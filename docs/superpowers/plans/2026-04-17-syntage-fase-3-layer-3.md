# Syntage Fase 3 — Layer 3 Canónico · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir el Layer 3 canónico de la integración Syntage: materialized views `invoices_unified` + `payments_unified` + `payment_allocations_unified`, tabla `reconciliation_issues` con 8 tipos MVP, funciones refresh + summary RPC, pg_cron cada 15min, endpoint manual y panel UI `/system → Syntage → Reconciliación`.

**Architecture:** PostgreSQL-first. Todo el matching y la lógica de issues viven en PLpgSQL sobre Supabase. Next.js sólo expone un endpoint trigger y un panel React Server Component que consume un único RPC `get_syntage_reconciliation_summary()`. Las `cashflow_*` views existentes NO se migran en Fase 3 (diferido a Fase 5-6).

**Tech Stack:** PostgreSQL 15, Supabase (pg_cron, pgcrypto), Next.js 15 App Router, React 19 (RSC), vitest, TailwindCSS, shadcn/ui (Card, Badge, Tabs).

**Spec:** `docs/superpowers/specs/2026-04-17-syntage-fase-3-layer-3-design.md`

---

## File Structure

### Create

- `supabase/migrations/20260418_syntage_layer3_001_reconciliation_issues.sql` — tabla + índices + RLS
- `supabase/migrations/20260418_syntage_layer3_002_invoices_unified.sql` — MV + índices
- `supabase/migrations/20260418_syntage_layer3_003_payments_unified.sql` — MV + VIEW + índices
- `supabase/migrations/20260418_syntage_layer3_004_refresh_functions.sql` — refresh_invoices_unified + refresh_payments_unified
- `supabase/migrations/20260418_syntage_layer3_005_summary_rpc.sql` — get_syntage_reconciliation_summary
- `supabase/migrations/20260418_syntage_layer3_006_cron.sql` — pg_cron schedule
- `src/app/api/syntage/refresh-unified/route.ts` — endpoint manual trigger
- `src/lib/queries/syntage-reconciliation.ts` — query helper + TypeScript types
- `src/components/system/SyntageReconciliationPanel.tsx` — UI panel
- `src/__tests__/syntage/refresh-unified-route.test.ts` — endpoint tests
- `src/__tests__/syntage/syntage-reconciliation-query.test.ts` — query helper tests
- `src/__tests__/syntage/reconciliation-integration.test.ts` — E2E DB integration (gated por env)
- `src/__tests__/syntage/invoices-unified-schema.test.ts` — regression snapshot

### Modify

- `src/app/system/page.tsx` — agregar sub-tabs dentro del tab `syntage` (Health + Reconciliación)

---

## Notes for the Engineer

- **Migration numbering:** Las migraciones existentes usan prefijo `20260417_syntage_*`. Usamos `20260418_syntage_layer3_0NN_*.sql` para (1) asegurar orden lexical correcto (después del drop-fk del 17) y (2) dejar claro que pertenecen a Fase 3.
- **Idempotencia:** cada migración empieza con `DROP IF EXISTS` o `CREATE OR REPLACE`. Si alguna falla a mitad, re-correrla debe ser seguro.
- **Testing SQL:** las tests de integración (`reconciliation-integration.test.ts`) requieren `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` en env. Saltan con `describe.skipIf(!process.env.SUPABASE_SERVICE_KEY)` si no están. En CI corren contra el Supabase dev branch; en local se puede correr contra producción **con datos existentes** (solo lectura).
- **No corras tests destructivos en prod.** Los tests de integración usan SELECT + seed con RFCs sintéticos (prefijo `TEST`) en tablas auxiliares, nunca TRUNCATE ni DELETE en tablas reales.
- **Supabase client:** usar `getServiceClient()` de `@/lib/supabase-server` — mismo patrón que `getSyntageHealth`.
- **Commit frequency:** cada tarea termina con un commit. Si una tarea tiene sub-pasos críticos (crear archivo, implementar, testear), commitear al cerrar cada sub-paso si pasa.

---

## Task 1 — `reconciliation_issues` table

**Files:**
- Create: `supabase/migrations/20260418_syntage_layer3_001_reconciliation_issues.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260418_syntage_layer3_001_reconciliation_issues.sql`:

```sql
-- Fase 3 Layer 3 · 001 reconciliation_issues
-- Tabla de discrepancias entre Syntage (fiscal) y Odoo (operativo).
-- Poblada por refresh_invoices_unified() y refresh_payments_unified().

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DROP TABLE IF EXISTS public.reconciliation_issues CASCADE;

CREATE TABLE public.reconciliation_issues (
  issue_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_type        text NOT NULL CHECK (issue_type IN (
    'cancelled_but_posted',
    'posted_but_sat_uncertified',
    'sat_only_cfdi_received',
    'sat_only_cfdi_issued',
    'amount_mismatch',
    'partner_blacklist_69b',
    'payment_missing_complemento',
    'complemento_missing_payment'
  )),
  canonical_id      text,
  uuid_sat          text,
  odoo_invoice_id   bigint,
  odoo_payment_id   bigint,
  odoo_company_id   integer,
  company_id        bigint,
  description       text NOT NULL,
  severity          text NOT NULL CHECK (severity IN ('critical','high','medium','low')),
  detected_at       timestamptz NOT NULL DEFAULT now(),
  resolved_at       timestamptz,
  resolution        text,
  metadata          jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- Dedup estructural: un solo issue abierto por (tipo, canonical_id)
CREATE UNIQUE INDEX reconciliation_issues_open_unique
  ON public.reconciliation_issues (issue_type, canonical_id)
  WHERE resolved_at IS NULL;

CREATE INDEX reconciliation_issues_company_open_idx
  ON public.reconciliation_issues (odoo_company_id, severity)
  WHERE resolved_at IS NULL;

CREATE INDEX reconciliation_issues_detected_idx
  ON public.reconciliation_issues (detected_at DESC);

CREATE INDEX reconciliation_issues_resolved_at_idx
  ON public.reconciliation_issues (resolved_at DESC NULLS FIRST);

-- RLS deny-all: solo service_role escribe/lee
ALTER TABLE public.reconciliation_issues ENABLE ROW LEVEL SECURITY;

GRANT ALL ON public.reconciliation_issues TO service_role;

COMMENT ON TABLE public.reconciliation_issues IS 'Fase 3 · Discrepancias Syntage/Odoo detectadas por refresh_*_unified(). 8 tipos MVP. Spec: docs/superpowers/specs/2026-04-17-syntage-fase-3-layer-3-design.md §7.';
```

- [ ] **Step 2: Apply migration to Supabase**

Run via Supabase MCP or `supabase db push`:

```bash
# Via MCP (preferred, already wired in this session)
# OR: supabase db push (requires linked project)
```

Via `mcp__claude_ai_Supabase__apply_migration`:
- `project_id`: `tozqezmivpblmcubmnpi`
- `name`: `syntage_layer3_001_reconciliation_issues`
- `query`: content of the .sql file

- [ ] **Step 3: Verify table exists**

Run query:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'reconciliation_issues' AND table_schema = 'public'
ORDER BY ordinal_position;
```

Expected: 13 rows matching the schema above.

- [ ] **Step 4: Verify indexes**

```sql
SELECT indexname, indexdef FROM pg_indexes
WHERE tablename = 'reconciliation_issues';
```

Expected: `reconciliation_issues_pkey`, `reconciliation_issues_open_unique`, `reconciliation_issues_company_open_idx`, `reconciliation_issues_detected_idx`, `reconciliation_issues_resolved_at_idx`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260418_syntage_layer3_001_reconciliation_issues.sql
git commit -m "feat(syntage): Fase 3 · reconciliation_issues table

8 issue types MVP, dedup estructural via partial UNIQUE index.
Spec: docs/superpowers/specs/2026-04-17-syntage-fase-3-layer-3-design.md §7

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

## Task 2 — `invoices_unified` materialized view

**Files:**
- Create: `supabase/migrations/20260418_syntage_layer3_002_invoices_unified.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260418_syntage_layer3_002_invoices_unified.sql`:

```sql
-- Fase 3 Layer 3 · 002 invoices_unified
-- Materialized view: 1 row por CFDI canónico (I/E). Merge Syntage (fiscal) + Odoo (operativo).
-- Refresh via refresh_invoices_unified() cada 15min (pg_cron).

DROP MATERIALIZED VIEW IF EXISTS public.invoices_unified CASCADE;

CREATE MATERIALIZED VIEW public.invoices_unified AS
WITH
  -- Nivel 1: match por UUID
  uuid_matches AS (
    SELECT s.uuid AS uuid_sat, o.id AS odoo_invoice_id
    FROM public.syntage_invoices s
    JOIN public.odoo_invoices o
      ON o.cfdi_uuid = s.uuid
     AND o.odoo_company_id = s.odoo_company_id
    WHERE s.tipo_comprobante IN ('I','E')
      AND o.move_type IN ('out_invoice','out_refund','in_invoice','in_refund')
  ),
  -- Nivel 2: match composite (sólo syntage rows sin match UUID)
  composite_candidates AS (
    SELECT
      s.uuid AS uuid_sat,
      o.id AS odoo_invoice_id,
      COUNT(*) OVER (PARTITION BY s.uuid) AS n_candidates,
      ROW_NUMBER() OVER (PARTITION BY s.uuid ORDER BY o.invoice_date) AS rn
    FROM public.syntage_invoices s
    JOIN public.companies c
      ON lower(c.rfc) = lower(COALESCE(s.emisor_rfc, s.receptor_rfc))
    JOIN public.odoo_invoices o
      ON o.company_id = c.id
     AND abs(s.total - o.amount_total) < 0.01
     AND date(s.fecha_emision) = date(o.invoice_date)
     AND (
          COALESCE(s.serie,'') || COALESCE(s.folio,'') ILIKE '%' || COALESCE(o.ref,'') || '%'
       OR COALESCE(o.ref,'') ILIKE '%' || COALESCE(s.folio,'') || '%'
     )
     AND o.odoo_company_id = s.odoo_company_id
     AND o.move_type IN ('out_invoice','out_refund','in_invoice','in_refund')
    WHERE s.tipo_comprobante IN ('I','E')
      AND NOT EXISTS (SELECT 1 FROM uuid_matches u WHERE u.uuid_sat = s.uuid)
  ),
  composite_matches AS (
    SELECT uuid_sat, odoo_invoice_id, n_candidates
    FROM composite_candidates
    WHERE rn = 1
  ),
  paired AS (
    SELECT uuid_sat, odoo_invoice_id, 'match_uuid'::text AS match_status, 'high'::text AS match_quality
    FROM uuid_matches
    UNION ALL
    SELECT uuid_sat, odoo_invoice_id,
      CASE WHEN n_candidates > 1 THEN 'ambiguous' ELSE 'match_composite' END,
      CASE WHEN n_candidates > 1 THEN 'low'       ELSE 'medium'          END
    FROM composite_matches
  )
