# Legacy View Deprecation Plan

**Date:** 2026-04-19
**Sunset target:** 2026-06-01 (30 days post-deploy)
**Supabase project:** tozqezmivpblmcubmnpi

---

## Summary

Seven legacy views in the `public` schema — `cfo_dashboard`, `pl_estado_resultados`, `monthly_revenue_trend`, `cash_position`, `working_capital`, `cash_flow_aging`, and `budget_vs_actual` — now have canonical `analytics_*` aliases created by migrations `20260419_reorg_r1_analytics_aliases.sql` (S1.1) and `20260419_s1_legacy_view_aliases_v2.sql` (S1.2). The legacy names remain live during a 30-day grace window ending **2026-06-01** to give the frontend team time to migrate all TypeScript/TSX call-sites. During this window no views will be dropped. After the sunset date, once TS references are verified at zero, DROP migrations will be scheduled as a separate sprint. Additionally, 21 `v_audit_*` views (costos-audit DQ layer) and 15 `cashflow_*` views (cashflow v3 operational layer) carry non-canonical prefixes; their reclassification is tracked here for a future sprint.

---

## Views with canonical L4 alias

| Legacy view | Canonical alias | Migration file | TS files referencing legacy (not yet migrated) |
|---|---|---|---|
| `cfo_dashboard` | `analytics_finance_cfo_snapshot` | `20260419_reorg_r1_analytics_aliases.sql` | **5 files** — see §TS References |
| `pl_estado_resultados` | `analytics_finance_income_statement` | `20260419_reorg_r1_analytics_aliases.sql` | **7 files** — see §TS References |
| `monthly_revenue_trend` | `analytics_revenue_operational_monthly` | `20260419_reorg_r1_analytics_aliases.sql` | **0 files** — No references found |
| `cash_position` | `analytics_finance_cash_position` | `20260419_reorg_r1_analytics_aliases.sql` | **1 file** — see §TS References |
| `working_capital` | `analytics_finance_working_capital` | `20260419_reorg_r1_analytics_aliases.sql` | **3 files** — see §TS References |
| `cash_flow_aging` | `analytics_ar_aging` | `20260419_reorg_r1_analytics_aliases.sql` (annotated in `20260419_s1_legacy_view_aliases_v2.sql`) | **3 files** — see §TS References |
| `budget_vs_actual` | `analytics_budget_vs_actual` | `20260419_s1_legacy_view_aliases_v2.sql` | **2 files** — see §TS References |

---

## TS code references to legacy views

Each entry lists the TS/TSX files that still call the **legacy** view name directly (not via alias). These are the migration targets.

### `cfo_dashboard` — 5 files

```
src/app/finanzas/page.tsx
src/lib/agents/director-chat-context.ts
src/lib/agents/financiero-context.ts
src/lib/queries/finance.ts
src/lib/queries/purchases.ts
```

### `pl_estado_resultados` — 7 files

```
src/app/finanzas/page.tsx
src/lib/agents/director-chat-context.ts
src/lib/agents/financiero-context.ts
src/lib/queries/finance.ts
src/lib/queries/sales.ts
src/app/page.tsx
src/lib/queries/dashboard.ts
```

### `monthly_revenue_trend` — 0 files

No references found. Likely already migrated or unused in frontend. Confirm via full-repo search before drop.

### `cash_position` — 1 file

```
src/lib/queries/finance.ts
```

### `working_capital` — 3 files

```
src/lib/agents/director-chat-context.ts
src/lib/agents/financiero-context.ts
src/lib/queries/finance.ts
```

### `cash_flow_aging` — 3 files

```
src/lib/queries/invoices.ts
src/lib/queries/companies.ts
src/components/shared/v2/company-link.tsx
```

### `budget_vs_actual` — 2 files

```
src/lib/agents/director-chat-context.ts
src/lib/agents/financiero-context.ts
```

---

## Candidates for consolidation into analytics_customer_360

The following candidates from S1.1 were checked for schema existence:

- `customer_ltv_health` — **does NOT exist** in schema. Skip.
- `company_profile` — **does NOT exist** in schema. Skip.
- `company_narrative` — **does NOT exist** in schema. Skip.

