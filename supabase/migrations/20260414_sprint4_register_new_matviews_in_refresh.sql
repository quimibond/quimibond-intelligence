-- Sprint 4 — Registrar las 3 matviews del Sprint 2 en las funciones de refresh
-- para que pg_cron las refresque cada 2 horas junto con las demás.
--
-- Matviews a registrar:
--   real_sale_price       (no deps, tier 1)
--   supplier_price_index  (no deps, tier 1)
--   rfm_segments          (depende de company_profile, tier 2)
--
-- Las 3 tienen UNIQUE index → soportan REFRESH CONCURRENTLY.
--
-- Bonus: agrega filtro defensivo en refresh_all_analytics_robust() para no
-- intentar refresh sobre objetos que no son matviews (weekly_trends es view).

------------------------------------------------------------------------------
-- 1) refresh_all_matviews() — versión con tier-based ordering
------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_all_matviews()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- ═══ TIER 1: No dependencies (base matviews) ═══
  REFRESH MATERIALIZED VIEW company_profile;
  REFRESH MATERIALIZED VIEW monthly_revenue_by_company;
  REFRESH MATERIALIZED VIEW portfolio_concentration;
  REFRESH MATERIALIZED VIEW ar_aging_detail;
  REFRESH MATERIALIZED VIEW accounting_anomalies;
  REFRESH MATERIALIZED VIEW customer_cohorts;
  REFRESH MATERIALIZED VIEW customer_margin_analysis;
  REFRESH MATERIALIZED VIEW customer_product_matrix;
  REFRESH MATERIALIZED VIEW supplier_product_matrix;
  REFRESH MATERIALIZED VIEW dead_stock_analysis;
  REFRESH MATERIALIZED VIEW inventory_velocity;
  REFRESH MATERIALIZED VIEW ops_delivery_health_weekly;
  REFRESH MATERIALIZED VIEW product_margin_analysis;
  REFRESH MATERIALIZED VIEW product_seasonality;
  REFRESH MATERIALIZED VIEW purchase_price_intelligence;
  REFRESH MATERIALIZED VIEW supplier_concentration_herfindahl;
  REFRESH MATERIALIZED VIEW company_email_intelligence;
  REFRESH MATERIALIZED VIEW company_handlers;
  REFRESH MATERIALIZED VIEW company_insight_history;
  REFRESH MATERIALIZED VIEW cross_director_signals;
  REFRESH MATERIALIZED VIEW cashflow_projection;

  -- ═══ TIER 1 (Sprint 2 — nuevos): No dependencies ═══
  REFRESH MATERIALIZED VIEW real_sale_price;
  REFRESH MATERIALIZED VIEW supplier_price_index;

  -- ═══ TIER 2: Depends on company_profile ═══
  REFRESH MATERIALIZED VIEW company_narrative;
  REFRESH MATERIALIZED VIEW customer_ltv_health;
  REFRESH MATERIALIZED VIEW payment_predictions;
  REFRESH MATERIALIZED VIEW client_reorder_predictions;

  -- ═══ TIER 2 (Sprint 2 — nuevos): Depends on company_profile (via tier join) ═══
  REFRESH MATERIALIZED VIEW rfm_segments;

  RAISE NOTICE 'All 28 materialized views refreshed successfully';
END;
$$;

------------------------------------------------------------------------------
-- 2) refresh_all_analytics_robust() — versión con error handling per matview
------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_all_analytics_robust(p_concurrent boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  start_ts timestamptz := clock_timestamp();
  method_ts timestamptz;
  errors int := 0;
  successes int := 0;
  result jsonb := '[]'::jsonb;
  v_matviews text[] := ARRAY[
    'company_profile',
    'payment_predictions',
    'cashflow_projection',
    'ar_aging_detail',
    'purchase_price_intelligence',
    'accounting_anomalies',
    'monthly_revenue_by_company',
    'customer_cohorts',
    'portfolio_concentration',
    'customer_margin_analysis',
    'product_seasonality',
    'inventory_velocity',
    'product_margin_analysis',
    'dead_stock_analysis',
    'client_reorder_predictions',
    'customer_product_matrix',
    'supplier_product_matrix',
    'company_narrative',
    'weekly_trends',
    'cross_director_signals',
    'company_email_intelligence',
    'company_insight_history',
    'company_handlers',
    'customer_ltv_health',
    'supplier_concentration_herfindahl',
    'ops_delivery_health_weekly',
    -- Sprint 2 — nuevos
    'real_sale_price',
    'supplier_price_index',
    'rfm_segments'
  ];
  v_mv text;
  v_has_unique_idx boolean;
  v_is_matview boolean;
  v_elapsed numeric;
  v_error text;
BEGIN
  FOREACH v_mv IN ARRAY v_matviews LOOP
    method_ts := clock_timestamp();
    v_error := NULL;

    -- Solo intentar refresh si es realmente una matview
    SELECT EXISTS (
      SELECT 1 FROM pg_matviews WHERE schemaname='public' AND matviewname=v_mv
    ) INTO v_is_matview;

    IF NOT v_is_matview THEN
      v_error := 'not a materialized view (skipped)';
      errors := errors + 1;
    ELSE
      SELECT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname='public' AND tablename=v_mv AND indexdef ILIKE '%UNIQUE%'
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
    END IF;

    v_elapsed := round(EXTRACT(EPOCH FROM clock_timestamp() - method_ts)::numeric, 2);
    INSERT INTO pipeline_logs (level, phase, message, details)
    VALUES (
      CASE WHEN v_error IS NULL THEN 'info' ELSE 'error' END,
      'refresh_matview',
      CASE WHEN v_error IS NULL
           THEN format('[%s] refreshed in %ss', v_mv, v_elapsed)
           ELSE format('[%s] FAILED: %s', v_mv, v_error) END,
      jsonb_build_object('matview', v_mv, 'elapsed_s', v_elapsed,
        'concurrent', p_concurrent AND v_has_unique_idx,
        'status', CASE WHEN v_error IS NULL THEN 'success' ELSE 'error' END,
        'error', v_error)
    );
    result := result || jsonb_build_object('matview', v_mv,
      'status', CASE WHEN v_error IS NULL THEN 'ok' ELSE 'error' END,
      'elapsed_s', v_elapsed, 'error', v_error);
  END LOOP;
  RETURN jsonb_build_object(
    'total_duration_ms', round(EXTRACT(EPOCH FROM clock_timestamp() - start_ts) * 1000),
    'successes', successes,
    'errors', errors,
    'matviews', result
  );
END;
$$;

COMMENT ON FUNCTION public.refresh_all_matviews() IS
'Refresh ordenado por tiers (deps) de las 28 matviews. Llamado por pg_cron cada 2 horas (15 */2 * * *). Sprint 4: agregadas real_sale_price, supplier_price_index, rfm_segments.';

COMMENT ON FUNCTION public.refresh_all_analytics_robust(boolean) IS
'Refresh robusto (try/catch per matview) con logging a pipeline_logs. Sprint 4: agregadas real_sale_price, supplier_price_index, rfm_segments. Filtra automáticamente entries que no sean matviews (weekly_trends es view).';
