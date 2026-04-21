-- supabase/migrations/1051_silver_sp4_canonical_crm_leads.sql
--
-- Silver SP4 — Task 12: canonical_crm_leads VIEW + refresh_all_matviews() wiring
-- Spec §5.19, §10.2; Plan Task 12.
-- Defensive: refresh function skips missing MVs; falls back to non-CONCURRENT refresh on failure.
--
-- Pre-flight snapshot (2026-04-21): existing refresh_all_matviews() used hard-coded REFRESH statements
-- for 29 MVs (no loop). The new implementation switches to a defensive loop — same semantics,
-- but now skips non-existent MVs and falls back to non-concurrent on CONCURRENTLY failure.
-- real_sale_price was in the old function and is preserved in v_mvs below.

BEGIN;

DROP VIEW IF EXISTS canonical_crm_leads;

CREATE VIEW canonical_crm_leads AS
SELECT
  l.id                                AS canonical_id,
  l.odoo_lead_id,
  l.name,
  cc.id                               AS canonical_company_id,
  l.odoo_partner_id,
  l.lead_type,
  l.stage,
  l.expected_revenue,
  l.probability,
  l.date_deadline,
  l.create_date,
  l.days_open,
  l.assigned_user,
  cct.id                              AS assignee_canonical_contact_id,
  l.active,
  l.synced_at
FROM odoo_crm_leads l
LEFT JOIN canonical_companies cc  ON cc.odoo_partner_id = l.odoo_partner_id
LEFT JOIN canonical_contacts  cct ON cct.display_name   = l.assigned_user;
--                                    ^^^^^^^^^^^^^^^^ weak join; SP5 refinement — acceptable for now

-- Drop old void-returning function before replacing with jsonb-returning version.
DROP FUNCTION IF EXISTS refresh_all_matviews();

-- Wire refresh_all_matviews() to include the 5 new SP4 MVs,
-- PLUS all existing legacy MVs from the prior implementation (preserved via v_mvs array).
--
-- Strategy: iterate an array of MV names; skip those that don't exist;
-- try CONCURRENTLY first, fall back to non-concurrent on failure.
--
-- Behavioral change note: prior implementation used hard-coded individual REFRESH statements.
-- New implementation uses a defensive loop. Semantics for existing MVs are preserved.
-- 'real_sale_price' was in the prior function and is explicitly included in v_mvs below.

CREATE OR REPLACE FUNCTION refresh_all_matviews()
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_started timestamptz := clock_timestamp();
  v_log     jsonb := '[]'::jsonb;
  v_name    text;
  v_mvs     text[] := ARRAY[
    -- Legacy MVs from prior implementation (all 29 preserved)
    'company_profile',
    'company_profile_sat',
    'monthly_revenue_by_company',
    'portfolio_concentration',
    'ar_aging_detail',
    'accounting_anomalies',
    'customer_cohorts',
    'customer_margin_analysis',
    'customer_product_matrix',
    'supplier_product_matrix',
    'dead_stock_analysis',
    'inventory_velocity',
    'ops_delivery_health_weekly',
    'product_real_cost',
    'product_margin_analysis',
    'purchase_price_intelligence',
    'supplier_concentration_herfindahl',
    'company_email_intelligence',
    'company_handlers',
    'company_insight_history',
    'cashflow_projection',
    'real_sale_price',
    'supplier_price_index',
    'company_narrative',
    'customer_ltv_health',
    'payment_predictions',
    'client_reorder_predictions',
    'rfm_segments',
    'journal_flow_profile',
    -- Additional MVs from spec (defensive — skipped if absent; deduped against legacy block above)
    'invoices_unified',
    'payments_unified',
    'syntage_invoices_enriched',
    'products_unified',
    'product_price_history',
    'partner_payment_profile',
    'account_payment_profile',
    'cross_director_signals',
    'monthly_revenue_trend',
    'product_seasonality',
    'bom_duplicate_components',
    -- SP4 new MVs
    'canonical_sale_orders',
    'canonical_purchase_orders',
    'canonical_order_lines',
    'canonical_deliveries',
    'canonical_manufacturing'
  ];
BEGIN
  FOREACH v_name IN ARRAY v_mvs LOOP
    IF EXISTS (SELECT 1 FROM pg_matviews
                 WHERE schemaname='public' AND matviewname=v_name) THEN
      BEGIN
        EXECUTE format('REFRESH MATERIALIZED VIEW CONCURRENTLY %I', v_name);
        v_log := v_log || jsonb_build_object('mv', v_name, 'status', 'ok');
      EXCEPTION WHEN OTHERS THEN
        BEGIN
          EXECUTE format('REFRESH MATERIALIZED VIEW %I', v_name);
          v_log := v_log || jsonb_build_object('mv', v_name, 'status', 'ok_non_concurrent');
        EXCEPTION WHEN OTHERS THEN
          v_log := v_log || jsonb_build_object('mv', v_name, 'status', 'error', 'err', SQLERRM);
        END;
      END;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'started_at',  v_started,
    'finished_at', clock_timestamp(),
    'results',     v_log
  );
END;
$$;

COMMENT ON FUNCTION refresh_all_matviews() IS
  'SP4 Task 12: iterates known MV names (legacy 29 + SP4 5), REFRESH CONCURRENTLY with non-concurrent fallback; skips missing MVs.';

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
SELECT 'CREATE_VIEW', 'canonical_crm_leads', 'Pattern B view + refresh_all_matviews() wiring (loop, defensive)',
       'supabase/migrations/1051_silver_sp4_canonical_crm_leads.sql',
       'silver-sp4-task-12', true
WHERE NOT EXISTS (SELECT 1 FROM schema_changes WHERE triggered_by = 'silver-sp4-task-12');

COMMIT;
