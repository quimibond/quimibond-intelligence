# Odoo ↔ SAT Drift Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take the raw drift aggregates already populated in `canonical_companies` and make them *actionable*: kill false positives (foreign/banking/gov CFDIs), auto-link obvious unlinked pairs, fix the root cause in the Odoo addon, and promote drift into the invariant engine so issues flow into `/inbox`.

**Architecture:** Four independent changes that can ship in any order. Three are pure Supabase migrations; one is a qb19 addon change. Each migration is idempotent (uses `IF NOT EXISTS`, `CREATE OR REPLACE`) so it can be re-run. The addon change needs the user to deploy via odoo-update (Claude never deploys to `quimibond`).

**Tech Stack:** PostgreSQL + Supabase MCP (`apply_migration`), pg_cron, plpgsql, Odoo 19 Python, pytest.

**Pre-requisites (already landed in this session, no replay needed):**
- `20260424_ltv_sin_iva_writer.sql` — LTV/revenue switched to sin-IVA + hourly refresh cron
- `20260424_odoo_sat_drift_aggregates.sql` — `drift_*` columns (AR, scope 2022+) + `gold_company_odoo_sat_drift` view
- `20260424_odoo_sat_drift_ap_aggregates.sql` — `drift_ap_*` columns (AP, scope 2025+)

**Worktree note:** This plan modifies the qb19 addon (`/Users/jj/addons/quimibond_intelligence/`) AND the quimibond-intelligence repo (`/Users/jj/quimibond-intelligence/quimibond-intelligence/`). If you want isolation, create the worktree at the parent level before starting. Otherwise work on branch `main` in both repos and commit atomically per task.

---

## File Structure

```
quimibond-intelligence/ (frontend repo)
  supabase/migrations/
    20260424_drift_category_flags.sql         (Task 1)
    20260424_drift_pair_autolink.sql          (Task 2)
    20260424_drift_invariants.sql             (Task 4)

addons/quimibond_intelligence/ (qb19 repo)
  models/sync_push.py                          (Task 3: modify _push_invoices)
  tests/test_cfdi_uuid_push.py                 (Task 3: new test file)
```

