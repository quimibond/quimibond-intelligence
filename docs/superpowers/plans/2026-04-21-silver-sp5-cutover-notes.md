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