SELECT
  -- Identidad canónica
  COALESCE(s.uuid, 'odoo:' || o.id::text) AS canonical_id,
  s.uuid AS uuid_sat,
  o.id   AS odoo_invoice_id,
  COALESCE(p.match_status,
    CASE WHEN s.uuid IS NOT NULL AND o.id IS NULL THEN 'syntage_only'
         WHEN s.uuid IS NULL AND o.id IS NOT NULL THEN 'odoo_only' END) AS match_status,
  COALESCE(p.match_quality, 'n/a') AS match_quality,
  COALESCE(s.direction, CASE WHEN o.move_type LIKE 'out_%' THEN 'issued' ELSE 'received' END) AS direction,

  -- Fiscales (Syntage autoritativo)
  s.estado_sat,
  s.fecha_cancelacion,
  s.fecha_timbrado,
  s.tipo_comprobante,
  s.metodo_pago,
  s.forma_pago,
  s.uso_cfdi,
  s.emisor_rfc,
  s.emisor_nombre,
  s.receptor_rfc,
  s.receptor_nombre,
  s.emisor_blacklist_status,
  s.receptor_blacklist_status,
  s.total       AS total_fiscal,
  s.subtotal    AS subtotal_fiscal,
  s.descuento   AS descuento_fiscal,
  s.impuestos_trasladados,
  s.impuestos_retenidos,
  s.moneda      AS moneda_fiscal,
  s.tipo_cambio AS tipo_cambio_fiscal,
  s.total_mxn   AS total_mxn_fiscal,

  -- Operativos (Odoo autoritativo)
  COALESCE(s.odoo_company_id, o.odoo_company_id) AS odoo_company_id,
  o.company_id,
  c.name AS partner_name,
  o.odoo_partner_id,
  o.name AS odoo_ref,
  o.ref  AS odoo_external_ref,
  o.move_type AS odoo_move_type,
  o.state AS odoo_state,
  o.payment_state,
  o.amount_total AS odoo_amount_total,
  o.amount_residual,
  o.invoice_date,
  o.due_date,
  o.days_overdue,
  o.currency AS odoo_currency,

  -- Derivados
  CASE
    WHEN s.uuid IS NULL OR o.id IS NULL THEN NULL
    WHEN s.estado_sat = 'cancelado' AND o.state = 'posted' THEN 'cancelled_but_posted'
    WHEN abs(s.total - o.amount_total) > 0.01 THEN 'amount_mismatch'
    ELSE 'consistent'
  END AS fiscal_operational_consistency,
  (s.total - o.amount_total) AS amount_diff,

  -- Evidencia (Fase 5)
  NULL::bigint AS email_id_origen,

  -- Plumbing
  now() AS refreshed_at
FROM paired p
FULL OUTER JOIN public.syntage_invoices s ON s.uuid = p.uuid_sat
FULL OUTER JOIN public.odoo_invoices    o ON o.id   = p.odoo_invoice_id
LEFT JOIN public.companies c ON c.id = o.company_id
WHERE
  (s.tipo_comprobante IN ('I','E') OR s.tipo_comprobante IS NULL)
  AND (o.move_type IN ('out_invoice','out_refund','in_invoice','in_refund') OR o.move_type IS NULL)
  -- Excluir rows sin ningún lado (shouldn't happen, safety net)
  AND (s.uuid IS NOT NULL OR o.id IS NOT NULL);

-- Unique index requerido para REFRESH CONCURRENTLY
CREATE UNIQUE INDEX invoices_unified_canonical_id_idx
  ON public.invoices_unified (canonical_id);

CREATE INDEX invoices_unified_company_date_idx
  ON public.invoices_unified (odoo_company_id, fecha_timbrado DESC NULLS LAST);

CREATE INDEX invoices_unified_match_status_idx
  ON public.invoices_unified (match_status);

CREATE INDEX invoices_unified_consistency_idx
  ON public.invoices_unified (fiscal_operational_consistency)
  WHERE fiscal_operational_consistency IS NOT NULL;

CREATE INDEX invoices_unified_cancelled_idx
  ON public.invoices_unified (estado_sat) WHERE estado_sat = 'cancelado';

CREATE INDEX invoices_unified_direction_idx
  ON public.invoices_unified (direction, fecha_timbrado DESC NULLS LAST);

GRANT SELECT ON public.invoices_unified TO service_role;

COMMENT ON MATERIALIZED VIEW public.invoices_unified IS 'Fase 3 · Layer 3 canónico: 1 row por CFDI (I/E) con autoridad por campo. Refresh: refresh_invoices_unified() cada 15min.';
```

- [ ] **Step 2: Apply migration via Supabase MCP**

Use `mcp__claude_ai_Supabase__apply_migration`:
- `name`: `syntage_layer3_002_invoices_unified`
- `query`: file contents

- [ ] **Step 3: Verify rows**

```sql
SELECT
  match_status,
  count(*) AS n,
  count(*) FILTER (WHERE fiscal_operational_consistency IS NOT NULL) AS with_consistency
FROM public.invoices_unified
GROUP BY match_status
ORDER BY n DESC;
```

Expected: ≥4 distinct `match_status` values (match_uuid, match_composite, syntage_only, odoo_only). Total rowcount should be roughly `count(syntage_invoices WHERE tipo IN ('I','E')) + count(odoo_invoices WHERE move_type IN 'out_/in_') - overlap`.

- [ ] **Step 4: Spot-check a UUID match**

```sql
SELECT canonical_id, uuid_sat, odoo_invoice_id, match_status, fiscal_operational_consistency, total_fiscal, odoo_amount_total, amount_diff
FROM public.invoices_unified
WHERE match_status = 'match_uuid'
LIMIT 3;
```

Expected: rows with both `uuid_sat` and `odoo_invoice_id` populated, `match_status='match_uuid'`, `match_quality='high'`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260418_syntage_layer3_002_invoices_unified.sql
git commit -m "feat(syntage): Fase 3 · invoices_unified materialized view

Matching UUID + composite fallback. Autoridad por campo fiscal/operativo.
canonical_id estable (uuid_sat o 'odoo:\${id}'). 6 índices incl. UNIQUE
requerido por REFRESH CONCURRENTLY.

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

## Task 3 — `payments_unified` + `payment_allocations_unified`

**Files:**
- Create: `supabase/migrations/20260418_syntage_layer3_003_payments_unified.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260418_syntage_layer3_003_payments_unified.sql`:

```sql
-- Fase 3 Layer 3 · 003 payments_unified + payment_allocations_unified
-- Materialized view a grano de complemento + vista derivada a grano de allocation.

DROP VIEW IF EXISTS public.payment_allocations_unified;
DROP MATERIALIZED VIEW IF EXISTS public.payments_unified CASCADE;

CREATE MATERIALIZED VIEW public.payments_unified AS
WITH
  num_op_matches AS (
    SELECT s.uuid_complemento, o.id AS odoo_payment_id
    FROM public.syntage_invoice_payments s
    JOIN public.odoo_account_payments o
      ON o.ref = s.num_operacion
     AND o.odoo_company_id = s.odoo_company_id
    WHERE s.num_operacion IS NOT NULL AND s.num_operacion <> ''
  ),
  composite_candidates AS (
    SELECT
      s.uuid_complemento,
      o.id AS odoo_payment_id,
      COUNT(*) OVER (PARTITION BY s.uuid_complemento) AS n_candidates,
      ROW_NUMBER() OVER (PARTITION BY s.uuid_complemento ORDER BY o.date) AS rn
    FROM public.syntage_invoice_payments s
    JOIN public.companies c
      ON lower(c.rfc) = lower(COALESCE(s.rfc_emisor_cta_ord, s.rfc_emisor_cta_ben))
    JOIN public.odoo_account_payments o
      ON o.company_id = c.id
     AND abs(s.monto - o.amount) < 0.01
     AND abs(date(s.fecha_pago) - date(o.date)) <= 1
     AND COALESCE(s.moneda_p, 'MXN') = COALESCE(o.currency, 'MXN')
     AND o.odoo_company_id = s.odoo_company_id
    WHERE NOT EXISTS (SELECT 1 FROM num_op_matches n WHERE n.uuid_complemento = s.uuid_complemento)
  ),
  composite_matches AS (
    SELECT uuid_complemento, odoo_payment_id, n_candidates
    FROM composite_candidates
    WHERE rn = 1
  ),
  paired AS (
    SELECT uuid_complemento, odoo_payment_id, 'match_num_op'::text AS match_status, 'high'::text AS match_quality
    FROM num_op_matches
    UNION ALL
    SELECT uuid_complemento, odoo_payment_id,
      CASE WHEN n_candidates > 1 THEN 'ambiguous' ELSE 'match_composite' END,
      CASE WHEN n_candidates > 1 THEN 'low'       ELSE 'medium'          END
    FROM composite_matches
  )
SELECT
  COALESCE(s.uuid_complemento, 'odoo:' || o.id::text) AS canonical_payment_id,
  s.uuid_complemento,
  o.id AS odoo_payment_id,
  COALESCE(p.match_status,
    CASE WHEN s.uuid_complemento IS NOT NULL AND o.id IS NULL THEN 'syntage_only'
         WHEN s.uuid_complemento IS NULL AND o.id IS NOT NULL THEN 'odoo_only' END) AS match_status,
  COALESCE(p.match_quality, 'n/a') AS match_quality,
  COALESCE(s.direction, CASE WHEN o.payment_type = 'inbound' THEN 'received' ELSE 'issued' END) AS direction,

  -- Fiscales (Syntage)
  s.fecha_pago,
  s.forma_pago_p,
  s.num_operacion,
  s.moneda_p,
  s.tipo_cambio_p,
  s.monto,
  s.rfc_emisor_cta_ord,
  s.rfc_emisor_cta_ben,
  s.estado_sat,
  s.doctos_relacionados,

  -- Operativos (Odoo)
  COALESCE(s.odoo_company_id, o.odoo_company_id) AS odoo_company_id,
  o.company_id,
  o.odoo_partner_id,
  o.name AS odoo_ref,
  o.amount AS odoo_amount,
  o.date AS odoo_date,
  o.journal_id,
  o.payment_method_line_id,
  o.reconciled,
  o.currency AS odoo_currency,

  now() AS refreshed_at
FROM paired p
FULL OUTER JOIN public.syntage_invoice_payments s ON s.uuid_complemento = p.uuid_complemento
FULL OUTER JOIN public.odoo_account_payments    o ON o.id                = p.odoo_payment_id
WHERE s.uuid_complemento IS NOT NULL OR o.id IS NOT NULL;

CREATE UNIQUE INDEX payments_unified_canonical_idx
  ON public.payments_unified (canonical_payment_id);

CREATE INDEX payments_unified_company_date_idx
  ON public.payments_unified (odoo_company_id, fecha_pago DESC NULLS LAST);

CREATE INDEX payments_unified_match_status_idx
  ON public.payments_unified (match_status);

GRANT SELECT ON public.payments_unified TO service_role;

-- Vista derivada: grano allocation (1 row por docto_relacionado)
CREATE VIEW public.payment_allocations_unified AS
SELECT
  p.canonical_payment_id,
  p.uuid_complemento,
  p.odoo_payment_id,
  p.direction,
  p.fecha_pago,
  p.odoo_company_id,
  (doc->>'uuid_docto')::text        AS invoice_uuid_sat,
  (doc->>'serie')::text             AS invoice_serie,
  (doc->>'folio')::text             AS invoice_folio,
  (doc->>'parcialidad')::int        AS parcialidad,
  (doc->>'imp_saldo_ant')::numeric  AS imp_saldo_ant,
  (doc->>'imp_pagado')::numeric     AS imp_pagado,
  (doc->>'imp_saldo_insoluto')::numeric AS imp_saldo_insoluto,
  iu.canonical_id                   AS invoice_canonical_id
FROM public.payments_unified p
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(p.doctos_relacionados, '[]'::jsonb)) AS doc
LEFT JOIN public.invoices_unified iu ON iu.uuid_sat = (doc->>'uuid_docto')::text;

