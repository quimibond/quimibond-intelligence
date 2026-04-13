-- Fase 7a: Fix critico al refresh chain de matviews.
--
-- Diagnostico (13-abr-2026):
--   - 23 materialized views existen y tienen datos
--   - refresh_all_analytics() crashea en product_seasonality con:
--     duplicate key value violates unique constraint "idx_ps_pk"
--     Key (odoo_product_id, month_num)=(18713, 4) already exists.
--   - Causa raiz: product_monthly_avg CTE agrupa por
--     (odoo_product_id, product_name, product_ref, month_num, month_name).
--     Si un producto (ej: 18713) tiene 2 nombres distintos entre invoices
--     (rename en Odoo), el GROUP BY produce 2 filas para la misma
--     (product_id, month_num), violando el unique index.
--   - Consecuencia: el cron /api/pipeline/refresh-views ha estado fallando
--     cada 6h hace dias. Las matviews posteriores a product_seasonality en
--     el orden de refresh_all_analytics() NO se refrescan: inventory_velocity,
--     product_margin_analysis, dead_stock_analysis, client_reorder_predictions,
--     customer_product_matrix, supplier_product_matrix, company_narrative,
--     weekly_trends, cross_director_signals, company_email_intelligence,
--     company_insight_history, company_handlers.
--
-- Fix:
--   1. Redefinir product_seasonality: group por (odoo_product_id, month_num)
--      solo; resolver product_name/product_ref via JOIN con odoo_products al
--      final (garantiza unicidad).
--   2. Nueva funcion refresh_all_analytics_robust() que envuelve cada
--      REFRESH en su propio BEGIN/EXCEPTION block. Si una matview falla,
--      las otras 22 siguen. Log per-step a pipeline_logs con
--      phase='refresh_matview'.
--   3. Apuntar /api/pipeline/refresh-views a la version robusta (codigo
--      frontend en commit separado).

BEGIN;

-- ── 1. Redefinir product_seasonality sin riesgo de duplicados ─────────
DROP MATERIALIZED VIEW IF EXISTS product_seasonality CASCADE;

CREATE MATERIALIZED VIEW product_seasonality AS
WITH monthly_sales AS (
  SELECT
    il.odoo_product_id,
    (EXTRACT(month FROM il.invoice_date))::int AS month_num,
    to_char(il.invoice_date::timestamptz, 'Mon') AS month_name,
    (EXTRACT(year FROM il.invoice_date))::int AS year,
    sum(il.quantity) AS total_qty,
    sum(il.price_subtotal) AS total_revenue,
    count(DISTINCT il.company_id) AS distinct_customers
  FROM odoo_invoice_lines il
  WHERE il.move_type = 'out_invoice'
    AND il.invoice_date IS NOT NULL
    AND il.odoo_product_id IS NOT NULL
    AND il.quantity > 0
  GROUP BY il.odoo_product_id, month_num, month_name, year
),
product_monthly_avg AS (
  SELECT
    odoo_product_id,
    month_num,
    max(month_name) AS month_name,
    round(avg(total_qty), 2) AS avg_monthly_qty,
    round(avg(total_revenue), 2) AS avg_monthly_revenue,
    round(avg(distinct_customers), 1) AS avg_monthly_customers,
    count(DISTINCT year) AS years_of_data
  FROM monthly_sales
  GROUP BY odoo_product_id, month_num
),
product_overall AS (
  SELECT
    odoo_product_id,
    round(avg(avg_monthly_qty), 2) AS overall_avg_qty,
    round(avg(avg_monthly_revenue), 2) AS overall_avg_revenue
  FROM product_monthly_avg
  GROUP BY odoo_product_id
)
SELECT
  pma.odoo_product_id,
  p.name AS product_name,
  p.internal_ref AS product_ref,
  pma.month_num,
  pma.month_name,
  pma.avg_monthly_qty,
  pma.avg_monthly_revenue,
  pma.avg_monthly_customers,
  pma.years_of_data,
  po.overall_avg_qty,
  po.overall_avg_revenue,
  CASE WHEN po.overall_avg_qty > 0
       THEN round(pma.avg_monthly_qty / po.overall_avg_qty, 2)
       ELSE NULL END AS qty_seasonality_idx,
  CASE WHEN po.overall_avg_revenue > 0
       THEN round(pma.avg_monthly_revenue / po.overall_avg_revenue, 2)
       ELSE NULL END AS revenue_seasonality_idx,
  CASE
    WHEN po.overall_avg_qty > 0 AND (pma.avg_monthly_qty / po.overall_avg_qty) > 1.5 THEN 'peak'
    WHEN po.overall_avg_qty > 0 AND (pma.avg_monthly_qty / po.overall_avg_qty) < 0.5 THEN 'trough'
    ELSE 'normal'
  END AS season_class
