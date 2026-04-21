BEGIN;

-- Drop 5 MVs with 0 frontend callers (user D2 approved)
DROP MATERIALIZED VIEW IF EXISTS public.syntage_invoices_enriched;
DROP MATERIALIZED VIEW IF EXISTS public.products_unified;
DROP MATERIALIZED VIEW IF EXISTS public.product_price_history;
DROP MATERIALIZED VIEW IF EXISTS public.cross_director_signals;
DROP MATERIALIZED VIEW IF EXISTS public.product_seasonality;

-- Update refresh_all_matviews to remove the 5 dropped MVs
-- Before: 34 MVs. After: 29 MVs (removed: syntage_invoices_enriched, products_unified,
-- product_price_history, cross_director_signals, product_seasonality)
CREATE OR REPLACE FUNCTION public.refresh_all_matviews()
RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.company_profile;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.company_profile_sat;
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
  REFRESH MATERIALIZED VIEW product_real_cost;
  REFRESH MATERIALIZED VIEW product_margin_analysis;
  REFRESH MATERIALIZED VIEW purchase_price_intelligence;
  REFRESH MATERIALIZED VIEW supplier_concentration_herfindahl;
  REFRESH MATERIALIZED VIEW company_email_intelligence;
  REFRESH MATERIALIZED VIEW company_handlers;
  REFRESH MATERIALIZED VIEW company_insight_history;
  REFRESH MATERIALIZED VIEW cashflow_projection;
  REFRESH MATERIALIZED VIEW real_sale_price;
  REFRESH MATERIALIZED VIEW supplier_price_index;
  REFRESH MATERIALIZED VIEW company_narrative;
  REFRESH MATERIALIZED VIEW customer_ltv_health;
  REFRESH MATERIALIZED VIEW payment_predictions;
  REFRESH MATERIALIZED VIEW client_reorder_predictions;
  REFRESH MATERIALIZED VIEW rfm_segments;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.journal_flow_profile;
  RAISE NOTICE 'All 29 materialized views refreshed successfully';
END;
$function$;

INSERT INTO public.schema_changes (change_type, table_name, description, sql_executed) VALUES
  ('drop_matview',   'syntage_invoices_enriched', 'SP1 — Fase 2.6 created, 0 frontend callers, only in refresh fn', 'DROP MATERIALIZED VIEW'),
  ('drop_matview',   'products_unified',           'SP1 — 0 frontend callers, interim step superseded by SP2 canonical_products', 'DROP MATERIALIZED VIEW'),
  ('drop_matview',   'product_price_history',      'SP1 — 0 frontend callers, spec says rebuild SP4', 'DROP MATERIALIZED VIEW'),
  ('drop_matview',   'cross_director_signals',     'SP1 — 0 frontend callers, only in refresh_product_intelligence fn (no UI)', 'DROP MATERIALIZED VIEW'),
  ('drop_matview',   'product_seasonality',        'SP1 — 0 frontend callers, only in refresh_product_intelligence fn (no UI)', 'DROP MATERIALIZED VIEW'),
  ('alter_function', 'refresh_all_matviews',       'SP1 — removed 5 dropped MVs from hardcoded refresh body, count 34→29', 'CREATE OR REPLACE FUNCTION');

COMMIT;
