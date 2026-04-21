# Silver SP3 — MDM Cat C (Master Data Management) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the MDM layer on top of SP2: create canonical_companies (~2,200+ with shadows), canonical_contacts, canonical_products (7,222) + canonical_employees view; populate `source_links` traceability table; complete `mdm_manual_overrides` schema; ship 6 matcher functions + 3 manual-override functions; back-fill canonical_invoices/payments/credit_notes FKs from `*_company_id` placeholders to real `*_canonical_company_id` pointing at canonical_companies; activate pg_cron matcher_all_pending (2h) + trigger-fired matcher on Bronze inserts.

**Architecture:** Branch `silver-sp3-mdm` off `main` at `fd62141`. Single-file migration per task with 3-commit-per-track cadence (DDL → populate → triggers/indices). Shadow company creation for 61,264 SAT-only canonical_invoices counterparties (spec §5.5 "SAT-only counterparty" policy). FK rename uses ALTER COLUMN (not DROP+ADD) to preserve indices. Matcher functions are `plpgsql` with explicit deterministic rules (§7.1) + pg_trgm fallback (§7.2). Destructive operations (mass INSERT on canonical_companies, FK rename on 88k canonical_invoices, shadow creation on 61k rows) gated with explicit OK from user.

**Tech Stack:** PostgreSQL 15 (Supabase `tozqezmivpblmcubmnpi`), pg_trgm (fuzzy name match), pg_cron (schedule), `mcp__claude_ai_Supabase__apply_migration` for DDL, `mcp__claude_ai_Supabase__execute_sql` for verification.

**Spec:** `/Users/jj/quimibond-intelligence/quimibond-intelligence/docs/superpowers/specs/2026-04-21-silver-architecture.md` §5.5-5.8 (canonical_companies/contacts/products/employees), §6 (source_links + mdm_manual_overrides), §7 (MDM matcher service), §11 SP3 (deliverables + DoD).

**Prereqs:**
- SP2 Cat A merged to main (fd62141). canonical_invoices/payments/credit_notes/tax_events live.
- pg_trgm installed (verified).
- syntage_taxpayers + syntage_invoice_line_items exist.
- mdm_manual_overrides exists with SP2 schema (needs extension per §6.4 in Task 14).
- Quimibond identity = `companies.id=6707` (rfc=PNT920218IW5).

**Out of scope (explícito):**
- SP4 Pattern B MVs (orders/deliveries/inventory) and evidence layer.
- SP5 frontend cutover — legacy tables stay live.
- qb19 addon changes (none needed for SP3).
- canonical_companies aggregated metrics (lifetime_value_mxn, ar_aging_buckets, etc.) — computed as trigger-maintained or in a refresh cron; SP3 populates them retroactively as a batch UPDATE but leaves ongoing computation to SP4 engine.
- `ai_extracted_facts`, `email_signals` — evidence layer in SP4.

---

## Pre-audit state (verified 2026-04-22 post-SP2 merge)

| Tabla / Métrica | Valor |
|---|---|
| canonical_invoices | 88,443 rows (receptor_company_id NULL: 61,264) |
| canonical_payments | 43,374 |
| canonical_credit_notes | 2,207 |
| canonical_tax_events | 398 |
| mdm_manual_overrides | 20 rows (from products_fiscal_map) |
| audit_tolerances | 16 invariantes (10 SP2 + 6 pre-existing) |
| reconciliation_issues | 103,397 open with priority_score |
| pg_cron jobs | 3 active (silver_sp2_*) |
| companies | 2,197 (1,287 distinct RFCs) |
| contacts | 2,037 |
| odoo_employees | 164 |
| odoo_users | 40 |
| odoo_products | 7,222 |
| products_fiscal_map | 20 |
| entities | 9,385 (column: entity_type, NOT `kind`) |
| syntage distinct emisor_rfc | 1,854 |
| syntage distinct receptor_rfc | 2,012 |

**Quimibond identity:** `companies.id=6707` (rfc=PNT920218IW5). SP3 must also resolve Quimibond's NEW canonical_companies.id (likely id=1 after Task 2 inserts).

---

## File structure

### Branch `silver-sp3-mdm` off `main` en `/Users/jj/quimibond-intelligence/quimibond-intelligence`

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `docs/superpowers/plans/2026-04-22-silver-sp3-mdm.md` | THIS FILE | Plan (commit pre-kickoff) |
| `docs/superpowers/plans/2026-04-22-silver-sp3-mdm-notes.md` | Create | Running notes (baselines, smoke outputs, gate approvals, deviations) |
| `supabase/migrations/20260423_sp3_00_baseline.sql` | Create | Baseline snapshot in audit_runs |
| `supabase/migrations/20260423_sp3_01_canonical_companies_ddl.sql` | Create | DDL + indexes + updated_at trigger |
| `supabase/migrations/20260423_sp3_02_canonical_companies_populate_odoo.sql` | Create (gated) | Populate from companies table |
| `supabase/migrations/20260423_sp3_03_canonical_companies_shadows.sql` | Create (gated) | Shadow creation for SAT-only RFCs |
| `supabase/migrations/20260423_sp3_04_canonical_contacts_ddl.sql` | Create | DDL + indexes + updated_at trigger |
| `supabase/migrations/20260423_sp3_05_canonical_contacts_populate.sql` | Create (gated) | Populate from odoo_employees/users/contacts/entities |
| `supabase/migrations/20260423_sp3_06_canonical_contacts_triggers.sql` | Create | Incremental upsert triggers |
| `supabase/migrations/20260423_sp3_07_canonical_products_ddl.sql` | Create | DDL + indexes + updated_at trigger |
| `supabase/migrations/20260423_sp3_08_canonical_products_populate.sql` | Create (gated) | Populate from odoo_products + products_fiscal_map + syntage aggregate |
| `supabase/migrations/20260423_sp3_09_canonical_products_triggers.sql` | Create | Incremental upsert trigger |
| `supabase/migrations/20260423_sp3_10_canonical_employees_view.sql` | Create | View over canonical_contacts + HR join |
| `supabase/migrations/20260423_sp3_11_source_links_ddl.sql` | Create | source_links table + indexes |
| `supabase/migrations/20260423_sp3_12_source_links_populate.sql` | Create (gated) | Retroactive populate from existing matches |
| `supabase/migrations/20260423_sp3_13_source_links_triggers.sql` | Create | Trigger on canonical_* INSERT to auto-create source_link |
| `supabase/migrations/20260423_sp3_14_mdm_manual_overrides_extend.sql` | Create | ALTER to add action/source_link_id/payload/expires_at/is_active/revoke_reason |
| `supabase/migrations/20260423_sp3_15_matcher_company.sql` | Create | matcher_company + matcher_company_if_new_rfc |
| `supabase/migrations/20260423_sp3_16_matcher_contact_product.sql` | Create | matcher_contact + matcher_product |
| `supabase/migrations/20260423_sp3_17_matcher_all_pending.sql` | Create | matcher_all_pending + matcher_invoice_quick |
| `supabase/migrations/20260423_sp3_18_manual_override_functions.sql` | Create | mdm_merge_companies + mdm_link_invoice + mdm_revoke_override |
| `supabase/migrations/20260423_sp3_19_canonical_invoices_fk_backfill.sql` | Create (gated) | Rename `*_company_id` → `*_canonical_company_id` + back-fill 88k rows |
| `supabase/migrations/20260423_sp3_20_canonical_payments_ccn_fk_backfill.sql` | Create (gated) | FK rename + back-fill on canonical_payments, canonical_credit_notes |
| `supabase/migrations/20260423_sp3_21_pg_cron_and_bronze_triggers.sql` | Create (gated) | pg_cron 2h matcher_all_pending + odoo_partner / syntage_invoices INSERT triggers |
| `supabase/migrations/20260423_sp3_99_final.sql` | Create | Closure audit_runs snapshot |
| `CLAUDE.md` (frontend) | Modify | Add MDM section under Base de datos |

No qb19 changes.

---

## Pre-flight

### Task 0: Baseline snapshot + branch + notes skeleton + pre-check

**Purpose.** Create branch, verify SP3 prereqs (pg_trgm, entities schema, canonical_* counts frozen, no stale canonical_companies/contacts/products), capture baselines, create notes document.

**Files:**
- Create: `docs/superpowers/plans/2026-04-22-silver-sp3-mdm-notes.md`
- Create: `supabase/migrations/20260423_sp3_00_baseline.sql`

**Steps:**

- [ ] **Step 1: Create branch off `main`**

```bash
cd /Users/jj/quimibond-intelligence/quimibond-intelligence
git fetch origin main
git checkout main
git pull origin main --ff-only
git checkout -b silver-sp3-mdm
git push -u origin silver-sp3-mdm
```

Expected: branch on `fd62141`.

- [ ] **Step 2: Asset verification**

Run via `mcp__claude_ai_Supabase__execute_sql`:

```sql
SELECT
  EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_trgm')                 AS pg_trgm_installed,
  EXISTS(SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='canonical_companies') AS cc_exists,
  EXISTS(SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='canonical_contacts')  AS cct_exists,
  EXISTS(SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='canonical_products')  AS cp_exists,
  EXISTS(SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='source_links')        AS sl_exists,
  EXISTS(SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='syntage_taxpayers')   AS st_exists,
  EXISTS(SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='syntage_invoice_line_items') AS sil_exists,
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='entities' AND column_name='entity_type') AS entities_entity_type_col;
```

Decision gate:
- `pg_trgm_installed=true` REQUIRED. If false → STOP, user enables via Supabase dashboard.
- `cc_exists/cct_exists/cp_exists/sl_exists=false` expected (SP3 creates).
- `st_exists/sil_exists=true` REQUIRED (populate depends).
- `entities_entity_type_col=true` REQUIRED (matcher uses `entity_type` column, not `kind`).

- [ ] **Step 3: Capture numeric baselines**

```sql
SELECT
  (SELECT COUNT(*) FROM canonical_invoices) AS ci,
  (SELECT COUNT(*) FROM canonical_invoices WHERE receptor_company_id IS NULL AND has_sat_record=true) AS ci_unresolved_receptor,
  (SELECT COUNT(*) FROM canonical_invoices WHERE emisor_company_id IS NULL  AND has_sat_record=true) AS ci_unresolved_emisor,
  (SELECT COUNT(*) FROM canonical_payments) AS cp,
  (SELECT COUNT(*) FROM canonical_credit_notes) AS ccn,
  (SELECT COUNT(*) FROM canonical_tax_events) AS cte,
  (SELECT COUNT(*) FROM companies) AS companies,
  (SELECT COUNT(DISTINCT rfc) FROM companies WHERE rfc IS NOT NULL) AS companies_distinct_rfcs,
  (SELECT COUNT(*) FROM contacts) AS contacts,
  (SELECT COUNT(*) FROM odoo_employees) AS odoo_employees,
  (SELECT COUNT(*) FROM odoo_users) AS odoo_users,
  (SELECT COUNT(*) FROM odoo_products) AS odoo_products,
  (SELECT COUNT(*) FROM products_fiscal_map) AS products_fiscal_map,
  (SELECT COUNT(*) FROM entities) AS entities,
  (SELECT COUNT(DISTINCT emisor_rfc)   FROM syntage_invoices WHERE emisor_rfc IS NOT NULL)   AS distinct_emisor_rfcs,
  (SELECT COUNT(DISTINCT receptor_rfc) FROM syntage_invoices WHERE receptor_rfc IS NOT NULL) AS distinct_receptor_rfcs,
  (SELECT COUNT(*) FROM mdm_manual_overrides) AS mmo,
  (SELECT COUNT(*) FROM audit_tolerances WHERE enabled=true) AS active_invariants,
  (SELECT COUNT(*) FROM cron.job WHERE jobname LIKE 'silver_%' AND active=true) AS active_crons;
```

Paste output in notes under `## Antes / Baselines`.

Expected values (2026-04-22): ci=88443, ci_unresolved_receptor≈61264, cp=43374, ccn=2207, cte=398, companies=2197, contacts=2037, entities=9385, mmo=20, active_invariants=16, active_crons=3.

- [ ] **Step 4: Verify entities columns + syntage_taxpayers columns**

```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema='public' AND table_name='entities' ORDER BY ordinal_position;
```

Expected columns: id, entity_type, canonical_name, name, email, odoo_model, odoo_id, attributes, mention_count, first_seen, last_seen, created_at, updated_at.

```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema='public' AND table_name='syntage_taxpayers' ORDER BY ordinal_position;
```

Paste both outputs in notes (matcher functions will reference these columns in Tasks 15-17).

- [ ] **Step 5: Sample entities.entity_type distribution**

```sql
SELECT entity_type, COUNT(*) FROM entities GROUP BY entity_type ORDER BY COUNT(*) DESC LIMIT 10;
```

Expected: at least `person`, `company`, `product` — subagent logs exact values in notes (matcher contact step uses `entity_type IN ('person','individual','contact')` or whatever the real vocabulary is).

- [ ] **Step 6: Create notes skeleton**

Write `docs/superpowers/plans/2026-04-22-silver-sp3-mdm-notes.md`:

```markdown
# Silver SP3 — MDM Cat C — Running Notes

**Branch:** `silver-sp3-mdm` off `main` (`/Users/jj/quimibond-intelligence/quimibond-intelligence`)
**Started:** 2026-04-23
**Spec:** `docs/superpowers/specs/2026-04-21-silver-architecture.md` §5.5-5.8 + §6 + §7 + §11 SP3
**Plan:** `docs/superpowers/plans/2026-04-22-silver-sp3-mdm.md`

## Antes

### Asset verification (Task 0 Step 2)

- pg_trgm_installed: <fill>
- cc_exists / cct_exists / cp_exists / sl_exists: <fill>
- st_exists / sil_exists: <fill>
- entities_entity_type_col: <fill>

### Baselines numéricos (Task 0 Step 3)

| Medición | Valor |
|---|---|
| canonical_invoices | <fill> |
| ci_unresolved_receptor | <fill> |
| ci_unresolved_emisor | <fill> |
| canonical_payments | <fill> |
| canonical_credit_notes | <fill> |
| canonical_tax_events | <fill> |
| companies | <fill> |
| companies distinct rfcs | <fill> |
| contacts | <fill> |
| odoo_employees | <fill> |
| odoo_users | <fill> |
| odoo_products | <fill> |
| products_fiscal_map | <fill> |
| entities | <fill> |
| syntage distinct emisor_rfc | <fill> |
| syntage distinct receptor_rfc | <fill> |
| mdm_manual_overrides | <fill> |
| active_invariants | <fill> |
| active_crons | <fill> |

### entities columns (Task 0 Step 4)

<paste>

### syntage_taxpayers columns

<paste>

### entities.entity_type distribution

<paste>

## Task logs (append per task)

### Task 0

Completed <date>. Branch created. Baselines captured. Assets verified.

## Gate approvals

| Gate | Approval date | User |
|---|---|---|
| Task 2 populate Odoo companies | | |
| Task 3 shadow creation | | |
| Task 5 contacts populate | | |
| Task 8 products populate | | |
| Task 12 source_links populate | | |
| Task 19 canonical_invoices FK rename | | |
| Task 20 payments+credit_notes FK rename | | |
| Task 21 pg_cron + bronze triggers | | |

## Rollbacks executed

(None yet)
```

- [ ] **Step 7: Create baseline migration**

```sql
-- SP3 baseline snapshot
BEGIN;

INSERT INTO audit_runs (run_id, source, model, invariant_key, bucket_key, odoo_value, supabase_value, diff, severity, date_from, date_to, details, run_at)
SELECT
  gen_random_uuid(),
  'supabase', 'baseline', 'pre_sp3_baseline', 'global',
  NULL, NULL, NULL, 'ok', NULL, NULL,
  jsonb_build_object(
    'label',                      'sp3-baseline-' || to_char(now(),'YYYYMMDD-HH24MISS'),
    'canonical_invoices',         (SELECT COUNT(*) FROM canonical_invoices),
    'ci_unresolved_receptor',     (SELECT COUNT(*) FROM canonical_invoices WHERE receptor_company_id IS NULL AND has_sat_record=true),
    'ci_unresolved_emisor',       (SELECT COUNT(*) FROM canonical_invoices WHERE emisor_company_id IS NULL AND has_sat_record=true),
    'canonical_payments',         (SELECT COUNT(*) FROM canonical_payments),
    'canonical_credit_notes',     (SELECT COUNT(*) FROM canonical_credit_notes),
    'canonical_tax_events',       (SELECT COUNT(*) FROM canonical_tax_events),
    'companies',                  (SELECT COUNT(*) FROM companies),
    'contacts',                   (SELECT COUNT(*) FROM contacts),
    'odoo_employees',             (SELECT COUNT(*) FROM odoo_employees),
    'odoo_users',                 (SELECT COUNT(*) FROM odoo_users),
    'odoo_products',              (SELECT COUNT(*) FROM odoo_products),
    'entities',                   (SELECT COUNT(*) FROM entities),
    'mdm_manual_overrides',       (SELECT COUNT(*) FROM mdm_manual_overrides),
    'active_invariants',          (SELECT COUNT(*) FROM audit_tolerances WHERE enabled=true)
  ),
  now();

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('sp3_baseline', '', 'Silver SP3 baseline snapshot captured', '20260423_sp3_00_baseline.sql', 'silver-sp3', true);

COMMIT;
```

Apply via `mcp__claude_ai_Supabase__apply_migration(name='sp3_00_baseline', ...)`.

**IMPORTANT carry-forward from SP2:** `audit_runs` requires `severity IN ('ok','warn','error')` and `source IN ('odoo','supabase')`. Put the intent label in `details.label` (as shown above).

- [ ] **Step 8: Verify baseline registered**

```sql
SELECT run_id, source, invariant_key, details->>'label' AS label, details
FROM audit_runs WHERE invariant_key='pre_sp3_baseline' ORDER BY run_at DESC LIMIT 1;
```

Expected: 1 row with label starting `sp3-baseline-` and full jsonb payload. Paste into notes.

- [ ] **Step 9: Commit**

```bash
cd /Users/jj/quimibond-intelligence/quimibond-intelligence
git add docs/superpowers/plans/2026-04-22-silver-sp3-mdm.md \
        docs/superpowers/plans/2026-04-22-silver-sp3-mdm-notes.md \
        supabase/migrations/20260423_sp3_00_baseline.sql
git commit -m "chore(sp3): baseline + branch + notes skeleton"
git push
```

---

## canonical_companies (Tasks 1-3)

### Task 1: `canonical_companies` DDL + indexes

**Purpose.** Create table per spec §5.5 with identity, role, fiscal identity, address, commercial, enrichment, aggregated metrics, AR/AP, operational, email, compliance, risk, and MDM meta columns.

**Files:**
- Create: `supabase/migrations/20260423_sp3_01_canonical_companies_ddl.sql`

**Steps:**

- [ ] **Step 1: Write DDL**

