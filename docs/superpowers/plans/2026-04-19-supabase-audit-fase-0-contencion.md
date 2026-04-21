# Fase 0 — Contención Supabase: Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolver issues críticos que hoy contaminan la capa unificada y tienen los dashboards rotos: reconciliation engine parado, 3,774 duplicados `cfdi_uuid`, crons de snapshots/crm_leads/journal_flow_profile stale.

**Architecture:** Mezcla de investigación operativa (diagnosticar crons) + migraciones SQL (dedup + UNIQUE INDEX) + fixes de config (frontend cron + addon filter). Todo cambio destructivo pasa por tabla de archive antes del DELETE para rollback. Baseline y post-validation en `audit_runs`.

**Tech Stack:** PostgreSQL (Supabase `tozqezmivpblmcubmnpi`), Next.js 14 (frontend cron), Python (Odoo 19 addon), MCP tools `mcp__claude_ai_Supabase__*` para DDL/DML, git para tracking.

**Spec parent:** [2026-04-19-supabase-audit-01-contencion.md](../specs/2026-04-19-supabase-audit-01-contencion.md)

**Repos afectados:**
- `/Users/jj` — root del repo (donde viven `docs/` y migraciones)
- `/Users/jj/addons/quimibond_intelligence/` — addon Odoo 19 (`sync_push.py`)
- `/Users/jj/quimibond-intelligence/` — frontend Next.js (crons de Vercel, API routes)

**Supabase project_id:** `tozqezmivpblmcubmnpi`

**Convención de migraciones:** `supabase/migrations/<YYYYMMDDHHMMSS>_phase_0_<short_desc>.sql` (directorio a crear si no existe en el repo root).

---

## Estructura de archivos

**Crear:**
- `supabase/migrations/20260419120000_phase_0_dedup_cfdi_uuid.sql` — archive + DELETE + UNIQUE partial + REFRESH
- `supabase/migrations/20260419120100_phase_0_journal_flow_profile.sql` — fix de MV (si aplica)
- `supabase/migrations/20260419120200_phase_0_baseline_invariants.sql` — insert a `audit_runs` con baseline y final
- `docs/superpowers/notes/2026-04-19-reconciliation-cron-rca.md` — root cause del reconciliation parado

**Modificar (potencial — se descubre en Tasks 3, 5, 6):**
- `/Users/jj/quimibond-intelligence/vercel.json` o `/Users/jj/quimibond-intelligence/app/api/cron/**` — fix cron de snapshots
- `/Users/jj/addons/quimibond_intelligence/models/sync_push.py` — ajuste filtro `_push_crm_leads`

**Tabla temporal de archive (en Supabase, no en git):**
- `public.odoo_invoices_archive_pre_dedup` (retener 90 días post-merge)

---

## Task 1: Setup y baseline

**Files:**
- Create: `supabase/migrations/20260419120200_phase_0_baseline_invariants.sql`

- [ ] **Step 1.1: Verificar acceso a Supabase MCP**

Run:
```
mcp__claude_ai_Supabase__execute_sql
  project_id: "tozqezmivpblmcubmnpi"
  query: "SELECT current_database(), current_user, now();"
```

Expected: devuelve una row con `postgres`, usuario actual, timestamp. Si falla con autenticación, abortar y pedir re-auth.

- [ ] **Step 1.2: Crear rama git `fase-0-contencion`**

Run:
```bash
cd /Users/jj
git checkout -b fase-0-contencion
```

Expected: `Switched to a new branch 'fase-0-contencion'`.

- [ ] **Step 1.3: Crear directorio `supabase/migrations/` si no existe**

Run:
```bash
mkdir -p /Users/jj/supabase/migrations
ls /Users/jj/supabase/migrations
```

Expected: directorio creado (vacío está OK).

- [ ] **Step 1.4: Escribir migración de baseline invariants**

Crear `/Users/jj/supabase/migrations/20260419120200_phase_0_baseline_invariants.sql`:

```sql
-- Phase 0 baseline: captura métricas clave ANTES de ejecutar fixes.
-- Se re-ejecuta al final de la fase para validar.

INSERT INTO public.audit_runs (invariant, severity, passed, detail, run_at)
SELECT
  'phase_0_baseline',
  'info',
  true,
  jsonb_build_object(
    'odoo_invoices_total', (SELECT COUNT(*) FROM public.odoo_invoices),
    'cfdi_uuid_groups_dupes', (
      SELECT COUNT(*) FROM (
        SELECT cfdi_uuid FROM public.odoo_invoices
        WHERE cfdi_uuid IS NOT NULL
        GROUP BY cfdi_uuid HAVING COUNT(*) > 1
      ) x
    ),
    'cfdi_uuid_extra_rows', (
      SELECT COALESCE(SUM(n - 1), 0) FROM (
        SELECT COUNT(*) AS n FROM public.odoo_invoices
        WHERE cfdi_uuid IS NOT NULL
        GROUP BY cfdi_uuid HAVING COUNT(*) > 1
      ) x
    ),
    'reconciliation_issues_open', (
      SELECT COUNT(*) FROM public.reconciliation_issues WHERE resolved_at IS NULL
    ),
    'reconciliation_issue_types_active_last_24h', (
      SELECT jsonb_agg(DISTINCT issue_type)
      FROM public.reconciliation_issues
      WHERE detected_at > now() - interval '24 hours'
    ),
    'invoices_unified_rows', (SELECT COUNT(*) FROM public.invoices_unified),
    'payments_unified_rows', (SELECT COUNT(*) FROM public.payments_unified),
    'odoo_snapshots_max_created', (SELECT MAX(created_at) FROM public.odoo_snapshots),
    'odoo_crm_leads_rows', (SELECT COUNT(*) FROM public.odoo_crm_leads),
    'journal_flow_profile_rows', (SELECT COUNT(*) FROM public.journal_flow_profile)
  ),
  now();
```

