# Fase 2.5 — Unificación de entidades y puente op↔fiscal: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir el puente explícito Odoo↔Syntage (`invoice_bridge`, `reconcile_invoice_manually`) + unificar las 4 entidades con gap residual (productos, órdenes, personas, precios históricos) + podar 6 views financieras redundantes.

**Architecture:** Solo migrations SQL en `quimibond-intelligence` (frontend repo) en branch `fase-2-5-unificacion`. Cada task = 1 commit. Operaciones destructivas (DROP view wrappers, DROP legacy views) requieren OK explícito del usuario antes del merge. El addon qb19 **no se toca** en esta fase (los cambios son read-only desde el punto de vista del push de Odoo). Frontend CLAUDE.md se actualiza al final.

**Tech Stack:** PostgreSQL 15 (Supabase `tozqezmivpblmcubmnpi`), SQL puro.

**Spec:** `/Users/jj/docs/superpowers/specs/2026-04-20-supabase-audit-06-unificacion.md`

---

## Pre-audit state (verificado 2026-04-20)

Queries ejecutadas contra Supabase producción confirman:

| Item | Valor confirmado |
|---|---|
| MVs totales | 36 (vs 35 que decía master plan) |
| `invoices_unified` | 96,500 rows, 257 MB, refreshed 2026-04-20 20:30 UTC |
| `payments_unified` | 41,255 rows, 32 MB |
| `cfdi_documents` | **Dropeada** (no aparece en pg_class) |
| `cfdi_invoice_match` view | **Dropeada** |
| Bridge UUID coverage | 10,553 match / 13,985 odoo con uuid / 27,760 total |
| Orphans Syntage issued post-2021 sin Odoo | 42,539 |
| Orphans Odoo posted post-2021 sin UUID | 5,251 |
| `odoo_payment_invoice_links` | 14,005 rows |
| `analytics_*` views | 12 existentes, 6 son thin wrappers (<300 chars) |
| `reconciliation_issues` open | 44,629 / 80,165 |
| `odoo_products.internal_ref` distintos | 5,997 |
| `syntage_invoice_line_items` | 166,723 rows |
| Productos SAT mapping table | **No existe** |
| `cash_position`/`cfo_dashboard`/`working_capital` | Viven — con overlap parcial |

**Supuestos cerrados sin necesidad de reconfirmar:**
- La capa unified (invoices_unified, payments_unified, company_profile*) está sana post-Fase 1.
- `odoo_payments` (legacy) está dropeada post-Fase 2.
- `cfdi_uuid` tiene UNIQUE partial index activo.

---

## File Structure

### Branch `fase-2-5-unificacion` en `/Users/jj/quimibond-intelligence/quimibond-intelligence`

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `supabase/migrations/20260421_fase25_00_baseline.sql` | Create | Snapshot de baseline en `audit_runs` |
| `supabase/migrations/20260421_fase25_01_invoice_bridge.sql` | Create | `invoice_bridge` view + `invoice_bridge_manual` tbl + indexes |
| `supabase/migrations/20260421_fase25_02_reconcile_invoice_fn.sql` | Create | `reconcile_invoice_manually()` function |
| `supabase/migrations/20260421_fase25_03_composite_matcher_fn.sql` | Create | `match_unlinked_invoices_by_composite()` function |
| `supabase/migrations/20260421_fase25_04_reconcile_payment_fn.sql` | Create | `reconcile_payment_manually()` function |
| `supabase/migrations/20260421_fase25_05_products_fiscal_map.sql` | Create | `products_fiscal_map` table + seed top 20 |
| `supabase/migrations/20260421_fase25_06_products_unified_view.sql` | Create | `products_unified` view |
| `supabase/migrations/20260421_fase25_07_product_price_history_mv.sql` | Create | `product_price_history` MV + add to `refresh_all_matviews` |
| `supabase/migrations/20260421_fase25_08_orders_unified_view.sql` | Create | `orders_unified` view |
| `supabase/migrations/20260421_fase25_09_order_fulfillment_bridge.sql` | Create | `order_fulfillment_bridge` view |
| `supabase/migrations/20260421_fase25_10_person_unified_view.sql` | Create | `person_unified` view |
| `supabase/migrations/20260421_fase25_11_backfill_contact_from_employee.sql` | Create | Trigger + backfill |
| `supabase/migrations/20260421_fase25_12_drop_analytics_wrappers.sql` | Create (gated) | DROP 6 wrappers thin |
| `supabase/migrations/20260421_fase25_13_consolidate_monthly_revenue.sql` | Create (gated) | Unificar monthly_revenue_trend + monthly_revenue_by_company |
| `supabase/migrations/20260421_fase25_14_final.sql` | Create | Snapshot final + invariantes |
| `docs/superpowers/plans/2026-04-21-supabase-audit-fase-2-5-audit-notes.md` | Create | Evidence pre/post |
| `CLAUDE.md` (frontend) | Modify | Añadir nuevos views/tables a sección `## Base de datos` |

---

## Pre-flight

### Task 0: Pre-flight audit + baseline snapshot

**Files:**
- Create: `quimibond-intelligence/quimibond-intelligence/docs/superpowers/plans/2026-04-21-supabase-audit-fase-2-5-audit-notes.md`
- Create: `quimibond-intelligence/quimibond-intelligence/supabase/migrations/20260421_fase25_00_baseline.sql`

- [ ] **Step 1: Crear branch**

```bash
cd /Users/jj/quimibond-intelligence/quimibond-intelligence
git checkout main
git pull origin main
git checkout -b fase-2-5-unificacion
```

- [ ] **Step 2: Ejecutar queries de baseline en Supabase**

```sql
-- Save outputs en audit-notes.md bajo ## Antes
-- 1) Bridge metrics
SELECT
  (SELECT count(*) FROM odoo_invoices) AS total_odoo,
  (SELECT count(*) FROM odoo_invoices WHERE cfdi_uuid IS NOT NULL) AS odoo_with_uuid,
  (SELECT count(*) FROM syntage_invoices) AS total_syntage,
  (SELECT count(*) FROM syntage_invoices s WHERE direction='issued' AND fecha_timbrado >= '2021-01-01' AND NOT EXISTS (SELECT 1 FROM odoo_invoices o WHERE o.cfdi_uuid=s.uuid)) AS syntage_issued_unmatched_2021,
  (SELECT count(*) FROM odoo_invoices WHERE state='posted' AND cfdi_uuid IS NULL AND move_type IN ('out_invoice','out_refund') AND invoice_date>='2021-01-01') AS odoo_customer_no_uuid_2021,
  (SELECT count(*) FROM invoices_unified) AS invoices_unified_rows,
  (SELECT count(*) FROM reconciliation_issues WHERE resolved_at IS NULL) AS issues_open;

-- 2) Products mapping
SELECT
  (SELECT count(*) FROM odoo_products) AS products_total,
  (SELECT count(DISTINCT internal_ref) FROM odoo_products WHERE internal_ref IS NOT NULL AND length(internal_ref) >= 4) AS distinct_refs_min4,
  (SELECT count(*) FROM syntage_invoice_line_items) AS syntage_lines;

-- 3) Orders
SELECT
  (SELECT count(*) FROM odoo_sale_orders) AS sale_orders,
  (SELECT count(*) FROM odoo_purchase_orders) AS purchase_orders,
  (SELECT count(*) FROM odoo_order_lines) AS order_lines_total;

-- 4) Persons
SELECT
  (SELECT count(*) FROM contacts) AS contacts_total,
  (SELECT count(*) FROM odoo_users) AS users_total,
  (SELECT count(*) FROM odoo_employees) AS employees_total,
  (SELECT count(*) FROM odoo_employees WHERE work_email IS NOT NULL AND NOT EXISTS (SELECT 1 FROM contacts c WHERE lower(c.email)=lower(odoo_employees.work_email))) AS employees_without_contact;

-- 5) Finance views to drop
SELECT viewname, length(pg_get_viewdef(format('public.%I', viewname)::regclass)::text) AS def_len
FROM pg_views WHERE schemaname='public' AND viewname LIKE 'analytics_%'
ORDER BY def_len;
```