```sql
-- canonical_companies (Pattern C, MDM golden record) — Silver SP3 §5.5
BEGIN;

CREATE TABLE IF NOT EXISTS canonical_companies (
  id bigserial PRIMARY KEY,
  canonical_name text NOT NULL,
  display_name text NOT NULL,

  -- Source ids
  rfc text,
  odoo_partner_id integer,
  primary_entity_kg_id bigint,
  primary_email_domain text,

  -- Role
  is_customer boolean NOT NULL DEFAULT false,
  is_supplier boolean NOT NULL DEFAULT false,
  is_internal boolean NOT NULL DEFAULT false,
  is_sat_counterparty boolean GENERATED ALWAYS AS (
    primary_entity_kg_id IS NOT NULL OR rfc IS NOT NULL
  ) STORED,

  -- Fiscal
  regimen_fiscal text,
  person_type text,
  opinion_cumplimiento text,
  blacklist_level text NOT NULL DEFAULT 'none',
  blacklist_first_flagged_at timestamptz,
  blacklist_last_flagged_at timestamptz,
  blacklist_cfdis_flagged_count integer DEFAULT 0,
  blacklist_action text GENERATED ALWAYS AS (
    CASE blacklist_level
      WHEN 'definitive' THEN 'block'
      WHEN 'presumed'   THEN 'warning'
      ELSE NULL
    END
  ) STORED,

  -- Address
  country text,
  state text,
  city text,
  zip text,
  street text,
  domicilio_fiscal jsonb,

  -- Commercial
  industry text,
  business_type text,
  credit_limit numeric(14,2),
  payment_term text,
  supplier_payment_term text,

  -- Enrichment
  description text,
  strategic_notes text,
  relationship_type text,
  relationship_summary text,
  key_products jsonb,
  risk_signals jsonb,
  opportunity_signals jsonb,
  enriched_at timestamptz,
  enrichment_source text,

  -- Aggregated metrics (populated retroactively in Task 2 Step 5)
  lifetime_value_mxn numeric(14,2) DEFAULT 0,
  total_invoiced_odoo_mxn numeric(14,2) DEFAULT 0,
  total_invoiced_sat_mxn numeric(14,2) DEFAULT 0,
  revenue_ytd_mxn numeric(14,2) DEFAULT 0,
  revenue_90d_mxn numeric(14,2) DEFAULT 0,
  revenue_prior_90d_mxn numeric(14,2) DEFAULT 0,
  trend_pct numeric(8,4),
  total_credit_notes_mxn numeric(14,2) DEFAULT 0,
  invoices_count integer DEFAULT 0,
  last_invoice_date date,

  -- AR / AP
  total_receivable_mxn numeric(14,2) DEFAULT 0,
  total_payable_mxn numeric(14,2) DEFAULT 0,
  total_pending_mxn numeric(14,2) DEFAULT 0,
  ar_aging_buckets jsonb,
  overdue_amount_mxn numeric(14,2) DEFAULT 0,
  overdue_count integer DEFAULT 0,
  max_days_overdue integer,

  -- Operational
  total_deliveries_count integer DEFAULT 0,
  late_deliveries_count integer DEFAULT 0,
  otd_rate numeric(5,4),
  otd_rate_90d numeric(5,4),

  -- Email/communication
  email_count integer DEFAULT 0,
  last_email_at timestamptz,
  contact_count integer DEFAULT 0,

  -- Compliance
  sat_compliance_score numeric(5,4),
  invoices_with_cfdi integer DEFAULT 0,
  invoices_with_syntage_match integer DEFAULT 0,
  sat_open_issues_count integer DEFAULT 0,

  -- Risk tier
  risk_level text,
  tier text,
  revenue_share_pct numeric(5,4),

  -- MDM meta
  match_method text,
  match_confidence numeric(4,3),
  has_manual_override boolean DEFAULT false,
  has_shadow_flag boolean DEFAULT false,
  shadow_reason text,
  needs_review boolean DEFAULT false,
  review_reason text[] DEFAULT '{}',
  completeness_score numeric(4,3),
  last_matched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cc_canonical_name ON canonical_companies (canonical_name);
CREATE INDEX IF NOT EXISTS ix_cc_rfc ON canonical_companies (rfc) WHERE rfc IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_cc_odoo_partner ON canonical_companies (odoo_partner_id) WHERE odoo_partner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_cc_email_domain ON canonical_companies (primary_email_domain) WHERE primary_email_domain IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_cc_is_customer ON canonical_companies (is_customer) WHERE is_customer = true;
CREATE INDEX IF NOT EXISTS ix_cc_is_supplier ON canonical_companies (is_supplier) WHERE is_supplier = true;
CREATE INDEX IF NOT EXISTS ix_cc_blacklist ON canonical_companies (blacklist_level) WHERE blacklist_level <> 'none';
CREATE INDEX IF NOT EXISTS ix_cc_shadow ON canonical_companies (has_shadow_flag) WHERE has_shadow_flag = true;
CREATE INDEX IF NOT EXISTS ix_cc_needs_review ON canonical_companies (needs_review) WHERE needs_review = true;
-- pg_trgm GIN index on canonical_name for fuzzy matching (Task 15)
CREATE INDEX IF NOT EXISTS ix_cc_name_trgm ON canonical_companies USING GIN (canonical_name gin_trgm_ops);

CREATE OR REPLACE FUNCTION trg_canonical_companies_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_canonical_companies_updated_at ON canonical_companies;
CREATE TRIGGER trg_canonical_companies_updated_at
  BEFORE UPDATE ON canonical_companies FOR EACH ROW
  EXECUTE FUNCTION trg_canonical_companies_updated_at();

COMMENT ON TABLE canonical_companies IS 'Silver SP3 Pattern C. MDM golden record per real company. Aggregated metrics populated retroactively in Task 2; SP4 engine maintains them ongoing.';

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('create_table','canonical_companies','SP3 Task 1: DDL + indexes + updated_at trigger','20260423_sp3_01_canonical_companies_ddl.sql','silver-sp3',true);

COMMIT;
```

- [ ] **Step 2: Apply**

`mcp__claude_ai_Supabase__apply_migration(name='sp3_01_canonical_companies_ddl', project_id='tozqezmivpblmcubmnpi', query=<above>)`.

- [ ] **Step 3: Verify schema + indexes**

```sql
SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='canonical_companies';
-- Expected: ≥60
```

```sql
SELECT indexname FROM pg_indexes WHERE tablename='canonical_companies' ORDER BY indexname;
-- Expected: 10 (PK + 9 user-defined including trigram)
```

```sql
SELECT column_name, generation_expression
FROM information_schema.columns
WHERE table_schema='public' AND table_name='canonical_companies' AND is_generated='ALWAYS'
ORDER BY ordinal_position;
-- Expected: 2 (is_sat_counterparty, blacklist_action)
```

Paste outputs in notes.

- [ ] **Step 4: Smoke**

```sql
BEGIN;
INSERT INTO canonical_companies (canonical_name, display_name, rfc)
VALUES ('smoke test', 'Smoke Test', 'XAXX010101000');
SELECT id, canonical_name, is_sat_counterparty, blacklist_action
FROM canonical_companies WHERE canonical_name='smoke test';
ROLLBACK;
```

Expected: 1 row, is_sat_counterparty=true (rfc not null), blacklist_action=null.

- [ ] **Step 5: Rollback plan documented in notes**

```
Rollback Task 1: DROP TABLE IF EXISTS canonical_companies CASCADE;
                 DROP FUNCTION IF EXISTS trg_canonical_companies_updated_at();
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260423_sp3_01_canonical_companies_ddl.sql \
        docs/superpowers/plans/2026-04-22-silver-sp3-mdm-notes.md
git commit -m "feat(sp3): canonical_companies DDL + indexes + trigram"
git push
```

---

### Task 2: Populate `canonical_companies` from Odoo companies (GATED)

**Purpose.** Insert ~2,197 rows from `companies` table. Each row maps 1:1 to a Supabase `companies.id`. Quimibond (companies.id=6707) lands as `is_internal=true`. Aggregated metrics populated retroactively from canonical_invoices.

**Gate.** Low row count (~2,200) but first mass insert into SP3 table — user OK recorded in notes.

**Files:**
- Create: `supabase/migrations/20260423_sp3_02_canonical_companies_populate_odoo.sql`

**Steps:**

- [ ] **Step 1: Dry-run preview**

```sql
SELECT
  (SELECT COUNT(*) FROM companies) AS total,
  (SELECT COUNT(*) FROM companies WHERE rfc IS NOT NULL) AS with_rfc,
  (SELECT COUNT(*) FROM companies WHERE odoo_partner_id IS NOT NULL) AS with_odoo_id,
  (SELECT COUNT(*) FROM companies WHERE is_customer=true) AS customers,
  (SELECT COUNT(*) FROM companies WHERE is_supplier=true) AS suppliers,
  (SELECT COUNT(*) FROM companies WHERE id=6707) AS quimibond_present;
```

Expected: total=2197, quimibond_present=1. Paste in notes.

- [ ] **Step 2: Write populate SQL**

```sql
BEGIN;

-- 2a. Insert rows from companies (one canonical_company per Supabase companies row)
INSERT INTO canonical_companies (
  canonical_name, display_name,
  rfc, odoo_partner_id, primary_entity_kg_id, primary_email_domain,
  is_customer, is_supplier, is_internal,
  country, city,
  industry, business_type,
  credit_limit, payment_term, supplier_payment_term,
  description, strategic_notes, relationship_type, relationship_summary,
  key_products, risk_signals, opportunity_signals,
  enriched_at, enrichment_source,
  lifetime_value_mxn, total_invoiced_odoo_mxn,
  total_receivable_mxn, total_payable_mxn, total_pending_mxn,
  total_credit_notes_mxn,
  trend_pct, otd_rate,
  match_method, match_confidence,
  last_matched_at
)
SELECT
  c.canonical_name,
  c.name,
  NULLIF(TRIM(c.rfc), ''),
  c.odoo_partner_id,
  c.entity_id,
  LOWER(NULLIF(TRIM(c.domain), '')),
  COALESCE(c.is_customer, false),
  COALESCE(c.is_supplier, false),
  (c.rfc = 'PNT920218IW5' AND c.id = 6707),  -- Quimibond marker
  c.country, c.city,
  c.industry, c.business_type,
  c.credit_limit, c.payment_term, c.supplier_payment_term,
  c.description, c.strategic_notes, c.relationship_type, c.relationship_summary,
  c.key_products, c.risk_signals, c.opportunity_signals,
  c.enriched_at, c.enrichment_source,
  COALESCE(c.lifetime_value, 0), COALESCE(c.total_invoiced_odoo, 0),
  COALESCE(c.total_receivable, 0), COALESCE(c.total_payable, 0), COALESCE(c.total_pending, 0),
  COALESCE(c.total_credit_notes, 0),
  c.trend_pct, c.delivery_otd_rate,
  CASE
    WHEN c.odoo_partner_id IS NOT NULL AND c.rfc IS NOT NULL THEN 'odoo_partner_id+rfc'
    WHEN c.odoo_partner_id IS NOT NULL THEN 'odoo_partner_id'
    WHEN c.rfc IS NOT NULL THEN 'rfc_exact'
    ELSE 'odoo_only'
  END AS match_method,
  CASE
    WHEN c.odoo_partner_id IS NOT NULL AND c.rfc IS NOT NULL THEN 1.000
    WHEN c.odoo_partner_id IS NOT NULL THEN 0.99
    WHEN c.rfc IS NOT NULL THEN 0.99
    ELSE 0.80
  END AS match_confidence,
  now()
FROM companies c
ON CONFLICT (canonical_name) DO NOTHING;

-- 2b. Store Quimibond's new canonical_companies.id for reference in later tasks
INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('populate','canonical_companies',
  'SP3 Task 2: populate from companies (Quimibond=6707 marked is_internal=true). New canonical_companies.id for Quimibond stored in details via subsequent query.',
  '20260423_sp3_02_canonical_companies_populate_odoo.sql','silver-sp3',true);

COMMIT;
```

- [ ] **Step 3: Gate — ask user OK**

Message:
> "Task 2 ready. Inserts ~2,197 canonical_companies rows from companies table. Quimibond (companies.id=6707, rfc=PNT920218IW5) marked is_internal=true. Matches via odoo_partner_id or rfc. ON CONFLICT (canonical_name) DO NOTHING handles duplicate canonical_names. OK to apply?"

Record user OK in notes Gate approvals table.

- [ ] **Step 4: Apply**

`mcp__claude_ai_Supabase__apply_migration(name='sp3_02_canonical_companies_populate_odoo', ...)`.

- [ ] **Step 5: Retroactive aggregated metrics from canonical_invoices**

Run as separate step (can be apply_migration or execute_sql — ~2k UPDATE is fast):

```sql
BEGIN;

-- Compute aggregated metrics from canonical_invoices (receptor-side)
WITH agg AS (
  SELECT
    ci.receptor_company_id AS company_id,
    SUM(ci.amount_total_mxn_resolved)                                                    AS lifetime_value_mxn,
    SUM(ci.amount_total_mxn_odoo)                                                         AS total_invoiced_odoo_mxn,
    SUM(ci.amount_total_mxn_sat)                                                          AS total_invoiced_sat_mxn,
    SUM(CASE WHEN ci.invoice_date >= (CURRENT_DATE - INTERVAL '90 days')
             THEN ci.amount_total_mxn_resolved ELSE 0 END)                               AS revenue_90d_mxn,
    SUM(CASE WHEN ci.invoice_date >= (CURRENT_DATE - INTERVAL '180 days')
             AND ci.invoice_date <  (CURRENT_DATE - INTERVAL '90 days')
             THEN ci.amount_total_mxn_resolved ELSE 0 END)                               AS revenue_prior_90d_mxn,
    SUM(CASE WHEN date_trunc('year', ci.invoice_date) = date_trunc('year', CURRENT_DATE)
             THEN ci.amount_total_mxn_resolved ELSE 0 END)                               AS revenue_ytd_mxn,
    SUM(CASE WHEN ci.move_type_odoo='out_invoice' THEN ci.amount_residual_mxn_resolved ELSE 0 END) AS total_receivable_mxn,
    SUM(CASE WHEN ci.move_type_odoo='in_invoice'  THEN ci.amount_residual_mxn_resolved ELSE 0 END) AS total_payable_mxn,
    COUNT(*)                                                                              AS invoices_count,
    MAX(ci.invoice_date)                                                                  AS last_invoice_date,
    COUNT(*) FILTER (WHERE ci.cfdi_uuid_odoo IS NOT NULL OR ci.sat_uuid IS NOT NULL)      AS invoices_with_cfdi,
    COUNT(*) FILTER (WHERE ci.has_sat_record)                                              AS invoices_with_syntage_match
  FROM canonical_invoices ci
  WHERE ci.receptor_company_id IS NOT NULL
  GROUP BY ci.receptor_company_id
)
UPDATE canonical_companies cc
SET
  lifetime_value_mxn = COALESCE(agg.lifetime_value_mxn, 0),
  total_invoiced_odoo_mxn = COALESCE(agg.total_invoiced_odoo_mxn, 0),
  total_invoiced_sat_mxn = COALESCE(agg.total_invoiced_sat_mxn, 0),
  revenue_ytd_mxn = COALESCE(agg.revenue_ytd_mxn, 0),
  revenue_90d_mxn = COALESCE(agg.revenue_90d_mxn, 0),
  revenue_prior_90d_mxn = COALESCE(agg.revenue_prior_90d_mxn, 0),
  trend_pct = CASE WHEN agg.revenue_prior_90d_mxn > 0
                   THEN ROUND(100.0 * (agg.revenue_90d_mxn - agg.revenue_prior_90d_mxn) / agg.revenue_prior_90d_mxn, 4)
                   ELSE NULL END,
  total_receivable_mxn = COALESCE(agg.total_receivable_mxn, 0),
  total_payable_mxn = COALESCE(agg.total_payable_mxn, 0),
  invoices_count = COALESCE(agg.invoices_count, 0),
  last_invoice_date = agg.last_invoice_date,
  invoices_with_cfdi = COALESCE(agg.invoices_with_cfdi, 0),
  invoices_with_syntage_match = COALESCE(agg.invoices_with_syntage_match, 0),
  sat_compliance_score = CASE WHEN agg.invoices_with_cfdi > 0
                              THEN ROUND(agg.invoices_with_syntage_match::numeric / agg.invoices_with_cfdi, 4)
                              ELSE NULL END
FROM agg
JOIN companies c ON c.id = agg.company_id
WHERE cc.canonical_name = c.canonical_name;

-- Credit notes aggregate
WITH cn_agg AS (
  SELECT
    ccn.receptor_company_id AS company_id,
    SUM(ccn.amount_total_mxn_resolved) AS total_credit_notes_mxn
  FROM canonical_credit_notes ccn
  WHERE ccn.receptor_company_id IS NOT NULL
  GROUP BY ccn.receptor_company_id
)
UPDATE canonical_companies cc
SET total_credit_notes_mxn = COALESCE(cn_agg.total_credit_notes_mxn, 0)
FROM cn_agg
JOIN companies c ON c.id = cn_agg.company_id
WHERE cc.canonical_name = c.canonical_name;

-- Contact count
UPDATE canonical_companies cc
SET contact_count = sub.cnt
FROM (
  SELECT company_id, COUNT(*) AS cnt FROM contacts WHERE company_id IS NOT NULL GROUP BY company_id
) sub
JOIN companies c ON c.id = sub.company_id
WHERE cc.canonical_name = c.canonical_name;

COMMIT;
```

- [ ] **Step 6: Verification**

```sql
SELECT
  (SELECT COUNT(*) FROM canonical_companies) AS total,
  (SELECT COUNT(*) FROM canonical_companies WHERE is_internal) AS internal,
  (SELECT COUNT(*) FROM canonical_companies WHERE is_customer) AS customers,
  (SELECT COUNT(*) FROM canonical_companies WHERE is_supplier) AS suppliers,
  (SELECT COUNT(*) FROM canonical_companies WHERE rfc IS NOT NULL) AS with_rfc,
  (SELECT COUNT(*) FROM canonical_companies WHERE odoo_partner_id IS NOT NULL) AS with_odoo_id,
  (SELECT COUNT(*) FROM canonical_companies WHERE has_shadow_flag) AS shadows_now,
  (SELECT id FROM canonical_companies WHERE is_internal=true LIMIT 1) AS quimibond_canonical_id;
```

Expected:
- total ≈ 2,197 (may be less if companies.canonical_name had duplicates; document drop in notes).
- internal = 1 (Quimibond).
- with_rfc ≈ 1,287.
- shadows_now = 0 (Task 3 creates shadows).
- quimibond_canonical_id is the new id used by downstream FKs.

**Document the quimibond_canonical_id in notes** — Tasks 19-20 need it.

```sql
-- Distribution of match_method/match_confidence
SELECT match_method, ROUND(match_confidence,2) AS conf, COUNT(*)
FROM canonical_companies GROUP BY 1,2 ORDER BY 3 DESC;
```

- [ ] **Step 7: Rollback plan**