- [ ] **Step 1.5: Ejecutar migración de baseline en Supabase**

Run:
```
mcp__claude_ai_Supabase__execute_sql
  project_id: "tozqezmivpblmcubmnpi"
  query: <contenido completo del archivo 20260419120200_phase_0_baseline_invariants.sql>
```

Expected: `INSERT 0 1`.

- [ ] **Step 1.6: Leer y guardar el baseline**

Run:
```
mcp__claude_ai_Supabase__execute_sql
  project_id: "tozqezmivpblmcubmnpi"
  query: "SELECT detail FROM public.audit_runs WHERE invariant='phase_0_baseline' ORDER BY run_at DESC LIMIT 1;"
```

Expected: JSON con las 10 métricas. Copiarlo al notes file en Step 1.7.

- [ ] **Step 1.7: Crear notes file con baseline**

Crear `/Users/jj/docs/superpowers/notes/2026-04-19-supabase-fase-0-baseline.md`:

```markdown
# Fase 0 — Baseline (2026-04-19)

<pegar el JSON del Step 1.6>

## Expectativas post-fase (según spec)
- cfdi_uuid_groups_dupes: 1547 → 0
- cfdi_uuid_extra_rows: 3774 → 0
- invoices_unified_rows: ~96000 → ~153700 (odoo post-dedup + syntage)
- odoo_snapshots_max_created: 2026-04-19 05:30 → última hora
- reconciliation_issue_types_active_last_24h: ["posted_but_sat_uncertified", "partner_blacklist_69b"] → los 8 tipos
```

- [ ] **Step 1.8: Commit**

Run:
```bash
cd /Users/jj
mkdir -p docs/superpowers/notes
git add supabase/migrations/20260419120200_phase_0_baseline_invariants.sql docs/superpowers/notes/2026-04-19-supabase-fase-0-baseline.md
git commit -m "chore(supabase): phase 0 baseline invariants captured"
```

Expected: commit exitoso.

---

## Task 2: Investigar root cause del reconciliation parado

**Files:**
- Create: `docs/superpowers/notes/2026-04-19-reconciliation-cron-rca.md`

- [ ] **Step 2.1: Query para confirmar el estado actual**

Run:
```
mcp__claude_ai_Supabase__execute_sql
  project_id: "tozqezmivpblmcubmnpi"
  query: "SELECT issue_type, COUNT(*) AS total, MIN(detected_at) AS first, MAX(detected_at) AS last, COUNT(*) FILTER (WHERE detected_at > now() - interval '24 hours') AS last_24h FROM public.reconciliation_issues GROUP BY issue_type ORDER BY last DESC;"
```

Expected: confirmar que solo 2 de 8 `issue_type` tienen filas en `last_24h`.

- [ ] **Step 2.2: Inspeccionar pg_cron jobs**

Run:
```
mcp__claude_ai_Supabase__execute_sql
  project_id: "tozqezmivpblmcubmnpi"
  query: "SELECT jobid, schedule, command, active, jobname FROM cron.job ORDER BY jobname;"
```

Documentar los 5 jobs. Ninguno obvio es "reconciliation" — confirmar.

- [ ] **Step 2.3: Buscar la función que alimenta reconciliation_issues**

Run:
```
mcp__claude_ai_Supabase__execute_sql
  project_id: "tozqezmivpblmcubmnpi"
  query: "SELECT p.proname, pg_get_functiondef(p.oid) AS def FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid WHERE n.nspname='public' AND (p.proname ILIKE '%reconciliation%' OR p.proname ILIKE '%refresh_invoices_unified%' OR p.proname ILIKE '%refresh_payments_unified%') ORDER BY p.proname;"
```

Expected: devuelve 3-5 funciones. Inspeccionar cuál inserta a `reconciliation_issues` (ojo con `REFRESH MATERIALIZED VIEW` que no inserta pero puede ser triggered). La función relevante probablemente hace `INSERT INTO reconciliation_issues ...`.

- [ ] **Step 2.4: Buscar en el frontend por crons de reconciliation**

Run:
```
Grep
  pattern: "reconciliation|refresh_invoices_unified|refresh_payments_unified"
  path: /Users/jj/quimibond-intelligence
  output_mode: files_with_matches
```

Enumerar archivos. Para cada uno, abrir y resumir qué hace.

- [ ] **Step 2.5: Inspeccionar `vercel.json` y crons de Vercel**

Run:
```
Read
  file_path: /Users/jj/quimibond-intelligence/vercel.json
```

Documentar todos los crons listados, con su schedule y endpoint.

- [ ] **Step 2.6: Revisar la edge function `query-intelligence`**

Run:
```
mcp__claude_ai_Supabase__get_edge_function
  project_id: "tozqezmivpblmcubmnpi"
  function_slug: "query-intelligence"
```

Expected: devuelve el source. Grep por "reconciliation" en el source; si aparece, documentar.

- [ ] **Step 2.7: Inspeccionar el trigger de `unified_refresh_queue`**

Run:
```
mcp__claude_ai_Supabase__execute_sql
  project_id: "tozqezmivpblmcubmnpi"
  query: "SELECT event_object_table, trigger_name, action_statement FROM information_schema.triggers WHERE trigger_schema='public' AND trigger_name ILIKE '%unified%' ORDER BY event_object_table, trigger_name;"
```

