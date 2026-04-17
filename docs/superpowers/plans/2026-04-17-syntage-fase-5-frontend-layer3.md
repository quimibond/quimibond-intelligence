# Syntage Fase 5 · Frontend Layer 3 Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrar 19 files TypeScript del frontend Next.js de Layer 2 (odoo_invoices, cfdi_documents) a Layer 3 (invoices_unified, payments_unified, email_cfdi_links), respetando autoridad por campo y exponiendo reconciliation_issues en UI contextual.

**Architecture:** 6 PRs incrementales con feature flag `USE_UNIFIED_LAYER` + parity tests. PR 0 pre-reqs (MV enrichment + reconciliation_issues fix + refresh trigger queue). PR 1-3 frontend migration. PR 4 data migration cfdi_documents. PR 5 shutdown parse-cfdi. PR 6 cleanup (día 30).

**Tech Stack:** PostgreSQL 15 (Supabase), Next.js 15 App Router, React 19 RSC, TypeScript, vitest, TailwindCSS/shadcn, pg_cron.

**Spec:** `docs/superpowers/specs/2026-04-17-syntage-fase-5-frontend-layer3-design.md`

---

## File Structure

### Create

- `supabase/migrations/20260418_syntage_layer3_008_email_cfdi_links.sql` — table + MV rebuild with JOIN
- `supabase/migrations/20260418_syntage_layer3_009_company_id_fix.sql` — reconciliation_issues.company_id populate + backfill
- `supabase/migrations/20260418_syntage_layer3_010_refresh_queue.sql` — on-demand refresh queue + triggers + debounced cron
- `src/lib/queries/unified.ts` — Layer 3 query helpers (new module)
- `src/__tests__/layer3/unified-helpers.test.ts` — unit tests for unified.ts
- `src/__tests__/layer3/parity-fase5.test.ts` — numeric parity vs legacy
- `src/components/shared/v2/sat-badge.tsx` — UUID/estado_sat badge
- `src/components/shared/v2/refresh-staleness-badge.tsx` — "hace X min" badge with manual refresh button
- `src/components/system/CompanyReconciliationTab.tsx` — new tab for /companies/[id]

### Modify

- `src/lib/queries/finance.ts` — feature-flagged unified dispatch for getCashFlowAging, getCeiTimeline, getTopDebtors, getCfoDashboard, getWorkingCapital, getCashFlowRunway
- `src/lib/queries/companies.ts` — getCompanyInvoices + getCompanyPayments via unified
- `src/lib/queries/invoice-detail.ts` — email_cfdi_links instead of cfdi_documents
- `src/lib/queries/purchases.ts` — getSupplierInvoices via unified, partner_blacklist_69b tag
- `src/app/cobranza/page.tsx` — SAT column + staleness badge
- `src/app/finanzas/page.tsx` — validated CFDIs donut
- `src/app/companies/[id]/page.tsx` — Reconciliación Fiscal tab
- `src/app/compras/page.tsx` — 69-B tag on suppliers
- `src/app/api/pipeline/parse-cfdi/route.ts` — 410 Gone
- `vercel.json` — remove parse-cfdi cron

### Delete (PR 5 rename + PR 6 drop)

- `cfdi_documents` table → rename to `cfdi_documents_deprecated_20260420` → drop in day 30

---

## Notes for the Engineer

- **Layer 3 state:** `invoices_unified` (71,898+ rows, growing to ~130k), `payments_unified` (18,772), `reconciliation_issues` (27,640 open). All live in prod.
- **Feature flag:** Default `USE_UNIFIED_LAYER !== 'false'` means unified is ON by default. Set to `"false"` in Vercel env to rollback.
- **Parity tests:** Use env `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_KEY`. Skip if missing (already gated pattern from Fase 3 integration tests).
- **Supabase client:** `getServiceClient()` from `@/lib/supabase-server` — same pattern as existing queries.
- **Commit frequency:** Each task ends with commit. PRs group thematically but internally use feature commits.
- **DO NOT stage:** `.claude-flow/`, `src/app/api/syntage/pull-sync/*` changes (parallel work). Check `git status --short` before each commit.
- **Working-tree watchdog:** `git diff --cached --stat` must show only expected files before commit.

---

# PR 0 · Layer 3 Pre-requisites

## Task 1 — `email_cfdi_links` table + MV rebuild with JOIN

**Files:**
- Create: `supabase/migrations/20260418_syntage_layer3_008_email_cfdi_links.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Fase 5 · 008 email_cfdi_links table + invoices_unified MV rebuild
-- Crea tabla vacía (se popula en PR 4) + recrea MV con LEFT JOIN para poblar email_id_origen.

CREATE TABLE IF NOT EXISTS public.email_cfdi_links (
  id           bigserial PRIMARY KEY,
  email_id     bigint,
  gmail_message_id text,
  account      text,
  uuid         text NOT NULL,
  linked_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_cfdi_links_uuid_idx  ON public.email_cfdi_links(uuid);
CREATE INDEX IF NOT EXISTS email_cfdi_links_email_idx ON public.email_cfdi_links(email_id);

ALTER TABLE public.email_cfdi_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_cfdi_links FROM anon, authenticated;
GRANT ALL ON public.email_cfdi_links TO service_role;

COMMENT ON TABLE public.email_cfdi_links IS 'Fase 5 · Puente email↔CFDI (schema reducido). Reemplaza cfdi_documents. Populated en PR 4.';

-- Recreate invoices_unified con LEFT JOIN a email_cfdi_links para populate email_id_origen
-- Copia exacta del MV actual + una nueva LEFT JOIN + columna cambia de NULL::bigint a el.email_id
DROP MATERIALIZED VIEW IF EXISTS public.invoices_unified CASCADE;

CREATE MATERIALIZED VIEW public.invoices_unified AS
WITH
  uuid_matches AS (
    SELECT DISTINCT ON (s.uuid)
      s.uuid AS uuid_sat, o.id AS odoo_invoice_id,
      COUNT(*) OVER (PARTITION BY s.uuid) AS n_odoo_candidates
    FROM public.syntage_invoices s
    JOIN public.odoo_invoices o
      ON o.cfdi_uuid = s.uuid AND o.odoo_company_id = s.odoo_company_id
    WHERE s.tipo_comprobante IN ('I','E')
      AND o.move_type IN ('out_invoice','out_refund','in_invoice','in_refund')
    ORDER BY s.uuid, o.invoice_date DESC NULLS LAST, o.id DESC
  ),
  composite_candidates AS (
    SELECT
      s.uuid AS uuid_sat, o.id AS odoo_invoice_id,
      COUNT(*) OVER (PARTITION BY s.uuid) AS n_candidates,
      ROW_NUMBER() OVER (PARTITION BY s.uuid ORDER BY o.invoice_date) AS rn
    FROM public.syntage_invoices s
    JOIN public.companies c ON lower(c.rfc) = lower(COALESCE(s.emisor_rfc, s.receptor_rfc))
    JOIN public.odoo_invoices o
      ON o.company_id = c.id
     AND abs(s.total - o.amount_total) < 0.01
     AND date(s.fecha_emision) = date(o.invoice_date)
     AND (COALESCE(s.serie,'') || COALESCE(s.folio,'') ILIKE '%' || o.ref || '%'
       OR o.ref ILIKE '%' || COALESCE(s.folio,'') || '%')
     AND o.odoo_company_id = s.odoo_company_id
     AND o.move_type IN ('out_invoice','out_refund','in_invoice','in_refund')
    WHERE s.tipo_comprobante IN ('I','E')
      AND NOT EXISTS (SELECT 1 FROM uuid_matches u WHERE u.uuid_sat = s.uuid)
      AND o.ref IS NOT NULL AND o.ref <> ''
  ),
  composite_matches AS (
    SELECT uuid_sat, odoo_invoice_id, n_candidates
    FROM composite_candidates WHERE rn = 1
  ),
  paired AS (
    SELECT uuid_sat, odoo_invoice_id, 'match_uuid'::text AS match_status,
      CASE WHEN n_odoo_candidates > 1 THEN 'medium' ELSE 'high' END AS match_quality
    FROM uuid_matches
    UNION ALL
    SELECT uuid_sat, odoo_invoice_id,
      CASE WHEN n_candidates > 1 THEN 'ambiguous' ELSE 'match_composite' END,
      CASE WHEN n_candidates > 1 THEN 'low' ELSE 'medium' END
    FROM composite_matches
  )
SELECT
  COALESCE(s.uuid, 'odoo:' || o.id::text) AS canonical_id,
  s.uuid AS uuid_sat, o.id AS odoo_invoice_id,
  COALESCE(p.match_status,
    CASE WHEN s.uuid IS NOT NULL AND o.id IS NULL THEN 'syntage_only'
         WHEN s.uuid IS NULL AND o.id IS NOT NULL THEN 'odoo_only' END) AS match_status,
  COALESCE(p.match_quality, 'n/a') AS match_quality,
  COALESCE(s.direction, CASE WHEN o.move_type LIKE 'out_%' THEN 'issued' ELSE 'received' END) AS direction,
  s.estado_sat, s.fecha_cancelacion, s.fecha_timbrado, s.tipo_comprobante,
  s.metodo_pago, s.forma_pago, s.uso_cfdi,
  s.emisor_rfc, s.emisor_nombre, s.receptor_rfc, s.receptor_nombre,
  s.emisor_blacklist_status, s.receptor_blacklist_status,
  s.total AS total_fiscal, s.subtotal AS subtotal_fiscal, s.descuento AS descuento_fiscal,
  s.impuestos_trasladados, s.impuestos_retenidos,
  s.moneda AS moneda_fiscal, s.tipo_cambio AS tipo_cambio_fiscal, s.total_mxn AS total_mxn_fiscal,
  COALESCE(s.odoo_company_id, o.odoo_company_id) AS odoo_company_id,
  o.company_id, c.name AS partner_name, o.odoo_partner_id,
  o.name AS odoo_ref, o.ref AS odoo_external_ref, o.move_type AS odoo_move_type,
  o.state AS odoo_state, o.payment_state,
  o.amount_total AS odoo_amount_total, o.amount_residual,
  o.invoice_date, o.due_date, o.days_overdue, o.currency AS odoo_currency,
  CASE
    WHEN s.uuid IS NULL OR o.id IS NULL THEN NULL
    WHEN s.estado_sat = 'cancelado' AND o.state = 'posted' THEN 'cancelled_but_posted'
    WHEN abs(s.total - o.amount_total) > 0.01 THEN 'amount_mismatch'
    ELSE 'consistent'
  END AS fiscal_operational_consistency,
  (s.total - o.amount_total) AS amount_diff,
  el.email_id AS email_id_origen,
  now() AS refreshed_at
FROM paired p
FULL OUTER JOIN public.syntage_invoices s ON s.uuid = p.uuid_sat
FULL OUTER JOIN public.odoo_invoices    o ON o.id   = p.odoo_invoice_id
LEFT JOIN public.companies c ON c.id = o.company_id
LEFT JOIN LATERAL (
  SELECT email_id FROM public.email_cfdi_links WHERE uuid = s.uuid LIMIT 1
) el ON true
WHERE
  (s.tipo_comprobante IN ('I','E') OR s.tipo_comprobante IS NULL)
  AND (o.move_type IN ('out_invoice','out_refund','in_invoice','in_refund') OR o.move_type IS NULL)
  AND (s.uuid IS NOT NULL OR o.id IS NOT NULL);

CREATE UNIQUE INDEX invoices_unified_canonical_id_idx ON public.invoices_unified (canonical_id);
CREATE INDEX invoices_unified_company_date_idx  ON public.invoices_unified (odoo_company_id, fecha_timbrado DESC NULLS LAST);
CREATE INDEX invoices_unified_match_status_idx  ON public.invoices_unified (match_status);
CREATE INDEX invoices_unified_consistency_idx   ON public.invoices_unified (fiscal_operational_consistency) WHERE fiscal_operational_consistency IS NOT NULL;
CREATE INDEX invoices_unified_cancelled_idx     ON public.invoices_unified (estado_sat) WHERE estado_sat = 'cancelado';
CREATE INDEX invoices_unified_direction_idx     ON public.invoices_unified (direction, fecha_timbrado DESC NULLS LAST);
CREATE INDEX invoices_unified_email_id_idx      ON public.invoices_unified (email_id_origen) WHERE email_id_origen IS NOT NULL;

REVOKE ALL ON public.invoices_unified FROM anon, authenticated;
GRANT SELECT ON public.invoices_unified TO service_role;

COMMENT ON MATERIALIZED VIEW public.invoices_unified IS 'Fase 3 · Layer 3 canónico: 1 row por CFDI (I/E). Fase 5 · agrega email_id_origen via LEFT JOIN email_cfdi_links.';
```

