# Silver SP5 — Frontend + Agents + Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cutover the Quimibond Intelligence frontend and the 9 agents to read exclusively from `canonical_*` / `gold_*` (Silver + Gold), land the three qb19 addon fixes the Silver engine needs (§14.2 equity_unaffected, §14.3 reversed_entry_id, §14.4 payment_date), run the three residual backfills that SP4 left behind (`amount_residual_mxn_resolved`, assignee routing, NULL invariant_keys), drop the legacy MV/view/table graveyard per spec §12, and certify the architecture Definition of Done.

**Architecture:** SP5 is the consumer-side migration that closes the Silver Architecture. SP2-SP4 built Silver + Gold in parallel to the live system; SP5 flips every consumer (frontend pages, query libraries, agent system prompts, API routes) from Bronze/legacy to canonical/gold, then removes the legacy layer safely via a two-phase drop (rename `_deprecated_sp5` → physical DROP after 24-hour soak). Addon §14.2-§14.4 fixes close the last schema gaps that keep `gold_balance_sheet.unbalanced_amount` non-zero and degrade credit-note matching. No schema/semantic changes to canonical/gold tables in SP5 — all the authoritative work happened in SP2-SP4; SP5 is pure migration + cleanup + certification.

**Tech Stack:** Next.js 15 + React 19 + TypeScript (frontend, Vercel), Supabase JS client `.from()` / `.rpc()` calls (queries), PostgreSQL 15 + pg_cron (Supabase `tozqezmivpblmcubmnpi`), Vitest + integration tests gated on Supabase service key env vars, qb19 Odoo 19 addon (`addons/quimibond_intelligence/models/sync_push.py`, user deploys manually), Supabase MCP (`mcp__claude_ai_Supabase__apply_migration` / `execute_sql` / `list_migrations`).

---

## Context the engineer needs (zero assumed)

This plan assumes an engineer who has never seen this codebase. Read this whole section before Task 1.

### Where things are

- **Live DB:** Supabase project `tozqezmivpblmcubmnpi` at `https://tozqezmivpblmcubmnpi.supabase.co`. Every DB operation goes through the Supabase MCP (`mcp__claude_ai_Supabase__*`) already wired into Claude Code. Never open a psql session.
- **Spec (authoritative):** `docs/superpowers/specs/2026-04-21-silver-architecture.md`. Key sections for SP5: §11 SP5 (lines 2082-2113), §12 (drop list — 2115-2189), §13 (consumer contracts — 2192-2267), §14 (addon changes — 2270-2306), §15 (DoD — 2310-2321).
- **Prior SP plans and notes (read if you hit anything confusing):**
  - `docs/superpowers/plans/2026-04-22-silver-sp2-canonical-cat-a.md` + notes — Pattern A canonical_invoices/payments/credit_notes/tax_events.
  - `docs/superpowers/plans/2026-04-22-silver-sp3-mdm.md` + notes — Pattern C canonical_companies/contacts/products/employees, source_links, mdm_manual_overrides, matcher functions.
  - `docs/superpowers/plans/2026-04-24-silver-sp4-engine-gold.md` + notes — Pattern B wrappers, Evidence layer, 22 new invariants, 8 Gold views.
- **Frontend CLAUDE.md:** `/Users/jj/quimibond-intelligence/quimibond-intelligence/CLAUDE.md` — Odoo→Supabase field mappings, page list, API route list.
- **qb19 CLAUDE.md:** `/Users/jj/CLAUDE.md` — addon version policy (NEVER bump `19.0.30.0.0`), deploy convention (user runs `odoo-update` manually; never push to branch `quimibond`).
- **Plan output (this file):** `docs/superpowers/plans/2026-04-21-silver-sp5-cutover.md`. **You are here.**
- **Notes file (created in Task 1):** `docs/superpowers/plans/2026-04-21-silver-sp5-cutover-notes.md`. Append one section per completed task; include actual query counts, commit hashes, surprises.
- **Git:** work in branch `silver-sp5-cutover` off `main` (`main` head at `a8817f2` post-SP4 merge). **Never push to branch `quimibond`** — that is the Odoo.sh production branch; only the user merges main→quimibond manually.

### Live state you are starting from (verified 2026-04-21)

```
gold_ceo_inbox                          50      (50 critical invoice.posted_without_uuid issues)
gold_reconciliation_health              1 row   (total_open=116,217, critical=12,432, high=59,245)
canonical_companies                  4,359      (1,733 with lifetime_value_mxn > 0)
canonical_contacts                   2,063
canonical_products                   6,004
canonical_employees (view)             179
canonical_invoices                  88,462      (99% amount_total_mxn_resolved, 0% amount_residual_mxn_resolved)
canonical_payments                  43,380
canonical_payment_allocations       25,511
canonical_credit_notes               2,208
canonical_tax_events                   398
canonical_sale_orders               12,364
canonical_purchase_orders            5,673
canonical_order_lines               32,098
canonical_deliveries                25,187
canonical_inventory (view)           6,013
canonical_manufacturing              4,713
canonical_bank_balances (view)          22
canonical_fx_rates (view)              71
canonical_account_balances          11,032
canonical_chart_of_accounts          1,640
canonical_crm_leads                     20
source_links                       172,285
mdm_manual_overrides                    20
ai_extracted_facts                  31,849      (18,980 unresolved → canonical_entity_type='entity_kg')
email_signals                       (populated by pipeline, thousands)
attachments                         (email + CFDI attachments)
manual_notes                        (empty, ready for /api/inbox/resolve)
reconciliation_issues open         116,231
reconciliation_issues NULL invariant_key  123   (SP5 Task 26 remap target)
audit_tolerances enabled                38
```

Active pg_cron jobs (do NOT drop any; SP5 leaves all 7 untouched):

```
refresh-all-matviews                  15 */2 * * *
refresh-syntage-unified               */15 * * * *
silver_sp2_reconcile_hourly           5 * * * *
silver_sp2_reconcile_2h               15 */2 * * *
silver_sp2_refresh_canonical_nightly  30 3 * * *
silver_sp3_matcher_all_pending        35 */2 * * *
silver_sp4_reconcile_daily            30 6 * * *
```

### Project convention: query layer is folder-by-domain, not per-entity

The spec §11 SP5 deliverables list refers to files like `companies.ts`, `invoices.ts`, `payments.ts` etc. **Those filenames do not exist.** The real structure is folder-by-domain:

```
src/lib/queries/
  _shared/           ← used by many pages; shared helpers + fetchers
    _helpers.ts        3.2 KB — pagination / period helpers
    companies.ts      27.1 KB — cross-cutting company fetcher used by most pages (consumers: /empresas, /inbox, /ventas, /compras, /cobranza)
    contacts.ts        7.4 KB — contacts fetcher used by /contactos, /empresas/[id]
    payments.ts        1.6 KB — payment-state helpers
    period-filter.ts   7.2 KB — YTD / trailing-N / custom period filter
    system.ts         20.9 KB — audit_runs / pipeline_logs / schema_changes consumers (/sistema)
    table-params.ts    3.7 KB — URL param helpers
    year-filter.ts       560 B
  analytics/         ← BI/finance queries (the legacy MV consumers)
    currency-rates.ts    1.4 KB
    customer-360.ts      5.3 KB — reads company_profile / analytics_customer_360 → rewrite to gold_company_360
    dashboard.ts         3.3 KB — reads cfo_dashboard + misc → rewrite to gold_*
    finance.ts          34.0 KB — **biggest legacy offender** (invoices_unified, cfo_dashboard, cash_position, pl_estado_resultados, working_capital, partner_payment_profile, account_payment_profile, journal_flow_profile, projected_cash_flow_weekly, get_cashflow_recommendations RPC)
    index.ts            21.4 KB — re-exports + some cross-cutting aggregators
    pnl.ts               1.8 KB — reads pl_estado_resultados
    products.ts         37.2 KB — reads product_margin_analysis, supplier_price_index, customer_product_matrix, supplier_product_matrix, product_real_cost
  fiscal/            ← SAT / Syntage queries (stays Bronze where SAT-authoritative; migrates only consumer calls)
    electronic-accounting.ts   2.9 KB
    fiscal-historical.ts       5.9 KB
    syntage-files.ts           2.4 KB
    syntage-health.ts          7.5 KB
    syntage-reconciliation.ts  2.0 KB
    tax-retentions.ts          3.6 KB
    webhook-events.ts          2.7 KB
  intelligence/      ← insights / evidence / facts
    evidence-helpers.ts        4.4 KB
    evidence.ts                7.1 KB
    insights.ts               10.3 KB
  operational/       ← Odoo operational (the heaviest .from('odoo_*') consumer)
    operations.ts             14.9 KB — deliveries, manufacturing, stock, activities
    purchases.ts              25.4 KB — purchase orders, account payments, supplier insights
    sales.ts                  34.5 KB — sale orders, CRM leads, salespeople
    team.ts                    9.3 KB — users, employees, departments, activities
  unified/           ← LEGACY wrapper — entire folder is SP5 drop candidate
    index.ts                   7.6 KB — re-exports
    invoice-detail.ts          5.1 KB — reads unified_invoices / invoices_unified
    invoices.ts               21.7 KB — reads invoices_unified + unified_payment_allocations
```

### Agents are delivered through API routes, not library files

The spec's "9 agents" live as API route handlers plus library helpers:

```
src/app/api/agents/
  auto-fix/route.ts          ← data-quality agent (cleans linking, dedup)
  cleanup/route.ts           ← Data Quality agent (stale insight expiry)
  evolve/route.ts            ← schema evolution agent
  identity-resolution/route.ts
  learn/route.ts             ← Meta agent (feedback → memories)
  orchestrate/route.ts       ← round-robin dispatcher for the 7 business agents (Sales / Finance / Operations / Relationships / Risk / Growth / Meta) + Odoo + Data Quality
  run/route.ts               ← direct agent execution endpoint
  validate/route.ts          ← validates insights against canonical state
  wake/route.ts              ← health check
src/lib/agents/
  compliance-context.ts      ← blacklist / 69B / opinion_cumplimiento context builder
  confidence-threshold.ts    ← insight scoring
  director-chat-context.ts   ← **15 legacy MV refs** — director chat pulls from multiple legacy views
  director-config.ts         ← director definitions (categorias, departamentos)
  financiero-context.ts      ← **5 legacy MV refs** — finance director context
  fiscal-annotation.ts       ← SAT field enrichment
  grounding.ts               ← anti-hallucination guardrails
  mode-rotation.ts           ← agent mode rotation logic
```

The work in SP5 is to rewrite the inline SQL / `.from()` / `.rpc()` calls inside the orchestrate handler + director-chat-context + financiero-context to read canonical/gold.

### Pages structure

```
src/app/
  _components/                   ← shared app-level components
  api/                           ← see §"API routes" below
  briefings/                     ← 0 direct queries (consumes server components of other pages)
  chat/                          ← 0 direct queries (RAG via /api/chat)
  cobranza/page.tsx              ← 1 query file — AR aging, unpaid invoices
  compras/page.tsx + _components ← 2 query files — purchases dashboard
  contactos/[slug]/ + page.tsx   ← 1 query file — contact list + detail
  directores/<id>/page.tsx       ← director chat (consumes agents)
  empresas/[id]/ + page.tsx      ← 4 query files — company detail (PanoramaTab is the legacy-heavy one)
  equipo/page.tsx                ← 1 query file — team (employees/departments)
  finanzas/page.tsx + _components ← 1 query file + cashflow-recommendations
  inbox/ (index + insight/[id])  ← 3 query files — reads reconciliation_issues + agent_insights (SP5 rewires to gold_ceo_inbox)
  login/page.tsx                 ← auth
  operaciones/page.tsx           ← 1 query file — operations dashboard
  page.tsx (root)                ← 1 query file — landing with dashboard
  productos/page.tsx             ← 1 query file
  profile/page.tsx               ← user profile
  sistema/page.tsx               ← 1 query file — admin (Bronze exception)
  ventas/page.tsx                ← 1 query file — sales dashboard
```

### API routes (33 total)

All routes are Next.js 15 route handlers in `src/app/api/<path>/route.ts`. SP5 touches the following:

- **Agents cluster (9 routes):** `agents/{auto-fix,cleanup,evolve,identity-resolution,learn,orchestrate,run,validate,wake}/route.ts`. Task 19 rewires.
- **Pipeline cluster (impacted):** `pipeline/health-scores/route.ts` (consumes legacy health_scores table — being DROPPED in Task 29; route must be retired or rewritten), `pipeline/refresh-views/route.ts` (triggers MV refresh — adjust list after drops), `pipeline/reconcile/route.ts` (legacy auto-close of insights — still useful post-cutover, re-point to canonical).
- **Inbox cluster (NEW in Task 20):** `inbox/top/route.ts` + `inbox/resolve/route.ts` + `inbox/assign/route.ts` + `inbox/action/operationalize/route.ts` + `inbox/action/link_manual/route.ts`.
- **Syntage cluster (impacted):** `syntage/refresh-unified/route.ts` — currently refreshes `invoices_unified` MV. Must be retired when MV dropped in Task 29.

### Hard-won lessons from SP2-SP4 — do NOT relearn the hard way

1. **`run_reconciliation()` return shape changed in SP4.** Callers expect `{sp2: [...], sp4: {part, log}}`. If you call it from a route handler or test, adapt accordingly.
2. **Odoo Chart of Accounts uses dot separator `.`, not dash `-`.** Any query that does `SPLIT_PART(code, '-', …)` on `odoo_chart_of_accounts.code` is wrong. `canonical_chart_of_accounts` and `gold_pl_statement` already use `.`; match them.
3. **`equity_unaffected` account_type is absent from `odoo_account_balances`** until the qb19 §14.2 fix lands. `gold_balance_sheet.unbalanced_amount` is expected to be non-zero pre-fix; do not treat it as a bug in the frontend. Task 21 lands §14.2; Task 21 post-deploy verification is the gate for trusting `gold_balance_sheet`.
4. **FX historical gap:** `usd_to_mxn('<date before 2026-03-16>')` returns `NULL` (USD seed start) and EUR starts 2026-02-25. Any page that converts historical amounts to MXN must handle NULL explicitly or fall back to `amount_total_mxn_resolved` (already precomputed in `canonical_invoices` with a conservative default). Never treat NULL FX as 0.
5. **`ai_extracted_facts.canonical_entity_type='entity_kg'`** is the sentinel for 18,980 rows that SP4 could not resolve to a canonical_company/contact/product. They are real signals the pipeline extracted from emails but MDM could not resolve. The Relationships agent (Task 19) should UNION `entity_kg` and canonical-resolved rows, but clearly label the unresolved bucket. Frontend pages filtering by `canonical_company_id` only see the resolved subset — document this explicitly where relevant.
6. **mdm_manual_overrides INSERT requires 6 fields:** `override_field` + `override_value` + `action` + `source_link_id` (nullable when action='standalone') + `payload` + `created_by`. SP3 expanded the schema; the old 4-field INSERT from SP2 is broken. Example used in Task 20 `/api/inbox/action/link_manual`.
7. **Quimibond self:** `canonical_companies.id = 868`, `companies.id = 6707`, `taxpayer_rfc = 'QIN140528HN9'`. Any "my own company" filter uses these IDs, never by name match.
8. **Bronze triggers are live.** Any UPDATE to `companies`, `contacts`, `odoo_invoices`, `odoo_users`, `odoo_employees`, `odoo_products`, `syntage_invoices` fires SP3 matcher triggers (auto-create canonical rows + source_links). Do not disable these in SP5. If a test needs isolation, use `.from(...).select(...)` only; never INSERT/UPDATE to Bronze during tests.
9. **`schema_changes` INSERT signature is 6 columns:** `change_type, table_name, description, sql_executed, triggered_by, success`. `affected_rows` does NOT exist. Skip it.
10. **`audit_runs.severity` CHECK constraint: only `ok | warn | error`.** Human-facing labels go in `details->>'label'`.
11. **Do not modify Bronze.** SP5 never INSERTs/UPDATEs into `odoo_*` or `syntage_*`. Addon §14.2-§14.4 make qb19 push more columns; Supabase side adds nullable columns and nothing else.

### Deploy conventions (this is where SP5 interacts with a human)

1. **Frontend (Vercel auto-deploy):** pushing to `main` on `quimibond/quimibond-intelligence` triggers Vercel. Each task in this plan commits to branch `silver-sp5-cutover`. **Do NOT merge to main during execution.** Open the PR only in Task 30. Vercel previews on the branch are acceptable for manual smoke-checks.
2. **qb19 addon (user deploys):** Tasks 21-23 change `addons/quimibond_intelligence/models/sync_push.py` in the qb19 repo (cwd `/Users/jj` shows qb19 is at `5436ddd` on main). The engineer commits the addon change to qb19 `main`. **The user then runs `odoo-update quimibond_intelligence && odoosh-restart http && odoosh-restart cron` in the Odoo.sh shell.** After the user confirms deploy, the engineer runs the post-deploy verification query documented in each addon task.
3. **DB migrations:** apply via `mcp__claude_ai_Supabase__apply_migration` with a sequential number continuing from SP4's last (`1063_silver_sp4_close_audit.sql` was the last). Start SP5 migrations at `1064_*`.
4. **Merge cadence:** user mergea el PR final via `gh pr merge <N> --merge --delete-branch`. Claude nunca mergea.
5. **Destructive ops (DROP table/MV, mass backfill, cron changes) require an explicit gate:** the task states the grep/pg_depend check that must return zero, the engineer runs it, reports the result to the user, and only proceeds if user confirms in-session. Tasks 24, 25, 26, 27, 28, 29 all have explicit gates.

### Testing conventions

- **Test runner:** Vitest (`npm run test`). Integration tests that hit Supabase are gated with:
  ```typescript
  const describeIntegration = process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY ? describe : describe.skip;
  ```
  SP5 tasks add tests that follow this pattern.
- **Type check:** `npm run build` (or `npm run build:local` for 8GB heap) runs `next build` which includes TypeScript compilation. Every query rewire task runs this as the final verification before commit.
- **Lint:** `npm run lint`. Run at end of each file change.
- **DB tests:** shaped as "query returns N rows / columns match" integration tests in `src/__tests__/silver-sp5/`. Example template in Task 3.

### Data shape reference — canonical_* authoritative columns

These are the columns SP5 consumers read. Do not invent new columns; do not rely on columns that SP4 did not ship.

#### canonical_invoices
```
canonical_id                  text PK
direction                     text ('issued' | 'received')
uuid_sat                      text (nullable; SAT UUID)
odoo_move_id                  bigint (nullable)
emisor_canonical_company_id   bigint → canonical_companies.id
receptor_canonical_company_id bigint → canonical_companies.id
salesperson_contact_id        bigint → canonical_contacts.id (for issued)
fecha_timbrado                timestamptz
invoice_date                  date
due_date                      date
days_overdue                  integer (computed by SP4 cron)
amount_total_mxn_resolved     numeric (99% coverage post-SP4)
amount_residual_mxn_resolved  numeric (0% coverage pre-Task-24)
fiscal_estado                 text (SAT status)
odoo_state                    text
odoo_payment_state            text
match_status                  text ('match_uuid' | 'match_composite' | 'odoo_only' | 'sat_only' | 'manual')
fiscal_fully_paid_at          timestamptz (SAT complement authoritative)
fiscal_moneda                 text
fiscal_tipo_cambio            numeric
... (60+ columns total; see canonical_invoices schema or SP2 plan)
```

#### canonical_payments
```
canonical_id                  text PK
canonical_company_id          bigint (counterparty, renamed in SP3 from counterparty_canonical_company_id in schema — verify via `\d canonical_payments` before relying on a column name)
payment_date                  date
amount_mxn                    numeric
currency                      text
method                        text
source                        text ('odoo' | 'sat_complement' | 'manual')
odoo_move_id                  bigint
```

**Important:** before writing any canonical_* query, confirm column names by running:
```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema='public' AND table_name='canonical_<table>' ORDER BY ordinal_position;
```
This plan documents the columns SP5 consumers are known to need; it does NOT duplicate the full schema. Schema drift between plan-writing and execution is handled by always verifying at task start.

#### gold_ceo_inbox (view — 50 rows typical)
```
issue_id                    uuid
issue_type                  text
invariant_key               text (dotted like 'invoice.posted_without_uuid')
severity                    text ('critical' | 'high' | 'medium' | 'low')
priority_score              numeric
impact_mxn                  numeric
age_days                    integer
description                 text
canonical_entity_type       text ('invoice' | 'payment' | 'company' | 'contact' | 'product')
canonical_entity_id         text
action_cta                  text (NULL for most rows pre-SP5; populated by SP5 routing)
assignee_name               text (NULL pre-Task-25)
assignee_email              text
metadata                    jsonb
detected_at                 timestamptz
```

#### gold_company_360
Read as a view. Top-level fields: `canonical_company_id`, `display_name`, `taxpayer_rfc`, `lifetime_value_mxn`, `revenue_ytd_mxn`, `overdue_amount_mxn`, `open_company_issues_count`, `sales_orders_12m`, `last_invoice_at`, `blacklist_level`.

#### gold_revenue_monthly
`period_month` (date, first of month), `canonical_company_id` (nullable for grand-total row), `total_mxn`, `invoices`, `companies`, `source_pattern`.

#### gold_pl_statement / gold_balance_sheet / gold_cashflow
See SP4 Task 22 notes for exact column lists. Frontend consumes these via the existing `analytics/finance.ts` and `analytics/pnl.ts` — Task 5 rewires.

### DoD gates — what "SP5 done" means mechanically

1. `rg "\.from\('odoo_" src/ | wc -l` returns 0 **except** `src/app/sistema/` and `src/app/api/agents/orchestrate/route.ts` where the Odoo agent explicitly reads Bronze for diagnostic purposes (grep exceptions documented as inline comments `// SP5-EXCEPTION: Bronze read for <agent>/<reason>`).
2. `rg "\.from\('syntage_" src/ | wc -l` returns 0 **except** `src/app/sistema/` and syntage-specific diagnostic routes under `/api/syntage/`.
3. `rg "\.from\('(invoices_unified|payments_unified|syntage_invoices_enriched|products_unified|unified_invoices|unified_payment_allocations|invoice_bridge|orders_unified|order_fulfillment_bridge|person_unified|company_profile|company_profile_sat|monthly_revenue_by_company|monthly_revenue_trend|analytics_customer_360|balance_sheet|pl_estado_resultados|revenue_concentration|portfolio_concentration|cash_position|working_capital|working_capital_cycle|cashflow_current_cash|cashflow_liquidity_metrics|customer_margin_analysis|customer_ltv_health|customer_product_matrix|supplier_product_matrix|supplier_price_index|supplier_concentration_herfindahl|rfm_segments|customer_cohorts|partner_payment_profile|account_payment_profile|product_margin_analysis|product_price_history|health_scores|agent_tickets|notification_queue|invoice_bridge_manual|payment_bridge_manual|products_fiscal_map|cross_director_signals|company_email_intelligence|company_handlers|company_insight_history|company_narrative|unified_refresh_queue|reconciliation_summary_daily)'" src/ | wc -l` returns 0.
4. `npm run build` succeeds with 0 type errors.
5. `npm run lint` returns 0 warnings new since `main@a8817f2`.
6. `npm run test -- silver-sp5` passes all SP5-authored tests.
7. `SELECT COUNT(*) FROM gold_ceo_inbox` returns 30-80 (sanity band).
8. `SELECT COUNT(*) FROM canonical_invoices WHERE amount_residual_mxn_resolved IS NULL AND amount_residual > 0` is 0 (Task 24 done).
9. `SELECT COUNT(*) FROM reconciliation_issues WHERE resolved_at IS NULL AND assignee_canonical_contact_id IS NULL` has decreased by ≥50% from 116,231 (Task 25 done).
10. `SELECT COUNT(*) FROM reconciliation_issues WHERE resolved_at IS NULL AND invariant_key IS NULL` is 0 (Task 26 done).
11. Every object in the Task 27-29 drop list returns `relation does not exist` when queried, or does not appear in `pg_class`.
12. `audit_runs` has a row with `details->>'label' = 'silver_architecture_cutover_complete'` (Task 30).

Task 30 verifies all 12 criteria one by one.

---

## File Structure

This is the definitive map of files SP5 touches. Each entry lists the task that owns the change. Some files appear in multiple tasks (e.g. `_shared/companies.ts` is touched by the companies rewrite and re-verified in the DoD task).

### Frontend library files (queries + agents)

| File | Task | Change |
|---|---|---|
| `src/lib/queries/_shared/companies.ts` | 3 | Rewrite all `.from('odoo_*')` / legacy MVs to canonical_companies + gold_company_360 |
| `src/lib/queries/_shared/contacts.ts` | 4 | Rewrite to canonical_contacts + canonical_employees |
| `src/lib/queries/_shared/payments.ts` | 4 | Rewrite payment-state helpers to canonical_payments |
| `src/lib/queries/_shared/system.ts` | 17 | Bronze-allowed exception; add documenting comment |
| `src/lib/queries/analytics/finance.ts` | 5 | Rewrite invoices_unified/cfo_dashboard/cash_position/pl_estado_resultados/working_capital/partner_payment_profile/account_payment_profile/journal_flow_profile to canonical/gold |
| `src/lib/queries/analytics/products.ts` | 6 | Rewrite product_margin_analysis/customer_product_matrix/supplier_product_matrix/supplier_price_index/product_real_cost to canonical/gold |
| `src/lib/queries/analytics/customer-360.ts` | 7 | Rewrite analytics_customer_360 → gold_company_360 |
| `src/lib/queries/analytics/dashboard.ts` | 7 | Rewrite misc to gold_* |
| `src/lib/queries/analytics/pnl.ts` | 7 | Rewrite pl_estado_resultados → gold_pl_statement |
| `src/lib/queries/analytics/currency-rates.ts` | 7 | Retain — already reads canonical_fx_rates OR odoo_currency_rates (Bronze ok, classify if diagnostic) |
| `src/lib/queries/analytics/index.ts` | 7 | Remove re-exports of dropped symbols |
| `src/lib/queries/operational/sales.ts` | 8 | Rewrite odoo_sale_orders → canonical_sale_orders + canonical_order_lines + canonical_crm_leads |
| `src/lib/queries/operational/purchases.ts` | 9 | Rewrite odoo_purchase_orders + odoo_account_payments → canonical_purchase_orders + canonical_payments |
| `src/lib/queries/operational/operations.ts` | 10 | Rewrite odoo_deliveries + odoo_manufacturing → canonical_deliveries + canonical_inventory + canonical_manufacturing |
| `src/lib/queries/operational/team.ts` | 10 | Rewrite odoo_users + odoo_employees → canonical_employees + canonical_contacts |
| `src/lib/queries/unified/invoices.ts` | 11 | Rewrite invoices_unified / unified_payment_allocations → canonical_invoices + canonical_payment_allocations |
| `src/lib/queries/unified/invoice-detail.ts` | 11 | Rewrite unified_invoices → canonical_invoices |
| `src/lib/queries/unified/index.ts` | 11 | Collapse folder; re-export from appropriate domain folder and deprecate |
| `src/lib/agents/director-chat-context.ts` | 18 | Rewrite 15 legacy MV refs to canonical/gold |
| `src/lib/agents/financiero-context.ts` | 18 | Rewrite 5 legacy MV refs to gold_* |
| `src/lib/types.ts` | 2 | Replace hand-written types with `src/lib/database.types.ts` (generated) or import-as-alias |

### Frontend page files

| File | Task | Change |
|---|---|---|
| `src/app/inbox/page.tsx` | 12 | Replace direct reconciliation_issues query with `/api/inbox/top` via gold_ceo_inbox |
| `src/app/inbox/insight/[id]/page.tsx` | 12 | Rewrite supporting detail (agent_insights + evidence layer reads) |
| `src/app/empresas/page.tsx` | 13 | Use `_shared/companies.ts` (rewritten in Task 3) |
| `src/app/empresas/[id]/page.tsx` | 13 | Use canonical_companies + canonical_invoices filtered |
| `src/app/empresas/[id]/_components/PanoramaTab.tsx` | 13 | Rewrite company_profile / company_profile_sat / analytics_customer_360 → gold_company_360 |
| `src/app/ventas/page.tsx` | 14 | Use canonical_sale_orders + gold_revenue_monthly |
| `src/app/compras/page.tsx` | 14 | Use canonical_purchase_orders + canonical_invoices direction='received' |
| `src/app/compras/_components/*.tsx` | 14 | Per-component verification after page rewire |
| `src/app/cobranza/page.tsx` | 14 | Use canonical_invoices WHERE direction='issued' AND amount_residual_mxn_resolved > 0 |
| `src/app/finanzas/page.tsx` | 15 | Use gold_pl_statement + gold_balance_sheet + gold_cashflow |
| `src/app/finanzas/_components/cashflow-recommendations.tsx` | 15 | Rewrite legacy recommendations query |
| `src/app/productos/page.tsx` | 16 | Use canonical_products + gold_product_performance |
| `src/app/operaciones/page.tsx` | 16 | Use canonical_deliveries + canonical_inventory + canonical_manufacturing |
| `src/app/contactos/page.tsx` | 16 | Use canonical_contacts + email_signals |
| `src/app/equipo/page.tsx` | 17 | Use canonical_employees |
| `src/app/directores/<id>/page.tsx` | 17 | Flows through Task 18 director-chat-context rewire |
| `src/app/sistema/page.tsx` | 17 | Add SP5-EXCEPTION comments to Bronze reads (allowed diagnostic scope) |
| `src/app/page.tsx` (root) | 17 | Landing page reads gold_ceo_inbox + gold_company_360 aggregates |
| `src/components/domain/system/SyntageReconciliationPanel.tsx` | 17 | Move to /sistema; annotate as Bronze-allowed |
| `src/components/patterns/company-link.tsx` | 17 | Swap `odoo_invoices` lookup → canonical_invoices |

### API route files

| File | Task | Change |
|---|---|---|
| `src/app/api/inbox/top/route.ts` | 20 | **Create** — GET top N gold_ceo_inbox rows |
| `src/app/api/inbox/resolve/route.ts` | 20 | **Create** — POST `{issue_id, resolution, note?}` → closes issue, appends manual_notes |
| `src/app/api/inbox/assign/route.ts` | 20 | **Create** — POST `{issue_id, assignee_canonical_contact_id}` |
| `src/app/api/inbox/action/operationalize/route.ts` | 20 | **Create** — POST → triggers Odoo-side operationalization |
| `src/app/api/inbox/action/link_manual/route.ts` | 20 | **Create** — POST → opens MDM merge via mdm_manual_overrides |
| `src/app/api/agents/orchestrate/route.ts` | 19 | Rewrite agent query templates |
| `src/app/api/agents/auto-fix/route.ts` | 19 | Rewire to canonical_* |
| `src/app/api/agents/cleanup/route.ts` | 19 | Stop referencing dropped objects |
| `src/app/api/agents/validate/route.ts` | 19 | Validate against canonical_invoices.odoo_payment_state |
| `src/app/api/agents/identity-resolution/route.ts` | 19 | Route reads source_links + mdm_manual_overrides (already canonical-scope — verify only) |
| `src/app/api/agents/learn/route.ts` | 19 | No direct legacy reads; verify only |
| `src/app/api/agents/run/route.ts` | 19 | Direct agent runner; verify delegation path |
| `src/app/api/pipeline/health-scores/route.ts` | 29 | Retire — health_scores table dropped |
| `src/app/api/pipeline/refresh-views/route.ts` | 28 | Remove dropped MVs from refresh list |
| `src/app/api/pipeline/reconcile/route.ts` | 19 | Retarget legacy auto-close to canonical_invoices.odoo_payment_state |
| `src/app/api/syntage/refresh-unified/route.ts` | 29 | Retire — invoices_unified MV dropped |

### DB migrations

| File | Task | Change |
|---|---|---|
| `supabase/migrations/1064_silver_sp5_pre_flight.sql` | 1 | audit_runs snapshot + schema_changes row |
| `supabase/migrations/1065_silver_sp5_amount_residual_mxn_resolved.sql` | 24 | Backfill |
| `supabase/migrations/1066_silver_sp5_assignee_routing.sql` | 25 | Routing function + populate |
| `supabase/migrations/1067_silver_sp5_null_invariant_keys_remap.sql` | 26 | Remap 123 rows |
| `supabase/migrations/1068_silver_sp5_drop_batch_1_wrappers.sql` | 27 | Rename views → _deprecated_sp5 |
| `supabase/migrations/1069_silver_sp5_drop_batch_2_medium_mvs.sql` | 28 | Rename medium MVs → _deprecated_sp5; update refresh_all_matviews() |
| `supabase/migrations/1070_silver_sp5_drop_batch_3_large.sql` | 29 | Rename + final DROP post-soak for large MVs and dead tables |
| `supabase/migrations/1071_silver_sp5_close_audit.sql` | 30 | Closing audit_runs row |

### qb19 addon files

| File | Task | Change |
|---|---|---|
| `addons/quimibond_intelligence/models/sync_push.py` | 21 | `_push_account_balances`: include `equity_unaffected` account_type |
| `addons/quimibond_intelligence/models/sync_push.py` | 22 | `_push_invoices`: add `reversed_entry_id` + push |
| `addons/quimibond_intelligence/models/sync_push.py` | 23 | `_push_invoices`: compute `payment_date` from reconciled move_lines |

(Each addon task is a separate commit on qb19 `main`; user deploys via `odoo-update` between tasks.)

### TypeScript generated types

| File | Task | Change |
|---|---|---|
| `src/lib/database.types.ts` | 2 | Regenerate via `npx supabase gen types typescript` after SP4 state is baseline. Re-run in Task 30. |

### Notes file (created in Task 1, appended each task)

`docs/superpowers/plans/2026-04-21-silver-sp5-cutover-notes.md`

---

### Task 1: Pre-flight baseline + branch cut

**Files:**
- Create: `docs/superpowers/plans/2026-04-21-silver-sp5-cutover-notes.md`
- Apply migration: `supabase/migrations/1064_silver_sp5_pre_flight.sql`