FROM product_monthly_avg pma
JOIN product_overall po USING (odoo_product_id)
LEFT JOIN odoo_products p ON p.odoo_product_id = pma.odoo_product_id
ORDER BY pma.odoo_product_id, pma.month_num;

CREATE UNIQUE INDEX idx_ps_pk ON product_seasonality (odoo_product_id, month_num);
CREATE INDEX idx_ps_season ON product_seasonality (season_class);

-- ── 2. Robust refresh function (per-matview try/catch + logging) ──────
CREATE OR REPLACE FUNCTION refresh_all_analytics_robust(p_concurrent boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  start_ts timestamptz := clock_timestamp();
  method_ts timestamptz;
  errors int := 0;
  successes int := 0;
  result jsonb := '[]'::jsonb;
  -- Order: deps primero (company_profile), heavy despues. CONCURRENTLY
  -- solo funciona con unique index — las views sin unique se refrescan
  -- blocking (rapidas).
  v_matviews text[] := ARRAY[
    -- Base (deps de payment_predictions + otros)
    'company_profile',
    'payment_predictions',
    -- Financials
    'cashflow_projection',
    'ar_aging_detail',
    'purchase_price_intelligence',
    'accounting_anomalies',
    -- Revenue & customer
    'monthly_revenue_by_company',
    'customer_cohorts',
    'portfolio_concentration',
    'customer_margin_analysis',
    -- Products
    'product_seasonality',
    'inventory_velocity',
    'product_margin_analysis',
    'dead_stock_analysis',
    'client_reorder_predictions',
    -- Cross-cutting
    'customer_product_matrix',
    'supplier_product_matrix',
    'company_narrative',
    'weekly_trends',
    'cross_director_signals',
    'company_email_intelligence',
    'company_insight_history',
    'company_handlers'
  ];
  v_mv text;
  v_has_unique_idx boolean;
  v_elapsed numeric;
  v_error text;
BEGIN
  FOREACH v_mv IN ARRAY v_matviews LOOP
    method_ts := clock_timestamp();
    v_error := NULL;

    -- Detectar si tiene unique index (requisito para CONCURRENTLY)
    SELECT EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname='public' AND tablename=v_mv
      AND indexdef ILIKE '%UNIQUE%'
    ) INTO v_has_unique_idx;

    BEGIN
      IF p_concurrent AND v_has_unique_idx THEN
        EXECUTE format('REFRESH MATERIALIZED VIEW CONCURRENTLY %I', v_mv);
      ELSE
        EXECUTE format('REFRESH MATERIALIZED VIEW %I', v_mv);
      END IF;
      successes := successes + 1;
    EXCEPTION WHEN OTHERS THEN
      errors := errors + 1;
      v_error := substring(SQLERRM for 400);
    END;

    v_elapsed := round(EXTRACT(EPOCH FROM clock_timestamp() - method_ts)::numeric, 2);

    -- Log per-matview a pipeline_logs
    INSERT INTO pipeline_logs (level, phase, message, details)
    VALUES (
      CASE WHEN v_error IS NULL THEN 'info' ELSE 'error' END,
      'refresh_matview',
      CASE WHEN v_error IS NULL
           THEN format('[%s] refreshed in %ss', v_mv, v_elapsed)
           ELSE format('[%s] FAILED: %s', v_mv, v_error) END,
      jsonb_build_object(
        'matview', v_mv,
        'elapsed_s', v_elapsed,
        'concurrent', p_concurrent AND v_has_unique_idx,
        'status', CASE WHEN v_error IS NULL THEN 'success' ELSE 'error' END,
        'error', v_error
      )
    );

    result := result || jsonb_build_object(
      'matview', v_mv,
      'status', CASE WHEN v_error IS NULL THEN 'ok' ELSE 'error' END,
      'elapsed_s', v_elapsed,
      'error', v_error
    );
  END LOOP;

  RETURN jsonb_build_object(
    'total_duration_ms', round(EXTRACT(EPOCH FROM clock_timestamp() - start_ts) * 1000),
    'successes', successes,
    'errors', errors,
    'matviews', result
  );
END;
$function$;

COMMENT ON FUNCTION refresh_all_analytics_robust IS
  'Refresh de las 23 matviews del sistema con try/catch individual. Si una falla, las demas siguen. Loggea a pipeline_logs con phase=refresh_matview. Reemplaza a refresh_all_analytics() que cascadeba cualquier error.';

COMMIT;
