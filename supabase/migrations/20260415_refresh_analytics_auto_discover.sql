-- Audit finding (2026-04-15): refresh_all_analytics_robust had a hardcoded
-- list of matviews that was out of sync with reality:
--
--   - `weekly_trends` listed but is a regular view → failed every 6h
--     (1 error/refresh, noise in pipeline_logs)
--
--   - `product_real_cost` (UPSTREAM matview) NOT listed → stale, silently
--     broke 6 downstream matviews that depend on it:
--       inventory_velocity, real_sale_price, dead_stock_analysis,
--       customer_margin_analysis, product_margin_analysis
--       (plus views invoice_line_margins, working_capital_cycle)
--     Result: directors Costos and Comercial read margin insights computed
--     against stale product costs.
--
--   - `bom_duplicate_components` also NOT listed → stale.
--
-- Fix: auto-discover all matviews in public schema every refresh. Upstream
-- matviews (product_real_cost, bom_duplicate_components) refresh FIRST so
-- downstream ones have fresh inputs. Any new matview added in the future
-- gets picked up automatically — no more hardcoded list drift.

CREATE OR REPLACE FUNCTION public.refresh_all_analytics_robust(p_concurrent boolean DEFAULT true)
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
  -- Upstream matviews that feed other matviews — must refresh FIRST
  v_upstream text[] := ARRAY[
    'product_real_cost',        -- feeds inventory_velocity, real_sale_price,
                                --   dead_stock_analysis, customer_margin_analysis,
                                --   product_margin_analysis (plus 2 views)
    'bom_duplicate_components'  -- data quality check on mrp.bom
  ];
  v_matviews text[];
  v_mv text;
  v_has_unique_idx boolean;
  v_elapsed numeric;
  v_error text;
BEGIN
  -- Auto-discover all matviews, upstream first, remaining alphabetical.
  v_matviews := v_upstream || ARRAY(
    SELECT matviewname::text
    FROM pg_matviews
    WHERE schemaname = 'public'
      AND matviewname <> ALL(v_upstream)
    ORDER BY matviewname
  );

  FOREACH v_mv IN ARRAY v_matviews LOOP
    method_ts := clock_timestamp();
    v_error := NULL;

    IF NOT EXISTS (
      SELECT 1 FROM pg_matviews WHERE schemaname='public' AND matviewname=v_mv
    ) THEN
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
$function$;