- [ ] **Step 3: Escribir migration baseline**

`supabase/migrations/20260421_fase25_00_baseline.sql`:

```sql
-- Fase 2.5 baseline: snapshot antes de crear bridges y unificaciones
INSERT INTO public.audit_runs (run_id, invariant_key, severity, source, model, details, run_at)
SELECT
  gen_random_uuid(),
  'phase_2_5_baseline',
  'ok',
  'supabase',
  'baseline',
  jsonb_build_object(
    'invoice_bridge_exists', (SELECT count(*) FROM pg_views WHERE schemaname='public' AND viewname='invoice_bridge'),
    'invoice_bridge_manual_exists', (SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename='invoice_bridge_manual'),
    'products_unified_exists', (SELECT count(*) FROM pg_views WHERE schemaname='public' AND viewname='products_unified'),
    'products_fiscal_map_exists', (SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename='products_fiscal_map'),
    'product_price_history_exists', (SELECT count(*) FROM pg_matviews WHERE schemaname='public' AND matviewname='product_price_history'),
    'orders_unified_exists', (SELECT count(*) FROM pg_views WHERE schemaname='public' AND viewname='orders_unified'),
    'person_unified_exists', (SELECT count(*) FROM pg_views WHERE schemaname='public' AND viewname='person_unified'),
    'analytics_wrappers_count', (SELECT count(*) FROM pg_views WHERE schemaname='public' AND viewname LIKE 'analytics_finance_%' OR viewname LIKE 'analytics_revenue_%'),
    'reconciliation_issues_open', (SELECT count(*) FROM reconciliation_issues WHERE resolved_at IS NULL),
    'odoo_invoices_with_uuid', (SELECT count(*) FROM odoo_invoices WHERE cfdi_uuid IS NOT NULL),
    'syntage_issued_unmatched_2021', (
      SELECT count(*) FROM syntage_invoices s
      WHERE direction='issued' AND fecha_timbrado >= '2021-01-01'
        AND NOT EXISTS (SELECT 1 FROM odoo_invoices o WHERE o.cfdi_uuid=s.uuid)
    )
  ),
  now();
```

Ejecutar vía `mcp__claude_ai_Supabase__execute_sql`. Expected: `INSERT 0 1`.

- [ ] **Step 4: Escribir audit-notes.md con `## Antes`**

Pegar los 5 resultados de Step 2 en `docs/superpowers/plans/2026-04-21-supabase-audit-fase-2-5-audit-notes.md` bajo `## Antes`.

- [ ] **Step 5: Commit**

```bash
cd /Users/jj/quimibond-intelligence/quimibond-intelligence
git add supabase/migrations/20260421_fase25_00_baseline.sql docs/superpowers/plans/2026-04-21-supabase-audit-fase-2-5-audit-notes.md
git commit -m "docs(audit): fase 2.5 unificación pre-flight baseline"
```

---

## Fase A — Bridge operativo↔fiscal (no destructivo)

### Task 1: `invoice_bridge` view + `invoice_bridge_manual` tabla

**Files:**
- Create: `supabase/migrations/20260421_fase25_01_invoice_bridge.sql`

- [ ] **Step 1: Verificar columnas disponibles en `invoices_unified`**

```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='invoices_unified'
ORDER BY ordinal_position;
-- Expected (confirmed 2026-04-20): canonical_id, uuid_sat, odoo_invoice_id, match_status, match_quality,
-- direction, estado_sat, fecha_timbrado, odoo_state, payment_state, odoo_amount_total_mxn,
-- total_mxn_fiscal, amount_diff, invoice_date, emisor_rfc, receptor_rfc, company_id, partner_name.
```

- [ ] **Step 2: Escribir migration**

`supabase/migrations/20260421_fase25_01_invoice_bridge.sql`:

```sql
BEGIN;

-- Tabla de overrides manuales (append-only)
CREATE TABLE IF NOT EXISTS public.invoice_bridge_manual (
  id bigserial PRIMARY KEY,
  odoo_invoice_id bigint,
  syntage_uuid text,
  linked_by text NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT now(),
  note text,
  CONSTRAINT invoice_bridge_manual_unique UNIQUE (odoo_invoice_id, syntage_uuid),
  CONSTRAINT invoice_bridge_manual_not_both_null CHECK (odoo_invoice_id IS NOT NULL OR syntage_uuid IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_invoice_bridge_manual_odoo
  ON public.invoice_bridge_manual (odoo_invoice_id) WHERE odoo_invoice_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invoice_bridge_manual_syntage
  ON public.invoice_bridge_manual (syntage_uuid) WHERE syntage_uuid IS NOT NULL;

COMMENT ON TABLE public.invoice_bridge_manual IS
  'Overrides manuales del bridge invoice Odoo↔Syntage. Append-only. Usa reconcile_invoice_manually() para insertar.';

-- View del bridge (cheap SELECT de invoices_unified)
CREATE OR REPLACE VIEW public.invoice_bridge AS
SELECT
  iu.canonical_id,
  iu.odoo_invoice_id,
  iu.uuid_sat AS syntage_uuid,
  iu.direction,
  iu.match_status,
  iu.match_quality AS match_confidence,
  CASE
    WHEN iu.odoo_invoice_id IS NOT NULL AND iu.uuid_sat IS NOT NULL THEN 'uuid_exact'
    WHEN iu.odoo_invoice_id IS NOT NULL AND iu.uuid_sat IS NULL THEN 'odoo_only'
    WHEN iu.odoo_invoice_id IS NULL AND iu.uuid_sat IS NOT NULL THEN 'syntage_only'
    ELSE 'none'
  END AS match_method,
  iu.odoo_amount_total_mxn AS amount_op,
  iu.total_mxn_fiscal      AS amount_sat,
  iu.amount_diff,
  iu.invoice_date          AS date_op,
  iu.fecha_timbrado::date  AS date_sat,
  iu.odoo_state            AS state_op,
  iu.estado_sat            AS state_sat,
  iu.payment_state,
  iu.emisor_rfc,
  iu.receptor_rfc,
  iu.company_id,
  iu.partner_name,
  -- Gap flags
  (iu.odoo_invoice_id IS NOT NULL AND iu.uuid_sat IS NULL AND iu.invoice_date >= '2021-01-01'::date) AS is_gap_missing_sat,
  (iu.odoo_invoice_id IS NULL AND iu.uuid_sat IS NOT NULL AND iu.fecha_timbrado >= '2021-01-01'::timestamptz) AS is_gap_missing_odoo,
  (iu.odoo_state = 'cancel' AND iu.estado_sat = 'vigente') AS is_state_mismatch_cancel_vigente,
  (iu.odoo_state = 'posted' AND iu.estado_sat = 'cancelado') AS is_state_mismatch_posted_cancel,
  -- Manual link flag
  EXISTS (
    SELECT 1 FROM public.invoice_bridge_manual m
    WHERE (m.odoo_invoice_id = iu.odoo_invoice_id)
       OR (m.syntage_uuid = iu.uuid_sat)
  ) AS has_manual_link
FROM public.invoices_unified iu;

COMMENT ON VIEW public.invoice_bridge IS
  'Puente operativo (Odoo) ↔ fiscal (Syntage). Cada fila = factura con su contraparte, método de match, y flags de gap.';

INSERT INTO public.schema_changes (change_type, object_name, notes) VALUES
  ('create_table','invoice_bridge_manual','Fase 2.5 — overrides manuales bridge Odoo↔Syntage'),
  ('create_view','invoice_bridge','Fase 2.5 — view unificada de bridge con flags de gap');

COMMIT;
```

- [ ] **Step 3: Smoke test**

