-- Reorg R3.1: analytics_supplier_360 — master para proveedores (simétrico a customer_360)

CREATE OR REPLACE VIEW public.analytics_supplier_360 AS
SELECT
  cp.company_id, cp.name, cp.canonical_name, cp.is_customer, cp.is_supplier,
  cp.industry, cp.tier, cp.risk_level,
  cp.total_purchases AS spend_lifetime_mxn, cp.last_purchase_date,
  (SELECT count(*) FROM public.odoo_invoices oi
   WHERE oi.company_id = cp.company_id AND oi.move_type='in_invoice'
     AND oi.payment_state IN ('not_paid','partial')) AS overdue_supplier_invoices,
  (SELECT sum(COALESCE(amount_residual_mxn, amount_residual)) FROM public.odoo_invoices oi
   WHERE oi.company_id = cp.company_id AND oi.move_type='in_invoice'
     AND oi.payment_state IN ('not_paid','partial')) AS we_owe_mxn,
  sfl.lifetime_spend_mxn AS fiscal_lifetime_spend_mxn,
  sfl.spend_12m_mxn AS fiscal_spend_12m_mxn,
  sfl.yoy_pct AS fiscal_yoy_pct,
  sfl.retenciones_lifetime_mxn AS fiscal_retenciones_mxn,
  sfl.first_cfdi AS fiscal_first_cfdi, sfl.last_cfdi AS fiscal_last_cfdi,
  sfl.days_since_last_cfdi AS fiscal_days_since_last_cfdi,
  (SELECT count(*) FROM public.reconciliation_issues ri
   WHERE ri.company_id = cp.company_id AND ri.resolved_at IS NULL) AS fiscal_issues_open,
  (SELECT count(*) FROM public.reconciliation_issues ri
   WHERE ri.company_id = cp.company_id AND ri.resolved_at IS NULL
     AND ri.issue_type = 'sat_only_cfdi_received') AS fiscal_gasto_no_capturado_count,
  EXISTS(SELECT 1 FROM public.reconciliation_issues ri
         WHERE ri.company_id = cp.company_id AND ri.resolved_at IS NULL
           AND ri.issue_type = 'partner_blacklist_69b') AS is_blacklist_69b
FROM public.company_profile cp
LEFT JOIN public.companies c ON c.id = cp.company_id
LEFT JOIN public.analytics_supplier_fiscal_lifetime sfl ON lower(sfl.rfc) = lower(c.rfc)
WHERE cp.is_supplier = true;

GRANT SELECT ON public.analytics_supplier_360 TO service_role, authenticated;

COMMENT ON VIEW public.analytics_supplier_360 IS
  'Master 360 view per proveedor. source=hybrid (odoo compras + syntage fiscal retenciones). Incluye 69-B blacklist + gasto SAT no capturado.';
