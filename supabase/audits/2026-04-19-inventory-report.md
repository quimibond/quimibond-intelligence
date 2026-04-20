# Supabase Schema Inventory Report — 2026-04-19

Audit of public schema layer convention compliance.
Queries executed against project `tozqezmivpblmcubmnpi`.

**Snapshot:** 2026-04-19 (counts reflect state at audit time, expected to drift).

---

## 1. Layer Distribution

Total objects in `public` schema: **165**

| Layer | Count | BASE TABLE | VIEW | Notes |
|---|---|---|---|---|
| L1-raw-odoo | 26 | 24 | 2 | `odoo_push_last_events`, `odoo_sync_freshness` are views |
| L1-raw-syntage | 17 | 12 | 5 | 5 analytical views mixed into raw layer |
| L2-canonical-or-legacy | 94 | 34 | 60 | Largest bucket — many legacy views without layer prefix |
| L3-unified | 3 | 1 | 2 | `unified_invoices`, `unified_payment_allocations`, `unified_refresh_queue` |
| L4-analytics | 13 | 0 | 13 | All correctly prefixed views |
| L5-intelligence | 7 | 6 | 1 | `ai_agents`, `agent_*` tables + `agent_effectiveness` view |
| DQ | 5 | 0 | 5 | `dq_*` views — all correctly classified |
| **TOTAL** | **165** | **77** | **88** | |

### Notable observations

- **L1-raw-syntage has 5 analytical views** (`syntage_client_cancellation_rates`, `syntage_product_line_analysis`, `syntage_revenue_fiscal_monthly`, `syntage_top_clients_fiscal_lifetime`, `syntage_top_suppliers_fiscal_lifetime`) that belong semantically in L4 but are prefixed `syntage_`. They have `analytics_*` aliases — see section 2.
- **L2-canonical-or-legacy is the largest bucket (94 objects)** and contains the bulk of legacy/unclassified views that are candidates for renaming to `analytics_*`.
- **`v_audit_*` views (21 objects)** in L2 use a `v_audit_` prefix not covered by the layer convention. These are sync-quality audit views created for the costos audit project and should be classified as DQ.

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
| `cash_flow_aging` | VIEW | YES → `analytics_ar_aging` (finance AR semantic; alias created in `20260419_reorg_r1_analytics_aliases.sql`) |
| `margin_analysis` | VIEW | NOT FOUND in schema (does not exist) |
| `budget_vs_actual` | VIEW | NO — no alias; view exists as `budget_vs_actual` |
| `cfdi_invoice_match` | VIEW | NOT FOUND in schema (does not exist) |

### Additional legacy views in L2 without analytics_* alias (selection of high-value candidates)

These exist in the schema but have no `analytics_*` counterpart yet:

| View | Description |
|---|---|
| `budget_vs_actual` | Budget variance — aliased as `analytics_budget_vs_actual` in S1.2 (v2 migration). |
| `invoice_line_margins` | Margin by invoice line — needs `analytics_finance_invoice_line_margins` |
| `revenue_concentration` | Customer revenue concentration — needs `analytics_revenue_concentration` |
| `collection_effectiveness_index` | AR collection KPI — needs `analytics_ar_collection_effectiveness` |
| `financial_runway` | Cash runway — needs `analytics_finance_runway` |
| `projected_cash_flow_weekly` | Weekly cashflow projection — needs `analytics_finance_cashflow_weekly` |
| `working_capital_cycle` | WC cycle days — needs `analytics_finance_working_capital_cycle` |
| `overhead_factor_12m` | Overhead rate — needs `analytics_finance_overhead_factor` |
| `cashflow_*` (15 views) | Detailed cashflow components — prefix `cashflow_` not in convention; candidates for `analytics_cashflow_*` |

---

## 3. Tablas Never-Read (seq_scan = 0 AND idx_scan = 0)

Query against `pg_stat_user_tables` returned **0 rows**.

This means every BASE TABLE in the public schema has been accessed via at least one sequential or index scan since the last `pg_stat_reset()`. No completely orphaned tables were detected.

**Interpretation:** Either all tables are actively used, or `pg_stat_reset()` was called recently, resetting counters. Given the schema has tables like `odoo_snapshots`, `schema_changes`, `reconciliation_issues`, and `facts` that appear infrequently written, a follow-up audit at a later date (after more activity accumulates) may surface candidates.

---

## Summary & Recommended Actions

| Priority | Action |
|---|---|
| HIGH | Alias first (non-destructive), then schedule deprecation after frontend migration verified (see S1.2). 5 confirmed legacy views with `analytics_*` replacements: `cfo_dashboard`, `pl_estado_resultados`, `monthly_revenue_trend`, `cash_position`, `working_capital` |
| HIGH | ~~Create `analytics_*` aliases for `cash_flow_aging` and `budget_vs_actual`~~ DONE: `cash_flow_aging` was already aliased as `analytics_ar_aging` (finance AR semantic). `budget_vs_actual` aliased as `analytics_budget_vs_actual` in S1.2 (migration `20260419_s1_legacy_view_aliases_v2`). |
| MEDIUM | Reclassify 21 `v_audit_*` views to `dq_*` prefix |
| MEDIUM | Evaluate 15 `cashflow_*` views — migrate to `analytics_cashflow_*` or keep as internal layer |
| LOW | Re-run never-read scan in 30 days to capture actual dead tables |