No live views require consolidation into `analytics_customer_360` at this time.

---

## Non-canonical prefix buckets (future migration sprint)

### v_audit_* (21 views) — reclassify to `dq_*`

These views were created for the costos/márgenes audit project. They belong semantically in the DQ layer (currently 5 `dq_*` views). Proposed rename prefix: `dq_audit_<domain>` or collapse into the existing `dq_*` pattern.

| # | Current view name | Proposed dq_* name |
|---|---|---|
| 1 | `v_audit_account_balances_buckets` | `dq_account_balances_buckets` |
| 2 | `v_audit_account_balances_orphan_account` | `dq_account_balances_orphan_account` |
| 3 | `v_audit_account_balances_trial_balance` | `dq_account_balances_trial_balance` |
| 4 | `v_audit_company_leak_invoice_lines` | `dq_company_leak_invoice_lines` |
| 5 | `v_audit_company_leak_order_lines` | `dq_company_leak_order_lines` |
| 6 | `v_audit_deliveries_buckets` | `dq_deliveries_buckets` |
| 7 | `v_audit_deliveries_done_without_date` | `dq_deliveries_done_without_date` |
| 8 | `v_audit_deliveries_orphan_partner` | `dq_deliveries_orphan_partner` |
| 9 | `v_audit_invoice_lines_buckets` | `dq_invoice_lines_buckets` |
| 10 | `v_audit_invoice_lines_fx_present` | `dq_invoice_lines_fx_present` |
| 11 | `v_audit_invoice_lines_fx_sanity` | `dq_invoice_lines_fx_sanity` |
| 12 | `v_audit_invoice_lines_price_recompute` | `dq_invoice_lines_price_recompute` |
| 13 | `v_audit_invoice_lines_reversal_sign` | `dq_invoice_lines_reversal_sign` |
| 14 | `v_audit_manufacturing_buckets` | `dq_manufacturing_buckets` |
| 15 | `v_audit_order_lines_buckets` | `dq_order_lines_buckets` |
| 16 | `v_audit_order_lines_orphan_product` | `dq_order_lines_orphan_product` |
| 17 | `v_audit_order_lines_orphan_purchase` | `dq_order_lines_orphan_purchase` |
| 18 | `v_audit_order_lines_orphan_sale` | `dq_order_lines_orphan_sale` |
| 19 | `v_audit_products_duplicate_default_code` | `dq_products_duplicate_default_code` |
| 20 | `v_audit_products_null_standard_price` | `dq_products_null_standard_price` |
| 21 | `v_audit_products_null_uom` | `dq_products_null_uom` |

**Action:** Create `analytics_*`/`dq_*` aliases first (non-destructive), then schedule DROP of `v_audit_*` in a future sprint. Confirm no TS/Python references before dropping.

### cashflow_* (15 views) — reclassify to `analytics_cashflow_*` or `analytics_finance_cashflow_*`

These views belong to the cashflow v3 operational layer. Proposed prefix: `analytics_finance_cashflow_<name>` for finance-specific cashflow views.

| # | Current view name | Proposed analytics_* name |
|---|---|---|
| 1 | `cashflow_ap_negotiate` | `analytics_finance_cashflow_ap_negotiate` |
| 2 | `cashflow_ap_predicted` | `analytics_finance_cashflow_ap_predicted` |
| 3 | `cashflow_ar_acelerate` | `analytics_finance_cashflow_ar_accelerate` |
| 4 | `cashflow_ar_predicted` | `analytics_finance_cashflow_ar_predicted` |
| 5 | `cashflow_company_behavior` | `analytics_finance_cashflow_company_behavior` |
| 6 | `cashflow_current_cash` | `analytics_finance_cashflow_current_cash` |
| 7 | `cashflow_in_transit` | `analytics_finance_cashflow_in_transit` |
| 8 | `cashflow_liquidity_metrics` | `analytics_finance_cashflow_liquidity_metrics` |
| 9 | `cashflow_opex_monthly` | `analytics_finance_cashflow_opex_monthly` |
| 10 | `cashflow_payroll_monthly` | `analytics_finance_cashflow_payroll_monthly` |
| 11 | `cashflow_po_backlog` | `analytics_finance_cashflow_po_backlog` |
| 12 | `cashflow_recurring_detail` | `analytics_finance_cashflow_recurring_detail` |
| 13 | `cashflow_so_backlog` | `analytics_finance_cashflow_so_backlog` |
| 14 | `cashflow_tax_monthly` | `analytics_finance_cashflow_tax_monthly` |
| 15 | `cashflow_unreconciled` | `analytics_finance_cashflow_unreconciled` |

