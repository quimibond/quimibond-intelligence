# Fase 2 — Limpieza Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminar tablas muertas, funciones/triggers duplicados y callers huérfanos en Supabase `tozqezmivpblmcubmnpi` para dejar el schema listo para Fase 3 (seguridad) y Fase 4 (performance).

**Architecture:** Trabajo split en dos repos: migrations SQL en `quimibond-intelligence` (frontend, branch `fase-2-limpieza`); cambios de Python en `qb19` (root, branch `fase-2-limpieza`). Cada task = 1 commit. Operaciones destructivas (DROP tabla, DROP trigger) requieren confirmación explícita del usuario antes del merge a `main`. Frontend va a prod vía push a `main`; backend vía merge `main → quimibond` + `odoo-update` manual (el usuario lo hace).

**Tech Stack:** PostgreSQL 15 (Supabase), Next.js 15, Odoo 19 Python addon, supabase-js.

---

## Spec & pre-audit state (verificado 2026-04-20)

**Spec:** `/Users/jj/docs/superpowers/specs/2026-04-19-supabase-audit-03-limpieza.md`

**Estado real en Supabase (verificado):**

| Item | Spec decía | Realidad hoy |
|---|---|---|
| `budgets` | 0 rows, depende `analytics_budget_vs_actual` | 0 rows, depende `budget_vs_actual` (vista real) |
| `chat_memory` | 0 rows, vacía | 0 rows; 1 caller frontend en `api/chat/route.ts` |
| `revenue_metrics` | 0 rows DEPRECATED | **7,349 rows** last write 2026-04-10; caller `api/pipeline/snapshot/route.ts`; referenciada por `data_quality_scorecard` (freshness check) |
| `employee_metrics` | 0 rows DEPRECATED | **34 rows** last write 2026-04-06; caller `api/pipeline/employee-metrics/route.ts` |
| `agent_insights_archive_pre_fase6` | 529 rows archivo | 529 rows, last write 2026-04-19 (nada la consume) |
| `odoo_payments` | 26,839 LEGACY | **53,683 rows**; consumers: `queries/_shared/payments.ts`, vista `odoo_sync_freshness`, comentario en `empresas/[id]/page.tsx` |
| `odoo_account_payments` | 17,853 preferred | 17,856 rows |
| UNIQUE `cfdi_uuid` | añadida en Fase 0 | **No existe** en `pg_constraint` ni `pg_indexes` (índice perdido o nunca se creó; Fase 0 dedupeó pero no dejó el constraint) |
| Funciones duplicadas (4) | pendiente | Confirmadas las 4: `get_contact_health_history`, `get_volume_trend`, `match_emails_to_companies_by_domain`, `match_emails_to_contacts_by_email`. **Ningún callsite en DB**; verificar frontend |
| Triggers `odoo_invoice_lines` | 6 | **4** reales: 3 company-resolve + 1 `touch_synced_at` |
| Triggers `odoo_order_lines` | 2 | 2 confirmados |
| `odoo_products/bank_balances/users` | dup updated_at | Confirmado: `trg_set_updated_at` + `trg_touch_updated_at` con funciones **idénticas** (ambas `NEW.updated_at := now()`) |
| `entities/facts/entity_relationships` UNIQUE | pendiente | **Ya existen** (Fase 1 los añadió). `entity_relationships` usa `entity_a_id/entity_b_id`, no `source/target`. Frontend `api/pipeline/analyze/route.ts` ya usa `onConflict` en 3/3 upserts |

**Conclusiones que cambian el spec:**

1. Task 2.4 del spec (UNIQUE + onConflict en entities/facts/rel) **ya está hecho**. Verificamos en Task 14 y cerramos.
2. Task 2.7 (cfdi_uuid push fix): El upsert actual usa `odoo_invoice_id` (PK de Odoo), no `cfdi_uuid`. Un mismo CFDI con 2 `odoo_invoice_id` distintos (original + cancelado/re-emitido) SÍ podría crear duplicados. **Falta añadir UNIQUE partial + decidir estrategia de idempotencia** (no sólo fix del push).
3. Task 2.6 (24 tablas sin consumer): auditoría ya hecha en Fase 0, out of scope aquí.
4. revenue_metrics y employee_metrics **no están vacías**: tienen callers vivos en frontend que hay que retirar antes de drop.

---

## File Structure

### Branch `fase-2-limpieza` en `/Users/jj/quimibond-intelligence/quimibond-intelligence` (frontend)

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `supabase/migrations/20260420_fase2_01_drop_chat_memory.sql` | Create | DROP TABLE chat_memory + log schema_changes |
| `supabase/migrations/20260420_fase2_02_drop_archive_pre_fase6.sql` | Create | DROP agent_insights_archive_pre_fase6 (post-export) |
| `supabase/migrations/20260420_fase2_03_drop_revenue_metrics.sql` | Create | DROP populate_revenue_metrics + revenue_metrics + update data_quality_scorecard |
| `supabase/migrations/20260420_fase2_04_drop_employee_metrics.sql` | Create | DROP calculate_employee_metrics + employee_metrics |
| `supabase/migrations/20260420_fase2_05_drop_budgets.sql` | Create (gated) | DROP budget_vs_actual + budgets |
| `supabase/migrations/20260420_fase2_06_consolidate_updated_at_triggers.sql` | Create | DROP trg_touch_updated_at en 3 tablas + DROP fn touch_updated_at |
| `supabase/migrations/20260420_fase2_07_consolidate_invoice_line_triggers.sql` | Create | DROP 2 triggers redundantes en odoo_invoice_lines + DROP fns no usadas |
| `supabase/migrations/20260420_fase2_08_consolidate_order_line_triggers.sql` | Create | DROP trigger redundante en odoo_order_lines + DROP fn |
| `supabase/migrations/20260420_fase2_09_drop_duplicate_fn_signatures.sql` | Create | DROP 4 signatures perdedoras |
| `supabase/migrations/20260420_fase2_10_update_odoo_sync_freshness.sql` | Create | Remover row `odoo_payments` de la vista odoo_sync_freshness |
| `supabase/migrations/20260420_fase2_11_add_unique_cfdi_uuid.sql` | Create | UNIQUE INDEX partial en odoo_invoices.cfdi_uuid WHERE NOT NULL |
| `supabase/migrations/20260420_fase2_12_drop_odoo_payments.sql` | Create (gated) | DROP odoo_payments (post-migration + post-deploy) |
| `src/lib/queries/_shared/payments.ts` | Modify | Reescribir `getCompanyPayments` contra `odoo_account_payments` |
| `src/app/empresas/[id]/page.tsx` | Modify | Actualizar comentario "odoo_payments" → "odoo_account_payments" |
| `src/app/api/pipeline/snapshot/route.ts` | Delete | Sacar writer de revenue_metrics (la ruta entera si es lo único que hace) |
| `src/app/api/pipeline/employee-metrics/route.ts` | Delete | Sacar writer de employee_metrics |
| `src/app/api/chat/route.ts` | Modify | Quitar referencia a chat_memory |
| `vercel.json` | Modify | Quitar crons de snapshot/employee-metrics si existen |
| `docs/superpowers/plans/2026-04-20-supabase-audit-fase-2-limpieza-audit-notes.md` | Create | Capturar evidencia de auditoría previa y post-cierre |