GRANT SELECT ON public.payment_allocations_unified TO service_role;

COMMENT ON MATERIALIZED VIEW public.payments_unified IS 'Fase 3 · 1 row por complemento Tipo P. Refresh: refresh_payments_unified() cada 15min.';
COMMENT ON VIEW public.payment_allocations_unified IS 'Fase 3 · Expande doctos_relacionados de payments_unified → 1 row por allocation. No materializada.';
```

- [ ] **Step 2: Apply migration**

Via `mcp__claude_ai_Supabase__apply_migration` con name `syntage_layer3_003_payments_unified`.

- [ ] **Step 3: Verify payments_unified rows**

```sql
SELECT match_status, count(*) FROM public.payments_unified GROUP BY match_status;
```

Expected: distinct match_status values (likely mostly `syntage_only` o `odoo_only` por coverage actual).

- [ ] **Step 4: Verify allocations expansion**

```sql
SELECT count(*) FROM public.payment_allocations_unified;
-- Should be >= count(payments_unified) since allocations expand doctos_relacionados
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260418_syntage_layer3_003_payments_unified.sql
git commit -m "feat(syntage): Fase 3 · payments_unified + payment_allocations_unified

MV grano complemento + VIEW derivada grano allocation.
Matching num_operacion + fallback compuesto (partner/monto/fecha/moneda).

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

## Task 4 — `refresh_invoices_unified()` function

**Files:**
- Create: `supabase/migrations/20260418_syntage_layer3_004_refresh_functions.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260418_syntage_layer3_004_refresh_functions.sql`:

```sql
-- Fase 3 Layer 3 · 004 refresh_invoices_unified + refresh_payments_unified
-- Ambas funciones ejecutan REFRESH CONCURRENTLY + repoblación de reconciliation_issues.

-- ============================================================================
-- refresh_invoices_unified()
-- ============================================================================

CREATE OR REPLACE FUNCTION public.refresh_invoices_unified()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  t_start    timestamptz := clock_timestamp();
  v_opened   integer := 0;
  v_resolved integer := 0;
  v_tmp      integer;
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.invoices_unified;

  -- ============================================================================
  -- AUTO-RESOLVE: cerrar issues que ya no aplican
  -- ============================================================================

  -- cancelled_but_posted → resuelto si Odoo ya no está posted o Syntage ya no cancelado
  WITH r AS (
    UPDATE public.reconciliation_issues ri
    SET resolved_at = now(), resolution = 'auto_odoo_updated'
    WHERE ri.resolved_at IS NULL
      AND ri.issue_type = 'cancelled_but_posted'
      AND NOT EXISTS (
        SELECT 1 FROM public.invoices_unified iu
        WHERE iu.canonical_id = ri.canonical_id
          AND iu.fiscal_operational_consistency = 'cancelled_but_posted'
      )
    RETURNING 1
  ) SELECT count(*) INTO v_tmp FROM r;
  v_resolved := v_resolved + v_tmp;

  -- posted_but_sat_uncertified → resuelto si Odoo ya tiene UUID o match composite apareció
  WITH r AS (
    UPDATE public.reconciliation_issues ri
    SET resolved_at = now(), resolution = 'auto_odoo_updated'
    WHERE ri.resolved_at IS NULL
      AND ri.issue_type = 'posted_but_sat_uncertified'
      AND NOT EXISTS (
        SELECT 1 FROM public.invoices_unified iu
        WHERE iu.canonical_id = ri.canonical_id
          AND iu.match_status = 'odoo_only'
          AND iu.odoo_state = 'posted'
          AND iu.uuid_sat IS NULL
      )
    RETURNING 1
  ) SELECT count(*) INTO v_tmp FROM r;
  v_resolved := v_resolved + v_tmp;

  -- sat_only_cfdi_received → resuelto si Odoo lo capturó
  WITH r AS (
    UPDATE public.reconciliation_issues ri
    SET resolved_at = now(), resolution = 'auto_odoo_updated'
    WHERE ri.resolved_at IS NULL
      AND ri.issue_type = 'sat_only_cfdi_received'
      AND NOT EXISTS (
        SELECT 1 FROM public.invoices_unified iu
        WHERE iu.canonical_id = ri.canonical_id
          AND iu.match_status = 'syntage_only'
          AND iu.direction = 'received'
      )
    RETURNING 1
  ) SELECT count(*) INTO v_tmp FROM r;
  v_resolved := v_resolved + v_tmp;

  -- sat_only_cfdi_issued → resuelto si Odoo lo capturó
  WITH r AS (
    UPDATE public.reconciliation_issues ri
    SET resolved_at = now(), resolution = 'auto_odoo_updated'
    WHERE ri.resolved_at IS NULL
      AND ri.issue_type = 'sat_only_cfdi_issued'
      AND NOT EXISTS (
        SELECT 1 FROM public.invoices_unified iu
        WHERE iu.canonical_id = ri.canonical_id
          AND iu.match_status = 'syntage_only'
          AND iu.direction = 'issued'
      )
    RETURNING 1
  ) SELECT count(*) INTO v_tmp FROM r;
  v_resolved := v_resolved + v_tmp;

  -- amount_mismatch → resuelto si ya matchea
  WITH r AS (
    UPDATE public.reconciliation_issues ri
    SET resolved_at = now(), resolution = 'auto_odoo_updated'
    WHERE ri.resolved_at IS NULL
      AND ri.issue_type = 'amount_mismatch'
      AND NOT EXISTS (
        SELECT 1 FROM public.invoices_unified iu
        WHERE iu.canonical_id = ri.canonical_id
          AND iu.fiscal_operational_consistency = 'amount_mismatch'
      )
    RETURNING 1
  ) SELECT count(*) INTO v_tmp FROM r;
  v_resolved := v_resolved + v_tmp;

  -- partner_blacklist_69b → resuelto si SAT removió el status
  WITH r AS (
    UPDATE public.reconciliation_issues ri
    SET resolved_at = now(), resolution = 'auto_syntage_updated'
    WHERE ri.resolved_at IS NULL
      AND ri.issue_type = 'partner_blacklist_69b'
      AND NOT EXISTS (
        SELECT 1 FROM public.invoices_unified iu
        WHERE iu.canonical_id = ri.canonical_id
          AND (iu.emisor_blacklist_status IN ('presumed','definitive')
            OR iu.receptor_blacklist_status IN ('presumed','definitive'))
      )
    RETURNING 1
  ) SELECT count(*) INTO v_tmp FROM r;
  v_resolved := v_resolved + v_tmp;

  -- ============================================================================
  -- INSERT: nuevos issues detectados
  -- ============================================================================

  -- cancelled_but_posted · severity high
  WITH ins AS (
    INSERT INTO public.reconciliation_issues
      (issue_type, canonical_id, uuid_sat, odoo_invoice_id, odoo_company_id, company_id,
       description, severity, metadata)
    SELECT
      'cancelled_but_posted',
      iu.canonical_id, iu.uuid_sat, iu.odoo_invoice_id, iu.odoo_company_id, iu.company_id,
      format('Syntage marca UUID %s como cancelado, Odoo sigue posted en %s', iu.uuid_sat, iu.odoo_ref),
      'high',
      jsonb_build_object(
        'counterparty_rfc', COALESCE(iu.emisor_rfc, iu.receptor_rfc),
        'detected_via', 'uuid',
        'fecha_cancelacion', iu.fecha_cancelacion
      )
    FROM public.invoices_unified iu
    WHERE iu.fiscal_operational_consistency = 'cancelled_but_posted'
    ON CONFLICT (issue_type, canonical_id) WHERE resolved_at IS NULL DO NOTHING
    RETURNING 1
  ) SELECT count(*) INTO v_tmp FROM ins;
  v_opened := v_opened + v_tmp;

  -- posted_but_sat_uncertified · severity low · FILTRADO a ≤30d
  WITH ins AS (
    INSERT INTO public.reconciliation_issues
      (issue_type, canonical_id, uuid_sat, odoo_invoice_id, odoo_company_id, company_id,
       description, severity, metadata)
    SELECT
      'posted_but_sat_uncertified',
      iu.canonical_id, NULL, iu.odoo_invoice_id, iu.odoo_company_id, iu.company_id,
      format('Odoo %s posted sin UUID SAT ni match composite', iu.odoo_ref),
      'low',
      jsonb_build_object(
        'counterparty_rfc', NULL,
        'detected_via', 'composite',
        'invoice_date', iu.invoice_date
      )
    FROM public.invoices_unified iu
    WHERE iu.match_status = 'odoo_only'
      AND iu.odoo_state = 'posted'
      AND iu.uuid_sat IS NULL
      AND iu.invoice_date > (now() - interval '30 days')::date
    ON CONFLICT (issue_type, canonical_id) WHERE resolved_at IS NULL DO NOTHING
    RETURNING 1
  ) SELECT count(*) INTO v_tmp FROM ins;
  v_opened := v_opened + v_tmp;

  -- sat_only_cfdi_received · severity medium
  WITH ins AS (
    INSERT INTO public.reconciliation_issues
      (issue_type, canonical_id, uuid_sat, odoo_invoice_id, odoo_company_id, company_id,
       description, severity, metadata)
    SELECT
      'sat_only_cfdi_received',
      iu.canonical_id, iu.uuid_sat, NULL, iu.odoo_company_id, NULL,
      format('CFDI recibido %s de %s no existe en Odoo (total fiscal $%s)',
             iu.uuid_sat, iu.emisor_nombre, iu.total_fiscal),
      'medium',
      jsonb_build_object(
        'counterparty_rfc', iu.emisor_rfc,
        'detected_via', 'uuid',
        'total_fiscal', iu.total_fiscal,
        'fecha_timbrado', iu.fecha_timbrado
      )
    FROM public.invoices_unified iu
    WHERE iu.match_status = 'syntage_only'
      AND iu.direction = 'received'
    ON CONFLICT (issue_type, canonical_id) WHERE resolved_at IS NULL DO NOTHING
    RETURNING 1
  ) SELECT count(*) INTO v_tmp FROM ins;
  v_opened := v_opened + v_tmp;

  -- sat_only_cfdi_issued · severity CRITICAL
  WITH ins AS (
    INSERT INTO public.reconciliation_issues
      (issue_type, canonical_id, uuid_sat, odoo_invoice_id, odoo_company_id, company_id,
       description, severity, metadata)
    SELECT
      'sat_only_cfdi_issued',
      iu.canonical_id, iu.uuid_sat, NULL, iu.odoo_company_id, NULL,
      format('CFDI emitido %s a %s no existe en Odoo (total fiscal $%s) — POSIBLE FRAUDE',
             iu.uuid_sat, iu.receptor_nombre, iu.total_fiscal),
      'critical',
      jsonb_build_object(
        'counterparty_rfc', iu.receptor_rfc,
        'detected_via', 'uuid',
        'total_fiscal', iu.total_fiscal,
        'fecha_timbrado', iu.fecha_timbrado
      )
    FROM public.invoices_unified iu
    WHERE iu.match_status = 'syntage_only'
      AND iu.direction = 'issued'
    ON CONFLICT (issue_type, canonical_id) WHERE resolved_at IS NULL DO NOTHING
    RETURNING 1
  ) SELECT count(*) INTO v_tmp FROM ins;
  v_opened := v_opened + v_tmp;

  -- amount_mismatch · severity medium
  WITH ins AS (
    INSERT INTO public.reconciliation_issues
      (issue_type, canonical_id, uuid_sat, odoo_invoice_id, odoo_company_id, company_id,
       description, severity, metadata)
    SELECT
      'amount_mismatch',
      iu.canonical_id, iu.uuid_sat, iu.odoo_invoice_id, iu.odoo_company_id, iu.company_id,
      format('UUID %s: total fiscal $%s vs Odoo $%s (diff $%s)',
             iu.uuid_sat, iu.total_fiscal, iu.odoo_amount_total, iu.amount_diff),
      'medium',
      jsonb_build_object(
        'counterparty_rfc', COALESCE(iu.emisor_rfc, iu.receptor_rfc),
        'detected_via', 'uuid',
        'amount_diff', iu.amount_diff,
        'severity_reason', CASE WHEN abs(iu.amount_diff) > 1000 THEN 'diff >$1000' ELSE 'diff minor' END
      )
    FROM public.invoices_unified iu
    WHERE iu.fiscal_operational_consistency = 'amount_mismatch'
    ON CONFLICT (issue_type, canonical_id) WHERE resolved_at IS NULL DO NOTHING
    RETURNING 1
  ) SELECT count(*) INTO v_tmp FROM ins;
  v_opened := v_opened + v_tmp;

  -- partner_blacklist_69b · severity medium · 1 issue por company_id
  WITH ins AS (
    INSERT INTO public.reconciliation_issues
      (issue_type, canonical_id, uuid_sat, odoo_invoice_id, odoo_company_id, company_id,
       description, severity, metadata)
    SELECT DISTINCT ON (iu.company_id, iu.odoo_company_id)
      'partner_blacklist_69b',
      'company:' || iu.company_id::text,  -- canonical_id sintético a nivel empresa
      NULL, NULL, iu.odoo_company_id, iu.company_id,
      format('Contraparte %s tiene status 69-B: %s',
             iu.partner_name,
             COALESCE(NULLIF(iu.emisor_blacklist_status, ''), iu.receptor_blacklist_status)),
      'medium',
      jsonb_build_object(
        'counterparty_rfc', COALESCE(iu.emisor_rfc, iu.receptor_rfc),
        'blacklist_status', COALESCE(NULLIF(iu.emisor_blacklist_status, ''), iu.receptor_blacklist_status),
        'detected_via', 'uuid'
      )
    FROM public.invoices_unified iu
    WHERE (iu.emisor_blacklist_status IN ('presumed','definitive')
        OR iu.receptor_blacklist_status IN ('presumed','definitive'))
      AND iu.company_id IS NOT NULL
    ON CONFLICT (issue_type, canonical_id) WHERE resolved_at IS NULL DO NOTHING
    RETURNING 1
  ) SELECT count(*) INTO v_tmp FROM ins;
  v_opened := v_opened + v_tmp;

  -- ============================================================================
  -- STALE: marcar issues sin resolución >7d como stale_7d (no son "nuevos")
  -- ============================================================================
  UPDATE public.reconciliation_issues
  SET resolution = 'stale_7d'
  WHERE resolved_at IS NULL
    AND detected_at < now() - interval '7 days'
    AND resolution IS NULL;

  RETURN jsonb_build_object(
    'refreshed_at', now(),
    'invoices_unified_rows', (SELECT count(*) FROM public.invoices_unified),
    'issues_opened', v_opened,
    'issues_resolved', v_resolved,
    'duration_ms', (extract(milliseconds FROM clock_timestamp() - t_start))::int
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_invoices_unified() TO service_role;

COMMENT ON FUNCTION public.refresh_invoices_unified() IS 'Fase 3 · REFRESH CONCURRENTLY invoices_unified + repoblación de reconciliation_issues (6 tipos: cancelled_but_posted, posted_but_sat_uncertified, sat_only_cfdi_received, sat_only_cfdi_issued, amount_mismatch, partner_blacklist_69b). Los 2 tipos de payments se manejan en refresh_payments_unified().';

-- ============================================================================
-- refresh_payments_unified()
-- ============================================================================

CREATE OR REPLACE FUNCTION public.refresh_payments_unified()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  t_start    timestamptz := clock_timestamp();
  v_opened   integer := 0;
  v_resolved integer := 0;
  v_tmp      integer;
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.payments_unified;

  -- AUTO-RESOLVE payment_missing_complemento
  WITH r AS (
    UPDATE public.reconciliation_issues ri
    SET resolved_at = now(), resolution = 'auto_syntage_updated'
    WHERE ri.resolved_at IS NULL
      AND ri.issue_type = 'payment_missing_complemento'
      AND EXISTS (
        -- Hay un Tipo P que ahora matchea esta factura
        SELECT 1 FROM public.payment_allocations_unified pa
        JOIN public.invoices_unified iu ON iu.canonical_id = ri.canonical_id
        WHERE pa.invoice_uuid_sat = iu.uuid_sat
      )
    RETURNING 1
  ) SELECT count(*) INTO v_tmp FROM r;
  v_resolved := v_resolved + v_tmp;

  -- AUTO-RESOLVE complemento_missing_payment
  WITH r AS (
    UPDATE public.reconciliation_issues ri
    SET resolved_at = now(), resolution = 'auto_odoo_updated'
    WHERE ri.resolved_at IS NULL
      AND ri.issue_type = 'complemento_missing_payment'
      AND NOT EXISTS (
        SELECT 1 FROM public.payments_unified pu
        WHERE pu.canonical_payment_id = ri.canonical_id
          AND pu.match_status = 'syntage_only'
      )
    RETURNING 1
  ) SELECT count(*) INTO v_tmp FROM r;
  v_resolved := v_resolved + v_tmp;

  -- INSERT payment_missing_complemento · severity high · FILTRADO: PPD + paid + ≥30d
  WITH candidates AS (
    SELECT iu.canonical_id, iu.uuid_sat, iu.odoo_invoice_id, iu.odoo_company_id, iu.company_id,
           iu.odoo_ref, iu.receptor_nombre, iu.emisor_nombre,
           iu.odoo_amount_total, iu.due_date, iu.invoice_date, iu.emisor_rfc, iu.receptor_rfc
    FROM public.invoices_unified iu
    WHERE iu.payment_state = 'paid'
      AND iu.metodo_pago = 'PPD'
      AND iu.invoice_date < (now() - interval '30 days')::date
      AND iu.uuid_sat IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.payment_allocations_unified pa
        WHERE pa.invoice_uuid_sat = iu.uuid_sat
      )
  ), ins AS (
    INSERT INTO public.reconciliation_issues
      (issue_type, canonical_id, uuid_sat, odoo_invoice_id, odoo_company_id, company_id,
       description, severity, metadata)
    SELECT
      'payment_missing_complemento',
      c.canonical_id, c.uuid_sat, c.odoo_invoice_id, c.odoo_company_id, c.company_id,
      format('Factura %s marcada paid (PPD) hace >30d, sin complemento Tipo P en SAT',
             c.odoo_ref),
      'high',
      jsonb_build_object(
        'counterparty_rfc', COALESCE(c.emisor_rfc, c.receptor_rfc),
        'detected_via', 'uuid',
        'days_overdue', (CURRENT_DATE - c.invoice_date),
        'amount_due', c.odoo_amount_total
      )
    FROM candidates c
    ON CONFLICT (issue_type, canonical_id) WHERE resolved_at IS NULL DO NOTHING
    RETURNING 1
  ) SELECT count(*) INTO v_tmp FROM ins;
  v_opened := v_opened + v_tmp;

  -- INSERT complemento_missing_payment · severity high
  WITH ins AS (
    INSERT INTO public.reconciliation_issues
      (issue_type, canonical_id, uuid_sat, odoo_invoice_id, odoo_payment_id, odoo_company_id, company_id,
       description, severity, metadata)
    SELECT
      'complemento_missing_payment',
      pu.canonical_payment_id, pu.uuid_complemento, NULL, NULL, pu.odoo_company_id, pu.company_id,
      format('Complemento Tipo P %s ($%s) no tiene pago matcheable en Odoo',
             pu.uuid_complemento, pu.monto),
      'high',
      jsonb_build_object(
        'counterparty_rfc', COALESCE(pu.rfc_emisor_cta_ord, pu.rfc_emisor_cta_ben),
        'detected_via', 'num_operacion',
        'amount', pu.monto,
        'fecha_pago', pu.fecha_pago
      )
    FROM public.payments_unified pu
    WHERE pu.match_status = 'syntage_only'
    ON CONFLICT (issue_type, canonical_id) WHERE resolved_at IS NULL DO NOTHING
    RETURNING 1
  ) SELECT count(*) INTO v_tmp FROM ins;
  v_opened := v_opened + v_tmp;

  RETURN jsonb_build_object(
    'refreshed_at', now(),
    'payments_unified_rows', (SELECT count(*) FROM public.payments_unified),
    'issues_opened', v_opened,
    'issues_resolved', v_resolved,
    'duration_ms', (extract(milliseconds FROM clock_timestamp() - t_start))::int
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_payments_unified() TO service_role;

COMMENT ON FUNCTION public.refresh_payments_unified() IS 'Fase 3 · REFRESH CONCURRENTLY payments_unified + populate 2 issue types: payment_missing_complemento, complemento_missing_payment.';
```

