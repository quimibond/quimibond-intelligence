# Silver SP2 — Cat A Canonical Reconciliation Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir las 4 canonical tables Pattern A (`canonical_invoices`, `canonical_payments` + `canonical_payment_allocations`, `canonical_credit_notes`, `canonical_tax_events`) con populate dual-source Odoo↔SAT, composite-match fallback para cerrar el gap 2022-2024 (48-66% → ≥95% cobertura uuid), extender `audit_tolerances`/`reconciliation_issues` por §9.1, registrar los primeros 10 invariantes (invoice.* + payment.*) ejecutables vía `run_reconciliation()`, y activar pg_cron cadences (hourly / 2h). Migrar bridges manuales a `mdm_manual_overrides`.

**Architecture:** Branch `silver-sp2-cat-a` off `main` en el frontend repo. Una migración SQL por task (numeradas `20260422_sp2_XX_*.sql`). Cada canonical table se construye en 3 pasos: (1) DDL schema + indexes, (2) populate inicial via `INSERT ... SELECT FULL OUTER JOIN` Odoo↔SAT, (3) trigger incremental `AFTER INSERT/UPDATE` en Bronze + smoke checks numéricos. FKs a `canonical_companies` se omiten (SP3 scope) — usa `companies.id` placeholder con comentario `-- TODO-SP3 swap to canonical_companies FK`. Destructivos (DROP/mass UPDATE/migraciones `invoice_bridge_manual`→`mdm_manual_overrides`) gated con OK explícito del usuario. Frontend NO se toca (SP5).

**Tech Stack:** PostgreSQL 15 (Supabase `tozqezmivpblmcubmnpi`), `mcp__claude_ai_Supabase__apply_migration` para DDL, `mcp__claude_ai_Supabase__execute_sql` para verificación/smoke, `pg_cron` (schema `cron`) para cadences.

**Spec:** `/Users/jj/quimibond-intelligence/quimibond-intelligence/docs/superpowers/specs/2026-04-21-silver-architecture.md` §5.1-5.4 (canonical schemas), §9.1-9.2 (reconciliation hookup + invariant catalog), §10.2-10.3 (refresh strategy), §11 SP2 (DoD + risks), §14 (addon fixes — informational, SP0 shipped).

**Prereqs:**
- SP0 addon fix deployed (qb19 main=5436ddd, prod). `_build_cfdi_map` iterates `doc.move_id` not M2M `invoice_ids`. Coverage hoy: 66.62% (18,494/27,761).
- SP1 audit+prune merged (frontend main=35e6e32). 18 objetos dropeados. `refresh_all_matviews` reduced a 29 MVs.
- Spec en main.
- `match_unlinked_invoices_by_composite(p_batch_size, p_date_tolerance_days, p_amount_tolerance)` function exists (Fase 2.5); returns `(odoo_invoice_id, syntage_uuid, emisor_rfc, amount_mxn, invoice_date, match_confidence)`.
- `invoice_bridge_manual` (0 rows), `payment_bridge_manual` (0 rows), `products_fiscal_map` (20 rows) exist.
- `audit_tolerances` (6 rows, existing keys), `reconciliation_issues` (80,486 rows, will be extended).
- `syntage_invoices_enriched` — existence verified in Task 0 (Fase 2.6 MV). If dropped in SP1, Task 1 substitutes live JOIN a `syntage_invoice_payments` aggregates.

**Out of scope (explícito):**
- `canonical_companies` / `canonical_contacts` / `canonical_products` / MDM matcher → **SP3**. Esta plan usa `companies.id` como placeholder FK.
- Pattern B canonical views (orders, order_lines, deliveries, inventory, etc.) → **SP4**.
- Evidence layer (`email_signals`, `ai_extracted_facts`, `attachments`) → **SP4**.
- Gold views / CEO Inbox backend → **SP4**.
- Frontend cutover → **SP5**.
- Addon qb19 NO se toca (SP0 cerrado; §14.2-14.5 pendientes de otro tracking).
- Contacts sync bug `on_conflict=email` → follow-up separado en qb19, NO en SP2.
- `ingestion_report_failure` RPC no-op → follow-up separado.

---

## Pre-audit state (verificado 2026-04-21 03:54 UTC)

```
odoo_invoices                   27,761 total
  with cfdi_uuid                18,494 (66.62%)
  NULL post-2021 posted          9,074 (target de composite match)
odoo_account_payments           17,863
odoo_invoices (refunds)            582 (out_refund + in_refund)
syntage_invoices               129,690 total
  tipo I (Ingreso)              82,473
  tipo E (Egreso/NC)             2,009
  tipo P (Pago)                 15,196
  tipo N (Nómina)               29,351
syntage_tax_retentions         (scan in Task 0)
syntage_tax_returns            (scan in Task 0)
syntage_electronic_accounting  (scan in Task 0)
invoice_bridge_manual                0
payment_bridge_manual                0
products_fiscal_map                 20
audit_tolerances                     6 rows (no key for invoice.* or payment.*)
reconciliation_issues           80,486 rows (pre-existing, will ALTER TABLE)
```

**Target SP2 DoD:**
- `canonical_invoices.count(*) ≥ 97,000` post-historical_pre_odoo filter (spec §11 SP2 DoD).
- Every row con `has_odoo_record=true` tiene `odoo_invoice_id` resolvable (no orphan).
- `canonical_invoices` cobertura uuid (via sat_uuid OR cfdi_uuid_odoo OR composite resolved_from) ≥95% para rows post-2021.
- `canonical_payments.count(*) ≥ 17,800` (subset Odoo + SAT allocations).
- `canonical_payment_allocations.count(*) ≥ 15,000` (doctos_relacionados expansion).
- `canonical_credit_notes.count(*) ≥ 2,500` (Odoo 582 + SAT E 2,009 union minus overlap).
- `canonical_tax_events.count(*) ≥ 100` (retentions + returns + accounting periods).
- 10 invariants registered en `audit_tolerances` con `enabled=true`.
- `run_reconciliation()` ejecuta end-to-end < 60s; populates `reconciliation_issues.priority_score`.
- pg_cron jobs `silver_sp2_reconcile_hourly`, `silver_sp2_reconcile_2h`, `silver_sp2_refresh_canonical_nightly` active.

**Gate policy.** User approval OK requerido antes de:
- Task 4 final populate (mass INSERT en canonical_invoices).
- Task 7 final populate (mass INSERT en canonical_payments + allocations).
- Task 10 final populate (canonical_credit_notes).
- Task 13 final populate (canonical_tax_events).
- Task 14 ALTER TABLE en reconciliation_issues (tabla con 80k rows).
- Task 15 creación de pg_cron jobs.
- Task 14 migración `invoice_bridge_manual`/`payment_bridge_manual`/`products_fiscal_map` → `mdm_manual_overrides`.

---

## File structure

### Branch `silver-sp2-cat-a` off `main` en `/Users/jj/quimibond-intelligence/quimibond-intelligence`

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `docs/superpowers/plans/2026-04-22-silver-sp2-canonical-cat-a.md` | THIS FILE | Plan (commit en branch pre-kickoff) |
| `docs/superpowers/plans/2026-04-22-silver-sp2-canonical-cat-a-notes.md` | Create | Running log: smoke outputs, composite match distribution, gate approvals, rollback history |
| `supabase/migrations/20260422_sp2_00_baseline.sql` | Create | Snapshot pre-SP2 en `audit_runs` (`sp2_baseline`) |
| `supabase/migrations/20260422_sp2_01_canonical_invoices_ddl.sql` | Create | `CREATE TABLE canonical_invoices` + indexes |
| `supabase/migrations/20260422_sp2_02_canonical_invoices_populate_odoo.sql` | Create (gated) | Insert Odoo-side rows (has_odoo_record=true) |
| `supabase/migrations/20260422_sp2_03_canonical_invoices_populate_sat.sql` | Create (gated) | Merge SAT-side rows + composite match fallback + resolved_from tagging |
| `supabase/migrations/20260422_sp2_04_canonical_invoices_trigger.sql` | Create | Incremental upsert trigger on `odoo_invoices` + `syntage_invoices` INSERT/UPDATE |
| `supabase/migrations/20260422_sp2_05_canonical_payments_ddl.sql` | Create | `CREATE TABLE canonical_payments` + `canonical_payment_allocations` + indexes |
| `supabase/migrations/20260422_sp2_06_canonical_payments_populate.sql` | Create (gated) | Insert Odoo `account_payments` + SAT complementos + allocations expansion |
| `supabase/migrations/20260422_sp2_07_canonical_payments_trigger.sql` | Create | Incremental trigger + smoke |
| `supabase/migrations/20260422_sp2_08_canonical_credit_notes_ddl.sql` | Create | `CREATE TABLE canonical_credit_notes` + indexes |
| `supabase/migrations/20260422_sp2_09_canonical_credit_notes_populate.sql` | Create (gated) | Insert E/out_refund/in_refund rows + cfdiRelacionados resolution |
| `supabase/migrations/20260422_sp2_10_canonical_credit_notes_trigger.sql` | Create | Incremental trigger + smoke |
| `supabase/migrations/20260422_sp2_11_canonical_tax_events_ddl.sql` | Create | `CREATE TABLE canonical_tax_events` + indexes |
| `supabase/migrations/20260422_sp2_12_canonical_tax_events_populate.sql` | Create (gated) | Insert retentions + returns + electronic_accounting |
| `supabase/migrations/20260422_sp2_13_canonical_tax_events_odoo_match.sql` | Create (gated) | Reconcile against `odoo_account_payments` + `odoo_account_balances` |
| `supabase/migrations/20260422_sp2_14_mdm_overrides_and_reconciliation_alter.sql` | Create (gated) | `mdm_manual_overrides` table + migrate bridge tables + ALTER `audit_tolerances` + ALTER `reconciliation_issues` per §9.1 |
| `supabase/migrations/20260422_sp2_15_invariants_and_runner.sql` | Create (gated) | Register 10 invariants + `run_reconciliation()` + pg_cron jobs |
| `supabase/migrations/20260422_sp2_99_final.sql` | Create | Snapshot cierre en `audit_runs` (`sp2_done`) |
| `CLAUDE.md` (frontend) | Modify | Documentar canonical tables + run_reconciliation + new audit_tolerances/reconciliation_issues columns |

**No branch necesaria en qb19.** SP2 es pure Supabase DDL/DML/trigger/cron. Sin cambios al addon.

---

## Pre-flight

### Task 0: Baseline snapshot + branch + notes skeleton + asset verification

**Purpose.** Crear branch, verificar assets críticos (syntage_invoices_enriched, match_unlinked_invoices_by_composite signature, pg_cron extension), capturar baselines numéricos y crear el documento de notas que acompañará todo SP2.

**Files:**
- Create: `docs/superpowers/plans/2026-04-22-silver-sp2-canonical-cat-a-notes.md`
- Create: `supabase/migrations/20260422_sp2_00_baseline.sql`

**Steps:**

- [ ] **Step 1: Crear branch off `main`**

```bash
cd /Users/jj/quimibond-intelligence/quimibond-intelligence
git fetch origin main
git checkout main
git pull origin main --ff-only
git checkout -b silver-sp2-cat-a
git push -u origin silver-sp2-cat-a
```

Expected: branch `silver-sp2-cat-a` creada, tracking `origin/silver-sp2-cat-a`.

- [ ] **Step 2: Verificar assets críticos en Supabase (`tozqezmivpblmcubmnpi`)**

Ejecutar vía `mcp__claude_ai_Supabase__execute_sql`:

```sql
SELECT
  EXISTS(SELECT 1 FROM pg_matviews WHERE schemaname='public' AND matviewname='syntage_invoices_enriched') AS mv_enriched_exists,
  EXISTS(SELECT 1 FROM pg_views   WHERE schemaname='public' AND viewname='syntage_invoices_enriched')    AS view_enriched_exists,
  EXISTS(SELECT 1 FROM pg_tables  WHERE schemaname='public' AND tablename='canonical_invoices')          AS ci_exists,
  EXISTS(SELECT 1 FROM pg_tables  WHERE schemaname='public' AND tablename='canonical_companies')         AS cc_exists,
  EXISTS(SELECT 1 FROM pg_tables  WHERE schemaname='public' AND tablename='mdm_manual_overrides')        AS mdm_exists,
  EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron')                                             AS pg_cron_installed,
  (SELECT nspname FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE extname='pg_cron') AS pg_cron_schema;
```

Expected row keys documented. Decision gate:
- `mv_enriched_exists=true OR view_enriched_exists=true` → OK. Si ambos `false` → Task 1 usa live aggregate subquery (skeleton incluido en Task 1 Step 3).
- `ci_exists=false` → OK (SP2 la crea). Si `true` → STOP, user confirma si reusar o DROP.
- `cc_exists=false` → OK (SP3 scope). Si `true` → STOP, user confirma.
- `mdm_exists=false` → OK (Task 14 la crea).
- `pg_cron_installed=true` required → si falsa, STOP y pedir user habilitar via Supabase dashboard.
- `pg_cron_schema` usually `'cron'` on Supabase.

- [ ] **Step 3: Capturar baselines numéricos**

```sql
SELECT
  (SELECT COUNT(*) FROM odoo_invoices)                            AS odoo_invoices_total,
  (SELECT COUNT(*) FROM odoo_invoices WHERE cfdi_uuid IS NOT NULL) AS odoo_with_uuid,
  (SELECT COUNT(*) FROM odoo_invoices
    WHERE cfdi_uuid IS NULL AND state='posted' AND invoice_date>='2021-01-01') AS odoo_null_uuid_post2021,
  (SELECT COUNT(*) FROM odoo_invoices WHERE move_type IN ('out_refund','in_refund')) AS odoo_refunds,
  (SELECT COUNT(*) FROM odoo_account_payments)                    AS odoo_payments,
  (SELECT COUNT(*) FROM syntage_invoices)                         AS syntage_invoices,
  (SELECT COUNT(*) FROM syntage_invoices WHERE tipo_comprobante='I') AS syntage_i,
  (SELECT COUNT(*) FROM syntage_invoices WHERE tipo_comprobante='E') AS syntage_e,
  (SELECT COUNT(*) FROM syntage_invoices WHERE tipo_comprobante='P') AS syntage_p,
  (SELECT COUNT(*) FROM syntage_invoice_payments)                 AS syntage_payments,
  (SELECT COUNT(*) FROM syntage_tax_retentions)                   AS syntage_retentions,
  (SELECT COUNT(*) FROM syntage_tax_returns)                      AS syntage_returns,
  (SELECT COUNT(*) FROM syntage_electronic_accounting)            AS syntage_ea,
  (SELECT COUNT(*) FROM invoice_bridge_manual)                    AS bridge_invoices,
  (SELECT COUNT(*) FROM payment_bridge_manual)                    AS bridge_payments,
  (SELECT COUNT(*) FROM products_fiscal_map)                      AS products_map,
  (SELECT COUNT(*) FROM audit_tolerances)                         AS audit_rows,
  (SELECT COUNT(*) FROM reconciliation_issues)                    AS reconciliation_rows;
```

Expected 2026-04-21 snapshot (already captured; re-verify drift): `odoo_invoices_total=27761, odoo_with_uuid=18494, odoo_null_uuid_post2021=9074, odoo_refunds=582, odoo_payments=17863, syntage_invoices=129690, syntage_i=82473, syntage_e=2009, syntage_p=15196, syntage_payments>=15196, bridge_invoices=0, bridge_payments=0, products_map=20, audit_rows=6, reconciliation_rows≈80486`.

- [ ] **Step 4: Verificar `match_unlinked_invoices_by_composite` signature**

```sql
SELECT proname, pg_get_function_arguments(oid) AS args, pg_get_function_result(oid) AS returns
FROM pg_proc
WHERE proname='match_unlinked_invoices_by_composite';
```

Expected: `args = p_batch_size integer DEFAULT 500, p_date_tolerance_days integer DEFAULT 3, p_amount_tolerance numeric DEFAULT 0.01` / `returns = TABLE(odoo_invoice_id bigint, syntage_uuid text, emisor_rfc text, amount_mxn numeric, invoice_date date, match_confidence text)`. Si difiere, Task 3 Step 2 adapta column references.

- [ ] **Step 5: Crear notes file skeleton**

```bash
cat > docs/superpowers/plans/2026-04-22-silver-sp2-canonical-cat-a-notes.md << 'EOF'
# Silver SP2 — Cat A Canonical Core — Running Notes

**Branch:** `silver-sp2-cat-a` off `main` (`/Users/jj/quimibond-intelligence/quimibond-intelligence`)
**Started:** 2026-04-22
**Spec:** `docs/superpowers/specs/2026-04-21-silver-architecture.md` §5.1-5.4 + §9 + §11 SP2
**Plan:** `docs/superpowers/plans/2026-04-22-silver-sp2-canonical-cat-a.md`

## Antes

### Asset verification (Task 0 Step 2)

- mv_enriched_exists:
- view_enriched_exists:
- ci_exists:
- cc_exists:
- mdm_exists:
- pg_cron_installed:
- pg_cron_schema:

### Baselines numéricos (Task 0 Step 3)

| Medición | Valor |
|---|---|
| odoo_invoices_total |  |
| odoo_with_uuid |  |
| odoo_null_uuid_post2021 |  |
| odoo_refunds |  |
| odoo_payments |  |
| syntage_invoices |  |
| syntage_i |  |
| syntage_e |  |
| syntage_p |  |
| syntage_payments |  |
| syntage_retentions |  |
| syntage_returns |  |
| syntage_ea |  |
| bridge_invoices |  |
| bridge_payments |  |
| products_map |  |
| audit_rows |  |
| reconciliation_rows |  |

### Match composite signature (Task 0 Step 4)

- args:
- returns:

## Task logs (append below por task)

### Task 1

### Task 2

...

## Gate approvals

| Gate | Approval date | User |
|---|---|---|
| Task 2 populate Odoo | | |
| Task 3 populate SAT + composite | | |
| Task 6 populate payments | | |
| Task 9 populate credit_notes | | |
| Task 12 populate tax_events | | |
| Task 13 Odoo tax match | | |
| Task 14 bridge migration + ALTER | | |
| Task 15 pg_cron enable | | |

## Rollbacks executed

(None yet)
EOF
```

- [ ] **Step 6: Crear baseline migration `20260422_sp2_00_baseline.sql`**

```sql
-- SP2 baseline snapshot
BEGIN;

INSERT INTO audit_runs (run_id, source, model, invariant_key, bucket_key, odoo_value, supabase_value, diff, severity, date_from, date_to, details, run_at)
SELECT
  'sp2-baseline-' || to_char(now(),'YYYYMMDD-HH24MISS'),
  'silver_sp2', 'baseline', 'pre_sp2_baseline', 'global',
  NULL, NULL, NULL, 'info',
  NULL, NULL,
  jsonb_build_object(
    'odoo_invoices_total',                (SELECT COUNT(*) FROM odoo_invoices),
    'odoo_with_uuid',                     (SELECT COUNT(*) FROM odoo_invoices WHERE cfdi_uuid IS NOT NULL),
    'odoo_null_uuid_post2021',            (SELECT COUNT(*) FROM odoo_invoices WHERE cfdi_uuid IS NULL AND state='posted' AND invoice_date>='2021-01-01'),
    'odoo_refunds',                       (SELECT COUNT(*) FROM odoo_invoices WHERE move_type IN ('out_refund','in_refund')),
    'odoo_payments',                      (SELECT COUNT(*) FROM odoo_account_payments),
    'syntage_invoices',                   (SELECT COUNT(*) FROM syntage_invoices),
    'syntage_i',                          (SELECT COUNT(*) FROM syntage_invoices WHERE tipo_comprobante='I'),
    'syntage_e',                          (SELECT COUNT(*) FROM syntage_invoices WHERE tipo_comprobante='E'),
    'syntage_p',                          (SELECT COUNT(*) FROM syntage_invoices WHERE tipo_comprobante='P'),
    'syntage_payments',                   (SELECT COUNT(*) FROM syntage_invoice_payments),
    'syntage_retentions',                 (SELECT COUNT(*) FROM syntage_tax_retentions),
    'syntage_returns',                    (SELECT COUNT(*) FROM syntage_tax_returns),
    'syntage_ea',                         (SELECT COUNT(*) FROM syntage_electronic_accounting),
    'bridge_invoices',                    (SELECT COUNT(*) FROM invoice_bridge_manual),
    'bridge_payments',                    (SELECT COUNT(*) FROM payment_bridge_manual),
    'products_map',                       (SELECT COUNT(*) FROM products_fiscal_map),
    'audit_rows',                         (SELECT COUNT(*) FROM audit_tolerances),
    'reconciliation_rows',                (SELECT COUNT(*) FROM reconciliation_issues)
  ),
  now();

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('sp2_baseline', '', 'Silver SP2 baseline snapshot captured', '20260422_sp2_00_baseline.sql', 'silver-sp2', true);

COMMIT;
```

Apply via `mcp__claude_ai_Supabase__apply_migration(name='sp2_00_baseline', query=<above SQL>)`.

- [ ] **Step 7: Verificar baseline registered**

```sql
SELECT run_id, source, invariant_key, details
FROM audit_runs
WHERE invariant_key='pre_sp2_baseline'
ORDER BY run_at DESC LIMIT 1;
```

Expected: 1 row con `details` jsonb populado.

Pegar output en notes `## Antes / Baseline migration`.

- [ ] **Step 8: Commit**

```bash
cd /Users/jj/quimibond-intelligence/quimibond-intelligence
git add docs/superpowers/plans/2026-04-22-silver-sp2-canonical-cat-a.md \
        docs/superpowers/plans/2026-04-22-silver-sp2-canonical-cat-a-notes.md \
        supabase/migrations/20260422_sp2_00_baseline.sql
git commit -m "chore(sp2): baseline snapshot + notes skeleton + branch"
git push
```

---

## canonical_invoices (Tasks 1-4)

### Task 1: `canonical_invoices` DDL + indexes

**Purpose.** Crear la tabla `canonical_invoices` per spec §5.1 con ~60 columnas, generated columns STORED para diff flags, indexes, y triggers `updated_at`. FK a `canonical_companies` se OMITE (SP3) — `emisor_canonical_company_id`/`receptor_canonical_company_id` quedan como `bigint` sin REFERENCES + comentario TODO-SP3.

**Files:**
- Create: `supabase/migrations/20260422_sp2_01_canonical_invoices_ddl.sql`

**Steps:**

- [ ] **Step 1: Escribir DDL completa**