### Branch `fase-2-limpieza` en `/Users/jj` (qb19)

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `addons/quimibond_intelligence/models/sync_push.py` | Modify | Remover método `_push_payments` + su entry en la lista de métodos; opcionalmente añadir idempotencia cfdi_uuid |
| `data/ir_cron_data.xml` | Modify (si aplica) | Quitar referencias si existen |

---

## Pre-flight

### Task 0: Pre-flight audit (read-only, snapshot de evidencia)

**Files:**
- Create: `quimibond-intelligence/quimibond-intelligence/docs/superpowers/plans/2026-04-20-supabase-audit-fase-2-limpieza-audit-notes.md`

- [ ] **Step 1: Ejecutar queries de audit en Supabase project `tozqezmivpblmcubmnpi`**

```sql
-- Save output de estas queries en el archivo de audit-notes
-- 1) row counts de tablas muertas + odoo_payments
SELECT 'budgets' AS tbl, COUNT(*) FROM budgets UNION ALL
SELECT 'chat_memory', COUNT(*) FROM chat_memory UNION ALL
SELECT 'revenue_metrics', COUNT(*) FROM revenue_metrics UNION ALL
SELECT 'employee_metrics', COUNT(*) FROM employee_metrics UNION ALL
SELECT 'agent_insights_archive_pre_fase6', COUNT(*) FROM agent_insights_archive_pre_fase6 UNION ALL
SELECT 'odoo_payments', COUNT(*) FROM odoo_payments UNION ALL
SELECT 'odoo_account_payments', COUNT(*) FROM odoo_account_payments;

-- 2) Duplicados de cfdi_uuid hoy
SELECT cfdi_uuid, COUNT(*) n FROM odoo_invoices
WHERE cfdi_uuid IS NOT NULL GROUP BY cfdi_uuid HAVING COUNT(*) > 1 ORDER BY n DESC LIMIT 20;

-- 3) Triggers objetivo
SELECT event_object_table, trigger_name, action_timing, event_manipulation
FROM information_schema.triggers
WHERE event_object_schema='public'
  AND event_object_table IN ('odoo_invoice_lines','odoo_order_lines','odoo_products','odoo_bank_balances','odoo_users')
ORDER BY event_object_table, trigger_name;

-- 4) Firmas de funciones duplicadas
SELECT proname, pg_get_function_identity_arguments(oid) FROM pg_proc
WHERE pronamespace='public'::regnamespace
  AND proname IN ('match_emails_to_companies_by_domain','match_emails_to_contacts_by_email','get_contact_health_history','get_volume_trend')
ORDER BY proname, oid;
```

- [ ] **Step 2: Guardar evidencia en `audit-notes.md`**

Estructura: `## Antes` con los 4 bloques de resultados. Al final de Fase 2 (Task 16) se añade `## Después` con las mismas queries.

- [ ] **Step 3: Commit**

```bash
cd /Users/jj/quimibond-intelligence/quimibond-intelligence
git checkout -b fase-2-limpieza
git add docs/superpowers/plans/2026-04-20-supabase-audit-fase-2-limpieza-audit-notes.md
git commit -m "docs(audit): fase 2 limpieza pre-flight baseline"
```

---

## Fase A — Dead tables (ops destructivas, gated)

### Task 1: Drop `chat_memory` (frontend writer + tabla)

**Files:**
- Modify: `quimibond-intelligence/quimibond-intelligence/src/app/api/chat/route.ts`
- Create: `quimibond-intelligence/quimibond-intelligence/supabase/migrations/20260420_fase2_01_drop_chat_memory.sql`

- [ ] **Step 1: Verificar que `chat_memory` no tiene deps vivas**

```sql
SELECT n.nspname, c.relname, c.relkind FROM pg_depend d
JOIN pg_class c ON c.oid=d.objid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE d.refobjid='public.chat_memory'::regclass AND c.relkind IN ('v','m','r');
-- Expected: empty
```

- [ ] **Step 2: Quitar uso de `chat_memory` en `api/chat/route.ts`**

Leer el archivo. Si el uso es sólo escritura "fire-and-forget" (lo más probable), eliminar la línea. Si se lee para hidratar contexto del chat, sustituir por array vacío y comentar 1 línea de justificación.

- [ ] **Step 3: Escribir migration SQL**

```sql
-- 20260420_fase2_01_drop_chat_memory.sql
BEGIN;
  -- Confirm empty + no deps
  DO $$
  BEGIN
    IF (SELECT count(*) FROM public.chat_memory) > 0 THEN
      RAISE EXCEPTION 'chat_memory no está vacía; aborta drop';
    END IF;
  END $$;

  DROP TABLE public.chat_memory;

  INSERT INTO public.schema_changes (change_type, object_name, notes)
  VALUES ('drop_table', 'chat_memory', 'Fase 2 limpieza — 0 rows, sin deps, writer retirado del frontend');
COMMIT;
```

- [ ] **Step 4: Probar en preview (si se usa branch Supabase) o pedir confirmación**

Comentar al usuario: "Task 1 lista. Destructiva: `DROP TABLE chat_memory`. ¿Aplico la migration a prod?" — **NO aplicar sin OK explícito**.

- [ ] **Step 5: Commit**

```bash
cd /Users/jj/quimibond-intelligence/quimibond-intelligence
git add src/app/api/chat/route.ts supabase/migrations/20260420_fase2_01_drop_chat_memory.sql
git commit -m "chore(db): drop chat_memory (0 rows, retirar writer)"
```

---

### Task 2: Drop `agent_insights_archive_pre_fase6` (529 rows → CSV)

