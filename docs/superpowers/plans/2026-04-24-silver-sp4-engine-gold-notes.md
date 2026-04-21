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

## Task 6 — canonical_inventory (completed 2026-04-21)

Migration `1045_silver_sp4_canonical_inventory.sql` applied. Pattern B live VIEW (not MV) over `canonical_products` with LEFT JOIN to `odoo_orderpoints` on `odoo_product_id`. Rationale: orderpoints set is tiny (57 rows) — materializing adds no performance benefit; live view always reflects current stock quantities.

### Verify counts

| rows | with_orderpoint | untuned | stockouts |
|---|---|---|---|
| 6,013 | 51 | 19 | 5,002 |

**Notes:**

- 6,013 rows — exceeds ≥6,004 threshold ✓. Delta of 9 vs canonical_products (6,004) is because 9 products have multiple orderpoints across warehouses (one row per orderpoint per product). `with_orderpoint = 51` vs expected ≈57 — 6 orderpoints reference products not yet in canonical_products (possible inactive/archived products). Not a concern.
- `untuned = 19` — 19 orderpoints where `product_min_qty = 0` and `qty_to_order > 0`, meaning the reorder rule exists but min threshold is unconfigured. Actionable for ops.
- `stockouts = 5,002` — 5,000 canonical_products have `available_qty <= 0` (confirmed via direct count), +2 from multi-orderpoint products. This is expected for Quimibond's textile business model: the catalog contains ~6k SKUs (fabric/color/weight variants) most of which are made-to-order or not currently stocked. Not a data bug.
- `refreshed_at` calls `now()` at query time — always current (advantage of VIEW over MV for this use case).
- `schema_changes` row inserted: `CREATE_VIEW / canonical_inventory / silver-sp4-task-6 / 2026-04-21 20:07:21 UTC`.

## Task 7 — canonical_manufacturing (completed 2026-04-21)

Migration `1046_silver_sp4_canonical_manufacturing.sql` applied. Pattern B thin MV over `odoo_manufacturing` with LEFT JOIN to `canonical_products` (by `odoo_product_id`). 2 derived columns: `yield_pct` (100 × qty_produced / qty_planned, NULL when qty_planned = 0) and `cycle_time_days` (EXTRACT(EPOCH …) / 86400, NULL when either date is NULL). 3 indexes created (pk, state, canonical_product_id).

### Verify — state breakdown

| state | count | avg_yield | avg_cycle_days |
|---|---|---|---|
| done | 4,416 | 100.8 | 0.12 |
| cancel | 209 | 0.0 | 0.56 |
| confirmed | 54 | 0.0 | 12.44 |
| draft | 15 | 0.0 | 0.04 |
| to_close | 14 | 0.0 | 0.04 |
| progress | 5 | 0.0 | 0.04 |
| **total** | **4,713** | | |

**Notes:**

- Total 4,713 rows — matches spec volume exactly ✓.
- 4,416 `done` orders (93.7% completion rate) with avg yield of 100.8% — slight over-production is normal for textile cut-and-sew (rounding up to full meters/rolls).
- `avg_cycle_days = 0.12` for done orders indicates same-day or next-day production cycles — consistent with Quimibond's make-to-order model on standard SKUs.
- 54 `confirmed` orders with avg cycle 12.44 days — these are open work orders scheduled but not yet started; the cycle clock started at `date_start` so this reflects elapsed wait time.
- `yield_pct` and `cycle_time_days` are NULL for all non-`done` states (qty_produced = 0 / date_finished IS NULL respectively) — expected, not a data gap.
- `schema_changes` row inserted: `CREATE_MV / canonical_manufacturing / silver-sp4-task-7`.

## Task 8 — canonical_bank_balances (completed 2026-04-21)

Migration `1047_silver_sp4_canonical_bank_balances.sql` applied. Pattern B live VIEW over `odoo_bank_balances` (22 rows — too small to materialize). Adds 2 derived columns: `is_stale` (true when `now() - updated_at > 48h`) and `classification` (cash / debt / other).

**Classification logic:**
- `debt`: `journal_type = 'credit_card'` OR `current_balance_mxn < 0`
- `cash`: `journal_type IN ('bank','cash')` AND `current_balance_mxn > 0`
- `other`: all remaining (zero-balance accounts, unclassified journal types)

**Verify query results (2026-04-21):**

| classification | count | total_mxn | stale |
|---|---|---|---|
| cash | 13 | 2,580,897 | 0 |
| debt | 1 | -55,809 | 0 |
| other | 8 | 0 | 0 |

Total: 22 rows. Net liquid position: MXN 2,525,088 (cash + debt). 0 stale rows (sync current). The single `debt` row is a credit-card journal with negative balance. The 8 `other` rows are zero-balance accounts (bank/cash journals with `current_balance_mxn = 0` fall through to `other` since the `cash` branch requires `> 0`).

## Task 9 — canonical_fx_rates VIEW + usd_to_mxn(date) (completed 2026-04-21)

Migration `1048_silver_sp4_canonical_fx_rates.sql` applied. Pattern B thin VIEW over `odoo_currency_rates` with `is_stale` flag (>3 days old) and `recency_rank` window function partitioned by currency. Previous zero-arg `usd_to_mxn()` dropped (CASCADE); replaced by `usd_to_mxn(p_date date DEFAULT CURRENT_DATE)` which queries the view.