- [ ] **Step 2: Apply migration via MCP**

Use `mcp__claude_ai_Supabase__apply_migration`:
- project_id: `tozqezmivpblmcubmnpi`
- name: `syntage_layer3_008_email_cfdi_links`
- query: contents above

- [ ] **Step 3: Verify table + MV**

```sql
-- email_cfdi_links exists and empty
SELECT count(*) FROM public.email_cfdi_links;  -- Expected: 0

-- MV has new email_id_origen column and rows preserved
SELECT count(*) FROM public.invoices_unified;  -- Expected: similar to pre-migration count
SELECT count(*) FILTER (WHERE email_id_origen IS NOT NULL) AS with_email FROM public.invoices_unified;  -- Expected: 0 (no data yet)
SELECT column_name FROM information_schema.columns
WHERE table_name='invoices_unified' AND column_name IN ('email_id_origen');  -- Expected: 1 row
```

- [ ] **Step 4: Commit**

```bash
cd /Users/jj/quimibond-intelligence/quimibond-intelligence/
git add supabase/migrations/20260418_syntage_layer3_008_email_cfdi_links.sql
git diff --cached --stat  # exactly 1 file
git commit -m "$(cat <<'EOF'
feat(syntage): Fase 5 PR 0 · email_cfdi_links table + MV rebuild

Tabla creada vacía (se popula en PR 4). invoices_unified MV recreada con
LEFT JOIN lateral a email_cfdi_links para poblar email_id_origen cuando
exista el link. MV shape agrega email_id_origen column (bigint, nullable).

Co-Authored-By: claude-flow <ruv@ruv.net>
EOF
)"
```

---

## Task 2 — `reconciliation_issues.company_id` fix + backfill