**Files:**
- Create: `quimibond-intelligence/quimibond-intelligence/supabase/migrations/20260420_fase2_02_drop_archive_pre_fase6.sql`
- Create: `/tmp/agent_insights_archive_pre_fase6_backup_2026-04-20.csv`

- [ ] **Step 1: Exportar a CSV local antes de drop**

Correr desde psql conectado a Supabase (el usuario lo hace manualmente, o usar `execute_sql` + JSON dump). Comando sugerido al usuario:

```bash
psql "$SUPABASE_URL" -c "\copy (SELECT * FROM agent_insights_archive_pre_fase6) TO '/tmp/agent_insights_archive_pre_fase6_backup_2026-04-20.csv' WITH CSV HEADER"
```

Alternativa: correr `SELECT row_to_json(t) FROM agent_insights_archive_pre_fase6 t` vía MCP, guardar output en `backups/` del repo.

- [ ] **Step 2: Confirmar backup guardado (tamaño > 0, row count match = 529)**

Reportar al usuario el path del backup y pedir OK.

- [ ] **Step 3: Migration SQL**

```sql
-- 20260420_fase2_02_drop_archive_pre_fase6.sql
BEGIN;
  DROP TABLE public.agent_insights_archive_pre_fase6;
  INSERT INTO public.schema_changes (change_type, object_name, notes)
  VALUES ('drop_table', 'agent_insights_archive_pre_fase6', 'Fase 2 — 529 rows exportadas a /tmp/…_2026-04-20.csv');
COMMIT;
```

- [ ] **Step 4: Commit (migration sólo; backup NO se commitea — es local)**

```bash
git add supabase/migrations/20260420_fase2_02_drop_archive_pre_fase6.sql
git commit -m "chore(db): drop agent_insights_archive_pre_fase6 (529 rows, exportadas)"
```

---

### Task 3: Retirar writer + drop `revenue_metrics`

**Files:**
- Delete: `quimibond-intelligence/quimibond-intelligence/src/app/api/pipeline/snapshot/route.ts`
- Modify: `quimibond-intelligence/quimibond-intelligence/vercel.json` (si existe el cron)
- Create: `quimibond-intelligence/quimibond-intelligence/supabase/migrations/20260420_fase2_03_drop_revenue_metrics.sql`

- [ ] **Step 1: Leer `api/pipeline/snapshot/route.ts` para confirmar que sólo escribe a revenue_metrics**

Si hace otras cosas, no borrar la ruta — sólo quitar el bloque de revenue_metrics. En ese caso, renombrar el Step 1.

- [ ] **Step 2: Buscar callers del endpoint**

```bash
rg -n "api/pipeline/snapshot" quimibond-intelligence/quimibond-intelligence/
```

Si hay UI que lo llame, también retirar ese uso.

- [ ] **Step 3: Borrar ruta (o bloque) y actualizar vercel.json**

- [ ] **Step 4: Migration SQL — actualizar `data_quality_scorecard` + drops**

```sql
-- 20260420_fase2_03_drop_revenue_metrics.sql
BEGIN;
  -- Recrear data_quality_scorecard sin la freshness check de revenue_metrics
  CREATE OR REPLACE VIEW public.data_quality_scorecard AS
  -- Copiar la definición completa ACTUAL menos el UNION ALL del 'revenue_metrics_stale_days'
  -- (obtener definición via: SELECT definition FROM pg_views WHERE viewname='data_quality_scorecard';)
  -- PASTE aquí el SELECT completo, omitiendo el bloque 'freshness','revenue_metrics_stale_days',…
  SELECT …;  -- reemplazar con la definición actualizada

  DROP FUNCTION IF EXISTS public.populate_revenue_metrics();
  DROP TABLE public.revenue_metrics;

  INSERT INTO public.schema_changes (change_type, object_name, notes)
  VALUES
    ('drop_table', 'revenue_metrics', 'Fase 2 — 7349 rows, DEPRECATED; writer API removido'),
    ('drop_function', 'populate_revenue_metrics()', 'Fase 2 — ya no hay tabla destino'),
    ('replace_view', 'data_quality_scorecard', 'Fase 2 — removida freshness check revenue_metrics');
COMMIT;
```

Nota: El writer a implementar ANTES de escribir la migration debe obtener la definición actual del view con la query de pg_views. El agente que ejecute este paso debe copiar-pegar la definición y omitir el bloque identificado.

- [ ] **Step 5: Verificar sentido**

```sql
-- Post-migration: data_quality_scorecard no debe romper
SELECT COUNT(*) FROM data_quality_scorecard;
-- Expected: > 0 y no error
```

- [ ] **Step 6: Commit**

```bash
git add src/app/api/pipeline/snapshot/route.ts vercel.json supabase/migrations/20260420_fase2_03_drop_revenue_metrics.sql
git commit -m "chore(db): drop revenue_metrics + writer (7349 rows DEPRECATED)"
```

---

### Task 4: Retirar writer + drop `employee_metrics`

**Files:**
- Delete: `quimibond-intelligence/quimibond-intelligence/src/app/api/pipeline/employee-metrics/route.ts`
- Modify: `quimibond-intelligence/quimibond-intelligence/vercel.json` (si existe el cron)
- Create: `quimibond-intelligence/quimibond-intelligence/supabase/migrations/20260420_fase2_04_drop_employee_metrics.sql`

- [ ] **Step 1: Leer ruta y confirmar no-otros-efectos**

```bash
rg -n "api/pipeline/employee-metrics" quimibond-intelligence/quimibond-intelligence/
```

- [ ] **Step 2: Borrar ruta + cron en `vercel.json`**

- [ ] **Step 3: Migration SQL**

```sql
-- 20260420_fase2_04_drop_employee_metrics.sql
BEGIN;
  DROP FUNCTION IF EXISTS public.calculate_employee_metrics();
  DROP TABLE public.employee_metrics;
  INSERT INTO public.schema_changes (change_type, object_name, notes) VALUES
    ('drop_table','employee_metrics','Fase 2 — 34 rows, writer retirado'),
    ('drop_function','calculate_employee_metrics()','Fase 2 — destino drop');
COMMIT;
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/pipeline/employee-metrics/route.ts vercel.json supabase/migrations/20260420_fase2_04_drop_employee_metrics.sql
git commit -m "chore(db): drop employee_metrics + writer (34 rows DEPRECATED)"
```

---

### Task 5: Handle `budgets` (gated — decidir drop vs keep)

