-- SP2 baseline snapshot
BEGIN;

INSERT INTO audit_runs (run_id, source, model, invariant_key, bucket_key, odoo_value, supabase_value, diff, severity, date_from, date_to, details, run_at)
SELECT
  gen_random_uuid(),
  'supabase', 'baseline', 'pre_sp2_baseline', 'global',
  NULL, NULL, NULL, 'ok',
  NULL, NULL,
  jsonb_build_object(
    'label',                              'sp2-baseline-' || to_char(now(),'YYYYMMDD-HH24MISS'),
    'odoo_invoices_total',                (SELECT COUNT(*) FROM odoo_invoices),
    'odoo_with_uuid',                     (SELECT COUNT(*) FROM odoo_invoices WHERE cfdi_uuid IS NOT NULL),
    'odoo_null_uuid_post2021',            (SELECT COUNT(*) FROM odoo_invoices WHERE cfdi_uuid IS NULL AND state='posted' AND invoice_date>='2021-01-01'),
    'odoo_refunds',                       (SELECT COUNT(*) FROM odoo_invoices WHERE move_type IN ('out_refund','in_refund')),
    'odoo_payments',                      (SELECT COUNT(*) FROM odoo_account_payments),
    'syntage_invoices',                   (SELECT COUNT(*) FROM syntage_invoices),
    'syntage_i',                          (SELECT COUNT(*) FROM syntage_invoices WHERE tipo_comprobante='I'),
    'syntage_e',                          (SELECT COUNT(*) FROM syntage_invoices WHERE tipo_comprobante='E'),
    'syntage_p',                          (SELECT COUNT(*) FROM syntage_invoices WHERE tipo_comprobante='P'),
    'syntage_payments',                   (SELECT COUNT(*) FROM syntage_invoice_payments),
    'syntage_retentions',                 (SELECT COUNT(*) FROM syntage_tax_retentions),
    'syntage_returns',                    (SELECT COUNT(*) FROM syntage_tax_returns),
    'syntage_ea',                         (SELECT COUNT(*) FROM syntage_electronic_accounting),
    'bridge_invoices',                    (SELECT COUNT(*) FROM invoice_bridge_manual),
    'bridge_payments',                    (SELECT COUNT(*) FROM payment_bridge_manual),
    'products_map',                       (SELECT COUNT(*) FROM products_fiscal_map),
    'audit_rows',                         (SELECT COUNT(*) FROM audit_tolerances),
    'reconciliation_rows',                (SELECT COUNT(*) FROM reconciliation_issues)
  ),
  now();

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('sp2_baseline', '', 'Silver SP2 baseline snapshot captured', '20260422_sp2_00_baseline.sql', 'silver-sp2', true);

COMMIT;
