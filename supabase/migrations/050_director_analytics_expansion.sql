-- Fase 7c: Expansion del arsenal analitico por director.
--
-- 5 nuevos objetos que cubren gaps concretos detectados en la auditoria.
-- Cada uno tiene un director-owner claro y alimenta el director-chat-context
-- para respuestas mas profundas.
--
-- Decisiones de diseno:
--   - VIEW (no materializada) para agregados pequenos y calculos simples que
--     cambian minuto a minuto (runway, salesperson workload).
--   - MATERIALIZED VIEW para joins pesados que tocan odoo_invoice_lines,
--     con unique index para permitir REFRESH CONCURRENTLY.
--   - Nombres descriptivos > cortos (customer_ltv_health, no ltv_score).

BEGIN;

-- ── 1. financial_runway (VIEW) ─────────────────────────────────────────
-- Runway calculado: cash disponible / burn rate estimado.
-- Director: financiero. Pregunta: "Cuantas semanas de nomina aguantamos?"
CREATE OR REPLACE VIEW financial_runway AS
WITH
  cash_now AS (
    SELECT COALESCE(SUM(balance), 0)::numeric AS cash_mxn
    FROM odoo_bank_balances
    WHERE account_type IN ('asset_cash', 'liability_credit_card')
  ),
  ar_expected_30d AS (
    -- Facturas out_invoice no pagadas con due_date en los proximos 30 dias
    SELECT COALESCE(SUM(amount_residual), 0)::numeric AS expected_in_mxn
    FROM odoo_invoices
    WHERE move_type = 'out_invoice'
      AND state = 'posted'
      AND payment_state IN ('not_paid', 'partial')
      AND due_date BETWEEN CURRENT_DATE - INTERVAL '30 days' AND CURRENT_DATE + INTERVAL '30 days'
  ),
  ap_due_30d AS (
    -- Facturas de proveedor a pagar en los proximos 30 dias
    SELECT COALESCE(SUM(amount_residual), 0)::numeric AS due_out_mxn
    FROM odoo_invoices
    WHERE move_type = 'in_invoice'
      AND state = 'posted'
      AND payment_state IN ('not_paid', 'partial')
      AND due_date BETWEEN CURRENT_DATE - INTERVAL '30 days' AND CURRENT_DATE + INTERVAL '30 days'
  ),
  burn_60d AS (
    -- Burn rate: salidas reales del banco en los ultimos 60 dias (payments.outbound)
    SELECT COALESCE(SUM(amount), 0)::numeric AS outflow_60d
    FROM odoo_account_payments
    WHERE date >= CURRENT_DATE - INTERVAL '60 days'
      AND partner_type = 'supplier'
  )
SELECT
  cn.cash_mxn,
  ar.expected_in_mxn,
  ap.due_out_mxn,
  (cn.cash_mxn + ar.expected_in_mxn - ap.due_out_mxn) AS net_position_30d,
  (b.outflow_60d / 60.0)::numeric AS burn_rate_daily,
  CASE
    WHEN b.outflow_60d <= 0 THEN NULL
    ELSE ROUND(((cn.cash_mxn + ar.expected_in_mxn - ap.due_out_mxn) / (b.outflow_60d / 60.0))::numeric, 0)
  END AS runway_days_net,
  CASE
    WHEN b.outflow_60d <= 0 THEN NULL
    ELSE ROUND((cn.cash_mxn / (b.outflow_60d / 60.0))::numeric, 0)
  END AS runway_days_cash_only,
  NOW() AS computed_at
FROM cash_now cn
CROSS JOIN ar_expected_30d ar
CROSS JOIN ap_due_30d ap
CROSS JOIN burn_60d b;

COMMENT ON VIEW financial_runway IS
  'Runway en dias: cash_now + AR proximos 30d - AP proximos 30d, dividido entre burn rate diario (60d rolling). Para el director financiero. View (no matview) porque cambia minuto a minuto y es de una sola fila.';