Expected: lista triggers. Si `unified_refresh_queue` tiene 0 filas (como está hoy), quizá el mecanismo que enqueue está roto o nunca se activó.

- [ ] **Step 2.8: Escribir RCA**

Crear `/Users/jj/docs/superpowers/notes/2026-04-19-reconciliation-cron-rca.md` con estructura:

```markdown
# Reconciliation engine — Root Cause Analysis (2026-04-19)

## Síntoma
5 de 8 issue_types sin detección nueva desde 2026-04-17 20:29. Los 2 vivos: `posted_but_sat_uncertified`, `partner_blacklist_69b`.

## Inventario
- pg_cron jobs relacionados: <pegar de Step 2.2>
- Funciones SQL relacionadas: <de Step 2.3>
- Frontend crons: <de Step 2.5>
- Edge function query-intelligence usa reconciliation?: <de Step 2.6>
- Triggers sobre unified_refresh_queue: <de Step 2.7>

## Causa raíz (hipótesis ordenadas por probabilidad)
1. [principal] ...
2. ...

## Plan de fix
Acciones concretas para Task 3. Si la causa es "cron deshabilitado": habilitar. Si es "función con bug": fix con SQL exacto. Si es "trigger desarmado": reescribir trigger.
```

- [ ] **Step 2.9: Commit**

Run:
```bash
cd /Users/jj
git add docs/superpowers/notes/2026-04-19-reconciliation-cron-rca.md
git commit -m "docs(supabase): RCA reconciliation cron parado 2d"
```

---

## Task 3: Revivir el reconciliation engine

**Files (dependen del RCA):**
- Potencial: `supabase/migrations/20260419120300_phase_0_revive_reconciliation.sql`
- Potencial: modificación en `/Users/jj/quimibond-intelligence/vercel.json` o `app/api/cron/reconciliation/route.ts`
- Potencial: nuevo `pg_cron.schedule(...)` call

**Rama A: la causa es pg_cron deshabilitado o mal schedule**

- [ ] **Step 3A.1: Escribir migración de re-habilitación**

Crear `/Users/jj/supabase/migrations/20260419120300_phase_0_revive_reconciliation.sql`:

```sql
-- Re-habilitar el cron de reconciliation. El nombre y schedule se ajustan
-- según RCA (ver notes/2026-04-19-reconciliation-cron-rca.md).

-- Si el job existe pero está inactivo:
UPDATE cron.job SET active = true WHERE jobname = '<nombre_del_job>';

-- Si el job no existe, crearlo (ajustar comando según la función real):
SELECT cron.schedule(
  'reconciliation-full-scan',
  '*/30 * * * *',  -- cada 30 min; ajustar si el spec pide otro ritmo
  $$SELECT public.<fn_reconciliation_full>();$$
);
```

- [ ] **Step 3A.2: Ejecutar migración**

Run:
```
mcp__claude_ai_Supabase__execute_sql
  project_id: "tozqezmivpblmcubmnpi"
  query: <contenido completo de 20260419120300>
```

Expected: `UPDATE 1` o row con jobid nuevo.

- [ ] **Step 3A.3: Disparar manualmente la función una vez para prime del estado**

Run:
```
mcp__claude_ai_Supabase__execute_sql
  project_id: "tozqezmivpblmcubmnpi"
  query: "SELECT public.<fn_reconciliation_full>();"
```

Expected: completa sin error. Puede tardar 30-60s.

- [ ] **Step 3A.4: Verificar que los 8 issue_types tienen detección reciente**

Run:
```
mcp__claude_ai_Supabase__execute_sql
  project_id: "tozqezmivpblmcubmnpi"
  query: "SELECT issue_type, MAX(detected_at) AS last FROM public.reconciliation_issues GROUP BY issue_type ORDER BY last DESC;"
```

Expected: los 8 tipos con `last` dentro de la última hora.

**Rama B: la causa es función con bug (solo detecta 2 tipos)**

- [ ] **Step 3B.1: Obtener definition de la función buggy**

Run:
```
mcp__claude_ai_Supabase__execute_sql
  project_id: "tozqezmivpblmcubmnpi"
  query: "SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname='<fn_buggy>' AND pronamespace = 'public'::regnamespace;"
```

Expected: devuelve el body de la función.

- [ ] **Step 3B.2: Escribir migración con fix de la función**

Crear `/Users/jj/supabase/migrations/20260419120300_phase_0_revive_reconciliation.sql` con `CREATE OR REPLACE FUNCTION public.<fn_buggy>(...) ...` que incluya las 6 queries de detección faltantes. El contenido exacto depende del RCA — NO escribir placeholder, escribir las 6 queries reales.

- [ ] **Step 3B.3: Ejecutar migración**

Run:
```
mcp__claude_ai_Supabase__execute_sql
  project_id: "tozqezmivpblmcubmnpi"
  query: <contenido de la migración>
```

Expected: `CREATE FUNCTION`.

- [ ] **Step 3B.4: Disparar la función y verificar**

Run:
```
mcp__claude_ai_Supabase__execute_sql
  project_id: "tozqezmivpblmcubmnpi"
  query: "SELECT public.<fn_buggy>(); SELECT issue_type, MAX(detected_at) FROM public.reconciliation_issues GROUP BY issue_type;"
```

Expected: los 8 tipos con `MAX(detected_at)` reciente.

**Rama C: la causa es cron de Vercel desactivado**

- [ ] **Step 3C.1: Leer vercel.json actual**

Run:
```
Read
  file_path: /Users/jj/quimibond-intelligence/vercel.json
```

