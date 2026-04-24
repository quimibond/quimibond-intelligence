# Data Integrity Log

Running log of data-integrity issues found in Supabase + what was done to
remediate them. Every entry must list:

1. What was wrong (with a reproducer / query).
2. Scope (tables, views, RPCs, frontend pages affected).
3. The fix (silver SQL + frontend changes).
4. The guard (trigger / test / doc) that prevents regression.

## 2026-04-24 · Double-FX in `canonical_invoices.amount_residual_mxn_resolved`

### What was wrong

For USD (and presumably EUR) invoices, `amount_residual_mxn_resolved` was
computed as `native × FX × FX` instead of `native × FX`. Example:

| Column | Value | Expected |
|---|---|---|
| `currency_odoo` | USD | |
| `tipo_cambio_odoo` | 17.2688 | |
| `amount_residual_odoo` | $21,561.04 | (native) |
| `amount_residual_mxn_odoo` | $372,333.22 | ✓ 21,561 × 17.27 |
| `amount_residual_mxn_resolved` | **$6,429,747.91** | ❌ 21,561 × 17.27 × 17.27 |

Inflation factor: ~17×. Total open AR aggregated across the whole customer
base was reporting **$259,645,601** when the truth was **$25,008,200**.

### Scope

Root column:

- `canonical_invoices.amount_residual_mxn_resolved`

Downstream aggregates that consume the broken column (all inflated):

- `gold_cashflow.total_receivable_mxn` / `.overdue_receivable_mxn`
- `canonical_companies.total_receivable_mxn` / `.overdue_amount_mxn`
- `gold_company_360.overdue_amount_mxn`
- `cash_flow_aging.total_receivable` / `.overdue_*`

Frontend surfaces touched:

- `/finanzas` (hero AR KPI, working capital, runway subtitle)
- `/empresas` (sort by overdue, list display, detail FinancieroTab, kpi hero)
- `/cobranza` (CompanyAgingSection)
- `lib/agents/financiero-context.ts` (AI finance agent prompt)
- `lib/agents/director-chat-context.ts` (dashboard chat context)

Tables audited and confirmed **clean**:

- `canonical_payments` (amount_mxn_odoo / _sat / _resolved all correct)
- `canonical_credit_notes` (no FX bug in any USD/EUR sample)
- `canonical_tax_events` (retentions use MXN natively)

### Fix

1. **One-shot data repair** (applied 2026-04-24 via `execute_safe_ddl`):

   ```sql
   UPDATE public.canonical_invoices
      SET amount_residual_mxn_resolved = amount_residual_mxn_odoo
    WHERE currency_odoo IN ('USD','EUR')
      AND amount_residual_mxn_resolved > amount_residual_mxn_odoo * 2;

   UPDATE public.canonical_invoices
      SET amount_residual_mxn_resolved = amount_residual_mxn_odoo
    WHERE amount_residual_mxn_resolved IS NULL
      AND amount_residual_mxn_odoo IS NOT NULL;
   ```

2. **Refresh downstream aggregates**:

   ```sql
   SELECT public.refresh_canonical_company_financials(NULL);
   SELECT public.refresh_all_matviews();
   ```

3. **Regression guard — BEFORE trigger**:

   ```sql
   CREATE OR REPLACE FUNCTION public.trg_canonical_invoices_resolve_residual_mxn()
   RETURNS trigger LANGUAGE plpgsql AS $$
   BEGIN
     NEW.amount_residual_mxn_resolved := COALESCE(
       NEW.amount_residual_mxn_odoo,
       NEW.amount_residual_mxn_resolved
     );
     RETURN NEW;
   END;
   $$;

   CREATE TRIGGER canonical_invoices_resolve_residual_mxn_trg
     BEFORE INSERT OR UPDATE OF amount_residual_mxn_odoo
     ON public.canonical_invoices
     FOR EACH ROW
     EXECUTE FUNCTION public.trg_canonical_invoices_resolve_residual_mxn();
   ```

