# Silver SP1 — Audit + Prune Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auditar concretamente los 38+ drop candidates del Silver Architecture spec §12 (15 views + ~25 MVs + 13 tables + pages/routes), categorizar cada uno (keep / migrate-first / drop / re-evaluate) con evidencia dual (frontend grep + DB pg_depend), y ejecutar los drops confirmados por batch gated con OK del usuario. Entregar base limpia y documentada para SP2 sin construir canonical_* tables todavía.

**Architecture:** Branch `silver-sp1-audit-prune` off `main`. Una migración SQL por batch de drops (agrupados por tipo: views analytics/wrappers, MVs sin callers, tablas muertas, frontend pages/routes). Un único `audit-notes.md` con evidencia + categorización completa, commiteado antes de cualquier drop. Cada drop batch es su propia commit con BEGIN/COMMIT, `DROP X IF EXISTS` y `INSERT INTO schema_changes`. Final task reescribe `refresh_all_matviews()` para reflejar el set post-drops.

**Tech Stack:** PostgreSQL 15 (Supabase `tozqezmivpblmcubmnpi`), Next.js 15 frontend (TypeScript), `rg`/Grep tool para audit de callers, `mcp__claude_ai_Supabase__execute_sql` + `mcp__claude_ai_Supabase__apply_migration` para DB.

**Spec:** `/Users/jj/quimibond-intelligence/quimibond-intelligence/docs/superpowers/specs/2026-04-21-silver-architecture.md` §11 SP1 + §12 (drop list) + §14 (addon fixes — informational, not in SP1 scope) + §15 (global DoD).

**Prereqs:**
- SP0 addon fix (`fix-build-cfdi-map` branch, §14.1 patch) committed — merge a `quimibond` + `odoo-update` es manual step del usuario (no bloquea SP1 audit; bloqueará SP2).
- Canonical_* tables NO existen todavía (correcto para SP1; se construyen en SP2-SP4).
- Fases previas mergeadas a `main`: Fase 0, 1, 2, 2.5, 2.5.1, 2.6.
- Spec commiteada en branch `silver-architecture-spec` (7e95839).

**Out of scope (explícito):**
- Ninguna tabla canonical_* se crea aquí (SP2+).
- No se toca el addon qb19 (SP0 ya cubre §14.1; §14.2-14.5 quedan para SP2/SP4).
- `monthly_revenue_trend` vs `monthly_revenue_by_company` consolidation: **deferred** a SP4 gold (spec decisión firmada 2026-04-21).
- `v_audit_*` (21 views monitoring Fase 0-2.6): **KEEP** (spec §12.1 explicit exception).

---

## Pre-audit state (verificado 2026-04-21)

Queries ejecutadas contra `tozqezmivpblmcubmnpi` al 2026-04-21, pre-SP1:

| Dimensión | Valor actual | Target post-SP1 |
|---|---|---|
| `pg_views` schema=public | **77** (incluye 21 `v_audit_*`) | 62-65 (drop esperado ~12-15) |
| `pg_matviews` schema=public | **39** | 28-32 (drop esperado ~7-11; rest defer SP5) |
| `pg_tables` schema=public | **77** | 68-73 (drop esperado 4-9 tablas muertas) |
| `pg_proc` schema=public | **312** | 311-312 (solo actualizar `refresh_all_matviews`) |

**Candidatos confirmados presentes (spec §12):**

Views (16 de 17 listadas en spec §12.1 — `portfolio_concentration` es MV, no view):
- `unified_invoices`, `unified_payment_allocations`, `invoice_bridge`, `orders_unified`, `order_fulfillment_bridge`, `person_unified`
- `cash_position`, `working_capital`, `working_capital_cycle`, `cashflow_current_cash`, `cashflow_liquidity_metrics`
- `monthly_revenue_trend` (deferred), `analytics_customer_360`
- `balance_sheet`, `pl_estado_resultados`, `revenue_concentration`

MVs confirmadas (38 presentes, 1 faltante confirmado):
- Drop-candidate large: `invoices_unified` (66 MB), `payments_unified` (25 MB), `syntage_invoices_enriched` (49 MB), `products_unified` (1032 kB), `company_profile` (1128 kB), `company_profile_sat` (256 kB), `monthly_revenue_by_company` (1024 kB)
- Drop-or-fold candidates: `product_margin_analysis`, `customer_margin_analysis`, `customer_ltv_health`, `customer_product_matrix`, `supplier_product_matrix`, `supplier_price_index`, `supplier_concentration_herfindahl`, `partner_payment_profile`, `account_payment_profile`, `portfolio_concentration`, `rfm_segments`, `customer_cohorts`
- Agent-specific (decide SP5): `company_email_intelligence`, `company_handlers`, `company_insight_history`, `company_narrative`, `cross_director_signals`
- Operational KEEP + rewire (SP4 scope): `inventory_velocity`, `dead_stock_analysis`, `cashflow_projection`, `accounting_anomalies`, `ar_aging_detail`, `journal_flow_profile`, `ops_delivery_health_weekly`, `purchase_price_intelligence`, `product_real_cost`, `product_seasonality`, `payment_predictions`, `client_reorder_predictions`, `bom_duplicate_components`, `product_price_history` (rebuild SP4)
- `stockout_queue` = view (not MV). KEEP (§12.2 line).

Tablas muertas candidatas (spec §12.3, counts vivos):
- `agent_tickets` = **1,958 rows** (DROP CONFIRMED user 2026-04-21)
- `notification_queue` = **815 rows** (DROP CONFIRMED user 2026-04-21)
- `health_scores` = **52,152 rows** (DROP CONFIRMED user 2026-04-21)
- `unified_refresh_queue` = 0 rows (reconsider or drop)
- `reconciliation_summary_daily` = 2 rows (stale)
- `odoo_schema_catalog` = 3,820 rows (dead-pixel)
- `odoo_uoms` = 76 rows (dead-pixel)
- `odoo_snapshots` = 21,783 rows (replaced by canonical_*)
- `odoo_invoices_archive_pre_dedup` = 5,321 rows (archive)
- `odoo_invoices_archive_dup_cfdi_uuid_2026_04_20` = 5,321 rows (archive)
- `invoice_bridge_manual` = 0 rows (migrate later SP2; SKIP in SP1)
- `payment_bridge_manual` = 0 rows (migrate later SP2; SKIP in SP1)
- `products_fiscal_map` = 20 rows (migrate later SP3; SKIP in SP1)

Frontend páginas candidatas (spec §12.4, gated):
- `/dashboard` — decorative? evaluate
- `/emails` top-nav standalone — merged to /companies/[id] and /contacts/[id] tabs
- "agent status" decorative dashboards

API routes candidatas (spec §12.5):
- `/api/pipeline/reconcile` (cron-only, superseded by engine SP4)
- `/api/pipeline/embeddings` (evaluate)
- `/api/agents/*` con 0 traffic 30d

**State other:**
- `refresh_all_matviews()` actual contiene **34 MVs** (última línea comentada: `-- Fase 2.6: nueva MV fiscal goldmine` + `syntage_invoices_enriched`). Post-SP1 se reescribe para reflejar set sobreviviente.
- `analytics_*` survivors post-Fase 2.5.1/2.6: solo queda `analytics_customer_360` (los 4 wrappers analytics_fiscal_* ya dropeados en Fase 2.5.1; los 4 analytics_customer_* dropeados en Fase 2.6 previa task).
- `schema_changes` columnas: `(id, change_type, table_name, description, sql_executed, triggered_by, success, error_message, created_at)`.
- `audit_runs` columnas: `(id, run_id, run_at, source, model, invariant_key, bucket_key, odoo_value, supabase_value, diff, severity, date_from, date_to, details)`.

**Supuestos cerrados (no reconfirmar):**
- Capa unified (invoices_unified, payments_unified, company_profile*) sigue consumida por frontend hoy (se drop en SP5, no en SP1).
- Branch plan commits van a `silver-architecture-spec` (misma rama que la spec, frontend repo).

---

## File structure

### Branch `silver-sp1-audit-prune` off `main` en `/Users/jj/quimibond-intelligence/quimibond-intelligence`

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `docs/superpowers/plans/2026-04-21-silver-sp1-audit-prune.md` | THIS FILE | Plan (commit en `silver-architecture-spec` pre-kickoff) |
| `docs/superpowers/plans/2026-04-21-silver-sp1-audit-notes.md` | Create | Inventory completo con evidencia per-item (frontend callers + DB deps + categorización + user signoff log) |
| `supabase/migrations/20260422_sp1_00_baseline.sql` | Create | Snapshot baseline en `audit_runs` (pre_silver_baseline) |
| `supabase/migrations/20260422_sp1_01_drop_unused_views.sql` | Create (gated) | Batch 1: views sin callers y/o wrappers redundantes |
| `supabase/migrations/20260422_sp1_02_drop_dead_mvs.sql` | Create (gated) | Batch 2: MVs refreshed pero sin consumer (scope SP1 only — MVs que no bloquean SP2/3) |
| `supabase/migrations/20260422_sp1_03_drop_abandoned_tables.sql` | Create (gated) | Batch 3: `agent_tickets`, `notification_queue`, `health_scores`, `unified_refresh_queue`, `reconciliation_summary_daily`, `odoo_schema_catalog`, `odoo_uoms`, `odoo_snapshots`, `odoo_invoices_archive_*` (confirmed) |
| `supabase/migrations/20260422_sp1_04_update_refresh_all_matviews.sql` | Create | Reescribir body `refresh_all_matviews()` removiendo MVs dropeadas |
| `supabase/migrations/20260422_sp1_05_drop_frontend_deadcode.sql` | Create (optional, gated) | Solo si Batch 4 incluye DB-side cleanup adicional post-frontend drops |
| `supabase/migrations/20260422_sp1_99_final.sql` | Create | Snapshot cierre en `audit_runs` (sp1_audit_prune_done) |
| `src/app/emails/**`, `src/app/<decorative>/**` | Delete (gated) | Pages confirmadas drop tras Task 3 user OK |
| `src/app/api/pipeline/reconcile/route.ts` | Delete (gated) | Si user OK post-audit |
| `src/app/api/pipeline/embeddings/route.ts` | Delete (gated) | Si user OK post-audit |
| `vercel.json` | Modify (gated) | Remover `crons` entries que invocan routes dropped |
| `CLAUDE.md` (frontend) | Modify | Anotar objetos dropeados + refresh_all_matviews nuevo body |

---

## Pre-flight

### Task 0: Baseline snapshot + branch + audit-notes skeleton

**Purpose.** Establecer la base comparativa post-SP1, crear la rama de trabajo y el documento de evidencia que acompaña todo el sub-proyecto.

**Files:**
- Create: `docs/superpowers/plans/2026-04-21-silver-sp1-audit-notes.md`
- Create: `supabase/migrations/20260422_sp1_00_baseline.sql`

**Steps:**

- [ ] **Step 1: Crear branch off `main`**

```bash
cd /Users/jj/quimibond-intelligence/quimibond-intelligence
git fetch origin main
git checkout main
git pull origin main --ff-only
git checkout -b silver-sp1-audit-prune
git push -u origin silver-sp1-audit-prune
```

- [ ] **Step 2: Query baseline global via `mcp__claude_ai_Supabase__execute_sql` (project_id=`tozqezmivpblmcubmnpi`)**

```sql
SELECT
  (SELECT count(*) FROM pg_views WHERE schemaname='public') AS total_views,
  (SELECT count(*) FROM pg_matviews WHERE schemaname='public') AS total_mvs,
  (SELECT count(*) FROM pg_tables WHERE schemaname='public') AS total_tables,
  (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace) AS total_fns,
  (SELECT count(*) FROM pg_views WHERE schemaname='public' AND viewname LIKE 'v_audit_%') AS v_audit_count;
```

Expected (si nada ha cambiado vs 2026-04-21): `total_views=77, total_mvs=39, total_tables=77, total_fns=312, v_audit_count=21`. Capturar exact values in audit-notes §Antes.

- [ ] **Step 3: Query existence + row counts de candidatos (§12)**