- [ ] **Step 3C.2: Añadir/re-habilitar el cron**

Edit en `vercel.json` el bloque `"crons"` para incluir:

```json
{
  "path": "/api/cron/reconciliation",
  "schedule": "*/30 * * * *"
}
```

- [ ] **Step 3C.3: Verificar que `/api/cron/reconciliation/route.ts` existe y es válido**

Run:
```
Read
  file_path: /Users/jj/quimibond-intelligence/app/api/cron/reconciliation/route.ts
```

Si no existe, crearlo con handler que llame a la función SQL vía supabase admin client. Código referencia:

```typescript
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 });
  }
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { error } = await supabase.rpc('<fn_reconciliation_full>');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, ts: new Date().toISOString() });
}
```

- [ ] **Step 3C.4: Commit frontend + deploy a preview**

Run:
```bash
cd /Users/jj/quimibond-intelligence
git add vercel.json app/api/cron/reconciliation/route.ts
git commit -m "fix(cron): revive reconciliation scheduled job"
git push origin HEAD:fase-0-reconciliation-cron  # deploy preview en Vercel
```

- [ ] **Step 3C.5: Disparar manualmente el endpoint**

Run:
```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<preview-url>/api/cron/reconciliation
```

Expected: `{"ok":true,...}`.

- [ ] **Step 3C.6: Merge a main**

Una vez verificado, mergear a main para que el cron de Vercel lo pick up.

**Común a las 3 ramas:**

- [ ] **Step 3.X: Commit migración (si aplica)**

Run:
```bash
cd /Users/jj
git add supabase/migrations/20260419120300_phase_0_revive_reconciliation.sql
git commit -m "fix(supabase): revive reconciliation engine (RCA: <causa>)"
```

- [ ] **Step 3.Y: Re-correr baseline invariants para validar**

Run:
```
mcp__claude_ai_Supabase__execute_sql
  project_id: "tozqezmivpblmcubmnpi"
  query: "SELECT detail->'reconciliation_issue_types_active_last_24h' FROM public.audit_runs WHERE invariant='phase_0_baseline' ORDER BY run_at DESC LIMIT 1; SELECT jsonb_agg(DISTINCT issue_type) FROM public.reconciliation_issues WHERE detected_at > now() - interval '24 hours';"
```

Expected: la segunda query debe devolver array de longitud 8.

---

## Task 4: Dedup de `odoo_invoices.cfdi_uuid`

**Files:**
- Create: `supabase/migrations/20260419120000_phase_0_dedup_cfdi_uuid.sql`

- [ ] **Step 4.1: Test de verificación "hoy falla"**

Run:
```
mcp__claude_ai_Supabase__execute_sql
  project_id: "tozqezmivpblmcubmnpi"
  query: "SELECT (COUNT(*) = 0) AS passes, COUNT(*) AS dup_groups FROM (SELECT cfdi_uuid FROM public.odoo_invoices WHERE cfdi_uuid IS NOT NULL GROUP BY cfdi_uuid HAVING COUNT(*) > 1) x;"
```

Expected: `passes=false, dup_groups=1547`.

- [ ] **Step 4.2: Escribir migración de dedup**

Crear `/Users/jj/supabase/migrations/20260419120000_phase_0_dedup_cfdi_uuid.sql`:

```sql
-- Phase 0 — Deduplicar odoo_invoices por cfdi_uuid.
-- Estrategia: archivar todos los registros con UUID duplicado, retener solo
-- la fila con write_date más reciente (desempate por id mayor).
-- Añadir UNIQUE INDEX parcial para prevenir recurrencia.

BEGIN;

-- 1) Crear tabla de archive (si no existe)
CREATE TABLE IF NOT EXISTS public.odoo_invoices_archive_pre_dedup (
  LIKE public.odoo_invoices INCLUDING ALL,
  archived_at timestamptz NOT NULL DEFAULT now(),
  archive_reason text NOT NULL DEFAULT 'cfdi_uuid_dedup_phase_0'
);

-- 2) Insertar en archive TODAS las filas cuyo cfdi_uuid está duplicado
INSERT INTO public.odoo_invoices_archive_pre_dedup
  (<columnas_explícitas_de_odoo_invoices>)  -- AJUSTAR según schema real
SELECT <columnas_explícitas_de_odoo_invoices>
FROM public.odoo_invoices
WHERE cfdi_uuid IN (
  SELECT cfdi_uuid FROM public.odoo_invoices
  WHERE cfdi_uuid IS NOT NULL
  GROUP BY cfdi_uuid HAVING COUNT(*) > 1
);

-- 3) Verificar archive count == 3774 + dup_groups originales
-- (3,774 extras + 1,547 winners = 5,321 rows en archive)
-- Si count difiere, ROLLBACK.
DO $$
DECLARE
  archive_count int;
BEGIN
  SELECT COUNT(*) INTO archive_count FROM public.odoo_invoices_archive_pre_dedup
  WHERE archive_reason = 'cfdi_uuid_dedup_phase_0';
  IF archive_count < 5000 OR archive_count > 6000 THEN
    RAISE EXCEPTION 'archive_count fuera de rango esperado: %', archive_count;
  END IF;
END $$;

-- 4) DELETE de los "perdedores" (todas las filas excepto la más reciente por UUID)
WITH ranked AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY cfdi_uuid
      ORDER BY write_date DESC NULLS LAST, id DESC
    ) AS rn
  FROM public.odoo_invoices
  WHERE cfdi_uuid IS NOT NULL
    AND cfdi_uuid IN (
      SELECT cfdi_uuid FROM public.odoo_invoices
      WHERE cfdi_uuid IS NOT NULL
      GROUP BY cfdi_uuid HAVING COUNT(*) > 1
    )
)
DELETE FROM public.odoo_invoices
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- 5) Verificar que ya no hay duplicados
DO $$
DECLARE
  dup_count int;
BEGIN
  SELECT COUNT(*) INTO dup_count FROM (
    SELECT cfdi_uuid FROM public.odoo_invoices
    WHERE cfdi_uuid IS NOT NULL
    GROUP BY cfdi_uuid HAVING COUNT(*) > 1
  ) x;
  IF dup_count > 0 THEN
    RAISE EXCEPTION 'dedup falló, quedan % grupos duplicados', dup_count;
  END IF;
END $$;

-- 6) Añadir UNIQUE INDEX parcial para prevenir recurrencia
CREATE UNIQUE INDEX IF NOT EXISTS odoo_invoices_cfdi_uuid_unique
  ON public.odoo_invoices (cfdi_uuid)
  WHERE cfdi_uuid IS NOT NULL;

-- 7) Log en schema_changes
INSERT INTO public.schema_changes (ddl, success, error, applied_at)
VALUES (
  'Phase 0: dedup odoo_invoices.cfdi_uuid + UNIQUE INDEX parcial',
  true, NULL, now()
);

COMMIT;
```

