# Supabase Schema Inventory Report — 2026-04-19

Audit of public schema layer convention compliance.
Queries executed against project `tozqezmivpblmcubmnpi`.

---

## 1. Layer Distribution

Total objects in `public` schema: **150**

| Layer | Count | BASE TABLE | VIEW | Notes |
|---|---|---|---|---|
| L1-raw-odoo | 26 | 24 | 2 | `odoo_push_last_events`, `odoo_sync_freshness` are views |
| L1-raw-syntage | 17 | 11 | 6 | 6 analytical views mixed into raw layer |
| L2-canonical-or-legacy | 79 | 30 | 49 | Largest bucket — many legacy views without layer prefix |
| L3-unified | 3 | 1 | 2 | `unified_invoices`, `unified_payment_allocations`, `unified_refresh_queue` |
| L4-analytics | 13 | 0 | 13 | All correctly prefixed views |
| L5-intelligence | 7 | 5 | 2 | `ai_agents`, `agent_*` tables + `agent_effectiveness` view |
| DQ | 5 | 0 | 5 | `dq_*` views — all correctly classified |
| **TOTAL** | **150** | **70** | **80** | |

### Notable observations

- **L1-raw-syntage has 6 analytical views** (`syntage_client_cancellation_rates`, `syntage_product_line_analysis`, `syntage_revenue_fiscal_monthly`, `syntage_top_clients_fiscal_lifetime`, `syntage_top_suppliers_fiscal_lifetime`) that belong semantically in L4 but are prefixed `syntage_`. They have `analytics_*` aliases — see section 2.
- **L2-canonical-or-legacy is the largest bucket (79 objects)** and contains the bulk of legacy/unclassified views that are candidates for renaming to `analytics_*`.
- **`v_audit_*` views (19 objects)** in L2 use a `v_audit_` prefix not covered by the layer convention. These are sync-quality audit views created for the costos audit project and should be classified as DQ.

---

## 2. Views Sin Prefijo Canónico — Legacy View Audit

Candidate views from the L2-canonical-or-legacy bucket that were specifically checked for `analytics_*` aliases:

### analytics_* aliases that exist (13 total)

| analytics_* view | Likely replaces legacy view |
|---|---|
| `analytics_ar_aging` | — |
| `analytics_customer_360` | — |
| `analytics_customer_cancellation_rates` | `syntage_client_cancellation_rates` |
| `analytics_customer_fiscal_lifetime` | `syntage_top_clients_fiscal_lifetime` |
| `analytics_finance_cash_position` | `cash_position` |
| `analytics_finance_cfo_snapshot` | `cfo_dashboard` |
| `analytics_finance_income_statement` | `pl_estado_resultados` |
| `analytics_finance_working_capital` | `working_capital` |
| `analytics_product_fiscal_line_analysis` | `syntage_product_line_analysis` |
| `analytics_revenue_fiscal_monthly` | `syntage_revenue_fiscal_monthly` |
| `analytics_revenue_operational_monthly` | `monthly_revenue_trend` |
| `analytics_supplier_360` | — |
| `analytics_supplier_fiscal_lifetime` | `syntage_top_suppliers_fiscal_lifetime` |

### Candidate legacy views — alias status

| Legacy View | table_type | analytics_* alias exists? |
|---|---|---|
| `cfo_dashboard` | VIEW | YES → `analytics_finance_cfo_snapshot` |
| `pl_estado_resultados` | VIEW | YES → `analytics_finance_income_statement` |
| `monthly_revenue_trend` | VIEW | YES → `analytics_revenue_operational_monthly` |
| `cash_position` | VIEW | YES → `analytics_finance_cash_position` |
| `working_capital` | VIEW | YES → `analytics_finance_working_capital` |
| `customer_ltv_health` | VIEW | NOT FOUND in schema (does not exist) |
| `company_profile` | VIEW | NOT FOUND in schema (does not exist) |
| `company_narrative` | VIEW | NOT FOUND in schema (does not exist) |
| `expense_breakdown` | VIEW | NOT FOUND in schema (does not exist) |
| `payment_analysis` | VIEW | NOT FOUND in schema (does not exist) |
| `cash_flow_aging` | VIEW | NO — no alias; view exists as `cash_flow_aging` |
| `margin_analysis` | VIEW | NOT FOUND in schema (does not exist) |
| `budget_vs_actual` | VIEW | NO — no alias; view exists as `budget_vs_actual` |
| `cfdi_invoice_match` | VIEW | NOT FOUND in schema (does not exist) |

### Additional legacy views in L2 without analytics_* alias (selection of high-value candidates)

These exist in the schema but have no `analytics_*` counterpart yet:

| View | Description |
|---|---|
| `cash_flow_aging` | Cash flow by aging bucket — needs `analytics_finance_cash_flow_aging` |
| `budget_vs_actual` | Budget variance — needs `analytics_finance_budget_vs_actual` |
| `invoice_line_margins` | Margin by invoice line — needs `analytics_finance_invoice_line_margins` |
| `revenue_concentration` | Customer revenue concentration — needs `analytics_revenue_concentration` |
| `collection_effectiveness_index` | AR collection KPI — needs `analytics_ar_collection_effectiveness` |
| `financial_runway` | Cash runway — needs `analytics_finance_runway` |
| `projected_cash_flow_weekly` | Weekly cashflow projection — needs `analytics_finance_cashflow_weekly` |
| `working_capital_cycle` | WC cycle days — needs `analytics_finance_working_capital_cycle` |
| `overhead_factor_12m` | Overhead rate — needs `analytics_finance_overhead_factor` |
| `cashflow_*` (14 views) | Detailed cashflow components — prefix `cashflow_` not in convention; candidates for `analytics_cashflow_*` |

---

## 3. Tablas Never-Read (seq_scan = 0 AND idx_scan = 0)

Query against `pg_stat_user_tables` returned **0 rows**.

This means every BASE TABLE in the public schema has been accessed via at least one sequential or index scan since the last `pg_stat_reset()`. No completely orphaned tables were detected.

**Interpretation:** Either all tables are actively used, or `pg_stat_reset()` was called recently, resetting counters. Given the schema has tables like `odoo_snapshots`, `schema_changes`, `reconciliation_issues`, and `facts` that appear infrequently written, a follow-up audit at a later date (after more activity accumulates) may surface candidates.

---

## Summary & Recommended Actions

| Priority | Action |
|---|---|
| HIGH | Drop or alias 5 confirmed legacy views that have `analytics_*` replacements: `cfo_dashboard`, `pl_estado_resultados`, `monthly_revenue_trend`, `cash_position`, `working_capital` |
| HIGH | Create `analytics_*` aliases for `cash_flow_aging` and `budget_vs_actual` (frontend uses these) |
| MEDIUM | Reclassify 19 `v_audit_*` views to `dq_*` prefix |
| MEDIUM | Evaluate 14 `cashflow_*` views — migrate to `analytics_cashflow_*` or keep as internal layer |
| LOW | Re-run never-read scan in 30 days to capture actual dead tables |