**Files:**
- Create: `supabase/migrations/20260418_syntage_layer3_009_company_id_fix.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Fase 5 · 009 reconciliation_issues.company_id populate + backfill
-- Fix del bug Fase 3 donde sat_only_* dejaban company_id NULL.

-- 1. Backfill: populate company_id en issues ya abiertos donde rfc existe en companies
UPDATE public.reconciliation_issues ri
SET company_id = c.id
FROM public.syntage_invoices s
JOIN public.companies c ON lower(c.rfc) = lower(
  CASE WHEN ri.issue_type='sat_only_cfdi_issued' THEN s.receptor_rfc
       WHEN ri.issue_type='sat_only_cfdi_received' THEN s.emisor_rfc END
)
WHERE ri.company_id IS NULL
  AND ri.uuid_sat = s.uuid
  AND ri.issue_type IN ('sat_only_cfdi_issued','sat_only_cfdi_received');

-- 2. CREATE OR REPLACE refresh_invoices_unified con company_id lookup en INSERT de sat_only_*
-- (copia completa de la función existente con modificación de 2 INSERT blocks)

CREATE OR REPLACE FUNCTION public.refresh_invoices_unified()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '60s'
SET lock_timeout = '30s'
AS $$
DECLARE
  t_start    timestamptz := clock_timestamp();
  v_opened   integer := 0;
  v_resolved integer := 0;
  v_tmp      integer;
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.invoices_unified;

  -- AUTO-RESOLVE (6 tipos) — sin cambios
  WITH r AS (UPDATE public.reconciliation_issues ri SET resolved_at=now(), resolution='auto_odoo_updated'
    WHERE ri.resolved_at IS NULL AND ri.issue_type='cancelled_but_posted'
      AND NOT EXISTS (SELECT 1 FROM public.invoices_unified iu WHERE iu.canonical_id=ri.canonical_id AND iu.fiscal_operational_consistency='cancelled_but_posted')
    RETURNING 1) SELECT count(*) INTO v_tmp FROM r; v_resolved := v_resolved + v_tmp;

  WITH r AS (UPDATE public.reconciliation_issues ri SET resolved_at=now(), resolution='auto_odoo_updated'
    WHERE ri.resolved_at IS NULL AND ri.issue_type='posted_but_sat_uncertified'
      AND NOT EXISTS (SELECT 1 FROM public.invoices_unified iu WHERE iu.canonical_id=ri.canonical_id AND iu.match_status='odoo_only' AND iu.odoo_state='posted' AND iu.uuid_sat IS NULL)
    RETURNING 1) SELECT count(*) INTO v_tmp FROM r; v_resolved := v_resolved + v_tmp;

  WITH r AS (UPDATE public.reconciliation_issues ri SET resolved_at=now(), resolution='auto_odoo_updated'
    WHERE ri.resolved_at IS NULL AND ri.issue_type='sat_only_cfdi_received'
      AND NOT EXISTS (SELECT 1 FROM public.invoices_unified iu WHERE iu.canonical_id=ri.canonical_id AND iu.match_status='syntage_only' AND iu.direction='received')
    RETURNING 1) SELECT count(*) INTO v_tmp FROM r; v_resolved := v_resolved + v_tmp;

  WITH r AS (UPDATE public.reconciliation_issues ri SET resolved_at=now(), resolution='auto_odoo_updated'
    WHERE ri.resolved_at IS NULL AND ri.issue_type='sat_only_cfdi_issued'
      AND NOT EXISTS (SELECT 1 FROM public.invoices_unified iu WHERE iu.canonical_id=ri.canonical_id AND iu.match_status='syntage_only' AND iu.direction='issued')
    RETURNING 1) SELECT count(*) INTO v_tmp FROM r; v_resolved := v_resolved + v_tmp;

  WITH r AS (UPDATE public.reconciliation_issues ri SET resolved_at=now(), resolution='auto_odoo_updated'
    WHERE ri.resolved_at IS NULL AND ri.issue_type='amount_mismatch'
      AND NOT EXISTS (SELECT 1 FROM public.invoices_unified iu WHERE iu.canonical_id=ri.canonical_id AND iu.fiscal_operational_consistency='amount_mismatch')
    RETURNING 1) SELECT count(*) INTO v_tmp FROM r; v_resolved := v_resolved + v_tmp;

  WITH r AS (UPDATE public.reconciliation_issues ri SET resolved_at=now(), resolution='auto_syntage_updated'
    WHERE ri.resolved_at IS NULL AND ri.issue_type='partner_blacklist_69b'
      AND NOT EXISTS (SELECT 1 FROM public.invoices_unified iu WHERE iu.canonical_id=ri.canonical_id
        AND (iu.emisor_blacklist_status IN ('presumed','definitive') OR iu.receptor_blacklist_status IN ('presumed','definitive')))
    RETURNING 1) SELECT count(*) INTO v_tmp FROM r; v_resolved := v_resolved + v_tmp;

  -- INSERT: cancelled_but_posted, posted_but_sat_uncertified, amount_mismatch, partner_blacklist_69b — sin cambios
  WITH ins AS (INSERT INTO public.reconciliation_issues (issue_type, canonical_id, uuid_sat, odoo_invoice_id, odoo_company_id, company_id, description, severity, metadata)
    SELECT 'cancelled_but_posted', iu.canonical_id, iu.uuid_sat, iu.odoo_invoice_id, iu.odoo_company_id, iu.company_id,
      format('Syntage marca UUID %s como cancelado, Odoo sigue posted en %s', iu.uuid_sat, iu.odoo_ref), 'high',
      jsonb_build_object('counterparty_rfc', COALESCE(iu.emisor_rfc, iu.receptor_rfc), 'detected_via', 'uuid', 'fecha_cancelacion', iu.fecha_cancelacion)
    FROM public.invoices_unified iu WHERE iu.fiscal_operational_consistency = 'cancelled_but_posted'
    ON CONFLICT (issue_type, canonical_id) WHERE resolved_at IS NULL DO NOTHING RETURNING 1
  ) SELECT count(*) INTO v_tmp FROM ins; v_opened := v_opened + v_tmp;

  WITH ins AS (INSERT INTO public.reconciliation_issues (issue_type, canonical_id, uuid_sat, odoo_invoice_id, odoo_company_id, company_id, description, severity, metadata)
    SELECT 'posted_but_sat_uncertified', iu.canonical_id, NULL, iu.odoo_invoice_id, iu.odoo_company_id, iu.company_id,
      format('Odoo %s posted sin UUID SAT ni match composite', iu.odoo_ref), 'low',
      jsonb_build_object('counterparty_rfc', NULL, 'detected_via', 'composite', 'invoice_date', iu.invoice_date)
    FROM public.invoices_unified iu WHERE iu.match_status='odoo_only' AND iu.odoo_state='posted' AND iu.uuid_sat IS NULL
      AND iu.invoice_date > (now() - interval '30 days')::date
    ON CONFLICT (issue_type, canonical_id) WHERE resolved_at IS NULL DO NOTHING RETURNING 1
  ) SELECT count(*) INTO v_tmp FROM ins; v_opened := v_opened + v_tmp;

  -- sat_only_cfdi_received · FIX: populate company_id via emisor_rfc lookup
  WITH ins AS (INSERT INTO public.reconciliation_issues (issue_type, canonical_id, uuid_sat, odoo_invoice_id, odoo_company_id, company_id, description, severity, metadata)
    SELECT 'sat_only_cfdi_received', iu.canonical_id, iu.uuid_sat, NULL, iu.odoo_company_id,
      (SELECT id FROM public.companies WHERE lower(rfc)=lower(iu.emisor_rfc) LIMIT 1) AS company_id,  -- NUEVO
      format('CFDI recibido %s de %s no existe en Odoo (total fiscal $%s)', iu.uuid_sat, iu.emisor_nombre, iu.total_fiscal), 'medium',
      jsonb_build_object('counterparty_rfc', iu.emisor_rfc, 'detected_via', 'uuid', 'total_fiscal', iu.total_fiscal, 'fecha_timbrado', iu.fecha_timbrado)
    FROM public.invoices_unified iu
    WHERE iu.match_status='syntage_only' AND iu.direction='received'
      AND iu.fecha_timbrado >= '2021-01-01'
    ON CONFLICT (issue_type, canonical_id) WHERE resolved_at IS NULL DO NOTHING RETURNING 1
  ) SELECT count(*) INTO v_tmp FROM ins; v_opened := v_opened + v_tmp;

  -- sat_only_cfdi_issued · FIX: populate company_id via receptor_rfc lookup
  WITH ins AS (INSERT INTO public.reconciliation_issues (issue_type, canonical_id, uuid_sat, odoo_invoice_id, odoo_company_id, company_id, description, severity, metadata)
    SELECT 'sat_only_cfdi_issued', iu.canonical_id, iu.uuid_sat, NULL, iu.odoo_company_id,
      (SELECT id FROM public.companies WHERE lower(rfc)=lower(iu.receptor_rfc) LIMIT 1) AS company_id,  -- NUEVO
      format('CFDI emitido %s a %s no existe en Odoo (total fiscal $%s) — POSIBLE FRAUDE', iu.uuid_sat, iu.receptor_nombre, iu.total_fiscal), 'critical',
      jsonb_build_object('counterparty_rfc', iu.receptor_rfc, 'detected_via', 'uuid', 'total_fiscal', iu.total_fiscal, 'fecha_timbrado', iu.fecha_timbrado)
    FROM public.invoices_unified iu
    WHERE iu.match_status='syntage_only' AND iu.direction='issued'
      AND iu.fecha_timbrado >= '2021-01-01'
    ON CONFLICT (issue_type, canonical_id) WHERE resolved_at IS NULL DO NOTHING RETURNING 1
  ) SELECT count(*) INTO v_tmp FROM ins; v_opened := v_opened + v_tmp;

  WITH ins AS (INSERT INTO public.reconciliation_issues (issue_type, canonical_id, uuid_sat, odoo_invoice_id, odoo_company_id, company_id, description, severity, metadata)
    SELECT 'amount_mismatch', iu.canonical_id, iu.uuid_sat, iu.odoo_invoice_id, iu.odoo_company_id, iu.company_id,
      format('UUID %s: total fiscal $%s vs Odoo $%s (diff $%s)', iu.uuid_sat, iu.total_fiscal, iu.odoo_amount_total, iu.amount_diff), 'medium',
      jsonb_build_object('counterparty_rfc', COALESCE(iu.emisor_rfc, iu.receptor_rfc), 'detected_via', 'uuid', 'amount_diff', iu.amount_diff,
        'severity_reason', CASE WHEN abs(iu.amount_diff) > 1000 THEN 'diff >$1000' ELSE 'diff minor' END)
    FROM public.invoices_unified iu WHERE iu.fiscal_operational_consistency='amount_mismatch'
    ON CONFLICT (issue_type, canonical_id) WHERE resolved_at IS NULL DO NOTHING RETURNING 1
  ) SELECT count(*) INTO v_tmp FROM ins; v_opened := v_opened + v_tmp;

  WITH ins AS (INSERT INTO public.reconciliation_issues (issue_type, canonical_id, uuid_sat, odoo_invoice_id, odoo_company_id, company_id, description, severity, metadata)
    SELECT DISTINCT ON (iu.company_id, iu.odoo_company_id) 'partner_blacklist_69b', 'company:' || iu.company_id::text,
      NULL, NULL, iu.odoo_company_id, iu.company_id,
      format('Contraparte %s tiene status 69-B: %s', iu.partner_name, COALESCE(NULLIF(iu.emisor_blacklist_status, ''), iu.receptor_blacklist_status)), 'medium',
      jsonb_build_object('counterparty_rfc', COALESCE(iu.emisor_rfc, iu.receptor_rfc),
        'blacklist_status', COALESCE(NULLIF(iu.emisor_blacklist_status, ''), iu.receptor_blacklist_status), 'detected_via', 'uuid')
    FROM public.invoices_unified iu
    WHERE (iu.emisor_blacklist_status IN ('presumed','definitive') OR iu.receptor_blacklist_status IN ('presumed','definitive'))
      AND iu.company_id IS NOT NULL
    ON CONFLICT (issue_type, canonical_id) WHERE resolved_at IS NULL DO NOTHING RETURNING 1
  ) SELECT count(*) INTO v_tmp FROM ins; v_opened := v_opened + v_tmp;

  UPDATE public.reconciliation_issues SET resolution='stale_7d'
  WHERE resolved_at IS NULL AND detected_at < now() - interval '7 days' AND resolution IS NULL;

  RETURN jsonb_build_object(
    'refreshed_at', now(),
    'invoices_unified_rows', (SELECT count(*) FROM public.invoices_unified),
    'issues_opened', v_opened, 'issues_resolved', v_resolved,
    'duration_ms', (extract(milliseconds FROM clock_timestamp() - t_start))::int
  );
END;
$$;

COMMENT ON FUNCTION public.refresh_invoices_unified() IS 'Fase 3 · Fase 5 update: sat_only_* INSERTs populan company_id via companies.rfc lookup.';
```

- [ ] **Step 2: Apply migration**

Via `mcp__claude_ai_Supabase__apply_migration`:
- name: `syntage_layer3_009_company_id_fix`
- query: contents above

- [ ] **Step 3: Verify backfill worked**

```sql
SELECT issue_type, count(*) FILTER (WHERE company_id IS NULL) AS null_company,
       count(*) FILTER (WHERE company_id IS NOT NULL) AS has_company
FROM public.reconciliation_issues
WHERE resolved_at IS NULL AND issue_type IN ('sat_only_cfdi_issued','sat_only_cfdi_received')
GROUP BY issue_type;
```
Expected: most should have company_id. Null remainder are RFCs unknown to `companies`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260418_syntage_layer3_009_company_id_fix.sql
git diff --cached --stat  # 1 file
git commit -m "$(cat <<'EOF'
fix(syntage): Fase 5 PR 0 · reconciliation_issues.company_id populate

Fix de bug Fase 3 donde sat_only_* dejaban company_id NULL. Ahora el
INSERT del refresh function hace lookup companies.rfc para popular.
Backfill UPDATE para los ~51k issues ya abiertos.

Consecuencia: tab Reconciliación Fiscal en /companies/[id] (Fase 5 PR 2)
podrá filtrar issues correctamente por company_id.