**Nota:** las `<columnas_explícitas_de_odoo_invoices>` se obtienen en Step 4.3.

- [ ] **Step 4.3: Obtener columnas reales de `odoo_invoices`**

Run:
```
mcp__claude_ai_Supabase__execute_sql
  project_id: "tozqezmivpblmcubmnpi"
  query: "SELECT string_agg(column_name, ', ' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema='public' AND table_name='odoo_invoices';"
```

Copiar la lista exacta y sustituir `<columnas_explícitas_de_odoo_invoices>` en la migración (dos lugares: `INSERT INTO ... (...)` y `SELECT ...`).

- [ ] **Step 4.4: Ejecutar la migración**

Run:
```
mcp__claude_ai_Supabase__execute_sql
  project_id: "tozqezmivpblmcubmnpi"
  query: <contenido completo de 20260419120000_phase_0_dedup_cfdi_uuid.sql>
```

Expected: `COMMIT`. Si DO block falla, la transacción rollbackea y hay que investigar.

- [ ] **Step 4.5: Re-correr el test de Step 4.1 — ahora pasa**

Run:
```
mcp__claude_ai_Supabase__execute_sql
  project_id: "tozqezmivpblmcubmnpi"
  query: "SELECT (COUNT(*) = 0) AS passes FROM (SELECT cfdi_uuid FROM public.odoo_invoices WHERE cfdi_uuid IS NOT NULL GROUP BY cfdi_uuid HAVING COUNT(*) > 1) x;"
```

Expected: `passes=true`.

- [ ] **Step 4.6: Verificar row counts**

Run:
```
mcp__claude_ai_Supabase__execute_sql
  project_id: "tozqezmivpblmcubmnpi"
  query: "SELECT (SELECT COUNT(*) FROM public.odoo_invoices) AS current_rows, (SELECT COUNT(*) FROM public.odoo_invoices_archive_pre_dedup) AS archived_rows;"
```

Expected: `current_rows ≈ 23,974` (27,748 - 3,774), `archived_rows ≈ 5,321`.

- [ ] **Step 4.7: REFRESH `invoices_unified`**

Run:
```
mcp__claude_ai_Supabase__execute_sql
  project_id: "tozqezmivpblmcubmnpi"
  query: "REFRESH MATERIALIZED VIEW CONCURRENTLY public.invoices_unified;"
```

Expected: completa sin error. Puede tardar 1-3 min.

- [ ] **Step 4.8: Verificar que `invoices_unified` subió en row count**

Run:
```
mcp__claude_ai_Supabase__execute_sql
  project_id: "tozqezmivpblmcubmnpi"
  query: "SELECT COUNT(*) AS rows FROM public.invoices_unified;"
```

Expected: `rows` > 150000 (antes era 96,511). El target exacto depende de cómo filtra la MV, pero debe subir significativamente.

- [ ] **Step 4.9: Commit migración**

Run:
```bash
cd /Users/jj
git add supabase/migrations/20260419120000_phase_0_dedup_cfdi_uuid.sql
git commit -m "fix(supabase): dedup odoo_invoices cfdi_uuid + UNIQUE INDEX parcial

Phase 0: 1,547 UUIDs con colisión, 3,774 filas extra archivadas a
odoo_invoices_archive_pre_dedup. invoices_unified re-refresh
post-dedup para reflejar data limpia."
```

---

## Task 5: Revivir `odoo_snapshots` cron

**Files:**
- Potencial modify: `/Users/jj/quimibond-intelligence/vercel.json`
- Potencial modify: `/Users/jj/quimibond-intelligence/app/api/cron/snapshot/route.ts` (o similar)

- [ ] **Step 5.1: Confirmar staleness**

Run:
```
mcp__claude_ai_Supabase__execute_sql
  project_id: "tozqezmivpblmcubmnpi"
  query: "SELECT MAX(created_at) AS last_snap, COUNT(*) AS total, age(now(), MAX(created_at)) AS staleness FROM public.odoo_snapshots;"
```

Expected: staleness > 20h (antes del fix).

- [ ] **Step 5.2: Localizar el cron en el frontend**

Run:
```
Grep
  pattern: "take_daily_snapshot|odoo_snapshots|api/cron/snapshot"
  path: /Users/jj/quimibond-intelligence
  output_mode: files_with_matches
```