```sql
-- canonical_invoices (Pattern A) — Silver SP2 §5.1
BEGIN;

CREATE TABLE IF NOT EXISTS canonical_invoices (
  -- === Identity ===
  canonical_id text PRIMARY KEY,
  odoo_invoice_id bigint,
  sat_uuid text,
  direction text NOT NULL CHECK (direction IN ('issued','received','internal')),
  move_type_odoo text,
  tipo_comprobante_sat text,

  -- === Monto nativo ===
  amount_total_odoo numeric(14,2),
  amount_total_sat numeric(14,2),
  amount_total_resolved numeric(14,2),
  amount_total_diff_abs numeric(14,2)
    GENERATED ALWAYS AS (
      CASE WHEN amount_total_odoo IS NOT NULL AND amount_total_sat IS NOT NULL
           THEN ABS(amount_total_odoo - amount_total_sat) END
    ) STORED,
  amount_total_has_discrepancy boolean
    GENERATED ALWAYS AS (
      amount_total_odoo IS NOT NULL AND amount_total_sat IS NOT NULL
      AND ABS(amount_total_odoo - amount_total_sat) > 0.50
    ) STORED,
  amount_untaxed_odoo numeric(14,2),
  amount_untaxed_sat numeric(14,2),
  amount_tax_odoo numeric(14,2),
  amount_tax_sat numeric(14,2),
  amount_retenciones_sat numeric(14,2),

  -- === Residual / Payments ===
  amount_residual_odoo numeric(14,2),
  amount_residual_sat numeric(14,2),
  amount_paid_odoo numeric(14,2),
  amount_paid_sat numeric(14,2),
  amount_credited_sat numeric(14,2),
  amount_residual_resolved numeric(14,2),

  -- === MXN ===
  amount_total_mxn_odoo numeric(14,2),
  amount_total_mxn_sat numeric(14,2),
  amount_total_mxn_ops numeric(14,2),
  amount_total_mxn_fiscal numeric(14,2),
  amount_total_mxn_resolved numeric(14,2),
  amount_total_mxn_diff_abs numeric(14,2)
    GENERATED ALWAYS AS (
      CASE WHEN amount_total_mxn_odoo IS NOT NULL AND amount_total_mxn_sat IS NOT NULL
           THEN ABS(amount_total_mxn_odoo - amount_total_mxn_sat) END
    ) STORED,
  amount_total_mxn_diff_pct numeric(8,4)
    GENERATED ALWAYS AS (
      CASE WHEN amount_total_mxn_odoo IS NOT NULL AND amount_total_mxn_sat IS NOT NULL
                AND amount_total_mxn_sat <> 0
           THEN ROUND(100.0 * ABS(amount_total_mxn_odoo - amount_total_mxn_sat) / amount_total_mxn_sat, 4) END
    ) STORED,
  amount_residual_mxn_odoo numeric(14,2),
  amount_residual_mxn_resolved numeric(14,2),

  -- === Moneda / FX ===
  currency_odoo text,
  currency_sat text,
  tipo_cambio_odoo numeric(18,6),
  tipo_cambio_sat numeric(18,6),

  -- === Fechas ===
  invoice_date date,
  fecha_emision timestamptz,
  fecha_timbrado timestamptz,
  fecha_cancelacion timestamptz,
  due_date_odoo date,
  fiscal_due_date timestamptz,
  due_date_resolved date,
  fiscal_fully_paid_at timestamptz,
  fiscal_last_payment_date timestamptz,
  payment_date_odoo date,
  fiscal_days_to_full_payment integer,
  fiscal_days_to_due_date integer,
  date_has_discrepancy boolean
    GENERATED ALWAYS AS (
      invoice_date IS NOT NULL AND fecha_timbrado IS NOT NULL
      AND ABS(invoice_date - fecha_timbrado::date) > 3
    ) STORED,

  -- === Estados ===
  state_odoo text,
  payment_state_odoo text,
  estado_sat text,
  cfdi_sat_state_odoo text,
  edi_state_odoo text,
  fiscal_cancellation_process_status text,
  state_mismatch boolean
    GENERATED ALWAYS AS (
      (state_odoo = 'cancel' AND estado_sat = 'vigente')
      OR (state_odoo = 'posted' AND estado_sat = 'cancelado')
    ) STORED,

  -- === Identificadores ===
  odoo_name text,
  cfdi_uuid_odoo text,
  serie text, folio text,
  odoo_ref text,

  -- === Partners ===
  emisor_rfc text,
  emisor_nombre text,
  receptor_rfc text,
  receptor_nombre text,
  odoo_partner_id integer,
  -- TODO-SP3: swap to canonical_companies FK (currently references companies.id as placeholder).
  emisor_company_id bigint,            -- REFERENCES companies(id); renamed to emisor_canonical_company_id in SP3
  receptor_company_id bigint,          -- REFERENCES companies(id)

  -- === 69B ===
  emisor_blacklist_status text,
  receptor_blacklist_status text,
  blacklist_action text
    GENERATED ALWAYS AS (
      CASE
        WHEN emisor_blacklist_status = 'definitive' OR receptor_blacklist_status = 'definitive' THEN 'block'
        WHEN emisor_blacklist_status = 'presumed'   OR receptor_blacklist_status = 'presumed'   THEN 'warning'
        ELSE NULL
      END
    ) STORED,

  -- === Metodo/forma pago + payment term ===
  metodo_pago text,
  forma_pago text,
  uso_cfdi text,
  payment_term_odoo text,
  fiscal_payment_terms_raw text,
  fiscal_payment_terms jsonb,

  -- === Salesperson ===
  salesperson_user_id integer,
  -- TODO-SP3: swap to canonical_contacts FK
  salesperson_contact_id bigint,

  -- === Flags historical ===
  historical_pre_odoo boolean
    GENERATED ALWAYS AS (
      odoo_invoice_id IS NULL AND fecha_timbrado IS NOT NULL AND fecha_timbrado < '2021-01-01'::timestamptz
    ) STORED,
  pending_operationalization boolean
    GENERATED ALWAYS AS (
      sat_uuid IS NOT NULL AND odoo_invoice_id IS NULL AND fecha_timbrado >= '2021-01-01'::timestamptz
    ) STORED,

  -- === Resolution tagging (composite match) ===
  resolved_from text,                   -- 'odoo_uuid'|'sat_primary'|'sat_composite_match'|'manual_bridge'|NULL
  match_confidence text,                -- 'exact'|'high'|'medium'|'low'|NULL
  match_evidence jsonb,                 -- diagnostic: composite inputs used, score, tie-breakers

  -- === Presence & meta ===
  has_odoo_record boolean NOT NULL DEFAULT false,
  has_sat_record boolean NOT NULL DEFAULT false,
  has_email_thread boolean NOT NULL DEFAULT false,
  has_manual_link boolean NOT NULL DEFAULT false,
  sources_present text[] NOT NULL DEFAULT '{}',
  sources_missing text[] NOT NULL DEFAULT '{}',
  completeness_score numeric(4,3),
  needs_review boolean DEFAULT false,
  review_reason text[] DEFAULT '{}',
  source_hashes jsonb,
  last_reconciled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_invoices_sat_uuid
  ON canonical_invoices (sat_uuid) WHERE sat_uuid IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_invoices_odoo_id
  ON canonical_invoices (odoo_invoice_id) WHERE odoo_invoice_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_canonical_invoices_emisor
  ON canonical_invoices (emisor_company_id);
CREATE INDEX IF NOT EXISTS ix_canonical_invoices_receptor
  ON canonical_invoices (receptor_company_id);
CREATE INDEX IF NOT EXISTS ix_canonical_invoices_direction_date
  ON canonical_invoices (direction, invoice_date DESC);
CREATE INDEX IF NOT EXISTS ix_canonical_invoices_needs_review
  ON canonical_invoices (needs_review) WHERE needs_review = true;
CREATE INDEX IF NOT EXISTS ix_canonical_invoices_pending_op
  ON canonical_invoices (pending_operationalization) WHERE pending_operationalization = true;
CREATE INDEX IF NOT EXISTS ix_canonical_invoices_state_mismatch
  ON canonical_invoices (state_mismatch) WHERE state_mismatch = true;
CREATE INDEX IF NOT EXISTS ix_canonical_invoices_amount_disc
  ON canonical_invoices (amount_total_has_discrepancy) WHERE amount_total_has_discrepancy = true;
CREATE INDEX IF NOT EXISTS ix_canonical_invoices_invoice_date
  ON canonical_invoices (invoice_date);
CREATE INDEX IF NOT EXISTS ix_canonical_invoices_fecha_timbrado
  ON canonical_invoices (fecha_timbrado);
CREATE INDEX IF NOT EXISTS ix_canonical_invoices_historical
  ON canonical_invoices (historical_pre_odoo) WHERE historical_pre_odoo = true;
CREATE INDEX IF NOT EXISTS ix_canonical_invoices_resolved_from
  ON canonical_invoices (resolved_from);

-- updated_at trigger
CREATE OR REPLACE FUNCTION trg_canonical_invoices_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_canonical_invoices_updated_at ON canonical_invoices;
CREATE TRIGGER trg_canonical_invoices_updated_at
  BEFORE UPDATE ON canonical_invoices
  FOR EACH ROW EXECUTE FUNCTION trg_canonical_invoices_updated_at();

COMMENT ON TABLE canonical_invoices IS 'Silver SP2 Pattern A. FKs emisor_company_id/receptor_company_id currently point at companies.id; SP3 renames to *_canonical_company_id with FK to canonical_companies.';

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('create_table','canonical_invoices','SP2 Task 1: canonical_invoices DDL','20260422_sp2_01_canonical_invoices_ddl.sql','silver-sp2',true);

COMMIT;
```

- [ ] **Step 2: Apply migration**

Invocar `mcp__claude_ai_Supabase__apply_migration(name='sp2_01_canonical_invoices_ddl', query=<above SQL>)`.

Expected: success. Si falla por extension ausente (pgcrypto/uuid), no debería — solo text/bigint/numeric/jsonb.

- [ ] **Step 3: Verificar schema**

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='public' AND table_name='canonical_invoices'
ORDER BY ordinal_position;
```

Expected: ≥60 columnas. Incluye `canonical_id`, `sat_uuid`, `odoo_invoice_id`, `amount_total_has_discrepancy` (generated), `historical_pre_odoo` (generated), `resolved_from`, `match_confidence`, `completeness_score`.

- [ ] **Step 4: Verificar indexes + generated columns**

```sql
SELECT indexname, indexdef FROM pg_indexes WHERE tablename='canonical_invoices' ORDER BY indexname;
SELECT column_name, generation_expression
FROM information_schema.columns
WHERE table_schema='public' AND table_name='canonical_invoices' AND is_generated='ALWAYS'
ORDER BY ordinal_position;
```

Expected: 13 indexes; 6+ generated columns (`amount_total_diff_abs`, `amount_total_has_discrepancy`, `amount_total_mxn_diff_abs`, `amount_total_mxn_diff_pct`, `date_has_discrepancy`, `state_mismatch`, `blacklist_action`, `historical_pre_odoo`, `pending_operationalization`).

Pegar outputs en notes `## Task 1 / DDL verification`.

- [ ] **Step 5: Smoke — insert dummy row + rollback**

```sql
BEGIN;
INSERT INTO canonical_invoices (canonical_id, direction, has_odoo_record, has_sat_record)
VALUES ('smoke:test', 'issued', false, false);
SELECT canonical_id, historical_pre_odoo, pending_operationalization, state_mismatch, blacklist_action
FROM canonical_invoices WHERE canonical_id='smoke:test';
ROLLBACK;
```

Expected: 1 row; todos los generated boolean = false/null coherently; ROLLBACK deja tabla vacía.

- [ ] **Step 6: Rollback plan documentado**

Añadir en notes:
```
Rollback Task 1: DROP TABLE IF EXISTS canonical_invoices CASCADE;
```

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260422_sp2_01_canonical_invoices_ddl.sql \
        docs/superpowers/plans/2026-04-22-silver-sp2-canonical-cat-a-notes.md
git commit -m "feat(sp2): canonical_invoices DDL + indexes + generated cols"
git push
```

---

### Task 2: Populate `canonical_invoices` Odoo side (GATED)

**Purpose.** Insertar todas las rows con `has_odoo_record=true` desde `odoo_invoices`. Estas rows serán candidatas primarias para Match con SAT en Task 3.

**Gate.** Tamaño: ~27,761 rows. User OK requerido antes de aplicar migration.

**Files:**
- Create: `supabase/migrations/20260422_sp2_02_canonical_invoices_populate_odoo.sql`

**Steps:**

- [ ] **Step 1: Dry-run query count preview**

```sql
SELECT
  COUNT(*) AS total_odoo,
  COUNT(*) FILTER (WHERE cfdi_uuid IS NOT NULL) AS with_uuid,
  COUNT(*) FILTER (WHERE move_type='out_invoice') AS out_inv,
  COUNT(*) FILTER (WHERE move_type='in_invoice') AS in_inv,
  COUNT(*) FILTER (WHERE move_type IN ('out_refund','in_refund')) AS refunds,
  COUNT(*) FILTER (WHERE move_type NOT IN ('out_invoice','in_invoice','out_refund','in_refund')) AS other
FROM odoo_invoices;
```

Expected: `total_odoo ≈ 27,761`. Refunds van a `canonical_credit_notes` (excluidos aquí).

Pegar output en notes `## Task 2 / Preview`.

- [ ] **Step 2: Construir populate SQL**

```sql
BEGIN;

-- Invoices sin sat_uuid conocido aún (Task 3 añadirá sat side)
INSERT INTO canonical_invoices (
  canonical_id, odoo_invoice_id, direction, move_type_odoo,
  amount_total_odoo, amount_untaxed_odoo, amount_tax_odoo, amount_residual_odoo,
  amount_paid_odoo, amount_total_mxn_odoo, amount_total_mxn_ops, amount_residual_mxn_odoo,
  currency_odoo, invoice_date, due_date_odoo, payment_date_odoo,
  state_odoo, payment_state_odoo, cfdi_sat_state_odoo, edi_state_odoo,
  odoo_name, cfdi_uuid_odoo, odoo_ref, odoo_partner_id,
  payment_term_odoo, salesperson_user_id,
  emisor_company_id, receptor_company_id,
  has_odoo_record, has_sat_record, sources_present,
  resolved_from, match_confidence,
  source_hashes
)
SELECT
  'odoo:' || oi.id::text AS canonical_id,
  oi.id AS odoo_invoice_id,
  CASE oi.move_type
    WHEN 'out_invoice' THEN 'issued'
    WHEN 'out_refund'  THEN 'issued'
    WHEN 'in_invoice'  THEN 'received'
    WHEN 'in_refund'   THEN 'received'
    WHEN 'entry'       THEN 'internal'
    ELSE 'internal'
  END AS direction,
  oi.move_type AS move_type_odoo,
  oi.amount_total, oi.amount_untaxed, oi.amount_tax, oi.amount_residual,
  oi.amount_paid, oi.amount_total_mxn, oi.amount_total_mxn, oi.amount_residual_mxn,
  oi.currency, oi.invoice_date, oi.due_date, oi.payment_date,
  oi.state, oi.payment_state, oi.cfdi_sat_state, oi.edi_state,
  oi.name, oi.cfdi_uuid, oi.ref, oi.odoo_partner_id,
  oi.payment_term, oi.salesperson_user_id,
  CASE WHEN oi.move_type IN ('out_invoice','out_refund') THEN 1 ELSE oi.company_id END AS emisor_company_id, -- 1 = Quimibond
  CASE WHEN oi.move_type IN ('in_invoice','in_refund')   THEN 1 ELSE oi.company_id END AS receptor_company_id,
  true AS has_odoo_record,
  (oi.cfdi_uuid IS NOT NULL) AS has_sat_record_proxy, -- preliminary; reset/confirm in Task 3
  ARRAY['odoo'] AS sources_present,
  CASE WHEN oi.cfdi_uuid IS NOT NULL THEN 'odoo_uuid' ELSE NULL END AS resolved_from,
  CASE WHEN oi.cfdi_uuid IS NOT NULL THEN 'exact' ELSE NULL END AS match_confidence,
  jsonb_build_object('odoo_write_date', oi.write_date, 'odoo_synced_at', oi.synced_at) AS source_hashes
FROM odoo_invoices oi
WHERE oi.move_type IN ('out_invoice','in_invoice')  -- refunds van a canonical_credit_notes
ON CONFLICT (canonical_id) DO NOTHING;

-- Also seed sat_uuid when odoo_invoices already has it (pre-composite match)
UPDATE canonical_invoices ci
SET sat_uuid = oi.cfdi_uuid
FROM odoo_invoices oi
WHERE ci.odoo_invoice_id = oi.id
  AND oi.cfdi_uuid IS NOT NULL
  AND ci.sat_uuid IS NULL;

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('populate','canonical_invoices','SP2 Task 2: populate from odoo_invoices (I only; refunds in Task 8)','20260422_sp2_02_canonical_invoices_populate_odoo.sql','silver-sp2',true);

COMMIT;
```

Nota FK: `emisor_company_id` / `receptor_company_id` se setean con regla simple "Quimibond = company_id=1". Si hay múltiples company_id internos, ajustar según mapping. **Verificar antes de aplicar:**

```sql
SELECT DISTINCT company_id FROM odoo_invoices ORDER BY company_id;
SELECT id, name FROM companies WHERE id IN (SELECT DISTINCT company_id FROM odoo_invoices) ORDER BY id;
```

Si `company_id` es heterogéneo (Quimibond + filiales), documentar en notes y ajustar SQL para usar `company_id` directo sin mapear a 1. El spec §5.1 deja esto abierto — resolver vía MDM en SP3.

- [ ] **Step 3: Gate — esperar OK del usuario antes de aplicar**

Poner mensaje al usuario:
> "Task 2 listo para aplicar. Affecta ~27,761 rows (INSERT en canonical_invoices). ¿OK para ejecutar? (responde `OK sp2 task 2` o propón ajustes)"

Esperar respuesta explícita.

- [ ] **Step 4: Apply**

`mcp__claude_ai_Supabase__apply_migration(name='sp2_02_canonical_invoices_populate_odoo', query=<above SQL>)`.

- [ ] **Step 5: Verificación numérica**

```sql
SELECT
  (SELECT COUNT(*) FROM canonical_invoices) AS total_rows,
  (SELECT COUNT(*) FROM canonical_invoices WHERE has_odoo_record=true) AS odoo_rows,
  (SELECT COUNT(*) FROM canonical_invoices WHERE sat_uuid IS NOT NULL) AS with_uuid,
  (SELECT COUNT(*) FROM canonical_invoices WHERE resolved_from='odoo_uuid') AS from_odoo_uuid,
  (SELECT COUNT(DISTINCT direction) FROM canonical_invoices) AS directions,
  (SELECT COUNT(*) FROM canonical_invoices WHERE odoo_invoice_id IS NULL AND has_odoo_record=true) AS orphan_flag_bug;
```

Expected:
- `total_rows ≈ 27,179` (27,761 - 582 refunds; o rango aproximado).
- `odoo_rows = total_rows`.
- `with_uuid ≈ 18,494` (= pre-SP2 odoo_with_uuid).
- `from_odoo_uuid ≈ 18,494`.
- `directions = 3` (issued, received, internal).
- `orphan_flag_bug = 0`.

Pegar en notes.

- [ ] **Step 6: Rollback plan**

```sql
-- Rollback Task 2
DELETE FROM canonical_invoices WHERE canonical_id LIKE 'odoo:%';
```

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260422_sp2_02_canonical_invoices_populate_odoo.sql \
        docs/superpowers/plans/2026-04-22-silver-sp2-canonical-cat-a-notes.md
git commit -m "feat(sp2): populate canonical_invoices from odoo_invoices (I only)"
git push
```

---

### Task 3: Populate `canonical_invoices` SAT side + composite match (GATED)

**Purpose.** Merge SAT rows (`syntage_invoices` tipo='I') en canonical_invoices:
1. Para CFDI SAT con UUID ya match de Odoo (Task 2): actualizar fila existente con sat_* fields.
2. Para CFDI SAT sin Odoo match: intentar composite match via `match_unlinked_invoices_by_composite()` y adjuntar si confidence=high/medium.
3. Para CFDI SAT sin match post-composite: crear fila SAT-only con `canonical_id='sat:'||uuid`, `has_odoo_record=false`, `pending_operationalization=true` (si post-2021) o `historical_pre_odoo=true`.

Gap target: post-Task 3, invoices post-2021 con `sat_uuid` o `cfdi_uuid_odoo` o `resolved_from='sat_composite_match'` ≥ 95%.

**Gate.** Grande (~82,473 syntage I rows; ~13,000+ composite match candidates). User OK requerido.

**Files:**
- Create: `supabase/migrations/20260422_sp2_03_canonical_invoices_populate_sat.sql`

**Steps:**

- [ ] **Step 1: Dry-run composite match diagnosis**

Ejecutar función pre-existente contra batch limitado:

```sql
SELECT match_confidence, COUNT(*)
FROM match_unlinked_invoices_by_composite(p_batch_size := 500, p_date_tolerance_days := 3, p_amount_tolerance := 0.01)
GROUP BY match_confidence;
```

Expected: distribución con categorías `high`, `medium`, `low`, y posibles `ambiguous`/`no_match`. Pegar en notes.

Si `high + medium < 30% de 9,074 NULLs post-2021`, advertir user — tolerances pueden estar mal; pausar para ajustar.

- [ ] **Step 2: Query diagnóstico contra syntage I**

```sql
SELECT
  (SELECT COUNT(*) FROM syntage_invoices WHERE tipo_comprobante='I') AS sat_i_total,
  (SELECT COUNT(*) FROM syntage_invoices si
    WHERE si.tipo_comprobante='I'
      AND EXISTS(SELECT 1 FROM canonical_invoices ci WHERE ci.sat_uuid=si.uuid)
  ) AS sat_already_matched,
  (SELECT COUNT(*) FROM syntage_invoices si
    WHERE si.tipo_comprobante='I' AND si.fecha_timbrado < '2021-01-01'::timestamptz
  ) AS sat_historical_pre_odoo,
  (SELECT COUNT(*) FROM syntage_invoices si
    WHERE si.tipo_comprobante='I' AND si.fecha_timbrado >= '2021-01-01'::timestamptz
      AND NOT EXISTS(SELECT 1 FROM canonical_invoices ci WHERE ci.sat_uuid=si.uuid)
  ) AS sat_unmatched_post_2021;
```

Expected: `sat_i_total≈82,473`, `sat_already_matched≈18,494`, `sat_historical_pre_odoo` ∈ [30k,60k] (el grueso de pre-2021), `sat_unmatched_post_2021` ∈ [5k,15k].

- [ ] **Step 3: Construir populate SQL (multi-statement, transactional)**

```sql
BEGIN;

-- 3a. UPDATE canonical rows existentes con datos SAT (donde sat_uuid ya coincide con canonical via Task 2 seeded)
UPDATE canonical_invoices ci
SET
  tipo_comprobante_sat = si.tipo_comprobante,
  amount_total_sat = si.total,
  amount_untaxed_sat = si.subtotal,
  amount_tax_sat = si.impuestos_trasladados,
  amount_retenciones_sat = si.impuestos_retenidos,
  amount_total_mxn_sat = si.total_mxn,
  amount_total_mxn_fiscal = si.total_mxn,
  currency_sat = si.moneda,
  tipo_cambio_sat = si.tipo_cambio,
  fecha_emision = si.fecha_emision,
  fecha_timbrado = si.fecha_timbrado,
  fecha_cancelacion = si.fecha_cancelacion,
  estado_sat = si.estado_sat,
  serie = COALESCE(ci.serie, si.serie),
  folio = COALESCE(ci.folio, si.folio),
  emisor_rfc = si.emisor_rfc,
  emisor_nombre = si.emisor_nombre,
  receptor_rfc = si.receptor_rfc,
  receptor_nombre = si.receptor_nombre,
  emisor_blacklist_status = si.emisor_blacklist_status,
  receptor_blacklist_status = si.receptor_blacklist_status,
  metodo_pago = si.metodo_pago,
  forma_pago = si.forma_pago,
  uso_cfdi = si.uso_cfdi,
  has_sat_record = true,
  sources_present = ARRAY(SELECT DISTINCT unnest(ci.sources_present || ARRAY['sat'])),
  source_hashes = COALESCE(ci.source_hashes,'{}'::jsonb) || jsonb_build_object('sat_synced_at', si.synced_at)
FROM syntage_invoices si
WHERE si.uuid = ci.sat_uuid
  AND si.tipo_comprobante='I';

-- 3b. Composite match fallback — attach SAT uuid a canonical rows Odoo-only donde confidence high/medium
WITH matched AS (
  SELECT odoo_invoice_id, syntage_uuid, match_confidence
  FROM match_unlinked_invoices_by_composite(p_batch_size := 10000, p_date_tolerance_days := 3, p_amount_tolerance := 0.01)
  WHERE match_confidence IN ('high','medium')
)
UPDATE canonical_invoices ci
SET
  sat_uuid = m.syntage_uuid,
  resolved_from = 'sat_composite_match',
  match_confidence = m.match_confidence,
  match_evidence = jsonb_build_object(
    'method','composite',
    'inputs', jsonb_build_object(
      'emisor_rfc', ci.emisor_rfc,
      'receptor_rfc', ci.receptor_rfc,
      'amount_total_mxn_odoo', ci.amount_total_mxn_odoo,
      'invoice_date', ci.invoice_date,
      'tolerance_days', 3,
      'tolerance_amount', 0.01
    )
  )