```sql
-- Cada fila de invoices_unified aparece en invoice_bridge
SELECT
  (SELECT count(*) FROM invoices_unified) AS iu_count,
  (SELECT count(*) FROM invoice_bridge) AS bridge_count;
-- Expected: iguales

-- Gaps hoy
SELECT count(*) FILTER (WHERE is_gap_missing_sat) AS gaps_missing_sat,
       count(*) FILTER (WHERE is_gap_missing_odoo) AS gaps_missing_odoo
FROM invoice_bridge;
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260421_fase25_01_invoice_bridge.sql
git commit -m "feat(db): add invoice_bridge view + invoice_bridge_manual table"
```

---

### Task 2: Función `reconcile_invoice_manually()`

**Files:**
- Create: `supabase/migrations/20260421_fase25_02_reconcile_invoice_fn.sql`

- [ ] **Step 1: Migration**

```sql
BEGIN;

CREATE OR REPLACE FUNCTION public.reconcile_invoice_manually(
  p_odoo_invoice_id bigint,
  p_syntage_uuid text,
  p_linked_by text,
  p_note text DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_id bigint;
  v_existing_uuid text;
BEGIN
  IF p_odoo_invoice_id IS NULL AND p_syntage_uuid IS NULL THEN
    RAISE EXCEPTION 'Al menos uno de odoo_invoice_id o syntage_uuid debe ser NOT NULL';
  END IF;

  IF p_linked_by IS NULL OR p_linked_by = '' THEN
    RAISE EXCEPTION 'linked_by es obligatorio (quién hizo el link)';
  END IF;

  -- Insert del manual link (idempotente)
  INSERT INTO public.invoice_bridge_manual (odoo_invoice_id, syntage_uuid, linked_by, note)
  VALUES (p_odoo_invoice_id, p_syntage_uuid, p_linked_by, p_note)
  ON CONFLICT (odoo_invoice_id, syntage_uuid)
  DO UPDATE SET note = EXCLUDED.note, linked_by = EXCLUDED.linked_by, linked_at = now()
  RETURNING id INTO v_id;

  -- Poblar cfdi_uuid en odoo_invoices si estaba NULL
  IF p_odoo_invoice_id IS NOT NULL AND p_syntage_uuid IS NOT NULL THEN
    SELECT cfdi_uuid INTO v_existing_uuid FROM public.odoo_invoices WHERE id = p_odoo_invoice_id;
    IF v_existing_uuid IS NULL THEN
      UPDATE public.odoo_invoices SET cfdi_uuid = p_syntage_uuid WHERE id = p_odoo_invoice_id;
    ELSIF v_existing_uuid <> p_syntage_uuid THEN
      RAISE WARNING 'odoo_invoice % already has cfdi_uuid % (distinto al solicitado %) — manual link guardado pero NO se sobrescribe odoo_invoices.cfdi_uuid',
        p_odoo_invoice_id, v_existing_uuid, p_syntage_uuid;
    END IF;
  END IF;

  -- Resolver issues relacionados
  UPDATE public.reconciliation_issues ri
  SET resolved_at = now(),
      resolution = format('manual_link by %s: %s', p_linked_by, COALESCE(p_note,''))
  WHERE ri.resolved_at IS NULL
    AND ri.issue_type IN ('sat_only_cfdi_issued','sat_only_cfdi_received','cancelled_but_posted')
    AND (
      (p_odoo_invoice_id IS NOT NULL AND ri.odoo_invoice_id = p_odoo_invoice_id) OR
      (p_syntage_uuid IS NOT NULL AND ri.uuid_sat = p_syntage_uuid)
    );

  RETURN v_id;
END $$;

COMMENT ON FUNCTION public.reconcile_invoice_manually IS
  'UX reconciliation: vincula manualmente factura Odoo ↔ CFDI SAT. Pobla cfdi_uuid si NULL (nunca sobrescribe). Resuelve issues.';

INSERT INTO public.schema_changes (change_type, object_name, notes)
VALUES ('create_function','reconcile_invoice_manually(bigint,text,text,text)','Fase 2.5 — reconciliación manual invoice bridge');

COMMIT;
```

- [ ] **Step 2: Smoke test**

```sql
-- Test con un odoo_invoice_id sin uuid y un syntage_uuid sin odoo_invoice_id
-- (fabricar par sintético que no existe para evitar side-effects)
SELECT public.reconcile_invoice_manually(
  NULL,
  '00000000-0000-0000-0000-000000000000',
  'smoke_test',
  'phase 2.5 smoke'
);
-- Verify: row en invoice_bridge_manual
SELECT * FROM public.invoice_bridge_manual WHERE linked_by='smoke_test';
-- Cleanup
DELETE FROM public.invoice_bridge_manual WHERE linked_by='smoke_test';
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260421_fase25_02_reconcile_invoice_fn.sql
git commit -m "feat(db): reconcile_invoice_manually() function"
```

---

### Task 3: Función `match_unlinked_invoices_by_composite()`

**Files:**
- Create: `supabase/migrations/20260421_fase25_03_composite_matcher_fn.sql`

- [ ] **Step 1: Migration**

```sql
BEGIN;

CREATE OR REPLACE FUNCTION public.match_unlinked_invoices_by_composite(
  p_batch_size integer DEFAULT 500,
  p_date_tolerance_days integer DEFAULT 3,
  p_amount_tolerance numeric DEFAULT 0.01
) RETURNS TABLE (
  odoo_invoice_id bigint,
  syntage_uuid text,
  emisor_rfc text,
  amount_mxn numeric,
  invoice_date date,
  match_confidence text
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH odoo_unmatched AS (
    SELECT o.id AS odoo_id, o.cfdi_uuid, o.amount_total_mxn, o.invoice_date,
           CASE WHEN o.move_type IN ('out_invoice','out_refund') THEN 'PNT920218IW5' ELSE NULL END AS emisor_if_customer,
           o.odoo_partner_id
    FROM public.odoo_invoices o
    WHERE o.state='posted'
      AND o.cfdi_uuid IS NULL
      AND o.invoice_date >= '2021-01-01'
  ),
  syntage_unmatched AS (
    SELECT s.uuid, s.emisor_rfc, s.total_mxn, s.fecha_timbrado::date AS fecha,
           s.direction
    FROM public.syntage_invoices s
    WHERE s.fecha_timbrado >= '2021-01-01'
      AND NOT EXISTS (SELECT 1 FROM public.odoo_invoices o2 WHERE o2.cfdi_uuid = s.uuid)
  )
  SELECT ou.odoo_id,
         su.uuid,
         su.emisor_rfc,
         su.total_mxn,
         ou.invoice_date,
         CASE
           WHEN su.total_mxn = ou.amount_total_mxn AND su.fecha = ou.invoice_date THEN 'high'
           WHEN abs(su.total_mxn - ou.amount_total_mxn) <= p_amount_tolerance
                AND abs(su.fecha - ou.invoice_date) <= p_date_tolerance_days THEN 'medium'
           ELSE 'low'
         END
  FROM odoo_unmatched ou
  JOIN syntage_unmatched su ON (
    abs(su.total_mxn - ou.amount_total_mxn) <= p_amount_tolerance
    AND abs(su.fecha - ou.invoice_date) <= p_date_tolerance_days
  )
  LIMIT p_batch_size;
END $$;

COMMENT ON FUNCTION public.match_unlinked_invoices_by_composite IS
  'Sugiere matches operativo↔fiscal por composite (amount_mxn + date tolerance). Diagnóstico — no aplica auto-links.';

INSERT INTO public.schema_changes (change_type, object_name, notes)
VALUES ('create_function','match_unlinked_invoices_by_composite(int,int,numeric)','Fase 2.5 — composite matcher para diagnóstico');

COMMIT;
```

- [ ] **Step 2: Smoke test**