**Files:**
- Create: `quimibond-intelligence/quimibond-intelligence/supabase/migrations/20260420_fase2_05_drop_budgets.sql` (condicional)

- [ ] **Step 1: Preguntar al usuario**

Mensaje: "`budgets` tiene 0 rows; `budget_vs_actual` es un view que depende. Nadie la ha poblado desde que se creó. Opciones: (A) DROP tabla + view, (B) Dejar como contrato vacío. ¿Cuál?"

- [ ] **Step 2a (si A — drop): Migration**

```sql
-- 20260420_fase2_05_drop_budgets.sql
BEGIN;
  DROP VIEW IF EXISTS public.budget_vs_actual;
  DROP TABLE public.budgets;
  INSERT INTO public.schema_changes (change_type, object_name, notes) VALUES
    ('drop_view','budget_vs_actual','Fase 2 — budgets nunca poblada'),
    ('drop_table','budgets','Fase 2 — 0 rows, contrato nunca usado');
COMMIT;
```

- [ ] **Step 2b (si B — keep): Migration "no-op" + comentario**

```sql
-- 20260420_fase2_05_keep_budgets.sql
COMMENT ON TABLE public.budgets IS 'RESERVED: contrato para entrada manual de presupuestos (Fase 2 decision: keep, 2026-04-20)';
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260420_fase2_05_*.sql
git commit -m "chore(db): resolve budgets — <drop|keep> per user"
```

---

## Fase B — Triggers & funciones duplicadas (no destructivo, seguro)

### Task 6: Consolidar triggers `updated_at` (3 tablas)

**Files:**
- Create: `quimibond-intelligence/quimibond-intelligence/supabase/migrations/20260420_fase2_06_consolidate_updated_at_triggers.sql`

- [ ] **Step 1: Validar que `set_updated_at()` y `touch_updated_at()` son idénticas semánticamente**

Ambos cuerpos son `NEW.updated_at := now(); RETURN NEW;` — confirmado en audit previo. Mantener `set_updated_at` (más corto/claro).

- [ ] **Step 2: Buscar otros usos de `touch_updated_at`**

```sql
SELECT event_object_table, trigger_name FROM information_schema.triggers
WHERE trigger_schema='public' AND action_statement ILIKE '%touch_updated_at%';
```

Si hay triggers en otras tablas → no dropear la función, sólo los 3 triggers.

- [ ] **Step 3: Migration SQL**

```sql
-- 20260420_fase2_06_consolidate_updated_at_triggers.sql
BEGIN;
  DROP TRIGGER IF EXISTS trg_touch_updated_at ON public.odoo_products;
  DROP TRIGGER IF EXISTS trg_touch_updated_at ON public.odoo_bank_balances;
  DROP TRIGGER IF EXISTS trg_touch_updated_at ON public.odoo_users;

  -- Sólo drop la fn si YA no hay ningún trigger que la use
  DO $$
  DECLARE v_uses int;
  BEGIN
    SELECT count(*) INTO v_uses
      FROM pg_trigger WHERE NOT tgisinternal
        AND tgfoid = 'public.touch_updated_at()'::regprocedure;
    IF v_uses = 0 THEN
      DROP FUNCTION public.touch_updated_at();
    END IF;
  END $$;

  INSERT INTO public.schema_changes (change_type, object_name, notes) VALUES
    ('drop_trigger','trg_touch_updated_at (3x)','Fase 2 — redundante con trg_set_updated_at');
COMMIT;
```

- [ ] **Step 4: Smoke test (simulado con UPDATE no-op)**

```sql
-- Para cada tabla, confirmar que updated_at sigue cambiando tras UPDATE
BEGIN;
  UPDATE public.odoo_products SET updated_at = updated_at WHERE id = (SELECT id FROM public.odoo_products LIMIT 1);
  -- Revisar que updated_at = now() (el trigger set_updated_at debería dispararse)
ROLLBACK;
```

Expected: updated_at = now() dentro de tolerancia de 1s.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260420_fase2_06_consolidate_updated_at_triggers.sql
git commit -m "refactor(db): consolidate updated_at triggers (drop touch duplicates)"
```

---

### Task 7: Consolidar triggers de `odoo_invoice_lines`

**Files:**
- Create: `quimibond-intelligence/quimibond-intelligence/supabase/migrations/20260420_fase2_07_consolidate_invoice_line_triggers.sql`

- [ ] **Step 1: Decidir trigger canónico**

De las 3 funciones resolve, `auto_resolve_odoo_company` (usada por `trg_resolve_invoice_line_company`) es la mejor: INS+UPD, contacts fallback, exception handler. Canónico = `trg_resolve_invoice_line_company`.

Drop targets:
- `trg_auto_link_invoice_line_company` → fn `auto_link_order_to_company` (misnamed)
- `trg_link_invoice_line_company` → fn `auto_link_invoice_line_company`

Conservar:
- `trg_resolve_invoice_line_company` → fn `auto_resolve_odoo_company`
- `trg_touch_synced_at` (no se toca)

- [ ] **Step 2: Buscar otros triggers que usen esas fns**

```sql
SELECT DISTINCT event_object_table, trigger_name FROM information_schema.triggers
WHERE trigger_schema='public' AND (
  action_statement ILIKE '%auto_link_order_to_company%' OR
  action_statement ILIKE '%auto_link_invoice_line_company%'
);
```

Si `auto_link_order_to_company` se usa en otra tabla (p.ej. sale_orders), dropear sólo el trigger acá — **no** la función.

- [ ] **Step 3: Migration SQL**

```sql
-- 20260420_fase2_07_consolidate_invoice_line_triggers.sql
BEGIN;
  DROP TRIGGER IF EXISTS trg_auto_link_invoice_line_company ON public.odoo_invoice_lines;
  DROP TRIGGER IF EXISTS trg_link_invoice_line_company ON public.odoo_invoice_lines;

  -- Condicional drop de las fns si no tienen más usos
  DO $$
  DECLARE v1 int; v2 int;
  BEGIN
    SELECT count(*) INTO v1 FROM pg_trigger WHERE NOT tgisinternal
      AND tgfoid='public.auto_link_order_to_company()'::regprocedure;
    IF v1 = 0 THEN DROP FUNCTION public.auto_link_order_to_company(); END IF;

    SELECT count(*) INTO v2 FROM pg_trigger WHERE NOT tgisinternal
      AND tgfoid='public.auto_link_invoice_line_company()'::regprocedure;
    IF v2 = 0 THEN DROP FUNCTION public.auto_link_invoice_line_company(); END IF;
  END $$;

  INSERT INTO public.schema_changes (change_type, object_name, notes) VALUES
    ('drop_trigger','trg_auto_link_invoice_line_company','Fase 2 — duplicado resolve'),
    ('drop_trigger','trg_link_invoice_line_company','Fase 2 — duplicado resolve');