Co-Authored-By: claude-flow <ruv@ruv.net>
EOF
)"
```

---

## Task 3 — Refresh queue trigger system

**Files:**
- Create: `supabase/migrations/20260418_syntage_layer3_010_refresh_queue.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Fase 5 · 010 refresh queue trigger system
-- Mitiga freshness gap: 15min MV vs live Odoo → máx 7min worst case.

CREATE TABLE IF NOT EXISTS public.unified_refresh_queue (
  requested_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  PRIMARY KEY (requested_at)
);

CREATE INDEX IF NOT EXISTS unified_refresh_queue_pending_idx
  ON public.unified_refresh_queue (processed_at) WHERE processed_at IS NULL;

REVOKE ALL ON public.unified_refresh_queue FROM anon, authenticated;
GRANT ALL ON public.unified_refresh_queue TO service_role;

CREATE OR REPLACE FUNCTION public.trg_schedule_unified_refresh()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.unified_refresh_queue (requested_at) VALUES (now())
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS odoo_invoices_refresh_trigger ON public.odoo_invoices;
CREATE TRIGGER odoo_invoices_refresh_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.odoo_invoices
FOR EACH STATEMENT EXECUTE FUNCTION public.trg_schedule_unified_refresh();

DROP TRIGGER IF EXISTS odoo_payments_refresh_trigger ON public.odoo_account_payments;
CREATE TRIGGER odoo_payments_refresh_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.odoo_account_payments
FOR EACH STATEMENT EXECUTE FUNCTION public.trg_schedule_unified_refresh();

DROP TRIGGER IF EXISTS syntage_invoices_refresh_trigger ON public.syntage_invoices;
CREATE TRIGGER syntage_invoices_refresh_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.syntage_invoices
FOR EACH STATEMENT EXECUTE FUNCTION public.trg_schedule_unified_refresh();

DROP TRIGGER IF EXISTS syntage_payments_refresh_trigger ON public.syntage_invoice_payments;
CREATE TRIGGER syntage_payments_refresh_trigger
AFTER INSERT OR UPDATE OR DELETE ON public.syntage_invoice_payments
FOR EACH STATEMENT EXECUTE FUNCTION public.trg_schedule_unified_refresh();

-- Debounced cron: cada 2min, check pending + min gap 5min desde último refresh
DO $$
BEGIN
  PERFORM cron.unschedule(jobname) FROM cron.job WHERE jobname = 'debounced-unified-refresh';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'debounced-unified-refresh',
  '*/2 * * * *',
  $job$
    DO $$
    DECLARE
      last_refresh timestamptz;
      has_pending boolean;
    BEGIN
      SELECT max(refreshed_at) INTO last_refresh FROM public.invoices_unified;
      SELECT EXISTS(SELECT 1 FROM public.unified_refresh_queue WHERE processed_at IS NULL) INTO has_pending;

      IF has_pending AND (last_refresh IS NULL OR last_refresh < now() - interval '5 minutes') THEN
        PERFORM public.refresh_invoices_unified();
        PERFORM public.refresh_payments_unified();
        UPDATE public.unified_refresh_queue SET processed_at = now() WHERE processed_at IS NULL;
      END IF;

      DELETE FROM public.unified_refresh_queue WHERE processed_at < now() - interval '7 days';
    END $$;
  $job$
);

COMMENT ON TABLE public.unified_refresh_queue IS 'Fase 5 · Queue para debounced refresh de invoices_unified/payments_unified. Trigger en odoo/syntage tables enqueue, cron cada 2min procesa.';
```

- [ ] **Step 2: Apply migration**

Via `mcp__claude_ai_Supabase__apply_migration` con name `syntage_layer3_010_refresh_queue`.

- [ ] **Step 3: Verify triggers registered**

```sql
SELECT event_object_table, trigger_name
FROM information_schema.triggers
WHERE trigger_name LIKE '%refresh_trigger'
ORDER BY event_object_table;
-- Expected: 4 triggers (odoo_invoices, odoo_account_payments, syntage_invoices, syntage_invoice_payments)

SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'debounced-unified-refresh';
-- Expected: */2 * * * * · active
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260418_syntage_layer3_010_refresh_queue.sql
git diff --cached --stat  # 1 file
git commit -m "$(cat <<'EOF'
feat(syntage): Fase 5 PR 0 · unified_refresh_queue + triggers

Reduce freshness gap de 15min → max 7min (2min cron * 5min min-gap).
Triggers en odoo_invoices/odoo_account_payments/syntage_invoices/
syntage_invoice_payments encolan requests. Debounced cron cada 2min
procesa si hay pending + último refresh >5min.

Co-Authored-By: claude-flow <ruv@ruv.net>
EOF
)"
```

---

# PR 1 · unified.ts helpers + /cobranza + /finanzas + parity tests

## Task 4 — unified.ts query helpers (TDD)

**Files:**
- Create: `src/lib/queries/unified.ts`
- Create: `src/__tests__/layer3/unified-helpers.test.ts`

- [ ] **Step 1: Write failing unit tests**

Create `src/__tests__/layer3/unified-helpers.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  getServiceClient: vi.fn(),
}));

import {
  getUnifiedRevenueAggregates,
  getUnifiedCashFlowAging,
  getUnifiedInvoicesForCompany,
  getUnifiedReconciliationCounts,
  getUnifiedRefreshStaleness,
  isComputableRevenue,
} from "@/lib/queries/unified";
import { getServiceClient } from "@/lib/supabase-server";

type Row = Record<string, unknown>;