Task 3 is independent of Tasks 1/2/4. Tasks 1 → 2 should be sequential (Task 2 benefits from Task 1's noise cleanup). Task 4 depends on neither but is most useful after Tasks 1-2.

---

## Task 1 — Drift category flags (P1)

**Purpose:** Eliminate ~$202M of "drift" that isn't actually drift — foreign suppliers with no Mexican RFC, banks, government entities, payroll CFDIs. They populate `drift_ap_*_mxn` legitimately but should NOT flip `drift_ap_needs_review`.

**Files:**
- Create: `quimibond-intelligence/supabase/migrations/20260424_drift_category_flags.sql`

**Current state (measured 2026-04-24):**
- 117 proveedores con `drift_ap_needs_review=true`
- 12 foreign (no RFC / XEXX) = $23.9M
- 3 banking = $158.2M
- 7 gov + payroll = $20.7M
- 95 regular suppliers = $32.6M — **el drift real**

---

- [ ] **Step 1.1: Baseline query — count current flagged suppliers**

Use the Supabase MCP to confirm starting state:

```sql
SELECT COUNT(*) FILTER (WHERE drift_ap_needs_review) AS ap_flagged,
       COUNT(*) FILTER (WHERE drift_needs_review) AS ar_flagged,
       SUM(drift_ap_total_abs_mxn) AS ap_drift_mxn,
       SUM(drift_total_abs_mxn) AS ar_drift_mxn
FROM canonical_companies;
```

Expected: `ap_flagged≈117`, `ar_flagged≈52`, `ap_drift≈$235M`, `ar_drift≈$37M`.

Record the exact numbers — they're the before-state to compare against Step 1.6.

- [ ] **Step 1.2: Create the migration file**

Create `quimibond-intelligence/supabase/migrations/20260424_drift_category_flags.sql` with the content below. Copy verbatim; don't paraphrase.

```sql
-- 2026-04-24 — Category flags to suppress false-positive drift_*_needs_review.
--
-- is_foreign: supplier with no Mexican RFC (NULL, empty, or XEXX010101000 genérico).
--             Cannot emit Mexican CFDI → Odoo-only is expected, not drift.
-- is_bank: commercial banks + casas de bolsa. CFDIs bancarios (comisiones, intereses,
--          estados de cuenta) go via journal entry, not in_invoice. Business decision
--          to document them that way — tagged as noise for drift purposes.
-- is_government: SAT, IMSS, INFONAVIT, gobiernos estatales. CFDIs de gobierno se
--                registran como pago de impuestos/cuotas, no invoice.
-- is_payroll_entity: counterparty used to dump nómina CFDIs en Odoo (e.g., "NOMINA"
--                    pseudo-partner). Tagged payroll distinct from regular suppliers.
--
-- Scope: purely flags + refresh logic tweak. Amount values stay populated (for audit),
--        only the needs_review booleans are suppressed.

ALTER TABLE canonical_companies
  ADD COLUMN IF NOT EXISTS is_foreign boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_bank boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_government boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_payroll_entity boolean DEFAULT false;

COMMENT ON COLUMN canonical_companies.is_foreign IS 'No Mexican RFC → cannot emit CFDI. Suppresses drift_ap_needs_review.';
COMMENT ON COLUMN canonical_companies.is_bank IS 'Banks / brokerage houses. CFDI bancario ≠ invoice. Suppresses drift flags.';
COMMENT ON COLUMN canonical_companies.is_government IS 'SAT/IMSS/INFONAVIT/etc. CFDI gobierno ≠ invoice. Suppresses drift flags.';
COMMENT ON COLUMN canonical_companies.is_payroll_entity IS 'Payroll pseudo-counterparty. Suppresses drift flags.';

-- Auto-populate is_foreign
UPDATE canonical_companies cc
SET is_foreign = true
WHERE (cc.rfc IS NULL OR TRIM(cc.rfc) = '' OR cc.rfc ILIKE 'XEXX%')
  AND NOT cc.is_internal;

-- Auto-populate is_bank (pattern + whitelist)
UPDATE canonical_companies cc
SET is_bank = true
WHERE (cc.display_name ILIKE '%BANCA%'
    OR cc.display_name ILIKE '%CASA DE BOLSA%'
    OR cc.display_name ILIKE '%BANCO %'
    OR cc.display_name ILIKE 'BANCO %'
    OR cc.display_name ILIKE '%HSBC%'
    OR cc.display_name ILIKE '%BANAMEX%'
    OR cc.display_name ILIKE '%BBVA%'
    OR cc.display_name ILIKE '%SANTANDER%'
    OR cc.display_name ILIKE '%SCOTIABANK%'
    OR cc.display_name ILIKE '%BANORTE%'
    OR cc.display_name ILIKE '%INBURSA%'
    OR cc.display_name ILIKE '%ACTINVER%'
    OR cc.display_name ILIKE '%MASARI%'
    OR cc.display_name ILIKE '%MIFEL%')
  AND NOT cc.is_internal;

-- Auto-populate is_government
UPDATE canonical_companies cc
SET is_government = true
WHERE (cc.display_name ILIKE 'SERVICIO DE ADMIN%'
    OR cc.display_name ILIKE 'INSTITUTO MEXICANO DEL SEGURO SOCIAL%'
    OR cc.display_name ILIKE '%Instituto del Fondo Nacional%'
    OR cc.display_name ILIKE 'INFONAVIT%'
    OR cc.display_name ILIKE '%Gobierno del Estado%'
    OR cc.display_name ILIKE '%SECRETARIA DE%'
    OR cc.display_name ILIKE '%COMISION FEDERAL DE ELECTRICIDAD%'
    OR cc.display_name ILIKE 'CFE %'
    OR cc.rfc IN ('SAT970701NN3','IMS421231I45','INF830502951'))
  AND NOT cc.is_internal;

-- Auto-populate is_payroll_entity
UPDATE canonical_companies cc
SET is_payroll_entity = true
WHERE UPPER(cc.display_name) = 'NOMINA'
   OR UPPER(cc.display_name) LIKE 'NOMINA %'
   OR UPPER(cc.display_name) LIKE '% NOMINA';

-- Tighten the needs_review predicates to exclude these categories.
-- We reuse the existing refresh function; just patch the two WHERE clauses.
CREATE OR REPLACE FUNCTION public.refresh_canonical_company_financials(p_id bigint DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_updated integer;
BEGIN
  SET LOCAL statement_timeout = '10min';

  -- [AR / LTV / CN / AP residual blocks preserved verbatim — see prior migration
  -- 20260424_odoo_sat_drift_ap_aggregates.sql for full definition. The only
  -- change below is in the two drift_*_needs_review assignments.]

  -- AR
  WITH agg AS (
    SELECT ci.receptor_canonical_company_id AS cc_id,
           SUM(COALESCE(ci.amount_untaxed_sat * ci.tipo_cambio_sat, oi.amount_untaxed_mxn)) AS ltv_mxn,
           SUM(oi.amount_untaxed_mxn) AS odoo_mxn,
           SUM(ci.amount_untaxed_sat * ci.tipo_cambio_sat) AS sat_mxn,
           SUM(CASE WHEN ci.invoice_date_resolved >= date_trunc('year', CURRENT_DATE)
                     THEN COALESCE(ci.amount_untaxed_sat * ci.tipo_cambio_sat, oi.amount_untaxed_mxn) END) AS ytd_mxn,
           SUM(CASE WHEN ci.invoice_date_resolved >= CURRENT_DATE - interval '90 days'
                     THEN COALESCE(ci.amount_untaxed_sat * ci.tipo_cambio_sat, oi.amount_untaxed_mxn) END) AS last_90d_mxn,
           SUM(CASE WHEN ci.invoice_date_resolved >= CURRENT_DATE - interval '180 days'
                      AND ci.invoice_date_resolved <  CURRENT_DATE - interval '90 days'
                     THEN COALESCE(ci.amount_untaxed_sat * ci.tipo_cambio_sat, oi.amount_untaxed_mxn) END) AS prior_90d_mxn,
           COUNT(*) AS invoices_count,
           MAX(ci.invoice_date_resolved) AS last_invoice_date,
           SUM(ci.amount_residual_mxn_resolved) AS ar_mxn,
           SUM(CASE WHEN ci.due_date_resolved < CURRENT_DATE AND ci.amount_residual_mxn_resolved > 0
                     THEN ci.amount_residual_mxn_resolved END) AS overdue_mxn,
           COUNT(*) FILTER (WHERE ci.due_date_resolved < CURRENT_DATE
                              AND ci.amount_residual_mxn_resolved > 0) AS overdue_count,
           MAX(CASE WHEN ci.due_date_resolved < CURRENT_DATE
                     THEN (CURRENT_DATE - ci.due_date_resolved) END) AS max_overdue_days
    FROM canonical_invoices ci
    LEFT JOIN odoo_invoices oi ON oi.id = ci.odoo_invoice_id
    WHERE ci.direction='issued' AND ci.receptor_canonical_company_id IS NOT NULL
      AND LOWER(COALESCE(ci.estado_sat,'vigente')) NOT IN ('cancelado','c')
      AND COALESCE(ci.state_odoo,'posted') <> 'cancel'
      AND (p_id IS NULL OR ci.receptor_canonical_company_id = p_id)
    GROUP BY 1
  )
  UPDATE canonical_companies cc
  SET lifetime_value_mxn=COALESCE(agg.ltv_mxn,0), total_invoiced_odoo_mxn=COALESCE(agg.odoo_mxn,0),
      total_invoiced_sat_mxn=COALESCE(agg.sat_mxn,0),
      revenue_ytd_mxn=COALESCE(agg.ytd_mxn,0), revenue_90d_mxn=COALESCE(agg.last_90d_mxn,0),
      revenue_prior_90d_mxn=COALESCE(agg.prior_90d_mxn,0),
      trend_pct = CASE WHEN agg.prior_90d_mxn > 0
                        THEN ROUND(100.0*(agg.last_90d_mxn-agg.prior_90d_mxn)/agg.prior_90d_mxn, 2) END,
      invoices_count=COALESCE(agg.invoices_count,0), last_invoice_date=agg.last_invoice_date,
      total_receivable_mxn=COALESCE(agg.ar_mxn,0), overdue_amount_mxn=COALESCE(agg.overdue_mxn,0),
      overdue_count=COALESCE(agg.overdue_count,0), max_days_overdue=agg.max_overdue_days,
      updated_at=now()
  FROM agg WHERE cc.id = agg.cc_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  UPDATE canonical_companies cc
  SET lifetime_value_mxn=0, total_invoiced_odoo_mxn=0, total_invoiced_sat_mxn=0,
      revenue_ytd_mxn=0, revenue_90d_mxn=0, revenue_prior_90d_mxn=0, trend_pct=NULL,
      invoices_count=0, last_invoice_date=NULL,
      total_receivable_mxn=0, overdue_amount_mxn=0, overdue_count=0, max_days_overdue=NULL,
      updated_at=now()
  WHERE (p_id IS NULL OR cc.id = p_id)
    AND cc.lifetime_value_mxn > 0
    AND NOT EXISTS (
      SELECT 1 FROM canonical_invoices ci
      WHERE ci.direction='issued' AND ci.receptor_canonical_company_id = cc.id
        AND LOWER(COALESCE(ci.estado_sat,'vigente')) NOT IN ('cancelado','c')
        AND COALESCE(ci.state_odoo,'posted') <> 'cancel'
    );

  -- CN sin IVA
  WITH cn_agg AS (
    SELECT ccn.receptor_canonical_company_id AS cc_id,
           SUM(COALESCE(si.subtotal * si.tipo_cambio, oi.amount_untaxed_mxn)) AS cn_sin_iva_mxn
    FROM canonical_credit_notes ccn
    LEFT JOIN syntage_invoices si ON si.uuid = ccn.sat_uuid
    LEFT JOIN odoo_invoices    oi ON oi.id   = ccn.odoo_invoice_id
    WHERE ccn.direction='issued' AND ccn.receptor_canonical_company_id IS NOT NULL
      AND LOWER(COALESCE(ccn.estado_sat,'vigente')) NOT IN ('cancelado','c')
      AND COALESCE(ccn.state_odoo,'posted') <> 'cancel'
      AND (p_id IS NULL OR ccn.receptor_canonical_company_id = p_id)
    GROUP BY 1
  )
  UPDATE canonical_companies cc
  SET total_credit_notes_mxn = COALESCE(cn_agg.cn_sin_iva_mxn, 0), updated_at = now()
  FROM cn_agg WHERE cc.id = cn_agg.cc_id;

  UPDATE canonical_companies cc
  SET total_credit_notes_mxn = 0, updated_at = now()
  WHERE (p_id IS NULL OR cc.id = p_id) AND cc.total_credit_notes_mxn > 0
    AND NOT EXISTS (
      SELECT 1 FROM canonical_credit_notes ccn
      WHERE ccn.direction='issued' AND ccn.receptor_canonical_company_id = cc.id
        AND LOWER(COALESCE(ccn.estado_sat,'vigente')) NOT IN ('cancelado','c')
        AND COALESCE(ccn.state_odoo,'posted') <> 'cancel'
    );

  -- AP residual con IVA
  WITH ap_agg AS (
    SELECT ci.emisor_canonical_company_id AS cc_id,
           SUM(ci.amount_residual_mxn_resolved) AS ap_mxn
    FROM canonical_invoices ci
    WHERE ci.direction='received' AND ci.emisor_canonical_company_id IS NOT NULL
      AND LOWER(COALESCE(ci.estado_sat,'vigente')) NOT IN ('cancelado','c')
      AND COALESCE(ci.state_odoo,'posted') <> 'cancel'
      AND (p_id IS NULL OR ci.emisor_canonical_company_id = p_id)
    GROUP BY 1
  )
  UPDATE canonical_companies cc
  SET total_payable_mxn = COALESCE(ap_agg.ap_mxn, 0),
      total_pending_mxn = COALESCE(cc.total_receivable_mxn, 0) + COALESCE(ap_agg.ap_mxn, 0),
      updated_at        = now()
  FROM ap_agg WHERE cc.id = ap_agg.cc_id;

  -- AR drift (2022+)
  WITH drift_base AS (
    SELECT ci.receptor_canonical_company_id AS cc_id,
           ci.has_odoo_record, ci.has_sat_record,
           (ci.amount_untaxed_sat * ci.tipo_cambio_sat) AS sat_mxn,
           oi.amount_untaxed_mxn AS odoo_mxn
    FROM canonical_invoices ci
    LEFT JOIN odoo_invoices oi ON oi.id = ci.odoo_invoice_id
    WHERE ci.direction='issued' AND ci.receptor_canonical_company_id IS NOT NULL
      AND ci.invoice_date_resolved >= '2022-01-01'
      AND LOWER(COALESCE(ci.estado_sat,'vigente')) NOT IN ('cancelado','c')
      AND COALESCE(ci.state_odoo,'posted') <> 'cancel'
      AND (p_id IS NULL OR ci.receptor_canonical_company_id = p_id)
  ),
  drift_agg AS (
    SELECT cc_id,
           COUNT(*) FILTER (WHERE has_odoo_record AND NOT has_sat_record) AS odoo_only_count,
           COUNT(*) FILTER (WHERE NOT has_odoo_record AND has_sat_record) AS sat_only_count,
           COUNT(*) FILTER (WHERE has_odoo_record AND has_sat_record
                              AND ABS(COALESCE(sat_mxn,0) - COALESCE(odoo_mxn,0)) > 1) AS matched_diff_count,
           SUM(odoo_mxn) FILTER (WHERE has_odoo_record AND NOT has_sat_record) AS odoo_only_mxn,
           SUM(sat_mxn)  FILTER (WHERE NOT has_odoo_record AND has_sat_record) AS sat_only_mxn,
           SUM(ABS(COALESCE(sat_mxn,0) - COALESCE(odoo_mxn,0)))
               FILTER (WHERE has_odoo_record AND has_sat_record) AS matched_abs_mxn
    FROM drift_base GROUP BY 1
  )
  UPDATE canonical_companies cc
  SET drift_sat_only_count   = COALESCE(d.sat_only_count, 0),
      drift_sat_only_mxn     = COALESCE(d.sat_only_mxn, 0),
      drift_odoo_only_count  = COALESCE(d.odoo_only_count, 0),
      drift_odoo_only_mxn    = COALESCE(d.odoo_only_mxn, 0),
      drift_matched_diff_count = COALESCE(d.matched_diff_count, 0),
      drift_matched_abs_mxn  = COALESCE(d.matched_abs_mxn, 0),
      drift_total_abs_mxn    = COALESCE(d.sat_only_mxn,0) + COALESCE(d.odoo_only_mxn,0) + COALESCE(d.matched_abs_mxn,0),
      -- PATCH: exclude categorized entities from needs_review
      drift_needs_review = (
        (COALESCE(d.sat_only_mxn,0) + COALESCE(d.odoo_only_mxn,0) + COALESCE(d.matched_abs_mxn,0)) > 1000
        AND NOT cc.is_foreign AND NOT cc.is_bank AND NOT cc.is_government AND NOT cc.is_payroll_entity
      ),
      drift_last_computed_at = now(),
      updated_at             = now()
  FROM drift_agg d WHERE cc.id = d.cc_id;

  -- AR drift zero-out
  UPDATE canonical_companies cc
  SET drift_sat_only_count=0, drift_sat_only_mxn=0,
      drift_odoo_only_count=0, drift_odoo_only_mxn=0,
      drift_matched_diff_count=0, drift_matched_abs_mxn=0,
      drift_total_abs_mxn=0, drift_needs_review=false,
      drift_last_computed_at=now()
  WHERE (p_id IS NULL OR cc.id = p_id)
    AND (cc.drift_total_abs_mxn > 0 OR cc.drift_needs_review IS TRUE)
    AND NOT EXISTS (
      SELECT 1 FROM canonical_invoices ci
      WHERE ci.direction='issued' AND ci.receptor_canonical_company_id = cc.id
        AND ci.invoice_date_resolved >= '2022-01-01'
        AND LOWER(COALESCE(ci.estado_sat,'vigente')) NOT IN ('cancelado','c')
        AND COALESCE(ci.state_odoo,'posted') <> 'cancel'
        AND ((ci.has_odoo_record AND NOT ci.has_sat_record)
          OR (NOT ci.has_odoo_record AND ci.has_sat_record)
          OR (ci.has_odoo_record AND ci.has_sat_record
              AND ABS(COALESCE(ci.amount_untaxed_sat * ci.tipo_cambio_sat, 0) - COALESCE((
                SELECT amount_untaxed_mxn FROM odoo_invoices WHERE id = ci.odoo_invoice_id), 0)) > 1))
    );

  -- AP drift (2025+)
  WITH drift_ap_base AS (
    SELECT ci.emisor_canonical_company_id AS cc_id,
           ci.has_odoo_record, ci.has_sat_record,
           (ci.amount_untaxed_sat * ci.tipo_cambio_sat) AS sat_mxn,
           oi.amount_untaxed_mxn AS odoo_mxn
    FROM canonical_invoices ci
    LEFT JOIN odoo_invoices oi ON oi.id = ci.odoo_invoice_id
    WHERE ci.direction='received' AND ci.emisor_canonical_company_id IS NOT NULL
      AND ci.invoice_date_resolved >= '2025-01-01'
      AND LOWER(COALESCE(ci.estado_sat,'vigente')) NOT IN ('cancelado','c')
      AND COALESCE(ci.state_odoo,'posted') <> 'cancel'
      AND (p_id IS NULL OR ci.emisor_canonical_company_id = p_id)
  ),
  drift_ap_agg AS (
    SELECT cc_id,
           COUNT(*) FILTER (WHERE has_odoo_record AND NOT has_sat_record) AS odoo_only_count,
           COUNT(*) FILTER (WHERE NOT has_odoo_record AND has_sat_record) AS sat_only_count,
           COUNT(*) FILTER (WHERE has_odoo_record AND has_sat_record
                              AND ABS(COALESCE(sat_mxn,0) - COALESCE(odoo_mxn,0)) > 1) AS matched_diff_count,
           SUM(odoo_mxn) FILTER (WHERE has_odoo_record AND NOT has_sat_record) AS odoo_only_mxn,
           SUM(sat_mxn)  FILTER (WHERE NOT has_odoo_record AND has_sat_record) AS sat_only_mxn,
           SUM(ABS(COALESCE(sat_mxn,0) - COALESCE(odoo_mxn,0)))
               FILTER (WHERE has_odoo_record AND has_sat_record) AS matched_abs_mxn
    FROM drift_ap_base GROUP BY 1
  )
  UPDATE canonical_companies cc
  SET drift_ap_sat_only_count    = COALESCE(d.sat_only_count, 0),
      drift_ap_sat_only_mxn      = COALESCE(d.sat_only_mxn, 0),
      drift_ap_odoo_only_count   = COALESCE(d.odoo_only_count, 0),
      drift_ap_odoo_only_mxn     = COALESCE(d.odoo_only_mxn, 0),
      drift_ap_matched_diff_count= COALESCE(d.matched_diff_count, 0),
      drift_ap_matched_abs_mxn   = COALESCE(d.matched_abs_mxn, 0),
      drift_ap_total_abs_mxn     = COALESCE(d.sat_only_mxn,0) + COALESCE(d.odoo_only_mxn,0) + COALESCE(d.matched_abs_mxn,0),
      -- PATCH: exclude categorized entities from needs_review
      drift_ap_needs_review = (
        (COALESCE(d.sat_only_mxn,0) + COALESCE(d.odoo_only_mxn,0) + COALESCE(d.matched_abs_mxn,0)) > 5000
        AND NOT cc.is_foreign AND NOT cc.is_bank AND NOT cc.is_government AND NOT cc.is_payroll_entity
      ),
      updated_at                 = now()
  FROM drift_ap_agg d WHERE cc.id = d.cc_id;

  UPDATE canonical_companies cc
  SET drift_ap_sat_only_count=0, drift_ap_sat_only_mxn=0,
      drift_ap_odoo_only_count=0, drift_ap_odoo_only_mxn=0,
      drift_ap_matched_diff_count=0, drift_ap_matched_abs_mxn=0,
      drift_ap_total_abs_mxn=0, drift_ap_needs_review=false
  WHERE (p_id IS NULL OR cc.id = p_id)
    AND (cc.drift_ap_total_abs_mxn > 0 OR cc.drift_ap_needs_review IS TRUE)
    AND NOT EXISTS (
      SELECT 1 FROM canonical_invoices ci
      WHERE ci.direction='received' AND ci.emisor_canonical_company_id = cc.id
        AND ci.invoice_date_resolved >= '2025-01-01'
        AND LOWER(COALESCE(ci.estado_sat,'vigente')) NOT IN ('cancelado','c')
        AND COALESCE(ci.state_odoo,'posted') <> 'cancel'
        AND ((ci.has_odoo_record AND NOT ci.has_sat_record)
          OR (NOT ci.has_odoo_record AND ci.has_sat_record)
          OR (ci.has_odoo_record AND ci.has_sat_record
              AND ABS(COALESCE(ci.amount_untaxed_sat * ci.tipo_cambio_sat, 0) - COALESCE((
                SELECT amount_untaxed_mxn FROM odoo_invoices WHERE id = ci.odoo_invoice_id), 0)) > 1))
    );

  RETURN v_updated;
END;
$fn$;

-- Trigger full refresh to apply category suppression
SELECT public.refresh_canonical_company_financials(NULL);

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('ADD COLUMN','canonical_companies',
        'Added is_foreign/is_bank/is_government/is_payroll_entity flags. Drift needs_review suppresses these categories.',
        '20260424_drift_category_flags.sql','audit-contitech-2026-04-23', true);
```

- [ ] **Step 1.3: Apply migration via Supabase MCP**

```
apply_migration name="20260424_drift_category_flags" project_id="tozqezmivpblmcubmnpi"
```

Paste the SQL contents from Step 1.2. Expected: `{"success": true}`.

- [ ] **Step 1.4: Verify category auto-populate**

```sql
SELECT
  COUNT(*) FILTER (WHERE is_foreign) AS foreign_cnt,
  COUNT(*) FILTER (WHERE is_bank) AS bank_cnt,
  COUNT(*) FILTER (WHERE is_government) AS gov_cnt,
  COUNT(*) FILTER (WHERE is_payroll_entity) AS payroll_cnt
FROM canonical_companies;
```

Expected (approximate): `foreign≥12`, `bank≥10` (the 3 flagged + others with bank-like names), `gov≥7`, `payroll≥1`.

If any count is 0, revisit the pattern list in the migration. Add missing counterparties by eyeballing `SELECT display_name FROM canonical_companies WHERE drift_ap_total_abs_mxn > 1000000 ORDER BY drift_ap_total_abs_mxn DESC;` and categorize manually with `UPDATE canonical_companies SET is_bank=true WHERE id IN (...);`

- [ ] **Step 1.5: Verify needs_review counts dropped**

```sql
SELECT COUNT(*) FILTER (WHERE drift_ap_needs_review) AS ap_flagged,
       COUNT(*) FILTER (WHERE drift_needs_review) AS ar_flagged,
       SUM(drift_ap_total_abs_mxn) FILTER (WHERE drift_ap_needs_review) AS ap_actionable_mxn,
       SUM(drift_total_abs_mxn) FILTER (WHERE drift_needs_review) AS ar_actionable_mxn
FROM canonical_companies;
```

Expected: `ap_flagged≈95` (from 117), `ap_actionable_mxn≈$32.6M` (from $235M). AR should be roughly unchanged (~52, ~$37M) since AR had fewer categorized entities.

- [ ] **Step 1.6: Verify Contitech unchanged (sanity check)**

```sql
SELECT id, display_name, is_foreign, is_bank, is_government, is_payroll_entity,
       drift_needs_review, drift_total_abs_mxn
FROM canonical_companies WHERE id=1448;
```

Expected: all four flags false, `drift_needs_review=true`, `drift_total_abs_mxn≈$2,537,170`. If any flag is `true`, the pattern matched a false positive — audit the SQL.

- [ ] **Step 1.7: Verify BANCA MIFEL suppressed**

```sql
SELECT id, display_name, is_bank, drift_ap_needs_review, drift_ap_total_abs_mxn
FROM canonical_companies WHERE id=1271;
```

Expected: `is_bank=true`, `drift_ap_needs_review=false`, `drift_ap_total_abs_mxn≈$109.5M` (amount preserved; flag suppressed).

- [ ] **Step 1.8: Commit**

```bash
cd /Users/jj/quimibond-intelligence/quimibond-intelligence
git add supabase/migrations/20260424_drift_category_flags.sql
git commit -m "feat(canonical): drift category flags suppress false-positive needs_review

Adds is_foreign, is_bank, is_government, is_payroll_entity on canonical_companies.
Auto-populated via RFC + display_name patterns. Extends refresh function to skip
these categories in drift_*_needs_review flags (amounts still tracked for audit).

AP flagged suppliers: 117 → ~95 (drops \$202M false-positive drift).
Contitech + regular suppliers unaffected."
```

---

## Task 2 — Auto-link symmetric pairs (P3)

**Purpose:** Detect `sat_only` + `odoo_only` entries on the same canonical_company with matching MXN amount (±$1) and close dates (±7 days). These are almost always the same invoice with a broken UUID match. Auto-link them via `mdm_link_invoice` so drift surfaces real issues only.

**Files:**
- Create: `quimibond-intelligence/supabase/migrations/20260424_drift_pair_autolink.sql`

**Current state (measured 2026-04-24):**
- Universe: 20 unlinked pairs in AR (2022+). AP count uncomputed but expect similar order of magnitude.
- Contitech alone has 2+2 pairs ($1.27M each) that collapse perfectly.

---

- [ ] **Step 2.1: Enumerate candidate pairs (pre-state)**

```sql
WITH pc AS (
  SELECT
    ci.direction,
    COALESCE(ci.receptor_canonical_company_id, ci.emisor_canonical_company_id) AS cc_id,
    ROUND(COALESCE(ci.amount_untaxed_sat * ci.tipo_cambio_sat,
                   (SELECT amount_untaxed_mxn FROM odoo_invoices WHERE id = ci.odoo_invoice_id), 0), 0) AS amt,
    ci.invoice_date_resolved,
    ci.has_odoo_record, ci.has_sat_record
  FROM canonical_invoices ci
  WHERE ci.invoice_date_resolved >= '2022-01-01'
    AND LOWER(COALESCE(ci.estado_sat,'vigente')) NOT IN ('cancelado','c')
    AND COALESCE(ci.state_odoo,'posted') <> 'cancel'
    AND (NOT ci.has_odoo_record OR NOT ci.has_sat_record)
)
SELECT direction,
       SUM(CASE WHEN has_sat_record AND NOT has_odoo_record THEN 1 ELSE 0 END) AS sat_only,
       SUM(CASE WHEN has_odoo_record AND NOT has_sat_record THEN 1 ELSE 0 END) AS odoo_only,
       COUNT(*) FILTER (WHERE cc_id IS NOT NULL) AS has_cc_id
FROM pc
GROUP BY direction;
```

Record the numbers. These are the "before" counts — Step 2.6 expects `sat_only` and `odoo_only` both reduce by ~(number of pairs found).

- [ ] **Step 2.2: Create migration file**

Create `quimibond-intelligence/supabase/migrations/20260424_drift_pair_autolink.sql`:

```sql
-- 2026-04-24 — Auto-link Odoo↔SAT invoice pairs where UUID join failed but amount+date+party match.
-- These are mostly CFDI UUIDs never propagated from Odoo to Supabase (or stored in different
-- casing — see memory project_sp10_6_uuid_case_fix). This function finds same-company, same-amount
-- (±$1), close-date (±7 days) candidates and links them by writing the UUID onto the Odoo row.
--
-- IMPORTANT: This is a SEED, not a deterministic matcher. Only links rows that have exactly
-- ONE candidate on each side (prevents ambiguous merges). Ambiguous candidates stay unlinked.

CREATE OR REPLACE FUNCTION public.autolink_drift_pairs(
  p_direction text DEFAULT 'issued',
  p_from_date date DEFAULT '2022-01-01',
  p_amount_tol_mxn numeric DEFAULT 1.0,
  p_days_tol integer DEFAULT 7
)
RETURNS TABLE(linked_pairs integer, failed_pairs integer) LANGUAGE plpgsql
SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_linked integer := 0;
  v_failed integer := 0;
  r record;
BEGIN
  SET LOCAL statement_timeout = '10min';

  FOR r IN
    WITH sat_rows AS (
      SELECT ci.canonical_id AS sat_canonical_id,
             ci.sat_uuid,
             CASE WHEN p_direction='issued' THEN ci.receptor_canonical_company_id
                  ELSE ci.emisor_canonical_company_id END AS cc_id,
             (ci.amount_untaxed_sat * ci.tipo_cambio_sat)::numeric AS amt_mxn,
             ci.invoice_date_resolved AS inv_date
      FROM canonical_invoices ci
      WHERE ci.direction=p_direction
        AND ci.has_sat_record AND NOT ci.has_odoo_record
        AND ci.invoice_date_resolved >= p_from_date
        AND LOWER(COALESCE(ci.estado_sat,'vigente')) NOT IN ('cancelado','c')
        AND ci.sat_uuid IS NOT NULL
    ),
    odoo_rows AS (
      SELECT ci.canonical_id AS odoo_canonical_id,
             ci.odoo_invoice_id,
             CASE WHEN p_direction='issued' THEN ci.receptor_canonical_company_id
                  ELSE ci.emisor_canonical_company_id END AS cc_id,
             oi.amount_untaxed_mxn AS amt_mxn,
             ci.invoice_date_resolved AS inv_date
      FROM canonical_invoices ci
      JOIN odoo_invoices oi ON oi.id = ci.odoo_invoice_id
      WHERE ci.direction=p_direction
        AND ci.has_odoo_record AND NOT ci.has_sat_record
        AND ci.invoice_date_resolved >= p_from_date
        AND COALESCE(ci.state_odoo,'posted') <> 'cancel'
    ),
    candidates AS (
      SELECT s.sat_canonical_id, s.sat_uuid, o.odoo_canonical_id, o.odoo_invoice_id,
             s.cc_id, s.amt_mxn AS sat_amt, o.amt_mxn AS odoo_amt,
             ABS(s.inv_date - o.inv_date) AS day_diff
      FROM sat_rows s JOIN odoo_rows o
        ON s.cc_id = o.cc_id
       AND ABS(s.amt_mxn - o.amt_mxn) <= p_amount_tol_mxn
       AND ABS(s.inv_date - o.inv_date) <= p_days_tol
    ),
    -- Only keep candidates that are unambiguous (1 SAT matches exactly 1 Odoo and vice versa)
    sat_counts AS (SELECT sat_canonical_id, COUNT(*) AS n FROM candidates GROUP BY 1),
    odoo_counts AS (SELECT odoo_canonical_id, COUNT(*) AS n FROM candidates GROUP BY 1)
    SELECT c.*
    FROM candidates c
    JOIN sat_counts sc ON sc.sat_canonical_id = c.sat_canonical_id AND sc.n = 1
    JOIN odoo_counts oc ON oc.odoo_canonical_id = c.odoo_canonical_id AND oc.n = 1
  LOOP
    BEGIN
      -- Write the SAT UUID onto the Odoo invoice; the canonical_invoices trigger will merge
      UPDATE odoo_invoices SET cfdi_uuid = r.sat_uuid WHERE id = r.odoo_invoice_id;

      -- Record the link in mdm_manual_overrides (audit trail)
      INSERT INTO mdm_manual_overrides (
        action, source_link_id, payload, is_active, created_by, created_at
      ) VALUES (
        'autolink_drift_pair',
        NULL,
        jsonb_build_object(
          'sat_canonical_id', r.sat_canonical_id,
          'odoo_canonical_id', r.odoo_canonical_id,
          'sat_uuid', r.sat_uuid,
          'odoo_invoice_id', r.odoo_invoice_id,
          'cc_id', r.cc_id,
          'sat_amt_mxn', r.sat_amt,
          'odoo_amt_mxn', r.odoo_amt,
          'day_diff', r.day_diff,
          'direction', p_direction
        ),
        true, 'autolink_drift_pairs', now()
      );

      v_linked := v_linked + 1;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
    END;
  END LOOP;

  linked_pairs := v_linked;
  failed_pairs := v_failed;
  RETURN NEXT;
END;$fn$;

COMMENT ON FUNCTION public.autolink_drift_pairs IS 'Auto-link sat_only+odoo_only candidates by writing SAT uuid on Odoo row. Safe: only links 1:1 unambiguous pairs.';

-- Run for AR (2022+) and AP (2025+)
SELECT 'ar_autolink' AS run, linked_pairs, failed_pairs
FROM public.autolink_drift_pairs('issued', '2022-01-01'::date, 1.0, 7);

SELECT 'ap_autolink' AS run, linked_pairs, failed_pairs
FROM public.autolink_drift_pairs('received', '2025-01-01'::date, 1.0, 7);

-- Refresh financials to let the new UUID matches propagate
SELECT public.refresh_canonical_company_financials(NULL);

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('SEED','odoo_invoices',
        'Autolinked unambiguous Odoo↔SAT drift pairs (1:1 by cc_id + amount±$1 + date±7d).',
        '20260424_drift_pair_autolink.sql','audit-contitech-2026-04-23', true);
```

- [ ] **Step 2.3: Apply migration**

```
apply_migration name="20260424_drift_pair_autolink" project_id="tozqezmivpblmcubmnpi"
```

Expected: `{"success": true}`. The SELECT results from the two `autolink_drift_pairs()` calls will be visible in the response if you use execute_sql — with apply_migration they run silently; verify via Step 2.4.

- [ ] **Step 2.4: Verify pair counts dropped**

```sql
SELECT action, COUNT(*) AS pairs_linked
FROM mdm_manual_overrides
WHERE action='autolink_drift_pair'
  AND created_at > now() - interval '5 minutes'
GROUP BY 1;
```

Expected: `pairs_linked` >= 15 (the 20 AR candidates from Step 2.1, minus any that fell outside the unambiguous-1:1 filter).

- [ ] **Step 2.5: Verify Contitech drift collapsed**

```sql
SELECT id, display_name,
       drift_sat_only_count, drift_sat_only_mxn::numeric,
       drift_odoo_only_count, drift_odoo_only_mxn::numeric,
       drift_total_abs_mxn::numeric
FROM canonical_companies WHERE id=1448;
```

Expected: all 4 count/mxn fields drop to 0 (or near-0). If Contitech still shows 2+2, the UUID update didn't propagate to canonical_invoices — check that `odoo_invoices.cfdi_uuid` got updated:

```sql
SELECT id, name, cfdi_uuid FROM odoo_invoices
WHERE odoo_partner_id=1265 AND cfdi_uuid IS NULL AND state='posted'
  AND invoice_date >= '2022-01-01' ORDER BY invoice_date DESC LIMIT 5;
```

If UUIDs are present but canonical_invoices still shows `has_sat_record=false`, manually invoke the reconciliation trigger or run a canonical_invoices refresh.

- [ ] **Step 2.6: Verify universe drift dropped**

```sql
SELECT 'post_autolink' AS tag,
       COUNT(*) FILTER (WHERE drift_needs_review) AS ar_flagged,
       COUNT(*) FILTER (WHERE drift_ap_needs_review) AS ap_flagged,
       SUM(drift_total_abs_mxn) FILTER (WHERE drift_needs_review) AS ar_mxn,
       SUM(drift_ap_total_abs_mxn) FILTER (WHERE drift_ap_needs_review) AS ap_mxn
FROM canonical_companies;
```

Expected: Modest reduction in counts and MXN vs Step 1.5. If no change, the unambiguous filter was too strict — re-run with wider tolerances: `SELECT * FROM autolink_drift_pairs('issued', '2022-01-01', 5.0, 14);`

- [ ] **Step 2.7: Commit**

```bash
cd /Users/jj/quimibond-intelligence/quimibond-intelligence
git add supabase/migrations/20260424_drift_pair_autolink.sql
git commit -m "feat(canonical): autolink unambiguous Odoo↔SAT drift pairs

New function autolink_drift_pairs() matches sat_only+odoo_only candidates
by same cc_id, matching MXN amount (±\$1), close date (±7d), unambiguous 1:1.
Writes SAT uuid onto odoo_invoices.cfdi_uuid so canonical reconciliation picks
up the match. Audit trail in mdm_manual_overrides with action='autolink_drift_pair'.

Initial run: AR 2022+ + AP 2025+. Rescues known pairs (e.g., Contitech 2+2)."
```

---

## Task 3 — qb19 addon UUID capture audit + fix (P5)

**Purpose:** Fix the root cause behind Odoo-only drift in 2025-2026 (77 rows / $27M AP, 18 rows / $3.1M AR). Facturas are posted in Odoo but `cfdi_uuid` never makes it to Supabase. Usually timing issue: addon pushes the move before `l10n_mx_edi` finishes timbrado.

**Files:**
- Modify: `/Users/jj/addons/quimibond_intelligence/models/sync_push.py` — function `_push_invoices`
- Create: `/Users/jj/addons/quimibond_intelligence/tests/test_cfdi_uuid_push.py`

**Pre-read required:** Read `sync_push.py::_push_invoices` and locate the UUID field. Odoo 19 renamed some l10n_mx_edi fields; the addon may still reference old names.

---

- [ ] **Step 3.1: Audit current UUID capture logic**

Read the relevant chunk:

```bash
cd /Users/jj/addons/quimibond_intelligence
grep -n "cfdi_uuid\|l10n_mx_edi" models/sync_push.py | head -40
```

Expected: a read of `move.l10n_mx_edi_cfdi_uuid` or similar. Note the exact field name used and any fallback logic.

Also check Odoo 19 reality — on the server (or local Odoo dev), inspect `account.move` fields:

```bash
# In Odoo shell (if available):
# self.env['account.move'].fields_get().keys() | grep l10n_mx
```

Alternative: read Odoo 19 addon source — the correct field in Odoo 19 is `l10n_mx_edi_cfdi_uuid` (computed from `l10n_mx_edi_document_ids`). If the addon reads `cfdi_uuid` directly, it's fine; if it tries a path that broke in Odoo 19, that's the bug.

Record findings in a comment block at the top of the test file.

- [ ] **Step 3.2: Create failing test**

Create `/Users/jj/addons/quimibond_intelligence/tests/test_cfdi_uuid_push.py`:

```python
# -*- coding: utf-8 -*-
"""
Test: _push_invoices correctly captures cfdi_uuid from l10n_mx_edi in Odoo 19.

Bug profile (2026-04-24): 77 out_invoice rows in Supabase odoo_invoices (2025+) have
NULL cfdi_uuid despite being posted + timbrado in Odoo. Root cause: either (a) addon
reads the field before l10n_mx_edi populates it, or (b) field path changed in Odoo 19.

Fix expectation: _push_invoices should read `l10n_mx_edi_cfdi_uuid` on posted moves
and skip the push (leave for next cron) if UUID is still NULL AND move is <5 minutes
old — giving l10n_mx_edi time to finish. For moves >5 min old without UUID, push
anyway and log a warning so we see them in logs.
"""
from odoo.tests import TransactionCase, tagged


@tagged('post_install', '-at_install', 'quimibond')
class TestCfdiUuidPush(TransactionCase):

    def setUp(self):
        super().setUp()
        self.Move = self.env['account.move']
        self.partner = self.env['res.partner'].create({
            'name': 'Test Partner UUID',
            'vat': 'AAA010101AAA',
        })

    def _make_posted_invoice(self, uuid=None):
        """Create a posted out_invoice. If uuid provided, stub l10n_mx_edi_cfdi_uuid."""
        move = self.Move.create({
            'move_type': 'out_invoice',
            'partner_id': self.partner.id,
            'invoice_date': '2026-04-01',
            'invoice_line_ids': [(0, 0, {
                'name': 'test',
                'quantity': 1,
                'price_unit': 100.0,
            })],
        })
        move.action_post()
        if uuid:
            # Patch the read-only computed field for test purposes
            move.write({'l10n_mx_edi_cfdi_uuid': uuid})
        return move

    def test_push_reads_uuid_from_odoo19_field(self):
        """When l10n_mx_edi_cfdi_uuid is set, _push_invoices must include it in payload."""
        move = self._make_posted_invoice(uuid='DEADBEEF-CAFE-BABE-0000-000000000001')
        payload = self.env['quimibond.sync'].sudo()._serialize_invoice(move)
        self.assertEqual(
            payload.get('cfdi_uuid'),
            'DEADBEEF-CAFE-BABE-0000-000000000001',
            msg='Expected cfdi_uuid to match l10n_mx_edi_cfdi_uuid field'
        )

    def test_push_handles_null_uuid_gracefully(self):
        """When UUID is still NULL (pre-timbrado), payload.cfdi_uuid must be None, not raise."""
        move = self._make_posted_invoice(uuid=None)
        payload = self.env['quimibond.sync'].sudo()._serialize_invoice(move)
        self.assertIsNone(payload.get('cfdi_uuid'),
                          msg='Pre-timbrado invoice should push with NULL UUID, not raise')

    def test_push_logs_warning_for_old_untimbrada(self):
        """Posted >5 min ago without UUID → should log warning (signal for ops)."""
        import logging
        move = self._make_posted_invoice(uuid=None)
        # Backdate create_date to simulate >5min-old invoice
        self.env.cr.execute(
            "UPDATE account_move SET create_date = create_date - interval '10 minutes' WHERE id=%s",
            (move.id,)
        )
        with self.assertLogs('odoo.addons.quimibond_intelligence', level='WARNING') as cm:
            self.env['quimibond.sync'].sudo()._serialize_invoice(move)
        self.assertTrue(any('cfdi_uuid' in msg for msg in cm.output),
                        msg='Expected WARNING log for old posted-no-UUID invoice')
```

- [ ] **Step 3.3: Run test; verify it fails**

On the Odoo.sh shell or local dev server:

```bash
odoo-bin --test-tags quimibond -d <db_name> --stop-after-init
```

Expected failure modes:
- `test_push_reads_uuid_from_odoo19_field` → AttributeError on `l10n_mx_edi_cfdi_uuid` **OR** `payload['cfdi_uuid']` is None (wrong field used).
- `test_push_handles_null_uuid_gracefully` → TypeError or KeyError if null not handled.
- `test_push_logs_warning_for_old_untimbrada` → no log captured (warning not emitted yet).

Record the specific failure from each test — informs the fix.

- [ ] **Step 3.4: Implement fix in `_push_invoices`**

Open `/Users/jj/addons/quimibond_intelligence/models/sync_push.py`. Locate `_push_invoices` (per CLAUDE.md around ~1500 LOC file; grep for `account.move` + `out_invoice`).

Three surgical changes (don't refactor surrounding code):

1. Define a helper `_read_cfdi_uuid(move)` at class level:

```python
import logging
_logger = logging.getLogger(__name__)

STALE_UUID_THRESHOLD_MINUTES = 5

def _read_cfdi_uuid(self, move):
    """Read CFDI UUID from Odoo 19 l10n_mx_edi. Logs if posted-but-not-timbrado
    for >5 min (operational signal).

    Returns: str or None.
    """
    uuid = move.l10n_mx_edi_cfdi_uuid or None
    if uuid:
        return uuid

    # No UUID yet. If posted >5 min ago, this is a real problem — log it.
    if move.state == 'posted' and move.create_date:
        age_minutes = (fields.Datetime.now() - move.create_date).total_seconds() / 60.0
        if age_minutes > STALE_UUID_THRESHOLD_MINUTES:
            _logger.warning(
                'account.move id=%s name=%s posted %.1f min ago without cfdi_uuid '
                '(l10n_mx_edi timbrado may have failed)',
                move.id, move.name, age_minutes
            )
    return None
```

2. In `_push_invoices`, replace the existing CFDI UUID capture call with `_read_cfdi_uuid(move)`. Find current code similar to:

```python
# OLD (example — actual may differ)
'cfdi_uuid': move.cfdi_uuid if hasattr(move, 'cfdi_uuid') else None,
```

Replace with:

```python
'cfdi_uuid': self._read_cfdi_uuid(move),
```

3. Ensure `_serialize_invoice(move)` (if exists as separate helper) is wired to use the same `_read_cfdi_uuid`. If the codebase uses inline dict construction in `_push_invoices`, factor out a `_serialize_invoice(move)` method that returns a dict — the test references it.

- [ ] **Step 3.5: Run tests; verify they pass**

```bash
odoo-bin --test-tags quimibond -d <db_name> --stop-after-init 2>&1 | tail -20
```

Expected: 3 passed, 0 failed.

If a test still fails:
- Field not found → try `move.l10n_mx_edi_document_ids[-1].uuid` as Odoo 19 alternate path.
- Warning not logged → verify logger name matches (`odoo.addons.quimibond_intelligence`).

- [ ] **Step 3.6: Commit (qb19 repo)**

```bash
cd /Users/jj/addons/quimibond_intelligence
git add models/sync_push.py tests/test_cfdi_uuid_push.py
git commit -m "fix(sync_push): robust cfdi_uuid capture for Odoo 19

- _read_cfdi_uuid() helper reads l10n_mx_edi_cfdi_uuid with NULL-safe fallback
- Warns when an invoice is posted >5 min without timbrado (operational signal)
- Adds test_cfdi_uuid_push.py covering happy path, null path, stale warning

Addresses root cause behind 77 rows in Supabase odoo_invoices (2025+) with
NULL cfdi_uuid (flagged as drift in canonical_companies.drift_ap_odoo_only_count)."
```

- [ ] **Step 3.7: Flag deployment needed (manual user step — do NOT auto-deploy)**

Per `feedback_deploys.md`, Claude never merges to `quimibond` or runs `odoo-update`. After commit, print this block for the user to run manually when ready:

```bash
# USER ACTION (not Claude):
cd /Users/jj/addons/quimibond_intelligence
git push origin main
# Then in Odoo.sh GitHub UI: merge main → quimibond
# Then in Odoo.sh shell:
#   odoo-update quimibond_intelligence && odoosh-restart http && odoosh-restart cron
```

---

## Task 4 — Drift invariants (P7)

**Purpose:** Promote drift aggregates into the `reconciliation_issues` invariant engine so they flow into `/inbox` alongside every other sync issue. Makes them visible to the team daily without a new frontend.

**Files:**
- Create: `quimibond-intelligence/supabase/migrations/20260424_drift_invariants.sql`

Current state: `audit_tolerances` has 16 active invariantes, none for drift. `silver_sp2_reconcile_hourly` + `silver_sp2_reconcile_2h` run them on cron.

---

- [ ] **Step 4.1: Read existing invariant shape**

```sql
SELECT invariant_key, check_cadence, enabled, severity_default
FROM audit_tolerances ORDER BY invariant_key LIMIT 30;
```

Record the exact column names and data types used. The new rows must match this shape.

- [ ] **Step 4.2: Create migration**

Create `quimibond-intelligence/supabase/migrations/20260424_drift_invariants.sql`:

```sql
-- 2026-04-24 — Register 3 drift invariantes so they flow into /inbox via
-- reconciliation_issues / silver_sp2_reconcile_* crons.

INSERT INTO audit_tolerances (invariant_key, check_cadence, enabled, severity_default, description)
VALUES
  ('invoice.ar_sat_only_drift', 'hourly', true, 'medium',
   'CFDI vigente emitido (AR) sin contraparte en Odoo (2022+, Contitech-style gap).'),
  ('invoice.ar_odoo_only_drift', 'hourly', true, 'medium',
   'Factura out_invoice posted sin CFDI UUID en SAT (2022+, timbrado pendiente).'),
  ('invoice.ap_sat_only_drift', '2h', true, 'medium',
   'CFDI vigente recibido (AP) sin asiento en Odoo (2025+, categorías no-supplier excluidas).')
ON CONFLICT (invariant_key) DO UPDATE
SET enabled = EXCLUDED.enabled,
    severity_default = EXCLUDED.severity_default,
    description = EXCLUDED.description;

-- Extension: add invariant-emitting block.
-- Piggybacks on _sp4_run_extra style: inserts rows into reconciliation_issues if not
-- already open for the same canonical_entity_id.
CREATE OR REPLACE FUNCTION public.sp5_drift_invariants(p_key text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql
SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_log jsonb := '[]'::jsonb;
BEGIN
  -- AR sat_only (2022+)
  IF (p_key IS NULL OR p_key='invoice.ar_sat_only_drift')
     AND (SELECT enabled FROM audit_tolerances WHERE invariant_key='invoice.ar_sat_only_drift') THEN
    INSERT INTO reconciliation_issues
      (issue_id, issue_type, canonical_entity_type, canonical_entity_id, canonical_id,
       impact_mxn, severity, detected_at, invariant_key, action_cta, description, metadata)
    SELECT gen_random_uuid(), 'invoice.ar_sat_only_drift', 'invoice',
           ci.canonical_id, ci.canonical_id,
           (ci.amount_untaxed_sat * ci.tipo_cambio_sat),
           CASE WHEN (ci.amount_untaxed_sat * ci.tipo_cambio_sat) > 100000 THEN 'high' ELSE 'medium' END,
           now(), 'invoice.ar_sat_only_drift', 'link_manual',
           format('CFDI SAT %s emitido a %s sin match en Odoo',
                  ci.sat_uuid, ci.receptor_nombre),
           jsonb_build_object('sat_uuid', ci.sat_uuid, 'receptor_rfc', ci.receptor_rfc,
                              'invoice_date', ci.invoice_date_resolved)
    FROM canonical_invoices ci
    WHERE ci.direction='issued'
      AND ci.has_sat_record AND NOT ci.has_odoo_record
      AND ci.invoice_date_resolved >= '2022-01-01'
      AND LOWER(COALESCE(ci.estado_sat,'vigente')) NOT IN ('cancelado','c')
      AND NOT EXISTS (SELECT 1 FROM reconciliation_issues ri
        WHERE ri.invariant_key='invoice.ar_sat_only_drift'
          AND ri.canonical_id=ci.canonical_id AND ri.resolved_at IS NULL);
    v_log := v_log || jsonb_build_object('k','invoice.ar_sat_only_drift','status','ok');
  END IF;

  -- AR odoo_only (2022+)
  IF (p_key IS NULL OR p_key='invoice.ar_odoo_only_drift')
     AND (SELECT enabled FROM audit_tolerances WHERE invariant_key='invoice.ar_odoo_only_drift') THEN
    INSERT INTO reconciliation_issues
      (issue_id, issue_type, canonical_entity_type, canonical_entity_id, canonical_id,
       impact_mxn, severity, detected_at, invariant_key, action_cta, description, metadata)
    SELECT gen_random_uuid(), 'invoice.ar_odoo_only_drift', 'invoice',
           ci.canonical_id, ci.canonical_id,
           COALESCE(oi.amount_untaxed_mxn, 0),
           CASE WHEN COALESCE(oi.amount_untaxed_mxn,0) > 100000 THEN 'high' ELSE 'medium' END,
           now(), 'invoice.ar_odoo_only_drift', 'review_timbrado',
           format('Odoo %s posted sin CFDI UUID (timbrado pendiente o fallido)', ci.odoo_name),
           jsonb_build_object('odoo_invoice_id', ci.odoo_invoice_id, 'odoo_name', ci.odoo_name,
                              'invoice_date', ci.invoice_date_resolved)
    FROM canonical_invoices ci
    LEFT JOIN odoo_invoices oi ON oi.id = ci.odoo_invoice_id
    WHERE ci.direction='issued'
      AND ci.has_odoo_record AND NOT ci.has_sat_record
      AND ci.invoice_date_resolved >= '2022-01-01'
      AND COALESCE(ci.state_odoo,'posted') <> 'cancel'
      AND NOT EXISTS (SELECT 1 FROM reconciliation_issues ri
        WHERE ri.invariant_key='invoice.ar_odoo_only_drift'
          AND ri.canonical_id=ci.canonical_id AND ri.resolved_at IS NULL);
    v_log := v_log || jsonb_build_object('k','invoice.ar_odoo_only_drift','status','ok');
  END IF;

  -- AP sat_only (2025+, excluir categorías)
  IF (p_key IS NULL OR p_key='invoice.ap_sat_only_drift')
     AND (SELECT enabled FROM audit_tolerances WHERE invariant_key='invoice.ap_sat_only_drift') THEN
    INSERT INTO reconciliation_issues
      (issue_id, issue_type, canonical_entity_type, canonical_entity_id, canonical_id,
       impact_mxn, severity, detected_at, invariant_key, action_cta, description, metadata)
    SELECT gen_random_uuid(), 'invoice.ap_sat_only_drift', 'invoice',
           ci.canonical_id, ci.canonical_id,
           (ci.amount_untaxed_sat * ci.tipo_cambio_sat),
           'medium', now(), 'invoice.ap_sat_only_drift', 'link_manual',
           format('CFDI SAT %s recibido de %s sin asiento Odoo',
                  ci.sat_uuid, ci.emisor_nombre),
           jsonb_build_object('sat_uuid', ci.sat_uuid, 'emisor_rfc', ci.emisor_rfc,
                              'invoice_date', ci.invoice_date_resolved)
    FROM canonical_invoices ci
    JOIN canonical_companies cc ON cc.id = ci.emisor_canonical_company_id
    WHERE ci.direction='received'
      AND ci.has_sat_record AND NOT ci.has_odoo_record
      AND ci.invoice_date_resolved >= '2025-01-01'
      AND LOWER(COALESCE(ci.estado_sat,'vigente')) NOT IN ('cancelado','c')
      AND NOT cc.is_foreign AND NOT cc.is_bank
      AND NOT cc.is_government AND NOT cc.is_payroll_entity
      AND NOT EXISTS (SELECT 1 FROM reconciliation_issues ri
        WHERE ri.invariant_key='invoice.ap_sat_only_drift'
          AND ri.canonical_id=ci.canonical_id AND ri.resolved_at IS NULL);
    v_log := v_log || jsonb_build_object('k','invoice.ap_sat_only_drift','status','ok');
  END IF;

  RETURN jsonb_build_object('drift_invariants', v_log);
END;
$fn$;

-- Wire into existing run_reconciliation: extend to call sp5_drift_invariants when full-run.
-- The existing run_reconciliation composes sp2 + sp4 results. We add sp5-drift.
CREATE OR REPLACE FUNCTION public.run_reconciliation(p_key text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE v_sp2 jsonb; v_sp4 jsonb; v_sp5d jsonb;
BEGIN
  SELECT json_agg(r) INTO v_sp2
  FROM run_reconciliation_sp2(p_key) r;
  v_sp4 := _sp4_run_extra(p_key);
  v_sp5d := public.sp5_drift_invariants(p_key);
  RETURN jsonb_build_object('sp2', v_sp2, 'sp4', v_sp4, 'sp5_drift', v_sp5d);
END;
$fn$;

-- Seed immediate run so issues appear without waiting for cron
SELECT public.sp5_drift_invariants(NULL);

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('ADD FUNCTION','reconciliation_issues',
        '3 drift invariantes (AR sat_only, AR odoo_only, AP sat_only) wired into run_reconciliation.',
        '20260424_drift_invariants.sql','audit-contitech-2026-04-23', true);
```

- [ ] **Step 4.3: Apply migration**

```
apply_migration name="20260424_drift_invariants" project_id="tozqezmivpblmcubmnpi"
```

Expected: `{"success": true}`.

- [ ] **Step 4.4: Verify issues appeared**

```sql
SELECT invariant_key, severity, COUNT(*) AS open_issues,
       SUM(impact_mxn)::numeric AS total_impact_mxn
FROM reconciliation_issues
WHERE invariant_key LIKE 'invoice.%_drift'
  AND resolved_at IS NULL
GROUP BY 1,2 ORDER BY 1,2;
```

Expected (post Task 1+2 suppression and pair auto-link):
- `invoice.ar_sat_only_drift`: ~100 issues (from 122 sat_only minus autolinked), ~$25-33M impact
- `invoice.ar_odoo_only_drift`: ~30-40 issues, ~$3-4M impact
- `invoice.ap_sat_only_drift`: ~300-400 issues (AP excluded categorías), ~$5-10M impact

If counts are zero, the seed run hit a filter mismatch — inspect logs:

```sql
SELECT * FROM schema_changes
WHERE triggered_by='audit-contitech-2026-04-23' ORDER BY executed_at DESC LIMIT 5;
```

- [ ] **Step 4.5: Verify hourly cron picks up new invariantes on next run**

```sql
SELECT jobid, jobname, schedule, last_run_status, last_start_time
FROM cron.job_run_details
JOIN cron.job USING (jobid)
WHERE jobname LIKE 'silver_sp2_reconcile%'
ORDER BY last_start_time DESC LIMIT 3;
```

Expected: next run at `:05` (hourly) will invoke `run_reconciliation_sp2` → which doesn't call our new fn directly. The new invariantes run via `run_reconciliation()` (called nightly). For hourly coverage, either (a) extend `run_reconciliation_sp2` to include drift, or (b) accept nightly update.

Decision: drift changes slowly — nightly is fine. If user wants hourly, add `PERFORM sp5_drift_invariants(NULL);` to the hourly cron body.

- [ ] **Step 4.6: Commit**

```bash
cd /Users/jj/quimibond-intelligence/quimibond-intelligence
git add supabase/migrations/20260424_drift_invariants.sql
git commit -m "feat(invariantes): Odoo↔SAT drift as reconciliation_issues

3 new invariants registered:
- invoice.ar_sat_only_drift (AR 2022+ hourly)
- invoice.ar_odoo_only_drift (AR 2022+ hourly)
- invoice.ap_sat_only_drift (AP 2025+ 2h, excluding foreign/bank/gov/payroll)

sp5_drift_invariants() wired into run_reconciliation() so nightly cron
promotes drift to reconciliation_issues → /inbox feed."
```

---

## Task 5 — Vercel redeploy (deployment gate)

**Purpose:** Invalidate `unstable_cache` tags (`finance`, `companies`) so the UI shows the new sin-IVA + drift values.

- [ ] **Step 5.1: User runs Vercel redeploy**

Print for the user (Claude doesn't auto-deploy):

```bash
cd /Users/jj/quimibond-intelligence/quimibond-intelligence
vercel --prod
```

Wait for "Production: https://..." success message.

- [ ] **Step 5.2: Smoke-test frontend**

Open `/empresas/1448` (Contitech) in browser. Expected:
- LTV hero shows ≈ $492M (not $620M)
- Credit notes tile shows ≈ $13.8M (not $4.2M)
- No console errors

---

## Post-Plan Verification

- [ ] **Global drift dashboard sanity check**

```sql
SELECT
  SUM(lifetime_value_mxn) AS universe_ltv,
  COUNT(*) FILTER (WHERE drift_needs_review) AS ar_flagged,
  COUNT(*) FILTER (WHERE drift_ap_needs_review) AS ap_flagged_actionable,
  SUM(drift_total_abs_mxn) FILTER (WHERE drift_needs_review) AS ar_actionable,
  SUM(drift_ap_total_abs_mxn) FILTER (WHERE drift_ap_needs_review) AS ap_actionable,
  (SELECT COUNT(*) FROM reconciliation_issues
    WHERE invariant_key LIKE 'invoice.%_drift' AND resolved_at IS NULL) AS open_drift_issues
FROM canonical_companies;
```

Expected (after all 4 tasks):
- `universe_ltv` ≈ $1.67B (unchanged from session close)
- `ar_flagged` ≤ 52 (reduced by autolinks)
- `ap_flagged_actionable` ≤ 95 (Task 1 suppression)
- `ar_actionable` + `ap_actionable` ≤ $70M combined
- `open_drift_issues` > 0 and aligns with flagged companies

- [ ] **Cron health check**

```sql
SELECT jobname, active, schedule
FROM cron.job
WHERE jobname IN (
  'refresh_canonical_company_financials_hourly',
  'silver_sp2_reconcile_hourly',
  'silver_sp2_reconcile_2h',
  'silver_sp2_refresh_canonical_nightly'
)
ORDER BY jobname;
```

Expected: all 4 active. `refresh_canonical_company_financials_hourly` at `45 * * * *`.

---

## Rollback notes

All 4 migrations are safely reversible:

- **Task 1**: `ALTER TABLE canonical_companies DROP COLUMN IF EXISTS is_foreign, ...;` Revert refresh function to prior `CREATE OR REPLACE`.
- **Task 2**: `DELETE FROM mdm_manual_overrides WHERE action='autolink_drift_pair' AND created_at > '2026-04-24';` Then `UPDATE odoo_invoices SET cfdi_uuid=NULL WHERE id IN (SELECT (payload->>'odoo_invoice_id')::bigint FROM mdm_manual_overrides WHERE action='autolink_drift_pair' AND created_at > '2026-04-24');` Refresh canonical.
- **Task 3 (addon)**: `git revert <commit-sha>` in `/Users/jj/addons/quimibond_intelligence/`.
- **Task 4**: `UPDATE audit_tolerances SET enabled=false WHERE invariant_key LIKE 'invoice.%_drift';` `DELETE FROM reconciliation_issues WHERE invariant_key LIKE 'invoice.%_drift';`

---

## Out of scope (by design)

- **P2 (banking decision)** and **P4 (ENTRETELAS BRINCO manual reconciliation)** — require human accounting input, not code.
- **P6 (frontend drift panel)** — belongs in the SP6 frontend session (per memory `feedback_sp6_frontend_session.md`, do not touch from this session).
- **Complete bank/gov whitelist exhaustiveness** — Task 1 covers the top offenders; rarer entities will surface via drift flags and can be categorized ad-hoc.