COMMIT;
```

- [ ] **Step 4: Smoke test**

```sql
-- Insertar una línea de prueba sin company_id para verificar que trg_resolve_invoice_line_company la resuelve
BEGIN;
  INSERT INTO public.odoo_invoice_lines (odoo_line_id, odoo_move_id, odoo_partner_id, move_type)
  SELECT -9999, (SELECT odoo_move_id FROM public.odoo_invoice_lines LIMIT 1),
         (SELECT odoo_partner_id FROM public.odoo_invoice_lines WHERE company_id IS NOT NULL LIMIT 1),
         'out_invoice';
  SELECT company_id FROM public.odoo_invoice_lines WHERE odoo_line_id = -9999;
  -- Expected: NOT NULL (trigger resolvió)
ROLLBACK;
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260420_fase2_07_consolidate_invoice_line_triggers.sql
git commit -m "refactor(db): consolidate odoo_invoice_lines resolve triggers (keep 1 of 3)"
```

---

### Task 8: Consolidar triggers de `odoo_order_lines`

**Files:**
- Create: `quimibond-intelligence/quimibond-intelligence/supabase/migrations/20260420_fase2_08_consolidate_order_line_triggers.sql`

- [ ] **Step 1: Decidir canónico**

`trg_resolve_order_line_company` → fn `auto_resolve_odoo_company` (INS+UPD, contacts fallback, exception handler). 
Drop: `trg_resolve_order_company` → fn `auto_resolve_order_line_company` (sin fallback ni exception).

- [ ] **Step 2: Migration**

```sql
-- 20260420_fase2_08_consolidate_order_line_triggers.sql
BEGIN;
  DROP TRIGGER IF EXISTS trg_resolve_order_company ON public.odoo_order_lines;

  DO $$
  DECLARE v int;
  BEGIN
    SELECT count(*) INTO v FROM pg_trigger WHERE NOT tgisinternal
      AND tgfoid='public.auto_resolve_order_line_company()'::regprocedure;
    IF v = 0 THEN DROP FUNCTION public.auto_resolve_order_line_company(); END IF;
  END $$;

  INSERT INTO public.schema_changes (change_type, object_name, notes) VALUES
    ('drop_trigger','trg_resolve_order_company','Fase 2 — redundante con trg_resolve_order_line_company');
COMMIT;
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260420_fase2_08_consolidate_order_line_triggers.sql
git commit -m "refactor(db): consolidate odoo_order_lines resolve triggers (keep 1 of 2)"
```

---

### Task 9: Drop firmas duplicadas de funciones (4)

**Files:**
- Create: `quimibond-intelligence/quimibond-intelligence/supabase/migrations/20260420_fase2_09_drop_duplicate_fn_signatures.sql`

- [ ] **Step 1: Buscar callsites en frontend**

```bash
rg -n 'get_contact_health_history|get_volume_trend|match_emails_to_companies_by_domain|match_emails_to_contacts_by_email' quimibond-intelligence/quimibond-intelligence/src
```

Resultado esperado (verificado 2026-04-20): 0 callsites. Si aparecen, revisar qué firma usan.

- [ ] **Step 2: Decidir firma canónica por función**

| Función | Firmas existentes | Canónica (keep) | Razón |
|---|---|---|---|
| `get_contact_health_history` | `(bigint,int)` vs `(text,int)` | `(bigint,int)` | ID numérico es más eficiente |
| `get_volume_trend` | `()` vs `(int)` | `(int p_days)` | Parametrizable |
| `match_emails_to_companies_by_domain` | `()` vs `(int)` | `(int batch_size)` | Parametrizable |
| `match_emails_to_contacts_by_email` | `()` vs `(int)` | `(int batch_size)` | Parametrizable |

- [ ] **Step 3: Migration SQL**

```sql
-- 20260420_fase2_09_drop_duplicate_fn_signatures.sql
BEGIN;
  DROP FUNCTION IF EXISTS public.get_contact_health_history(text, integer);
  DROP FUNCTION IF EXISTS public.get_volume_trend();
  DROP FUNCTION IF EXISTS public.match_emails_to_companies_by_domain();
  DROP FUNCTION IF EXISTS public.match_emails_to_contacts_by_email();

  INSERT INTO public.schema_changes (change_type, object_name, notes) VALUES
    ('drop_function','get_contact_health_history(text,int)','Fase 2 — keep bigint signature'),
    ('drop_function','get_volume_trend()','Fase 2 — keep (int)'),
    ('drop_function','match_emails_to_companies_by_domain()','Fase 2 — keep (int)'),
    ('drop_function','match_emails_to_contacts_by_email()','Fase 2 — keep (int)');
COMMIT;
```

- [ ] **Step 4: Smoke test — llamar cada fn canónica**

```sql
SELECT * FROM public.get_volume_trend(30) LIMIT 1;
SELECT * FROM public.match_emails_to_companies_by_domain(10) LIMIT 1;
SELECT * FROM public.match_emails_to_contacts_by_email(10) LIMIT 1;
-- get_contact_health_history requiere un id válido
SELECT * FROM public.get_contact_health_history((SELECT id FROM contacts LIMIT 1), 30) LIMIT 1;
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260420_fase2_09_drop_duplicate_fn_signatures.sql
git commit -m "refactor(db): drop duplicate function signatures (4 pairs)"
```

---

## Fase C — `odoo_payments` deprecation (staged)

### Task 10: Migrar frontend `odoo_payments` → `odoo_account_payments`

**Files:**
- Modify: `quimibond-intelligence/quimibond-intelligence/src/lib/queries/_shared/payments.ts`
- Modify: `quimibond-intelligence/quimibond-intelligence/src/app/empresas/[id]/page.tsx`

- [ ] **Step 1: Mapear columnas odoo_payments → odoo_account_payments**

| odoo_payments | odoo_account_payments | Notas |
|---|---|---|
| `id` | `id` | PK serial |
| `name` | `name` | |
| `payment_type` | `payment_type` | inbound/outbound |
| `amount` | `amount` | MXN amount |
| `currency` | `currency` | |
| `payment_date` | `date` | **rename** |
| `state` | `state` | |
| `payment_category` | — | **no existe**; derivar de `partner_type` (customer/supplier) o `journal_name` |
| `amount_mxn` | `amount_signed` | Con signo (entradas + / salidas −) |
| `synced_at` | `synced_at` | |

- [ ] **Step 2: Reescribir `getCompanyPayments`**

```ts
// src/lib/queries/_shared/payments.ts
import "server-only";
import { getServiceClient } from "@/lib/supabase-server";