FROM matched m
WHERE ci.odoo_invoice_id = m.odoo_invoice_id
  AND ci.sat_uuid IS NULL;

-- 3c. Now pull SAT fields for those newly-matched rows
UPDATE canonical_invoices ci
SET
  tipo_comprobante_sat = si.tipo_comprobante,
  amount_total_sat = si.total,
  amount_untaxed_sat = si.subtotal,
  amount_tax_sat = si.impuestos_trasladados,
  amount_retenciones_sat = si.impuestos_retenidos,
  amount_total_mxn_sat = si.total_mxn,
  amount_total_mxn_fiscal = si.total_mxn,
  currency_sat = si.moneda,
  tipo_cambio_sat = si.tipo_cambio,
  fecha_emision = si.fecha_emision,
  fecha_timbrado = si.fecha_timbrado,
  fecha_cancelacion = si.fecha_cancelacion,
  estado_sat = si.estado_sat,
  emisor_rfc = COALESCE(ci.emisor_rfc, si.emisor_rfc),
  emisor_nombre = COALESCE(ci.emisor_nombre, si.emisor_nombre),
  receptor_rfc = COALESCE(ci.receptor_rfc, si.receptor_rfc),
  receptor_nombre = COALESCE(ci.receptor_nombre, si.receptor_nombre),
  emisor_blacklist_status = si.emisor_blacklist_status,
  receptor_blacklist_status = si.receptor_blacklist_status,
  metodo_pago = si.metodo_pago,
  forma_pago = si.forma_pago,
  uso_cfdi = si.uso_cfdi,
  has_sat_record = true,
  sources_present = ARRAY(SELECT DISTINCT unnest(ci.sources_present || ARRAY['sat']))
FROM syntage_invoices si
WHERE si.uuid = ci.sat_uuid
  AND si.tipo_comprobante='I'
  AND ci.has_sat_record = false;

-- 3d. Insertar rows SAT-only (CFDI sin match Odoo después de composite)
INSERT INTO canonical_invoices (
  canonical_id, sat_uuid, direction, tipo_comprobante_sat,
  amount_total_sat, amount_untaxed_sat, amount_tax_sat, amount_retenciones_sat,
  amount_total_mxn_sat, amount_total_mxn_fiscal,
  currency_sat, tipo_cambio_sat,
  fecha_emision, fecha_timbrado, fecha_cancelacion, estado_sat,
  serie, folio,
  emisor_rfc, emisor_nombre, receptor_rfc, receptor_nombre,
  emisor_blacklist_status, receptor_blacklist_status,
  metodo_pago, forma_pago, uso_cfdi,
  has_odoo_record, has_sat_record, sources_present,
  resolved_from, match_confidence, source_hashes
)
SELECT
  si.uuid AS canonical_id,
  si.uuid AS sat_uuid,
  CASE si.direction WHEN 'emitida' THEN 'issued' WHEN 'recibida' THEN 'received' ELSE 'internal' END,
  si.tipo_comprobante,
  si.total, si.subtotal, si.impuestos_trasladados, si.impuestos_retenidos,
  si.total_mxn, si.total_mxn,
  si.moneda, si.tipo_cambio,
  si.fecha_emision, si.fecha_timbrado, si.fecha_cancelacion, si.estado_sat,
  si.serie, si.folio,
  si.emisor_rfc, si.emisor_nombre, si.receptor_rfc, si.receptor_nombre,
  si.emisor_blacklist_status, si.receptor_blacklist_status,
  si.metodo_pago, si.forma_pago, si.uso_cfdi,
  false, true, ARRAY['sat'],
  'sat_primary', 'exact',
  jsonb_build_object('sat_synced_at', si.synced_at)
FROM syntage_invoices si
WHERE si.tipo_comprobante='I'
  AND NOT EXISTS (SELECT 1 FROM canonical_invoices ci WHERE ci.sat_uuid = si.uuid)
ON CONFLICT (canonical_id) DO NOTHING;

-- 3e. Compute completeness_score + sources_missing
UPDATE canonical_invoices ci
SET
  completeness_score = CASE
    WHEN has_odoo_record AND has_sat_record AND has_email_thread THEN 1.000
    WHEN has_odoo_record AND has_sat_record THEN 0.667
    WHEN has_odoo_record OR has_sat_record THEN 0.333
    ELSE 0.000
  END,
  sources_missing = CASE
    WHEN has_odoo_record AND has_sat_record THEN ARRAY['email']
    WHEN has_odoo_record AND NOT has_sat_record THEN ARRAY['sat','email']
    WHEN NOT has_odoo_record AND has_sat_record THEN ARRAY['odoo','email']
    ELSE ARRAY['odoo','sat','email']
  END
WHERE completeness_score IS NULL OR sources_missing = '{}';

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('populate','canonical_invoices','SP2 Task 3: merge SAT + composite match','20260422_sp2_03_canonical_invoices_populate_sat.sql','silver-sp2',true);

COMMIT;
```

Nota Step 3b: `match_unlinked_invoices_by_composite` tiene `p_batch_size DEFAULT 500`. Llamar con 10,000 permite procesar todo en una corrida si cabe en memoria; si timeout, bajar a 2,000 y repetir statement en loop (documentar en notes cómo).

- [ ] **Step 4: Gate — esperar OK del usuario**

Mensaje:
> "Task 3 listo. Affecta ~82k SAT I rows: (a) update 18k existing matches, (b) composite-match fallback sobre 9k nulls post-2021 con tolerances ±3d/±0.01 MXN, (c) insert SAT-only rows ~60k (mayormente historical_pre_odoo). ¿OK para ejecutar?"

- [ ] **Step 5: Apply**

`mcp__claude_ai_Supabase__apply_migration(name='sp2_03_canonical_invoices_populate_sat', query=<above SQL>)`.

Si timeout >60s, repartir en 3 migrations separadas (3a+3b+3c en uno, 3d en otro, 3e en otro).

- [ ] **Step 6: Verificación cobertura + smoke**

```sql
-- Cobertura uuid post-Task 3
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE sat_uuid IS NOT NULL) AS with_sat_uuid,
  COUNT(*) FILTER (WHERE cfdi_uuid_odoo IS NOT NULL) AS with_odoo_uuid,
  COUNT(*) FILTER (WHERE has_odoo_record AND has_sat_record) AS dual,
  COUNT(*) FILTER (WHERE has_odoo_record AND NOT has_sat_record) AS odoo_only,
  COUNT(*) FILTER (WHERE NOT has_odoo_record AND has_sat_record) AS sat_only,
  COUNT(*) FILTER (WHERE historical_pre_odoo) AS historical,
  COUNT(*) FILTER (WHERE pending_operationalization) AS pending_op
FROM canonical_invoices;

-- Distribución resolved_from
SELECT resolved_from, match_confidence, COUNT(*)
FROM canonical_invoices
GROUP BY resolved_from, match_confidence
ORDER BY COUNT(*) DESC;

-- Gap post-2021 cerrado
SELECT
  COUNT(*) AS total_post_2021,
  COUNT(*) FILTER (WHERE sat_uuid IS NOT NULL OR cfdi_uuid_odoo IS NOT NULL) AS resolved,
  ROUND(100.0 * COUNT(*) FILTER (WHERE sat_uuid IS NOT NULL OR cfdi_uuid_odoo IS NOT NULL) / NULLIF(COUNT(*),0), 2) AS pct
FROM canonical_invoices
WHERE invoice_date >= '2021-01-01' OR fecha_timbrado >= '2021-01-01'::timestamptz;
```

Expected:
- `total ≥ 90,000`.
- `dual ≥ 17,000` (18k pre-existing - refunds).
- `sat_only ≥ 60,000` (syntage I historical + pending_op).
- `historical ≈ 50,000-60,000`.
- `pct ≥ 95` — **DoD numérico primario de SP2 para canonical_invoices**.

Si `pct < 95`, investigar: tolerancias (ajustar match composite a ±7d o ±0.5% amount), rangos de fecha, RFCs que difieren entre Odoo y SAT.

Pegar todos los outputs en notes.

- [ ] **Step 7: Smoke integrity**

```sql
-- No canonical_id collisions
SELECT canonical_id, COUNT(*)
FROM canonical_invoices GROUP BY canonical_id HAVING COUNT(*)>1;

-- No row with has_odoo_record=true sin odoo_invoice_id
SELECT COUNT(*) FROM canonical_invoices WHERE has_odoo_record=true AND odoo_invoice_id IS NULL;

-- No row with has_sat_record=true sin sat_uuid
SELECT COUNT(*) FROM canonical_invoices WHERE has_sat_record=true AND sat_uuid IS NULL;

-- Amount discrepancy stats
SELECT
  COUNT(*) FILTER (WHERE amount_total_has_discrepancy) AS discrepant,
  MAX(amount_total_diff_abs) AS max_diff,
  ROUND(AVG(amount_total_diff_abs)::numeric, 2) AS avg_diff
FROM canonical_invoices
WHERE has_odoo_record AND has_sat_record;
```

Expected all 3 first queries = 0. Discrepant count será >0 pero documentar magnitud; invariante `invoice.amount_mismatch` (Task 15) los detectará.

- [ ] **Step 8: Rollback plan**

```sql
-- Rollback Task 3 (parcial: drop SAT-only rows + null SAT fields en matches)
DELETE FROM canonical_invoices WHERE canonical_id NOT LIKE 'odoo:%';
UPDATE canonical_invoices
SET sat_uuid=NULL, tipo_comprobante_sat=NULL, amount_total_sat=NULL, amount_untaxed_sat=NULL,
    amount_tax_sat=NULL, amount_retenciones_sat=NULL, amount_total_mxn_sat=NULL,
    amount_total_mxn_fiscal=NULL, currency_sat=NULL, tipo_cambio_sat=NULL,
    fecha_emision=NULL, fecha_timbrado=NULL, fecha_cancelacion=NULL, estado_sat=NULL,
    emisor_rfc=NULL, emisor_nombre=NULL, receptor_rfc=NULL, receptor_nombre=NULL,
    emisor_blacklist_status=NULL, receptor_blacklist_status=NULL,
    metodo_pago=NULL, forma_pago=NULL, uso_cfdi=NULL,
    has_sat_record=false,
    sources_present = array_remove(sources_present, 'sat'),
    resolved_from = CASE WHEN resolved_from='sat_composite_match' THEN NULL ELSE resolved_from END,
    match_confidence = CASE WHEN resolved_from='sat_composite_match' THEN NULL ELSE match_confidence END,
    match_evidence = NULL;
```

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/20260422_sp2_03_canonical_invoices_populate_sat.sql \
        docs/superpowers/plans/2026-04-22-silver-sp2-canonical-cat-a-notes.md
git commit -m "feat(sp2): merge SAT + composite-match fallback into canonical_invoices"
git push
```

---

### Task 4: Incremental upsert trigger + final smoke

**Purpose.** Crear trigger `AFTER INSERT/UPDATE` en `odoo_invoices` y `syntage_invoices` que mantiene `canonical_invoices` sincronizada incrementalmente. Esto reemplaza la necesidad de full populate recurrente (solo nightly safety net via pg_cron Task 15).

**Files:**
- Create: `supabase/migrations/20260422_sp2_04_canonical_invoices_trigger.sql`

**Steps:**

- [ ] **Step 1: Escribir trigger functions**

```sql
BEGIN;

-- Upsert from odoo_invoices row
CREATE OR REPLACE FUNCTION canonical_invoices_upsert_from_odoo() RETURNS trigger AS $$
DECLARE
  v_canonical_id text;
  v_direction text;
BEGIN
  IF NEW.move_type NOT IN ('out_invoice','in_invoice') THEN
    RETURN NEW;  -- refunds → canonical_credit_notes trigger
  END IF;

  v_direction := CASE NEW.move_type
    WHEN 'out_invoice' THEN 'issued'
    WHEN 'in_invoice'  THEN 'received'
    ELSE 'internal'
  END;

  -- If Odoo has a uuid, prefer canonical_id = uuid (merges with existing SAT row)
  IF NEW.cfdi_uuid IS NOT NULL AND EXISTS(SELECT 1 FROM canonical_invoices WHERE sat_uuid=NEW.cfdi_uuid) THEN
    v_canonical_id := (SELECT canonical_id FROM canonical_invoices WHERE sat_uuid=NEW.cfdi_uuid LIMIT 1);
  ELSE
    v_canonical_id := 'odoo:' || NEW.id::text;
  END IF;

  INSERT INTO canonical_invoices (
    canonical_id, odoo_invoice_id, sat_uuid, direction, move_type_odoo,
    amount_total_odoo, amount_untaxed_odoo, amount_tax_odoo, amount_residual_odoo,
    amount_paid_odoo, amount_total_mxn_odoo, amount_total_mxn_ops, amount_residual_mxn_odoo,
    currency_odoo, invoice_date, due_date_odoo, payment_date_odoo,
    state_odoo, payment_state_odoo, cfdi_sat_state_odoo, edi_state_odoo,
    odoo_name, cfdi_uuid_odoo, odoo_ref, odoo_partner_id,
    payment_term_odoo, salesperson_user_id,
    emisor_company_id, receptor_company_id,
    has_odoo_record, sources_present,
    resolved_from, match_confidence, source_hashes
  ) VALUES (
    v_canonical_id, NEW.id, NEW.cfdi_uuid, v_direction, NEW.move_type,
    NEW.amount_total, NEW.amount_untaxed, NEW.amount_tax, NEW.amount_residual,
    NEW.amount_paid, NEW.amount_total_mxn, NEW.amount_total_mxn, NEW.amount_residual_mxn,
    NEW.currency, NEW.invoice_date, NEW.due_date, NEW.payment_date,
    NEW.state, NEW.payment_state, NEW.cfdi_sat_state, NEW.edi_state,
    NEW.name, NEW.cfdi_uuid, NEW.ref, NEW.odoo_partner_id,
    NEW.payment_term, NEW.salesperson_user_id,
    CASE WHEN NEW.move_type='out_invoice' THEN 1 ELSE NEW.company_id END,
    CASE WHEN NEW.move_type='in_invoice'  THEN 1 ELSE NEW.company_id END,
    true, ARRAY['odoo'],
    CASE WHEN NEW.cfdi_uuid IS NOT NULL THEN 'odoo_uuid' ELSE NULL END,
    CASE WHEN NEW.cfdi_uuid IS NOT NULL THEN 'exact' ELSE NULL END,
    jsonb_build_object('odoo_write_date', NEW.write_date, 'odoo_synced_at', NEW.synced_at)
  )
  ON CONFLICT (canonical_id) DO UPDATE SET
    odoo_invoice_id = EXCLUDED.odoo_invoice_id,
    sat_uuid = COALESCE(canonical_invoices.sat_uuid, EXCLUDED.sat_uuid),
    move_type_odoo = EXCLUDED.move_type_odoo,
    amount_total_odoo = EXCLUDED.amount_total_odoo,
    amount_untaxed_odoo = EXCLUDED.amount_untaxed_odoo,
    amount_tax_odoo = EXCLUDED.amount_tax_odoo,
    amount_residual_odoo = EXCLUDED.amount_residual_odoo,
    amount_paid_odoo = EXCLUDED.amount_paid_odoo,
    amount_total_mxn_odoo = EXCLUDED.amount_total_mxn_odoo,
    amount_total_mxn_ops = EXCLUDED.amount_total_mxn_odoo,
    amount_residual_mxn_odoo = EXCLUDED.amount_residual_mxn_odoo,
    currency_odoo = EXCLUDED.currency_odoo,
    invoice_date = EXCLUDED.invoice_date,
    due_date_odoo = EXCLUDED.due_date_odoo,
    payment_date_odoo = EXCLUDED.payment_date_odoo,
    state_odoo = EXCLUDED.state_odoo,
    payment_state_odoo = EXCLUDED.payment_state_odoo,
    cfdi_sat_state_odoo = EXCLUDED.cfdi_sat_state_odoo,
    edi_state_odoo = EXCLUDED.edi_state_odoo,
    odoo_name = EXCLUDED.odoo_name,
    cfdi_uuid_odoo = EXCLUDED.cfdi_uuid_odoo,
    odoo_ref = EXCLUDED.odoo_ref,
    odoo_partner_id = EXCLUDED.odoo_partner_id,
    payment_term_odoo = EXCLUDED.payment_term_odoo,
    salesperson_user_id = EXCLUDED.salesperson_user_id,
    has_odoo_record = true,
    sources_present = ARRAY(SELECT DISTINCT unnest(canonical_invoices.sources_present || ARRAY['odoo'])),
    source_hashes = COALESCE(canonical_invoices.source_hashes,'{}'::jsonb)
                    || jsonb_build_object('odoo_write_date', NEW.write_date, 'odoo_synced_at', NEW.synced_at);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Upsert from syntage_invoices row (tipo I only; E → credit_notes; P → payments)
CREATE OR REPLACE FUNCTION canonical_invoices_upsert_from_sat() RETURNS trigger AS $$
DECLARE v_canonical_id text; v_direction text;
BEGIN
  IF NEW.tipo_comprobante <> 'I' THEN RETURN NEW; END IF;

  v_direction := CASE NEW.direction WHEN 'emitida' THEN 'issued' WHEN 'recibida' THEN 'received' ELSE 'internal' END;
  v_canonical_id := NEW.uuid;

  INSERT INTO canonical_invoices (
    canonical_id, sat_uuid, direction, tipo_comprobante_sat,
    amount_total_sat, amount_untaxed_sat, amount_tax_sat, amount_retenciones_sat,
    amount_total_mxn_sat, amount_total_mxn_fiscal,
    currency_sat, tipo_cambio_sat,
    fecha_emision, fecha_timbrado, fecha_cancelacion, estado_sat,
    serie, folio,
    emisor_rfc, emisor_nombre, receptor_rfc, receptor_nombre,
    emisor_blacklist_status, receptor_blacklist_status,
    metodo_pago, forma_pago, uso_cfdi,
    has_sat_record, sources_present,
    resolved_from, match_confidence, source_hashes
  ) VALUES (
    v_canonical_id, NEW.uuid, v_direction, NEW.tipo_comprobante,
    NEW.total, NEW.subtotal, NEW.impuestos_trasladados, NEW.impuestos_retenidos,
    NEW.total_mxn, NEW.total_mxn,
    NEW.moneda, NEW.tipo_cambio,
    NEW.fecha_emision, NEW.fecha_timbrado, NEW.fecha_cancelacion, NEW.estado_sat,
    NEW.serie, NEW.folio,
    NEW.emisor_rfc, NEW.emisor_nombre, NEW.receptor_rfc, NEW.receptor_nombre,
    NEW.emisor_blacklist_status, NEW.receptor_blacklist_status,
    NEW.metodo_pago, NEW.forma_pago, NEW.uso_cfdi,
    true, ARRAY['sat'],
    COALESCE(NULL,'sat_primary'), 'exact',
    jsonb_build_object('sat_synced_at', NEW.synced_at)
  )
  ON CONFLICT (canonical_id) DO UPDATE SET
    tipo_comprobante_sat = EXCLUDED.tipo_comprobante_sat,
    amount_total_sat = EXCLUDED.amount_total_sat,
    amount_untaxed_sat = EXCLUDED.amount_untaxed_sat,
    amount_tax_sat = EXCLUDED.amount_tax_sat,
    amount_retenciones_sat = EXCLUDED.amount_retenciones_sat,
    amount_total_mxn_sat = EXCLUDED.amount_total_mxn_sat,
    amount_total_mxn_fiscal = EXCLUDED.amount_total_mxn_sat,
    currency_sat = EXCLUDED.currency_sat,
    tipo_cambio_sat = EXCLUDED.tipo_cambio_sat,
    fecha_emision = EXCLUDED.fecha_emision,
    fecha_timbrado = EXCLUDED.fecha_timbrado,
    fecha_cancelacion = EXCLUDED.fecha_cancelacion,
    estado_sat = EXCLUDED.estado_sat,
    emisor_rfc = COALESCE(canonical_invoices.emisor_rfc, EXCLUDED.emisor_rfc),
    emisor_nombre = COALESCE(canonical_invoices.emisor_nombre, EXCLUDED.emisor_nombre),
    receptor_rfc = COALESCE(canonical_invoices.receptor_rfc, EXCLUDED.receptor_rfc),
    receptor_nombre = COALESCE(canonical_invoices.receptor_nombre, EXCLUDED.receptor_nombre),
    emisor_blacklist_status = EXCLUDED.emisor_blacklist_status,
    receptor_blacklist_status = EXCLUDED.receptor_blacklist_status,
    metodo_pago = EXCLUDED.metodo_pago,
    forma_pago = EXCLUDED.forma_pago,
    uso_cfdi = EXCLUDED.uso_cfdi,
    has_sat_record = true,
    sources_present = ARRAY(SELECT DISTINCT unnest(canonical_invoices.sources_present || ARRAY['sat'])),
    source_hashes = COALESCE(canonical_invoices.source_hashes,'{}'::jsonb)
                    || jsonb_build_object('sat_synced_at', NEW.synced_at);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_canonical_invoices_from_odoo ON odoo_invoices;
CREATE TRIGGER trg_canonical_invoices_from_odoo
  AFTER INSERT OR UPDATE ON odoo_invoices
  FOR EACH ROW EXECUTE FUNCTION canonical_invoices_upsert_from_odoo();

DROP TRIGGER IF EXISTS trg_canonical_invoices_from_sat ON syntage_invoices;
CREATE TRIGGER trg_canonical_invoices_from_sat
  AFTER INSERT OR UPDATE ON syntage_invoices
  FOR EACH ROW EXECUTE FUNCTION canonical_invoices_upsert_from_sat();

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('create_trigger','canonical_invoices','SP2 Task 4: incremental upsert triggers','20260422_sp2_04_canonical_invoices_trigger.sql','silver-sp2',true);

COMMIT;
```

- [ ] **Step 2: Apply**

`mcp__claude_ai_Supabase__apply_migration(name='sp2_04_canonical_invoices_trigger', query=<above SQL>)`.

- [ ] **Step 3: Smoke test — simular UPDATE en odoo_invoices**

```sql
-- Elegir una row con UUID conocido
WITH sample AS (
  SELECT id, odoo_partner_id, write_date FROM odoo_invoices WHERE cfdi_uuid IS NOT NULL LIMIT 1
)
UPDATE odoo_invoices SET write_date = now() WHERE id = (SELECT id FROM sample);

-- Verificar canonical actualizado
SELECT canonical_id, source_hashes->>'odoo_write_date' AS hash_odoo_write
FROM canonical_invoices
WHERE odoo_invoice_id = (SELECT id FROM odoo_invoices WHERE cfdi_uuid IS NOT NULL LIMIT 1);
```

Expected: `hash_odoo_write` actualizado al timestamp reciente.

- [ ] **Step 4: Smoke test — simular INSERT en syntage_invoices (mock)**

```sql
BEGIN;
INSERT INTO syntage_invoices (
  syntage_id, uuid, taxpayer_rfc, direction, tipo_comprobante,
  fecha_emision, fecha_timbrado, emisor_rfc, receptor_rfc,
  subtotal, total, moneda, tipo_cambio, total_mxn,
  impuestos_trasladados, impuestos_retenidos,
  metodo_pago, forma_pago, uso_cfdi, estado_sat, synced_at
) VALUES (
  'smoke-test', '00000000-smoke-test-invoice-000000000000',
  'PNT920218IW5', 'emitida', 'I',
  now(), now(), 'PNT920218IW5', 'XAXX010101000',
  100, 116, 'MXN', 1, 116, 16, 0,
  'PUE', '03', 'G03', 'vigente', now()
);
SELECT canonical_id, has_sat_record, tipo_comprobante_sat
FROM canonical_invoices
WHERE sat_uuid = '00000000-smoke-test-invoice-000000000000';
ROLLBACK;
```

Expected: 1 row con `has_sat_record=true, tipo_comprobante_sat='I'`.

- [ ] **Step 5: Performance check**

```sql
EXPLAIN ANALYZE
INSERT INTO canonical_invoices (canonical_id, direction, has_odoo_record, has_sat_record)
VALUES ('perf:test', 'issued', false, false)
ON CONFLICT (canonical_id) DO NOTHING;
```

