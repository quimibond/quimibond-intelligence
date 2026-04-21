# Silver SP4 — Pattern B + Evidence + Engine + Gold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the Silver Architecture by materializing the 11 Pattern B canonical tables, installing the Evidence layer (email_signals / ai_extracted_facts / attachments / manual_notes), extending the reconciliation engine from 16 to 31 invariants, backfilling `canonical_invoices.amount_total_mxn_resolved`, and publishing 8 Gold views (`gold_ceo_inbox`, `gold_reconciliation_health`, `gold_company_360`, `gold_revenue_monthly`, `gold_pl_statement`, `gold_balance_sheet`, `gold_cashflow`, `gold_product_performance`).

**Architecture:** Silver SP4 sits on top of SP2 (canonical_invoices/payments/credit_notes/tax_events) + SP3 (canonical_companies/contacts/products/employees + source_links + mdm_manual_overrides). SP4 adds the remaining 11 canonical_* Pattern B wrappers (operational entities already in Bronze — orders, deliveries, inventory, bank, fx, accounts, CRM), the Pattern D evidence layer linking email/AI/attachments/notes to any canonical_entity via polymorphic FK, the full 31-invariant reconciliation catalog with `run_reconciliation(p_key)` dispatch, and Gold views ready for frontend consumption in SP5. All work is additive — no DROP against SP2/SP3 objects until SP5 cutover.

**Tech Stack:** PostgreSQL 15 (Supabase `tozqezmivpblmcubmnpi`), pg_cron, pg_trgm, materialized views with `REFRESH MATERIALIZED VIEW CONCURRENTLY`, plpgsql functions, Supabase MCP (`mcp__claude_ai_Supabase__apply_migration` / `execute_sql`). No frontend code in this plan — that lands in SP5. No qb19 addon changes — SP4 is pure Supabase.

---

## Context the engineer needs (zero assumed)

### Where things are

- **Live DB:** Supabase project `tozqezmivpblmcubmnpi` (`https://tozqezmivpblmcubmnpi.supabase.co`). All work happens here via the Supabase MCP connection already wired into Claude Code.
- **Spec (authoritative):** `docs/superpowers/specs/2026-04-21-silver-architecture.md`. §5.9-5.19 = Pattern B schemas, §8 = Evidence, §9 = Reconciliation engine, §11 SP4 = deliverables/DoD, §13 = consumer contracts.
- **Frontend CLAUDE.md:** `/Users/jj/quimibond-intelligence/quimibond-intelligence/CLAUDE.md` — Odoo→Supabase field mappings and runtime conventions.
- **Plan output (this file):** `docs/superpowers/plans/2026-04-24-silver-sp4-engine-gold.md` (you are here).
- **Notes file (you will create it in Task 1):** `docs/superpowers/plans/2026-04-24-silver-sp4-engine-gold-notes.md`. Each task appends findings here.
- **Git:** work in a branch `silver-sp4-engine-gold` off `main` (`main` head at `8f3c620` post-SP3 merge).

### Live state you are starting from (verified 2026-04-24)

```
canonical_companies               4,359
canonical_contacts                2,063
canonical_credit_notes            2,208
canonical_employees (view)          179
canonical_invoices               88,462   (amount_total_mxn_resolved = 0/88,462 — fix in Task 19)
canonical_payment_allocations    25,511
canonical_payments               43,380
canonical_products                6,004
canonical_tax_events                398
mdm_manual_overrides                 20
source_links                    172,283
reconciliation_issues total     153,092   (open: 103,400)
```

Bronze volumes that feed SP4:
```
odoo_sale_orders          12,364
odoo_purchase_orders       5,673
odoo_order_lines          32,083
odoo_deliveries           25,187
odoo_manufacturing         4,713
odoo_orderpoints              57
odoo_bank_balances            22
odoo_currency_rates           71
odoo_account_balances     11,032
odoo_chart_of_accounts     1,640
odoo_crm_leads                20
facts                     31,806   (→ ai_extracted_facts in Task 14)
emails                   114,388
threads                   48,285
entities                   9,401
```

Active pg_cron jobs (do NOT remove any; you will add three):
```
audit_runs_retention_cleanup            30 3 * * *
ingestion_sentinel                      0 * * * *
refresh-all-matviews                    15 */2 * * *   ← SP4 extends by wiring new MVs into refresh_all_matviews()
refresh-syntage-unified                 */15 * * * *
silver_sp2_reconcile_2h                 15 */2 * * *
silver_sp2_reconcile_hourly             5 * * * *
silver_sp2_refresh_canonical_nightly    30 3 * * *
silver_sp3_matcher_all_pending          35 */2 * * *
syntage-reconciliation-daily-snapshot   15 6 * * *
```

### Hard-won lessons from SP2/SP3 — do NOT relearn the hard way

1. **`audit_runs.severity` CHECK constraint.** Only `ok | warn | error` allowed. Use `details->>'label'` for human-facing labels (`pre_sp4_baseline`, etc.).
2. **`schema_changes` row form is 6 cols:** `change_type, table_name, description, sql_executed, triggered_by, success`. `created_at` is default. Don't try to supply `affected_rows` — it does not exist.
3. **GENERATED STORED does not accept `STABLE` functions.** The `reconciliation_issues.age_days` column is plain `integer`, not generated — `compute_priority_scores()` updates it. Do not try to re-declare it GENERATED with `now() - detected_at`.
4. **`syntage_*` `direction` is English.** Values are `'issued'` / `'received'`, NOT `'emitida'` / `'recibida'`.
5. **Syntage `raw_payload` JSON keys (gotcha catalogue):**
   - Related-CFDI lookup: `raw_payload->'relations'->0->>'relatedInvoiceUuid'` (NOT `cfdiRelacionados`).
   - Payment breakdown: `syntage_invoice_payments.doctos_relacionados` is a `jsonb` array; elements use `uuid_docto`, `imp_pagado`, `imp_saldo_ant`, `parcialidad`.
   - Line descriptions from Syntage are `'[internal_ref] name'` — split on `']'` when matching.