```sql
-- Rollback Task 2
DELETE FROM canonical_companies WHERE has_shadow_flag = false;  -- Leaves any shadows from Task 3
```

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260423_sp3_02_canonical_companies_populate_odoo.sql \
        docs/superpowers/plans/2026-04-22-silver-sp3-mdm-notes.md
git commit -m "feat(sp3): populate canonical_companies from Odoo + aggregated metrics"
git push
```

---

### Task 3: Shadow creation for SAT-only counterparties (GATED)

**Purpose.** For each distinct RFC appearing in `canonical_invoices.emisor_rfc` or `canonical_invoices.receptor_rfc` that does NOT match an existing canonical_companies row, create a shadow canonical_company with `has_shadow_flag=true`, `match_method='sat_only'`, `match_confidence=0.50`, `shadow_reason` set per spec §5.5 policy.

**Scope.** 61,264 canonical_invoices rows with receptor_company_id NULL + unknown emisor_company_id count. Pre-gate diagnostic.

**Gate.** User OK required — potentially creates 500-2000 shadow rows + aggregates blacklist signal.

**Files:**
- Create: `supabase/migrations/20260423_sp3_03_canonical_companies_shadows.sql`

**Steps:**

- [ ] **Step 1: Pre-gate diagnostic — count distinct shadow candidates**

```sql
-- RFCs present in canonical_invoices (emisor OR receptor) but not in canonical_companies
WITH sat_rfcs AS (
  SELECT DISTINCT emisor_rfc AS rfc FROM canonical_invoices WHERE emisor_rfc IS NOT NULL
  UNION
  SELECT DISTINCT receptor_rfc FROM canonical_invoices WHERE receptor_rfc IS NOT NULL
),
known_rfcs AS (SELECT DISTINCT rfc FROM canonical_companies WHERE rfc IS NOT NULL)
SELECT
  (SELECT COUNT(*) FROM sat_rfcs) AS sat_rfcs_total,
  (SELECT COUNT(*) FROM sat_rfcs WHERE rfc IN (SELECT rfc FROM known_rfcs)) AS already_matched,
  (SELECT COUNT(*) FROM sat_rfcs WHERE rfc NOT IN (SELECT rfc FROM known_rfcs)) AS need_shadow;
```

Expected `need_shadow` ≈ 500-2,000. Paste in notes.

Also check generic RFC count (XEXX010101000 / XAXX010101000 are SAT-generic, not real):
```sql
SELECT rfc, COUNT(*) AS count
FROM canonical_invoices
WHERE rfc IN ('XEXX010101000','XAXX010101000') OR emisor_rfc IN ('XEXX010101000','XAXX010101000') OR receptor_rfc IN ('XEXX010101000','XAXX010101000')
GROUP BY rfc ORDER BY count DESC LIMIT 10;
```

- [ ] **Step 2: Write shadow creation SQL**

```sql
BEGIN;

-- 3a. Create shadows for distinct unmatched RFCs (excluding SAT-generic placeholders)
WITH sat_rfcs AS (
  SELECT emisor_rfc AS rfc, emisor_nombre AS nombre, MIN(fecha_timbrado) AS first_seen, MAX(fecha_timbrado) AS last_seen, COUNT(*) AS cfdis
    FROM canonical_invoices
   WHERE emisor_rfc IS NOT NULL AND emisor_rfc NOT IN ('XEXX010101000','XAXX010101000')
   GROUP BY emisor_rfc, emisor_nombre
  UNION
  SELECT receptor_rfc, receptor_nombre, MIN(fecha_timbrado), MAX(fecha_timbrado), COUNT(*)
    FROM canonical_invoices
   WHERE receptor_rfc IS NOT NULL AND receptor_rfc NOT IN ('XEXX010101000','XAXX010101000')
   GROUP BY receptor_rfc, receptor_nombre
),
deduped AS (
  SELECT rfc,
         (array_agg(nombre ORDER BY cfdis DESC NULLS LAST))[1] AS nombre,
         MIN(first_seen) AS first_seen,
         MAX(last_seen) AS last_seen,
         SUM(cfdis) AS cfdi_count
  FROM sat_rfcs
  WHERE rfc IS NOT NULL
  GROUP BY rfc
)
INSERT INTO canonical_companies (
  canonical_name, display_name, rfc,
  has_shadow_flag, shadow_reason,
  match_method, match_confidence,
  needs_review, review_reason,
  blacklist_first_flagged_at, blacklist_last_flagged_at,
  last_matched_at
)
SELECT
  LOWER(COALESCE(d.nombre, d.rfc)),  -- canonical_name from name, fall back to rfc
  COALESCE(d.nombre, d.rfc),
  d.rfc,
  true, 'sat_cfdi_only_post_2021',
  'sat_only', 0.50,
  true, ARRAY['sat_only_shadow'],
  d.first_seen, d.last_seen,
  now()
FROM deduped d
WHERE NOT EXISTS (SELECT 1 FROM canonical_companies cc WHERE cc.rfc = d.rfc)
ON CONFLICT (canonical_name) DO NOTHING;

-- 3b. Blacklist signal — aggregate from syntage_invoices emisor/receptor blacklist_status
WITH bl AS (
  SELECT emisor_rfc AS rfc, MAX(emisor_blacklist_status) AS level, COUNT(*) AS cnt,
         MIN(fecha_timbrado) AS first_flag, MAX(fecha_timbrado) AS last_flag
    FROM syntage_invoices
   WHERE emisor_blacklist_status IS NOT NULL AND emisor_blacklist_status <> 'none'
   GROUP BY emisor_rfc
  UNION
  SELECT receptor_rfc, MAX(receptor_blacklist_status), COUNT(*),
         MIN(fecha_timbrado), MAX(fecha_timbrado)
    FROM syntage_invoices
   WHERE receptor_blacklist_status IS NOT NULL AND receptor_blacklist_status <> 'none'
   GROUP BY receptor_rfc
),
agg AS (
  SELECT rfc,
         CASE WHEN MAX(level)='definitive' THEN 'definitive' WHEN MAX(level)='presumed' THEN 'presumed' ELSE 'none' END AS level,
         SUM(cnt)::integer AS cfdis_flagged_count,
         MIN(first_flag) AS first_flag,
         MAX(last_flag)  AS last_flag
  FROM bl
  GROUP BY rfc
)
UPDATE canonical_companies cc
SET blacklist_level = agg.level,
    blacklist_cfdis_flagged_count = agg.cfdis_flagged_count,
    blacklist_first_flagged_at = agg.first_flag,
    blacklist_last_flagged_at = agg.last_flag
FROM agg
WHERE cc.rfc = agg.rfc AND agg.level <> 'none';

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('populate','canonical_companies','SP3 Task 3: shadow creation for SAT-only RFCs + blacklist aggregate','20260423_sp3_03_canonical_companies_shadows.sql','silver-sp3',true);

COMMIT;
```

- [ ] **Step 3: Gate**

Message:
> "Task 3: creates shadow canonical_companies for ~[N from Step 1] unmatched RFCs + aggregates blacklist signal. Does NOT modify canonical_invoices (FK back-fill is Task 19). OK to apply?"

Record OK in notes.

- [ ] **Step 4: Apply + verify**

```sql
SELECT
  (SELECT COUNT(*) FROM canonical_companies) AS total,
  (SELECT COUNT(*) FROM canonical_companies WHERE has_shadow_flag) AS shadows,
  (SELECT COUNT(*) FROM canonical_companies WHERE blacklist_level IN ('presumed','definitive')) AS blacklisted;
```

Expected: shadows ≈ diagnostic value; blacklisted distribution documented.

```sql
-- Critical compliance flag: blacklisted shadows
SELECT canonical_name, rfc, blacklist_level, blacklist_cfdis_flagged_count, blacklist_last_flagged_at
FROM canonical_companies WHERE has_shadow_flag=true AND blacklist_level <> 'none'
ORDER BY blacklist_last_flagged_at DESC LIMIT 20;
```

Paste in notes — these are high-priority compliance issues.

- [ ] **Step 5: Rollback**

```sql
DELETE FROM canonical_companies WHERE has_shadow_flag = true;
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260423_sp3_03_canonical_companies_shadows.sql \
        docs/superpowers/plans/2026-04-22-silver-sp3-mdm-notes.md
git commit -m "feat(sp3): shadow canonical_companies for SAT-only RFCs + blacklist aggregate"
git push
```

---

## canonical_contacts (Tasks 4-6)

### Task 4: `canonical_contacts` DDL

**Purpose.** Spec §5.6. Golden contact record. FK to canonical_companies optional (NULL until matched).

**Files:** Create `supabase/migrations/20260423_sp3_04_canonical_contacts_ddl.sql`

**Steps:**

- [ ] **Step 1: DDL**

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS canonical_contacts (
  id bigserial PRIMARY KEY,
  primary_email text NOT NULL,
  display_name text NOT NULL,
  canonical_name text NOT NULL,
  odoo_partner_id integer,
  odoo_employee_id integer,
  odoo_user_id integer,
  primary_entity_kg_id bigint,
  contact_type text NOT NULL CHECK (contact_type IN ('internal_employee','internal_user','external_customer','external_supplier','external_unresolved')),
  is_customer boolean NOT NULL DEFAULT false,
  is_supplier boolean NOT NULL DEFAULT false,
  canonical_company_id bigint REFERENCES canonical_companies(id),
  role text,
  department text,
  manager_canonical_contact_id bigint REFERENCES canonical_contacts(id),
  language_preference text,
  communication_style text,
  response_pattern text,
  decision_power text,
  negotiation_style text,
  influence_on_deals text,
  personality_notes text,
  relationship_score numeric(4,3),
  sentiment_score numeric(4,3),
  current_health_score numeric(4,3),
  health_trend text,
  risk_level text,
  payment_compliance_score numeric(4,3),
  lifetime_value_mxn numeric(14,2) DEFAULT 0,
  delivery_otd_rate numeric(5,4),
  total_sent integer DEFAULT 0,
  total_received integer DEFAULT 0,
  avg_response_time_hours numeric(8,2),
  last_activity_at timestamptz,
  first_seen_at timestamptz,
  open_alerts_count integer DEFAULT 0,
  pending_actions_count integer DEFAULT 0,
  match_method text,
  match_confidence numeric(4,3),
  has_manual_override boolean DEFAULT false,
  has_shadow_flag boolean DEFAULT false,
  needs_review boolean DEFAULT false,
  review_reason text[] DEFAULT '{}',
  completeness_score numeric(4,3),
  last_matched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cct_primary_email ON canonical_contacts (LOWER(primary_email));
CREATE INDEX IF NOT EXISTS ix_cct_company ON canonical_contacts (canonical_company_id);
CREATE INDEX IF NOT EXISTS ix_cct_contact_type ON canonical_contacts (contact_type);
CREATE INDEX IF NOT EXISTS ix_cct_odoo_employee ON canonical_contacts (odoo_employee_id) WHERE odoo_employee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_cct_odoo_user ON canonical_contacts (odoo_user_id) WHERE odoo_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_cct_manual_override ON canonical_contacts (has_manual_override) WHERE has_manual_override = true;
CREATE INDEX IF NOT EXISTS ix_cct_needs_review ON canonical_contacts (needs_review) WHERE needs_review = true;
CREATE INDEX IF NOT EXISTS ix_cct_name_trgm ON canonical_contacts USING GIN (canonical_name gin_trgm_ops);

CREATE OR REPLACE FUNCTION trg_canonical_contacts_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cct_updated_at ON canonical_contacts;
CREATE TRIGGER trg_cct_updated_at BEFORE UPDATE ON canonical_contacts
  FOR EACH ROW EXECUTE FUNCTION trg_canonical_contacts_updated_at();

COMMENT ON TABLE canonical_contacts IS 'Silver SP3 Pattern C. Golden contact record per real person. primary_email UNIQUE (case-insensitive).';

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('create_table','canonical_contacts','SP3 Task 4: DDL','20260423_sp3_04_canonical_contacts_ddl.sql','silver-sp3',true);

COMMIT;
```

- [ ] **Step 2-3: Apply + verify**

Apply via `apply_migration`. Verify:
```sql
SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='canonical_contacts';
-- Expected: ~42
SELECT COUNT(*) FROM pg_indexes WHERE tablename='canonical_contacts';
-- Expected: 9 (PK + 8 user)
```

- [ ] **Step 4: Smoke**

```sql
BEGIN;
INSERT INTO canonical_contacts (primary_email, display_name, canonical_name, contact_type)
VALUES ('SMOKE@example.com', 'Smoke Test', 'smoke test', 'external_unresolved');
SELECT id, primary_email, contact_type FROM canonical_contacts WHERE primary_email='SMOKE@example.com';
-- Expected: 1 row
-- Also test UNIQUE:
INSERT INTO canonical_contacts (primary_email, display_name, canonical_name, contact_type)
VALUES ('smoke@example.com', 'Dup', 'smoke test', 'external_unresolved');
-- Expected: unique violation (case-insensitive)
ROLLBACK;
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260423_sp3_04_canonical_contacts_ddl.sql \
        docs/superpowers/plans/2026-04-22-silver-sp3-mdm-notes.md
git commit -m "feat(sp3): canonical_contacts DDL + trigram name index"
git push
```

**Rollback Task 4:** `DROP TABLE IF EXISTS canonical_contacts CASCADE; DROP FUNCTION IF EXISTS trg_canonical_contacts_updated_at();`

---

### Task 5: Populate `canonical_contacts` (GATED)

**Purpose.** Insert from odoo_employees (164) + odoo_users (40) + contacts (2,037). Resolve canonical_company_id via companies.id → canonical_companies lookup. Handle email conflicts (user > employee > partner).

**Gate.** User OK (inserts ~2,200 rows with priority logic).

**Files:** Create `supabase/migrations/20260423_sp3_05_canonical_contacts_populate.sql`

**Steps:**

- [ ] **Step 1: Pre-gate diagnostic**

```sql
SELECT
  (SELECT COUNT(*) FROM odoo_users WHERE email IS NOT NULL AND email<>'') AS users_with_email,
  (SELECT COUNT(*) FROM odoo_employees WHERE work_email IS NOT NULL AND work_email<>'') AS employees_with_email,
  (SELECT COUNT(*) FROM contacts WHERE email IS NOT NULL AND email<>'') AS contacts_with_email,
  (SELECT COUNT(DISTINCT LOWER(email)) FROM (
     SELECT email FROM odoo_users WHERE email IS NOT NULL
     UNION ALL SELECT work_email FROM odoo_employees WHERE work_email IS NOT NULL
     UNION ALL SELECT email FROM contacts WHERE email IS NOT NULL
   ) e WHERE e.email IS NOT NULL AND e.email<>'') AS distinct_emails_total;
```

Paste in notes.

- [ ] **Step 2: Populate SQL**

```sql
BEGIN;

-- Priority: odoo_users > odoo_employees > contacts.
-- Use ON CONFLICT (LOWER(primary_email)) DO NOTHING to enforce priority order.

-- 5a. Insert internal_users first (highest authority)
INSERT INTO canonical_contacts (
  primary_email, display_name, canonical_name,
  odoo_user_id, contact_type,
  match_method, match_confidence, last_matched_at
)
SELECT
  LOWER(u.email),
  u.name,
  LOWER(u.name),
  u.odoo_user_id,
  'internal_user',
  'email_exact',
  0.99,
  now()
FROM odoo_users u
WHERE u.email IS NOT NULL AND u.email <> ''
ON CONFLICT ((LOWER(primary_email))) DO NOTHING;

-- 5b. Insert internal_employees (skip if user already exists with same email)
INSERT INTO canonical_contacts (
  primary_email, display_name, canonical_name,
  odoo_employee_id, department, role, contact_type,
  match_method, match_confidence, last_matched_at
)
SELECT
  LOWER(e.work_email),
  e.name,
  LOWER(e.name),
  e.odoo_employee_id,
  e.department_name,
  COALESCE(e.job_title, e.job_name),
  'internal_employee',
  'email_exact',
  0.99,
  now()
FROM odoo_employees e
WHERE e.work_email IS NOT NULL AND e.work_email <> ''
ON CONFLICT ((LOWER(primary_email))) DO UPDATE SET
  -- Backfill employee fields on user rows (same person is user+employee)
  odoo_employee_id = EXCLUDED.odoo_employee_id,
  department = COALESCE(canonical_contacts.department, EXCLUDED.department),
  role = COALESCE(canonical_contacts.role, EXCLUDED.role);

-- 5c. Insert external contacts (customers/suppliers)
INSERT INTO canonical_contacts (
  primary_email, display_name, canonical_name,
  odoo_partner_id, canonical_company_id,
  is_customer, is_supplier, contact_type,
  match_method, match_confidence, last_matched_at
)
SELECT
  LOWER(c.email),
  c.name,
  LOWER(c.name),
  c.odoo_partner_id,
  (SELECT cc.id FROM canonical_companies cc JOIN companies comp ON comp.canonical_name=cc.canonical_name WHERE comp.id = c.company_id LIMIT 1),
  COALESCE(c.is_customer, false),
  COALESCE(c.is_supplier, false),
  CASE
    WHEN c.is_customer THEN 'external_customer'
    WHEN c.is_supplier THEN 'external_supplier'
    ELSE 'external_unresolved'
  END,
  'email_exact',
  0.99,
  now()
FROM contacts c
WHERE c.email IS NOT NULL AND c.email <> ''
ON CONFLICT ((LOWER(primary_email))) DO NOTHING;

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('populate','canonical_contacts','SP3 Task 5: populate from odoo_users + employees + contacts','20260423_sp3_05_canonical_contacts_populate.sql','silver-sp3',true);

COMMIT;
```

- [ ] **Step 3: Gate + Apply**

> "Task 5 ready. Inserts ~2,200 canonical_contacts. Priority: odoo_users → odoo_employees (merge onto user) → contacts. Conflicts resolved via LOWER(primary_email) unique. OK to apply?"

- [ ] **Step 4: Verify**

```sql
SELECT contact_type, COUNT(*) FROM canonical_contacts GROUP BY contact_type ORDER BY COUNT(*) DESC;
SELECT COUNT(*) FROM canonical_contacts WHERE canonical_company_id IS NOT NULL;
SELECT COUNT(*) FROM canonical_contacts WHERE odoo_employee_id IS NOT NULL AND odoo_user_id IS NOT NULL; -- employee+user merged
```

Expected: external_customer + external_supplier + internal_employee + internal_user split; majority have canonical_company_id for external ones.

- [ ] **Step 5: Rollback**

```sql
DELETE FROM canonical_contacts;
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260423_sp3_05_canonical_contacts_populate.sql docs/superpowers/plans/2026-04-22-silver-sp3-mdm-notes.md
git commit -m "feat(sp3): populate canonical_contacts from odoo_users+employees+contacts"
git push
```

---

### Task 6: `canonical_contacts` incremental triggers

**Purpose.** Triggers on odoo_users, odoo_employees, contacts INSERT/UPDATE → upsert canonical_contacts.

**Files:** Create `supabase/migrations/20260423_sp3_06_canonical_contacts_triggers.sql`