Listar archivos. El más probable es `app/api/cron/snapshot/route.ts` + entrada en `vercel.json`.

- [ ] **Step 5.3: Leer vercel.json y confirmar schedule**

Run:
```
Read
  file_path: /Users/jj/quimibond-intelligence/vercel.json
```

Ver el bloque `crons`. Confirmar que hay entrada para `/api/cron/snapshot` o similar con schedule diario.

- [ ] **Step 5.4: Leer route handler del snapshot**

Run:
```
Read
  file_path: /Users/jj/quimibond-intelligence/app/api/cron/snapshot/route.ts
```

(Ajustar path si grep devolvió otro.)

- [ ] **Step 5.5: Disparar manualmente el endpoint y leer respuesta**

Obtener Vercel URL actual y `CRON_SECRET` de Vercel env.

Run:
```bash
curl -v -H "Authorization: Bearer $CRON_SECRET" https://quimibond-intelligence.vercel.app/api/cron/snapshot
```

Expected: 200 o error. Si 200: ¿por qué el cron no corrió auto? Si error: leer el mensaje.

- [ ] **Step 5.6: Fix según lo encontrado**

Casos comunes:
- **Cron no estaba registrado en `vercel.json`:** añadir entrada, commit, push.
- **`take_daily_snapshot()` function falla:** abrir logs de Supabase, leer error. Si es un bug de SQL, fix en migración `supabase/migrations/20260419120500_fix_take_daily_snapshot.sql`.
- **CRON_SECRET cambió:** actualizar env var.
- **Function RPC permission denied:** `GRANT EXECUTE ON FUNCTION public.take_daily_snapshot TO service_role;`

Aplicar el fix correspondiente sin placeholder — usar el error real como guía.

- [ ] **Step 5.7: Re-validar**

Esperar la siguiente ejecución programada (o dispararla manualmente) y verificar:

Run:
```
mcp__claude_ai_Supabase__execute_sql
  project_id: "tozqezmivpblmcubmnpi"
  query: "SELECT MAX(created_at) AS last_snap, age(now(), MAX(created_at)) AS staleness FROM public.odoo_snapshots;"
```

Expected: `staleness < 1h`.

- [ ] **Step 5.8: Commit**

Run:
```bash
cd /Users/jj/quimibond-intelligence
git add <archivos_tocados>
git commit -m "fix(cron): revive daily odoo_snapshots cron"
```

---

## Task 6: Revivir `odoo_crm_leads` sync

**Files:**
- Potencial modify: `/Users/jj/addons/quimibond_intelligence/models/sync_push.py`

- [ ] **Step 6.1: Confirmar estado actual**

Run:
```
mcp__claude_ai_Supabase__execute_sql
  project_id: "tozqezmivpblmcubmnpi"
  query: "SELECT COUNT(*) AS rows, MAX(created_at) AS last_created, MAX(updated_at) AS last_updated FROM public.odoo_crm_leads;"
```

Expected: `rows=20` y timestamps >2d atrás.

- [ ] **Step 6.2: Leer el método `_push_crm_leads`**

Run:
```
Grep
  pattern: "_push_crm_leads|crm\\.lead"
  path: /Users/jj/addons/quimibond_intelligence/models/sync_push.py
  output_mode: content
  -n: true
```

Listar las líneas. Abrir el archivo en la sección relevante.

- [ ] **Step 6.3: Identificar el filtro `search_read`**

En `sync_push.py`, encontrar la llamada tipo:
```python
leads = self.env['crm.lead'].search_read([<domain>], [<fields>])
```

Documentar el `<domain>` actual. Posibles problemas:
- Filtro por equipo o usuario específico que excluye todo
- Filtro por `stage_id` que nunca matchea
- Filtro que restringe a `active=True` cuando todos los leads están inactivos

- [ ] **Step 6.4: Contrastar en shell Odoo**

Pedir al usuario correr en shell Odoo.sh:
```python
env['crm.lead'].search_count([])  # total sin filtro
env['crm.lead'].search_count([<domain_actual>])  # con el filtro del addon
```

Documentar la diferencia.

- [ ] **Step 6.5: Ajustar el filtro**

Edit `/Users/jj/addons/quimibond_intelligence/models/sync_push.py` en el método `_push_crm_leads`:

Si el filtro actual es muy restrictivo, reemplazar por uno razonable. Ejemplo:
```python
# ANTES
domain = [('user_id', '=', specific_user_id)]
# DESPUÉS (basado en debugging)
domain = [('active', '=', True)]  # o vacío [] si se quieren todos
```

**Nota:** NO modificar la versión del `__manifest__.py` (según CLAUDE.md).

- [ ] **Step 6.6: Probar en local o pedir al user triggearlo**

Si el user tiene acceso a shell Odoo:
```python
self.env['quimibond.intelligence'].sudo()._push_crm_leads()
```

- [ ] **Step 6.7: Verificar row count post-sync**

Run:
```
mcp__claude_ai_Supabase__execute_sql
  project_id: "tozqezmivpblmcubmnpi"
  query: "SELECT COUNT(*) AS rows, MAX(updated_at) AS last_updated FROM public.odoo_crm_leads;"
```

Expected: `rows` > 20 (el número real depende de cuántos leads tenga Quimibond — confirmar que cuadra con Odoo).

- [ ] **Step 6.8: Deploy del addon**

Per CLAUDE.md:
```bash
cd /Users/jj
git add addons/quimibond_intelligence/models/sync_push.py
git commit -m "fix(sync): _push_crm_leads — corregir filtro que excluía leads válidos"
```

