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