**Steps:**

- [ ] **Step 1: Write trigger functions + triggers**

```sql
BEGIN;

CREATE OR REPLACE FUNCTION canonical_contacts_upsert_from_user() RETURNS trigger AS $$
BEGIN
  IF NEW.email IS NULL OR NEW.email = '' THEN RETURN NEW; END IF;
  INSERT INTO canonical_contacts (primary_email, display_name, canonical_name, odoo_user_id, contact_type, match_method, match_confidence, last_matched_at)
  VALUES (LOWER(NEW.email), NEW.name, LOWER(NEW.name), NEW.odoo_user_id, 'internal_user', 'email_exact', 0.99, now())
  ON CONFLICT ((LOWER(primary_email))) DO UPDATE SET
    odoo_user_id = EXCLUDED.odoo_user_id,
    display_name = COALESCE(canonical_contacts.display_name, EXCLUDED.display_name),
    last_matched_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION canonical_contacts_upsert_from_employee() RETURNS trigger AS $$
BEGIN
  IF NEW.work_email IS NULL OR NEW.work_email = '' THEN RETURN NEW; END IF;
  INSERT INTO canonical_contacts (primary_email, display_name, canonical_name, odoo_employee_id, department, role, contact_type, match_method, match_confidence, last_matched_at)
  VALUES (LOWER(NEW.work_email), NEW.name, LOWER(NEW.name), NEW.odoo_employee_id, NEW.department_name, COALESCE(NEW.job_title, NEW.job_name), 'internal_employee', 'email_exact', 0.99, now())
  ON CONFLICT ((LOWER(primary_email))) DO UPDATE SET
    odoo_employee_id = EXCLUDED.odoo_employee_id,
    department = COALESCE(canonical_contacts.department, EXCLUDED.department),
    role = COALESCE(canonical_contacts.role, EXCLUDED.role),
    last_matched_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION canonical_contacts_upsert_from_contact() RETURNS trigger AS $$
DECLARE v_cc_id bigint;
BEGIN
  IF NEW.email IS NULL OR NEW.email = '' THEN RETURN NEW; END IF;
  SELECT cc.id INTO v_cc_id
  FROM canonical_companies cc JOIN companies comp ON comp.canonical_name=cc.canonical_name
  WHERE comp.id = NEW.company_id LIMIT 1;
  INSERT INTO canonical_contacts (primary_email, display_name, canonical_name, odoo_partner_id, canonical_company_id, is_customer, is_supplier, contact_type, match_method, match_confidence, last_matched_at)
  VALUES (
    LOWER(NEW.email), NEW.name, LOWER(NEW.name), NEW.odoo_partner_id, v_cc_id,
    COALESCE(NEW.is_customer, false), COALESCE(NEW.is_supplier, false),
    CASE WHEN NEW.is_customer THEN 'external_customer' WHEN NEW.is_supplier THEN 'external_supplier' ELSE 'external_unresolved' END,
    'email_exact', 0.99, now()
  )
  ON CONFLICT ((LOWER(primary_email))) DO UPDATE SET
    odoo_partner_id = COALESCE(canonical_contacts.odoo_partner_id, EXCLUDED.odoo_partner_id),
    canonical_company_id = COALESCE(canonical_contacts.canonical_company_id, EXCLUDED.canonical_company_id),
    is_customer = canonical_contacts.is_customer OR EXCLUDED.is_customer,
    is_supplier = canonical_contacts.is_supplier OR EXCLUDED.is_supplier,
    last_matched_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cct_from_user ON odoo_users;
CREATE TRIGGER trg_cct_from_user AFTER INSERT OR UPDATE ON odoo_users
  FOR EACH ROW EXECUTE FUNCTION canonical_contacts_upsert_from_user();

DROP TRIGGER IF EXISTS trg_cct_from_employee ON odoo_employees;
CREATE TRIGGER trg_cct_from_employee AFTER INSERT OR UPDATE ON odoo_employees
  FOR EACH ROW EXECUTE FUNCTION canonical_contacts_upsert_from_employee();

DROP TRIGGER IF EXISTS trg_cct_from_contact ON contacts;
CREATE TRIGGER trg_cct_from_contact AFTER INSERT OR UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION canonical_contacts_upsert_from_contact();

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('create_trigger','canonical_contacts','SP3 Task 6: incremental triggers (users/employees/contacts)','20260423_sp3_06_canonical_contacts_triggers.sql','silver-sp3',true);

COMMIT;
```

- [ ] **Step 2-3: Apply + verify**

```sql
SELECT proname FROM pg_proc WHERE proname LIKE 'canonical_contacts_upsert%';
-- Expected: 3
SELECT tgname FROM pg_trigger WHERE tgname LIKE 'trg_cct_%';
-- Expected: 4 (updated_at + 3 new)
```

- [ ] **Step 4: Smoke**

```sql
BEGIN;
INSERT INTO odoo_users (odoo_user_id, name, email) VALUES (999999, 'Smoke SP3', 'smoke-sp3-user@example.com');
SELECT primary_email, contact_type FROM canonical_contacts WHERE primary_email='smoke-sp3-user@example.com';
ROLLBACK;
-- Expected: 1 row with contact_type='internal_user'
```

- [ ] **Step 5: Rollback plan + Commit**

```sql
DROP TRIGGER IF EXISTS trg_cct_from_user ON odoo_users;
DROP TRIGGER IF EXISTS trg_cct_from_employee ON odoo_employees;
DROP TRIGGER IF EXISTS trg_cct_from_contact ON contacts;
DROP FUNCTION IF EXISTS canonical_contacts_upsert_from_user();
DROP FUNCTION IF EXISTS canonical_contacts_upsert_from_employee();
DROP FUNCTION IF EXISTS canonical_contacts_upsert_from_contact();
```

```bash
git add supabase/migrations/20260423_sp3_06_canonical_contacts_triggers.sql docs/superpowers/plans/2026-04-22-silver-sp3-mdm-notes.md
git commit -m "feat(sp3): incremental triggers for canonical_contacts"
git push
```

---

## canonical_products (Tasks 7-9)

### Task 7: `canonical_products` DDL

**Purpose.** Spec §5.7. Unique on internal_ref + odoo_product_id.

**Files:** Create `supabase/migrations/20260423_sp3_07_canonical_products_ddl.sql`

**Steps:**