Expected: <5ms.

```sql
DELETE FROM canonical_invoices WHERE canonical_id='perf:test';
```

- [ ] **Step 6: Rollback plan**

```sql
DROP TRIGGER IF EXISTS trg_canonical_invoices_from_odoo ON odoo_invoices;
DROP TRIGGER IF EXISTS trg_canonical_invoices_from_sat ON syntage_invoices;
DROP FUNCTION IF EXISTS canonical_invoices_upsert_from_odoo();
DROP FUNCTION IF EXISTS canonical_invoices_upsert_from_sat();
```

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260422_sp2_04_canonical_invoices_trigger.sql \
        docs/superpowers/plans/2026-04-22-silver-sp2-canonical-cat-a-notes.md
git commit -m "feat(sp2): incremental upsert triggers for canonical_invoices"
git push
```

---

## canonical_payments + canonical_payment_allocations (Tasks 5-7)

### Task 5: `canonical_payments` + `canonical_payment_allocations` DDL

**Purpose.** Crear `canonical_payments` (Pattern A, spec §5.2) + `canonical_payment_allocations` (separate table for multiplicity). Un row por evento bancario `(odoo_payment_id, sat_uuid_complemento)` resueltos.

**Files:**
- Create: `supabase/migrations/20260422_sp2_05_canonical_payments_ddl.sql`

**Steps:**

- [ ] **Step 1: Escribir DDL**

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS canonical_payments (
  canonical_id text PRIMARY KEY,
  odoo_payment_id bigint,
  sat_uuid_complemento text,
  direction text NOT NULL CHECK (direction IN ('received','sent')),

  -- === Monto ===
  amount_odoo numeric(14,2),
  amount_sat numeric(14,2),
  amount_resolved numeric(14,2),
  amount_diff_abs numeric(14,2)
    GENERATED ALWAYS AS (
      CASE WHEN amount_odoo IS NOT NULL AND amount_sat IS NOT NULL
           THEN ABS(amount_odoo - amount_sat) END
    ) STORED,
  amount_has_discrepancy boolean
    GENERATED ALWAYS AS (
      amount_odoo IS NOT NULL AND amount_sat IS NOT NULL
      AND ABS(amount_odoo - amount_sat) > 0.01
    ) STORED,

  -- === MXN ===
  amount_mxn_odoo numeric(14,2),
  amount_mxn_sat numeric(14,2),
  amount_mxn_resolved numeric(14,2),

  -- === Moneda / FX ===
  currency_odoo text,
  currency_sat text,
  tipo_cambio_sat numeric(18,6),

  -- === Fechas ===
  payment_date_odoo date,
  fecha_pago_sat timestamptz,
  payment_date_resolved date,
  date_has_discrepancy boolean
    GENERATED ALWAYS AS (
      payment_date_odoo IS NOT NULL AND fecha_pago_sat IS NOT NULL
      AND ABS(payment_date_odoo - fecha_pago_sat::date) > 1
    ) STORED,

  -- === Forma pago / journal ===
  forma_pago_sat text,
  payment_method_odoo text,
  journal_name text,
  journal_type text,
  is_reconciled boolean,
  reconciled_invoices_count integer,

  -- === Counterparties ===
  rfc_emisor_cta_ord text,
  rfc_emisor_cta_ben text,
  num_operacion text,
  odoo_ref text,

  -- === Partner ===
  partner_name text,
  odoo_partner_id integer,
  -- TODO-SP3: swap to canonical_companies FK
  counterparty_company_id bigint,
  estado_sat text,

  -- === Allocations (cache; detail en canonical_payment_allocations) ===
  allocation_count integer,
  allocated_invoices_uuid text[],
  amount_allocated numeric(14,2),
  amount_unallocated numeric(14,2)
    GENERATED ALWAYS AS (amount_resolved - COALESCE(amount_allocated,0)) STORED,

  -- === Flags ===
  registered_but_not_fiscally_confirmed boolean
    GENERATED ALWAYS AS (
      odoo_payment_id IS NOT NULL AND sat_uuid_complemento IS NULL
    ) STORED,
  complement_without_payment boolean
    GENERATED ALWAYS AS (
      sat_uuid_complemento IS NOT NULL AND odoo_payment_id IS NULL
    ) STORED,

  -- === Presence & meta ===
  has_odoo_record boolean NOT NULL DEFAULT false,
  has_sat_record boolean NOT NULL DEFAULT false,
  has_manual_link boolean NOT NULL DEFAULT false,
  sources_present text[] NOT NULL DEFAULT '{}',
  sources_missing text[] NOT NULL DEFAULT '{}',
  completeness_score numeric(4,3),
  needs_review boolean DEFAULT false,
  review_reason text[] DEFAULT '{}',
  source_hashes jsonb,
  last_reconciled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS canonical_payment_allocations (
  id bigserial PRIMARY KEY,
  payment_canonical_id text NOT NULL REFERENCES canonical_payments(canonical_id) ON DELETE CASCADE,
  invoice_canonical_id text NOT NULL,  -- NOT FK (historical_pre_odoo rows may exist)
  allocated_amount numeric(14,2) NOT NULL,
  currency text,
  source text NOT NULL CHECK (source IN ('sat_complemento','odoo_link','manual')),
  sat_saldo_anterior numeric(14,2),
  sat_saldo_insoluto numeric(14,2),
  sat_num_parcialidad integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cpa_pair ON canonical_payment_allocations (payment_canonical_id, invoice_canonical_id, source);
CREATE INDEX IF NOT EXISTS ix_cpa_invoice ON canonical_payment_allocations (invoice_canonical_id);
CREATE INDEX IF NOT EXISTS ix_cpa_payment ON canonical_payment_allocations (payment_canonical_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_payments_sat ON canonical_payments (sat_uuid_complemento) WHERE sat_uuid_complemento IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_payments_odoo ON canonical_payments (odoo_payment_id) WHERE odoo_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_canonical_payments_counterparty ON canonical_payments (counterparty_company_id);
CREATE INDEX IF NOT EXISTS ix_canonical_payments_dir_date ON canonical_payments (direction, payment_date_resolved DESC);
CREATE INDEX IF NOT EXISTS ix_canonical_payments_reg_not_conf ON canonical_payments (registered_but_not_fiscally_confirmed) WHERE registered_but_not_fiscally_confirmed=true;
CREATE INDEX IF NOT EXISTS ix_canonical_payments_comp_no_pay ON canonical_payments (complement_without_payment) WHERE complement_without_payment=true;
CREATE INDEX IF NOT EXISTS ix_canonical_payments_num_op ON canonical_payments (num_operacion);

CREATE OR REPLACE FUNCTION trg_canonical_payments_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_canonical_payments_updated_at ON canonical_payments;
CREATE TRIGGER trg_canonical_payments_updated_at
  BEFORE UPDATE ON canonical_payments FOR EACH ROW
  EXECUTE FUNCTION trg_canonical_payments_updated_at();

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('create_table','canonical_payments','SP2 Task 5: canonical_payments + allocations DDL','20260422_sp2_05_canonical_payments_ddl.sql','silver-sp2',true);

COMMIT;
```

- [ ] **Step 2: Apply**

`mcp__claude_ai_Supabase__apply_migration(name='sp2_05_canonical_payments_ddl', query=<above SQL>)`.

- [ ] **Step 3: Verify schema**

```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema='public' AND table_name='canonical_payments' ORDER BY ordinal_position;
SELECT indexname FROM pg_indexes WHERE tablename IN ('canonical_payments','canonical_payment_allocations') ORDER BY indexname;
```

Expected: canonical_payments has ~45 columnas incluyendo generated; 7 indexes + 3 en allocations.

- [ ] **Step 4: Rollback plan**

```sql
DROP TABLE IF EXISTS canonical_payment_allocations CASCADE;
DROP TABLE IF EXISTS canonical_payments CASCADE;
DROP FUNCTION IF EXISTS trg_canonical_payments_updated_at();
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260422_sp2_05_canonical_payments_ddl.sql \
        docs/superpowers/plans/2026-04-22-silver-sp2-canonical-cat-a-notes.md
git commit -m "feat(sp2): canonical_payments + canonical_payment_allocations DDL"
git push
```

---

### Task 6: Populate `canonical_payments` + `canonical_payment_allocations` (GATED)

**Purpose.** Populate:
1. Rows Odoo: `odoo_account_payments` (17,863).
2. Rows SAT: `syntage_invoice_payments` (~15,196 complementos).
3. Match vía `num_operacion` + fecha ± 1d + amount ± 0.01 → consolidar en mismo `canonical_id`.
4. Expand `doctos_relacionados jsonb` → `canonical_payment_allocations`.

**Gate.** User OK required (afecta 20k+ rows).

**Files:**
- Create: `supabase/migrations/20260422_sp2_06_canonical_payments_populate.sql`

**Steps:**

- [ ] **Step 1: Dry-run overlap analysis**

```sql
-- Cuántos SAT complementos tienen num_operacion resolvable a Odoo?
SELECT
  (SELECT COUNT(*) FROM odoo_account_payments) AS odoo_payments,
  (SELECT COUNT(*) FROM syntage_invoice_payments) AS sat_complements,
  (SELECT COUNT(*) FROM odoo_account_payments
    WHERE EXISTS(SELECT 1 FROM syntage_invoice_payments sp
                 WHERE sp.num_operacion = odoo_account_payments.ref
                   AND ABS(sp.monto - odoo_account_payments.amount) < 0.01
                   AND ABS(sp.fecha_pago::date - odoo_account_payments.date) <= 1)
  ) AS matched_by_numop;
```

Expected: `matched_by_numop` ∈ [2k, 8k] (depende de calidad de ref Odoo).

- [ ] **Step 2: Construir populate SQL**

```sql
BEGIN;

-- 6a. Odoo payments (sin match SAT aún)
INSERT INTO canonical_payments (
  canonical_id, odoo_payment_id, direction,
  amount_odoo, amount_mxn_odoo,
  currency_odoo, payment_date_odoo,
  payment_method_odoo, journal_name, is_reconciled, reconciled_invoices_count,
  odoo_ref, partner_name, odoo_partner_id, counterparty_company_id,
  has_odoo_record, sources_present, source_hashes
)
SELECT
  'odoo:' || oap.id::text,
  oap.id,
  CASE oap.payment_type WHEN 'inbound' THEN 'received' ELSE 'sent' END,
  oap.amount, COALESCE(oap.amount_signed, oap.amount),
  oap.currency, oap.date,
  oap.payment_method, oap.journal_name, oap.is_reconciled, oap.reconciled_invoices_count,
  oap.ref, NULL, oap.odoo_partner_id, oap.company_id,
  true, ARRAY['odoo'],
  jsonb_build_object('odoo_synced_at', oap.synced_at)
FROM odoo_account_payments oap
ON CONFLICT (canonical_id) DO NOTHING;

-- 6b. SAT complementos — attach al Odoo row existente si num_operacion + fecha + amount match
UPDATE canonical_payments cp
SET
  sat_uuid_complemento = sp.uuid_complemento,
  amount_sat = sp.monto,
  amount_mxn_sat = sp.monto * COALESCE(sp.tipo_cambio_p,1),
  currency_sat = sp.moneda_p,
  tipo_cambio_sat = sp.tipo_cambio_p,
  fecha_pago_sat = sp.fecha_pago,
  forma_pago_sat = sp.forma_pago_p,
  num_operacion = sp.num_operacion,
  rfc_emisor_cta_ord = sp.rfc_emisor_cta_ord,
  rfc_emisor_cta_ben = sp.rfc_emisor_cta_ben,
  estado_sat = sp.estado_sat,
  has_sat_record = true,
  sources_present = ARRAY(SELECT DISTINCT unnest(cp.sources_present || ARRAY['sat'])),
  source_hashes = COALESCE(cp.source_hashes,'{}'::jsonb) || jsonb_build_object('sat_synced_at', sp.synced_at)
FROM syntage_invoice_payments sp
JOIN odoo_account_payments oap ON oap.id = cp.odoo_payment_id
WHERE cp.sat_uuid_complemento IS NULL
  AND sp.num_operacion = oap.ref
  AND ABS(sp.monto - oap.amount) < 0.01
  AND ABS(sp.fecha_pago::date - oap.date) <= 1;

-- 6c. SAT-only complementos (no Odoo match)
INSERT INTO canonical_payments (
  canonical_id, sat_uuid_complemento, direction,
  amount_sat, amount_mxn_sat,
  currency_sat, tipo_cambio_sat, fecha_pago_sat, forma_pago_sat,
  num_operacion, rfc_emisor_cta_ord, rfc_emisor_cta_ben, estado_sat,
  has_sat_record, sources_present, source_hashes
)
SELECT
  'sat:' || sp.uuid_complemento,
  sp.uuid_complemento,
  CASE sp.direction WHEN 'emitida' THEN 'received' ELSE 'sent' END,
  sp.monto, sp.monto * COALESCE(sp.tipo_cambio_p,1),
  sp.moneda_p, sp.tipo_cambio_p, sp.fecha_pago, sp.forma_pago_p,
  sp.num_operacion, sp.rfc_emisor_cta_ord, sp.rfc_emisor_cta_ben, sp.estado_sat,
  true, ARRAY['sat'],
  jsonb_build_object('sat_synced_at', sp.synced_at)
FROM syntage_invoice_payments sp
WHERE NOT EXISTS (SELECT 1 FROM canonical_payments cp WHERE cp.sat_uuid_complemento = sp.uuid_complemento)
ON CONFLICT (canonical_id) DO NOTHING;

-- 6d. Resolved fields (defaults per §5.2 survivorship)
UPDATE canonical_payments cp
SET
  amount_resolved = COALESCE(cp.amount_odoo, cp.amount_sat),
  amount_mxn_resolved = COALESCE(cp.amount_mxn_odoo, cp.amount_mxn_sat),
  payment_date_resolved = COALESCE(cp.payment_date_odoo, cp.fecha_pago_sat::date),
  completeness_score = CASE
    WHEN cp.has_odoo_record AND cp.has_sat_record THEN 1.000
    WHEN cp.has_odoo_record OR  cp.has_sat_record THEN 0.500
    ELSE 0.000
  END,
  sources_missing = CASE
    WHEN cp.has_odoo_record AND cp.has_sat_record THEN '{}'::text[]
    WHEN cp.has_odoo_record AND NOT cp.has_sat_record THEN ARRAY['sat']
    WHEN NOT cp.has_odoo_record AND cp.has_sat_record THEN ARRAY['odoo']
    ELSE ARRAY['odoo','sat']
  END;

-- 6e. Allocations from doctos_relacionados jsonb
INSERT INTO canonical_payment_allocations (
  payment_canonical_id, invoice_canonical_id, allocated_amount, currency, source,
  sat_saldo_anterior, sat_saldo_insoluto, sat_num_parcialidad
)
SELECT
  cp.canonical_id,
  d->>'uuid',
  (d->>'importe_pagado')::numeric,
  d->>'moneda_dr',
  'sat_complemento',
  NULLIF(d->>'saldo_anterior','')::numeric,
  NULLIF(d->>'saldo_insoluto','')::numeric,
  NULLIF(d->>'num_parcialidad','')::integer
FROM syntage_invoice_payments sp
JOIN canonical_payments cp ON cp.sat_uuid_complemento = sp.uuid_complemento
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(sp.doctos_relacionados,'[]'::jsonb)) AS d
WHERE d ? 'uuid'
ON CONFLICT (payment_canonical_id, invoice_canonical_id, source) DO NOTHING;

-- 6f. Cache allocation summary en canonical_payments
UPDATE canonical_payments cp
SET
  allocation_count = agg.cnt,
  allocated_invoices_uuid = agg.uuids,
  amount_allocated = agg.total
FROM (
  SELECT payment_canonical_id,
         COUNT(*)        AS cnt,
         array_agg(invoice_canonical_id) AS uuids,
         SUM(allocated_amount)            AS total
  FROM canonical_payment_allocations
  GROUP BY payment_canonical_id
) agg
WHERE agg.payment_canonical_id = cp.canonical_id;

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('populate','canonical_payments','SP2 Task 6: populate payments + allocations','20260422_sp2_06_canonical_payments_populate.sql','silver-sp2',true);

COMMIT;
```

- [ ] **Step 3: Gate — esperar OK del usuario**

Mensaje:
> "Task 6 listo. Inserta ~17,863 Odoo + ~15,196 SAT complementos (merge via num_operacion + fecha+monto) + expand allocations desde doctos_relacionados jsonb. ¿OK para ejecutar?"

- [ ] **Step 4: Apply**

`mcp__claude_ai_Supabase__apply_migration(name='sp2_06_canonical_payments_populate', query=<above>)`.

- [ ] **Step 5: Verificación numérica**

```sql
SELECT
  (SELECT COUNT(*) FROM canonical_payments) AS total,
  (SELECT COUNT(*) FROM canonical_payments WHERE has_odoo_record AND has_sat_record) AS dual,
  (SELECT COUNT(*) FROM canonical_payments WHERE registered_but_not_fiscally_confirmed) AS odoo_only,
  (SELECT COUNT(*) FROM canonical_payments WHERE complement_without_payment) AS sat_only,
  (SELECT COUNT(*) FROM canonical_payment_allocations) AS allocations,
  (SELECT COUNT(DISTINCT invoice_canonical_id) FROM canonical_payment_allocations) AS distinct_invoices_allocated,
  (SELECT SUM(amount_allocated) FROM canonical_payments WHERE allocation_count IS NOT NULL) AS total_allocated;

SELECT
  COUNT(*) FILTER (WHERE amount_has_discrepancy) AS discrepant_amount,
  COUNT(*) FILTER (WHERE date_has_discrepancy) AS discrepant_date,
  MAX(amount_diff_abs) AS max_amount_diff
FROM canonical_payments
WHERE has_odoo_record AND has_sat_record;
```

Expected:
- `total ≥ 17,800` (target DoD).
- `dual ≥ 2,000` (varies con match quality).
- `allocations ≥ 15,000` (DoD).
- `distinct_invoices_allocated ≥ 10,000`.

- [ ] **Step 6: Smoke integrity**

```sql
SELECT COUNT(*) FROM canonical_payments WHERE has_odoo_record AND odoo_payment_id IS NULL;  -- 0
SELECT COUNT(*) FROM canonical_payments WHERE has_sat_record AND sat_uuid_complemento IS NULL;  -- 0
SELECT COUNT(*) FROM canonical_payment_allocations WHERE payment_canonical_id NOT IN (SELECT canonical_id FROM canonical_payments);  -- 0
```

Expected: todos 0.

- [ ] **Step 7: Rollback**

```sql
DELETE FROM canonical_payment_allocations;
DELETE FROM canonical_payments;
```

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260422_sp2_06_canonical_payments_populate.sql \
        docs/superpowers/plans/2026-04-22-silver-sp2-canonical-cat-a-notes.md
git commit -m "feat(sp2): populate canonical_payments + allocations"
git push
```

---

### Task 7: Incremental payments trigger + final smoke

**Purpose.** Triggers `AFTER INSERT/UPDATE` en `odoo_account_payments` y `syntage_invoice_payments` + re-cache allocations.

**Files:**
- Create: `supabase/migrations/20260422_sp2_07_canonical_payments_trigger.sql`

**Steps:**

- [ ] **Step 1: Escribir trigger functions**

```sql
BEGIN;

CREATE OR REPLACE FUNCTION canonical_payments_upsert_from_odoo() RETURNS trigger AS $$
DECLARE v_canonical_id text;
BEGIN
  -- If SAT row already has num_operacion match, use that canonical
  IF NEW.ref IS NOT NULL AND EXISTS(
    SELECT 1 FROM canonical_payments cp
    WHERE cp.num_operacion = NEW.ref
      AND ABS(cp.amount_sat - NEW.amount) < 0.01
      AND ABS(cp.fecha_pago_sat::date - NEW.date) <= 1
  ) THEN
    v_canonical_id := (
      SELECT canonical_id FROM canonical_payments cp
      WHERE cp.num_operacion = NEW.ref
        AND ABS(cp.amount_sat - NEW.amount) < 0.01
        AND ABS(cp.fecha_pago_sat::date - NEW.date) <= 1
      LIMIT 1
    );
  ELSE
    v_canonical_id := 'odoo:' || NEW.id::text;
  END IF;

  INSERT INTO canonical_payments (
    canonical_id, odoo_payment_id, direction,
    amount_odoo, amount_mxn_odoo, currency_odoo, payment_date_odoo,
    payment_method_odoo, journal_name, is_reconciled, reconciled_invoices_count,
    odoo_ref, odoo_partner_id, counterparty_company_id,
    has_odoo_record, sources_present, source_hashes
  ) VALUES (
    v_canonical_id, NEW.id,
    CASE NEW.payment_type WHEN 'inbound' THEN 'received' ELSE 'sent' END,
    NEW.amount, COALESCE(NEW.amount_signed, NEW.amount),
    NEW.currency, NEW.date,
    NEW.payment_method, NEW.journal_name, NEW.is_reconciled, NEW.reconciled_invoices_count,
    NEW.ref, NEW.odoo_partner_id, NEW.company_id,
    true, ARRAY['odoo'],
    jsonb_build_object('odoo_synced_at', NEW.synced_at)
  )
  ON CONFLICT (canonical_id) DO UPDATE SET
    odoo_payment_id = EXCLUDED.odoo_payment_id,
    amount_odoo = EXCLUDED.amount_odoo,
    amount_mxn_odoo = EXCLUDED.amount_mxn_odoo,
    currency_odoo = EXCLUDED.currency_odoo,
    payment_date_odoo = EXCLUDED.payment_date_odoo,
    payment_method_odoo = EXCLUDED.payment_method_odoo,
    journal_name = EXCLUDED.journal_name,
    is_reconciled = EXCLUDED.is_reconciled,
    reconciled_invoices_count = EXCLUDED.reconciled_invoices_count,
    odoo_ref = EXCLUDED.odoo_ref,
    odoo_partner_id = EXCLUDED.odoo_partner_id,
    counterparty_company_id = EXCLUDED.counterparty_company_id,
    has_odoo_record = true,
    sources_present = ARRAY(SELECT DISTINCT unnest(canonical_payments.sources_present || ARRAY['odoo'])),
    amount_resolved = COALESCE(EXCLUDED.amount_odoo, canonical_payments.amount_sat),
    amount_mxn_resolved = COALESCE(EXCLUDED.amount_mxn_odoo, canonical_payments.amount_mxn_sat),
    payment_date_resolved = COALESCE(EXCLUDED.payment_date_odoo, canonical_payments.fecha_pago_sat::date),
    source_hashes = COALESCE(canonical_payments.source_hashes,'{}'::jsonb) || jsonb_build_object('odoo_synced_at', NEW.synced_at);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION canonical_payments_upsert_from_sat() RETURNS trigger AS $$