```sql
-- Views candidatos (spec §12.1)
SELECT 'view' AS kind, viewname AS obj
FROM pg_views
WHERE schemaname='public'
  AND viewname IN (
    'unified_invoices','unified_payment_allocations','invoice_bridge',
    'orders_unified','order_fulfillment_bridge','person_unified',
    'cash_position','working_capital','working_capital_cycle',
    'cashflow_current_cash','cashflow_liquidity_metrics',
    'monthly_revenue_trend','analytics_customer_360',
    'balance_sheet','pl_estado_resultados','revenue_concentration'
  )
ORDER BY obj;

-- MVs candidatas (spec §12.2)
SELECT 'mv' AS kind, matviewname AS obj, pg_size_pretty(pg_relation_size(format('public.%I', matviewname)::regclass)) AS sz
FROM pg_matviews
WHERE schemaname='public'
  AND matviewname IN (
    'invoices_unified','payments_unified','syntage_invoices_enriched',
    'products_unified','product_price_history','company_profile','company_profile_sat',
    'monthly_revenue_by_company','product_margin_analysis','customer_margin_analysis',
    'customer_ltv_health','customer_product_matrix','supplier_product_matrix',
    'supplier_price_index','supplier_concentration_herfindahl','partner_payment_profile',
    'account_payment_profile','portfolio_concentration','rfm_segments','customer_cohorts',
    'company_email_intelligence','company_handlers','company_insight_history',
    'company_narrative','cross_director_signals',
    'inventory_velocity','dead_stock_analysis','cashflow_projection','accounting_anomalies',
    'ar_aging_detail','journal_flow_profile','ops_delivery_health_weekly',
    'purchase_price_intelligence','product_real_cost','product_seasonality',
    'payment_predictions','client_reorder_predictions','bom_duplicate_components'
  )
ORDER BY obj;

-- Tablas candidatas (spec §12.3) — presencia + row count
SELECT 'agent_tickets' AS t, count(*) AS n FROM agent_tickets
UNION ALL SELECT 'notification_queue', count(*) FROM notification_queue
UNION ALL SELECT 'health_scores', count(*) FROM health_scores
UNION ALL SELECT 'unified_refresh_queue', count(*) FROM unified_refresh_queue
UNION ALL SELECT 'reconciliation_summary_daily', count(*) FROM reconciliation_summary_daily
UNION ALL SELECT 'odoo_schema_catalog', count(*) FROM odoo_schema_catalog
UNION ALL SELECT 'odoo_uoms', count(*) FROM odoo_uoms
UNION ALL SELECT 'odoo_snapshots', count(*) FROM odoo_snapshots
UNION ALL SELECT 'odoo_invoices_archive_pre_dedup', count(*) FROM odoo_invoices_archive_pre_dedup
UNION ALL SELECT 'odoo_invoices_archive_dup_cfdi_uuid_2026_04_20', count(*) FROM odoo_invoices_archive_dup_cfdi_uuid_2026_04_20
ORDER BY t;
```

Pegar los 3 outputs en `audit-notes.md` bajo `## Antes` con header y la fecha `2026-04-21`.

- [ ] **Step 4: Escribir migration `20260422_sp1_00_baseline.sql`**

`supabase/migrations/20260422_sp1_00_baseline.sql`:

```sql
-- Silver SP1 baseline: snapshot pre-audit
-- Spec: docs/superpowers/specs/2026-04-21-silver-architecture.md §11 SP1
BEGIN;

INSERT INTO public.audit_runs (run_id, invariant_key, bucket_key, severity, source, model, details, run_at)
SELECT
  gen_random_uuid(),
  'sp1_pre_silver_baseline',
  'sp1',
  'ok',
  'supabase',
  'sp1_audit_prune',
  jsonb_build_object(
    'total_views',   (SELECT count(*) FROM pg_views    WHERE schemaname='public'),
    'total_mvs',     (SELECT count(*) FROM pg_matviews WHERE schemaname='public'),
    'total_tables',  (SELECT count(*) FROM pg_tables   WHERE schemaname='public'),
    'total_fns',     (SELECT count(*) FROM pg_proc     WHERE pronamespace='public'::regnamespace),
    'v_audit_count', (SELECT count(*) FROM pg_views    WHERE schemaname='public' AND viewname LIKE 'v_audit_%'),
    'drop_candidates_views', (
      SELECT count(*) FROM pg_views WHERE schemaname='public' AND viewname IN (
        'unified_invoices','unified_payment_allocations','invoice_bridge',
        'orders_unified','order_fulfillment_bridge','person_unified',
        'cash_position','working_capital','working_capital_cycle',
        'cashflow_current_cash','cashflow_liquidity_metrics',
        'monthly_revenue_trend','analytics_customer_360',
        'balance_sheet','pl_estado_resultados','revenue_concentration'
      )
    ),
    'drop_candidates_mvs', (
      SELECT count(*) FROM pg_matviews WHERE schemaname='public' AND matviewname IN (
        'invoices_unified','payments_unified','syntage_invoices_enriched',
        'products_unified','product_price_history','company_profile','company_profile_sat',
        'monthly_revenue_by_company','product_margin_analysis','customer_margin_analysis',
        'customer_ltv_health','customer_product_matrix','supplier_product_matrix',
        'supplier_price_index','supplier_concentration_herfindahl','partner_payment_profile',
        'account_payment_profile','portfolio_concentration','rfm_segments','customer_cohorts',
        'company_email_intelligence','company_handlers','company_insight_history',
        'company_narrative','cross_director_signals'
      )
    ),
    'drop_candidates_tables_confirmed', jsonb_build_object(
      'agent_tickets',        (SELECT count(*) FROM agent_tickets),
      'notification_queue',   (SELECT count(*) FROM notification_queue),
      'health_scores',        (SELECT count(*) FROM health_scores),
      'unified_refresh_queue',(SELECT count(*) FROM unified_refresh_queue),
      'reconciliation_summary_daily', (SELECT count(*) FROM reconciliation_summary_daily),
      'odoo_schema_catalog',  (SELECT count(*) FROM odoo_schema_catalog),
      'odoo_uoms',            (SELECT count(*) FROM odoo_uoms),
      'odoo_snapshots',       (SELECT count(*) FROM odoo_snapshots),
      'odoo_invoices_archive_pre_dedup', (SELECT count(*) FROM odoo_invoices_archive_pre_dedup),
      'odoo_invoices_archive_dup_cfdi_uuid_2026_04_20', (SELECT count(*) FROM odoo_invoices_archive_dup_cfdi_uuid_2026_04_20)
    ),
    'spec_version', '2026-04-21',
    'plan_version', '2026-04-21-silver-sp1-audit-prune.md'
  ),
  now();

COMMIT;
```

Ejecutar via `mcp__claude_ai_Supabase__apply_migration(name='20260422_sp1_00_baseline', query=<above>)`. Expected: `INSERT 0 1`.

- [ ] **Step 5: Crear `audit-notes.md` con skeleton**

`docs/superpowers/plans/2026-04-21-silver-sp1-audit-notes.md`:

```markdown
# Silver SP1 — Audit + Prune Notes

**Plan:** `docs/superpowers/plans/2026-04-21-silver-sp1-audit-prune.md`
**Spec:** `docs/superpowers/specs/2026-04-21-silver-architecture.md` §11 SP1 + §12
**Project:** `tozqezmivpblmcubmnpi`
**Branch:** `silver-sp1-audit-prune`
**Started:** 2026-04-22

---

## Antes (baseline 2026-04-22)

<INSERT 3 outputs de Task 0 Step 2 + Step 3 aquí>

---

## Fase A — Audit evidence

### Frontend caller audit (Task 1)

| # | Object | Type | Callers (file:line) | Notes |
|---|---|---|---|---|

### DB dependency audit (Task 2)

| # | Object | Type | DB deps (kind:name) | Function refs (name) | Notes |
|---|---|---|---|---|---|

### Categorization decisions (Task 3)

| # | Object | Type | Frontend callers | DB deps | Category | Evidence | User signoff |
|---|---|---|---|---|---|---|---|

Categories: `DROP CONFIRMED` | `MIGRATE FIRST` | `KEEP` | `RE-EVALUATE`.

---

## Fase B — Drops ejecutados

### Batch 1 — Unused views (Task 4)
<fill post-execution: migration SHA, schema_changes insert, post-count>

### Batch 2 — MVs sin callers (Task 5)
<fill post-execution>

### Batch 3 — Abandoned tables (Task 6)
<fill post-execution>

### Batch 4 — Frontend pages + API routes (Task 7)
<fill post-execution>

### refresh_all_matviews cleanup (Task 8)
<fill post-execution: function body diff, new MV count>

---

## Después (post-SP1)

<INSERT final snapshot in Task 9>

## User signoff log

| Batch | Fecha | Confirmación textual del usuario |
|---|---|---|
```

- [ ] **Step 6: Commit baseline**

```bash
cd /Users/jj/quimibond-intelligence/quimibond-intelligence
git add supabase/migrations/20260422_sp1_00_baseline.sql \
        docs/superpowers/plans/2026-04-21-silver-sp1-audit-notes.md
git commit -m "docs(sp1): baseline snapshot + audit-notes skeleton

Silver Architecture SP1 kickoff. Baseline captured in audit_runs
(invariant_key=sp1_pre_silver_baseline). Audit-notes skeleton ready
to receive per-candidate evidence in Tasks 1-3."
git push
```

**Acceptance.** `git log --oneline -1` muestra commit. `SELECT * FROM audit_runs WHERE invariant_key='sp1_pre_silver_baseline' ORDER BY run_at DESC LIMIT 1` retorna 1 row con todos los keys del jsonb poblados.

---

## Fase A — Audit (read-only, build complete evidence)

**Principio.** Fase A es 100 % read-only. No DROP, no ALTER, no INSERT en prod schema. Solo `INSERT INTO audit_runs` (Task 0 ya hecho) y commits de markdown en el repo. Todos los drops ocurren en Fase B gated.

### Task 1: Frontend caller audit — views, MVs, tables, functions

**Purpose.** Construir evidencia concreta de qué objetos tienen (o no tienen) callers en `src/` + `vercel.json` + addon. Base para categorización en Task 3.

**Method.** Un `rg` call por tipo de objeto con patrones `|`-joined para maximizar eficiencia. Salida recortada (file:line + contexto breve) a `audit-notes.md`.

**Files:**
- Modify: `docs/superpowers/plans/2026-04-21-silver-sp1-audit-notes.md` (section Frontend caller audit)

**Steps:**

- [ ] **Step 1: Grep views (16 candidates)**

```bash
cd /Users/jj/quimibond-intelligence/quimibond-intelligence
rg -n --type-add 'ts:*.{ts,tsx,js,jsx,mjs}' -tts -tjson \
  -e 'unified_invoices|unified_payment_allocations|invoice_bridge|orders_unified|order_fulfillment_bridge|person_unified|cash_position|working_capital|working_capital_cycle|cashflow_current_cash|cashflow_liquidity_metrics|monthly_revenue_trend|analytics_customer_360|balance_sheet|pl_estado_resultados|revenue_concentration' \
  src app vercel.json 2>/dev/null | sort
```

