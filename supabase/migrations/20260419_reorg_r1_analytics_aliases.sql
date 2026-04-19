-- Reorg R1.1 + R1.2 + R1.5: crear aliases analytics_* / unified_* / analytics_finance_*
-- Pattern: los nombres actuales se mantienen. Se crean vistas con nombres nuevos que
-- apuntan al mismo objeto. Código TS puede migrar al nuevo nombre sin romper nada.
-- R1.6: DROP cfdi_documents_deprecated_20260420 (día 30+ pasado).

-- ════════ L4 ANALYTICS · fiscal históricos ════════
CREATE OR REPLACE VIEW public.analytics_customer_fiscal_lifetime AS
  SELECT * FROM public.syntage_top_clients_fiscal_lifetime;
CREATE OR REPLACE VIEW public.analytics_supplier_fiscal_lifetime AS
  SELECT * FROM public.syntage_top_suppliers_fiscal_lifetime;
CREATE OR REPLACE VIEW public.analytics_customer_cancellation_rates AS
  SELECT * FROM public.syntage_client_cancellation_rates;
CREATE OR REPLACE VIEW public.analytics_product_fiscal_line_analysis AS
  SELECT * FROM public.syntage_product_line_analysis;
CREATE OR REPLACE VIEW public.analytics_revenue_fiscal_monthly AS
  SELECT * FROM public.syntage_revenue_fiscal_monthly;

-- ════════ L4 ANALYTICS · financieros (re-prefijados) ════════
CREATE OR REPLACE VIEW public.analytics_finance_cfo_snapshot AS
  SELECT * FROM public.cfo_dashboard;
CREATE OR REPLACE VIEW public.analytics_finance_income_statement AS
  SELECT * FROM public.pl_estado_resultados;
CREATE OR REPLACE VIEW public.analytics_finance_working_capital AS
  SELECT * FROM public.working_capital;
CREATE OR REPLACE VIEW public.analytics_finance_cash_position AS
  SELECT * FROM public.cash_position;
CREATE OR REPLACE VIEW public.analytics_ar_aging AS
  SELECT * FROM public.cash_flow_aging;
CREATE OR REPLACE VIEW public.analytics_revenue_operational_monthly AS
  SELECT * FROM public.monthly_revenue_trend;

-- ════════ L3 UNIFIED · prefix unificado ════════
CREATE OR REPLACE VIEW public.unified_invoices AS
  SELECT * FROM public.invoices_unified;
CREATE OR REPLACE VIEW public.unified_payments AS
  SELECT * FROM public.payments_unified;
CREATE OR REPLACE VIEW public.unified_payment_allocations AS
  SELECT * FROM public.payment_allocations_unified;

-- ════════ COMMENT ON ════════
COMMENT ON VIEW public.analytics_customer_fiscal_lifetime IS
  'Alias de syntage_top_clients_fiscal_lifetime. source=syntage · aggregation=lifetime · coverage=2014-present';
COMMENT ON VIEW public.analytics_supplier_fiscal_lifetime IS
  'Alias de syntage_top_suppliers_fiscal_lifetime. source=syntage';
COMMENT ON VIEW public.analytics_customer_cancellation_rates IS
  'Alias de syntage_client_cancellation_rates. source=syntage · window=24m';
COMMENT ON VIEW public.analytics_product_fiscal_line_analysis IS
  'Alias de syntage_product_line_analysis. source=syntage · 172K line items agregados';
COMMENT ON VIEW public.analytics_revenue_fiscal_monthly IS
  'Alias de syntage_revenue_fiscal_monthly. source=syntage · 148 meses';
COMMENT ON VIEW public.analytics_finance_cfo_snapshot IS
  'Alias de cfo_dashboard. source=odoo · refresh=realtime';
COMMENT ON VIEW public.analytics_finance_income_statement IS
  'Alias de pl_estado_resultados. source=odoo · monthly P&L';
COMMENT ON VIEW public.analytics_finance_working_capital IS
  'Alias de working_capital. source=odoo';
COMMENT ON VIEW public.analytics_finance_cash_position IS
  'Alias de cash_position. source=odoo';
COMMENT ON VIEW public.analytics_ar_aging IS
  'Alias de cash_flow_aging. source=odoo';
COMMENT ON VIEW public.analytics_revenue_operational_monthly IS
  'Alias de monthly_revenue_trend. source=odoo · operativo MoM';
COMMENT ON VIEW public.unified_invoices IS
  'Alias de invoices_unified MV. source=hybrid odoo+syntage · refresh=pg_cron 15min · post-2021';
COMMENT ON VIEW public.unified_payments IS
  'Alias de payments_unified MV. source=hybrid';
COMMENT ON VIEW public.unified_payment_allocations IS
  'Alias de payment_allocations_unified. source=hybrid · complementos Tipo P';

-- ════════ GRANTS ════════
GRANT SELECT ON public.analytics_customer_fiscal_lifetime TO service_role, authenticated;
GRANT SELECT ON public.analytics_supplier_fiscal_lifetime TO service_role, authenticated;
GRANT SELECT ON public.analytics_customer_cancellation_rates TO service_role, authenticated;
GRANT SELECT ON public.analytics_product_fiscal_line_analysis TO service_role, authenticated;
GRANT SELECT ON public.analytics_revenue_fiscal_monthly TO service_role, authenticated;
GRANT SELECT ON public.analytics_finance_cfo_snapshot TO service_role, authenticated;
GRANT SELECT ON public.analytics_finance_income_statement TO service_role, authenticated;
GRANT SELECT ON public.analytics_finance_working_capital TO service_role, authenticated;
GRANT SELECT ON public.analytics_finance_cash_position TO service_role, authenticated;
GRANT SELECT ON public.analytics_ar_aging TO service_role, authenticated;
GRANT SELECT ON public.analytics_revenue_operational_monthly TO service_role, authenticated;
GRANT SELECT ON public.unified_invoices TO service_role, authenticated;
GRANT SELECT ON public.unified_payments TO service_role, authenticated;
GRANT SELECT ON public.unified_payment_allocations TO service_role, authenticated;

-- ════════ R1.6: DROP deprecated ════════
DO $$
DECLARE
  dep_count int;
BEGIN
  SELECT count(*) INTO dep_count
  FROM pg_depend d JOIN pg_class c ON c.oid=d.objid
  WHERE d.refobjid = 'public.cfdi_documents_deprecated_20260420'::regclass
    AND c.relkind IN ('v', 'm');
  IF dep_count = 0 THEN
    DROP TABLE IF EXISTS public.cfdi_documents_deprecated_20260420 CASCADE;
  END IF;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;