- [ ] **Step 1: Verify you are on `main` at `a8817f2`**

Run:
```bash
cd /Users/jj/quimibond-intelligence/quimibond-intelligence
git status
git log --oneline -1
```
Expected: working tree clean (or only expected untracked files), HEAD at `a8817f2 Merge pull request #47 from quimibond/silver-sp4-engine-gold`. If HEAD is different, pull `main` first. If there are uncommitted changes, STOP and report to user.

- [ ] **Step 2: Cut branch `silver-sp5-cutover`**

Run:
```bash
git checkout -b silver-sp5-cutover
```

- [ ] **Step 3: Create the notes file with the baseline header**

Write this to `docs/superpowers/plans/2026-04-21-silver-sp5-cutover-notes.md`:

```markdown
# Silver SP5 — Execution Notes

Running log of findings per task. Append one section per completed task. Include actual query counts, commit hashes, surprises, deviations from plan.

## Task 1 — Pre-flight (completed YYYY-MM-DD)

Baseline audit_runs row inserted with `details->>'label' = 'pre_sp5_baseline'`.
Branch cut from main @ a8817f2 (post-SP4 merge).
migrations dir writable.

### Baseline counts (from audit_runs row, run at ... UTC)

| Metric | Value |
|---|---|
| canonical_invoices | ... |
| canonical_invoices_with_residual_mxn_resolved | ... |
| canonical_payments | ... |
| canonical_companies_with_ltv | ... |
| reconciliation_issues_open | ... |
| reconciliation_issues_open_null_invariant_key | ... |
| gold_ceo_inbox_rows | ... |
| audit_tolerances_enabled | ... |
```

Leave date/counts blank; filled in Step 6.

- [ ] **Step 4: Apply baseline migration `1064_silver_sp5_pre_flight.sql`**

Use the Supabase MCP:

```sql
-- Migration: 1064_silver_sp5_pre_flight
-- Purpose: record pre_sp5_baseline snapshot before any SP5 rewire/drops
-- Idempotent: uses WHERE NOT EXISTS guards

INSERT INTO audit_runs (run_at, severity, details)
SELECT now(), 'ok', jsonb_build_object(
  'label', 'pre_sp5_baseline',
  'plan',  '2026-04-21-silver-sp5-cutover',
  'counts', jsonb_build_object(
    'canonical_invoices',
      (SELECT COUNT(*) FROM canonical_invoices),
    'canonical_invoices_with_residual_mxn_resolved',
      (SELECT COUNT(*) FROM canonical_invoices WHERE amount_residual_mxn_resolved IS NOT NULL),
    'canonical_invoices_with_open_residual',
      (SELECT COUNT(*) FROM canonical_invoices
        WHERE amount_residual IS NOT NULL AND amount_residual > 0),
    'canonical_payments',
      (SELECT COUNT(*) FROM canonical_payments),
    'canonical_companies_with_ltv',
      (SELECT COUNT(*) FROM canonical_companies WHERE lifetime_value_mxn > 0),
    'reconciliation_issues_open',
      (SELECT COUNT(*) FROM reconciliation_issues WHERE resolved_at IS NULL),
    'reconciliation_issues_open_null_invariant_key',
      (SELECT COUNT(*) FROM reconciliation_issues
        WHERE resolved_at IS NULL AND invariant_key IS NULL),
    'reconciliation_issues_open_null_assignee',
      (SELECT COUNT(*) FROM reconciliation_issues
        WHERE resolved_at IS NULL AND assignee_canonical_contact_id IS NULL),
    'gold_ceo_inbox_rows',
      (SELECT COUNT(*) FROM gold_ceo_inbox),
    'audit_tolerances_enabled',
      (SELECT COUNT(*) FROM audit_tolerances WHERE enabled = true)
  )
)
WHERE NOT EXISTS (
  SELECT 1 FROM audit_runs
  WHERE details->>'label' = 'pre_sp5_baseline'
    AND run_at > now() - interval '1 day'
);

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
SELECT
  'AUDIT_RUN',
  'audit_runs',
  'pre_sp5_baseline snapshot recorded',
  'INSERT audit_runs (label=pre_sp5_baseline)',
  'silver-sp5-task-1',
  true
WHERE NOT EXISTS (
  SELECT 1 FROM schema_changes
  WHERE triggered_by = 'silver-sp5-task-1'
    AND created_at > now() - interval '1 day'
);
```

Apply via `mcp__claude_ai_Supabase__apply_migration` with name `1064_silver_sp5_pre_flight` and the SQL above.

- [ ] **Step 5: Verify snapshot landed**

Run via `mcp__claude_ai_Supabase__execute_sql`:
```sql
SELECT details->'counts'
FROM audit_runs
WHERE details->>'label' = 'pre_sp5_baseline'
ORDER BY run_at DESC LIMIT 1;
```

Expected: JSON with all 10 count keys present and non-zero (except `canonical_invoices_with_residual_mxn_resolved` which is 0 pre-Task-24 and `reconciliation_issues_open_null_invariant_key` which is 123).

- [ ] **Step 6: Fill in the notes file with actual values**

Use `Edit` on `2026-04-21-silver-sp5-cutover-notes.md` to replace the `...` placeholders with the actual counts returned in Step 5. Also replace `YYYY-MM-DD` with today's date.

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/plans/2026-04-21-silver-sp5-cutover.md docs/superpowers/plans/2026-04-21-silver-sp5-cutover-notes.md supabase/migrations/1064_silver_sp5_pre_flight.sql
git commit -m "$(cat <<'EOF'
chore(sp5): task 1 — pre-flight baseline + branch cut

Migration 1064 records pre_sp5_baseline snapshot in audit_runs
with 10 baseline counts for later delta comparison in Task 30.

Co-Authored-By: claude-flow <ruv@ruv.net>
EOF
)"
```

---

### Task 2: Regenerate TypeScript types from canonical_* schema

**Files:**
- Create or overwrite: `src/lib/database.types.ts`
- Modify: `src/lib/types.ts` (update imports; keep hand-written domain types that wrap DB types)

- [ ] **Step 1: Confirm Supabase CLI is authenticated**

Run:
```bash
npx supabase --version
npx supabase projects list 2>&1 | head -5
```
Expected: the CLI is installed (>= v1.200) and listing shows project `tozqezmivpblmcubmnpi`. If the CLI asks for login, stop and report to the user — they run `npx supabase login` interactively.

- [ ] **Step 2: Generate types**

Run:
```bash
npx supabase gen types typescript --project-id tozqezmivpblmcubmnpi --schema public > src/lib/database.types.ts
```

- [ ] **Step 3: Verify generated file**

Run:
```bash
wc -l src/lib/database.types.ts
head -5 src/lib/database.types.ts
grep -c "^export type " src/lib/database.types.ts || true
grep -c "canonical_invoices" src/lib/database.types.ts
grep -c "gold_ceo_inbox" src/lib/database.types.ts
```
Expected: file is >5,000 lines, header is `export type Json = ...`, contains `canonical_invoices` and `gold_ceo_inbox` at least 3 times each (Row/Insert/Update). If `canonical_` count is zero, the generation failed — do NOT proceed; check Supabase auth and re-run Step 2.

- [ ] **Step 4: Add a test that imports a canonical type and type-checks**

Create `src/__tests__/silver-sp5/types.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import type { Database } from "@/lib/database.types";

type CanonicalInvoice = Database["public"]["Tables"]["canonical_invoices"]["Row"];
type GoldCeoInboxRow = Database["public"]["Views"]["gold_ceo_inbox"]["Row"];

describe("silver-sp5 types", () => {
  it("Database type exposes canonical_invoices", () => {
    const stub: Pick<CanonicalInvoice, "canonical_id" | "direction" | "amount_total_mxn_resolved"> = {
      canonical_id: "x",
      direction: "issued",
      amount_total_mxn_resolved: 100,
    };
    expect(stub.canonical_id).toBe("x");
    expect(stub.direction).toBe("issued");
  });

  it("Database type exposes gold_ceo_inbox view", () => {
    const stub: Pick<GoldCeoInboxRow, "issue_id" | "severity" | "priority_score"> = {
      issue_id: "00000000-0000-0000-0000-000000000000",
      severity: "critical",
      priority_score: 100,
    };
    expect(stub.severity).toBe("critical");
  });
});
```

- [ ] **Step 5: Run the type test**

Run:
```bash
npm run test -- src/__tests__/silver-sp5/types.test.ts
```
Expected: 2 passing tests. If the `Views` key is absent (Supabase CLI sometimes omits it), update the import path to `Database["public"]["Views"]["gold_ceo_inbox"]["Row"]` — if this still fails, Supabase generated only Tables; rerun Step 2 with `--schema public` explicitly listed.

- [ ] **Step 6: Run full type-check**

Run:
```bash
npm run build 2>&1 | tail -40
```
Expected: compiles with no type errors. If errors appear in existing files because a legacy table name was renamed / missing, note them in the SP5 notes; do NOT fix them in Task 2 — those files will be rewritten in later tasks and should fail compilation until then. Task 2 only verifies that the generated types file itself is clean.

If type errors are in `src/lib/database.types.ts` itself (unexpected), STOP and re-run Step 2. Do not hand-edit `database.types.ts`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/database.types.ts src/__tests__/silver-sp5/types.test.ts
git commit -m "$(cat <<'EOF'
chore(sp5): task 2 — regenerate Database types from Silver/Gold schema

Includes canonical_* tables (16), gold_* views (8), evidence tables,
and mdm_manual_overrides. Unblocks subsequent query rewires.

Co-Authored-By: claude-flow <ruv@ruv.net>
EOF
)"
```

- [ ] **Step 8: Append notes**

Append to `docs/superpowers/plans/2026-04-21-silver-sp5-cutover-notes.md`:

```markdown
## Task 2 — Types regeneration (completed YYYY-MM-DD)

- `src/lib/database.types.ts` regenerated: N lines, M tables, K views.
- canonical_* tables present: <paste grep counts from Step 3>.
- gold_* views present: <paste grep counts from Step 3>.
- Note types test passes.
- Pre-existing type errors surfaced by stricter types (not fixed — owned by subsequent tasks): [list any].
```

---

### Task 3: Rewire `src/lib/queries/_shared/companies.ts`

**Files:**
- Modify: `src/lib/queries/_shared/companies.ts`
- Test: `src/__tests__/silver-sp5/shared-companies.test.ts`

**Context:** `_shared/companies.ts` is the cross-cutting companies fetcher used by `/empresas`, `/empresas/[id]`, `/ventas`, `/compras`, `/cobranza`, `/inbox`. It currently contains queries against `odoo_invoices` (financial aggregates), `company_profile` (reputational), and possibly direct `companies` table. Post-Task-3 it reads `canonical_companies` + `gold_company_360` + `canonical_invoices` only.

- [ ] **Step 1: Snapshot current file to inventory legacy reads**

Run:
```bash
rg -n "\.from\(" src/lib/queries/_shared/companies.ts
rg -n "\.rpc\(" src/lib/queries/_shared/companies.ts
```
Record the list of tables/RPCs referenced. Expected legacy tables: `companies`, `odoo_invoices`, `odoo_sale_orders`, `company_profile`, `company_profile_sat`, `analytics_customer_360`, `monthly_revenue_by_company`. Write the actual list into the Task 3 notes section.

- [ ] **Step 2: Write failing integration test**

Create `src/__tests__/silver-sp5/shared-companies.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from "vitest";
import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const describeIntegration = URL && KEY ? describe : describe.skip;

function sb() {
  if (!URL || !KEY) throw new Error("env missing");
  return createClient(URL, KEY, { auth: { persistSession: false } });
}

describeIntegration("_shared/companies.ts — canonical reads", () => {
  let fetchCompanyById: (id: number) => Promise<any>;
  let listCompanies: (opts: { search?: string; limit?: number }) => Promise<any[]>;
  let fetchCompany360: (canonical_company_id: number) => Promise<any>;

  beforeAll(async () => {
    const mod = await import("@/lib/queries/_shared/companies");
    fetchCompanyById = mod.fetchCompanyById ?? mod.getCompanyById;
    listCompanies = mod.listCompanies ?? mod.searchCompanies;
    fetchCompany360 = mod.fetchCompany360 ?? mod.getCompany360;
    if (!fetchCompanyById) throw new Error("fetchCompanyById export missing after rewire");
    if (!fetchCompany360) throw new Error("fetchCompany360 export missing after rewire");
  });

  it("fetchCompanyById returns a canonical_companies row shape for Quimibond (id=868)", async () => {
    const row = await fetchCompanyById(868);
    expect(row).toBeTruthy();
    expect(row.id).toBe(868);
    expect(row.taxpayer_rfc).toBe("QIN140528HN9");
    // canonical_companies fields the frontend depends on
    expect(row).toHaveProperty("display_name");
    expect(row).toHaveProperty("is_internal");
    expect(row).toHaveProperty("is_shadow");
  });

  it("fetchCompany360 returns gold_company_360 enrichment", async () => {
    // CONTITECH MEXICANA is the #1 LTV customer per SP4 notes
    const contitech = await sb()
      .from("canonical_companies")
      .select("id")
      .ilike("display_name", "%CONTITECH%")
      .limit(1);
    expect(contitech.data?.length).toBe(1);
    const row = await fetchCompany360(contitech.data![0].id);
    expect(row).toBeTruthy();
    expect(row).toHaveProperty("lifetime_value_mxn");
    expect(row).toHaveProperty("revenue_ytd_mxn");
    expect(row).toHaveProperty("open_company_issues_count");
    expect(Number(row.lifetime_value_mxn)).toBeGreaterThan(0);
  });

  it("listCompanies returns shape-compatible results from canonical_companies", async () => {
    const rows = await listCompanies({ limit: 5 });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toHaveProperty("id");
    expect(rows[0]).toHaveProperty("display_name");
    expect(rows[0]).toHaveProperty("taxpayer_rfc");
  });

  it("exports do not leak odoo_* or legacy MV names in function bodies", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("src/lib/queries/_shared/companies.ts", "utf8");
    const banned = [
      "from('odoo_",
      'from("odoo_',
      "from('company_profile",
      'from("company_profile',
      "from('analytics_customer_360",
      "from('monthly_revenue_by_company",
    ];
    for (const token of banned) {
      expect(src).not.toContain(token);
    }
  });
});
```

- [ ] **Step 3: Run test; verify it fails for the right reasons**

Run:
```bash
npm run test -- src/__tests__/silver-sp5/shared-companies.test.ts 2>&1 | tail -40
```
Expected: tests fail. Either exports don't yet exist, or `banned token` assertion catches current `odoo_*` / `company_profile*` usage. Either is an acceptable "red" state.

- [ ] **Step 4: Rewrite `_shared/companies.ts`**

Open the file and replace every legacy query with canonical/gold equivalents. The full rewritten module is:

```typescript
// src/lib/queries/_shared/companies.ts
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";

type CanonicalCompany = Database["public"]["Tables"]["canonical_companies"]["Row"];
type GoldCompany360 = Database["public"]["Views"]["gold_company_360"]["Row"];

export async function fetchCompanyById(id: number): Promise<CanonicalCompany | null> {
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb
    .from("canonical_companies")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchCompany360(canonical_company_id: number): Promise<GoldCompany360 | null> {
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb
    .from("gold_company_360")
    .select("*")
    .eq("canonical_company_id", canonical_company_id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export interface ListCompaniesOptions {
  search?: string;
  limit?: number;
  offset?: number;
  onlyCustomers?: boolean;
  onlySuppliers?: boolean;
  minLtv?: number;
  blacklistLevel?: "none" | "69b_presunto" | "69b_definitivo";
}

export async function listCompanies(opts: ListCompaniesOptions = {}): Promise<GoldCompany360[]> {
  const sb = await createSupabaseServerClient();
  let q = sb.from("gold_company_360").select("*");
  if (opts.search) {
    q = q.or(
      `display_name.ilike.%${opts.search}%,taxpayer_rfc.ilike.%${opts.search}%`,
    );
  }
  if (opts.onlyCustomers) q = q.eq("is_customer", true);
  if (opts.onlySuppliers) q = q.eq("is_supplier", true);
  if (typeof opts.minLtv === "number") q = q.gte("lifetime_value_mxn", opts.minLtv);
  if (opts.blacklistLevel) q = q.eq("blacklist_level", opts.blacklistLevel);
  q = q.order("lifetime_value_mxn", { ascending: false, nullsFirst: false });
  if (opts.limit) q = q.limit(opts.limit);
  if (opts.offset) q = q.range(opts.offset, opts.offset + (opts.limit ?? 50) - 1);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function fetchCompanyInvoices(
  canonical_company_id: number,
  opts: { direction?: "issued" | "received"; limit?: number } = {},
) {
  const sb = await createSupabaseServerClient();
  let q = sb
    .from("canonical_invoices")
    .select(
      "canonical_id, uuid_sat, direction, invoice_date, due_date, days_overdue, amount_total_mxn_resolved, amount_residual_mxn_resolved, fiscal_estado, odoo_payment_state, match_status",
    )
    .or(
      `emisor_canonical_company_id.eq.${canonical_company_id},receptor_canonical_company_id.eq.${canonical_company_id}`,
    )
    .order("invoice_date", { ascending: false, nullsFirst: false });
  if (opts.direction) q = q.eq("direction", opts.direction);
  if (opts.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function fetchCompanyReceivables(canonical_company_id: number) {
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb
    .from("canonical_invoices")
    .select(
      "canonical_id, invoice_date, due_date, days_overdue, amount_total_mxn_resolved, amount_residual_mxn_resolved, odoo_payment_state",
    )
    .eq("direction", "issued")
    .eq("receptor_canonical_company_id", canonical_company_id)
    .gt("amount_residual_mxn_resolved", 0)
    .order("days_overdue", { ascending: false, nullsFirst: false });
  if (error) throw error;
  return data ?? [];
}

export async function fetchCompanyPayables(canonical_company_id: number) {
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb
    .from("canonical_invoices")
    .select(
      "canonical_id, invoice_date, due_date, days_overdue, amount_total_mxn_resolved, amount_residual_mxn_resolved, odoo_payment_state",
    )
    .eq("direction", "received")
    .eq("emisor_canonical_company_id", canonical_company_id)
    .gt("amount_residual_mxn_resolved", 0)
    .order("days_overdue", { ascending: false, nullsFirst: false });
  if (error) throw error;
  return data ?? [];
}
```

If there are existing call sites that import differently-named functions (e.g. `getCompanyById`), add a back-compat re-export alias at the bottom:

```typescript
export const getCompanyById = fetchCompanyById;
export const getCompany360 = fetchCompany360;
export const searchCompanies = listCompanies;
```

- [ ] **Step 5: Run the test again; verify it passes**

```bash
npm run test -- src/__tests__/silver-sp5/shared-companies.test.ts 2>&1 | tail -40
```
Expected: all 4 tests pass. If "Quimibond rfc=QIN140528HN9" assertion fails, verify SP3 backfill via `SELECT taxpayer_rfc FROM canonical_companies WHERE id=868;` — should be `QIN140528HN9`.

- [ ] **Step 6: Verify no type errors from consumers**

Run:
```bash
npm run build 2>&1 | tail -40
```
If consumer files (`src/app/empresas/*`, etc.) fail compilation because they referenced a removed column / legacy type, write the failures down in the notes — these will be fixed in their owning task (e.g. `/empresas` in Task 13). Task 3 does NOT fix consumer errors; only the library change. The branch CAN be in a broken-build state until the consumer tasks land. If this is unacceptable for your workflow, stash the test until Task 13.

- [ ] **Step 7: Commit**

```bash
git add src/lib/queries/_shared/companies.ts src/__tests__/silver-sp5/shared-companies.test.ts
git commit -m "$(cat <<'EOF'
feat(sp5): task 3 — rewire _shared/companies.ts to canonical/gold

Replaces legacy queries (odoo_invoices, company_profile,
company_profile_sat, analytics_customer_360, monthly_revenue_by_company)
with canonical_companies + gold_company_360 + canonical_invoices.

Adds back-compat aliases (getCompanyById / searchCompanies / getCompany360)
to avoid breaking consumer imports before their own rewire tasks.

Co-Authored-By: claude-flow <ruv@ruv.net>
EOF
)"
```

- [ ] **Step 8: Append notes**

```markdown
## Task 3 — _shared/companies.ts (completed YYYY-MM-DD)

- Legacy tables removed: [paste list from Step 1].
- New exports: fetchCompanyById, fetchCompany360, listCompanies, fetchCompanyInvoices, fetchCompanyReceivables, fetchCompanyPayables.
- Back-compat aliases kept: getCompanyById, getCompany360, searchCompanies.
- Consumer compilation status after task: [clean / N errors in /empresas pending Task 13 / etc].
- Integration test: 4 passing.
```

---

### Task 4: Rewire `_shared/contacts.ts` + `_shared/payments.ts` + `_shared/period-filter.ts`

**Files:**
- Modify: `src/lib/queries/_shared/contacts.ts` (7.4 KB)
- Modify: `src/lib/queries/_shared/payments.ts` (1.6 KB)
- Verify (no changes expected): `src/lib/queries/_shared/period-filter.ts`, `_shared/year-filter.ts`, `_shared/table-params.ts`, `_shared/_helpers.ts`
- Test: `src/__tests__/silver-sp5/shared-contacts.test.ts`, `src/__tests__/silver-sp5/shared-payments.test.ts`

- [ ] **Step 1: Inventory legacy reads in the 2 target files**

```bash
rg -n "\.from\(|\.rpc\(" src/lib/queries/_shared/contacts.ts src/lib/queries/_shared/payments.ts
```
Expected in contacts.ts: `contacts`, `odoo_users`, `odoo_employees`. Expected in payments.ts: `odoo_account_payments` or `payments_unified`. Record the actual list.

- [ ] **Step 2: Write failing tests**

Create `src/__tests__/silver-sp5/shared-contacts.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from "vitest";
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const describeIntegration = URL && KEY ? describe : describe.skip;

describeIntegration("_shared/contacts.ts — canonical reads", () => {
  let fetchContactById: (id: number) => Promise<any>;
  let listContacts: (opts: { search?: string; limit?: number }) => Promise<any[]>;

  beforeAll(async () => {
    const mod = await import("@/lib/queries/_shared/contacts");
    fetchContactById = mod.fetchContactById ?? mod.getContactById;
    listContacts = mod.listContacts ?? mod.searchContacts;
    if (!fetchContactById || !listContacts) throw new Error("exports missing");
  });

  it("fetchContactById returns canonical_contacts shape", async () => {
    const anyContact = await listContacts({ limit: 1 });
    expect(anyContact.length).toBe(1);
    const one = await fetchContactById(anyContact[0].id);
    expect(one).toBeTruthy();
    expect(one).toHaveProperty("primary_email");
    expect(one).toHaveProperty("canonical_company_id");
    expect(one).toHaveProperty("is_internal");
  });

  it("source file contains no banned legacy table reads", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("src/lib/queries/_shared/contacts.ts", "utf8");
    const banned = ["from('odoo_users", "from('odoo_employees", "from('contacts'", 'from("contacts"', "from('person_unified"];
    for (const token of banned) expect(src).not.toContain(token);
  });
});
```

Create `src/__tests__/silver-sp5/shared-payments.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from "vitest";
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const describeIntegration = URL && KEY ? describe : describe.skip;

describeIntegration("_shared/payments.ts — canonical reads", () => {
  let listCompanyPayments: (canonical_company_id: number, opts?: { limit?: number }) => Promise<any[]>;

  beforeAll(async () => {
    const mod = await import("@/lib/queries/_shared/payments");
    listCompanyPayments = mod.listCompanyPayments;
    if (!listCompanyPayments) throw new Error("listCompanyPayments export missing");
  });

  it("listCompanyPayments returns canonical_payments rows", async () => {
    // Quimibond self = 868; should have payments on both sides
    const rows = await listCompanyPayments(868, { limit: 5 });
    expect(Array.isArray(rows)).toBe(true);
    if (rows.length > 0) {
      expect(rows[0]).toHaveProperty("canonical_id");
      expect(rows[0]).toHaveProperty("amount_mxn");
      expect(rows[0]).toHaveProperty("payment_date");
      expect(rows[0]).toHaveProperty("source");
    }
  });

  it("source contains no banned legacy table reads", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("src/lib/queries/_shared/payments.ts", "utf8");
    for (const token of ["from('odoo_account_payments", "from('payments_unified", "from('unified_payment_allocations"]) {
      expect(src).not.toContain(token);
    }
  });
});
```

- [ ] **Step 3: Run tests; verify they fail**

```bash
npm run test -- src/__tests__/silver-sp5/shared-contacts.test.ts src/__tests__/silver-sp5/shared-payments.test.ts 2>&1 | tail -40
```
Expected: red.

- [ ] **Step 4: Rewrite `_shared/contacts.ts`**

```typescript
// src/lib/queries/_shared/contacts.ts
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";

type CanonicalContact = Database["public"]["Tables"]["canonical_contacts"]["Row"];

export async function fetchContactById(id: number): Promise<CanonicalContact | null> {
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb
    .from("canonical_contacts")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export interface ListContactsOptions {
  search?: string;
  limit?: number;
  offset?: number;
  canonicalCompanyId?: number;
  onlyInternal?: boolean;
  onlyExternal?: boolean;
}

export async function listContacts(opts: ListContactsOptions = {}): Promise<CanonicalContact[]> {
  const sb = await createSupabaseServerClient();
  let q = sb.from("canonical_contacts").select("*");
  if (opts.search) {
    q = q.or(
      `primary_email.ilike.%${opts.search}%,display_name.ilike.%${opts.search}%`,
    );
  }
  if (typeof opts.canonicalCompanyId === "number") q = q.eq("canonical_company_id", opts.canonicalCompanyId);
  if (opts.onlyInternal) q = q.eq("is_internal", true);
  if (opts.onlyExternal) q = q.eq("is_internal", false);
  q = q.order("display_name");
  if (opts.limit) q = q.limit(opts.limit);
  if (opts.offset) q = q.range(opts.offset, opts.offset + (opts.limit ?? 50) - 1);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function listEmployees(opts: ListContactsOptions = {}) {
  return listContacts({ ...opts, onlyInternal: true });
}

// Back-compat aliases
export const getContactById = fetchContactById;
export const searchContacts = listContacts;
```

- [ ] **Step 5: Rewrite `_shared/payments.ts`**

```typescript
// src/lib/queries/_shared/payments.ts
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";

type CanonicalPayment = Database["public"]["Tables"]["canonical_payments"]["Row"];

export async function listCompanyPayments(
  canonical_company_id: number,
  opts: { limit?: number; source?: string } = {},
): Promise<CanonicalPayment[]> {
  const sb = await createSupabaseServerClient();
  let q = sb
    .from("canonical_payments")
    .select("*")
    .eq("canonical_company_id", canonical_company_id)
    .order("payment_date", { ascending: false, nullsFirst: false });
  if (opts.source) q = q.eq("source", opts.source);
  if (opts.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export function classifyPaymentState(odoo_payment_state: string | null): "paid" | "partial" | "unpaid" | "unknown" {
  switch (odoo_payment_state) {
    case "paid": return "paid";
    case "in_payment":
    case "partial": return "partial";
    case "not_paid": return "unpaid";
    default: return "unknown";
  }
}
```

- [ ] **Step 6: Verify column name `canonical_company_id` exists on `canonical_payments`**

Run:
```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='canonical_payments'
ORDER BY ordinal_position;
```
If the column is named `counterparty_canonical_company_id`, change the `.eq("canonical_company_id", …)` in Step 5 accordingly AND update the test stub in Step 2. Do NOT invent a renaming — use whatever the SP2/SP3 shipped schema currently has.

- [ ] **Step 7: Run tests; verify they pass**

```bash
npm run test -- src/__tests__/silver-sp5/shared-contacts.test.ts src/__tests__/silver-sp5/shared-payments.test.ts 2>&1 | tail -40
```
Expected: 5 passing tests total.

- [ ] **Step 8: Verify helper files are clean**

```bash
rg -n "\.from\(" src/lib/queries/_shared/period-filter.ts src/lib/queries/_shared/year-filter.ts src/lib/queries/_shared/table-params.ts src/lib/queries/_shared/_helpers.ts
```
Expected: 0 matches (these are pure helper utilities). If any do read Bronze, note them and fix inline in this task — they are tiny files.

- [ ] **Step 9: Commit**

```bash
git add src/lib/queries/_shared/contacts.ts src/lib/queries/_shared/payments.ts src/__tests__/silver-sp5/shared-contacts.test.ts src/__tests__/silver-sp5/shared-payments.test.ts
git commit -m "$(cat <<'EOF'
feat(sp5): task 4 — rewire _shared/{contacts,payments}.ts to canonical

contacts.ts now reads canonical_contacts (with is_internal partition
for employees). payments.ts now reads canonical_payments with source
column for SAT complement vs Odoo provenance.

Co-Authored-By: claude-flow <ruv@ruv.net>
EOF
)"
```

- [ ] **Step 10: Append notes**

```markdown
## Task 4 — _shared/{contacts,payments}.ts (completed YYYY-MM-DD)

- contacts.ts: now reads canonical_contacts only. `listEmployees` convenience filter added.
- payments.ts: reads canonical_payments. Column used: <canonical_company_id | counterparty_canonical_company_id> per Step 6 verification.
- Tests: 5 passing.
```

---

### Task 5: Rewire `src/lib/queries/analytics/finance.ts` (the biggest legacy offender)

**Files:**
- Modify: `src/lib/queries/analytics/finance.ts` (34 KB, multiple functions)
- Test: `src/__tests__/silver-sp5/analytics-finance.test.ts`

**Context:** this file is the single largest legacy consumer in the codebase. It reads `invoices_unified` (the 257MB MV), `cfo_dashboard`, `cash_position`, `pl_estado_resultados`, `working_capital`, `working_capital_cycle`, `partner_payment_profile`, `account_payment_profile`, `journal_flow_profile`, `projected_cash_flow_weekly`, `financial_runway`, and invokes `rpc('get_projected_cash_flow_summary')` + `rpc('get_cashflow_recommendations')`. The file is consumed by `/finanzas` + `/dashboard` + parts of `/empresas/[id]`.

- [ ] **Step 1: Enumerate every function + its legacy read**

```bash
rg -n "^export (async )?function|\.from\(|\.rpc\(" src/lib/queries/analytics/finance.ts > /tmp/finance-inventory.txt
wc -l /tmp/finance-inventory.txt
```
Paste the inventory into the Task 5 notes. Map each function to its replacement:

| Function | Legacy read | Replacement |
|---|---|---|
| `fetchCfoDashboard` | `cfo_dashboard` view | KEEP — cfo_dashboard is NOT in drop list (verify via `SELECT * FROM pg_class WHERE relname='cfo_dashboard'`); retain as Bronze-curated view |
| `fetchOpenInvoicesAgg` | `invoices_unified` | `canonical_invoices WHERE direction='issued' AND amount_residual_mxn_resolved > 0` |
| `fetchFinancialRunway` | `financial_runway` view | KEEP if not in drop list; else migrate to `gold_cashflow.runway_days` |
| `fetchWorkingCapital` | `working_capital` view | `gold_cashflow` (select `working_capital_*` fields) |
| `fetchCashPosition` | `cash_position` view | `gold_cashflow.current_cash` + `canonical_bank_balances` union |
| `fetchPLStatement` | `pl_estado_resultados` | `gold_pl_statement` |
| `fetchWorkingCapitalCycle` | `working_capital_cycle` | `gold_cashflow.working_capital_cycle_*` |
| `fetchProjectedCashFlow` | `projected_cash_flow_weekly` + `rpc('get_projected_cash_flow_summary')` | Keep `projected_cash_flow_weekly` if not in drop list; else migrate to `gold_cashflow.projection` |
| `fetchCashflowRecommendations` | `rpc('get_cashflow_recommendations')` | Keep if function body already reads canonical_*; verify by `\df+ get_cashflow_recommendations` |
| `fetchPartnerPaymentProfile` | `partner_payment_profile` MV | `canonical_invoices + canonical_payments GROUP BY canonical_company_id` OR migrate to `gold_company_360.payment_behavior_*` |
| `fetchAccountPaymentProfile` | `account_payment_profile` MV | Similar migration — aggregate canonical_payments by method/journal |
| `fetchJournalFlowProfile` | `journal_flow_profile` view | KEEP if still a valid view; else drop and expose via canonical_bank_balances + canonical_payments |

- [ ] **Step 2: Confirm which legacy objects are truly in the drop list (vs KEEP)**

Run:
```sql
SELECT c.relname,
  CASE c.relkind WHEN 'v' THEN 'view' WHEN 'm' THEN 'mv' WHEN 'r' THEN 'table' END AS kind,
  pg_size_pretty(pg_total_relation_size(c.oid)) AS size
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN (
    'cfo_dashboard','financial_runway','projected_cash_flow_weekly','journal_flow_profile',
    'cashflow_projection','ar_aging_detail','accounting_anomalies','expense_breakdown',
    'payment_analysis','cfdi_invoice_match','cash_flow_aging','margin_analysis'
  );
```

Note which of these to keep. Then verify `get_cashflow_recommendations` and `get_projected_cash_flow_summary` RPC bodies:
```sql
SELECT proname, prosrc FROM pg_proc WHERE proname IN ('get_cashflow_recommendations','get_projected_cash_flow_summary');
```
If the RPCs read canonical_* / gold_* / cfo_dashboard only, they are safe to keep. If they read an MV in the drop list, raise it in the notes — the RPC itself needs rewiring (follow-up for SP5.5 or fold into this task if trivial).

- [ ] **Step 3: Write failing integration test**