Also run same pattern against `/Users/jj/addons/quimibond_intelligence/` read-only (addon shouldn't reference views but confirm):

```bash
rg -n -e 'unified_invoices|unified_payment_allocations|invoice_bridge|orders_unified|order_fulfillment_bridge|person_unified|cash_position|working_capital|working_capital_cycle|cashflow_current_cash|cashflow_liquidity_metrics|monthly_revenue_trend|analytics_customer_360|balance_sheet|pl_estado_resultados|revenue_concentration' \
  /Users/jj/addons/quimibond_intelligence/ 2>/dev/null | sort
```

Paste grep output (file:line triples) into `audit-notes.md` section "Frontend caller audit" with 1 row per view.

- [ ] **Step 2: Grep MVs (25+ candidates)**

```bash
cd /Users/jj/quimibond-intelligence/quimibond-intelligence
rg -n -tts -tjson \
  -e 'invoices_unified|payments_unified|syntage_invoices_enriched|products_unified|product_price_history|company_profile|company_profile_sat|monthly_revenue_by_company|product_margin_analysis|customer_margin_analysis|customer_ltv_health|customer_product_matrix|supplier_product_matrix|supplier_price_index|supplier_concentration_herfindahl|partner_payment_profile|account_payment_profile|portfolio_concentration|rfm_segments|customer_cohorts|company_email_intelligence|company_handlers|company_insight_history|company_narrative|cross_director_signals' \
  src app vercel.json 2>/dev/null | sort
```

Append results to audit-notes. **Note**: many MV names also appear as identifiers in DB functions; ese audit va en Task 2.

- [ ] **Step 3: Grep operational MVs (keep + rewire set)**

Confirmar si son realmente consumidas en frontend. Si alguna tiene 0 callers, puede bajar a "drop candidate" aún.

```bash
cd /Users/jj/quimibond-intelligence/quimibond-intelligence
rg -n -tts -tjson \
  -e 'inventory_velocity|dead_stock_analysis|cashflow_projection|accounting_anomalies|ar_aging_detail|journal_flow_profile|ops_delivery_health_weekly|purchase_price_intelligence|product_real_cost|product_seasonality|payment_predictions|client_reorder_predictions|bom_duplicate_components|stockout_queue' \
  src app vercel.json 2>/dev/null | sort
```

Append. Flag cualquier con 0 callers — se clasifica `RE-EVALUATE` en Task 3.

- [ ] **Step 4: Grep tables confirmed drop + migrate-later**

```bash
cd /Users/jj/quimibond-intelligence/quimibond-intelligence
rg -n -tts -tjson \
  -e 'agent_tickets|notification_queue|health_scores|unified_refresh_queue|reconciliation_summary_daily|odoo_schema_catalog|odoo_uoms|odoo_snapshots|odoo_invoices_archive_pre_dedup|odoo_invoices_archive_dup_cfdi_uuid_2026_04_20|invoice_bridge_manual|payment_bridge_manual|products_fiscal_map' \
  src app vercel.json 2>/dev/null | sort
```

Also grep against addon:

```bash
rg -n -e 'invoice_bridge_manual|payment_bridge_manual|products_fiscal_map|agent_tickets|notification_queue|health_scores|unified_refresh_queue|reconciliation_summary_daily|odoo_schema_catalog|odoo_uoms|odoo_snapshots' \
  /Users/jj/addons/quimibond_intelligence/ 2>/dev/null | sort
```

Append. **Expected:** `invoice_bridge_manual`/`payment_bridge_manual`/`products_fiscal_map` tienen callers (RPCs + UI reconcile flow) → MIGRATE FIRST (SP2/SP3 pre-drop); dropped NOT in SP1. `agent_tickets`/`notification_queue`/`health_scores` expected 0 callers → DROP CONFIRMED.

- [ ] **Step 5: Grep frontend pages (§12.4)**

Listar páginas existentes + uso en top-nav:

```bash
cd /Users/jj/quimibond-intelligence/quimibond-intelligence
ls -1 src/app | grep -v -E '^(_|api|globals|icon|layout|loading|error|not-found|page)' | sort
```

Luego grep cada page folder en top-nav:

```bash
rg -n -tts -tjson -e "href=['\"]/(dashboard|emails|agents)" src 2>/dev/null | sort
rg -n -tts -tjson -e "'/dashboard'|'/emails'" src/components 2>/dev/null | sort
```

Append page inventory + link refs to audit-notes.

- [ ] **Step 6: Grep API routes (§12.5)**

```bash
cd /Users/jj/quimibond-intelligence/quimibond-intelligence
ls -1 src/app/api | sort
rg -n -tts -tjson -e '/api/pipeline/reconcile|/api/pipeline/embeddings' src vercel.json 2>/dev/null | sort
```

También examinar `vercel.json` crons:

```bash
cat vercel.json | grep -E '"path":|"schedule":' | head -60
```

Append crons table + caller counts a audit-notes.

- [ ] **Step 7: Commit evidence**

```bash
cd /Users/jj/quimibond-intelligence/quimibond-intelligence
git add docs/superpowers/plans/2026-04-21-silver-sp1-audit-notes.md
git commit -m "docs(sp1): Task 1 frontend caller audit complete

Grep-based inventory of src/ + vercel.json + addon refs to every
spec §12 drop candidate. 0-caller objects flagged for Task 3
categorization."
git push
```

**Acceptance.** Each of 16 views, 25+ MVs, 13 tables, ~5 pages, ~10 routes has a row in audit-notes with callers column populated (possibly `(none)`).

---

### Task 2: DB dependency audit — pg_depend + function refs per candidate

**Purpose.** Para cada drop candidate, determinar si algún **otro** DB object (view, MV, function, trigger) lo referencia. Un candidate con DB deps no se puede DROP directamente sin CASCADE (riesgoso) o drop order (seguro).

**Method.** Dos queries por candidate: (1) `pg_depend` reverse lookup por `refobjid`, (2) regex search de `pg_proc` definition bodies.

**Files:**
- Modify: `docs/superpowers/plans/2026-04-21-silver-sp1-audit-notes.md` (section DB dependency audit)

**Steps:**

- [ ] **Step 1: Batch query pg_depend para todos los view candidates**

Via `mcp__claude_ai_Supabase__execute_sql`:

```sql
WITH cand(nm) AS (VALUES
  ('unified_invoices'), ('unified_payment_allocations'), ('invoice_bridge'),
  ('orders_unified'), ('order_fulfillment_bridge'), ('person_unified'),
  ('cash_position'), ('working_capital'), ('working_capital_cycle'),
  ('cashflow_current_cash'), ('cashflow_liquidity_metrics'),
  ('monthly_revenue_trend'), ('analytics_customer_360'),
  ('balance_sheet'), ('pl_estado_resultados'), ('revenue_concentration')
)
SELECT
  cand.nm                                               AS candidate,
  dep_n.nspname || '.' || dep_c.relname                 AS dependent_obj,
  CASE dep_c.relkind
    WHEN 'v' THEN 'view' WHEN 'm' THEN 'matview'
    WHEN 'r' THEN 'table' WHEN 'f' THEN 'foreign_table'
  END                                                    AS dependent_kind
FROM cand
LEFT JOIN pg_class c ON c.relname = cand.nm AND c.relnamespace = 'public'::regnamespace
LEFT JOIN pg_depend d ON d.refobjid = c.oid AND d.deptype = 'n'
LEFT JOIN pg_rewrite r ON r.oid = d.objid
LEFT JOIN pg_class dep_c ON dep_c.oid = r.ev_class AND dep_c.oid <> c.oid
LEFT JOIN pg_namespace dep_n ON dep_n.oid = dep_c.relnamespace
WHERE dep_c.oid IS NOT NULL
ORDER BY candidate, dependent_obj;
```

Paste output into audit-notes.md table `DB dependency audit`, column `DB deps`.

- [ ] **Step 2: Batch query pg_depend para MV candidates**

```sql
WITH cand(nm) AS (VALUES
  ('invoices_unified'),('payments_unified'),('syntage_invoices_enriched'),
  ('products_unified'),('product_price_history'),('company_profile'),('company_profile_sat'),
  ('monthly_revenue_by_company'),('product_margin_analysis'),('customer_margin_analysis'),
  ('customer_ltv_health'),('customer_product_matrix'),('supplier_product_matrix'),
  ('supplier_price_index'),('supplier_concentration_herfindahl'),('partner_payment_profile'),
  ('account_payment_profile'),('portfolio_concentration'),('rfm_segments'),('customer_cohorts'),
  ('company_email_intelligence'),('company_handlers'),('company_insight_history'),
  ('company_narrative'),('cross_director_signals'),
  ('inventory_velocity'),('dead_stock_analysis'),('cashflow_projection'),('accounting_anomalies'),
  ('ar_aging_detail'),('journal_flow_profile'),('ops_delivery_health_weekly'),
  ('purchase_price_intelligence'),('product_real_cost'),('product_seasonality'),
  ('payment_predictions'),('client_reorder_predictions'),('bom_duplicate_components')
)
SELECT
  cand.nm AS candidate,
  dep_n.nspname || '.' || dep_c.relname AS dependent_obj,
  CASE dep_c.relkind
    WHEN 'v' THEN 'view' WHEN 'm' THEN 'matview' WHEN 'r' THEN 'table'
  END AS dependent_kind
FROM cand
LEFT JOIN pg_class c ON c.relname = cand.nm AND c.relnamespace = 'public'::regnamespace
LEFT JOIN pg_depend d ON d.refobjid = c.oid AND d.deptype = 'n'
LEFT JOIN pg_rewrite r ON r.oid = d.objid
LEFT JOIN pg_class dep_c ON dep_c.oid = r.ev_class AND dep_c.oid <> c.oid
LEFT JOIN pg_namespace dep_n ON dep_n.oid = dep_c.relnamespace
WHERE dep_c.oid IS NOT NULL
ORDER BY candidate, dependent_obj;
```

Paste output.

- [ ] **Step 3: Batch query pg_depend para tables confirmed drop**

```sql
WITH cand(nm) AS (VALUES
  ('agent_tickets'),('notification_queue'),('health_scores'),
  ('unified_refresh_queue'),('reconciliation_summary_daily'),
  ('odoo_schema_catalog'),('odoo_uoms'),('odoo_snapshots'),
  ('odoo_invoices_archive_pre_dedup'),
  ('odoo_invoices_archive_dup_cfdi_uuid_2026_04_20')
)
SELECT
  cand.nm AS candidate,
  dep_n.nspname || '.' || dep_c.relname AS dependent_obj,
  CASE dep_c.relkind
    WHEN 'v' THEN 'view' WHEN 'm' THEN 'matview' WHEN 'r' THEN 'table'
  END AS dependent_kind
FROM cand
LEFT JOIN pg_class c ON c.relname = cand.nm AND c.relnamespace = 'public'::regnamespace
LEFT JOIN pg_depend d ON d.refobjid = c.oid AND d.deptype = 'n'
LEFT JOIN pg_rewrite r ON r.oid = d.objid
LEFT JOIN pg_class dep_c ON dep_c.oid = r.ev_class AND dep_c.oid <> c.oid
LEFT JOIN pg_namespace dep_n ON dep_n.oid = dep_c.relnamespace
WHERE dep_c.oid IS NOT NULL
ORDER BY candidate, dependent_obj;
```

Paste output.

- [ ] **Step 4: Function body regex scan**

Para cada candidate, buscar su nombre en `pg_proc.prosrc` — detecta funciones que lo consultan aunque pg_depend no lo capture (p.ej. consultas dinámicas):

```sql
SELECT p.proname AS fn, cand.nm AS candidate
FROM pg_proc p
JOIN pg_namespace n ON n.oid=p.pronamespace
CROSS JOIN (VALUES
  ('unified_invoices'),('unified_payment_allocations'),('invoice_bridge'),
  ('orders_unified'),('order_fulfillment_bridge'),('person_unified'),
  ('cash_position'),('working_capital'),('working_capital_cycle'),
  ('cashflow_current_cash'),('cashflow_liquidity_metrics'),
  ('monthly_revenue_trend'),('analytics_customer_360'),
  ('balance_sheet'),('pl_estado_resultados'),('revenue_concentration'),
  ('invoices_unified'),('payments_unified'),('syntage_invoices_enriched'),
  ('products_unified'),('product_price_history'),('company_profile'),('company_profile_sat'),
  ('monthly_revenue_by_company'),('product_margin_analysis'),('customer_margin_analysis'),
  ('customer_ltv_health'),('customer_product_matrix'),('supplier_product_matrix'),
  ('supplier_price_index'),('supplier_concentration_herfindahl'),('partner_payment_profile'),
  ('account_payment_profile'),('portfolio_concentration'),('rfm_segments'),('customer_cohorts'),
  ('company_email_intelligence'),('company_handlers'),('company_insight_history'),
  ('company_narrative'),('cross_director_signals'),
  ('agent_tickets'),('notification_queue'),('health_scores'),
  ('unified_refresh_queue'),('reconciliation_summary_daily'),
  ('odoo_schema_catalog'),('odoo_uoms'),('odoo_snapshots')
) AS cand(nm)
WHERE n.nspname='public'
  AND p.prosrc ~* ('\m' || cand.nm || '\M')
ORDER BY candidate, fn;
```

Paste output. This populates column `Function refs` in audit-notes DB dependency table.

- [ ] **Step 5: Trigger refs (critical for tables)**

Para tables con drop confirmed, asegurar que no haya triggers ni FKs de otras tables apuntando a ellas:

```sql
-- FKs apuntando a candidates (reverse FK lookup)
SELECT
  cl_target.relname AS target_table,
  cl_source.relname AS source_table,
  con.conname AS fk_name
FROM pg_constraint con
JOIN pg_class cl_source ON cl_source.oid = con.conrelid
JOIN pg_class cl_target ON cl_target.oid = con.confrelid
JOIN pg_namespace ns_t ON ns_t.oid = cl_target.relnamespace
WHERE ns_t.nspname='public'
  AND con.contype='f'
  AND cl_target.relname IN (
    'agent_tickets','notification_queue','health_scores',
    'unified_refresh_queue','reconciliation_summary_daily',
    'odoo_schema_catalog','odoo_uoms','odoo_snapshots',
    'odoo_invoices_archive_pre_dedup',
    'odoo_invoices_archive_dup_cfdi_uuid_2026_04_20'
  )
ORDER BY target_table, source_table;
```

Expected: 0 rows (tables confirmed drop don't have inbound FKs — verify, flag if not).

- [ ] **Step 6: Commit evidence**

```bash
cd /Users/jj/quimibond-intelligence/quimibond-intelligence
git add docs/superpowers/plans/2026-04-21-silver-sp1-audit-notes.md
git commit -m "docs(sp1): Task 2 DB dependency audit complete

pg_depend + pg_proc body scan per candidate. Chains identified
for drop ordering (Task 4/5). FK reverse lookups confirm tables
confirmed-drop have no inbound FKs."
git push
```

**Acceptance.** audit-notes DB dependency table populated for every candidate. Any candidate with `DB deps` non-empty is flagged in Task 3 for dependency-order DROP OR removed from SP1 scope.

---

### Task 3: Categorization sign-off (gated)

**Purpose.** Con evidencia completa (Task 1 + Task 2), asignar cada candidate a una de 4 categorías. **Después** de proponer, pedir explícitamente OK del usuario antes de cualquier drop en Fase B.

**Rules (in order of application):**
1. Si `Frontend callers > 0` AND `user no confirma migrate` → `MIGRATE FIRST` (defer to SP5).
2. Si `Frontend callers == 0` AND `DB deps == 0` AND spec §12 lo marca drop → `DROP CONFIRMED`.
3. Si `Frontend callers == 0` AND `DB deps > 0` → sigue siendo candidate si las deps también están en drop list → `DROP CONFIRMED (depend order)`; else → `KEEP` (dep legítima fuera de scope SP1).
4. Si spec dice "KEEP + rewire" (operational MVs §12.2 bloque 3) → `KEEP`. Confirmar que tienen callers.
5. Ambiguo (operational MV con 0 callers, o agent-specific MV) → `RE-EVALUATE` → pregunta explícita al usuario.

**Files:**
- Modify: `docs/superpowers/plans/2026-04-21-silver-sp1-audit-notes.md` (section Categorization decisions)

**Steps:**

- [ ] **Step 1: Llenar tabla Categorization**

Por cada candidate, una row:

```
| # | Object | Type | FE callers | DB deps | Category | Evidence | Signoff |
|---|---|---|---|---|---|---|---|
| 1 | unified_invoices | view | <N> refs en <file.ts>... | invoices_unified (MV) | MIGRATE FIRST | Still consumed; SP5 cutover | pending |
...
```

Fill for all 16 views + 38 MVs + 10 tables + N pages + N routes.

- [ ] **Step 2: Agrupar en batches para Fase B**

Summary table al final de la sección, con conteo por categoría:

```
| Category | Count | Batch assignment |
|---|---|---|
| DROP CONFIRMED (views, 0 callers) | ~N | Batch 1 (Task 4) |
| DROP CONFIRMED (MVs, 0 callers) | ~N | Batch 2 (Task 5) |
| DROP CONFIRMED (tables, spec §12.3) | ~N | Batch 3 (Task 6) |
| DROP CONFIRMED (pages/routes)      | ~N | Batch 4 (Task 7) |
| MIGRATE FIRST                      | ~N | Defer SP5 (document only) |
| KEEP                                | ~N | Document replacement target (SP4/SP5) |
| RE-EVALUATE                         | ~N | Ask user explicit, per-item |
```

- [ ] **Step 3: Commit proposal**

```bash
cd /Users/jj/quimibond-intelligence/quimibond-intelligence
git add docs/superpowers/plans/2026-04-21-silver-sp1-audit-notes.md
git commit -m "docs(sp1): Task 3 categorization proposed (pending user OK)

Per-candidate category assignment. Batches defined but not yet
executed — awaiting user signoff in Tasks 4-7."
git push
```

- [ ] **Step 4: ASK USER — explicit signoff message**

**Exact message to send user (copy-paste):**

```
SP1 audit completo. Propongo las siguientes categorías:

- DROP CONFIRMED views (Batch 1 → Task 4): <lista>
- DROP CONFIRMED MVs (Batch 2 → Task 5): <lista>
- DROP CONFIRMED tables (Batch 3 → Task 6): agent_tickets, notification_queue, health_scores, + <otras>
- DROP CONFIRMED frontend pages/routes (Batch 4 → Task 7): <lista>
- MIGRATE FIRST (defer SP5): <lista>
- KEEP: <lista>
- RE-EVALUATE (necesito tu decisión): <lista con explicación per-item>

Evidencia completa en:
docs/superpowers/plans/2026-04-21-silver-sp1-audit-notes.md

¿OK para proceder con Batch 1 (views)? O prefieres empezar con un
batch específico / ajustar categorías / discutir RE-EVALUATE primero?

Drops son gated per batch — puedo ejecutar uno a la vez, smoke-test, y
avanzar al siguiente solo con tu OK explícito.
```

**No DROPs happen until the user responds.** Paste user response verbatim en audit-notes §User signoff log. If user asks changes, update categorization table + re-ask.

**Acceptance.** Categorization table complete, 0 items "TBD", user responded in chat. Signoff log has Batch 1 approval (or explicit deferral to different batch order).

---

## Fase B — Execute drops (gated per batch)

**Principio general.** Cada batch = una migración independiente + una commit + una verificación post-drop. Si cualquier smoke test falla, **no se avanza al siguiente batch** hasta resolver.

### Task 4: Batch 1 — Drop unused views

**Scope.** Todas las views clasificadas `DROP CONFIRMED` en Task 3, generalmente las que tienen 0 frontend callers y 0 DB deps OR cuyas DB deps también están en drop list.

**Typical candidates (pre-approved by spec §12.1, pending evidence from Task 1-3):**
- `analytics_customer_360` — ya marcado drop-before-gold en spec §12.1 (replaced by `gold_company_360` in SP4); si 0 callers → DROP.
- `cash_position`, `working_capital`, `working_capital_cycle`, `cashflow_current_cash`, `cashflow_liquidity_metrics`, `revenue_concentration`, `portfolio_concentration` (view) — si todos tienen 0 frontend callers.
- `unified_invoices`, `unified_payment_allocations`, `invoice_bridge`, `orders_unified`, `order_fulfillment_bridge`, `person_unified` — expected `MIGRATE FIRST` si callers > 0 (spec says SP5).

**Rule of thumb.** Si Task 3 marcó `DROP CONFIRMED` para esa view, entra aquí. Si no, salta.

**Files:**
- Create: `supabase/migrations/20260422_sp1_01_drop_unused_views.sql`

**Steps:**

- [ ] **Step 1: Confirmar lista final del batch**

Leer audit-notes.md sección Categorization; filtrar `Category='DROP CONFIRMED'` AND `Type='view'`. Esa es la lista para esta task.

Re-verificar deps directos con query:

```sql
SELECT dep_n.nspname || '.' || dep_c.relname AS dependent_obj,
       CASE dep_c.relkind WHEN 'v' THEN 'view' WHEN 'm' THEN 'matview' WHEN 'r' THEN 'table' END AS kind,
       c.relname AS dropping
FROM pg_class c
JOIN pg_namespace n ON n.oid=c.relnamespace AND n.nspname='public'
LEFT JOIN pg_depend d ON d.refobjid=c.oid AND d.deptype='n'
LEFT JOIN pg_rewrite r ON r.oid=d.objid
LEFT JOIN pg_class dep_c ON dep_c.oid=r.ev_class AND dep_c.oid<>c.oid
LEFT JOIN pg_namespace dep_n ON dep_n.oid=dep_c.relnamespace
WHERE c.relname IN (<BATCH_1_VIEW_LIST>)
  AND dep_c.oid IS NOT NULL;
```

Si hay rows no vacíos, determinar DROP order. Caso común: view A → view B requiere drop A primero.

- [ ] **Step 2: Escribir migration `20260422_sp1_01_drop_unused_views.sql`**

Plantilla (rellenar `<BATCH_1_VIEW_LIST>` con los confirmados):

```sql
-- Silver SP1 Batch 1 — drop unused views
-- Spec: 2026-04-21-silver-architecture.md §12.1
-- Plan: 2026-04-21-silver-sp1-audit-prune.md Task 4
-- Evidence: 2026-04-21-silver-sp1-audit-notes.md §Categorization
BEGIN;

-- Pre-drop snapshot (idempotent; safe if re-run)
DO $$
DECLARE v_before int;
BEGIN
  SELECT count(*) INTO v_before FROM pg_views WHERE schemaname='public';
  RAISE NOTICE 'sp1_01 pre-drop view count = %', v_before;
END$$;

-- DROPs in dependency order (top-level views first only if they depend on bottom-level)
-- Each line intentionally explicit (no CASCADE — fails loudly if unexpected dep exists)
DROP VIEW IF EXISTS public.<CANDIDATE_1> RESTRICT;
DROP VIEW IF EXISTS public.<CANDIDATE_2> RESTRICT;
-- ... one line per confirmed candidate, in dep order (deepest first)

INSERT INTO public.schema_changes (change_type, table_name, description, sql_executed, triggered_by, success, created_at)
VALUES
  ('DROP_VIEW', '<CANDIDATE_1>', 'SP1 Batch 1: drop unused view (0 frontend callers, spec §12.1)',
   'DROP VIEW IF EXISTS public.<CANDIDATE_1> RESTRICT;', 'sp1_audit_prune', true, now()),
  ('DROP_VIEW', '<CANDIDATE_2>', 'SP1 Batch 1: drop unused view (0 frontend callers, spec §12.1)',
   'DROP VIEW IF EXISTS public.<CANDIDATE_2> RESTRICT;', 'sp1_audit_prune', true, now())
  -- ... one tuple per candidate
;

-- Post-drop snapshot into audit_runs
INSERT INTO public.audit_runs (run_id, invariant_key, bucket_key, severity, source, model, details, run_at)
SELECT gen_random_uuid(),'sp1_batch1_views_dropped','sp1','ok','supabase','sp1_audit_prune',
  jsonb_build_object(
    'views_after', (SELECT count(*) FROM pg_views WHERE schemaname='public'),
    'dropped', ARRAY['<CANDIDATE_1>','<CANDIDATE_2>']  -- ... fill exact list
  ), now();

COMMIT;
```

- [ ] **Step 3: ASK USER — Batch 1 final OK before apply**

**Exact message:**

```
Batch 1 (views) listo para aplicar. Drops confirmados:

<LISTA FINAL DE CANDIDATES con 1 por línea>

Migration: supabase/migrations/20260422_sp1_01_drop_unused_views.sql
Verificación dep-order: <resultado de Step 1 query>
Post-snapshot: audit_runs invariant_key=sp1_batch1_views_dropped

¿Aplico ahora con mcp__claude_ai_Supabase__apply_migration?
```

**Espera respuesta** ("OK", "adelante", "sí", "go"). Si user pide ajuste, vuelve al Step 2.

- [ ] **Step 4: Apply migration**

Via `mcp__claude_ai_Supabase__apply_migration(name='20260422_sp1_01_drop_unused_views', query=<full migration body>)`.

Expected: `COMMIT` (no errors). Capture return value in audit-notes.

- [ ] **Step 5: Smoke test**

```sql
-- Verify drops succeeded
SELECT viewname FROM pg_views WHERE schemaname='public' AND viewname IN (<BATCH_1_VIEW_LIST>);
-- Expected: 0 rows

-- Verify schema_changes insertion
SELECT count(*) FROM schema_changes
WHERE triggered_by='sp1_audit_prune'
  AND change_type='DROP_VIEW'
  AND created_at > now() - interval '10 minutes';
-- Expected: N = len(BATCH_1_VIEW_LIST)

-- Verify global view count decreased by exactly N
SELECT (77 - count(*)) AS delta FROM pg_views WHERE schemaname='public';
```

Paste outputs into audit-notes §Batch 1 ejecutado.

- [ ] **Step 6: Frontend smoke — `npm run build` + local dev**

```bash
cd /Users/jj/quimibond-intelligence/quimibond-intelligence
npm run build 2>&1 | tail -30
```

If TypeScript or Next.js build errors mention removed views → rollback (Step 7) y reclassify as MIGRATE FIRST. If clean, proceed.

- [ ] **Step 7: Rollback procedure (only if smoke fails)**

```sql
-- Rollback = recreate the view from pg_get_viewdef BEFORE drop (captured in audit-notes)
-- If not captured, restore from last known-good migration history
-- Document reason for rollback in audit-notes.md
```

Commit rollback migration as `20260422_sp1_01_rollback.sql` (only if needed).

- [ ] **Step 8: Commit Batch 1**

```bash
cd /Users/jj/quimibond-intelligence/quimibond-intelligence
git add supabase/migrations/20260422_sp1_01_drop_unused_views.sql \
        docs/superpowers/plans/2026-04-21-silver-sp1-audit-notes.md
git commit -m "refactor(db): SP1 Batch 1 — drop <N> unused views

Drops (spec §12.1, categorized DROP CONFIRMED in Task 3):
- <candidate 1>
- <candidate 2>
...

Audit: audit_runs invariant_key=sp1_batch1_views_dropped
Smoke: npm run build clean, frontend unaffected.
Refs: docs/superpowers/plans/2026-04-21-silver-sp1-audit-notes.md"
git push
```

**Acceptance.** `pg_views` count dropped by exactly N. `schema_changes` has N rows with `triggered_by='sp1_audit_prune'`. Frontend `npm run build` passes. User signoff logged.

---

### Task 5: Batch 2 — Drop dead materialized views

**Scope.** MVs que Task 3 marcó `DROP CONFIRMED` — típicamente MVs refrescadas cada 2h por `refresh_all_matviews()` pero sin consumidor (ni frontend ni DB dep). NO se incluyen las MVs grandes (`invoices_unified`, `payments_unified`, `syntage_invoices_enriched`, `products_unified`, `company_profile*`) — esas son SP5 post-cutover per spec §12.2.

**Out of SP1 scope (defer to SP5):**
- `invoices_unified` (66 MB) — SP5 after canonical_invoices cutover.
- `payments_unified` (25 MB) — SP5.
- `syntage_invoices_enriched` (49 MB) — spec §12.2 says DROP after SP2 (not SP1).
- `products_unified`, `company_profile`, `company_profile_sat`, `monthly_revenue_by_company` — SP5.

**Typical SP1 candidates (if Task 3 confirms 0 callers):**
- `product_margin_analysis`, `customer_margin_analysis` — spec says REBUILD; drop depends on audit.
- `customer_ltv_health`, `customer_product_matrix`, `supplier_product_matrix`, `supplier_price_index`, `supplier_concentration_herfindahl`, `partner_payment_profile`, `account_payment_profile`, `portfolio_concentration`, `rfm_segments`, `customer_cohorts` — spec §12.2 says "REBUILD or DROP (SP4 audit)". If 0 callers now → DROP in SP1, accept that SP4 may rebuild later.
- `company_email_intelligence`, `company_handlers`, `company_insight_history`, `company_narrative`, `cross_director_signals` — spec §12.2 says "DECIDE in SP5". En SP1 solo se dropean las con 0 callers Y user OK; sino → defer.

**Files:**
- Create: `supabase/migrations/20260422_sp1_02_drop_dead_mvs.sql`

**Steps:**

- [ ] **Step 1: Confirmar lista batch 2 desde Task 3**

Filter audit-notes §Categorization: `Category='DROP CONFIRMED' AND Type='mv'`. Flag any conflict with "defer SP5" comments.

Re-run dep check:

```sql
WITH cand(nm) AS (VALUES <BATCH_2_MV_LIST_AS_VALUES>)
SELECT cand.nm, dep_n.nspname||'.'||dep_c.relname AS dep_obj, dep_c.relkind
FROM cand
JOIN pg_class c ON c.relname=cand.nm AND c.relnamespace='public'::regnamespace
LEFT JOIN pg_depend d ON d.refobjid=c.oid AND d.deptype='n'
LEFT JOIN pg_rewrite r ON r.oid=d.objid
LEFT JOIN pg_class dep_c ON dep_c.oid=r.ev_class AND dep_c.oid<>c.oid
LEFT JOIN pg_namespace dep_n ON dep_n.oid=dep_c.relnamespace
WHERE dep_c.oid IS NOT NULL
ORDER BY cand.nm;
```

- [ ] **Step 2: Escribir migration `20260422_sp1_02_drop_dead_mvs.sql`**

```sql
-- Silver SP1 Batch 2 — drop dead materialized views
-- Spec: 2026-04-21-silver-architecture.md §12.2
-- Plan: 2026-04-21-silver-sp1-audit-prune.md Task 5
BEGIN;

-- Pre-drop snapshot
DO $$ DECLARE v_before int;
BEGIN SELECT count(*) INTO v_before FROM pg_matviews WHERE schemaname='public';
  RAISE NOTICE 'sp1_02 pre-drop mv count = %', v_before;
END$$;

-- DROPs in dep order
DROP MATERIALIZED VIEW IF EXISTS public.<MV_CAND_1> RESTRICT;
DROP MATERIALIZED VIEW IF EXISTS public.<MV_CAND_2> RESTRICT;
-- ... one line per confirmed MV candidate

INSERT INTO public.schema_changes (change_type, table_name, description, sql_executed, triggered_by, success, created_at)
VALUES
  ('DROP_MATVIEW', '<MV_CAND_1>',
   'SP1 Batch 2: drop dead MV (0 frontend callers, spec §12.2)',
   'DROP MATERIALIZED VIEW IF EXISTS public.<MV_CAND_1> RESTRICT;',
   'sp1_audit_prune', true, now())
  -- ... one tuple per candidate
;

INSERT INTO public.audit_runs (run_id, invariant_key, bucket_key, severity, source, model, details, run_at)
SELECT gen_random_uuid(),'sp1_batch2_mvs_dropped','sp1','ok','supabase','sp1_audit_prune',
  jsonb_build_object(
    'mvs_after',(SELECT count(*) FROM pg_matviews WHERE schemaname='public'),
    'dropped', ARRAY['<MV_CAND_1>','<MV_CAND_2>']  -- fill exact
  ), now();

COMMIT;
```

- [ ] **Step 3: ASK USER — Batch 2 OK**

**Message:**

```
Batch 2 (MVs muertas) listo:

<LISTA FINAL con tamaños>

Grandes MVs (invoices_unified 66MB, payments_unified 25MB, etc.) están DEFERRED a SP5
per spec §12.2 — no se tocan ahora.

Migration: 20260422_sp1_02_drop_dead_mvs.sql
Dep-order verified: <resultado Step 1>

Aplico?
```

Wait for user OK.

- [ ] **Step 4: Apply migration**

Via `mcp__claude_ai_Supabase__apply_migration(name='20260422_sp1_02_drop_dead_mvs', query=<body>)`.

- [ ] **Step 5: Smoke test**

```sql
-- Verify drops
SELECT matviewname FROM pg_matviews WHERE schemaname='public' AND matviewname IN (<BATCH_2_MV_LIST>);
-- Expected: 0

-- Verify refresh_all_matviews NO corre hasta Task 8 (aún contiene las MVs dropeadas)
-- Importante: Task 8 DEBE correrse antes del próximo cron auto-refresh (2h) para evitar errors de "no existe MV"
SELECT pg_get_functiondef('public.refresh_all_matviews()'::regprocedure) ~* '<MV_CAND_1>' AS still_has_dropped_mv;
-- Expected: true — confirmarse Task 8 es next
```

- [ ] **Step 6: Frontend smoke**

```bash
cd /Users/jj/quimibond-intelligence/quimibond-intelligence
npm run build 2>&1 | tail -30
```

Si build falla → rollback.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260422_sp1_02_drop_dead_mvs.sql \
        docs/superpowers/plans/2026-04-21-silver-sp1-audit-notes.md
git commit -m "refactor(db): SP1 Batch 2 — drop <N> dead materialized views

Drops (spec §12.2, Task 3 category=DROP CONFIRMED):
- <mv1> (<size>)
- <mv2> (<size>)
...

Large MVs (invoices_unified, payments_unified, etc.) deferred to
SP5 cutover. refresh_all_matviews cleanup in next commit (Task 8).

Audit: audit_runs invariant_key=sp1_batch2_mvs_dropped"
git push
```

**Acceptance.** `pg_matviews` count decreased by exactly N. `schema_changes` rows present. Frontend builds. **CRITICAL**: next cron refresh will fail — Task 8 must run before next `refresh_all_matviews()` cron fires (typically every 2h).

---

### Task 6: Batch 3 — Drop abandoned tables

**Scope.** Tablas de §12.3 con `DROP CONFIRMED`. Drop confirmed explícitos del user (2026-04-21):
1. `agent_tickets` (1,958 rows — 100% pending, worker never runs)
2. `notification_queue` (815 rows — 100% pending)
3. `health_scores` (52,152 rows — 100% contact_id NULL)

Plus additional per Task 3 audit:
4. `unified_refresh_queue` (0 rows ever)
5. `reconciliation_summary_daily` (2 rows, stale)
6. `odoo_schema_catalog` (3,820 rows, dead-pixel — odoo-agent disabled)
7. `odoo_uoms` (76 rows, dead-pixel — no converter usage)
8. `odoo_snapshots` (21,783 rows, replaced by canonical_*)
9. `odoo_invoices_archive_pre_dedup` (5,321 rows, archive)
10. `odoo_invoices_archive_dup_cfdi_uuid_2026_04_20` (5,321 rows, archive)

**EXCLUDED from SP1** (defer SP2/SP3):
- `invoice_bridge_manual` (SP2 migrate to `mdm_manual_overrides`)
- `payment_bridge_manual` (SP2 migrate)
- `products_fiscal_map` (SP3 migrate)

**Archive rule.** Before dropping any table with `count > 100`, dump to `/tmp/sp1_archive_<table>_<yyyymmdd>.jsonl` via `COPY` — user preference for reversibility.

**Files:**
- Create: `supabase/migrations/20260422_sp1_03_drop_abandoned_tables.sql`

**Steps:**

- [ ] **Step 1: Archive rows > 100 into /tmp files**

Para tablas con `count > 100` (según baseline Task 0 Step 3), ejecutar `COPY` a JSON. Vía `mcp__claude_ai_Supabase__execute_sql` — ejecutar SELECT y pegar resultado a archivo local:

```sql
-- Dump each table body
SELECT row_to_json(t) FROM agent_tickets t;
```

Guardar stdout en `/tmp/sp1_archive_agent_tickets_20260422.jsonl` (local al shell del operador). Repetir para:
- `notification_queue` → `/tmp/sp1_archive_notification_queue_20260422.jsonl`
- `health_scores` → `/tmp/sp1_archive_health_scores_20260422.jsonl` (**52k rows — verifica tamaño antes, ~10 MB aprox**)
- `odoo_schema_catalog` → `/tmp/sp1_archive_odoo_schema_catalog_20260422.jsonl`
- `odoo_snapshots` → `/tmp/sp1_archive_odoo_snapshots_20260422.jsonl`
- `odoo_invoices_archive_pre_dedup` → `/tmp/sp1_archive_odoo_invoices_archive_pre_dedup_20260422.jsonl`
- `odoo_invoices_archive_dup_cfdi_uuid_2026_04_20` → `/tmp/sp1_archive_odoo_invoices_archive_dup_cfdi_uuid_2026_04_20_20260422.jsonl`

Small tables (count ≤ 100) no need archiving: `unified_refresh_queue` (0), `reconciliation_summary_daily` (2), `odoo_uoms` (76).

Confirmar sizes en audit-notes before DROP:

```bash
ls -lh /tmp/sp1_archive_*.jsonl
```

- [ ] **Step 2: Confirmar batch 3 lista final**

Lista master SP1:
```
agent_tickets, notification_queue, health_scores,
unified_refresh_queue, reconciliation_summary_daily,
odoo_schema_catalog, odoo_uoms, odoo_snapshots,
odoo_invoices_archive_pre_dedup,
odoo_invoices_archive_dup_cfdi_uuid_2026_04_20
```

Re-verify inbound FK (already queried Task 2 Step 5 — expected 0):

```sql
SELECT cl_target.relname, cl_source.relname, con.conname
FROM pg_constraint con
JOIN pg_class cl_source ON cl_source.oid=con.conrelid
JOIN pg_class cl_target ON cl_target.oid=con.confrelid
JOIN pg_namespace ns_t ON ns_t.oid=cl_target.relnamespace
WHERE ns_t.nspname='public' AND con.contype='f'
  AND cl_target.relname IN (
    'agent_tickets','notification_queue','health_scores',
    'unified_refresh_queue','reconciliation_summary_daily',
    'odoo_schema_catalog','odoo_uoms','odoo_snapshots',
    'odoo_invoices_archive_pre_dedup',
    'odoo_invoices_archive_dup_cfdi_uuid_2026_04_20'
  );
```

Expected: 0 rows.

- [ ] **Step 3: Escribir migration `20260422_sp1_03_drop_abandoned_tables.sql`**

```sql
-- Silver SP1 Batch 3 — drop abandoned tables
-- Spec: 2026-04-21-silver-architecture.md §12.3
-- Plan: 2026-04-21-silver-sp1-audit-prune.md Task 6
-- User-approved DROPs: agent_tickets, notification_queue, health_scores
-- (spec §12.3 'DROP CONFIRMED user approved 2026-04-21')
BEGIN;

DO $$ DECLARE v_before int;
BEGIN SELECT count(*) INTO v_before FROM pg_tables WHERE schemaname='public';
  RAISE NOTICE 'sp1_03 pre-drop table count = %', v_before;
END$$;

-- Drops. RESTRICT catches accidental FK dependencies.
DROP TABLE IF EXISTS public.agent_tickets RESTRICT;
DROP TABLE IF EXISTS public.notification_queue RESTRICT;
DROP TABLE IF EXISTS public.health_scores RESTRICT;
DROP TABLE IF EXISTS public.unified_refresh_queue RESTRICT;
DROP TABLE IF EXISTS public.reconciliation_summary_daily RESTRICT;
DROP TABLE IF EXISTS public.odoo_schema_catalog RESTRICT;
DROP TABLE IF EXISTS public.odoo_uoms RESTRICT;
DROP TABLE IF EXISTS public.odoo_snapshots RESTRICT;
DROP TABLE IF EXISTS public.odoo_invoices_archive_pre_dedup RESTRICT;
DROP TABLE IF EXISTS public.odoo_invoices_archive_dup_cfdi_uuid_2026_04_20 RESTRICT;

INSERT INTO public.schema_changes (change_type, table_name, description, sql_executed, triggered_by, success, created_at) VALUES
  ('DROP_TABLE','agent_tickets',
   'SP1 Batch 3: drop abandoned table (1958 rows, 100% pending, worker never runs). Archive: /tmp/sp1_archive_agent_tickets_20260422.jsonl. User-approved 2026-04-21.',
   'DROP TABLE IF EXISTS public.agent_tickets RESTRICT;','sp1_audit_prune',true,now()),
  ('DROP_TABLE','notification_queue',
   'SP1 Batch 3: drop abandoned table (815 rows, 100% pending). Archive: /tmp/sp1_archive_notification_queue_20260422.jsonl. User-approved 2026-04-21.',
   'DROP TABLE IF EXISTS public.notification_queue RESTRICT;','sp1_audit_prune',true,now()),
  ('DROP_TABLE','health_scores',
   'SP1 Batch 3: drop abandoned table (52152 rows, 100% contact_id NULL). Archive: /tmp/sp1_archive_health_scores_20260422.jsonl. User-approved 2026-04-21.',
   'DROP TABLE IF EXISTS public.health_scores RESTRICT;','sp1_audit_prune',true,now()),
  ('DROP_TABLE','unified_refresh_queue',
   'SP1 Batch 3: drop abandoned table (0 rows ever, spec §12.3).',
   'DROP TABLE IF EXISTS public.unified_refresh_queue RESTRICT;','sp1_audit_prune',true,now()),
  ('DROP_TABLE','reconciliation_summary_daily',
   'SP1 Batch 3: drop stale table (2 rows, spec §12.3).',
   'DROP TABLE IF EXISTS public.reconciliation_summary_daily RESTRICT;','sp1_audit_prune',true,now()),
  ('DROP_TABLE','odoo_schema_catalog',
   'SP1 Batch 3: drop dead-pixel table (3820 rows, odoo-agent disabled, spec §12.3).',
   'DROP TABLE IF EXISTS public.odoo_schema_catalog RESTRICT;','sp1_audit_prune',true,now()),
  ('DROP_TABLE','odoo_uoms',
   'SP1 Batch 3: drop dead-pixel table (76 rows, no converter usage, spec §12.3).',
   'DROP TABLE IF EXISTS public.odoo_uoms RESTRICT;','sp1_audit_prune',true,now()),
  ('DROP_TABLE','odoo_snapshots',
   'SP1 Batch 3: drop replaced-by-canonical table (21783 rows, spec §12.3). Archive: /tmp/sp1_archive_odoo_snapshots_20260422.jsonl.',
   'DROP TABLE IF EXISTS public.odoo_snapshots RESTRICT;','sp1_audit_prune',true,now()),
  ('DROP_TABLE','odoo_invoices_archive_pre_dedup',
   'SP1 Batch 3: drop archive from Fase 0 (5321 rows, integrity validated). Archive: /tmp/sp1_archive_odoo_invoices_archive_pre_dedup_20260422.jsonl.',
   'DROP TABLE IF EXISTS public.odoo_invoices_archive_pre_dedup RESTRICT;','sp1_audit_prune',true,now()),
  ('DROP_TABLE','odoo_invoices_archive_dup_cfdi_uuid_2026_04_20',
   'SP1 Batch 3: drop archive from Fase 2 cfdi bug mitigation (5321 rows). Archive: /tmp/sp1_archive_odoo_invoices_archive_dup_cfdi_uuid_2026_04_20_20260422.jsonl.',
   'DROP TABLE IF EXISTS public.odoo_invoices_archive_dup_cfdi_uuid_2026_04_20 RESTRICT;','sp1_audit_prune',true,now());

INSERT INTO public.audit_runs (run_id, invariant_key, bucket_key, severity, source, model, details, run_at)
SELECT gen_random_uuid(),'sp1_batch3_tables_dropped','sp1','ok','supabase','sp1_audit_prune',
  jsonb_build_object(
    'tables_after',(SELECT count(*) FROM pg_tables WHERE schemaname='public'),
    'dropped', ARRAY[
      'agent_tickets','notification_queue','health_scores',
      'unified_refresh_queue','reconciliation_summary_daily',
      'odoo_schema_catalog','odoo_uoms','odoo_snapshots',
      'odoo_invoices_archive_pre_dedup',
      'odoo_invoices_archive_dup_cfdi_uuid_2026_04_20'
    ],
    'archive_files', ARRAY[
      '/tmp/sp1_archive_agent_tickets_20260422.jsonl',
      '/tmp/sp1_archive_notification_queue_20260422.jsonl',
      '/tmp/sp1_archive_health_scores_20260422.jsonl',
      '/tmp/sp1_archive_odoo_schema_catalog_20260422.jsonl',
      '/tmp/sp1_archive_odoo_snapshots_20260422.jsonl',
      '/tmp/sp1_archive_odoo_invoices_archive_pre_dedup_20260422.jsonl',
      '/tmp/sp1_archive_odoo_invoices_archive_dup_cfdi_uuid_2026_04_20_20260422.jsonl'
    ]
  ), now();

COMMIT;
```

- [ ] **Step 4: ASK USER — Batch 3 OK**

**Message:**

```
Batch 3 (tablas muertas) listo. 10 tables a dropear:

Confirmed DROP user 2026-04-21:
  - agent_tickets (1958 rows, archived)
  - notification_queue (815 rows, archived)
  - health_scores (52152 rows, archived)

Spec §12.3 dead-pixel / stale / archive:
  - unified_refresh_queue (0)
  - reconciliation_summary_daily (2)
  - odoo_schema_catalog (3820, archived)
  - odoo_uoms (76)
  - odoo_snapshots (21783, archived)
  - odoo_invoices_archive_pre_dedup (5321, archived)
  - odoo_invoices_archive_dup_cfdi_uuid_2026_04_20 (5321, archived)

EXCLUIDAS SP1 (defer SP2/SP3):
  - invoice_bridge_manual, payment_bridge_manual (SP2 migrate to mdm_manual_overrides)
  - products_fiscal_map (SP3 migrate)

Archives: /tmp/sp1_archive_*.jsonl
Migration: 20260422_sp1_03_drop_abandoned_tables.sql
FK reverse check: 0 inbound FKs

¿Aplico?
```

Wait OK.

- [ ] **Step 5: Apply migration**

Via `mcp__claude_ai_Supabase__apply_migration(name='20260422_sp1_03_drop_abandoned_tables', query=<body>)`.

- [ ] **Step 6: Smoke test**

```sql
SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN (
  'agent_tickets','notification_queue','health_scores',
  'unified_refresh_queue','reconciliation_summary_daily',
  'odoo_schema_catalog','odoo_uoms','odoo_snapshots',
  'odoo_invoices_archive_pre_dedup',
  'odoo_invoices_archive_dup_cfdi_uuid_2026_04_20'
);
-- Expected: 0 rows

SELECT count(*) FROM schema_changes WHERE triggered_by='sp1_audit_prune' AND change_type='DROP_TABLE';
-- Expected: 10
```

Frontend smoke:

```bash
cd /Users/jj/quimibond-intelligence/quimibond-intelligence
npm run build 2>&1 | tail -30
rg -tts -tjson -e 'agent_tickets|notification_queue|health_scores' src 2>/dev/null | head -5
```

Expected: build pass; grep returns 0 matches (Task 1 already confirmed, re-verify).

- [ ] **Step 7: Monitor /api/health + pipeline logs for 2h**

Supabase logs:

```
mcp__claude_ai_Supabase__get_logs(project_id='tozqezmivpblmcubmnpi', service='api')
```

Look for errors mentioning dropped table names. Vercel runtime logs:

Via `mcp__claude_ai_Vercel__get_runtime_logs` para project `quimibond-intelligence`. Expected: 0 errors referencing dropped tables.

- [ ] **Step 8: Commit Batch 3**

```bash
git add supabase/migrations/20260422_sp1_03_drop_abandoned_tables.sql \
        docs/superpowers/plans/2026-04-21-silver-sp1-audit-notes.md
git commit -m "refactor(db): SP1 Batch 3 — drop 10 abandoned tables

User-approved 2026-04-21 (spec §12.3):
- agent_tickets (1958 rows, worker never runs)
- notification_queue (815 rows, 100% pending)
- health_scores (52152 rows, 100% contact_id NULL)

Spec §12.3 dead-pixel / stale / archive:
- unified_refresh_queue, reconciliation_summary_daily,
- odoo_schema_catalog, odoo_uoms, odoo_snapshots,
- odoo_invoices_archive_pre_dedup,
- odoo_invoices_archive_dup_cfdi_uuid_2026_04_20

Archives written to /tmp/sp1_archive_*.jsonl (reversible).
Audit: audit_runs invariant_key=sp1_batch3_tables_dropped"
git push
```

**Acceptance.** `pg_tables` count -10. 10 `schema_changes` rows with `change_type=DROP_TABLE`, `triggered_by=sp1_audit_prune`. Frontend build pass. 2h monitoring window clean.

---

### Task 7: Batch 4 — Drop frontend pages + API routes (gated)

**Scope.** Solo se ejecuta si Task 3 marcó algún page/route como `DROP CONFIRMED`. Si todos quedaron `KEEP` o `RE-EVALUATE` → skip Task 7, save plan para SP5.

**Typical candidates (spec §12.4-12.5):**
- `src/app/emails/` — standalone page (merged into /companies + /contacts tabs)
- `src/app/<decorative_dashboard>/` — agent status dashboards sin acción
- `src/app/api/pipeline/reconcile/` — superseded by engine SP4
- `src/app/api/pipeline/embeddings/` — unused post vector prune
- Any `/api/agents/*` with 0 traffic 30d (requires Vercel analytics)

**Files:**
- Delete (via `git rm`): `src/app/<confirmed pages>/**`
- Delete: `src/app/api/<confirmed routes>/**`
- Modify: `vercel.json` (drop cron entries)
- Modify: `src/components/<nav>` (drop links if any)
- Modify: `CLAUDE.md` (note removal)

**Steps:**

- [ ] **Step 1: Confirmar batch 4 lista final desde Task 3**

Filter audit-notes: `Category='DROP CONFIRMED'` AND (`Type='page'` OR `Type='route'`). List exact paths.

- [ ] **Step 2: Verify 30d traffic para routes (Vercel logs)**

Via `mcp__claude_ai_Vercel__get_runtime_logs(projectId=..., since='30d')` — agregar por path, confirmar 0 calls para routes flagged. Guardar outputs en audit-notes.

- [ ] **Step 3: Grep internal links a pages/routes a borrar**

```bash
cd /Users/jj/quimibond-intelligence/quimibond-intelligence
# Verify there are no internal <Link href=...> ni fetch('...') references
for item in <CONFIRMED_PATH_1> <CONFIRMED_PATH_2>; do
  rg -n -tts -tjson -e "$item" src 2>/dev/null
done
```

Expected: 0 matches except the page/route definitions themselves.

- [ ] **Step 4: ASK USER — Batch 4 OK**

**Message:**

```
Batch 4 (frontend) listo. A borrar:

Pages (git rm -r):
  - src/app/<path_1>/
  - src/app/<path_2>/

API routes (git rm -r):
  - src/app/api/<path_3>/
  - src/app/api/<path_4>/

vercel.json: remover crons:
  - { path: "/api/<route_3>", schedule: "..." }

Top-nav: sin cambios (verified 0 links)
CLAUDE.md: update referencia

Vercel traffic 30d: 0 calls a estas routes (evidence en audit-notes)

¿OK para aplicar git rm + commit?
```

Wait OK.

- [ ] **Step 5: Remove pages + routes**

```bash
cd /Users/jj/quimibond-intelligence/quimibond-intelligence
git rm -r src/app/<path_1>/
git rm -r src/app/<path_2>/
git rm -r src/app/api/<path_3>/
git rm -r src/app/api/<path_4>/
```

- [ ] **Step 6: Update `vercel.json`**

Editar `vercel.json` removiendo las entries de `crons[]` que apuntan a las routes dropeadas.

Before:
```json
{
  "crons": [
    { "path": "/api/pipeline/reconcile", "schedule": "*/30 * * * *" },
    { "path": "/api/pipeline/<otras>", "schedule": "..." }
  ]
}
```

After: delete only the lines for dropped routes.

- [ ] **Step 7: Update top-nav & CLAUDE.md**

If a page was linked from `src/components/Header.tsx` or similar, edit to remove link.

Update frontend `CLAUDE.md`:
- `## Paginas` table: remove row for dropped page
- `## API Routes` table: remove row for dropped route
- `## Crons (Vercel)` table: remove row for dropped cron