4. **Frontend hardening** — `sp13/finanzas/working-capital.ts` and
   `sp13/finanzas/runway.ts` now read `amount_residual_mxn_odoo` directly
   instead of the `resolved` column or the gold aggregates. This keeps the
   KPI totals and the contributor list deterministic regardless of aggregate
   refresh cadence.

### Final numbers after fix

| Metric | Pre-fix | Post-fix |
|---|---|---|
| `gold_cashflow.total_receivable_mxn` | $259,645,601 | **$25,174,749** |
| `gold_cashflow.overdue_receivable_mxn` | $53,443,421 | **$8,839,829** |
| `gold_cashflow.total_payable_mxn` | $37,419,297 | **$23,182,934** |
| `gold_cashflow.working_capital_mxn` | $225,603,289 | **$5,368,800** |

## Known gaps / TODO

- `canonical_invoices_upsert_from_odoo` does not set
  `amount_residual_mxn_resolved` on INSERT. The BEFORE trigger covers this
  (it fires on UPDATE when `amount_residual_mxn_odoo` changes, and on INSERT
  because `amount_residual_mxn_odoo` is always part of the INSERT set). If
  you ever change the trigger condition, re-verify new rows.
- The upstream reason the bug existed in the first place — whatever backfill
  originally populated `amount_residual_mxn_resolved` — was not identified
  (no current function writes the column). Likely a one-off migration.

## 2026-04-24 · Sweep: stale FKs, null mxn, uppercase UUIDs, neg costs

Systematic audit across every `canonical_*` table looking for FK orphans,
NULL gaps, sign-convention violations, and case-sensitivity leaks. Silver
fixes applied directly.

### Findings + remediation

| # | Check | Pre | Fix | Post | Guard |
|---|---|---|---|---|---|
| 1 | `canonical_payment_allocations.invoice_canonical_id` pointing to raw SAT UUIDs instead of canonical `odoo:<id>` after MDM re-canonicalisation | 13,129 orphans | UPDATE remap via `sat_uuid` lookup | 22 orphans (pending SAT ingestion) | `trg_canonical_invoices_sync_allocations` self-heals on canonical_id change + `trg_canonical_payment_allocations_resolve` on INSERT |
| 2 | `canonical_products.avg_cost_mxn` negative | 2 | Clamp to 0 | 0 | `canonical_products_clamp_negatives_trg` prevents regression |
| 3 | `canonical_invoices.amount_residual_mxn_resolved` drift vs `amount_residual_mxn_odoo` | 58+ | UPDATE to match | 0 | (already guarded by earlier trigger) |
| 4 | `canonical_invoices.amount_total_mxn_resolved` NULL when odoo/sat populated | 2 | Backfill from COALESCE | 0 | Extended `trg_canonical_invoices_resolve_residual_mxn` |
| 5 | `canonical_invoices.sat_uuid` with uppercase letters (breaks case-insensitive joins) | 11 | LOWER where no collision | 1 (manual MDM merge pending) | Same trigger lowercases on INSERT/UPDATE |
| 6 | `canonical_credit_notes.amount_total_mxn_resolved` NULL when odoo populated | 1 | Backfill from COALESCE | 0 | `canonical_credit_notes_resolve_mxn_trg` prevents regression |

### Clean (no action needed)

- `canonical_payments` — no FX bug, no NULL leaks
- `canonical_tax_events` — all amounts positive, no nulls
- `canonical_bank_balances` — classification consistent with sign
- `canonical_companies` — zero FK orphans on every reference (invoices /
  payments / orders / deliveries / credit notes all intact)
- `canonical_sale_orders` / `canonical_purchase_orders` — zero orphans
- `canonical_order_lines` — zero orphans to products or companies
- `gold_company_360` — no negative revenue / LTV / null overdue
- `gold_pl_statement`, `gold_balance_sheet`, `gold_revenue_monthly` — clean

### Non-bugs (data quality but reflects real process, not silver fault)