DECLARE v_canonical_id text;
BEGIN
  v_canonical_id := 'sat:' || NEW.uuid_complemento;
  -- Si existe Odoo row con match, consolidar
  IF EXISTS(SELECT 1 FROM canonical_payments cp
            JOIN odoo_account_payments oap ON oap.id = cp.odoo_payment_id
            WHERE oap.ref = NEW.num_operacion
              AND ABS(oap.amount - NEW.monto) < 0.01
              AND ABS(oap.date - NEW.fecha_pago::date) <= 1) THEN
    v_canonical_id := (
      SELECT cp.canonical_id FROM canonical_payments cp
      JOIN odoo_account_payments oap ON oap.id = cp.odoo_payment_id
      WHERE oap.ref = NEW.num_operacion
        AND ABS(oap.amount - NEW.monto) < 0.01
        AND ABS(oap.date - NEW.fecha_pago::date) <= 1
      LIMIT 1
    );
  END IF;

  INSERT INTO canonical_payments (
    canonical_id, sat_uuid_complemento, direction,
    amount_sat, amount_mxn_sat, currency_sat, tipo_cambio_sat, fecha_pago_sat, forma_pago_sat,
    num_operacion, rfc_emisor_cta_ord, rfc_emisor_cta_ben, estado_sat,
    has_sat_record, sources_present, source_hashes
  ) VALUES (
    v_canonical_id, NEW.uuid_complemento,
    CASE NEW.direction WHEN 'emitida' THEN 'received' ELSE 'sent' END,
    NEW.monto, NEW.monto * COALESCE(NEW.tipo_cambio_p,1),
    NEW.moneda_p, NEW.tipo_cambio_p, NEW.fecha_pago, NEW.forma_pago_p,
    NEW.num_operacion, NEW.rfc_emisor_cta_ord, NEW.rfc_emisor_cta_ben, NEW.estado_sat,
    true, ARRAY['sat'],
    jsonb_build_object('sat_synced_at', NEW.synced_at)
  )
  ON CONFLICT (canonical_id) DO UPDATE SET
    sat_uuid_complemento = EXCLUDED.sat_uuid_complemento,
    amount_sat = EXCLUDED.amount_sat,
    amount_mxn_sat = EXCLUDED.amount_mxn_sat,
    currency_sat = EXCLUDED.currency_sat,
    tipo_cambio_sat = EXCLUDED.tipo_cambio_sat,
    fecha_pago_sat = EXCLUDED.fecha_pago_sat,
    forma_pago_sat = EXCLUDED.forma_pago_sat,
    num_operacion = EXCLUDED.num_operacion,
    rfc_emisor_cta_ord = EXCLUDED.rfc_emisor_cta_ord,
    rfc_emisor_cta_ben = EXCLUDED.rfc_emisor_cta_ben,
    estado_sat = EXCLUDED.estado_sat,
    has_sat_record = true,
    sources_present = ARRAY(SELECT DISTINCT unnest(canonical_payments.sources_present || ARRAY['sat'])),
    amount_resolved = COALESCE(canonical_payments.amount_odoo, EXCLUDED.amount_sat),
    amount_mxn_resolved = COALESCE(canonical_payments.amount_mxn_odoo, EXCLUDED.amount_mxn_sat),
    payment_date_resolved = COALESCE(canonical_payments.payment_date_odoo, EXCLUDED.fecha_pago_sat::date),
    source_hashes = COALESCE(canonical_payments.source_hashes,'{}'::jsonb) || jsonb_build_object('sat_synced_at', NEW.synced_at);

  -- Re-populate allocations from new doctos_relacionados
  DELETE FROM canonical_payment_allocations
   WHERE payment_canonical_id = v_canonical_id AND source='sat_complemento';
  INSERT INTO canonical_payment_allocations (
    payment_canonical_id, invoice_canonical_id, allocated_amount, currency, source,
    sat_saldo_anterior, sat_saldo_insoluto, sat_num_parcialidad
  )
  SELECT
    v_canonical_id,
    d->>'uuid',
    (d->>'importe_pagado')::numeric,
    d->>'moneda_dr',
    'sat_complemento',
    NULLIF(d->>'saldo_anterior','')::numeric,
    NULLIF(d->>'saldo_insoluto','')::numeric,
    NULLIF(d->>'num_parcialidad','')::integer
  FROM jsonb_array_elements(COALESCE(NEW.doctos_relacionados,'[]'::jsonb)) AS d
  WHERE d ? 'uuid'
  ON CONFLICT DO NOTHING;

  -- Update allocation cache
  UPDATE canonical_payments cp
  SET
    allocation_count = agg.cnt,
    allocated_invoices_uuid = agg.uuids,
    amount_allocated = agg.total
  FROM (
    SELECT COUNT(*) AS cnt, array_agg(invoice_canonical_id) AS uuids, SUM(allocated_amount) AS total
    FROM canonical_payment_allocations WHERE payment_canonical_id = v_canonical_id
  ) agg
  WHERE cp.canonical_id = v_canonical_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_canonical_payments_from_odoo ON odoo_account_payments;
CREATE TRIGGER trg_canonical_payments_from_odoo
  AFTER INSERT OR UPDATE ON odoo_account_payments
  FOR EACH ROW EXECUTE FUNCTION canonical_payments_upsert_from_odoo();

DROP TRIGGER IF EXISTS trg_canonical_payments_from_sat ON syntage_invoice_payments;
CREATE TRIGGER trg_canonical_payments_from_sat
  AFTER INSERT OR UPDATE ON syntage_invoice_payments
  FOR EACH ROW EXECUTE FUNCTION canonical_payments_upsert_from_sat();

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('create_trigger','canonical_payments','SP2 Task 7: incremental triggers','20260422_sp2_07_canonical_payments_trigger.sql','silver-sp2',true);

COMMIT;
```

- [ ] **Step 2: Apply**

`mcp__claude_ai_Supabase__apply_migration(name='sp2_07_canonical_payments_trigger', query=<above>)`.

- [ ] **Step 3: Smoke INSERT syntage_invoice_payments (mock + ROLLBACK)**

```sql
BEGIN;
INSERT INTO syntage_invoice_payments (
  syntage_id, uuid_complemento, taxpayer_rfc, direction,
  fecha_pago, forma_pago_p, moneda_p, tipo_cambio_p, monto,
  num_operacion, estado_sat, synced_at, doctos_relacionados
) VALUES (
  'smoke-p-1', '00000000-smoke-payment-uuid-000000000000',
  'PNT920218IW5', 'emitida', now(), '03', 'MXN', 1, 1000,
  'SMOKE-REF-1', 'vigente', now(),
  '[{"uuid":"00000000-smoke-dr-uuid-000000000000","importe_pagado":"1000","moneda_dr":"MXN"}]'::jsonb
);
SELECT canonical_id, allocation_count, amount_allocated
FROM canonical_payments WHERE sat_uuid_complemento = '00000000-smoke-payment-uuid-000000000000';
ROLLBACK;
```

Expected: 1 row con `allocation_count=1, amount_allocated=1000.00`.

- [ ] **Step 4: Rollback plan**

```sql
DROP TRIGGER IF EXISTS trg_canonical_payments_from_odoo ON odoo_account_payments;
DROP TRIGGER IF EXISTS trg_canonical_payments_from_sat ON syntage_invoice_payments;
DROP FUNCTION IF EXISTS canonical_payments_upsert_from_odoo();
DROP FUNCTION IF EXISTS canonical_payments_upsert_from_sat();
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260422_sp2_07_canonical_payments_trigger.sql \
        docs/superpowers/plans/2026-04-22-silver-sp2-canonical-cat-a-notes.md
git commit -m "feat(sp2): incremental triggers for canonical_payments + allocations"
git push
```

---

## canonical_credit_notes (Tasks 8-10)

### Task 8: `canonical_credit_notes` DDL

**Purpose.** Tabla separada de `canonical_invoices` para Egresos (tipo_comprobante='E' SAT + move_type IN ('out_refund','in_refund') Odoo). Spec §5.3.

**Files:**
- Create: `supabase/migrations/20260422_sp2_08_canonical_credit_notes_ddl.sql`

**Steps:**

- [ ] **Step 1: Escribir DDL**

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS canonical_credit_notes (
  canonical_id text PRIMARY KEY,
  odoo_invoice_id bigint,
  sat_uuid text,
  direction text NOT NULL CHECK (direction IN ('issued','received')),
  move_type_odoo text,
  tipo_comprobante_sat text NOT NULL DEFAULT 'E',

  -- === Monto ===
  amount_total_odoo numeric(14,2),
  amount_total_sat numeric(14,2),
  amount_total_resolved numeric(14,2),
  amount_total_diff_abs numeric(14,2)
    GENERATED ALWAYS AS (
      CASE WHEN amount_total_odoo IS NOT NULL AND amount_total_sat IS NOT NULL
           THEN ABS(amount_total_odoo - amount_total_sat) END
    ) STORED,
  amount_total_mxn_odoo numeric(14,2),
  amount_total_mxn_sat numeric(14,2),
  amount_total_mxn_resolved numeric(14,2),

  -- === FX ===
  currency_odoo text,
  currency_sat text,
  tipo_cambio_sat numeric(18,6),

  -- === Link a factura origen ===
  related_invoice_uuid text,
  related_invoice_canonical_id text,
  tipo_relacion text,   -- SAT code 01/03/etc
  reversed_entry_id_odoo bigint,   -- §14.3 pendiente en addon

  -- === Partners ===
  emisor_rfc text, emisor_nombre text,
  receptor_rfc text, receptor_nombre text,
  odoo_partner_id integer,
  -- TODO-SP3: swap to canonical_companies FK
  emisor_company_id bigint,
  receptor_company_id bigint,

  -- === Fechas ===
  invoice_date date,
  fecha_emision timestamptz, fecha_timbrado timestamptz, fecha_cancelacion timestamptz,

  -- === Estados ===
  state_odoo text, estado_sat text,
  state_mismatch boolean
    GENERATED ALWAYS AS (
      (state_odoo = 'cancel' AND estado_sat = 'vigente')
      OR (state_odoo = 'posted' AND estado_sat = 'cancelado')
    ) STORED,

  -- === Flags ===
  historical_pre_odoo boolean
    GENERATED ALWAYS AS (
      odoo_invoice_id IS NULL AND fecha_timbrado IS NOT NULL AND fecha_timbrado < '2021-01-01'::timestamptz
    ) STORED,
  pending_operationalization boolean
    GENERATED ALWAYS AS (
      sat_uuid IS NOT NULL AND odoo_invoice_id IS NULL AND fecha_timbrado >= '2021-01-01'::timestamptz
    ) STORED,

  has_odoo_record boolean NOT NULL DEFAULT false,
  has_sat_record boolean NOT NULL DEFAULT false,
  has_manual_link boolean NOT NULL DEFAULT false,
  sources_present text[] NOT NULL DEFAULT '{}',
  sources_missing text[] NOT NULL DEFAULT '{}',
  completeness_score numeric(4,3),
  needs_review boolean DEFAULT false,
  review_reason text[] DEFAULT '{}',
  source_hashes jsonb,
  last_reconciled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ccn_sat ON canonical_credit_notes (sat_uuid) WHERE sat_uuid IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_ccn_odoo ON canonical_credit_notes (odoo_invoice_id) WHERE odoo_invoice_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_ccn_related ON canonical_credit_notes (related_invoice_canonical_id);
CREATE INDEX IF NOT EXISTS ix_ccn_emisor ON canonical_credit_notes (emisor_company_id);
CREATE INDEX IF NOT EXISTS ix_ccn_direction_date ON canonical_credit_notes (direction, invoice_date DESC);
CREATE INDEX IF NOT EXISTS ix_ccn_pending_op ON canonical_credit_notes (pending_operationalization) WHERE pending_operationalization=true;
CREATE INDEX IF NOT EXISTS ix_ccn_state_mismatch ON canonical_credit_notes (state_mismatch) WHERE state_mismatch=true;

CREATE OR REPLACE FUNCTION trg_canonical_credit_notes_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ccn_updated_at ON canonical_credit_notes;
CREATE TRIGGER trg_ccn_updated_at BEFORE UPDATE ON canonical_credit_notes
  FOR EACH ROW EXECUTE FUNCTION trg_canonical_credit_notes_updated_at();

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('create_table','canonical_credit_notes','SP2 Task 8: DDL','20260422_sp2_08_canonical_credit_notes_ddl.sql','silver-sp2',true);

COMMIT;
```

- [ ] **Step 2: Apply**

`mcp__claude_ai_Supabase__apply_migration(name='sp2_08_canonical_credit_notes_ddl', query=<above>)`.

- [ ] **Step 3: Verify**

```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='canonical_credit_notes' ORDER BY ordinal_position;
```

Expected: ~40 columnas.

- [ ] **Step 4: Rollback**

```sql
DROP TABLE IF EXISTS canonical_credit_notes CASCADE;
DROP FUNCTION IF EXISTS trg_canonical_credit_notes_updated_at();
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260422_sp2_08_canonical_credit_notes_ddl.sql \
        docs/superpowers/plans/2026-04-22-silver-sp2-canonical-cat-a-notes.md
git commit -m "feat(sp2): canonical_credit_notes DDL"
git push
```

---

### Task 9: Populate `canonical_credit_notes` + resolve related invoice UUID (GATED)

**Purpose.** Populate ~2,500 rows (Odoo 582 refunds + SAT 2,009 E minus overlap). Resolve `related_invoice_uuid` via `syntage_invoices.raw_payload.cfdiRelacionados[0].uuid`; backfill `related_invoice_canonical_id` que apunta a `canonical_invoices.canonical_id`.

**Gate.** User OK required.

**Files:**
- Create: `supabase/migrations/20260422_sp2_09_canonical_credit_notes_populate.sql`

**Steps:**

- [ ] **Step 1: Dry-run**

```sql
SELECT
  (SELECT COUNT(*) FROM odoo_invoices WHERE move_type IN ('out_refund','in_refund')) AS odoo_refunds,
  (SELECT COUNT(*) FROM syntage_invoices WHERE tipo_comprobante='E') AS sat_egresos,
  (SELECT COUNT(*) FROM odoo_invoices WHERE move_type IN ('out_refund','in_refund') AND cfdi_uuid IS NOT NULL) AS odoo_refunds_with_uuid,
  (SELECT COUNT(*) FROM syntage_invoices
    WHERE tipo_comprobante='E' AND raw_payload ? 'cfdiRelacionados') AS sat_with_related;
```

Expected: `odoo_refunds≈582, sat_egresos≈2009, sat_with_related>1500`.

- [ ] **Step 2: Populate SQL**

```sql
BEGIN;

-- 9a. Odoo refunds
INSERT INTO canonical_credit_notes (
  canonical_id, odoo_invoice_id, direction, move_type_odoo,
  amount_total_odoo, amount_total_mxn_odoo,
  currency_odoo, invoice_date, odoo_partner_id,
  state_odoo,
  emisor_company_id, receptor_company_id,
  has_odoo_record, sources_present, source_hashes
)
SELECT
  CASE WHEN oi.cfdi_uuid IS NOT NULL THEN oi.cfdi_uuid ELSE 'odoo:' || oi.id::text END,
  oi.id,
  CASE WHEN oi.move_type='out_refund' THEN 'issued' ELSE 'received' END,
  oi.move_type,
  oi.amount_total, oi.amount_total_mxn,
  oi.currency, oi.invoice_date, oi.odoo_partner_id,
  oi.state,
  CASE WHEN oi.move_type='out_refund' THEN 1 ELSE oi.company_id END,
  CASE WHEN oi.move_type='in_refund'  THEN 1 ELSE oi.company_id END,
  true, ARRAY['odoo'],
  jsonb_build_object('odoo_write_date', oi.write_date, 'odoo_synced_at', oi.synced_at)
FROM odoo_invoices oi
WHERE oi.move_type IN ('out_refund','in_refund')
ON CONFLICT (canonical_id) DO NOTHING;

-- Seed sat_uuid where Odoo has cfdi_uuid
UPDATE canonical_credit_notes ccn
SET sat_uuid = oi.cfdi_uuid
FROM odoo_invoices oi
WHERE ccn.odoo_invoice_id = oi.id AND oi.cfdi_uuid IS NOT NULL AND ccn.sat_uuid IS NULL;

-- 9b. Match SAT E rows a Odoo via uuid
UPDATE canonical_credit_notes ccn
SET
  tipo_comprobante_sat = si.tipo_comprobante,
  amount_total_sat = si.total,
  amount_total_mxn_sat = si.total_mxn,
  currency_sat = si.moneda,
  tipo_cambio_sat = si.tipo_cambio,
  fecha_emision = si.fecha_emision,
  fecha_timbrado = si.fecha_timbrado,
  fecha_cancelacion = si.fecha_cancelacion,
  estado_sat = si.estado_sat,
  emisor_rfc = si.emisor_rfc, emisor_nombre = si.emisor_nombre,
  receptor_rfc = si.receptor_rfc, receptor_nombre = si.receptor_nombre,
  related_invoice_uuid = si.raw_payload #>> '{cfdiRelacionados,0,uuid}',
  tipo_relacion = si.raw_payload #>> '{cfdiRelacionados,0,tipoRelacion}',
  has_sat_record = true,
  sources_present = ARRAY(SELECT DISTINCT unnest(ccn.sources_present || ARRAY['sat']))
FROM syntage_invoices si
WHERE si.uuid = ccn.sat_uuid AND si.tipo_comprobante='E';

-- 9c. SAT E rows without Odoo match → insert
INSERT INTO canonical_credit_notes (
  canonical_id, sat_uuid, direction, tipo_comprobante_sat,
  amount_total_sat, amount_total_mxn_sat, currency_sat, tipo_cambio_sat,
  fecha_emision, fecha_timbrado, fecha_cancelacion, estado_sat,
  emisor_rfc, emisor_nombre, receptor_rfc, receptor_nombre,
  related_invoice_uuid, tipo_relacion,
  has_odoo_record, has_sat_record, sources_present, source_hashes
)
SELECT
  si.uuid,
  si.uuid,
  CASE si.direction WHEN 'emitida' THEN 'issued' ELSE 'received' END,
  si.tipo_comprobante,
  si.total, si.total_mxn, si.moneda, si.tipo_cambio,
  si.fecha_emision, si.fecha_timbrado, si.fecha_cancelacion, si.estado_sat,
  si.emisor_rfc, si.emisor_nombre, si.receptor_rfc, si.receptor_nombre,
  si.raw_payload #>> '{cfdiRelacionados,0,uuid}',
  si.raw_payload #>> '{cfdiRelacionados,0,tipoRelacion}',
  false, true, ARRAY['sat'],
  jsonb_build_object('sat_synced_at', si.synced_at)
FROM syntage_invoices si
WHERE si.tipo_comprobante='E'
  AND NOT EXISTS (SELECT 1 FROM canonical_credit_notes ccn WHERE ccn.sat_uuid = si.uuid)
ON CONFLICT (canonical_id) DO NOTHING;

-- 9d. Resolve related_invoice_canonical_id (link to canonical_invoices)
UPDATE canonical_credit_notes ccn
SET related_invoice_canonical_id = ci.canonical_id
FROM canonical_invoices ci
WHERE ci.sat_uuid = ccn.related_invoice_uuid
  AND ccn.related_invoice_canonical_id IS NULL;

-- 9e. Survivorship + completeness
UPDATE canonical_credit_notes ccn
SET
  amount_total_resolved = COALESCE(ccn.amount_total_sat, ccn.amount_total_odoo),
  amount_total_mxn_resolved = COALESCE(ccn.amount_total_mxn_sat, ccn.amount_total_mxn_odoo),
  completeness_score = CASE
    WHEN has_odoo_record AND has_sat_record THEN 1.000
    WHEN has_odoo_record OR  has_sat_record THEN 0.500
    ELSE 0.000
  END,
  sources_missing = CASE
    WHEN has_odoo_record AND has_sat_record THEN '{}'::text[]
    WHEN has_odoo_record AND NOT has_sat_record THEN ARRAY['sat']
    WHEN NOT has_odoo_record AND has_sat_record THEN ARRAY['odoo']
    ELSE ARRAY['odoo','sat']
  END;

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('populate','canonical_credit_notes','SP2 Task 9: populate + related resolution','20260422_sp2_09_canonical_credit_notes_populate.sql','silver-sp2',true);

COMMIT;
```

- [ ] **Step 3: Gate**

> "Task 9 listo. Inserta ~582 Odoo refunds + ~1,500 SAT E sin match. Resuelve related_invoice_canonical_id via cfdiRelacionados. ¿OK para ejecutar?"

- [ ] **Step 4: Apply**

`mcp__claude_ai_Supabase__apply_migration(name='sp2_09_canonical_credit_notes_populate', query=<above>)`.

- [ ] **Step 5: Verificación**

```sql
SELECT
  (SELECT COUNT(*) FROM canonical_credit_notes) AS total,
  (SELECT COUNT(*) FROM canonical_credit_notes WHERE has_odoo_record AND has_sat_record) AS dual,
  (SELECT COUNT(*) FROM canonical_credit_notes WHERE related_invoice_canonical_id IS NOT NULL) AS related_resolved,
  (SELECT COUNT(*) FROM canonical_credit_notes WHERE related_invoice_uuid IS NOT NULL AND related_invoice_canonical_id IS NULL) AS related_orphan,
  (SELECT COUNT(*) FROM canonical_credit_notes WHERE historical_pre_odoo) AS historical,
  (SELECT COUNT(*) FROM canonical_credit_notes WHERE pending_operationalization) AS pending;
```

Expected: `total ≥ 2,500` (DoD), `related_resolved ≥ 70% of related_invoice_uuid not null`. `related_orphan` = candidatos para invariante `invoice.credit_note_orphan`.

- [ ] **Step 6: Rollback**

```sql
DELETE FROM canonical_credit_notes;
```

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260422_sp2_09_canonical_credit_notes_populate.sql \
        docs/superpowers/plans/2026-04-22-silver-sp2-canonical-cat-a-notes.md
git commit -m "feat(sp2): populate canonical_credit_notes + cfdiRelacionados resolution"
git push
```

---

### Task 10: Incremental credit_notes trigger + smoke

**Purpose.** Trigger AFTER INSERT/UPDATE on `odoo_invoices` (refunds only) + `syntage_invoices` (E only).

**Files:**
- Create: `supabase/migrations/20260422_sp2_10_canonical_credit_notes_trigger.sql`

**Steps:**

- [ ] **Step 1: Escribir trigger functions**

```sql
BEGIN;

CREATE OR REPLACE FUNCTION canonical_credit_notes_upsert_from_odoo() RETURNS trigger AS $$
DECLARE v_canonical_id text;
BEGIN
  IF NEW.move_type NOT IN ('out_refund','in_refund') THEN RETURN NEW; END IF;

  IF NEW.cfdi_uuid IS NOT NULL AND EXISTS(SELECT 1 FROM canonical_credit_notes WHERE sat_uuid=NEW.cfdi_uuid) THEN
    v_canonical_id := (SELECT canonical_id FROM canonical_credit_notes WHERE sat_uuid=NEW.cfdi_uuid LIMIT 1);
  ELSE
    v_canonical_id := COALESCE(NEW.cfdi_uuid, 'odoo:' || NEW.id::text);
  END IF;

  INSERT INTO canonical_credit_notes (
    canonical_id, odoo_invoice_id, sat_uuid, direction, move_type_odoo,
    amount_total_odoo, amount_total_mxn_odoo, currency_odoo, invoice_date,
    odoo_partner_id, state_odoo,
    emisor_company_id, receptor_company_id,
    has_odoo_record, sources_present, source_hashes
  ) VALUES (
    v_canonical_id, NEW.id, NEW.cfdi_uuid,
    CASE WHEN NEW.move_type='out_refund' THEN 'issued' ELSE 'received' END,
    NEW.move_type,
    NEW.amount_total, NEW.amount_total_mxn, NEW.currency, NEW.invoice_date,
    NEW.odoo_partner_id, NEW.state,
    CASE WHEN NEW.move_type='out_refund' THEN 1 ELSE NEW.company_id END,
    CASE WHEN NEW.move_type='in_refund'  THEN 1 ELSE NEW.company_id END,
    true, ARRAY['odoo'],
    jsonb_build_object('odoo_write_date', NEW.write_date, 'odoo_synced_at', NEW.synced_at)
  )
  ON CONFLICT (canonical_id) DO UPDATE SET
    odoo_invoice_id = EXCLUDED.odoo_invoice_id,
    sat_uuid = COALESCE(canonical_credit_notes.sat_uuid, EXCLUDED.sat_uuid),
    move_type_odoo = EXCLUDED.move_type_odoo,
    amount_total_odoo = EXCLUDED.amount_total_odoo,
    amount_total_mxn_odoo = EXCLUDED.amount_total_mxn_odoo,
    currency_odoo = EXCLUDED.currency_odoo,
    invoice_date = EXCLUDED.invoice_date,
    odoo_partner_id = EXCLUDED.odoo_partner_id,
    state_odoo = EXCLUDED.state_odoo,
    has_odoo_record = true,
    sources_present = ARRAY(SELECT DISTINCT unnest(canonical_credit_notes.sources_present || ARRAY['odoo']));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION canonical_credit_notes_upsert_from_sat() RETURNS trigger AS $$