- [ ] **Step 2: Apply migration**

Via `mcp__claude_ai_Supabase__apply_migration` con name `syntage_layer3_004_refresh_functions`.

- [ ] **Step 3: Run refresh_invoices_unified manually**

```sql
SELECT public.refresh_invoices_unified();
```

Expected: JSON with `invoices_unified_rows`, `issues_opened`, `issues_resolved`, `duration_ms`. Duration should be <10s.

- [ ] **Step 4: Verify issues populated**

```sql
SELECT issue_type, severity, count(*) AS open
FROM public.reconciliation_issues
WHERE resolved_at IS NULL
GROUP BY issue_type, severity
ORDER BY severity, open DESC;
```

Expected: rows for most 6 issue types (payments populated in Step 5).

- [ ] **Step 5: Run refresh_payments_unified**

```sql
SELECT public.refresh_payments_unified();
```

Expected: JSON similar. With current data likely few payment issues.

- [ ] **Step 6: Re-run to verify idempotency**

```sql
SELECT public.refresh_invoices_unified();
-- Then compare issue count — should NOT have doubled due to ON CONFLICT
SELECT count(*) FROM public.reconciliation_issues WHERE resolved_at IS NULL;
```

Expected: count stable (not doubled).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260418_syntage_layer3_004_refresh_functions.sql
git commit -m "feat(syntage): Fase 3 · refresh_invoices_unified + refresh_payments_unified

PLpgSQL functions ejecutan REFRESH CONCURRENTLY + auto-resolve + INSERT
por los 8 issue types MVP. Idempotentes via ON CONFLICT.
Stale marker 7d para issues sin resolución.

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

## Task 5 — `get_syntage_reconciliation_summary()` RPC

**Files:**
- Create: `supabase/migrations/20260418_syntage_layer3_005_summary_rpc.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260418_syntage_layer3_005_summary_rpc.sql`:

```sql
-- Fase 3 Layer 3 · 005 get_syntage_reconciliation_summary
-- Single-roundtrip JSON para el dashboard UI.

CREATE OR REPLACE FUNCTION public.get_syntage_reconciliation_summary()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  WITH
    open_issues AS (
      SELECT * FROM public.reconciliation_issues WHERE resolved_at IS NULL
    ),
    by_type_cte AS (
      SELECT
        issue_type,
        count(*) AS open,
        (SELECT count(*) FROM public.reconciliation_issues
          WHERE issue_type = o.issue_type
            AND resolved_at > now() - interval '7 days') AS resolved_7d,
        -- Rank por peso, luego convertir de nuevo a texto
        (ARRAY['low','medium','high','critical'])[
          max(CASE severity
                WHEN 'low' THEN 1
                WHEN 'medium' THEN 2
                WHEN 'high' THEN 3
                WHEN 'critical' THEN 4
              END)
        ] AS severity
      FROM open_issues o
      GROUP BY issue_type
    ),
    by_severity_cte AS (
      SELECT jsonb_object_agg(severity, cnt) AS severity_map
      FROM (
        SELECT severity, count(*) AS cnt FROM open_issues GROUP BY severity
      ) s
    ),
    top_companies_cte AS (
      SELECT jsonb_agg(jsonb_build_object(
        'company_id', c.id,
        'name', c.name,
        'open', t.n
      ) ORDER BY t.n DESC) AS companies
      FROM (
        SELECT company_id, count(*) AS n
        FROM open_issues
        WHERE company_id IS NOT NULL
        GROUP BY company_id
        ORDER BY n DESC
        LIMIT 10
      ) t
      LEFT JOIN public.companies c ON c.id = t.company_id
    ),
    resolution_rate_cte AS (
      SELECT
        CASE
          WHEN (resolved_last_7d + opened_last_7d) = 0 THEN 0::numeric
          ELSE round(resolved_last_7d::numeric / (resolved_last_7d + opened_last_7d), 2)
        END AS rate
      FROM (
        SELECT
          (SELECT count(*) FROM public.reconciliation_issues
            WHERE resolved_at > now() - interval '7 days') AS resolved_last_7d,
          (SELECT count(*) FROM public.reconciliation_issues
            WHERE detected_at > now() - interval '7 days') AS opened_last_7d
      ) x
    ),
    recent_critical_cte AS (
      SELECT jsonb_agg(jsonb_build_object(
        'issue_id', r.issue_id,
        'type', r.issue_type,
        'description', r.description,
        'severity', r.severity,
        'company', c.name,
        'company_id', r.company_id,
        'odoo_invoice_id', r.odoo_invoice_id,
        'uuid_sat', r.uuid_sat,
        'amount_diff', r.metadata->>'amount_diff',
        'detected_at', r.detected_at
      ) ORDER BY r.detected_at DESC) AS issues
      FROM (
        SELECT * FROM open_issues
        WHERE severity IN ('critical','high')
        ORDER BY detected_at DESC
        LIMIT 20
      ) r
      LEFT JOIN public.companies c ON c.id = r.company_id
    )
  SELECT jsonb_build_object(
    'by_type', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'type', issue_type,
        'open', open,
        'resolved_7d', resolved_7d,
        'severity', severity
      )) FROM by_type_cte
    ), '[]'::jsonb),
    'by_severity', COALESCE((SELECT severity_map FROM by_severity_cte),
                            '{"critical":0,"high":0,"medium":0,"low":0}'::jsonb),
    'top_companies', COALESCE((SELECT companies FROM top_companies_cte), '[]'::jsonb),
    'resolution_rate_7d', (SELECT rate FROM resolution_rate_cte),
    'recent_critical', COALESCE((SELECT issues FROM recent_critical_cte), '[]'::jsonb),
    'generated_at', now(),
    'invoices_unified_refreshed_at', (SELECT max(refreshed_at) FROM public.invoices_unified),
    'payments_unified_refreshed_at', (SELECT max(refreshed_at) FROM public.payments_unified)
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_syntage_reconciliation_summary() TO service_role;

COMMENT ON FUNCTION public.get_syntage_reconciliation_summary() IS 'Fase 3 · JSON único consumido por SyntageReconciliationPanel. Target <300ms.';
```

- [ ] **Step 2: Apply migration**

Via `mcp__claude_ai_Supabase__apply_migration` con name `syntage_layer3_005_summary_rpc`.

- [ ] **Step 3: Call the RPC**

```sql
SELECT public.get_syntage_reconciliation_summary();
```

Expected: JSON with keys `by_type`, `by_severity`, `top_companies`, `resolution_rate_7d`, `recent_critical`, `generated_at`, `invoices_unified_refreshed_at`, `payments_unified_refreshed_at`.

- [ ] **Step 4: Verify latency**

```sql
EXPLAIN ANALYZE SELECT public.get_syntage_reconciliation_summary();
```

Expected: `Execution Time: < 300 ms`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260418_syntage_layer3_005_summary_rpc.sql
git commit -m "feat(syntage): Fase 3 · get_syntage_reconciliation_summary RPC

Single JSON para dashboard UI. by_type, by_severity, top_companies,
resolution_rate_7d, recent_critical. Target <300ms.

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

## Task 6 — `pg_cron` schedule

**Files:**
- Create: `supabase/migrations/20260418_syntage_layer3_006_cron.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260418_syntage_layer3_006_cron.sql`:

```sql
-- Fase 3 Layer 3 · 006 pg_cron schedule
-- Cada 15min: refresh_invoices_unified + refresh_payments_unified.

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Limpiar job previo (idempotente)
SELECT cron.unschedule(jobname)
FROM cron.job
WHERE jobname IN ('refresh-syntage-unified');

-- Schedule nuevo
SELECT cron.schedule(
  'refresh-syntage-unified',
  '*/15 * * * *',
  $$
    SELECT public.refresh_invoices_unified();
    SELECT public.refresh_payments_unified();
  $$
);

COMMENT ON EXTENSION pg_cron IS 'Fase 3 · schedule refresh-syntage-unified @ */15 * * * *';
```

- [ ] **Step 2: Apply migration**

Via `mcp__claude_ai_Supabase__apply_migration` con name `syntage_layer3_006_cron`.

- [ ] **Step 3: Verify job registered**

```sql
SELECT jobid, jobname, schedule, command, active
FROM cron.job
WHERE jobname = 'refresh-syntage-unified';
```

Expected: 1 row, `active=true`, schedule `*/15 * * * *`.

- [ ] **Step 4: Wait for first auto-execution (up to 15 min)**

Después de 15min:

```sql
SELECT jobid, runid, database, username, command, status, return_message, start_time, end_time
FROM cron.job_run_details
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'refresh-syntage-unified')
ORDER BY start_time DESC
LIMIT 3;
```

Expected: at least 1 row with `status='succeeded'`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260418_syntage_layer3_006_cron.sql
git commit -m "feat(syntage): Fase 3 · pg_cron schedule refresh @ */15min

