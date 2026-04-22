-- supabase/migrations/1065_silver_sp5_amount_residual_mxn_resolved.sql
--
-- Silver SP5 — Task 24: backfill canonical_invoices.amount_residual_mxn_resolved
-- Idempotent: only updates rows where amount_residual_mxn_resolved IS NULL.
-- FX strategy mirrors SP4 Task 19 for amount_total_mxn_resolved:
--   MXN passthrough, USD uses usd_to_mxn(invoice_date), else tipo_cambio_sat, else passthrough.
--
-- Column-name adaptations (live-verified 2026-04-21):
--   plan said fiscal_moneda   → actual: currency_odoo  (aligned with amount_residual_mxn_odoo rows)
--   plan said odoo_currency   → actual: currency_odoo
--   plan said fiscal_tipo_cambio → actual: tipo_cambio_sat (tipo_cambio_odoo is 0% filled)
--   invoice_date → invoice_date (confirmed)
--
-- Pre-backfill gate counts (2026-04-21):
--   total=88462, already_filled=0, candidates_any=27198, candidates_positive=669
-- Post-backfill:
--   filled=27198, coverage_pct=100.00

BEGIN;

UPDATE canonical_invoices AS ci
SET amount_residual_mxn_resolved = CASE
  WHEN ci.amount_residual_mxn_odoo IS NULL THEN NULL
  WHEN UPPER(COALESCE(ci.currency_odoo, ci.currency_sat, 'MXN')) = 'MXN' THEN
    ci.amount_residual_mxn_odoo
  WHEN UPPER(COALESCE(ci.currency_odoo, ci.currency_sat)) = 'USD' THEN
    ci.amount_residual_mxn_odoo * COALESCE(usd_to_mxn(ci.invoice_date), ci.tipo_cambio_sat, 1)
  WHEN ci.tipo_cambio_sat IS NOT NULL AND ci.tipo_cambio_sat > 0 THEN
    ci.amount_residual_mxn_odoo * ci.tipo_cambio_sat
  ELSE ci.amount_residual_mxn_odoo
END
WHERE ci.amount_residual_mxn_resolved IS NULL
  AND ci.amount_residual_mxn_odoo IS NOT NULL;

INSERT INTO audit_runs (run_id, run_at, source, model, invariant_key, bucket_key, severity, details)
VALUES (
  gen_random_uuid(), now(), 'supabase', 'silver_sp5', 'sp5.task24', 'sp5_task24_residual_backfill', 'ok',
  jsonb_build_object(
    'label', 'sp5_task24_residual_mxn_backfill',
    'rows_filled',
      (SELECT COUNT(*) FROM canonical_invoices WHERE amount_residual_mxn_resolved IS NOT NULL),
    'coverage_pct',
      ROUND(100.0 * (SELECT COUNT(*) FILTER (WHERE amount_residual_mxn_resolved IS NOT NULL) FROM canonical_invoices)
            / NULLIF((SELECT COUNT(*) FROM canonical_invoices WHERE amount_residual_mxn_odoo IS NOT NULL), 0), 2)
  )
);

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
SELECT 'BACKFILL','canonical_invoices',
  'amount_residual_mxn_resolved populated via FX passthrough (SP5 Task 24)',
  'UPDATE canonical_invoices SET amount_residual_mxn_resolved = CASE currency_odoo MXN/USD/tc_sat/passthrough END WHERE amount_residual_mxn_resolved IS NULL AND amount_residual_mxn_odoo IS NOT NULL',
  'silver-sp5-task-24', true
WHERE NOT EXISTS (SELECT 1 FROM schema_changes WHERE triggered_by='silver-sp5-task-24');

COMMIT;
