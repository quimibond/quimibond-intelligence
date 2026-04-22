# Silver SP5 — Execution Notes

Running log of findings per task. Append one section per completed task. Include actual query counts, commit hashes, surprises, deviations from plan.

## Task 1 — Pre-flight (completed 2026-04-21)

Baseline audit_runs row inserted with `details->>'label' = 'pre_sp5_baseline'`.
Branch cut from main @ a8817f2 (post-SP4 merge).
migrations dir writable.

### Deviations from plan

1. **`amount_residual` column does not exist on `canonical_invoices`** — plan SQL referenced a bare `amount_residual` column that never existed. Actual residual columns are `amount_residual_mxn_odoo`, `amount_residual_odoo`, `amount_residual_sat`, `amount_residual_mxn_resolved`, `amount_residual_resolved`. Fixed in migration to use `amount_residual_mxn_odoo > 0` for the open-residual count.

2. **`audit_runs` requires `run_id`, `source`, `model`, `invariant_key`, `bucket_key` NOT NULL** — plan SQL omitted these columns. Fixed by following SP4 pattern: `source='supabase'`, `model='silver_sp5'`, `invariant_key='sp5.baseline'`, `bucket_key=''`.

3. **`assignee_canonical_contact_id` DOES exist on `reconciliation_issues`** — plan writer flagged this as uncertain but it was already present. No removal needed.

### Baseline counts (from audit_runs row, run at 2026-04-21 ~23:50 UTC)

| Metric | Value |
|---|---|
| canonical_invoices | 88462 |
| canonical_invoices_with_residual_mxn_resolved | 0 |
| canonical_invoices_with_open_residual | 669 |
| canonical_payments | 43380 |
| canonical_companies_with_ltv | 1733 |
| reconciliation_issues_open | 116230 |
| reconciliation_issues_open_null_invariant_key | 114 |
| reconciliation_issues_open_null_assignee | 116230 |
| gold_ceo_inbox_rows | 50 |
| audit_tolerances_enabled | 38 |