Después el user aplica en Odoo.sh:
```bash
# en shell de Odoo.sh:
odoo-update quimibond_intelligence && odoosh-restart cron
```

---

## Task 7: Fix `journal_flow_profile` MV

**Files:**
- Potencial create: `supabase/migrations/20260419120600_phase_0_journal_flow_profile.sql`

- [ ] **Step 7.1: Confirmar estado de la MV**

Run:
```
mcp__claude_ai_Supabase__execute_sql
  project_id: "tozqezmivpblmcubmnpi"
  query: "SELECT COUNT(*) AS rows FROM public.journal_flow_profile; SELECT last_autoanalyze, last_analyze FROM pg_stat_user_tables WHERE schemaname='public' AND relname='journal_flow_profile';"
```

Expected: `rows` puede ser 0 o positivo; `last_autoanalyze` y `last_analyze` son NULL (nunca analyzed).

- [ ] **Step 7.2: Intentar REFRESH manual**

Run:
```
mcp__claude_ai_Supabase__execute_sql
  project_id: "tozqezmivpblmcubmnpi"
  query: "REFRESH MATERIALIZED VIEW public.journal_flow_profile;"
```

Dos resultados posibles:
- **Éxito:** la MV se puebla. Correr `ANALYZE public.journal_flow_profile;` y saltar a Step 7.6.
- **Error:** leer el mensaje (probablemente `relation X does not exist` o `column Y does not exist` — la definition referencia algo que ya no existe).

- [ ] **Step 7.3: Si falla, obtener la definition**

Run:
```
mcp__claude_ai_Supabase__execute_sql
  project_id: "tozqezmivpblmcubmnpi"
  query: "SELECT pg_get_viewdef('public.journal_flow_profile'::regclass, true);"
```

Leer la definition completa. Identificar qué tabla/columna ha desaparecido.

- [ ] **Step 7.4: Escribir migración de fix**

Crear `/Users/jj/supabase/migrations/20260419120600_phase_0_journal_flow_profile.sql`:

```sql
-- Phase 0 — Fix journal_flow_profile MV: la definition referencia
-- <tabla/columna que no existe>. Recrear con referencia válida.

DROP MATERIALIZED VIEW IF EXISTS public.journal_flow_profile CASCADE;

CREATE MATERIALIZED VIEW public.journal_flow_profile AS
  <definition fixeada>;

CREATE UNIQUE INDEX journal_flow_profile_pk
  ON public.journal_flow_profile (<llave_natural>);

REFRESH MATERIALIZED VIEW public.journal_flow_profile;
ANALYZE public.journal_flow_profile;
```

**Nota:** `<definition fixeada>` y `<llave_natural>` dependen de lo encontrado en Step 7.3 — NO escribir placeholder; poner el SQL real.

- [ ] **Step 7.5: Ejecutar migración**

Run:
```
mcp__claude_ai_Supabase__execute_sql
  project_id: "tozqezmivpblmcubmnpi"
  query: <contenido del fix>
```

Expected: completa sin error.

- [ ] **Step 7.6: Confirmar que la MV está poblada y fresh**

Run:
```
mcp__claude_ai_Supabase__execute_sql
  project_id: "tozqezmivpblmcubmnpi"
  query: "SELECT COUNT(*) AS rows FROM public.journal_flow_profile; SELECT last_analyze FROM pg_stat_user_tables WHERE schemaname='public' AND relname='journal_flow_profile';"
```

Expected: `rows > 0` y `last_analyze` reciente.

- [ ] **Step 7.7: Confirmar que está incluida en `refresh_all_matviews`**

Run:
```
mcp__claude_ai_Supabase__execute_sql
  project_id: "tozqezmivpblmcubmnpi"
  query: "SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname='refresh_all_matviews';"
```

Grep el output por `journal_flow_profile`. Si no aparece, añadirla en otra migración:

```sql
CREATE OR REPLACE FUNCTION public.refresh_all_matviews()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  <cuerpo_existente>;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.journal_flow_profile;
END $$;
```

- [ ] **Step 7.8: Commit**

Run:
```bash
cd /Users/jj
git add supabase/migrations/20260419120600_phase_0_journal_flow_profile.sql
git commit -m "fix(supabase): journal_flow_profile MV — recrear con definition válida y refrescar"
```

---

## Task 8: DoD validation y cierre de fase

**Files:**
- Create: append a `docs/superpowers/notes/2026-04-19-supabase-fase-0-baseline.md`

- [ ] **Step 8.1: Re-ejecutar el baseline invariants**

Run:
```
mcp__claude_ai_Supabase__execute_sql
  project_id: "tozqezmivpblmcubmnpi"
  query: "INSERT INTO public.audit_runs (invariant, severity, passed, detail, run_at) SELECT 'phase_0_final', 'info', true, jsonb_build_object('odoo_invoices_total', (SELECT COUNT(*) FROM public.odoo_invoices), 'cfdi_uuid_groups_dupes', (SELECT COUNT(*) FROM (SELECT cfdi_uuid FROM public.odoo_invoices WHERE cfdi_uuid IS NOT NULL GROUP BY cfdi_uuid HAVING COUNT(*) > 1) x), 'reconciliation_issues_open', (SELECT COUNT(*) FROM public.reconciliation_issues WHERE resolved_at IS NULL), 'reconciliation_issue_types_active_last_24h', (SELECT jsonb_agg(DISTINCT issue_type) FROM public.reconciliation_issues WHERE detected_at > now() - interval '24 hours'), 'invoices_unified_rows', (SELECT COUNT(*) FROM public.invoices_unified), 'payments_unified_rows', (SELECT COUNT(*) FROM public.payments_unified), 'odoo_snapshots_max_created', (SELECT MAX(created_at) FROM public.odoo_snapshots), 'odoo_crm_leads_rows', (SELECT COUNT(*) FROM public.odoo_crm_leads), 'journal_flow_profile_rows', (SELECT COUNT(*) FROM public.journal_flow_profile)), now();"
```