export interface CompanyPaymentRow {
  id: number;
  name: string | null;
  payment_type: string | null;
  amount: number | null;
  currency: string | null;
  payment_date: string | null;
  state: string | null;
  payment_category: string | null;
  amount_mxn: number | null;
  synced_at: string | null;
}

export async function getCompanyPayments(
  companyId: number,
  limit = 100,
): Promise<CompanyPaymentRow[]> {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("odoo_account_payments")
    .select(
      "id, name, payment_type, amount, currency, date, state, partner_type, amount_signed, synced_at",
    )
    .eq("company_id", companyId)
    .order("date", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw new Error(`company payments query failed: ${error.message}`);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id as number,
    name: r.name as string | null,
    payment_type: r.payment_type as string | null,
    amount: r.amount as number | null,
    currency: r.currency as string | null,
    payment_date: r.date as string | null,
    state: r.state as string | null,
    payment_category: (r.partner_type === "customer" ? "customer" :
                       r.partner_type === "supplier" ? "supplier" : null),
    amount_mxn: r.amount_signed as number | null,
    synced_at: r.synced_at as string | null,
  }));
}
```

- [ ] **Step 3: Actualizar comentario en `empresas/[id]/page.tsx`**

Cambiar `{/* 6. Pagos — historial de cobros y pagos desde odoo_payments */}` a `{/* 6. Pagos — historial de cobros y pagos desde odoo_account_payments */}`.

- [ ] **Step 4: Smoke test manual**

`npm run dev`, abrir `http://localhost:3000/empresas/<id>`, ir a tab "Pagos". Verificar que carga sin error y muestra pagos (fecha, monto, tipo).

Nota: si no hay dev server disponible, reportarlo explícitamente.

- [ ] **Step 5: Commit**

```bash
git add src/lib/queries/_shared/payments.ts src/app/empresas/\[id\]/page.tsx
git commit -m "refactor(queries): getCompanyPayments → odoo_account_payments"
```

---

### Task 11: Actualizar vista `odoo_sync_freshness` (remover row `odoo_payments`)

**Files:**
- Create: `quimibond-intelligence/quimibond-intelligence/supabase/migrations/20260420_fase2_10_update_odoo_sync_freshness.sql`

- [ ] **Step 1: Extraer definición actual**

```sql
SELECT definition FROM pg_views WHERE schemaname='public' AND viewname='odoo_sync_freshness';
```

Guardar output. El view tiene una CTE `per_table` con un `UNION ALL` que incluye un bloque `'odoo_payments'`. Remover ese bloque.

- [ ] **Step 2: Migration**

```sql
-- 20260420_fase2_10_update_odoo_sync_freshness.sql
BEGIN;
  CREATE OR REPLACE VIEW public.odoo_sync_freshness AS
  -- PEGAR definición actual MENOS el UNION ALL bloque 'odoo_payments'::text
  …;
  INSERT INTO public.schema_changes (change_type, object_name, notes) VALUES
    ('replace_view','odoo_sync_freshness','Fase 2 — removido odoo_payments row previo a drop');
COMMIT;
```

- [ ] **Step 3: Smoke test**

```sql
SELECT table_name, status FROM public.odoo_sync_freshness ORDER BY table_name;
-- Expected: sin row 'odoo_payments'; odoo_account_payments sigue
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260420_fase2_10_update_odoo_sync_freshness.sql
git commit -m "chore(db): remove odoo_payments row from odoo_sync_freshness view"
```

---

### Task 12: Remover `_push_payments` del addon qb19

**Files:**
- Modify: `/Users/jj/addons/quimibond_intelligence/models/sync_push.py` (línea ~340 `('payments', self._push_payments)` + el método completo)

- [ ] **Step 1: Localizar definición**

```bash
rg -n "_push_payments|'payments'" /Users/jj/addons/quimibond_intelligence/models/sync_push.py
```

- [ ] **Step 2: Editar**

- Quitar la entry `('payments', self._push_payments)` de la lista en `push_to_supabase()` (~línea 340).
- Borrar la definición completa del método `_push_payments` (y helpers dedicados).
- No tocar `_push_account_payments`.

- [ ] **Step 3: Smoke test (estático)**

```bash
cd /Users/jj
python -c "import ast; ast.parse(open('addons/quimibond_intelligence/models/sync_push.py').read())"
# Expected: sin error
rg -n "_push_payments" addons/quimibond_intelligence/
# Expected: 0 matches
```

- [ ] **Step 4: Commit en qb19**

```bash
cd /Users/jj
git checkout -b fase-2-limpieza
git add addons/quimibond_intelligence/models/sync_push.py
git commit -m "refactor(addon): drop _push_payments (use _push_account_payments only)"
```

**IMPORTANTE:** No cambiar `__manifest__.py`. El usuario deploy manual.

---

### Task 13: DROP `odoo_payments` (destructivo — gated, al final)

**Files:**
- Create: `quimibond-intelligence/quimibond-intelligence/supabase/migrations/20260420_fase2_12_drop_odoo_payments.sql`

**Pre-condiciones (verificar antes de ejecutar):**
1. Task 10 mergeado a `main` y deployado a Vercel.
2. Task 12 mergeado a `main` y deployado a Odoo.sh (`odoo-update` ejecutado por usuario).
3. Task 11 aplicado (view actualizada).
4. `rg -n "odoo_payments" quimibond-intelligence/quimibond-intelligence/src` retorna 0 líneas de código activo (solo comentarios/migrations).

- [ ] **Step 1: Verificar pre-condiciones**

Correr los greps y reportar al usuario. **NO proceder si falla cualquier check.**

- [ ] **Step 2: Confirmar último uso en Supabase (views + funciones)**

