-- Fase 2.5 baseline: snapshot antes de crear bridges y unificaciones
INSERT INTO public.audit_runs (run_id, invariant_key, severity, source, model, details, run_at)
SELECT
  gen_random_uuid(),
  'phase_2_5_baseline',
  'ok',
  'supabase',
  'baseline',
  jsonb_build_object(
    'invoice_bridge_exists', (SELECT count(*) FROM pg_views WHERE schemaname='public' AND viewname='invoice_bridge'),
    'invoice_bridge_manual_exists', (SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename='invoice_bridge_manual'),
    'products_unified_exists', (SELECT count(*) FROM pg_views WHERE schemaname='public' AND viewname='products_unified'),
    'products_fiscal_map_exists', (SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename='products_fiscal_map'),
    'product_price_history_exists', (SELECT count(*) FROM pg_matviews WHERE schemaname='public' AND matviewname='product_price_history'),
    'orders_unified_exists', (SELECT count(*) FROM pg_views WHERE schemaname='public' AND viewname='orders_unified'),
    'person_unified_exists', (SELECT count(*) FROM pg_views WHERE schemaname='public' AND viewname='person_unified'),
    'analytics_wrappers_count', (SELECT count(*) FROM pg_views WHERE schemaname='public' AND viewname LIKE 'analytics_finance_%' OR viewname LIKE 'analytics_revenue_%'),
    'reconciliation_issues_open', (SELECT count(*) FROM reconciliation_issues WHERE resolved_at IS NULL),
    'odoo_invoices_with_uuid', (SELECT count(*) FROM odoo_invoices WHERE cfdi_uuid IS NOT NULL),
    'syntage_issued_unmatched_2021', (
      SELECT count(*) FROM syntage_invoices s
      WHERE direction='issued' AND fecha_timbrado >= '2021-01-01'
        AND NOT EXISTS (SELECT 1 FROM odoo_invoices o WHERE o.cfdi_uuid=s.uuid)
    )
  ),
  now();