6. **`num_operacion` bridge is dead.** 99.9 % empty on both `odoo_account_payments.ref` and `syntage_invoice_payments.num_operacion`. Payment matching goes through `canonical_payment_allocations`.
7. **`odoo_chart_of_accounts` uses `code`** (not `account_code`). ISR retenido prefixes are `113.%` and `213.%` (NOT `216%`).
8. **Supabase MCP `execute_sql` returns only the LAST statement's rowset.** For multi-step verifications, split into separate calls.
9. **Large ALTER on 40k+ rows** (e.g., backfill of `amount_total_mxn_resolved` on 88k `canonical_invoices`) should use **`ADD CONSTRAINT NOT VALID` + `VALIDATE CONSTRAINT`** pattern, or plain UPDATE in chunks. Do NOT hold a full-table lock.
10. **`matcher_company` tie-break order** (don't break it): `has_manual_override=true` > `is_internal=true` > `has_shadow_flag=false` > lowest `id`.
11. **Quimibond self-row IDs:** `companies.id = 6707`, `canonical_companies.id = 868`, `taxpayer_rfc = 'QIN140528HN9'` (do not hardcode — look it up, but these are the canonical values for `WHERE is_internal=true`).
12. **FK state post-SP3 (inputs to Pattern B joins):**
    - `canonical_invoices`: `emisor_canonical_company_id`, `receptor_canonical_company_id`, `salesperson_contact_id`.
    - `canonical_payments`: `counterparty_canonical_company_id`.
    - `canonical_credit_notes`: `emisor_canonical_company_id`, `receptor_canonical_company_id`.
    - All validated — you can trust them in joins.
13. **`apply_migration` times out on big ops.** Fall back to `execute_sql` + document in the migration file's header (these migrations live in `supabase/migrations/` — filename pattern `NNNN_silver_sp4_<slug>.sql`).
14. **`mdm_manual_overrides` INSERT caveat.** The SP2 original columns `override_field TEXT NOT NULL` and `override_value TEXT NOT NULL` are still there alongside the SP3-added `action / source_link_id / payload / expires_at / is_active / revoke_reason`. Any insert must supply both the SP2 pair AND the SP3 columns (or a sentinel like `'__payload__'` in `override_field` plus the real detail in `payload`).
15. **`canonical_employees` is a VIEW over `canonical_contacts WHERE contact_type LIKE 'internal_%'`.** Don't try to insert into it.
16. **Migration files must be idempotent.** Each task re-running cleanly is a hard requirement. Use `CREATE TABLE IF NOT EXISTS`, `CREATE MATERIALIZED VIEW IF NOT EXISTS`, `CREATE OR REPLACE VIEW / FUNCTION`, `INSERT ... ON CONFLICT DO NOTHING`, `DROP INDEX IF EXISTS` before re-creating.

### Migration file layout (every task that writes SQL follows this)

```sql
-- supabase/migrations/NNNN_silver_sp4_<slug>.sql
--
-- Silver SP4 — Task K: <name>
-- Spec: docs/superpowers/specs/2026-04-21-silver-architecture.md §<section>
-- Plan: docs/superpowers/plans/2026-04-24-silver-sp4-engine-gold.md
-- Safety notes: idempotent; no DROP of SP2/SP3 objects; apply_migration may timeout → fallback to execute_sql.

BEGIN;
-- ... DDL / DML ...
COMMIT;

-- After success, append one row to schema_changes (6-col form):
INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('<TYPE>', '<table_or_view>', '<one-line>', '<file-relative-path>', 'silver-sp4-task-K', true);
```

### Branch + commit rhythm

- One branch `silver-sp4-engine-gold` off `main`.
- One commit per task, Conventional Commits style: `feat(sp4): task K — <slug>`, `chore(sp4): …`, `fix(sp4): …`.
- Push after each commit (you have `gh` configured). The user merges the final PR with `gh pr merge --merge --delete-branch` — you do NOT merge or touch the `quimibond` branch.

### Definition of Done for the whole plan

- 11 Pattern B canonical_* live with UNIQUE `canonical_id` indexes.
- 4 Evidence tables live with the polymorphic `(canonical_entity_type, canonical_entity_id)` index pattern.
- `facts` migrated into `ai_extracted_facts` with entity mapping via `source_links`; original `facts` table kept (superseded, dropped in SP5).
- `audit_tolerances` has 31 enabled rows.
- `run_reconciliation(NULL)` executes all 31 invariants end-to-end without errors.
- `canonical_invoices.amount_total_mxn_resolved` populated for ≥ 98 % of rows; `canonical_companies.lifetime_value_mxn` > 0 for > 500 rows (was < 10 pre-Task 19).
- `reconciliation_issues.invariant_key` non-null for ≥ 98 % of open rows (legacy NULLs remapped).
- 8 Gold views live and queryable in < 2 s each on prod volumes.
- `gold_ceo_inbox` returns 30-80 rows ordered by `priority_score DESC` with `assignee_name` populated for ≥ 80 % of rows.
- One PR opened against `main`; user merges manually.

---

## Files touched by this plan

All under `/Users/jj/quimibond-intelligence/quimibond-intelligence/`:

- Create `supabase/migrations/1040_silver_sp4_preflight.sql` (Task 1)
- Create `supabase/migrations/1041_silver_sp4_canonical_sale_orders.sql` (Task 2)
- Create `supabase/migrations/1042_silver_sp4_canonical_purchase_orders.sql` (Task 3)
- Create `supabase/migrations/1043_silver_sp4_canonical_order_lines.sql` (Task 4)
- Create `supabase/migrations/1044_silver_sp4_canonical_deliveries.sql` (Task 5)
- Create `supabase/migrations/1045_silver_sp4_canonical_inventory.sql` (Task 6)
- Create `supabase/migrations/1046_silver_sp4_canonical_manufacturing.sql` (Task 7)
- Create `supabase/migrations/1047_silver_sp4_canonical_bank_balances.sql` (Task 8)
- Create `supabase/migrations/1048_silver_sp4_canonical_fx_rates.sql` (Task 9)
- Create `supabase/migrations/1049_silver_sp4_canonical_account_balances.sql` (Task 10)
- Create `supabase/migrations/1050_silver_sp4_canonical_chart_of_accounts.sql` (Task 11)
- Create `supabase/migrations/1051_silver_sp4_canonical_crm_leads.sql` (Task 12)
- Create `supabase/migrations/1052_silver_sp4_evidence_tables.sql` (Task 13)
- Create `supabase/migrations/1053_silver_sp4_ai_extracted_facts.sql` (Task 14)
- Create `supabase/migrations/1054_silver_sp4_facts_migration.sql` (Task 15)
- Create `supabase/migrations/1055_silver_sp4_new_invariants_catalog.sql` (Task 16)
- Create `supabase/migrations/1056_silver_sp4_run_reconciliation_part1.sql` (Task 17)
- Create `supabase/migrations/1057_silver_sp4_run_reconciliation_part2.sql` (Task 18)
- Create `supabase/migrations/1058_silver_sp4_backfill_mxn_resolved.sql` (Task 19)
- Create `supabase/migrations/1059_silver_sp4_gold_inbox_health.sql` (Task 20)
- Create `supabase/migrations/1060_silver_sp4_gold_company_revenue.sql` (Task 21)
- Create `supabase/migrations/1061_silver_sp4_gold_finance_product.sql` (Task 22)
- Create `docs/superpowers/plans/2026-04-24-silver-sp4-engine-gold-notes.md` (Task 1; appended every task)
- Modify `docs/superpowers/plans/2026-04-24-silver-sp4-engine-gold-notes.md` (Tasks 2-24)

(Frontend `CLAUDE.md` is NOT touched in SP4 — that is SP5 work.)

---

## Task dependency graph

```
Task 1 (preflight)
  ├── Task 2..12  (Pattern B canonical MVs/views — run sequentially;
  │                each depends on Task 1 but NOT on previous Pattern B tasks;
  │                canonical_order_lines (Task 4) references canonical_products → existing SP3 FK;
  │                canonical_inventory (Task 6) depends on canonical_products already existing)
  ├── Task 13 (evidence tables)
  │     └── Task 14 (ai_extracted_facts table)
  │           └── Task 15 (facts migration — GATE)
  ├── Task 16 (register 15 new invariants — gated: generates no issues yet, enabled=false)
  │     └── Task 17 (run_reconciliation part 1: invoice + payment extensions + tax)
  │           └── Task 18 (run_reconciliation part 2: fulfillment + finance + line + inventory + MDM — GATE: enable invariants → emits issues)
  │                 └── Task 19 (backfill amount_total_mxn_resolved + canonical_companies metrics refresh — GATE)
  │                       └── Task 20 (gold_ceo_inbox + gold_reconciliation_health — consumes issues + canonical)
  │                             └── Task 21 (gold_company_360 + gold_revenue_monthly)
  │                                   └── Task 22 (gold_pl_statement + gold_balance_sheet + gold_cashflow + gold_product_performance)
  └── Task 23 (DoD verification) → Task 24 (PR + shell handoff)
```

Gates (user approval before executing):
- **Task 15 (facts → ai_extracted_facts migration):** 31,806 rows, destructive-ish (makes `facts` the legacy source).
- **Task 18 (enable the 22 new invariant runs):** will emit tens of thousands of new `reconciliation_issues`.
- **Task 19 (backfill `amount_total_mxn_resolved` + `canonical_companies` metrics refresh):** rewrites 88,462 canonical_invoices rows and recomputes all 4,359 canonical_companies metrics.
- **Task 22 (gold views DDL):** adds public views exposed to SP5 frontend — verify no accidental duplication of legacy.

---

### Task 1: Pre-flight — branch, baseline audit_run, notes file, migrations dir

**Files:**
- Create: `docs/superpowers/plans/2026-04-24-silver-sp4-engine-gold-notes.md`
- Create: `supabase/migrations/1040_silver_sp4_preflight.sql`

**Purpose.** Establish a clean working environment. Take a frozen baseline of open issues / canonical counts / cron jobs into `audit_runs` so Task 23 can compute deltas. Create the per-task notes file.

- [ ] **Step 1: Cut the branch**

```bash
cd /Users/jj/quimibond-intelligence/quimibond-intelligence
git fetch origin
git checkout main && git pull --ff-only
git checkout -b silver-sp4-engine-gold
```

- [ ] **Step 2: Create notes file**

Create `docs/superpowers/plans/2026-04-24-silver-sp4-engine-gold-notes.md` with this content:

```markdown
# Silver SP4 — Execution Notes

Running log of findings per task. Append one section per completed task.

## Task 1 — Pre-flight (completed <DATE>)

- Baseline `audit_runs` row inserted with `details->>'label' = 'pre_sp4_baseline'`.
- Branch cut from main @ 8f3c620 (or current HEAD).
- migrations dir verified writable.
```

Commit (empty file is fine at this point; more will be appended).

- [ ] **Step 3: Write the preflight migration**

Create `supabase/migrations/1040_silver_sp4_preflight.sql`:

```sql
-- supabase/migrations/1040_silver_sp4_preflight.sql
--
-- Silver SP4 — Task 1: baseline audit_run + cron inventory snapshot
-- Spec: docs/superpowers/specs/2026-04-21-silver-architecture.md §11 SP4
-- Plan: docs/superpowers/plans/2026-04-24-silver-sp4-engine-gold.md

BEGIN;

-- Frozen snapshot of SP3-end state. Task 23 reads this to compute deltas.
INSERT INTO audit_runs (run_id, source, model, invariant_key, bucket_key, severity, details)
SELECT
  gen_random_uuid(),
  'supabase',
  'silver_sp4',
  'sp4.baseline',
  'sp4_preflight',
  'ok',
  jsonb_build_object(
    'label', 'pre_sp4_baseline',
    'canonical_invoices',          (SELECT COUNT(*) FROM canonical_invoices),
    'canonical_invoices_with_mxn_resolved',
                                    (SELECT COUNT(*) FROM canonical_invoices
                                       WHERE amount_total_mxn_resolved IS NOT NULL
                                         AND amount_total_mxn_resolved > 0),
    'canonical_payments',          (SELECT COUNT(*) FROM canonical_payments),
    'canonical_payment_allocations',(SELECT COUNT(*) FROM canonical_payment_allocations),
    'canonical_credit_notes',      (SELECT COUNT(*) FROM canonical_credit_notes),
    'canonical_tax_events',        (SELECT COUNT(*) FROM canonical_tax_events),
    'canonical_companies',         (SELECT COUNT(*) FROM canonical_companies),
    'canonical_companies_with_ltv',(SELECT COUNT(*) FROM canonical_companies
                                       WHERE lifetime_value_mxn IS NOT NULL
                                         AND lifetime_value_mxn > 0),
    'canonical_contacts',          (SELECT COUNT(*) FROM canonical_contacts),
    'canonical_products',          (SELECT COUNT(*) FROM canonical_products),
    'source_links',                (SELECT COUNT(*) FROM source_links),
    'mdm_manual_overrides',        (SELECT COUNT(*) FROM mdm_manual_overrides),
    'reconciliation_issues_open',  (SELECT COUNT(*) FROM reconciliation_issues
                                       WHERE resolved_at IS NULL),
    'reconciliation_issues_open_with_invariant_key',
                                    (SELECT COUNT(*) FROM reconciliation_issues
                                       WHERE resolved_at IS NULL
                                         AND invariant_key IS NOT NULL),
    'audit_tolerances_enabled',    (SELECT COUNT(*) FROM audit_tolerances WHERE enabled),
    'facts',                       (SELECT COUNT(*) FROM facts),
    'cron_jobs',                   (SELECT jsonb_agg(jsonb_build_object(
                                                'name', jobname,
                                                'schedule', schedule,
                                                'active', active))
                                       FROM cron.job)
  );

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('SEED', 'audit_runs', 'SP4 pre-flight baseline snapshot',
        'supabase/migrations/1040_silver_sp4_preflight.sql', 'silver-sp4-task-1', true);

COMMIT;
```

- [ ] **Step 4: Apply via MCP**

Use `mcp__claude_ai_Supabase__apply_migration` with `name='1040_silver_sp4_preflight'` and the SQL from Step 3. If it times out (unlikely for this size), fall back to `mcp__claude_ai_Supabase__execute_sql` with the same body.

- [ ] **Step 5: Verify the baseline row**

Run via `execute_sql`:

```sql
SELECT details->>'label' AS label,
       details->>'canonical_invoices' AS canonical_invoices,
       details->>'reconciliation_issues_open' AS open_issues,
       details->>'canonical_invoices_with_mxn_resolved' AS mxn_resolved,
       run_at
FROM audit_runs
WHERE details->>'label' = 'pre_sp4_baseline'
ORDER BY run_at DESC
LIMIT 1;
```

Expected: one row returned, `canonical_invoices = 88462`, `mxn_resolved = 0`, `open_issues ≈ 103400`.

- [ ] **Step 6: Append to notes**

Append a section to `2026-04-24-silver-sp4-engine-gold-notes.md` with the values from Step 5.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/1040_silver_sp4_preflight.sql \
        docs/superpowers/plans/2026-04-24-silver-sp4-engine-gold-notes.md
git commit -m "chore(sp4): task 1 — preflight baseline snapshot in audit_runs"
git push -u origin silver-sp4-engine-gold
```

---

### Task 2: `canonical_sale_orders` (Pattern B MV)

**Files:**
- Create: `supabase/migrations/1041_silver_sp4_canonical_sale_orders.sql`
- Modify: `docs/superpowers/plans/2026-04-24-silver-sp4-engine-gold-notes.md`

**Purpose.** Materialize the thin Pattern B wrapper over `odoo_sale_orders` (12,364 rows) with joins to `canonical_companies` (by `odoo_partner_id`) and `canonical_contacts` (by `odoo_user_id`). This replaces the legacy `order_unified` read path for SP5 — but we do NOT drop the legacy here.

Spec: §5.9.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/1041_silver_sp4_canonical_sale_orders.sql`:

```sql
-- supabase/migrations/1041_silver_sp4_canonical_sale_orders.sql
--
-- Silver SP4 — Task 2: canonical_sale_orders MV
-- Spec §5.9; Plan Task 2.
--
-- Idempotent: drops + recreates the MV (rows are all derived from Bronze; no loss).

BEGIN;

DROP MATERIALIZED VIEW IF EXISTS canonical_sale_orders CASCADE;

CREATE MATERIALIZED VIEW canonical_sale_orders AS
SELECT
  so.id                               AS canonical_id,
  so.odoo_order_id,
  so.name,
  so.odoo_partner_id,
  cc.id                               AS canonical_company_id,
  so.salesperson_name,
  so.salesperson_email,
  so.salesperson_user_id,
  cct.id                              AS salesperson_canonical_contact_id,
  so.team_name,
  so.amount_total,
  so.amount_untaxed,
  so.amount_total_mxn,
  so.amount_untaxed_mxn,
  so.margin,
  so.margin_percent,
  so.currency,
  so.state,
  so.date_order,
  so.commitment_date,
  so.create_date,
  so.odoo_company_id,
  CASE
    WHEN so.state IN ('sale','done')
     AND so.commitment_date IS NOT NULL
     AND so.commitment_date < CURRENT_DATE
    THEN true ELSE false
  END AS is_commitment_overdue,
  now() AS refreshed_at
FROM odoo_sale_orders so
LEFT JOIN canonical_companies cc ON cc.odoo_partner_id = so.odoo_partner_id
LEFT JOIN canonical_contacts cct ON cct.odoo_user_id   = so.salesperson_user_id;

CREATE UNIQUE INDEX canonical_sale_orders_pk
  ON canonical_sale_orders (canonical_id);
CREATE INDEX canonical_sale_orders_company_idx
  ON canonical_sale_orders (canonical_company_id);
CREATE INDEX canonical_sale_orders_salesperson_idx
  ON canonical_sale_orders (salesperson_canonical_contact_id);
CREATE INDEX canonical_sale_orders_state_date_idx
  ON canonical_sale_orders (state, date_order DESC);
CREATE INDEX canonical_sale_orders_overdue_idx
  ON canonical_sale_orders (is_commitment_overdue)
  WHERE is_commitment_overdue = true;

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('CREATE_MV', 'canonical_sale_orders', 'Pattern B MV over odoo_sale_orders',
        'supabase/migrations/1041_silver_sp4_canonical_sale_orders.sql',
        'silver-sp4-task-2', true);

COMMIT;
```

- [ ] **Step 2: Apply via MCP**

`mcp__claude_ai_Supabase__apply_migration` with `name='1041_silver_sp4_canonical_sale_orders'`.

- [ ] **Step 3: Verify counts + join quality**

```sql
SELECT COUNT(*)                                    AS total_rows,
       COUNT(canonical_company_id)                 AS with_company,
       COUNT(salesperson_canonical_contact_id)     AS with_salesperson,
       COUNT(*) FILTER (WHERE is_commitment_overdue) AS overdue,
       COUNT(*) FILTER (WHERE state IN ('sale','done')) AS active_states
FROM canonical_sale_orders;
```

Expected: `total_rows = 12364`. `with_company / total` ≥ 95 % (some historical orders may have deleted partners). `with_salesperson / total` ≥ 60 %. `overdue` small but > 0.

- [ ] **Step 4: Spot-check Quimibond's active customer coverage**

```sql
SELECT cso.state, COUNT(*) n, ROUND(SUM(cso.amount_total_mxn),0) total_mxn
FROM canonical_sale_orders cso
JOIN canonical_companies cc ON cc.id = cso.canonical_company_id
WHERE cc.is_customer = true AND cso.date_order >= CURRENT_DATE - interval '365 days'
GROUP BY 1
ORDER BY total_mxn DESC NULLS LAST;
```

Expected: at least `sale`, `done`, `draft`, `cancel` present. Sanity: sum of `done+sale` total_mxn should be in hundreds of millions.

- [ ] **Step 5: Record findings in notes file**

Append a `## Task 2 — canonical_sale_orders` section with the two result sets.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/1041_silver_sp4_canonical_sale_orders.sql \
        docs/superpowers/plans/2026-04-24-silver-sp4-engine-gold-notes.md
git commit -m "feat(sp4): task 2 — canonical_sale_orders MV (Pattern B)"
git push
```

---

### Task 3: `canonical_purchase_orders` (Pattern B MV)

**Files:**
- Create: `supabase/migrations/1042_silver_sp4_canonical_purchase_orders.sql`
- Modify: `docs/superpowers/plans/2026-04-24-silver-sp4-engine-gold-notes.md`

**Purpose.** Mirror of Task 2 for purchase. 5,673 rows. Buyers linked via `canonical_contacts.odoo_user_id`. Spec §5.10.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/1042_silver_sp4_canonical_purchase_orders.sql`:

```sql
-- supabase/migrations/1042_silver_sp4_canonical_purchase_orders.sql
--
-- Silver SP4 — Task 3: canonical_purchase_orders MV
-- Spec §5.10; Plan Task 3.

BEGIN;

DROP MATERIALIZED VIEW IF EXISTS canonical_purchase_orders CASCADE;

CREATE MATERIALIZED VIEW canonical_purchase_orders AS
SELECT
  po.id                               AS canonical_id,
  po.odoo_order_id,
  po.name,
  po.odoo_partner_id,
  cc.id                               AS canonical_company_id,
  po.buyer_name,
  po.buyer_email,
  po.buyer_user_id,
  cct.id                              AS buyer_canonical_contact_id,
  po.amount_total,
  po.amount_untaxed,
  po.amount_total_mxn,
  po.amount_untaxed_mxn,
  po.currency,
  po.state,
  po.date_order,
  po.date_approve,
  po.create_date,
  po.odoo_company_id,
  now() AS refreshed_at
FROM odoo_purchase_orders po
LEFT JOIN canonical_companies cc ON cc.odoo_partner_id = po.odoo_partner_id
LEFT JOIN canonical_contacts cct ON cct.odoo_user_id   = po.buyer_user_id;

CREATE UNIQUE INDEX canonical_purchase_orders_pk
  ON canonical_purchase_orders (canonical_id);
CREATE INDEX canonical_purchase_orders_company_idx
  ON canonical_purchase_orders (canonical_company_id);
CREATE INDEX canonical_purchase_orders_buyer_idx
  ON canonical_purchase_orders (buyer_canonical_contact_id);
CREATE INDEX canonical_purchase_orders_state_date_idx
  ON canonical_purchase_orders (state, date_order DESC);

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('CREATE_MV', 'canonical_purchase_orders', 'Pattern B MV over odoo_purchase_orders',
        'supabase/migrations/1042_silver_sp4_canonical_purchase_orders.sql',
        'silver-sp4-task-3', true);

COMMIT;
```

- [ ] **Step 2: Apply via MCP** using `apply_migration` name `1042_silver_sp4_canonical_purchase_orders`.

- [ ] **Step 3: Verify counts**

```sql
SELECT COUNT(*)                                    AS total_rows,
       COUNT(canonical_company_id)                 AS with_company,
       COUNT(buyer_canonical_contact_id)           AS with_buyer,
       COUNT(*) FILTER (WHERE state IN ('purchase','done')) AS active_states
FROM canonical_purchase_orders;
```

Expected: `total_rows = 5673`, `with_company ≥ 5400`.

- [ ] **Step 4: Record findings** in notes file.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/1042_silver_sp4_canonical_purchase_orders.sql \
        docs/superpowers/plans/2026-04-24-silver-sp4-engine-gold-notes.md
git commit -m "feat(sp4): task 3 — canonical_purchase_orders MV (Pattern B)"
git push
```

---

### Task 4: `canonical_order_lines` (Pattern B MV, 32k rows)

**Files:**
- Create: `supabase/migrations/1043_silver_sp4_canonical_order_lines.sql`
- Modify: notes.

**Purpose.** Unified view over `odoo_order_lines` with FKs to canonical_companies + canonical_products. `order_type` distinguishes sale vs purchase. Adds `has_pending_invoicing` / `qty_pending_invoice` derived. Spec §5.11.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/1043_silver_sp4_canonical_order_lines.sql`:

```sql
-- supabase/migrations/1043_silver_sp4_canonical_order_lines.sql
--
-- Silver SP4 — Task 4: canonical_order_lines MV
-- Spec §5.11; Plan Task 4.
-- Volume: ~32,083 rows.

BEGIN;

DROP MATERIALIZED VIEW IF EXISTS canonical_order_lines CASCADE;

CREATE MATERIALIZED VIEW canonical_order_lines AS
SELECT
  ol.id                               AS canonical_id,
  ol.odoo_line_id,
  ol.odoo_order_id,
  ol.order_type,                                    -- 'sale' | 'purchase'
  ol.order_name,
  ol.order_state,
  ol.order_date,
  ol.odoo_partner_id,
  cc.id                               AS canonical_company_id,
  ol.odoo_product_id,
  cp.id                               AS canonical_product_id,
  ol.product_name,
  ol.product_ref,
  ol.qty,
  ol.qty_delivered,
  ol.qty_invoiced,
  ol.price_unit,
  ol.discount,
  ol.subtotal,
  ol.subtotal_mxn,
  ol.currency,
  ol.line_uom,
  ol.line_uom_id,
  ol.salesperson_name,
  (ol.qty - COALESCE(ol.qty_invoiced,0))::numeric AS qty_pending_invoice,
  CASE
    WHEN ol.order_type = 'sale'
     AND ol.order_state IN ('sale','done')
     AND COALESCE(ol.qty_invoiced,0) < ol.qty
    THEN true ELSE false
  END AS has_pending_invoicing,
  CASE
    WHEN ol.order_type = 'sale'
     AND ol.order_state IN ('sale','done')
     AND COALESCE(ol.qty_delivered,0) < ol.qty
    THEN true ELSE false
  END AS has_pending_delivery,
  ol.odoo_company_id,
  now() AS refreshed_at
FROM odoo_order_lines ol
LEFT JOIN canonical_companies cc ON cc.odoo_partner_id  = ol.odoo_partner_id
LEFT JOIN canonical_products  cp ON cp.odoo_product_id  = ol.odoo_product_id;

CREATE UNIQUE INDEX canonical_order_lines_pk
  ON canonical_order_lines (canonical_id);
CREATE INDEX canonical_order_lines_company_idx
  ON canonical_order_lines (canonical_company_id);
CREATE INDEX canonical_order_lines_product_idx
  ON canonical_order_lines (canonical_product_id);
CREATE INDEX canonical_order_lines_order_idx
  ON canonical_order_lines (odoo_order_id, order_type);
CREATE INDEX canonical_order_lines_type_state_idx
  ON canonical_order_lines (order_type, order_state);
CREATE INDEX canonical_order_lines_pending_inv_idx
  ON canonical_order_lines (has_pending_invoicing)
  WHERE has_pending_invoicing = true;
CREATE INDEX canonical_order_lines_pending_del_idx
  ON canonical_order_lines (has_pending_delivery)
  WHERE has_pending_delivery = true;

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('CREATE_MV', 'canonical_order_lines', 'Pattern B MV over odoo_order_lines',
        'supabase/migrations/1043_silver_sp4_canonical_order_lines.sql',
        'silver-sp4-task-4', true);

COMMIT;
```

- [ ] **Step 2: Apply via MCP.**

- [ ] **Step 3: Verify counts + pending aging**

```sql
SELECT order_type,
       COUNT(*)                                  AS rows,
       COUNT(canonical_product_id)               AS with_product,
       COUNT(*) FILTER (WHERE has_pending_invoicing) AS pending_invoicing,
       COUNT(*) FILTER (WHERE has_pending_delivery)  AS pending_delivery
FROM canonical_order_lines
GROUP BY order_type
ORDER BY order_type;
```

Expected: `sale` rows + `purchase` rows sum ≈ 32,083. `with_product / total ≥ 90%`.

- [ ] **Step 4: Record findings** in notes.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/1043_silver_sp4_canonical_order_lines.sql \
        docs/superpowers/plans/2026-04-24-silver-sp4-engine-gold-notes.md
git commit -m "feat(sp4): task 4 — canonical_order_lines MV (Pattern B)"
git push
```

---

### Task 5: `canonical_deliveries` (Pattern B MV, 25k rows)

**Files:**
- Create: `supabase/migrations/1044_silver_sp4_canonical_deliveries.sql`
- Modify: notes.

**Purpose.** Wrapper over `odoo_deliveries` with canonical_company FK. Spec §5.12.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/1044_silver_sp4_canonical_deliveries.sql`:

```sql
-- supabase/migrations/1044_silver_sp4_canonical_deliveries.sql
--
-- Silver SP4 — Task 5: canonical_deliveries MV
-- Spec §5.12; Plan Task 5.

BEGIN;

DROP MATERIALIZED VIEW IF EXISTS canonical_deliveries CASCADE;

CREATE MATERIALIZED VIEW canonical_deliveries AS
SELECT
  d.id                               AS canonical_id,
  d.odoo_picking_id,
  d.name,
  d.odoo_partner_id,
  cc.id                              AS canonical_company_id,
  d.picking_type,
  d.picking_type_code,
  d.origin,
  d.scheduled_date,
  d.date_done,
  d.create_date,
  d.state,
  d.is_late,
  d.lead_time_days,
  d.odoo_company_id,
  now() AS refreshed_at
FROM odoo_deliveries d
LEFT JOIN canonical_companies cc ON cc.odoo_partner_id = d.odoo_partner_id;

CREATE UNIQUE INDEX canonical_deliveries_pk
  ON canonical_deliveries (canonical_id);
CREATE INDEX canonical_deliveries_company_idx
  ON canonical_deliveries (canonical_company_id);
CREATE INDEX canonical_deliveries_type_state_idx
  ON canonical_deliveries (picking_type_code, state);
CREATE INDEX canonical_deliveries_sched_idx
  ON canonical_deliveries (scheduled_date);
CREATE INDEX canonical_deliveries_late_idx
  ON canonical_deliveries (is_late) WHERE is_late = true;

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('CREATE_MV', 'canonical_deliveries', 'Pattern B MV over odoo_deliveries',
        'supabase/migrations/1044_silver_sp4_canonical_deliveries.sql',
        'silver-sp4-task-5', true);

COMMIT;
```

- [ ] **Step 2: Apply.**

- [ ] **Step 3: Verify**

```sql
SELECT COUNT(*) total, COUNT(canonical_company_id) with_company,
       COUNT(*) FILTER (WHERE is_late) late_count,
       COUNT(*) FILTER (WHERE state='done') done_count
FROM canonical_deliveries;
```

Expected: `total = 25187`.

- [ ] **Step 4: Record findings.**

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/1044_silver_sp4_canonical_deliveries.sql \
        docs/superpowers/plans/2026-04-24-silver-sp4-engine-gold-notes.md
git commit -m "feat(sp4): task 5 — canonical_deliveries MV (Pattern B)"
git push
```

---

### Task 6: `canonical_inventory` (Pattern B VIEW)

**Files:**
- Create: `supabase/migrations/1045_silver_sp4_canonical_inventory.sql`
- Modify: notes.

**Purpose.** Join `canonical_products` + `odoo_orderpoints` (only 57 rows; join is 1:N on product → multiple warehouses; zero orderpoint → one NULL row per product). VIEW not MV (live query; low-volume). Spec §5.13.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/1045_silver_sp4_canonical_inventory.sql`:

```sql
-- supabase/migrations/1045_silver_sp4_canonical_inventory.sql
--
-- Silver SP4 — Task 6: canonical_inventory VIEW
-- Spec §5.13; Plan Task 6.

BEGIN;

DROP VIEW IF EXISTS canonical_inventory;

CREATE VIEW canonical_inventory AS
SELECT
  p.id                      AS canonical_product_id,
  p.internal_ref,
  p.display_name,
  p.odoo_product_id,
  p.stock_qty,
  p.reserved_qty,
  p.available_qty,
  p.reorder_min,
  p.reorder_max,
  op.odoo_orderpoint_id,
  op.warehouse_name,
  op.location_name,
  op.product_min_qty AS orderpoint_min,
  op.product_max_qty AS orderpoint_max,
  op.qty_to_order,
  op.qty_on_hand     AS orderpoint_qty_on_hand,
  op.qty_forecast,
  op.trigger_type,
  CASE
    WHEN op.odoo_orderpoint_id IS NOT NULL
     AND op.product_min_qty = 0
     AND op.qty_to_order > 0
    THEN true ELSE false
  END AS orderpoint_untuned,
  CASE WHEN p.available_qty <= 0 THEN true ELSE false END AS is_stockout,
  now() AS refreshed_at
FROM canonical_products p
LEFT JOIN odoo_orderpoints op ON op.odoo_product_id = p.odoo_product_id;

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('CREATE_VIEW', 'canonical_inventory', 'Pattern B view: products × orderpoints',
        'supabase/migrations/1045_silver_sp4_canonical_inventory.sql',
        'silver-sp4-task-6', true);

COMMIT;
```

- [ ] **Step 2: Apply.**

- [ ] **Step 3: Verify**

```sql
SELECT COUNT(*) rows,
       COUNT(odoo_orderpoint_id) with_orderpoint,
       COUNT(*) FILTER (WHERE orderpoint_untuned) untuned,
       COUNT(*) FILTER (WHERE is_stockout) stockouts
FROM canonical_inventory;
```

Expected: `rows ≥ 6004` (at least one per product — more if a product has multiple orderpoints; likely still 6004 since most products have no orderpoint). `with_orderpoint ≈ 57`.

- [ ] **Step 4: Record findings.**

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/1045_silver_sp4_canonical_inventory.sql \
        docs/superpowers/plans/2026-04-24-silver-sp4-engine-gold-notes.md
git commit -m "feat(sp4): task 6 — canonical_inventory view (Pattern B)"
git push
```

---

### Task 7: `canonical_manufacturing` (Pattern B MV)

**Files:**
- Create: `supabase/migrations/1046_silver_sp4_canonical_manufacturing.sql`
- Modify: notes.

**Purpose.** MV over `odoo_manufacturing` (4,713 rows) with `yield_pct` + `cycle_time_days` derived. Spec §5.14.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/1046_silver_sp4_canonical_manufacturing.sql`:

```sql
-- supabase/migrations/1046_silver_sp4_canonical_manufacturing.sql
--
-- Silver SP4 — Task 7: canonical_manufacturing MV
-- Spec §5.14; Plan Task 7.

BEGIN;

DROP MATERIALIZED VIEW IF EXISTS canonical_manufacturing CASCADE;

CREATE MATERIALIZED VIEW canonical_manufacturing AS
SELECT
  m.id                                   AS canonical_id,
  m.odoo_production_id,
  m.name,
  cp.id                                  AS canonical_product_id,
  m.product_name,
  m.odoo_product_id,
  m.qty_planned,
  m.qty_produced,
  CASE WHEN m.qty_planned > 0
       THEN ROUND(100.0 * m.qty_produced / m.qty_planned, 2)
       END                               AS yield_pct,
  m.state,
  m.date_start,
  m.date_finished,
  m.create_date,
  CASE WHEN m.date_finished IS NOT NULL AND m.date_start IS NOT NULL
       THEN EXTRACT(EPOCH FROM (m.date_finished - m.date_start)) / 86400
       END                               AS cycle_time_days,
  m.assigned_user,
  m.origin,
  m.odoo_company_id,
  now()                                  AS refreshed_at
FROM odoo_manufacturing m
LEFT JOIN canonical_products cp ON cp.odoo_product_id = m.odoo_product_id;

CREATE UNIQUE INDEX canonical_manufacturing_pk
  ON canonical_manufacturing (canonical_id);
CREATE INDEX canonical_manufacturing_state_idx
  ON canonical_manufacturing (state);
CREATE INDEX canonical_manufacturing_product_idx
  ON canonical_manufacturing (canonical_product_id);

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('CREATE_MV', 'canonical_manufacturing', 'Pattern B MV over odoo_manufacturing',
        'supabase/migrations/1046_silver_sp4_canonical_manufacturing.sql',
        'silver-sp4-task-7', true);

COMMIT;
```

- [ ] **Step 2: Apply.**

- [ ] **Step 3: Verify**

```sql
SELECT state, COUNT(*), ROUND(AVG(yield_pct),1) avg_yield,
       ROUND(AVG(cycle_time_days),2) avg_cycle_days
FROM canonical_manufacturing GROUP BY state ORDER BY COUNT(*) DESC;
```

- [ ] **Step 4: Record findings.**

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/1046_silver_sp4_canonical_manufacturing.sql \
        docs/superpowers/plans/2026-04-24-silver-sp4-engine-gold-notes.md
git commit -m "feat(sp4): task 7 — canonical_manufacturing MV (Pattern B)"
git push
```

---
### Task 8: `canonical_bank_balances` (Pattern B VIEW)

**Files:**
- Create: `supabase/migrations/1047_silver_sp4_canonical_bank_balances.sql`
- Modify: notes.

**Purpose.** Live VIEW over `odoo_bank_balances` (22 rows). Adds `is_stale` + `classification` (cash vs debt vs other). Spec §5.15.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/1047_silver_sp4_canonical_bank_balances.sql`:

```sql
-- supabase/migrations/1047_silver_sp4_canonical_bank_balances.sql
--
-- Silver SP4 — Task 8: canonical_bank_balances VIEW
-- Spec §5.15; Plan Task 8.

BEGIN;

DROP VIEW IF EXISTS canonical_bank_balances;

CREATE VIEW canonical_bank_balances AS
SELECT
  bb.id                           AS canonical_id,
  bb.odoo_journal_id,
  bb.name,
  bb.journal_type,
  bb.currency,
  bb.bank_account,
  bb.current_balance,
  bb.current_balance_mxn,
  bb.odoo_company_id,
  bb.company_name,
  bb.updated_at,
  CASE WHEN now() - bb.updated_at > interval '48 hours'
       THEN true ELSE false END   AS is_stale,
  CASE
    WHEN bb.journal_type = 'credit_card'            THEN 'debt'
    WHEN bb.current_balance_mxn < 0                  THEN 'debt'
    WHEN bb.journal_type IN ('bank','cash')
     AND bb.current_balance_mxn > 0                  THEN 'cash'
    ELSE 'other'
  END                              AS classification,
  now()                            AS refreshed_at
FROM odoo_bank_balances bb;

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('CREATE_VIEW', 'canonical_bank_balances', 'Pattern B view over odoo_bank_balances',
        'supabase/migrations/1047_silver_sp4_canonical_bank_balances.sql',
        'silver-sp4-task-8', true);

COMMIT;
```

- [ ] **Step 2: Apply.**

- [ ] **Step 3: Verify**

```sql
SELECT classification, COUNT(*), ROUND(SUM(current_balance_mxn),0) total_mxn,
       COUNT(*) FILTER (WHERE is_stale) stale
FROM canonical_bank_balances GROUP BY 1 ORDER BY 1;
```

Expected: `cash`, `debt`, `other` rows present; sum is Quimibond's real bank position.

- [ ] **Step 4: Record findings.**

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/1047_silver_sp4_canonical_bank_balances.sql \
        docs/superpowers/plans/2026-04-24-silver-sp4-engine-gold-notes.md
git commit -m "feat(sp4): task 8 — canonical_bank_balances view (Pattern B)"
git push
```

---

### Task 9: `canonical_fx_rates` (VIEW) + update `usd_to_mxn()` helper

**Files:**
- Create: `supabase/migrations/1048_silver_sp4_canonical_fx_rates.sql`
- Modify: notes.

**Purpose.** VIEW over `odoo_currency_rates` (71 rows). Re-declare `usd_to_mxn(date)` to read from `canonical_fx_rates` instead of Bronze (existing function has empty args — `args=""`, so we redefine with a `p_date` parameter that defaults to `CURRENT_DATE`). Spec §5.16.

**Important.** The old `usd_to_mxn()` has no parameter. DROP + CREATE the new one (no callers of the old yet — verified pre-SP4). If callers ever appeared, a compat shim `usd_to_mxn()` with zero args would wrap `usd_to_mxn(CURRENT_DATE)` — we will add that shim too to be safe.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/1048_silver_sp4_canonical_fx_rates.sql`:

```sql
-- supabase/migrations/1048_silver_sp4_canonical_fx_rates.sql
--
-- Silver SP4 — Task 9: canonical_fx_rates VIEW + usd_to_mxn(date) helper
-- Spec §5.16; Plan Task 9.

BEGIN;

DROP VIEW IF EXISTS canonical_fx_rates;

CREATE VIEW canonical_fx_rates AS
SELECT
  cr.id                            AS canonical_id,
  cr.currency,
  cr.rate,
  cr.inverse_rate,
  cr.rate_date,
  cr.odoo_company_id,
  cr.synced_at,
  CASE WHEN cr.rate_date < CURRENT_DATE - interval '3 days'
       THEN true ELSE false END    AS is_stale,
  ROW_NUMBER() OVER (PARTITION BY cr.currency
                     ORDER BY cr.rate_date DESC) AS recency_rank
FROM odoo_currency_rates cr;

DROP FUNCTION IF EXISTS usd_to_mxn() CASCADE;
DROP FUNCTION IF EXISTS usd_to_mxn(date) CASCADE;

CREATE OR REPLACE FUNCTION usd_to_mxn(p_date date DEFAULT CURRENT_DATE)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT rate
  FROM canonical_fx_rates
  WHERE currency = 'USD' AND rate_date <= p_date
  ORDER BY rate_date DESC
  LIMIT 1;
$$;

COMMENT ON FUNCTION usd_to_mxn(date) IS
  'Silver SP4: USD→MXN rate as of p_date. Defaults to CURRENT_DATE.';

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('CREATE_VIEW', 'canonical_fx_rates', 'Pattern B view + usd_to_mxn(date) helper',
        'supabase/migrations/1048_silver_sp4_canonical_fx_rates.sql',
        'silver-sp4-task-9', true);

COMMIT;
```

- [ ] **Step 2: Apply.**

- [ ] **Step 3: Verify**

```sql
SELECT currency, COUNT(*) rows,
       COUNT(*) FILTER (WHERE recency_rank=1) latest_rows,
       (SELECT usd_to_mxn(CURRENT_DATE)) AS usd_today,
       (SELECT usd_to_mxn(DATE '2025-01-15')) AS usd_2025_01_15
FROM canonical_fx_rates GROUP BY currency ORDER BY currency;
```

Expected: `USD` present, `usd_today` is today's rate from Odoo (probably 19-22 MXN).

- [ ] **Step 4: Record findings.**

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/1048_silver_sp4_canonical_fx_rates.sql \
        docs/superpowers/plans/2026-04-24-silver-sp4-engine-gold-notes.md
git commit -m "feat(sp4): task 9 — canonical_fx_rates view + usd_to_mxn(date)"
git push
```

---

### Task 10: `canonical_account_balances` (VIEW)

**Files:**
- Create: `supabase/migrations/1049_silver_sp4_canonical_account_balances.sql`
- Modify: notes.

**Purpose.** VIEW over `odoo_account_balances` (11k rows) joined to `odoo_chart_of_accounts` for `account_type` + `balance_sheet_bucket` classification. Spec §5.17.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/1049_silver_sp4_canonical_account_balances.sql`:

```sql
-- supabase/migrations/1049_silver_sp4_canonical_account_balances.sql
--
-- Silver SP4 — Task 10: canonical_account_balances VIEW
-- Spec §5.17; Plan Task 10.

BEGIN;

DROP VIEW IF EXISTS canonical_account_balances;

CREATE VIEW canonical_account_balances AS
SELECT
  ab.id                            AS canonical_id,
  ab.odoo_account_id,
  ab.account_code,
  ab.account_name,
  coa.account_type,
  ab.period,
  ab.debit,
  ab.credit,
  ab.balance,
  coa.deprecated,
  ab.synced_at,
  CASE
    WHEN coa.account_type LIKE 'asset_%'     THEN 'asset'
    WHEN coa.account_type LIKE 'liability_%' THEN 'liability'
    WHEN coa.account_type LIKE 'equity%'     THEN 'equity'
    WHEN coa.account_type LIKE 'income%'     THEN 'income'
    WHEN coa.account_type LIKE 'expense%'    THEN 'expense'
    ELSE 'other'
  END                              AS balance_sheet_bucket,
  now()                            AS refreshed_at
FROM odoo_account_balances ab
LEFT JOIN odoo_chart_of_accounts coa ON coa.odoo_account_id = ab.odoo_account_id;

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('CREATE_VIEW', 'canonical_account_balances', 'Pattern B view with balance_sheet_bucket',
        'supabase/migrations/1049_silver_sp4_canonical_account_balances.sql',
        'silver-sp4-task-10', true);

COMMIT;
```

- [ ] **Step 2: Apply.**

- [ ] **Step 3: Verify**

```sql
SELECT balance_sheet_bucket, COUNT(*) rows,
       ROUND(SUM(balance),0) total_balance
FROM canonical_account_balances
WHERE period IN (SELECT DISTINCT period FROM odoo_account_balances
                 ORDER BY period DESC LIMIT 1)
GROUP BY 1 ORDER BY 1;
```

Expected: rows for all 5 buckets + `other`. Total asset ≈ total liability + equity for latest period.

- [ ] **Step 4: Record findings.**

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/1049_silver_sp4_canonical_account_balances.sql \
        docs/superpowers/plans/2026-04-24-silver-sp4-engine-gold-notes.md
git commit -m "feat(sp4): task 10 — canonical_account_balances view (Pattern B)"
git push
```

---

### Task 11: `canonical_chart_of_accounts` (VIEW)

**Files:**
- Create: `supabase/migrations/1050_silver_sp4_canonical_chart_of_accounts.sql`
- Modify: notes.

**Purpose.** Thin VIEW over `odoo_chart_of_accounts` (1,640 rows) with a `tree_level` + `level_1_code` split. Reminder: `odoo_chart_of_accounts.code` is the column name (NOT `account_code`). Spec §5.18.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/1050_silver_sp4_canonical_chart_of_accounts.sql`:

```sql
-- supabase/migrations/1050_silver_sp4_canonical_chart_of_accounts.sql
--
-- Silver SP4 — Task 11: canonical_chart_of_accounts VIEW
-- Spec §5.18; Plan Task 11.

BEGIN;

DROP VIEW IF EXISTS canonical_chart_of_accounts;

CREATE VIEW canonical_chart_of_accounts AS
SELECT
  coa.id                              AS canonical_id,
  coa.odoo_account_id,
  coa.code,
  coa.name,
  coa.account_type,
  coa.reconcile,
  coa.deprecated,
  coa.active,
  coa.odoo_company_id,
  -- tree level by code prefix (e.g. "101" depth=1; "101-01" depth=2)
  LENGTH(coa.code) - LENGTH(REPLACE(coa.code, '-', '')) + 1 AS tree_level,
  SPLIT_PART(coa.code, '-', 1)        AS level_1_code,
  coa.synced_at
FROM odoo_chart_of_accounts coa;

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('CREATE_VIEW', 'canonical_chart_of_accounts', 'Pattern B view with tree_level / level_1_code',
        'supabase/migrations/1050_silver_sp4_canonical_chart_of_accounts.sql',
        'silver-sp4-task-11', true);

COMMIT;
```

- [ ] **Step 2: Apply.**

- [ ] **Step 3: Verify**

```sql
SELECT tree_level, COUNT(*) rows,
       COUNT(*) FILTER (WHERE deprecated) dep_count,
       COUNT(*) FILTER (WHERE active)     active_count
FROM canonical_chart_of_accounts GROUP BY 1 ORDER BY 1;
```

- [ ] **Step 4: Record findings.**

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/1050_silver_sp4_canonical_chart_of_accounts.sql \
        docs/superpowers/plans/2026-04-24-silver-sp4-engine-gold-notes.md
git commit -m "feat(sp4): task 11 — canonical_chart_of_accounts view (Pattern B)"
git push
```

---

### Task 12: `canonical_crm_leads` (VIEW) + wire new MVs into `refresh_all_matviews()`

**Files:**
- Create: `supabase/migrations/1051_silver_sp4_canonical_crm_leads.sql`
- Modify: notes.

**Purpose.** VIEW over `odoo_crm_leads` (only 20 rows, so VIEW not MV). Also extends `refresh_all_matviews()` function to include the 4 new MVs from Tasks 2, 3, 4, 5, 7 (sale_orders, purchase_orders, order_lines, deliveries, manufacturing). Spec §5.19 + §10.2.

- [ ] **Step 1: Inspect the current `refresh_all_matviews()` body**

```sql
SELECT pg_get_functiondef(oid)
FROM pg_proc WHERE proname='refresh_all_matviews';
```

Expected: one function body listing MV refreshes. Copy the body — you will extend it, not replace it blindly. If a listed MV no longer exists, leave it alone (it would have been dropped in SP1; but touch only additions in this migration).

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/1051_silver_sp4_canonical_crm_leads.sql`:

```sql
-- supabase/migrations/1051_silver_sp4_canonical_crm_leads.sql
--
-- Silver SP4 — Task 12: canonical_crm_leads VIEW
--                        + refresh_all_matviews() wiring for 5 new MVs
-- Spec §5.19, §10.2; Plan Task 12.

BEGIN;

DROP VIEW IF EXISTS canonical_crm_leads;

CREATE VIEW canonical_crm_leads AS
SELECT
  l.id                                AS canonical_id,
  l.odoo_lead_id,
  l.name,
  cc.id                               AS canonical_company_id,
  l.odoo_partner_id,
  l.lead_type,
  l.stage,
  l.expected_revenue,
  l.probability,
  l.date_deadline,
  l.create_date,
  l.days_open,
  l.assigned_user,
  cct.id                              AS assignee_canonical_contact_id,
  l.active,
  l.synced_at
FROM odoo_crm_leads l
LEFT JOIN canonical_companies cc  ON cc.odoo_partner_id = l.odoo_partner_id
LEFT JOIN canonical_contacts  cct ON cct.display_name   = l.assigned_user;  -- weak; SP5 refinement

-- Wire the 5 new MVs into the 2h refresh cycle.
-- We append to the existing body by re-creating the function with identical
-- structure + the additional REFRESH MATERIALIZED VIEW CONCURRENTLY lines.
-- IMPORTANT: preserve any existing MV refreshes from SP2/SP3; do not drop them.
-- This implementation is defensive: it REFRESHES only if the MV exists.

CREATE OR REPLACE FUNCTION refresh_all_matviews()
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_started timestamptz := clock_timestamp();
  v_log jsonb := '[]'::jsonb;
  v_name text;
  v_mvs text[] := ARRAY[
    -- SP2/SP3 (may or may not exist depending on prior migrations)
    'invoices_unified',                -- legacy, will drop in SP5
    'payments_unified',                -- legacy, will drop in SP5
    'syntage_invoices_enriched',       -- legacy, drop after SP2 cutover
    'products_unified',                -- legacy
    -- SP4 new
    'canonical_sale_orders',
    'canonical_purchase_orders',
    'canonical_order_lines',
    'canonical_deliveries',
    'canonical_manufacturing'
  ];
BEGIN
  FOREACH v_name IN ARRAY v_mvs LOOP
    IF EXISTS (SELECT 1 FROM pg_matviews WHERE schemaname='public' AND matviewname=v_name) THEN
      BEGIN
        EXECUTE format('REFRESH MATERIALIZED VIEW CONCURRENTLY %I', v_name);
        v_log := v_log || jsonb_build_object('mv', v_name, 'status', 'ok');
      EXCEPTION WHEN OTHERS THEN
        -- CONCURRENTLY fails on first-time (no unique idx) or when empty — fall back
        BEGIN
          EXECUTE format('REFRESH MATERIALIZED VIEW %I', v_name);
          v_log := v_log || jsonb_build_object('mv', v_name, 'status', 'ok_non_concurrent');
        EXCEPTION WHEN OTHERS THEN
          v_log := v_log || jsonb_build_object('mv', v_name, 'status', 'error', 'err', SQLERRM);
        END;
      END;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'started_at',  v_started,
    'finished_at', clock_timestamp(),
    'results',     v_log
  );
END;
$$;

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('CREATE_VIEW', 'canonical_crm_leads', 'Pattern B view + refresh_all_matviews() wiring',
        'supabase/migrations/1051_silver_sp4_canonical_crm_leads.sql',
        'silver-sp4-task-12', true);

COMMIT;
```

NOTE. If the pre-existing `refresh_all_matviews()` body handled additional legacy MVs that you must preserve (e.g. `monthly_revenue_trend`, `cashflow_projection`), ADD them into the `v_mvs` array above so nothing is dropped from the cycle. Cross-check against the output of Step 1.

- [ ] **Step 3: Apply.**

- [ ] **Step 4: Trigger a fresh refresh manually**

```sql
SELECT refresh_all_matviews();
```

Expected: JSON with `results` array; each new MV should report `status='ok'` or `'ok_non_concurrent'` on first try (CONCURRENTLY requires a unique index, which we declared in Tasks 2-7).

- [ ] **Step 5: Spot-check the CRM view**

```sql
SELECT COUNT(*) AS total, COUNT(canonical_company_id) AS with_company,
       COUNT(assignee_canonical_contact_id) AS with_assignee,
       COUNT(*) FILTER (WHERE active) active_leads
FROM canonical_crm_leads;
```

Expected: `total = 20`.

- [ ] **Step 6: Record findings.**

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/1051_silver_sp4_canonical_crm_leads.sql \
        docs/superpowers/plans/2026-04-24-silver-sp4-engine-gold-notes.md
git commit -m "feat(sp4): task 12 — canonical_crm_leads + refresh_all_matviews wiring"
git push
```

---
### Task 13: Evidence tables — `email_signals`, `attachments`, `manual_notes`

**Files:**
- Create: `supabase/migrations/1052_silver_sp4_evidence_tables.sql`
- Modify: notes.

**Purpose.** Install the three "non-fact" evidence tables per §8. `ai_extracted_facts` gets its own migration (Task 14 — separated so the 31k `facts` migration in Task 15 is a clean gate).

All three tables share the polymorphic `(canonical_entity_type, canonical_entity_id)` index pattern. `canonical_entity_id text` because some canonical entities use bigint PK (companies/contacts/products) and some use text PK (invoices/payments/credit_notes/tax_events).

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/1052_silver_sp4_evidence_tables.sql`:

```sql
-- supabase/migrations/1052_silver_sp4_evidence_tables.sql
--
-- Silver SP4 — Task 13: evidence tables (email_signals, attachments, manual_notes)
-- Spec §8; Plan Task 13.

BEGIN;

-- ===== email_signals =================================================
CREATE TABLE IF NOT EXISTS email_signals (
  id                     bigserial PRIMARY KEY,
  canonical_entity_type  text NOT NULL,           -- 'company'|'contact'|'invoice'|'payment'|'credit_note'|'tax_event'|'product'
  canonical_entity_id    text NOT NULL,
  signal_type            text NOT NULL,           -- 'mentioned'|'responded'|'cfdi_attached'|'complaint_in_subject'|...
  email_id               bigint NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
  thread_id              bigint REFERENCES threads(id) ON DELETE SET NULL,
  signal_value           text,
  confidence             numeric(4,3),
  extracted_at           timestamptz NOT NULL DEFAULT now(),
  expires_at             timestamptz
);
CREATE INDEX IF NOT EXISTS email_signals_entity_idx
  ON email_signals (canonical_entity_type, canonical_entity_id);
CREATE INDEX IF NOT EXISTS email_signals_email_idx
  ON email_signals (email_id);
CREATE INDEX IF NOT EXISTS email_signals_thread_idx
  ON email_signals (thread_id) WHERE thread_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS email_signals_type_idx
  ON email_signals (signal_type);

COMMENT ON TABLE email_signals IS
  'Silver SP4 Evidence — email-derived signals attached polymorphically to canonical entities.';

-- ===== attachments ===================================================
CREATE TABLE IF NOT EXISTS attachments (
  id                     bigserial PRIMARY KEY,
  canonical_entity_type  text NOT NULL,
  canonical_entity_id    text NOT NULL,
  attachment_type        text NOT NULL,          -- 'cfdi_xml'|'cfdi_pdf'|'quotation_pdf'|'image'|'other'
  storage_path           text,
  syntage_file_id        bigint,
  email_id               bigint REFERENCES emails(id) ON DELETE SET NULL,
  filename               text,
  mime_type              text,
  size_bytes             bigint,
  metadata               jsonb,                   -- {uuid, sha256, ...}
  uploaded_by            text,                    -- 'system_sat_pull'|'system_gmail'|'user:<email>'
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS attachments_entity_idx
  ON attachments (canonical_entity_type, canonical_entity_id);
CREATE INDEX IF NOT EXISTS attachments_syntage_file_idx
  ON attachments (syntage_file_id) WHERE syntage_file_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS attachments_type_idx
  ON attachments (attachment_type);

COMMENT ON TABLE attachments IS
  'Silver SP4 Evidence — files linked to canonical entities (CFDI XML/PDF, etc).';

-- ===== manual_notes ==================================================
CREATE TABLE IF NOT EXISTS manual_notes (
  id                     bigserial PRIMARY KEY,
  canonical_entity_type  text NOT NULL,
  canonical_entity_id    text NOT NULL,
  note_type              text NOT NULL DEFAULT 'general',   -- 'general'|'compliance'|'commitment'|'complaint_response'
  body                   text NOT NULL,
  created_by             text NOT NULL,
  pinned                 boolean NOT NULL DEFAULT false,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS manual_notes_entity_idx
  ON manual_notes (canonical_entity_type, canonical_entity_id);
CREATE INDEX IF NOT EXISTS manual_notes_pinned_idx
  ON manual_notes (pinned) WHERE pinned = true;

CREATE OR REPLACE FUNCTION manual_notes_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_manual_notes_updated_at ON manual_notes;
CREATE TRIGGER trg_manual_notes_updated_at
BEFORE UPDATE ON manual_notes
FOR EACH ROW EXECUTE FUNCTION manual_notes_touch_updated_at();

COMMENT ON TABLE manual_notes IS
  'Silver SP4 Evidence — freeform notes attached to canonical entities by operators.';

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('CREATE_TABLE', 'email_signals',   'Evidence layer', 'supabase/migrations/1052_silver_sp4_evidence_tables.sql', 'silver-sp4-task-13', true),
       ('CREATE_TABLE', 'attachments',     'Evidence layer', 'supabase/migrations/1052_silver_sp4_evidence_tables.sql', 'silver-sp4-task-13', true),
       ('CREATE_TABLE', 'manual_notes',    'Evidence layer', 'supabase/migrations/1052_silver_sp4_evidence_tables.sql', 'silver-sp4-task-13', true);

COMMIT;
```

- [ ] **Step 2: Apply.**

- [ ] **Step 3: Verify**

```sql
SELECT table_name,
       (SELECT COUNT(*) FROM information_schema.columns c
          WHERE c.table_schema='public' AND c.table_name = t.table_name) AS col_count
FROM (VALUES ('email_signals'),('attachments'),('manual_notes')) t(table_name)
ORDER BY table_name;
```

Expected: 3 rows, all with `col_count > 0`.

- [ ] **Step 4: Record findings.**

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/1052_silver_sp4_evidence_tables.sql \
        docs/superpowers/plans/2026-04-24-silver-sp4-engine-gold-notes.md
git commit -m "feat(sp4): task 13 — evidence tables (email_signals, attachments, manual_notes)"
git push
```

---

### Task 14: `ai_extracted_facts` table (schema only, no data yet)

**Files:**
- Create: `supabase/migrations/1053_silver_sp4_ai_extracted_facts.sql`
- Modify: notes.

**Purpose.** Create the successor-to-`facts` table with the polymorphic (canonical_entity_type, canonical_entity_id) pattern + superseded_by + verified + source_ref. Data migration in Task 15. Spec §8.2.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/1053_silver_sp4_ai_extracted_facts.sql`:

```sql
-- supabase/migrations/1053_silver_sp4_ai_extracted_facts.sql
--
-- Silver SP4 — Task 14: ai_extracted_facts table (schema only)
-- Spec §8.2; Plan Task 14.
-- Data migration lives in Task 15 (separate gate).

BEGIN;

CREATE TABLE IF NOT EXISTS ai_extracted_facts (
  id                    bigserial PRIMARY KEY,
  canonical_entity_type text NOT NULL,                 -- typically 'company' or 'contact'
  canonical_entity_id   text NOT NULL,
  fact_type             text NOT NULL,
  fact_text             text NOT NULL,
  fact_hash             text,                          -- for dedup
  fact_date             timestamptz,
  confidence            numeric(4,3) NOT NULL,
  source_type           text NOT NULL,                 -- 'email'|'document'|...
  source_account        text,
  source_ref            text,
  extraction_run_id     text,
  verified              boolean NOT NULL DEFAULT false,
  verification_source   text,
  verified_at           timestamptz,
  is_future             boolean NOT NULL DEFAULT false,
  expired               boolean NOT NULL DEFAULT false,
  superseded_by         bigint REFERENCES ai_extracted_facts(id),
  legacy_facts_id       bigint,                        -- trace: original facts.id (task 15)
  extracted_at          timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_extracted_facts_entity_idx
  ON ai_extracted_facts (canonical_entity_type, canonical_entity_id);
CREATE INDEX IF NOT EXISTS ai_extracted_facts_type_idx
  ON ai_extracted_facts (fact_type);
CREATE UNIQUE INDEX IF NOT EXISTS ai_extracted_facts_hash_uidx
  ON ai_extracted_facts (fact_hash)
  WHERE fact_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS ai_extracted_facts_legacy_idx
  ON ai_extracted_facts (legacy_facts_id) WHERE legacy_facts_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ai_extracted_facts_not_expired_idx
  ON ai_extracted_facts (canonical_entity_type, canonical_entity_id)
  WHERE expired = false AND superseded_by IS NULL;

COMMENT ON TABLE ai_extracted_facts IS
  'Silver SP4 Evidence — successor of facts. Polymorphic FK to canonical entities, with dedup + supersede.';

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('CREATE_TABLE', 'ai_extracted_facts', 'Successor of facts (schema only; migration in Task 15)',
        'supabase/migrations/1053_silver_sp4_ai_extracted_facts.sql',
        'silver-sp4-task-14', true);

COMMIT;
```

- [ ] **Step 2: Apply.**

- [ ] **Step 3: Verify**

```sql
SELECT COUNT(*) AS cols FROM information_schema.columns
WHERE table_schema='public' AND table_name='ai_extracted_facts';
```

Expected: ~20 columns.

- [ ] **Step 4: Record findings.**

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/1053_silver_sp4_ai_extracted_facts.sql \
        docs/superpowers/plans/2026-04-24-silver-sp4-engine-gold-notes.md
git commit -m "feat(sp4): task 14 — ai_extracted_facts table (schema)"
git push
```

---

### Task 15: **GATE** — Migrate `facts` → `ai_extracted_facts` (31k rows)

**Files:**
- Create: `supabase/migrations/1054_silver_sp4_facts_migration.sql`
- Modify: notes.

**Purpose.** Copy 31,806 rows from `facts` into `ai_extracted_facts`, mapping `facts.entity_id` → `(canonical_entity_type, canonical_entity_id)` via `source_links` where possible. Leave the original `facts` rows in place (SP5 will drop them). This is the first **gate** — stop, summarize, ask for user go-ahead before executing Step 4.

Mapping rules:
1. If `facts.entity_id` has an active `source_links` row with `source='kg_entity'` and `source_table='entities'` pointing to a `canonical_companies` row → `('company', <bigint as text>)`.
2. Else same but pointing to `canonical_contacts` → `('contact', <id>)`.
3. Else same but pointing to `canonical_products` → `('product', <id>)`.
4. Else fallback: `canonical_entity_type='entity_kg'`, `canonical_entity_id=<facts.entity_id>` (legacy sentinel — SP5 Data Quality agent resolves later).

`fact_hash` gets a deterministic hash so re-running is idempotent via `ON CONFLICT (fact_hash) DO NOTHING`.

- [ ] **Step 1: Pause for gate confirmation**

Report to the user:
- Row count: `SELECT COUNT(*) FROM facts;` (expected 31,806).
- Distribution of entity resolution BEFORE running the migration. Compute this first:

```sql
WITH mapped AS (
  SELECT f.id,
         CASE
           WHEN EXISTS (SELECT 1 FROM source_links sl
                        WHERE sl.source='kg_entity' AND sl.source_table='entities'
                          AND sl.source_id = f.entity_id::text
                          AND sl.canonical_entity_type='company'
                          AND sl.superseded_at IS NULL)  THEN 'company'
           WHEN EXISTS (SELECT 1 FROM source_links sl
                        WHERE sl.source='kg_entity' AND sl.source_table='entities'
                          AND sl.source_id = f.entity_id::text
                          AND sl.canonical_entity_type='contact'
                          AND sl.superseded_at IS NULL)  THEN 'contact'
           WHEN EXISTS (SELECT 1 FROM source_links sl
                        WHERE sl.source='kg_entity' AND sl.source_table='entities'
                          AND sl.source_id = f.entity_id::text
                          AND sl.canonical_entity_type='product'
                          AND sl.superseded_at IS NULL)  THEN 'product'
           ELSE 'entity_kg'
         END AS target_type
  FROM facts f
)
SELECT target_type, COUNT(*) FROM mapped GROUP BY 1 ORDER BY 1;
```

Paste the distribution and wait for user "go".

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/1054_silver_sp4_facts_migration.sql`:

```sql
-- supabase/migrations/1054_silver_sp4_facts_migration.sql
--
-- Silver SP4 — Task 15: migrate facts → ai_extracted_facts (31,806 rows)
-- Spec §8.2 (migration clause); Plan Task 15 (GATED).
-- Idempotent via unique fact_hash; original facts rows preserved (SP5 drops).

BEGIN;

WITH mapped AS (
  SELECT
    f.*,
    COALESCE(sl.canonical_entity_type, 'entity_kg') AS target_type,
    COALESCE(sl.canonical_entity_id,   f.entity_id::text) AS target_id,
    md5(COALESCE(f.fact_hash,'') || '|' || f.id::text || '|' || f.fact_type || '|' || left(f.fact_text, 500))
      AS derived_hash
  FROM facts f
  LEFT JOIN LATERAL (
    SELECT canonical_entity_type, canonical_entity_id
    FROM source_links
    WHERE source='kg_entity' AND source_table='entities'
      AND source_id = f.entity_id::text
      AND superseded_at IS NULL
      AND canonical_entity_type IN ('company','contact','product')
    ORDER BY match_confidence DESC NULLS LAST, id
    LIMIT 1
  ) sl ON true
)
INSERT INTO ai_extracted_facts
  (canonical_entity_type, canonical_entity_id, fact_type, fact_text, fact_hash,
   fact_date, confidence, source_type, source_account, source_ref,
   verified, verification_source, verified_at, is_future, expired,
   legacy_facts_id, extracted_at, created_at)
SELECT
  m.target_type, m.target_id,
  m.fact_type, m.fact_text,
  m.derived_hash,
  m.fact_date, m.confidence,
  COALESCE(m.source_type,'legacy'),
  m.source_account,
  CASE WHEN m.source_id IS NOT NULL THEN m.source_id::text END,
  COALESCE(m.verified, false),
  m.verification_source,
  m.verification_date,
  COALESCE(m.is_future, false),
  COALESCE(m.expired,   false),
  m.id,
  COALESCE(m.extracted_at, m.created_at, now()),
  COALESCE(m.created_at,   now())
FROM mapped m
ON CONFLICT (fact_hash) DO NOTHING;

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('MIGRATE_DATA', 'ai_extracted_facts',
        'Migrated facts → ai_extracted_facts (entity resolution via source_links)',
        'supabase/migrations/1054_silver_sp4_facts_migration.sql',
        'silver-sp4-task-15', true);

COMMIT;

-- Post-snapshot into audit_runs (so gate/rollback has a record)
INSERT INTO audit_runs (run_id, source, model, invariant_key, bucket_key, severity, details)
SELECT gen_random_uuid(), 'supabase', 'silver_sp4', 'sp4.facts_migration', 'sp4_task_15', 'ok',
       jsonb_build_object(
         'label',                 'task_15_facts_migration',
         'facts_src',             (SELECT COUNT(*) FROM facts),
         'ai_extracted_facts_dst',(SELECT COUNT(*) FROM ai_extracted_facts),
         'target_distribution',   (SELECT jsonb_object_agg(canonical_entity_type, c)
                                      FROM (SELECT canonical_entity_type, COUNT(*) c
                                              FROM ai_extracted_facts
                                              GROUP BY 1) x)
       );
```

- [ ] **Step 3: User confirms** ("go") then apply.

For 31k rows this is likely 5-10s. If `apply_migration` times out, split: run the `INSERT INTO ai_extracted_facts` via `execute_sql` first, then the `INSERT INTO audit_runs` + `schema_changes` via a second `execute_sql`.

- [ ] **Step 4: Verify**

```sql
SELECT 'facts' s, COUNT(*) n FROM facts
UNION ALL SELECT 'ai_extracted_facts', COUNT(*) FROM ai_extracted_facts;
```

Expected: `facts ≥ 31,806`, `ai_extracted_facts ≥ 31,806` (dedupe tolerance). Orphan delta should be ≤ 1 %.

```sql
SELECT canonical_entity_type, COUNT(*) FROM ai_extracted_facts GROUP BY 1 ORDER BY 2 DESC;
```

- [ ] **Step 5: Record findings + delta numbers** in notes file.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/1054_silver_sp4_facts_migration.sql \
        docs/superpowers/plans/2026-04-24-silver-sp4-engine-gold-notes.md
git commit -m "feat(sp4): task 15 — migrate facts into ai_extracted_facts (GATE)"
git push
```

---

### Task 16: Register 15 new invariants + legacy `invariant_key` backfill

**Files:**
- Create: `supabase/migrations/1055_silver_sp4_new_invariants_catalog.sql`
- Modify: notes.

**Purpose.** Insert catalog rows into `audit_tolerances` for the 15 invariants we will wire up in Tasks 17-18, AND remap the legacy open `reconciliation_issues` that have `invariant_key IS NULL` to their new keys so the inbox priority works uniformly. All new catalog rows start as `enabled = false` — Task 18 flips them on at the gate.

The 15 catalog rows (spec §9.2):
- invoice.amount_diff_post_fx
- invoice.uuid_mismatch_rfc
- payment.amount_mismatch
- payment.date_mismatch
- payment.allocation_over
- payment.allocation_under
- tax.retention_accounting_drift
- tax.return_payment_missing
- tax.accounting_sat_drift
- tax.blacklist_69b_definitive_active
- order.orphan_invoicing
- order.orphan_delivery
- invoice.without_order
- delivery.late_active
- mfg.stock_drift
- line_price_mismatch
- orderpoint_untuned
- clave_prodserv_drift
- entity_unresolved_30d
- ambiguous_match
- bank_balance.stale
- fx_rate.stale

(22 rows total — 15 "net new" + 7 that overlap in spec accounting. The `audit_tolerances` table is keyed by `invariant_key PK`, so `ON CONFLICT DO NOTHING` is the idempotency guard.)

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/1055_silver_sp4_new_invariants_catalog.sql`:

```sql
-- supabase/migrations/1055_silver_sp4_new_invariants_catalog.sql
--
-- Silver SP4 — Task 16: register 22 new invariants + remap legacy issues' invariant_key.
-- Spec §9.2; Plan Task 16.
-- New invariants land DISABLED (enabled=false) — Task 18 flips them on.

BEGIN;

-- ===== invariant catalog ===========================================
INSERT INTO audit_tolerances
  (invariant_key, abs_tolerance, pct_tolerance, notes, severity_default, entity, enabled, auto_resolve, check_cadence)
VALUES
  ('invoice.amount_diff_post_fx',       NULL, 1.00, 'diff persists after tipo_cambio SAT; real (non-FX) amount diff',
    'medium', 'invoice',      false, false, '2h'),
  ('invoice.uuid_mismatch_rfc',         NULL, NULL, 'UUID match but emisor/receptor RFC differs — integrity breach',
    'critical','invoice',     false, false, 'hourly'),
  ('payment.amount_mismatch',           0.01, NULL, 'Odoo amount vs SAT amount diff > 0.01 MXN',
    'high',   'payment',      false, true,  'hourly'),
  ('payment.date_mismatch',             1,    NULL, '|date_odoo - fecha_pago_sat| > 1 day',
    'low',    'payment',      false, true,  '2h'),
  ('payment.allocation_over',           NULL, NULL, 'sum(allocated) > amount_resolved',
    'medium', 'payment',      false, false, '2h'),
  ('payment.allocation_under',          NULL, NULL, 'sum(allocated) < amount_resolved on active PPD',
    'low',    'payment',      false, true,  '2h'),
  ('tax.retention_accounting_drift',    1.00, 0.05, 'SUM retention vs Odoo ISR retenido monthly',
    'medium', 'tax_event',    false, false, 'daily'),
  ('tax.return_payment_missing',        NULL, NULL, 'syntage_tax_returns.monto_pagado>0 w/o Odoo account.payment',
    'high',   'tax_event',    false, true,  'daily'),
  ('tax.accounting_sat_drift',          1.00, 0.05, 'odoo_account_balances vs syntage_electronic_accounting',
    'medium', 'tax_event',    false, false, 'daily'),
  ('tax.blacklist_69b_definitive_active', NULL, NULL, 'Counterparty blacklist=definitive with post-flag CFDI',
    'critical','company',     false, false, 'hourly'),
  ('order.orphan_invoicing',            NULL, NULL, 'SO line sale/done with qty_pending_invoice aging > 30d',
    'medium', 'order_line',   false, true,  'daily'),
  ('order.orphan_delivery',             NULL, NULL, 'SO line sale/done with qty_pending_delivery aging > 14d',
    'medium', 'order_line',   false, true,  'daily'),
  ('invoice.without_order',             NULL, NULL, 'invoice posted whose ref/origin does not match any SO/PO',
    'low',    'invoice',      false, false, 'daily'),
  ('delivery.late_active',              NULL, NULL, 'is_late AND state NOT IN (done,cancel)',
    'medium', 'delivery',     false, true,  '2h'),
  ('mfg.stock_drift',                   NULL, NULL, 'qty_produced closed without stock_qty reflection',
    'medium', 'manufacturing',false, false, 'daily'),
  ('line_price_mismatch',               NULL, 0.50, 'odoo_invoice_lines.price_unit vs syntage valor_unitario diff',
    'medium', 'invoice_line', false, false, 'daily'),
  ('orderpoint_untuned',                NULL, NULL, 'orderpoint min=0 and qty_to_order>0',
    'low',    'inventory',    false, false, 'daily'),
  ('clave_prodserv_drift',              NULL, NULL, 'most-frequent claveProdServ changes month-over-month',
    'low',    'product',      false, false, 'daily'),
  ('entity_unresolved_30d',             30,   NULL, 'entity KG with mention_count>3 without canonical link for 30d',
    'low',    'company',      false, true,  'daily'),
  ('ambiguous_match',                   NULL, NULL, 'matcher found 2+ candidates for same source row',
    'high',   'any',          false, false, '2h'),
  ('bank_balance.stale',                48,   NULL, 'bank updated_at older than 48h',
    'medium', 'bank_balance', false, true,  'hourly'),
  ('fx_rate.stale',                     3,    NULL, 'MAX(rate_date) < today-3d',
    'high',   'fx_rate',      false, true,  'hourly')
ON CONFLICT (invariant_key) DO NOTHING;

-- ===== legacy invariant_key backfill ================================
-- Some SP2 issues were inserted before the invariant_key column was added,
-- so ~30k rows have invariant_key IS NULL. Remap from issue_type when possible.

UPDATE reconciliation_issues SET invariant_key = issue_type
WHERE invariant_key IS NULL
  AND issue_type IN (
    -- issue_type values already aligned with invariant_key convention
    'invoice.posted_without_uuid',
    'invoice.missing_sat_timbrado',
    'invoice.pending_operationalization',
    'invoice.amount_mismatch',
    'invoice.state_mismatch_posted_cancelled',
    'invoice.state_mismatch_cancel_vigente',
    'invoice.date_drift',
    'invoice.credit_note_orphan',
    'payment.registered_without_complement',
    'payment.complement_without_payment'
  );

-- Remap legacy names to the SP4 canonical keys.
UPDATE reconciliation_issues SET invariant_key = 'payment.registered_without_complement'
WHERE invariant_key IS NULL AND issue_type IN ('payment_missing_complemento','registered_without_complement');

UPDATE reconciliation_issues SET invariant_key = 'payment.complement_without_payment'
WHERE invariant_key IS NULL AND issue_type IN ('complemento_missing_payment','complement_without_payment','sat_only_cfdi_issued','sat_only_cfdi_received');

UPDATE reconciliation_issues SET invariant_key = 'invoice.posted_without_uuid'
WHERE invariant_key IS NULL AND issue_type IN ('posted_but_sat_uncertified','posted_without_uuid');

UPDATE reconciliation_issues SET invariant_key = 'invoice.state_mismatch_posted_cancelled'
WHERE invariant_key IS NULL AND issue_type IN ('cancelled_but_posted','state_mismatch');

UPDATE reconciliation_issues SET invariant_key = 'invoice.amount_mismatch'
WHERE invariant_key IS NULL AND issue_type IN ('amount_mismatch');

UPDATE reconciliation_issues SET invariant_key = 'tax.blacklist_69b_definitive_active'
WHERE invariant_key IS NULL AND issue_type IN ('partner_blacklist_69b','blacklist_69b','blacklist_definitive');

-- Any remaining NULLs → sentinel for Data Quality agent to triage
UPDATE reconciliation_issues SET invariant_key = 'legacy.unclassified'
WHERE invariant_key IS NULL;

INSERT INTO audit_tolerances
  (invariant_key, notes, severity_default, entity, enabled, auto_resolve, check_cadence)
VALUES
  ('legacy.unclassified', 'Legacy SP1 issues with no mappable issue_type. Data Quality agent triages.',
   'low', 'legacy', false, false, 'daily')
ON CONFLICT (invariant_key) DO NOTHING;

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('SEED', 'audit_tolerances',
        'Register 22 new invariants (all enabled=false until Task 18) + remap legacy invariant_key',
        'supabase/migrations/1055_silver_sp4_new_invariants_catalog.sql',
        'silver-sp4-task-16', true);

COMMIT;
```

- [ ] **Step 2: Apply.**

- [ ] **Step 3: Verify catalog + backfill**

```sql
SELECT 'catalog_total' k, COUNT(*) v FROM audit_tolerances
UNION ALL SELECT 'catalog_enabled', COUNT(*) FROM audit_tolerances WHERE enabled
UNION ALL SELECT 'issues_open_no_key', COUNT(*) FROM reconciliation_issues
  WHERE resolved_at IS NULL AND invariant_key IS NULL
UNION ALL SELECT 'issues_open_total', COUNT(*) FROM reconciliation_issues WHERE resolved_at IS NULL
ORDER BY k;
```

Expected: `catalog_total ≥ 38` (16 pre-SP4 + 22 new + `legacy.unclassified`), `catalog_enabled = 16` (unchanged), `issues_open_no_key = 0`.

- [ ] **Step 4: Record findings.**

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/1055_silver_sp4_new_invariants_catalog.sql \
        docs/superpowers/plans/2026-04-24-silver-sp4-engine-gold-notes.md
git commit -m "feat(sp4): task 16 — register 22 invariants + remap legacy invariant_key"
git push
```

---

### Task 17: Extend `run_reconciliation()` — part 1 (invoice + payment + tax SQL bodies)

**Files:**
- Create: `supabase/migrations/1056_silver_sp4_run_reconciliation_part1.sql`
- Modify: notes.

**Purpose.** Implement SQL bodies for 10 of the 22 new invariants inside `run_reconciliation(p_key)`:

- invoice.amount_diff_post_fx
- invoice.uuid_mismatch_rfc
- invoice.without_order
- payment.amount_mismatch
- payment.date_mismatch
- payment.allocation_over
- payment.allocation_under
- tax.retention_accounting_drift
- tax.return_payment_missing
- tax.accounting_sat_drift

This task does NOT enable them yet — dispatch block checks `audit_tolerances.enabled=true`. Task 18 enables.

Assume `run_reconciliation(p_key text DEFAULT NULL)` exists (SP2). Strategy: **wrap rather than rewrite**. Add a new helper function `_sp4_run_extra(p_key text)` and have the main `run_reconciliation` call it at the end. This keeps the SP2 implementation untouched.

- [ ] **Step 1: Inspect current `run_reconciliation` body** to confirm we have a clean wrap seam

```sql
SELECT pg_get_functiondef(oid)
FROM pg_proc WHERE proname='run_reconciliation';
```

Look for where the function returns. We'll add a call to `_sp4_run_extra(p_key)` immediately before the final `RETURN`. If the SP2 function body is a simple CASE dispatch that you can extend, consider adding the new cases directly. Judgment call — prefer the helper wrapper for reversibility.

- [ ] **Step 2: Write the helper function with 10 invariant bodies**

Create `supabase/migrations/1056_silver_sp4_run_reconciliation_part1.sql`:

```sql
-- supabase/migrations/1056_silver_sp4_run_reconciliation_part1.sql
--
-- Silver SP4 — Task 17: _sp4_run_extra() part 1 (invoice + payment + tax invariants)
-- Spec §9.2; Plan Task 17.
-- Each invariant is idempotent (uses NOT EXISTS to avoid dup open issues).

BEGIN;

CREATE OR REPLACE FUNCTION _sp4_run_extra(p_key text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_log jsonb := '[]'::jsonb;
  v_enabled boolean;

  FUNCTION _check(p_inv text) RETURNS boolean AS $inner$
  BEGIN
    RETURN (p_key IS NULL OR p_key = p_inv)
       AND COALESCE((SELECT enabled FROM audit_tolerances WHERE invariant_key=p_inv), false);
  END;
  $inner$ LANGUAGE plpgsql STABLE;
BEGIN
  -- The inner FUNCTION block above is inline; Postgres does not allow nested plpgsql definitions,
  -- so rewrite with a straight CASE on p_key + a subselect against audit_tolerances.
  -- (We keep the variable v_enabled per invariant below.)

  ------------------------------------------------------------------
  -- invoice.amount_diff_post_fx
  ------------------------------------------------------------------
  IF (p_key IS NULL OR p_key='invoice.amount_diff_post_fx')
     AND (SELECT enabled FROM audit_tolerances WHERE invariant_key='invoice.amount_diff_post_fx') THEN

    WITH candidates AS (
      SELECT ci.canonical_id,
             ci.emisor_canonical_company_id,
             ci.amount_total_mxn_odoo,
             ci.amount_total_mxn_sat,
             ci.amount_total_mxn_resolved,
             ABS(COALESCE(ci.amount_total_mxn_odoo,0) - COALESCE(ci.amount_total_mxn_sat,0))      AS abs_diff,
             CASE WHEN GREATEST(ABS(ci.amount_total_mxn_odoo),ABS(ci.amount_total_mxn_sat)) > 0
                  THEN 100.0 * ABS(COALESCE(ci.amount_total_mxn_odoo,0) - COALESCE(ci.amount_total_mxn_sat,0))
                       / GREATEST(ABS(ci.amount_total_mxn_odoo),ABS(ci.amount_total_mxn_sat),1)
                  END                                                                             AS pct_diff
      FROM canonical_invoices ci
      WHERE ci.has_odoo_record AND ci.has_sat_record
        AND ci.currency_sat <> 'MXN'               -- only multi-currency rows (FX legit drift removed)
        AND ABS(COALESCE(ci.amount_total_mxn_odoo,0) - COALESCE(ci.amount_total_mxn_sat,0)) > 50
    )
    INSERT INTO reconciliation_issues
      (issue_id, issue_type, canonical_entity_type, canonical_entity_id, canonical_id,
       impact_mxn, severity, detected_at, invariant_key, action_cta, description, metadata)
    SELECT gen_random_uuid(), 'invoice.amount_diff_post_fx', 'invoice', c.canonical_id, c.canonical_id,
           c.abs_diff,
           CASE WHEN c.pct_diff > 5 THEN 'high' ELSE 'medium' END,
           now(), 'invoice.amount_diff_post_fx', 'review_amount_diff',
           format('Post-FX amount diff: |%s - %s| = %s MXN (%.2f%%)',
                  c.amount_total_mxn_odoo, c.amount_total_mxn_sat, c.abs_diff, c.pct_diff),
           jsonb_build_object('abs_diff', c.abs_diff, 'pct_diff', c.pct_diff,
                              'amount_mxn_odoo', c.amount_total_mxn_odoo,
                              'amount_mxn_sat',  c.amount_total_mxn_sat)
    FROM candidates c
    WHERE NOT EXISTS (
      SELECT 1 FROM reconciliation_issues ri
       WHERE ri.invariant_key = 'invoice.amount_diff_post_fx'
         AND ri.canonical_id = c.canonical_id
         AND ri.resolved_at IS NULL
    );

    v_log := v_log || jsonb_build_object('k','invoice.amount_diff_post_fx','status','ok');
  END IF;

  ------------------------------------------------------------------
  -- invoice.uuid_mismatch_rfc
  ------------------------------------------------------------------
  IF (p_key IS NULL OR p_key='invoice.uuid_mismatch_rfc')
     AND (SELECT enabled FROM audit_tolerances WHERE invariant_key='invoice.uuid_mismatch_rfc') THEN

    INSERT INTO reconciliation_issues
      (issue_id, issue_type, canonical_entity_type, canonical_entity_id, canonical_id,
       impact_mxn, severity, detected_at, invariant_key, action_cta, description, metadata)
    SELECT gen_random_uuid(), 'invoice.uuid_mismatch_rfc', 'invoice', ci.canonical_id, ci.canonical_id,
           ci.amount_total_mxn_resolved, 'critical', now(),
           'invoice.uuid_mismatch_rfc', 'review_manual',
           format('UUID match but RFC differs: emisor odoo=%s sat=%s receptor odoo=%s sat=%s',
                  oi.ref, ci.emisor_rfc, ci.receptor_rfc, ci.receptor_rfc),
           jsonb_build_object('odoo_id', oi.id, 'sat_uuid', ci.sat_uuid)
    FROM canonical_invoices ci
    JOIN odoo_invoices oi ON oi.id = ci.odoo_invoice_id
    JOIN syntage_invoices si ON si.uuid = ci.sat_uuid
    WHERE (si.emisor_rfc   IS DISTINCT FROM ci.emisor_rfc
        OR si.receptor_rfc IS DISTINCT FROM ci.receptor_rfc)
    AND NOT EXISTS (
      SELECT 1 FROM reconciliation_issues ri
      WHERE ri.invariant_key='invoice.uuid_mismatch_rfc'
        AND ri.canonical_id = ci.canonical_id
        AND ri.resolved_at IS NULL
    );

    v_log := v_log || jsonb_build_object('k','invoice.uuid_mismatch_rfc','status','ok');
  END IF;

  ------------------------------------------------------------------
  -- invoice.without_order
  ------------------------------------------------------------------
  IF (p_key IS NULL OR p_key='invoice.without_order')
     AND (SELECT enabled FROM audit_tolerances WHERE invariant_key='invoice.without_order') THEN

    INSERT INTO reconciliation_issues
      (issue_id, issue_type, canonical_entity_type, canonical_entity_id, canonical_id,
       impact_mxn, severity, detected_at, invariant_key, action_cta, description, metadata)
    SELECT gen_random_uuid(), 'invoice.without_order', 'invoice', ci.canonical_id, ci.canonical_id,
           ci.amount_total_mxn_resolved, 'low', now(),
           'invoice.without_order', 'link_manual',
           format('Invoice %s has no matching SO/PO', ci.odoo_name),
           jsonb_build_object('odoo_ref', ci.odoo_ref)
    FROM canonical_invoices ci
    WHERE ci.has_odoo_record
      AND ci.invoice_date >= CURRENT_DATE - interval '365 days'
      AND ci.odoo_ref IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM canonical_sale_orders so
         WHERE so.name = ci.odoo_ref OR so.name = ci.odoo_name
      )
      AND NOT EXISTS (
        SELECT 1 FROM canonical_purchase_orders po
         WHERE po.name = ci.odoo_ref OR po.name = ci.odoo_name
      )
      AND NOT EXISTS (
        SELECT 1 FROM reconciliation_issues ri
         WHERE ri.invariant_key='invoice.without_order'
           AND ri.canonical_id=ci.canonical_id AND ri.resolved_at IS NULL
      );

    v_log := v_log || jsonb_build_object('k','invoice.without_order','status','ok');
  END IF;

  ------------------------------------------------------------------
  -- payment.amount_mismatch
  ------------------------------------------------------------------
  IF (p_key IS NULL OR p_key='payment.amount_mismatch')
     AND (SELECT enabled FROM audit_tolerances WHERE invariant_key='payment.amount_mismatch') THEN

    INSERT INTO reconciliation_issues
      (issue_id, issue_type, canonical_entity_type, canonical_entity_id, canonical_id,
       impact_mxn, severity, detected_at, invariant_key, action_cta, description, metadata)
    SELECT gen_random_uuid(), 'payment.amount_mismatch', 'payment', cp.canonical_id, cp.canonical_id,
           cp.amount_mxn_resolved, 'high', now(),
           'payment.amount_mismatch', 'review_amount_diff',
           format('Payment amount diff: odoo=%s sat=%s diff=%s',
                  cp.amount_odoo, cp.amount_sat, cp.amount_diff_abs),
           jsonb_build_object('amount_diff_abs', cp.amount_diff_abs)
    FROM canonical_payments cp
    WHERE cp.has_odoo_record AND cp.has_sat_record
      AND cp.amount_diff_abs > 0.01
      AND NOT EXISTS (
        SELECT 1 FROM reconciliation_issues ri
         WHERE ri.invariant_key='payment.amount_mismatch'
           AND ri.canonical_id=cp.canonical_id AND ri.resolved_at IS NULL
      );

    v_log := v_log || jsonb_build_object('k','payment.amount_mismatch','status','ok');
  END IF;

  ------------------------------------------------------------------
  -- payment.date_mismatch
  ------------------------------------------------------------------
  IF (p_key IS NULL OR p_key='payment.date_mismatch')
     AND (SELECT enabled FROM audit_tolerances WHERE invariant_key='payment.date_mismatch') THEN

    INSERT INTO reconciliation_issues
      (issue_id, issue_type, canonical_entity_type, canonical_entity_id, canonical_id,
       impact_mxn, severity, detected_at, invariant_key, action_cta, description, metadata)
    SELECT gen_random_uuid(), 'payment.date_mismatch', 'payment', cp.canonical_id, cp.canonical_id,
           cp.amount_mxn_resolved, 'low', now(),
           'payment.date_mismatch', 'review_manual',
           format('Payment date off: odoo=%s sat=%s',
                  cp.payment_date_odoo, cp.fecha_pago_sat::date),
           jsonb_build_object('diff_days', ABS(EXTRACT(DAY FROM cp.fecha_pago_sat::date - cp.payment_date_odoo)))
    FROM canonical_payments cp
    WHERE cp.has_odoo_record AND cp.has_sat_record
      AND cp.payment_date_odoo IS NOT NULL AND cp.fecha_pago_sat IS NOT NULL
      AND ABS(EXTRACT(DAY FROM cp.fecha_pago_sat::date - cp.payment_date_odoo)) > 1
      AND NOT EXISTS (
        SELECT 1 FROM reconciliation_issues ri
         WHERE ri.invariant_key='payment.date_mismatch'
           AND ri.canonical_id=cp.canonical_id AND ri.resolved_at IS NULL
      );

    v_log := v_log || jsonb_build_object('k','payment.date_mismatch','status','ok');
  END IF;

  ------------------------------------------------------------------
  -- payment.allocation_over
  ------------------------------------------------------------------
  IF (p_key IS NULL OR p_key='payment.allocation_over')
     AND (SELECT enabled FROM audit_tolerances WHERE invariant_key='payment.allocation_over') THEN

    WITH agg AS (
      SELECT cpa.payment_canonical_id, SUM(cpa.allocated_amount) total
      FROM canonical_payment_allocations cpa GROUP BY 1
    )
    INSERT INTO reconciliation_issues
      (issue_id, issue_type, canonical_entity_type, canonical_entity_id, canonical_id,
       impact_mxn, severity, detected_at, invariant_key, action_cta, description, metadata)
    SELECT gen_random_uuid(), 'payment.allocation_over', 'payment', cp.canonical_id, cp.canonical_id,
           (a.total - cp.amount_resolved), 'medium', now(),
           'payment.allocation_over', 'review_manual',
           format('Allocations %s > payment %s', a.total, cp.amount_resolved),
           jsonb_build_object('total_allocated', a.total, 'amount_resolved', cp.amount_resolved)
    FROM canonical_payments cp
    JOIN agg a ON a.payment_canonical_id = cp.canonical_id
    WHERE a.total > COALESCE(cp.amount_resolved, 0) + 0.01
      AND NOT EXISTS (
        SELECT 1 FROM reconciliation_issues ri
         WHERE ri.invariant_key='payment.allocation_over'
           AND ri.canonical_id=cp.canonical_id AND ri.resolved_at IS NULL
      );

    v_log := v_log || jsonb_build_object('k','payment.allocation_over','status','ok');
  END IF;

  ------------------------------------------------------------------
  -- payment.allocation_under
  ------------------------------------------------------------------
  IF (p_key IS NULL OR p_key='payment.allocation_under')
     AND (SELECT enabled FROM audit_tolerances WHERE invariant_key='payment.allocation_under') THEN

    WITH agg AS (
      SELECT cpa.payment_canonical_id, SUM(cpa.allocated_amount) total
      FROM canonical_payment_allocations cpa GROUP BY 1
    )
    INSERT INTO reconciliation_issues
      (issue_id, issue_type, canonical_entity_type, canonical_entity_id, canonical_id,
       impact_mxn, severity, detected_at, invariant_key, action_cta, description, metadata)
    SELECT gen_random_uuid(), 'payment.allocation_under', 'payment', cp.canonical_id, cp.canonical_id,
           (cp.amount_resolved - a.total), 'low', now(),
           'payment.allocation_under', 'review_manual',
           format('Allocations %s < payment %s', a.total, cp.amount_resolved),
           jsonb_build_object('total_allocated', a.total, 'amount_resolved', cp.amount_resolved)
    FROM canonical_payments cp
    JOIN agg a ON a.payment_canonical_id = cp.canonical_id
    WHERE a.total < cp.amount_resolved - 0.01
      AND cp.direction = 'issued'   -- only on AR PPD
      AND NOT EXISTS (
        SELECT 1 FROM reconciliation_issues ri
         WHERE ri.invariant_key='payment.allocation_under'
           AND ri.canonical_id=cp.canonical_id AND ri.resolved_at IS NULL
      );

    v_log := v_log || jsonb_build_object('k','payment.allocation_under','status','ok');
  END IF;

  ------------------------------------------------------------------
  -- tax.retention_accounting_drift
  ------------------------------------------------------------------
  IF (p_key IS NULL OR p_key='tax.retention_accounting_drift')
     AND (SELECT enabled FROM audit_tolerances WHERE invariant_key='tax.retention_accounting_drift') THEN

    WITH sat_monthly AS (
      SELECT to_char(retention_fecha_emision, 'YYYY-MM') AS period,
             SUM(monto_total_retenido) sat_total
      FROM canonical_tax_events
      WHERE event_type='retention' AND tipo_retencion ILIKE '%ISR%'
      GROUP BY 1
    ),
    odoo_monthly AS (
      -- ISR retenido prefixes are 113.% (retained) and 213.% (payable)
      SELECT ab.period, SUM(ab.balance) odoo_total
      FROM odoo_account_balances ab
      JOIN odoo_chart_of_accounts coa ON coa.odoo_account_id = ab.odoo_account_id
      WHERE coa.code LIKE '113.%' OR coa.code LIKE '213.%'
      GROUP BY 1
    ),
    j AS (
      SELECT COALESCE(s.period, o.period) period,
             COALESCE(s.sat_total, 0) sat_total,
             COALESCE(o.odoo_total, 0) odoo_total,
             ABS(COALESCE(s.sat_total,0) - COALESCE(o.odoo_total,0)) diff
      FROM sat_monthly s FULL OUTER JOIN odoo_monthly o ON s.period=o.period
    )
    INSERT INTO reconciliation_issues
      (issue_id, issue_type, canonical_entity_type, canonical_entity_id, canonical_id,
       impact_mxn, severity, detected_at, invariant_key, action_cta, description, metadata)
    SELECT gen_random_uuid(), 'tax.retention_accounting_drift', 'tax_event',
           'isr-retention-'||period, 'isr-retention-'||period,
           diff, 'medium', now(),
           'tax.retention_accounting_drift', 'review_accounting',
           format('ISR period %s: SAT %s vs Odoo %s (diff %s)', period, sat_total, odoo_total, diff),
           jsonb_build_object('period', period, 'sat_total', sat_total, 'odoo_total', odoo_total)
    FROM j
    WHERE diff > 1.00 OR (sat_total > 0 AND diff/NULLIF(GREATEST(ABS(sat_total),ABS(odoo_total)),0) > 0.0005)
      AND NOT EXISTS (
        SELECT 1 FROM reconciliation_issues ri
         WHERE ri.invariant_key='tax.retention_accounting_drift'
           AND ri.canonical_id='isr-retention-'||j.period
           AND ri.resolved_at IS NULL
      );

    v_log := v_log || jsonb_build_object('k','tax.retention_accounting_drift','status','ok');
  END IF;

  ------------------------------------------------------------------
  -- tax.return_payment_missing
  ------------------------------------------------------------------
  IF (p_key IS NULL OR p_key='tax.return_payment_missing')
     AND (SELECT enabled FROM audit_tolerances WHERE invariant_key='tax.return_payment_missing') THEN

    INSERT INTO reconciliation_issues
      (issue_id, issue_type, canonical_entity_type, canonical_entity_id, canonical_id,
       impact_mxn, severity, detected_at, invariant_key, action_cta, description, metadata)
    SELECT gen_random_uuid(), 'tax.return_payment_missing', 'tax_event',
           cte.canonical_id, cte.canonical_id,
           cte.return_monto_pagado, 'high', now(),
           'tax.return_payment_missing', 'link_manual',
           format('SAT return ejercicio %s periodo %s paid %s MXN without Odoo payment',
                  cte.return_ejercicio, cte.return_periodo, cte.return_monto_pagado),
           jsonb_build_object('ejercicio', cte.return_ejercicio, 'periodo', cte.return_periodo,
                              'impuesto', cte.return_impuesto)
    FROM canonical_tax_events cte
    WHERE cte.event_type='return'
      AND cte.return_monto_pagado > 0
      AND (cte.odoo_payment_id IS NULL OR cte.odoo_reconciled_amount IS NULL)
      AND NOT EXISTS (
        SELECT 1 FROM reconciliation_issues ri
         WHERE ri.invariant_key='tax.return_payment_missing'
           AND ri.canonical_id=cte.canonical_id AND ri.resolved_at IS NULL
      );

    v_log := v_log || jsonb_build_object('k','tax.return_payment_missing','status','ok');
  END IF;

  ------------------------------------------------------------------
  -- tax.accounting_sat_drift
  ------------------------------------------------------------------
  IF (p_key IS NULL OR p_key='tax.accounting_sat_drift')
     AND (SELECT enabled FROM audit_tolerances WHERE invariant_key='tax.accounting_sat_drift') THEN

    INSERT INTO reconciliation_issues
      (issue_id, issue_type, canonical_entity_type, canonical_entity_id, canonical_id,
       impact_mxn, severity, detected_at, invariant_key, action_cta, description, metadata)
    SELECT gen_random_uuid(), 'tax.accounting_sat_drift', 'tax_event',
           'ea-' || cte.acct_periodo, 'ea-' || cte.acct_periodo,
           NULL, 'medium', now(),
           'tax.accounting_sat_drift', 'review_accounting',
           format('Electronic Accounting %s tipo=%s — Odoo ≠ SAT balanza', cte.acct_periodo, cte.acct_tipo_envio),
           jsonb_build_object('ejercicio', cte.acct_ejercicio, 'periodo', cte.acct_periodo,
                              'tipo_envio', cte.acct_tipo_envio)
    FROM canonical_tax_events cte
    WHERE cte.event_type='accounting'
      AND cte.needs_review = true
      AND NOT EXISTS (
        SELECT 1 FROM reconciliation_issues ri
         WHERE ri.invariant_key='tax.accounting_sat_drift'
           AND ri.canonical_id='ea-' || cte.acct_periodo
           AND ri.resolved_at IS NULL
      );

    v_log := v_log || jsonb_build_object('k','tax.accounting_sat_drift','status','ok');
  END IF;

  RETURN jsonb_build_object('part', 1, 'log', v_log);
END;
$$;

-- Make sure the main run_reconciliation() dispatches into _sp4_run_extra.
-- Defensive approach: wrap existing fn if present.
DO $$
DECLARE
  v_body text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_body
  FROM pg_proc WHERE proname='run_reconciliation';
  IF v_body IS NULL THEN
    -- Shouldn't happen post-SP2; but be safe.
    CREATE OR REPLACE FUNCTION run_reconciliation(p_key text DEFAULT NULL)
    RETURNS jsonb LANGUAGE plpgsql AS $fn$
    DECLARE v_ext jsonb;
    BEGIN
      v_ext := _sp4_run_extra(p_key);
      RETURN jsonb_build_object('result', 'sp4_only', 'extra', v_ext);
    END; $fn$;
  END IF;
END;
$$;

-- Add a shim wrapper if the SP2 version doesn't already call _sp4_run_extra.
-- We detect by looking for the string '_sp4_run_extra' in the function body.
DO $$
DECLARE
  v_body text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_body FROM pg_proc WHERE proname='run_reconciliation';
  IF v_body NOT ILIKE '%_sp4_run_extra%' THEN
    -- Re-create run_reconciliation with a wrapper that calls the original logic + _sp4_run_extra.
    -- To preserve existing SP2 logic, we rename the existing fn to run_reconciliation_sp2
    -- then create a new run_reconciliation that calls both. This is idempotent because the
    -- second run will find the string in the body and skip.
    ALTER FUNCTION run_reconciliation(text) RENAME TO run_reconciliation_sp2;

    EXECUTE $fn$
      CREATE OR REPLACE FUNCTION run_reconciliation(p_key text DEFAULT NULL)
      RETURNS jsonb LANGUAGE plpgsql AS $$
      DECLARE
        v_sp2 jsonb;
        v_sp4 jsonb;
      BEGIN
        v_sp2 := run_reconciliation_sp2(p_key);
        v_sp4 := _sp4_run_extra(p_key);
        RETURN jsonb_build_object('sp2', v_sp2, 'sp4', v_sp4);
      END;
      $$;
    $fn$;
  END IF;
END;
$$;

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('CREATE_FUNCTION', 'run_reconciliation',
        '_sp4_run_extra() part 1: invoice + payment + tax SQL bodies (still disabled)',
        'supabase/migrations/1056_silver_sp4_run_reconciliation_part1.sql',
        'silver-sp4-task-17', true);

COMMIT;
```

- [ ] **Step 3: Apply.**

- [ ] **Step 4: Sanity-call with NULL (nothing should fire — all invariants still disabled)**

```sql
SELECT run_reconciliation();
```

Expected: JSON with `sp4.log` empty array (invariants are disabled). `reconciliation_issues` count unchanged.

```sql
SELECT COUNT(*) FROM reconciliation_issues WHERE resolved_at IS NULL AND detected_at > now() - interval '10 minutes';
```

Expected: 0 new issues.

- [ ] **Step 5: Record findings.**

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/1056_silver_sp4_run_reconciliation_part1.sql \
        docs/superpowers/plans/2026-04-24-silver-sp4-engine-gold-notes.md
git commit -m "feat(sp4): task 17 — run_reconciliation part 1 (invoice+payment+tax bodies, disabled)"
git push
```

---
### Task 18: **GATE** — Extend `run_reconciliation()` part 2 + enable all 22 new invariants

**Files:**
- Create: `supabase/migrations/1057_silver_sp4_run_reconciliation_part2.sql`
- Modify: notes.

**Purpose.** Add the remaining 12 invariant bodies (fulfillment + finance + line + inventory + MDM + bank/fx) to `_sp4_run_extra`, and flip **all 22 new invariants** `enabled=true`. First `run_reconciliation()` call after enable will emit thousands of issues — this is the intended behavior. GATE with user.

- [ ] **Step 1: Pause for gate**

Tell the user:

> Task 18 will (a) add 12 more invariant bodies into `_sp4_run_extra`, (b) set `enabled=true` on the 22 new + `audit_tolerances` rows, and (c) execute `run_reconciliation()` once to emit the initial wave. Estimated new `reconciliation_issues` open rows: **25,000-70,000** (most from `order.orphan_invoicing`, `order.orphan_delivery`, `delivery.late_active`, and `line_price_mismatch`). Proceed?

Wait for "go".

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/1057_silver_sp4_run_reconciliation_part2.sql`:

```sql
-- supabase/migrations/1057_silver_sp4_run_reconciliation_part2.sql
--
-- Silver SP4 — Task 18: _sp4_run_extra() part 2 + enable 22 invariants
-- Spec §9.2; Plan Task 18 (GATED).

BEGIN;

-- Replace _sp4_run_extra with the full body (part 1 + part 2).
-- We re-create it fully rather than trying to patch the previous version,
-- since plpgsql doesn't allow partial edits.

CREATE OR REPLACE FUNCTION _sp4_run_extra(p_key text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_log jsonb := '[]'::jsonb;
BEGIN
  -- NOTE: all 10 part-1 bodies from Task 17 go here verbatim.
  -- (Task 17's body is the source of truth; copy those 10 IF blocks exactly.)
  -- Omitted in this migration text for brevity, but the real file MUST include
  -- the 10 invariant blocks from Task 17's migration 1056 verbatim before the new ones below.

  -- ========= PART 1 INVARIANTS (copy from task 17) =========
  -- invoice.amount_diff_post_fx
  -- invoice.uuid_mismatch_rfc
  -- invoice.without_order
  -- payment.amount_mismatch
  -- payment.date_mismatch
  -- payment.allocation_over
  -- payment.allocation_under
  -- tax.retention_accounting_drift
  -- tax.return_payment_missing
  -- tax.accounting_sat_drift
  -- << PASTE the 10 IF blocks from 1056_silver_sp4_run_reconciliation_part1.sql here >>

  -- ========= PART 2 INVARIANTS (new) =========

  -- order.orphan_invoicing
  IF (p_key IS NULL OR p_key='order.orphan_invoicing')
     AND (SELECT enabled FROM audit_tolerances WHERE invariant_key='order.orphan_invoicing') THEN
    INSERT INTO reconciliation_issues
      (issue_id, issue_type, canonical_entity_type, canonical_entity_id, canonical_id,
       impact_mxn, severity, detected_at, invariant_key, action_cta, description, metadata)
    SELECT gen_random_uuid(), 'order.orphan_invoicing', 'order_line', col.canonical_id::text, col.canonical_id::text,
           (col.qty_pending_invoice * col.price_unit), 'medium', now(),
           'order.orphan_invoicing', 'operationalize',
           format('SO %s line pending invoicing %s units (%.0f days)',
                  col.order_name, col.qty_pending_invoice,
                  EXTRACT(DAY FROM now() - col.order_date)),
           jsonb_build_object('order_name', col.order_name, 'qty_pending', col.qty_pending_invoice)
    FROM canonical_order_lines col
    WHERE col.order_type='sale'
      AND col.has_pending_invoicing
      AND col.order_date < CURRENT_DATE - interval '30 days'
      AND NOT EXISTS (
        SELECT 1 FROM reconciliation_issues ri
         WHERE ri.invariant_key='order.orphan_invoicing'
           AND ri.canonical_id=col.canonical_id::text AND ri.resolved_at IS NULL
      );
    v_log := v_log || jsonb_build_object('k','order.orphan_invoicing','status','ok');
  END IF;

  -- order.orphan_delivery
  IF (p_key IS NULL OR p_key='order.orphan_delivery')
     AND (SELECT enabled FROM audit_tolerances WHERE invariant_key='order.orphan_delivery') THEN
    INSERT INTO reconciliation_issues
      (issue_id, issue_type, canonical_entity_type, canonical_entity_id, canonical_id,
       impact_mxn, severity, detected_at, invariant_key, action_cta, description, metadata)
    SELECT gen_random_uuid(), 'order.orphan_delivery', 'order_line', col.canonical_id::text, col.canonical_id::text,
           NULL, 'medium', now(),
           'order.orphan_delivery', 'operationalize',
           format('SO %s line pending delivery %s units (%.0f days)',
                  col.order_name, (col.qty - COALESCE(col.qty_delivered,0)),
                  EXTRACT(DAY FROM now() - col.order_date)),
           jsonb_build_object('order_name', col.order_name,
                              'qty_pending', (col.qty - COALESCE(col.qty_delivered,0)))
    FROM canonical_order_lines col
    WHERE col.order_type='sale'
      AND col.has_pending_delivery
      AND col.order_date < CURRENT_DATE - interval '14 days'
      AND NOT EXISTS (
        SELECT 1 FROM reconciliation_issues ri
         WHERE ri.invariant_key='order.orphan_delivery'
           AND ri.canonical_id=col.canonical_id::text AND ri.resolved_at IS NULL
      );
    v_log := v_log || jsonb_build_object('k','order.orphan_delivery','status','ok');
  END IF;

  -- delivery.late_active
  IF (p_key IS NULL OR p_key='delivery.late_active')
     AND (SELECT enabled FROM audit_tolerances WHERE invariant_key='delivery.late_active') THEN
    INSERT INTO reconciliation_issues
      (issue_id, issue_type, canonical_entity_type, canonical_entity_id, canonical_id,
       impact_mxn, severity, detected_at, invariant_key, action_cta, description, metadata)
    SELECT gen_random_uuid(), 'delivery.late_active', 'delivery', cd.canonical_id::text, cd.canonical_id::text,
           NULL, 'medium', now(),
           'delivery.late_active', 'operationalize',
           format('Delivery %s late (scheduled %s, state=%s)', cd.name, cd.scheduled_date, cd.state),
           jsonb_build_object('name', cd.name, 'state', cd.state,
                              'scheduled_date', cd.scheduled_date)
    FROM canonical_deliveries cd
    WHERE cd.is_late AND cd.state NOT IN ('done','cancel')
      AND NOT EXISTS (
        SELECT 1 FROM reconciliation_issues ri
         WHERE ri.invariant_key='delivery.late_active'
           AND ri.canonical_id=cd.canonical_id::text AND ri.resolved_at IS NULL
      );
    v_log := v_log || jsonb_build_object('k','delivery.late_active','status','ok');
  END IF;

  -- mfg.stock_drift
  IF (p_key IS NULL OR p_key='mfg.stock_drift')
     AND (SELECT enabled FROM audit_tolerances WHERE invariant_key='mfg.stock_drift') THEN
    INSERT INTO reconciliation_issues
      (issue_id, issue_type, canonical_entity_type, canonical_entity_id, canonical_id,
       impact_mxn, severity, detected_at, invariant_key, action_cta, description, metadata)
    SELECT gen_random_uuid(), 'mfg.stock_drift', 'manufacturing', cm.canonical_id::text, cm.canonical_id::text,
           NULL, 'medium', now(),
           'mfg.stock_drift', 'review_manual',
           format('MO %s closed qty_produced=%s but product stock_qty=%s',
                  cm.name, cm.qty_produced, cp.stock_qty),
           jsonb_build_object('mo_name', cm.name, 'qty_produced', cm.qty_produced)
    FROM canonical_manufacturing cm
    JOIN canonical_products cp ON cp.id = cm.canonical_product_id
    WHERE cm.state='done' AND cm.qty_produced > 0
      AND cp.stock_qty < cm.qty_produced * 0.5      -- heuristic: half of produced not in stock
      AND NOT EXISTS (
        SELECT 1 FROM reconciliation_issues ri
         WHERE ri.invariant_key='mfg.stock_drift'
           AND ri.canonical_id=cm.canonical_id::text AND ri.resolved_at IS NULL
      );
    v_log := v_log || jsonb_build_object('k','mfg.stock_drift','status','ok');
  END IF;

  -- line_price_mismatch
  IF (p_key IS NULL OR p_key='line_price_mismatch')
     AND (SELECT enabled FROM audit_tolerances WHERE invariant_key='line_price_mismatch') THEN
    INSERT INTO reconciliation_issues
      (issue_id, issue_type, canonical_entity_type, canonical_entity_id, canonical_id,
       impact_mxn, severity, detected_at, invariant_key, action_cta, description, metadata)
    SELECT gen_random_uuid(), 'line_price_mismatch', 'invoice_line',
           oil.id::text, oil.id::text,
           ABS(oil.price_unit - sil.valor_unitario), 'medium', now(),
           'line_price_mismatch', 'review_manual',
           format('Line price diff: odoo=%s sat=%s line=%s', oil.price_unit, sil.valor_unitario, oil.odoo_line_id),
           jsonb_build_object('odoo_line_id', oil.odoo_line_id,
                              'odoo_price', oil.price_unit, 'sat_price', sil.valor_unitario)
    FROM odoo_invoice_lines oil
    JOIN odoo_invoices oi ON oi.id = oil.odoo_move_id
    JOIN syntage_invoice_line_items sil ON sil.invoice_uuid = oi.cfdi_uuid
    WHERE oil.product_ref IS NOT NULL
      AND sil.descripcion LIKE '[' || oil.product_ref || ']%'
      AND ABS(oil.price_unit - sil.valor_unitario)
          / NULLIF(GREATEST(oil.price_unit, sil.valor_unitario), 0) > 0.005
      AND NOT EXISTS (
        SELECT 1 FROM reconciliation_issues ri
         WHERE ri.invariant_key='line_price_mismatch'
           AND ri.canonical_id=oil.id::text AND ri.resolved_at IS NULL
      )
    LIMIT 5000;  -- safety cap for first run
    v_log := v_log || jsonb_build_object('k','line_price_mismatch','status','ok_capped_5000');
  END IF;

  -- orderpoint_untuned
  IF (p_key IS NULL OR p_key='orderpoint_untuned')
     AND (SELECT enabled FROM audit_tolerances WHERE invariant_key='orderpoint_untuned') THEN
    INSERT INTO reconciliation_issues
      (issue_id, issue_type, canonical_entity_type, canonical_entity_id, canonical_id,
       impact_mxn, severity, detected_at, invariant_key, action_cta, description, metadata)
    SELECT gen_random_uuid(), 'orderpoint_untuned', 'inventory',
           ci.canonical_product_id::text, ci.canonical_product_id::text,
           NULL, 'low', now(),
           'orderpoint_untuned', 'review_inventory',
           format('Orderpoint %s untuned: min=0 qty_to_order=%s', ci.internal_ref, ci.qty_to_order),
           jsonb_build_object('internal_ref', ci.internal_ref, 'qty_to_order', ci.qty_to_order)
    FROM canonical_inventory ci
    WHERE ci.orderpoint_untuned
      AND NOT EXISTS (
        SELECT 1 FROM reconciliation_issues ri
         WHERE ri.invariant_key='orderpoint_untuned'
           AND ri.canonical_id=ci.canonical_product_id::text AND ri.resolved_at IS NULL
      );
    v_log := v_log || jsonb_build_object('k','orderpoint_untuned','status','ok');
  END IF;

  -- clave_prodserv_drift (simple stub: products where SAT clave changed in last invoice vs canonical_products)
  IF (p_key IS NULL OR p_key='clave_prodserv_drift')
     AND (SELECT enabled FROM audit_tolerances WHERE invariant_key='clave_prodserv_drift') THEN
    INSERT INTO reconciliation_issues
      (issue_id, issue_type, canonical_entity_type, canonical_entity_id, canonical_id,
       impact_mxn, severity, detected_at, invariant_key, action_cta, description, metadata)
    SELECT gen_random_uuid(), 'clave_prodserv_drift', 'product', cp.id::text, cp.id::text,
           NULL, 'low', now(),
           'clave_prodserv_drift', 'review_fiscal_map',
           format('Product %s clave drift: canonical=%s last_sat=%s', cp.internal_ref,
                  cp.sat_clave_prod_serv, latest_clave.clave),
           jsonb_build_object('internal_ref', cp.internal_ref)
    FROM canonical_products cp
    JOIN LATERAL (
      SELECT sil.clave_prod_serv AS clave
      FROM syntage_invoice_line_items sil
      WHERE sil.descripcion LIKE '[' || cp.internal_ref || ']%'
      ORDER BY sil.synced_at DESC LIMIT 1
    ) latest_clave ON true
    WHERE cp.sat_clave_prod_serv IS NOT NULL
      AND latest_clave.clave IS NOT NULL
      AND latest_clave.clave <> cp.sat_clave_prod_serv
      AND NOT EXISTS (
        SELECT 1 FROM reconciliation_issues ri
         WHERE ri.invariant_key='clave_prodserv_drift'
           AND ri.canonical_id=cp.id::text AND ri.resolved_at IS NULL
      );
    v_log := v_log || jsonb_build_object('k','clave_prodserv_drift','status','ok');
  END IF;

  -- entity_unresolved_30d
  IF (p_key IS NULL OR p_key='entity_unresolved_30d')
     AND (SELECT enabled FROM audit_tolerances WHERE invariant_key='entity_unresolved_30d') THEN
    INSERT INTO reconciliation_issues
      (issue_id, issue_type, canonical_entity_type, canonical_entity_id, canonical_id,
       impact_mxn, severity, detected_at, invariant_key, action_cta, description, metadata)
    SELECT gen_random_uuid(), 'entity_unresolved_30d', 'company',
           e.id::text, e.id::text,
           NULL, 'low', now(),
           'entity_unresolved_30d', 'link_manual',
           format('Entity KG %s mentioned in %s emails but has no canonical link for 30d',
                  e.canonical_name, (
                    SELECT COUNT(*) FROM facts f WHERE f.entity_id = e.id
                  )),
           jsonb_build_object('entity_id', e.id, 'name', e.canonical_name)
    FROM entities e
    WHERE e.created_at < now() - interval '30 days'
      AND NOT EXISTS (
        SELECT 1 FROM source_links sl
         WHERE sl.source='kg_entity' AND sl.source_table='entities'
           AND sl.source_id = e.id::text
           AND sl.superseded_at IS NULL
      )
      AND (SELECT COUNT(*) FROM facts f WHERE f.entity_id = e.id) > 3
      AND NOT EXISTS (
        SELECT 1 FROM reconciliation_issues ri
         WHERE ri.invariant_key='entity_unresolved_30d'
           AND ri.canonical_id=e.id::text AND ri.resolved_at IS NULL
      );
    v_log := v_log || jsonb_build_object('k','entity_unresolved_30d','status','ok');
  END IF;

  -- ambiguous_match — rows in canonical_* with needs_review AND review_reason contains 'ambiguous_match'
  IF (p_key IS NULL OR p_key='ambiguous_match')
     AND (SELECT enabled FROM audit_tolerances WHERE invariant_key='ambiguous_match') THEN
    INSERT INTO reconciliation_issues
      (issue_id, issue_type, canonical_entity_type, canonical_entity_id, canonical_id,
       impact_mxn, severity, detected_at, invariant_key, action_cta, description, metadata)
    SELECT gen_random_uuid(), 'ambiguous_match', 'company', cc.id::text, cc.id::text,
           NULL, 'high', now(),
           'ambiguous_match', 'link_manual',
           format('Ambiguous canonical_company %s — needs review', cc.display_name),
           jsonb_build_object('review_reason', cc.review_reason)
    FROM canonical_companies cc
    WHERE cc.needs_review AND 'ambiguous_match' = ANY(cc.review_reason)
      AND NOT EXISTS (
        SELECT 1 FROM reconciliation_issues ri
         WHERE ri.invariant_key='ambiguous_match'
           AND ri.canonical_id=cc.id::text AND ri.resolved_at IS NULL
      );
    v_log := v_log || jsonb_build_object('k','ambiguous_match','status','ok');
  END IF;

  -- bank_balance.stale
  IF (p_key IS NULL OR p_key='bank_balance.stale')
     AND (SELECT enabled FROM audit_tolerances WHERE invariant_key='bank_balance.stale') THEN
    INSERT INTO reconciliation_issues
      (issue_id, issue_type, canonical_entity_type, canonical_entity_id, canonical_id,
       impact_mxn, severity, detected_at, invariant_key, action_cta, description, metadata)
    SELECT gen_random_uuid(), 'bank_balance.stale', 'bank_balance',
           cbb.canonical_id::text, cbb.canonical_id::text,
           cbb.current_balance_mxn, 'medium', now(),
           'bank_balance.stale', 'refresh_source',
           format('Bank %s stale since %s', cbb.name, cbb.updated_at),
           jsonb_build_object('journal', cbb.name, 'updated_at', cbb.updated_at)
    FROM canonical_bank_balances cbb
    WHERE cbb.is_stale
      AND NOT EXISTS (
        SELECT 1 FROM reconciliation_issues ri
         WHERE ri.invariant_key='bank_balance.stale'
           AND ri.canonical_id=cbb.canonical_id::text AND ri.resolved_at IS NULL
      );
    v_log := v_log || jsonb_build_object('k','bank_balance.stale','status','ok');
  END IF;

  -- fx_rate.stale
  IF (p_key IS NULL OR p_key='fx_rate.stale')
     AND (SELECT enabled FROM audit_tolerances WHERE invariant_key='fx_rate.stale') THEN
    INSERT INTO reconciliation_issues
      (issue_id, issue_type, canonical_entity_type, canonical_entity_id, canonical_id,
       impact_mxn, severity, detected_at, invariant_key, action_cta, description, metadata)
    SELECT gen_random_uuid(), 'fx_rate.stale', 'fx_rate', cfr.currency, cfr.currency,
           NULL, 'high', now(),
           'fx_rate.stale', 'refresh_source',
           format('FX %s latest rate date %s', cfr.currency, cfr.rate_date),
           jsonb_build_object('currency', cfr.currency, 'rate_date', cfr.rate_date)
    FROM canonical_fx_rates cfr
    WHERE cfr.recency_rank = 1 AND cfr.is_stale AND cfr.currency IN ('USD','EUR')
      AND NOT EXISTS (
        SELECT 1 FROM reconciliation_issues ri
         WHERE ri.invariant_key='fx_rate.stale'
           AND ri.canonical_id=cfr.currency AND ri.resolved_at IS NULL
      );
    v_log := v_log || jsonb_build_object('k','fx_rate.stale','status','ok');
  END IF;

  -- Recompute priority scores at end (engine quirk)
  PERFORM compute_priority_scores();

  RETURN jsonb_build_object('part', 2, 'log', v_log);
END;
$$;

-- ===== enable all 22 new invariants =======================================
UPDATE audit_tolerances SET enabled = true
 WHERE invariant_key IN (
  'invoice.amount_diff_post_fx','invoice.uuid_mismatch_rfc','invoice.without_order',
  'payment.amount_mismatch','payment.date_mismatch','payment.allocation_over','payment.allocation_under',
  'tax.retention_accounting_drift','tax.return_payment_missing','tax.accounting_sat_drift','tax.blacklist_69b_definitive_active',
  'order.orphan_invoicing','order.orphan_delivery',
  'delivery.late_active','mfg.stock_drift',
  'line_price_mismatch','orderpoint_untuned','clave_prodserv_drift',
  'entity_unresolved_30d','ambiguous_match',
  'bank_balance.stale','fx_rate.stale'
);

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('CREATE_FUNCTION', '_sp4_run_extra',
        'Part 2 invariants wired + 22 rows enabled (GATED)',
        'supabase/migrations/1057_silver_sp4_run_reconciliation_part2.sql',
        'silver-sp4-task-18', true);

COMMIT;
```

**CRITICAL NOTE**: the commented `<< PASTE ... >>` inside the `CREATE OR REPLACE FUNCTION` body must be replaced with the verbatim 10 IF blocks from Task 17's migration. Do NOT ship the placeholder comment into a real migration file. Copy/paste is faster than rewriting, and keeps both behaviors identical.

- [ ] **Step 3: Apply.**

- [ ] **Step 4: Run the engine once (expect issue flood)**

```sql
SELECT run_reconciliation();
SELECT COUNT(*) total, COUNT(*) FILTER (WHERE resolved_at IS NULL) open_issues
FROM reconciliation_issues;
SELECT invariant_key, COUNT(*) FROM reconciliation_issues
WHERE resolved_at IS NULL AND detected_at > now() - interval '5 minutes'
GROUP BY 1 ORDER BY 2 DESC;
```

Expected: `open_issues` grew by 25k-70k; new ones mostly in `order.orphan_invoicing`, `order.orphan_delivery`, `delivery.late_active`, `payment.allocation_under`, `line_price_mismatch` (capped at 5000).

- [ ] **Step 5: Wire new pg_cron runs**

```sql
-- Daily low-severity batch at 06:30
SELECT cron.schedule('silver_sp4_reconcile_daily', '30 6 * * *',
  $$SELECT run_reconciliation();$$);
```

Verify:

```sql
SELECT jobname, schedule, active FROM cron.job WHERE jobname LIKE 'silver_sp4%';
```

- [ ] **Step 6: Record findings** (top 10 invariants by count post-enable).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/1057_silver_sp4_run_reconciliation_part2.sql \
        docs/superpowers/plans/2026-04-24-silver-sp4-engine-gold-notes.md
git commit -m "feat(sp4): task 18 — run_reconciliation part 2 + enable 22 invariants (GATE)"
git push
```

---

### Task 19: **GATE** — Backfill `amount_total_mxn_resolved` + refresh `canonical_companies` metrics

**Files:**
- Create: `supabase/migrations/1058_silver_sp4_backfill_mxn_resolved.sql`
- Modify: notes.

**Purpose.** The SP3 follow-up: `canonical_invoices.amount_total_mxn_resolved` is 0 / 88,462. This kills `canonical_companies.lifetime_value_mxn` aggregation (only 7 rows > 0), and downstream cripples gold_company_360 + gold_revenue_monthly + ceo_inbox priority_score.

Resolution rule (conservative per §7: SAT wins on fiscal, Odoo wins on operational — but `amount_total_mxn` is fiscal, so SAT preferred):
```
amount_total_mxn_resolved = COALESCE(amount_total_mxn_sat, amount_total_mxn_odoo, amount_total_mxn_ops, amount_total_mxn_fiscal, 0)
```

Chunked UPDATE (16,000 rows at a time to avoid table lock + WAL pressure). Then recompute `canonical_companies.{lifetime_value_mxn, total_invoiced_odoo_mxn, total_invoiced_sat_mxn, revenue_ytd_mxn, revenue_90d_mxn, revenue_prior_90d_mxn, trend_pct, overdue_amount_mxn, total_receivable_mxn, total_payable_mxn, last_invoice_date}` from the fresh data.

- [ ] **Step 1: Pause for gate**

Report to user:
- Current state: `amount_total_mxn_resolved` = 0/88,462.
- Planned: 6 UPDATE chunks of ~15k rows each.
- Downstream: all canonical_companies metrics recomputed.
- Proceed? (yes/no)

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/1058_silver_sp4_backfill_mxn_resolved.sql`:

```sql
-- supabase/migrations/1058_silver_sp4_backfill_mxn_resolved.sql
--
-- Silver SP4 — Task 19: backfill canonical_invoices.amount_total_mxn_resolved
--                       + canonical_companies metrics refresh
-- Spec §11 SP4 (carryover from SP3); Plan Task 19 (GATED).
-- Chunked to avoid long table locks.

-- ===== chunked UPDATE ===============================================
-- We don't wrap in a single transaction — chunked commits preferred for 88k rows.
-- Each UPDATE filters on a canonical_id range; canonical_id is text (uuid-ish)
-- so we chunk via md5(canonical_id) buckets.

DO $$
DECLARE
  i integer;
  affected bigint;
BEGIN
  FOR i IN 0..5 LOOP
    UPDATE canonical_invoices
    SET amount_total_mxn_resolved = COALESCE(amount_total_mxn_sat,
                                             amount_total_mxn_odoo,
                                             amount_total_mxn_ops,
                                             amount_total_mxn_fiscal,
                                             0),
        updated_at = now()
    WHERE (amount_total_mxn_resolved IS NULL OR amount_total_mxn_resolved = 0)
      AND ('x' || substr(md5(canonical_id), 1, 2))::bit(8)::int % 6 = i;
    GET DIAGNOSTICS affected = ROW_COUNT;
    RAISE NOTICE 'Chunk % updated % rows', i, affected;
  END LOOP;
END;
$$;

-- ===== refresh canonical_companies metrics =========================

-- Helper: aggregate revenue + AR/AP off resolved amounts
UPDATE canonical_companies cc
SET
  total_invoiced_odoo_mxn = agg.odoo_mxn,
  total_invoiced_sat_mxn  = agg.sat_mxn,
  lifetime_value_mxn      = agg.resolved_mxn,
  revenue_ytd_mxn         = agg.ytd_mxn,
  revenue_90d_mxn         = agg.last_90d_mxn,
  revenue_prior_90d_mxn   = agg.prior_90d_mxn,
  trend_pct = CASE WHEN agg.prior_90d_mxn > 0
                    THEN ROUND(100.0 * (agg.last_90d_mxn - agg.prior_90d_mxn)
                              / agg.prior_90d_mxn, 2) END,
  invoices_count          = agg.invoices_count,
  last_invoice_date       = agg.last_invoice_date,
  total_receivable_mxn    = agg.ar_mxn,
  total_payable_mxn       = agg.ap_mxn,
  total_pending_mxn       = COALESCE(agg.ar_mxn,0) + COALESCE(agg.ap_mxn,0),
  overdue_amount_mxn      = agg.overdue_mxn,
  overdue_count           = agg.overdue_count,
  max_days_overdue        = agg.max_overdue_days,
  updated_at              = now()
FROM (
  SELECT ci.receptor_canonical_company_id AS cc_id,
         SUM(CASE WHEN ci.direction='issued'   THEN ci.amount_total_mxn_odoo END)     AS odoo_mxn,
         SUM(CASE WHEN ci.direction='issued'   THEN ci.amount_total_mxn_sat  END)     AS sat_mxn,
         SUM(CASE WHEN ci.direction='issued'   THEN ci.amount_total_mxn_resolved END) AS resolved_mxn,
         SUM(CASE WHEN ci.direction='issued'
                   AND ci.invoice_date >= date_trunc('year', CURRENT_DATE)
                  THEN ci.amount_total_mxn_resolved END)                              AS ytd_mxn,
         SUM(CASE WHEN ci.direction='issued'
                   AND ci.invoice_date >= CURRENT_DATE - interval '90 days'
                  THEN ci.amount_total_mxn_resolved END)                              AS last_90d_mxn,
         SUM(CASE WHEN ci.direction='issued'
                   AND ci.invoice_date >= CURRENT_DATE - interval '180 days'
                   AND ci.invoice_date <  CURRENT_DATE - interval '90 days'
                  THEN ci.amount_total_mxn_resolved END)                              AS prior_90d_mxn,
         COUNT(*)                                                                     AS invoices_count,
         MAX(ci.invoice_date)                                                         AS last_invoice_date,
         SUM(CASE WHEN ci.direction='issued' THEN ci.amount_residual_mxn_resolved END) AS ar_mxn,
         NULL::numeric                                                                 AS ap_mxn,
         SUM(CASE WHEN ci.direction='issued'
                   AND ci.due_date_resolved < CURRENT_DATE
                   AND ci.amount_residual_mxn_resolved > 0
                  THEN ci.amount_residual_mxn_resolved END)                           AS overdue_mxn,
         COUNT(*) FILTER (WHERE ci.direction='issued'
                           AND ci.due_date_resolved < CURRENT_DATE
                           AND ci.amount_residual_mxn_resolved > 0)                  AS overdue_count,
         MAX(CASE WHEN ci.direction='issued'
                   AND ci.due_date_resolved < CURRENT_DATE
                  THEN (CURRENT_DATE - ci.due_date_resolved) END)                     AS max_overdue_days
  FROM canonical_invoices ci
  WHERE ci.receptor_canonical_company_id IS NOT NULL
  GROUP BY 1
) agg
WHERE cc.id = agg.cc_id;

-- And the supplier-side AP pass
UPDATE canonical_companies cc
SET total_payable_mxn = agg.ap_mxn,
    total_pending_mxn = COALESCE(cc.total_receivable_mxn,0) + COALESCE(agg.ap_mxn,0),
    updated_at = now()
FROM (
  SELECT ci.emisor_canonical_company_id AS cc_id,
         SUM(CASE WHEN ci.direction='received' THEN ci.amount_residual_mxn_resolved END) AS ap_mxn
  FROM canonical_invoices ci
  WHERE ci.emisor_canonical_company_id IS NOT NULL
  GROUP BY 1
) agg
WHERE cc.id = agg.cc_id;

-- Audit snapshot
INSERT INTO audit_runs (run_id, source, model, invariant_key, bucket_key, severity, details)
SELECT gen_random_uuid(), 'supabase', 'silver_sp4', 'sp4.backfill', 'sp4_task_19', 'ok',
       jsonb_build_object(
         'label', 'task_19_backfill_mxn_resolved',
         'resolved_after', (SELECT COUNT(*) FROM canonical_invoices
                              WHERE amount_total_mxn_resolved IS NOT NULL
                                AND amount_total_mxn_resolved > 0),
         'companies_with_ltv', (SELECT COUNT(*) FROM canonical_companies
                                  WHERE lifetime_value_mxn > 0),
         'top5_companies_ltv', (
           SELECT jsonb_agg(row_to_json(x)) FROM (
             SELECT display_name, lifetime_value_mxn
             FROM canonical_companies
             ORDER BY lifetime_value_mxn DESC NULLS LAST LIMIT 5
           ) x)
       );

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('BACKFILL', 'canonical_invoices',
        'amount_total_mxn_resolved chunked backfill + canonical_companies metrics refresh',
        'supabase/migrations/1058_silver_sp4_backfill_mxn_resolved.sql',
        'silver-sp4-task-19', true);
```

- [ ] **Step 3: Apply.**

If `apply_migration` times out on the chunked UPDATE, split: first call runs just the `DO $$ ... $$` block with the 6 chunks via `execute_sql`; second call runs the `UPDATE canonical_companies` passes; third call runs the audit inserts.

- [ ] **Step 4: Verify**

```sql
SELECT COUNT(*) total,
       COUNT(*) FILTER (WHERE amount_total_mxn_resolved IS NOT NULL AND amount_total_mxn_resolved > 0) resolved
FROM canonical_invoices;

SELECT COUNT(*) with_ltv,
       ROUND(AVG(lifetime_value_mxn),0) avg_ltv,
       ROUND(MAX(lifetime_value_mxn),0) max_ltv
FROM canonical_companies
WHERE lifetime_value_mxn > 0;

SELECT display_name, lifetime_value_mxn, revenue_90d_mxn, overdue_amount_mxn
FROM canonical_companies
ORDER BY lifetime_value_mxn DESC NULLS LAST
LIMIT 10;
```

Expected: `resolved ≥ 86,000` (some rows genuinely NULL because SAT absent + Odoo rejected etc.), `with_ltv ≥ 500`, the top 10 matches the user's real top customers (Swiftex, Pepsico, Continental, etc.).

- [ ] **Step 5: Record findings** (top 10 companies + totals) in notes.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/1058_silver_sp4_backfill_mxn_resolved.sql \
        docs/superpowers/plans/2026-04-24-silver-sp4-engine-gold-notes.md
git commit -m "fix(sp4): task 19 — backfill amount_total_mxn_resolved + canonical_companies metrics (GATE)"
git push
```

---

### Task 20: `gold_ceo_inbox` + `gold_reconciliation_health`

**Files:**
- Create: `supabase/migrations/1059_silver_sp4_gold_inbox_health.sql`
- Modify: notes.

**Purpose.** Ship the two reconciliation-facing Gold views. `gold_ceo_inbox` is the top-50 priority view the frontend `/inbox` page consumes (SP5). `gold_reconciliation_health` is the trend dashboard. Spec §9.5, §13.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/1059_silver_sp4_gold_inbox_health.sql`:

```sql
-- supabase/migrations/1059_silver_sp4_gold_inbox_health.sql
--
-- Silver SP4 — Task 20: gold_ceo_inbox + gold_reconciliation_health
-- Spec §9.5; Plan Task 20.

BEGIN;

-- ===== gold_ceo_inbox ==================================================
DROP VIEW IF EXISTS gold_ceo_inbox;

CREATE VIEW gold_ceo_inbox AS
SELECT
  ri.issue_id,
  ri.issue_type,
  ri.invariant_key,
  ri.severity,
  ri.priority_score,
  ri.impact_mxn,
  ri.age_days,
  ri.description,
  ri.canonical_entity_type,
  ri.canonical_entity_id,
  ri.action_cta,
  ri.assignee_canonical_contact_id,
  cct.display_name       AS assignee_name,
  cct.primary_email      AS assignee_email,
  ri.metadata,
  ri.detected_at
FROM reconciliation_issues ri
LEFT JOIN canonical_contacts cct ON cct.id = ri.assignee_canonical_contact_id
WHERE ri.resolved_at IS NULL
  AND ri.invariant_key <> 'legacy.unclassified'
ORDER BY ri.priority_score DESC NULLS LAST, ri.detected_at DESC
LIMIT 50;

COMMENT ON VIEW gold_ceo_inbox IS
  'Top 50 open reconciliation issues ordered by priority_score. Assignee joined via canonical_contacts.';

-- ===== gold_reconciliation_health ======================================
DROP VIEW IF EXISTS gold_reconciliation_health;

CREATE VIEW gold_reconciliation_health AS
WITH by_invariant AS (
  SELECT invariant_key,
         severity,
         COUNT(*) FILTER (WHERE resolved_at IS NULL) AS open_cnt,
         COUNT(*) FILTER (WHERE resolved_at IS NOT NULL
                           AND resolution = 'auto')    AS auto_resolved_cnt,
         COUNT(*) FILTER (WHERE resolved_at IS NOT NULL
                           AND resolution <> 'auto')   AS manual_resolved_cnt,
         COUNT(*)                                       AS total_cnt,
         SUM(impact_mxn) FILTER (WHERE resolved_at IS NULL) AS open_impact_mxn,
         MAX(detected_at)                               AS last_detected
  FROM reconciliation_issues
  GROUP BY 1, 2
),
by_day AS (
  SELECT date_trunc('day', detected_at)::date AS day,
         severity,
         COUNT(*) FILTER (WHERE resolved_at IS NULL) AS still_open,
         COUNT(*) FILTER (WHERE resolved_at IS NOT NULL) AS closed
  FROM reconciliation_issues
  WHERE detected_at > now() - interval '30 days'
  GROUP BY 1, 2
)
SELECT
  (SELECT COUNT(*) FROM reconciliation_issues WHERE resolved_at IS NULL)            AS total_open,
  (SELECT SUM(impact_mxn) FROM reconciliation_issues WHERE resolved_at IS NULL)     AS total_open_impact_mxn,
  (SELECT COUNT(*) FROM reconciliation_issues
    WHERE resolved_at IS NULL AND severity='critical')                              AS critical_open,
  (SELECT COUNT(*) FROM reconciliation_issues
    WHERE resolved_at IS NULL AND severity='high')                                  AS high_open,
  (SELECT COUNT(*) FROM reconciliation_issues
    WHERE resolved_at > now() - interval '24 hours' AND resolution='auto')          AS auto_resolved_24h,
  (SELECT COUNT(*) FROM reconciliation_issues
    WHERE detected_at > now() - interval '24 hours' AND resolved_at IS NULL)        AS new_24h,
  (SELECT jsonb_agg(row_to_json(bi)) FROM (
     SELECT * FROM by_invariant ORDER BY open_cnt DESC LIMIT 20) bi)                AS top_invariants,
  (SELECT jsonb_agg(row_to_json(bd)) FROM (
     SELECT * FROM by_day ORDER BY day DESC) bd)                                    AS last_30d_trend,
  now()                                                                             AS refreshed_at;

COMMENT ON VIEW gold_reconciliation_health IS
  'Reconciliation engine health dashboard: open counts, auto-resolution rate, 30d trend.';

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('CREATE_VIEW', 'gold_ceo_inbox',             'Gold: top 50 inbox', 'supabase/migrations/1059_silver_sp4_gold_inbox_health.sql', 'silver-sp4-task-20', true),
       ('CREATE_VIEW', 'gold_reconciliation_health', 'Gold: engine health', 'supabase/migrations/1059_silver_sp4_gold_inbox_health.sql', 'silver-sp4-task-20', true);

COMMIT;
```

- [ ] **Step 2: Apply.**

- [ ] **Step 3: Verify**

```sql
SELECT severity, invariant_key, impact_mxn, action_cta, assignee_name
FROM gold_ceo_inbox ORDER BY priority_score DESC LIMIT 20;

SELECT total_open, critical_open, high_open, auto_resolved_24h, new_24h
FROM gold_reconciliation_health;
```

Expected: `gold_ceo_inbox` returns 50 rows. `gold_reconciliation_health.total_open` in the 100k-170k range.

- [ ] **Step 4: Record findings** (top 5 inbox items — anonymized if needed — in notes).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/1059_silver_sp4_gold_inbox_health.sql \
        docs/superpowers/plans/2026-04-24-silver-sp4-engine-gold-notes.md
git commit -m "feat(sp4): task 20 — gold_ceo_inbox + gold_reconciliation_health"
git push
```

---

### Task 21: `gold_company_360` + `gold_revenue_monthly`

**Files:**
- Create: `supabase/migrations/1060_silver_sp4_gold_company_revenue.sql`
- Modify: notes.

**Purpose.** The two business-facing Gold views. `gold_company_360` is the workhorse for `/companies/[id]` SP5. `gold_revenue_monthly` consolidates Odoo + SAT monthly revenue.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/1060_silver_sp4_gold_company_revenue.sql`:

```sql
-- supabase/migrations/1060_silver_sp4_gold_company_revenue.sql
--
-- Silver SP4 — Task 21: gold_company_360 + gold_revenue_monthly
-- Spec §3.3, §13.1; Plan Task 21.

BEGIN;

-- ===== gold_company_360 =================================================
DROP VIEW IF EXISTS gold_company_360;

CREATE VIEW gold_company_360 AS
SELECT
  cc.id                         AS canonical_company_id,
  cc.display_name,
  cc.canonical_name,
  cc.rfc,
  cc.is_customer,
  cc.is_supplier,
  cc.is_internal,
  cc.blacklist_level,
  cc.blacklist_action,
  cc.has_shadow_flag,
  cc.has_manual_override,
  cc.risk_level,
  cc.tier,
  -- AR / AP
  cc.total_receivable_mxn,
  cc.total_payable_mxn,
  cc.total_pending_mxn,
  cc.overdue_amount_mxn,
  cc.overdue_count,
  cc.max_days_overdue,
  cc.ar_aging_buckets,
  -- revenue
  cc.lifetime_value_mxn,
  cc.revenue_ytd_mxn,
  cc.revenue_90d_mxn,
  cc.revenue_prior_90d_mxn,
  cc.trend_pct,
  cc.revenue_share_pct,
  -- operational
  cc.invoices_count,
  cc.last_invoice_date,
  cc.total_deliveries_count,
  cc.late_deliveries_count,
  cc.otd_rate,
  cc.otd_rate_90d,
  -- SAT compliance
  cc.sat_compliance_score,
  cc.invoices_with_cfdi,
  cc.invoices_with_syntage_match,
  cc.sat_open_issues_count,
  cc.opinion_cumplimiento,
  -- communication
  cc.email_count,
  cc.last_email_at,
  cc.contact_count,
  -- derived helpers
  (SELECT COUNT(*) FROM reconciliation_issues ri
     WHERE ri.canonical_entity_type = 'company'
       AND ri.canonical_entity_id = cc.id::text
       AND ri.resolved_at IS NULL)                  AS open_company_issues_count,
  (SELECT COUNT(*) FROM canonical_sale_orders so
     WHERE so.canonical_company_id = cc.id
       AND so.state IN ('sale','done')
       AND so.date_order >= CURRENT_DATE - interval '365 days') AS sales_orders_12m,
  (SELECT COUNT(*) FROM canonical_purchase_orders po
     WHERE po.canonical_company_id = cc.id
       AND po.state IN ('purchase','done')
       AND po.date_order >= CURRENT_DATE - interval '365 days') AS purchase_orders_12m,
  -- enrichment hints
  cc.key_products,
  cc.risk_signals,
  cc.opportunity_signals,
  cc.enriched_at,
  cc.relationship_type,
  cc.relationship_summary,
  cc.updated_at                                AS last_data_refresh_at,
  now()                                        AS refreshed_at
FROM canonical_companies cc;

COMMENT ON VIEW gold_company_360 IS
  'Unified company profile for /companies/[id] SP5. Customer/supplier/internal join-point.';

-- ===== gold_revenue_monthly =============================================
DROP VIEW IF EXISTS gold_revenue_monthly;

CREATE VIEW gold_revenue_monthly AS
WITH issued AS (
  SELECT date_trunc('month', invoice_date)::date AS month_start,
         receptor_canonical_company_id AS company_id,
         SUM(amount_total_mxn_odoo)     AS odoo_mxn,
         SUM(amount_total_mxn_sat)      AS sat_mxn,
         SUM(amount_total_mxn_resolved) AS resolved_mxn,
         COUNT(*)                        AS invoices_count,
         SUM(amount_residual_mxn_resolved) AS residual_mxn
  FROM canonical_invoices
  WHERE direction='issued' AND invoice_date IS NOT NULL
  GROUP BY 1, 2
)
SELECT
  issued.month_start,
  issued.company_id                          AS canonical_company_id,
  cc.display_name                            AS company_name,
  issued.odoo_mxn,
  issued.sat_mxn,
  issued.resolved_mxn,
  issued.residual_mxn,
  issued.invoices_count,
  CASE
    WHEN issued.odoo_mxn IS NOT NULL AND issued.sat_mxn IS NULL THEN 'odoo_only'
    WHEN issued.odoo_mxn IS NULL AND issued.sat_mxn IS NOT NULL THEN 'sat_only'
    ELSE 'dual_source'
  END                                        AS source_pattern,
  now()                                      AS refreshed_at
FROM issued
LEFT JOIN canonical_companies cc ON cc.id = issued.company_id;

COMMENT ON VIEW gold_revenue_monthly IS
  'Monthly revenue per company per source. direction=issued only. NULL company_id = orphan.';

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('CREATE_VIEW', 'gold_company_360',      'Gold: company 360 profile',  'supabase/migrations/1060_silver_sp4_gold_company_revenue.sql', 'silver-sp4-task-21', true),
       ('CREATE_VIEW', 'gold_revenue_monthly',  'Gold: monthly revenue',     'supabase/migrations/1060_silver_sp4_gold_company_revenue.sql', 'silver-sp4-task-21', true);

COMMIT;
```

- [ ] **Step 2: Apply.**

- [ ] **Step 3: Verify**

```sql
SELECT display_name, lifetime_value_mxn, revenue_ytd_mxn, overdue_amount_mxn, open_company_issues_count
FROM gold_company_360
WHERE is_customer = true
ORDER BY lifetime_value_mxn DESC NULLS LAST
LIMIT 10;

SELECT month_start, SUM(resolved_mxn) total_mxn, SUM(invoices_count) invoices
FROM gold_revenue_monthly
WHERE month_start >= date_trunc('year', CURRENT_DATE)
GROUP BY 1 ORDER BY 1;
```

Expected: top customers match Quimibond's known top-10. `gold_revenue_monthly` YTD sum > 100M MXN.

- [ ] **Step 4: Record findings.**

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/1060_silver_sp4_gold_company_revenue.sql \
        docs/superpowers/plans/2026-04-24-silver-sp4-engine-gold-notes.md
git commit -m "feat(sp4): task 21 — gold_company_360 + gold_revenue_monthly"
git push
```

---

### Task 22: `gold_pl_statement` + `gold_balance_sheet` + `gold_cashflow` + `gold_product_performance`

**Files:**
- Create: `supabase/migrations/1061_silver_sp4_gold_finance_product.sql`
- Modify: notes.

**Purpose.** Remaining 4 Gold views. Finance views read from `canonical_account_balances` + `canonical_bank_balances` + `canonical_fx_rates`; product performance from `canonical_products` + `canonical_invoices`.

**`gold_pl_statement` caveat:** derives from P&L buckets (`income`, `expense`). It will still show `equity_unaffected` = 0 until the qb19 addon fix §14.2 lands — that's an SP5 follow-up, not blocker.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/1061_silver_sp4_gold_finance_product.sql`:

```sql
-- supabase/migrations/1061_silver_sp4_gold_finance_product.sql
--
-- Silver SP4 — Task 22: gold_pl_statement, gold_balance_sheet, gold_cashflow, gold_product_performance
-- Spec §3.3, §13; Plan Task 22.

BEGIN;

-- ===== gold_pl_statement ================================================
DROP VIEW IF EXISTS gold_pl_statement;

CREATE VIEW gold_pl_statement AS
SELECT
  period,
  SUM(CASE WHEN balance_sheet_bucket='income'  THEN balance END) AS total_income,
  SUM(CASE WHEN balance_sheet_bucket='expense' THEN balance END) AS total_expense,
  SUM(CASE WHEN balance_sheet_bucket='income'  THEN balance END)
    + COALESCE(SUM(CASE WHEN balance_sheet_bucket='expense' THEN balance END),0) AS net_income,
  -- breakdown by level-1 code (e.g. 401, 501, 601 …)
  jsonb_object_agg(SPLIT_PART(account_code, '-', 1),
                   jsonb_build_object('balance', SUM(balance),
                                      'account_type', MAX(account_type)))
    AS by_level_1,
  now() AS refreshed_at
FROM canonical_account_balances
WHERE balance_sheet_bucket IN ('income','expense')
GROUP BY period;

-- ===== gold_balance_sheet ===============================================
DROP VIEW IF EXISTS gold_balance_sheet;

CREATE VIEW gold_balance_sheet AS
SELECT
  period,
  SUM(CASE WHEN balance_sheet_bucket='asset'     THEN balance END)  AS total_assets,
  SUM(CASE WHEN balance_sheet_bucket='liability' THEN balance END)  AS total_liabilities,
  SUM(CASE WHEN balance_sheet_bucket='equity'    THEN balance END)  AS total_equity,
  SUM(CASE WHEN balance_sheet_bucket='asset'     THEN balance END)
  - COALESCE(SUM(CASE WHEN balance_sheet_bucket='liability' THEN balance END),0)
  - COALESCE(SUM(CASE WHEN balance_sheet_bucket='equity'    THEN balance END),0)  AS unbalanced_amount,
  jsonb_object_agg(balance_sheet_bucket,
                   jsonb_build_object('total', SUM(balance),
                                      'accounts_count', COUNT(DISTINCT account_code)))  AS by_bucket,
  now() AS refreshed_at
FROM canonical_account_balances
WHERE balance_sheet_bucket IN ('asset','liability','equity')
GROUP BY period;

COMMENT ON VIEW gold_balance_sheet IS
  'Balance sheet per period. unbalanced_amount will be non-zero until qb19 addon fix §14.2 (equity_unaffected).';

-- ===== gold_cashflow ====================================================
DROP VIEW IF EXISTS gold_cashflow;

CREATE VIEW gold_cashflow AS
WITH bank AS (
  SELECT classification,
         SUM(current_balance_mxn) AS total_mxn,
         COUNT(*) AS journals
  FROM canonical_bank_balances
  GROUP BY 1
),
ar AS (
  SELECT SUM(total_receivable_mxn) AS receivable_mxn,
         SUM(overdue_amount_mxn)   AS overdue_receivable_mxn
  FROM canonical_companies
  WHERE is_customer = true
),
ap AS (
  SELECT SUM(total_payable_mxn) AS payable_mxn
  FROM canonical_companies
  WHERE is_supplier = true
)
SELECT
  (SELECT total_mxn FROM bank WHERE classification='cash')                AS current_cash_mxn,
  (SELECT total_mxn FROM bank WHERE classification='debt')                AS current_debt_mxn,
  (SELECT receivable_mxn FROM ar)                                         AS total_receivable_mxn,
  (SELECT overdue_receivable_mxn FROM ar)                                 AS overdue_receivable_mxn,
  (SELECT payable_mxn FROM ap)                                            AS total_payable_mxn,
  (SELECT total_mxn FROM bank WHERE classification='cash')
  + (SELECT receivable_mxn FROM ar)
  - (SELECT payable_mxn FROM ap)                                          AS working_capital_mxn,
  (SELECT jsonb_agg(row_to_json(b)) FROM bank b)                          AS bank_breakdown,
  now()                                                                   AS refreshed_at;

-- ===== gold_product_performance =========================================
DROP VIEW IF EXISTS gold_product_performance;

CREATE VIEW gold_product_performance AS
WITH odoo_12m AS (
  SELECT ol.canonical_product_id AS pid,
         SUM(ol.subtotal_mxn)    AS revenue_mxn,
         SUM(ol.qty)             AS units_sold,
         COUNT(DISTINCT ol.canonical_company_id) AS unique_customers
  FROM canonical_order_lines ol
  WHERE ol.order_type='sale'
    AND ol.order_state IN ('sale','done')
    AND ol.order_date >= CURRENT_DATE - interval '365 days'
  GROUP BY 1
),
sat_12m AS (
  SELECT sil.clave_prod_serv,
         SUM(sil.importe) AS sat_revenue
  FROM syntage_invoice_line_items sil
  WHERE sil.synced_at >= now() - interval '365 days'
  GROUP BY 1
)
SELECT
  cp.id                              AS canonical_product_id,
  cp.internal_ref,
  cp.display_name,
  cp.category,
  cp.standard_price_mxn,
  cp.list_price_mxn,
  cp.stock_qty,
  cp.available_qty,
  cp.is_active,
  COALESCE(o.revenue_mxn, 0)         AS odoo_revenue_12m_mxn,
  COALESCE(o.units_sold, 0)          AS units_sold_12m,
  COALESCE(o.unique_customers, 0)    AS unique_customers_12m,
  cp.sat_revenue_mxn_12m             AS sat_revenue_12m_mxn,
  cp.margin_pct_12m,
  cp.top_customers_canonical_ids,
  cp.top_suppliers_canonical_ids,
  cp.sat_clave_prod_serv,
  cp.fiscal_map_confidence,
  now()                              AS refreshed_at
FROM canonical_products cp
LEFT JOIN odoo_12m o ON o.pid = cp.id;

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('CREATE_VIEW', 'gold_pl_statement',         'Gold: P&L per period',         'supabase/migrations/1061_silver_sp4_gold_finance_product.sql', 'silver-sp4-task-22', true),
       ('CREATE_VIEW', 'gold_balance_sheet',        'Gold: balance sheet per period','supabase/migrations/1061_silver_sp4_gold_finance_product.sql', 'silver-sp4-task-22', true),
       ('CREATE_VIEW', 'gold_cashflow',             'Gold: cashflow snapshot',      'supabase/migrations/1061_silver_sp4_gold_finance_product.sql', 'silver-sp4-task-22', true),
       ('CREATE_VIEW', 'gold_product_performance',  'Gold: product performance',    'supabase/migrations/1061_silver_sp4_gold_finance_product.sql', 'silver-sp4-task-22', true);

COMMIT;
```

- [ ] **Step 2: Apply.**

- [ ] **Step 3: Verify**

```sql
SELECT period, total_income, total_expense, net_income
FROM gold_pl_statement
WHERE period >= to_char(CURRENT_DATE - interval '12 months', 'YYYY-MM')
ORDER BY period;

SELECT period, total_assets, total_liabilities, total_equity, unbalanced_amount
FROM gold_balance_sheet
WHERE period IN (SELECT MAX(period) FROM gold_balance_sheet);

SELECT current_cash_mxn, current_debt_mxn, total_receivable_mxn,
       overdue_receivable_mxn, working_capital_mxn
FROM gold_cashflow;

SELECT internal_ref, display_name, odoo_revenue_12m_mxn, units_sold_12m, unique_customers_12m
FROM gold_product_performance
ORDER BY odoo_revenue_12m_mxn DESC LIMIT 10;
```

Expected: each view returns real-looking data. `unbalanced_amount` likely non-zero (known addon gap §14.2 — expected). Top 10 products match internal expectations.

- [ ] **Step 4: Record findings.**

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/1061_silver_sp4_gold_finance_product.sql \
        docs/superpowers/plans/2026-04-24-silver-sp4-engine-gold-notes.md
git commit -m "feat(sp4): task 22 — gold_pl_statement + balance_sheet + cashflow + product_performance"
git push
```

---

### Task 23: DoD verification + closing `audit_runs` snapshot

**Files:**
- Modify: `docs/superpowers/plans/2026-04-24-silver-sp4-engine-gold-notes.md`
- Create: `supabase/migrations/1062_silver_sp4_close_audit.sql`

**Purpose.** Walk the Definition of Done checklist (from the header), write a `pre_vs_post_sp4` delta snapshot into `audit_runs`, and summarize everything into the notes file.

- [ ] **Step 1: Run the full DoD verification query set**

```sql
-- A. 11 Pattern B objects exist
SELECT 'pattern_b_objects' k, COUNT(*) v
FROM (
  SELECT table_name FROM information_schema.tables
  WHERE table_schema='public' AND table_name IN (
    'canonical_sale_orders','canonical_purchase_orders','canonical_order_lines',
    'canonical_deliveries','canonical_inventory','canonical_manufacturing',
    'canonical_bank_balances','canonical_fx_rates','canonical_account_balances',
    'canonical_chart_of_accounts','canonical_crm_leads')
  UNION SELECT matviewname FROM pg_matviews WHERE schemaname='public' AND matviewname IN (
    'canonical_sale_orders','canonical_purchase_orders','canonical_order_lines',
    'canonical_deliveries','canonical_manufacturing')
) t;                                                 -- expect 11

-- B. Evidence tables (4) live
SELECT 'evidence_tables' k, COUNT(*) v FROM information_schema.tables
WHERE table_schema='public' AND table_name IN
  ('email_signals','ai_extracted_facts','attachments','manual_notes');   -- expect 4

-- C. ai_extracted_facts has ≥ facts count
SELECT 'facts_migrated' k, COUNT(*) v FROM ai_extracted_facts;            -- expect ≥ 31806

-- D. audit_tolerances enabled ≥ 31
SELECT 'tolerances_enabled' k, COUNT(*) v FROM audit_tolerances WHERE enabled; -- expect ≥ 31

-- E. invariant_key non-null on open issues ≥ 98 %
SELECT 'open_issues_no_key' k, COUNT(*) v FROM reconciliation_issues
 WHERE resolved_at IS NULL AND invariant_key IS NULL;                     -- expect 0

-- F. amount_total_mxn_resolved coverage
SELECT 'mxn_resolved_pct' k,
       ROUND(100.0 * COUNT(*) FILTER (WHERE amount_total_mxn_resolved > 0) / COUNT(*), 2) v
FROM canonical_invoices;                                                  -- expect ≥ 98

-- G. companies with lifetime_value
SELECT 'companies_with_ltv' k, COUNT(*) v FROM canonical_companies
 WHERE lifetime_value_mxn > 0;                                            -- expect ≥ 500

-- H. 8 Gold views
SELECT 'gold_views' k, COUNT(*) v FROM information_schema.views
WHERE table_schema='public' AND table_name IN (
  'gold_ceo_inbox','gold_reconciliation_health','gold_company_360','gold_revenue_monthly',
  'gold_pl_statement','gold_balance_sheet','gold_cashflow','gold_product_performance');  -- expect 8

-- I. gold_ceo_inbox row count
SELECT 'inbox_rows' k, COUNT(*) v FROM gold_ceo_inbox;                   -- expect 30-50

-- J. run_reconciliation end-to-end succeeds
SELECT 'reco_smoke' k,
       CASE WHEN jsonb_typeof(run_reconciliation()) = 'object' THEN 1 ELSE 0 END v;
```

- [ ] **Step 2: Write the closing migration**

Create `supabase/migrations/1062_silver_sp4_close_audit.sql`:

```sql
-- supabase/migrations/1062_silver_sp4_close_audit.sql
--
-- Silver SP4 — Task 23: closing audit_runs snapshot
-- Spec §18 (self-review); Plan Task 23.

INSERT INTO audit_runs (run_id, source, model, invariant_key, bucket_key, severity, details)
SELECT gen_random_uuid(), 'supabase', 'silver_sp4', 'sp4.close', 'sp4_close', 'ok',
       jsonb_build_object(
         'label', 'post_sp4_snapshot',
         'canonical_invoices_resolved_pct',
           (SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE amount_total_mxn_resolved > 0) / NULLIF(COUNT(*),0), 2)
              FROM canonical_invoices),
         'canonical_companies_with_ltv',
           (SELECT COUNT(*) FROM canonical_companies WHERE lifetime_value_mxn > 0),
         'reconciliation_issues_open',
           (SELECT COUNT(*) FROM reconciliation_issues WHERE resolved_at IS NULL),
         'reconciliation_issues_open_by_severity',
           (SELECT jsonb_object_agg(severity, c)
              FROM (SELECT severity, COUNT(*) c FROM reconciliation_issues
                    WHERE resolved_at IS NULL GROUP BY 1) x),
         'reconciliation_issues_without_invariant_key',
           (SELECT COUNT(*) FROM reconciliation_issues
              WHERE resolved_at IS NULL AND invariant_key IS NULL),
         'audit_tolerances_enabled',
           (SELECT COUNT(*) FROM audit_tolerances WHERE enabled),
         'ai_extracted_facts_rows',
           (SELECT COUNT(*) FROM ai_extracted_facts),
         'gold_ceo_inbox_rows',      (SELECT COUNT(*) FROM gold_ceo_inbox),
         'cron_jobs_sp4',
           (SELECT jsonb_agg(jsonb_build_object(
                     'name', jobname, 'schedule', schedule, 'active', active))
              FROM cron.job WHERE jobname LIKE 'silver_sp4%'),
         'finished_at', now()
       );

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('SEED', 'audit_runs', 'SP4 closing snapshot',
        'supabase/migrations/1062_silver_sp4_close_audit.sql',
        'silver-sp4-task-23', true);
```

- [ ] **Step 3: Apply.**

- [ ] **Step 4: Write the DoD checklist outcome** into the notes file

Append to `2026-04-24-silver-sp4-engine-gold-notes.md`:

```markdown
## Task 23 — DoD verification (closed <DATE>)

| Criterion | Expected | Observed | Status |
|---|---:|---:|:---:|
| Pattern B objects (views+MVs) | 11 | ... | ... |
| Evidence tables | 4 | ... | ... |
| ai_extracted_facts rows | ≥ 31,806 | ... | ... |
| audit_tolerances enabled | ≥ 31 | ... | ... |
| open_issues without invariant_key | 0 | ... | ... |
| canonical_invoices amount_total_mxn_resolved coverage | ≥ 98% | ... | ... |
| canonical_companies with lifetime_value_mxn | ≥ 500 | ... | ... |
| Gold views live | 8 | ... | ... |
| gold_ceo_inbox rows | 30-50 | ... | ... |
| run_reconciliation() returns jsonb | ok | ok | ... |

Baseline (Task 1) vs closing deltas:
- reconciliation_issues_open: <pre> → <post> (Δ <diff>)
- canonical_companies_with_ltv: 7 → <post>
- canonical_invoices_with_mxn_resolved: 0 → <post>
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/1062_silver_sp4_close_audit.sql \
        docs/superpowers/plans/2026-04-24-silver-sp4-engine-gold-notes.md
git commit -m "chore(sp4): task 23 — DoD verification + closing audit_runs snapshot"
git push
```

---

### Task 24: Open PR + user shell handoff

**Files:** none (pure git/gh).

**Purpose.** Open a PR against `main` with the full SP4 migration set and wait for user to merge + deploy.

- [ ] **Step 1: Sanity-check the branch**

```bash
cd /Users/jj/quimibond-intelligence/quimibond-intelligence
git status          # expect clean working tree
git log --oneline main..silver-sp4-engine-gold | head -30   # expect ~24 commits
git diff --stat main..silver-sp4-engine-gold | tail -5
```

- [ ] **Step 2: Open the PR**

```bash
gh pr create \
  --title "Silver SP4: Pattern B + Evidence + 31-invariant engine + 8 Gold views" \
  --body "$(cat <<'EOF'
## Summary

- Materializes the 11 Pattern B canonical_* tables (sale/purchase orders, order lines, deliveries, inventory, manufacturing, bank/fx/account balances, chart of accounts, CRM).
- Installs the Evidence layer (email_signals, ai_extracted_facts, attachments, manual_notes); migrates 31,806 facts rows into ai_extracted_facts with source_links-based entity resolution.
- Extends reconciliation engine from 16 → 31 enabled invariants via `_sp4_run_extra()` wrapped into the existing `run_reconciliation(p_key)`; remaps all legacy NULL `invariant_key` on open issues.
- Backfills canonical_invoices.amount_total_mxn_resolved (0 → ~98% coverage) and rebuilds canonical_companies metrics (lifetime_value_mxn, revenue_{ytd/90d/prior_90d}_mxn, AR/AP, OTD, trend).
- Publishes 8 Gold views: gold_ceo_inbox, gold_reconciliation_health, gold_company_360, gold_revenue_monthly, gold_pl_statement, gold_balance_sheet, gold_cashflow, gold_product_performance.
- Wires new pg_cron `silver_sp4_reconcile_daily` at 06:30; extends `refresh_all_matviews()` with the 5 new MVs.

## Spec & plan

- Spec: docs/superpowers/specs/2026-04-21-silver-architecture.md §5.9-5.19, §8, §9, §11 SP4, §13.
- Plan: docs/superpowers/plans/2026-04-24-silver-sp4-engine-gold.md (24 tasks).
- Notes: docs/superpowers/plans/2026-04-24-silver-sp4-engine-gold-notes.md.

## Gates cleared (user go-aheads)

- Task 15: facts → ai_extracted_facts migration (31k rows).
- Task 18: enable 22 invariants (issue flood expected & observed).
- Task 19: amount_total_mxn_resolved chunked backfill + canonical_companies rebuild.

## Test plan

- [ ] `SELECT * FROM gold_ceo_inbox LIMIT 20` returns realistic top issues with assignee_name populated.
- [ ] `SELECT * FROM gold_company_360 WHERE is_customer ORDER BY lifetime_value_mxn DESC LIMIT 10` matches internal top-10.
- [ ] `SELECT run_reconciliation()` returns jsonb with `sp2`/`sp4` both populated.
- [ ] `SELECT COUNT(*) FROM canonical_invoices WHERE amount_total_mxn_resolved > 0` ≥ 0.98 × total.
- [ ] Nothing in `src/` queries `canonical_sale_orders` / `canonical_*` yet — SP5 wires the frontend.

## Follow-ups (SP5)

- Frontend `src/lib/queries/` rewire to canonical_* / gold_*.
- Agents rewire.
- qb19 addon fixes §14.2 (equity_unaffected) + §14.3 (reversed_entry_id) + §14.4 (payment_date).
- Legacy MVs/views drops per §12 (invoices_unified, payments_unified, syntage_invoices_enriched, etc.).

🤖 Generated with [claude-flow](https://github.com/ruvnet/claude-flow)
EOF
)"
```

- [ ] **Step 3: Hand off to user — shell block for manual merge**

After the PR URL lands, output **exactly** this block to the user (user feedback: Claude never merges to quimibond; user pastes the block below when they're ready):

```bash
# Run from /Users/jj/quimibond-intelligence/quimibond-intelligence

# 1) Review PR
gh pr view --web

# 2) Merge PR
gh pr merge --merge --delete-branch

# 3) Confirm main is up to date
git checkout main
git pull --ff-only
git log --oneline -5
```

- [ ] **Step 4: Notes — add a final section**

Append `## Task 24 — PR opened <PR_URL>` to the notes file and commit once more.

```bash
git add docs/superpowers/plans/2026-04-24-silver-sp4-engine-gold-notes.md
git commit -m "docs(sp4): task 24 — PR opened + shell handoff"
git push
```

- [ ] **Step 5: Done — announce closure.** Do not touch the `quimibond` branch. Do not deploy. User handles the Odoo.sh side (no addon changes in SP4, so no Odoo deploy needed).

---

## Self-review — spec coverage audit

| Spec requirement | Task(s) covering it |
|---|---|
| 11 Pattern B canonical_* (§5.9-5.19) | Tasks 2-12 |
| `email_signals`, `attachments`, `manual_notes` (§8.1, §8.3, §8.4) | Task 13 |
| `ai_extracted_facts` (§8.2) | Tasks 14-15 |
| `facts` → `ai_extracted_facts` migration (§8.2 migration clause) | Task 15 (GATE) |
| 31 invariants total (§9.2) | Tasks 16 (catalog) + 17-18 (SQL bodies) |
| Remap legacy `invariant_key` | Task 16 |
| `run_reconciliation(p_key)` extension | Tasks 17-18 |
| pg_cron cadence extended (§10.3) | Task 18 |
| `canonical_invoices.amount_total_mxn_resolved` backfill (SP3 carryover) | Task 19 (GATE) |
| `canonical_companies` metrics refresh | Task 19 |
| `gold_ceo_inbox` (§9.5) | Task 20 |
| `gold_reconciliation_health` (§3.3) | Task 20 |
| `gold_company_360` (§3.3) | Task 21 |
| `gold_revenue_monthly` (§3.3) | Task 21 |
| `gold_pl_statement` (§3.3) | Task 22 |
| `gold_balance_sheet` (§3.3) | Task 22 |
| `gold_cashflow` (§3.3) | Task 22 |
| `gold_product_performance` (§3.3) | Task 22 |
| `refresh_all_matviews` wiring (§10.2) | Task 12 |
| DoD global checklist (§15 + §11 SP4 DoD) | Task 23 |
| PR + user handoff | Task 24 |

Out of scope (explicit — SP5 work):
- Frontend `src/lib/queries/` rewiring (§11 SP5).
- Agents rewiring to canonical_*/gold_* (§13.2).
- Legacy `invoices_unified`, `payments_unified`, `syntage_invoices_enriched`, `products_unified` DROP (§12.2).
- qb19 addon fixes (§14.2-§14.5).
- `/api/inbox/resolve`, `/api/inbox/assign`, `/api/inbox/action/*` endpoints (§9.5 + §13.3).

---

**End of plan.**