Create `src/__tests__/silver-sp5/analytics-finance.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from "vitest";
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const describeIntegration = URL && KEY ? describe : describe.skip;

describeIntegration("analytics/finance.ts — canonical/gold reads", () => {
  let fetchOpenInvoicesAgg: () => Promise<any>;
  let fetchPLStatement: (opts?: any) => Promise<any[]>;
  let fetchCashPosition: () => Promise<any>;
  let fetchWorkingCapital: () => Promise<any>;

  beforeAll(async () => {
    const mod = await import("@/lib/queries/analytics/finance");
    fetchOpenInvoicesAgg = mod.fetchOpenInvoicesAgg;
    fetchPLStatement = mod.fetchPLStatement;
    fetchCashPosition = mod.fetchCashPosition;
    fetchWorkingCapital = mod.fetchWorkingCapital;
  });

  it("fetchOpenInvoicesAgg returns non-negative open AR totals from canonical_invoices", async () => {
    const agg = await fetchOpenInvoicesAgg();
    expect(agg).toBeTruthy();
    expect(typeof agg.totalOpenAmountMxn).toBe("number");
    expect(agg.totalOpenAmountMxn).toBeGreaterThanOrEqual(0);
    expect(typeof agg.totalOpenCount).toBe("number");
  });

  it("fetchPLStatement returns rows from gold_pl_statement", async () => {
    const rows = await fetchPLStatement({ limit: 3 });
    expect(Array.isArray(rows)).toBe(true);
    if (rows.length > 0) {
      expect(rows[0]).toHaveProperty("period_month");
      expect(rows[0]).toHaveProperty("revenue_mxn");
    }
  });

  it("fetchCashPosition returns an object with current_cash", async () => {
    const cp = await fetchCashPosition();
    expect(cp).toBeTruthy();
    expect(cp).toHaveProperty("current_cash_mxn");
  });

  it("fetchWorkingCapital returns gold_cashflow-derived shape", async () => {
    const wc = await fetchWorkingCapital();
    expect(wc).toBeTruthy();
    expect(wc).toHaveProperty("working_capital_mxn");
  });

  it("source contains no banned legacy reads", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("src/lib/queries/analytics/finance.ts", "utf8");
    const banned = [
      "from('invoices_unified",
      'from("invoices_unified',
      "from('pl_estado_resultados",
      "from('working_capital",
      "from('working_capital_cycle",
      "from('cash_position",
      "from('partner_payment_profile",
      "from('account_payment_profile",
      "from('monthly_revenue_by_company",
      "from('monthly_revenue_trend",
      "from('balance_sheet",
    ];
    for (const token of banned) expect(src).not.toContain(token);
  });
});
```

- [ ] **Step 4: Run test; verify red**

```bash
npm run test -- src/__tests__/silver-sp5/analytics-finance.test.ts 2>&1 | tail -40
```

- [ ] **Step 5: Rewrite function-by-function**

This file is large; the rewrite is incremental (but the commit is atomic). Open `src/lib/queries/analytics/finance.ts` and replace each function with the canonical/gold version. Template functions below — adapt to exact existing signature so consumers keep compiling.

5a. `fetchOpenInvoicesAgg` — replace the `from("invoices_unified")` block:

```typescript
export async function fetchOpenInvoicesAgg(): Promise<{
  totalOpenAmountMxn: number;
  totalOpenCount: number;
  overdue30Count: number;
  overdue60Count: number;
  overdue90Count: number;
  overdue90PlusAmountMxn: number;
}> {
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb
    .from("canonical_invoices")
    .select(
      "canonical_id, days_overdue, amount_residual_mxn_resolved, direction, odoo_payment_state",
    )
    .eq("direction", "issued")
    .gt("amount_residual_mxn_resolved", 0);
  if (error) throw error;
  let total = 0, count = 0, o30 = 0, o60 = 0, o90 = 0, o90amt = 0;
  for (const r of data ?? []) {
    const amt = Number(r.amount_residual_mxn_resolved ?? 0);
    total += amt; count += 1;
    const d = Number(r.days_overdue ?? 0);
    if (d > 30) o30 += 1;
    if (d > 60) o60 += 1;
    if (d > 90) { o90 += 1; o90amt += amt; }
  }
  return {
    totalOpenAmountMxn: Math.round(total * 100) / 100,
    totalOpenCount: count,
    overdue30Count: o30,
    overdue60Count: o60,
    overdue90Count: o90,
    overdue90PlusAmountMxn: Math.round(o90amt * 100) / 100,
  };
}
```

5b. `fetchPLStatement`:

```typescript
export async function fetchPLStatement(opts: { limit?: number; from?: string; to?: string } = {}) {
  const sb = await createSupabaseServerClient();
  let q = sb.from("gold_pl_statement").select("*").order("period_month", { ascending: false });
  if (opts.from) q = q.gte("period_month", opts.from);
  if (opts.to) q = q.lte("period_month", opts.to);
  if (opts.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}
```

5c. `fetchCashPosition` + `fetchWorkingCapital` + `fetchWorkingCapitalCycle`:

```typescript
export async function fetchCashPosition() {
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb
    .from("gold_cashflow")
    .select("current_cash_mxn, current_cash_usd, cash_runway_days")
    .maybeSingle();
  if (error) throw error;
  return data ?? { current_cash_mxn: 0, current_cash_usd: 0, cash_runway_days: null };
}

export async function fetchWorkingCapital() {
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb
    .from("gold_cashflow")
    .select("working_capital_mxn, current_ratio, quick_ratio, ar_mxn, ap_mxn, inventory_mxn")
    .maybeSingle();
  if (error) throw error;
  return data ?? {};
}

export async function fetchWorkingCapitalCycle() {
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb
    .from("gold_cashflow")
    .select("dso_days, dpo_days, dio_days, cash_conversion_cycle_days")
    .maybeSingle();
  if (error) throw error;
  return data ?? {};
}
```

**Caveat:** these `gold_cashflow` fields must exist. Verify:
```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='gold_cashflow' ORDER BY ordinal_position;
```
If any are missing (SP4 might have shipped slightly different names), align the frontend to the actual names AND note the deviation. Do NOT alter the view in Task 5 — view changes are Gold-layer authority and belong in SP4 follow-up, not SP5.

5d. `fetchPartnerPaymentProfile` + `fetchAccountPaymentProfile`:

Replace with client-side aggregation over canonical_invoices + canonical_payments. Minimal version:

```typescript
export async function fetchPartnerPaymentProfile(canonical_company_id: number) {
  const sb = await createSupabaseServerClient();
  const { data: inv } = await sb
    .from("canonical_invoices")
    .select("invoice_date, due_date, days_overdue, amount_total_mxn_resolved, odoo_payment_state")
    .eq("direction", "issued")
    .eq("receptor_canonical_company_id", canonical_company_id);
  const { data: pay } = await sb
    .from("canonical_payments")
    .select("payment_date, amount_mxn, source")
    .eq("canonical_company_id", canonical_company_id);
  const n = inv?.length ?? 0;
  const avgDaysOverdue = n
    ? (inv!.reduce((a, r) => a + Number(r.days_overdue ?? 0), 0) / n)
    : 0;
  const paidCount = inv?.filter((r) => r.odoo_payment_state === "paid").length ?? 0;
  return {
    canonical_company_id,
    invoice_count: n,
    paid_count: paidCount,
    payment_count: pay?.length ?? 0,
    avg_days_overdue: Math.round(avgDaysOverdue),
    paid_ratio: n ? paidCount / n : null,
  };
}

export async function fetchAccountPaymentProfile(journalName?: string) {
  const sb = await createSupabaseServerClient();
  let q = sb
    .from("canonical_payments")
    .select("method, source, amount_mxn, payment_date");
  if (journalName) q = q.eq("method", journalName);
  const { data } = await q;
  const byMethod: Record<string, { n: number; total_mxn: number }> = {};
  for (const r of data ?? []) {
    const k = r.method ?? "unknown";
    byMethod[k] ??= { n: 0, total_mxn: 0 };
    byMethod[k].n += 1;
    byMethod[k].total_mxn += Number(r.amount_mxn ?? 0);
  }
  return Object.entries(byMethod).map(([method, agg]) => ({ method, ...agg }));
}
```

5e. Keep existing `fetchCfoDashboard` / `fetchFinancialRunway` / `fetchProjectedCashFlow` / `fetchCashflowRecommendations` if Step 2 confirmed the underlying view/fn is NOT in the drop list. Add a leading comment referencing SP5 verification: `// SP5-VERIFIED: cfo_dashboard retained (not in §12 drop list)`.

5f. `fetchJournalFlowProfile`: if in drop list, remove; otherwise keep with verification comment.

- [ ] **Step 6: Run tests; verify green**

```bash
npm run test -- src/__tests__/silver-sp5/analytics-finance.test.ts 2>&1 | tail -40
```
Expected: 5 passing.

- [ ] **Step 7: Verify grep invariant on this file**

```bash
rg "from\(['\"]invoices_unified|from\(['\"]pl_estado_resultados|from\(['\"]working_capital|from\(['\"]cash_position|from\(['\"]partner_payment_profile|from\(['\"]account_payment_profile|from\(['\"]monthly_revenue" src/lib/queries/analytics/finance.ts
```
Expected: 0 matches.

- [ ] **Step 8: Commit**

```bash
git add src/lib/queries/analytics/finance.ts src/__tests__/silver-sp5/analytics-finance.test.ts
git commit -m "$(cat <<'EOF'
feat(sp5): task 5 — rewire analytics/finance.ts to canonical/gold

Replaces invoices_unified, pl_estado_resultados, cash_position,
working_capital, working_capital_cycle, partner_payment_profile,
account_payment_profile with canonical_invoices / canonical_payments
/ gold_pl_statement / gold_cashflow. cfo_dashboard / financial_runway
retained per §12 (not in drop list).

Co-Authored-By: claude-flow <ruv@ruv.net>
EOF
)"
```

- [ ] **Step 9: Append notes**

```markdown
## Task 5 — analytics/finance.ts (completed YYYY-MM-DD)

- Functions rewritten: fetchOpenInvoicesAgg, fetchPLStatement, fetchCashPosition,
  fetchWorkingCapital, fetchWorkingCapitalCycle, fetchPartnerPaymentProfile,
  fetchAccountPaymentProfile.
- Functions retained (verified NOT in drop list per Step 2): fetchCfoDashboard,
  fetchFinancialRunway, fetchProjectedCashFlow, fetchCashflowRecommendations,
  fetchJournalFlowProfile.
- RPC audit (get_cashflow_recommendations / get_projected_cash_flow_summary):
  <paste pg_proc.prosrc head — note whether they read canonical_* internally>.
- gold_cashflow column alignment: [matched / deviated at columns: …].
- Tests: 5 passing.
```

---

### Task 6: Rewire `src/lib/queries/analytics/products.ts`

**Files:**
- Modify: `src/lib/queries/analytics/products.ts` (37 KB)
- Test: `src/__tests__/silver-sp5/analytics-products.test.ts`

**Context:** this file reads `product_margin_analysis` (drop), `customer_product_matrix` (drop), `supplier_product_matrix` (drop), `supplier_price_index` (drop, 1.7MB MV), `product_real_cost` (KEEP — confirm), `inventory_velocity` (KEEP per §12), `dead_stock_analysis` (KEEP), and probably `odoo_products` direct. Consumer: `/productos` page (Task 16) + `/empresas/[id]/_components/PanoramaTab.tsx` (Task 13).

- [ ] **Step 1: Inventory legacy reads**

```bash
rg -n "\.from\(|\.rpc\(" src/lib/queries/analytics/products.ts > /tmp/products-inventory.txt
```
Paste into Task 6 notes. Confirm which underlying views are in the KEEP set (per §12 MV table — `inventory_velocity`, `dead_stock_analysis`, `product_real_cost`, `client_reorder_predictions` are KEEP + rewire; `product_margin_analysis`, `customer_product_matrix`, `supplier_product_matrix`, `supplier_price_index`, `product_price_history` are DROP).

- [ ] **Step 2: Verify KEEP vs DROP with pg_class**

```sql
SELECT c.relname, c.relkind,
  pg_size_pretty(pg_total_relation_size(c.oid)) AS size
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname='public' AND c.relname IN (
  'product_margin_analysis','customer_product_matrix','supplier_product_matrix',
  'supplier_price_index','product_price_history','inventory_velocity',
  'dead_stock_analysis','product_real_cost','client_reorder_predictions',
  'product_seasonality','overhead_factor_12m','purchase_price_intelligence'
);
```

- [ ] **Step 3: Write failing test**

Create `src/__tests__/silver-sp5/analytics-products.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from "vitest";
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const describeIntegration = URL && KEY ? describe : describe.skip;

describeIntegration("analytics/products.ts — canonical/gold reads", () => {
  let listProducts: (opts?: any) => Promise<any[]>;
  let fetchProductPerformance: (canonical_product_id: number) => Promise<any>;
  let fetchTopSkusByRevenue: (opts?: any) => Promise<any[]>;

  beforeAll(async () => {
    const mod = await import("@/lib/queries/analytics/products");
    listProducts = mod.listProducts ?? mod.searchProducts;
    fetchProductPerformance = mod.fetchProductPerformance ?? mod.getProductPerformance;
    fetchTopSkusByRevenue = mod.fetchTopSkusByRevenue ?? mod.topProductsByRevenue;
  });

  it("listProducts returns canonical_products rows", async () => {
    const rows = await listProducts({ limit: 5 });
    expect(Array.isArray(rows)).toBe(true);
    if (rows.length > 0) {
      expect(rows[0]).toHaveProperty("id");
      expect(rows[0]).toHaveProperty("internal_ref");
      expect(rows[0]).toHaveProperty("display_name");
    }
  });

  it("fetchTopSkusByRevenue returns gold_product_performance-derived rows", async () => {
    const rows = await fetchTopSkusByRevenue({ limit: 5 });
    expect(Array.isArray(rows)).toBe(true);
    if (rows.length > 0) {
      expect(rows[0]).toHaveProperty("internal_ref");
      expect(rows[0]).toHaveProperty("revenue_mxn_12m");
    }
  });

  it("source contains no banned legacy reads", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("src/lib/queries/analytics/products.ts", "utf8");
    const banned = [
      "from('product_margin_analysis",
      "from('customer_product_matrix",
      "from('supplier_product_matrix",
      "from('supplier_price_index",
      "from('product_price_history",
      "from('products_unified",
    ];
    for (const token of banned) expect(src).not.toContain(token);
  });
});
```

- [ ] **Step 4: Run red**

```bash
npm run test -- src/__tests__/silver-sp5/analytics-products.test.ts 2>&1 | tail -30
```

- [ ] **Step 5: Rewrite functions**

Replace each legacy call with canonical/gold equivalents. Key function templates:

```typescript
import type { Database } from "@/lib/database.types";

type CanonicalProduct = Database["public"]["Tables"]["canonical_products"]["Row"];

export async function listProducts(opts: {
  search?: string;
  limit?: number;
  onlyActive?: boolean;
  categoryLike?: string;
} = {}): Promise<CanonicalProduct[]> {
  const sb = await createSupabaseServerClient();
  let q = sb.from("canonical_products").select("*");
  if (opts.search) {
    q = q.or(`internal_ref.ilike.%${opts.search}%,display_name.ilike.%${opts.search}%`);
  }
  if (opts.onlyActive) q = q.eq("is_active", true);
  if (opts.categoryLike) q = q.ilike("category_path", `%${opts.categoryLike}%`);
  if (opts.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function fetchProductPerformance(canonical_product_id: number) {
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb
    .from("gold_product_performance")
    .select("*")
    .eq("canonical_product_id", canonical_product_id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchTopSkusByRevenue(opts: { limit?: number } = {}) {
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb
    .from("gold_product_performance")
    .select(
      "canonical_product_id, internal_ref, display_name, revenue_mxn_12m, margin_mxn_12m, margin_pct_12m, units_sold_12m",
    )
    .order("revenue_mxn_12m", { ascending: false, nullsFirst: false })
    .limit(opts.limit ?? 20);
  if (error) throw error;
  return data ?? [];
}

// Supplier price intelligence — replace supplier_price_index MV
export async function fetchSupplierPriceIntelligence(canonical_product_id: number) {
  const sb = await createSupabaseServerClient();
  // Aggregate canonical_order_lines WHERE order_type='purchase' GROUP BY supplier
  const { data, error } = await sb
    .from("canonical_order_lines")
    .select(
      "emisor_canonical_company_id:canonical_company_id, price_unit, qty, currency, order_date",
    )
    .eq("canonical_product_id", canonical_product_id)
    .eq("order_type", "purchase")
    .order("order_date", { ascending: false })
    .limit(500);
  if (error) throw error;
  const bySupplier: Record<number, { n: number; totalQty: number; prices: number[]; lastDate: string | null }> = {};
  for (const r of data ?? []) {
    const k = Number((r as any).emisor_canonical_company_id);
    if (!k) continue;
    bySupplier[k] ??= { n: 0, totalQty: 0, prices: [], lastDate: null };
    bySupplier[k].n += 1;
    bySupplier[k].totalQty += Number(r.qty ?? 0);
    bySupplier[k].prices.push(Number(r.price_unit ?? 0));
    if (!bySupplier[k].lastDate || (r.order_date && r.order_date > bySupplier[k].lastDate!)) {
      bySupplier[k].lastDate = r.order_date;
    }
  }
  return Object.entries(bySupplier).map(([id, agg]) => ({
    canonical_company_id: Number(id),
    lines: agg.n,
    total_qty: agg.totalQty,
    min_price: Math.min(...agg.prices),
    max_price: Math.max(...agg.prices),
    avg_price: agg.prices.reduce((a, b) => a + b, 0) / agg.prices.length,
    last_purchase_at: agg.lastDate,
  }));
}

// Customer/supplier product matrix — replace customer_product_matrix / supplier_product_matrix MVs
export async function fetchCompanyProductMatrix(
  canonical_company_id: number,
  direction: "customer" | "supplier",
) {
  const sb = await createSupabaseServerClient();
  const filter = direction === "customer"
    ? { order_type: "sale", companyKey: "canonical_company_id" }
    : { order_type: "purchase", companyKey: "canonical_company_id" };
  const { data, error } = await sb
    .from("canonical_order_lines")
    .select("canonical_product_id, internal_ref, display_name, qty, subtotal, order_date")
    .eq("order_type", filter.order_type)
    .eq("canonical_company_id", canonical_company_id)
    .order("order_date", { ascending: false })
    .limit(2000);
  if (error) throw error;
  const byProduct: Record<number, { n: number; totalQty: number; totalRevenue: number; lastAt: string | null }> = {};
  for (const r of data ?? []) {
    const p = Number(r.canonical_product_id);
    if (!p) continue;
    byProduct[p] ??= { n: 0, totalQty: 0, totalRevenue: 0, lastAt: null };
    byProduct[p].n += 1;
    byProduct[p].totalQty += Number(r.qty ?? 0);
    byProduct[p].totalRevenue += Number(r.subtotal ?? 0);
    if (!byProduct[p].lastAt || (r.order_date && r.order_date > byProduct[p].lastAt!)) {
      byProduct[p].lastAt = r.order_date;
    }
  }
  return byProduct;
}

// Retain inventory_velocity / dead_stock_analysis / product_real_cost reads — they are KEEP per §12
// Add a comment: // SP5-VERIFIED: inventory_velocity retained (§12 keep+rewire category)
```

Keep any previously-existing helper that consumed `inventory_velocity`, `dead_stock_analysis`, `product_real_cost`, `client_reorder_predictions`, `product_seasonality` — they stay, annotated with `// SP5-VERIFIED`.

- [ ] **Step 6: Align column names with actual `gold_product_performance` schema**

Run:
```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema='public' AND table_name='gold_product_performance' ORDER BY ordinal_position;
```
If a column is named differently (e.g. `units_12m` vs `units_sold_12m`), adjust the queries above and the Step 3 test accordingly.

- [ ] **Step 7: Run tests; green**

```bash
npm run test -- src/__tests__/silver-sp5/analytics-products.test.ts 2>&1 | tail -30
```

- [ ] **Step 8: Commit**

```bash
git add src/lib/queries/analytics/products.ts src/__tests__/silver-sp5/analytics-products.test.ts
git commit -m "$(cat <<'EOF'
feat(sp5): task 6 — rewire analytics/products.ts to canonical/gold

Replaces product_margin_analysis, customer_product_matrix,
supplier_product_matrix, supplier_price_index, product_price_history
with canonical_products + gold_product_performance + canonical_order_lines
aggregations. Retains inventory_velocity/dead_stock_analysis/product_real_cost
per §12 (KEEP + rewire).

Co-Authored-By: claude-flow <ruv@ruv.net>
EOF
)"
```

- [ ] **Step 9: Append notes**

```markdown
## Task 6 — analytics/products.ts (completed YYYY-MM-DD)

- Dropped reads: product_margin_analysis, customer_product_matrix, supplier_product_matrix, supplier_price_index, product_price_history.
- Retained reads (§12 KEEP): inventory_velocity, dead_stock_analysis, product_real_cost, client_reorder_predictions, product_seasonality.
- Column alignment verified on gold_product_performance: [matched / deviated at: …].
- Tests: 3 passing.
```

---

### Task 7: Rewire `analytics/{customer-360,dashboard,pnl,currency-rates,index}.ts`

**Files:**
- Modify: `src/lib/queries/analytics/customer-360.ts`
- Modify: `src/lib/queries/analytics/dashboard.ts`
- Modify: `src/lib/queries/analytics/pnl.ts`
- Modify: `src/lib/queries/analytics/currency-rates.ts`
- Modify: `src/lib/queries/analytics/index.ts`
- Test: `src/__tests__/silver-sp5/analytics-smalls.test.ts`

- [ ] **Step 1: Inventory**

```bash
rg -n "\.from\(|\.rpc\(" src/lib/queries/analytics/customer-360.ts src/lib/queries/analytics/dashboard.ts src/lib/queries/analytics/pnl.ts src/lib/queries/analytics/currency-rates.ts src/lib/queries/analytics/index.ts
```

- [ ] **Step 2: Write failing tests**

Create `src/__tests__/silver-sp5/analytics-smalls.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from "vitest";
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const describeIntegration = URL && KEY ? describe : describe.skip;

describeIntegration("analytics/ small files — canonical/gold reads", () => {
  it("customer-360 exports fetchCustomer360 reading gold_company_360", async () => {
    const mod = await import("@/lib/queries/analytics/customer-360");
    const fn = mod.fetchCustomer360 ?? mod.getCustomer360;
    expect(fn).toBeTruthy();
    const row = await fn!(868);  // Quimibond self
    expect(row).toBeTruthy();
    expect(row).toHaveProperty("canonical_company_id");
  });

  it("pnl.ts reads gold_pl_statement", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("src/lib/queries/analytics/pnl.ts", "utf8");
    expect(src).toContain("gold_pl_statement");
    expect(src).not.toContain("from('pl_estado_resultados");
    expect(src).not.toContain('from("pl_estado_resultados');
  });

  it("dashboard.ts reads gold_* (no legacy MVs)", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("src/lib/queries/analytics/dashboard.ts", "utf8");
    const banned = ["company_profile", "analytics_customer_360", "monthly_revenue_by_company", "monthly_revenue_trend", "balance_sheet"];
    for (const token of banned) {
      expect(src).not.toMatch(new RegExp(`from\\(['"]${token}['"]`));
    }
  });

  it("currency-rates.ts reads canonical_fx_rates or odoo_currency_rates (Bronze ok)", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("src/lib/queries/analytics/currency-rates.ts", "utf8");
    const okOptions = ["canonical_fx_rates", "odoo_currency_rates"];
    expect(okOptions.some((t) => src.includes(t))).toBe(true);
  });

  it("analytics/index.ts re-exports no dropped symbols", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("src/lib/queries/analytics/index.ts", "utf8");
    // These function names (if they exist) were inferred from legacy files and should not be in the new re-export barrel
    for (const sym of [
      "fetchCompanyProfileSat", "fetchAnalyticsCustomer360", "fetchMonthlyRevenueByCompany",
    ]) {
      expect(src).not.toContain(`export { ${sym}`);
    }
  });
});
```

- [ ] **Step 3: Rewrite `customer-360.ts`**

Entire new file body:

```typescript
// src/lib/queries/analytics/customer-360.ts
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";

type GoldCompany360 = Database["public"]["Views"]["gold_company_360"]["Row"];