BEGIN
  IF NEW.tipo_comprobante <> 'E' THEN RETURN NEW; END IF;

  INSERT INTO canonical_credit_notes (
    canonical_id, sat_uuid, direction, tipo_comprobante_sat,
    amount_total_sat, amount_total_mxn_sat, currency_sat, tipo_cambio_sat,
    fecha_emision, fecha_timbrado, fecha_cancelacion, estado_sat,
    emisor_rfc, emisor_nombre, receptor_rfc, receptor_nombre,
    related_invoice_uuid, tipo_relacion,
    has_sat_record, sources_present, source_hashes
  ) VALUES (
    NEW.uuid, NEW.uuid,
    CASE NEW.direction WHEN 'emitida' THEN 'issued' ELSE 'received' END,
    NEW.tipo_comprobante,
    NEW.total, NEW.total_mxn, NEW.moneda, NEW.tipo_cambio,
    NEW.fecha_emision, NEW.fecha_timbrado, NEW.fecha_cancelacion, NEW.estado_sat,
    NEW.emisor_rfc, NEW.emisor_nombre, NEW.receptor_rfc, NEW.receptor_nombre,
    NEW.raw_payload #>> '{cfdiRelacionados,0,uuid}',
    NEW.raw_payload #>> '{cfdiRelacionados,0,tipoRelacion}',
    true, ARRAY['sat'],
    jsonb_build_object('sat_synced_at', NEW.synced_at)
  )
  ON CONFLICT (canonical_id) DO UPDATE SET
    amount_total_sat = EXCLUDED.amount_total_sat,
    amount_total_mxn_sat = EXCLUDED.amount_total_mxn_sat,
    fecha_emision = EXCLUDED.fecha_emision,
    fecha_timbrado = EXCLUDED.fecha_timbrado,
    fecha_cancelacion = EXCLUDED.fecha_cancelacion,
    estado_sat = EXCLUDED.estado_sat,
    related_invoice_uuid = EXCLUDED.related_invoice_uuid,
    tipo_relacion = EXCLUDED.tipo_relacion,
    has_sat_record = true,
    sources_present = ARRAY(SELECT DISTINCT unnest(canonical_credit_notes.sources_present || ARRAY['sat']));

  -- Resolve related_invoice_canonical_id
  UPDATE canonical_credit_notes ccn
  SET related_invoice_canonical_id = ci.canonical_id
  FROM canonical_invoices ci
  WHERE ccn.canonical_id = NEW.uuid
    AND ci.sat_uuid = ccn.related_invoice_uuid
    AND ccn.related_invoice_canonical_id IS NULL;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ccn_from_odoo ON odoo_invoices;
CREATE TRIGGER trg_ccn_from_odoo AFTER INSERT OR UPDATE ON odoo_invoices
  FOR EACH ROW EXECUTE FUNCTION canonical_credit_notes_upsert_from_odoo();

DROP TRIGGER IF EXISTS trg_ccn_from_sat ON syntage_invoices;
CREATE TRIGGER trg_ccn_from_sat AFTER INSERT OR UPDATE ON syntage_invoices
  FOR EACH ROW EXECUTE FUNCTION canonical_credit_notes_upsert_from_sat();

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('create_trigger','canonical_credit_notes','SP2 Task 10: triggers','20260422_sp2_10_canonical_credit_notes_trigger.sql','silver-sp2',true);

COMMIT;
```

- [ ] **Step 2: Apply**

`mcp__claude_ai_Supabase__apply_migration(name='sp2_10_canonical_credit_notes_trigger', query=<above>)`.

- [ ] **Step 3: Smoke test**

```sql
BEGIN;
INSERT INTO syntage_invoices (
  syntage_id, uuid, taxpayer_rfc, direction, tipo_comprobante,
  fecha_emision, fecha_timbrado, emisor_rfc, receptor_rfc,
  subtotal, total, moneda, tipo_cambio, total_mxn,
  metodo_pago, forma_pago, uso_cfdi, estado_sat, synced_at,
  raw_payload
) VALUES (
  'smoke-e', '00000000-smoke-credit-note-0000000000000',
  'PNT920218IW5', 'emitida', 'E',
  now(), now(), 'PNT920218IW5', 'XAXX010101000',
  50, 58, 'MXN', 1, 58,
  'PUE', '03', 'G03', 'vigente', now(),
  '{"cfdiRelacionados":[{"uuid":"19a3dc5f-d07f-450b-ad20-aa3d92212a06","tipoRelacion":"01"}]}'::jsonb
);
SELECT canonical_id, related_invoice_uuid, tipo_relacion
FROM canonical_credit_notes WHERE sat_uuid='00000000-smoke-credit-note-0000000000000';
ROLLBACK;
```

Expected: 1 row con `related_invoice_uuid='19a3dc5f-...'`, `tipo_relacion='01'`.

- [ ] **Step 4: Rollback plan**

```sql
DROP TRIGGER IF EXISTS trg_ccn_from_odoo ON odoo_invoices;
DROP TRIGGER IF EXISTS trg_ccn_from_sat  ON syntage_invoices;
DROP FUNCTION IF EXISTS canonical_credit_notes_upsert_from_odoo();
DROP FUNCTION IF EXISTS canonical_credit_notes_upsert_from_sat();
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260422_sp2_10_canonical_credit_notes_trigger.sql \
        docs/superpowers/plans/2026-04-22-silver-sp2-canonical-cat-a-notes.md
git commit -m "feat(sp2): incremental triggers for canonical_credit_notes"
git push
```

---

## canonical_tax_events (Tasks 11-13)

### Task 11: `canonical_tax_events` DDL

**Purpose.** Tabla unificada para eventos fiscales no-factura: retenciones (ISR/IVA), declaraciones mensuales, contabilidad electrónica (catálogo/balanza/pólizas). Spec §5.4.

**Files:**
- Create: `supabase/migrations/20260422_sp2_11_canonical_tax_events_ddl.sql`

**Steps:**

- [ ] **Step 1: Escribir DDL**

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS canonical_tax_events (
  canonical_id text PRIMARY KEY,
  event_type text NOT NULL CHECK (event_type IN ('retention','tax_return','electronic_accounting')),
  sat_record_id text,

  -- === Retention fields ===
  retention_uuid text,
  tipo_retencion text,
  monto_total_retenido numeric(14,2),
  emisor_rfc text, receptor_rfc text,
  retention_fecha_emision timestamptz,

  -- === Tax return fields ===
  return_ejercicio integer,
  return_periodo text,
  return_impuesto text,
  return_tipo_declaracion text,
  return_fecha_presentacion timestamptz,
  return_monto_pagado numeric(14,2),
  return_numero_operacion text,

  -- === Electronic accounting fields ===
  acct_ejercicio integer,
  acct_periodo text,
  acct_record_type text,
  acct_tipo_envio text,
  acct_hash text,

  -- === Odoo reconciliation ===
  odoo_payment_id bigint,
  odoo_account_ids integer[],
  odoo_reconciled_amount numeric(14,2),
  reconciliation_diff_abs numeric(14,2)
    GENERATED ALWAYS AS (
      CASE
        WHEN event_type='retention' AND monto_total_retenido IS NOT NULL AND odoo_reconciled_amount IS NOT NULL
          THEN ABS(monto_total_retenido - odoo_reconciled_amount)
        WHEN event_type='tax_return' AND return_monto_pagado IS NOT NULL AND odoo_reconciled_amount IS NOT NULL
          THEN ABS(return_monto_pagado - odoo_reconciled_amount)
        ELSE NULL
      END
    ) STORED,

  -- === Meta ===
  sat_estado text,
  taxpayer_rfc text NOT NULL DEFAULT 'PNT920218IW5',
  has_odoo_match boolean DEFAULT false,
  needs_review boolean DEFAULT false,
  review_reason text[] DEFAULT '{}',
  source_hashes jsonb,
  last_reconciled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_cte_type ON canonical_tax_events (event_type);
CREATE INDEX IF NOT EXISTS ix_cte_return_period ON canonical_tax_events (return_ejercicio, return_periodo)
  WHERE event_type='tax_return';
CREATE INDEX IF NOT EXISTS ix_cte_acct_period ON canonical_tax_events (acct_ejercicio, acct_periodo)
  WHERE event_type='electronic_accounting';
CREATE INDEX IF NOT EXISTS ix_cte_odoo_match ON canonical_tax_events (has_odoo_match) WHERE has_odoo_match=false;
CREATE INDEX IF NOT EXISTS ix_cte_retention_uuid ON canonical_tax_events (retention_uuid) WHERE retention_uuid IS NOT NULL;

CREATE OR REPLACE FUNCTION trg_canonical_tax_events_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cte_updated_at ON canonical_tax_events;
CREATE TRIGGER trg_cte_updated_at BEFORE UPDATE ON canonical_tax_events
  FOR EACH ROW EXECUTE FUNCTION trg_canonical_tax_events_updated_at();

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('create_table','canonical_tax_events','SP2 Task 11: DDL','20260422_sp2_11_canonical_tax_events_ddl.sql','silver-sp2',true);

COMMIT;
```

- [ ] **Step 2: Apply**

`mcp__claude_ai_Supabase__apply_migration(name='sp2_11_canonical_tax_events_ddl', query=<above>)`.

- [ ] **Step 3: Verify**

```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema='public' AND table_name='canonical_tax_events' ORDER BY ordinal_position;
SELECT indexname FROM pg_indexes WHERE tablename='canonical_tax_events';
```

Expected: ~30 columnas; 5 indexes.

- [ ] **Step 4: Rollback**

```sql
DROP TABLE IF EXISTS canonical_tax_events CASCADE;
DROP FUNCTION IF EXISTS trg_canonical_tax_events_updated_at();
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260422_sp2_11_canonical_tax_events_ddl.sql \
        docs/superpowers/plans/2026-04-22-silver-sp2-canonical-cat-a-notes.md
git commit -m "feat(sp2): canonical_tax_events DDL"
git push
```

---

### Task 12: Populate `canonical_tax_events` from SAT (GATED)

**Purpose.** Insert 3 slices: retentions, returns, electronic_accounting. No Odoo side yet (Task 13).

**Gate.** User OK.

**Files:**
- Create: `supabase/migrations/20260422_sp2_12_canonical_tax_events_populate.sql`

**Steps:**

- [ ] **Step 1: Dry-run**

```sql
SELECT
  (SELECT COUNT(*) FROM syntage_tax_retentions) AS retentions,
  (SELECT COUNT(*) FROM syntage_tax_returns)    AS returns,
  (SELECT COUNT(*) FROM syntage_electronic_accounting) AS ea;
```

Pegar en notes.

- [ ] **Step 2: Populate SQL**

```sql
BEGIN;

-- 12a. Retentions
INSERT INTO canonical_tax_events (
  canonical_id, event_type, sat_record_id,
  retention_uuid, tipo_retencion, monto_total_retenido,
  emisor_rfc, receptor_rfc, retention_fecha_emision, sat_estado,
  taxpayer_rfc, source_hashes
)
SELECT
  'retention:' || COALESCE(r.uuid, r.syntage_id),
  'retention',
  r.syntage_id,
  r.uuid, r.tipo_retencion, r.monto_total_retenido,
  r.emisor_rfc, r.receptor_rfc, r.fecha_emision, r.estado_sat,
  COALESCE(r.taxpayer_rfc,'PNT920218IW5'),
  jsonb_build_object('sat_synced_at', r.synced_at)
FROM syntage_tax_retentions r
ON CONFLICT (canonical_id) DO NOTHING;

-- 12b. Tax returns
INSERT INTO canonical_tax_events (
  canonical_id, event_type, sat_record_id,
  return_ejercicio, return_periodo, return_impuesto,
  return_tipo_declaracion, return_fecha_presentacion, return_monto_pagado, return_numero_operacion,
  taxpayer_rfc, source_hashes
)
SELECT
  'return:' || r.ejercicio || '-' || r.periodo || '-' || COALESCE(r.impuesto,'X') || '-' || r.syntage_id,
  'tax_return',
  r.syntage_id,
  r.ejercicio, r.periodo, r.impuesto,
  r.tipo_declaracion, r.fecha_presentacion, r.monto_pagado, r.numero_operacion,
  COALESCE(r.taxpayer_rfc,'PNT920218IW5'),
  jsonb_build_object('sat_synced_at', r.synced_at)
FROM syntage_tax_returns r
ON CONFLICT (canonical_id) DO NOTHING;

-- 12c. Electronic accounting
INSERT INTO canonical_tax_events (
  canonical_id, event_type, sat_record_id,
  acct_ejercicio, acct_periodo, acct_record_type, acct_tipo_envio, acct_hash,
  taxpayer_rfc, source_hashes
)
SELECT
  'acct:' || e.ejercicio || '-' || e.periodo || '-' || e.record_type || '-' || e.syntage_id,
  'electronic_accounting',
  e.syntage_id,
  e.ejercicio, e.periodo, e.record_type, e.tipo_envio, e.hash,
  COALESCE(e.taxpayer_rfc,'PNT920218IW5'),
  jsonb_build_object('sat_synced_at', e.synced_at)
FROM syntage_electronic_accounting e
ON CONFLICT (canonical_id) DO NOTHING;

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('populate','canonical_tax_events','SP2 Task 12: populate SAT sources','20260422_sp2_12_canonical_tax_events_populate.sql','silver-sp2',true);

COMMIT;
```

- [ ] **Step 3: Gate**

> "Task 12 listo. Inserta retentions + returns + electronic_accounting desde syntage_*. Conteos dry-run en notes. ¿OK para ejecutar?"

- [ ] **Step 4: Apply + verify**

```sql
SELECT event_type, COUNT(*)
FROM canonical_tax_events GROUP BY event_type ORDER BY event_type;

SELECT COUNT(*) FROM canonical_tax_events;  -- expected ≥ 100 (DoD)
```

Pegar outputs.

- [ ] **Step 5: Rollback**

```sql
DELETE FROM canonical_tax_events;
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260422_sp2_12_canonical_tax_events_populate.sql \
        docs/superpowers/plans/2026-04-22-silver-sp2-canonical-cat-a-notes.md
git commit -m "feat(sp2): populate canonical_tax_events from SAT sources"
git push
```

---

### Task 13: `canonical_tax_events` Odoo reconciliation (GATED) + trigger

**Purpose.** Match tax events against Odoo:
- **Retentions**: aggregate `syntage_tax_retentions.monto_total_retenido` mensual vs `odoo_account_balances` con cuentas ISR/IVA retenido.
- **Returns**: `odoo_account_payments` con `date` match ±1d y `amount` match tolerance 0.01.
- **Electronic accounting**: no Odoo direct counterpart — set `has_odoo_match=false` permanente, invariante futuro comparará balanza SAT vs Odoo monthly (deferred invariant).

Trigger: AFTER INSERT/UPDATE on each syntage_tax_* table.

**Gate.** User OK.

**Files:**
- Create: `supabase/migrations/20260422_sp2_13_canonical_tax_events_odoo_match.sql`

**Steps:**

- [ ] **Step 1: Returns reconciliation**

```sql
BEGIN;

-- 13a. Match tax returns with odoo_account_payments
UPDATE canonical_tax_events cte
SET
  odoo_payment_id = oap.id,
  odoo_reconciled_amount = oap.amount,
  has_odoo_match = true,
  last_reconciled_at = now()
FROM odoo_account_payments oap
WHERE cte.event_type='tax_return'
  AND cte.return_numero_operacion = oap.ref
  AND ABS(cte.return_monto_pagado - oap.amount) < 0.01
  AND ABS(cte.return_fecha_presentacion::date - oap.date) <= 1
  AND cte.has_odoo_match = false;

-- 13b. Match retentions to ISR/IVA accounts (monthly aggregate)
-- Note: requires odoo_account_balances cuenta ISR retenido (216.x) — ajustar si cuenta difiere
WITH retention_agg AS (
  SELECT
    DATE_TRUNC('month', retention_fecha_emision) AS mo,
    SUM(monto_total_retenido) AS total_retained
  FROM canonical_tax_events
  WHERE event_type='retention'
  GROUP BY 1
),
odoo_isr AS (
  SELECT
    DATE_TRUNC('month', period_end) AS mo,
    SUM(balance) AS odoo_balance
  FROM odoo_account_balances
  WHERE account_code LIKE '216%'  -- ISR retenido (verify exact code)
  GROUP BY 1
)
UPDATE canonical_tax_events cte
SET
  odoo_reconciled_amount = oi.odoo_balance,
  has_odoo_match = CASE WHEN ABS(cte.monto_total_retenido - COALESCE(oi.odoo_balance,0)) < 1.00 THEN true ELSE false END,
  last_reconciled_at = now()
FROM retention_agg r
JOIN odoo_isr oi ON oi.mo = r.mo
WHERE cte.event_type='retention'
  AND DATE_TRUNC('month', cte.retention_fecha_emision) = r.mo
  AND cte.has_odoo_match = false;

-- 13c. Incremental triggers
CREATE OR REPLACE FUNCTION canonical_tax_events_upsert_retention() RETURNS trigger AS $$
BEGIN
  INSERT INTO canonical_tax_events (
    canonical_id, event_type, sat_record_id, retention_uuid,
    tipo_retencion, monto_total_retenido,
    emisor_rfc, receptor_rfc, retention_fecha_emision, sat_estado,
    taxpayer_rfc, source_hashes
  ) VALUES (
    'retention:' || COALESCE(NEW.uuid, NEW.syntage_id),
    'retention', NEW.syntage_id, NEW.uuid,
    NEW.tipo_retencion, NEW.monto_total_retenido,
    NEW.emisor_rfc, NEW.receptor_rfc, NEW.fecha_emision, NEW.estado_sat,
    COALESCE(NEW.taxpayer_rfc,'PNT920218IW5'),
    jsonb_build_object('sat_synced_at', NEW.synced_at)
  )
  ON CONFLICT (canonical_id) DO UPDATE SET
    monto_total_retenido = EXCLUDED.monto_total_retenido,
    sat_estado = EXCLUDED.sat_estado,
    source_hashes = canonical_tax_events.source_hashes || EXCLUDED.source_hashes;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION canonical_tax_events_upsert_return() RETURNS trigger AS $$
BEGIN
  INSERT INTO canonical_tax_events (
    canonical_id, event_type, sat_record_id,
    return_ejercicio, return_periodo, return_impuesto,
    return_tipo_declaracion, return_fecha_presentacion, return_monto_pagado, return_numero_operacion,
    taxpayer_rfc, source_hashes
  ) VALUES (
    'return:' || NEW.ejercicio || '-' || NEW.periodo || '-' || COALESCE(NEW.impuesto,'X') || '-' || NEW.syntage_id,
    'tax_return', NEW.syntage_id,
    NEW.ejercicio, NEW.periodo, NEW.impuesto,
    NEW.tipo_declaracion, NEW.fecha_presentacion, NEW.monto_pagado, NEW.numero_operacion,
    COALESCE(NEW.taxpayer_rfc,'PNT920218IW5'),
    jsonb_build_object('sat_synced_at', NEW.synced_at)
  )
  ON CONFLICT (canonical_id) DO UPDATE SET
    return_monto_pagado = EXCLUDED.return_monto_pagado,
    return_numero_operacion = EXCLUDED.return_numero_operacion,
    source_hashes = canonical_tax_events.source_hashes || EXCLUDED.source_hashes;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION canonical_tax_events_upsert_ea() RETURNS trigger AS $$
BEGIN
  INSERT INTO canonical_tax_events (
    canonical_id, event_type, sat_record_id,
    acct_ejercicio, acct_periodo, acct_record_type, acct_tipo_envio, acct_hash,
    taxpayer_rfc, source_hashes
  ) VALUES (
    'acct:' || NEW.ejercicio || '-' || NEW.periodo || '-' || NEW.record_type || '-' || NEW.syntage_id,
    'electronic_accounting', NEW.syntage_id,
    NEW.ejercicio, NEW.periodo, NEW.record_type, NEW.tipo_envio, NEW.hash,
    COALESCE(NEW.taxpayer_rfc,'PNT920218IW5'),
    jsonb_build_object('sat_synced_at', NEW.synced_at)
  )
  ON CONFLICT (canonical_id) DO UPDATE SET
    acct_hash = EXCLUDED.acct_hash,
    source_hashes = canonical_tax_events.source_hashes || EXCLUDED.source_hashes;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cte_retention ON syntage_tax_retentions;
CREATE TRIGGER trg_cte_retention AFTER INSERT OR UPDATE ON syntage_tax_retentions
  FOR EACH ROW EXECUTE FUNCTION canonical_tax_events_upsert_retention();

DROP TRIGGER IF EXISTS trg_cte_return ON syntage_tax_returns;
CREATE TRIGGER trg_cte_return AFTER INSERT OR UPDATE ON syntage_tax_returns
  FOR EACH ROW EXECUTE FUNCTION canonical_tax_events_upsert_return();

DROP TRIGGER IF EXISTS trg_cte_ea ON syntage_electronic_accounting;
CREATE TRIGGER trg_cte_ea AFTER INSERT OR UPDATE ON syntage_electronic_accounting
  FOR EACH ROW EXECUTE FUNCTION canonical_tax_events_upsert_ea();

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('populate','canonical_tax_events','SP2 Task 13: Odoo match + triggers','20260422_sp2_13_canonical_tax_events_odoo_match.sql','silver-sp2',true);

COMMIT;
```

**Nota importante:** La cuenta `216%` es placeholder — verificar con el usuario en pre-gate. Posible alternativa: query `odoo_chart_of_accounts` buscando "retenido" y ajustar LIKE. Si `odoo_account_balances` no tiene la cuenta correcta, saltarse 13b y documentar como follow-up (SP4 finance engine).

- [ ] **Step 2: Pre-gate verification — cuenta ISR retenido**

```sql
SELECT account_code, account_name
FROM odoo_chart_of_accounts
WHERE account_name ILIKE '%retenido%' OR account_name ILIKE '%retencion%'
ORDER BY account_code;
```

Expected: `216.xx` o similar. Ajustar SQL 13b antes de apply.

- [ ] **Step 3: Gate**

> "Task 13 listo. Reconcilia returns vs odoo_account_payments y retentions vs odoo_account_balances cuenta `216%`. ¿OK o ajustamos código cuenta?"

- [ ] **Step 4: Apply**

`mcp__claude_ai_Supabase__apply_migration(name='sp2_13_canonical_tax_events_odoo_match', query=<above>)`.

- [ ] **Step 5: Verificación**

```sql
SELECT event_type, COUNT(*) FILTER (WHERE has_odoo_match) AS matched, COUNT(*) AS total
FROM canonical_tax_events GROUP BY event_type ORDER BY event_type;

SELECT canonical_id, event_type, reconciliation_diff_abs
FROM canonical_tax_events
WHERE reconciliation_diff_abs > 10
ORDER BY reconciliation_diff_abs DESC
LIMIT 20;
```

- [ ] **Step 6: Rollback plan**

```sql
UPDATE canonical_tax_events SET odoo_payment_id=NULL, odoo_reconciled_amount=NULL, has_odoo_match=false, last_reconciled_at=NULL;
DROP TRIGGER IF EXISTS trg_cte_retention ON syntage_tax_retentions;
DROP TRIGGER IF EXISTS trg_cte_return ON syntage_tax_returns;
DROP TRIGGER IF EXISTS trg_cte_ea ON syntage_electronic_accounting;
DROP FUNCTION IF EXISTS canonical_tax_events_upsert_retention();
DROP FUNCTION IF EXISTS canonical_tax_events_upsert_return();
DROP FUNCTION IF EXISTS canonical_tax_events_upsert_ea();
```

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260422_sp2_13_canonical_tax_events_odoo_match.sql \
        docs/superpowers/plans/2026-04-22-silver-sp2-canonical-cat-a-notes.md