function makeClient(rows: Row[]) {
  const qb: Record<string, unknown> = {
    _rows: rows,
  };
  const builder: {
    select: (cols: string) => typeof builder;
    eq: (col: string, val: unknown) => typeof builder;
    gte: (col: string, val: unknown) => typeof builder;
    lte: (col: string, val: unknown) => typeof builder;
    in: (col: string, vals: unknown[]) => typeof builder;
    is: (col: string, val: unknown) => typeof builder;
    not: (col: string, op: string, val: unknown) => typeof builder;
    order: (col: string, opts?: Record<string, unknown>) => typeof builder;
    limit: (n: number) => typeof builder;
    then: (cb: (v: unknown) => unknown) => unknown;
  } = {
    select: () => builder,
    eq: () => builder,
    gte: () => builder,
    lte: () => builder,
    in: () => builder,
    is: () => builder,
    not: () => builder,
    order: () => builder,
    limit: () => builder,
    then: (cb) => cb({ data: rows, error: null }),
  };
  return {
    from: () => builder,
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
}

describe("isComputableRevenue", () => {
  it("returns true for match_uuid posted vigente issued", () => {
    expect(isComputableRevenue({
      direction: "issued", match_status: "match_uuid",
      estado_sat: "vigente", odoo_state: "posted",
    })).toBe(true);
  });

  it("returns false for cancelled", () => {
    expect(isComputableRevenue({
      direction: "issued", match_status: "match_uuid",
      estado_sat: "cancelado", odoo_state: "posted",
    })).toBe(false);
  });

  it("returns false for syntage_only", () => {
    expect(isComputableRevenue({
      direction: "issued", match_status: "syntage_only",
      estado_sat: "vigente", odoo_state: null,
    })).toBe(false);
  });

  it("returns true for odoo_only posted (syntage unknown)", () => {
    expect(isComputableRevenue({
      direction: "issued", match_status: "odoo_only",
      estado_sat: null, odoo_state: "posted",
    })).toBe(true);
  });
});

describe("getUnifiedRevenueAggregates", () => {
  it("calls invoices_unified table and returns aggregate shape", async () => {
    const rows = [
      { match_status: "match_uuid", odoo_amount_total: 100, uuid_sat: "A" },
      { match_status: "match_composite", odoo_amount_total: 200, uuid_sat: "B" },
      { match_status: "odoo_only", odoo_amount_total: 300, uuid_sat: null },
    ];
    vi.mocked(getServiceClient).mockReturnValue(makeClient(rows) as never);

    const r = await getUnifiedRevenueAggregates("2026-01-01", "2026-12-31");
    expect(r.revenue).toBe(600);
    expect(r.count).toBe(3);
    expect(r.uuidValidated).toBe(2);
    expect(r.pctValidated).toBeCloseTo(66.67, 1);
  });
});

describe("getUnifiedRefreshStaleness", () => {
  it("returns minutes since most recent MV refresh", async () => {
    const ago = new Date(Date.now() - 8 * 60_000).toISOString();
    const qb = {
      select: () => qb,
      limit: () => qb,
      single: () => Promise.resolve({
        data: {
          invoices_unified_refreshed_at: ago,
          payments_unified_refreshed_at: ago,
        },
        error: null,
      }),
    };
    const client = {
      rpc: vi.fn().mockResolvedValue({
        data: {
          invoices_unified_refreshed_at: ago,
          payments_unified_refreshed_at: ago,
        },
        error: null,
      }),
    };
    vi.mocked(getServiceClient).mockReturnValue(client as never);

    const r = await getUnifiedRefreshStaleness();
    expect(r.minutesSinceRefresh).toBeGreaterThanOrEqual(7);
    expect(r.minutesSinceRefresh).toBeLessThan(10);
  });
});

describe("getUnifiedReconciliationCounts", () => {
  it("aggregates open issues by severity", async () => {
    const rows = [
      { severity: "critical" }, { severity: "critical" },
      { severity: "high" }, { severity: "medium" }, { severity: "low" },
    ];
    vi.mocked(getServiceClient).mockReturnValue(makeClient(rows) as never);
    const r = await getUnifiedReconciliationCounts(42);
    expect(r.open).toBe(5);
    expect(r.bySeverity.critical).toBe(2);
    expect(r.bySeverity.high).toBe(1);
    expect(r.bySeverity.medium).toBe(1);
    expect(r.bySeverity.low).toBe(1);
  });
});
```

- [ ] **Step 2: Run — verify fail**

```bash
cd /Users/jj/quimibond-intelligence/quimibond-intelligence/
npx vitest run src/__tests__/layer3/unified-helpers.test.ts
```
Expected: FAIL — module `@/lib/queries/unified` not found.

- [ ] **Step 3: Implement unified.ts**

Create `src/lib/queries/unified.ts`:

```ts
import { getServiceClient } from "@/lib/supabase-server";

export type Severity = "critical" | "high" | "medium" | "low";
export type MatchStatus = "match_uuid" | "match_composite" | "ambiguous" | "syntage_only" | "odoo_only";

export interface UnifiedInvoice {
  canonical_id: string;
  uuid_sat: string | null;
  odoo_invoice_id: number | null;
  match_status: MatchStatus;
  match_quality: string;
  direction: "issued" | "received";
  estado_sat: string | null;
  fecha_timbrado: string | null;
  fecha_cancelacion: string | null;
  total_fiscal: number | null;
  odoo_amount_total: number | null;
  amount_residual: number | null;
  payment_state: string | null;
  odoo_state: string | null;
  invoice_date: string | null;
  due_date: string | null;
  days_overdue: number | null;
  odoo_currency: string | null;
  moneda_fiscal: string | null;
  partner_name: string | null;
  company_id: number | null;
  odoo_company_id: number | null;
  emisor_rfc: string | null;
  receptor_rfc: string | null;
  emisor_blacklist_status: string | null;
  receptor_blacklist_status: string | null;
  fiscal_operational_consistency: string | null;
  amount_diff: number | null;
  odoo_ref: string | null;
  email_id_origen: number | null;
}

export interface UnifiedAgingBucket {
  bucket: "0-30" | "31-60" | "61-90" | "90+";
  amount: number;
  count: number;
}

export interface UnifiedRevenueAggregate {
  revenue: number;
  count: number;
  uuidValidated: number;
  pctValidated: number;
}

export interface UnifiedReconciliationCounts {
  open: number;
  bySeverity: Record<Severity, number>;
}

export interface UnifiedRefreshStaleness {
  invoicesRefreshedAt: string | null;
  paymentsRefreshedAt: string | null;
  minutesSinceRefresh: number;
}

export function isComputableRevenue(row: {
  direction?: string | null;
  match_status?: string | null;
  estado_sat?: string | null;
  odoo_state?: string | null;
}): boolean {
  if (row.direction !== "issued") return false;
  if (!row.match_status || !["match_uuid", "match_composite", "odoo_only"].includes(row.match_status)) return false;
  if ((row.estado_sat ?? "vigente") === "cancelado") return false;
  if (row.odoo_state != null && row.odoo_state !== "posted") return false;
  return true;
}

export async function getUnifiedInvoicesForCompany(
  companyId: number,
  opts?: { direction?: "issued" | "received"; includeNonComputable?: boolean }
): Promise<UnifiedInvoice[]> {
  const supabase = getServiceClient();
  let q = supabase.from("invoices_unified").select("*").eq("company_id", companyId);
  if (opts?.direction) q = q.eq("direction", opts.direction);
  if (!opts?.includeNonComputable) {
    q = q.in("match_status", ["match_uuid", "match_composite", "odoo_only"])
         .not("estado_sat", "eq", "cancelado");
  }
  const { data, error } = await q.order("invoice_date", { ascending: false }).limit(500);
  if (error) throw new Error(error.message);
  return (data ?? []) as UnifiedInvoice[];
}

export async function getUnifiedRevenueAggregates(
  fromDate: string,
  toDate: string,
  opts?: { companyId?: number }
): Promise<UnifiedRevenueAggregate> {
  const supabase = getServiceClient();
  let q = supabase.from("invoices_unified")
    .select("match_status,odoo_amount_total,uuid_sat,estado_sat,odoo_state,direction")
    .eq("direction", "issued")
    .in("match_status", ["match_uuid", "match_composite", "odoo_only"])
    .gte("invoice_date", fromDate)
    .lte("invoice_date", toDate)
    .not("estado_sat", "eq", "cancelado");
  if (opts?.companyId) q = q.eq("company_id", opts.companyId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<{ match_status: string; odoo_amount_total: number | null; uuid_sat: string | null }>;
  const revenue = rows.reduce((s, r) => s + (r.odoo_amount_total ?? 0), 0);
  const count = rows.length;
  const uuidValidated = rows.filter((r) => r.uuid_sat !== null).length;
  const pctValidated = count > 0 ? (uuidValidated / count) * 100 : 0;
  return { revenue, count, uuidValidated, pctValidated };
}

export async function getUnifiedCashFlowAging(
  opts?: { companyId?: number }
): Promise<UnifiedAgingBucket[]> {
  const supabase = getServiceClient();
  let q = supabase.from("invoices_unified")
    .select("amount_residual,days_overdue,match_status,estado_sat,odoo_state,direction")
    .eq("direction", "issued")
    .in("match_status", ["match_uuid", "match_composite", "odoo_only"])
    .not("estado_sat", "eq", "cancelado")
    .in("payment_state", ["not_paid", "partial", "in_payment"]);
  if (opts?.companyId) q = q.eq("company_id", opts.companyId);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<{ amount_residual: number | null; days_overdue: number | null }>;
  const buckets: Record<UnifiedAgingBucket["bucket"], UnifiedAgingBucket> = {
    "0-30":  { bucket: "0-30",  amount: 0, count: 0 },
    "31-60": { bucket: "31-60", amount: 0, count: 0 },
    "61-90": { bucket: "61-90", amount: 0, count: 0 },
    "90+":   { bucket: "90+",   amount: 0, count: 0 },
  };
  for (const r of rows) {
    const d = r.days_overdue ?? 0;
    const a = r.amount_residual ?? 0;
    const key: UnifiedAgingBucket["bucket"] = d <= 30 ? "0-30" : d <= 60 ? "31-60" : d <= 90 ? "61-90" : "90+";
    buckets[key].amount += a;
    buckets[key].count += 1;
  }
  return Object.values(buckets);
}

export async function getUnifiedReconciliationCounts(
  companyId: number
): Promise<UnifiedReconciliationCounts> {
  const supabase = getServiceClient();
  const { data, error } = await supabase.from("reconciliation_issues")
    .select("severity")
    .eq("company_id", companyId)
    .is("resolved_at", null);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<{ severity: Severity }>;
  const bySeverity: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const r of rows) bySeverity[r.severity] += 1;
  return { open: rows.length, bySeverity };
}

export async function getUnifiedRefreshStaleness(): Promise<UnifiedRefreshStaleness> {
  const supabase = getServiceClient();
  const { data, error } = await supabase.rpc("get_syntage_reconciliation_summary");
  if (error) throw new Error(error.message);
  const d = (data ?? {}) as { invoices_unified_refreshed_at?: string | null; payments_unified_refreshed_at?: string | null };
  const invRef = d.invoices_unified_refreshed_at ?? null;
  const payRef = d.payments_unified_refreshed_at ?? null;
  const refs = [invRef, payRef].filter((x): x is string => x != null);
  if (refs.length === 0) return { invoicesRefreshedAt: null, paymentsRefreshedAt: null, minutesSinceRefresh: 99999 };
  const oldestRef = refs.sort()[0];
  const minutesSinceRefresh = Math.round((Date.now() - new Date(oldestRef).getTime()) / 60_000);
  return { invoicesRefreshedAt: invRef, paymentsRefreshedAt: payRef, minutesSinceRefresh };
}
```

- [ ] **Step 4: Run tests — verify pass**

```bash
npx vitest run src/__tests__/layer3/unified-helpers.test.ts
```
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/queries/unified.ts src/__tests__/layer3/unified-helpers.test.ts
git diff --cached --stat  # exactly 2 files
git commit -m "$(cat <<'EOF'
feat(syntage): Fase 5 PR 1 · unified.ts query helpers

5 helpers + isComputableRevenue filter para Layer 3:
- getUnifiedInvoicesForCompany
- getUnifiedRevenueAggregates
- getUnifiedCashFlowAging
- getUnifiedReconciliationCounts
- getUnifiedRefreshStaleness

TypeScript types estrictos + unit tests con mocks de supabase client.

Co-Authored-By: claude-flow <ruv@ruv.net>
EOF
)"
```

---

## Task 5 — Refactor finance.ts with feature flag + parity tests

**Files:**
- Modify: `src/lib/queries/finance.ts`
- Create: `src/__tests__/layer3/parity-fase5.test.ts`

- [ ] **Step 1: Read current finance.ts to understand structure**

```bash
head -60 src/lib/queries/finance.ts
```

Note the existing exports (`getCashFlowAging`, `getCeiTimeline`, `getTopDebtors`, etc) — you'll refactor to dispatch on feature flag.

- [ ] **Step 2: Write parity tests first**

Create `src/__tests__/layer3/parity-fase5.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const describeIntegration = URL && KEY ? describe : describe.skip;

function sb() {
  if (!URL || !KEY) throw new Error("env missing");
  return createClient(URL, KEY, { auth: { persistSession: false } });
}

async function legacyCxcTotal(): Promise<number> {
  const supabase = sb();
  const { data, error } = await supabase.from("odoo_invoices")
    .select("amount_residual,move_type,state,payment_state,cfdi_sat_state")
    .in("move_type", ["out_invoice", "out_refund"])
    .eq("state", "posted")
    .in("payment_state", ["not_paid", "partial", "in_payment"])
    .not("cfdi_sat_state", "eq", "cancelado");
  if (error) throw error;
  return (data ?? []).reduce((s: number, r: { amount_residual: number | null }) => s + (r.amount_residual ?? 0), 0);
}

async function unifiedCxcTotal(): Promise<number> {
  const supabase = sb();
  const { data, error } = await supabase.from("invoices_unified")
    .select("amount_residual,direction,match_status,estado_sat,odoo_state,payment_state")
    .eq("direction", "issued")
    .in("match_status", ["match_uuid", "match_composite", "odoo_only"])
    .not("estado_sat", "eq", "cancelado")
    .in("payment_state", ["not_paid", "partial", "in_payment"]);
  if (error) throw error;
  return (data ?? []).reduce((s: number, r: { amount_residual: number | null }) => s + (r.amount_residual ?? 0), 0);
}

describeIntegration("Fase 5 parity · legacy vs unified", () => {
  it("CxC total diff <0.5% (allows for cancelled_but_posted exclusion)", async () => {
    const legacy = await legacyCxcTotal();
    const unified = await unifiedCxcTotal();
    const diff = Math.abs(legacy - unified);
    const pct = legacy > 0 ? (diff / legacy) : 0;
    // 0.5% tolerance: unified excludes cancelled_but_posted (~97 rows) which legacy includes via payment_state not_paid
    expect(pct).toBeLessThan(0.005);
  });

  it("CxC aging bucket counts match within 2%", async () => {
    const supabase = sb();
    const { data: legacy, error: e1 } = await supabase.from("odoo_invoices")
      .select("amount_residual,days_overdue,move_type,state,payment_state,cfdi_sat_state")
      .in("move_type", ["out_invoice", "out_refund"])
      .eq("state", "posted")
      .in("payment_state", ["not_paid", "partial", "in_payment"])
      .not("cfdi_sat_state", "eq", "cancelado");
    if (e1) throw e1;
    const { data: unified, error: e2 } = await supabase.from("invoices_unified")
      .select("amount_residual,days_overdue,direction,match_status,estado_sat,payment_state")
      .eq("direction", "issued")
      .in("match_status", ["match_uuid", "match_composite", "odoo_only"])
      .not("estado_sat", "eq", "cancelado")
      .in("payment_state", ["not_paid", "partial", "in_payment"]);
    if (e2) throw e2;
    const legacyCount = (legacy ?? []).length;
    const unifiedCount = (unified ?? []).length;
    const diff = Math.abs(legacyCount - unifiedCount);
    expect(diff / legacyCount).toBeLessThan(0.02);
  });
});
```

- [ ] **Step 3: Run parity tests — verify skip (no env) or pass**

```bash
npx vitest run src/__tests__/layer3/parity-fase5.test.ts
```
Expected: 2 tests skipped (if no env) or PASS (if env + diff within tolerance).

- [ ] **Step 4: Refactor finance.ts with feature flag**

Read the current finance.ts file structure. For each function that currently reads `odoo_invoices`/`odoo_account_payments` directly, add a feature-flagged dispatch. Example for `getCashFlowAging`:

```ts
import { getUnifiedCashFlowAging } from "@/lib/queries/unified";

const USE_UNIFIED_LAYER = process.env.USE_UNIFIED_LAYER !== "false";

// ... existing legacy function renamed
async function legacyGetCashFlowAging(companyId?: number) {
  // ... existing body unchanged, just renamed
}

export async function getCashFlowAging(companyId?: number) {
  if (USE_UNIFIED_LAYER) {
    const buckets = await getUnifiedCashFlowAging({ companyId });
    // Return shape compatible with legacy consumers
    return buckets;
  }
  return legacyGetCashFlowAging(companyId);
}
```

Repeat for: `getCeiTimeline`, `getTopDebtors`, `getCfoDashboard`, `getWorkingCapital`, `getCashFlowRunway`. If the legacy shape has additional fields not in unified, ensure compatibility.

- [ ] **Step 5: Run existing finance tests if any**

```bash
npx vitest run src/__tests__/ --testPathPattern finance
```
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/queries/finance.ts src/__tests__/layer3/parity-fase5.test.ts
git diff --cached --stat  # 2 files
git commit -m "$(cat <<'EOF'
feat(syntage): Fase 5 PR 1 · finance.ts migrated to Layer 3

getCashFlowAging, getCeiTimeline, getTopDebtors, getCfoDashboard,
getWorkingCapital, getCashFlowRunway ahora dispatch a unified helpers
cuando USE_UNIFIED_LAYER !== 'false' (default ON). Legacy paths
preservados como fallback para rollback instantáneo sin redeploy.

Parity test gates diff <0.5% en CxC total y aging counts.

Co-Authored-By: claude-flow <ruv@ruv.net>
EOF
)"
```

---

## Task 6 — `/cobranza` UI changes

**Files:**
- Modify: `src/app/cobranza/page.tsx`
- Create: `src/components/shared/v2/sat-badge.tsx`
- Create: `src/components/shared/v2/refresh-staleness-badge.tsx`

- [ ] **Step 1: Create SAT badge component**

Create `src/components/shared/v2/sat-badge.tsx`:

```tsx
import { Badge } from "@/components/ui/badge";