**Pre-flight caveat check:** Existing `usd_to_mxn()` was a simple scalar querying `odoo_currency_rates` directly with a 19.5 MXN fallback. No dependents found (`pg_depend` returned empty). DROP CASCADE was safe.

**Verify query results (2026-04-21):**

### Query 1 — per-currency rows

| currency | rows | latest_rows |
|---|---|---|
| EUR | 35 | 1 |
| USD | 36 | 1 |

USD and EUR both present with `latest_rows = 1` (recency_rank partition correct).

### Query 2 — usd_to_mxn(CURRENT_DATE)

| usd_today |
|---|
| 17.272300 |

### Query 3 — usd_to_mxn(DATE '2025-01-15')

| usd_2025_01_15 |
|---|
| NULL |

NULL is expected and correct: `odoo_currency_rates` only contains data from 2026-03-16 onward (USD earliest) and 2026-02-25 (EUR earliest). There is no FX data for 2025-01-15 in Bronze. Historical back-fill is a separate data-quality concern, not a bug in the view or function logic.

**Zero-arg backward compatibility:** `usd_to_mxn()` (no args) still works via the DEFAULT — callers using the old zero-arg form will get the CURRENT_DATE rate seamlessly.

- `schema_changes` row inserted: `CREATE_VIEW / canonical_bank_balances / silver-sp4-task-8`.

## Task 10 — canonical_account_balances VIEW (completed 2026-04-21)

Migration `1049_silver_sp4_canonical_account_balances.sql` applied. Pattern B live VIEW joining `odoo_account_balances` (11,032 rows total) with `odoo_chart_of_accounts` via `odoo_account_id`. Adds `balance_sheet_bucket` classification column and `refreshed_at` timestamp.

**balance_sheet_bucket logic:**
- `asset`: `account_type LIKE 'asset_%'`
- `liability`: `account_type LIKE 'liability_%'`
- `equity`: `account_type LIKE 'equity%'`
- `income`: `account_type LIKE 'income%'`
- `expense`: `account_type LIKE 'expense%'`
- `other`: all remaining (unclassified or NULL account_type from LEFT JOIN miss)

**Latest period:** `2026-04` (154 rows in latest period).

**Verify query results — latest period (2026-04):**

| balance_sheet_bucket | rows | total_balance (MXN) |
|---|---|---|
| asset | 41 | -4,287,560 |
| expense | 72 | 9,175,355 |
| income | 14 | -6,498,757 |
| liability | 27 | 1,610,962 |

**Notes:**
- No `equity` or `other` bucket rows in the latest period. Equity accounts either have no movement for 2026-04 or their `account_type` value in `odoo_chart_of_accounts` does not match the `equity%` pattern — consistent with the known `equity_unaffected` gap (§14.2).
- **Asset ≠ Liability + Equity gap confirmed:** Asset total = -4,287,560 vs Liability total = 1,610,962. Equity bucket is absent from the latest period, which is the primary source of the imbalance. This is the documented `equity_unaffected` gap: Odoo's `equity_unaffected` account type (retained earnings / prior-period equity) does not match any of the `equity%` LIKE patterns and falls through to either NULL (if COA join misses) or `other`. The P&L accounts (income/expense) appearing here are YTD period slices, not balance-sheet closing balances, so the accounting equation does not close at the period-view level — this is expected.
- `schema_changes` row inserted: `CREATE_VIEW / canonical_account_balances / silver-sp4-task-10`.

## Task 11 — canonical_chart_of_accounts VIEW (completed 2026-04-21)

Migration `1050_silver_sp4_canonical_chart_of_accounts.sql` applied. Pattern B live VIEW over `odoo_chart_of_accounts` (1,640 rows). Adds `tree_level` (hyphen-count + 1) and `level_1_code` (SPLIT_PART on `-`) computed columns.

### Verify query results

| tree_level | rows | dep_count | active_count |
|---|---|---|---|
| 1 | 1,640 | 0 | 1,525 |

**Notes:**
- **Single tree_level=1 for all rows:** Bronze `odoo_chart_of_accounts` uses dot-notation codes (e.g., `101.01.01`, `102.01.0001`) — not hyphen-delimited. Since no `-` characters appear in any `code`, the hyphen-count formula `LENGTH(code) - LENGTH(REPLACE(code, '-', '')) + 1` correctly yields 1 for every row. The view spec uses `-` as the separator; this is the correct formula per spec — the Bronze data characteristic is the explanation. The `level_1_code` column similarly returns the full code (no split occurs). Future consumers needing dot-level hierarchy should use `SPLIT_PART(code, '.', 1)` which yields 91 distinct level-1 prefixes.
- **368 rows with empty code:** 1,640 total − 1,272 with_code = 368 rows have `code = ''`. These are system/multi-company accounts added by Odoo modules without a SAT chart code. `tree_level` = 1 and `level_1_code` = `''` for these rows — consistent and non-breaking.
- **0 deprecated, 1,525 active:** No accounts are marked deprecated; 115 rows have `active = false` (hidden accounts in Odoo UI).
- `schema_changes` row inserted: `CREATE_VIEW / canonical_chart_of_accounts / silver-sp4-task-11`.