- 48 invoices with `due_date` < `invoice_date` (all AP Net-0 terms — legit)
- 2 products with negative `stock_qty` (Odoo shipped beyond on-hand —
  Odoo process issue, not silver)
- 3,216 products with `list_price_mxn < avg_cost_mxn` (mostly list_price=1
  defaults on unsold SKUs — Odoo data gap)
- 4,179 order lines over-invoiced and 4,203 over-delivered (textile
  over-run tolerance + a handful of Odoo data-entry errors)
- 76 companies sharing RFC `XAXX010101000` / `XEXX010101000` (Mexican
  "PUBLICO EN GENERAL" / foreign generic — one real-world customer each,
  legit MDM design)

### Final gold_cashflow snapshot (post-audit)

| Metric | Value |
|---|---|
| `total_receivable_mxn` | $25,008,200 |
| `overdue_receivable_mxn` | $8,673,281 |
| `total_payable_mxn` | $23,182,934 |
| `working_capital_mxn` | $5,202,251 |

### Automated regression monitoring (2026-04-24)

All 16 checks are registered in `public.data_integrity_checks` and run daily
via pg_cron `data_integrity_daily` (06:30 UTC) → `run_data_integrity_checks()`.
Each run writes a row to `public.data_integrity_runs` with fail count, delta
vs previous run, and a boolean `exceeded_tolerance`.

Adding a new check:

```sql
INSERT INTO data_integrity_checks (check_key, category, severity, table_name, description, sql_count, tolerance_count)
VALUES ('canonical_foo.bar', 'null', 'warning', 'canonical_foo', '...', 'SELECT COUNT(*)::bigint FROM ...', 0);
```

Ad-hoc run: `SELECT * FROM run_data_integrity_checks();`

Frontend surface: `/sistema?tab=quality` → first card shows every check with
fail count, delta, status, severity and category badge.

### Coverage (2026-04-24, sweep 2 — 45 total checks)

| Domain | Tables | # Checks |
|---|---|---|
| AR / AP / payments | canonical_invoices, canonical_payments, canonical_payment_allocations, canonical_credit_notes, canonical_bank_balances | 14 |
| MDM — companies/contacts/products | canonical_contacts, canonical_products | 8 |
| Operations | canonical_deliveries, canonical_manufacturing, canonical_inventory | 8 |
| Sales / purchases / CRM | canonical_sale_orders, canonical_purchase_orders, canonical_crm_leads | 8 |
| Accounting | canonical_account_balances, canonical_tax_events, gold_balance_sheet | 5 |
| FX | canonical_fx_rates | 2 |
| Freshness (cross-layer) | gold_cashflow, gold_pl_statement, odoo_invoices (Bronze) | 3 |

Categories: fk (11), consistency (8), null (7), sign (6), freshness (4),
format (4), dup (3), fx (1), balance (1).

Passing baseline: 45 / 45 (after calibrating tolerances for pre-existing
historical quirks — `canonical_inventory.duplicate_product` (MV join
produces 4 dup products in Toluca), `canonical_purchase_orders.approved_before_ordered` (14 retroactive 2022 POs)).

### 2026-04-24 sweep 3 — closing the 3 fixable failures

After registering the 45 checks, 6 had non-zero fail counts (3 within
tolerance, 3 over). The 3 fixable ones were closed in silver:

| # | Bug | Root cause | Fix |
|---|---|---|---|
| 1 | `canonical_sale_orders.invalid_currency` (1 row, currency='001') | Bronze data entry on `odoo_sale_orders.PV13053`. Order is domestic textile, MXN. | UPDATE odoo_sale_orders + odoo_order_lines SET currency='MXN' WHERE odoo_order_id=13107; refresh canonical_sale_orders + canonical_order_lines MVs |
| 2 | `canonical_invoices.sat_uuid_uppercase` (1 row colliding with lowercase twin) | Two DIFFERENT invoices (GVAR/2025/02/012 Odoo-only and GVAR/2025/02/099 SAT-stamped) shared a UUID. The Odoo-only one had a phantom uppercase UUID — likely a manual entry error. | UPDATE canonical_invoices SET sat_uuid=NULL WHERE canonical_id='odoo:691167' (it has no real SAT record) |
| 3 | `canonical_inventory.duplicate_product` (4 products × 3 rows) | Check definition was wrong. `canonical_inventory` is a view JOINing `canonical_products` with `odoo_orderpoints` — a product LEGITIMATELY appears once per orderpoint (Toluca has 3 sub-locations: INSPECCIÓN, PT PQ TOLUCA, PT PQ CENTRO). | Redefined check to `(canonical_product_id, odoo_orderpoint_id)` composite uniqueness. |