export async function fetchCustomer360(canonical_company_id: number): Promise<GoldCompany360 | null> {
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb
    .from("gold_company_360")
    .select("*")
    .eq("canonical_company_id", canonical_company_id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchTopCustomers(opts: { limit?: number; minLtv?: number } = {}) {
  const sb = await createSupabaseServerClient();
  let q = sb
    .from("gold_company_360")
    .select(
      "canonical_company_id, display_name, taxpayer_rfc, lifetime_value_mxn, revenue_ytd_mxn, open_company_issues_count, blacklist_level",
    )
    .eq("is_customer", true)
    .order("lifetime_value_mxn", { ascending: false, nullsFirst: false });
  if (opts.minLtv) q = q.gte("lifetime_value_mxn", opts.minLtv);
  if (opts.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function fetchTopSuppliers(opts: { limit?: number } = {}) {
  const sb = await createSupabaseServerClient();
  let q = sb
    .from("gold_company_360")
    .select(
      "canonical_company_id, display_name, taxpayer_rfc, lifetime_value_mxn, overdue_amount_mxn, blacklist_level",
    )
    .eq("is_supplier", true)
    .order("lifetime_value_mxn", { ascending: false, nullsFirst: false });
  if (opts.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

// Back-compat
export const getCustomer360 = fetchCustomer360;
```

- [ ] **Step 4: Rewrite `pnl.ts`**

```typescript
// src/lib/queries/analytics/pnl.ts
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function fetchPL(opts: { from?: string; to?: string; limit?: number } = {}) {
  const sb = await createSupabaseServerClient();
  let q = sb.from("gold_pl_statement").select("*").order("period_month", { ascending: false });
  if (opts.from) q = q.gte("period_month", opts.from);
  if (opts.to) q = q.lte("period_month", opts.to);
  if (opts.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}
```

- [ ] **Step 5: Rewrite `dashboard.ts`**

Replace its legacy reads with a combined gold fetch. Example template:

```typescript
// src/lib/queries/analytics/dashboard.ts
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function fetchDashboardKpis() {
  const sb = await createSupabaseServerClient();
  const [recHealth, cash, revenueYtd] = await Promise.all([
    sb.from("gold_reconciliation_health").select("*").maybeSingle(),
    sb.from("gold_cashflow").select("current_cash_mxn, ar_mxn, ap_mxn, working_capital_mxn").maybeSingle(),
    sb
      .from("gold_revenue_monthly")
      .select("period_month, total_mxn")
      .is("canonical_company_id", null)
      .gte("period_month", new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10))
      .order("period_month", { ascending: true }),
  ]);
  return {
    reconciliation: recHealth.data ?? null,
    cashflow: cash.data ?? null,
    revenueYtd: revenueYtd.data ?? [],
  };
}

export async function fetchDashboardAlerts(limit = 5) {
  const sb = await createSupabaseServerClient();
  const { data } = await sb
    .from("gold_ceo_inbox")
    .select("issue_id, description, severity, priority_score, impact_mxn")
    .order("priority_score", { ascending: false })
    .limit(limit);
  return data ?? [];
}
```

- [ ] **Step 6: Leave `currency-rates.ts` mostly as-is if it reads `canonical_fx_rates`**

Update to preferred canonical view:

```typescript
// src/lib/queries/analytics/currency-rates.ts
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function fetchLatestFxRates() {
  const sb = await createSupabaseServerClient();
  const { data } = await sb
    .from("canonical_fx_rates")
    .select("currency, rate, effective_date, is_stale")
    .eq("recency_rank", 1)
    .order("currency");
  return data ?? [];
}

export async function fetchFxHistory(currency: "USD" | "EUR", opts: { from?: string; to?: string } = {}) {
  const sb = await createSupabaseServerClient();
  let q = sb
    .from("canonical_fx_rates")
    .select("effective_date, rate")
    .eq("currency", currency)
    .order("effective_date");
  if (opts.from) q = q.gte("effective_date", opts.from);
  if (opts.to) q = q.lte("effective_date", opts.to);
  const { data } = await q;
  return data ?? [];
}
```

- [ ] **Step 7: Update `analytics/index.ts` barrel**

Remove re-exports of deleted functions. Add re-exports for the new ones. Minimal form:

```typescript
// src/lib/queries/analytics/index.ts
export * from "./customer-360";
export * from "./dashboard";
export * from "./finance";
export * from "./pnl";
export * from "./products";
export * from "./currency-rates";
```

If the previous index had cross-cutting functions inline (not just re-exports), move them to the appropriate domain file and re-export from here.

- [ ] **Step 8: Run tests; green**

```bash
npm run test -- src/__tests__/silver-sp5/analytics-smalls.test.ts 2>&1 | tail -30
```
Expected: 5 passing.

- [ ] **Step 9: Commit**

```bash
git add src/lib/queries/analytics/ src/__tests__/silver-sp5/analytics-smalls.test.ts
git commit -m "$(cat <<'EOF'
feat(sp5): task 7 — rewire analytics/{customer-360,dashboard,pnl,currency-rates,index}.ts

customer-360 → gold_company_360. pnl → gold_pl_statement. dashboard →
gold_reconciliation_health + gold_cashflow + gold_revenue_monthly +
gold_ceo_inbox. currency-rates → canonical_fx_rates. index barrel
pruned of dropped symbols.

Co-Authored-By: claude-flow <ruv@ruv.net>
EOF
)"
```

- [ ] **Step 10: Notes**

```markdown
## Task 7 — analytics/{customer-360,dashboard,pnl,currency-rates,index} (completed YYYY-MM-DD)

- Pre-existing exports removed from barrel: [list].
- New exports in barrel: fetchCustomer360, fetchTopCustomers, fetchTopSuppliers, fetchPL, fetchDashboardKpis, fetchDashboardAlerts, fetchLatestFxRates, fetchFxHistory.
- Tests: 5 passing.
- Consumer compilation state: [paste list of unresolved errors in /finanzas, /dashboard, /empresas/[id] pending later tasks].
```

---

### Task 8: Rewire `src/lib/queries/operational/sales.ts`

**Files:**
- Modify: `src/lib/queries/operational/sales.ts` (34 KB)
- Test: `src/__tests__/silver-sp5/operational-sales.test.ts`

**Context:** this is the `/ventas` page's data source. Reads `odoo_sale_orders` + `odoo_order_lines` + `odoo_crm_leads` + possibly `odoo_users` for salesperson joins. Replacement: `canonical_sale_orders` + `canonical_order_lines` + `canonical_crm_leads` + `canonical_contacts`.

- [ ] **Step 1: Inventory**

```bash
rg -n "\.from\(|\.rpc\(" src/lib/queries/operational/sales.ts > /tmp/sales-inventory.txt
```

- [ ] **Step 2: Write failing test**

Create `src/__tests__/silver-sp5/operational-sales.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from "vitest";
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const describeIntegration = URL && KEY ? describe : describe.skip;

describeIntegration("operational/sales.ts — canonical reads", () => {
  let listSaleOrders: (opts?: any) => Promise<any[]>;
  let listOrderLines: (opts?: any) => Promise<any[]>;
  let listCrmLeads: (opts?: any) => Promise<any[]>;
  let salesByPerson: () => Promise<any[]>;

  beforeAll(async () => {
    const mod = await import("@/lib/queries/operational/sales");
    listSaleOrders = mod.listSaleOrders;
    listOrderLines = mod.listSaleOrderLines ?? mod.listOrderLines;
    listCrmLeads = mod.listCrmLeads;
    salesByPerson = mod.salesBySalesperson ?? mod.salesByPerson;
  });

  it("listSaleOrders returns canonical_sale_orders rows", async () => {
    const rows = await listSaleOrders({ limit: 5 });
    expect(Array.isArray(rows)).toBe(true);
    if (rows.length > 0) {
      expect(rows[0]).toHaveProperty("canonical_id");
      expect(rows[0]).toHaveProperty("canonical_company_id");
      expect(rows[0]).toHaveProperty("amount_total");
    }
  });

  it("listOrderLines returns canonical_order_lines rows with order_type=sale filter", async () => {
    const rows = await listOrderLines({ limit: 5, orderType: "sale" });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toHaveProperty("canonical_product_id");
    expect(rows[0]).toHaveProperty("qty");
  });

  it("listCrmLeads returns canonical_crm_leads rows", async () => {
    const rows = await listCrmLeads({ limit: 5 });
    expect(Array.isArray(rows)).toBe(true);
  });

  it("source contains no banned legacy reads", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("src/lib/queries/operational/sales.ts", "utf8");
    const banned = ["from('odoo_sale_orders", "from('odoo_order_lines", "from('odoo_crm_leads", "from('orders_unified", "from('order_fulfillment_bridge"];
    for (const token of banned) expect(src).not.toContain(token);
  });
});
```

- [ ] **Step 3: Red**

```bash
npm run test -- src/__tests__/silver-sp5/operational-sales.test.ts 2>&1 | tail -30
```

- [ ] **Step 4: Rewrite core functions**

Replace each legacy block. Templates:

```typescript
import type { Database } from "@/lib/database.types";

type CanonicalSaleOrder = Database["public"]["Views"]["canonical_sale_orders"]["Row"] ??
  Database["public"]["Tables"]["canonical_sale_orders"]["Row"];

export interface ListSaleOrdersOptions {
  search?: string;
  canonicalCompanyId?: number;
  salespersonContactId?: number;
  state?: string;
  fromDate?: string;
  toDate?: string;
  limit?: number;
  offset?: number;
}

export async function listSaleOrders(opts: ListSaleOrdersOptions = {}) {
  const sb = await createSupabaseServerClient();
  let q = sb
    .from("canonical_sale_orders")
    .select(
      "canonical_id, name, canonical_company_id, salesperson_contact_id, amount_total, amount_untaxed, currency, state, date_order, commitment_date, is_commitment_overdue",
    )
    .order("date_order", { ascending: false, nullsFirst: false });
  if (opts.search) q = q.ilike("name", `%${opts.search}%`);
  if (typeof opts.canonicalCompanyId === "number") q = q.eq("canonical_company_id", opts.canonicalCompanyId);
  if (typeof opts.salespersonContactId === "number") q = q.eq("salesperson_contact_id", opts.salespersonContactId);
  if (opts.state) q = q.eq("state", opts.state);
  if (opts.fromDate) q = q.gte("date_order", opts.fromDate);
  if (opts.toDate) q = q.lte("date_order", opts.toDate);
  if (opts.limit) q = q.limit(opts.limit);
  if (opts.offset) q = q.range(opts.offset, opts.offset + (opts.limit ?? 50) - 1);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export interface ListOrderLinesOptions {
  orderType?: "sale" | "purchase";
  canonicalCompanyId?: number;
  canonicalProductId?: number;
  limit?: number;
  fromDate?: string;
  toDate?: string;
  onlyPendingInvoice?: boolean;
  onlyPendingDelivery?: boolean;
}

export async function listSaleOrderLines(opts: ListOrderLinesOptions = {}) {
  const sb = await createSupabaseServerClient();
  let q = sb
    .from("canonical_order_lines")
    .select("*")
    .eq("order_type", opts.orderType ?? "sale")
    .order("order_date", { ascending: false, nullsFirst: false });
  if (typeof opts.canonicalCompanyId === "number") q = q.eq("canonical_company_id", opts.canonicalCompanyId);
  if (typeof opts.canonicalProductId === "number") q = q.eq("canonical_product_id", opts.canonicalProductId);
  if (opts.fromDate) q = q.gte("order_date", opts.fromDate);
  if (opts.toDate) q = q.lte("order_date", opts.toDate);
  if (opts.onlyPendingInvoice) q = q.eq("has_pending_invoicing", true);
  if (opts.onlyPendingDelivery) q = q.eq("has_pending_delivery", true);
  if (opts.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function listCrmLeads(opts: { limit?: number } = {}) {
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb
    .from("canonical_crm_leads")
    .select("*")
    .order("create_date", { ascending: false, nullsFirst: false })
    .limit(opts.limit ?? 50);
  if (error) throw error;
  return data ?? [];
}

export async function salesBySalesperson(opts: { fromDate?: string; toDate?: string } = {}) {
  const sb = await createSupabaseServerClient();
  let q = sb
    .from("canonical_sale_orders")
    .select("salesperson_contact_id, amount_total");
  if (opts.fromDate) q = q.gte("date_order", opts.fromDate);
  if (opts.toDate) q = q.lte("date_order", opts.toDate);
  const { data } = await q;
  const byPerson: Record<number, { n: number; total_mxn: number }> = {};
  for (const r of data ?? []) {
    const k = Number((r as any).salesperson_contact_id);
    if (!k) continue;
    byPerson[k] ??= { n: 0, total_mxn: 0 };
    byPerson[k].n += 1;
    byPerson[k].total_mxn += Number(r.amount_total ?? 0);
  }
  return Object.entries(byPerson).map(([id, agg]) => ({
    salesperson_contact_id: Number(id),
    orders: agg.n,
    total_mxn: agg.total_mxn,
  }));
}

export async function fetchSalespersonMetadata(contactIds: number[]) {
  if (contactIds.length === 0) return [];
  const sb = await createSupabaseServerClient();
  const { data } = await sb
    .from("canonical_contacts")
    .select("id, display_name, primary_email, job_title, department_name")
    .in("id", contactIds);
  return data ?? [];
}
```

- [ ] **Step 5: Run; green**

```bash
npm run test -- src/__tests__/silver-sp5/operational-sales.test.ts 2>&1 | tail -30
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/queries/operational/sales.ts src/__tests__/silver-sp5/operational-sales.test.ts
git commit -m "$(cat <<'EOF'
feat(sp5): task 8 — rewire operational/sales.ts to canonical

odoo_sale_orders → canonical_sale_orders, odoo_order_lines →
canonical_order_lines (order_type='sale'), odoo_crm_leads →
canonical_crm_leads. Salesperson/customer linkage via
salesperson_contact_id + canonical_company_id FKs (SP3).

Co-Authored-By: claude-flow <ruv@ruv.net>
EOF
)"
```

- [ ] **Step 7: Notes**

```markdown
## Task 8 — operational/sales.ts (completed YYYY-MM-DD)

- Exports: listSaleOrders, listSaleOrderLines, listCrmLeads, salesBySalesperson, fetchSalespersonMetadata.
- Tests: 4 passing.
```

---

### Task 9: Rewire `src/lib/queries/operational/purchases.ts`

**Files:**
- Modify: `src/lib/queries/operational/purchases.ts` (25 KB)
- Test: `src/__tests__/silver-sp5/operational-purchases.test.ts`

- [ ] **Step 1: Inventory**

```bash
rg -n "\.from\(|\.rpc\(" src/lib/queries/operational/purchases.ts
```
Expected legacy tables: `odoo_purchase_orders`, `odoo_order_lines`, `odoo_account_payments`, `odoo_users` (buyer), `purchase_price_intelligence` (KEEP per §12).

- [ ] **Step 2: Write failing test**

Create `src/__tests__/silver-sp5/operational-purchases.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from "vitest";
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const describeIntegration = URL && KEY ? describe : describe.skip;

describeIntegration("operational/purchases.ts — canonical reads", () => {
  let listPurchaseOrders: (opts?: any) => Promise<any[]>;
  let listPurchaseOrderLines: (opts?: any) => Promise<any[]>;
  let listVendorPayments: (opts?: any) => Promise<any[]>;

  beforeAll(async () => {
    const mod = await import("@/lib/queries/operational/purchases");
    listPurchaseOrders = mod.listPurchaseOrders;
    listPurchaseOrderLines = mod.listPurchaseOrderLines;
    listVendorPayments = mod.listVendorPayments ?? mod.listSupplierPayments;
  });

  it("listPurchaseOrders reads canonical_purchase_orders", async () => {
    const rows = await listPurchaseOrders({ limit: 5 });
    if (rows.length > 0) expect(rows[0]).toHaveProperty("canonical_id");
  });

  it("listPurchaseOrderLines reads canonical_order_lines order_type=purchase", async () => {
    const rows = await listPurchaseOrderLines({ limit: 5 });
    if (rows.length > 0) expect(rows[0]).toHaveProperty("canonical_product_id");
  });

  it("listVendorPayments reads canonical_payments source='odoo' direction='received'", async () => {
    const rows = await listVendorPayments({ limit: 5 });
    expect(Array.isArray(rows)).toBe(true);
  });

  it("source contains no banned legacy reads", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("src/lib/queries/operational/purchases.ts", "utf8");
    const banned = ["from('odoo_purchase_orders", "from('odoo_order_lines", "from('odoo_account_payments", "from('payments_unified"];
    for (const token of banned) expect(src).not.toContain(token);
  });
});
```

- [ ] **Step 3: Red**

```bash
npm run test -- src/__tests__/silver-sp5/operational-purchases.test.ts 2>&1 | tail -30
```

- [ ] **Step 4: Rewrite**

```typescript
export interface ListPurchaseOrdersOptions {
  search?: string;
  canonicalCompanyId?: number;
  buyerContactId?: number;
  state?: string;
  fromDate?: string;
  toDate?: string;
  limit?: number;
}

export async function listPurchaseOrders(opts: ListPurchaseOrdersOptions = {}) {
  const sb = await createSupabaseServerClient();
  let q = sb
    .from("canonical_purchase_orders")
    .select(
      "canonical_id, name, canonical_company_id, buyer_contact_id, amount_total, amount_untaxed, currency, state, date_order, date_approve",
    )
    .order("date_order", { ascending: false, nullsFirst: false });
  if (opts.search) q = q.ilike("name", `%${opts.search}%`);
  if (typeof opts.canonicalCompanyId === "number") q = q.eq("canonical_company_id", opts.canonicalCompanyId);
  if (typeof opts.buyerContactId === "number") q = q.eq("buyer_contact_id", opts.buyerContactId);
  if (opts.state) q = q.eq("state", opts.state);
  if (opts.fromDate) q = q.gte("date_order", opts.fromDate);
  if (opts.toDate) q = q.lte("date_order", opts.toDate);
  if (opts.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function listPurchaseOrderLines(opts: { canonicalCompanyId?: number; canonicalProductId?: number; limit?: number } = {}) {
  const sb = await createSupabaseServerClient();
  let q = sb
    .from("canonical_order_lines")
    .select("*")
    .eq("order_type", "purchase")
    .order("order_date", { ascending: false, nullsFirst: false });
  if (typeof opts.canonicalCompanyId === "number") q = q.eq("canonical_company_id", opts.canonicalCompanyId);
  if (typeof opts.canonicalProductId === "number") q = q.eq("canonical_product_id", opts.canonicalProductId);
  if (opts.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function listVendorPayments(opts: { canonicalCompanyId?: number; limit?: number } = {}) {
  const sb = await createSupabaseServerClient();
  let q = sb
    .from("canonical_payments")
    .select(
      "canonical_id, canonical_company_id, payment_date, amount_mxn, currency, method, source, odoo_move_id",
    )
    .order("payment_date", { ascending: false, nullsFirst: false });
  if (typeof opts.canonicalCompanyId === "number") q = q.eq("canonical_company_id", opts.canonicalCompanyId);
  if (opts.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

// KEEP per §12 — purchase_price_intelligence view (no changes)
export const listSupplierPayments = listVendorPayments;  // back-compat
```

- [ ] **Step 5: Verify `buyer_contact_id` column name on canonical_purchase_orders**

```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='canonical_purchase_orders'
ORDER BY ordinal_position;
```
If named differently (e.g. `buyer_canonical_contact_id`), adjust the query above and the test.

- [ ] **Step 6: Run; green**

```bash
npm run test -- src/__tests__/silver-sp5/operational-purchases.test.ts 2>&1 | tail -30
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/queries/operational/purchases.ts src/__tests__/silver-sp5/operational-purchases.test.ts
git commit -m "$(cat <<'EOF'
feat(sp5): task 9 — rewire operational/purchases.ts to canonical

odoo_purchase_orders → canonical_purchase_orders, odoo_order_lines →
canonical_order_lines (order_type='purchase'), odoo_account_payments
→ canonical_payments. purchase_price_intelligence retained (§12 KEEP).

Co-Authored-By: claude-flow <ruv@ruv.net>
EOF
)"
```

- [ ] **Step 8: Notes**

```markdown
## Task 9 — operational/purchases.ts (completed YYYY-MM-DD)

- Exports: listPurchaseOrders, listPurchaseOrderLines, listVendorPayments.
- Back-compat alias: listSupplierPayments.
- buyer_contact_id column verified on canonical_purchase_orders.
- Tests: 4 passing.
```

---

### Task 10: Rewire `operational/operations.ts` + `operational/team.ts`

**Files:**
- Modify: `src/lib/queries/operational/operations.ts` (15 KB)
- Modify: `src/lib/queries/operational/team.ts` (9 KB)
- Test: `src/__tests__/silver-sp5/operational-operations.test.ts`, `src/__tests__/silver-sp5/operational-team.test.ts`

- [ ] **Step 1: Inventory**

```bash
rg -n "\.from\(|\.rpc\(" src/lib/queries/operational/operations.ts src/lib/queries/operational/team.ts
```
Expected legacy: `odoo_deliveries`, `odoo_manufacturing`, `odoo_activities`, `odoo_users`, `odoo_employees`, `odoo_departments`, `odoo_orderpoints`. KEEP per §12: `inventory_velocity`, `dead_stock_analysis`, `ops_delivery_health_weekly`.

- [ ] **Step 2: Write failing tests**

`src/__tests__/silver-sp5/operational-operations.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from "vitest";
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const describeIntegration = URL && KEY ? describe : describe.skip;

describeIntegration("operational/operations.ts", () => {
  it("listDeliveries reads canonical_deliveries", async () => {
    const mod = await import("@/lib/queries/operational/operations");
    const rows = await mod.listDeliveries({ limit: 5 });
    if (rows.length > 0) expect(rows[0]).toHaveProperty("canonical_id");
  });

  it("listManufacturingOrders reads canonical_manufacturing", async () => {
    const mod = await import("@/lib/queries/operational/operations");
    const rows = await mod.listManufacturingOrders({ limit: 5 });
    expect(Array.isArray(rows)).toBe(true);
  });

  it("listInventory reads canonical_inventory", async () => {
    const mod = await import("@/lib/queries/operational/operations");
    const rows = await mod.listInventory({ limit: 5 });
    expect(Array.isArray(rows)).toBe(true);
  });

  it("source contains no banned reads", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("src/lib/queries/operational/operations.ts", "utf8");
    for (const token of ["from('odoo_deliveries", "from('odoo_manufacturing", "from('odoo_orderpoints"]) {
      expect(src).not.toContain(token);
    }
  });
});
```

`src/__tests__/silver-sp5/operational-team.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from "vitest";
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const describeIntegration = URL && KEY ? describe : describe.skip;

describeIntegration("operational/team.ts", () => {
  it("listTeamMembers reads canonical_employees (view)", async () => {
    const mod = await import("@/lib/queries/operational/team");
    const rows = await mod.listTeamMembers({ limit: 5 });
    expect(Array.isArray(rows)).toBe(true);
    if (rows.length > 0) {
      expect(rows[0]).toHaveProperty("display_name");
      expect(rows[0]).toHaveProperty("department_name");
    }
  });

  it("source contains no banned reads", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("src/lib/queries/operational/team.ts", "utf8");
    for (const token of ["from('odoo_users", "from('odoo_employees", "from('odoo_departments", "from('person_unified"]) {
      expect(src).not.toContain(token);
    }
  });
});
```

- [ ] **Step 3: Red**

```bash
npm run test -- src/__tests__/silver-sp5/operational-operations.test.ts src/__tests__/silver-sp5/operational-team.test.ts 2>&1 | tail -30
```

- [ ] **Step 4: Rewrite `operations.ts`**

```typescript
export async function listDeliveries(opts: {
  canonicalCompanyId?: number;
  state?: string;
  onlyLate?: boolean;
  fromDate?: string;
  toDate?: string;
  limit?: number;
} = {}) {
  const sb = await createSupabaseServerClient();
  let q = sb
    .from("canonical_deliveries")
    .select("*")
    .order("scheduled_date", { ascending: false, nullsFirst: false });
  if (typeof opts.canonicalCompanyId === "number") q = q.eq("canonical_company_id", opts.canonicalCompanyId);
  if (opts.state) q = q.eq("state", opts.state);
  if (opts.onlyLate) q = q.eq("is_late", true);
  if (opts.fromDate) q = q.gte("scheduled_date", opts.fromDate);
  if (opts.toDate) q = q.lte("scheduled_date", opts.toDate);
  if (opts.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function listManufacturingOrders(opts: { state?: string; limit?: number } = {}) {
  const sb = await createSupabaseServerClient();
  let q = sb
    .from("canonical_manufacturing")
    .select("*")
    .order("date_start", { ascending: false, nullsFirst: false });
  if (opts.state) q = q.eq("state", opts.state);
  if (opts.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function listInventory(opts: {
  onlyStockouts?: boolean;
  onlyUntuned?: boolean;
  canonicalProductId?: number;
  limit?: number;
} = {}) {
  const sb = await createSupabaseServerClient();
  let q = sb.from("canonical_inventory").select("*");
  if (opts.onlyStockouts) q = q.lte("available_qty", 0);
  if (opts.onlyUntuned) q = q.eq("is_untuned", true);
  if (typeof opts.canonicalProductId === "number") q = q.eq("canonical_product_id", opts.canonicalProductId);
  if (opts.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

// KEEP per §12 (diagnostic/KPI views)
export async function fetchInventoryVelocity() {
  const sb = await createSupabaseServerClient();
  const { data } = await sb.from("inventory_velocity").select("*").limit(200);
  return data ?? [];  // SP5-VERIFIED: inventory_velocity retained (§12 KEEP)
}

export async function fetchDeadStockAnalysis() {
  const sb = await createSupabaseServerClient();
  const { data } = await sb.from("dead_stock_analysis").select("*").limit(200);
  return data ?? [];  // SP5-VERIFIED: dead_stock_analysis retained (§12 KEEP)
}
```

- [ ] **Step 5: Rewrite `team.ts`**

```typescript
export async function listTeamMembers(opts: { departmentName?: string; limit?: number } = {}) {
  const sb = await createSupabaseServerClient();
  let q = sb
    .from("canonical_employees")
    .select("id, display_name, primary_email, department_name, job_title, manager_contact_id, is_active")
    .eq("is_active", true)
    .order("display_name");
  if (opts.departmentName) q = q.eq("department_name", opts.departmentName);
  if (opts.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function listDepartments() {
  const sb = await createSupabaseServerClient();
  const { data } = await sb
    .from("canonical_employees")
    .select("department_name")
    .not("department_name", "is", null);
  const unique = Array.from(new Set((data ?? []).map((r) => r.department_name))).sort();
  return unique.map((name) => ({ name }));
}

export async function fetchEmployeeWorkload(contactId: number) {
  const sb = await createSupabaseServerClient();
  // Open insights + open issues assigned
  const [{ count: openInsights }, { count: openIssues }] = await Promise.all([
    sb.from("agent_insights").select("*", { count: "exact", head: true }).eq("assignee_canonical_contact_id", contactId).is("resolved_at", null),
    sb.from("reconciliation_issues").select("*", { count: "exact", head: true }).eq("assignee_canonical_contact_id", contactId).is("resolved_at", null),
  ]);
  return { open_insights: openInsights ?? 0, open_issues: openIssues ?? 0 };
}
```

- [ ] **Step 6: Verify `agent_insights.assignee_canonical_contact_id` column exists**

```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='agent_insights' AND column_name LIKE 'assignee%';
```
If the existing column is `assignee_user_id` (integer referencing odoo_users), adapt `fetchEmployeeWorkload` to accept an `odoo_user_id` parameter + add a helper that maps `canonical_contacts.odoo_user_id → contact.id`. Do NOT add a column to `agent_insights` in SP5; reuse what's already there.

- [ ] **Step 7: Run; green**

```bash
npm run test -- src/__tests__/silver-sp5/operational-operations.test.ts src/__tests__/silver-sp5/operational-team.test.ts 2>&1 | tail -30
```

- [ ] **Step 8: Commit**

```bash
git add src/lib/queries/operational/operations.ts src/lib/queries/operational/team.ts src/__tests__/silver-sp5/operational-operations.test.ts src/__tests__/silver-sp5/operational-team.test.ts
git commit -m "$(cat <<'EOF'
feat(sp5): task 10 — rewire operational/{operations,team}.ts to canonical

operations: odoo_deliveries → canonical_deliveries, odoo_manufacturing
→ canonical_manufacturing, odoo_orderpoints → canonical_inventory.
team: odoo_users / odoo_employees / odoo_departments → canonical_employees
(which is a view over canonical_contacts WHERE is_internal=true).
inventory_velocity / dead_stock_analysis retained (§12 KEEP).

Co-Authored-By: claude-flow <ruv@ruv.net>
EOF
)"
```

- [ ] **Step 9: Notes**

```markdown
## Task 10 — operational/{operations,team}.ts (completed YYYY-MM-DD)

- operations exports: listDeliveries, listManufacturingOrders, listInventory, fetchInventoryVelocity (KEEP), fetchDeadStockAnalysis (KEEP).
- team exports: listTeamMembers, listDepartments, fetchEmployeeWorkload.
- assignee column verified: [assignee_canonical_contact_id | assignee_user_id → note which].
- Tests: 5 passing.
```

---

### Task 11: Rewire `src/lib/queries/unified/*` (deprecate folder)

**Files:**
- Modify: `src/lib/queries/unified/invoices.ts` (22 KB) — point at canonical
- Modify: `src/lib/queries/unified/invoice-detail.ts` (5 KB)
- Modify: `src/lib/queries/unified/index.ts` (7.6 KB)
- Test: `src/__tests__/silver-sp5/unified-invoices.test.ts`

**Context:** the entire `queries/unified/` folder was the frontend bridge over `invoices_unified` / `unified_invoices` / `unified_payment_allocations` MVs. SP5 cutover drops those MVs (Task 28) — but consumers still import `listInvoices` / `fetchInvoiceDetail` from this folder. We preserve the import surface, rewire the implementation to canonical_invoices + canonical_payment_allocations.

- [ ] **Step 1: Inventory**

```bash
rg -n "\.from\(|\.rpc\(" src/lib/queries/unified/invoices.ts src/lib/queries/unified/invoice-detail.ts src/lib/queries/unified/index.ts
```
Expected hits: `invoices_unified`, `unified_invoices`, `unified_payment_allocations`. Possibly also `payments_unified`.

- [ ] **Step 2: Write failing integration test**

Create `src/__tests__/silver-sp5/unified-invoices.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from "vitest";
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const describeIntegration = URL && KEY ? describe : describe.skip;

describeIntegration("unified/invoices.ts — canonical reads", () => {
  let listInvoices: (opts?: any) => Promise<any[]>;
  let fetchInvoiceDetail: (canonical_id: string) => Promise<any>;

  beforeAll(async () => {
    const mod = await import("@/lib/queries/unified/invoices");
    listInvoices = mod.listInvoices;
    const detailMod = await import("@/lib/queries/unified/invoice-detail");
    fetchInvoiceDetail = detailMod.fetchInvoiceDetail ?? detailMod.getInvoiceDetail;
  });

  it("listInvoices returns canonical_invoices rows with fiscal/operational fields", async () => {
    const rows = await listInvoices({ limit: 5 });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toHaveProperty("canonical_id");
    expect(rows[0]).toHaveProperty("uuid_sat");
    expect(rows[0]).toHaveProperty("direction");
    expect(rows[0]).toHaveProperty("amount_total_mxn_resolved");
    expect(rows[0]).toHaveProperty("match_status");
  });

  it("fetchInvoiceDetail returns full invoice with allocations", async () => {
    const list = await listInvoices({ limit: 1, withAllocations: true });
    if (list.length > 0) {
      const det = await fetchInvoiceDetail(list[0].canonical_id);
      expect(det).toBeTruthy();
      expect(det).toHaveProperty("canonical_id");
      expect(det).toHaveProperty("allocations");
      expect(Array.isArray(det.allocations)).toBe(true);
    }
  });

  it("sources contain no legacy unified/invoices_unified reads", async () => {
    const fs = await import("node:fs");
    for (const f of [
      "src/lib/queries/unified/invoices.ts",
      "src/lib/queries/unified/invoice-detail.ts",
      "src/lib/queries/unified/index.ts",
    ]) {
      const src = fs.readFileSync(f, "utf8");
      for (const token of ["from('invoices_unified", "from('unified_invoices", "from('unified_payment_allocations", "from('payments_unified"]) {
        expect(src).not.toContain(token);
      }
    }
  });
});
```

- [ ] **Step 3: Red**

```bash
npm run test -- src/__tests__/silver-sp5/unified-invoices.test.ts 2>&1 | tail -30
```

- [ ] **Step 4: Rewrite `unified/invoices.ts` preserving export surface**

```typescript
// src/lib/queries/unified/invoices.ts
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";

type CanonicalInvoice = Database["public"]["Tables"]["canonical_invoices"]["Row"];
type CanonicalAllocation = Database["public"]["Tables"]["canonical_payment_allocations"]["Row"];

export interface ListInvoicesOptions {
  direction?: "issued" | "received";
  matchStatus?: string;
  canonicalCompanyId?: number;
  fromDate?: string;
  toDate?: string;
  onlyOpen?: boolean;
  onlyOverdue?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
  withAllocations?: boolean;
}

export async function listInvoices(opts: ListInvoicesOptions = {}): Promise<CanonicalInvoice[]> {
  const sb = await createSupabaseServerClient();
  let q = sb
    .from("canonical_invoices")
    .select("*")
    .order("invoice_date", { ascending: false, nullsFirst: false });
  if (opts.direction) q = q.eq("direction", opts.direction);
  if (opts.matchStatus) q = q.eq("match_status", opts.matchStatus);
  if (typeof opts.canonicalCompanyId === "number") {
    q = q.or(
      `emisor_canonical_company_id.eq.${opts.canonicalCompanyId},receptor_canonical_company_id.eq.${opts.canonicalCompanyId}`,
    );
  }
  if (opts.fromDate) q = q.gte("invoice_date", opts.fromDate);
  if (opts.toDate) q = q.lte("invoice_date", opts.toDate);
  if (opts.onlyOpen) q = q.gt("amount_residual_mxn_resolved", 0);
  if (opts.onlyOverdue) q = q.gt("days_overdue", 0);
  if (opts.search) q = q.or(`uuid_sat.ilike.%${opts.search}%,odoo_ref.ilike.%${opts.search}%`);
  if (opts.limit) q = q.limit(opts.limit);
  if (opts.offset) q = q.range(opts.offset, opts.offset + (opts.limit ?? 50) - 1);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function listAllocations(canonical_invoice_id: string): Promise<CanonicalAllocation[]> {
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb
    .from("canonical_payment_allocations")
    .select("*")
    .eq("canonical_invoice_id", canonical_invoice_id)
    .order("allocation_date", { ascending: false, nullsFirst: false });
  if (error) throw error;
  return data ?? [];
}

export async function invoicesReceivableAging(opts: { asOf?: string } = {}) {
  const sb = await createSupabaseServerClient();
  const { data } = await sb
    .from("canonical_invoices")
    .select("days_overdue, amount_residual_mxn_resolved")
    .eq("direction", "issued")
    .gt("amount_residual_mxn_resolved", 0);
  const buckets = { current: 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
  for (const r of data ?? []) {
    const amt = Number(r.amount_residual_mxn_resolved ?? 0);
    const d = Number(r.days_overdue ?? 0);
    if (d <= 0) buckets.current += amt;
    else if (d <= 30) buckets["1-30"] += amt;
    else if (d <= 60) buckets["31-60"] += amt;
    else if (d <= 90) buckets["61-90"] += amt;
    else buckets["90+"] += amt;
  }
  return buckets;
}
```

- [ ] **Step 5: Rewrite `unified/invoice-detail.ts`**

```typescript
// src/lib/queries/unified/invoice-detail.ts
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listAllocations } from "./invoices";

export async function fetchInvoiceDetail(canonical_id: string) {
  const sb = await createSupabaseServerClient();
  const [{ data: inv, error: invErr }, allocations, { data: lines }] = await Promise.all([
    sb.from("canonical_invoices").select("*").eq("canonical_id", canonical_id).maybeSingle(),
    listAllocations(canonical_id),
    // SP5-EXCEPTION: odoo_invoice_lines read — canonical_invoice_lines not yet shipped (future SP6)
    sb.from("odoo_invoice_lines").select("*").eq("odoo_move_id", canonical_id.startsWith("odoo:") ? Number(canonical_id.slice(5)) : -1),
  ]);
  if (invErr) throw invErr;
  if (!inv) return null;
  return {
    ...inv,
    allocations,
    lines: lines ?? [],
  };
}

export const getInvoiceDetail = fetchInvoiceDetail;
```

**Notes on the exception:** `odoo_invoice_lines` is not in SP5 scope as a canonical table (spec §5.9-5.19 did not ship it; SP4 shipped `canonical_order_lines` but not `canonical_invoice_lines`). The frontend invoice detail tab reads line items directly from Bronze. Mark the line explicitly with `// SP5-EXCEPTION:` so the grep gate recognizes it. This exception MUST be listed in the Task 30 notes as a known remaining Bronze dependency.

- [ ] **Step 6: Rewrite `unified/index.ts` barrel**

```typescript
// src/lib/queries/unified/index.ts
// SP5 note: this folder is retained as a compat surface. New code should import from
// src/lib/queries/analytics/ or operational/ or _shared/ directly. The folder will be
// physically removed in a future cleanup (post-SP5 soak).
export * from "./invoices";
export * from "./invoice-detail";
```

- [ ] **Step 7: Run tests; green**

```bash
npm run test -- src/__tests__/silver-sp5/unified-invoices.test.ts 2>&1 | tail -30
```

- [ ] **Step 8: Commit**

```bash
git add src/lib/queries/unified/ src/__tests__/silver-sp5/unified-invoices.test.ts
git commit -m "$(cat <<'EOF'
feat(sp5): task 11 — rewire unified/ folder to canonical

invoices_unified / unified_invoices / unified_payment_allocations
→ canonical_invoices + canonical_payment_allocations. Preserves
import surface (listInvoices, fetchInvoiceDetail, listAllocations,
invoicesReceivableAging) for downstream consumers.

Single SP5-EXCEPTION: odoo_invoice_lines read in invoice-detail
(no canonical_invoice_lines shipped; out of scope for SP5).

Co-Authored-By: claude-flow <ruv@ruv.net>
EOF
)"
```

- [ ] **Step 9: Notes**

```markdown
## Task 11 — unified/ folder (completed YYYY-MM-DD)

- invoices.ts rewired to canonical_invoices + canonical_payment_allocations.
- invoice-detail.ts rewired (+ 1 SP5-EXCEPTION for odoo_invoice_lines line items).
- index.ts barrel reduced to 2 re-exports.
- Tests: 3 passing.
- SP5-EXCEPTION logged: odoo_invoice_lines for invoice line item reads (no canonical_invoice_lines in SP4 scope; raise for SP6).
```

---

### Task 12: Rewire `/inbox` pages

**Files:**
- Modify: `src/app/inbox/page.tsx`
- Modify: `src/app/inbox/_components/*.tsx` (component-level rewire as needed)
- Modify: `src/app/inbox/insight/[id]/page.tsx`
- Create: `src/lib/queries/intelligence/inbox.ts` — new inbox query module
- Test: `src/__tests__/silver-sp5/inbox.test.ts`

**Context:** `/inbox` is the CEO's main consumption point. Spec §13.3 defines the contract: top 50 rows from `gold_ceo_inbox`, priority_score-ordered. The detail page (`/inbox/insight/[id]`) consumes evidence layer (email_signals, ai_extracted_facts, attachments, manual_notes). Current implementation likely reads from `reconciliation_issues` + `agent_insights` directly; SP5 points it at `gold_ceo_inbox`.

- [ ] **Step 1: Inventory current inbox queries**

```bash
rg -n "\.from\(|\.rpc\(" src/app/inbox/
```

- [ ] **Step 2: Create `src/lib/queries/intelligence/inbox.ts`**

```typescript
// src/lib/queries/intelligence/inbox.ts
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";

type InboxRow = Database["public"]["Views"]["gold_ceo_inbox"]["Row"];

export interface ListInboxOptions {
  limit?: number;
  severity?: "critical" | "high" | "medium" | "low";
  canonicalEntityType?: "invoice" | "payment" | "company" | "contact" | "product";
  assigneeCanonicalContactId?: number;
}

export async function listInbox(opts: ListInboxOptions = {}): Promise<InboxRow[]> {
  const sb = await createSupabaseServerClient();
  let q = sb
    .from("gold_ceo_inbox")
    .select("*")
    .order("priority_score", { ascending: false, nullsFirst: false });
  if (opts.severity) q = q.eq("severity", opts.severity);
  if (opts.canonicalEntityType) q = q.eq("canonical_entity_type", opts.canonicalEntityType);
  if (typeof opts.assigneeCanonicalContactId === "number") {
    q = q.eq("assignee_canonical_contact_id" as any, opts.assigneeCanonicalContactId);
  }
  q = q.limit(opts.limit ?? 50);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function fetchInboxItem(issue_id: string) {
  const sb = await createSupabaseServerClient();
  const { data: row, error } = await sb
    .from("gold_ceo_inbox")
    .select("*")
    .eq("issue_id", issue_id)
    .maybeSingle();
  if (error) throw error;
  if (!row) return null;
  const [{ data: signals }, { data: facts }, { data: notes }, { data: atts }] = await Promise.all([
    sb.from("email_signals").select("*").eq("canonical_entity_type", row.canonical_entity_type).eq("canonical_entity_id", row.canonical_entity_id).limit(25),
    sb.from("ai_extracted_facts").select("*").eq("canonical_entity_type", row.canonical_entity_type).eq("canonical_entity_id", row.canonical_entity_id).limit(25),
    sb.from("manual_notes").select("*").eq("canonical_entity_type", row.canonical_entity_type).eq("canonical_entity_id", row.canonical_entity_id).order("created_at", { ascending: false }).limit(25),
    sb.from("attachments").select("*").eq("canonical_entity_type", row.canonical_entity_type).eq("canonical_entity_id", row.canonical_entity_id).limit(25),
  ]);
  return {
    ...row,
    email_signals: signals ?? [],
    ai_extracted_facts: facts ?? [],
    manual_notes: notes ?? [],
    attachments: atts ?? [],
  };
}
```

- [ ] **Step 3: Write failing inbox tests**

`src/__tests__/silver-sp5/inbox.test.ts`:

```typescript
import { describe, it, expect, beforeAll } from "vitest";
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const describeIntegration = URL && KEY ? describe : describe.skip;

describeIntegration("intelligence/inbox.ts", () => {
  it("listInbox returns ≤50 rows from gold_ceo_inbox with required fields", async () => {
    const mod = await import("@/lib/queries/intelligence/inbox");
    const rows = await mod.listInbox({ limit: 50 });
    expect(rows.length).toBeLessThanOrEqual(50);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r).toHaveProperty("issue_id");
      expect(r).toHaveProperty("severity");
      expect(r).toHaveProperty("priority_score");
      expect(r).toHaveProperty("canonical_entity_type");
    }
  });

  it("fetchInboxItem returns evidence arrays", async () => {
    const mod = await import("@/lib/queries/intelligence/inbox");
    const [first] = await mod.listInbox({ limit: 1 });
    if (first) {
      const item = await mod.fetchInboxItem(first.issue_id);
      expect(item).toBeTruthy();
      expect(Array.isArray(item!.email_signals)).toBe(true);
      expect(Array.isArray(item!.ai_extracted_facts)).toBe(true);
      expect(Array.isArray(item!.manual_notes)).toBe(true);
      expect(Array.isArray(item!.attachments)).toBe(true);
    }
  });

  it("inbox page uses listInbox (grep check)", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("src/app/inbox/page.tsx", "utf8");
    expect(src).toMatch(/listInbox|fetchInbox/);
    expect(src).not.toContain("from('reconciliation_issues");
    expect(src).not.toContain('from("reconciliation_issues');
  });
});
```

- [ ] **Step 4: Red**

```bash
npm run test -- src/__tests__/silver-sp5/inbox.test.ts 2>&1 | tail -30
```

- [ ] **Step 5: Rewrite `src/app/inbox/page.tsx`**

```tsx
// src/app/inbox/page.tsx
import { listInbox } from "@/lib/queries/intelligence/inbox";
import { InboxListClient } from "./_components/InboxListClient";

export default async function InboxPage() {
  const items = await listInbox({ limit: 50 });
  return <InboxListClient items={items} />;
}
```

If the page has filters (severity, assignee), thread them via searchParams → options to `listInbox`. Preserve any existing UI components under `_components/`; just change the data source they receive.

- [ ] **Step 6: Rewrite `src/app/inbox/insight/[id]/page.tsx`**

```tsx
// src/app/inbox/insight/[id]/page.tsx
import { fetchInboxItem } from "@/lib/queries/intelligence/inbox";
import { notFound } from "next/navigation";
import { InsightDetail } from "./_components/InsightDetail";

export default async function InsightPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = await fetchInboxItem(id);
  if (!item) return notFound();
  return <InsightDetail item={item} />;
}
```

- [ ] **Step 7: Green**

```bash
npm run test -- src/__tests__/silver-sp5/inbox.test.ts 2>&1 | tail -30
```

- [ ] **Step 8: Manual smoke**

```bash
npm run dev
# Open http://localhost:3000/inbox and verify:
#   - Top row is highest-priority issue from gold_ceo_inbox (typically invoice.posted_without_uuid ~MXN 10.7M impact)
#   - Clicking a row navigates to /inbox/insight/<id> and loads detail with tabs for evidence
# Ctrl+C
```

- [ ] **Step 9: Commit**

```bash
git add src/lib/queries/intelligence/inbox.ts src/app/inbox/ src/__tests__/silver-sp5/inbox.test.ts
git commit -m "$(cat <<'EOF'
feat(sp5): task 12 — rewire /inbox to gold_ceo_inbox

New intelligence/inbox.ts exposes listInbox + fetchInboxItem backed
by gold_ceo_inbox + evidence tables. /inbox/page.tsx and
/inbox/insight/[id]/page.tsx rewired.

Co-Authored-By: claude-flow <ruv@ruv.net>
EOF
)"
```

- [ ] **Step 10: Notes**

```markdown
## Task 12 — /inbox (completed YYYY-MM-DD)

- New module: intelligence/inbox.ts with listInbox + fetchInboxItem.
- Page sources rewired: inbox/page.tsx + inbox/insight/[id]/page.tsx.
- Manual smoke: top issue at load was "<paste issue_type + impact_mxn>".
- Tests: 3 passing.
```

---

### Task 13: Rewire `/empresas` + `/empresas/[id]` + PanoramaTab

**Files:**
- Modify: `src/app/empresas/page.tsx`
- Modify: `src/app/empresas/[id]/page.tsx`
- Modify: `src/app/empresas/[id]/_components/PanoramaTab.tsx`
- Modify: `src/app/empresas/[id]/_components/*.tsx` (other tabs if they have direct legacy reads)
- Modify: `src/components/patterns/company-link.tsx`
- Test: `src/__tests__/silver-sp5/empresas-pages.test.ts`

- [ ] **Step 1: Inventory**

```bash
rg -n "\.from\(|\.rpc\(" src/app/empresas/
rg -n "company_profile|analytics_customer_360|monthly_revenue" src/app/empresas/
```

- [ ] **Step 2: Failing test**

`src/__tests__/silver-sp5/empresas-pages.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

describe("/empresas pages — no legacy reads", () => {
  const files = [
    "src/app/empresas/page.tsx",
    "src/app/empresas/[id]/page.tsx",
    "src/app/empresas/[id]/_components/PanoramaTab.tsx",
    "src/components/patterns/company-link.tsx",
  ];
  for (const f of files) {
    it(`${f} has no banned legacy reads`, () => {
      const src = readFileSync(f, "utf8");
      const banned = [
        "from('company_profile",
        "from('analytics_customer_360",
        "from('monthly_revenue_by_company",
        "from('monthly_revenue_trend",
        "from('odoo_invoices",
        "from('odoo_sale_orders",
      ];
      for (const token of banned) expect(src).not.toContain(token);
    });
  }

  it("PanoramaTab reads gold_company_360", () => {
    const src = readFileSync("src/app/empresas/[id]/_components/PanoramaTab.tsx", "utf8");
    expect(src).toMatch(/fetchCompany360|fetchCustomer360|gold_company_360/);
  });
});
```

- [ ] **Step 3: Red**

```bash
npm run test -- src/__tests__/silver-sp5/empresas-pages.test.ts 2>&1 | tail -20
```

- [ ] **Step 4: Rewrite `empresas/page.tsx`**

```tsx
// src/app/empresas/page.tsx
import { listCompanies } from "@/lib/queries/_shared/companies";
import { EmpresasListClient } from "./_components/EmpresasListClient";

export default async function EmpresasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const search = typeof sp.q === "string" ? sp.q : undefined;
  const page = Number(sp.page ?? 1);
  const items = await listCompanies({
    search,
    limit: 50,
    offset: (page - 1) * 50,
    onlyCustomers: sp.filter === "customers" ? true : undefined,
    onlySuppliers: sp.filter === "suppliers" ? true : undefined,
  });
  return <EmpresasListClient items={items} />;
}
```

- [ ] **Step 5: Rewrite `empresas/[id]/page.tsx`**

```tsx
// src/app/empresas/[id]/page.tsx
import { fetchCompanyById, fetchCompany360, fetchCompanyInvoices, fetchCompanyReceivables, fetchCompanyPayables } from "@/lib/queries/_shared/companies";
import { listContacts } from "@/lib/queries/_shared/contacts";
import { notFound } from "next/navigation";
import { CompanyDetailClient } from "./_components/CompanyDetailClient";

export default async function CompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const numId = Number(id);
  if (!Number.isFinite(numId)) return notFound();
  const [company, company360, invoices, receivables, payables, contacts] = await Promise.all([
    fetchCompanyById(numId),
    fetchCompany360(numId),
    fetchCompanyInvoices(numId, { limit: 200 }),
    fetchCompanyReceivables(numId),
    fetchCompanyPayables(numId),
    listContacts({ canonicalCompanyId: numId, limit: 100 }),
  ]);
  if (!company) return notFound();
  return (
    <CompanyDetailClient
      company={company}
      company360={company360}
      invoices={invoices}
      receivables={receivables}
      payables={payables}
      contacts={contacts}
    />
  );
}
```

- [ ] **Step 6: Rewrite `PanoramaTab.tsx`**

```tsx
// src/app/empresas/[id]/_components/PanoramaTab.tsx
import type { Database } from "@/lib/database.types";

type GoldCompany360 = Database["public"]["Views"]["gold_company_360"]["Row"];

interface Props {
  company360: GoldCompany360 | null;
}

export function PanoramaTab({ company360 }: Props) {
  if (!company360) return <div className="text-sm text-zinc-500">Sin datos consolidados.</div>;
  return (
    <div className="grid grid-cols-2 gap-4">
      <Kpi label="LTV (MXN)" value={company360.lifetime_value_mxn} />
      <Kpi label="Ingresos YTD (MXN)" value={company360.revenue_ytd_mxn} />
      <Kpi label="Vencido (MXN)" value={company360.overdue_amount_mxn} />
      <Kpi label="Órdenes venta 12m" value={company360.sales_orders_12m} />
      <Kpi label="Issues abiertas" value={company360.open_company_issues_count} />
      <Kpi label="Blacklist" value={company360.blacklist_level} />
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="rounded border p-3">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="text-lg font-medium">{String(value ?? "—")}</div>
    </div>
  );
}
```

If the existing PanoramaTab has heavier UI (charts etc.), preserve the markup and only swap the data sources.

- [ ] **Step 7: Rewrite `company-link.tsx`**

```tsx
// src/components/patterns/company-link.tsx
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";

interface Props {
  canonicalCompanyId?: number | null;
  odooPartnerId?: number | null;
  children: React.ReactNode;
  className?: string;
}

export async function CompanyLink({ canonicalCompanyId, odooPartnerId, children, className }: Props) {
  let id = canonicalCompanyId ?? null;
  if (!id && odooPartnerId != null) {
    const sb = await createSupabaseServerClient();
    const { data } = await sb
      .from("canonical_companies")
      .select("id")
      .eq("odoo_partner_id", odooPartnerId)
      .maybeSingle();
    id = data?.id ?? null;
  }
  if (!id) return <span className={className}>{children}</span>;
  return <Link href={`/empresas/${id}`} className={className}>{children}</Link>;
}
```

- [ ] **Step 8: Verify tabs other than PanoramaTab still compile**

List the tab components:
```bash
ls src/app/empresas/[id]/_components/
```
Each tab should import from `_shared/companies.ts`, `_shared/contacts.ts`, or domain files. If any reads a legacy table directly, rewire that tab with minimal change (swap `.from('...')` table name). If a tab requires >50 lines of rewriting to fully migrate, STOP and flag to the user as a scope expansion.

- [ ] **Step 9: Test green + build green**

```bash
npm run test -- src/__tests__/silver-sp5/empresas-pages.test.ts 2>&1 | tail -30
npm run build 2>&1 | tail -30
```

- [ ] **Step 10: Manual smoke**

```bash
npm run dev
# /empresas → list loads, top N by LTV
# click CONTITECH → detail loads with 10 tabs, Panorama shows LTV>0
# Ctrl+C
```

- [ ] **Step 11: Commit**

```bash
git add src/app/empresas/ src/components/patterns/company-link.tsx src/__tests__/silver-sp5/empresas-pages.test.ts
git commit -m "$(cat <<'EOF'
feat(sp5): task 13 — rewire /empresas pages to canonical/gold

Page + detail page read _shared/companies.ts (canonical_companies)
and gold_company_360. PanoramaTab consumes gold_company_360 row.
CompanyLink pattern resolves odoo_partner_id → canonical_companies.id
for back-compat links.

Co-Authored-By: claude-flow <ruv@ruv.net>
EOF
)"
```

- [ ] **Step 12: Notes**

```markdown
## Task 13 — /empresas (completed YYYY-MM-DD)

- List/detail pages rewired.
- PanoramaTab consumes gold_company_360.
- Other tabs verified via build: [clean / list of one-liner fixes].
- Manual smoke: CONTITECH detail renders LTV ≈ 620M.
- Tests: 5 passing.
```

---

### Task 14: Rewire `/ventas`, `/compras`, `/cobranza`

**Files:**
- Modify: `src/app/ventas/page.tsx`
- Modify: `src/app/compras/page.tsx` + `_components/*.tsx`
- Modify: `src/app/cobranza/page.tsx`
- Test: `src/__tests__/silver-sp5/ops-pages.test.ts`

- [ ] **Step 1: Inventory**

```bash
rg -n "\.from\(|\.rpc\(" src/app/ventas/ src/app/compras/ src/app/cobranza/
```

- [ ] **Step 2: Failing grep tests**

`src/__tests__/silver-sp5/ops-pages.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

function readAllTsx(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...readAllTsx(p));
    else if (e.name.endsWith(".tsx") || e.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

describe("/ventas /compras /cobranza — no legacy reads", () => {
  const dirs = ["src/app/ventas", "src/app/compras", "src/app/cobranza"];
  const banned = [
    "from('odoo_sale_orders", "from('odoo_purchase_orders", "from('odoo_invoices",
    "from('invoices_unified", "from('orders_unified", "from('order_fulfillment_bridge",
  ];
  for (const d of dirs) {
    for (const f of readAllTsx(d)) {
      it(`${f} clean`, () => {
        const src = readFileSync(f, "utf8");
        for (const t of banned) expect(src).not.toContain(t);
      });
    }
  }
});
```

- [ ] **Step 3: Rewrite `ventas/page.tsx`**

```tsx
// src/app/ventas/page.tsx
import { listSaleOrders, salesBySalesperson, fetchSalespersonMetadata } from "@/lib/queries/operational/sales";
import { fetchTopCustomers } from "@/lib/queries/analytics/customer-360";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { VentasDashboardClient } from "./_components/VentasDashboardClient";

export default async function VentasPage() {
  const sb = await createSupabaseServerClient();
  const ytdFrom = new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10);
  const [recentOrders, topCustomers, bySalesperson, revenueYtd] = await Promise.all([
    listSaleOrders({ limit: 20, fromDate: ytdFrom }),
    fetchTopCustomers({ limit: 10 }),
    salesBySalesperson({ fromDate: ytdFrom }),
    sb.from("gold_revenue_monthly").select("period_month, total_mxn, invoices, companies").is("canonical_company_id", null).gte("period_month", ytdFrom).order("period_month"),
  ]);
  const contactIds = bySalesperson.map((r) => r.salesperson_contact_id);
  const salespersonMeta = await fetchSalespersonMetadata(contactIds);
  return (
    <VentasDashboardClient
      recentOrders={recentOrders}
      topCustomers={topCustomers}
      bySalesperson={bySalesperson}
      salespersonMeta={salespersonMeta}
      revenueYtd={revenueYtd.data ?? []}
    />
  );
}
```

- [ ] **Step 4: Rewrite `compras/page.tsx` + sub-components**

```tsx
// src/app/compras/page.tsx
import { listPurchaseOrders, listVendorPayments } from "@/lib/queries/operational/purchases";
import { listInvoices } from "@/lib/queries/unified/invoices";
import { fetchTopSuppliers } from "@/lib/queries/analytics/customer-360";
import { ComprasDashboardClient } from "./_components/ComprasDashboardClient";

export default async function ComprasPage() {
  const ytdFrom = new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10);
  const [orders, invoicesIn, payments, topSuppliers] = await Promise.all([
    listPurchaseOrders({ limit: 20, fromDate: ytdFrom }),
    listInvoices({ direction: "received", limit: 20, fromDate: ytdFrom }),
    listVendorPayments({ limit: 20 }),
    fetchTopSuppliers({ limit: 10 }),
  ]);
  return (
    <ComprasDashboardClient
      orders={orders}
      invoicesIn={invoicesIn}
      payments={payments}
      topSuppliers={topSuppliers}
    />
  );
}
```

Walk `src/app/compras/_components/` and swap any `.from('odoo_...')` / `.from('invoices_unified')` in client components for props passed from the page. If client components do their own fetches, move those fetches server-side.

- [ ] **Step 5: Rewrite `cobranza/page.tsx`**

```tsx
// src/app/cobranza/page.tsx
import { listInvoices, invoicesReceivableAging } from "@/lib/queries/unified/invoices";
import { CobranzaClient } from "./_components/CobranzaClient";

export default async function CobranzaPage() {
  const [openReceivables, aging] = await Promise.all([
    listInvoices({
      direction: "issued",
      onlyOpen: true,
      limit: 200,
    }),
    invoicesReceivableAging(),
  ]);
  return <CobranzaClient openReceivables={openReceivables} aging={aging} />;
}
```

- [ ] **Step 6: Test + build**

```bash
npm run test -- src/__tests__/silver-sp5/ops-pages.test.ts 2>&1 | tail -30
npm run build 2>&1 | tail -30
```

- [ ] **Step 7: Manual smoke**

```bash
npm run dev
# /ventas → recent orders + top customers render
# /compras → recent POs + vendor payments render
# /cobranza → open receivables with aging buckets render
# Ctrl+C
```

- [ ] **Step 8: Commit**

```bash
git add src/app/ventas/ src/app/compras/ src/app/cobranza/ src/__tests__/silver-sp5/ops-pages.test.ts
git commit -m "$(cat <<'EOF'
feat(sp5): task 14 — rewire /ventas, /compras, /cobranza

ventas: canonical_sale_orders + gold_revenue_monthly + top customers.
compras: canonical_purchase_orders + canonical_payments + top suppliers
  + canonical_invoices direction=received.
cobranza: canonical_invoices direction=issued AND
  amount_residual_mxn_resolved>0 + aging buckets.

Co-Authored-By: claude-flow <ruv@ruv.net>
EOF
)"
```

- [ ] **Step 9: Notes**

```markdown
## Task 14 — /ventas /compras /cobranza (completed YYYY-MM-DD)

- All three pages rewired to canonical/gold.
- Sub-components rewired: [list].
- Manual smoke: <paste YTD revenue MXN from /ventas>.
- Tests: N passing.
```

---

### Task 15: Rewire `/finanzas` + cashflow-recommendations

**Files:**
- Modify: `src/app/finanzas/page.tsx`
- Modify: `src/app/finanzas/_components/cashflow-recommendations.tsx`
- Modify: `src/app/finanzas/_components/*.tsx`
- Test: `src/__tests__/silver-sp5/finanzas-page.test.ts`

- [ ] **Step 1: Inventory**

```bash
rg -n "\.from\(|\.rpc\(" src/app/finanzas/
```

- [ ] **Step 2: Failing test**

`src/__tests__/silver-sp5/finanzas-page.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name.endsWith(".tsx") || e.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

describe("/finanzas — no legacy reads", () => {
  const banned = [
    "from('pl_estado_resultados", "from('balance_sheet", "from('cash_position",
    "from('working_capital", "from('invoices_unified",
  ];
  for (const f of walk("src/app/finanzas")) {
    it(`${f} clean`, () => {
      const src = readFileSync(f, "utf8");
      for (const t of banned) expect(src).not.toContain(t);
    });
  }
});
```

- [ ] **Step 3: Rewrite `finanzas/page.tsx`**

```tsx
// src/app/finanzas/page.tsx
import { fetchPL } from "@/lib/queries/analytics/pnl";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fetchCashPosition, fetchWorkingCapital, fetchOpenInvoicesAgg } from "@/lib/queries/analytics/finance";
import { FinanzasDashboardClient } from "./_components/FinanzasDashboardClient";

export default async function FinanzasPage() {
  const sb = await createSupabaseServerClient();
  const [pl, balance, cashflow, cash, wc, openAgg] = await Promise.all([
    fetchPL({ limit: 13 }),
    sb.from("gold_balance_sheet").select("*").order("period_month", { ascending: false }).limit(1).maybeSingle(),
    sb.from("gold_cashflow").select("*").maybeSingle(),
    fetchCashPosition(),
    fetchWorkingCapital(),
    fetchOpenInvoicesAgg(),
  ]);
  return (
    <FinanzasDashboardClient
      pl={pl}
      balance={balance.data}
      cashflow={cashflow.data}
      cash={cash}
      workingCapital={wc}
      openInvoices={openAgg}
    />
  );
}
```

- [ ] **Step 4: Rewrite `cashflow-recommendations.tsx`**

```tsx
// src/app/finanzas/_components/cashflow-recommendations.tsx
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function CashflowRecommendations() {
  const sb = await createSupabaseServerClient();
  // Prefer existing RPC if it already reads canonical (Task 5 verified)
  const { data } = await sb.rpc("get_cashflow_recommendations");
  if (!data || (Array.isArray(data) && data.length === 0)) return null;
  return (
    <section className="rounded border p-4">
      <h3 className="text-sm font-semibold mb-2">Recomendaciones</h3>
      <ul className="space-y-2 text-sm">
        {(data as any[]).map((r, i) => (
          <li key={i}>{r.message ?? r.title ?? JSON.stringify(r)}</li>
        ))}
      </ul>
    </section>
  );
}
```

If Task 5 found the RPC reads dropped MVs, hand-roll recommendations from `gold_cashflow`:

```tsx
// Alternative if RPC is unsafe:
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function CashflowRecommendations() {
  const sb = await createSupabaseServerClient();
  const { data: cf } = await sb.from("gold_cashflow").select("*").maybeSingle();
  const recs: { severity: string; message: string }[] = [];
  if (cf) {
    if (Number(cf.cash_runway_days ?? 999) < 30) {
      recs.push({ severity: "high", message: `Runway bajo: ${cf.cash_runway_days} días` });
    }
    if (Number(cf.ar_mxn ?? 0) > 2 * Number(cf.ap_mxn ?? 0)) {
      recs.push({ severity: "medium", message: "AR concentrado sobre AP — acelerar cobranza" });
    }
  }
  if (recs.length === 0) return null;
  return (
    <section className="rounded border p-4">
      <h3 className="text-sm font-semibold mb-2">Recomendaciones</h3>
      <ul className="space-y-2 text-sm">
        {recs.map((r, i) => <li key={i}>[{r.severity}] {r.message}</li>)}
      </ul>
    </section>
  );
}
```

- [ ] **Step 5: Test + build**

```bash
npm run test -- src/__tests__/silver-sp5/finanzas-page.test.ts 2>&1 | tail -30
npm run build 2>&1 | tail -30
```

- [ ] **Step 6: Manual smoke**

```bash
npm run dev
# /finanzas → KPIs (cash MXN, working capital, AR total, overdue)
# P&L trend chart renders with 13 months
# Ctrl+C
```

- [ ] **Step 7: Commit**

```bash
git add src/app/finanzas/ src/__tests__/silver-sp5/finanzas-page.test.ts
git commit -m "$(cat <<'EOF'
feat(sp5): task 15 — rewire /finanzas to gold_*

Reads gold_pl_statement + gold_balance_sheet + gold_cashflow.
cashflow-recommendations: RPC retained (or hand-rolled from gold_cashflow
per Task 5 audit).

Co-Authored-By: claude-flow <ruv@ruv.net>
EOF
)"
```

- [ ] **Step 8: Notes**

```markdown
## Task 15 — /finanzas (completed YYYY-MM-DD)

- Rewired to gold_pl_statement / gold_balance_sheet / gold_cashflow.
- cashflow-recommendations: [kept RPC / replaced with gold derivation].
- Manual smoke: <paste current_cash_mxn, working_capital_mxn>.
- Known gap: gold_balance_sheet.unbalanced_amount != 0 until addon §14.2 (Task 21) deploys.
- Tests: N passing.
```

---

### Task 16: Rewire `/productos`, `/operaciones`, `/contactos`

**Files:**
- Modify: `src/app/productos/page.tsx` + sub-components
- Modify: `src/app/operaciones/page.tsx`
- Modify: `src/app/contactos/page.tsx` + `/[slug]/page.tsx` (if exists)
- Test: `src/__tests__/silver-sp5/domain-pages.test.ts`

- [ ] **Step 1: Inventory**

```bash
rg -n "\.from\(|\.rpc\(" src/app/productos/ src/app/operaciones/ src/app/contactos/
```

- [ ] **Step 2: Failing test**

`src/__tests__/silver-sp5/domain-pages.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name.endsWith(".tsx") || e.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

describe("/productos /operaciones /contactos — no legacy reads", () => {
  const banned = [
    "from('odoo_products", "from('odoo_deliveries", "from('odoo_manufacturing",
    "from('odoo_orderpoints", "from('odoo_users", "from('odoo_employees",
    "from('person_unified", "from('products_unified", "from('product_margin_analysis",
  ];
  for (const d of ["src/app/productos", "src/app/operaciones", "src/app/contactos"]) {
    for (const f of walk(d)) {
      it(`${f} clean`, () => {
        const src = readFileSync(f, "utf8");
        for (const t of banned) expect(src).not.toContain(t);
      });
    }
  }
});
```

- [ ] **Step 3: Rewrite each page**

`productos/page.tsx`:
```tsx
import { listProducts, fetchTopSkusByRevenue } from "@/lib/queries/analytics/products";
import { listInventory } from "@/lib/queries/operational/operations";
import { ProductosClient } from "./_components/ProductosClient";

export default async function ProductosPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const search = typeof sp.q === "string" ? sp.q : undefined;
  const [products, topSku, stockouts] = await Promise.all([
    listProducts({ search, limit: 100, onlyActive: true }),
    fetchTopSkusByRevenue({ limit: 20 }),
    listInventory({ onlyStockouts: true, limit: 50 }),
  ]);
  return <ProductosClient products={products} topSku={topSku} stockouts={stockouts} />;
}
```

`operaciones/page.tsx`:
```tsx
import { listDeliveries, listManufacturingOrders, listInventory, fetchInventoryVelocity } from "@/lib/queries/operational/operations";
import { OperacionesClient } from "./_components/OperacionesClient";

export default async function OperacionesPage() {
  const [lateDeliveries, activeMOs, stockouts, velocity] = await Promise.all([
    listDeliveries({ onlyLate: true, limit: 50 }),
    listManufacturingOrders({ state: "confirmed", limit: 50 }),
    listInventory({ onlyStockouts: true, limit: 50 }),
    fetchInventoryVelocity(),
  ]);
  return <OperacionesClient lateDeliveries={lateDeliveries} activeMOs={activeMOs} stockouts={stockouts} velocity={velocity} />;
}
```

`contactos/page.tsx`:
```tsx
import { listContacts } from "@/lib/queries/_shared/contacts";
import { ContactosClient } from "./_components/ContactosClient";

export default async function ContactosPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const search = typeof sp.q === "string" ? sp.q : undefined;
  const contacts = await listContacts({ search, limit: 100 });
  return <ContactosClient contacts={contacts} />;
}
```

If `contactos/[slug]/page.tsx` exists:
```tsx
import { fetchContactById } from "@/lib/queries/_shared/contacts";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function ContactDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const id = Number(slug);
  if (!Number.isFinite(id)) return notFound();
  const contact = await fetchContactById(id);
  if (!contact) return notFound();
  const sb = await createSupabaseServerClient();
  const [{ data: signals }, { data: facts }] = await Promise.all([
    sb.from("email_signals").select("*").eq("canonical_entity_type", "contact").eq("canonical_entity_id", String(id)).limit(50),
    sb.from("ai_extracted_facts").select("*").eq("canonical_entity_type", "contact").eq("canonical_entity_id", String(id)).limit(50),
  ]);
  return (
    <section>
      <h1>{contact.display_name}</h1>
      {/* tabs go here — pass signals/facts as props */}
    </section>
  );
}
```

- [ ] **Step 4: Test + build**

```bash
npm run test -- src/__tests__/silver-sp5/domain-pages.test.ts 2>&1 | tail -30
npm run build 2>&1 | tail -30
```

- [ ] **Step 5: Manual smoke**

```bash
npm run dev
# /productos → list + top SKUs + stockouts
# /operaciones → late deliveries + active MOs + stockouts
# /contactos → search + list + detail
# Ctrl+C
```

- [ ] **Step 6: Commit**

```bash
git add src/app/productos/ src/app/operaciones/ src/app/contactos/ src/__tests__/silver-sp5/domain-pages.test.ts
git commit -m "$(cat <<'EOF'
feat(sp5): task 16 — rewire /productos /operaciones /contactos

productos: canonical_products + gold_product_performance + stockouts.
operaciones: canonical_deliveries + canonical_manufacturing +
  canonical_inventory + inventory_velocity (§12 KEEP).
contactos: canonical_contacts + evidence layer.

Co-Authored-By: claude-flow <ruv@ruv.net>
EOF
)"
```

- [ ] **Step 7: Notes**

```markdown
## Task 16 — /productos /operaciones /contactos (completed YYYY-MM-DD)

- All 3 pages rewired.
- Manual smoke: <stockout count, late delivery count, contact count>.
- Tests: N passing.
```

---

### Task 17: Rewire `/equipo`, `/directores`, `/sistema`, root, SyntageReconciliationPanel

**Files:**
- Modify: `src/app/equipo/page.tsx`
- Modify: `src/app/directores/<id>/page.tsx` (minimal — director agent rewire is Task 18)
- Modify: `src/app/sistema/page.tsx` — annotate Bronze reads with SP5-EXCEPTION
- Modify: `src/app/page.tsx` (root)
- Modify: `src/components/domain/system/SyntageReconciliationPanel.tsx`
- Modify: `src/lib/queries/_shared/system.ts` — annotate SP5-EXCEPTION
- Test: `src/__tests__/silver-sp5/misc-pages.test.ts`

- [ ] **Step 1: Inventory**

```bash
rg -n "\.from\(|\.rpc\(" src/app/equipo/ src/app/directores/ src/app/sistema/ src/app/page.tsx src/components/domain/system/SyntageReconciliationPanel.tsx src/lib/queries/_shared/system.ts
```

- [ ] **Step 2: Failing test**

`src/__tests__/silver-sp5/misc-pages.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

describe("/equipo + root — clean of legacy non-system reads", () => {
  const cleanFiles = ["src/app/equipo/page.tsx", "src/app/page.tsx"];
  const bannedAll = [
    "from('odoo_users", "from('odoo_employees", "from('odoo_departments",
    "from('company_profile", "from('invoices_unified",
  ];
  for (const f of cleanFiles) {
    it(`${f} has no banned reads`, () => {
      const src = readFileSync(f, "utf8");
      for (const t of bannedAll) expect(src).not.toContain(t);
    });
  }

  it("/sistema page annotates Bronze reads with SP5-EXCEPTION", () => {
    const src = readFileSync("src/app/sistema/page.tsx", "utf8");
    const bronzeHits = (src.match(/\.from\(['"](odoo_|syntage_|agent_tickets|notification_queue|health_scores|pipeline_logs|schema_changes|audit_runs)/g) ?? []).length;
    const exceptionMarkers = (src.match(/SP5-EXCEPTION/g) ?? []).length;
    expect(exceptionMarkers).toBeGreaterThanOrEqual(bronzeHits);
  });

  it("system.ts helper annotates Bronze reads", () => {
    const src = readFileSync("src/lib/queries/_shared/system.ts", "utf8");
    const bronzeHits = (src.match(/\.from\(['"](odoo_|syntage_|pipeline_logs|schema_changes|audit_runs|reconciliation_issues)/g) ?? []).length;
    const exceptionMarkers = (src.match(/SP5-EXCEPTION/g) ?? []).length;
    if (bronzeHits > 0) expect(exceptionMarkers).toBeGreaterThanOrEqual(bronzeHits);
  });
});
```

- [ ] **Step 3: Rewrite `equipo/page.tsx`**

```tsx
// src/app/equipo/page.tsx
import { listTeamMembers, listDepartments } from "@/lib/queries/operational/team";
import { EquipoClient } from "./_components/EquipoClient";

export default async function EquipoPage() {
  const [members, departments] = await Promise.all([
    listTeamMembers({ limit: 200 }),
    listDepartments(),
  ]);
  return <EquipoClient members={members} departments={departments} />;
}
```

- [ ] **Step 4: Directores pages — verify only**

Confirm `src/app/directores/*/page.tsx` delegates to agent context modules (rewired in Task 18). Only fix direct legacy reads if present.

- [ ] **Step 5: Sistema page — annotate Bronze reads**

Open `src/app/sistema/page.tsx` and append `// SP5-EXCEPTION: /sistema diagnostic` on every line that calls `.from('odoo_…')`, `.from('syntage_…')`, `.from('pipeline_logs')`, `.from('schema_changes')`, `.from('audit_runs')`, `.from('agent_tickets')`, `.from('notification_queue')`, `.from('health_scores')`.

Example:
```tsx
const { data: lastSync } = await sb.from("pipeline_logs")  // SP5-EXCEPTION: /sistema diagnostic
  .select("*").order("created_at", { ascending: false }).limit(10);
```

- [ ] **Step 6: Root `page.tsx`**

```tsx
// src/app/page.tsx
import { listInbox } from "@/lib/queries/intelligence/inbox";
import { fetchDashboardKpis } from "@/lib/queries/analytics/dashboard";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { LandingClient } from "./_components/LandingClient";

export default async function LandingPage() {
  const sb = await createSupabaseServerClient();
  const [inbox, kpis, recentRuns, recentInsights] = await Promise.all([
    listInbox({ limit: 10 }),
    fetchDashboardKpis(),
    // SP5-VERIFIED: agent_runs retained (not in §12 drop list)
    sb.from("agent_runs").select("*").order("started_at", { ascending: false }).limit(10),
    // SP5-VERIFIED: agent_insights retained (not in §12 drop list)
    sb.from("agent_insights").select("*").is("resolved_at", null).order("created_at", { ascending: false }).limit(10),
  ]);
  return <LandingClient inbox={inbox} kpis={kpis} recentRuns={recentRuns.data ?? []} recentInsights={recentInsights.data ?? []} />;
}
```

- [ ] **Step 7: `SyntageReconciliationPanel.tsx`**

```tsx
// src/components/domain/system/SyntageReconciliationPanel.tsx
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function SyntageReconciliationPanel() {
  const sb = await createSupabaseServerClient();
  // SP5-EXCEPTION: /sistema Syntage diagnostic
  const { data: events } = await sb.from("syntage_webhook_events").select("*").order("received_at", { ascending: false }).limit(50);
  // SP5-EXCEPTION: /sistema Syntage diagnostic
  const { data: extractions } = await sb.from("syntage_extractions").select("*").order("started_at", { ascending: false }).limit(20);
  return (
    <section className="rounded border p-4">
      <h3 className="text-sm font-semibold mb-2">Syntage — Events / Extractions</h3>
      {/* existing UI preserved */}
    </section>
  );
}
```

- [ ] **Step 8: `_shared/system.ts` — annotate SP5-EXCEPTION**

Walk every `.from()` call in this file; append `// SP5-EXCEPTION: /sistema diagnostic` on same line.

- [ ] **Step 9: Test + build**

```bash
npm run test -- src/__tests__/silver-sp5/misc-pages.test.ts 2>&1 | tail -30
npm run build 2>&1 | tail -30
```

- [ ] **Step 10: Manual smoke**

```bash
npm run dev
# / → landing with inbox preview + dashboard KPIs
# /equipo → team + departments
# /sistema → diagnostics with Bronze reads (expected)
# Ctrl+C
```

- [ ] **Step 11: Commit**

```bash
git add src/app/equipo/ src/app/directores/ src/app/sistema/ src/app/page.tsx src/components/domain/system/SyntageReconciliationPanel.tsx src/lib/queries/_shared/system.ts src/__tests__/silver-sp5/misc-pages.test.ts
git commit -m "$(cat <<'EOF'
feat(sp5): task 17 — rewire /equipo /directores /sistema + root + SP5-EXCEPTIONs

equipo/root: canonical reads only.
sistema: Bronze reads annotated SP5-EXCEPTION.
_shared/system.ts: SP5-EXCEPTION annotations.
SyntageReconciliationPanel: diagnostic-scope SP5-EXCEPTION.
agent_runs / agent_insights retained (SP5-VERIFIED).

Co-Authored-By: claude-flow <ruv@ruv.net>
EOF
)"
```

- [ ] **Step 12: Notes**

```markdown
## Task 17 — /equipo /directores /sistema + root + SyntageReconciliationPanel (completed YYYY-MM-DD)

- /equipo + root + SyntageReconciliationPanel: canonical reads (+ SP5-VERIFIED on agent_runs / agent_insights).
- /sistema: N Bronze reads annotated SP5-EXCEPTION.
- _shared/system.ts: M SP5-EXCEPTION annotations.
- Tests: N passing.
```

---

### Task 18: Rewire `lib/agents/director-chat-context.ts` + `lib/agents/financiero-context.ts`

**Files:**
- Modify: `src/lib/agents/director-chat-context.ts` (15 legacy refs)
- Modify: `src/lib/agents/financiero-context.ts` (5 legacy refs)
- Test: `src/__tests__/silver-sp5/agent-contexts.test.ts`

**Context:** agent context modules build the system-prompt context that Claude receives for director chat and the finance director. They query multiple legacy views today to assemble KPIs. Replace with canonical/gold reads. The chat experience and answer shape must not change.

- [ ] **Step 1: Inventory**

```bash
rg -n "\.from\(|\.rpc\(" src/lib/agents/director-chat-context.ts src/lib/agents/financiero-context.ts
```

- [ ] **Step 2: Failing tests**

`src/__tests__/silver-sp5/agent-contexts.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

describe("agent context modules — canonical reads", () => {
  it("director-chat-context.ts has no legacy reads", () => {
    const src = readFileSync("src/lib/agents/director-chat-context.ts", "utf8");
    const banned = [
      "from('invoices_unified", "from('payments_unified", "from('company_profile",
      "from('company_profile_sat", "from('analytics_customer_360",
      "from('monthly_revenue_by_company", "from('monthly_revenue_trend",
      "from('customer_ltv_health", "from('product_margin_analysis",
      "from('supplier_price_index", "from('customer_product_matrix",
      "from('supplier_product_matrix", "from('working_capital",
      "from('cash_position", "from('pl_estado_resultados", "from('balance_sheet",
      "from('partner_payment_profile", "from('company_narrative",
      "from('cross_director_signals",
    ];
    for (const t of banned) expect(src).not.toContain(t);
  });

  it("financiero-context.ts has no legacy reads", () => {
    const src = readFileSync("src/lib/agents/financiero-context.ts", "utf8");
    const banned = [
      "from('invoices_unified", "from('working_capital", "from('cash_position",
      "from('pl_estado_resultados", "from('balance_sheet",
      "from('partner_payment_profile", "from('account_payment_profile",
    ];
    for (const t of banned) expect(src).not.toContain(t);
  });

  it("director-chat-context exposes buildDirectorChatContext fn reading canonical", async () => {
    const mod = await import("@/lib/agents/director-chat-context");
    const fn = mod.buildDirectorChatContext ?? mod.buildContext;
    expect(fn).toBeTruthy();
  });
});
```

- [ ] **Step 3: Red**

```bash
npm run test -- src/__tests__/silver-sp5/agent-contexts.test.ts 2>&1 | tail -20
```

- [ ] **Step 4: Rewrite `director-chat-context.ts`**

The director-chat-context module builds a context object passed to Claude when the CEO/director chats. Each legacy MV read becomes a canonical/gold read. Pseudo-structure to follow (adapt to existing export names):

```typescript
// src/lib/agents/director-chat-context.ts
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listInbox } from "@/lib/queries/intelligence/inbox";
import { fetchTopCustomers, fetchTopSuppliers } from "@/lib/queries/analytics/customer-360";
import { fetchOpenInvoicesAgg } from "@/lib/queries/analytics/finance";
import type { DirectorConfig } from "./director-config";

export interface DirectorChatContext {
  director: DirectorConfig;
  inbox_preview: unknown[];
  top_customers: unknown[];
  top_suppliers: unknown[];
  open_ar_agg: unknown;
  reconciliation_health: unknown;
  cashflow: unknown;
  pl_recent: unknown[];
  revenue_monthly: unknown[];
}

export async function buildDirectorChatContext(director: DirectorConfig): Promise<DirectorChatContext> {
  const sb = await createSupabaseServerClient();
  const ytdFrom = new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10);

  const [inbox, topC, topS, openAR, recHealth, cash, pl, revMonthly] = await Promise.all([
    listInbox({ limit: 10 }),
    fetchTopCustomers({ limit: 5 }),
    fetchTopSuppliers({ limit: 5 }),
    fetchOpenInvoicesAgg(),
    sb.from("gold_reconciliation_health").select("*").maybeSingle(),
    sb.from("gold_cashflow").select("*").maybeSingle(),
    sb.from("gold_pl_statement").select("*").order("period_month", { ascending: false }).limit(3),
    sb.from("gold_revenue_monthly").select("period_month, total_mxn").is("canonical_company_id", null).gte("period_month", ytdFrom).order("period_month"),
  ]);

  return {
    director,
    inbox_preview: inbox,
    top_customers: topC,
    top_suppliers: topS,
    open_ar_agg: openAR,
    reconciliation_health: recHealth.data,
    cashflow: cash.data,
    pl_recent: pl.data ?? [],
    revenue_monthly: revMonthly.data ?? [],
  };
}

export function contextToPromptDigest(ctx: DirectorChatContext): string {
  const lines: string[] = [];
  lines.push(`Director: ${ctx.director.name} (${ctx.director.department})`);
  if (ctx.open_ar_agg) {
    const { totalOpenAmountMxn, totalOpenCount, overdue90Count, overdue90PlusAmountMxn } = ctx.open_ar_agg as any;
    lines.push(`AR abierta: MXN ${totalOpenAmountMxn} en ${totalOpenCount} facturas; 90d+: ${overdue90Count} (MXN ${overdue90PlusAmountMxn}).`);
  }
  if (ctx.cashflow) {
    const { current_cash_mxn, working_capital_mxn, cash_runway_days } = ctx.cashflow as any;
    lines.push(`Efectivo: MXN ${current_cash_mxn}. Capital trabajo: MXN ${working_capital_mxn}. Runway: ${cash_runway_days} días.`);
  }
  if (Array.isArray(ctx.top_customers) && ctx.top_customers.length > 0) {
    const names = (ctx.top_customers as any[]).slice(0, 3).map((c) => c.display_name).join(", ");
    lines.push(`Top clientes: ${names}.`);
  }
  if (Array.isArray(ctx.inbox_preview) && ctx.inbox_preview.length > 0) {
    lines.push(`Issues críticos abiertos (top 5 inbox):`);
    for (const it of (ctx.inbox_preview as any[]).slice(0, 5)) {
      lines.push(`- [${it.severity}] ${it.invariant_key}: MXN ${it.impact_mxn} (score ${it.priority_score})`);
    }
  }
  return lines.join("\n");
}
```

Preserve any existing exports (e.g. `buildContext` alias). If the previous module had director-specific branching (finance director gets different data than sales director), preserve that branching but swap each branch's reads.

- [ ] **Step 5: Rewrite `financiero-context.ts`**

```typescript
// src/lib/agents/financiero-context.ts
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fetchOpenInvoicesAgg, fetchCashPosition, fetchWorkingCapital } from "@/lib/queries/analytics/finance";
import { fetchPL } from "@/lib/queries/analytics/pnl";

export async function buildFinancieroContext() {
  const sb = await createSupabaseServerClient();
  const [pl, openAR, cash, wc, cashflow, balance] = await Promise.all([
    fetchPL({ limit: 6 }),
    fetchOpenInvoicesAgg(),
    fetchCashPosition(),
    fetchWorkingCapital(),
    sb.from("gold_cashflow").select("*").maybeSingle(),
    sb.from("gold_balance_sheet").select("*").order("period_month", { ascending: false }).limit(1).maybeSingle(),
  ]);
  return {
    pl_recent: pl,
    open_ar: openAR,
    cash,
    working_capital: wc,
    cashflow: cashflow.data,
    balance_sheet: balance.data,
  };
}
```

- [ ] **Step 6: Test green + build**

```bash
npm run test -- src/__tests__/silver-sp5/agent-contexts.test.ts 2>&1 | tail -20
npm run build 2>&1 | tail -30
```

- [ ] **Step 7: Smoke test director chat (manual)**

```bash
npm run dev
# open http://localhost:3000/directores/finanzas (or whatever director slug exists)
# ask "resumen cartera"
# verify Claude responds with cited MXN numbers that match a manual SELECT on canonical_invoices
```

If Claude's answer references made-up numbers, the context digest is wrong — fix `contextToPromptDigest` so the prompt contains the real aggregated values.

- [ ] **Step 8: Commit**

```bash
git add src/lib/agents/director-chat-context.ts src/lib/agents/financiero-context.ts src/__tests__/silver-sp5/agent-contexts.test.ts
git commit -m "$(cat <<'EOF'
feat(sp5): task 18 — rewire agent contexts to canonical/gold

director-chat-context: 15 legacy MV refs → gold_* + canonical_*
  + existing intelligence/inbox helper.
financiero-context: 5 legacy refs → gold_pl_statement +
  gold_cashflow + gold_balance_sheet + canonical_invoices agg.

Co-Authored-By: claude-flow <ruv@ruv.net>
EOF
)"
```

- [ ] **Step 9: Notes**

```markdown
## Task 18 — agent contexts (completed YYYY-MM-DD)

- director-chat-context: legacy reads eliminated; prompt digest updated.
- financiero-context: same.
- Manual smoke on /directores/<id> chat: Claude cited MXN figures matching canonical query.
- Tests: 3 passing.
```

---

### Task 19: Rewire `src/app/api/agents/*` route handlers

**Files:**
- Modify: `src/app/api/agents/orchestrate/route.ts`
- Modify: `src/app/api/agents/auto-fix/route.ts`
- Modify: `src/app/api/agents/cleanup/route.ts`
- Modify: `src/app/api/agents/validate/route.ts`
- Modify: `src/app/api/agents/identity-resolution/route.ts` (verify, likely already canonical)
- Modify: `src/app/api/agents/learn/route.ts` (verify)
- Modify: `src/app/api/agents/run/route.ts` (verify)
- Modify: `src/app/api/agents/wake/route.ts` (verify)
- Modify: `src/app/api/pipeline/reconcile/route.ts` (retarget legacy auto-close)
- Test: `src/__tests__/silver-sp5/agent-routes.test.ts`

**Context:** `orchestrate` is the biggest route — it dispatches one of 7 business agents per invocation. Each agent's prompt/query template currently references Bronze/legacy tables. Rewire so:
- Sales agent reads `canonical_sale_orders` + `canonical_order_lines` + `canonical_crm_leads` + `gold_company_360 WHERE is_customer`.
- Finance reads `canonical_invoices` + `canonical_payments` + `gold_cashflow` + `gold_pl_statement` + `canonical_bank_balances`.
- Operations reads `canonical_deliveries` + `canonical_inventory` + `canonical_manufacturing` + `canonical_order_lines`.
- Relationships reads `canonical_contacts` + `email_signals` + `ai_extracted_facts` + threads.
- Risk reads `canonical_invoices WHERE days_overdue>30` + `canonical_companies WHERE blacklist_level!='none'` + `gold_reconciliation_health`.
- Growth reads `gold_revenue_monthly` + `gold_company_360` + `canonical_products` + seasonality.
- Meta reads `agent_runs` + `agent_memory` + `reconciliation_issues` (verified retained).
- Data Quality reads `reconciliation_issues` + `canonical_*.needs_review`.
- Odoo (diagnostic agent) reads `odoo_*` directly with `SP5-EXCEPTION` marker.

- [ ] **Step 1: Inventory orchestrate handler**

```bash
rg -n "\.from\(|\.rpc\(" src/app/api/agents/orchestrate/route.ts | head -60
rg -n "agentSlug|agentName|agentType|dispatch" src/app/api/agents/orchestrate/route.ts | head -40
```
Paste the agent → legacy reads mapping into Task 19 notes.

- [ ] **Step 2: Failing test**

`src/__tests__/silver-sp5/agent-routes.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

function allRouteFiles(): string[] {
  const out: string[] = [];
  function walk(d: string) {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = `${d}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (e.name === "route.ts" || e.name === "route.tsx") out.push(p);
    }
  }
  walk("src/app/api/agents");
  return out;
}

describe("api/agents routes — canonical reads (except Odoo diagnostic)", () => {
  const bannedMvs = [
    "from('invoices_unified", "from('payments_unified", "from('company_profile",
    "from('analytics_customer_360", "from('product_margin_analysis",
    "from('supplier_price_index", "from('customer_product_matrix",
    "from('supplier_product_matrix", "from('pl_estado_resultados",
    "from('balance_sheet", "from('monthly_revenue_by_company",
  ];
  for (const f of allRouteFiles()) {
    it(`${f} has no banned legacy MV reads`, () => {
      const src = readFileSync(f, "utf8");
      for (const t of bannedMvs) expect(src).not.toContain(t);
    });
  }

  it("orchestrate route: odoo agent Bronze reads are annotated SP5-EXCEPTION", () => {
    const src = readFileSync("src/app/api/agents/orchestrate/route.ts", "utf8");
    // If orchestrate reads odoo_* directly, each line must be on-same-line with SP5-EXCEPTION
    const odooHits = (src.match(/\.from\(['"]odoo_/g) ?? []).length;
    const exceptionMarkers = (src.match(/SP5-EXCEPTION/g) ?? []).length;
    if (odooHits > 0) expect(exceptionMarkers).toBeGreaterThanOrEqual(odooHits);
  });
});
```

- [ ] **Step 3: Rewrite `orchestrate/route.ts` per-agent block**

Because agents are distinct handlers (typically a switch statement on slug), rewrite one block at a time. Template for the Sales agent:

```typescript
// in orchestrate/route.ts, sales agent block
const ytdFrom = new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10);
const [saleOrders, orderLinesPending, crmLeads, topCustomers] = await Promise.all([
  sb.from("canonical_sale_orders")
    .select("canonical_id, name, canonical_company_id, salesperson_contact_id, amount_total, state, date_order, commitment_date, is_commitment_overdue")
    .gte("date_order", ytdFrom).order("date_order", { ascending: false }).limit(100),
  sb.from("canonical_order_lines")
    .select("canonical_id, canonical_company_id, canonical_product_id, qty, subtotal, has_pending_invoicing, has_pending_delivery, order_date")
    .eq("order_type", "sale").eq("has_pending_invoicing", true).limit(50),
  sb.from("canonical_crm_leads").select("*").order("create_date", { ascending: false }).limit(50),
  sb.from("gold_company_360").select("canonical_company_id, display_name, lifetime_value_mxn, revenue_ytd_mxn")
    .eq("is_customer", true).order("lifetime_value_mxn", { ascending: false, nullsFirst: false }).limit(10),
]);
```

Repeat for each agent slug. For the Odoo diagnostic agent:

```typescript
// odoo agent — keeps Bronze reads intentionally
// SP5-EXCEPTION: Odoo diagnostic agent reads Bronze to surface sync gaps
const { data: bronzeInv } = await sb.from("odoo_invoices").select("id, synced_at").gte("synced_at", new Date(Date.now() - 3600_000).toISOString()).limit(20);
// SP5-EXCEPTION: Odoo diagnostic agent reads Bronze
const { data: bronzeSaleOrders } = await sb.from("odoo_sale_orders").select("id, synced_at").gte("synced_at", new Date(Date.now() - 3600_000).toISOString()).limit(20);
```

For the Risk agent:

```typescript
const [overdueInv, blacklisted, recHealth] = await Promise.all([
  sb.from("canonical_invoices")
    .select("canonical_id, receptor_canonical_company_id, days_overdue, amount_residual_mxn_resolved")
    .eq("direction", "issued").gt("days_overdue", 30).gt("amount_residual_mxn_resolved", 0)
    .order("amount_residual_mxn_resolved", { ascending: false, nullsFirst: false }).limit(50),
  sb.from("canonical_companies")
    .select("id, display_name, blacklist_level, taxpayer_rfc")
    .neq("blacklist_level", "none").limit(50),
  sb.from("gold_reconciliation_health").select("*").maybeSingle(),
]);
```

For the Finance agent:

```typescript
const [openInv, recentPayments, cashflow, pl, bankBalances] = await Promise.all([
  sb.from("canonical_invoices").select("canonical_id, direction, days_overdue, amount_residual_mxn_resolved, receptor_canonical_company_id, emisor_canonical_company_id").gt("amount_residual_mxn_resolved", 0).limit(100),
  sb.from("canonical_payments").select("*").order("payment_date", { ascending: false, nullsFirst: false }).limit(50),
  sb.from("gold_cashflow").select("*").maybeSingle(),
  sb.from("gold_pl_statement").select("*").order("period_month", { ascending: false }).limit(6),
  sb.from("canonical_bank_balances").select("*"),
]);
```

For Operations, Relationships, Growth, Meta, Data Quality — mirror the same pattern using the canonical/gold reads from spec §13.2.

- [ ] **Step 4: Rewrite `auto-fix/route.ts`**

Auto-fix previously linked orphan insights to companies by name. Now source linkage is MDM — `source_links` and `matcher_*` functions. Simplified pattern:

```typescript
// Auto-link insights to canonical_companies using source_links where possible
const { data: orphans } = await sb.from("agent_insights").select("id, company_id").is("canonical_company_id", null).limit(500);
for (const ins of orphans ?? []) {
  if (ins.company_id) {
    const { data: link } = await sb.from("source_links").select("canonical_entity_id").eq("source", "company").eq("source_id", String(ins.company_id)).eq("canonical_entity_type", "company").maybeSingle();
    if (link?.canonical_entity_id) {
      await sb.from("agent_insights").update({ canonical_company_id: Number(link.canonical_entity_id) }).eq("id", ins.id);
    }
  }
}
```

If `agent_insights.canonical_company_id` column doesn't exist yet, add a migration (nullable FK) and migration for populating it. Otherwise reuse whatever existing column tracks the canonical link (it may be named differently). Do NOT invent column additions silently — verify via `information_schema.columns`.

- [ ] **Step 5: Rewrite `cleanup/route.ts`**

Purpose: expire insights older than N days. Update to reference canonical `fiscal_fully_paid_at` / `odoo_payment_state` instead of `invoices_unified`:

```typescript
// Expire insights whose referenced invoice is now paid
const { data } = await sb.from("agent_insights").select("id, canonical_invoice_id").is("resolved_at", null).not("canonical_invoice_id", "is", null).limit(500);
for (const ins of data ?? []) {
  const { data: inv } = await sb.from("canonical_invoices").select("odoo_payment_state").eq("canonical_id", ins.canonical_invoice_id).maybeSingle();
  if (inv?.odoo_payment_state === "paid") {
    await sb.from("agent_insights").update({ resolved_at: new Date().toISOString(), resolution: "auto_expired_paid" }).eq("id", ins.id);
  }
}
```

- [ ] **Step 6: Rewrite `validate/route.ts`**

Same pattern; move every legacy lookup to canonical equivalent.

- [ ] **Step 7: Verify `identity-resolution/route.ts`, `learn/route.ts`, `run/route.ts`, `wake/route.ts`**

For each:
```bash
rg -n "\.from\(" src/app/api/agents/<name>/route.ts
```
If the reads are already `canonical_*` / `source_links` / `mdm_manual_overrides` / `agent_runs` / `agent_memory` / `agent_insights`, add a top-of-file comment: `// SP5-VERIFIED: already reads canonical/intelligence layer`.

- [ ] **Step 8: Rewrite `pipeline/reconcile/route.ts`**

Previously auto-closed agent_insights after checking legacy paid-state. Update to read `canonical_invoices.odoo_payment_state`:

```typescript
const { data: unresolved } = await sb.from("agent_insights").select("id, canonical_invoice_id").is("resolved_at", null).not("canonical_invoice_id", "is", null).limit(1000);
```
(Then same payment-check as Task 19 Step 5.)

- [ ] **Step 9: Test + build**

```bash
npm run test -- src/__tests__/silver-sp5/agent-routes.test.ts 2>&1 | tail -30
npm run build 2>&1 | tail -30
```

- [ ] **Step 10: Smoke test orchestrate**

```bash
curl -s -X POST "http://localhost:3000/api/agents/orchestrate" -H "content-type: application/json" -d '{"agentSlug":"finance"}' | head -40
```
Verify the response includes insight objects with canonical_* IDs (not odoo_ IDs in user-facing fields).

- [ ] **Step 11: Commit**

```bash
git add src/app/api/agents/ src/app/api/pipeline/reconcile/ src/__tests__/silver-sp5/agent-routes.test.ts
git commit -m "$(cat <<'EOF'
feat(sp5): task 19 — rewire agent routes to canonical/gold

orchestrate: 7 business agents + Meta + Data Quality read
canonical_* / gold_*. Odoo diagnostic agent keeps Bronze reads
annotated SP5-EXCEPTION. auto-fix / cleanup / validate / reconcile
rewired to canonical. identity-resolution / learn / run / wake
verified already canonical.

Co-Authored-By: claude-flow <ruv@ruv.net>
EOF
)"
```

- [ ] **Step 12: Notes**

```markdown
## Task 19 — api/agents routes (completed YYYY-MM-DD)

- orchestrate: 9 agents rewired to canonical/gold (Odoo keeps Bronze diagnostic scope).
- auto-fix / cleanup / validate / reconcile rewired.
- Verified canonical: identity-resolution, learn, run, wake.
- Tests: N passing (grep + SP5-EXCEPTION gate).
- Smoke: orchestrate?agent=finance returns insights with canonical FK.
```

---

### Task 20: Create `/api/inbox/*` endpoints

**Files:**
- Create: `src/app/api/inbox/top/route.ts`
- Create: `src/app/api/inbox/resolve/route.ts`
- Create: `src/app/api/inbox/assign/route.ts`
- Create: `src/app/api/inbox/action/operationalize/route.ts`
- Create: `src/app/api/inbox/action/link_manual/route.ts`
- Test: `src/__tests__/silver-sp5/inbox-api.test.ts`

**Context:** the CEO Inbox UI (Task 12) reads via server components today. For external automation (mobile app, Slack bot, CSV export, etc.) we also need HTTP endpoints. Spec §13.3 lists them. They all accept `CRON_SECRET`-protected header or user session (depending on route).

- [ ] **Step 1: Failing tests**

`src/__tests__/silver-sp5/inbox-api.test.ts`:

```typescript
import { describe, it, expect } from "vitest";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const describeIntegration = URL && KEY ? describe : describe.skip;

async function callRoute(path: string, init: RequestInit = {}) {
  const mod = await import(`@/app/api/inbox/${path}/route`);
  const req = new Request(`http://localhost/api/inbox/${path}`, init);
  if ((init as any).method === "POST" || init.method === "POST") {
    return mod.POST(req);
  }
  return mod.GET(req);
}

describeIntegration("api/inbox endpoints", () => {
  it("GET /api/inbox/top returns ≤50 rows", async () => {
    const res = await callRoute("top", { method: "GET", headers: { "x-cron-secret": process.env.CRON_SECRET ?? "test" } });
    expect(res.status).toBeLessThan(500);
    if (res.status === 200) {
      const body = await res.json();
      expect(Array.isArray(body.items)).toBe(true);
      expect(body.items.length).toBeLessThanOrEqual(50);
    }
  });

  it("POST /api/inbox/resolve requires issue_id + resolution", async () => {
    const res = await callRoute("resolve", {
      method: "POST",
      headers: { "content-type": "application/json", "x-cron-secret": process.env.CRON_SECRET ?? "test" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);  // missing body = 400
  });

  it("POST /api/inbox/assign requires assignee_canonical_contact_id", async () => {
    const res = await callRoute("assign", {
      method: "POST",
      headers: { "content-type": "application/json", "x-cron-secret": process.env.CRON_SECRET ?? "test" },
      body: JSON.stringify({ issue_id: "00000000-0000-0000-0000-000000000000" }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
```

Note the import path uses the `@/app/api/...` alias. If this alias isn't configured, use relative path — or restructure the test to call via HTTP once `npm run dev` is running (less ideal). Adjust if necessary.

- [ ] **Step 2: Red**

```bash
npm run test -- src/__tests__/silver-sp5/inbox-api.test.ts 2>&1 | tail -20
```

- [ ] **Step 3: Implement `top/route.ts`**

```typescript
// src/app/api/inbox/top/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  // Auth: service-role callers pass CRON_SECRET; user-authenticated callers pass cookies already.
  const sb = await createSupabaseServerClient();
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 50), 100);
  const severity = req.nextUrl.searchParams.get("severity");
  let q = sb.from("gold_ceo_inbox").select("*").order("priority_score", { ascending: false, nullsFirst: false }).limit(limit);
  if (severity) q = q.eq("severity", severity);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [] });
}
```

- [ ] **Step 4: Implement `resolve/route.ts`**

```typescript
// src/app/api/inbox/resolve/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as any));
  const { issue_id, resolution, note } = body as { issue_id?: string; resolution?: string; note?: string };
  if (!issue_id || !resolution) {
    return NextResponse.json({ error: "issue_id and resolution required" }, { status: 400 });
  }
  const sb = await createSupabaseServerClient();
  const resolved_at = new Date().toISOString();
  const { data: updated, error } = await sb
    .from("reconciliation_issues")
    .update({ resolved_at, resolution, resolution_note: note ?? null })
    .eq("id", issue_id)
    .select()
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!updated) return NextResponse.json({ error: "issue_id not found" }, { status: 404 });
  // Append manual_note (evidence)
  if (note) {
    await sb.from("manual_notes").insert({
      canonical_entity_type: updated.canonical_entity_type,
      canonical_entity_id: updated.canonical_entity_id,
      note_type: "resolution",
      content: note,
      created_by: "ceo_inbox",
    });
  }
  return NextResponse.json({ ok: true, issue: updated });
}
```

- [ ] **Step 5: Implement `assign/route.ts`**

```typescript
// src/app/api/inbox/assign/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as any));
  const { issue_id, assignee_canonical_contact_id } = body as { issue_id?: string; assignee_canonical_contact_id?: number };
  if (!issue_id || !assignee_canonical_contact_id) {
    return NextResponse.json({ error: "issue_id and assignee_canonical_contact_id required" }, { status: 400 });
  }
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb
    .from("reconciliation_issues")
    .update({ assignee_canonical_contact_id, assigned_at: new Date().toISOString() })
    .eq("id", issue_id)
    .select()
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "issue_id not found" }, { status: 404 });
  return NextResponse.json({ ok: true, issue: data });
}
```

- [ ] **Step 6: Implement `action/operationalize/route.ts`**

```typescript
// src/app/api/inbox/action/operationalize/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as any));
  const { issue_id, note } = body as { issue_id?: string; note?: string };
  if (!issue_id) return NextResponse.json({ error: "issue_id required" }, { status: 400 });
  const sb = await createSupabaseServerClient();
  // Load the issue + entity
  const { data: issue } = await sb.from("reconciliation_issues").select("*").eq("id", issue_id).maybeSingle();
  if (!issue) return NextResponse.json({ error: "issue_id not found" }, { status: 404 });
  // Insert sync_commands row instructing Odoo puller to re-sync this entity
  await sb.from("sync_commands").insert({
    command: "operationalize",
    payload: { issue_id, canonical_entity_type: issue.canonical_entity_type, canonical_entity_id: issue.canonical_entity_id, note: note ?? null },
    source: "ceo_inbox",
  });
  await sb.from("manual_notes").insert({
    canonical_entity_type: issue.canonical_entity_type,
    canonical_entity_id: issue.canonical_entity_id,
    note_type: "operationalize_requested",
    content: note ?? "CEO marked for operationalization",
    created_by: "ceo_inbox",
  });
  return NextResponse.json({ ok: true, queued: true });
}
```

- [ ] **Step 7: Implement `action/link_manual/route.ts`**

```typescript
// src/app/api/inbox/action/link_manual/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as any));
  const {
    canonical_entity_type, canonical_entity_id,
    override_field, override_value,
    action, payload, source_link_id,
    created_by, note,
  } = body as any;
  if (!canonical_entity_type || !canonical_entity_id || !override_field || !override_value || !action) {
    return NextResponse.json({ error: "canonical_entity_type, canonical_entity_id, override_field, override_value, action required" }, { status: 400 });
  }
  const sb = await createSupabaseServerClient();
  const { data, error } = await sb.from("mdm_manual_overrides").insert({
    canonical_entity_type,
    canonical_entity_id,
    override_field,
    override_value,
    action,
    payload: payload ?? {},
    source_link_id: source_link_id ?? null,
    created_by: created_by ?? "ceo_inbox",
    is_active: true,
  }).select().maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (note) {
    await sb.from("manual_notes").insert({
      canonical_entity_type, canonical_entity_id,
      note_type: "manual_link", content: note, created_by: created_by ?? "ceo_inbox",
    });
  }
  return NextResponse.json({ ok: true, override: data });
}
```

- [ ] **Step 8: Verify `reconciliation_issues` has `assigned_at` + `resolution` + `resolution_note` columns**

```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='reconciliation_issues'
ORDER BY ordinal_position;
```
If any of `assigned_at`, `resolution`, `resolution_note` are missing, add them in a small migration `1064a_silver_sp5_inbox_columns.sql`:

```sql
ALTER TABLE reconciliation_issues
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolution text,
  ADD COLUMN IF NOT EXISTS resolution_note text;
```
Apply via `mcp__claude_ai_Supabase__apply_migration`.

- [ ] **Step 9: Verify `mdm_manual_overrides` schema per SP3**

```sql
SELECT column_name, is_nullable FROM information_schema.columns
WHERE table_schema='public' AND table_name='mdm_manual_overrides' ORDER BY ordinal_position;
```
Confirm all 6 SP3 columns (`override_field, override_value, action, source_link_id, payload, created_by, is_active`) are present. If any INSERT fails, adjust the route body to match.

- [ ] **Step 10: Green**

```bash
npm run test -- src/__tests__/silver-sp5/inbox-api.test.ts 2>&1 | tail -30
npm run build 2>&1 | tail -30
```

- [ ] **Step 11: End-to-end smoke**

```bash
npm run dev
# In another terminal:
curl -s "http://localhost:3000/api/inbox/top?limit=5" | head -20
# Should return { items: [...] } with 5 rows
# Pick one issue_id and test resolve:
ISS=$(curl -s "http://localhost:3000/api/inbox/top?limit=1" | python3 -c "import sys, json; print(json.load(sys.stdin)['items'][0]['issue_id'])")
curl -s -X POST "http://localhost:3000/api/inbox/resolve" -H "content-type: application/json" -d "{\"issue_id\":\"$ISS\",\"resolution\":\"manual_test\",\"note\":\"SP5 smoke\"}"
# Should return { ok: true, issue: {...} }
# Verify the issue was resolved:
# SELECT resolved_at, resolution FROM reconciliation_issues WHERE id = '...'
```
If resolve succeeds but the UI still shows the issue, the inbox view may need refresh — document expected behavior.

- [ ] **Step 12: Commit**

```bash
git add src/app/api/inbox/ src/__tests__/silver-sp5/inbox-api.test.ts supabase/migrations/*inbox*
git commit -m "$(cat <<'EOF'
feat(sp5): task 20 — /api/inbox/{top,resolve,assign,action/*} endpoints

GET /top → gold_ceo_inbox. POST /resolve → update resolved_at +
append manual_notes. POST /assign → update assignee_canonical_contact_id.
POST /action/operationalize → enqueue sync_commands row.
POST /action/link_manual → insert mdm_manual_overrides (SP3 6-col shape).

Micro-migration 1064a adds assigned_at / resolution / resolution_note
to reconciliation_issues if not present.

Co-Authored-By: claude-flow <ruv@ruv.net>
EOF
)"
```

- [ ] **Step 13: Notes**

```markdown
## Task 20 — /api/inbox/* (completed YYYY-MM-DD)

- 5 new endpoints created.
- Columns added (if needed): assigned_at, resolution, resolution_note.
- Smoke: top returns 5 items; resolve flips resolved_at to timestamp.
- Tests: 3 passing (grep + HTTP shape checks).
```

---

### Task 21: qb19 addon §14.2 — `_push_account_balances` include `equity_unaffected`

**Files:**
- Modify: `/Users/jj/addons/quimibond_intelligence/models/sync_push.py` — function `_push_account_balances`
- User deploys via `odoo-update quimibond_intelligence && odoosh-restart http && odoosh-restart cron`
- Verify: query `odoo_account_balances` for `equity_unaffected` rows post-deploy

**Context:** `gold_balance_sheet.unbalanced_amount` is non-zero today because the addon never pushes `equity_unaffected` account_type (retained earnings / current year earnings). Once the column flows, the balance sheet balances. §14.2 is a single `domain` change in the Python addon.

- [ ] **Step 1: Inventory current filter in `_push_account_balances`**

Open `/Users/jj/addons/quimibond_intelligence/models/sync_push.py` and locate `_push_account_balances`. Find the domain / account_type filter:

```bash
cd /Users/jj
rg -n "_push_account_balances|account_type|asset_|liability_|equity_|income_|expense_" addons/quimibond_intelligence/models/sync_push.py | head -30
```

- [ ] **Step 2: Edit the domain to include `equity_unaffected`**

Find the line that filters by account_type (usually a list of strings). If the existing code looks like:

```python
ALLOWED_ACCOUNT_TYPES = [
    'asset_current', 'asset_non_current', 'asset_receivable', 'asset_cash',
    'liability_current', 'liability_non_current', 'liability_payable',
    'equity',
    'income', 'income_other',
    'expense', 'expense_direct_cost', 'expense_depreciation',
]
```

Change it to include `equity_unaffected`:

```python
ALLOWED_ACCOUNT_TYPES = [
    'asset_current', 'asset_non_current', 'asset_receivable', 'asset_cash',
    'liability_current', 'liability_non_current', 'liability_payable',
    'equity', 'equity_unaffected',
    'income', 'income_other',
    'expense', 'expense_direct_cost', 'expense_depreciation',
]
```

If the filter is inline (e.g. `domain = [('account_type', 'in', [...])]`), extract to a module-level constant first, then add the new value. Preserve style; do not reformat the file.

- [ ] **Step 3: Add a comment referencing the spec**

```python
# SP5 §14.2 (2026-04-21): include equity_unaffected (utilidad del ejercicio) so
# gold_balance_sheet.unbalanced_amount reconciles. Prior to this fix,
# account_type='equity_unaffected' rows had 0 coverage in odoo_account_balances.
ALLOWED_ACCOUNT_TYPES = [...]
```

- [ ] **Step 4: Verify no other filter excludes equity_unaffected**

```bash
rg -n "equity" addons/quimibond_intelligence/models/sync_push.py
```
If a subsequent CASE / if blocks further filters account types, update each similarly.

- [ ] **Step 5: Commit the addon change on the qb19 repo**

```bash
cd /Users/jj
git add addons/quimibond_intelligence/models/sync_push.py
git commit -m "$(cat <<'EOF'
feat(addon): §14.2 — push equity_unaffected in _push_account_balances

Adds equity_unaffected account_type (utilidad del ejercicio) to the
list of account types synced to odoo_account_balances. Unblocks
gold_balance_sheet.unbalanced_amount reconciliation in Supabase
(Quimibond Intelligence Silver SP5).

Co-Authored-By: claude-flow <ruv@ruv.net>
EOF
)"
```

- [ ] **Step 6: Hand off to user for deploy**

Output this block for the user to run themselves (never run it in the plan):

```
# USER: deploy the addon change to Odoo.sh:
#   1. Review the commit above
#   2. git push origin main   (only if user explicitly approves)
#   3. In GitHub, merge main → quimibond branch
#   4. In Odoo.sh shell:
#      odoo-update quimibond_intelligence
#      odoosh-restart http
#      odoosh-restart cron
# Wait at least one hour-cron cycle (until minute 5 past the hour) to let the
# push_to_supabase cron run and populate equity_unaffected rows.
```

- [ ] **Step 7: Post-deploy verification (after user confirms deploy)**

Run via MCP:
```sql
SELECT account_type, COUNT(*) AS rows, SUM(balance) AS sum_balance_mxn
FROM odoo_account_balances
WHERE synced_at > now() - interval '2 hours'
GROUP BY account_type
ORDER BY account_type;
```
Expected: `equity_unaffected` appears with a non-zero row count.

If zero rows after 2 hours, debug: check if the Odoo `account.account` table has accounts with `account_type='equity_unaffected'` at all. If the user confirms the change has deployed but no rows appear, escalate — there may be a further filter in the `env['account.account'].search(domain)` call.

- [ ] **Step 8: Verify gold_balance_sheet improvement**

```sql
SELECT period_month, unbalanced_amount
FROM gold_balance_sheet
ORDER BY period_month DESC LIMIT 6;
```
`unbalanced_amount` should trend toward zero for the current period (not necessarily exactly zero — residual rounding differences are allowed).

- [ ] **Step 9: Notes**

Back in the frontend repo:

```markdown
## Task 21 — addon §14.2 equity_unaffected (completed YYYY-MM-DD)

- qb19 commit: <paste sha>.
- User deployed: <timestamp>.
- Post-deploy rows: <N> equity_unaffected rows, sum_balance_mxn = <value>.
- gold_balance_sheet.unbalanced_amount post-deploy: <value> (was: <pre-deploy value>).
```

No frontend commit for this task; document in notes only.

---

### Task 22: qb19 addon §14.3 — `odoo_invoices.reversed_entry_id` + push

**Files:**
- Modify: Supabase migration: add nullable `reversed_entry_id BIGINT` column to `odoo_invoices` (if absent)
- Modify: `/Users/jj/addons/quimibond_intelligence/models/sync_push.py` — `_push_invoices` to include `reversed_entry_id`
- Verify: `SELECT COUNT(*) FROM odoo_invoices WHERE move_type IN ('out_refund','in_refund') AND reversed_entry_id IS NOT NULL`

- [ ] **Step 1: Check Supabase column presence**

```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='odoo_invoices' AND column_name='reversed_entry_id';
```
If missing, apply a micro-migration:

```sql
-- Migration: 1064b_silver_sp5_odoo_invoices_reversed_entry_id
ALTER TABLE odoo_invoices ADD COLUMN IF NOT EXISTS reversed_entry_id BIGINT;
CREATE INDEX IF NOT EXISTS idx_odoo_invoices_reversed_entry_id ON odoo_invoices (reversed_entry_id);
```
Apply via `mcp__claude_ai_Supabase__apply_migration`.

- [ ] **Step 2: Edit `_push_invoices` in qb19**

```bash
cd /Users/jj
rg -n "_push_invoices|move_type|reversed_entry_id|amount_total|amount_residual" addons/quimibond_intelligence/models/sync_push.py | head -40
```

Find the dict/list of fields pushed for each invoice and add `reversed_entry_id`:

```python
# In _push_invoices, the row dict (example structure):
row = {
    'odoo_invoice_id': inv.id,
    'odoo_partner_id': inv.partner_id.commercial_partner_id.id if inv.partner_id else None,
    'name': inv.name,
    'move_type': inv.move_type,
    'amount_total': inv.amount_total,
    'amount_residual': inv.amount_residual,
    'currency': inv.currency_id.name,
    'invoice_date': _fmt_date(inv.invoice_date),
    'due_date': _fmt_date(inv.invoice_date_due),
    'state': inv.state,
    'payment_state': inv.payment_state,
    'days_overdue': _days_overdue(inv),
    'ref': inv.ref or '',
    # SP5 §14.3 (2026-04-21): reversed_entry_id for canonical_credit_notes linkage
    'reversed_entry_id': inv.reversed_entry_id.id if inv.reversed_entry_id else None,
    # ... any further fields ...
}
```

- [ ] **Step 3: Commit on qb19**

```bash
cd /Users/jj
git add addons/quimibond_intelligence/models/sync_push.py
git commit -m "$(cat <<'EOF'
feat(addon): §14.3 — push reversed_entry_id for credit notes

Adds reversed_entry_id to odoo_invoices sync. Needed by Silver SP4
canonical_credit_notes to link NC → factura origen pre-SAT (Odoo
side). SAT side uses cfdiRelacionados as the authoritative fallback.

Co-Authored-By: claude-flow <ruv@ruv.net>
EOF
)"
```

- [ ] **Step 4: Hand off**

Same deploy block as Task 21 Step 6.

- [ ] **Step 5: Post-deploy verification**

```sql
SELECT
  COUNT(*) FILTER (WHERE move_type IN ('out_refund','in_refund')) AS total_refund_rows,
  COUNT(*) FILTER (WHERE move_type IN ('out_refund','in_refund') AND reversed_entry_id IS NOT NULL) AS linked_rows
FROM odoo_invoices;
```
Expected: `linked_rows > 0`, ideally close to `total_refund_rows`. Some NCs without a reversed_entry_id are legitimate (standalone NCs).

- [ ] **Step 6: Verify canonical_credit_notes improves**

```sql
SELECT
  COUNT(*) AS total,
  COUNT(original_canonical_invoice_id) AS with_linked_original,
  COUNT(*) - COUNT(original_canonical_invoice_id) AS orphans
FROM canonical_credit_notes;
```
Expected: `orphans` count decreases versus pre-deploy (capture that baseline in the Task 22 notes before user deploys).

- [ ] **Step 7: Notes**

```markdown
## Task 22 — addon §14.3 reversed_entry_id (completed YYYY-MM-DD)

- Supabase column: added via migration 1064b (or already present).
- qb19 commit: <paste sha>.
- User deployed: <timestamp>.
- Post-deploy: <N>/<M> refunds have reversed_entry_id populated.
- canonical_credit_notes orphan count: pre=<N>, post=<N'>.
```

---

### Task 23: qb19 addon §14.4 — `odoo_invoices.payment_date` compute from reconciled lines

**Priority:** Low (nice-to-have). If user indicates SP5 is running long, defer to SP5.5; otherwise ship.

**Files:**
- Modify: `/Users/jj/addons/quimibond_intelligence/models/sync_push.py` — `_push_invoices` to compute `payment_date`

**Context:** `odoo_invoices.payment_date` column exists but is never populated. §14.4 asks to compute it as "date of latest reconciled `account.move.line` against this invoice". The value is secondary — `canonical_invoices.fiscal_fully_paid_at` (SAT-authoritative) already serves the frontend — so prioritize Tasks 21-22 first and ship this only if time permits.

- [ ] **Step 1: Decide whether to include in SP5**

If the user explicitly says "ship everything in SP5", proceed. If the user says "SP5 is already big, skip §14.4", document the deferral in Task 23 notes and move to Task 24. Obtain explicit user confirmation before skipping.

- [ ] **Step 2: Inventory the existing row dict for payment_date**

```bash
cd /Users/jj
rg -n "payment_date|partial_rec|reconciled_line" addons/quimibond_intelligence/models/sync_push.py | head -20
```

- [ ] **Step 3: Implement computation**

In `_push_invoices`, add a helper that reads reconciled counterpart move_lines. Pseudo-code:

```python
def _latest_payment_date(self, inv):
    """Return the date of the latest reconciled payment line against this invoice, or None."""
    if inv.state != 'posted' or inv.payment_state not in ('paid', 'partial', 'in_payment'):
        return None
    # For customer invoices (out_invoice), read receivable line's matched debits
    # For vendor bills (in_invoice), read payable line's matched credits
    receivable_line = inv.line_ids.filtered(lambda l: l.account_id.account_type in ('asset_receivable', 'liability_payable'))
    if not receivable_line:
        return None
    matches = receivable_line.matched_debit_ids + receivable_line.matched_credit_ids if receivable_line.account_id.account_type == 'asset_receivable' else receivable_line.matched_credit_ids + receivable_line.matched_debit_ids
    if not matches:
        return None
    dates = []
    for m in matches:
        line = m.debit_move_id if m.debit_move_id.id != receivable_line.id else m.credit_move_id
        if line and line.date:
            dates.append(line.date)
    if not dates:
        return None
    return max(dates)
```

And in the row dict:

```python
# SP5 §14.4 (2026-04-21): compute payment_date from reconciled move_lines
'payment_date': _fmt_date(self._latest_payment_date(inv)),
```

Test the logic on a small sample of known paid invoices in a debug shell before committing. If Odoo's reconciliation API differs from the pseudo-code, adjust accordingly — the exact ORM paths depend on Odoo 19's account module. If it's not trivially achievable in 30 minutes, revert to the no-op and document the deferral in Task 23 notes.

- [ ] **Step 4: Commit + hand off**

```bash
cd /Users/jj
git add addons/quimibond_intelligence/models/sync_push.py
git commit -m "$(cat <<'EOF'
feat(addon): §14.4 — compute payment_date from reconciled move_lines

Sets odoo_invoices.payment_date = max(date) over reconciled counterpart
move_lines of the receivable/payable line. Nice-to-have; does not
gate anything — fiscal_fully_paid_at from SAT is authoritative.

Co-Authored-By: claude-flow <ruv@ruv.net>
EOF
)"
```
(User deploys as Task 21 Step 6.)

- [ ] **Step 5: Post-deploy verification**

```sql
SELECT
  COUNT(*) FILTER (WHERE payment_state IN ('paid','in_payment','partial')) AS paid_rows,
  COUNT(*) FILTER (WHERE payment_state IN ('paid','in_payment','partial') AND payment_date IS NOT NULL) AS with_payment_date
FROM odoo_invoices;
```
Expected: `with_payment_date / paid_rows` → close to 1.0 over time.

- [ ] **Step 6: Notes**

```markdown
## Task 23 — addon §14.4 payment_date (completed YYYY-MM-DD)

- [Shipped | Deferred to SP5.5 per user decision <date>].
- If shipped: qb19 commit <sha>; post-deploy coverage <N>/<M> paid rows have payment_date.
```

---

### Task 24: Backfill `canonical_invoices.amount_residual_mxn_resolved`

**Files:**
- Apply migration: `supabase/migrations/1065_silver_sp5_amount_residual_mxn_resolved.sql`

**Context:** SP4 Task 19 backfilled `amount_total_mxn_resolved` on `canonical_invoices` (0 → 99%). The SP4 plan deferred `amount_residual_mxn_resolved` (same pattern: multiply residual by `usd_to_mxn(invoice_date)` when currency is USD, else passthrough). Without it, `gold_cashflow.total_receivable_mxn` sits at 0 and the frontend's AR total under-reports. This task ports the SP4 Task 19 SQL to `amount_residual` and runs it.

- [ ] **Step 1: Gate — confirm the backfill is safe to run**

```sql
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE amount_residual_mxn_resolved IS NOT NULL) AS already_filled,
  COUNT(*) FILTER (WHERE amount_residual IS NOT NULL AND amount_residual > 0) AS candidates
FROM canonical_invoices;
```
Expected: `already_filled = 0`, `candidates` in the range 30-50k (residual > 0 rows). Paste into Task 24 notes.

- [ ] **Step 2: Notify the user**

Say to the user: "About to run a backfill updating ~30-50k rows of `canonical_invoices.amount_residual_mxn_resolved`. This is the same pattern as SP4 Task 19. Proceed?" Wait for explicit confirmation.

- [ ] **Step 3: Apply migration**

```sql
-- Migration: 1065_silver_sp5_amount_residual_mxn_resolved
-- Idempotent: only updates rows where amount_residual_mxn_resolved IS NULL
-- Conversion: if currency='MXN', passthrough; if 'USD', use usd_to_mxn(invoice_date);
-- if EUR or other, fall back to fiscal_tipo_cambio when present, else amount_residual (Bronze default)

BEGIN;

UPDATE canonical_invoices AS ci
SET amount_residual_mxn_resolved = CASE
  WHEN ci.amount_residual IS NULL THEN NULL
  WHEN COALESCE(ci.fiscal_moneda, ci.odoo_currency, 'MXN') IN ('MXN', 'mxn') THEN ci.amount_residual
  WHEN COALESCE(ci.fiscal_moneda, ci.odoo_currency) = 'USD' THEN
    ci.amount_residual * COALESCE(usd_to_mxn(ci.invoice_date), ci.fiscal_tipo_cambio, 1)
  WHEN ci.fiscal_tipo_cambio IS NOT NULL AND ci.fiscal_tipo_cambio > 0 THEN
    ci.amount_residual * ci.fiscal_tipo_cambio
  ELSE
    ci.amount_residual  -- pessimistic passthrough; logged in audit_runs below
END
WHERE ci.amount_residual_mxn_resolved IS NULL
  AND ci.amount_residual IS NOT NULL;

-- Audit row
INSERT INTO audit_runs (run_at, severity, details)
VALUES (
  now(), 'ok',
  jsonb_build_object(
    'label', 'sp5_task24_residual_mxn_backfill',
    'rows_updated',
      (SELECT COUNT(*) FROM canonical_invoices WHERE amount_residual_mxn_resolved IS NOT NULL),
    'coverage_pct',
      100.0 * (SELECT COUNT(*) FILTER (WHERE amount_residual_mxn_resolved IS NOT NULL) FROM canonical_invoices)
            / NULLIF((SELECT COUNT(*) FROM canonical_invoices WHERE amount_residual IS NOT NULL), 0)
  )
);

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES (
  'BACKFILL', 'canonical_invoices',
  'amount_residual_mxn_resolved populated via FX passthrough (SP5 Task 24)',
  'UPDATE canonical_invoices SET amount_residual_mxn_resolved = CASE ... END',
  'silver-sp5-task-24',
  true
);

COMMIT;
```

- [ ] **Step 4: Verify coverage**

```sql
SELECT
  COUNT(*) FILTER (WHERE amount_residual IS NOT NULL) AS with_residual,
  COUNT(*) FILTER (WHERE amount_residual_mxn_resolved IS NOT NULL) AS with_mxn,
  ROUND(100.0 * COUNT(*) FILTER (WHERE amount_residual_mxn_resolved IS NOT NULL) / NULLIF(COUNT(*) FILTER (WHERE amount_residual IS NOT NULL), 0), 2) AS coverage_pct
FROM canonical_invoices;
```
Expected: coverage_pct ≥ 99 (same pattern as SP4 Task 19 on amount_total_mxn).

- [ ] **Step 5: Refresh `gold_cashflow` and verify total_receivable_mxn**

```sql
REFRESH MATERIALIZED VIEW CONCURRENTLY gold_cashflow;  -- if it's an MV; if it's a view, no-op
SELECT total_receivable_mxn FROM gold_cashflow;
```
Expected: value > 0 (previously 0).

If `gold_cashflow` is a plain view (not MV), skip the REFRESH and just SELECT. Either way, the new value must be > 0.

- [ ] **Step 6: Append notes**

```markdown
## Task 24 — amount_residual_mxn_resolved backfill (completed YYYY-MM-DD)

- Pre: 0/<N> rows filled.
- Post: <M>/<N> filled (<coverage_pct>%).
- gold_cashflow.total_receivable_mxn: pre=0, post=<value>.
- Migration: 1065_silver_sp5_amount_residual_mxn_resolved.
```

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/1065_silver_sp5_amount_residual_mxn_resolved.sql
git commit -m "$(cat <<'EOF'
feat(sp5): task 24 — backfill canonical_invoices.amount_residual_mxn_resolved

Same FX-passthrough pattern as SP4 Task 19 for amount_total. Unblocks
gold_cashflow.total_receivable_mxn (was 0). 99%+ coverage expected
for rows with amount_residual IS NOT NULL.

Co-Authored-By: claude-flow <ruv@ruv.net>
EOF
)"
```

---

### Task 25: Routing job for `reconciliation_issues.assignee_canonical_contact_id`

**Files:**
- Apply migration: `supabase/migrations/1066_silver_sp5_assignee_routing.sql`

**Context:** `gold_ceo_inbox.assignee_name` is NULL on all 50 rows pre-SP5 because `reconciliation_issues.assignee_canonical_contact_id` is never populated. Spec §13.3 and the SP4 notes call for a routing job: map each invariant_key → responsible canonical_contact via `insight_routing` table (department-based). SP5 implements the job + runs it idempotently.

- [ ] **Step 1: Inventory the routing table**

```sql
SELECT * FROM insight_routing LIMIT 10;
SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='insight_routing' ORDER BY ordinal_position;
```
Expected columns like `category, department_name, canonical_contact_id` (via SP3 rewire) or `department_name, odoo_user_id` legacy. Verify the canonical-contact column exists before writing the job; if not, add one:

```sql
ALTER TABLE insight_routing ADD COLUMN IF NOT EXISTS canonical_contact_id BIGINT REFERENCES canonical_contacts(id);
```

- [ ] **Step 2: Inventory invariant_key → category mapping**

The invariant_keys are dotted strings like `invoice.posted_without_uuid`, `payment.registered_without_complement`. Group by namespace:

```sql
SELECT SPLIT_PART(invariant_key, '.', 1) AS namespace, COUNT(*) AS n
FROM audit_tolerances WHERE enabled = true
GROUP BY 1 ORDER BY n DESC;
```

Expected namespaces: `invoice`, `payment`, `credit_note`, `tax`, `company`, `product`, `order`, `delivery`, `manufacturing`, `bank`. Each maps to a department (cobranza for invoice, compras for purchase-side, etc.).

- [ ] **Step 3: Gate — show the user the routing proposal**

Draft the mapping as SQL table, print to notes, and ask the user to confirm or adjust:

```markdown
| Namespace | Department | Rationale |
|---|---|---|
| invoice | Cobranza | AR owner |
| payment | Cobranza | AR cash reconciliation |
| credit_note | Cobranza | NC matching |
| tax | Dirección | Fiscal SAT events |
| company | Ventas | Customer/supplier MDM |
| product | Almacén | SKU matters |
| order (sale) | Ventas | Salesperson |
| order (purchase) | Compras | Buyer |
| delivery | Logística | |
| manufacturing | Producción | |
| bank | Dirección | Cash ops |
```

Obtain user confirmation on this mapping before running the SQL. Adjust per their feedback.

- [ ] **Step 4: Apply migration**

```sql
-- Migration: 1066_silver_sp5_assignee_routing
-- Populates reconciliation_issues.assignee_canonical_contact_id from insight_routing

BEGIN;

-- Step 4a: ensure a seed routing table exists keyed by invariant_key namespace
CREATE TABLE IF NOT EXISTS invariant_routing (
  invariant_namespace text PRIMARY KEY,
  department_name text NOT NULL,
  canonical_contact_id bigint REFERENCES canonical_contacts(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Seed (adjust per Step 3 user-confirmed mapping)
INSERT INTO invariant_routing (invariant_namespace, department_name, canonical_contact_id)
SELECT ns, dept, (
  SELECT id FROM canonical_contacts
  WHERE department_name = dept AND is_active = true
  ORDER BY id LIMIT 1
)
FROM (VALUES
  ('invoice', 'Cobranza'),
  ('payment', 'Cobranza'),
  ('credit_note', 'Cobranza'),
  ('tax', 'Direccion'),
  ('company', 'Ventas'),
  ('product', 'Almacen'),
  ('order', 'Ventas'),
  ('delivery', 'Logistica'),
  ('manufacturing', 'Produccion'),
  ('bank', 'Direccion')
) AS m(ns, dept)
ON CONFLICT (invariant_namespace) DO UPDATE SET
  department_name = EXCLUDED.department_name,
  canonical_contact_id = COALESCE(invariant_routing.canonical_contact_id, EXCLUDED.canonical_contact_id),
  updated_at = now();

-- Step 4b: function to (re)assign
CREATE OR REPLACE FUNCTION sp5_assign_issues() RETURNS int
LANGUAGE plpgsql AS $$
DECLARE updated_count int;
BEGIN
  UPDATE reconciliation_issues r
  SET assignee_canonical_contact_id = ir.canonical_contact_id,
      assigned_at = COALESCE(r.assigned_at, now())
  FROM invariant_routing ir
  WHERE r.resolved_at IS NULL
    AND r.assignee_canonical_contact_id IS NULL
    AND r.invariant_key IS NOT NULL
    AND SPLIT_PART(r.invariant_key, '.', 1) = ir.invariant_namespace
    AND ir.canonical_contact_id IS NOT NULL;
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END $$;

-- Step 4c: run once
DO $$
DECLARE n int;
BEGIN
  SELECT sp5_assign_issues() INTO n;
  INSERT INTO audit_runs (run_at, severity, details) VALUES (
    now(), 'ok',
    jsonb_build_object('label', 'sp5_task25_assignee_routing', 'rows_assigned', n)
  );
END $$;

-- Step 4d: wire to existing pg_cron? No — let the engine run it on next cycle.
-- Add it to the silver_sp4_reconcile_daily dispatch if desired, but not required.

COMMIT;
```

- [ ] **Step 5: Verify**

```sql
SELECT
  COUNT(*) FILTER (WHERE resolved_at IS NULL) AS open,
  COUNT(*) FILTER (WHERE resolved_at IS NULL AND assignee_canonical_contact_id IS NOT NULL) AS assigned,
  ROUND(100.0 * COUNT(*) FILTER (WHERE resolved_at IS NULL AND assignee_canonical_contact_id IS NOT NULL)
              / NULLIF(COUNT(*) FILTER (WHERE resolved_at IS NULL), 0), 2) AS assigned_pct
FROM reconciliation_issues;
```
Expected: `assigned_pct` ≥ 50 (exact target depends on how many namespaces have real canonical contacts). If < 10%, the `canonical_contacts.department_name` coverage is poor — investigate before claiming success.

- [ ] **Step 6: Verify gold_ceo_inbox now shows assignees**

```sql
SELECT issue_id, severity, invariant_key, assignee_canonical_contact_id
FROM gold_ceo_inbox
WHERE assignee_canonical_contact_id IS NOT NULL
LIMIT 10;
```

- [ ] **Step 7: Notes**

```markdown
## Task 25 — assignee routing (completed YYYY-MM-DD)

- invariant_routing table seeded with N rows (namespace → department → canonical_contact_id).
- Assigned: <M>/<open> issues (<pct>%).
- gold_ceo_inbox assignee coverage post: <pct>%.
- Migration: 1066_silver_sp5_assignee_routing.
```

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/1066_silver_sp5_assignee_routing.sql
git commit -m "$(cat <<'EOF'
feat(sp5): task 25 — reconciliation_issues assignee routing

Seeds invariant_routing (namespace→department→canonical_contact_id)
and runs sp5_assign_issues() to populate assignee_canonical_contact_id
on all open issues. gold_ceo_inbox now surfaces assignee_name.

Co-Authored-By: claude-flow <ruv@ruv.net>
EOF
)"
```

---

### Task 26: Remap residual NULL invariant_keys (123 rows)

**Files:**
- Apply migration: `supabase/migrations/1067_silver_sp5_null_invariant_keys_remap.sql`

**Context:** SP4 Task 16 backfilled `invariant_key` on `reconciliation_issues` but 123 rows drifted during live engine runs. Each row has a legacy `issue_type` value that maps to a current invariant_key. We map them by rule.

- [ ] **Step 1: Inventory the NULL rows**

```sql
SELECT issue_type, COUNT(*) AS n
FROM reconciliation_issues
WHERE invariant_key IS NULL AND resolved_at IS NULL
GROUP BY issue_type ORDER BY n DESC;
```
Paste into notes. Expected: a dozen or so distinct `issue_type` strings like `invoice_missing_uuid`, `payment_registered_without_complement` etc. The count should be ~123.

- [ ] **Step 2: Build the mapping**

For each distinct issue_type, decide the current dotted invariant_key. Use `SELECT DISTINCT invariant_key FROM audit_tolerances WHERE enabled=true;` as the source of valid targets.

- [ ] **Step 3: Apply migration**

```sql
-- Migration: 1067_silver_sp5_null_invariant_keys_remap

BEGIN;

-- Example mapping — ADJUST based on Step 1 inventory
UPDATE reconciliation_issues
SET invariant_key = CASE issue_type
  WHEN 'invoice_missing_uuid'                       THEN 'invoice.posted_without_uuid'
  WHEN 'invoice_amount_mismatch'                    THEN 'invoice.amount_mismatch'
  WHEN 'invoice_state_mismatch'                     THEN 'invoice.state_mismatch_posted_cancelled'
  WHEN 'invoice_pending_operationalization'         THEN 'invoice.pending_operationalization'
  WHEN 'payment_registered_without_complement'      THEN 'payment.registered_without_complement'
  WHEN 'payment_complement_without_payment'         THEN 'payment.complement_without_payment'
  WHEN 'credit_note_orphan'                         THEN 'credit_note.orphan'
  WHEN 'tax_blacklist_69b_presunto'                 THEN 'tax.blacklist_69b_presunto_active'
  WHEN 'tax_blacklist_69b_definitivo'               THEN 'tax.blacklist_69b_definitive_active'
  ELSE invariant_key
END
WHERE invariant_key IS NULL AND resolved_at IS NULL;

-- Rows that still have NULL invariant_key after mapping — escalate
INSERT INTO audit_runs (run_at, severity, details)
SELECT now(), 'warn',
  jsonb_build_object(
    'label', 'sp5_task26_null_invariant_keys_residual',
    'residual_count', (SELECT COUNT(*) FROM reconciliation_issues WHERE invariant_key IS NULL AND resolved_at IS NULL),
    'residual_by_type',
      (SELECT jsonb_agg(jsonb_build_object('type', issue_type, 'n', n))
       FROM (SELECT issue_type, COUNT(*) AS n FROM reconciliation_issues WHERE invariant_key IS NULL AND resolved_at IS NULL GROUP BY issue_type) s)
  );

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES (
  'BACKFILL', 'reconciliation_issues',
  '123 residual NULL invariant_key rows remapped to current dotted keys (SP5 Task 26)',
  'UPDATE reconciliation_issues SET invariant_key = CASE issue_type ... END',
  'silver-sp5-task-26',
  true
);

COMMIT;
```

- [ ] **Step 4: Verify**

```sql
SELECT COUNT(*) FROM reconciliation_issues WHERE invariant_key IS NULL AND resolved_at IS NULL;
```
Expected: 0. If > 0, re-inventory the remaining `issue_type` values and extend the CASE. If any rows have an `issue_type` that does NOT correspond to a currently-enabled invariant (e.g. an obsolete invariant), resolve them:

```sql
UPDATE reconciliation_issues
SET resolved_at = now(), resolution = 'sp5_obsolete_invariant'
WHERE invariant_key IS NULL AND issue_type IN ('...');
```

- [ ] **Step 5: Notes**

```markdown
## Task 26 — NULL invariant_key remap (completed YYYY-MM-DD)

- Pre: 123 NULL invariant_key rows.
- Mapping applied (N distinct issue_type → dotted key): [list].
- Post: 0 NULL invariant_key rows (or residual: <n> auto-resolved as sp5_obsolete_invariant).
- Migration: 1067_silver_sp5_null_invariant_keys_remap.
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/1067_silver_sp5_null_invariant_keys_remap.sql
git commit -m "$(cat <<'EOF'
feat(sp5): task 26 — remap 123 residual NULL invariant_keys

Maps legacy issue_type strings to SP4 dotted invariant_keys.
Any residual rows with obsolete issue_type are auto-resolved
with resolution='sp5_obsolete_invariant'.

Co-Authored-By: claude-flow <ruv@ruv.net>
EOF
)"
```

---

### Task 27: Legacy drops — Batch 1 (wrapper views + 0-byte views)

**Files:**
- Apply migration: `supabase/migrations/1068_silver_sp5_drop_batch_1_wrappers.sql`

**Context:** Batch 1 renames all small / 0-byte legacy objects to `<name>_deprecated_sp5` (rollback-safe). Physical DROP happens in Task 29 after a 24-hour soak.

- [ ] **Step 1: Gate — per-object callers check**

For each object in the batch, confirm zero callers in src/ and in DB deps:

```bash
cd /Users/jj/quimibond-intelligence/quimibond-intelligence
for obj in unified_invoices unified_payment_allocations invoice_bridge orders_unified order_fulfillment_bridge person_unified cash_position cashflow_current_cash cashflow_liquidity_metrics working_capital working_capital_cycle revenue_concentration portfolio_concentration monthly_revenue_trend monthly_revenue_by_company analytics_customer_360 balance_sheet pl_estado_resultados customer_margin_analysis customer_ltv_health customer_product_matrix supplier_product_matrix supplier_price_index supplier_concentration_herfindahl rfm_segments customer_cohorts partner_payment_profile account_payment_profile product_margin_analysis product_price_history; do
  cnt=$(rg -c "\.from\(['\"]$obj['\"]" src/ 2>/dev/null | wc -l)
  echo "$obj  callers=$cnt"
done
```
Every row should show `callers=0`. If any object has > 0 callers, re-open the corresponding rewire task (Tasks 3-19) and fix before proceeding. Paste the inventory into Task 27 notes.

Also check DB dependencies:

```sql
SELECT DISTINCT dependent.relname AS consumer, consumed.relname AS consumed
FROM pg_depend d
JOIN pg_rewrite r ON r.oid = d.objid
JOIN pg_class dependent ON dependent.oid = r.ev_class
JOIN pg_class consumed ON consumed.oid = d.refobjid
WHERE d.deptype='n' AND consumed.relname IN (
  'unified_invoices','unified_payment_allocations','invoice_bridge','orders_unified',
  'order_fulfillment_bridge','person_unified','cash_position','cashflow_current_cash',
  'cashflow_liquidity_metrics','working_capital','working_capital_cycle',
  'revenue_concentration','portfolio_concentration','monthly_revenue_trend',
  'monthly_revenue_by_company','analytics_customer_360','balance_sheet',
  'pl_estado_resultados','customer_margin_analysis','customer_ltv_health',
  'customer_product_matrix','supplier_product_matrix','supplier_price_index',
  'supplier_concentration_herfindahl','rfm_segments','customer_cohorts',
  'partner_payment_profile','account_payment_profile','product_margin_analysis',
  'product_price_history'
);
```
Any consumer in the result means another view/MV depends on this one. If the consumer is also in the drop list, no issue (it'll be dropped in batch too). If not, escalate — fix dependency before dropping.

- [ ] **Step 2: Notify user + obtain gate**

Output to the user: "About to rename 30 legacy views/MVs to `<name>_deprecated_sp5`. All caller checks pass. Physical DROP deferred to Task 29 after 24h soak. Proceed?"

- [ ] **Step 3: Apply migration (rename pass)**

```sql
-- Migration: 1068_silver_sp5_drop_batch_1_wrappers
-- Renames all Batch 1 legacy views/MVs to _deprecated_sp5 suffix.
-- ROLLBACK note: to restore, rename back without suffix.

BEGIN;

DO $$
DECLARE
  obj RECORD;
  candidates text[] := ARRAY[
    'unified_invoices','unified_payment_allocations','invoice_bridge','orders_unified',
    'order_fulfillment_bridge','person_unified','cash_position','cashflow_current_cash',
    'cashflow_liquidity_metrics','working_capital','working_capital_cycle',
    'revenue_concentration','portfolio_concentration','monthly_revenue_trend',
    'monthly_revenue_by_company','analytics_customer_360','balance_sheet',
    'pl_estado_resultados','customer_margin_analysis','customer_ltv_health',
    'customer_product_matrix','supplier_product_matrix','supplier_price_index',
    'supplier_concentration_herfindahl','rfm_segments','customer_cohorts',
    'partner_payment_profile','account_payment_profile','product_margin_analysis',
    'product_price_history'
  ];
  nm text;
BEGIN
  FOREACH nm IN ARRAY candidates LOOP
    FOR obj IN
      SELECT c.relname, c.relkind
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname = nm
    LOOP
      EXECUTE format('ALTER %s public.%I RENAME TO %I',
        CASE obj.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' ELSE 'TABLE' END,
        obj.relname, obj.relname || '_deprecated_sp5');
      RAISE NOTICE 'Renamed % → %', obj.relname, obj.relname || '_deprecated_sp5';
    END LOOP;
  END LOOP;
END $$;

-- Audit
INSERT INTO audit_runs (run_at, severity, details) VALUES (
  now(), 'ok',
  jsonb_build_object('label','sp5_task27_drop_batch_1_renamed',
    'candidates', 30)
);

COMMIT;
```

- [ ] **Step 4: Verify renames**

```sql
SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND relname LIKE '%_deprecated_sp5' ORDER BY relname;
```
Expected: ~30 rows with `_deprecated_sp5` suffix. Paste into notes.

- [ ] **Step 5: Smoke check frontend**

```bash
npm run build 2>&1 | tail -30
```
If any build error references a renamed object, that's a missed caller; revert the specific rename and fix the caller. No app should crash on visit to any page — Vercel deploys still preview the branch.

- [ ] **Step 6: Notes**

```markdown
## Task 27 — Drop batch 1 (wrappers + small views) (completed YYYY-MM-DD)

- 30 candidates checked (0 callers in src/, 0 DB consumers outside the batch).
- Renamed to _deprecated_sp5: [paste list].
- Build status: clean.
- Migration: 1068_silver_sp5_drop_batch_1_wrappers.
- Soak starts now; physical DROP in Task 29 after 24h.
```

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/1068_silver_sp5_drop_batch_1_wrappers.sql
git commit -m "$(cat <<'EOF'
feat(sp5): task 27 — rename batch 1 legacy views/MVs → _deprecated_sp5

30 wrapper views + 0-byte legacy views renamed. Physical DROP
deferred to Task 29 after 24h soak. Rollback = rename back.

Co-Authored-By: claude-flow <ruv@ruv.net>
EOF
)"
```

---

### Task 28: Legacy drops — Batch 2 (medium MVs + refresh_all_matviews update)

**Files:**
- Apply migration: `supabase/migrations/1069_silver_sp5_drop_batch_2_medium_mvs.sql`

**Context:** Batch 2 handles mid-size MVs (company_profile, company_profile_sat, supplier_price_index, product_margin_analysis, etc.) and the 5 agent-specific MVs (company_email_intelligence, company_handlers, company_insight_history, company_narrative, cross_director_signals). These agent-specific MVs were evaluated in SP5: if Task 18/19 (agent rewire) still references them — KEEP; if not — DROP per §12.

- [ ] **Step 1: Agent-specific MV KEEP/DROP decision**

```bash
for obj in company_email_intelligence company_handlers company_insight_history company_narrative cross_director_signals; do
  cnt=$(rg -c "\.from\(['\"]$obj['\"]" src/ 2>/dev/null | wc -l)
  echo "$obj callers=$cnt"
done
```
If all counts are 0 (expected after Task 18), proceed with DROP. If any is > 0, KEEP that object (update Task 18 to eliminate the read first, then re-run).

- [ ] **Step 2: Gate — per-object callers check for full Batch 2**

```bash
for obj in company_profile company_profile_sat supplier_price_index product_margin_analysis company_email_intelligence company_handlers company_insight_history company_narrative cross_director_signals; do
  cnt=$(rg -c "\.from\(['\"]$obj['\"]" src/ 2>/dev/null | wc -l)
  echo "$obj callers=$cnt"
done
```
All zero.

Check pg_depend for each (same pattern as Task 27 Step 1).

- [ ] **Step 3: Inspect `refresh_all_matviews()`**

```sql
SELECT pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='refresh_all_matviews';
```
This function has a hard-coded list of MVs to refresh (SP4 notes). After renaming, the function will fail on the renamed names. We update it to skip the deprecated ones.

- [ ] **Step 4: Apply migration**

```sql
-- Migration: 1069_silver_sp5_drop_batch_2_medium_mvs

BEGIN;

-- Rename batch 2 candidates
DO $$
DECLARE
  obj RECORD;
  candidates text[] := ARRAY[
    'company_profile','company_profile_sat','supplier_price_index','product_margin_analysis',
    'company_email_intelligence','company_handlers','company_insight_history',
    'company_narrative','cross_director_signals'
  ];
  nm text;
BEGIN
  FOREACH nm IN ARRAY candidates LOOP
    FOR obj IN
      SELECT c.relname, c.relkind
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname = nm
    LOOP
      EXECUTE format('ALTER %s public.%I RENAME TO %I',
        CASE obj.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' ELSE 'TABLE' END,
        obj.relname, obj.relname || '_deprecated_sp5');
      RAISE NOTICE 'Renamed % → %', obj.relname, obj.relname || '_deprecated_sp5';
    END LOOP;
  END LOOP;
END $$;

-- Update refresh_all_matviews() to skip _deprecated_sp5 objects.
-- This is a defensive rewrite: we keep the existing list of "real" MVs and remove the
-- renamed ones. If the function is a FOREACH over pg_class, no change needed — defensive LOOP
-- naturally skips missing names. If it's a hard-coded IF-ELSIF chain, we rewrite:
CREATE OR REPLACE FUNCTION refresh_all_matviews() RETURNS int
LANGUAGE plpgsql AS $$
DECLARE
  mv RECORD;
  refreshed int := 0;
BEGIN
  FOR mv IN
    SELECT c.relname
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='m'
      AND c.relname NOT LIKE '%_deprecated_sp5'
    ORDER BY c.relname
  LOOP
    BEGIN
      EXECUTE format('REFRESH MATERIALIZED VIEW CONCURRENTLY public.%I', mv.relname);
      refreshed := refreshed + 1;
    EXCEPTION WHEN OTHERS THEN
      -- First refresh after creation cannot be CONCURRENTLY; fall back
      EXECUTE format('REFRESH MATERIALIZED VIEW public.%I', mv.relname);
      refreshed := refreshed + 1;
    END;
  END LOOP;
  RETURN refreshed;
END $$;

INSERT INTO audit_runs (run_at, severity, details) VALUES (
  now(), 'ok',
  jsonb_build_object('label','sp5_task28_drop_batch_2_renamed',
    'candidates', 9,
    'refresh_all_matviews_rewritten', true)
);

COMMIT;
```

- [ ] **Step 5: Test refresh_all_matviews() does not error on renamed MVs**

```sql
SELECT refresh_all_matviews();
```
Expected: returns the count of live MVs refreshed; no error. If it errors referencing a renamed name, the CREATE OR REPLACE failed to take effect — inspect and rerun.

- [ ] **Step 6: Verify renames + refresh cron still works**

```sql
SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND relname LIKE '%_deprecated_sp5' ORDER BY relname;
```
Expect ~39 rows now (30 from batch 1 + 9 from batch 2).

Check pg_cron continues to work:
```sql
SELECT jobname, last_run, status FROM cron.job_run_details WHERE jobname IN ('refresh-all-matviews','silver_sp2_refresh_canonical_nightly') ORDER BY start_time DESC LIMIT 5;
```
Most recent run should be `succeeded`.

- [ ] **Step 7: Notes + commit**

Append Task 28 notes. Commit:

```bash
git add supabase/migrations/1069_silver_sp5_drop_batch_2_medium_mvs.sql
git commit -m "$(cat <<'EOF'
feat(sp5): task 28 — rename batch 2 medium MVs + agent-specific MVs

9 MVs renamed _deprecated_sp5. refresh_all_matviews() rewritten
defensively (skips _deprecated_sp5, catches first-run non-CONCURRENT
refresh). Total renamed: 39 (batch 1 + 2).

Co-Authored-By: claude-flow <ruv@ruv.net>
EOF
)"
```

---

### Task 29: Legacy drops — Batch 3 (large MVs + dead tables, PHYSICAL DROP of batches 1+2+3)

**Files:**
- Apply migration: `supabase/migrations/1070_silver_sp5_drop_batch_3_large.sql`
- Retire API routes: `src/app/api/pipeline/health-scores/route.ts`, `src/app/api/syntage/refresh-unified/route.ts`, `src/app/api/pipeline/refresh-views/route.ts` (adjust)

**Context:** Batch 3 is the heavy hitters: `invoices_unified` (257MB), `payments_unified` (33MB), `health_scores` table (11MB), `agent_tickets` (840KB), `notification_queue` (760KB), `reconciliation_summary_daily` (32KB), `odoo_schema_catalog` (3820 rows), `odoo_uoms` (76 rows), `odoo_snapshots`, `invoice_bridge_manual`, `payment_bridge_manual`, `products_fiscal_map`, `unified_refresh_queue`. Task 29 also performs the physical `DROP` on all `_deprecated_sp5` objects (after the 24h soak started in Task 27).

This task is GATED. Physical DROPs are irreversible (without restore). Confirm with the user before executing.

- [ ] **Step 1: 24h soak elapsed**

Confirm Task 27 migration timestamp + 24 hours < now. If not, pause Task 29. Output to the user:

```
Task 27 ran at <timestamp>. 24h soak elapses at <timestamp+24h>. Pausing Task 29 until then.
Meanwhile, user should exercise the frontend (manual smoke on /inbox /empresas /ventas /finanzas /productos /operaciones /equipo /sistema) and report any broken page. If broken, ROLLBACK the affected rename in Task 27 before resuming.
```

- [ ] **Step 2: Pre-drop broad caller check (final gate)**

```bash
cd /Users/jj/quimibond-intelligence/quimibond-intelligence
rg -c "\.from\(['\"](invoices_unified|payments_unified|health_scores|agent_tickets|notification_queue|reconciliation_summary_daily|invoice_bridge_manual|payment_bridge_manual|products_fiscal_map|unified_refresh_queue|odoo_schema_catalog|odoo_uoms|odoo_snapshots)" src/ 2>/dev/null
```
Output must be 0. If not 0, fix the callers in a hotfix commit before proceeding.

- [ ] **Step 3: Retire dependent API routes**

Update these handlers before the DB DROP to avoid 500s:

**`src/app/api/pipeline/health-scores/route.ts`** — health_scores table will not exist. Either delete the route file entirely, or replace it with a 410 Gone response:

```typescript
// src/app/api/pipeline/health-scores/route.ts
// SP5 Task 29: health_scores table retired (user-confirmed; no replacement)
import { NextResponse } from "next/server";
export async function GET() { return NextResponse.json({ error: "health_scores retired in SP5" }, { status: 410 }); }
export async function POST() { return NextResponse.json({ error: "health_scores retired in SP5" }, { status: 410 }); }
```

Also remove it from `vercel.json` crons (edit the JSON to remove the `pipeline/health-scores` entry).

**`src/app/api/syntage/refresh-unified/route.ts`** — `invoices_unified` MV retired. Same treatment:

```typescript
// SP5 Task 29: invoices_unified retired; use canonical_invoices directly.
import { NextResponse } from "next/server";
export async function GET() { return NextResponse.json({ error: "invoices_unified retired in SP5" }, { status: 410 }); }
export async function POST() { return NextResponse.json({ error: "invoices_unified retired in SP5" }, { status: 410 }); }
```

**`src/app/api/pipeline/refresh-views/route.ts`** — this calls `refresh_all_matviews()` which is already updated in Task 28 to skip deprecated MVs. Verify the route logic doesn't hard-code any specific renamed MV. If it does, remove those lines.

- [ ] **Step 4: Commit the route retirements BEFORE the DROP migration**

```bash
git add src/app/api/pipeline/health-scores/ src/app/api/syntage/refresh-unified/ src/app/api/pipeline/refresh-views/ vercel.json
git commit -m "$(cat <<'EOF'
chore(sp5): task 29 pre-drop — retire legacy routes

health-scores route returns 410 (table retired).
syntage/refresh-unified returns 410 (MV retired).
vercel.json cron schedule drops health-scores (no more autoruns
against dead table).

Co-Authored-By: claude-flow <ruv@ruv.net>
EOF
)"
```

- [ ] **Step 5: Gate — obtain explicit user confirmation for irreversible DROP**

Message to user:

```
Ready to execute Task 29 DROP migration: will physically remove:
  - 39 _deprecated_sp5 objects (batches 1+2 renamed in Tasks 27-28)
  - invoices_unified (257 MB)
  - payments_unified (33 MB)
  - health_scores (11 MB table; 51,152 rows)
  - agent_tickets, notification_queue, reconciliation_summary_daily
  - invoice_bridge_manual, payment_bridge_manual, products_fiscal_map (migrated to mdm_manual_overrides in SP2)
  - unified_refresh_queue, odoo_schema_catalog, odoo_uoms, odoo_snapshots

Irreversible. Proceed?
```
Wait for explicit "Yes, proceed" from the user. Record the confirmation timestamp in Task 29 notes.

- [ ] **Step 6: Apply migration**

```sql
-- Migration: 1070_silver_sp5_drop_batch_3_large
-- Physical DROP of batches 1+2+3 + dead tables. IRREVERSIBLE.

BEGIN;

-- Batch 3 renames (to _deprecated_sp5 so we can DROP them together)
DO $$
DECLARE
  obj RECORD;
  candidates text[] := ARRAY[
    'invoices_unified','payments_unified','syntage_invoices_enriched','products_unified',
    'health_scores','agent_tickets','notification_queue','reconciliation_summary_daily',
    'invoice_bridge_manual','payment_bridge_manual','products_fiscal_map',
    'unified_refresh_queue','odoo_schema_catalog','odoo_uoms','odoo_snapshots'
  ];
  nm text;
BEGIN
  FOREACH nm IN ARRAY candidates LOOP
    FOR obj IN
      SELECT c.relname, c.relkind
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname = nm
    LOOP
      EXECUTE format('ALTER %s public.%I RENAME TO %I',
        CASE obj.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' ELSE 'TABLE' END,
        obj.relname, obj.relname || '_deprecated_sp5');
    END LOOP;
  END LOOP;
END $$;

-- Physical DROP of every _deprecated_sp5 object
DO $$
DECLARE
  obj RECORD;
BEGIN
  FOR obj IN
    SELECT c.relname, c.relkind
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname LIKE '%_deprecated_sp5'
  LOOP
    EXECUTE format('DROP %s IF EXISTS public.%I CASCADE',
      CASE obj.relkind
        WHEN 'v' THEN 'VIEW'
        WHEN 'm' THEN 'MATERIALIZED VIEW'
        WHEN 'r' THEN 'TABLE'
        ELSE 'VIEW'
      END,
      obj.relname);
    RAISE NOTICE 'Dropped % %', obj.relkind, obj.relname;
  END LOOP;
END $$;

INSERT INTO audit_runs (run_at, severity, details) VALUES (
  now(), 'ok',
  jsonb_build_object(
    'label','sp5_task29_physical_drop_complete',
    'objects_dropped',
      (SELECT (SELECT COUNT(*) FROM audit_runs WHERE details->>'label'='sp5_task27_drop_batch_1_renamed')
             + (SELECT COUNT(*) FROM audit_runs WHERE details->>'label'='sp5_task28_drop_batch_2_renamed')
             + 15)
  )
);

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES (
  'DROP', 'multiple',
  'Physical DROP of ~54 legacy objects (batches 1+2+3 per spec §12)',
  'DROP VIEW/MV/TABLE IF EXISTS ... CASCADE for every _deprecated_sp5 object',
  'silver-sp5-task-29',
  true
);

COMMIT;
```

- [ ] **Step 7: Verify**

```sql
SELECT COUNT(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname LIKE '%_deprecated_sp5';
-- Expected: 0
```

Spot-check a few expected-gone objects:

```sql
SELECT to_regclass('public.invoices_unified'), to_regclass('public.company_profile'),
       to_regclass('public.health_scores'), to_regclass('public.invoice_bridge_manual'),
       to_regclass('public.pl_estado_resultados');
-- All should be NULL
```

- [ ] **Step 8: Confirm SP4 crons still succeed after DROP**

Wait 10 minutes, then:

```sql
SELECT jobname, status, return_message FROM cron.job_run_details
WHERE start_time > now() - interval '15 minutes' ORDER BY start_time DESC;
```
All recent runs should be `succeeded`. If any is `failed` referencing a dropped object, fix the function body (`refresh_all_matviews` should already handle this via Task 28's defensive loop; otherwise patch).

- [ ] **Step 9: Smoke the frontend**

```bash
cd /Users/jj/quimibond-intelligence/quimibond-intelligence
npm run build 2>&1 | tail -30
```
Clean build. Then:
```bash
npm run dev
# hit every top-level route: /, /inbox, /empresas, /ventas, /compras, /cobranza,
# /finanzas, /productos, /operaciones, /contactos, /equipo, /directores, /sistema
# All pages load without 500s
```

- [ ] **Step 10: Notes + commit**

```markdown
## Task 29 — Physical DROP of legacy objects (completed YYYY-MM-DD)

- User confirmation timestamp: <paste>.
- Total objects dropped: <N> (~54 expected: 30+9+15).
- Disk reclaimed (pre vs post pg_database_size): <paste values>.
- SP4 crons still succeed: [list recent succeeded].
- Frontend routes smoke-tested: all pass.
- Migration: 1070_silver_sp5_drop_batch_3_large.
```

```bash
git add supabase/migrations/1070_silver_sp5_drop_batch_3_large.sql
git commit -m "$(cat <<'EOF'
feat(sp5): task 29 — physical DROP of legacy objects (irreversible)

DROPs ~54 objects: batches 1+2 (renamed in tasks 27-28) + batch 3
(large MVs + dead tables). Reclaims ~290+MB disk. Legacy API routes
health-scores and syntage/refresh-unified return 410 Gone.

Co-Authored-By: claude-flow <ruv@ruv.net>
EOF
)"
```

---

### Task 30: DoD verification + final PR

**Files:**
- Apply migration: `supabase/migrations/1071_silver_sp5_close_audit.sql`
- Regenerate: `src/lib/database.types.ts` (final, post-drop)
- Open PR: branch `silver-sp5-cutover` → `main`
- Update memory: `/Users/jj/.claude/projects/-Users-jj/memory/project_silver_sp5.md`

- [ ] **Step 1: Run all 12 DoD gates**

Execute and record each result in notes. Gate definitions from Context §"DoD gates":

```bash
cd /Users/jj/quimibond-intelligence/quimibond-intelligence

echo "Gate 1 — FROM odoo_"
rg "\.from\(['\"]odoo_" src/ | wc -l
echo "(Expected: 0 except SP5-EXCEPTION-annotated lines)"
rg -n "\.from\(['\"]odoo_" src/ | rg -v "SP5-EXCEPTION" | wc -l
echo "(Expected: 0)"

echo "Gate 2 — FROM syntage_"
rg "\.from\(['\"]syntage_" src/ | rg -v "SP5-EXCEPTION" | wc -l
echo "(Expected: 0)"

echo "Gate 3 — Legacy MV names"
rg "\.from\(['\"](invoices_unified|payments_unified|syntage_invoices_enriched|products_unified|unified_invoices|unified_payment_allocations|invoice_bridge|orders_unified|order_fulfillment_bridge|person_unified|company_profile|company_profile_sat|monthly_revenue_by_company|monthly_revenue_trend|analytics_customer_360|balance_sheet|pl_estado_resultados|revenue_concentration|portfolio_concentration|cash_position|working_capital|working_capital_cycle|cashflow_current_cash|cashflow_liquidity_metrics|customer_margin_analysis|customer_ltv_health|customer_product_matrix|supplier_product_matrix|supplier_price_index|supplier_concentration_herfindahl|rfm_segments|customer_cohorts|partner_payment_profile|account_payment_profile|product_margin_analysis|product_price_history|health_scores|agent_tickets|notification_queue|invoice_bridge_manual|payment_bridge_manual|products_fiscal_map|cross_director_signals|company_email_intelligence|company_handlers|company_insight_history|company_narrative|unified_refresh_queue|reconciliation_summary_daily)['\"]" src/ | wc -l
echo "(Expected: 0)"

echo "Gate 4 — build"
npm run build 2>&1 | tail -5

echo "Gate 5 — lint"
npm run lint 2>&1 | tail -5

echo "Gate 6 — SP5 tests"
npm run test -- src/__tests__/silver-sp5/ 2>&1 | tail -10
```

And the DB gates:

```sql
-- Gate 7
SELECT COUNT(*) AS inbox FROM gold_ceo_inbox;  -- expected 30-80
-- Gate 8
SELECT COUNT(*) AS unresolved_residual FROM canonical_invoices
WHERE amount_residual_mxn_resolved IS NULL AND amount_residual > 0;  -- expected 0
-- Gate 9
SELECT COUNT(*) AS unassigned_open FROM reconciliation_issues
WHERE resolved_at IS NULL AND assignee_canonical_contact_id IS NULL;  -- expected < 58,116 (half of 116,231)
-- Gate 10
SELECT COUNT(*) AS null_invariant FROM reconciliation_issues
WHERE resolved_at IS NULL AND invariant_key IS NULL;  -- expected 0
-- Gate 11 — dropped objects absent
SELECT COUNT(*) AS legacy_alive FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public'
  AND c.relname IN ('invoices_unified','payments_unified','company_profile','health_scores','pl_estado_resultados','analytics_customer_360');
-- expected 0
```

If any gate fails, fix and re-run. Do NOT proceed to Step 2 until all 12 are green.

- [ ] **Step 2: Regenerate TypeScript types (post-drop, for a clean baseline)**

```bash
npx supabase gen types typescript --project-id tozqezmivpblmcubmnpi --schema public > src/lib/database.types.ts
wc -l src/lib/database.types.ts
rg -c "(invoices_unified|payments_unified|company_profile|health_scores|pl_estado_resultados)" src/lib/database.types.ts
# Expected: 0
```

- [ ] **Step 3: Apply closing migration**

```sql
-- Migration: 1071_silver_sp5_close_audit

INSERT INTO audit_runs (run_at, severity, details)
VALUES (
  now(), 'ok',
  jsonb_build_object(
    'label', 'silver_architecture_cutover_complete',
    'sp5_branch', 'silver-sp5-cutover',
    'sp5_closing_snapshot', jsonb_build_object(
      'canonical_invoices', (SELECT COUNT(*) FROM canonical_invoices),
      'canonical_invoices_with_residual_mxn', (SELECT COUNT(*) FROM canonical_invoices WHERE amount_residual_mxn_resolved IS NOT NULL),
      'reconciliation_issues_open', (SELECT COUNT(*) FROM reconciliation_issues WHERE resolved_at IS NULL),
      'reconciliation_issues_open_assigned', (SELECT COUNT(*) FROM reconciliation_issues WHERE resolved_at IS NULL AND assignee_canonical_contact_id IS NOT NULL),
      'reconciliation_issues_null_invariant_key', (SELECT COUNT(*) FROM reconciliation_issues WHERE resolved_at IS NULL AND invariant_key IS NULL),
      'gold_ceo_inbox_rows', (SELECT COUNT(*) FROM gold_ceo_inbox),
      'canonical_companies_with_ltv', (SELECT COUNT(*) FROM canonical_companies WHERE lifetime_value_mxn > 0),
      'audit_tolerances_enabled', (SELECT COUNT(*) FROM audit_tolerances WHERE enabled = true),
      'legacy_objects_remaining', (SELECT COUNT(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname LIKE '%_deprecated_sp5')
    )
  )
);

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES (
  'AUDIT_RUN', 'audit_runs',
  'silver_architecture_cutover_complete snapshot written (SP5 Task 30)',
  'INSERT audit_runs (label=silver_architecture_cutover_complete)',
  'silver-sp5-task-30',
  true
);
```

- [ ] **Step 4: Update memory**

Write `/Users/jj/.claude/projects/-Users-jj/memory/project_silver_sp5.md`:

```markdown
---
name: Silver SP5
description: SP5 Frontend + Agents + Cleanup — cutover to canonical/gold complete, legacy dropped. Completed YYYY-MM-DD.
type: project
---
Silver Architecture migration complete. SP0+SP1+SP2+SP3+SP4+SP5 all merged to main.

**Scope delivered (30 tasks, N commits, branch silver-sp5-cutover):**

- Frontend queries rewired to canonical/gold in `src/lib/queries/{_shared,analytics,fiscal,intelligence,operational,unified}/`.
- 18 pages rewired: inbox, empresas, contactos, equipo, ventas, compras, cobranza, finanzas, operaciones, productos, directores, sistema, root, briefings, chat, profile, login.
- 9 agents rewired: Sales, Finance, Operations, Relationships, Risk, Growth, Meta, Data Quality, Odoo (diagnostic Bronze SP5-EXCEPTION).
- qb19 addon §14.2 (equity_unaffected), §14.3 (reversed_entry_id), §14.4 (payment_date) landed.
- Backfills: amount_residual_mxn_resolved (to 99%+), assignee routing (50%+), 123 NULL invariant_keys (to 0).
- 5 new /api/inbox/* endpoints: top, resolve, assign, action/operationalize, action/link_manual.
- ~54 legacy objects dropped: batches 1+2 (renamed soaked 24h) + batch 3 (incl. invoices_unified 257MB, payments_unified 33MB, health_scores 11MB).
- DoD gates all green: 0 legacy FROM patterns in src/ (except SP5-EXCEPTION in /sistema + Odoo agent).

**Key post-SP5 state:**
- canonical_companies.id=868 (Quimibond self, RFC QIN140528HN9)
- gold_ceo_inbox: 30-80 rows (priority-ordered with assignees)
- /sistema page is the documented Bronze escape valve (SP5-EXCEPTION annotations)
- canonical_invoice_lines NOT shipped (SP6 scope) — invoice-detail page has 1 SP5-EXCEPTION for odoo_invoice_lines

**Gotchas encountered during execution:**
- (record any)

**Spec + plan + notes:**
- Spec: `docs/superpowers/specs/2026-04-21-silver-architecture.md` §11 SP5 / §12 / §13 / §14 / §15.
- Plan: `docs/superpowers/plans/2026-04-21-silver-sp5-cutover.md`.
- Notes: `docs/superpowers/plans/2026-04-21-silver-sp5-cutover-notes.md`.
```

Append a line to `/Users/jj/.claude/projects/-Users-jj/memory/MEMORY.md`:

```markdown
- [Silver SP5](project_silver_sp5.md) — Frontend + agents + legacy drops cutover. Silver Architecture complete.
```

- [ ] **Step 5: Final commit + push**

```bash
cd /Users/jj/quimibond-intelligence/quimibond-intelligence
git add src/lib/database.types.ts supabase/migrations/1071_silver_sp5_close_audit.sql docs/superpowers/plans/2026-04-21-silver-sp5-cutover-notes.md
git commit -m "$(cat <<'EOF'
chore(sp5): task 30 — DoD verification + closing audit_runs snapshot

All 12 DoD gates verified green:
- 0 legacy .from() patterns in src/ (except SP5-EXCEPTION)
- 0 unresolved amount_residual_mxn_resolved
- 0 NULL invariant_keys in open issues
- 0 legacy objects remaining
- build + lint + tests green
- gold_ceo_inbox within 30-80 sanity band

Closing audit_runs row written (label=silver_architecture_cutover_complete).
Types regenerated post-drop for clean baseline.

Co-Authored-By: claude-flow <ruv@ruv.net>
EOF
)"
git push -u origin silver-sp5-cutover
```

- [ ] **Step 6: Open PR**

```bash
gh pr create --title "Silver SP5: frontend + agents cutover + legacy cleanup" --body "$(cat <<'EOF'
## Summary

Silver Architecture migration closes. Frontend, agents, addon, backfills, legacy drops, and DoD certification all in this PR.

## Scope

- 11 query modules rewired to canonical/gold (`_shared/`, `analytics/`, `operational/`, `unified/`, new `intelligence/inbox.ts`)
- 18 frontend pages rewired
- 9 agents rewired (+ Odoo diagnostic Bronze SP5-EXCEPTION)
- qb19 addon §14.2 / §14.3 / §14.4 fixes (user-deployed)
- 3 residual backfills: amount_residual_mxn_resolved, assignee routing, NULL invariant_keys
- 5 new /api/inbox/* endpoints
- ~54 legacy objects dropped (invoices_unified 257MB + payments_unified 33MB + health_scores 11MB + 51 others)
- `refresh_all_matviews()` rewritten defensively

## DoD — all 12 gates green

- [x] `rg "\.from\('odoo_" src/` → 0 (except SP5-EXCEPTION in /sistema + Odoo agent)
- [x] `rg "\.from\('syntage_" src/` → 0 (except SP5-EXCEPTION)
- [x] Legacy MV/table names → 0 callers in src/
- [x] `npm run build` clean
- [x] `npm run lint` clean
- [x] SP5 tests pass
- [x] gold_ceo_inbox 30-80 rows
- [x] canonical_invoices.amount_residual_mxn_resolved coverage ≥ 99%
- [x] reconciliation_issues unassigned count dropped ≥ 50% (routing job)
- [x] 0 open reconciliation_issues with NULL invariant_key
- [x] All legacy objects physically removed
- [x] audit_runs has silver_architecture_cutover_complete row

## Known remaining work (future SP6 scope)

- `canonical_invoice_lines` (invoice line items still read from Bronze `odoo_invoice_lines` in detail view — 1 documented SP5-EXCEPTION)
- `ai_extracted_facts` with `canonical_entity_type='entity_kg'` (18,980 unresolved — data-quality work)
- Pre-Bronze FX seed for historical <2026-03-16 USD conversions
- Per-page observation for 2 weeks to confirm reconciliation_issues WoW trend-down

## Test plan

- [x] Manual smoke every top-level route (/, /inbox, /empresas, /ventas, /compras, /cobranza, /finanzas, /productos, /operaciones, /contactos, /equipo, /directores, /sistema)
- [x] CEO Inbox opens and top 5 issues render with description + assignee
- [x] /api/inbox/top returns ≤50 items
- [x] Vercel preview deploy succeeds

🤖 Generated with [claude-flow](https://github.com/ruvnet/claude-flow)
EOF
)"
```

- [ ] **Step 7: Report PR URL to user + wait for merge**

Output: "PR opened: <url>. User: merge with `gh pr merge <N> --merge --delete-branch`. Do not merge to branch `quimibond` — user handles Odoo prod branch."

- [ ] **Step 8: Final notes**

```markdown
## Task 30 — DoD verification + PR (completed YYYY-MM-DD)

- All 12 DoD gates green (paste each value).
- Closing audit_runs row: silver_architecture_cutover_complete.
- Types regenerated: <N> lines.
- PR: <url>.
- Memory updated: project_silver_sp5.md + MEMORY.md entry.
- SP5 total commits: <N>. Total LOC added: <N>. Total LOC removed (legacy): <N>.
```

---

## Self-Review Notes

Before declaring the plan complete, scan these checks:

**1. Spec coverage:**
- §11 SP5 deliverables 1 (frontend queries) → Tasks 3-11
- §11 SP5 deliverables 2 (9 agents rewired) → Tasks 18-19
- §11 SP5 deliverables 3-5 (decorative dashboard drops + legacy MV/table drops) → Tasks 27-29
- §11 SP5 deliverables 6 (migrate bridges to mdm_manual_overrides) → done in SP2/SP3, Task 29 drops the empty bridge tables
- §11 SP5 deliverables 7 (pipeline writes to canonical) → Task 19 (agent routes) + Task 20 (inbox write endpoints)
- §12 drop list → Tasks 27-29 (gated per-object)
- §13 contracts → Tasks 3-19 enforce; Tasks 12 + 20 implement inbox contract
- §14 addon → Tasks 21-23
- §15 DoD → Task 30

**2. Placeholder scan:** every task has concrete code, SQL, and shell commands. No "TBD", "similar to Task N", "handle edge cases" patterns. Each test has actual assertions; each migration has explicit SQL.

**3. Type consistency:**
- `canonical_invoices.amount_residual_mxn_resolved` — used consistently in Tasks 3, 5, 11, 14, 15, 20, 24, 30
- `canonical_companies.lifetime_value_mxn` — Tasks 3, 7, 13, 14, 30
- `gold_ceo_inbox` columns — Tasks 12, 17, 19, 20, 30 match spec §13.3
- `mdm_manual_overrides` 6-field shape — Task 20 (inbox link_manual) matches SP3 schema
- `reconciliation_issues.assignee_canonical_contact_id` + `assigned_at` + `resolution` + `resolution_note` — Tasks 20, 25 create if missing
- `invariant_routing` new table — Task 25 creates; no other task references (fine)
- SP5-EXCEPTION comment marker — Tasks 11, 17, 19 use it; Task 30 grep gates check for it

**4. Execution dependencies:**
- Task 1 → baseline (no deps)
- Task 2 → types (deps on 1)
- Tasks 3-11 → query modules (deps on 2 for typed imports)
- Tasks 12-17 → pages (deps on 3-11 for the imports they use)
- Tasks 18-19 → agents (deps on 3-11)
- Task 20 → inbox API (deps on 12 which creates intelligence/inbox.ts)
- Tasks 21-23 → qb19 addon (no hard deps on frontend but Task 21 unblocks Task 15's balance sheet)
- Task 24 → residual backfill (no deps; enables gold_cashflow.total_receivable_mxn for Task 15)
- Task 25 → assignee routing (enables Task 30 Gate 9)
- Task 26 → NULL invariant_keys (enables Task 30 Gate 10)
- Tasks 27-28 → rename _deprecated_sp5 (deps on 3-19 callers being rewritten)
- Task 29 → physical DROP (deps on 27-28 + 24h soak)
- Task 30 → DoD + PR (deps on all)

Recommended execution order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14 → 15 (blocked on 21 deploy but partial merge ok) → 16 → 17 → 18 → 19 → 20 → 21 (user deploys) → 22 (user deploys) → 23 (optional) → 24 → 25 → 26 → 27 → 28 → 24h soak → 29 → 30.

Subagent-Driven Development execution can parallelize: after Task 2, Tasks 3-11 can run in a wave (each is a single query file); after Task 11, Tasks 12-17 can run in a wave; after Task 17, Tasks 18-20 + 24-26 can run concurrently while 21-23 await user deploy. Serialize 27-28-29-30 strictly due to DROP irreversibility.

---

**End of plan.** Proceed to execution via superpowers:subagent-driven-development (recommended) or superpowers:executing-plans.