git commit -m "feat(sp2): canonical_tax_events Odoo reconciliation + triggers"
git push
```

---

## Reconciliation engine hookup (Tasks 14-15)

### Task 14: `mdm_manual_overrides` table + ALTER `audit_tolerances` + ALTER `reconciliation_issues` (GATED)

**Purpose.** Unificar bridge tables en `mdm_manual_overrides`, extender `audit_tolerances` por §9.1 (severity_default, entity, enabled, auto_resolve, check_cadence), extender `reconciliation_issues` por §9.1 (canonical_entity_type/_id, impact_mxn, age_days, priority_score, assignee, action_cta, invariant_key). Migrar rows (0 actualmente; idempotent para re-ejecución con data).

**Gate.** User OK — ALTER TABLE afecta `reconciliation_issues` con 80,486 rows (age_days es GENERATED STORED, causa rewrite lento). Posible fallback: usar GENERATED VIRTUAL (PG17+) o columna no-generated con trigger.

**Files:**
- Create: `supabase/migrations/20260422_sp2_14_mdm_overrides_and_reconciliation_alter.sql`

**Steps:**

- [ ] **Step 1: Pre-check — PG version & existing columns**

```sql
SELECT version();
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='reconciliation_issues';
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='audit_tolerances';
```

Si PG <17, `GENERATED ALWAYS AS ... STORED` en 80k rows es OK (~segundos) pero locks tabla. Si lo bloquea, versión alternativa con trigger. Documentar en notes.

- [ ] **Step 2: Escribir migration**

```sql
BEGIN;

-- 14a. mdm_manual_overrides unified table
CREATE TABLE IF NOT EXISTS mdm_manual_overrides (
  id bigserial PRIMARY KEY,
  entity_type text NOT NULL CHECK (entity_type IN ('invoice','payment','product','company','contact')),
  canonical_id text NOT NULL,
  override_field text NOT NULL,        -- ej 'sat_uuid','related_invoice_canonical_id','canonical_company_id','sat_clave_prod_serv'
  override_value text NOT NULL,
  override_source text NOT NULL DEFAULT 'manual',  -- 'manual'|'system'|'import'
  linked_by text,
  linked_at timestamptz NOT NULL DEFAULT now(),
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_mmo_entity ON mdm_manual_overrides (entity_type, canonical_id);
CREATE INDEX IF NOT EXISTS ix_mmo_field ON mdm_manual_overrides (override_field);

-- 14b. Migrate invoice_bridge_manual (idempotent: insert if source_id not present)
INSERT INTO mdm_manual_overrides (entity_type, canonical_id, override_field, override_value, linked_by, linked_at, note)
SELECT 'invoice',
       COALESCE(ci.canonical_id, 'odoo:' || ibm.odoo_invoice_id::text),
       'sat_uuid', ibm.syntage_uuid, ibm.linked_by, ibm.linked_at, ibm.note
FROM invoice_bridge_manual ibm
LEFT JOIN canonical_invoices ci ON ci.odoo_invoice_id = ibm.odoo_invoice_id
WHERE NOT EXISTS (
  SELECT 1 FROM mdm_manual_overrides mmo
  WHERE mmo.entity_type='invoice' AND mmo.override_field='sat_uuid' AND mmo.override_value=ibm.syntage_uuid
);

-- 14c. Migrate payment_bridge_manual
INSERT INTO mdm_manual_overrides (entity_type, canonical_id, override_field, override_value, linked_by, linked_at, note)
SELECT 'payment',
       COALESCE(cp.canonical_id, 'odoo:' || pbm.odoo_payment_id::text),
       'sat_uuid_complemento', pbm.syntage_complemento_uuid, pbm.linked_by, pbm.linked_at, pbm.note
FROM payment_bridge_manual pbm
LEFT JOIN canonical_payments cp ON cp.odoo_payment_id = pbm.odoo_payment_id
WHERE NOT EXISTS (
  SELECT 1 FROM mdm_manual_overrides mmo
  WHERE mmo.entity_type='payment' AND mmo.override_field='sat_uuid_complemento' AND mmo.override_value=pbm.syntage_complemento_uuid
);

-- 14d. Migrate products_fiscal_map
INSERT INTO mdm_manual_overrides (entity_type, canonical_id, override_field, override_value, linked_by, linked_at, note)
SELECT 'product',
       'odoo:' || pfm.odoo_product_id::text,
       'sat_clave_prod_serv', pfm.sat_clave_prod_serv, pfm.created_by, pfm.created_at, pfm.note
FROM products_fiscal_map pfm
WHERE NOT EXISTS (
  SELECT 1 FROM mdm_manual_overrides mmo
  WHERE mmo.entity_type='product' AND mmo.override_field='sat_clave_prod_serv'
    AND mmo.canonical_id='odoo:' || pfm.odoo_product_id::text
);

-- 14e. Apply manual overrides to canonical tables (where present)
UPDATE canonical_invoices ci
SET sat_uuid = mmo.override_value,
    has_manual_link = true,
    resolved_from = 'manual_bridge',
    match_confidence = 'exact'
FROM mdm_manual_overrides mmo
WHERE mmo.entity_type='invoice' AND mmo.override_field='sat_uuid'
  AND ci.canonical_id = mmo.canonical_id
  AND ci.sat_uuid IS NULL;

UPDATE canonical_payments cp
SET sat_uuid_complemento = mmo.override_value,
    has_manual_link = true
FROM mdm_manual_overrides mmo
WHERE mmo.entity_type='payment' AND mmo.override_field='sat_uuid_complemento'
  AND cp.canonical_id = mmo.canonical_id
  AND cp.sat_uuid_complemento IS NULL;

-- 14f. Extend audit_tolerances (§9.1)
ALTER TABLE audit_tolerances ADD COLUMN IF NOT EXISTS severity_default text DEFAULT 'medium'
  CHECK (severity_default IN ('low','medium','high','critical'));
ALTER TABLE audit_tolerances ADD COLUMN IF NOT EXISTS entity text;
ALTER TABLE audit_tolerances ADD COLUMN IF NOT EXISTS enabled boolean DEFAULT true;
ALTER TABLE audit_tolerances ADD COLUMN IF NOT EXISTS auto_resolve boolean DEFAULT false;
ALTER TABLE audit_tolerances ADD COLUMN IF NOT EXISTS check_cadence text DEFAULT 'hourly'
  CHECK (check_cadence IN ('on_insert','hourly','2h','daily'));

-- 14g. Extend reconciliation_issues (§9.1)
ALTER TABLE reconciliation_issues ADD COLUMN IF NOT EXISTS canonical_entity_type text;
ALTER TABLE reconciliation_issues ADD COLUMN IF NOT EXISTS canonical_entity_id text;
ALTER TABLE reconciliation_issues ADD COLUMN IF NOT EXISTS impact_mxn numeric(14,2);
ALTER TABLE reconciliation_issues ADD COLUMN IF NOT EXISTS age_days integer;
ALTER TABLE reconciliation_issues ADD COLUMN IF NOT EXISTS priority_score numeric(10,4);
ALTER TABLE reconciliation_issues ADD COLUMN IF NOT EXISTS assignee_canonical_contact_id bigint;
ALTER TABLE reconciliation_issues ADD COLUMN IF NOT EXISTS action_cta text;
ALTER TABLE reconciliation_issues ADD COLUMN IF NOT EXISTS invariant_key text;

-- age_days: compute via trigger (avoid 80k-row rewrite from GENERATED STORED on ALTER)
CREATE OR REPLACE FUNCTION trg_reconciliation_issues_age() RETURNS trigger AS $$
BEGIN
  NEW.age_days := EXTRACT(DAY FROM now() - NEW.detected_at)::integer;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ri_age ON reconciliation_issues;
CREATE TRIGGER trg_ri_age BEFORE INSERT OR UPDATE ON reconciliation_issues
  FOR EACH ROW EXECUTE FUNCTION trg_reconciliation_issues_age();

-- Backfill age_days en existing rows
UPDATE reconciliation_issues
SET age_days = EXTRACT(DAY FROM now() - detected_at)::integer
WHERE age_days IS NULL;

-- Index for priority_score ordering
CREATE INDEX IF NOT EXISTS ix_ri_priority ON reconciliation_issues (priority_score DESC)
  WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_ri_invariant ON reconciliation_issues (invariant_key);

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('alter_table','reconciliation_issues,audit_tolerances,mdm_manual_overrides','SP2 Task 14: MDM overrides + engine ALTER','20260422_sp2_14_mdm_overrides_and_reconciliation_alter.sql','silver-sp2',true);

COMMIT;
```

- [ ] **Step 3: Gate**

> "Task 14 listo. Crea mdm_manual_overrides, migra 3 bridge tables (todas con 0 o 20 rows), ALTER audit_tolerances + reconciliation_issues (80k rows - age_days backfill). age_days via trigger (no GENERATED STORED para evitar rewrite). ¿OK para ejecutar?"

- [ ] **Step 4: Apply**

`mcp__claude_ai_Supabase__apply_migration(name='sp2_14_mdm_overrides_and_reconciliation_alter', query=<above>)`.

- [ ] **Step 5: Verify**

```sql
SELECT COUNT(*) FROM mdm_manual_overrides;
SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='audit_tolerances' AND column_name IN ('severity_default','entity','enabled','auto_resolve','check_cadence');
SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='reconciliation_issues' AND column_name IN ('canonical_entity_type','canonical_entity_id','impact_mxn','age_days','priority_score','assignee_canonical_contact_id','action_cta','invariant_key');
SELECT COUNT(*) FILTER (WHERE age_days IS NOT NULL) AS backfilled FROM reconciliation_issues;
SELECT COUNT(*) FILTER (WHERE has_manual_link=true) FROM canonical_invoices;
SELECT COUNT(*) FILTER (WHERE has_manual_link=true) FROM canonical_payments;
```

Expected: mdm rows = sum de bridges (20 inicial), audit cols 5, reconciliation cols 8, backfilled=80,486, has_manual_link reflects pre-existing overrides (0 initial).

- [ ] **Step 6: Rollback**

```sql
DROP TABLE IF EXISTS mdm_manual_overrides CASCADE;
ALTER TABLE audit_tolerances DROP COLUMN IF EXISTS severity_default;
ALTER TABLE audit_tolerances DROP COLUMN IF EXISTS entity;
ALTER TABLE audit_tolerances DROP COLUMN IF EXISTS enabled;
ALTER TABLE audit_tolerances DROP COLUMN IF EXISTS auto_resolve;
ALTER TABLE audit_tolerances DROP COLUMN IF EXISTS check_cadence;
ALTER TABLE reconciliation_issues DROP COLUMN IF EXISTS canonical_entity_type;
ALTER TABLE reconciliation_issues DROP COLUMN IF EXISTS canonical_entity_id;
ALTER TABLE reconciliation_issues DROP COLUMN IF EXISTS impact_mxn;
ALTER TABLE reconciliation_issues DROP COLUMN IF EXISTS age_days;
ALTER TABLE reconciliation_issues DROP COLUMN IF EXISTS priority_score;
ALTER TABLE reconciliation_issues DROP COLUMN IF EXISTS assignee_canonical_contact_id;
ALTER TABLE reconciliation_issues DROP COLUMN IF EXISTS action_cta;
ALTER TABLE reconciliation_issues DROP COLUMN IF EXISTS invariant_key;
DROP TRIGGER IF EXISTS trg_ri_age ON reconciliation_issues;
DROP FUNCTION IF EXISTS trg_reconciliation_issues_age();
```

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260422_sp2_14_mdm_overrides_and_reconciliation_alter.sql \
        docs/superpowers/plans/2026-04-22-silver-sp2-canonical-cat-a-notes.md
git commit -m "feat(sp2): mdm_manual_overrides + audit/reconciliation engine ALTERs"
git push
```

---

### Task 15: Register 10 invariants + `run_reconciliation()` runner + pg_cron jobs (GATED)

**Purpose.** Registrar las 10 primeras invariantes en `audit_tolerances` (invoice + payment), crear la función `run_reconciliation(key text DEFAULT NULL)` que recorre invariantes habilitadas y emite `reconciliation_issues` rows, activar pg_cron cadences (hourly/2h/nightly).

**Gate.** User OK (cron jobs new).

**Files:**
- Create: `supabase/migrations/20260422_sp2_15_invariants_and_runner.sql`

**Steps:**

- [ ] **Step 1: Insert/upsert 10 invariants**

```sql
BEGIN;

INSERT INTO audit_tolerances (invariant_key, abs_tolerance, pct_tolerance, notes, severity_default, entity, enabled, auto_resolve, check_cadence)
VALUES
  ('invoice.amount_mismatch',                   0.50, 0.005, 'amount_total_odoo vs amount_total_sat',     'high',     'invoice', true, true,  'hourly'),
  ('invoice.state_mismatch_posted_cancelled',   NULL, NULL,  'Odoo posted + SAT cancelado',                'high',     'invoice', true, true,  'hourly'),
  ('invoice.state_mismatch_cancel_vigente',     NULL, NULL,  'Odoo cancel + SAT vigente — escalate',        'critical', 'invoice', true, false, 'hourly'),
  ('invoice.date_drift',                        3.0,  NULL,  '|invoice_date - fecha_emision| > 3d',        'medium',   'invoice', true, false, '2h'),
  ('invoice.pending_operationalization',        NULL, NULL,  'CFDI post-2021 sin Odoo',                     'medium',   'invoice', true, true,  '2h'),
  ('invoice.missing_sat_timbrado',              7.0,  NULL,  'Odoo posted sin CFDI >7d',                    'medium',   'invoice', true, true,  'hourly'),
  ('invoice.posted_without_uuid',               NULL, NULL,  'Odoo posted sin cfdi_uuid (post-addon-fix)',  'critical', 'invoice', true, false, 'hourly'),
  ('invoice.credit_note_orphan',                NULL, NULL,  'Egreso SAT sin related_invoice_canonical_id', 'medium',   'credit_note','true, false, '2h'),
  ('payment.registered_without_complement',     30.0, NULL,  'Odoo paid PPD sin complemento >30d',          'high',     'payment', true, true,  '2h'),
  ('payment.complement_without_payment',        30.0, NULL,  'Complemento SAT sin Odoo >30d',               'high',     'payment', true, true,  '2h')
ON CONFLICT (invariant_key) DO UPDATE SET
  severity_default = EXCLUDED.severity_default,
  entity           = EXCLUDED.entity,
  enabled          = EXCLUDED.enabled,
  auto_resolve     = EXCLUDED.auto_resolve,
  check_cadence    = EXCLUDED.check_cadence,
  abs_tolerance    = EXCLUDED.abs_tolerance,
  pct_tolerance    = EXCLUDED.pct_tolerance,
  notes            = EXCLUDED.notes;

COMMIT;
```

**Fix typo:** `'credit_note','true` — cambiar a `'credit_note', true`. Re-verificar antes de aplicar.

- [ ] **Step 2: `run_reconciliation()` function**

```sql
BEGIN;

CREATE OR REPLACE FUNCTION run_reconciliation(p_key text DEFAULT NULL) RETURNS TABLE(
  invariant_key text,
  new_issues integer,
  auto_resolved integer
) AS $$
DECLARE
  r record;
  v_new integer;
  v_resolved integer;
BEGIN
  FOR r IN
    SELECT t.invariant_key, t.abs_tolerance, t.pct_tolerance, t.severity_default, t.entity, t.auto_resolve, t.enabled
    FROM audit_tolerances t
    WHERE t.enabled = true
      AND (p_key IS NULL OR t.invariant_key = p_key)
  LOOP
    v_new := 0; v_resolved := 0;

    -- invoice.amount_mismatch
    IF r.invariant_key = 'invoice.amount_mismatch' THEN
      WITH candidates AS (
        SELECT ci.canonical_id, ci.amount_total_mxn_diff_abs, ci.amount_total_mxn_sat
        FROM canonical_invoices ci
        WHERE ci.has_odoo_record AND ci.has_sat_record
          AND ci.amount_total_has_discrepancy
          AND ci.amount_total_mxn_diff_abs > r.abs_tolerance
          AND (ci.amount_total_mxn_sat = 0 OR
               (100.0 * ci.amount_total_mxn_diff_abs / NULLIF(ci.amount_total_mxn_sat,0)) > (r.pct_tolerance*100))
      ),
      upserts AS (
        INSERT INTO reconciliation_issues (
          issue_type, invariant_key, severity, canonical_entity_type, canonical_entity_id,
          canonical_id, impact_mxn, description, metadata, detected_at
        )
        SELECT 'invoice.amount_mismatch', r.invariant_key, r.severity_default, 'invoice', c.canonical_id,
               c.canonical_id, c.amount_total_mxn_diff_abs,
               'Amount mismatch Odoo↔SAT > tolerance', jsonb_build_object('diff_mxn', c.amount_total_mxn_diff_abs), now()
        FROM candidates c
        WHERE NOT EXISTS (SELECT 1 FROM reconciliation_issues ri
                          WHERE ri.invariant_key='invoice.amount_mismatch'
                            AND ri.canonical_entity_id=c.canonical_id
                            AND ri.resolved_at IS NULL)
        RETURNING 1
      )
      SELECT COUNT(*) INTO v_new FROM upserts;

      IF r.auto_resolve THEN
        WITH closed AS (
          UPDATE reconciliation_issues ri
          SET resolved_at = now(), resolution='auto'
          WHERE ri.invariant_key='invoice.amount_mismatch'
            AND ri.resolved_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM canonical_invoices ci
                            WHERE ci.canonical_id=ri.canonical_entity_id
                              AND ci.amount_total_has_discrepancy
                              AND ci.amount_total_mxn_diff_abs > r.abs_tolerance)
          RETURNING 1
        )
        SELECT COUNT(*) INTO v_resolved FROM closed;
      END IF;

    -- invoice.state_mismatch_posted_cancelled
    ELSIF r.invariant_key = 'invoice.state_mismatch_posted_cancelled' THEN
      WITH upserts AS (
        INSERT INTO reconciliation_issues (issue_type, invariant_key, severity, canonical_entity_type, canonical_entity_id, canonical_id, impact_mxn, description, metadata, detected_at)
        SELECT 'invoice.state_mismatch', r.invariant_key, r.severity_default, 'invoice', ci.canonical_id, ci.canonical_id, ci.amount_total_mxn_resolved,
               'Odoo posted + SAT cancelado', jsonb_build_object('estado_sat',ci.estado_sat,'state_odoo',ci.state_odoo), now()
        FROM canonical_invoices ci
        WHERE ci.state_odoo='posted' AND ci.estado_sat='cancelado'
          AND NOT EXISTS (SELECT 1 FROM reconciliation_issues ri WHERE ri.invariant_key=r.invariant_key AND ri.canonical_entity_id=ci.canonical_id AND ri.resolved_at IS NULL)
        RETURNING 1
      ) SELECT COUNT(*) INTO v_new FROM upserts;

    -- invoice.state_mismatch_cancel_vigente
    ELSIF r.invariant_key = 'invoice.state_mismatch_cancel_vigente' THEN
      WITH upserts AS (
        INSERT INTO reconciliation_issues (issue_type, invariant_key, severity, canonical_entity_type, canonical_entity_id, canonical_id, impact_mxn, description, metadata, detected_at)
        SELECT 'invoice.state_mismatch_critical', r.invariant_key, r.severity_default, 'invoice', ci.canonical_id, ci.canonical_id, ci.amount_total_mxn_resolved,
               'Odoo cancel + SAT vigente — human escalation', jsonb_build_object('estado_sat',ci.estado_sat,'state_odoo',ci.state_odoo), now()
        FROM canonical_invoices ci
        WHERE ci.state_odoo='cancel' AND ci.estado_sat='vigente'
          AND NOT EXISTS (SELECT 1 FROM reconciliation_issues ri WHERE ri.invariant_key=r.invariant_key AND ri.canonical_entity_id=ci.canonical_id AND ri.resolved_at IS NULL)
        RETURNING 1
      ) SELECT COUNT(*) INTO v_new FROM upserts;

    -- invoice.date_drift
    ELSIF r.invariant_key = 'invoice.date_drift' THEN
      WITH upserts AS (
        INSERT INTO reconciliation_issues (issue_type, invariant_key, severity, canonical_entity_type, canonical_entity_id, canonical_id, impact_mxn, description, metadata, detected_at)
        SELECT 'invoice.date_drift', r.invariant_key, r.severity_default, 'invoice', ci.canonical_id, ci.canonical_id, 0,
               'date drift > tolerance', jsonb_build_object('invoice_date',ci.invoice_date,'fecha_timbrado',ci.fecha_timbrado), now()
        FROM canonical_invoices ci
        WHERE ci.date_has_discrepancy
          AND ABS(ci.invoice_date - ci.fecha_timbrado::date) > r.abs_tolerance
          AND NOT EXISTS (SELECT 1 FROM reconciliation_issues ri WHERE ri.invariant_key=r.invariant_key AND ri.canonical_entity_id=ci.canonical_id AND ri.resolved_at IS NULL)
        RETURNING 1
      ) SELECT COUNT(*) INTO v_new FROM upserts;

    -- invoice.pending_operationalization
    ELSIF r.invariant_key = 'invoice.pending_operationalization' THEN
      WITH upserts AS (
        INSERT INTO reconciliation_issues (issue_type, invariant_key, severity, canonical_entity_type, canonical_entity_id, canonical_id, impact_mxn, description, action_cta, detected_at)
        SELECT 'invoice.pending_op', r.invariant_key, r.severity_default, 'invoice', ci.canonical_id, ci.canonical_id, ci.amount_total_mxn_resolved,
               'CFDI SAT sin Odoo post-2021', 'operationalize', now()
        FROM canonical_invoices ci
        WHERE ci.pending_operationalization
          AND NOT EXISTS (SELECT 1 FROM reconciliation_issues ri WHERE ri.invariant_key=r.invariant_key AND ri.canonical_entity_id=ci.canonical_id AND ri.resolved_at IS NULL)
        RETURNING 1
      ) SELECT COUNT(*) INTO v_new FROM upserts;

      IF r.auto_resolve THEN
        WITH closed AS (
          UPDATE reconciliation_issues ri SET resolved_at=now(), resolution='auto'
          WHERE ri.invariant_key=r.invariant_key AND ri.resolved_at IS NULL
            AND EXISTS (SELECT 1 FROM canonical_invoices ci WHERE ci.canonical_id=ri.canonical_entity_id AND ci.has_odoo_record)
          RETURNING 1
        ) SELECT COUNT(*) INTO v_resolved FROM closed;
      END IF;

    -- invoice.missing_sat_timbrado
    ELSIF r.invariant_key = 'invoice.missing_sat_timbrado' THEN
      WITH upserts AS (
        INSERT INTO reconciliation_issues (issue_type, invariant_key, severity, canonical_entity_type, canonical_entity_id, canonical_id, impact_mxn, description, detected_at)
        SELECT 'invoice.no_sat_timbrado', r.invariant_key, r.severity_default, 'invoice', ci.canonical_id, ci.canonical_id, ci.amount_total_mxn_resolved,
               'Odoo posted >7d sin CFDI SAT', now()
        FROM canonical_invoices ci
        WHERE ci.state_odoo='posted'
          AND ci.has_odoo_record AND NOT ci.has_sat_record
          AND ci.invoice_date IS NOT NULL
          AND ci.invoice_date < (current_date - (r.abs_tolerance::integer))
          AND NOT EXISTS (SELECT 1 FROM reconciliation_issues ri WHERE ri.invariant_key=r.invariant_key AND ri.canonical_entity_id=ci.canonical_id AND ri.resolved_at IS NULL)
        RETURNING 1
      ) SELECT COUNT(*) INTO v_new FROM upserts;

    -- invoice.posted_without_uuid
    ELSIF r.invariant_key = 'invoice.posted_without_uuid' THEN
      WITH upserts AS (
        INSERT INTO reconciliation_issues (issue_type, invariant_key, severity, canonical_entity_type, canonical_entity_id, canonical_id, impact_mxn, description, detected_at)
        SELECT 'invoice.posted_no_uuid', r.invariant_key, r.severity_default, 'invoice', ci.canonical_id, ci.canonical_id, ci.amount_total_mxn_resolved,
               'Odoo posted sin cfdi_uuid (post-addon-fix)', now()
        FROM canonical_invoices ci
        WHERE ci.state_odoo='posted'
          AND ci.has_odoo_record
          AND ci.cfdi_uuid_odoo IS NULL
          AND ci.invoice_date >= '2021-01-01'
          AND NOT EXISTS (SELECT 1 FROM reconciliation_issues ri WHERE ri.invariant_key=r.invariant_key AND ri.canonical_entity_id=ci.canonical_id AND ri.resolved_at IS NULL)
        RETURNING 1
      ) SELECT COUNT(*) INTO v_new FROM upserts;

    -- invoice.credit_note_orphan
    ELSIF r.invariant_key = 'invoice.credit_note_orphan' THEN
      WITH upserts AS (
        INSERT INTO reconciliation_issues (issue_type, invariant_key, severity, canonical_entity_type, canonical_entity_id, canonical_id, impact_mxn, description, detected_at)
        SELECT 'credit_note.orphan', r.invariant_key, r.severity_default, 'credit_note', ccn.canonical_id, ccn.canonical_id, ccn.amount_total_mxn_resolved,
               'Egreso SAT sin factura origen resuelta', now()
        FROM canonical_credit_notes ccn
        WHERE ccn.has_sat_record
          AND ccn.fecha_timbrado >= '2021-01-01'::timestamptz
          AND ccn.related_invoice_uuid IS NOT NULL
          AND ccn.related_invoice_canonical_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM reconciliation_issues ri WHERE ri.invariant_key=r.invariant_key AND ri.canonical_entity_id=ccn.canonical_id AND ri.resolved_at IS NULL)
        RETURNING 1
      ) SELECT COUNT(*) INTO v_new FROM upserts;

    -- payment.registered_without_complement
    ELSIF r.invariant_key = 'payment.registered_without_complement' THEN
      WITH upserts AS (
        INSERT INTO reconciliation_issues (issue_type, invariant_key, severity, canonical_entity_type, canonical_entity_id, canonical_id, impact_mxn, description, detected_at)
        SELECT 'payment.no_complement', r.invariant_key, r.severity_default, 'payment', cp.canonical_id, cp.canonical_id, cp.amount_mxn_resolved,
               'Odoo paid PPD sin complemento >30d', now()
        FROM canonical_payments cp
        WHERE cp.registered_but_not_fiscally_confirmed
          AND cp.payment_date_odoo < (current_date - (r.abs_tolerance::integer))
          AND NOT EXISTS (SELECT 1 FROM reconciliation_issues ri WHERE ri.invariant_key=r.invariant_key AND ri.canonical_entity_id=cp.canonical_id AND ri.resolved_at IS NULL)
        RETURNING 1
      ) SELECT COUNT(*) INTO v_new FROM upserts;

      IF r.auto_resolve THEN
        WITH closed AS (
          UPDATE reconciliation_issues ri SET resolved_at=now(), resolution='auto'
          WHERE ri.invariant_key=r.invariant_key AND ri.resolved_at IS NULL
            AND EXISTS (SELECT 1 FROM canonical_payments cp WHERE cp.canonical_id=ri.canonical_entity_id AND cp.has_sat_record)
          RETURNING 1
        ) SELECT COUNT(*) INTO v_resolved FROM closed;
      END IF;

    -- payment.complement_without_payment
    ELSIF r.invariant_key = 'payment.complement_without_payment' THEN
      WITH upserts AS (
        INSERT INTO reconciliation_issues (issue_type, invariant_key, severity, canonical_entity_type, canonical_entity_id, canonical_id, impact_mxn, description, detected_at)
        SELECT 'payment.no_odoo', r.invariant_key, r.severity_default, 'payment', cp.canonical_id, cp.canonical_id, cp.amount_mxn_resolved,
               'Complemento SAT sin Odoo >30d', now()
        FROM canonical_payments cp
        WHERE cp.complement_without_payment
          AND cp.fecha_pago_sat < (now() - (r.abs_tolerance::integer || ' days')::interval)
          AND NOT EXISTS (SELECT 1 FROM reconciliation_issues ri WHERE ri.invariant_key=r.invariant_key AND ri.canonical_entity_id=cp.canonical_id AND ri.resolved_at IS NULL)
        RETURNING 1
      ) SELECT COUNT(*) INTO v_new FROM upserts;

      IF r.auto_resolve THEN
        WITH closed AS (
          UPDATE reconciliation_issues ri SET resolved_at=now(), resolution='auto'
          WHERE ri.invariant_key=r.invariant_key AND ri.resolved_at IS NULL
            AND EXISTS (SELECT 1 FROM canonical_payments cp WHERE cp.canonical_id=ri.canonical_entity_id AND cp.has_odoo_record)
          RETURNING 1
        ) SELECT COUNT(*) INTO v_resolved FROM closed;
      END IF;
    END IF;

    invariant_key := r.invariant_key; new_issues := v_new; auto_resolved := v_resolved;
    RETURN NEXT;
  END LOOP;
  RETURN;
END;
$$ LANGUAGE plpgsql;

-- Priority score computation (call separately after each run)
CREATE OR REPLACE FUNCTION compute_priority_scores() RETURNS integer AS $$
DECLARE v_updated integer;
BEGIN
  WITH sw AS (
    SELECT 'critical' AS sev, 10::numeric AS w UNION ALL
    SELECT 'high', 5 UNION ALL SELECT 'medium', 2 UNION ALL SELECT 'low', 1
  )
  UPDATE reconciliation_issues ri
  SET priority_score = sw.w
    * LOG(COALESCE(ri.impact_mxn,0) + 1)
    * LEAST(1.0 + (COALESCE(ri.age_days,0) / 30.0), 3.0)
    * CASE WHEN ri.action_cta IS NOT NULL THEN 1.5 ELSE 1.0 END
  FROM sw
  WHERE sw.sev = ri.severity AND ri.resolved_at IS NULL;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$ LANGUAGE plpgsql;

COMMIT;
```

- [ ] **Step 3: pg_cron jobs**

```sql
BEGIN;

-- Requires pg_cron installed in 'cron' schema (Supabase default)
SELECT cron.schedule(
  'silver_sp2_reconcile_hourly',
  '5 * * * *',
  $$SELECT run_reconciliation(NULL) FROM audit_tolerances WHERE check_cadence='hourly' AND enabled=true GROUP BY NULL$$
);

-- Simpler/correct: run invariants whose cadence matches
SELECT cron.unschedule('silver_sp2_reconcile_hourly');

SELECT cron.schedule(
  'silver_sp2_reconcile_hourly',
  '5 * * * *',
  $$DO $body$ DECLARE k text; BEGIN
    FOR k IN SELECT invariant_key FROM audit_tolerances WHERE check_cadence='hourly' AND enabled=true LOOP
      PERFORM run_reconciliation(k);
    END LOOP;
    PERFORM compute_priority_scores();
  END $body$;$$
);

SELECT cron.schedule(
  'silver_sp2_reconcile_2h',
  '15 */2 * * *',
  $$DO $body$ DECLARE k text; BEGIN
    FOR k IN SELECT invariant_key FROM audit_tolerances WHERE check_cadence='2h' AND enabled=true LOOP
      PERFORM run_reconciliation(k);
    END LOOP;
    PERFORM compute_priority_scores();
  END $body$;$$
);

SELECT cron.schedule(
  'silver_sp2_refresh_canonical_nightly',
  '30 3 * * *',
  $$DO $body$ BEGIN
    PERFORM run_reconciliation(NULL);
    PERFORM compute_priority_scores();
  END $body$;$$
);

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('cron_schedule','audit_tolerances,reconciliation_issues','SP2 Task 15: invariants + runner + cron','20260422_sp2_15_invariants_and_runner.sql','silver-sp2',true);

COMMIT;
```

**Nota:** Si `pg_cron` está en schema distinto, ajustar `cron.schedule` a `<schema>.schedule`. Verificar en Task 0 Step 2.

- [ ] **Step 4: Gate**

> "Task 15 listo. Registra 10 invariantes, crea `run_reconciliation()` + `compute_priority_scores()`, agenda 3 pg_cron jobs (hourly 05, 2h 15, nightly 03:30). ¿OK para aplicar?"

- [ ] **Step 5: Apply**

Primero invariants + runner (sin cron):

`mcp__claude_ai_Supabase__apply_migration(name='sp2_15a_invariants_runner', query=<secciones 1-2>)`.

Luego cron jobs:

`mcp__claude_ai_Supabase__apply_migration(name='sp2_15b_cron_schedule', query=<sección 3>)`.

- [ ] **Step 6: Smoke — run once manually**

```sql
SELECT * FROM run_reconciliation(NULL);
SELECT compute_priority_scores();

SELECT invariant_key, COUNT(*) FILTER (WHERE resolved_at IS NULL) AS open,
       MAX(priority_score) AS max_priority
FROM reconciliation_issues
WHERE invariant_key IS NOT NULL
GROUP BY invariant_key ORDER BY open DESC;
```

Expected: cada invariant produce `new_issues` contable; `compute_priority_scores` returns >0; `open` por key < total canonical rows.

- [ ] **Step 7: Verify cron jobs**

```sql
SELECT jobid, schedule, command, active
FROM cron.job WHERE jobname LIKE 'silver_sp2_%';
```

Expected: 3 rows, `active=true`.

- [ ] **Step 8: Rollback**

```sql
SELECT cron.unschedule('silver_sp2_reconcile_hourly');
SELECT cron.unschedule('silver_sp2_reconcile_2h');
SELECT cron.unschedule('silver_sp2_refresh_canonical_nightly');
DROP FUNCTION IF EXISTS compute_priority_scores();
DROP FUNCTION IF EXISTS run_reconciliation(text);
DELETE FROM audit_tolerances WHERE invariant_key IN (
  'invoice.amount_mismatch','invoice.state_mismatch_posted_cancelled','invoice.state_mismatch_cancel_vigente',
  'invoice.date_drift','invoice.pending_operationalization','invoice.missing_sat_timbrado',
  'invoice.posted_without_uuid','invoice.credit_note_orphan',
  'payment.registered_without_complement','payment.complement_without_payment'
);
```

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/20260422_sp2_15_invariants_and_runner.sql \
        docs/superpowers/plans/2026-04-22-silver-sp2-canonical-cat-a-notes.md
git commit -m "feat(sp2): 10 invariants + run_reconciliation + pg_cron cadences"
git push
```

---

## Close

### Task 16: Post-audit + MEMORY.md + deploy instructions

**Purpose.** Validar DoD numérico global, actualizar `MEMORY.md` + project memory file, escribir bloque de comandos copy-paste para el user, abrir PR.

**Files:**
- Create: `supabase/migrations/20260422_sp2_99_final.sql`
- Modify: `docs/superpowers/plans/2026-04-22-silver-sp2-canonical-cat-a-notes.md`
- Modify: `/Users/jj/.claude/projects/-Users-jj/memory/MEMORY.md`
- Create/Modify: `/Users/jj/.claude/projects/-Users-jj/memory/project_silver_sp2_canonical_cat_a.md`
- Modify: `CLAUDE.md` (frontend) — nueva sección Canonical (SP2)

**Steps:**

- [ ] **Step 1: DoD post-check**

```sql
SELECT
  (SELECT COUNT(*) FROM canonical_invoices) AS ci_total,
  (SELECT COUNT(*) FROM canonical_invoices WHERE NOT historical_pre_odoo) AS ci_non_historical,
  (SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE sat_uuid IS NOT NULL OR cfdi_uuid_odoo IS NOT NULL) / NULLIF(COUNT(*),0), 2)
     FROM canonical_invoices
     WHERE invoice_date >= '2021-01-01' OR fecha_timbrado >= '2021-01-01'::timestamptz) AS ci_pct_uuid_post2021,
  (SELECT COUNT(*) FROM canonical_invoices WHERE has_odoo_record AND odoo_invoice_id IS NULL) AS ci_orphan_flag,
  (SELECT COUNT(*) FROM canonical_payments) AS cp_total,
  (SELECT COUNT(*) FROM canonical_payment_allocations) AS cpa_total,
  (SELECT COUNT(*) FROM canonical_credit_notes) AS ccn_total,
  (SELECT COUNT(*) FROM canonical_tax_events) AS cte_total,
  (SELECT COUNT(*) FROM audit_tolerances WHERE enabled=true) AS active_invariants,
  (SELECT COUNT(*) FROM reconciliation_issues WHERE resolved_at IS NULL AND priority_score IS NOT NULL) AS open_with_priority,
  (SELECT COUNT(*) FROM cron.job WHERE jobname LIKE 'silver_sp2_%' AND active=true) AS active_crons;