- [ ] **Step 8: Smoke test**

```bash
cd /Users/jj/quimibond-intelligence/quimibond-intelligence
npm run build 2>&1 | tail -30
```

Expected: build pass.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor(frontend): SP1 Batch 4 — drop <N> unused pages/routes

Pages removed (spec §12.4, 0 traffic 30d):
- <path_1>
- <path_2>

API routes removed (spec §12.5):
- /api/<route_3>
- /api/<route_4>

vercel.json crons updated. Top-nav unchanged (0 internal links).
CLAUDE.md sections Paginas/API Routes/Crons updated.

Evidence: docs/superpowers/plans/2026-04-21-silver-sp1-audit-notes.md"
git push
```

**Acceptance.** Build clean. No 404s post-deploy (user monitors). Grep of dropped paths returns 0 except inside the DB archives.

**Note.** If Task 3 did NOT flag any page/route as DROP CONFIRMED (everything went MIGRATE FIRST or KEEP or RE-EVALUATE), mark this task as **SKIPPED** in audit-notes and proceed to Task 8.

---

### Task 8: Update `refresh_all_matviews()` to reflect post-drop MV set

**Purpose.** Post-Batch 2, la función `public.refresh_all_matviews()` aún intenta refrescar las MVs dropeadas → el próximo cron (max 2h) fallará con `relation does not exist`. Esta task reescribe el body.

**CRITICAL.** Debe correrse inmediatamente después de Task 5 (Batch 2) — antes del próximo cron de refresh.

**Current body (verified 2026-04-21):**

```sql
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.company_profile;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.company_profile_sat;
  REFRESH MATERIALIZED VIEW monthly_revenue_by_company;
  REFRESH MATERIALIZED VIEW portfolio_concentration;
  REFRESH MATERIALIZED VIEW ar_aging_detail;
  REFRESH MATERIALIZED VIEW accounting_anomalies;
  REFRESH MATERIALIZED VIEW customer_cohorts;
  REFRESH MATERIALIZED VIEW customer_margin_analysis;
  REFRESH MATERIALIZED VIEW customer_product_matrix;
  REFRESH MATERIALIZED VIEW supplier_product_matrix;
  REFRESH MATERIALIZED VIEW dead_stock_analysis;
  REFRESH MATERIALIZED VIEW inventory_velocity;
  REFRESH MATERIALIZED VIEW ops_delivery_health_weekly;
  REFRESH MATERIALIZED VIEW product_real_cost;
  REFRESH MATERIALIZED VIEW product_margin_analysis;
  REFRESH MATERIALIZED VIEW product_seasonality;
  REFRESH MATERIALIZED VIEW purchase_price_intelligence;
  REFRESH MATERIALIZED VIEW supplier_concentration_herfindahl;
  REFRESH MATERIALIZED VIEW company_email_intelligence;
  REFRESH MATERIALIZED VIEW company_handlers;
  REFRESH MATERIALIZED VIEW company_insight_history;
  REFRESH MATERIALIZED VIEW cross_director_signals;
  REFRESH MATERIALIZED VIEW cashflow_projection;
  REFRESH MATERIALIZED VIEW real_sale_price;
  REFRESH MATERIALIZED VIEW supplier_price_index;
  REFRESH MATERIALIZED VIEW company_narrative;
  REFRESH MATERIALIZED VIEW customer_ltv_health;
  REFRESH MATERIALIZED VIEW payment_predictions;
  REFRESH MATERIALIZED VIEW client_reorder_predictions;
  REFRESH MATERIALIZED VIEW rfm_segments;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.journal_flow_profile;
  REFRESH MATERIALIZED VIEW public.products_unified;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.product_price_history;
  -- Fase 2.6: nueva MV fiscal goldmine
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.syntage_invoices_enriched;
  RAISE NOTICE 'All 34 materialized views refreshed successfully';
