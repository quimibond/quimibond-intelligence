# Silver SP4 — Execution Notes

Running log of findings per task. Append one section per completed task.

## Task 1 — Pre-flight (completed 2026-04-21)

- Baseline `audit_runs` row inserted with `details->>'label' = 'pre_sp4_baseline'`.
- Branch cut from main @ 8f3c620 (post-SP3 merge).
- migrations dir verified writable.
- Migration patched for idempotency (WHERE NOT EXISTS guards on both INSERTs).

### Verified baseline counts (from audit_runs row, run_at 2026-04-21 19:41:09 UTC)

| Metric | Value |
|---|---|
| canonical_invoices | 88,462 |
| canonical_invoices_with_mxn_resolved | 0 |
| canonical_payments | 43,380 |
| canonical_payment_allocations | 25,511 |
| canonical_credit_notes | 2,208 |
| canonical_tax_events | 398 |
| canonical_companies | 4,359 |
| canonical_companies_with_ltv | 7 |
| canonical_contacts | 2,064 |
| canonical_products | 6,005 |
| source_links | 172,285 |
| mdm_manual_overrides | 20 |
| reconciliation_issues_open | 103,401 |
| reconciliation_issues_open_with_invariant_key | 72,427 |
| audit_tolerances_enabled | 16 |
| facts | 31,830 |

Matches plan expectations: invoices=88462 ✓, mxn_resolved=0 ✓, open_issues≈103400 ✓.

## Task 2 — canonical_sale_orders (completed 2026-04-21)

Migration `1041_silver_sp4_canonical_sale_orders.sql` applied. Pattern B thin MV over `odoo_sale_orders` with LEFT JOINs to `canonical_companies` (by `odoo_partner_id`) and `canonical_contacts` (by `odoo_user_id`). 5 indexes created (pk, company, salesperson, state_date, overdue partial).

### Step 3 — Counts

| Metric | Value | Notes |
|---|---|---|
| total_rows | 12,364 | Matches plan reference exactly ✓ |
| with_company | 12,217 | 98.8% — exceeds ≥95% threshold ✓ |
| with_salesperson | 8,560 | 69.2% — exceeds ≥60% threshold ✓ |
| overdue | 12,089 | See note below |
| active_states | 12,364 | All rows are state='sale' |

**Note on `overdue` / `active_states`:** Bronze `odoo_sale_orders` contains only `state = 'sale'` rows — no `done`, `draft`, or `cancel` states exist in the current Bronze snapshot. This means `active_states = total_rows`. The `is_commitment_overdue` flag is 12,089 because Bronze contains historical sale orders (many dating back years) with past `commitment_date` values; 249 rows either have no `commitment_date` (NULL) or a future date. The CASE logic is correct — this is a characteristic of the Bronze data, not a bug.

### Step 4 — Customer coverage (last 365 days, is_customer = true)

| state | n | total_mxn |
|---|---|---|
| sale | 2,216 | 181,755,643 |

Only `sale` state present (see note above). 2,216 active customer orders in the past 365 days totaling ~$182M MXN. Consistent with expectations for an active trading company.

## Task 3 — canonical_purchase_orders (completed 2026-04-21)

Migration `1042_silver_sp4_canonical_purchase_orders.sql` applied. Pattern B thin MV over `odoo_purchase_orders` with LEFT JOINs to `canonical_companies` (by `odoo_partner_id`) and `canonical_contacts` (by `odoo_user_id`). 4 indexes created (pk, company, buyer, state_date).

### Step 3 — Counts

| Metric | Value | Notes |
|---|---|---|
| total_rows | 5,673 | Matches plan reference exactly ✓ |
| with_company | 5,652 | 99.6% — exceeds ≥5400 threshold ✓ |
| with_buyer | 5,012 | 88.3% — buyer contact linked |
| active_states | 5,673 | All rows are `purchase` or `done` ✓ |

### State breakdown

| state | n |
|---|---|
| purchase | 5,590 |
| done | 83 |

**Note on states:** Bronze `odoo_purchase_orders` contains only `purchase` and `done` states — no `draft` or `cancel` rows in the current Bronze snapshot. This means `active_states = total_rows`. The MV logic and Bronze data are consistent.

## Task 4 — canonical_order_lines (completed 2026-04-21)

Migration `1043_silver_sp4_canonical_order_lines.sql` applied. Pattern B thin MV over `odoo_order_lines` with LEFT JOINs to `canonical_companies` (by `odoo_partner_id`) and `canonical_products` (by `odoo_product_id`). 3 derived columns: `qty_pending_invoice`, `has_pending_invoicing`, `has_pending_delivery`. 7 indexes created (pk, company, product, order, type_state, 2 partial pending).

### Step 3 — Counts by order_type

| order_type | rows | with_product | pending_invoicing | pending_delivery |
|---|---|---|---|---|
| sale | 21,003 | 20,205 | 3,217 | 3,176 |
| purchase | 11,095 | 10,180 | 0 | 0 |
| **total** | **32,098** | **30,385** | **3,217** | **3,176** |

**Notes:**

- Total 32,098 rows — matches plan reference ~32,083 ✓ (delta of 15 is normal Bronze churn).
- Product coverage: sale 96.2%, purchase 91.7% — both exceed ≥90% threshold ✓.
- `pending_invoicing` and `pending_delivery` are correctly 0 for purchase rows: the CASE predicate restricts both flags to `order_type = 'sale'` only.
- 3,217 sale lines with unresolved invoicing (~15.3% of sale rows) and 3,176 with unresolved delivery (~15.1%) — reasonable for an active trading company with open orders.

## Task 5 — canonical_deliveries (completed 2026-04-21)

Migration `1044_silver_sp4_canonical_deliveries.sql` applied. Pattern B thin MV over `odoo_deliveries` with LEFT JOIN to `canonical_companies` (by `odoo_partner_id`). 5 indexes created (pk, company, type_state, sched, partial late).

### Verify counts

| total | with_company | late_count | done_count | with_done_date |
|---|---|---|---|---|
| 25,187 | 24,882 | 276 | 20,949 | 20,949 |

**Notes:**

- Total 25,187 rows — matches plan reference ~25,187 exactly ✓.
- Company coverage: 24,882 / 25,187 = 98.8% ✓ (305 rows without canonical_company_id — unlinked partners).
- 276 late deliveries (1.1% of total) — `is_late = true` partial index active.
- 20,949 done rows (83.2%), all with `date_done` populated — 100% date coverage for completed deliveries ✓.
- `refreshed_at` uses `now()` at MV creation time; will be stale until next `REFRESH MATERIALIZED VIEW CONCURRENTLY canonical_deliveries` (wired to nightly pg_cron in SP4 engine).