**Action:** Create `analytics_finance_cashflow_*` aliases first, update frontend references, then schedule DROP of `cashflow_*` originals.

---

## Action plan

| Date | Action |
|---|---|
| **2026-04-19** | Aliases deployed (S1.1 + S1.2). Grace window starts. Legacy views remain live. |
| **2026-04-19 → 2026-05-20** | Frontend migration: replace legacy view names with `analytics_*` aliases in all TS/TSX files identified above. Priority order: `pl_estado_resultados` (7 files) → `cfo_dashboard` (5 files) → `cash_flow_aging` / `working_capital` (3 files each) → `budget_vs_actual` (2 files) → `cash_position` (1 file). |
| **2026-05-20 → 2026-05-30** | Verify zero remaining TS references. Re-run grep suite. Fix any missed call-sites. |
| **2026-06-01** | Sunset date. Confirm all 7 legacy views have 0 TS references before proceeding. |
| **Post-2026-06-01** | Schedule DROP migrations (separate sprint — NOT in this document). |
| **Future sprint** | Create `dq_*` aliases for 21 `v_audit_*` views, then drop originals. |
| **Future sprint** | Create `analytics_finance_cashflow_*` aliases for 15 `cashflow_*` views, update frontend, then drop originals. |

---

## Drop candidates post-sunset

**NOT to be executed now.** After 2026-06-01 and after confirming 0 TS references per view, schedule the following DROP migrations:

```sql
-- Only execute after verifying 0 references in production TS/TSX code
DROP VIEW IF EXISTS cfo_dashboard;            -- aliased → analytics_finance_cfo_snapshot
DROP VIEW IF EXISTS pl_estado_resultados;     -- aliased → analytics_finance_income_statement
DROP VIEW IF EXISTS monthly_revenue_trend;    -- aliased → analytics_revenue_operational_monthly
DROP VIEW IF EXISTS cash_position;            -- aliased → analytics_finance_cash_position
DROP VIEW IF EXISTS working_capital;          -- aliased → analytics_finance_working_capital
DROP VIEW IF EXISTS cash_flow_aging;          -- aliased → analytics_ar_aging
DROP VIEW IF EXISTS budget_vs_actual;         -- aliased → analytics_budget_vs_actual
```

Each DROP should be a standalone timestamped migration with a corresponding TS reference grep in the PR description confirming 0 hits.

---

## Verification grep commands

Re-run these before scheduling any DROP to confirm 0 references:

```bash
# All 7 legacy views at once
grep -rln "\bcfo_dashboard\b\|\bpl_estado_resultados\b\|\bmonthly_revenue_trend\b\|\bcash_position\b\|\bworking_capital\b\|\bcash_flow_aging\b\|\bbudget_vs_actual\b" src --include="*.ts" --include="*.tsx"

# Per-view (for PR descriptions)
grep -rln "\bcfo_dashboard\b" src --include="*.ts" --include="*.tsx"
grep -rln "\bpl_estado_resultados\b" src --include="*.ts" --include="*.tsx"
grep -rln "\bmonthly_revenue_trend\b" src --include="*.ts" --include="*.tsx"
grep -rln "\bcash_position\b" src --include="*.ts" --include="*.tsx"
grep -rln "\bworking_capital\b" src --include="*.ts" --include="*.tsx"
grep -rln "\bcash_flow_aging\b" src --include="*.ts" --include="*.tsx"
grep -rln "\bbudget_vs_actual\b" src --include="*.ts" --include="*.tsx"
```