```sql
SELECT match_confidence, count(*) FROM public.match_unlinked_invoices_by_composite(1000)
GROUP BY 1 ORDER BY 1;
-- Expected: >=1 row (high/medium/low)
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260421_fase25_03_composite_matcher_fn.sql
git commit -m "feat(db): match_unlinked_invoices_by_composite() diagnostic function"
```

---

### Task 4: Función `reconcile_payment_manually()`

**Files:**
- Create: `supabase/migrations/20260421_fase25_04_reconcile_payment_fn.sql`

- [ ] **Step 1: Migration**

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS public.payment_bridge_manual (
  id bigserial PRIMARY KEY,
  odoo_payment_id bigint,
  syntage_complemento_uuid text,
  linked_by text NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT now(),
  note text,
  CONSTRAINT payment_bridge_manual_unique UNIQUE (odoo_payment_id, syntage_complemento_uuid),
  CONSTRAINT payment_bridge_manual_not_both_null CHECK (odoo_payment_id IS NOT NULL OR syntage_complemento_uuid IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_payment_bridge_manual_op ON public.payment_bridge_manual (odoo_payment_id) WHERE odoo_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payment_bridge_manual_sat ON public.payment_bridge_manual (syntage_complemento_uuid) WHERE syntage_complemento_uuid IS NOT NULL;

CREATE OR REPLACE FUNCTION public.reconcile_payment_manually(
  p_odoo_payment_id bigint,
  p_syntage_complemento_uuid text,
  p_linked_by text,
  p_note text DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE v_id bigint;
BEGIN
  IF p_odoo_payment_id IS NULL AND p_syntage_complemento_uuid IS NULL THEN
    RAISE EXCEPTION 'Al menos uno de odoo_payment_id o syntage_complemento_uuid debe ser NOT NULL';
  END IF;
  IF p_linked_by IS NULL OR p_linked_by = '' THEN
    RAISE EXCEPTION 'linked_by es obligatorio';
  END IF;

  INSERT INTO public.payment_bridge_manual (odoo_payment_id, syntage_complemento_uuid, linked_by, note)
  VALUES (p_odoo_payment_id, p_syntage_complemento_uuid, p_linked_by, p_note)
  ON CONFLICT (odoo_payment_id, syntage_complemento_uuid)
  DO UPDATE SET note = EXCLUDED.note, linked_by = EXCLUDED.linked_by, linked_at = now()
  RETURNING id INTO v_id;

  -- Resolver issues payment_missing_complemento / complemento_missing_payment relacionados
  UPDATE public.reconciliation_issues ri
  SET resolved_at = now(),
      resolution = format('manual_payment_link by %s: %s', p_linked_by, COALESCE(p_note,''))
  WHERE ri.resolved_at IS NULL
    AND ri.issue_type IN ('payment_missing_complemento','complemento_missing_payment')
    AND (
      (p_odoo_payment_id IS NOT NULL AND ri.odoo_payment_id = p_odoo_payment_id) OR
      (p_syntage_complemento_uuid IS NOT NULL AND ri.uuid_sat = p_syntage_complemento_uuid)
    );

  RETURN v_id;
END $$;

COMMENT ON FUNCTION public.reconcile_payment_manually IS
  'UX reconciliation: vincula manualmente pago Odoo ↔ complemento SAT.';

INSERT INTO public.schema_changes (change_type, object_name, notes) VALUES
  ('create_table','payment_bridge_manual','Fase 2.5 — manual overrides payment bridge'),
  ('create_function','reconcile_payment_manually(bigint,text,text,text)','Fase 2.5 — reconciliación manual pago');

COMMIT;
```

- [ ] **Step 2: Smoke test**

```sql
SELECT public.reconcile_payment_manually(NULL, '00000000-0000-0000-0000-000000000001', 'smoke_test', 'phase 2.5 test');
SELECT * FROM public.payment_bridge_manual WHERE linked_by='smoke_test';
DELETE FROM public.payment_bridge_manual WHERE linked_by='smoke_test';
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260421_fase25_04_reconcile_payment_fn.sql
git commit -m "feat(db): payment_bridge_manual + reconcile_payment_manually()"
```

---

## Fase B — Unificación productos + precios

### Task 5: `products_fiscal_map` tabla + seed top 20

**Files:**
- Create: `supabase/migrations/20260421_fase25_05_products_fiscal_map.sql`

- [ ] **Step 1: Identificar top 20 SKUs por revenue 12m**

```sql
-- Ejecuta para obtener candidatos (no es parte de la migration, es para la seed)
SELECT
  p.odoo_product_id, p.internal_ref, p.name,
  sum(COALESCE(il.price_subtotal_mxn, il.price_subtotal)) AS revenue_12m,
  -- Clave SAT más frecuente en facturación de Quimibond (PNT920218IW5)
  mode() WITHIN GROUP (ORDER BY sli.clave_prod_serv) AS likely_clave_sat,
  count(DISTINCT sli.clave_prod_serv) AS distinct_claves
FROM odoo_products p
JOIN odoo_invoice_lines il ON il.odoo_product_id = p.odoo_product_id
LEFT JOIN syntage_invoice_line_items sli ON (
  sli.descripcion ILIKE '%' || p.internal_ref || '%'
  AND length(p.internal_ref) >= 4
  AND sli.taxpayer_rfc = 'PNT920218IW5'
)
WHERE il.move_type='out_invoice'
  AND il.invoice_date >= CURRENT_DATE - interval '365 days'
  AND p.internal_ref IS NOT NULL
GROUP BY p.odoo_product_id, p.internal_ref, p.name
ORDER BY revenue_12m DESC NULLS LAST
LIMIT 20;
```

Guardar el resultado (copiar/pegar) para armar los INSERT del seed. Si `likely_clave_sat` es NULL para un SKU, dejar mapping manual para que el operador lo complete.

- [ ] **Step 2: Migration**

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS public.products_fiscal_map (
  id bigserial PRIMARY KEY,
  odoo_product_id integer NOT NULL,
  internal_ref text NOT NULL,
  sat_clave_prod_serv text NOT NULL,
  description_pattern text,  -- opcional: regex o ILIKE pattern
  confidence text NOT NULL CHECK (confidence IN ('manual_confirmed','inferred_high','inferred_medium','inferred_low')),
  created_by text NOT NULL DEFAULT 'seed',
  created_at timestamptz NOT NULL DEFAULT now(),
  note text,
  UNIQUE (odoo_product_id, sat_clave_prod_serv)
);

CREATE INDEX IF NOT EXISTS idx_pfm_internal_ref ON public.products_fiscal_map (internal_ref);
CREATE INDEX IF NOT EXISTS idx_pfm_clave ON public.products_fiscal_map (sat_clave_prod_serv);

COMMENT ON TABLE public.products_fiscal_map IS
  'Mapping manual + inferido entre odoo_products.internal_ref y SAT claveProdServ. Seed inicial top 20 SKUs.';

-- Seed (los 20 SKUs con su clave SAT más frecuente)
-- Ejecutar con los valores reales obtenidos en Step 1.
-- Template (reemplazar los <placeholders>):
-- INSERT INTO public.products_fiscal_map
--   (odoo_product_id, internal_ref, sat_clave_prod_serv, confidence, created_by, note)
-- VALUES
--   (<id>, '<ref>', '<clave>', 'inferred_high', 'seed_phase_2_5', 'auto-inferred from top 20 query');

INSERT INTO public.schema_changes (change_type, object_name, notes)
VALUES ('create_table','products_fiscal_map','Fase 2.5 — mapping SKU Odoo ↔ clave SAT');

COMMIT;
```

- [ ] **Step 3: Reportar al usuario para confirmar seeds**

Pegar el resultado del query de Step 1 y pedir "¿aplico estos 20 mappings con confidence=inferred_high?" — si OK, añadir los 20 INSERT a la migration.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260421_fase25_05_products_fiscal_map.sql
git commit -m "feat(db): products_fiscal_map table + seed top 20 SKUs"
```

---

### Task 6: `products_unified` view

**Files:**
- Create: `supabase/migrations/20260421_fase25_06_products_unified_view.sql`

- [ ] **Step 1: Migration**

```sql
BEGIN;

CREATE OR REPLACE VIEW public.products_unified AS
SELECT
  p.odoo_product_id,
  p.internal_ref,
  p.name AS product_name,
  p.category,
  p.uom,
  p.product_type,
  p.active,
  p.standard_price,
  p.list_price,
  p.stock_qty,
  -- Fiscal mapping
  pfm.sat_clave_prod_serv,
  pfm.confidence AS fiscal_map_confidence,
  -- Agregados SAT (solo de CFDIs emitidos por Quimibond)
  COALESCE(sat.sat_line_count, 0) AS sat_line_count_12m,
  COALESCE(sat.sat_revenue_mxn, 0) AS sat_revenue_mxn_12m,
  sat.last_sat_invoice_date
FROM public.odoo_products p
LEFT JOIN public.products_fiscal_map pfm ON pfm.odoo_product_id = p.odoo_product_id
LEFT JOIN LATERAL (
  SELECT
    count(*) AS sat_line_count,
    sum(sli.importe) AS sat_revenue_mxn,
    max(si.fecha_timbrado::date) AS last_sat_invoice_date
  FROM public.syntage_invoice_line_items sli
  JOIN public.syntage_invoices si ON si.uuid = sli.invoice_uuid
  WHERE si.taxpayer_rfc = 'PNT920218IW5'
    AND si.direction = 'issued'
    AND si.fecha_timbrado >= CURRENT_DATE - interval '365 days'
    AND (
      (pfm.sat_clave_prod_serv IS NOT NULL AND sli.clave_prod_serv = pfm.sat_clave_prod_serv)
      OR (
        pfm.sat_clave_prod_serv IS NULL
        AND p.internal_ref IS NOT NULL
        AND length(p.internal_ref) >= 4
        AND sli.descripcion ILIKE '%' || p.internal_ref || '%'
      )
    )
) sat ON true
WHERE p.active = true OR p.stock_qty > 0;

COMMENT ON VIEW public.products_unified IS
  'Vista unificada productos Odoo + fiscal SAT. Usa products_fiscal_map si existe, sino heurística ILIKE con guard length>=4.';

INSERT INTO public.schema_changes (change_type, object_name, notes)
VALUES ('create_view','products_unified','Fase 2.5 — view unificada productos op + fiscal');

COMMIT;
```

- [ ] **Step 2: Smoke test**

```sql
SELECT count(*) FROM products_unified;
SELECT count(*) FROM products_unified WHERE sat_revenue_mxn_12m > 0;
SELECT internal_ref, sat_clave_prod_serv, sat_revenue_mxn_12m
FROM products_unified
WHERE sat_revenue_mxn_12m > 0
ORDER BY sat_revenue_mxn_12m DESC LIMIT 10;
```

**Alerta de performance:** LATERAL con ILIKE sobre 166K rows × 7.2K productos puede tardar. Si >5s, refactorizar a MV (`products_unified` MV refreshed cada 2h). Decidir tras el smoke test.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260421_fase25_06_products_unified_view.sql
git commit -m "feat(db): products_unified view with fiscal SAT aggregation"
```

---

### Task 7: `product_price_history` MV

**Files:**
- Create: `supabase/migrations/20260421_fase25_07_product_price_history_mv.sql`

- [ ] **Step 1: Migration**

```sql
BEGIN;

CREATE MATERIALIZED VIEW IF NOT EXISTS public.product_price_history AS
WITH order_sale AS (
  SELECT odoo_product_id,
         date_trunc('month', order_date)::date AS month,
         'order_sale'::text AS source,
         avg(price_unit) AS avg_price,
         min(price_unit) AS min_price,
         max(price_unit) AS max_price,
         sum(qty) AS qty,
         count(*) AS line_count,
         count(DISTINCT company_id) AS companies_count
  FROM public.odoo_order_lines
  WHERE order_type='sale' AND order_state IN ('sale','done') AND odoo_product_id IS NOT NULL
  GROUP BY 1, 2
),
order_purchase AS (
  SELECT odoo_product_id,
         date_trunc('month', order_date)::date AS month,
         'order_purchase'::text AS source,
         avg(price_unit), min(price_unit), max(price_unit),
         sum(qty), count(*), count(DISTINCT company_id)
  FROM public.odoo_order_lines
  WHERE order_type='purchase' AND order_state IN ('purchase','done') AND odoo_product_id IS NOT NULL
  GROUP BY 1, 2
),
invoice_sale AS (
  SELECT odoo_product_id,
         date_trunc('month', invoice_date)::date AS month,
         'invoice_sale'::text AS source,
         avg(price_unit), min(price_unit), max(price_unit),
         sum(quantity), count(*), count(DISTINCT company_id)
  FROM public.odoo_invoice_lines
  WHERE move_type IN ('out_invoice','out_refund') AND odoo_product_id IS NOT NULL
  GROUP BY 1, 2
),
invoice_purchase AS (
  SELECT odoo_product_id,
         date_trunc('month', invoice_date)::date AS month,
         'invoice_purchase'::text AS source,
         avg(price_unit), min(price_unit), max(price_unit),
         sum(quantity), count(*), count(DISTINCT company_id)
  FROM public.odoo_invoice_lines
  WHERE move_type IN ('in_invoice','in_refund') AND odoo_product_id IS NOT NULL
  GROUP BY 1, 2
)
SELECT odoo_product_id, month, source, avg_price, min_price, max_price, qty, line_count, companies_count FROM order_sale
UNION ALL SELECT * FROM order_purchase
UNION ALL SELECT * FROM invoice_sale
UNION ALL SELECT * FROM invoice_purchase;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pph_pk ON public.product_price_history (odoo_product_id, month, source);
CREATE INDEX IF NOT EXISTS idx_pph_month ON public.product_price_history (month);
CREATE INDEX IF NOT EXISTS idx_pph_source ON public.product_price_history (source);

COMMENT ON MATERIALIZED VIEW public.product_price_history IS
  'Historial mensual de precios por producto (sale/purchase × order/invoice). Refreshed en refresh_all_matviews.';

-- Añadir al refresh_all_matviews (editamos la función existente)
-- IMPORTANTE: leer la definición actual primero para no perder MVs.
-- Snippet para añadir dentro del body de refresh_all_matviews:
--   PERFORM public.safe_refresh_mv('product_price_history');

INSERT INTO public.schema_changes (change_type, object_name, notes)
VALUES ('create_matview','product_price_history','Fase 2.5 — historial precios mensual por SKU/source');

COMMIT;
```

- [ ] **Step 2: Añadir a `refresh_all_matviews`**

```sql
-- Obtener definición actual
SELECT pg_get_functiondef('public.refresh_all_matviews()'::regprocedure);
```

Copiar la definición, añadir `PERFORM public.safe_refresh_mv('product_price_history');` antes del `END`, escribir como `CREATE OR REPLACE FUNCTION ...` en la misma migration (o append a la existente). Commit atomic.

- [ ] **Step 3: Primer refresh manual**

```sql
REFRESH MATERIALIZED VIEW public.product_price_history;
SELECT count(*), count(DISTINCT odoo_product_id), min(month), max(month) FROM public.product_price_history;
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260421_fase25_07_product_price_history_mv.sql
git commit -m "feat(db): product_price_history MV + add to refresh_all_matviews"
```

---

## Fase C — Órdenes + personas

### Task 8: `orders_unified` view

**Files:**
- Create: `supabase/migrations/20260421_fase25_08_orders_unified_view.sql`

- [ ] **Step 1: Verificar columnas de `odoo_sale_orders` y `odoo_purchase_orders`**

```sql
SELECT table_name, column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name IN ('odoo_sale_orders','odoo_purchase_orders')
ORDER BY table_name, ordinal_position;
```

- [ ] **Step 2: Migration**

```sql
BEGIN;

CREATE OR REPLACE VIEW public.orders_unified AS
SELECT
  'sale'::text AS order_type,
  so.id,
  so.odoo_order_id,
  so.name,
  so.company_id,
  so.odoo_partner_id,
  so.amount_total,
  so.amount_untaxed,
  so.state,
  so.date_order,
  so.commitment_date AS fulfillment_date,
  so.currency,
  so.salesperson_user_id AS assignee_user_id,
  so.salesperson_name AS assignee_name,
  so.team_name,
  so.margin,
  so.margin_percent
FROM public.odoo_sale_orders so
UNION ALL
SELECT
  'purchase'::text AS order_type,
  po.id,
  po.odoo_order_id,
  po.name,
  po.company_id,
  po.odoo_partner_id,
  po.amount_total,
  po.amount_untaxed,
  po.state,
  po.date_order,
  po.date_approve AS fulfillment_date,
  po.currency,
  po.buyer_user_id AS assignee_user_id,
  po.buyer_name AS assignee_name,
  NULL::text AS team_name,
  NULL::numeric AS margin,
  NULL::numeric AS margin_percent
FROM public.odoo_purchase_orders po;

COMMENT ON VIEW public.orders_unified IS
  'Unified sale + purchase orders con discriminador order_type. Columnas comunes.';

INSERT INTO public.schema_changes (change_type, object_name, notes)
VALUES ('create_view','orders_unified','Fase 2.5 — union sale+purchase orders');

COMMIT;
```

**Nota:** Ajustar `margin`, `margin_percent`, `team_name` si los nombres de columna reales difieren del CLAUDE.md. Verificar con el query de Step 1.

- [ ] **Step 3: Smoke test**

```sql
SELECT order_type, count(*) FROM orders_unified GROUP BY 1;
-- Expected: sale ~12,353, purchase ~5,669
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260421_fase25_08_orders_unified_view.sql
git commit -m "feat(db): orders_unified view (sale + purchase)"
```

---

### Task 9: `order_fulfillment_bridge` view

**Files:**
- Create: `supabase/migrations/20260421_fase25_09_order_fulfillment_bridge.sql`

- [ ] **Step 1: Migration**

```sql
BEGIN;

CREATE OR REPLACE VIEW public.order_fulfillment_bridge AS
SELECT
  ol.odoo_line_id,
  ol.order_type,
  ol.odoo_order_id,
  ol.order_name,
  ol.company_id,
  ol.odoo_partner_id,
  ol.odoo_product_id,
  ol.product_ref,
  ol.product_name,
  ol.qty,
  ol.qty_delivered,
  ol.qty_invoiced,
  (ol.qty - COALESCE(ol.qty_delivered, 0)) AS qty_pending_delivery,
  (ol.qty - COALESCE(ol.qty_invoiced, 0)) AS qty_pending_invoicing,
  ol.price_unit,
  ol.subtotal_mxn,
  ol.order_state,
  ol.order_date,
  CASE
    WHEN ol.qty_invoiced >= ol.qty THEN 'fully_invoiced'
    WHEN ol.qty_delivered >= ol.qty THEN 'delivered_not_invoiced'
    WHEN ol.qty_delivered > 0 THEN 'partial_delivery'
    ELSE 'open'
  END AS fulfillment_stage
FROM public.odoo_order_lines ol
WHERE ol.order_state IN ('sale','purchase','done');

COMMENT ON VIEW public.order_fulfillment_bridge IS
  'Bridge orden → entrega → facturación. fulfillment_stage categoriza el embudo.';

INSERT INTO public.schema_changes (change_type, object_name, notes)
VALUES ('create_view','order_fulfillment_bridge','Fase 2.5 — trazabilidad orden→entrega→factura');

COMMIT;
```

- [ ] **Step 2: Smoke test**

```sql
SELECT order_type, fulfillment_stage, count(*) FROM order_fulfillment_bridge
GROUP BY 1, 2 ORDER BY 1, 2;
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260421_fase25_09_order_fulfillment_bridge.sql
git commit -m "feat(db): order_fulfillment_bridge view"
```

---

### Task 10: `person_unified` view

**Files:**
- Create: `supabase/migrations/20260421_fase25_10_person_unified_view.sql`

- [ ] **Step 1: Migration**

```sql
BEGIN;

CREATE OR REPLACE VIEW public.person_unified AS
WITH base AS (
  SELECT
    c.id AS contact_id,
    c.entity_id,
    lower(c.email) AS primary_email,
    c.name AS contact_name,
    c.phone,
    c.company AS company_text,
    c.company_id,
    NULL::integer AS employee_odoo_id,
    NULL::text    AS employee_department,
    NULL::text    AS employee_job_title,
    NULL::integer AS user_odoo_id,
    'contact'::text AS origin
  FROM public.contacts c
  WHERE c.email IS NOT NULL AND c.email <> ''
  UNION ALL
  SELECT
    NULL, NULL,
    lower(e.work_email), e.name, e.work_phone, NULL, NULL,
    e.odoo_employee_id, e.department_name, e.job_title,
    e.odoo_user_id,
    'employee'::text
  FROM public.odoo_employees e
  WHERE e.work_email IS NOT NULL AND e.work_email <> ''
  UNION ALL
  SELECT
    NULL, NULL,
    lower(u.email), u.name, NULL, NULL, NULL,
    NULL, u.department, u.job_title,
    u.odoo_user_id,
    'user'::text
  FROM public.odoo_users u
  WHERE u.email IS NOT NULL AND u.email <> ''
)
SELECT
  primary_email,
  bool_or(origin='contact') AS has_contact,
  bool_or(origin='employee') AS has_employee,
  bool_or(origin='user') AS has_user,
  max(contact_id) AS contact_id,
  max(entity_id) AS entity_id,
  max(employee_odoo_id) AS employee_odoo_id,
  max(user_odoo_id) AS user_odoo_id,
  coalesce(max(contact_name), max(company_text)) AS name,
  max(employee_department) AS department,
  max(employee_job_title) AS job_title,
  max(company_id) AS company_id,
  CASE
    WHEN bool_or(origin='employee') THEN 'employee'
    WHEN bool_or(origin='user')     THEN 'user'
    ELSE 'external'
  END AS role
FROM base
GROUP BY primary_email;

COMMENT ON VIEW public.person_unified IS
  'Personas unificadas por primary_email: contacts ∪ odoo_employees ∪ odoo_users. Role deriva del origen.';

INSERT INTO public.schema_changes (change_type, object_name, notes)
VALUES ('create_view','person_unified','Fase 2.5 — union personas por email');

COMMIT;
```

- [ ] **Step 2: Smoke test**

```sql
SELECT role, count(*) FROM person_unified GROUP BY 1;
SELECT has_contact, has_employee, has_user, count(*)
FROM person_unified GROUP BY 1,2,3 ORDER BY 4 DESC;
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260421_fase25_10_person_unified_view.sql
git commit -m "feat(db): person_unified view (contacts ∪ employees ∪ users)"
```

---

### Task 11: Trigger backfill `contact ← employee`

**Files:**
- Create: `supabase/migrations/20260421_fase25_11_backfill_contact_from_employee.sql`

- [ ] **Step 1: Migration**

```sql
BEGIN;

CREATE OR REPLACE FUNCTION public.trg_backfill_contact_from_employee()
RETURNS trigger LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NEW.work_email IS NULL OR NEW.work_email = '' THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.contacts (email, name, phone)
  VALUES (lower(NEW.work_email), NEW.name, NEW.work_phone)
  ON CONFLICT (email) DO NOTHING;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_backfill_contact_from_employee ON public.odoo_employees;
CREATE TRIGGER trg_backfill_contact_from_employee
AFTER INSERT OR UPDATE OF work_email, name ON public.odoo_employees
FOR EACH ROW EXECUTE FUNCTION public.trg_backfill_contact_from_employee();

-- Backfill histórico
DO $$
DECLARE v_count int;
BEGIN
  WITH ins AS (
    INSERT INTO public.contacts (email, name, phone)
    SELECT DISTINCT lower(e.work_email), e.name, e.work_phone
    FROM public.odoo_employees e
    WHERE e.work_email IS NOT NULL AND e.work_email <> ''
      AND NOT EXISTS (SELECT 1 FROM public.contacts c WHERE lower(c.email)=lower(e.work_email))
    ON CONFLICT (email) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM ins;
  INSERT INTO public.audit_runs (run_id, invariant_key, severity, source, model, details, run_at)
  VALUES (gen_random_uuid(), 'phase_2_5_backfill_contacts_from_employees', 'ok', 'supabase', 'migration',
    jsonb_build_object('inserted_count', v_count), now());
END $$;

INSERT INTO public.schema_changes (change_type, object_name, notes)
VALUES ('create_trigger','trg_backfill_contact_from_employee','Fase 2.5 — auto-crear contact cuando llega employee');

COMMIT;
```

**Nota:** Verificar primero que `contacts.email` tiene UNIQUE constraint. Si no, añadirlo en migration separada antes.

```sql
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint WHERE conrelid='public.contacts'::regclass;
```

- [ ] **Step 2: Smoke test**

```sql
SELECT count(*) FROM contacts; -- baseline
-- Insertar employee sintético
INSERT INTO odoo_employees (odoo_employee_id, name, work_email)
VALUES (-99999, 'Smoke Test Employee', 'smoke-test-fase25@example.com');
-- Verificar contact creado
SELECT * FROM contacts WHERE email='smoke-test-fase25@example.com';
-- Cleanup
DELETE FROM odoo_employees WHERE odoo_employee_id=-99999;
DELETE FROM contacts WHERE email='smoke-test-fase25@example.com';
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260421_fase25_11_backfill_contact_from_employee.sql
git commit -m "feat(db): backfill contact from employee trigger"
```

---

## Fase D — Poda de views financieras redundantes (gated)

### Task 12: DROP 6 analytics_* wrappers thin

**Files:**
- Create: `supabase/migrations/20260421_fase25_12_drop_analytics_wrappers.sql`

**Pre-condiciones:**
- Audit consumers en frontend primero.

- [ ] **Step 1: Audit consumers frontend**

```bash
rg -n "analytics_finance_cash_position|analytics_finance_cfo_snapshot|analytics_finance_income_statement|analytics_finance_working_capital|analytics_revenue_fiscal_monthly|analytics_revenue_operational_monthly" \
  /Users/jj/quimibond-intelligence/quimibond-intelligence/src
```

Guardar output. Si hay consumers, listar archivos + lineas para migrar.

- [ ] **Step 2: Migrar consumers a views base**

Por cada caller encontrado, reemplazar:
- `analytics_finance_cash_position` → `cash_position`
- `analytics_finance_cfo_snapshot` → `cfo_dashboard`
- `analytics_finance_income_statement` → `pl_estado_resultados`
- `analytics_finance_working_capital` → `working_capital`
- `analytics_revenue_fiscal_monthly` → `syntage_revenue_fiscal_monthly`
- `analytics_revenue_operational_monthly` → `monthly_revenue_trend`

Commit frontend changes separately.

- [ ] **Step 3: Pedir OK explícito al usuario**

"Task 12 dropea 6 views thin wrappers. Frontend migrado (ver commit <hash>). ¿Aplico DROP?"

- [ ] **Step 4: Migration**

```sql
BEGIN;

DROP VIEW IF EXISTS public.analytics_finance_cash_position;
DROP VIEW IF EXISTS public.analytics_finance_cfo_snapshot;
DROP VIEW IF EXISTS public.analytics_finance_income_statement;
DROP VIEW IF EXISTS public.analytics_finance_working_capital;
DROP VIEW IF EXISTS public.analytics_revenue_fiscal_monthly;
DROP VIEW IF EXISTS public.analytics_revenue_operational_monthly;

INSERT INTO public.schema_changes (change_type, object_name, notes) VALUES
  ('drop_view','analytics_finance_cash_position','Fase 2.5 — thin wrapper, frontend migrado a cash_position'),
  ('drop_view','analytics_finance_cfo_snapshot','Fase 2.5 — thin wrapper'),
  ('drop_view','analytics_finance_income_statement','Fase 2.5 — thin wrapper'),
  ('drop_view','analytics_finance_working_capital','Fase 2.5 — thin wrapper'),
  ('drop_view','analytics_revenue_fiscal_monthly','Fase 2.5 — thin wrapper'),
  ('drop_view','analytics_revenue_operational_monthly','Fase 2.5 — thin wrapper');

COMMIT;
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260421_fase25_12_drop_analytics_wrappers.sql
git commit -m "chore(db): drop 6 analytics_* thin wrappers (frontend migrated)"
```

---

### Task 13: Consolidar monthly_revenue_trend + monthly_revenue_by_company (gated)

**Files:**
- Create: `supabase/migrations/20260421_fase25_13_consolidate_monthly_revenue.sql`

**Status:** OPCIONAL — solo si el usuario confirma que quiere una sola fuente.

- [ ] **Step 1: Audit consumers**

```bash
rg -n "monthly_revenue_trend|monthly_revenue_by_company" /Users/jj/quimibond-intelligence/quimibond-intelligence/src
```

- [ ] **Step 2: Si el usuario confirma, crear view `monthly_revenue_unified`**

```sql
BEGIN;

CREATE OR REPLACE VIEW public.monthly_revenue_unified AS
SELECT
  month,
  company_id,
  company_name,
  revenue,
  net_revenue,
  invoice_count,
  prev_month_revenue,
  mom_growth_pct,
  yoy_revenue,
  yoy_growth_pct,
  rank_in_month,
  'per_company'::text AS granularity
FROM public.monthly_revenue_by_company
UNION ALL
SELECT
  month,
  NULL::bigint AS company_id,
  NULL::text AS company_name,
  revenue,
  revenue AS net_revenue,
  order_lines::numeric AS invoice_count,
  prev_month_revenue,
  mom_change_pct AS mom_growth_pct,
  NULL::numeric AS yoy_revenue,
  NULL::numeric AS yoy_growth_pct,
  NULL::bigint AS rank_in_month,
  'total'::text AS granularity
FROM public.monthly_revenue_trend;

COMMENT ON VIEW public.monthly_revenue_unified IS
  'Combina monthly_revenue_by_company (per empresa) + monthly_revenue_trend (total) con discriminador granularity.';

INSERT INTO public.schema_changes (change_type, object_name, notes)
VALUES ('create_view','monthly_revenue_unified','Fase 2.5 — consolidación monthly revenue');

COMMIT;
```

- [ ] **Step 3: NO dropear fuentes base** hasta que frontend migre en otra PR.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260421_fase25_13_consolidate_monthly_revenue.sql
git commit -m "feat(db): monthly_revenue_unified view (optional consolidation)"
```

---

## Fase E — Cierre

### Task 14: Post-audit snapshot + frontend CLAUDE.md update

**Files:**
- Create: `supabase/migrations/20260421_fase25_14_final.sql`
- Modify: `quimibond-intelligence/quimibond-intelligence/CLAUDE.md`
- Modify: `quimibond-intelligence/quimibond-intelligence/docs/superpowers/plans/2026-04-21-supabase-audit-fase-2-5-audit-notes.md`

- [ ] **Step 1: Migration final**

```sql
INSERT INTO public.audit_runs (run_id, invariant_key, severity, source, model, details, run_at)
SELECT
  gen_random_uuid(),
  'phase_2_5_final',
  'ok',
  'supabase',
  'final',
  jsonb_build_object(
    'invoice_bridge_row_count', (SELECT count(*) FROM invoice_bridge),
    'invoice_bridge_gaps_missing_sat', (SELECT count(*) FROM invoice_bridge WHERE is_gap_missing_sat),
    'invoice_bridge_gaps_missing_odoo', (SELECT count(*) FROM invoice_bridge WHERE is_gap_missing_odoo),
    'products_fiscal_map_seeded', (SELECT count(*) FROM products_fiscal_map),
    'products_unified_with_sat_revenue', (SELECT count(*) FROM products_unified WHERE sat_revenue_mxn_12m>0),
    'product_price_history_rows', (SELECT count(*) FROM product_price_history),
    'orders_unified_rows', (SELECT count(*) FROM orders_unified),
    'person_unified_rows', (SELECT count(*) FROM person_unified),
    'reconciliation_issues_open_after', (SELECT count(*) FROM reconciliation_issues WHERE resolved_at IS NULL)
  ),
  now();
```

- [ ] **Step 2: Re-correr queries del Task 0 → `## Después`**

Pegar outputs en `audit-notes.md` bajo `## Después`.

- [ ] **Step 3: Actualizar frontend CLAUDE.md**

Añadir sección "### Unified views + bridges" en `## Base de datos (Supabase)`:

```markdown
### Unified views + bridges (Fase 2.5)

| Objeto | Tipo | Propósito |
|---|---|---|
| `invoice_bridge` | view | Bridge factura Odoo↔Syntage con flags de gap + manual links |
| `invoice_bridge_manual` | table | Overrides manuales de matching |
| `reconcile_invoice_manually(odoo_id, uuid, by, note)` | fn | UX reconciliación manual |
| `match_unlinked_invoices_by_composite(batch)` | fn | Diagnóstico composite matching |
| `payment_bridge_manual` | table | Overrides manuales pagos |
| `reconcile_payment_manually(odoo_pay_id, uuid, by, note)` | fn | UX reconciliación manual pagos |
| `products_fiscal_map` | table | Mapping SKU Odoo → clave SAT |
| `products_unified` | view | Productos Odoo + agregados SAT |
| `product_price_history` | MV | Historial mensual precios por producto/source |
| `orders_unified` | view | Union sale + purchase orders |
| `order_fulfillment_bridge` | view | Trazabilidad orden→entrega→factura |
| `person_unified` | view | Union contacts ∪ employees ∪ users por email |
```

- [ ] **Step 4: Actualizar memoria**

Añadir a `/Users/jj/.claude/projects/-Users-jj/memory/project_supabase_audit_2026_04_19.md`:

```md
## Fase 2.5 Unificación — cerrada 2026-04-XX
- invoice_bridge view + invoice_bridge_manual tbl + reconcile_invoice_manually fn
- products_fiscal_map (20 SKUs seedeados) + products_unified view
- product_price_history MV (N rows)
- orders_unified + order_fulfillment_bridge views
- person_unified view + trigger backfill contact from employee
- 6 analytics_* wrappers dropeados
- Commits: …
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260421_fase25_14_final.sql CLAUDE.md docs/superpowers/plans/2026-04-21-supabase-audit-fase-2-5-audit-notes.md
git commit -m "docs(audit): fase 2.5 unificación post-flight + CLAUDE.md update"
```

- [ ] **Step 6: Reportar al usuario**

"Fase 2.5 completa. Cambios:
- 1 view bridge (invoice_bridge) + 1 tabla overrides + 2 funciones de reconciliación manual
- 1 view productos (products_unified) + 1 tabla mapping + seed 20 SKUs
- 1 MV price history
- 2 views órdenes (orders_unified + order_fulfillment_bridge)
- 1 view person + trigger backfill
- 6 views wrappers dropeadas
- 1 view monthly_revenue_unified opcional

PR listo para merge:
- Frontend: `fase-2-5-unificacion` → `main` (14 commits + los de frontend migration)

Deploy (usuario ejecuta):
```bash
cd /Users/jj/quimibond-intelligence/quimibond-intelligence
git checkout main && git merge fase-2-5-unificacion && git push origin main
# Vercel auto-deploy
```"

---

## Orden de ejecución recomendado

1. Task 0 (baseline)
2. Task 1 (invoice_bridge view + table) — **el deliverable central, primero**
3. Task 2 (reconcile_invoice_manually)
4. Task 3 (composite matcher)
5. Task 4 (reconcile_payment_manually)
6. Task 5 (products_fiscal_map + seed)
7. Task 6 (products_unified view)
8. Task 7 (product_price_history MV)
9. Task 8 (orders_unified)
10. Task 9 (order_fulfillment_bridge)
11. Task 10 (person_unified)
12. Task 11 (backfill contact ← employee)
13. → **Audit frontend consumers** (Task 12 Step 1)
14. → **Migrar frontend** (fuera del scope SQL, PR separado)
15. Task 12 (drop wrappers — gated)
16. Task 13 (monthly_revenue_unified — opcional)
17. Task 14 (post-audit + CLAUDE.md + memoria)

---

## DoD

- [ ] `invoice_bridge` retorna ≥ `invoices_unified.count(*)` rows.
- [ ] `invoice_bridge_manual` + `reconcile_invoice_manually` smoke test pasa.
- [ ] `match_unlinked_invoices_by_composite(1000)` devuelve ≥1 row.
- [ ] `payment_bridge_manual` + `reconcile_payment_manually` smoke test pasa.
- [ ] `products_fiscal_map` tiene ≥20 rows seedeados.
- [ ] `products_unified` retorna count > 0 con `sat_revenue_mxn_12m > 0` en ≥20 rows.
- [ ] `product_price_history` MV tiene ≥10K rows y está en `refresh_all_matviews`.
- [ ] `orders_unified.count` = sale + purchase.
- [ ] `order_fulfillment_bridge.count` > 0 por cada `fulfillment_stage`.
- [ ] `person_unified` tiene filas con `has_contact AND has_employee` > 0.
- [ ] Trigger `trg_backfill_contact_from_employee` smoke test pasa.
- [ ] 6 views `analytics_*` thin dropeadas (gated + frontend migrado).
- [ ] `schema_changes` tiene entry por cada DDL.
- [ ] `audit_runs` tiene `phase_2_5_baseline` y `phase_2_5_final`.
- [ ] CLAUDE.md (frontend) actualizada.
- [ ] Memoria `project_supabase_audit_2026_04_19.md` actualizada.

---

## Riesgos & mitigaciones

| Riesgo | Mitigación |
|---|---|
| `products_unified` LATERAL con ILIKE es lento (>5s) | Smoke test; si falla → convertir a MV refreshed 2h |
| `reconcile_invoice_manually` sobrescribe cfdi_uuid válido | Guard `WHERE cfdi_uuid IS NULL`; warning en `RAISE` si mismatch |
| `product_price_history` MV pesada al refresh | Índice UNIQUE composite permite CONCURRENTLY; particionar por año si crece |
| `person_unified` expone PII a anon | Security queda a Fase 3; mientras tanto exponer solo a service_role |
| Trigger `backfill_contact_from_employee` spammea contacts | `ON CONFLICT (email) DO NOTHING` — idempotente |
| Migration frontend → drop de wrappers rompe prod | Dos commits separados: (1) migrar consumers, (2) drop tras verificación |
| `orders_unified` con columnas inexistentes (margin/team_name) | Query de verificación en Step 1 de Task 8 antes del DDL |

---

## Self-review

- [x] Task 0 captura baseline antes de crear objetos
- [x] Task 1 es el deliverable central (invoice_bridge) — va primero
- [x] Tasks 2-4 complementan el bridge con UX reconciliación
- [x] Tasks 5-7 cubren productos + precios históricos
- [x] Tasks 8-9 cubren órdenes unified + fulfillment
- [x] Tasks 10-11 cubren personas
- [x] Tasks 12-13 poddan redundancias (gated)
- [x] Task 14 cierra con audit + docs
- [x] Destructivas marcadas "gated — OK explícito"
- [x] Smoke tests en cada task
- [x] Referencias cruzadas al spec
- [x] DoD medible
