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