END;
```

**Files:**
- Create: `supabase/migrations/20260422_sp1_04_update_refresh_all_matviews.sql`

**Steps:**

- [ ] **Step 1: Compute surviving MV set**

```sql
-- Actual matviews remaining post-Batch 2
SELECT matviewname FROM pg_matviews WHERE schemaname='public' ORDER BY matviewname;
```

Compare against above list. Identify which lines must be removed.

- [ ] **Step 2: Check for `real_sale_price`**

Old body refs `real_sale_price` but pre-baseline query didn't list it. Verify:

```sql
SELECT matviewname FROM pg_matviews WHERE schemaname='public' AND matviewname='real_sale_price';
```

If it doesn't exist even pre-Batch 2 → current function already broken (known issue); new body just skips it.

- [ ] **Step 3: Escribir migration `20260422_sp1_04_update_refresh_all_matviews.sql`**

```sql
-- Silver SP1 — refresh_all_matviews cleanup post-Batch 2
-- Plan: 2026-04-21-silver-sp1-audit-prune.md Task 8
-- Purpose: remove dropped MVs from function body; avoid cron failure.
BEGIN;

CREATE OR REPLACE FUNCTION public.refresh_all_matviews()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- SP1: only refresh surviving MVs
  -- List generated from `SELECT matviewname FROM pg_matviews WHERE schemaname='public' ORDER BY matviewname` post-Batch 2
  <ONE REFRESH STATEMENT PER SURVIVING MV, using CONCURRENTLY where the MV has a UNIQUE INDEX>
  -- Example fills:
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.<mv_1>;
  REFRESH MATERIALIZED VIEW public.<mv_2>;
  -- ... etc
  RAISE NOTICE 'refresh_all_matviews: % MVs refreshed',
    (SELECT count(*) FROM pg_matviews WHERE schemaname='public');