export interface SatBadgeProps {
  estadoSat: string | null;
  uuidSat: string | null;
}

export function SatBadge({ estadoSat, uuidSat }: SatBadgeProps) {
  if (!uuidSat) {
    return <Badge variant="outline" className="text-muted-foreground">sin UUID</Badge>;
  }
  if (estadoSat === "cancelado") {
    return <Badge className="bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-100">cancelado</Badge>;
  }
  return <Badge className="bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">vigente</Badge>;
}
```

- [ ] **Step 2: Create refresh staleness badge with manual refresh button**

Create `src/components/shared/v2/refresh-staleness-badge.tsx`:

```tsx
"use client";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export interface RefreshStalenessBadgeProps {
  minutesSinceRefresh: number;
  invoicesRefreshedAt: string | null;
}

export function RefreshStalenessBadge({ minutesSinceRefresh, invoicesRefreshedAt }: RefreshStalenessBadgeProps) {
  const [refreshing, setRefreshing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const color = minutesSinceRefresh < 20
    ? "bg-muted text-muted-foreground"
    : minutesSinceRefresh < 60
    ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100"
    : "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-100";

  async function triggerRefresh() {
    setRefreshing(true);
    setMsg(null);
    try {
      const res = await fetch("/api/syntage/refresh-unified", { method: "POST" });
      setMsg(res.ok ? "Refresh iniciado · recarga en ~30s" : `Error ${res.status}`);
    } catch (e) {
      setMsg(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="flex items-center gap-2 text-xs">
      <Badge className={color} title={invoicesRefreshedAt ?? undefined}>
        Actualizado hace {minutesSinceRefresh}min
      </Badge>
      {minutesSinceRefresh >= 20 && (
        <Button size="sm" variant="outline" onClick={triggerRefresh} disabled={refreshing}>
          {refreshing ? "Refrescando..." : "Refresh ahora"}
        </Button>
      )}
      {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
    </div>
  );
}
```

- [ ] **Step 3: Modify /cobranza/page.tsx**

Read current page.tsx to find the invoice table. Add:
- Import `SatBadge` and `RefreshStalenessBadge` from `@/components/shared/v2/...`
- Import `getUnifiedRefreshStaleness` from `@/lib/queries/unified`
- Fetch staleness in page (`const staleness = await getUnifiedRefreshStaleness()`)
- Render `<RefreshStalenessBadge {...staleness} />` near the page title
- Add a new column "SAT" in the invoice table rendering `<SatBadge estadoSat={row.estado_sat} uuidSat={row.uuid_sat} />`

Exact edits depend on current file structure — use `grep -n "InvoiceTable\|tabla\|<table" src/app/cobranza/page.tsx` to find insertion points.

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep -E "cobranza|sat-badge|refresh-staleness" || echo "no errors"
```

- [ ] **Step 5: Dev server smoke test**

```bash
npm run dev &
# Open http://localhost:3000/cobranza, verify:
# - staleness badge appears
# - SAT column badges render
# - total not radically different from pre-migration
```

- [ ] **Step 6: Commit**

```bash
git add src/app/cobranza/page.tsx src/components/shared/v2/sat-badge.tsx src/components/shared/v2/refresh-staleness-badge.tsx
git diff --cached --stat  # 3 files
git commit -m "$(cat <<'EOF'
feat(syntage): Fase 5 PR 1 · /cobranza · SAT badge + staleness indicator

Nueva columna SAT en tabla de facturas (vigente/cancelado/sin UUID).
Badge de staleness top del page con botón manual refresh si >20min.
Ambos consumen Layer 3 via unified helpers.

Co-Authored-By: claude-flow <ruv@ruv.net>
EOF
)"
```

---

## Task 7 — `/finanzas` UI · validated CFDIs donut

**Files:**
- Modify: `src/app/finanzas/page.tsx`

- [ ] **Step 1: Identify revenue section**

```bash
grep -n "revenue\|Revenue\|Ingresos\|getCfoDashboard" src/app/finanzas/page.tsx | head -20
```

- [ ] **Step 2: Add CFDIs validated stat card + donut**

In `/finanzas/page.tsx`, add after the revenue section:

```tsx
import { getUnifiedRevenueAggregates } from "@/lib/queries/unified";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// In the RSC body, after existing fetches:
const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
const monthEnd = new Date().toISOString().slice(0, 10);
const revenueAgg = await getUnifiedRevenueAggregates(monthStart, monthEnd);

const pctColor = revenueAgg.pctValidated > 90 ? "bg-emerald-100 text-emerald-900"
  : revenueAgg.pctValidated > 70 ? "bg-amber-100 text-amber-900"
  : "bg-rose-100 text-rose-900";

// JSX:
<Card>
  <CardHeader>
    <CardTitle className="text-base">CFDIs validados SAT · mes corriente</CardTitle>
    <p className="text-xs text-muted-foreground">
      Facturas emitidas con UUID SAT / total posted
    </p>
  </CardHeader>
  <CardContent>
    <div className="flex items-baseline gap-3">
      <span className="font-mono text-3xl tabular-nums">
        {Math.round(revenueAgg.pctValidated)}%
      </span>
      <Badge className={pctColor}>
        {revenueAgg.uuidValidated} de {revenueAgg.count}
      </Badge>
    </div>
    <div className="mt-2 text-xs text-muted-foreground">
      Revenue total (posted no-cancelado): ${revenueAgg.revenue.toLocaleString("es-MX", { minimumFractionDigits: 2 })}
    </div>
  </CardContent>
</Card>
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep -E "finanzas" || echo "no errors"
```

- [ ] **Step 4: Commit**

```bash
git add src/app/finanzas/page.tsx
git diff --cached --stat  # 1 file
git commit -m "$(cat <<'EOF'
feat(syntage): Fase 5 PR 1 · /finanzas · CFDIs validados SAT stat card

Card nueva muestra % de revenue posted del mes que tiene UUID SAT.
Verde >90% · amber 70-90% · rojo <70%. Consume getUnifiedRevenueAggregates.

Co-Authored-By: claude-flow <ruv@ruv.net>
EOF
)"
```

---

# PR 2 · /companies/[id] + invoice-detail.ts

## Task 8 — Refactor companies.ts + invoice-detail.ts

**Files:**
- Modify: `src/lib/queries/companies.ts`
- Modify: `src/lib/queries/invoice-detail.ts`

- [ ] **Step 1: Identify current query patterns**

```bash
grep -n "odoo_invoices\|cfdi_documents" src/lib/queries/companies.ts src/lib/queries/invoice-detail.ts
```

- [ ] **Step 2: Refactor companies.ts**

Add at the top:
```ts
import { getUnifiedInvoicesForCompany } from "@/lib/queries/unified";
const USE_UNIFIED_LAYER = process.env.USE_UNIFIED_LAYER !== "false";
```

For `getCompanyInvoices(companyId)`:
```ts
async function legacyGetCompanyInvoices(companyId: number) {
  // existing body, renamed
}

export async function getCompanyInvoices(companyId: number) {
  if (USE_UNIFIED_LAYER) {
    const rows = await getUnifiedInvoicesForCompany(companyId);
    // Map shape if legacy callers expect specific field names
    return rows;
  }
  return legacyGetCompanyInvoices(companyId);
}
```

- [ ] **Step 3: Refactor invoice-detail.ts**

Replace queries that read `cfdi_documents` with `email_cfdi_links` joined by `uuid`:

```ts
// Replace queries like:
// supabase.from("cfdi_documents").select("email_id,gmail_message_id").eq("uuid", uuid)
// With:
supabase.from("email_cfdi_links").select("email_id,gmail_message_id").eq("uuid", uuid);
```

Note: in PR 4 `email_cfdi_links` will be populated. Until then, results are empty (no regression — current parse-cfdi produced empty `cfdi_documents.uuid` matches for invoices not yet parsed anyway).

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep -E "companies|invoice-detail" || echo "no errors"
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/queries/companies.ts src/lib/queries/invoice-detail.ts
git diff --cached --stat  # 2 files
git commit -m "$(cat <<'EOF'
feat(syntage): Fase 5 PR 2 · companies.ts + invoice-detail.ts → Layer 3

getCompanyInvoices usa getUnifiedInvoicesForCompany con feature flag.
invoice-detail.ts lee email_cfdi_links (vacío hasta PR 4) en vez de
cfdi_documents directo.

Co-Authored-By: claude-flow <ruv@ruv.net>
EOF
)"
```

---

## Task 9 — `/companies/[id]` Reconciliación tab

**Files:**
- Create: `src/components/system/CompanyReconciliationTab.tsx`
- Modify: `src/app/companies/[id]/page.tsx`

- [ ] **Step 1: Create CompanyReconciliationTab component**

Create `src/components/system/CompanyReconciliationTab.tsx`:

```tsx
import { getServiceClient } from "@/lib/supabase-server";
import { getUnifiedReconciliationCounts } from "@/lib/queries/unified";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const SEV_STYLES: Record<string, string> = {
  critical: "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-100",
  high:     "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100",
  medium:   "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-100",
  low:      "bg-muted text-muted-foreground",
};

export async function CompanyReconciliationTab({ companyId }: { companyId: number }) {
  const supabase = getServiceClient();
  const counts = await getUnifiedReconciliationCounts(companyId);

  const { data: issues, error } = await supabase
    .from("reconciliation_issues")
    .select("issue_id,issue_type,severity,description,detected_at,metadata,uuid_sat,odoo_invoice_id")
    .eq("company_id", companyId)
    .is("resolved_at", null)
    .order("detected_at", { ascending: false })
    .limit(50);

  if (error) {
    return <div className="p-4 text-rose-600 text-sm">Error: {error.message}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-3">
        {(["critical","high","medium","low"] as const).map((sev) => (
          <div key={sev} className="rounded-md border bg-card p-3 text-center">
            <Badge className={SEV_STYLES[sev]}>{sev}</Badge>
            <div className="mt-2 font-mono text-xl tabular-nums">{counts.bySeverity[sev]}</div>
          </div>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Issues abiertos ({counts.open})</CardTitle>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left">Severity</th>
                <th className="px-4 py-2 text-left">Tipo</th>
                <th className="px-4 py-2 text-left">Descripción</th>
                <th className="px-4 py-2 text-left">Detectado</th>
              </tr>
            </thead>
            <tbody>
              {(issues ?? []).length === 0 && (
                <tr><td className="px-4 py-6 text-center text-muted-foreground" colSpan={4}>Sin issues abiertos</td></tr>
              )}
              {(issues ?? []).map((i: { issue_id: string; issue_type: string; severity: string; description: string; detected_at: string }) => (
                <tr key={i.issue_id} className="border-t">
                  <td className="px-4 py-2"><Badge className={SEV_STYLES[i.severity]}>{i.severity}</Badge></td>
                  <td className="px-4 py-2 text-xs font-mono">{i.issue_type}</td>
                  <td className="px-4 py-2">{i.description}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {new Date(i.detected_at).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Modify /companies/[id]/page.tsx**

Read existing file to find tab structure. Add:
- Import `CompanyReconciliationTab`
- Add `<TabsTrigger value="reconciliacion">Reconciliación</TabsTrigger>` to TabsList
- Add `<TabsContent value="reconciliacion"><Suspense fallback={<Skeleton />}><CompanyReconciliationTab companyId={id} /></Suspense></TabsContent>`

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep -E "companies|CompanyReconciliationTab" || echo "no errors"
```

- [ ] **Step 4: Commit**

```bash
git add src/components/system/CompanyReconciliationTab.tsx src/app/companies/[id]/page.tsx
git diff --cached --stat  # 2 files
git commit -m "$(cat <<'EOF'
feat(syntage): Fase 5 PR 2 · /companies/[id] · tab Reconciliación Fiscal

Tab nuevo muestra issues abiertos del company_id: 4 stat cards por severity
+ tabla paginada LIMIT 50. Consume Layer 3 via getUnifiedReconciliationCounts.

Co-Authored-By: claude-flow <ruv@ruv.net>
EOF
)"
```

---

# PR 3 · /compras + purchases.ts

## Task 10 — Refactor purchases.ts + /compras 69-B tag

**Files:**
- Modify: `src/lib/queries/purchases.ts`
- Modify: `src/app/compras/page.tsx`

- [ ] **Step 1: Identify patterns**

```bash
grep -n "odoo_invoices\|supplier" src/lib/queries/purchases.ts | head -10
```

- [ ] **Step 2: Refactor purchases.ts**

Add feature flag + unified dispatch:
```ts
import { getUnifiedInvoicesForCompany } from "@/lib/queries/unified";
const USE_UNIFIED_LAYER = process.env.USE_UNIFIED_LAYER !== "false";

async function legacyGetSupplierInvoices(supplierCompanyId: number) {
  // existing body renamed
}

export async function getSupplierInvoices(supplierCompanyId: number) {
  if (USE_UNIFIED_LAYER) {
    return getUnifiedInvoicesForCompany(supplierCompanyId, { direction: "received" });
  }
  return legacyGetSupplierInvoices(supplierCompanyId);
}
```

- [ ] **Step 3: Add 69-B tag helper query**

In purchases.ts, add:
```ts
import { getServiceClient } from "@/lib/supabase-server";

export async function getSupplierBlacklistStatus(supplierCompanyId: number): Promise<string | null> {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("reconciliation_issues")
    .select("metadata")
    .eq("company_id", supplierCompanyId)
    .eq("issue_type", "partner_blacklist_69b")
    .is("resolved_at", null)
    .limit(1);
  if (error) return null;
  const row = (data ?? [])[0] as { metadata?: { blacklist_status?: string } } | undefined;
  return row?.metadata?.blacklist_status ?? null;
}
```

- [ ] **Step 4: Modify /compras/page.tsx to render 69-B tag**

In the supplier table, add a column or badge:
```tsx
// Near supplier name:
{supplier.blacklist_status && (
  <Badge className="bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-100 ml-2">
    69-B: {supplier.blacklist_status}
  </Badge>
)}
```

Fetch the blacklist_status per supplier in the page (or bulk query if list has many).

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit 2>&1 | grep -E "compras|purchases" || echo "no errors"
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/queries/purchases.ts src/app/compras/page.tsx
git diff --cached --stat  # 2 files
git commit -m "$(cat <<'EOF'
feat(syntage): Fase 5 PR 3 · /compras · 69-B tag + purchases.ts migrated

getSupplierInvoices dispatch a Layer 3 (direction='received').
Nuevo getSupplierBlacklistStatus consulta reconciliation_issues
partner_blacklist_69b y tag rojo aparece en /compras supplier list.

Co-Authored-By: claude-flow <ruv@ruv.net>
EOF
)"
```

---

# PR 4 · cfdi_documents → email_cfdi_links migration

## Task 11 — Data migration + MV refresh to populate email_id_origen

**Files:**
- Create: `supabase/migrations/20260418_syntage_layer3_011_cfdi_documents_migration.sql`

- [ ] **Step 1: Write migration**

```sql
-- Fase 5 PR 4 · Migrate cfdi_documents data → email_cfdi_links

-- Copy rows with valid uuid to email_cfdi_links
INSERT INTO public.email_cfdi_links (email_id, gmail_message_id, account, uuid, linked_at)
SELECT email_id, gmail_message_id, account, uuid, COALESCE(parsed_at, now())
FROM public.cfdi_documents
WHERE uuid IS NOT NULL AND uuid <> ''
ON CONFLICT DO NOTHING;

-- Report
SELECT
  (SELECT count(*) FROM public.cfdi_documents WHERE uuid IS NOT NULL) AS source_rows,
  (SELECT count(*) FROM public.email_cfdi_links) AS migrated_rows;
```

- [ ] **Step 2: Apply migration**

Via `mcp__claude_ai_Supabase__apply_migration` con name `syntage_layer3_011_cfdi_documents_migration`.

- [ ] **Step 3: Trigger MV refresh to populate email_id_origen**

```sql
SELECT public.refresh_invoices_unified();
-- Then check
SELECT count(*) FILTER (WHERE email_id_origen IS NOT NULL) AS with_email,
       count(*) AS total
FROM public.invoices_unified;
```

Expected: `with_email > 0` and equals approximately the `email_cfdi_links` count matched against `syntage_invoices.uuid`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260418_syntage_layer3_011_cfdi_documents_migration.sql
git diff --cached --stat  # 1 file
git commit -m "$(cat <<'EOF'
feat(syntage): Fase 5 PR 4 · migrate cfdi_documents → email_cfdi_links

INSERT data rows con uuid válido. Refresh manual del MV para popular
invoices_unified.email_id_origen via LEFT JOIN. cfdi_documents queda
intacto hasta PR 5 (rename + deprecated).

Co-Authored-By: claude-flow <ruv@ruv.net>
EOF
)"
```

---

# PR 5 · Shutdown parse-cfdi + rename deprecated

## Task 12 — Shutdown parse-cfdi cron + 410 Gone endpoint

**Files:**
- Modify: `src/app/api/pipeline/parse-cfdi/route.ts`
- Modify: `vercel.json`
- Create: `supabase/migrations/20260418_syntage_layer3_012_deprecate_cfdi_documents.sql`

- [ ] **Step 1: Replace parse-cfdi route with 410 Gone**

Modify `src/app/api/pipeline/parse-cfdi/route.ts` — replace body with:

```ts
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const MESSAGE = "Endpoint deprecated 2026-04-20. CFDIs now ingested via Syntage webhook. See /system → Syntage.";

export async function GET() {
  return NextResponse.json({ error: "Gone", message: MESSAGE }, { status: 410 });
}

export async function POST() {
  return NextResponse.json({ error: "Gone", message: MESSAGE }, { status: 410 });
}
```

- [ ] **Step 2: Remove parse-cfdi cron from vercel.json**

```bash
grep -n "parse-cfdi" vercel.json
```

Remove the entry (cron schedule block).

- [ ] **Step 3: Rename cfdi_documents in Supabase**

Create `supabase/migrations/20260418_syntage_layer3_012_deprecate_cfdi_documents.sql`:

```sql
-- Fase 5 PR 5 · Deprecate cfdi_documents (rename for 30d safety net)

ALTER TABLE IF EXISTS public.cfdi_documents RENAME TO cfdi_documents_deprecated_20260420;

REVOKE INSERT, UPDATE, DELETE ON public.cfdi_documents_deprecated_20260420 FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON public.cfdi_documents_deprecated_20260420 FROM service_role;

COMMENT ON TABLE public.cfdi_documents_deprecated_20260420 IS 'Deprecated 2026-04-20 · read-only · replaced by email_cfdi_links. DROP en Fase 5 PR 6 (día 30).';
```

- [ ] **Step 4: Apply migration**

Via `mcp__claude_ai_Supabase__apply_migration` con name `syntage_layer3_012_deprecate_cfdi_documents`.

- [ ] **Step 5: Verify**

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema='public' AND table_name LIKE 'cfdi_documents%';
-- Expected: cfdi_documents_deprecated_20260420 (only)
```

- [ ] **Step 6: Commit**

```bash
git add src/app/api/pipeline/parse-cfdi/route.ts vercel.json supabase/migrations/20260418_syntage_layer3_012_deprecate_cfdi_documents.sql
git diff --cached --stat  # 3 files
git commit -m "$(cat <<'EOF'
feat(syntage): Fase 5 PR 5 · shutdown parse-cfdi + deprecate cfdi_documents

/api/pipeline/parse-cfdi responde 410 Gone indefinidamente.
Cron removido de vercel.json.
Tabla renamed a cfdi_documents_deprecated_20260420, read-only (revoke
INSERT/UPDATE/DELETE). DROP en PR 6 tras 30d sin regresiones.

Co-Authored-By: claude-flow <ruv@ruv.net>
EOF
)"
```

---

# PR 6 · Cleanup legacy (día 30 post-deploy)

## Task 13 — Remove legacy fallback + drop deprecated table

**Files:**
- Modify: `src/lib/queries/finance.ts` (remove legacy fns + feature flag)
- Modify: `src/lib/queries/companies.ts`
- Modify: `src/lib/queries/purchases.ts`
- Modify: `src/app/api/pipeline/parse-cfdi/route.ts` (remove entirely OR keep 410)
- Create: `supabase/migrations/20260520_syntage_layer3_013_cleanup.sql`

**Run only ≥30 days post-PR 5 deploy, after validating no legacy path usage via logs.**

- [ ] **Step 1: Search for legacy fallback code**

```bash
grep -rn "legacyGet\|USE_UNIFIED_LAYER\|legacyCashFlowAging\|legacyGetCompanyInvoices\|legacyGetSupplierInvoices" src/
```

- [ ] **Step 2: Remove legacy fns + flag from finance.ts**

Delete all `legacy*` functions and inline `USE_UNIFIED_LAYER` dispatch. Exported functions become simple wrappers around unified helpers.

- [ ] **Step 3: Same for companies.ts + purchases.ts**

- [ ] **Step 4: Optional: remove parse-cfdi route entirely**

Delete `src/app/api/pipeline/parse-cfdi/` folder (or keep 410 response indefinitely — preference).

- [ ] **Step 5: Drop deprecated table**

Create `supabase/migrations/20260520_syntage_layer3_013_cleanup.sql`:

```sql
DROP TABLE IF EXISTS public.cfdi_documents_deprecated_20260420;
```

Apply via `mcp__claude_ai_Supabase__apply_migration` con name `syntage_layer3_013_cleanup`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/queries/finance.ts src/lib/queries/companies.ts src/lib/queries/purchases.ts supabase/migrations/20260520_syntage_layer3_013_cleanup.sql
# Optional: rm -rf src/app/api/pipeline/parse-cfdi/
git diff --cached --stat
git commit -m "$(cat <<'EOF'
chore(syntage): Fase 5 PR 6 · cleanup legacy (30d post-deploy)

Remove USE_UNIFIED_LAYER feature flag + legacy fallback fns.
DROP cfdi_documents_deprecated_20260420.
Migración Fase 5 cerrada.

Co-Authored-By: claude-flow <ruv@ruv.net>
EOF
)"
```

---

## Self-Review Checklist

| Spec Section | Task(s) |
|---|---|
| §3 Autoridad por campo | Task 4 (isComputableRevenue + unified helpers) |
| §4 PR 0 email_id_origen | Task 1 |
| §4.2 company_id fix + backfill | Task 2 |
| §4.3 refresh trigger queue | Task 3 |
| §5 email_cfdi_links table | Task 1 (create) + Task 11 (populate) |
| §6.1 unified.ts helpers | Task 4 |
| §6.2 finance.ts refactor + feature flag | Task 5 |
| §6.3 /cobranza SAT column + staleness | Task 6 |
| §6.4 /finanzas validated donut | Task 7 |
| §6.5 Parity tests | Task 5 |
| §7 /companies/[id] + invoice-detail | Task 8 + Task 9 |
| §8 /compras + purchases | Task 10 |
| §9 cfdi_documents migration | Task 11 |
| §10 parse-cfdi shutdown | Task 12 |
| §11 Cleanup 30d | Task 13 |
| §12 Testing | Task 4 (unit) + Task 5 (parity) |
| §13 Rollout (6 PRs) | Tasks organized by PR boundary |
| §14 Rollback (feature flag) | Task 5 |
| §15 Success criteria | All tasks contribute |

No gaps. Types consistent (`MatchStatus`, `Severity`, `UnifiedInvoice` used uniformly). No TBDs.