-- ── 2. customer_ltv_health (MATERIALIZED VIEW) ─────────────────────────
-- LTV + 12m revenue + churn risk score + overdue score por empresa.
-- Director: comercial + riesgo.
CREATE MATERIALIZED VIEW IF NOT EXISTS customer_ltv_health AS
WITH sales_hist AS (
  SELECT
    il.company_id,
    COUNT(DISTINCT il.move_name) AS total_invoices,
    MIN(il.invoice_date) AS first_purchase,
    MAX(il.invoice_date) AS last_purchase,
    SUM(il.price_subtotal) AS ltv_revenue,
    SUM(CASE WHEN il.invoice_date >= CURRENT_DATE - INTERVAL '12 months' THEN il.price_subtotal ELSE 0 END) AS revenue_12m,
    SUM(CASE WHEN il.invoice_date >= CURRENT_DATE - INTERVAL '3 months' THEN il.price_subtotal ELSE 0 END) AS revenue_3m,
    SUM(CASE WHEN il.invoice_date >= CURRENT_DATE - INTERVAL '12 months' AND il.invoice_date < CURRENT_DATE - INTERVAL '3 months' THEN il.price_subtotal ELSE 0 END) AS revenue_3m_to_12m
  FROM odoo_invoice_lines il
  WHERE il.move_type = 'out_invoice'
    AND il.company_id IS NOT NULL
    AND il.invoice_date IS NOT NULL
    AND il.quantity > 0
  GROUP BY il.company_id
),
overdue AS (
  SELECT
    company_id,
    SUM(amount_residual)::numeric AS overdue_amount,
    MAX(days_overdue) AS max_days_overdue,
    COUNT(*) AS overdue_count
  FROM odoo_invoices
  WHERE move_type = 'out_invoice'
    AND state = 'posted'
    AND payment_state IN ('not_paid', 'partial')
    AND days_overdue > 0
    AND company_id IS NOT NULL
  GROUP BY company_id
)
SELECT
  c.id AS company_id,
  c.canonical_name AS company_name,
  c.tier,
  COALESCE(sh.total_invoices, 0) AS total_invoices,
  sh.first_purchase,
  sh.last_purchase,
  COALESCE(sh.ltv_revenue, 0)::numeric AS ltv_mxn,
  COALESCE(sh.revenue_12m, 0)::numeric AS revenue_12m,
  COALESCE(sh.revenue_3m, 0)::numeric AS revenue_3m,
  -- Churn signal: revenue_3m vs (revenue_12m - revenue_3m) / 3  (trimestre actual vs promedio trimestral previo)
  CASE
    WHEN sh.revenue_3m_to_12m > 0
    THEN ROUND(((COALESCE(sh.revenue_3m, 0) / (sh.revenue_3m_to_12m / 3.0)) - 1) * 100, 1)
    ELSE NULL
  END AS trend_pct_vs_prior_quarters,
  COALESCE(o.overdue_amount, 0)::numeric AS overdue_mxn,
  COALESCE(o.max_days_overdue, 0) AS max_days_overdue,
  COALESCE(o.overdue_count, 0) AS overdue_invoices,
  -- Churn risk score 0..100 (100 = alto riesgo de churn)
  LEAST(100, GREATEST(0,
    CASE WHEN sh.last_purchase IS NULL THEN 100
         ELSE LEAST(80, (CURRENT_DATE - sh.last_purchase))
    END +
    CASE WHEN COALESCE(o.max_days_overdue, 0) >= 60 THEN 20
         WHEN COALESCE(o.max_days_overdue, 0) >= 30 THEN 10
         ELSE 0
    END
  ))::int AS churn_risk_score,
  -- Overdue risk score 0..100
  LEAST(100, GREATEST(0,
    LEAST(60, COALESCE(o.max_days_overdue, 0)) +
    CASE WHEN COALESCE(o.overdue_amount, 0) > 500000 THEN 40
         WHEN COALESCE(o.overdue_amount, 0) > 100000 THEN 20
         WHEN COALESCE(o.overdue_amount, 0) > 0 THEN 10
         ELSE 0
    END
  ))::int AS overdue_risk_score,
  (CURRENT_DATE - COALESCE(sh.last_purchase, CURRENT_DATE - INTERVAL '1000 days')) AS days_since_last_order,
  NOW() AS computed_at