END;
$$;

INSERT INTO public.schema_changes (change_type, table_name, description, sql_executed, triggered_by, success, created_at)
VALUES (
  'ALTER_FUNCTION','refresh_all_matviews',
  'SP1: rewrote refresh_all_matviews body to reflect post-Batch 2 MV set. Removed <N> dropped MVs.',
  'CREATE OR REPLACE FUNCTION public.refresh_all_matviews()...','sp1_audit_prune',true,now()
);

COMMIT;

-- Post-update smoke: call once, verify no error
SELECT public.refresh_all_matviews();
```

**Note.** `CONCURRENTLY` requires UNIQUE INDEX on the MV. Antes de aplicar, verify which MVs have it:

```sql
SELECT m.matviewname,
       EXISTS (
         SELECT 1 FROM pg_index i
         JOIN pg_class c ON c.oid=i.indrelid
         WHERE i.indisunique AND c.relname=m.matviewname
           AND c.relnamespace='public'::regnamespace
       ) AS has_unique
FROM pg_matviews m
WHERE m.schemaname='public'
ORDER BY m.matviewname;
```

MVs con `has_unique=false` se refrescan sin CONCURRENTLY.

- [ ] **Step 4: ASK USER — Task 8 OK**

**Message:**

```
Task 8 listo: reescribir refresh_all_matviews body.