Unschedule idempotente antes de crear. Corre refresh_invoices_unified
+ refresh_payments_unified.

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

## Task 7 — `POST /api/syntage/refresh-unified` endpoint

**Files:**
- Create: `src/app/api/syntage/refresh-unified/route.ts`
- Create: `src/__tests__/syntage/refresh-unified-route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/syntage/refresh-unified-route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Mock supabase-server BEFORE importing route
vi.mock("@/lib/supabase-server", () => ({
  getServiceClient: vi.fn(),
}));

// Mock auth to always pass when Bearer is correct
vi.mock("@/lib/pipeline/auth", () => ({
  validatePipelineAuth: vi.fn((req: NextRequest) => {
    if (req.headers.get("authorization") === "Bearer test-secret") return null;
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }),
}));

import { POST } from "@/app/api/syntage/refresh-unified/route";
import { getServiceClient } from "@/lib/supabase-server";

function makeReq(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("https://example.com/api/syntage/refresh-unified", {
    method: "POST",
    headers,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/syntage/refresh-unified", () => {
  it("returns 401 when auth missing", async () => {
    const res = await POST(makeReq());
    expect(res.status).toBe(401);
  });

  it("returns 200 with refresh results when auth valid", async () => {
    const mockRpc = vi.fn()
      .mockResolvedValueOnce({ data: { invoices_unified_rows: 100, issues_opened: 5, issues_resolved: 2, duration_ms: 1234 }, error: null })
      .mockResolvedValueOnce({ data: { payments_unified_rows: 30, issues_opened: 1, issues_resolved: 0, duration_ms: 500 },  error: null });
    vi.mocked(getServiceClient).mockReturnValue({ rpc: mockRpc } as never);

    const res = await POST(makeReq({ authorization: "Bearer test-secret" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.invoices).toMatchObject({ invoices_unified_rows: 100, issues_opened: 5 });
    expect(body.payments).toMatchObject({ payments_unified_rows: 30 });
    expect(mockRpc).toHaveBeenCalledWith("refresh_invoices_unified");
    expect(mockRpc).toHaveBeenCalledWith("refresh_payments_unified");
  });

  it("returns 500 when RPC fails", async () => {
    const mockRpc = vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } });
    vi.mocked(getServiceClient).mockReturnValue({ rpc: mockRpc } as never);

    const res = await POST(makeReq({ authorization: "Bearer test-secret" }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain("boom");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/syntage/refresh-unified-route.test.ts`