FROM companies c
LEFT JOIN sales_hist sh ON sh.company_id = c.id
LEFT JOIN overdue o ON o.company_id = c.id
WHERE c.is_customer = true;

CREATE UNIQUE INDEX idx_customer_ltv_health_pk ON customer_ltv_health (company_id);
CREATE INDEX idx_customer_ltv_health_churn ON customer_ltv_health (churn_risk_score DESC);
CREATE INDEX idx_customer_ltv_health_ltv ON customer_ltv_health (ltv_mxn DESC);

COMMENT ON MATERIALIZED VIEW customer_ltv_health IS
  'LTV + revenue 12m/3m + trend + churn risk score + overdue risk score por empresa cliente. Scores 0-100 (100 = alto riesgo). Director comercial y riesgo.';

-- ── 3. supplier_concentration_herfindahl (MATERIALIZED VIEW) ───────────
-- Indice Herfindahl por producto: mide cuanto dependemos de un solo proveedor.
-- Director: compras + riesgo.
CREATE MATERIALIZED VIEW IF NOT EXISTS supplier_concentration_herfindahl AS
WITH purchases_12m AS (
  SELECT
    il.odoo_product_id,
    il.product_ref,
    il.product_name,
    il.company_id AS supplier_id,
    SUM(il.price_subtotal) AS spent
  FROM odoo_invoice_lines il
  WHERE il.move_type = 'in_invoice'
    AND il.invoice_date >= CURRENT_DATE - INTERVAL '12 months'
    AND il.odoo_product_id IS NOT NULL
    AND il.quantity > 0
  GROUP BY il.odoo_product_id, il.product_ref, il.product_name, il.company_id
),
product_total AS (
  SELECT odoo_product_id, SUM(spent) AS total_spent
  FROM purchases_12m
  GROUP BY odoo_product_id
),
shares AS (
  SELECT
    p.odoo_product_id,
    MAX(p.product_ref) AS product_ref,
    MAX(p.product_name) AS product_name,
    COUNT(DISTINCT p.supplier_id) AS supplier_count,
    SUM(POWER(p.spent / NULLIF(pt.total_spent, 0), 2)) AS herfindahl_idx,
    MAX(pt.total_spent) AS total_spent_12m,
    MAX(p.spent / NULLIF(pt.total_spent, 0)) AS top_supplier_share
  FROM purchases_12m p
  JOIN product_total pt ON pt.odoo_product_id = p.odoo_product_id
  GROUP BY p.odoo_product_id
),
top_supplier AS (
  SELECT DISTINCT ON (p.odoo_product_id)
    p.odoo_product_id,
    co.canonical_name AS top_supplier_name,
    co.id AS top_supplier_company_id,
    p.spent AS top_supplier_spent
  FROM purchases_12m p
  LEFT JOIN companies co ON co.id = p.supplier_id
  ORDER BY p.odoo_product_id, p.spent DESC
)
SELECT
  s.odoo_product_id,
  s.product_ref,
  s.product_name,
  s.supplier_count,
  ROUND(s.herfindahl_idx::numeric, 4) AS herfindahl_idx,
  ROUND((s.top_supplier_share * 100)::numeric, 1) AS top_supplier_share_pct,
  ROUND(s.total_spent_12m::numeric, 0) AS total_spent_12m,
  ts.top_supplier_name,
  ts.top_supplier_company_id,
  ROUND(ts.top_supplier_spent::numeric, 0) AS top_supplier_spent_12m,
  CASE
    WHEN s.supplier_count = 1 THEN 'single_source'
    WHEN s.herfindahl_idx > 0.7 THEN 'very_high'
    WHEN s.herfindahl_idx > 0.5 THEN 'high'
    WHEN s.herfindahl_idx > 0.3 THEN 'moderate'
    ELSE 'diversified'
  END AS concentration_level,
  NOW() AS computed_at