MVs sobrevivientes post-Batch 2: <N>
MVs removidas del body: <M>
MVs con CONCURRENTLY (tienen UNIQUE INDEX): <X>
MVs sin CONCURRENTLY: <Y>

Migration: 20260422_sp1_04_update_refresh_all_matviews.sql
Post-apply smoke: SELECT public.refresh_all_matviews() ejecutará once.

Esto debe aplicarse ANTES del próximo cron refresh (cada 2h).
¿Aplico?
```

Wait OK.

- [ ] **Step 5: Apply + smoke**

Via `mcp__claude_ai_Supabase__apply_migration(name='20260422_sp1_04_update_refresh_all_matviews', query=<body>)`.

Then separately:

```sql
SELECT public.refresh_all_matviews();
-- Expected: NOTICE "refresh_all_matviews: <N> MVs refreshed"
-- No error
```

Record execution time + output in audit-notes.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260422_sp1_04_update_refresh_all_matviews.sql \
        docs/superpowers/plans/2026-04-21-silver-sp1-audit-notes.md
git commit -m "fix(db): SP1 Task 8 — refresh_all_matviews reflects post-drop MV set

Removed <M> dropped MVs from function body (Batch 2 artifacts).
Surviving: <N>. Smoke test: SELECT refresh_all_matviews() passes.

Prevents cron failure (runs every 2h). Required immediately after
Task 5 execution."
git push
```

**Acceptance.** `SELECT public.refresh_all_matviews()` completes without error. `pg_get_functiondef('public.refresh_all_matviews()'::regprocedure)` no longer contains any dropped MV name.

---

## Fase C — Close

### Task 9: Post-audit snapshot + memoria + CLAUDE.md + self-review

**Purpose.** Capturar el estado final, actualizar memoria del proyecto, asegurar que SP2 parte de una base documentada.

**Files:**
- Create: `supabase/migrations/20260422_sp1_99_final.sql`
- Modify: `docs/superpowers/plans/2026-04-21-silver-sp1-audit-notes.md` (section Después + signoff log)
- Modify: `/Users/jj/.claude/projects/-Users-jj/memory/project_supabase_audit_2026_04_19.md`
- Modify: `CLAUDE.md` (frontend, section Base de datos / refresh function)

**Steps:**

- [ ] **Step 1: Re-run baseline queries → capture Después**

```sql
SELECT
  (SELECT count(*) FROM pg_views WHERE schemaname='public') AS total_views,
  (SELECT count(*) FROM pg_matviews WHERE schemaname='public') AS total_mvs,
  (SELECT count(*) FROM pg_tables WHERE schemaname='public') AS total_tables,
  (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace) AS total_fns,
  (SELECT count(*) FROM pg_views WHERE schemaname='public' AND viewname LIKE 'v_audit_%') AS v_audit_count,
  (SELECT count(*) FROM schema_changes WHERE triggered_by='sp1_audit_prune') AS sp1_ops_total;
```

Paste into audit-notes §Después.

- [ ] **Step 2: Compute delta**

```sql
-- Calcular diferencia vs baseline (Task 0 audit_runs entry)
SELECT
  b.run_at AS baseline_at,
  (b.details->>'total_views')::int AS views_before,
  (SELECT count(*) FROM pg_views WHERE schemaname='public') AS views_after,
  (b.details->>'total_mvs')::int AS mvs_before,
  (SELECT count(*) FROM pg_matviews WHERE schemaname='public') AS mvs_after,
  (b.details->>'total_tables')::int AS tables_before,
  (SELECT count(*) FROM pg_tables WHERE schemaname='public') AS tables_after
FROM audit_runs b
WHERE b.invariant_key='sp1_pre_silver_baseline'
ORDER BY b.run_at DESC LIMIT 1;
```

Paste delta table in audit-notes.

- [ ] **Step 3: Escribir migration `20260422_sp1_99_final.sql`**

```sql
-- Silver SP1 final snapshot
BEGIN;

INSERT INTO public.audit_runs (run_id, invariant_key, bucket_key, severity, source, model, details, run_at)
SELECT gen_random_uuid(),'sp1_audit_prune_done','sp1','ok','supabase','sp1_audit_prune',
  jsonb_build_object(
    'total_views',(SELECT count(*) FROM pg_views WHERE schemaname='public'),
    'total_mvs',(SELECT count(*) FROM pg_matviews WHERE schemaname='public'),
    'total_tables',(SELECT count(*) FROM pg_tables WHERE schemaname='public'),
    'total_fns',(SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace),
    'v_audit_count',(SELECT count(*) FROM pg_views WHERE schemaname='public' AND viewname LIKE 'v_audit_%'),
    'sp1_ops_total',(SELECT count(*) FROM schema_changes WHERE triggered_by='sp1_audit_prune'),
    'sp1_batches',jsonb_build_object(
      'batch1_views_dropped',(SELECT count(*) FROM schema_changes WHERE triggered_by='sp1_audit_prune' AND change_type='DROP_VIEW'),
      'batch2_mvs_dropped',(SELECT count(*) FROM schema_changes WHERE triggered_by='sp1_audit_prune' AND change_type='DROP_MATVIEW'),
      'batch3_tables_dropped',(SELECT count(*) FROM schema_changes WHERE triggered_by='sp1_audit_prune' AND change_type='DROP_TABLE'),
      'refresh_fn_updated',(SELECT count(*) FROM schema_changes WHERE triggered_by='sp1_audit_prune' AND change_type='ALTER_FUNCTION')
    ),
    'closed_at','2026-04-XX'  -- fill actual date
  ), now();

COMMIT;
```

Apply via `mcp__claude_ai_Supabase__apply_migration`.

- [ ] **Step 4: Update memoria**

Edit `/Users/jj/.claude/projects/-Users-jj/memory/project_supabase_audit_2026_04_19.md`. Append section:

```markdown
## SP1 Silver Audit + Prune (2026-04-XX)

**Status:** COMPLETE (merged to main).
**Branch:** silver-sp1-audit-prune → merged.
**Spec:** 2026-04-21-silver-architecture.md §11 SP1 + §12.

**Results:**
- Views dropped: N (list)
- MVs dropped: M (list)
- Tables dropped: 10 (agent_tickets, notification_queue, health_scores + 7 more)
- Frontend pages/routes dropped: P
- refresh_all_matviews rewritten

**Baseline → post:** 77→X views, 39→Y MVs, 77→Z tables.

**Next:** SP2 Cat A canonical_invoices/payments/credit_notes/tax_events.
Depends on SP0 addon fix deployed to prod.
```

- [ ] **Step 5: Update frontend `CLAUDE.md`**

Edit `/Users/jj/quimibond-intelligence/quimibond-intelligence/CLAUDE.md`:
- In `## Base de datos`, remove bullet mentions of dropped tables (agent_tickets, notification_queue, health_scores if mentioned explicitly).
- Add note at end:

```markdown
### Silver SP1 cleanup (2026-04-XX)

Dropped 10 tables / N views / M MVs per spec §12. See
docs/superpowers/plans/2026-04-21-silver-sp1-audit-notes.md
for the full per-item audit trail.

refresh_all_matviews now refreshes <X> MVs (was 34 pre-SP1).
```

- [ ] **Step 6: Self-review**

Run the Self-review checklist at end of this plan. Any `[ ]` still open → resolve or document.

- [ ] **Step 7: Final commit**

```bash
cd /Users/jj/quimibond-intelligence/quimibond-intelligence
git add supabase/migrations/20260422_sp1_99_final.sql \
        docs/superpowers/plans/2026-04-21-silver-sp1-audit-notes.md \
        CLAUDE.md
git commit -m "docs(sp1): SP1 audit+prune complete — ready for SP2

Final snapshot captured. memoria + CLAUDE.md updated.

Deltas:
- Views: 77 → <X>
- MVs:   39 → <Y>
- Tables: 77 → <Z>

Branch ready to merge to main.
Audit-notes: docs/superpowers/plans/2026-04-21-silver-sp1-audit-notes.md
Next: SP2 Cat A Reconciliation Core (spec §11)."
git push
```

- [ ] **Step 8: ASK USER — merge decision**

**Message:**

```
SP1 complete. Branch silver-sp1-audit-prune ready.

Summary:
- Batch 1 views dropped: N
- Batch 2 MVs dropped: M
- Batch 3 tables dropped: 10
- Batch 4 frontend: <skipped/P items>
- refresh_all_matviews cleaned up

Audit: docs/superpowers/plans/2026-04-21-silver-sp1-audit-notes.md
migrations: 20260422_sp1_{00,01,02,03,04,99}.sql (+ optional 05)

¿Mergeo a main? O prefieres PR a GitHub para review primero?
```

**Acceptance.** Commit final pushed. audit-notes.md "Después" populated. Memoria + frontend CLAUDE.md updated. User gives merge signoff.

---

## Self-review checklist