```sql
-- Ninguna view/MV/fn debe referenciar odoo_payments
SELECT n.nspname, c.relname, c.relkind FROM pg_depend d
JOIN pg_class c ON c.oid=d.objid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE d.refobjid='public.odoo_payments'::regclass AND c.relkind IN ('v','m');
-- Expected: empty

SELECT p.proname FROM pg_proc p WHERE pronamespace='public'::regnamespace
  AND pg_get_functiondef(p.oid) ILIKE '%odoo_payments%';
-- Expected: empty (o false positives tipo 'odoo_account_payments' — revisar manualmente)
```

- [ ] **Step 3: Migration**

```sql
-- 20260420_fase2_12_drop_odoo_payments.sql
BEGIN;
  DROP TABLE public.odoo_payments;
  INSERT INTO public.schema_changes (change_type, object_name, notes)
  VALUES ('drop_table','odoo_payments','Fase 2 — 53k rows legacy proxy; reemplazada por odoo_account_payments');
COMMIT;
```

- [ ] **Step 4: Pedir OK explícito al usuario**

"Task 13 es el último destructivo: DROP TABLE odoo_payments (53,683 rows). Frontend ya migrado y deployado; addon ya no escribe. ¿Apruebas?"

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260420_fase2_12_drop_odoo_payments.sql
git commit -m "chore(db): drop odoo_payments (legacy proxy, migrated)"
```

---

## Fase D — cfdi_uuid push idempotency

### Task 14: Añadir UNIQUE partial index a `odoo_invoices.cfdi_uuid`

**Files:**
- Create: `quimibond-intelligence/quimibond-intelligence/supabase/migrations/20260420_fase2_11_add_unique_cfdi_uuid.sql`

- [ ] **Step 1: Verificar que NO hay duplicados hoy**

```sql
SELECT cfdi_uuid, COUNT(*) n FROM odoo_invoices
WHERE cfdi_uuid IS NOT NULL GROUP BY cfdi_uuid HAVING COUNT(*) > 1;
-- Expected: 0 rows (Fase 0 dedupeó 3,774)
```

**Si hay dups:** pausar, reportar al usuario, dedup primero (archivar duplicados a `odoo_invoices_archive_dup_cfdi_uuid_2026_04_20`, mantener MIN(odoo_invoice_id)). No aplicar index si falla.

- [ ] **Step 2: Migration**

```sql
-- 20260420_fase2_11_add_unique_cfdi_uuid.sql
BEGIN;
  CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_odoo_invoices_cfdi_uuid
    ON public.odoo_invoices (cfdi_uuid)
    WHERE cfdi_uuid IS NOT NULL;

  INSERT INTO public.schema_changes (change_type, object_name, notes)
  VALUES ('create_index','uq_odoo_invoices_cfdi_uuid','Fase 2 — partial UNIQUE para prevenir re-introducción de duplicados CFDI');
COMMIT;
```

**Nota:** `CREATE INDEX CONCURRENTLY` no corre dentro de transacción en PostgreSQL — ajustar: remover BEGIN/COMMIT y correr la sentencia sola, dejar el INSERT INTO schema_changes en una segunda migration o transacción separada.

Alternativa segura (una sola migration):

```sql
-- 20260420_fase2_11_add_unique_cfdi_uuid.sql
CREATE UNIQUE INDEX IF NOT EXISTS uq_odoo_invoices_cfdi_uuid
  ON public.odoo_invoices (cfdi_uuid)
  WHERE cfdi_uuid IS NOT NULL;

INSERT INTO public.schema_changes (change_type, object_name, notes)
VALUES ('create_index','uq_odoo_invoices_cfdi_uuid','Fase 2 — partial UNIQUE para prevenir re-introducción de duplicados CFDI');
```

(Sin CONCURRENTLY porque la tabla tiene ~60k rows — el lock es corto, aceptable).

- [ ] **Step 3: Smoke test**

```sql
-- Intentar insertar un duplicado debe fallar
DO $$
DECLARE v_uuid text;
BEGIN
  SELECT cfdi_uuid INTO v_uuid FROM odoo_invoices WHERE cfdi_uuid IS NOT NULL LIMIT 1;
  BEGIN
    INSERT INTO odoo_invoices (odoo_invoice_id, cfdi_uuid, odoo_partner_id, move_type, state)
    VALUES (-12345, v_uuid, 1, 'out_invoice', 'posted');
    RAISE EXCEPTION 'Expected unique violation, got insert';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'OK — unique constraint en cfdi_uuid funcional';
  END;
END $$;
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260420_fase2_11_add_unique_cfdi_uuid.sql
git commit -m "chore(db): partial UNIQUE index on odoo_invoices.cfdi_uuid"
```

---

### Task 15: Proteger `_push_invoices` contra colisión cfdi_uuid

**Files:**
- Modify: `/Users/jj/addons/quimibond_intelligence/models/sync_push.py` (método `_push_invoices`, ~línea 1133)

**Contexto:** El upsert actual usa `on_conflict='odoo_invoice_id'`. Si 2 `odoo_invoice_id` distintos comparten `cfdi_uuid` (caso real: factura cancelada + re-emitida), el UPSERT se vuelve INSERT y viola UNIQUE del index nuevo → batch falla. Hay que decidir: saltar o actualizar.

**Decisión:** La factura re-emitida es la versión "buena"; la cancelada debería archivarse. En el push, si el INSERT falla con unique_violation de `uq_odoo_invoices_cfdi_uuid`, loggear a `ingestion.failures` y saltar (no bloquear el batch completo). El existing `upsert_with_details` ya maneja fallos por row y los reporta.

- [ ] **Step 1: Revisar `SupabaseClient.upsert_with_details`**

```bash
rg -n "upsert_with_details" /Users/jj/addons/quimibond_intelligence/models/
```

Verificar que retorna `(ok_count, failed_list)` incluyendo errores 23505 (unique_violation). Si ya lo hace, el código de `_push_invoices` ya captura el error en `all_failed` y lo loggea. **No hace falta cambio.**

- [ ] **Step 2: Añadir comment en `_push_invoices` documentando la invariante**

En la línea `on_conflict='odoo_invoice_id'`, agregar comment:

```python
# Upsert por odoo_invoice_id (PK de Odoo, único cross-company).
# Si cfdi_uuid ya existe en OTRO odoo_invoice_id (factura cancelada + re-emitida),
# el INSERT implícito falla por uq_odoo_invoices_cfdi_uuid → row reportada a
# ingestion.failures como partial; no bloquea el batch. Ver migration
# 20260420_fase2_11_add_unique_cfdi_uuid.sql.
ok_batch, failed_batch = client.upsert_with_details(
    'odoo_invoices', rows, on_conflict='odoo_invoice_id', batch_size=200
)
```

- [ ] **Step 3: Smoke test (Odoo shell, opcional)**

```python
# En /home/odoo console — pedirle al usuario que corra:
env['qb.sync.push'].push_to_supabase()
# Revisar /api/audit_runs y buscar 'partial' con error_code='23505'
```

- [ ] **Step 4: Commit qb19**

```bash
cd /Users/jj
git add addons/quimibond_intelligence/models/sync_push.py
git commit -m "docs(addon): document cfdi_uuid unique invariant in _push_invoices"
```

---

## Fase E — Cierre

### Task 16: Post-audit + update spec + memoria

**Files:**
- Modify: `quimibond-intelligence/quimibond-intelligence/docs/superpowers/plans/2026-04-20-supabase-audit-fase-2-limpieza-audit-notes.md`
- Modify: `/Users/jj/.claude/projects/-Users-jj/memory/project_supabase_audit_2026_04_19.md`

- [ ] **Step 1: Re-correr queries del Task 0**

Las mismas 4 queries. Guardar en `audit-notes.md` bajo `## Después`.