---

## S3 · Data utilization audit (2026-04-19)

### Candidates probed

Row counts and freshness queried live against project `tozqezmivpblmcubmnpi`. TS refs = number of `.from("<table>")` call sites in `src/**/*.{ts,tsx}` (excluding write-only inserts and comment mentions).

| Table | Rows | Last record | TS refs | Notes |
|---|---|---|---|---|
| `syntage_webhook_events` | 42,924 | active | 3 | read in syntage health + idempotency — in use |
| `odoo_payments` | 26,839 | — | 0 | **ZERO reads** — proxy payment table; 26k rows fully dark |
| `odoo_account_payments` | 17,853 | — | 4 | read in financiero-context + briefing + health-scores |
| `syntage_files` | 16,097 | 2026-04-17 | 1 | admin handler only — not surfaced in UI |
| `pipeline_logs` | 12,870 | active | many | actively read + written — in use |
| `odoo_account_balances` | 11,030 | 2026-04-19 | 0 | **ZERO reads** — only a comment in finanzas/page.tsx; fresh hourly |
| `odoo_activities` | 5,617 | — | 3 | read in orchestrate + director-chat + companies query |
| `odoo_manufacturing` | 4,650 | 2026-04-19 | 3 | read in operations queries + orchestrate |
| `odoo_deliveries` | 2,192 | — | many | actively used |
| `odoo_chart_of_accounts` | 1,640 | 2026-04-19 | 0 | **ZERO reads** — 1,640 CoA entries, fresh, never consumed |
| `odoo_employees` | 164 | 2026-04-19 | 2 | read in team queries |
| `syntage_tax_retentions` | 78 | 2026-04-17 | 1 | tax-retention handler only — not surfaced in UI |
| `odoo_currency_rates` | 70 | 2026-04-19 | 0 | **ZERO reads** — FX rates synced hourly, never queried |
| `odoo_orderpoints` | 57 | 2026-04-19 | 2 | agent context + orchestrate only — no frontend panel |
| `syntage_electronic_accounting` | 35 | 2026-04-17 | 1 | electronic-accounting handler only |
| `odoo_departments` | 26 | 2026-04-19 | 1 | count only in team query — no detail panel |
| `odoo_bank_balances` | 22 | 2026-04-19 | 1 | financiero-context only — not on any page |
| `odoo_crm_leads` | 20 | — | 3 | read in orchestrate + director-chat + reconcile |

### Zero-read tables (highest priority gaps)

| Table | Rows | Freshness | Assessment |
|---|---|---|---|
| `odoo_payments` | 26,839 | — | Proxy payment data — large and dark |
| `odoo_account_balances` | 11,030 | hourly | Monthly P&L balances — rich, fresh, zero UI |
| `odoo_chart_of_accounts` | 1,640 | hourly | Full CoA — needed for account drill-down |
| `odoo_currency_rates` | 70 | hourly | FX rates — small but relevant for multi-currency |

### Integrating (priority order)

1. **`odoo_account_balances`** → **`/finanzas` tab "P&L por Cuenta"** — 11,030 monthly balance rows synced hourly, structured by account/period. The finanzas page already references this table in a comment as a known future data source. Integrate as a drill-down table within the income-statement panel: group by `account_type`, show period-over-period comparison. Immediate and high-value for CFO/CEO.

2. **`odoo_payments`** → **`/companies/[id]` tab "Pagos"** — 26,839 rows of proxy payment history, zero frontend reads. The company detail page already has invoices and deliveries tabs; a payments tab using this table closes the AR/AP loop for the relationship view. Filter by `odoo_partner_id` → `company_id`, show `payment_date`, `amount`, `payment_type`.

3. **`odoo_chart_of_accounts`** → **`/finanzas` tab "Plan de Cuentas"** — 1,640 CoA entries fresh hourly. Enables account-level drill-down from P&L lines and budget vs actual view; without it, `odoo_account_balances` can't be labeled meaningfully. Add a simple filterable table (code, name, account_type, internal_group). Low UI complexity.

4. **`odoo_currency_rates`** → **`/sistema` or `/finanzas` FX widget** — 70 rows of daily rates (MXN/USD/EUR). Small table, low integration cost. Surface as a compact FX panel showing last rate per currency pair + change. Useful context for multi-currency invoice and payment amounts displayed across the platform.

### Reporting (not integrating this sprint)

- **`syntage_files`** (16,097 rows) — Read only from Syntage admin handler; surfacing requires a file browser UI with download links — redesign effort, defer.
- **`syntage_electronic_accounting`** (35 rows) — Consumed by accounting handler; thin data currently, revisit when more periods accumulate.
- **`syntage_tax_retentions`** (78 rows) — Specialized fiscal table; already has a handler; needs a dedicated retenciones panel that is out of this sprint scope.
- **`odoo_orderpoints`** (57 rows) — Read by agents; no frontend panel. Value is real (stockout detection) but already covered by agent insights; a dedicated panel is a separate sprint.
- **`odoo_bank_balances`** (22 rows) — Read by financiero-context agent; `analytics_finance_cash_position` view already exposes this to the CFO dashboard. Not a gap.
- **`odoo_departments`** (26 rows) — Count used in team queries; full detail already visible via `/departments` page backed by other queries. Not a gap.
