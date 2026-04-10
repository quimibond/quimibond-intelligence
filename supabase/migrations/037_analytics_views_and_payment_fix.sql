-- ============================================================================
-- Migration 037: Analytics materialized views + payment prediction fix
--
-- Applied via Supabase MCP on 2026-04-10
--
-- 1. Fix purchase_price_intelligence: unique key by odoo_product_id (not product_ref)
-- 2. Rebuild cashflow_projection with detail by company, month, and bucket
-- 3. Create 7 new materialized views for deep analytics
-- 4. Update refresh functions to include new views
-- 5. Create refresh_all_analytics() master function
-- 6. Add unique index to client_reorder_predictions for CONCURRENTLY
--
-- Note: payment_predictions (0 rows) will populate once Odoo sync pushes
-- days_to_pay and payment_date fields (see qb19 commit feat: sync payment_date)
-- ============================================================================

-- Already applied via MCP execute_sql. This file documents the changes.

-- ── 1. purchase_price_intelligence ──────────────────────────────────────
-- Problem: UNIQUE INDEX on (product_ref, currency) fails because
-- different products can share the same default_code (e.g. "RONDANA PLANA").
-- Fix: GROUP BY odoo_product_id and make unique index on (odoo_product_id, currency).

-- DROP MATERIALIZED VIEW IF EXISTS purchase_price_intelligence CASCADE;
-- CREATE MATERIALIZED VIEW purchase_price_intelligence AS ... (uses odoo_product_id as key)
-- CREATE UNIQUE INDEX idx_ppi_product_currency ON purchase_price_intelligence (odoo_product_id, currency);

-- ── 2. cashflow_projection ─────────────────────────────────────────────
-- Problem: Only 5 rows (aggregated buckets). No detail by company or month.
-- Fix: 5 flow_types: receivable_detail, receivable_by_company,
--      receivable_by_month, receivable_bucket, payable_bucket, summary.

-- DROP MATERIALIZED VIEW IF EXISTS cashflow_projection CASCADE;
-- CREATE MATERIALIZED VIEW cashflow_projection AS ... (735 rows with detail)

-- ── 3. New materialized views ──────────────────────────────────────────

-- monthly_revenue_by_company (7,399 rows)
-- Revenue time series with MA-3m, MA-6m, MoM%, YoY%, rank per month.
-- Indexes: idx_mrbc_company, idx_mrbc_month, idx_mrbc_pk (company_id, month)

-- customer_cohorts (325 rows)
-- Quarterly cohort analysis: retention %, cumulative LTV per customer.
-- Indexes: idx_cc_pk (cohort_quarter, period), idx_cc_quarter

-- portfolio_concentration (836 rows)
-- Pareto A/B/C classification, HHI contribution, churn status.
-- Indexes: idx_pc_company, idx_pc_pareto, idx_pc_status

-- ar_aging_detail (547 rows)
-- Per-invoice aging: current, 1-30, 31-60, 61-90, 91-120, 120+ buckets.
-- Indexes: idx_arad_company, idx_arad_bucket, idx_arad_invoice

-- customer_margin_analysis (836 rows)
-- Margin by customer using invoice_lines x product cost (avg_cost/standard_price).
-- Indexes: idx_cma_company, idx_cma_margin

-- product_seasonality (3,204 rows)
-- Seasonality index per product per month. Peak/trough/normal classification.
-- Indexes: idx_ps_pk (odoo_product_id, month_num), idx_ps_season

-- inventory_velocity (5,688 rows)
-- Daily run rate, days of stock, annual turnover, reorder status.
-- Indexes: idx_iv_product, idx_iv_reorder, idx_iv_turnover

-- ── 4. Updated refresh functions ───────────────────────────────────────

-- refresh_product_intelligence(): now includes 6 new views (CONCURRENTLY)
-- refresh_purchase_intelligence(): now uses CONCURRENTLY
-- refresh_cashflow_projection(): now includes ar_aging_detail

-- ── 5. refresh_all_analytics() ─────────────────────────────────────────
-- Master function that refreshes all 22 materialized views in dependency order.
-- Returns: {status, duration_ms, refreshed_at}

-- ── 6. client_reorder_predictions unique index ─────────────────────────
-- CREATE UNIQUE INDEX idx_crp_company ON client_reorder_predictions (company_id);
-- Required for REFRESH MATERIALIZED VIEW CONCURRENTLY.