- [ ] **Step 2: Actualizar memoria**

Añadir a `project_supabase_audit_2026_04_19.md`:

```md
## Fase 2 Limpieza — cerrada 2026-04-XX
- 5 tablas muertas tratadas: chat_memory, agent_insights_archive_pre_fase6, revenue_metrics, employee_metrics dropeadas; budgets = <decisión>
- 6 triggers consolidados (3 updated_at + 2 invoice_lines + 1 order_lines)
- 4 pares de firmas de funciones → 1 por función
- odoo_payments DEPRECATED → dropeada (53k rows); frontend migrado a odoo_account_payments; addon _push_payments removido
- UNIQUE partial cfdi_uuid aplicado (previene re-introducción de dups Fase 0)
- Task 2.4 (UNIQUE + onConflict en entities/facts/entity_relationships): estaba ya hecho desde Fase 1, verificado
- Commits: …
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-04-20-supabase-audit-fase-2-limpieza-audit-notes.md
git commit -m "docs(audit): fase 2 limpieza post-flight + memory update"
```

- [ ] **Step 4: Reportar al usuario**

"Fase 2 completa. Cambios: X tablas dropeadas, Y triggers consolidados, Z firmas duplicadas eliminadas, odoo_payments deprecada. PRs listos para merge:
- Frontend: `fase-2-limpieza` → `main` (N commits)
- qb19: `fase-2-limpieza` → `main` (2 commits)

Para deploy prod:
```
# Frontend (Vercel): merge a main, auto-deploy
# qb19 (Odoo.sh):
git checkout quimibond && git merge main && git push
# luego en Odoo.sh shell:
odoo-update quimibond_intelligence && odoosh-restart http && odoosh-restart cron
```"

---

## Orden de ejecución recomendado

1. Task 0 (baseline audit)
2. Tasks 6, 7, 8, 9 (no destructivos — triggers/fns duplicadas) — se pueden aplicar sin riesgo
3. Task 1 (chat_memory — frontend retirada + drop)
4. Task 2 (agent_insights_archive — export + drop)
5. Task 3 (revenue_metrics — writer + drop)
6. Task 4 (employee_metrics — writer + drop)
7. Task 5 (budgets — **user decide**)
8. Task 14 (UNIQUE cfdi_uuid)
9. Task 15 (cfdi_uuid comment en addon)
10. Task 10 (migrate frontend `odoo_payments` → `odoo_account_payments`)
11. Task 12 (addon `_push_payments` drop)
12. Task 11 (view odoo_sync_freshness update)
13. → **Merge a main + deploy frontend y qb19** (usuario hace esto)
14. Task 13 (DROP odoo_payments — gated, al final)
15. Task 16 (post-audit + memoria)

---

## DoD

- [ ] `budgets`, `chat_memory`, `revenue_metrics`, `employee_metrics`, `agent_insights_archive_pre_fase6` tratadas (drop o keep-as-contract con comentario)
- [ ] 4 funciones duplicadas: 1 firma cada
- [ ] `odoo_invoice_lines` ≤ 2 triggers, `odoo_order_lines` = 1 trigger, `odoo_products/bank_balances/users` = 1 trigger `updated_at`
- [ ] `odoo_payments` sin consumers en frontend ni push desde addon; tabla dropeada
- [ ] UNIQUE partial en `odoo_invoices.cfdi_uuid` activa y verificada
- [ ] `schema_changes` tiene entradas por cada DROP/REPLACE
- [ ] `audit-notes.md` con `## Antes` / `## Después`
- [ ] Memoria `project_supabase_audit_2026_04_19.md` actualizada

---

## Riesgos & mitigaciones

| Riesgo | Mitigación |
|---|---|
| Drop de tabla usada por view/function oculta | `pg_depend` check + `rg` en frontend antes de cada drop; schema_changes queda como audit trail |
| Trigger canónico rompe sync en vivo | Smoke test con `INSERT/UPDATE` + ROLLBACK dentro de transacción antes del merge |
| UNIQUE cfdi_uuid rechaza inserts válidos post-add | Task 15 documenta que `upsert_with_details` captura 23505 y reporta row-level sin bloquear el batch |
| `odoo_payments` drop rompe alguna query no detectada | Gated tras deploy confirmado; Task 13 re-verifica `pg_depend` antes |
| Migration con CONCURRENTLY en transacción falla | Se usa CREATE INDEX sin CONCURRENTLY (tabla mediana, lock breve aceptable) |

---

## Self-review

- [x] Task 0 captura baseline antes de cualquier cambio
- [x] Tasks 1-5 son dead-table drops (cubre 2.1 del spec)
- [x] Tasks 6-8 consolidan triggers (cubre 2.3)
- [x] Task 9 consolida firmas (cubre 2.2)
- [x] Tasks 10-13 migran + drop odoo_payments (cubre 2.5)
- [x] Task 14 resuelve causa raíz del cfdi_uuid (cubre 2.7)
- [x] Task 15 documenta invariante del push (cubre 2.7 robusto)
- [x] Task 16 cierra con audit + memoria
- [x] Sin placeholders en código (migrations tienen template copy-paste con nota de dónde pegar definición de view)
- [x] Destructivas marcadas con "gated — OK explícito"
- [x] 2.4 del spec documentado como "ya hecho en Fase 1, verificado"
- [x] 2.6 del spec marcado out-of-scope