FROM shares s
LEFT JOIN top_supplier ts ON ts.odoo_product_id = s.odoo_product_id;

CREATE UNIQUE INDEX idx_supplier_herfindahl_pk ON supplier_concentration_herfindahl (odoo_product_id);
CREATE INDEX idx_supplier_herfindahl_level ON supplier_concentration_herfindahl (concentration_level);
CREATE INDEX idx_supplier_herfindahl_spent ON supplier_concentration_herfindahl (total_spent_12m DESC);

COMMENT ON MATERIALIZED VIEW supplier_concentration_herfindahl IS
  'Indice Herfindahl (0-1) por producto en compras 12m. herfindahl_idx > 0.7 = muy concentrado. supplier_count=1 = single source. Director compras y riesgo.';

-- ── 4. salesperson_workload_30d (VIEW) ─────────────────────────────────
-- Workload real por vendedor: ordenes abiertas + actividades vencidas + cartera.
-- Director: equipo.
CREATE OR REPLACE VIEW salesperson_workload_30d AS
WITH open_orders AS (
  SELECT
    so.salesperson_user_id,
    so.salesperson_name,
    COUNT(*) AS open_orders,
    SUM(so.amount_untaxed) AS open_order_value
  FROM odoo_sale_orders so
  WHERE so.state IN ('sale', 'draft')
    AND so.salesperson_user_id IS NOT NULL
  GROUP BY so.salesperson_user_id, so.salesperson_name
),
recent_sales AS (
  SELECT
    so.salesperson_user_id,
    COUNT(*) AS orders_30d,
    SUM(so.amount_untaxed) AS revenue_30d
  FROM odoo_sale_orders so
  WHERE so.date_order >= CURRENT_DATE - INTERVAL '30 days'
    AND so.state IN ('sale', 'done')
    AND so.salesperson_user_id IS NOT NULL
  GROUP BY so.salesperson_user_id
),
overdue_by_sp AS (
  -- Cartera vencida de los clientes que maneja cada vendedor (via top salesperson en company_handlers equivalente)
  SELECT
    cp.name AS company_name,
    SUM(inv.amount_residual) AS overdue_mxn,
    MAX(inv.days_overdue) AS max_days_overdue
  FROM odoo_invoices inv
  JOIN companies cp ON cp.id = inv.company_id
  WHERE inv.move_type = 'out_invoice'
    AND inv.state = 'posted'
    AND inv.payment_state IN ('not_paid', 'partial')
    AND inv.days_overdue > 0
  GROUP BY cp.name
),
activities_by_user AS (
  SELECT
    assigned_to,
    COUNT(*) AS total_activities,
    COUNT(*) FILTER (WHERE is_overdue = true) AS overdue_activities
  FROM odoo_activities
  GROUP BY assigned_to
)
SELECT
  u.odoo_user_id,
  u.name AS salesperson_name,
  u.email,
  u.department,
  COALESCE(oo.open_orders, 0) AS open_orders,
  COALESCE(ROUND(oo.open_order_value::numeric, 0), 0) AS open_order_value,
  COALESCE(rs.orders_30d, 0) AS orders_30d,
  COALESCE(ROUND(rs.revenue_30d::numeric, 0), 0) AS revenue_30d,
  COALESCE(au.total_activities, 0) AS total_activities,
  COALESCE(au.overdue_activities, 0) AS overdue_activities,
  CASE
    WHEN COALESCE(au.total_activities, 0) = 0 THEN NULL
    ELSE ROUND(100.0 * au.overdue_activities / au.total_activities, 1)
  END AS overdue_activities_pct,
  -- Health score: 0 = excelente, 100 = critico
  LEAST(100, GREATEST(0,
    CASE WHEN COALESCE(au.overdue_activities, 0) > 50 THEN 40
         WHEN COALESCE(au.overdue_activities, 0) > 20 THEN 20
         WHEN COALESCE(au.overdue_activities, 0) > 5 THEN 10
         ELSE 0
    END +
    CASE WHEN COALESCE(oo.open_orders, 0) > 50 THEN 30
         WHEN COALESCE(oo.open_orders, 0) > 20 THEN 15
         ELSE 0
    END +
    CASE WHEN COALESCE(rs.orders_30d, 0) = 0 AND COALESCE(oo.open_orders, 0) = 0 THEN 30
         ELSE 0
    END
  ))::int AS workload_stress_score