Expected: `INSERT 0 1`.

- [ ] **Step 8.2: Leer el final y comparar con baseline**

Run:
```
mcp__claude_ai_Supabase__execute_sql
  project_id: "tozqezmivpblmcubmnpi"
  query: "SELECT invariant, detail, run_at FROM public.audit_runs WHERE invariant IN ('phase_0_baseline','phase_0_final') ORDER BY run_at;"
```

Copiar ambos JSON. Validar cada campo:

| Campo | Baseline | Final | OK? |
|---|---|---|---|
| cfdi_uuid_groups_dupes | 1547 | **0** | ✓ |
| cfdi_uuid_extra_rows | 3774 | — | ✓ |
| reconciliation_issue_types_active_last_24h | 2 tipos | **8 tipos** | ✓ |
| invoices_unified_rows | 96511 | **>150000** | ✓ |
| odoo_snapshots_max_created | >20h atrás | <1h atrás | ✓ |
| odoo_crm_leads_rows | 20 | > 20 | ✓ |
| journal_flow_profile_rows | (null/0) | > 0 | ✓ |

Si algún campo NO cumple, retornar al task correspondiente.

- [ ] **Step 8.3: Append al notes file**

Edit `/Users/jj/docs/superpowers/notes/2026-04-19-supabase-fase-0-baseline.md` añadiendo sección:

```markdown
## Final (YYYY-MM-DD)

<pegar el JSON del phase_0_final>

## Delta baseline → final

| Métrica | Baseline | Final |
|---|---|---|
| cfdi_uuid_groups_dupes | 1547 | 0 |
| reconciliation_types_last_24h | 2 | 8 |
| invoices_unified_rows | 96,511 | <nuevo> |
| odoo_snapshots staleness | 21h | <1h |
| odoo_crm_leads | 20 | <nuevo> |
| journal_flow_profile_rows | null/0 | <nuevo> |

**Fase 0 cerrada: YYYY-MM-DD HH:MM**
```

- [ ] **Step 8.4: Actualizar memoria del proyecto**

Edit `/Users/jj/.claude/projects/-Users-jj/memory/project_supabase_audit_2026_04_19.md`:

Cambiar línea `**Estado 2026-04-19:**` añadiendo:
```markdown
- Fase 0 **COMPLETADA** YYYY-MM-DD. Cfdi_uuid dedupeado, reconciliation revivido, snapshots/crm_leads/journal_flow_profile al día. Lista para Fase 1 UI unificada.
```

- [ ] **Step 8.5: Commit final y PR**

Run:
```bash
cd /Users/jj
git add docs/superpowers/notes/2026-04-19-supabase-fase-0-baseline.md
git commit -m "docs(supabase): phase 0 DoD validated — final invariants capturados"

git push -u origin fase-0-contencion
gh pr create --title "supabase: Fase 0 — Contención (dedup + reconciliation + crons stale)" --body "$(cat <<'EOF'
## Summary
- Dedup de odoo_invoices.cfdi_uuid: 1,547 UUIDs duplicados / 3,774 filas extras archivadas
- UNIQUE INDEX parcial sobre cfdi_uuid para prevenir recurrencia
- Reconciliation engine revivido — los 8 issue_types detectan en <1h
- odoo_snapshots cron funcionando (staleness <1h)
- odoo_crm_leads filter corregido — row count real
- journal_flow_profile MV recreada + refrescada

Spec: docs/superpowers/specs/2026-04-19-supabase-audit-01-contencion.md
Plan: docs/superpowers/plans/2026-04-19-supabase-audit-fase-0-contencion.md

## Test plan
- [ ] Verificado: `SELECT COUNT(*) FROM odoo_invoices GROUP BY cfdi_uuid HAVING COUNT(*)>1` = 0
- [ ] Verificado: 8 issue_types con detected_at < 1h atrás
- [ ] Verificado: invoices_unified row count subió >150K
- [ ] Verificado: odoo_snapshots.max(created_at) < 1h
- [ ] Verificado: odoo_crm_leads row count > 20
- [ ] Verificado: journal_flow_profile populated

🤖 Generated with [claude-flow](https://github.com/ruvnet/claude-flow)
EOF
)"
```

---

## Self-review checklist (para el agente que ejecuta)

Antes de cerrar el PR, confirmar:

- [ ] Tabla `odoo_invoices_archive_pre_dedup` existe y contiene filas (rollback posible los próximos 90 días)
- [ ] `UNIQUE INDEX odoo_invoices_cfdi_uuid_unique` aparece en `pg_indexes`
- [ ] `audit_runs` tiene `phase_0_baseline` y `phase_0_final`
- [ ] `schema_changes` tiene entrada del dedup
- [ ] No se tocó `__manifest__.py` del addon (regla de CLAUDE.md)
- [ ] Ningún commit skipea pre-commit hooks
- [ ] PR incluye link al spec y plan

---

## Out of scope (para Fases siguientes)

- Causa raíz del duplicado en el push del addon — se cierra en Fase 2 (requiere decisión sobre llave de upsert)
- Auto-resolve de los 4 issue_types eternos — Fase 1
- Migración de consumers raw → unified — Fase 1
- Backfill Syntage del 18% gap — Fase 1
