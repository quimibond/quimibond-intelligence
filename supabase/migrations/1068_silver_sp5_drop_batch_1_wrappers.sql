-- Migration: 1068_silver_sp5_drop_batch_1_wrappers
-- Renames Batch 1 legacy views/MVs to _deprecated_sp5. Reversible.
-- Physical DROP happens in T29 after 24h soak.
--
-- Excluded from batch (KEEP consumers still reference them):
--   pl_estado_resultados  → overhead_factor_12m (§12 KEEP, active callers in sales.ts / system.ts)
--   customer_product_matrix → stockout_queue (§12 KEEP, active caller in analytics/index.ts)
--
-- Already absent (10 — dropped in prior SP work, skipped automatically):
--   balance_sheet, invoice_bridge, monthly_revenue_trend, order_fulfillment_bridge,
--   orders_unified, person_unified, product_price_history, unified_invoices,
--   unified_payment_allocations, working_capital

BEGIN;

DO $$
DECLARE
  obj RECORD;
  candidates text[] := ARRAY[
    'unified_invoices','unified_payment_allocations','invoice_bridge','orders_unified',
    'order_fulfillment_bridge','person_unified','cash_position','cashflow_current_cash',
    'cashflow_liquidity_metrics','working_capital','revenue_concentration',
    'portfolio_concentration','monthly_revenue_trend','monthly_revenue_by_company',
    'analytics_customer_360','balance_sheet',
    -- pl_estado_resultados EXCLUDED: overhead_factor_12m (KEEP) depends on it
    'customer_margin_analysis','customer_ltv_health',
    -- customer_product_matrix EXCLUDED: stockout_queue (KEEP) depends on it
    'supplier_product_matrix','supplier_price_index','supplier_concentration_herfindahl',
    'rfm_segments','customer_cohorts','partner_payment_profile','account_payment_profile',
    'product_margin_analysis','product_price_history'
  ];
  nm text;
BEGIN
  FOREACH nm IN ARRAY candidates LOOP
    FOR obj IN
      SELECT c.relname, c.relkind
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname = nm
    LOOP
      EXECUTE format('ALTER %s public.%I RENAME TO %I',
        CASE obj.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' ELSE 'TABLE' END,
        obj.relname, obj.relname || '_deprecated_sp5');
      RAISE NOTICE 'Renamed % → %', obj.relname, obj.relname || '_deprecated_sp5';
    END LOOP;
  END LOOP;
END $$;

INSERT INTO audit_runs (run_id, run_at, source, model, invariant_key, bucket_key, severity, details)
VALUES (gen_random_uuid(), now(), 'supabase', 'silver_sp5', 'sp5.task27', 'sp5_task27_drop_batch_1', 'ok',
  jsonb_build_object(
    'label', 'sp5_task27_drop_batch_1_renamed',
    'candidates', 27,
    'excluded_keep_dependency', ARRAY['pl_estado_resultados','customer_product_matrix'],
    'already_absent', ARRAY['balance_sheet','invoice_bridge','monthly_revenue_trend',
      'order_fulfillment_bridge','orders_unified','person_unified','product_price_history',
      'unified_invoices','unified_payment_allocations','working_capital']
  ));

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
SELECT 'RENAME_TABLE', 'multiple',
  'Batch 1 legacy views/MVs renamed _deprecated_sp5 (reversible; DROP in T29 after soak). Excluded: pl_estado_resultados (overhead_factor_12m KEEP dep) + customer_product_matrix (stockout_queue KEEP dep).',
  'ALTER VIEW/MV ... RENAME TO ...',
  'silver-sp5-task-27', true
WHERE NOT EXISTS (SELECT 1 FROM schema_changes WHERE triggered_by='silver-sp5-task-27');

COMMIT;