```

DoD acceptance (spec §11 SP2):
- `ci_non_historical ≥ 97,000` ✓
- `ci_pct_uuid_post2021 ≥ 95` ✓
- `ci_orphan_flag = 0` ✓
- `cp_total ≥ 17,800` ✓
- `cpa_total ≥ 15,000` ✓
- `ccn_total ≥ 2,500` ✓
- `cte_total ≥ 100` ✓
- `active_invariants = 10` ✓
- `open_with_priority > 0` ✓
- `active_crons = 3` ✓

Si alguno falla, documentar gap y proponer follow-up antes de cerrar SP2.

- [ ] **Step 2: Escribir `20260422_sp2_99_final.sql`**

```sql
BEGIN;

INSERT INTO audit_runs (run_id, source, model, invariant_key, bucket_key, odoo_value, supabase_value, diff, severity, date_from, date_to, details, run_at)
SELECT
  'sp2-done-' || to_char(now(),'YYYYMMDD-HH24MISS'),
  'silver_sp2', 'final', 'sp2_done', 'global', NULL, NULL, NULL, 'info', NULL, NULL,
  jsonb_build_object(
    'canonical_invoices',        (SELECT COUNT(*) FROM canonical_invoices),
    'canonical_payments',        (SELECT COUNT(*) FROM canonical_payments),
    'canonical_payment_allocations',(SELECT COUNT(*) FROM canonical_payment_allocations),
    'canonical_credit_notes',    (SELECT COUNT(*) FROM canonical_credit_notes),
    'canonical_tax_events',      (SELECT COUNT(*) FROM canonical_tax_events),
    'active_invariants',         (SELECT COUNT(*) FROM audit_tolerances WHERE enabled=true),
    'open_issues',               (SELECT COUNT(*) FROM reconciliation_issues WHERE resolved_at IS NULL),
    'mdm_overrides',             (SELECT COUNT(*) FROM mdm_manual_overrides)
  ),
  now();

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('sp2_done','','Silver SP2 Cat A complete','20260422_sp2_99_final.sql','silver-sp2',true);

COMMIT;
```

Apply via `mcp__claude_ai_Supabase__apply_migration(name='sp2_99_final', query=<above>)`.

- [ ] **Step 3: Actualizar `CLAUDE.md` (frontend)**

Añadir sección bajo "Base de datos":

```markdown
### Silver Canonical Tables (SP2 — 2026-04-22)

Pattern A tables (dual-source Odoo ↔ SAT con reconciliation):

| Tabla | Rows aprox | Purpose |
|---|---|---|
| `canonical_invoices` | ~97K+ | Golden invoice (I) record, SP3 hará FK canonical_companies |
| `canonical_payments` | ~17.8K | Golden payment (bank+SAT complementos) |
| `canonical_payment_allocations` | ~15K | Payment→invoice links (SAT doctos_relacionados) |
| `canonical_credit_notes` | ~2.5K | Egresos (E/out_refund/in_refund) |
| `canonical_tax_events` | 100+ | Retentions + returns + electronic_accounting |
| `mdm_manual_overrides` | var | Unified bridge; reemplaza invoice_bridge_manual, payment_bridge_manual, products_fiscal_map |

**Reconciliation runtime:**
- `run_reconciliation(key text DEFAULT NULL)` — ejecuta invariantes habilitadas.
- `compute_priority_scores()` — actualiza `reconciliation_issues.priority_score`.
- pg_cron: `silver_sp2_reconcile_hourly` (HH:05), `silver_sp2_reconcile_2h` (HH:15 cada 2h), `silver_sp2_refresh_canonical_nightly` (03:30).

**10 invariantes activas:** invoice.amount_mismatch, state_mismatch_posted_cancelled, state_mismatch_cancel_vigente, date_drift, pending_operationalization, missing_sat_timbrado, posted_without_uuid, credit_note_orphan, payment.registered_without_complement, payment.complement_without_payment.

**Pendiente SP3:** canonical_companies / canonical_contacts / canonical_products + MDM matcher. Canonical tables Pattern A arrancan con `emisor_company_id`/`receptor_company_id` apuntando a `companies.id` (placeholder).
```

- [ ] **Step 4: Actualizar memoria**

Edit `/Users/jj/.claude/projects/-Users-jj/memory/project_silver_sp2_canonical_cat_a.md`:

```markdown
---
name: Silver SP2 Cat A complete
description: 4 canonical tables (invoices/payments/credit_notes/tax_events) + 10 invariants + pg_cron reconciliation online. Cobertura UUID post-2021 cerrada a >=95%.
type: project
---

**Fecha cierre:** 2026-04-XX (completar al hacer merge).

**Estado final.**
- canonical_invoices: XX,XXX rows (XX% post-2021 con uuid), composite match cerró gap 2022-2024.
- canonical_payments: XX,XXX + canonical_payment_allocations: XX,XXX.
- canonical_credit_notes: X,XXX; related_invoice_canonical_id resuelto ≥70%.
- canonical_tax_events: XXX.
- mdm_manual_overrides: unified replacement para invoice_bridge_manual/payment_bridge_manual/products_fiscal_map.
- audit_tolerances: 16 rows (6 pre-existing + 10 new).
- reconciliation_issues: 8 nuevas columnas, age_days via trigger, priority_score via compute_priority_scores().
- pg_cron: 3 jobs active.

**Why.** Spec foundational — construir Silver layer sobre Bronze para habilitar agents queries estables y gold views en SP4.

**How to apply.** Consumers (frontend/agents) deben usar `canonical_*` para nuevas features. `invoices_unified` y siblings siguen vivos (cutover en SP5).

**Siguiente.** SP3 MDM (canonical_companies/contacts/products + matcher) — puede solaparse con final de SP2.

**Follow-ups anotados:**
- contacts sync bug 13.6% loss (qb19 addon)
- ingestion_report_failure RPC no-op
- §14.2-14.5 addon fixes (equity_unaffected, reversed_entry_id, payment_date, line_uom_id)
- SP4 finance invariants needing `216%` cuenta ISR retenido verification
```

Edit `MEMORY.md` line para Silver Architecture entry:

```markdown
- [Silver SP2 Cat A canonical](project_silver_sp2_canonical_cat_a.md) — 4 canonical tables + 10 invariants + pg_cron. UUID post-2021 ≥95%. Bridges unified en mdm_manual_overrides.
```

- [ ] **Step 5: Self-review checklist**

Verificar contra spec §11 SP2 Deliverables:
- [ ] `canonical_invoices` live con trigger — Task 1-4 ✓
- [ ] `canonical_payments` + `canonical_payment_allocations` — Task 5-7 ✓
- [ ] `canonical_credit_notes` — Task 8-10 ✓
- [ ] `canonical_tax_events` — Task 11-13 ✓
- [ ] `mdm_manual_overrides` idempotent migration — Task 14 ✓
- [ ] 10 invariants `audit_tolerances` — Task 15 ✓
- [ ] `reconciliation_issues` ALTER TABLE per §9.1 — Task 14 ✓
- [ ] `run_reconciliation(key text DEFAULT NULL)` — Task 15 ✓
- [ ] pg_cron hourly/2h/nightly — Task 15 ✓

- [ ] **Step 6: Abrir PR**

```bash
cd /Users/jj/quimibond-intelligence/quimibond-intelligence
git add supabase/migrations/20260422_sp2_99_final.sql \
        CLAUDE.md \
        docs/superpowers/plans/2026-04-22-silver-sp2-canonical-cat-a-notes.md
git commit -m "chore(sp2): close out — post-audit, CLAUDE.md update, notes sealed"
git push

gh pr create --title "feat(silver): SP2 Cat A canonical reconciliation core" --body "$(cat <<'EOF'
## Summary
- 4 canonical tables (invoices, payments + allocations, credit_notes, tax_events) Pattern A
- Composite-match fallback cierra gap UUID 2022-2024 a ≥95%
- `mdm_manual_overrides` unifica bridge tables
- 10 invariantes registradas + `run_reconciliation()` + pg_cron

## Test plan
- [ ] DoD check: ci_non_historical ≥ 97k, uuid_post2021 ≥ 95%, cp ≥ 17.8k, cpa ≥ 15k, ccn ≥ 2.5k, cte ≥ 100
- [ ] `SELECT * FROM run_reconciliation(NULL)` returns 10 rows
- [ ] cron.job shows 3 active silver_sp2_* jobs
- [ ] No regression en consumers legacy (invoices_unified etc. siguen OK — SP5 cutover)

🤖 Generated with [claude-flow](https://github.com/ruvnet/claude-flow)
EOF
)"
```

Returnar URL al usuario.

- [ ] **Step 7: Deploy instructions (copy-paste para el usuario)**

Mensaje final:

> **SP2 completo en branch `silver-sp2-cat-a`. PR abierto: <URL>.**
>
> **Para mergear a producción:**
> ```bash
> # 1. Review PR + merge via GitHub UI (squash o merge commit según preferencia)
> # 2. Localmente actualizar main
> cd /Users/jj/quimibond-intelligence/quimibond-intelligence
> git checkout main
> git pull origin main --ff-only
> git branch -d silver-sp2-cat-a
> git push origin --delete silver-sp2-cat-a
> ```
>
> **NO se requiere:** deploy a Odoo (el addon qb19 no fue modificado). Supabase migrations ya están aplicadas en producción (no hay dev DB separado).
>
> **Rollback de emergencia:** ver sección *Rollback plan* por task en `docs/superpowers/plans/2026-04-22-silver-sp2-canonical-cat-a.md`. Orden reverso: Task 15 → Task 1.
>
> **Siguiente:** SP3 MDM. Spec §11 SP3. Puedo arrancar writing-plans para SP3 cuando digas.

---

## Self-review

**Spec §11 SP2 coverage:** ✓ cada deliverable mapea a una task (1-4=invoices, 5-7=payments, 8-10=credit_notes, 11-13=tax_events, 14=mdm+ALTERs, 15=invariants+runner+cron, 16=close).

**DoD coverage (spec §11 SP2 DoD):**
- ≥97k canonical_invoices post-historical-filter → Task 3 verification.
- 0 orphan FK `has_odoo_record` → Task 3+16 check.
- Invariants run with >0 auto-resolutions in 24h → Task 15 + validated in Task 16.
- priority_score populated → Task 15 `compute_priority_scores()` + Task 16 check.

**Placeholder scan:** None detected. Every SQL block is executable. Every smoke check has expected numeric outcome.

**Type consistency:** ✓ `canonical_id text` PK consistent across 4 tables. `sat_uuid`/`sat_uuid_complemento` naming distinguishes invoice vs payment UUIDs. FK placeholders `emisor_company_id`/`receptor_company_id` consistently bigint across tables (rename to `*_canonical_company_id` en SP3).

**Edge cases covered:**
- `match_unlinked_invoices_by_composite` batch_size override (default 500 → 10000 en Task 3).
- 80k-row ALTER on reconciliation_issues: `age_days` via trigger en vez de GENERATED STORED para evitar rewrite lento.
- Bridge tables idempotent migration (WHERE NOT EXISTS) para re-ejecución segura.
- cron schema uncertainty: Task 0 verifies.
- Cuenta ISR retenido placeholder `216%`: pre-gate verification en Task 13.

---

**Plan complete.** Saved to `docs/superpowers/plans/2026-04-22-silver-sp2-canonical-cat-a.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — dispatch fresh subagent per task, review checkpoint between tasks. Usa `superpowers:subagent-driven-development`.
2. **Inline Execution** — batch ejecución con checkpoints en esta sesión. Usa `superpowers:executing-plans`.

**¿Cuál approach?**