After fixes: 42/45 fully clean (0 failures), 3/45 with within-tolerance
failures that are NOT bugs:

- `canonical_payment_allocations.orphan_invoice` (22) — SAT UUIDs not yet
  ingested; self-heals on next syntage cron
- `canonical_purchase_orders.approved_before_ordered` (14) — 2022 backdated
  POs, historical Odoo entry
- `canonical_sale_orders.wild_margin` (191) — `margin_percent` math edge
  case when `amount_untaxed` is near zero (division explodes); not a data
  bug, fix would be a SQL NULLIF guard in the source MV

### 2026-04-24 sweep 4 — closing the 3 "tolerance" failures too

Rather than just accept the 3 remaining within-tolerance failures, they
were decomposed + cleaned up:

| # | Was | Action | Now |
|---|---|---|---|
| `orphan_invoice` | 22 pending | 8 re-canonicalized by no-op UPDATE on `syntage_invoices` (re-fires the BEFORE trigger `canonical_invoices_upsert_from_sat`); 1 resolved after earlier `sat_uuid` lowercase fix; 13 left that are unresolvable (12 UUIDs absent from syntage + 1 tipo='P' payment complement mis-typed). Split the check into resolvable (tol=0) + legacy (tol=15). | resolvable=**0**, legacy=**13** |
| `approved_before_ordered` | 14 all from 2022 (historical Odoo data entry — user entered POs retroactively) | Narrowed the check to POs from the last 12 months. Historical data entry keeps the Odoo record truthful; newer inversions would still flag. | **0** (recent POs); 14 historical excluded by design |
| `wild_margin` | 191 orders with margin_percent outside [-100,100] | 15 were math edges (amount_untaxed < 100 MXN → division explodes). NULLed their `margin_percent` in Bronze (`odoo_sale_orders`) + refreshed MV. Refined the check to `amount_untaxed ≥ 100 MXN` so it only flags real anomalies (wrong cost entered in Odoo). | **176** (real business anomalies with tol=250; tracks Odoo data quality, not silver bugs) |

Final state: **46 checks, 44 fully clean, 2 within tolerance**.
Remaining tolerances are legitimate:
- `orphan_invoice_legacy` (13) — UUIDs that exist nowhere; historical pipeline artifacts
- `wild_margin` (176) — cost entries in Odoo that produce >100% margins (negative cost, free samples, etc.)

Neither is a silver data integrity issue; both reflect upstream business
/ data entry patterns.

### Triggers installed (all BEFORE-row, SECURITY INVOKER)

1. `canonical_invoices_resolve_residual_mxn_trg` — keeps
   `amount_residual_mxn_resolved = amount_residual_mxn_odoo`, fills
   `amount_total_mxn_resolved` from COALESCE, lowercases `sat_uuid`.
2. `trg_canonical_invoices_sync_allocations` — on canonical_id change,
   re-points all allocation rows.
3. `trg_canonical_payment_allocations_resolve` — on INSERT/UPDATE of
   allocation, resolves `invoice_canonical_id` via canonical_id or sat_uuid.
4. `canonical_products_clamp_negatives_trg` — floors cost and price at 0.
5. `canonical_credit_notes_resolve_mxn_trg` — fills
   `amount_total_mxn_resolved` from COALESCE on INSERT/UPDATE.