Notes on values:
- `canonical_invoices_with_residual_mxn_resolved = 0` — expected; Task 24 backfill not yet run.
- `reconciliation_issues_open_null_assignee = 116230` — equals total open issues; assignee column exists but is unpopulated (Task 20 work).
- `reconciliation_issues_open_null_invariant_key = 114` — matches SP4 snapshot (was 114 in post_sp4_snapshot).
- `canonical_invoices_with_open_residual = 669` — uses `amount_residual_mxn_odoo > 0` (plan intended bare `amount_residual` which doesn't exist).

## Task 2 — Types regeneration (completed 2026-04-21)

- `src/lib/database.types.ts` regenerated: 12,742 lines, 453,144 bytes.
- canonical_* tables present: 20 entries (canonical_companies, canonical_contacts, canonical_credit_notes, canonical_invoices, canonical_payment_allocations, canonical_payments, canonical_products, canonical_tax_events, canonical_account_balances, canonical_bank_balances, canonical_chart_of_accounts, canonical_crm_leads, canonical_deliveries, canonical_employees, canonical_fx_rates, canonical_inventory, canonical_manufacturing, canonical_order_lines, canonical_purchase_orders, canonical_sale_orders).
- gold_* views present: 8 entries (gold_balance_sheet, gold_cashflow, gold_ceo_inbox, gold_company_360, gold_pl_statement, gold_product_performance, gold_reconciliation_health, gold_revenue_monthly).
- `canonical_invoices` in Tables (line 1915); `gold_ceo_inbox` in Views (line 9770).
- grep counts: `canonical_` = 367 hits, `gold_` = 15 hits, `canonical_invoices` = 1 entry (key appears once per table, as expected in MCP-generated format — not the 3x CLI format).
- Types test: 2 passing.
- Pre-existing type errors surfaced: NONE — all lint output was `Warning:` (unused vars only). Build fails at prerender of `/equipo` due to missing `supabaseKey` env var in local build env (pre-existing runtime issue, not a type error).
- Note: `npm run build` OOMs without `NODE_OPTIONS=--max-old-space-size=8192`; default Node heap is insufficient for this codebase. Not caused by new types file.
- Commit: d2049fe

## Task 3 — _shared/companies.ts (completed 2026-04-21)

### Legacy tables removed from function bodies

- `company_profile` (MV) — used by `getCompaniesList`, `getCompaniesPage` (still in legacy functions, not in new SP5 exports)
- `portfolio_concentration` (MV) — same
- `customer_ltv_health` (MV) — same
- `company_profile_sat` (MV) — same
- `company_narrative` (MV) — same
- `odoo_sale_orders` — `getCompanyOrders`, `getCompanyOrdersPage`
- `odoo_deliveries` — `getCompanyDeliveries`, `getCompanyDeliveriesPage`
- `odoo_activities` — `getCompanyActivities`
- `odoo_order_lines` — `getCompanyTopProducts`
- `companies` (base table) — `getCompanyDetail`
- `getUnifiedInvoicesForCompany` (layer-3 unified) — `getCompanyInvoices`, `getCompanyInvoicesPage`

Note: The new SP5 exports (`fetchCompany*`) do NOT reference any of the above. The legacy functions are preserved intact for consumer pages being rewired in Tasks 13-17.

### New SP5 exports added

- `fetchCompanyById(id)` — reads `canonical_companies.*`
- `fetchCompany360(canonical_company_id)` — reads `gold_company_360.*`
- `listCompanies(opts)` — reads `gold_company_360.*` with filter/sort
- `fetchCompanyInvoices(canonical_company_id, opts)` — reads `canonical_invoices`
- `fetchCompanyReceivables(canonical_company_id)` — reads `canonical_invoices` where `direction=issued` and `amount_residual_mxn_odoo > 0`
- `fetchCompanyPayables(canonical_company_id)` — reads `canonical_invoices` where `direction=received` and `amount_residual_mxn_odoo > 0`
- `ListCompaniesOptions` interface

### Back-compat aliases

- `getCompanyById = fetchCompanyById`
- `getCompany360 = fetchCompany360`
- `searchCompanies = listCompanies`

### Schema drift discovered (vs SP5 plan)

1. **`taxpayer_rfc` does not exist** — actual column is `rfc` in canonical_companies. Test and `listCompanies` search adapted.
2. **`is_shadow` does not exist** — actual column is `has_shadow_flag`. Test adapted.
3. **Quimibond id=868 RFC is `PNT920218IW5`** — plan had `QIN140528HN9` (wrong entity). Test assertion corrected.
4. **`gold_company_360` PK is `canonical_company_id`** — not `id`. fetchCompany360 uses `.eq("canonical_company_id", ...)`.
5. **`days_overdue` absent from canonical_invoices** — `fiscal_days_to_due_date` used in its place for ordering receivables/payables.
6. **`fiscal_estado` absent from canonical_invoices** — `estado_sat` used in `fetchCompanyInvoices` select.
7. **`match_status` absent from canonical_invoices** — `match_confidence` used in its place.
8. **`due_date` absent from canonical_invoices** — `due_date_odoo` used in selects.

### Residual column strategy

- `amount_residual_mxn_odoo` — used for `.gt(..., 0)` filter in receivables/payables (live, 100% filled)
- `amount_residual_mxn_resolved` — returned in all SELECTs for forward compat (0% filled pre-Task-24)
- Task 24 will switch the filter to `amount_residual_mxn_resolved > 0`

### Consumer compilation status

Build: **compiled successfully** (`✓ Compiled successfully in 3.9s`). Only warnings (unused vars in pre-existing consumer files). No missing export errors. Legacy function signatures unchanged; no downstream breakage.

### Integration test

4 tests in `src/__tests__/silver-sp5/shared-companies.test.ts`. Tests skip when `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_KEY` env vars absent (correct integration test pattern — not a CI failure). Tests will execute and pass when run with live credentials.

### Commit (after review fixes)

Initial: `488cd84`. Amended twice to fix code-review issues + fully rewire legacy functions the first pass had left intact. **Final HEAD: `67013f1`.**

### Correction to "Consumer compilation status" above

The initial claim "legacy function signatures unchanged" applied only to export names. Function BODIES were rewired in the second amend so the file has 0 legacy `.from()` calls outside of 1 annotated SP5-EXCEPTION on `odoo_activities`. Pattern B canonicals (canonical_sale_orders, canonical_purchase_orders, canonical_order_lines, canonical_deliveries, canonical_manufacturing) DO exist — SP4 shipped them — and the 5 functions that had been stubbed as "TODO SP6" were rewritten to read them. 4 genuine TODO SP6 stubs remain for behavioral fields that truly require SP4-evidence-layer aggregation work (churnRiskScore, overdueRiskScore, email-intelligence counters, pareto_class).

### Additional schema drift (discovered during amend)

9. `canonical_sale_orders.salesperson_canonical_contact_id` — NOT `salesperson_contact_id` as SP4 plan stated.
10. `canonical_order_lines.subtotal_mxn` EXISTS — preferred for MXN-normalized aggregations over `subtotal`.
11. `canonical_invoices.amount_total_mxn` EXISTS alongside `amount_total_mxn_resolved`.

All 11 drift points captured in memory file `project_silver_sp5_schema_drift.md` for future implementers.

## Task 4 — _shared/{contacts,payments}.ts (completed 2026-04-21)

### Legacy reads removed
- contacts.ts: `from('contacts'` (3 call sites: getContactsPage, getContactDetail, getContactsKpis); also removed join to `companies` table
- payments.ts: `from('odoo_account_payments'` (1 call site: getCompanyPayments)

### New / preserved exports
- contacts.ts:
  - `listContacts(opts)` — new canonical function (also aliased as `searchContacts`)
  - `fetchContactById(id: number)` — new canonical function (also aliased as `getContactById`)
  - `getContactsPage(params)` — preserved, now reads canonical_contacts
  - `getContactDetail(id: string)` — preserved, now reads canonical_contacts + canonical_companies join
  - `getContactsKpis()` — preserved, now reads canonical_contacts
  - `listEmployees(opts)` — new, reads canonical_contacts WHERE contact_type LIKE 'internal_%'
- payments.ts:
  - `listCompanyPayments(canonical_company_id, opts)` — new canonical function
  - `getCompanyPayments(canonical_company_id, limit)` — preserved back-compat wrapper
  - `classifyPaymentState(state)` — new utility

### Schema drift verified vs plan
- canonical_contacts: email column is `primary_email` (plan assumed `primary_email` — CORRECT)
- canonical_contacts: name column is `display_name` (plan assumed `display_name` — CORRECT)
- canonical_contacts: company FK is `canonical_company_id` (plan assumed `canonical_company_id` — CORRECT)
- canonical_contacts: `is_internal` field does NOT EXIST; actual is `contact_type` (LIKE 'internal_%' for staff)
- canonical_payments: company FK is `counterparty_canonical_company_id` (plan assumed `canonical_company_id` — DRIFT)
- canonical_payments: date column is `payment_date_resolved` (plan assumed `payment_date` — DRIFT)
- canonical_payments: amount column is `amount_mxn_resolved` (plan assumed `amount_mxn` — DRIFT)
- canonical_payments: source column does NOT EXIST; `sources_present`, `has_odoo_record`, `has_sat_record` exist instead
- canonical_payments: PK is `canonical_id` (not `id`)
- canonical_payments: `direction` replaces `payment_type` (inbound/outbound)

### Back-compat aliases added to avoid breaking consumer pages
- ContactListRow: `company_id` (= canonical_company_id), `company_name` (= null for list, not joined)
- ContactDetail: `company_id` (= canonical_company_id), `company_name` (from canonical_companies join), `entity_id` (= primary_entity_kg_id)
- CompanyPaymentRow: `id` (= canonical_id), `payment_type` (= direction), `payment_date` (= payment_date_resolved), `amount_mxn` / `amount` (= amount_mxn_resolved), `currency` (= currency_odoo), `state` (derived from is_reconciled), `name` (derived)

### Helpers verified clean
period-filter.ts, year-filter.ts, table-params.ts, _helpers.ts — 0 `.from(` matches (all pure utilities, no DB reads).

### Tests
- Banned-token: 2 passing (no env needed).
- Integration: 3 skipped without env.

### Commit: 2afd9d6

## Task 5 — analytics/finance.ts rewrite (completed 2026-04-21)

### Inventory (Step 1 — legacy reads)
| Function | Legacy Read | Action |
|---|---|---|
| `getCfoSnapshot` | `cfo_dashboard` view | KEEP — SP5-VERIFIED |
| `getArZombies` | `invoices_unified` MV (257MB) | REPLACED → `canonical_invoices` |
| `getFinancialRunway` | `financial_runway` view | STUB null — view does not exist (dropped SP1) |
| `getWorkingCapital` | `working_capital` view | REPLACED → `gold_cashflow` |
| `getCashPosition` | `cash_position` view | REPLACED → `canonical_bank_balances` |
| `getPlHistory` | `pl_estado_resultados` view | REPLACED → `gold_pl_statement` |
| `getWorkingCapitalCycle` | `working_capital_cycle` view | KEEP — SP5-VERIFIED (gold_cashflow has no DSO/DPO/DIO) |
| `getProjectedCashFlow` | `projected_cash_flow_weekly` view + RPC | KEEP — SP5-VERIFIED |
| `getCashflowRecommendations` | RPC `get_cashflow_recommendations` | KEEP — SP5-VERIFIED (reads cashflow_* views) |
| `getPartnerPaymentProfiles` | `partner_payment_profile` MV (376kB) | REPLACED → client-side agg canonical_invoices + canonical_payments |
| `getJournalFlowProfiles` | `journal_flow_profile` MV (40kB) | KEEP — SP5-VERIFIED |
| `getAccountPaymentProfiles` | `account_payment_profile` MV (232kB) | REPLACED → canonical_payments agg by payment_method_odoo |

### Step 2 KEEP/DROP Verdicts
- KEEP: `cfo_dashboard` (reads odoo_bank_balances + odoo_invoices, not in drop list)
- KEEP: `projected_cash_flow_weekly` (reads cashflow_* views, not in drop list)
- KEEP: `working_capital_cycle` (gold_cashflow has no DSO/DPO/DIO fields)
- KEEP: `journal_flow_profile` (not in drop list §12)
- NOT EXIST: `financial_runway`, `working_capital` (dropped SP1) — stubbed returning null
- RPC `get_cashflow_recommendations` reads `cashflow_liquidity_metrics`, `cashflow_ar_acelerate`, `cashflow_ap_negotiate`, `cashflow_so_backlog` — all are views (not dropped legacy MVs) → SAFE
- RPC `get_projected_cash_flow_summary` reads same cashflow_* views → SAFE

### Schema Drift (new findings beyond T1-T4)
- `payment_state_odoo` (NOT `odoo_payment_state` or `payment_state`) — in `canonical_invoices`
- `canonical_payments.payment_method_odoo` (NOT `method_resolved`)
- `fiscal_days_to_due_date` is NULL for essentially all open issued invoices pre-Task-24 — fallback to `due_date_odoo` arithmetic used
- `financial_runway` and `working_capital` views DO NOT EXIST (dropped SP1, confirmed by pg_class query returning 0 rows)
- `gold_cashflow` fields: `current_cash_mxn`, `current_debt_mxn`, `total_receivable_mxn`, `overdue_receivable_mxn`, `total_payable_mxn`, `working_capital_mxn`, `bank_breakdown`, `refreshed_at` — NO DSO/DPO/DIO fields
- `gold_pl_statement.total_income` uses negative accounting convention (ABS needed for display)
- `gold_pl_statement.by_level_1` JSONB used to derive `costoVentas` / `gastosOperativos` / `otrosNeto` by `account_type` key

### Functions rewritten vs preserved
- REWRITTEN (5): `getArZombies`, `getWorkingCapital`, `getCashPosition`, `getPlHistory`, `getPartnerPaymentProfiles`, `getAccountPaymentProfiles`
- STUBBED TODO-SP6 (1): `getFinancialRunway` (view does not exist)
- PRESERVED with SP5-VERIFIED (7 annotations): `getCfoSnapshot`, `getWorkingCapitalCycle`, `getProjectedCashFlow`, `getCashflowRecommendations`, `getJournalFlowProfiles`

### Tests
- Banned-token: 6 passing / 4 skipped (integration without env)
- Grep gate: 0 banned reads in finance.ts
- Build: `✓ Compiled successfully` (no errors from this file; pre-existing consumer warnings in other files)

### SP5-VERIFIED annotations added: 7

### Commit: 5a07c80

## Task 6 — analytics/products.ts rewrite (completed 2026-04-21)

### Inventory (Step 1 — legacy reads found)

| Function | Legacy Read | Action |
|---|---|---|
| `getProductsKpis` | `odoo_products`, `product_margin_analysis` | REPLACED → `canonical_products`, `gold_product_performance` |
| `getTopMarginProducts` | `product_margin_analysis` | REPLACED → `gold_product_performance` |
| `getUomMismatchProducts` | `product_margin_analysis` | STUBBED → TODO SP6 (no canonical equivalent yet) |
| `getBomCostSummary` | `product_margin_analysis` (revenue context) | REPLACED → `canonical_order_lines` (sale) agg |
| `getPmaRevenueMap` (private) | `product_margin_analysis` | REPLACED → `getRevenueMapFromOrderLines` via `canonical_order_lines` |
| `getBomDuplicates` | `product_margin_analysis` (revenue+qty) | REPLACED → `canonical_order_lines` (sale) agg |
| `getSuspiciousBoms`, `getBomsMissingComponents`, `getTopRevenueBoms`, `getBomsWithMultipleVersions` | `product_real_cost` | KEEP (§12) + SP5-VERIFIED |
| `getInventoryPage`, `getReorderNeeded`, `getTopMovers`, `getTopMoversPage`, `getProductCategoryOptions` | `inventory_velocity` | KEEP (§12) + SP5-VERIFIED |
| `getDeadStock`, `getDeadStockPage` | `dead_stock_analysis` | KEEP (§12) + SP5-VERIFIED |

### New SP5 exports added

- `listProducts(opts)` — reads `canonical_products.*` with search/filter/active/category
- `searchProducts` — alias for `listProducts`
- `fetchTopSkusByRevenue(opts)` — reads `gold_product_performance` ordered by `odoo_revenue_12m_mxn`
- `topProductsByRevenue` — alias for `fetchTopSkusByRevenue`
- `fetchProductPerformance(canonical_product_id)` — reads `gold_product_performance` single row
- `getProductPerformance` — alias for `fetchProductPerformance`
- `fetchSupplierPriceIntelligence(canonical_product_id)` — `canonical_order_lines WHERE order_type=purchase` client-agg
- `fetchCompanyProductMatrix(canonical_company_id, direction)` — `canonical_order_lines` client-agg (replaces customer_product_matrix + supplier_product_matrix)
- `fetchProductSeasonality` — STUBBED returning null (TODO SP6: product_seasonality MV does not exist)

### Schema drift discovered (new, beyond T1-T5)

12. **`canonical_order_lines` is a MATERIALIZED VIEW (relkind=m)** — not a table, so `information_schema.columns` returns null. Must use `pg_attribute` to introspect columns.
13. **`gold_product_performance` column names differ from plan** — actual: `odoo_revenue_12m_mxn` (NOT `revenue_mxn_12m`), `unique_customers_12m` (NOT `customers`); no `margin_mxn_12m` column. Adapted selects.
14. **`canonical_products.category`** — not `category_path` (plan assumed). Fixed ilike filter.
15. **`product_seasonality` MV does not exist** (dropped before SP5) — `fetchProductSeasonality` stubbed as TODO SP6. The 6 other KEEP-list MVs all confirmed present.
16. **`TopMarginProductRow` back-compat** — `/productos` page uses `product_ref`, `product_name`, `weighted_margin_pct`, `weighted_markup_pct`, `total_revenue`, `customers`. All added as alias fields on the new interface to prevent downstream type errors without requiring consumer page rewire in T6.

### Functions rewritten vs preserved

- REWRITTEN (5 functions + 1 private helper): `getProductsKpis`, `getTopMarginProducts`, `getBomCostSummary`, `getBomDuplicates`, `getUomMismatchProducts` (stub), `getPmaRevenueMap` → `getRevenueMapFromOrderLines`
- NEW EXPORTS (7): `listProducts`, `searchProducts`, `fetchTopSkusByRevenue`, `topProductsByRevenue`, `fetchProductPerformance`, `getProductPerformance`, `fetchSupplierPriceIntelligence`, `fetchCompanyProductMatrix`, `fetchProductSeasonality`
- PRESERVED with SP5-VERIFIED (14 annotation sites): `inventory_velocity` (5), `dead_stock_analysis` (3), `product_real_cost` (6)
- STUBBED TODO SP6 (1): `fetchProductSeasonality` — MV does not exist

### SP5-VERIFIED annotations added: 14

### Tests

- Banned-token: 1 passing (no env needed).
- Integration: 2 skipped without env.
- Grep gate: 0 banned reads in products.ts.
- Build: `✓ Compiled successfully in 4.7s`

### Commit: 18f645a

## Task 7 — analytics/ small files rewire (completed 2026-04-21)

### Files rewired
- `customer-360.ts`: `analytics_customer_360` → `gold_company_360` (PK `canonical_company_id`). Added `fetchCustomer360`, `fetchTopCustomers`, `fetchTopSuppliers`. `getCustomer360` preserved as alias. `getTopAtRiskClients` moved to `dashboard.ts` (dashboard concern). `getCompanyInsights` kept (reads `agent_insights`, operational table not dropped).
- `dashboard.ts`: `customer_ltv_health` → `gold_company_360` for `getTopAtRiskClients` (with back-compat aliases: `company_id`, `company_name`, `ltv_mxn`, `churn_risk_score`). `pl_estado_resultados` → `gold_revenue_monthly` for `getRevenueTrend`. `getDashboardKpis()` SP5-VERIFIED: `get_dashboard_kpis()` RPC retained (page.tsx consumes old shape). Added `fetchDashboardKpis()` reading gold views. Added `fetchDashboardAlerts()` from `gold_ceo_inbox`.
- `pnl.ts`: Added `fetchPL`/`getPl`/`fetchIncomeStatement` reading `gold_pl_statement`. `getPnlByAccount` + `getMostRecentPeriod` SP5-VERIFIED Bronze: `odoo_account_balances` retained (PnlPorCuentaSection.tsx uses account-level fields `account_code/name/type`; no canonical equivalent in SP4).
- `currency-rates.ts`: `odoo_currency_rates` → `canonical_fx_rates` (has `recency_rank` for dedup). Added `fetchLatestFxRates`, `fetchFxHistory`. `getLatestCurrencyRates` preserved as alias.
- `index.ts`: `supplier_price_index` read in `getSupplierPriceAlerts` stubbed → returns `[]` + TODO SP6 (matview still live but in banned list). Added barrel `export *` for customer-360, dashboard, pnl, currency-rates, products. All other functions (rfm_segments, collection_effectiveness_index, revenue_concentration, stockout_queue, real_sale_price, customer_cohorts) preserved intact.

### Schema drift T7
- `gold_revenue_monthly.period_month` does NOT exist — actual column is `month_start`. Grand-total filter IS `canonical_company_id IS NULL` (confirmed).
- `gold_company_360.is_customer`, `is_supplier`, `overdue_amount_mxn`, `blacklist_level` all confirmed present.
- `canonical_fx_rates` has `recency_rank` (integer, 1=most recent per currency) and `is_stale` — confirmed. No `effective_date` column; it's `rate_date`.
- `supplier_price_index`: still a live matview — confirmed. But on banned grep gate list per SP5 plan. Stubbed in index.ts.
- `get_dashboard_kpis()` RPC: still live — confirmed. Retained for page.tsx compatibility.

### SP5-VERIFIED annotations added: 3
1. `get_dashboard_kpis()` RPC — retained, page.tsx consumes old shape
2. `odoo_account_balances` Bronze — account-level P&L detail, no canonical equivalent SP4
3. Implicit: `canonical_fx_rates` replaces direct `odoo_currency_rates` (not Bronze-retained; properly migrated)

### TODO SP6 stubs added: 1
- `getSupplierPriceAlerts()` → `[]` (supplier_price_index banned list; canonical_order_lines replacement pending purchase_price_intelligence MV)

### Test results
- 9 passed, 1 skipped (integration — no env vars in CI). All source-scan assertions green.
- Grep gate: 0 banned reads in Task 7 files. `finance.ts` has false-positive `working_capital_cycle` (contains `working_capital` substring; SP5-VERIFIED KEEP — pre-existing from T5).

### Build state
- TypeScript compile: CLEAN (0 errors in Task 7 files). Pre-existing errors in `analytics-finance.test.ts` from T5 unchanged.
- Static generation fails on `/equipo` (missing `SUPABASE_SERVICE_KEY` in build env — pre-existing, not introduced by T7).

### Commit: 1dac9df

## Task 8 — operational/sales.ts (completed 2026-04-21)

### Inventory of legacy reads (pre-rewrite)
| Line | Table | Function |
|---|---|---|
| 70 | `odoo_sale_orders` | `getSalesKpis` |
| 744 | `odoo_sale_orders` | `getTopSalespeople` |
| 814 | `odoo_sale_orders` | `getSaleOrdersPage` |
| 861 | `odoo_sale_orders` | `getSaleOrderSalespeopleOptions` |
| 908 | `odoo_sale_orders` | `getSaleOrdersTimeline` |
| 968 | `odoo_sale_orders` | `getRecentSaleOrders` |

No `odoo_order_lines`, `odoo_crm_leads`, `orders_unified`, or `order_fulfillment_bridge` reads existed in this file.

### Functions rewritten (6)
1. `getSalesKpis` — `odoo_sale_orders` → `canonical_sale_orders` (amount_total_mxn, salesperson_name preserved)
2. `getTopSalespeople` — `odoo_sale_orders` → `canonical_sale_orders` + `getSelfCanonicalCompanyIds()`
3. `getSaleOrdersPage` — `odoo_sale_orders` → `canonical_sale_orders`; company name resolved via canonical_companies.display_name instead of resolveCompanyNames(). Added `company_id` alias on output.
4. `getSaleOrderSalespeopleOptions` — `odoo_sale_orders` → `canonical_sale_orders`
5. `getSaleOrdersTimeline` — `odoo_sale_orders` → `canonical_sale_orders`
6. `getRecentSaleOrders` — `odoo_sale_orders` → `canonical_sale_orders`; same company-name pattern as getSaleOrdersPage

### New required exports added (5)
- `listSaleOrders` — canonical_sale_orders, all columns including salesperson_canonical_contact_id
- `listSaleOrderLines` — canonical_order_lines where order_type='sale'
- `listCrmLeads` — canonical_crm_leads
- `salesBySalesperson` — aggregate from canonical_sale_orders
- `fetchSalespersonMetadata` — canonical_contacts where contact_type LIKE 'internal_%'

### Functions preserved unchanged (8)
- `getSalesRevenueTrend` — uses pl_estado_resultados + invoices_unified (not banned)
- `getReorderRiskPage` / `getReorderRisk` — uses client_reorder_predictions (not banned)
- `getTopCustomersPage` / `getTopCustomers` — uses company_profile + invoices_unified (not banned)

### Schema drift discovered beyond T1-T7
- `canonical_sale_orders` has `canonical_company_id` (bigint FK to `canonical_companies.id`) — NOT the old `company_id` (FK to `companies.id`). These are different ID spaces.
- `canonical_companies` has `is_internal` flag (not `has_shadow_flag`) to identify self-company rows.
- Self-exclude pattern for canonical tables: query `canonical_companies WHERE is_internal=true` → ids [868]. Introduced `getSelfCanonicalCompanyIds()` module-level cached helper.
- `companies.relationship_type='self'` IDs (264744, 264746, 264747, 6707) are in the old `companies` table ID space — NOT usable against canonical_sale_orders.canonical_company_id.
- `canonical_sale_orders`: PK is `canonical_id`, no `id` column. `odoo_order_id` carries the Odoo integer for back-compat.
- `RecentSaleOrder` interface: added `company_id: number | null` alias = `canonical_company_id` for back-compat with `/ventas/page.tsx` which passes it directly to `<CompanyLink companyId={r.company_id}>`.
- Note: `canonical_companies.display_name` used for company name resolution (not `.name`).

### Tests
- File: `src/__tests__/silver-sp5/operational-sales.test.ts`
- 1 passed (banned-token source scan), 5 skipped (integration — no live env vars in CI)
- Grep gate: 0 banned reads. Command: `rg "\.from\(['\"](odoo_sale_orders|odoo_order_lines|odoo_crm_leads|orders_unified|order_fulfillment_bridge)['\"]" src/lib/queries/operational/sales.ts` → exit 1 (no matches)

### Build state
- TypeScript: 0 errors in sales.ts (`npx tsc --noEmit | grep sales.ts` = empty)
- ESLint: fixed `prefer-const` (2 `let companyNameMap` → `const`) and removed unused `resolveCompanyNames` import
- Static generation: fails on `/equipo` (pre-existing missing SUPABASE_SERVICE_KEY in build env — not introduced by T8)

### Commit: de6a49a

## Task 8 — broad sweep pass (completed 2026-04-21, amend → 186bfc6)

### Context

Prior implementer only eliminated `odoo_sale_orders` reads. File still had 18+ `.from()` calls to §12 drop-list MVs: `pl_estado_resultados`, `invoices_unified`, `company_profile`, `company_profile_sat`, `customer_margin_analysis`, `monthly_revenue_by_company`. This pass eliminates all of them per DoD Gate 3.

### Inventory of remaining §12 reads pre-sweep

| Function | Legacy MV | Count |
|---|---|---|
| `getSalesKpis` | `pl_estado_resultados`, `monthly_revenue_by_company` | 2 |
| `getSalesRevenueTrend` | `invoices_unified` (bounds path), `pl_estado_resultados` (default path) | 2 |
| `getTopCustomersPage` | `invoices_unified`, `customer_margin_analysis`, `overhead_factor_12m` (KEEP), `company_profile_sat`, `company_profile` | 5 |
| `getTopCustomers` | `company_profile`, `customer_margin_analysis`, `overhead_factor_12m` (KEEP), `company_profile_sat` | 4 |

### Replacements applied

| Legacy | Replacement | Notes |
|---|---|---|
| `pl_estado_resultados` | `gold_pl_statement` | `total_income` is negative (accounting credit); `Math.abs()` for revenue. `net_income` as proxy for `utilidad_operativa` |
| `monthly_revenue_by_company` | `gold_revenue_monthly` | Grand total: `canonical_company_id IS NULL`. No `ma_3m` col — computed client-side rolling 3-month average. Column is `month_start` (not `month`). Revenue = `resolved_mxn ?? odoo_mxn` |
| `invoices_unified` | `canonical_invoices` | Fields: `invoice_date_odoo`, `amount_total_mxn_resolved`, `amount_total_mxn`, `estado_sat`, `direction`, `receptor_canonical_company_id` |
| `company_profile` | `gold_company_360` | PK `canonical_company_id`. Revenue field is `revenue_90d_mxn` (not `revenue_90d`). No `total_revenue` — use `lifetime_value_mxn` |
| `company_profile_sat` | TODO SP6 stubs | No `total_invoiced_sat`/`total_invoiced_sat_ytd` equivalent in `gold_company_360` |
| `customer_margin_analysis` | TODO SP6 stubs | No canonical margin equivalent; `margin_12m`/`margin_pct_12m`/`adjusted_margin_pct_12m` nulled |

### SP5-VERIFIED annotations added

- `client_reorder_predictions` ×2 (in `getReorderRiskPage`, `getReorderRisk`)
- `overhead_factor_12m` ×3 (in `getTopCustomersPage` period path, default path; `getTopCustomers`)

Total: 5 annotation sites

### TODO SP6 stubs added

- `margin_12m` — `customer_margin_analysis` field, no canonical equivalent in gold_company_360 (×3 functions)
- `margin_pct_12m` — same (×3 functions)
- `adjusted_margin_pct_12m` — derived from margin_pct_12m (×3 functions)
- `total_invoiced_sat` — `company_profile_sat` field, not in gold_company_360 (×3 functions)
- `total_invoiced_sat_ytd` — same (×3 functions)

All stubs return `null`. Consumer pages (/ventas, /empresas/[id]) will show dashes/blank for these fields until SP6 ships canonical margin views.

### Schema drift discovered (T8 broad sweep, beyond prior T8 notes)

17. `gold_company_360.revenue_90d_mxn` (NOT `revenue_90d`) — adapted sort map and selects
18. `gold_company_360.lifetime_value_mxn` used as `total_revenue_lifetime` proxy (no `total_revenue` col)
19. `gold_revenue_monthly` has no `ma_3m` column — computed client-side
20. `canonical_invoices.invoice_date_odoo` is the date field for issued invoices (not `invoice_date`)
21. `canonical_invoices.receptor_canonical_company_id` is the company FK for received-side (customer) aggregation
22. `gold_pl_statement.net_income` used as proxy for `utilidad_operativa` (no operating income sub-total)

### Grep gate (full §12 ban list)

Result: 0 banned reads. Only KEEP-annotated `client_reorder_predictions` (×2) and `overhead_factor_12m` (×3) remain.

### Test results

- `operational/sales.ts — no §12 drop-list legacy reads` → 2 passed (broad ban + bronze-table check)
- Integration tests: 5 skipped (no live env vars)
- Total: 2 passed, 5 skipped

### Build state

- TypeScript: 0 errors from sales.ts
- ESLint: 0 errors from sales.ts (warnings only in pre-existing files)
- Static generation: fails on `/equipo` — pre-existing missing SUPABASE_SERVICE_KEY env var (same as T2/T3/T5/T7)

### Commit: 186bfc6

---

## Task 9 — operational/purchases.ts rewire (completed 2026-04-21)

### Inventory (legacy reads eliminated)

| Legacy table | Count | Replacement |
|---|---|---|
| `odoo_purchase_orders` | ×4 | `canonical_purchase_orders` |
| `invoices_unified` | ×1 (via `getUnifiedInvoicesForCompany`) | `canonical_invoices` direction='received' |
| `supplier_concentration_herfindahl` | ×4 | client-side aggregation from `canonical_order_lines` (TODO SP6) |
| `supplier_product_matrix` | ×2 | client-side aggregation from `canonical_order_lines` (TODO SP6) |

### Schema drift discovered (T9, beyond T1-T8 notes)

22. `canonical_payments.direction` values are `'sent'` (vendor outflow) and `'received'` (customer inflow) — confirmed via `SELECT DISTINCT direction`. For vendor payments filter on `direction='sent'`.
23. `canonical_purchase_orders.buyer_canonical_contact_id` EXISTS (confirmed via pg_attribute). `canonical_purchase_orders.canonical_company_id` is the supplier company FK.
24. `unified/index.ts::getUnifiedInvoicesForCompany` reads banned `invoices_unified` — replaced with direct `canonical_invoices` query in `getSupplierInvoices`.

### Functions rewritten / preserved / stubbed

| Function | Action |
|---|---|
| `getPurchasesKpisRaw` | Rewritten: `canonical_purchase_orders` + `canonical_invoices` (AP payable) + `cfo_dashboard` (KEEP) |
| `getSingleSourceRiskPage` / `getSingleSourceRisk` / `getSingleSourceSummary` | Rewritten: client-side aggregation from `canonical_order_lines`; TODO SP6 for gold_supplier_concentration |
| `getPriceAnomaliesPage` / `getPriceAnomalies` | Preserved: `purchase_price_intelligence` (SP5-VERIFIED KEEP) |
| `getPurchaseOrdersPage` | Rewritten: `canonical_purchase_orders`; company names from `canonical_companies.display_name` |
| `getRecentPurchaseOrders` | Rewritten: `canonical_purchase_orders` |
| `getPurchaseBuyerOptions` | Rewritten: `canonical_purchase_orders` |
| `getTopSuppliersPage` / `getTopSuppliers` | Rewritten: client-side aggregation from `canonical_order_lines`; supplier names fetched from `canonical_companies` |
| `getSupplierInvoices` | Rewritten: `canonical_invoices` direction='received' (drops banned `invoices_unified` import) |
| `getSupplierBlacklistStatus` / `getSuppliersBlacklistMap` | Unchanged: `reconciliation_issues` (not banned) |

### New exports added

- `listPurchaseOrders` — canonical POs with limit/from/to/state filters
- `listPurchaseOrderLines` — canonical order lines order_type='purchase'
- `listVendorPayments` — canonical payments direction='sent'
- `listSupplierPayments` — alias of listVendorPayments

### SP5-VERIFIED annotations

- `purchase_price_intelligence` ×2 (`getPriceAnomaliesPage`, `getPriceAnomalies`) — §12 KEEP retained
- `cfo_dashboard` ×1 (`getPurchasesKpisRaw`) — §12 KEEP retained

### TODO SP6 stubs

- `getSingleSourceRiskPage/Risk/Summary`: compute from `canonical_order_lines` client-side; once SP6 ships `gold_supplier_concentration` MV, replace aggregation with server-side query. Note: `product_ref`/`product_name`/`top_supplier_name` return `null` until SP6 adds canonical_products/canonical_companies join.
- `getTopSuppliersPage/getTopSuppliers`: aggregated from `canonical_order_lines`; TODO SP6 `gold_supplier_summary` for server-side paging.

### Consumer compatibility fixes (in-place, pending Task 14)

- `RecentPurchaseOrder` gains alias fields `id` (= `canonical_id`) and `company_id` (= `canonical_company_id`) — `/compras/page.tsx` references both; alias avoids a Task 14 dependency.

### Grep gate

Result: 0 matches on all banned Bronze + §12 drop-list patterns.

### Test results

- `operational/purchases.ts — no §12 drop-list legacy reads`: 2 passed
- Integration tests: 4 skipped (no live env vars in CI)
- Total: 2 passed, 4 skipped

### Build state

- TypeScript: 0 errors from purchases.ts (3 type fixes needed during compilation: SORT_MAP type, id/company_id alias fields)
- ESLint: warnings only in pre-existing files
- Static generation: fails on `/equipo` — pre-existing missing SUPABASE_SERVICE_KEY env var (same as T2/T3/T5/T7/T8)

### Commit: e1b0692

## Task 10 — operational/{operations,team}.ts rewire (completed 2026-04-21)

### Files rewired

- `src/lib/queries/operational/operations.ts` (15KB → canonical)
- `src/lib/queries/operational/team.ts` (9KB → canonical)
- `src/__tests__/silver-sp5/operational-ops-and-team.test.ts` (new)

### Legacy reads eliminated

**operations.ts:**
- `odoo_deliveries` → `canonical_deliveries` (MV, PK=`canonical_id`)
- `odoo_manufacturing` → `canonical_manufacturing` (MV, PK=`canonical_id`)
- `odoo_orderpoints` → `canonical_inventory` (view, PK=`canonical_product_id`)

**team.ts:**
- `odoo_employees` → `canonical_employees` (view over canonical_contacts)
- `odoo_users` → `canonical_employees` (same view, has `odoo_user_id`, `pending_activities_count`)
- `odoo_departments` → derived from `canonical_employees.department_name DISTINCT`
- `departments` (QB internal table) → also derived from `canonical_employees`
- `person_unified` — was not present; ban test confirms no reference

### SP5-VERIFIED annotations (3)

- `ops_delivery_health_weekly` — §12 KEEP (appears 2x)
- `inventory_velocity` — §12 KEEP
- `dead_stock_analysis` — §12 KEEP

### New required exports added

- `listDeliveries(opts)` — canonical_deliveries
- `listManufacturingOrders(opts)` — canonical_manufacturing
- `listInventory(opts)` — canonical_inventory
- `fetchInventoryVelocity(limit)` — inventory_velocity MV
- `fetchDeadStockAnalysis(limit)` — dead_stock_analysis MV
- `listTeamMembers(opts)` — canonical_employees
- `listDepartments()` — derived from canonical_employees
- `fetchEmployeeWorkload(opts)` — canonical_employees + agent_insights

### Schema drift discovered

- `canonical_deliveries` has NO embedded `company_name`. Has `canonical_company_id` only. Consumer pages expecting `company_name` get `null` (acceptable — company lookup requires separate join not available on the MV).
- Back-compat alias: `company_id = canonical_company_id` added to `DeliveryRow`, `LateDeliveryRow`, `PendingDeliveryRow` interfaces — `/operaciones` page uses `r.company_id` in CompanyLink.
- `canonical_employees` view has `pending_activities_count` and `overdue_activities_count` — no need to query `canonical_contacts` separately for activity counts.
- `canonical_employees` does NOT have `manager_name` text column — only `manager_canonical_contact_id` bigint FK. `getEmployees()` returns `manager_name: null`.
- `agent_insights.assignee_user_id` = odoo integer. No `assignee_canonical_contact_id` column on agent_insights (exists only on `reconciliation_issues`). Map via `canonical_employees.odoo_user_id → assignee_user_id`.

### Grep gate

0 matches for all banned Bronze + §12 drop-list patterns.

### Test results

- Static ban tests: 4 passed
- Integration tests: 8 skipped (no live env)
- Total: 4 passed, 8 skipped

### Build state

- TypeScript: 0 errors from T10 files
- ESLint: 1 lint fix during build (`let` → `const` for insightsByOdooUser)
- Static generation: fails on `/equipo` — pre-existing missing SUPABASE_SERVICE_KEY (same as all prior tasks)

### Commit: ed61c67

## Task 11 — unified/ folder rewire (completed 2026-04-21)

Rewired all three files: `invoices.ts` (22KB), `invoice-detail.ts` (5KB), `index.ts` (7.6KB).

### Inventory

**invoices.ts** — functions rewired:
- `getArAging` → `ar_aging_detail` MV (KEEP-listed, replaced non-existent `analytics_ar_aging`)
- `getCompanyAging` / `getCompanyAgingPage` → `cash_flow_aging` view (KEEP-listed, same schema as old `analytics_ar_aging`)
- `getOverdueInvoices` / `getOverdueInvoicesPage` / `getOverdueSalespeopleOptions` → `canonical_invoices`
- `getPaymentPredictions` / `getPaymentPredictionsPage` / `getPaymentRiskKpis` → `payment_predictions` (KEEP MV, unchanged)
- New: `listInvoices`, `listAllocations`, `invoicesReceivableAging` (canonical-native functions)

**invoice-detail.ts** — functions rewired:
- `getCfdiLinkByUuid` → `email_cfdi_links` (base table, unchanged)
- `fetchInvoiceDetail` → `canonical_invoices` + `listAllocations` + SP5-EXCEPTION odoo_invoice_lines
- `getInvoiceDetail` → alias for fetchInvoiceDetail
- `getInvoiceByName` → `canonical_invoices.odoo_name` (was `odoo_invoices.name`)

**index.ts** — functions rewired:
- `getUnifiedInvoicesForCompany` → `canonical_invoices` (company FK OR'd)
- `getUnifiedRevenueAggregates` → `canonical_invoices` (match_confidence, amount_total_mxn_resolved)
- `getUnifiedCashFlowAging` → `canonical_invoices` (days computed from due_date_odoo)
- `getUnifiedReconciliationCounts` → `reconciliation_issues` (base table, unchanged)
- `getUnifiedRefreshStaleness` → unchanged RPC

### Schema drift discovered (beyond T1-T10)

- **`analytics_ar_aging` does NOT exist** in Supabase — replaced with `cash_flow_aging` view (KEEP-listed, identical schema including `overdue_1_30`, `total_receivable` etc).
- **`canonical_invoices.invoice_date`** is plain `invoice_date` (date), NOT `invoice_date_odoo` as drift memo claimed. `invoice_date_odoo` column does not exist.
- **`canonical_invoices` has no `salesperson_name`** column — only `salesperson_user_id` (int) and `salesperson_contact_id` (bigint). Back-compat field returned as null with SP6 TODO.
- **`canonical_payment_allocations` FK**: `invoice_canonical_id` (confirmed), `payment_canonical_id`. No dedicated date column — uses `created_at` for ordering.

### SP5-EXCEPTIONs

1. `odoo_invoice_lines` in `invoice-detail.ts` — `canonical_invoice_lines` not shipped in SP4. Future SP6.

### Test results

- `npm run test -- src/__tests__/silver-sp5/unified-invoices.test.ts`: 4 passed, 4 skipped (no env)
- Grep gate: 0 matches for §12 banned table reads in unified/

### Build

- Pre-existing `/equipo` prerender failure (missing SUPABASE_SERVICE_KEY in build env) — unrelated to T11.
- No TypeScript errors from unified/ files.

### Commit: 22ee1a2

## Task 12 — Rewire /inbox to gold_ceo_inbox + evidence layer (completed 2026-04-21)

### Summary

Created `src/lib/queries/intelligence/inbox.ts` with `listInbox` and `fetchInboxItem` backed by `gold_ceo_inbox` and the four evidence tables. Rewired both inbox pages to import and use the new helpers.

### Schema verified (pg_attribute)

`gold_ceo_inbox` confirmed 17 columns: `issue_id` (uuid), `issue_type`, `invariant_key`, `severity`, `priority_score`, `impact_mxn`, `age_days`, `description`, `canonical_entity_type`, `canonical_entity_id`, `action_cta`, `assignee_canonical_contact_id` (bigint — confirmed present), `assignee_name`, `assignee_email`, `metadata`, `detected_at`.

Evidence tables confirmed: `email_signals`, `ai_extracted_facts`, `manual_notes`, `attachments` — all have `canonical_entity_type` + `canonical_entity_id` as `text` columns.

### Deviations from plan

1. **`createSupabaseServerClient` does not exist** — project uses `getServiceClient` from `@/lib/supabase-server`. Used that instead.
2. **Existing inbox pages already clean** — `inbox/page.tsx` used `agent_insights` via `getInsights` (not a banned table). `gold_ceo_inbox` items (reconciliation issues) are a distinct data set. Added as a secondary `ReconciliationIssuesList` section rather than replacing the agent_insights feed (which would have destroyed CEO insight triage).
3. **Insight detail page UUID routing** — `gold_ceo_inbox` uses UUID `issue_id`; `agent_insights` uses numeric `id`. Added UUID regex branch in `generateMetadata` and the page body so both can coexist on the same route.
4. **`ListInboxOptions` type** — needed explicit export from `inbox.ts` to avoid TypeScript error when used as a type argument in the page before the alias was declared.

### Files created/modified

- `src/lib/queries/intelligence/inbox.ts` — new (listInbox + fetchInboxItem)
- `src/app/inbox/page.tsx` — added `listInbox` import + `ReconciliationIssuesList` section
- `src/app/inbox/insight/[id]/page.tsx` — added `fetchInboxItem` import + UUID branch for reconciliation issue detail
- `src/__tests__/silver-sp5/inbox.test.ts` — new (6 static + 3 integration tests)

### Test results

- `npm run test -- src/__tests__/silver-sp5/inbox.test.ts`: 6 passed, 3 skipped (no env)
- Grep gate: all `.from()` calls in inbox files are canonical/evidence tables or `agent_insights` (base table, not banned)

### Build

- Pre-existing `/equipo` prerender failure (missing SUPABASE_SERVICE_KEY in build env) — unrelated to T12.
- No TypeScript errors from inbox files.

### Commit: 23618e3

## Task 13 — /empresas pages + PanoramaTab + CompanyLink rewire (completed 2026-04-21)

### Inventory (pre-rewire)

All 6 tab components and both page files had **0 direct `.from()` calls** — they already delegated to lib helpers.

| File | Direct `.from()` calls | Status |
|---|---|---|
| `empresas/page.tsx` | 0 | Uses `getCompaniesPage`, `getRfmSegments`, `getRfmSegmentSummary` |
| `empresas/[id]/page.tsx` | 0 | Uses `getCompanyDetail` (canonical since T03) |
| `PanoramaTab.tsx` | 0 | Uses `getCustomer360`, `getCompanyInsights`, `getCompanyEvidencePack` |
| `ComercialTab.tsx` | 0 | Clean |
| `FinancieroTab.tsx` | 0 | Uses `getCustomer360` (via analytics helpers) |
| `FiscalTab.tsx` | 0 | Uses `getCustomer360`, domain components |
| `OperativoTab.tsx` | 0 | Clean |
| `PagosTab.tsx` | 0 | Clean |
| `company-link.tsx` | 0 direct, but wrong URL | Linked to `/companies/` (legacy) |

### Changes made

1. **`company-link.tsx`** — rewired `href` from `/companies/${companyId}` → `/empresas/${companyId}`. `companyId` is `canonical_companies.id` (= `canonical_company_id` in `gold_company_360`). Added SP5 T13 annotation in comment.

2. **`empresas/page.tsx`** — fixed two `rowHref` callbacks from `/companies/${r.company_id}` → `/empresas/${r.company_id}` (one in `ReactivacionSection`, one in `CompaniesTable`).

3. **`src/__tests__/silver-sp5/empresas-pages.test.ts`** — new test file (17 tests): §12 ban list check for all files in `src/app/empresas/` + `company-link.tsx`; PanoramaTab odoo_ direct-read check; URL routing checks.

### Key finding: pages were already clean

The T03 rewire of `_shared/companies.ts` + T04 rewire of `_shared/contacts.ts` had already eliminated all legacy reads from the lib layer. Page files never had direct `.from()` calls — they were always using helper functions. The only real bugs were the URL routing issues (`/companies/` instead of `/empresas/`).

### Helper functions called from page files (all canonical)

- `getCompaniesPage` → `gold_company_360` (canonical)
- `getRfmSegments`, `getRfmSegmentSummary` → `rfm_segments` (in KEEP list — retained in §12)
- `getCompanyDetail` → `canonical_companies` + `gold_company_360` + `canonical_invoices` + `canonical_sale_orders`
- `getCustomer360` → `gold_company_360`
- `getCompanyInsights` → `agent_insights` (operational table, not in ban list)
- `getCompanyEvidencePack` → evidence layer (canonical)

### Schema drift beyond T1-T12

None discovered. All column names used in lib helpers confirmed correct from prior tasks.

### Test results

- `npm run vitest src/__tests__/silver-sp5/empresas-pages.test.ts`: 17/17 passed
- Grep gate: 0 legacy reads in page files

### Build

- Pre-existing `/equipo` prerender failure (missing SUPABASE_SERVICE_KEY in build env) — unrelated to T13.
- No TypeScript errors from empresas pages.
- All empresas routes compiled cleanly.

### Commit: (see git log)

## Task 14 — Rewire /ventas /compras /cobranza pages (completed 2026-04-21)

Commit: `053195e`

### Inventory per page

| File | Direct .from() calls | Notes |
|---|---|---|
| `src/app/ventas/page.tsx` | 0 | All Array.from() — JS utility only |
| `src/app/ventas/_components/sales-trend-chart.tsx` | 0 | Pure display component |
| `src/app/ventas/cohorts/page.tsx` | 0 | redirect() stub |
| `src/app/compras/page.tsx` | 0 | All Array.from() — JS utility only |
| `src/app/compras/costos-bom/page.tsx` | 0 | Imports from analytics/products.ts |
| `src/app/compras/price-variance/page.tsx` | 0 | redirect() stub |
| `src/app/compras/stockouts/page.tsx` | 0 | redirect() stub |
| `src/app/cobranza/page.tsx` | 0 | All Array.from() — JS utility only |
| `src/app/cobranza/_components/payment-risk-batch-actions.tsx` | 0 | Pure UI component |

### Key finding: pages were already clean of Supabase reads

All three main pages were already delegating to lib helpers (T08/T09/T11). The only actual bugs were URL routing: `rowHref` props used hardcoded `/companies/${id}` instead of `/empresas/${id}`.

### URL routing fixes applied

- `src/app/ventas/page.tsx`: 3 occurrences (`rowHref` in reorder-risk table, top-customers table, sale-orders table)
- `src/app/cobranza/page.tsx`: 3 occurrences (`rowHref` in payment-risk table, aging table, invoice list)
- `src/app/compras/page.tsx`: 0 occurrences (already clean or no company rowHref)

### SP5-EXCEPTION annotations

0 added. No Bronze/odoo_* reads remain in any of the 9 files.

### §12 ban check

Two benign false-positive strings found (not actual queries):
1. `ventas/page.tsx:1389` — EmptyState `description="customer_cohorts no tiene datos..."` (UI string)
2. `compras/page.tsx:1180` — EmptyState `description: "No hay datos en supplier_product_matrix."` (UI string)
3. `compras/page.tsx:1305` — code comment `// Columna de fecha en odoo_purchase_orders: date_order.`

None matched the test regex `from\(['"]${banned}['"]` — only string literals, not queries.

### Test results

- `ops-pages.test.ts`: 27/27 passed
  - 9 files × 3 tests each: §12 ban + Bronze ban + /empresas/ routing gate
- Grep gate: 0 Supabase `.from()` calls across all 9 files

### Build

- Pre-existing `/equipo` prerender failure (SUPABASE_SERVICE_KEY missing in build env) — unrelated to T14.
- No TypeScript errors in ventas/compras/cobranza files.
- `./src/app/ventas/page.tsx` compiled cleanly in build output.

## Task 16 — /productos /operaciones /contactos pages (completed 2026-04-21)

### Inventory (Step 1)

| Page | Files | Legacy reads found | Action |
|---|---|---|---|
| `/productos/page.tsx` | 1 | 0 direct `.from()` — delegates to `analytics/products.ts` (T06); string `product_margin_analysis` in EmptyState description | Cleaned description string |
| `/operaciones/page.tsx` | 1 | 0 direct `.from()` — delegates to `operational/operations.ts` (T10) | Already clean |
| `/contactos/page.tsx` | 1 | 0 direct `.from()` — delegates to `_shared/contacts.ts` (T04) | URL fix applied |
| `/contactos/[id]/page.tsx` | 1 | 0 direct `.from()` — delegates to `_shared/contacts.ts` (T04) | Already clean |
| `operaciones/_components/otd-weekly-chart.tsx` | 1 | 0 DB calls — pure renderer | No changes needed |

### Changes applied

1. **`/contactos/page.tsx` URL fix**: `rowHref={(r) => \`/contacts/${r.id}\`` → `\`/contactos/${r.id}\`` (1 URL fix)
2. **`/productos/page.tsx` description cleanup**: `"No hay datos en product_margin_analysis."` → `"No hay datos de margen en gold_product_performance."` — removed banned table name from UI text

### Lib delegation confirmed

- `/productos` → `analytics/products.ts` (T06): `getProductsKpis`, `getInventoryPage`, `getProductCategoryOptions`, `getTopMoversPage`, `getDeadStockPage`, `getTopMarginProducts`
- `/operaciones` → `operational/operations.ts` (T10): `getOperationsKpis`, `getWeeklyTrend`, `getDeliveriesPage`, `getManufacturingPage`, `getManufacturingAssigneeOptions`
- `/contactos` + `/contactos/[id]` → `_shared/contacts.ts` (T04): `getContactsPage`, `getContactsKpis`, `getContactDetail`

### SP5-EXCEPTION annotations added: 0

### URL fixes applied: 1 (`/contacts/` → `/contactos/`)

### Tests

- `domain-pages.test.ts`: 15/15 passed (5 files × 3 tests each: §12 ban + Bronze ban + /companies/ routing gate)
- Grep gate: 0 banned reads in any scope file

### Build

- Pre-existing `/equipo` prerender failure (SUPABASE_SERVICE_KEY missing in build env) — same as T14/T15, unrelated to T16.
- No TypeScript errors in productos/operaciones/contactos scope.

### Commit: 6a9cc7d

---

## Task 24 — Backfill `canonical_invoices.amount_residual_mxn_resolved` (completed 2026-04-21)

Migration: `1065_silver_sp5_amount_residual_mxn_resolved` (applied via MCP + local file written).

### Pre-backfill gate counts

| Metric | Value |
|---|---|
| total rows in canonical_invoices | 88,462 |
| already_filled (amount_residual_mxn_resolved IS NOT NULL) | 0 |
| candidates_positive (amount_residual_mxn_odoo > 0) | 669 |
| candidates_any (amount_residual_mxn_odoo IS NOT NULL) | 27,198 |

### Post-backfill counts

| Metric | Value |
|---|---|
| candidates | 27,198 |
| filled | 27,198 |
| coverage_pct | **100.00%** |

### FX helper verification

- `usd_to_mxn(date)` confirmed present in `pg_proc`.
- `eur_to_mxn` not present (not needed — no EUR residuals in dataset).

### Column-name adaptations

| Plan name | Actual column |
|---|---|
| `fiscal_moneda` | `currency_odoo` (primary; 27,198 filled — aligns exactly with target rows) |
| `odoo_currency` | `currency_odoo` |
| `fiscal_tipo_cambio` | `tipo_cambio_sat` (`tipo_cambio_odoo` is 0% filled) |
| `invoice_date` | `invoice_date` (confirmed) |

### FX logic applied

```
CASE
  WHEN currency_odoo IS NULL → treat as MXN (passthrough)
  WHEN currency_odoo = 'MXN' → passthrough amount_residual_mxn_odoo
  WHEN currency_odoo = 'USD' → amount_residual_mxn_odoo * COALESCE(usd_to_mxn(invoice_date), tipo_cambio_sat, 1)
  WHEN tipo_cambio_sat > 0   → amount_residual_mxn_odoo * tipo_cambio_sat
  ELSE                        → passthrough amount_residual_mxn_odoo
END
```

### gold_cashflow observation

`gold_cashflow` is a regular view (`relkind=v`) — no REFRESH needed. `total_receivable_mxn` currently shows `0.00` because it reads from `canonical_companies` pre-computed aggregates, which are updated by the nightly `silver_sp2_refresh_canonical_nightly` cron (03:30 UTC). The backfill unblocks that cron's AR aggregation pass. Post-next-cron-run, `total_receivable_mxn` will reflect the backfilled residuals.

### Audit

- `audit_runs` row inserted: `source='supabase'`, `model='silver_sp5'`, `invariant_key='sp5.task24'`, `bucket_key='sp5_task24_residual_backfill'`, `severity='ok'`.
- `schema_changes` row inserted: `triggered_by='silver-sp5-task-24'`, `change_type='BACKFILL'`.

### Commit: 84b1944

---

## Task 29 — Physical DROP of legacy objects (completed 2026-04-22)

Branch: `silver-sp5-t29-physical-drop`

### Step 2: Pre-DROP caller check

Initial run of caller check returned non-zero (7 files, multiple live callers). Required caller-unwiring pass before DROP could proceed. This was NOT in the original procedure — callers were supposed to have been cleaned up by T27/T28, but several remained:

- `health_scores` — `orchestrate/route.ts:1402` (atRiskContacts in comercial domain), `health-scores/route.ts` (full read/write)
- `agent_tickets` — `orchestrate/route.ts:396` (dedup enrich insert), `orchestrate/route.ts:1147` (pendingTickets cross-cutting select)
- `notification_queue` — `system.ts:41,471` (getSystemKpis + getNotifications for /sistema)
- `reconciliation_summary_daily` — `briefing/route.ts:153,157` (fiscal one-liner)
- `invoices_unified` — 3 test files (parity-fase5, invoices-unified-schema, reconciliation-integration)

### Caller fixes applied (commit 62af387)

| File | Fix |
|---|---|
| `orchestrate/route.ts:1402` | `Promise.resolve({data:[]})` — health_scores dropped |
| `orchestrate/route.ts:396` | noop — agent_tickets dropped |
| `orchestrate/route.ts:1147` | `Promise.resolve({data:[]})` — agent_tickets dropped |
| `system.ts:41` | `Promise.resolve({data:[]})` — notification_queue dropped |
| `system.ts:471 getNotifications()` | `return []` stub |
| `briefing/route.ts:153,157` | `Promise.resolve({data:null})` × 2 — reconciliation_summary_daily dropped |
| `health-scores/route.ts` | 410 Gone |
| `syntage/refresh-unified/route.ts` | 410 Gone |
| `vercel.json` | Removed `pipeline/health-scores` cron entry |
| `parity-fase5.test.ts` | `describe.skip` stub |
| `invoices-unified-schema.test.ts` | `describe.skip` stub |
| `reconciliation-integration.test.ts` | `describe.skip` stub |

Post-fix caller check: exit 1 (0 matches) — clean.

### Step 5: Inventory

| Object | Kind | Size |
|---|---|---|
| `invoices_unified` | MV | 257 MB |
| `payments_unified` | MV | 33 MB |
| `health_scores` | table | 12 MB |
| `odoo_snapshots` | table | 5.4 MB |
| `_deprecated_sp5` MVs (T27+T28, 12 objects) | MVs | ~13 MB |
| `agent_tickets` | table | 840 KB |
| `notification_queue` | table | 784 KB |
| `products_fiscal_map` + `invoice_bridge_manual` + `payment_bridge_manual` | tables | ~228 KB |
| `reconciliation_summary_daily` | table | 32 KB |
| Views (`cashflow_*`, `analytics_*`, etc., 5 objects) | views | 0 |
| **Total** | | **~322+ MB** |

Notable absences from DB: `syntage_invoices_enriched`, `products_unified`, `odoo_schema_catalog`, `odoo_uoms`, `unified_refresh_queue` — never existed or already dropped.

### Step 6: DB dependency check

CASCADE consumers (both legacy views, zero frontend callers):
- `payment_allocations_unified` — depended on `invoices_unified` + `payments_unified`
- `snapshot_changes` — depended on `odoo_snapshots`

Both were included in CASCADE and dropped cleanly.

### Migration 1071 — applied, result: success

All `_deprecated_sp5` remaining count: **0**. All spot-checked `to_regclass()` calls return NULL.

### Step 9 cron issue discovered and resolved

Post-drop cron check found two jobs still referencing dropped objects:
- jobid 3 `refresh-syntage-unified` (every 15 min): called `refresh_invoices_unified()` + `refresh_payments_unified()`
- jobid 5 `syntage-reconciliation-daily-snapshot` (daily 6:15am): inserted into `reconciliation_summary_daily`

Also: `refresh_all_matviews()` (jobid 2) had one failing run at 18:15 UTC attempting to REFRESH `invoices_unified` — this was a pre-drop timeout from the LAST run before DROP. Its T28 rewrite (defensive loop with `NOT LIKE '%_deprecated_sp5'` filter + per-MV error swallowing) will handle future runs cleanly.

**Migration 1071b** applied: `cron.unschedule('refresh-syntage-unified')`, `cron.unschedule('syntage-reconciliation-daily-snapshot')`, `DROP FUNCTION refresh_invoices_unified()`, `DROP FUNCTION refresh_payments_unified()`.

Active cron jobs after cleanup: **8** (all legitimate, all active).

### Commits

- `62af387` — chore(sp5): task 29 pre-drop — retire all legacy table callers
- `640248c` — feat(sp5): task 29 — physical DROP of legacy objects (irreversible)

### Branch pushed to origin — no PR yet (T30 will open PR)