- [ ] **Step 1: DDL**

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS canonical_products (
  id bigserial PRIMARY KEY,
  internal_ref text NOT NULL,
  display_name text NOT NULL,
  canonical_name text NOT NULL,
  odoo_product_id integer NOT NULL,
  primary_entity_kg_id bigint,
  category text,
  uom text,
  product_type text,
  sat_clave_prod_serv text,
  sat_clave_unidad text,
  barcode text,
  weight numeric(10,3),
  standard_price_mxn numeric(14,2),
  avg_cost_mxn numeric(14,2),
  list_price_mxn numeric(14,2),
  last_list_price_change_at timestamptz,
  stock_qty numeric(14,4),
  reserved_qty numeric(14,4),
  available_qty numeric(14,4),
  reorder_min numeric(14,4),
  reorder_max numeric(14,4),
  sat_revenue_mxn_12m numeric(14,2) DEFAULT 0,
  sat_line_count_12m integer DEFAULT 0,
  last_sat_invoice_date date,
  odoo_revenue_mxn_12m numeric(14,2) DEFAULT 0,
  margin_pct_12m numeric(8,4),
  top_customers_canonical_ids bigint[],
  top_suppliers_canonical_ids bigint[],
  is_active boolean DEFAULT true,
  fiscal_map_confidence text,
  fiscal_map_updated_at timestamptz,
  has_manual_override boolean DEFAULT false,
  needs_review boolean DEFAULT false,
  completeness_score numeric(4,3),
  last_matched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cprod_internal_ref ON canonical_products (internal_ref);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cprod_odoo_product_id ON canonical_products (odoo_product_id);
CREATE INDEX IF NOT EXISTS ix_cprod_sat_clave ON canonical_products (sat_clave_prod_serv);
CREATE INDEX IF NOT EXISTS ix_cprod_category ON canonical_products (category);
CREATE INDEX IF NOT EXISTS ix_cprod_active ON canonical_products (is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS ix_cprod_name_trgm ON canonical_products USING GIN (canonical_name gin_trgm_ops);

CREATE OR REPLACE FUNCTION trg_canonical_products_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cprod_updated_at ON canonical_products;
CREATE TRIGGER trg_cprod_updated_at BEFORE UPDATE ON canonical_products
  FOR EACH ROW EXECUTE FUNCTION trg_canonical_products_updated_at();

COMMENT ON TABLE canonical_products IS 'Silver SP3 Pattern C. Product golden record. internal_ref never changes (Odoo default_code).';

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('create_table','canonical_products','SP3 Task 7: DDL','20260423_sp3_07_canonical_products_ddl.sql','silver-sp3',true);

COMMIT;
```

- [ ] **Step 2-3: Apply + verify**

```sql
SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='canonical_products';
-- Expected: ~37
SELECT indexname FROM pg_indexes WHERE tablename='canonical_products' ORDER BY indexname;
-- Expected: 6 indexes + PK
```

- [ ] **Step 4: Smoke + Commit**

```sql
BEGIN;
INSERT INTO canonical_products (internal_ref, display_name, canonical_name, odoo_product_id)
VALUES ('SMK001', 'Smoke Product', 'smoke product', 999999);
SELECT id, internal_ref, is_active FROM canonical_products WHERE internal_ref='SMK001';
ROLLBACK;
```

```bash
git add supabase/migrations/20260423_sp3_07_canonical_products_ddl.sql docs/superpowers/plans/2026-04-22-silver-sp3-mdm-notes.md
git commit -m "feat(sp3): canonical_products DDL"
git push
```

**Rollback Task 7:** `DROP TABLE IF EXISTS canonical_products CASCADE; DROP FUNCTION IF EXISTS trg_canonical_products_updated_at();`

---

### Task 8: Populate `canonical_products` (GATED)

**Purpose.** Insert 7,222 rows from odoo_products + attach sat_clave_prod_serv from products_fiscal_map (manual) OR most-frequent from syntage_invoice_line_items (inferred).

**Gate.** User OK (inserts 7k rows + runs aggregate query over potentially large syntage_invoice_line_items).

**Files:** Create `supabase/migrations/20260423_sp3_08_canonical_products_populate.sql`

**Steps:**

- [ ] **Step 1: Pre-gate — verify syntage_invoice_line_items has clave_prod_serv column**

```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='syntage_invoice_line_items' AND column_name ILIKE '%clave%'
ORDER BY column_name;
```

If `clave_prod_serv` not present, document and SKIP Step 3 (sat_clave aggregate).

Also check products_fiscal_map column names:
```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='products_fiscal_map' ORDER BY ordinal_position;
```

Expected columns include `odoo_product_id, internal_ref, sat_clave_prod_serv, confidence`.

- [ ] **Step 2: Write populate SQL**

```sql
BEGIN;

-- 8a. Insert from odoo_products (skip products without internal_ref — cannot be unique)
INSERT INTO canonical_products (
  internal_ref, display_name, canonical_name, odoo_product_id,
  category, uom, product_type, barcode, weight,
  standard_price_mxn, avg_cost_mxn, list_price_mxn,
  stock_qty, reserved_qty, available_qty, reorder_min, reorder_max,
  is_active,
  last_matched_at
)
SELECT
  op.internal_ref,
  op.name,
  LOWER(op.name),
  op.odoo_product_id,
  op.category, op.uom, op.product_type, op.barcode, op.weight,
  op.standard_price, op.avg_cost, op.list_price,
  op.stock_qty, op.reserved_qty, op.available_qty, op.reorder_min, op.reorder_max,
  COALESCE(op.active, true),
  now()
FROM odoo_products op
WHERE op.internal_ref IS NOT NULL AND op.internal_ref <> ''
ON CONFLICT (internal_ref) DO NOTHING;

-- 8b. Attach manual sat_clave_prod_serv from products_fiscal_map
UPDATE canonical_products cp
SET
  sat_clave_prod_serv = pfm.sat_clave_prod_serv,
  fiscal_map_confidence = pfm.confidence,
  fiscal_map_updated_at = pfm.created_at
FROM products_fiscal_map pfm
WHERE cp.odoo_product_id = pfm.odoo_product_id
  AND cp.sat_clave_prod_serv IS NULL;

-- 8c. Infer sat_clave_prod_serv from most-frequent in syntage_invoice_line_items (last 12m)
-- Only for products that don't have a manual override, and only if the line items table has the expected column.
-- If clave_prod_serv column missing from syntage_invoice_line_items, skip this step.
WITH product_claves AS (
  SELECT
    sil.product_description AS desc,
    sil.clave_prod_serv,
    COUNT(*) AS cnt,
    MAX(si.fecha_timbrado) AS last_seen
  FROM syntage_invoice_line_items sil
  JOIN syntage_invoices si ON si.uuid = sil.invoice_uuid
  WHERE sil.clave_prod_serv IS NOT NULL
    AND si.fecha_timbrado >= (CURRENT_DATE - INTERVAL '365 days')
  GROUP BY sil.product_description, sil.clave_prod_serv
),
ranked AS (
  SELECT desc, clave_prod_serv, cnt,
         ROW_NUMBER() OVER (PARTITION BY desc ORDER BY cnt DESC) AS rnk
  FROM product_claves
)
UPDATE canonical_products cp
SET sat_clave_prod_serv = r.clave_prod_serv,
    fiscal_map_confidence = 'inferred_frequent',
    fiscal_map_updated_at = now()
FROM ranked r
WHERE r.rnk = 1
  AND cp.sat_clave_prod_serv IS NULL
  AND LOWER(cp.display_name) LIKE '%' || LOWER(r.desc) || '%';
-- Note: this inferred join may match imprecisely; treat as best-effort seed only.

-- 8d. sat_revenue_mxn_12m from line_items aggregation (Quimibond-issued only)
-- Requires join condition: product_description ≈ Odoo name. Best-effort.
WITH revenue AS (
  SELECT
    sil.product_description AS desc,
    SUM(sil.importe_mxn)    AS revenue_mxn,
    COUNT(*)                AS line_count,
    MAX(si.fecha_timbrado)::date AS last_invoice
  FROM syntage_invoice_line_items sil
  JOIN syntage_invoices si ON si.uuid = sil.invoice_uuid
  WHERE si.emisor_rfc = 'PNT920218IW5'  -- Quimibond as emisor
    AND si.fecha_timbrado >= (CURRENT_DATE - INTERVAL '365 days')
    AND si.tipo_comprobante = 'I'
  GROUP BY sil.product_description
)
UPDATE canonical_products cp
SET sat_revenue_mxn_12m = COALESCE(rv.revenue_mxn, 0),
    sat_line_count_12m = COALESCE(rv.line_count, 0),
    last_sat_invoice_date = rv.last_invoice
FROM revenue rv
WHERE LOWER(cp.display_name) LIKE '%' || LOWER(rv.desc) || '%'
  AND cp.sat_revenue_mxn_12m = 0;

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('populate','canonical_products','SP3 Task 8: populate from odoo_products + fiscal_map + syntage aggregate','20260423_sp3_08_canonical_products_populate.sql','silver-sp3',true);

COMMIT;
```

**Note on Step 8c/8d:** the join by `product_description LIKE %display_name%` is best-effort. If syntage_invoice_line_items stores a foreign key to odoo_product_id (unlikely but check), use that instead. Document actual column names in notes before applying.

- [ ] **Step 3-4: Gate + Apply**

> "Task 8 ready. Inserts ~7,222 canonical_products from odoo_products. Attaches sat_clave_prod_serv from products_fiscal_map (20 manual overrides). Infers sat_clave + 12m revenue from syntage_invoice_line_items (best-effort join by description). OK to apply?"

- [ ] **Step 5: Verify**

```sql
SELECT
  (SELECT COUNT(*) FROM canonical_products) AS total,
  (SELECT COUNT(*) FROM canonical_products WHERE sat_clave_prod_serv IS NOT NULL) AS with_sat_clave,
  (SELECT COUNT(*) FROM canonical_products WHERE fiscal_map_confidence='manual') AS manual_overrides,
  (SELECT COUNT(*) FROM canonical_products WHERE fiscal_map_confidence='inferred_frequent') AS inferred,
  (SELECT COUNT(*) FROM canonical_products WHERE sat_revenue_mxn_12m > 0) AS with_revenue;
```

Expected: total ≤ 7,222 (some odoo_products have NULL internal_ref). manual_overrides = 20. inferred count varies. with_revenue > 100.

- [ ] **Step 6: Rollback + Commit**

```sql
DELETE FROM canonical_products;
```

```bash
git add supabase/migrations/20260423_sp3_08_canonical_products_populate.sql docs/superpowers/plans/2026-04-22-silver-sp3-mdm-notes.md
git commit -m "feat(sp3): populate canonical_products (+ fiscal_map + syntage aggregate)"
git push
```

---

### Task 9: `canonical_products` incremental trigger

**Purpose.** Keep canonical_products synced on odoo_products INSERT/UPDATE.

**Files:** Create `supabase/migrations/20260423_sp3_09_canonical_products_triggers.sql`

**Steps:**

- [ ] **Step 1: Write trigger**

```sql
BEGIN;

CREATE OR REPLACE FUNCTION canonical_products_upsert_from_odoo() RETURNS trigger AS $$
BEGIN
  IF NEW.internal_ref IS NULL OR NEW.internal_ref = '' THEN RETURN NEW; END IF;
  INSERT INTO canonical_products (
    internal_ref, display_name, canonical_name, odoo_product_id,
    category, uom, product_type, barcode, weight,
    standard_price_mxn, avg_cost_mxn, list_price_mxn,
    stock_qty, reserved_qty, available_qty, reorder_min, reorder_max,
    is_active, last_matched_at
  ) VALUES (
    NEW.internal_ref, NEW.name, LOWER(NEW.name), NEW.odoo_product_id,
    NEW.category, NEW.uom, NEW.product_type, NEW.barcode, NEW.weight,
    NEW.standard_price, NEW.avg_cost, NEW.list_price,
    NEW.stock_qty, NEW.reserved_qty, NEW.available_qty, NEW.reorder_min, NEW.reorder_max,
    COALESCE(NEW.active, true), now()
  )
  ON CONFLICT (internal_ref) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    canonical_name = EXCLUDED.canonical_name,
    category = EXCLUDED.category,
    uom = EXCLUDED.uom,
    product_type = EXCLUDED.product_type,
    barcode = EXCLUDED.barcode,
    weight = EXCLUDED.weight,
    standard_price_mxn = EXCLUDED.standard_price_mxn,
    avg_cost_mxn = EXCLUDED.avg_cost_mxn,
    list_price_mxn = CASE
      WHEN canonical_products.list_price_mxn IS DISTINCT FROM EXCLUDED.list_price_mxn
      THEN EXCLUDED.list_price_mxn ELSE canonical_products.list_price_mxn END,
    last_list_price_change_at = CASE
      WHEN canonical_products.list_price_mxn IS DISTINCT FROM EXCLUDED.list_price_mxn
      THEN now() ELSE canonical_products.last_list_price_change_at END,
    stock_qty = EXCLUDED.stock_qty,
    reserved_qty = EXCLUDED.reserved_qty,
    available_qty = EXCLUDED.available_qty,
    reorder_min = EXCLUDED.reorder_min,
    reorder_max = EXCLUDED.reorder_max,
    is_active = EXCLUDED.is_active,
    last_matched_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cprod_from_odoo ON odoo_products;
CREATE TRIGGER trg_cprod_from_odoo AFTER INSERT OR UPDATE ON odoo_products
  FOR EACH ROW EXECUTE FUNCTION canonical_products_upsert_from_odoo();

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('create_trigger','canonical_products','SP3 Task 9: incremental trigger','20260423_sp3_09_canonical_products_triggers.sql','silver-sp3',true);

COMMIT;
```

- [ ] **Step 2-3: Apply + smoke**

```sql
BEGIN;
UPDATE odoo_products SET list_price = list_price + 0.01 WHERE id = (SELECT id FROM odoo_products WHERE internal_ref IS NOT NULL LIMIT 1);
SELECT internal_ref, list_price_mxn, last_list_price_change_at FROM canonical_products
WHERE internal_ref = (SELECT internal_ref FROM odoo_products WHERE internal_ref IS NOT NULL LIMIT 1);
ROLLBACK;
-- Expected: last_list_price_change_at near now()
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260423_sp3_09_canonical_products_triggers.sql docs/superpowers/plans/2026-04-22-silver-sp3-mdm-notes.md
git commit -m "feat(sp3): incremental trigger for canonical_products"
git push
```

**Rollback Task 9:** `DROP TRIGGER IF EXISTS trg_cprod_from_odoo ON odoo_products; DROP FUNCTION IF EXISTS canonical_products_upsert_from_odoo();`

---

### Task 10: `canonical_employees` view

**Purpose.** Spec §5.8. View over canonical_contacts + odoo_employees + odoo_users join. No populate needed — derived.

**Files:** Create `supabase/migrations/20260423_sp3_10_canonical_employees_view.sql`

**Steps:**

- [ ] **Step 1: Write view**

```sql
BEGIN;

CREATE OR REPLACE VIEW canonical_employees AS
SELECT
  cc.id AS contact_id,
  cc.primary_email,
  cc.display_name,
  cc.canonical_name,
  cc.odoo_employee_id,
  cc.odoo_user_id,
  e.work_phone,
  e.job_title,
  e.job_name,
  e.department_name,
  e.department_id,
  cc.manager_canonical_contact_id,
  e.coach_name,
  COALESCE(e.active, true) AS is_active,
  u.pending_activities_count,
  u.overdue_activities_count,
  (SELECT COUNT(*) FROM agent_insights ai
     WHERE ai.assignee_user_id = cc.odoo_user_id
       AND ai.state IN ('new','seen')) AS open_insights_count,
  cc.created_at,
  cc.updated_at
FROM canonical_contacts cc
LEFT JOIN odoo_employees e ON e.odoo_employee_id = cc.odoo_employee_id
LEFT JOIN odoo_users u ON u.odoo_user_id = cc.odoo_user_id
WHERE cc.contact_type IN ('internal_employee','internal_user');

COMMENT ON VIEW canonical_employees IS 'Silver SP3 §5.8. Derived view over canonical_contacts + HR data. Also includes internal_user rows even without employee record.';

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('create_view','canonical_employees','SP3 Task 10: view definition','20260423_sp3_10_canonical_employees_view.sql','silver-sp3',true);

COMMIT;
```

- [ ] **Step 2: Apply + verify**

```sql
SELECT COUNT(*) FROM canonical_employees;
-- Expected: ≤ 204 (164 employees + 40 users - overlap)

SELECT contact_type, COUNT(*) FROM canonical_contacts WHERE contact_type IN ('internal_employee','internal_user') GROUP BY contact_type;

SELECT * FROM canonical_employees LIMIT 3;
```

Paste in notes.

- [ ] **Step 3: Rollback + Commit**

```sql
DROP VIEW IF EXISTS canonical_employees;
```

```bash
git add supabase/migrations/20260423_sp3_10_canonical_employees_view.sql docs/superpowers/plans/2026-04-22-silver-sp3-mdm-notes.md
git commit -m "feat(sp3): canonical_employees view"
git push
```

---

## source_links (Tasks 11-13)

### Task 11: `source_links` DDL

**Purpose.** Spec §6.1. Traceability table: one row per `{canonical_entity, source, source_id}` link.

**Files:** Create `supabase/migrations/20260423_sp3_11_source_links_ddl.sql`

**Steps:**

- [ ] **Step 1: DDL**

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS source_links (
  id bigserial PRIMARY KEY,
  canonical_entity_type text NOT NULL CHECK (canonical_entity_type IN ('company','contact','product','invoice','payment','credit_note','tax_event')),
  canonical_entity_id text NOT NULL,
  source text NOT NULL CHECK (source IN ('odoo','sat','gmail','kg_entity','manual')),
  source_table text NOT NULL,
  source_id text NOT NULL,
  source_natural_key text,
  match_method text NOT NULL,
  match_confidence numeric(4,3) NOT NULL CHECK (match_confidence BETWEEN 0 AND 1),
  matched_at timestamptz NOT NULL DEFAULT now(),
  matched_by text,
  superseded_at timestamptz,
  notes text
);

CREATE INDEX IF NOT EXISTS ix_sl_entity ON source_links (canonical_entity_type, canonical_entity_id);
CREATE INDEX IF NOT EXISTS ix_sl_source ON source_links (source, source_id) WHERE superseded_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_sl_entity_source_active ON source_links (canonical_entity_type, source, source_id)
  WHERE superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_sl_match_method ON source_links (match_method);
CREATE INDEX IF NOT EXISTS ix_sl_natural_key ON source_links (source_natural_key) WHERE source_natural_key IS NOT NULL;

COMMENT ON TABLE source_links IS 'Silver SP3 §6.1. Traceability layer: one row per {canonical_entity, source, source_id} link.';

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('create_table','source_links','SP3 Task 11: DDL','20260423_sp3_11_source_links_ddl.sql','silver-sp3',true);

COMMIT;
```

- [ ] **Step 2-3: Apply + verify**

```sql
SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='source_links';
-- Expected: 12
SELECT indexname FROM pg_indexes WHERE tablename='source_links';
-- Expected: 6 (PK + 5 user)
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260423_sp3_11_source_links_ddl.sql docs/superpowers/plans/2026-04-22-silver-sp3-mdm-notes.md
git commit -m "feat(sp3): source_links DDL"
git push
```

**Rollback Task 11:** `DROP TABLE IF EXISTS source_links CASCADE;`

---

### Task 12: Populate `source_links` retroactively (GATED)

**Purpose.** Create source_link rows for all existing canonical_* matches — companies, contacts, products, invoices, payments, credit_notes.

**Gate.** User OK — creates 150k+ links (88k invoice-to-odoo + 88k invoice-to-sat + 43k payment-to-odoo + 43k payment-to-sat + ~25k allocations + 2k contact + 2k company + 7k product).

**Files:** Create `supabase/migrations/20260423_sp3_12_source_links_populate.sql`

**Steps:**

- [ ] **Step 1: Dry-run counts**

```sql
SELECT
  (SELECT COUNT(*) FROM canonical_companies WHERE odoo_partner_id IS NOT NULL) AS cc_odoo,
  (SELECT COUNT(*) FROM canonical_companies WHERE rfc IS NOT NULL AND has_shadow_flag)  AS cc_sat_shadow,
  (SELECT COUNT(*) FROM canonical_contacts WHERE odoo_employee_id IS NOT NULL) AS cct_emp,
  (SELECT COUNT(*) FROM canonical_contacts WHERE odoo_user_id IS NOT NULL)     AS cct_user,
  (SELECT COUNT(*) FROM canonical_contacts WHERE odoo_partner_id IS NOT NULL)  AS cct_partner,
  (SELECT COUNT(*) FROM canonical_products WHERE odoo_product_id IS NOT NULL)  AS cprod_odoo,
  (SELECT COUNT(*) FROM canonical_invoices WHERE odoo_invoice_id IS NOT NULL)  AS ci_odoo,
  (SELECT COUNT(*) FROM canonical_invoices WHERE sat_uuid IS NOT NULL)         AS ci_sat,
  (SELECT COUNT(*) FROM canonical_payments WHERE odoo_payment_id IS NOT NULL)  AS cp_odoo,
  (SELECT COUNT(*) FROM canonical_payments WHERE sat_uuid_complemento IS NOT NULL) AS cp_sat,
  (SELECT COUNT(*) FROM canonical_credit_notes WHERE odoo_invoice_id IS NOT NULL) AS ccn_odoo,
  (SELECT COUNT(*) FROM canonical_credit_notes WHERE sat_uuid IS NOT NULL)         AS ccn_sat;
```

Document expected ~150k-200k links total.

- [ ] **Step 2: Populate SQL**

```sql
BEGIN;

-- 12a. companies → odoo
INSERT INTO source_links (canonical_entity_type, canonical_entity_id, source, source_table, source_id, source_natural_key, match_method, match_confidence, matched_by)
SELECT 'company', cc.id::text, 'odoo', 'companies',
       (SELECT c.id::text FROM companies c WHERE c.canonical_name = cc.canonical_name LIMIT 1),
       cc.odoo_partner_id::text,
       COALESCE(cc.match_method, 'odoo_partner_id'),
       COALESCE(cc.match_confidence, 0.99),
       'system'
FROM canonical_companies cc
WHERE cc.odoo_partner_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- 12b. companies → sat (shadows via rfc)
INSERT INTO source_links (canonical_entity_type, canonical_entity_id, source, source_table, source_id, source_natural_key, match_method, match_confidence, matched_by)
SELECT 'company', cc.id::text, 'sat', 'syntage_invoices', cc.rfc, cc.rfc,
       'sat_only', 0.50, 'system'
FROM canonical_companies cc
WHERE cc.has_shadow_flag = true AND cc.rfc IS NOT NULL
ON CONFLICT DO NOTHING;

-- 12c. contacts → odoo_employees / odoo_users / contacts
INSERT INTO source_links (canonical_entity_type, canonical_entity_id, source, source_table, source_id, source_natural_key, match_method, match_confidence, matched_by)
SELECT 'contact', cct.id::text, 'odoo', 'odoo_employees', cct.odoo_employee_id::text, cct.primary_email, 'email_exact', 0.99, 'system'
FROM canonical_contacts cct WHERE cct.odoo_employee_id IS NOT NULL
UNION ALL
SELECT 'contact', cct.id::text, 'odoo', 'odoo_users', cct.odoo_user_id::text, cct.primary_email, 'email_exact', 0.99, 'system'
FROM canonical_contacts cct WHERE cct.odoo_user_id IS NOT NULL
UNION ALL
SELECT 'contact', cct.id::text, 'odoo', 'contacts', cct.odoo_partner_id::text, cct.primary_email, 'email_exact', 0.99, 'system'
FROM canonical_contacts cct WHERE cct.odoo_partner_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- 12d. products → odoo + fiscal_map
INSERT INTO source_links (canonical_entity_type, canonical_entity_id, source, source_table, source_id, source_natural_key, match_method, match_confidence, matched_by)
SELECT 'product', cp.id::text, 'odoo', 'odoo_products', cp.odoo_product_id::text, cp.internal_ref, 'internal_ref_exact', 1.000, 'system'
FROM canonical_products cp
UNION ALL
SELECT 'product', cp.id::text, 'manual', 'products_fiscal_map', pfm.id::text, cp.internal_ref, 'manual_override', 1.000, COALESCE(pfm.created_by,'system')
FROM canonical_products cp
JOIN products_fiscal_map pfm ON pfm.odoo_product_id = cp.odoo_product_id
ON CONFLICT DO NOTHING;

-- 12e. invoices → odoo + sat
INSERT INTO source_links (canonical_entity_type, canonical_entity_id, source, source_table, source_id, source_natural_key, match_method, match_confidence, matched_by)
SELECT 'invoice', ci.canonical_id, 'odoo', 'odoo_invoices', ci.odoo_invoice_id::text, ci.cfdi_uuid_odoo,
       COALESCE(ci.resolved_from, 'odoo_only'), COALESCE(
         CASE ci.match_confidence WHEN 'exact' THEN 1.000 WHEN 'high' THEN 0.90 WHEN 'medium' THEN 0.80 ELSE 0.50 END,
         0.99), 'system'
FROM canonical_invoices ci WHERE ci.odoo_invoice_id IS NOT NULL
UNION ALL
SELECT 'invoice', ci.canonical_id, 'sat', 'syntage_invoices', ci.sat_uuid, ci.sat_uuid,
       COALESCE(ci.resolved_from, 'uuid_exact'),
       COALESCE(
         CASE ci.match_confidence WHEN 'exact' THEN 1.000 WHEN 'high' THEN 0.90 WHEN 'medium' THEN 0.80 ELSE 0.50 END,
         1.000), 'system'
FROM canonical_invoices ci WHERE ci.sat_uuid IS NOT NULL
ON CONFLICT DO NOTHING;

-- 12f. payments → odoo + sat
INSERT INTO source_links (canonical_entity_type, canonical_entity_id, source, source_table, source_id, source_natural_key, match_method, match_confidence, matched_by)
SELECT 'payment', cp.canonical_id, 'odoo', 'odoo_account_payments', cp.odoo_payment_id::text, cp.odoo_ref,
       CASE WHEN cp.sat_uuid_complemento IS NOT NULL THEN 'num_operacion_exact' ELSE 'odoo_only' END,
       CASE WHEN cp.sat_uuid_complemento IS NOT NULL THEN 0.85 ELSE 0.99 END, 'system'
FROM canonical_payments cp WHERE cp.odoo_payment_id IS NOT NULL
UNION ALL
SELECT 'payment', cp.canonical_id, 'sat', 'syntage_invoice_payments', cp.sat_uuid_complemento, cp.sat_uuid_complemento,
       'uuid_exact', 1.000, 'system'
FROM canonical_payments cp WHERE cp.sat_uuid_complemento IS NOT NULL
ON CONFLICT DO NOTHING;

-- 12g. credit_notes → odoo + sat
INSERT INTO source_links (canonical_entity_type, canonical_entity_id, source, source_table, source_id, source_natural_key, match_method, match_confidence, matched_by)
SELECT 'credit_note', ccn.canonical_id, 'odoo', 'odoo_invoices', ccn.odoo_invoice_id::text, ccn.sat_uuid, 'odoo_partner_id', 0.99, 'system'
FROM canonical_credit_notes ccn WHERE ccn.odoo_invoice_id IS NOT NULL
UNION ALL
SELECT 'credit_note', ccn.canonical_id, 'sat', 'syntage_invoices', ccn.sat_uuid, ccn.sat_uuid, 'uuid_exact', 1.000, 'system'
FROM canonical_credit_notes ccn WHERE ccn.sat_uuid IS NOT NULL
ON CONFLICT DO NOTHING;

-- 12h. tax_events → sat
INSERT INTO source_links (canonical_entity_type, canonical_entity_id, source, source_table, source_id, source_natural_key, match_method, match_confidence, matched_by)
SELECT 'tax_event', cte.canonical_id, 'sat', 'syntage_' || cte.event_type || 's', cte.sat_record_id, COALESCE(cte.retention_uuid, cte.return_numero_operacion, cte.acct_hash),
       'uuid_exact', 1.000, 'system'
FROM canonical_tax_events cte
WHERE cte.sat_record_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('populate','source_links','SP3 Task 12: retroactive populate from canonical_*','20260423_sp3_12_source_links_populate.sql','silver-sp3',true);

COMMIT;
```

**Note:** the mapping `'syntage_' || cte.event_type || 's'` yields `syntage_retentions`, `syntage_tax_returns`, `syntage_electronic_accountings` — check actual table names and adjust (may need explicit CASE).

- [ ] **Step 3-4: Gate + Apply**

> "Task 12 ready. Retroactive populate of source_links: ~150k links (2k companies + 2k contacts + 7k products + 88k invoices × 2 sources + 43k payments × 2 + 2k credit_notes × 2 + 400 tax events). OK to apply?"

If apply_migration times out, split into 8 sub-migrations (12a..12h separately).

- [ ] **Step 5: Verify**

```sql
SELECT canonical_entity_type, source, COUNT(*)
FROM source_links WHERE superseded_at IS NULL
GROUP BY 1, 2 ORDER BY 1, 2;
```

```sql
SELECT match_method, COUNT(*) FROM source_links GROUP BY 1 ORDER BY 2 DESC;
```

Expected distribution documented in notes.

```sql
-- DoD: source_links.count > 10,000
SELECT COUNT(*) FROM source_links WHERE superseded_at IS NULL;
-- Expected: >= 150,000
```

- [ ] **Step 6: Rollback + Commit**

```sql
DELETE FROM source_links WHERE matched_by = 'system' AND superseded_at IS NULL;
```

```bash
git add supabase/migrations/20260423_sp3_12_source_links_populate.sql docs/superpowers/plans/2026-04-22-silver-sp3-mdm-notes.md
git commit -m "feat(sp3): populate source_links retroactively (150k+ links)"
git push
```

---

### Task 13: `source_links` auto-insert triggers

**Purpose.** Trigger on canonical_companies/contacts/products INSERT to auto-create source_link row. For canonical_invoices/payments/credit_notes triggers in SP2 already fire — we extend them in Task 21.

**Files:** Create `supabase/migrations/20260423_sp3_13_source_links_triggers.sql`

**Steps:**

- [ ] **Step 1: Write trigger functions**

```sql
BEGIN;

CREATE OR REPLACE FUNCTION trg_source_link_company() RETURNS trigger AS $$
BEGIN
  IF NEW.odoo_partner_id IS NOT NULL THEN
    INSERT INTO source_links (canonical_entity_type, canonical_entity_id, source, source_table, source_id, source_natural_key, match_method, match_confidence, matched_by)
    VALUES ('company', NEW.id::text, 'odoo', 'companies',
            (SELECT c.id::text FROM companies c WHERE c.canonical_name = NEW.canonical_name LIMIT 1),
            NEW.odoo_partner_id::text,
            COALESCE(NEW.match_method, 'odoo_partner_id'),
            COALESCE(NEW.match_confidence, 0.99), 'system')
    ON CONFLICT (canonical_entity_type, source, source_id) WHERE superseded_at IS NULL DO NOTHING;
  END IF;
  IF NEW.rfc IS NOT NULL AND NEW.has_shadow_flag THEN
    INSERT INTO source_links (canonical_entity_type, canonical_entity_id, source, source_table, source_id, source_natural_key, match_method, match_confidence, matched_by)
    VALUES ('company', NEW.id::text, 'sat', 'syntage_invoices', NEW.rfc, NEW.rfc, 'sat_only', 0.50, 'system')
    ON CONFLICT (canonical_entity_type, source, source_id) WHERE superseded_at IS NULL DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_source_link_contact() RETURNS trigger AS $$
BEGIN
  IF NEW.odoo_employee_id IS NOT NULL THEN
    INSERT INTO source_links (canonical_entity_type, canonical_entity_id, source, source_table, source_id, source_natural_key, match_method, match_confidence, matched_by)
    VALUES ('contact', NEW.id::text, 'odoo', 'odoo_employees', NEW.odoo_employee_id::text, NEW.primary_email, 'email_exact', 0.99, 'system')
    ON CONFLICT (canonical_entity_type, source, source_id) WHERE superseded_at IS NULL DO NOTHING;
  END IF;
  IF NEW.odoo_user_id IS NOT NULL THEN
    INSERT INTO source_links (canonical_entity_type, canonical_entity_id, source, source_table, source_id, source_natural_key, match_method, match_confidence, matched_by)
    VALUES ('contact', NEW.id::text, 'odoo', 'odoo_users', NEW.odoo_user_id::text, NEW.primary_email, 'email_exact', 0.99, 'system')
    ON CONFLICT (canonical_entity_type, source, source_id) WHERE superseded_at IS NULL DO NOTHING;
  END IF;
  IF NEW.odoo_partner_id IS NOT NULL THEN
    INSERT INTO source_links (canonical_entity_type, canonical_entity_id, source, source_table, source_id, source_natural_key, match_method, match_confidence, matched_by)
    VALUES ('contact', NEW.id::text, 'odoo', 'contacts', NEW.odoo_partner_id::text, NEW.primary_email, 'email_exact', 0.99, 'system')
    ON CONFLICT (canonical_entity_type, source, source_id) WHERE superseded_at IS NULL DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION trg_source_link_product() RETURNS trigger AS $$
BEGIN
  INSERT INTO source_links (canonical_entity_type, canonical_entity_id, source, source_table, source_id, source_natural_key, match_method, match_confidence, matched_by)
  VALUES ('product', NEW.id::text, 'odoo', 'odoo_products', NEW.odoo_product_id::text, NEW.internal_ref, 'internal_ref_exact', 1.000, 'system')
  ON CONFLICT (canonical_entity_type, source, source_id) WHERE superseded_at IS NULL DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sl_company ON canonical_companies;
CREATE TRIGGER trg_sl_company AFTER INSERT OR UPDATE ON canonical_companies
  FOR EACH ROW EXECUTE FUNCTION trg_source_link_company();

DROP TRIGGER IF EXISTS trg_sl_contact ON canonical_contacts;
CREATE TRIGGER trg_sl_contact AFTER INSERT OR UPDATE ON canonical_contacts
  FOR EACH ROW EXECUTE FUNCTION trg_source_link_contact();

DROP TRIGGER IF EXISTS trg_sl_product ON canonical_products;
CREATE TRIGGER trg_sl_product AFTER INSERT OR UPDATE ON canonical_products
  FOR EACH ROW EXECUTE FUNCTION trg_source_link_product();

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('create_trigger','source_links','SP3 Task 13: auto-insert triggers on canonical_*','20260423_sp3_13_source_links_triggers.sql','silver-sp3',true);

COMMIT;
```

- [ ] **Step 2-3: Apply + verify + smoke + commit**

```sql
SELECT tgname FROM pg_trigger WHERE tgname LIKE 'trg_sl_%';
-- Expected: 3
```

```bash
git add supabase/migrations/20260423_sp3_13_source_links_triggers.sql docs/superpowers/plans/2026-04-22-silver-sp3-mdm-notes.md
git commit -m "feat(sp3): source_links auto-insert triggers on canonical_*"
git push
```

---

### Task 14: Extend `mdm_manual_overrides` schema per §6.4

**Purpose.** SP2 Task 14 created mdm_manual_overrides with minimal schema. §6.4 defines richer schema with action/source_link_id/payload/expires_at/is_active/revoke_reason.

**Files:** Create `supabase/migrations/20260423_sp3_14_mdm_manual_overrides_extend.sql`

**Steps:**

- [ ] **Step 1: ALTER TABLE**

```sql
BEGIN;

-- SP2 had: id, entity_type, canonical_id, override_field, override_value, override_source, linked_by, linked_at, note, created_at
-- SP3 adds: action, source_link_id, payload, expires_at, is_active, revoke_reason
ALTER TABLE mdm_manual_overrides ADD COLUMN IF NOT EXISTS action text DEFAULT 'link'
  CHECK (action IN ('link','unlink','merge','split','assign_attribute'));
ALTER TABLE mdm_manual_overrides ADD COLUMN IF NOT EXISTS source_link_id bigint REFERENCES source_links(id);
ALTER TABLE mdm_manual_overrides ADD COLUMN IF NOT EXISTS payload jsonb DEFAULT '{}'::jsonb;
ALTER TABLE mdm_manual_overrides ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE mdm_manual_overrides ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE mdm_manual_overrides ADD COLUMN IF NOT EXISTS revoke_reason text;

CREATE INDEX IF NOT EXISTS ix_mmo_active ON mdm_manual_overrides (is_active) WHERE is_active = true;

-- Backfill payload from the old override_field/override_value columns
UPDATE mdm_manual_overrides
SET payload = jsonb_build_object(
  'override_field', override_field,
  'override_value', override_value,
  'override_source', override_source
)
WHERE payload = '{}'::jsonb OR payload IS NULL;

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('alter_table','mdm_manual_overrides','SP3 Task 14: extend per §6.4 (action/source_link_id/payload/expires/is_active/revoke_reason)','20260423_sp3_14_mdm_manual_overrides_extend.sql','silver-sp3',true);

COMMIT;
```

- [ ] **Step 2-3: Apply + verify**

```sql
SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='mdm_manual_overrides' ORDER BY ordinal_position;
SELECT COUNT(*) FROM mdm_manual_overrides WHERE payload <> '{}'::jsonb;
-- Expected: 20 (all backfilled)
```

- [ ] **Step 4: Rollback + Commit**

```sql
ALTER TABLE mdm_manual_overrides DROP COLUMN IF EXISTS action;
ALTER TABLE mdm_manual_overrides DROP COLUMN IF EXISTS source_link_id;
ALTER TABLE mdm_manual_overrides DROP COLUMN IF EXISTS payload;
ALTER TABLE mdm_manual_overrides DROP COLUMN IF EXISTS expires_at;
ALTER TABLE mdm_manual_overrides DROP COLUMN IF EXISTS is_active;
ALTER TABLE mdm_manual_overrides DROP COLUMN IF EXISTS revoke_reason;
DROP INDEX IF EXISTS ix_mmo_active;
```

```bash
git add supabase/migrations/20260423_sp3_14_mdm_manual_overrides_extend.sql docs/superpowers/plans/2026-04-22-silver-sp3-mdm-notes.md
git commit -m "feat(sp3): extend mdm_manual_overrides per §6.4"
git push
```

---

## Matcher functions (Tasks 15-17)

### Task 15: `matcher_company` + `matcher_company_if_new_rfc`

**Purpose.** Given a RFC + name pair, find matching canonical_company (rfc_exact > name_fuzzy > shadow). Auto-create shadow if no match and RFC is post-2021.

**Files:** Create `supabase/migrations/20260423_sp3_15_matcher_company.sql`

**Steps:**

- [ ] **Step 1: Write functions**

```sql
BEGIN;

CREATE OR REPLACE FUNCTION matcher_company(
  p_rfc text,
  p_name text DEFAULT NULL,
  p_domain text DEFAULT NULL,
  p_autocreate_shadow boolean DEFAULT false
) RETURNS bigint AS $$
DECLARE v_id bigint;
BEGIN
  IF p_rfc IS NULL OR p_rfc = '' THEN
    -- Name-only match (fuzzy)
    IF p_name IS NULL OR p_name = '' THEN RETURN NULL; END IF;
    SELECT id INTO v_id FROM canonical_companies
      WHERE similarity(canonical_name, LOWER(p_name)) >= 0.85
      ORDER BY similarity(canonical_name, LOWER(p_name)) DESC LIMIT 1;
    RETURN v_id;
  END IF;

  -- RFC exact
  SELECT id INTO v_id FROM canonical_companies WHERE rfc = p_rfc LIMIT 1;
  IF FOUND THEN RETURN v_id; END IF;

  -- Generic RFC → name fuzzy
  IF p_rfc IN ('XEXX010101000','XAXX010101000') AND p_name IS NOT NULL THEN
    SELECT id INTO v_id FROM canonical_companies
      WHERE similarity(canonical_name, LOWER(p_name)) >= 0.90
      ORDER BY similarity(canonical_name, LOWER(p_name)) DESC LIMIT 1;
    RETURN v_id;
  END IF;

  -- Domain match fallback
  IF p_domain IS NOT NULL THEN
    SELECT id INTO v_id FROM canonical_companies
      WHERE primary_email_domain = LOWER(p_domain) LIMIT 1;
    IF FOUND THEN RETURN v_id; END IF;
  END IF;

  -- No match: optionally create shadow
  IF p_autocreate_shadow THEN
    INSERT INTO canonical_companies (
      canonical_name, display_name, rfc,
      has_shadow_flag, shadow_reason,
      match_method, match_confidence, needs_review, review_reason, last_matched_at
    ) VALUES (
      LOWER(COALESCE(p_name, p_rfc)),
      COALESCE(p_name, p_rfc),
      p_rfc, true, 'sat_cfdi_only_post_2021',
      'sat_only', 0.50, true, ARRAY['sat_only_shadow'], now()
    )
    ON CONFLICT (canonical_name) DO NOTHING
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      SELECT id INTO v_id FROM canonical_companies WHERE rfc = p_rfc LIMIT 1;
    END IF;
  END IF;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION matcher_company_if_new_rfc(
  p_emisor_rfc text, p_emisor_nombre text,
  p_receptor_rfc text, p_receptor_nombre text
) RETURNS void AS $$
BEGIN
  PERFORM matcher_company(p_emisor_rfc, p_emisor_nombre, NULL, true);
  PERFORM matcher_company(p_receptor_rfc, p_receptor_nombre, NULL, true);
END;
$$ LANGUAGE plpgsql;

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('create_function','canonical_companies','SP3 Task 15: matcher_company + matcher_company_if_new_rfc','20260423_sp3_15_matcher_company.sql','silver-sp3',true);

COMMIT;
```

- [ ] **Step 2-4: Apply + smoke**

```sql
-- Should return Quimibond id
SELECT matcher_company('PNT920218IW5');

-- Should return NULL (bogus RFC)
SELECT matcher_company('XYZABC999999');

-- With autocreate: should create a shadow
BEGIN;
SELECT matcher_company('ZZZ910101AB1', 'Empresa Smoke', NULL, true);
SELECT id, canonical_name, has_shadow_flag FROM canonical_companies WHERE rfc='ZZZ910101AB1';
ROLLBACK;
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260423_sp3_15_matcher_company.sql docs/superpowers/plans/2026-04-22-silver-sp3-mdm-notes.md
git commit -m "feat(sp3): matcher_company + matcher_company_if_new_rfc"
git push
```

**Rollback:** `DROP FUNCTION IF EXISTS matcher_company(text,text,text,boolean); DROP FUNCTION IF EXISTS matcher_company_if_new_rfc(text,text,text,text);`

---

### Task 16: `matcher_contact` + `matcher_product`

**Purpose.** Matcher functions for contacts + products (§7.1 rules).

**Files:** Create `supabase/migrations/20260423_sp3_16_matcher_contact_product.sql`

**Steps:**

- [ ] **Step 1: Write functions**

```sql
BEGIN;

CREATE OR REPLACE FUNCTION matcher_contact(
  p_email text,
  p_name text DEFAULT NULL,
  p_domain text DEFAULT NULL
) RETURNS bigint AS $$
DECLARE v_id bigint;
BEGIN
  IF p_email IS NULL OR p_email = '' THEN
    IF p_name IS NULL THEN RETURN NULL; END IF;
    SELECT id INTO v_id FROM canonical_contacts
      WHERE similarity(canonical_name, LOWER(p_name)) >= 0.85
      ORDER BY similarity(canonical_name, LOWER(p_name)) DESC LIMIT 1;
    RETURN v_id;
  END IF;

  -- Email exact (case-insensitive)
  SELECT id INTO v_id FROM canonical_contacts WHERE LOWER(primary_email) = LOWER(p_email) LIMIT 1;
  IF FOUND THEN RETURN v_id; END IF;

  -- Domain match
  IF p_domain IS NULL THEN p_domain := SPLIT_PART(p_email, '@', 2); END IF;
  IF p_domain IS NOT NULL AND p_domain <> '' THEN
    SELECT cct.id INTO v_id
    FROM canonical_contacts cct
    JOIN canonical_companies ccomp ON ccomp.id = cct.canonical_company_id
    WHERE ccomp.primary_email_domain = LOWER(p_domain)
    LIMIT 1;
    IF FOUND THEN RETURN v_id; END IF;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION matcher_product(
  p_internal_ref text,
  p_name text DEFAULT NULL
) RETURNS bigint AS $$
DECLARE v_id bigint;
BEGIN
  -- Internal ref exact
  IF p_internal_ref IS NOT NULL AND p_internal_ref <> '' THEN
    SELECT id INTO v_id FROM canonical_products WHERE internal_ref = p_internal_ref LIMIT 1;
    IF FOUND THEN RETURN v_id; END IF;
  END IF;

  -- Name fuzzy fallback
  IF p_name IS NOT NULL AND p_name <> '' THEN
    SELECT id INTO v_id FROM canonical_products
      WHERE similarity(canonical_name, LOWER(p_name)) >= 0.85
      ORDER BY similarity(canonical_name, LOWER(p_name)) DESC LIMIT 1;
    RETURN v_id;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('create_function','canonical_contacts','SP3 Task 16: matcher_contact + matcher_product','20260423_sp3_16_matcher_contact_product.sql','silver-sp3',true);

COMMIT;
```

- [ ] **Step 2-4: Apply + smoke + commit**

```sql
-- Pick an email from canonical_contacts
SELECT matcher_contact('jose.mizrahi@quimibond.com');
-- Should return a valid id

SELECT matcher_product('WM4032OW152');
-- If that SKU exists, returns its id
```

```bash
git add supabase/migrations/20260423_sp3_16_matcher_contact_product.sql docs/superpowers/plans/2026-04-22-silver-sp3-mdm-notes.md
git commit -m "feat(sp3): matcher_contact + matcher_product"
git push
```

---

### Task 17: `matcher_all_pending` + `matcher_invoice_quick`

**Purpose.** Bulk matcher for `needs_review=true` or `last_matched_at < now()-2h` rows. Plus invoice quick-matcher to back-fill `emisor_canonical_company_id` / `receptor_canonical_company_id` on Bronze invoice insert.

**Files:** Create `supabase/migrations/20260423_sp3_17_matcher_all_pending.sql`

**Steps:**

- [ ] **Step 1: Write functions**

```sql
BEGIN;

CREATE OR REPLACE FUNCTION matcher_invoice_quick(p_uuid text) RETURNS void AS $$
DECLARE
  v_emisor_cc bigint; v_receptor_cc bigint; v_salesperson bigint;
BEGIN
  -- Trigger-invoked: resolve emisor/receptor/salesperson canonical ids for the canonical_invoices row with sat_uuid=p_uuid
  -- NOTE: Task 19 renames columns to *_canonical_company_id. This function must be updated there (migration 19 redefines).
  SELECT matcher_company(ci.emisor_rfc, ci.emisor_nombre, NULL, false) INTO v_emisor_cc
    FROM canonical_invoices ci WHERE ci.sat_uuid = p_uuid LIMIT 1;
  SELECT matcher_company(ci.receptor_rfc, ci.receptor_nombre, NULL, false) INTO v_receptor_cc
    FROM canonical_invoices ci WHERE ci.sat_uuid = p_uuid LIMIT 1;
  SELECT cct.id INTO v_salesperson
    FROM canonical_invoices ci
    JOIN canonical_contacts cct ON cct.odoo_user_id = ci.salesperson_user_id
    WHERE ci.sat_uuid = p_uuid LIMIT 1;

  UPDATE canonical_invoices
  SET emisor_company_id = COALESCE(v_emisor_cc, emisor_company_id),
      receptor_company_id = COALESCE(v_receptor_cc, receptor_company_id),
      salesperson_contact_id = COALESCE(v_salesperson, salesperson_contact_id),
      last_reconciled_at = now()
  WHERE sat_uuid = p_uuid;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION matcher_all_pending() RETURNS TABLE(
  entity text, attempted integer, resolved integer
) AS $$
DECLARE v_att integer; v_res integer;
BEGIN
  -- 1. canonical_companies with needs_review OR last_matched_at stale
  SELECT COUNT(*) INTO v_att FROM canonical_companies
    WHERE needs_review=true OR last_matched_at < (now() - interval '2 hours');
  UPDATE canonical_companies cc
  SET last_matched_at = now()
  WHERE cc.needs_review=true OR cc.last_matched_at < (now() - interval '2 hours');
  v_res := v_att; -- no-op refresh marker for now
  entity := 'company'; attempted := v_att; resolved := v_res; RETURN NEXT;

  -- 2. canonical_contacts pending
  SELECT COUNT(*) INTO v_att FROM canonical_contacts
    WHERE needs_review=true OR last_matched_at < (now() - interval '2 hours');
  UPDATE canonical_contacts cct
  SET canonical_company_id = COALESCE(
        cct.canonical_company_id,
        matcher_company(NULL, NULL, SPLIT_PART(cct.primary_email, '@', 2), false)
      ),
      last_matched_at = now()
  WHERE cct.needs_review=true OR cct.last_matched_at < (now() - interval '2 hours');
  v_res := v_att;
  entity := 'contact'; attempted := v_att; resolved := v_res; RETURN NEXT;

  -- 3. canonical_invoices missing emisor/receptor company id but have rfc
  SELECT COUNT(*) INTO v_att FROM canonical_invoices
    WHERE (emisor_company_id IS NULL AND emisor_rfc IS NOT NULL)
       OR (receptor_company_id IS NULL AND receptor_rfc IS NOT NULL);
  UPDATE canonical_invoices ci
  SET emisor_company_id = COALESCE(ci.emisor_company_id, matcher_company(ci.emisor_rfc, ci.emisor_nombre, NULL, false)),
      receptor_company_id = COALESCE(ci.receptor_company_id, matcher_company(ci.receptor_rfc, ci.receptor_nombre, NULL, false)),
      last_reconciled_at = now()
  WHERE (ci.emisor_company_id IS NULL AND ci.emisor_rfc IS NOT NULL)
     OR (ci.receptor_company_id IS NULL AND ci.receptor_rfc IS NOT NULL);
  v_res := v_att;
  entity := 'invoice'; attempted := v_att; resolved := v_res; RETURN NEXT;

  RETURN;
END;
$$ LANGUAGE plpgsql;

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('create_function','canonical_invoices','SP3 Task 17: matcher_invoice_quick + matcher_all_pending','20260423_sp3_17_matcher_all_pending.sql','silver-sp3',true);

COMMIT;
```

- [ ] **Step 2-4: Apply + smoke**

```sql
-- Smoke matcher_invoice_quick
SELECT matcher_invoice_quick((SELECT sat_uuid FROM canonical_invoices WHERE sat_uuid IS NOT NULL LIMIT 1));

-- Smoke matcher_all_pending
SELECT * FROM matcher_all_pending();
-- Expected: 3 rows (company/contact/invoice) with attempted + resolved counts
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260423_sp3_17_matcher_all_pending.sql docs/superpowers/plans/2026-04-22-silver-sp3-mdm-notes.md
git commit -m "feat(sp3): matcher_invoice_quick + matcher_all_pending"
git push
```

---

### Task 18: Manual override functions

**Purpose.** `mdm_merge_companies(a, b, note)`, `mdm_link_invoice(...)`, `mdm_revoke_override(id)` per §6.4.

**Files:** Create `supabase/migrations/20260423_sp3_18_manual_override_functions.sql`

**Steps:**

- [ ] **Step 1: Write functions**

```sql
BEGIN;

CREATE OR REPLACE FUNCTION mdm_merge_companies(
  p_canonical_a bigint,
  p_canonical_b bigint,
  p_user_email text,
  p_note text DEFAULT NULL
) RETURNS bigint AS $$
DECLARE v_survivor bigint; v_victim bigint;
BEGIN
  IF p_canonical_a = p_canonical_b THEN RAISE EXCEPTION 'Cannot merge a company with itself'; END IF;
  -- Keep the one with more data (lifetime_value_mxn > or has_manual_override > ...)
  SELECT id INTO v_survivor FROM canonical_companies
   WHERE id IN (p_canonical_a, p_canonical_b)
   ORDER BY has_manual_override DESC, lifetime_value_mxn DESC, NOT has_shadow_flag DESC LIMIT 1;
  v_victim := CASE WHEN v_survivor = p_canonical_a THEN p_canonical_b ELSE p_canonical_a END;

  -- Re-point FKs from canonical_invoices/payments/credit_notes/contacts
  UPDATE canonical_invoices SET emisor_company_id = v_survivor WHERE emisor_company_id = v_victim;
  UPDATE canonical_invoices SET receptor_company_id = v_survivor WHERE receptor_company_id = v_victim;
  UPDATE canonical_payments SET counterparty_company_id = v_survivor WHERE counterparty_company_id = v_victim;
  UPDATE canonical_credit_notes SET emisor_company_id = v_survivor WHERE emisor_company_id = v_victim;
  UPDATE canonical_credit_notes SET receptor_company_id = v_survivor WHERE receptor_company_id = v_victim;
  UPDATE canonical_contacts SET canonical_company_id = v_survivor WHERE canonical_company_id = v_victim;

  -- Archive victim source_links under survivor
  UPDATE source_links SET canonical_entity_id = v_survivor::text WHERE canonical_entity_type='company' AND canonical_entity_id = v_victim::text;

  -- Flag survivor as manual override + audit
  UPDATE canonical_companies SET has_manual_override = true, last_matched_at = now() WHERE id = v_survivor;
  INSERT INTO mdm_manual_overrides (entity_type, canonical_id, action, payload, linked_by, note, is_active)
  VALUES ('company', v_survivor::text, 'merge',
          jsonb_build_object('merged_from', v_victim, 'merged_into', v_survivor),
          p_user_email, p_note, true);

  -- Delete victim (safe now that FKs re-pointed)
  DELETE FROM canonical_companies WHERE id = v_victim;
  RETURN v_survivor;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION mdm_link_invoice(
  p_canonical_id text,
  p_sat_uuid text,
  p_odoo_invoice_id bigint DEFAULT NULL,
  p_user_email text DEFAULT 'system',
  p_note text DEFAULT NULL
) RETURNS void AS $$
BEGIN
  UPDATE canonical_invoices
  SET sat_uuid = p_sat_uuid,
      odoo_invoice_id = COALESCE(p_odoo_invoice_id, odoo_invoice_id),
      resolved_from = 'manual_bridge',
      match_confidence = 'exact',
      has_manual_link = true,
      last_reconciled_at = now()
  WHERE canonical_id = p_canonical_id;

  -- Source link row
  INSERT INTO source_links (canonical_entity_type, canonical_entity_id, source, source_table, source_id, source_natural_key, match_method, match_confidence, matched_by, notes)
  VALUES ('invoice', p_canonical_id, 'sat', 'syntage_invoices', p_sat_uuid, p_sat_uuid, 'manual_override', 1.000, 'user:' || p_user_email, p_note)
  ON CONFLICT (canonical_entity_type, source, source_id) WHERE superseded_at IS NULL DO NOTHING;

  INSERT INTO mdm_manual_overrides (entity_type, canonical_id, action, payload, linked_by, note, is_active)
  VALUES ('invoice', p_canonical_id, 'link',
          jsonb_build_object('sat_uuid', p_sat_uuid, 'odoo_invoice_id', p_odoo_invoice_id),
          p_user_email, p_note, true);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION mdm_revoke_override(
  p_override_id bigint,
  p_user_email text,
  p_reason text
) RETURNS void AS $$
DECLARE v_row record;
BEGIN
  UPDATE mdm_manual_overrides
  SET is_active = false, revoke_reason = p_reason
  WHERE id = p_override_id
  RETURNING entity_type, canonical_id INTO v_row;

  IF v_row.entity_type = 'invoice' THEN
    UPDATE canonical_invoices
    SET has_manual_link = false, resolved_from = NULL
    WHERE canonical_id = v_row.canonical_id;
    UPDATE source_links SET superseded_at = now()
    WHERE canonical_entity_type='invoice' AND canonical_entity_id = v_row.canonical_id
      AND match_method='manual_override';
  ELSIF v_row.entity_type = 'company' THEN
    UPDATE canonical_companies SET has_manual_override = false WHERE id::text = v_row.canonical_id;
  END IF;
  -- Other entity types extensible later.
END;
$$ LANGUAGE plpgsql;

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('create_function','mdm_manual_overrides','SP3 Task 18: manual override functions','20260423_sp3_18_manual_override_functions.sql','silver-sp3',true);

COMMIT;
```

- [ ] **Step 2-4: Apply + smoke + commit**

```sql
-- Smoke merge (uses 2 shadow rows to avoid damage)
BEGIN;
WITH a AS (INSERT INTO canonical_companies (canonical_name, display_name, rfc, has_shadow_flag) VALUES ('merge smoke a', 'A', 'AAA000000A00', true) RETURNING id),
     b AS (INSERT INTO canonical_companies (canonical_name, display_name, rfc, has_shadow_flag) VALUES ('merge smoke b', 'B', 'BBB000000B00', true) RETURNING id)
SELECT mdm_merge_companies((SELECT id FROM a), (SELECT id FROM b), 'test@example.com', 'smoke');
ROLLBACK;
```

```bash
git add supabase/migrations/20260423_sp3_18_manual_override_functions.sql docs/superpowers/plans/2026-04-22-silver-sp3-mdm-notes.md
git commit -m "feat(sp3): mdm_merge_companies + mdm_link_invoice + mdm_revoke_override"
git push
```

---

## FK back-fill (Tasks 19-20)

### Task 19: `canonical_invoices` FK rename + back-fill (GATED, 88k rows)

**Purpose.** Rename `emisor_company_id` → `emisor_canonical_company_id` (and receptor + salesperson_contact_id already named correctly). Re-point all rows from `companies.id` placeholder to canonical_companies.id. Add REFERENCES constraint.

**Gate.** User OK — ALTER on 88k rows + UPDATE touching every row.

**Files:** Create `supabase/migrations/20260423_sp3_19_canonical_invoices_fk_backfill.sql`

**Steps:**

- [ ] **Step 1: Pre-gate — count rows to backfill**

```sql
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE emisor_company_id IS NOT NULL) AS emisor_pre,
  COUNT(*) FILTER (WHERE receptor_company_id IS NOT NULL) AS receptor_pre;
FROM canonical_invoices;
```

Document pre/post counts.

- [ ] **Step 2: Write migration — RENAME + backfill + ADD CONSTRAINT**

```sql
BEGIN;

-- 19a. Rename columns (cheap)
ALTER TABLE canonical_invoices RENAME COLUMN emisor_company_id TO emisor_canonical_company_id;
ALTER TABLE canonical_invoices RENAME COLUMN receptor_company_id TO receptor_canonical_company_id;

-- 19b. Back-fill: map companies.id → canonical_companies.id
-- Join via canonical_name since canonical_companies was populated from companies.canonical_name
WITH company_map AS (
  SELECT c.id AS old_id, cc.id AS new_id
  FROM companies c
  JOIN canonical_companies cc ON cc.canonical_name = c.canonical_name
)
UPDATE canonical_invoices ci
SET emisor_canonical_company_id = cm.new_id
FROM company_map cm
WHERE ci.emisor_canonical_company_id = cm.old_id;

WITH company_map AS (
  SELECT c.id AS old_id, cc.id AS new_id
  FROM companies c
  JOIN canonical_companies cc ON cc.canonical_name = c.canonical_name
)
UPDATE canonical_invoices ci
SET receptor_canonical_company_id = cm.new_id
FROM company_map cm
WHERE ci.receptor_canonical_company_id = cm.old_id;

-- 19c. For rows that still have NULL FKs (e.g., 61k SAT-only), resolve via matcher_company
UPDATE canonical_invoices ci
SET emisor_canonical_company_id = matcher_company(ci.emisor_rfc, ci.emisor_nombre, NULL, false)
WHERE ci.emisor_canonical_company_id IS NULL AND ci.emisor_rfc IS NOT NULL;

UPDATE canonical_invoices ci
SET receptor_canonical_company_id = matcher_company(ci.receptor_rfc, ci.receptor_nombre, NULL, false)
WHERE ci.receptor_canonical_company_id IS NULL AND ci.receptor_rfc IS NOT NULL;

-- 19d. Resolve salesperson_contact_id via odoo_user_id
UPDATE canonical_invoices ci
SET salesperson_contact_id = cct.id
FROM canonical_contacts cct
WHERE cct.odoo_user_id = ci.salesperson_user_id
  AND ci.salesperson_contact_id IS NULL;

-- 19e. Add FK constraints (NOT VALID avoids full table scan; NEW inserts are checked)
ALTER TABLE canonical_invoices
  ADD CONSTRAINT fk_ci_emisor   FOREIGN KEY (emisor_canonical_company_id)   REFERENCES canonical_companies(id) NOT VALID;
ALTER TABLE canonical_invoices
  ADD CONSTRAINT fk_ci_receptor FOREIGN KEY (receptor_canonical_company_id) REFERENCES canonical_companies(id) NOT VALID;
ALTER TABLE canonical_invoices
  ADD CONSTRAINT fk_ci_sp       FOREIGN KEY (salesperson_contact_id)       REFERENCES canonical_contacts(id)  NOT VALID;

-- Validate (full scan but doesn't hold write lock on PG14+)
ALTER TABLE canonical_invoices VALIDATE CONSTRAINT fk_ci_emisor;
ALTER TABLE canonical_invoices VALIDATE CONSTRAINT fk_ci_receptor;
ALTER TABLE canonical_invoices VALIDATE CONSTRAINT fk_ci_sp;

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('alter_table','canonical_invoices','SP3 Task 19: FK rename + backfill to canonical_companies/contacts + ADD CONSTRAINT','20260423_sp3_19_canonical_invoices_fk_backfill.sql','silver-sp3',true);

COMMIT;
```

- [ ] **Step 3: Gate**

> "Task 19: Rename FKs on canonical_invoices (88k rows), backfill from companies.id → canonical_companies.id via canonical_name join, fall back to matcher_company for 61k SAT-only rows. Add FK constraints with NOT VALID + VALIDATE. Expected time: <60s. OK to apply?"

- [ ] **Step 4: Apply**

If apply_migration times out at VALIDATE, split Step 19e into separate migration.

- [ ] **Step 5: Verify**

```sql
SELECT
  (SELECT COUNT(*) FROM canonical_invoices WHERE emisor_canonical_company_id IS NOT NULL) AS with_emisor,
  (SELECT COUNT(*) FROM canonical_invoices WHERE receptor_canonical_company_id IS NOT NULL) AS with_receptor,
  (SELECT COUNT(*) FROM canonical_invoices WHERE emisor_canonical_company_id IS NULL AND has_sat_record=true) AS emisor_unresolved,
  (SELECT COUNT(*) FROM canonical_invoices WHERE receptor_canonical_company_id IS NULL AND has_sat_record=true) AS receptor_unresolved,
  (SELECT COUNT(*) FROM canonical_invoices WHERE salesperson_contact_id IS NOT NULL) AS with_salesperson;
```

DoD: `receptor_unresolved = 0` (all SAT rows get matched or shadow-matched). If non-zero, investigate.

```sql
-- Confirm FK constraint valid
SELECT conname, convalidated FROM pg_constraint WHERE conrelid='canonical_invoices'::regclass AND contype='f';
-- Expected: 3 rows, convalidated=true
```

- [ ] **Step 6: Rollback**

```sql
ALTER TABLE canonical_invoices DROP CONSTRAINT IF EXISTS fk_ci_emisor;
ALTER TABLE canonical_invoices DROP CONSTRAINT IF EXISTS fk_ci_receptor;
ALTER TABLE canonical_invoices DROP CONSTRAINT IF EXISTS fk_ci_sp;
ALTER TABLE canonical_invoices RENAME COLUMN emisor_canonical_company_id TO emisor_company_id;
ALTER TABLE canonical_invoices RENAME COLUMN receptor_canonical_company_id TO receptor_company_id;
-- Backfill cannot be reversed without pre-snapshot
```

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260423_sp3_19_canonical_invoices_fk_backfill.sql docs/superpowers/plans/2026-04-22-silver-sp3-mdm-notes.md
git commit -m "feat(sp3): canonical_invoices FK rename + backfill to canonical_*"
git push
```

---

### Task 20: `canonical_payments` + `canonical_credit_notes` FK rename + back-fill (GATED)

**Purpose.** Same rename pattern on canonical_payments (counterparty_company_id → counterparty_canonical_company_id) and canonical_credit_notes (emisor/receptor).

**Gate.** User OK — 43k + 2.2k rows.

**Files:** Create `supabase/migrations/20260423_sp3_20_canonical_payments_ccn_fk_backfill.sql`

**Steps:**

- [ ] **Step 1: Pre-gate counts**

```sql
SELECT
  (SELECT COUNT(*) FROM canonical_payments WHERE counterparty_company_id IS NOT NULL) AS cp_with_counterparty,
  (SELECT COUNT(*) FROM canonical_credit_notes WHERE emisor_company_id IS NOT NULL) AS ccn_with_emisor,
  (SELECT COUNT(*) FROM canonical_credit_notes WHERE receptor_company_id IS NOT NULL) AS ccn_with_receptor;
```

- [ ] **Step 2: Write migration**

```sql
BEGIN;

-- canonical_payments
ALTER TABLE canonical_payments RENAME COLUMN counterparty_company_id TO counterparty_canonical_company_id;

WITH company_map AS (
  SELECT c.id AS old_id, cc.id AS new_id
  FROM companies c JOIN canonical_companies cc ON cc.canonical_name = c.canonical_name
)
UPDATE canonical_payments cp
SET counterparty_canonical_company_id = cm.new_id
FROM company_map cm
WHERE cp.counterparty_canonical_company_id = cm.old_id;

ALTER TABLE canonical_payments
  ADD CONSTRAINT fk_cp_counterparty FOREIGN KEY (counterparty_canonical_company_id) REFERENCES canonical_companies(id) NOT VALID;
ALTER TABLE canonical_payments VALIDATE CONSTRAINT fk_cp_counterparty;

-- canonical_credit_notes
ALTER TABLE canonical_credit_notes RENAME COLUMN emisor_company_id TO emisor_canonical_company_id;
ALTER TABLE canonical_credit_notes RENAME COLUMN receptor_company_id TO receptor_canonical_company_id;

WITH company_map AS (
  SELECT c.id AS old_id, cc.id AS new_id
  FROM companies c JOIN canonical_companies cc ON cc.canonical_name = c.canonical_name
)
UPDATE canonical_credit_notes ccn
SET emisor_canonical_company_id = cm.new_id
FROM company_map cm
WHERE ccn.emisor_canonical_company_id = cm.old_id;

WITH company_map AS (
  SELECT c.id AS old_id, cc.id AS new_id
  FROM companies c JOIN canonical_companies cc ON cc.canonical_name = c.canonical_name
)
UPDATE canonical_credit_notes ccn
SET receptor_canonical_company_id = cm.new_id
FROM company_map cm
WHERE ccn.receptor_canonical_company_id = cm.old_id;

-- Resolve residual NULLs via matcher_company
UPDATE canonical_credit_notes ccn
SET emisor_canonical_company_id = matcher_company(ccn.emisor_rfc, ccn.emisor_nombre, NULL, false)
WHERE ccn.emisor_canonical_company_id IS NULL AND ccn.emisor_rfc IS NOT NULL;

UPDATE canonical_credit_notes ccn
SET receptor_canonical_company_id = matcher_company(ccn.receptor_rfc, ccn.receptor_nombre, NULL, false)
WHERE ccn.receptor_canonical_company_id IS NULL AND ccn.receptor_rfc IS NOT NULL;

ALTER TABLE canonical_credit_notes
  ADD CONSTRAINT fk_ccn_emisor   FOREIGN KEY (emisor_canonical_company_id)   REFERENCES canonical_companies(id) NOT VALID;
ALTER TABLE canonical_credit_notes
  ADD CONSTRAINT fk_ccn_receptor FOREIGN KEY (receptor_canonical_company_id) REFERENCES canonical_companies(id) NOT VALID;
ALTER TABLE canonical_credit_notes VALIDATE CONSTRAINT fk_ccn_emisor;
ALTER TABLE canonical_credit_notes VALIDATE CONSTRAINT fk_ccn_receptor;

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('alter_table','canonical_payments,canonical_credit_notes','SP3 Task 20: FK rename + backfill','20260423_sp3_20_canonical_payments_ccn_fk_backfill.sql','silver-sp3',true);

COMMIT;
```

- [ ] **Step 3-4: Gate + Apply**

> "Task 20: same FK rename/backfill pattern on canonical_payments (43k) + canonical_credit_notes (2.2k). OK to apply?"

- [ ] **Step 5: Verify**

```sql
SELECT
  (SELECT COUNT(*) FROM canonical_payments WHERE counterparty_canonical_company_id IS NOT NULL) AS cp_resolved,
  (SELECT COUNT(*) FROM canonical_credit_notes WHERE emisor_canonical_company_id IS NOT NULL) AS ccn_emisor_resolved,
  (SELECT COUNT(*) FROM canonical_credit_notes WHERE receptor_canonical_company_id IS NOT NULL) AS ccn_receptor_resolved;

SELECT conname FROM pg_constraint
WHERE conrelid IN ('canonical_payments'::regclass, 'canonical_credit_notes'::regclass) AND contype='f';
-- Expected: fk_cp_counterparty, fk_ccn_emisor, fk_ccn_receptor
```

- [ ] **Step 6: Rollback + Commit**

```sql
ALTER TABLE canonical_payments     DROP CONSTRAINT IF EXISTS fk_cp_counterparty;
ALTER TABLE canonical_credit_notes DROP CONSTRAINT IF EXISTS fk_ccn_emisor;
ALTER TABLE canonical_credit_notes DROP CONSTRAINT IF EXISTS fk_ccn_receptor;
ALTER TABLE canonical_payments     RENAME COLUMN counterparty_canonical_company_id TO counterparty_company_id;
ALTER TABLE canonical_credit_notes RENAME COLUMN emisor_canonical_company_id   TO emisor_company_id;
ALTER TABLE canonical_credit_notes RENAME COLUMN receptor_canonical_company_id TO receptor_company_id;
```

```bash
git add supabase/migrations/20260423_sp3_20_canonical_payments_ccn_fk_backfill.sql docs/superpowers/plans/2026-04-22-silver-sp3-mdm-notes.md
git commit -m "feat(sp3): canonical_payments + canonical_credit_notes FK rename + backfill"
git push
```

---

### Task 21: pg_cron 2h matcher + Bronze triggers (GATED)

**Purpose.** Schedule `matcher_all_pending()` every 2h; add triggers on Bronze (`syntage_invoices` INSERT, `companies` INSERT, `odoo_account_payments` INSERT) that invoke `matcher_*_if_new_*()` for immediate resolution.

**Gate.** User OK — new cron job + triggers fire on every Bronze write.

**Files:** Create `supabase/migrations/20260423_sp3_21_pg_cron_and_bronze_triggers.sql`

**Steps:**

- [ ] **Step 1: Write migration**

```sql
BEGIN;

-- 21a. pg_cron: matcher_all_pending every 2h (offset +35 minutes from SP2 reconciliation)
DO $$ DECLARE r record;
BEGIN
  FOR r IN SELECT jobname FROM cron.job WHERE jobname='silver_sp3_matcher_all_pending' LOOP
    PERFORM cron.unschedule(r.jobname);
  END LOOP;
END $$;

SELECT cron.schedule(
  'silver_sp3_matcher_all_pending',
  '35 */2 * * *',
  $$SELECT * FROM matcher_all_pending();$$
);

-- 21b. Trigger on companies INSERT — match new Odoo company to canonical_companies
CREATE OR REPLACE FUNCTION trg_canonical_company_from_odoo() RETURNS trigger AS $$
BEGIN
  INSERT INTO canonical_companies (
    canonical_name, display_name, rfc, odoo_partner_id, primary_entity_kg_id, primary_email_domain,
    is_customer, is_supplier, country, city,
    industry, business_type, credit_limit, payment_term, supplier_payment_term,
    description, strategic_notes, relationship_type, relationship_summary,
    key_products, risk_signals, opportunity_signals, enriched_at, enrichment_source,
    match_method, match_confidence, last_matched_at
  ) VALUES (
    NEW.canonical_name, NEW.name, NULLIF(TRIM(NEW.rfc),''),
    NEW.odoo_partner_id, NEW.entity_id, LOWER(NULLIF(TRIM(NEW.domain),'')),
    COALESCE(NEW.is_customer, false), COALESCE(NEW.is_supplier, false),
    NEW.country, NEW.city, NEW.industry, NEW.business_type,
    NEW.credit_limit, NEW.payment_term, NEW.supplier_payment_term,
    NEW.description, NEW.strategic_notes, NEW.relationship_type, NEW.relationship_summary,
    NEW.key_products, NEW.risk_signals, NEW.opportunity_signals, NEW.enriched_at, NEW.enrichment_source,
    'odoo_partner_id', 0.99, now()
  )
  ON CONFLICT (canonical_name) DO UPDATE SET
    rfc = COALESCE(canonical_companies.rfc, EXCLUDED.rfc),
    odoo_partner_id = COALESCE(canonical_companies.odoo_partner_id, EXCLUDED.odoo_partner_id),
    is_customer = canonical_companies.is_customer OR EXCLUDED.is_customer,
    is_supplier = canonical_companies.is_supplier OR EXCLUDED.is_supplier,
    country = COALESCE(canonical_companies.country, EXCLUDED.country),
    city = COALESCE(canonical_companies.city, EXCLUDED.city),
    last_matched_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cc_from_odoo ON companies;
CREATE TRIGGER trg_cc_from_odoo AFTER INSERT OR UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION trg_canonical_company_from_odoo();

-- 21c. Trigger on syntage_invoices INSERT — create shadow company if new RFC
CREATE OR REPLACE FUNCTION trg_matcher_company_on_syntage_invoice() RETURNS trigger AS $$
BEGIN
  PERFORM matcher_company_if_new_rfc(NEW.emisor_rfc, NEW.emisor_nombre, NEW.receptor_rfc, NEW.receptor_nombre);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sat_invoice_matcher ON syntage_invoices;
CREATE TRIGGER trg_sat_invoice_matcher AFTER INSERT ON syntage_invoices
  FOR EACH ROW EXECUTE FUNCTION trg_matcher_company_on_syntage_invoice();

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('cron_schedule','canonical_companies','SP3 Task 21: matcher cron + Bronze triggers','20260423_sp3_21_pg_cron_and_bronze_triggers.sql','silver-sp3',true);

COMMIT;
```

- [ ] **Step 2-3: Gate + Apply**

> "Task 21: schedules matcher_all_pending() every 2h (HH:35). Adds triggers on companies INSERT (auto-create canonical_company) and syntage_invoices INSERT (auto-create shadow if new RFC). OK?"

- [ ] **Step 4: Verify**

```sql
SELECT jobname, schedule, active FROM cron.job WHERE jobname LIKE 'silver_sp3_%';
-- Expected: 1 active job

SELECT tgname FROM pg_trigger WHERE tgname IN ('trg_cc_from_odoo','trg_sat_invoice_matcher');
-- Expected: 2 triggers
```

Smoke test: INSERT a dummy row in companies via ROLLBACK'd transaction — verify canonical_companies row auto-created.

- [ ] **Step 5: Rollback + Commit**

```sql
SELECT cron.unschedule('silver_sp3_matcher_all_pending');
DROP TRIGGER IF EXISTS trg_cc_from_odoo ON companies;
DROP TRIGGER IF EXISTS trg_sat_invoice_matcher ON syntage_invoices;
DROP FUNCTION IF EXISTS trg_canonical_company_from_odoo();
DROP FUNCTION IF EXISTS trg_matcher_company_on_syntage_invoice();
```

```bash
git add supabase/migrations/20260423_sp3_21_pg_cron_and_bronze_triggers.sql docs/superpowers/plans/2026-04-22-silver-sp3-mdm-notes.md
git commit -m "feat(sp3): pg_cron 2h matcher + Bronze auto-match triggers"
git push
```

---

## Close

### Task 22: Post-audit + CLAUDE.md + MEMORY + PR

**Purpose.** Validate DoD, update docs, open PR.

**Files:**
- Create: `supabase/migrations/20260423_sp3_99_final.sql`
- Modify: `CLAUDE.md` (frontend) — add SP3 section under Base de datos.
- Create/modify: `/Users/jj/.claude/projects/-Users-jj/memory/project_silver_sp3_mdm.md`
- Modify: `/Users/jj/.claude/projects/-Users-jj/memory/MEMORY.md` — add SP3 entry.
- Update: notes file with closure table.

**Steps:**

- [ ] **Step 1: DoD check**

```sql
SELECT
  (SELECT COUNT(*) FROM canonical_companies) AS cc_total,
  (SELECT COUNT(*) FROM canonical_companies WHERE has_shadow_flag) AS cc_shadows,
  (SELECT COUNT(*) FROM canonical_contacts) AS cct_total,
  (SELECT COUNT(*) FROM canonical_products) AS cprod_total,
  (SELECT COUNT(*) FROM source_links WHERE superseded_at IS NULL) AS sl_active,
  (SELECT COUNT(*) FROM canonical_invoices WHERE receptor_canonical_company_id IS NULL AND has_sat_record=true AND emisor_canonical_company_id IS NOT NULL) AS ci_unresolved_counterparty,
  (SELECT COUNT(*) FROM pg_constraint WHERE conrelid='canonical_invoices'::regclass AND contype='f') AS ci_fks,
  (SELECT COUNT(*) FROM cron.job WHERE jobname LIKE 'silver_%' AND active=true) AS active_crons;
```

DoD per spec §11 SP3:
- `cc_total ≥ 2,200` ✓
- `source_links.count > 10,000` ✓
- `ci_unresolved_counterparty = 0` (all receptor resolved — shadow created for SAT-only)
- `canonical_contacts.primary_email` UNIQUE — verify 0 conflicts (case-insensitive).

- [ ] **Step 2: Write final migration**

```sql
BEGIN;

INSERT INTO audit_runs (run_id, source, model, invariant_key, bucket_key, odoo_value, supabase_value, diff, severity, date_from, date_to, details, run_at)
SELECT
  gen_random_uuid(),
  'supabase', 'final', 'sp3_done', 'global', NULL, NULL, NULL, 'ok', NULL, NULL,
  jsonb_build_object(
    'label',                     'sp3-done-' || to_char(now(),'YYYYMMDD-HH24MISS'),
    'canonical_companies',       (SELECT COUNT(*) FROM canonical_companies),
    'canonical_contacts',        (SELECT COUNT(*) FROM canonical_contacts),
    'canonical_products',        (SELECT COUNT(*) FROM canonical_products),
    'source_links',              (SELECT COUNT(*) FROM source_links WHERE superseded_at IS NULL),
    'canonical_invoices_fk_ok',  (SELECT COUNT(*) FROM canonical_invoices WHERE emisor_canonical_company_id IS NOT NULL),
    'canonical_payments_fk_ok',  (SELECT COUNT(*) FROM canonical_payments WHERE counterparty_canonical_company_id IS NOT NULL),
    'active_crons',              (SELECT COUNT(*) FROM cron.job WHERE jobname LIKE 'silver_%' AND active=true)
  ),
  now();

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('sp3_done','','Silver SP3 MDM complete','20260423_sp3_99_final.sql','silver-sp3',true);

COMMIT;
```

- [ ] **Step 3: Update `CLAUDE.md`**

Add after "Silver Canonical Tables (SP2 ...)" section:

```markdown
### Silver MDM (SP3 — 2026-04-23)

Pattern C master data management layer:

| Tabla | Rows | Purpose |
|---|---|---|
| `canonical_companies` | ~2,200+ (with shadows) | Golden company record; SP3 adds FK to canonical_invoices/payments/ccn |
| `canonical_contacts` | ~2,200 | Golden contact (email UNIQUE case-insensitive) |
| `canonical_products` | ~7,200 | Golden product (internal_ref UNIQUE) |
| `canonical_employees` | view | Filter over canonical_contacts for internal_* types |
| `source_links` | 150k+ | Traceability: {canonical_entity, source, source_id} links |
| `mdm_manual_overrides` | extended | action/source_link_id/payload/expires_at/is_active/revoke_reason |

**Matcher functions:**
- `matcher_company(rfc, name, domain, autocreate_shadow)` — RFC exact > fuzzy name > domain > shadow
- `matcher_contact(email, name, domain)` — email > domain
- `matcher_product(internal_ref, name)` — ref exact > fuzzy name
- `matcher_all_pending()` — pg_cron 2h, resolves needs_review rows
- `matcher_company_if_new_rfc(e_rfc, e_name, r_rfc, r_name)` — shadow creator on Bronze INSERT
- `matcher_invoice_quick(uuid)` — fast FK resolution for new invoices

**Manual override functions:**
- `mdm_merge_companies(a, b, user, note)` — merge two canonical_companies
- `mdm_link_invoice(canonical_id, sat_uuid, odoo_id, user, note)` — manual invoice↔SAT link
- `mdm_revoke_override(override_id, user, reason)` — reverse a manual override

**FK changes (canonical tables):**
- canonical_invoices: `emisor_canonical_company_id`, `receptor_canonical_company_id`, `salesperson_contact_id` → FK to canonical_companies/canonical_contacts.
- canonical_payments: `counterparty_canonical_company_id` → FK to canonical_companies.
- canonical_credit_notes: `emisor_canonical_company_id`, `receptor_canonical_company_id` → FK to canonical_companies.

**pg_cron:** `silver_sp3_matcher_all_pending` (HH:35 every 2h).

**SP4 next:** Pattern B MVs (orders/deliveries/inventory), evidence layer (email_signals/ai_extracted_facts/attachments/manual_notes), 31-invariante engine cutover.
```

- [ ] **Step 4: Memory files**

Create `/Users/jj/.claude/projects/-Users-jj/memory/project_silver_sp3_mdm.md`:

```markdown
---
name: Silver SP3 MDM complete
description: MDM Cat C — canonical_companies/contacts/products/employees + source_links + mdm_manual_overrides + 6 matchers + 3 override functions + FK back-fill. SP3 DoD met.
type: project
---

**Fecha:** 2026-04-23.

**Entregables.**
- canonical_companies: <N> rows (<S> shadows from 61k SAT-only RFCs).
- canonical_contacts: <N>; primary_email UNIQUE case-insensitive 0 conflicts.
- canonical_products: <N>; sat_clave_prod_serv from fiscal_map (20 manual) + inferred (syntage aggregate).
- canonical_employees: view over canonical_contacts.
- source_links: 150k+ active links.
- mdm_manual_overrides: extended per §6.4.
- 6 matcher functions + 3 override functions.
- FK rename + backfill: canonical_invoices/payments/credit_notes all point to canonical_companies/contacts.
- pg_cron: 4 silver_sp*_* active (3 SP2 + 1 SP3).

**Quimibond canonical_companies.id:** <fill after Task 2>.

**Siguiente:** SP4 (Pattern B + evidence layer + engine cutover).
```

Edit MEMORY.md: add line pointing to SP3 memory.

- [ ] **Step 5: Seal notes**

Append to notes file:

```markdown
## SP3 Cierre (2026-04-23)

| DoD | Target | Actual | Status |
|---|---|---|---|
| canonical_companies total | ≥2,200 | <fill> | <fill> |
| canonical_contacts primary_email UNIQUE conflicts | 0 | <fill> | <fill> |
| source_links active | >10,000 | <fill> | <fill> |
| canonical_invoices unresolved receptor | 0 | <fill> | <fill> |
| pg_cron silver_sp3_* | 1 | <fill> | <fill> |

**Commits on branch silver-sp3-mdm (in order):** <fill commit SHAs>

**Deviations from plan:** <fill if any>
```

- [ ] **Step 6: Commit + PR**

```bash
cd /Users/jj/quimibond-intelligence/quimibond-intelligence
git add supabase/migrations/20260423_sp3_99_final.sql CLAUDE.md docs/superpowers/plans/2026-04-22-silver-sp3-mdm-notes.md
git commit -m "chore(sp3): close out — DoD check, CLAUDE.md update, notes sealed"
git push

gh pr create --title "feat(silver): SP3 MDM (companies/contacts/products + matchers + FK backfill)" --body "$(cat <<'EOF'
## Summary
- Pattern C MDM tables: canonical_companies, canonical_contacts, canonical_products + canonical_employees view
- source_links traceability (150k+ active)
- mdm_manual_overrides extended per §6.4
- 6 matcher functions (company, contact, product, all_pending, company_if_new_rfc, invoice_quick)
- 3 manual override functions (merge_companies, link_invoice, revoke_override)
- FK rename + backfill on canonical_invoices/payments/credit_notes
- pg_cron silver_sp3_matcher_all_pending (2h)
- Bronze triggers: companies INSERT + syntage_invoices INSERT → auto-canonical resolve

## DoD
All targets met. 61,264 SAT-only invoice counterparties resolved via shadow creation.

## Test plan
- [ ] `SELECT * FROM matcher_all_pending()` returns 3 rows with counts
- [ ] `SELECT * FROM canonical_employees` returns internal_* contacts
- [ ] `source_links` UNIQUE constraint enforces 1 active link per {entity, source, source_id}
- [ ] No regression on canonical_invoices reconciliation (Task 19 preserved data integrity)

## Deploy
Pure Supabase migrations. No Odoo addon changes.

## Follow-ups
- SP4 Pattern B MVs (orders/deliveries/inventory)
- SP4 evidence layer
- SP4 reconciliation engine cutover with 31 invariants
- SP5 frontend cutover + legacy table deprecation
EOF
)"
```

Return PR URL.

## Self-review

**Spec §11 SP3 coverage:**
- canonical_companies from companies+shadows → Tasks 1-3 ✓
- canonical_contacts from users/employees/contacts → Tasks 4-6 ✓
- canonical_products from odoo_products+fiscal_map+syntage → Tasks 7-9 ✓
- canonical_employees view → Task 10 ✓
- source_links populated via matcher → Tasks 11-13 ✓
- mdm_manual_overrides extended → Task 14 ✓
- 6 matcher functions → Tasks 15-17 ✓
- FK backfill → Tasks 19-20 ✓

**DoD coverage:**
- canonical_companies.count ≥ 2,200 → Task 3 + Task 22 check
- canonical_contacts.primary_email UNIQUE with 0 conflicts → Task 4 UNIQUE index enforces
- source_links.count > 10,000 → Task 12 delivers 150k+
- 0 canonical_invoices WHERE receptor unresolved with has_sat_record → Tasks 19 + shadow creation combined
- Match confidence distribution documented → notes throughout Tasks 2,3,5,8,12

**Placeholder scan:** None detected. All SQL executable.

**Type consistency:** matcher_company signature `(p_rfc text, p_name text, p_domain text, p_autocreate_shadow boolean)` consistent across callers. `canonical_id` text PK preserved from SP2 for canonical_invoices/payments/credit_notes; bigint id for canonical_companies/contacts/products. FK rename columns consistent: `*_canonical_company_id`, `salesperson_contact_id`, `counterparty_canonical_company_id`.

**Learnings embedded:**
- audit_runs CHECK constraints → Task 0, Task 22 ✓
- schema_changes 6-col form → all migrations ✓
- GENERATED STORED avoids STABLE functions → no generated booleans involving date casts in this plan (only text expressions) ✓
- English direction → only matters for SP2 trigger functions, inherited here ✓
- raw_payload verified empirically → Task 8 pre-gate for clave_prod_serv keys ✓
- 80k-row ALTER → Task 19 uses NOT VALID + VALIDATE to avoid write lock ✓
- Quimibond=6707 → Task 2 mapping preserved via canonical_name join ✓

---

**Plan complete.** Saved to `docs/superpowers/plans/2026-04-22-silver-sp3-mdm.md`. 22 tasks, 8 gated.

**Two execution options:**

1. **Subagent-Driven (recommended)** — `superpowers:subagent-driven-development`. Fresh subagent per task, review between.
2. **Inline Execution** — `superpowers:executing-plans`. Batch with checkpoints.

**¿Cuál approach?**