FROM odoo_users u
LEFT JOIN open_orders oo ON oo.salesperson_user_id = u.odoo_user_id
LEFT JOIN recent_sales rs ON rs.salesperson_user_id = u.odoo_user_id
LEFT JOIN activities_by_user au ON au.assigned_to = u.name
WHERE u.department IS NOT NULL
  AND (COALESCE(oo.open_orders, 0) > 0 OR COALESCE(rs.orders_30d, 0) > 0 OR COALESCE(au.overdue_activities, 0) > 0)
ORDER BY workload_stress_score DESC, open_order_value DESC;

COMMENT ON VIEW salesperson_workload_30d IS
  'Carga real por vendedor: open orders, revenue 30d, actividades vencidas, workload_stress_score 0-100. Para el director equipo.';

-- ── 5. ops_delivery_health_weekly (MATERIALIZED VIEW) ──────────────────
-- OTD + avg days late + throughput semanal, rolling 12 semanas.
-- Director: operaciones.
CREATE MATERIALIZED VIEW IF NOT EXISTS ops_delivery_health_weekly AS
WITH weeks AS (
  SELECT
    date_trunc('week', date_done)::date AS week_start,
    COUNT(*) AS total_completed,
    COUNT(*) FILTER (WHERE is_late = false) AS on_time,
    COUNT(*) FILTER (WHERE is_late = true) AS late,
    AVG(lead_time_days) FILTER (WHERE lead_time_days IS NOT NULL) AS avg_lead_days
  FROM odoo_deliveries
  WHERE state = 'done'
    AND date_done >= CURRENT_DATE - INTERVAL '12 weeks'
  GROUP BY date_trunc('week', date_done)::date
)
SELECT
  week_start,
  total_completed,
  on_time,
  late,
  CASE
    WHEN total_completed > 0 THEN ROUND(100.0 * on_time / total_completed, 1)
    ELSE NULL
  END AS otd_pct,
  ROUND(avg_lead_days::numeric, 1) AS avg_lead_days,
  NOW() AS computed_at
FROM weeks
ORDER BY week_start DESC;

CREATE UNIQUE INDEX idx_ops_delivery_weekly_pk ON ops_delivery_health_weekly (week_start);

COMMENT ON MATERIALIZED VIEW ops_delivery_health_weekly IS
  'OTD rate semanal rolling 12 semanas + avg lead time. Director operaciones.';

-- ── 6. Extender refresh_all_analytics_robust con las 3 matviews nuevas ─
-- Re-crea la funcion con el array actualizado. Incluye las 23 originales +
-- customer_ltv_health, supplier_concentration_herfindahl, ops_delivery_health_weekly.
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
  v_matviews text[] := ARRAY[
    -- Base
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
    'company_handlers',
    -- Nuevas (Fase 7c)
    'customer_ltv_health',
    'supplier_concentration_herfindahl',
    'ops_delivery_health_weekly'
  ];
  v_mv text;
  v_has_unique_idx boolean;
  v_elapsed numeric;
  v_error text;
BEGIN
  FOREACH v_mv IN ARRAY v_matviews LOOP
    method_ts := clock_timestamp();
    v_error := NULL;

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

COMMIT;