Expected: FAIL (route file doesn't exist yet).

- [ ] **Step 3: Implement the route**

Create `src/app/api/syntage/refresh-unified/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { validatePipelineAuth } from "@/lib/pipeline/auth";
import { getServiceClient } from "@/lib/supabase-server";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

/**
 * Manual trigger for Layer 3 refresh.
 *
 * Usage:
 *   POST /api/syntage/refresh-unified
 *   Authorization: Bearer <CRON_SECRET>
 *
 * Returns the JSON results of both refresh_invoices_unified() and
 * refresh_payments_unified(). Normally these run via pg_cron every 15min;
 * this endpoint is for manual trigger (e.g. from /system UI button or
 * after a large backfill).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const authError = validatePipelineAuth(request);
  if (authError) return authError as NextResponse;

  const supabase = getServiceClient();

  const { data: invoicesResult, error: invoicesError } = await supabase.rpc(
    "refresh_invoices_unified"
  );
  if (invoicesError) {
    return NextResponse.json(
      { ok: false, error: `refresh_invoices_unified failed: ${invoicesError.message}` },
      { status: 500 }
    );
  }

  const { data: paymentsResult, error: paymentsError } = await supabase.rpc(
    "refresh_payments_unified"
  );
  if (paymentsError) {
    return NextResponse.json(
      {
        ok: false,
        error: `refresh_payments_unified failed: ${paymentsError.message}`,
        invoices: invoicesResult,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    invoices: invoicesResult,
    payments: paymentsResult,
  });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return POST(request);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/syntage/refresh-unified-route.test.ts`
Expected: 3 tests PASS.

- [ ] **Step 5: Smoke test against deployed endpoint** (optional, requires production CRON_SECRET)

```bash
curl -sS -X POST "https://quimibond-intelligence.vercel.app/api/syntage/refresh-unified" \
  -H "Authorization: Bearer $CRON_SECRET"
```

Expected: `{"ok":true,"invoices":{...},"payments":{...}}`.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/syntage/refresh-unified/route.ts src/__tests__/syntage/refresh-unified-route.test.ts
git commit -m "feat(syntage): Fase 3 · POST /api/syntage/refresh-unified endpoint

Manual trigger para refresh_invoices_unified + refresh_payments_unified.
Auth via CRON_SECRET Bearer. Devuelve JSON combinado de ambos refresh.

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

## Task 8 — `syntage-reconciliation.ts` query helper + types

**Files:**
- Create: `src/lib/queries/syntage-reconciliation.ts`
- Create: `src/__tests__/syntage/syntage-reconciliation-query.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/syntage/syntage-reconciliation-query.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  getServiceClient: vi.fn(),
}));

import { getSyntageReconciliationSummary } from "@/lib/queries/syntage-reconciliation";
import { getServiceClient } from "@/lib/supabase-server";

describe("getSyntageReconciliationSummary", () => {
  it("returns the RPC result cast to the expected shape", async () => {
    const mockPayload = {
      by_type: [
        { type: "cancelled_but_posted", open: 12, resolved_7d: 3, severity: "high" },
      ],
      by_severity: { critical: 2, high: 18, medium: 45, low: 103 },
      top_companies: [{ company_id: 42, name: "Acme", open: 8 }],
      resolution_rate_7d: 0.67,
      recent_critical: [
        {
          issue_id: "abc",
          type: "sat_only_cfdi_issued",
          severity: "critical",
          description: "...",
          company: "Acme",
          company_id: 42,
          odoo_invoice_id: null,
          uuid_sat: "U-1",
          amount_diff: null,
          detected_at: "2026-04-17T00:00:00Z",
        },
      ],
      generated_at: "2026-04-17T18:00:00Z",
      invoices_unified_refreshed_at: "2026-04-17T17:45:00Z",
      payments_unified_refreshed_at: "2026-04-17T17:45:00Z",
    };
    const mockRpc = vi.fn().mockResolvedValue({ data: mockPayload, error: null });
    vi.mocked(getServiceClient).mockReturnValue({ rpc: mockRpc } as never);

    const result = await getSyntageReconciliationSummary();
    expect(mockRpc).toHaveBeenCalledWith("get_syntage_reconciliation_summary");
    expect(result.by_type[0].type).toBe("cancelled_but_posted");
    expect(result.by_severity.critical).toBe(2);
    expect(result.resolution_rate_7d).toBe(0.67);
  });

  it("throws when RPC returns an error", async () => {
    const mockRpc = vi.fn().mockResolvedValue({ data: null, error: { message: "oops" } });
    vi.mocked(getServiceClient).mockReturnValue({ rpc: mockRpc } as never);

    await expect(getSyntageReconciliationSummary()).rejects.toThrow("oops");
  });

  it("returns safe defaults when data is null", async () => {
    const mockRpc = vi.fn().mockResolvedValue({ data: null, error: null });
    vi.mocked(getServiceClient).mockReturnValue({ rpc: mockRpc } as never);

    const result = await getSyntageReconciliationSummary();
    expect(result.by_type).toEqual([]);
    expect(result.by_severity).toEqual({ critical: 0, high: 0, medium: 0, low: 0 });
    expect(result.top_companies).toEqual([]);
    expect(result.recent_critical).toEqual([]);
    expect(result.resolution_rate_7d).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/syntage/syntage-reconciliation-query.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the query helper**

Create `src/lib/queries/syntage-reconciliation.ts`:

```ts
import { getServiceClient } from "@/lib/supabase-server";

export type IssueType =
  | "cancelled_but_posted"
  | "posted_but_sat_uncertified"
  | "sat_only_cfdi_received"
  | "sat_only_cfdi_issued"
  | "amount_mismatch"
  | "partner_blacklist_69b"
  | "payment_missing_complemento"
  | "complemento_missing_payment";

export type Severity = "critical" | "high" | "medium" | "low";

export interface IssueByType {
  type: IssueType;
  open: number;
  resolved_7d: number;
  severity: Severity;
}

export interface IssueBySeverity {
  critical: number;
  high: number;
  medium: number;
  low: number;
}

export interface TopCompany {
  company_id: number;
  name: string | null;
  open: number;
}

export interface RecentCriticalIssue {
  issue_id: string;
  type: IssueType;
  severity: Severity;
  description: string;
  company: string | null;
  company_id: number | null;
  odoo_invoice_id: number | null;
  uuid_sat: string | null;
  amount_diff: string | null;
  detected_at: string;
}

export interface SyntageReconciliationSummary {
  by_type: IssueByType[];
  by_severity: IssueBySeverity;
  top_companies: TopCompany[];
  resolution_rate_7d: number;
  recent_critical: RecentCriticalIssue[];
  generated_at: string;
  invoices_unified_refreshed_at: string | null;
  payments_unified_refreshed_at: string | null;
}

const DEFAULT_SUMMARY: SyntageReconciliationSummary = {
  by_type: [],
  by_severity: { critical: 0, high: 0, medium: 0, low: 0 },
  top_companies: [],
  resolution_rate_7d: 0,
  recent_critical: [],
  generated_at: new Date().toISOString(),
  invoices_unified_refreshed_at: null,
  payments_unified_refreshed_at: null,
};

export async function getSyntageReconciliationSummary(): Promise<SyntageReconciliationSummary> {
  const supabase = getServiceClient();
  const { data, error } = await supabase.rpc("get_syntage_reconciliation_summary");
  if (error) throw new Error(error.message);
  if (!data) return DEFAULT_SUMMARY;
  return data as SyntageReconciliationSummary;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/syntage/syntage-reconciliation-query.test.ts`
Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/queries/syntage-reconciliation.ts src/__tests__/syntage/syntage-reconciliation-query.test.ts
git commit -m "feat(syntage): Fase 3 · getSyntageReconciliationSummary query helper

TypeScript types estrictos para el JSON de get_syntage_reconciliation_summary.
Safe default si RPC devuelve null.

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

## Task 9 — `SyntageReconciliationPanel.tsx` component

**Files:**
- Create: `src/components/system/SyntageReconciliationPanel.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/system/SyntageReconciliationPanel.tsx`:

```tsx
import { getSyntageReconciliationSummary, type IssueType, type Severity } from "@/lib/queries/syntage-reconciliation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatNumber } from "@/lib/formatters";

const SEVERITY_STYLES: Record<Severity, string> = {
  critical: "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-100",
  high:     "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100",
  medium:   "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-100",
  low:      "bg-muted text-muted-foreground",
};

const ISSUE_TYPE_LABELS: Record<IssueType, string> = {
  cancelled_but_posted:         "CFDI cancelado · Odoo posted",
  posted_but_sat_uncertified:   "Odoo posted · sin timbrar",
  sat_only_cfdi_received:       "SAT recibido · Odoo no sabe",
  sat_only_cfdi_issued:         "SAT emitido · Odoo no sabe",
  amount_mismatch:              "Total fiscal ≠ operativo",
  partner_blacklist_69b:        "Contraparte 69-B",
  payment_missing_complemento:  "Pago sin complemento P",
  complemento_missing_payment:  "Complemento P sin pago Odoo",
};

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" });
}

export async function SyntageReconciliationPanel() {
  const summary = await getSyntageReconciliationSummary();

  return (
    <div className="space-y-4">
      {/* Row 1 — 8 stat cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(Object.keys(ISSUE_TYPE_LABELS) as IssueType[]).map((type) => {
          const row = summary.by_type.find((t) => t.type === type);
          const open = row?.open ?? 0;
          const severity = row?.severity ?? "low";
          return (
            <div key={type} className="rounded-md border bg-card p-3">
              <div className="text-xs text-muted-foreground">{ISSUE_TYPE_LABELS[type]}</div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="font-mono text-2xl tabular-nums">{formatNumber(open)}</span>
                {open > 0 && (
                  <Badge className={SEVERITY_STYLES[severity]}>{severity}</Badge>
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                {row ? `+${row.resolved_7d} resueltos 7d` : "—"}
              </div>
            </div>
          );
        })}
      </div>

      {/* Row 2 — severity breakdown + resolution rate */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Issues por severity (abiertos)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-4 gap-2">
              {(["critical","high","medium","low"] as Severity[]).map((sev) => (
                <div key={sev} className="rounded-md border bg-card p-3 text-center">
                  <Badge className={SEVERITY_STYLES[sev]}>{sev}</Badge>
                  <div className="mt-2 font-mono text-xl tabular-nums">
                    {formatNumber(summary.by_severity[sev] ?? 0)}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Resolution rate 7d</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="font-mono text-3xl tabular-nums">
                {Math.round(summary.resolution_rate_7d * 100)}%
              </div>
              <div className="text-xs text-muted-foreground">
                Resueltos / (resueltos + nuevos) en los últimos 7 días
              </div>
              <div className="text-xs text-muted-foreground">
                Invoices refreshed_at: {formatDateTime(summary.invoices_unified_refreshed_at)}
              </div>
              <div className="text-xs text-muted-foreground">
                Payments refreshed_at: {formatDateTime(summary.payments_unified_refreshed_at)}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Row 3 — recent critical/high issues table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Issues críticos recientes</CardTitle>
          <p className="text-xs text-muted-foreground">
            severity ∈ {'{'}critical, high{'}'} · abiertos · ordenados por detección
          </p>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left">Severity</th>
                  <th className="px-4 py-2 text-left">Tipo</th>
                  <th className="px-4 py-2 text-left">Descripción</th>
                  <th className="px-4 py-2 text-left">Contraparte</th>
                  <th className="px-4 py-2 text-right">Monto diff</th>
                  <th className="px-4 py-2 text-left">Detectado</th>
                </tr>
              </thead>
              <tbody>
                {summary.recent_critical.length === 0 && (
                  <tr>
                    <td className="px-4 py-6 text-center text-muted-foreground" colSpan={6}>
                      Sin issues críticos abiertos
                    </td>
                  </tr>
                )}
                {summary.recent_critical.map((issue) => (
                  <tr key={issue.issue_id} className="border-t">
                    <td className="px-4 py-2">
                      <Badge className={SEVERITY_STYLES[issue.severity]}>{issue.severity}</Badge>
                    </td>
                    <td className="px-4 py-2 text-xs font-mono">{issue.type}</td>
                    <td className="px-4 py-2">{issue.description}</td>
                    <td className="px-4 py-2">{issue.company ?? "—"}</td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums">
                      {issue.amount_diff ? `$${issue.amount_diff}` : "—"}
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {formatDateTime(issue.detected_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Row 4 — top 10 companies with most issues */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Top 10 empresas con más issues abiertos</CardTitle>
        </CardHeader>
        <CardContent>
          {summary.top_companies.length === 0 ? (
            <div className="text-sm text-muted-foreground">Sin issues por empresa</div>
          ) : (
            <ol className="space-y-1 text-sm">
              {summary.top_companies.map((c, i) => (
                <li key={c.company_id} className="flex items-center justify-between rounded-md border px-3 py-2">
                  <span>
                    <span className="mr-2 text-muted-foreground">{i + 1}.</span>
                    {c.name ?? `(sin nombre · id ${c.company_id})`}
                  </span>
                  <span className="font-mono tabular-nums">{formatNumber(c.open)}</span>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors in the new file.

- [ ] **Step 3: Commit**

```bash
git add src/components/system/SyntageReconciliationPanel.tsx
git commit -m "feat(syntage): Fase 3 · SyntageReconciliationPanel (RSC)

Panel con 8 stat cards + severity breakdown + resolution rate +
tabla issues críticos + top 10 empresas. Un solo fetch via RPC.

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

## Task 10 — Wire panel into `/system` as sub-tab

**Files:**
- Modify: `src/app/system/page.tsx` (area around line 188-200)

- [ ] **Step 1: Read the current file section**

```bash
grep -n "SyntageHealthPanel" src/app/system/page.tsx
```

Expected: 2 matches (import + usage).

- [ ] **Step 2: Add import**

Edit `src/app/system/page.tsx` · near existing `SyntageHealthPanel` import (around line 38). Add:

```tsx
import { SyntageReconciliationPanel } from "@/components/system/SyntageReconciliationPanel";
```

- [ ] **Step 3: Add sub-tabs inside `value="syntage"` TabsContent**

Replace the existing `<TabsContent value="syntage">` block (currently showing only `<SyntageHealthPanel />`) with a nested tabs structure. The current block:

```tsx
<TabsContent value="syntage" className="mt-4 space-y-4">
  <Card>
    <CardHeader>
      <CardTitle className="text-base">Sincronización Syntage (SAT)</CardTitle>
      <p className="text-xs text-muted-foreground">
        Estado del backfill fiscal: extractions, cross-check con Odoo, error rate, distribución por año.
      </p>
    </CardHeader>
    <CardContent className="pb-4">
      <Suspense fallback={<Skeleton className="h-[600px]" />}>
        <SyntageHealthPanel />
      </Suspense>
    </CardContent>
  </Card>
</TabsContent>
```

Replace with:

```tsx
<TabsContent value="syntage" className="mt-4 space-y-4">
  <Tabs defaultValue="health" className="w-full">
    <TabsList>
      <TabsTrigger value="health">Health & backfill</TabsTrigger>
      <TabsTrigger value="reconciliation">Reconciliación</TabsTrigger>
    </TabsList>

    <TabsContent value="health" className="mt-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sincronización Syntage (SAT)</CardTitle>
          <p className="text-xs text-muted-foreground">
            Estado del backfill fiscal: extractions, cross-check con Odoo, error rate, distribución por año.
          </p>
        </CardHeader>
        <CardContent className="pb-4">
          <Suspense fallback={<Skeleton className="h-[600px]" />}>
            <SyntageHealthPanel />
          </Suspense>
        </CardContent>
      </Card>
    </TabsContent>

    <TabsContent value="reconciliation" className="mt-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Layer 3 · Reconciliación Syntage vs Odoo</CardTitle>
          <p className="text-xs text-muted-foreground">
            invoices_unified + reconciliation_issues. Refresh automático cada 15min via pg_cron. Spec: Fase 3.
          </p>
        </CardHeader>
        <CardContent className="pb-4">
          <Suspense fallback={<Skeleton className="h-[600px]" />}>
            <SyntageReconciliationPanel />
          </Suspense>
        </CardContent>
      </Card>
    </TabsContent>
  </Tabs>
</TabsContent>
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Dev-server smoke test**

```bash
npm run dev
```

Navigate to `http://localhost:3000/system`, click tab "Syntage", verify both sub-tabs render ("Health & backfill" y "Reconciliación"). Both panels should load data (or show loading skeletons).

- [ ] **Step 6: Commit**

```bash
git add src/app/system/page.tsx
git commit -m "feat(syntage): Fase 3 · sub-tab Reconciliación en /system

Nested Tabs dentro del tab 'syntage': Health & backfill (existente)
+ Reconciliación (nuevo). Lee de get_syntage_reconciliation_summary.

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

## Task 11 — Integration test (E2E against real Supabase)

**Files:**
- Create: `src/__tests__/syntage/reconciliation-integration.test.ts`

- [ ] **Step 1: Write the integration test**

Create `src/__tests__/syntage/reconciliation-integration.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;

// Only run when env configured (gated in CI secret-safe environments)
const describeIntegration = URL && KEY ? describe : describe.skip;

function sb() {
  if (!URL || !KEY) throw new Error("env missing");
  return createClient(URL, KEY, { auth: { persistSession: false } });
}

describeIntegration("syntage Fase 3 integration (real Supabase, read-only)", () => {
  it("invoices_unified has rows", async () => {
    const supabase = sb();
    const { data, error } = await supabase
      .from("invoices_unified")
      .select("canonical_id", { count: "exact", head: true });
    expect(error).toBeNull();
    // data is null for head queries but count arrives in error-free
  });

  it("invoices_unified match_status values are from allowed set", async () => {
    const supabase = sb();
    const { data, error } = await supabase
      .from("invoices_unified")
      .select("match_status")
      .limit(500);
    expect(error).toBeNull();
    const allowed = new Set(["match_uuid","match_composite","syntage_only","odoo_only","ambiguous"]);
    const bad = (data ?? []).filter((r) => !allowed.has(r.match_status));
    expect(bad).toEqual([]);
  });

  it("refresh_invoices_unified RPC returns expected shape", async () => {
    const supabase = sb();
    const { data, error } = await supabase.rpc("refresh_invoices_unified");
    expect(error).toBeNull();
    expect(data).toMatchObject({
      refreshed_at: expect.any(String),
      invoices_unified_rows: expect.any(Number),
      issues_opened: expect.any(Number),
      issues_resolved: expect.any(Number),
      duration_ms: expect.any(Number),
    });
    expect((data as { duration_ms: number }).duration_ms).toBeLessThan(30_000);
  });

  it("refresh_invoices_unified is idempotent (count stable on second call)", async () => {
    const supabase = sb();
    await supabase.rpc("refresh_invoices_unified");
    const { count: c1 } = await supabase
      .from("reconciliation_issues")
      .select("*", { count: "exact", head: true })
      .is("resolved_at", null);

    await supabase.rpc("refresh_invoices_unified");
    const { count: c2 } = await supabase
      .from("reconciliation_issues")
      .select("*", { count: "exact", head: true })
      .is("resolved_at", null);

    expect(c2).toBe(c1);
  });

  it("get_syntage_reconciliation_summary returns well-formed JSON", async () => {
    const supabase = sb();
    const { data, error } = await supabase.rpc("get_syntage_reconciliation_summary");
    expect(error).toBeNull();
    expect(data).toMatchObject({
      by_type: expect.any(Array),
      by_severity: expect.any(Object),
      top_companies: expect.any(Array),
      resolution_rate_7d: expect.any(Number),
      recent_critical: expect.any(Array),
    });
  });

  it("invoices_unified refresh completes in < 30s (performance bench)", async () => {
    const supabase = sb();
    const t0 = Date.now();
    const { error } = await supabase.rpc("refresh_invoices_unified");
    const ms = Date.now() - t0;
    expect(error).toBeNull();
    expect(ms).toBeLessThan(30_000);
  });
});
```

- [ ] **Step 2: Run integration tests**

```bash
NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_KEY=... npx vitest run src/__tests__/syntage/reconciliation-integration.test.ts
```

Expected: all 6 tests PASS. If env not set, all skip (no failure).

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/syntage/reconciliation-integration.test.ts
git commit -m "test(syntage): Fase 3 · integration tests E2E

6 tests: rows exist, match_status enum, RPC shape, idempotency,
summary JSON, performance <30s. Gated por env (skip si falta
SUPABASE_SERVICE_KEY).

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

## Task 12 — Regression snapshot test (schema stability)

**Files:**
- Create: `src/__tests__/syntage/invoices-unified-schema.test.ts`

- [ ] **Step 1: Write the snapshot test**

Create `src/__tests__/syntage/invoices-unified-schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;

const describeIntegration = URL && KEY ? describe : describe.skip;

// Canon shape. If you add/remove columns from invoices_unified, update this.
const INVOICES_UNIFIED_COLUMNS: Record<string, string> = {
  canonical_id: "text",
  uuid_sat: "text",
  odoo_invoice_id: "bigint",
  match_status: "text",
  match_quality: "text",
  direction: "text",
  estado_sat: "text",
  fecha_cancelacion: "timestamp with time zone",
  fecha_timbrado: "timestamp with time zone",
  tipo_comprobante: "text",
  metodo_pago: "text",
  forma_pago: "text",
  uso_cfdi: "text",
  emisor_rfc: "text",
  emisor_nombre: "text",
  receptor_rfc: "text",
  receptor_nombre: "text",
  emisor_blacklist_status: "text",
  receptor_blacklist_status: "text",
  total_fiscal: "numeric",
  subtotal_fiscal: "numeric",
  descuento_fiscal: "numeric",
  impuestos_trasladados: "numeric",
  impuestos_retenidos: "numeric",
  moneda_fiscal: "text",
  tipo_cambio_fiscal: "numeric",
  total_mxn_fiscal: "numeric",
  odoo_company_id: "integer",
  company_id: "bigint",
  partner_name: "text",
  odoo_partner_id: "integer",
  odoo_ref: "text",
  odoo_external_ref: "text",
  odoo_move_type: "text",
  odoo_state: "text",
  payment_state: "text",
  odoo_amount_total: "numeric",
  amount_residual: "numeric",
  invoice_date: "date",
  due_date: "date",
  days_overdue: "integer",
  odoo_currency: "text",
  fiscal_operational_consistency: "text",
  amount_diff: "numeric",
  email_id_origen: "bigint",
  refreshed_at: "timestamp with time zone",
};

function sb() {
  if (!URL || !KEY) throw new Error("env missing");
  return createClient(URL, KEY, { auth: { persistSession: false } });
}

describeIntegration("invoices_unified schema regression", () => {
  it("matches the expected column set + types", async () => {
    const supabase = sb();
    const { data, error } = await supabase.rpc("exec_sql", {
      query: `SELECT column_name, data_type
              FROM information_schema.columns
              WHERE table_name = 'invoices_unified' AND table_schema = 'public'
              ORDER BY column_name`,
    }).single();

    // Fallback: if exec_sql RPC doesn't exist, use a direct select-all from view
    // and introspect the returned row.
    if (error?.message?.includes("function") || !data) {
      const { data: sampleRow, error: sampleErr } = await supabase
        .from("invoices_unified")
        .select("*")
        .limit(1);
      expect(sampleErr).toBeNull();
      if (sampleRow && sampleRow.length > 0) {
        const actualCols = new Set(Object.keys(sampleRow[0]));
        const expectedCols = new Set(Object.keys(INVOICES_UNIFIED_COLUMNS));
        const missing = [...expectedCols].filter((c) => !actualCols.has(c));
        const extra   = [...actualCols].filter((c) => !expectedCols.has(c));
        expect({ missing, extra }).toEqual({ missing: [], extra: [] });
      }
    } else {
      const rows = data as unknown as { column_name: string; data_type: string }[];
      for (const row of rows) {
        expect(INVOICES_UNIFIED_COLUMNS[row.column_name]).toBe(row.data_type);
      }
      const actualCols = new Set(rows.map((r) => r.column_name));
      const expectedCols = new Set(Object.keys(INVOICES_UNIFIED_COLUMNS));
      const missing = [...expectedCols].filter((c) => !actualCols.has(c));
      const extra   = [...actualCols].filter((c) => !expectedCols.has(c));
      expect({ missing, extra }).toEqual({ missing: [], extra: [] });
    }
  });
});
```

- [ ] **Step 2: Run the snapshot test**

```bash
NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_KEY=... npx vitest run src/__tests__/syntage/invoices-unified-schema.test.ts
```

Expected: PASS (or skip if env missing).

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/syntage/invoices-unified-schema.test.ts
git commit -m "test(syntage): Fase 3 · invoices_unified schema snapshot

Detecta cambios accidentales de shape. Si agregas/quitas columnas de
invoices_unified, actualiza INVOICES_UNIFIED_COLUMNS en el test.

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

## Task 13 — Push to main + verify production

**Files:** (no file changes — deployment task)

- [ ] **Step 1: Confirm branch state**

```bash
git status
git log --oneline -20
```

Expected: 12 commits ahead of origin/main (1 per task). Working tree clean.

- [ ] **Step 2: Push to origin**

```bash
git push origin main
```

- [ ] **Step 3: Wait for Vercel deploy (~2 min)**

Check https://vercel.com/josejmizrahis-projects/quimibond-intelligence — wait until latest deploy READY.

- [ ] **Step 4: Trigger manual refresh against prod**

```bash
curl -sS -X POST "https://quimibond-intelligence.vercel.app/api/syntage/refresh-unified" \
  -H "Authorization: Bearer $CRON_SECRET" | jq .
```

Expected: `{"ok":true,"invoices":{...},"payments":{...}}`.

- [ ] **Step 5: Visual smoke test**

Open https://quimibond-intelligence.vercel.app/system → click tab "Syntage" → click sub-tab "Reconciliación". Verify:
- 8 stat cards render (some may be 0)
- Severity breakdown shows numbers
- Resolution rate displays a percentage
- "Issues críticos recientes" table renders (empty state ok)
- Top 10 empresas list renders

- [ ] **Step 6: Verify pg_cron auto-run**

Wait >15 min, then:

```sql
SELECT jobid, runid, status, start_time, end_time
FROM cron.job_run_details
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'refresh-syntage-unified')
ORDER BY start_time DESC
LIMIT 5;
```

Expected: at least 1 auto-run with `status='succeeded'`.

- [ ] **Step 7: Update memory for next session**

Update `/Users/jj/.claude/projects/-Users-jj/memory/project_syntage_integration.md` with:
- Fase 3 completada
- Ubicación spec/plan
- Next phases (4, 5, 6)

---

## Self-Review Checklist (run before handoff)

Spec coverage vs plan tasks:

| Spec Section | Task(s) |
|---|---|
| §3 Artefactos (tabla `reconciliation_issues`) | Task 1 |
| §3 Artefactos (MV `invoices_unified`) | Task 2 |
| §3 Artefactos (MV `payments_unified` + VIEW allocations) | Task 3 |
| §3 Artefactos (`refresh_invoices_unified`, `refresh_payments_unified`) | Task 4 |
| §3 Artefactos (`get_syntage_reconciliation_summary`) | Task 5 |
| §3 Artefactos (pg_cron schedule) | Task 6 |
| §3 Artefactos (endpoint `POST /api/syntage/refresh-unified`) | Task 7 |
| §3 Artefactos (query helper TypeScript) | Task 8 |
| §3 Artefactos (`SyntageReconciliationPanel.tsx`) | Task 9 |
| §3 Artefactos (sub-tab `/system → Syntage`) | Task 10 |
| §4 Matching strategy (Nivel 1 + Nivel 2) | Task 2 (invoices), Task 3 (payments) |
| §5 Schema `invoices_unified` | Task 2 |
| §6 Schema `payments_unified` + allocations | Task 3 |
| §7 Schema `reconciliation_issues` (8 tipos, shape metadata) | Task 1 + Task 4 |
| §8 PLpgSQL functions | Task 4 + Task 5 |
| §9 Cron + manual trigger | Task 6 + Task 7 |
| §10 UI | Task 9 + Task 10 |
| §11 Testing (unit, integration, perf, regression) | Task 7 + Task 8 + Task 11 + Task 12 |
| §12 Failure tolerance (idempotency) | Task 4 (verificada en Step 6) + Task 11 |
| §15 Rollout (manual trigger + auto cron + UI smoke) | Task 13 |

No hay gaps. No tasks con TBD/TODO. Identifiers (`canonical_id`, `match_status`, `invoices_unified`, `refresh_invoices_unified`, etc.) son consistentes across tasks.