- [ ] Todos los 38+ candidatos listados en spec §12 tienen row en `audit-notes.md` Categorization table (16 views + 25+ MVs + 13 tables + pages + routes).
- [ ] Per-candidate: **frontend callers column populated** (file:line triples o `(none)`).
- [ ] Per-candidate: **DB dependencies column populated** (pg_depend + function refs, o `(none)`).
- [ ] Per-candidate: **category assigned** (DROP CONFIRMED / MIGRATE FIRST / KEEP / RE-EVALUATE) — **0 items "TBD" or "decidir después"**.
- [ ] Each batch (Tasks 4-7) has explicit "ASK USER" gate before apply, with exact copy-paste message template.
- [ ] Each migration uses `BEGIN; ... COMMIT;` and `DROP X IF EXISTS ... RESTRICT` (no CASCADE).
- [ ] Each migration writes to `schema_changes (change_type, table_name, description, sql_executed, triggered_by, success, created_at)` — exact column list.
- [ ] Each batch ends with a smoke test (SQL + `npm run build` frontend).
- [ ] Task 8 (`refresh_all_matviews` cleanup) runs **immediately after Task 5 (Batch 2)** to prevent cron failure.
- [ ] Tables `> 100 rows` archived to `/tmp/sp1_archive_*.jsonl` before DROP (reversibility).
- [ ] `v_audit_*` (21 views) **NOT touched** (spec §12.1 KEEP explicit exception).
- [ ] `invoice_bridge_manual`, `payment_bridge_manual`, `products_fiscal_map` **NOT dropped** in SP1 (defer SP2/SP3 MDM migration).
- [ ] `invoices_unified`, `payments_unified`, `syntage_invoices_enriched`, `products_unified`, `company_profile*`, `monthly_revenue_by_company` **NOT dropped** in SP1 (defer SP5 post-cutover).
- [ ] Final `audit_runs` entry `sp1_audit_prune_done` contains delta counts + batch summary.
- [ ] `refresh_all_matviews()` regenerada sin referencias a MVs dropeadas; smoke `SELECT refresh_all_matviews()` pasa.
- [ ] Branch commits lineales, sin force-pushes, sin amends (per CLAUDE.md git safety).
- [ ] No canonical_* tables creadas en SP1 (SP2+ scope).

---

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Drop breaks hidden caller (grep missed something) | Medium | Task 1 grep es exhaustivo (patterns en paralelo sobre src/ + vercel.json + addon). 2h monitoring window post-Batch 3 via Supabase + Vercel logs. Rollback docs en Task 4 Step 7. |
| Drop breaks MV dependency chain | Medium | Task 2 `pg_depend` reverse lookup + Task 5 Step 1 re-check antes de cada apply. `RESTRICT` (no CASCADE) aborta con error loud. |
| `refresh_all_matviews` runs before Task 8 (cron every 2h) | High | Task 8 es next-after-Task-5 en el plan; commit message enfatiza "CRITICAL run immediately after Task 5". Operator debe minimizar window entre Batches 2 y Task 8 (< 2h). |
| User changes mind per-batch mid-execution | Low | Gated commits — cada batch es su propia migration + commit. User puede abortar entre Task 4/5/6/7; Task 9 aún cierra con state real (no assumes all batches executed). |
| Archive files (/tmp) perdidos antes de confirmation | Low | /tmp survives across shell runs within session. Migration references the path in description; user puede copiar a ~/Documents/sp1-archives/ si quiere retención. |
| Tabla que `agent_tickets` drop rompe alguna tabla `agent_*` (ej. `agent_runs`) | Low | Task 2 Step 5 reverse-FK check retorna 0 rows (pre-verified). `RESTRICT` es safety net. |
| Spec §12.2 "DECIDE SP5" MVs (company_email_intelligence etc.) dropeadas prematuramente | Low | Task 3 categorization rule 4 marca estas como `KEEP` o `RE-EVALUATE`; solo dropea si user explícitamente OK en signoff. |
| Frontend `npm run build` falla post-drop | Low | Each batch runs build. Failure triggers rollback in Step 7 de esa task. |
| `CREATE OR REPLACE FUNCTION refresh_all_matviews` uses CONCURRENTLY on MV sin UNIQUE INDEX | Low | Task 8 Step 3 query verifica `has_unique` per MV; fallback a non-CONCURRENTLY. |

---

## Definition of Done (SP1)

Criterios concretos para declarar SP1 completo:

1. **Audit completo.** audit-notes.md Categorization table tiene row por cada candidato de spec §12 (16 views + 25+ MVs + 13 tables + N pages/routes). 0 rows "TBD".
2. **Evidencia dual por row.** Cada row tiene Frontend callers column + DB dependencies column populadas (vacío `(none)` explícito vs unpopulated).
3. **User signoff por batch.** audit-notes.md §User signoff log tiene entry con fecha + mensaje del user por cada batch ejecutado (o SKIP documentado).
4. **Drops ejecutados matchean signoff.** `schema_changes WHERE triggered_by='sp1_audit_prune'` tiene N rows, donde N = sum de candidates DROP CONFIRMED en audit-notes.
5. **Counts caen según delta.** `pg_views/matviews/tables` post-SP1 = baseline - (drops executed). Verificable en audit_runs `sp1_audit_prune_done` vs `sp1_pre_silver_baseline`.
6. **refresh_all_matviews healthy.** `SELECT refresh_all_matviews()` ejecuta sin error; function body no contiene nombres de MVs dropeadas.
7. **Frontend build clean.** `npm run build` pasa en HEAD de `silver-sp1-audit-prune`.
8. **0 post-drop errors en prod logs.** 24h de Supabase + Vercel logs post-cierre sin errores referenciando objetos dropeados.
9. **Branch ready.** `silver-sp1-audit-prune` con ≥ 6 commits lineales (Task 0, Task 1, Task 3, Task 4-7 each, Task 8, Task 9), pushed, sin force-push.
10. **SP2 unblocked.** SP0 addon fix status confirmado en memoria (deploy a prod pendiente o completado); SP2 puede iniciar con canonical_* construction sobre base limpia.

---

## Appendix A — Full drop candidate inventory (from spec §12, verificado 2026-04-21)

### A.1 Views (16 candidates — spec §12.1)

| # | View | Spec default | Est. category | Notes |
|---|---|---|---|---|
| 1 | `unified_invoices` | DROP (legacy wrapper) | MIGRATE FIRST likely (SP5) | Legacy compat over `invoices_unified` MV |
| 2 | `unified_payment_allocations` | DROP (legacy wrapper) | MIGRATE FIRST likely | |
| 3 | `invoice_bridge` | DROP (superseded) | MIGRATE FIRST likely | 96k rows, used frontend |
| 4 | `orders_unified` | DROP | MIGRATE FIRST likely | Used frontend |
| 5 | `order_fulfillment_bridge` | DROP | MIGRATE FIRST likely | |
| 6 | `person_unified` | DROP | MIGRATE FIRST likely | |
| 7 | `cash_position` | DROP | Task 3 decide | Subsumed by gold_cashflow |
| 8 | `working_capital` | DROP | Task 3 decide | Duplicated with cfo_dashboard |
| 9 | `working_capital_cycle` | DROP | Task 3 decide | Same |
| 10 | `cashflow_current_cash` | DROP | Task 3 decide | Over-fragmented |
| 11 | `cashflow_liquidity_metrics` | DROP | Task 3 decide | |
| 12 | `monthly_revenue_trend` | DEFERRED | KEEP (defer SP4 consolidation) | Spec user decision 2026-04-21 |
| 13 | `analytics_customer_360` | DROP | Task 3 decide | Pre-gold replacement |
| 14 | `balance_sheet` | DROP (with addon fix) | KEEP likely | Buggy equity_unaffected; refine in SP4 |
| 15 | `pl_estado_resultados` | DROP | KEEP likely | Used financial page; replace SP4 |
| 16 | `revenue_concentration` | DROP | Task 3 decide | Duplicated |

Plus `portfolio_concentration` in spec §12.1 is actually a **MV** — classified in A.2.

### A.2 Materialized Views (25 candidates in drop/rebuild section — spec §12.2)

Large, defer SP5 post-cutover:
- `invoices_unified` (66 MB)
- `payments_unified` (25 MB)
- `syntage_invoices_enriched` (49 MB) — spec says DROP after SP2
- `products_unified`
- `company_profile`, `company_profile_sat`
- `monthly_revenue_by_company`

Rebuild or drop in SP4:
- `product_margin_analysis`, `customer_margin_analysis`
- `customer_ltv_health`, `customer_product_matrix`, `supplier_product_matrix`
- `supplier_price_index`, `supplier_concentration_herfindahl`
- `partner_payment_profile`, `account_payment_profile`, `portfolio_concentration`
- `rfm_segments`, `customer_cohorts`

Agent-specific (decide SP5):
- `company_email_intelligence`, `company_handlers`, `company_insight_history`, `company_narrative`, `cross_director_signals`

KEEP + rewire (SP4/SP5):
- `inventory_velocity`, `dead_stock_analysis`, `stockout_queue` (view)
- `cashflow_projection`, `accounting_anomalies`, `ar_aging_detail`, `journal_flow_profile`
- `ops_delivery_health_weekly`, `purchase_price_intelligence`, `product_real_cost`, `product_seasonality`
- `payment_predictions`, `client_reorder_predictions`, `bom_duplicate_components`
- `product_price_history` (rebuild as gold)

### A.3 Tables (13 candidates — spec §12.3)

| # | Table | Rows | Spec default | SP1 action |
|---|---|---|---|---|
| 1 | `agent_tickets` | 1,958 | DROP CONFIRMED user 2026-04-21 | Batch 3 |
| 2 | `notification_queue` | 815 | DROP CONFIRMED user 2026-04-21 | Batch 3 |
| 3 | `health_scores` | 52,152 | DROP CONFIRMED user 2026-04-21 | Batch 3 |
| 4 | `unified_refresh_queue` | 0 | DROP | Batch 3 |
| 5 | `reconciliation_summary_daily` | 2 | DROP | Batch 3 |
| 6 | `odoo_schema_catalog` | 3,820 | DROP (dead-pixel) | Batch 3 |
| 7 | `odoo_uoms` | 76 | DROP (dead-pixel) | Batch 3 |
| 8 | `odoo_snapshots` | 21,783 | DROP (replaced) | Batch 3 |
| 9 | `odoo_invoices_archive_pre_dedup` | 5,321 | DROP (archive) | Batch 3 |
| 10 | `odoo_invoices_archive_dup_cfdi_uuid_2026_04_20` | 5,321 | DROP (archive) | Batch 3 |
| 11 | `invoice_bridge_manual` | 0 | MIGRATE (SP2) | SKIP SP1 |
| 12 | `payment_bridge_manual` | 0 | MIGRATE (SP2) | SKIP SP1 |
| 13 | `products_fiscal_map` | 20 | MIGRATE (SP3) | SKIP SP1 |

### A.4 Frontend pages (§12.4, gated)

| # | Page | Spec default | SP1 action |
|---|---|---|---|
| 1 | `/dashboard` (if decorative) | Evaluate — keep if CEO uses | Task 3 audit |
| 2 | `/emails` (standalone top-nav) | Remove (merged tabs) | Task 3 audit |
| 3 | Agent status decorative dashboards | Fold `/system` | Task 3 audit |

Others to enumerate in Task 1 Step 5.

### A.5 API routes (§12.5)

| # | Route | Spec default | SP1 action |
|---|---|---|---|
| 1 | `/api/pipeline/reconcile` | DROP (cron-only, SP4 superseded) | Task 3 audit |
| 2 | `/api/pipeline/embeddings` | Evaluate SP5 | Task 3 audit |
| 3 | `/api/agents/*` 0-traffic 30d | DROP | Task 3 audit |

Full enumeration in Task 1 Step 6.

---

## Appendix B — Commands cheatsheet

```bash
# Branch
cd /Users/jj/quimibond-intelligence/quimibond-intelligence
git checkout -b silver-sp1-audit-prune main
git push -u origin silver-sp1-audit-prune

# Grep audit (views)
rg -n -tts -tjson -e '<pipe_joined_names>' src app vercel.json

# Build smoke
npm run build 2>&1 | tail -30

# Commit pattern
git add <paths>
git commit -m "<type>(<scope>): <subject>

<body>"
git push
```

```sql
-- Supabase apply migration
mcp__claude_ai_Supabase__apply_migration(project_id='tozqezmivpblmcubmnpi', name='<yyyymmdd>_sp1_XX_<desc>', query='<body>')

-- Read-only
mcp__claude_ai_Supabase__execute_sql(project_id='tozqezmivpblmcubmnpi', query='<q>')

-- Logs
mcp__claude_ai_Supabase__get_logs(project_id='tozqezmivpblmcubmnpi', service='api')
```

```sql
-- schema_changes INSERT template (column order hard-coded)
INSERT INTO public.schema_changes
  (change_type, table_name, description, sql_executed, triggered_by, success, created_at)
VALUES
  ('<DROP_VIEW|DROP_MATVIEW|DROP_TABLE|ALTER_FUNCTION>',
   '<object_name>',
   '<human-readable description w/ spec ref>',
   '<exact SQL that ran>',
   'sp1_audit_prune',
   true,
   now());

-- audit_runs INSERT template
INSERT INTO public.audit_runs
  (run_id, invariant_key, bucket_key, severity, source, model, details, run_at)
VALUES
  (gen_random_uuid(),
   '<sp1_*>',
   'sp1',
   'ok',
   'supabase',
   'sp1_audit_prune',
   jsonb_build_object(...),
   now());
```
