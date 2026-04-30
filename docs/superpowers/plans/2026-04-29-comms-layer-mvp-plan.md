# Comms Layer MVP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar tabs/sección `Comunicaciones` en `/empresas/[id]` y `/contactos/[id]` que muestren timeline read-only de threads (Gmail) + 2 invariants nuevos (`comms.unanswered_external_thread`, `comms.activity_overdue`) que aparezcan en `gold_ceo_inbox`.

**Architecture:** RPC `comms_timeline` lee `threads`/`emails` directo (sin MV intermedia). Frontend Server Component llama helper Zod-validado con `unstable_cache` 60s. Two pg_cron-callable detect functions UPSERT a `reconciliation_issues` (auto-resolve cuando condición ya no aplica). Cero cambios a `emails`/`threads`/canonical bronze. Cero cambios al addon Odoo.

**Tech Stack:** Next.js 15 (App Router) + TypeScript + Zod 4 + Supabase Postgres + pg_cron + shadcn/ui (Sheet, Tabs, Card, Badge) + date-fns 4 + Vitest 4.

**Spec:** `docs/superpowers/specs/2026-04-29-comms-layer-mvp-design.md`.

---

## File Structure

```
Backend (apply via mcp__claude_ai_Supabase__apply_migration)
  Create: supabase/migrations/20260429_comms_layer_mvp.sql
  Create: supabase/tests/comms_timeline_rpc.sql        (manual run via execute_sql)
  Create: supabase/tests/comms_invariants.sql

Frontend helpers
  Create: src/lib/queries/comms/timeline.ts            (RPC helper + Zod schema)
  Create: src/lib/queries/comms/timeline.test.ts       (Vitest)
  Create: src/lib/queries/comms/messages.ts            (drawer helper)

Frontend components
  Create: src/components/comms/CommsTimeline.tsx       (server entry, lazy)
  Create: src/components/comms/CommsThreadList.tsx     (client, paging + scope)
  Create: src/components/comms/CommsThreadCard.tsx     (presentational)
  Create: src/components/comms/CommsThreadCard.test.tsx
  Create: src/components/comms/CommsThreadDrawer.tsx   (Sheet read-only)
  Create: src/components/comms/CommsScopeToggle.tsx    (URL-state segmented)
  Create: src/components/comms/CommsEmptyState.tsx
  Create: src/components/comms/CommsEmptyState.test.tsx

Integration
  Modify: src/app/empresas/[id]/page.tsx
  Modify: src/app/empresas/[id]/_components/TabPicker.tsx
  Modify: src/app/contactos/[id]/page.tsx              (section card, no tab refactor)
```

**Decisión clave de integración (verificada en plan):** `/contactos/[id]` NO tiene `TabPicker` ni estructura de tabs — es un detail page de cards. Añadimos `<CommsTimeline>` como **sección/card** (más alta que riesgo, más baja que kpis), NO como tab. Mantiene scope minimal.

**Branch:** `comms-mvp` (cortada de `main@6221370`).

---

## Phase A — Backend (Supabase)

### Task 1: Skeleton migration + indexes

**Files:**
- Create: `supabase/migrations/20260429_comms_layer_mvp.sql`

- [ ] **Step 1: Crear branch**

```bash
git checkout -b comms-mvp main
```

Expected: switched to new branch.

- [ ] **Step 2: Crear archivo migration con header + indexes**

Crear `supabase/migrations/20260429_comms_layer_mvp.sql` con:

```sql
-- ============================================================================
-- Comms Layer MVP (2026-04-29)
-- Spec: docs/superpowers/specs/2026-04-29-comms-layer-mvp-design.md
-- ----------------------------------------------------------------------------
-- - 2 RPCs públicas (comms_timeline, comms_thread_messages)
-- - 2 detect funcs (unanswered_external_thread, activity_overdue)
-- - invariant_routing seeds + pg_cron schedule
-- - 5 indexes (4 nuevos + 2 unique para ON CONFLICT)
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Indexes
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_threads_company_id_last_activity
  ON public.threads (company_id, last_activity DESC)
  WHERE company_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_threads_unanswered_external
  ON public.threads (last_sender_type, hours_without_response)
  WHERE last_sender_type = 'external';

CREATE INDEX IF NOT EXISTS idx_emails_sender_contact_thread
  ON public.emails (sender_contact_id, thread_id)
  WHERE sender_contact_id IS NOT NULL AND thread_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_recon_issues_thread_metadata
  ON public.reconciliation_issues (
    issue_type, canonical_entity_type, canonical_entity_id, (metadata->>'thread_id')
  )
  WHERE issue_type = 'comms.unanswered_external_thread';

CREATE UNIQUE INDEX IF NOT EXISTS uq_recon_issues_activity_metadata
  ON public.reconciliation_issues (
    issue_type, canonical_entity_type, canonical_entity_id, (metadata->>'activity_id')
  )
  WHERE issue_type = 'comms.activity_overdue';

COMMIT;
```

- [ ] **Step 3: Verificar sintaxis con dry-run en MCP**

Run vía Claude Code MCP:
```
mcp__claude_ai_Supabase__execute_sql(project_id='tozqezmivpblmcubmnpi',
  query='EXPLAIN SELECT 1 FROM threads WHERE company_id IS NOT NULL AND last_activity IS NOT NULL LIMIT 1')
```

Expected: returns plan, valida que tabla `threads` y columna `last_activity` existen.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260429_comms_layer_mvp.sql
git commit -m "feat(comms): migration skeleton + indexes (Task 1)"
```

---

### Task 2: RPC `comms_timeline`

**Files:**
- Modify: `supabase/migrations/20260429_comms_layer_mvp.sql` (append RPC after indexes)
- Create: `supabase/tests/comms_timeline_rpc.sql`

- [ ] **Step 1: Escribir test SQL primero**

Crear `supabase/tests/comms_timeline_rpc.sql`:

```sql
-- Test: comms_timeline RPC
-- Run via: mcp__claude_ai_Supabase__execute_sql con este SQL completo
-- Expected: 4 raises NOTICE 'TEST PASSED' al final.

DO $$
DECLARE
  v_company_id bigint := -999001;
  v_contact_id bigint := -999002;
  v_thread_a   bigint;
  v_thread_b   bigint;
  v_count      int;
  v_severity   text;
BEGIN
  -- Seed: 2 threads para company -999001
  INSERT INTO threads (gmail_thread_id, account, company_id, last_sender_type,
                       hours_without_response, last_activity, message_count,
                       has_internal_reply, has_external_reply, status)
  VALUES ('test_thread_a_' || extract(epoch from now()), 'test@example.com',
          v_company_id, 'external', 200, now() - interval '8 days',
          3, false, true, 'open')
  RETURNING id INTO v_thread_a;

  INSERT INTO threads (gmail_thread_id, account, company_id, last_sender_type,
                       hours_without_response, last_activity, message_count,
                       has_internal_reply, has_external_reply, status)
  VALUES ('test_thread_b_' || extract(epoch from now()), 'test@example.com',
          v_company_id, 'internal', 0, now() - interval '1 hour',
          5, true, true, 'open')
  RETURNING id INTO v_thread_b;

  -- TEST 1: company external scope returns thread_a only (high severity)
  SELECT count(*), max(severity) INTO v_count, v_severity
    FROM comms_timeline('company', v_company_id, 'external', 25, 0);
  IF v_count = 2 AND v_severity = 'high' THEN
    RAISE NOTICE 'TEST 1 PASSED: external returns both with at least one high';
  ELSE
    RAISE EXCEPTION 'TEST 1 FAILED: count=%, severity=%', v_count, v_severity;
  END IF;

  -- TEST 2: thread_a alone qualifies as 'high' (>168h)
  SELECT severity INTO v_severity
    FROM comms_timeline('company', v_company_id, 'external', 25, 0)
    WHERE thread_id = v_thread_a;
  IF v_severity = 'high' THEN
    RAISE NOTICE 'TEST 2 PASSED: thread_a severity=high';
  ELSE
    RAISE EXCEPTION 'TEST 2 FAILED: thread_a severity=%', v_severity;
  END IF;

  -- TEST 3: invalid entity_type raises
  BEGIN
    PERFORM * FROM comms_timeline('invalid', 1, 'external', 25, 0);
    RAISE EXCEPTION 'TEST 3 FAILED: should have raised on invalid entity_type';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE '%Unknown entity_type%' THEN
      RAISE NOTICE 'TEST 3 PASSED: rejects invalid entity_type';
    ELSE
      RAISE;
    END IF;
  END;

  -- TEST 4: pagination total_count constant across pages
  DECLARE
    v_total_p1 bigint;
    v_total_p2 bigint;
  BEGIN
    SELECT total_count INTO v_total_p1
      FROM comms_timeline('company', v_company_id, 'external', 1, 0);
    SELECT total_count INTO v_total_p2
      FROM comms_timeline('company', v_company_id, 'external', 1, 1);
    IF v_total_p1 = v_total_p2 AND v_total_p1 = 2 THEN
      RAISE NOTICE 'TEST 4 PASSED: total_count=2 stable across pages';
    ELSE
      RAISE EXCEPTION 'TEST 4 FAILED: p1=%, p2=%', v_total_p1, v_total_p2;
    END IF;
  END;

  -- Cleanup
  DELETE FROM threads WHERE id IN (v_thread_a, v_thread_b);
END $$;
```

- [ ] **Step 2: Correr test (debe fallar — RPC no existe)**

Run:
```
mcp__claude_ai_Supabase__execute_sql con el contenido de supabase/tests/comms_timeline_rpc.sql
```

Expected: ERROR `function comms_timeline(...) does not exist`.

- [ ] **Step 3: Append RPC al migration**

Append al final de `supabase/migrations/20260429_comms_layer_mvp.sql` (antes del COMMIT inexistente al final — corregir: el `COMMIT` se mueve al último append en Task 6):

Reemplazar el `COMMIT;` actual con:

```sql
-- ----------------------------------------------------------------------------
-- 2. RPC comms_timeline
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.comms_timeline(
  p_entity_type   text,
  p_entity_id     bigint,
  p_scope         text DEFAULT 'external',
  p_limit         int  DEFAULT 25,
  p_offset        int  DEFAULT 0
)
RETURNS TABLE (
  thread_id              bigint,
  gmail_thread_id        text,
  subject                text,
  last_activity          timestamptz,
  last_sender            text,
  last_sender_type       text,
  hours_without_response numeric,
  status                 text,
  message_count          int,
  has_internal_reply     boolean,
  has_external_reply     boolean,
  participant_emails     text[],
  severity               text,
  total_count            bigint
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_thread_ids bigint[];
BEGIN
  IF p_entity_type = 'company' THEN
    SELECT array_agg(t.id) INTO v_thread_ids
      FROM public.threads t WHERE t.company_id = p_entity_id;
  ELSIF p_entity_type = 'contact' THEN
    SELECT array_agg(DISTINCT tid) INTO v_thread_ids
      FROM (
        SELECT id AS tid FROM public.threads WHERE started_by_contact_id = p_entity_id
        UNION
        SELECT DISTINCT thread_id AS tid FROM public.emails
          WHERE sender_contact_id = p_entity_id AND thread_id IS NOT NULL
      ) thread_ids;
  ELSE
    RAISE EXCEPTION 'Unknown entity_type %', p_entity_type;
  END IF;

  IF v_thread_ids IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH filtered AS (
    SELECT t.*
    FROM public.threads t
    WHERE t.id = ANY(v_thread_ids)
      AND CASE p_scope
        WHEN 'external' THEN t.has_external_reply IS TRUE
        WHEN 'internal' THEN t.has_internal_reply IS TRUE AND t.has_external_reply IS NOT TRUE
        ELSE TRUE
      END
  ),
  counted AS (SELECT COUNT(*) AS n FROM filtered)
  SELECT
    f.id, f.gmail_thread_id, f.subject, f.last_activity, f.last_sender,
    f.last_sender_type, f.hours_without_response, f.status, f.message_count,
    f.has_internal_reply, f.has_external_reply, f.participant_emails,
    CASE
      WHEN f.last_sender_type = 'external' AND f.hours_without_response > 168 THEN 'high'
      WHEN f.last_sender_type = 'external' AND f.hours_without_response > 72  THEN 'medium'
      WHEN f.last_sender_type = 'external' AND f.hours_without_response > 24  THEN 'low'
      ELSE 'none'
    END AS severity,
    c.n AS total_count
  FROM filtered f, counted c
  ORDER BY f.last_activity DESC NULLS LAST
  LIMIT p_limit OFFSET p_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION public.comms_timeline(text, bigint, text, int, int)
  TO authenticated, service_role;
```

- [ ] **Step 4: Aplicar migration parcial via MCP (development apply)**

Run:
```
mcp__claude_ai_Supabase__apply_migration(
  project_id='tozqezmivpblmcubmnpi',
  name='20260429_comms_layer_mvp_task2',
  query=<contenido completo de la migration hasta este punto>)
```

Expected: success, function created.

- [ ] **Step 5: Re-correr test, verificar pasa**

Run el `supabase/tests/comms_timeline_rpc.sql` de nuevo.

Expected output (NOTICE):
```
TEST 1 PASSED: external returns both with at least one high
TEST 2 PASSED: thread_a severity=high
TEST 3 PASSED: rejects invalid entity_type
TEST 4 PASSED: total_count=2 stable across pages
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260429_comms_layer_mvp.sql supabase/tests/comms_timeline_rpc.sql
git commit -m "feat(comms): RPC comms_timeline + SQL test (Task 2)"
```

---

### Task 3: RPC `comms_thread_messages`

**Files:**
- Modify: `supabase/migrations/20260429_comms_layer_mvp.sql`

- [ ] **Step 1: Append RPC al migration**

Append:

```sql
-- ----------------------------------------------------------------------------
-- 3. RPC comms_thread_messages (drawer detail)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.comms_thread_messages(p_thread_id bigint)
RETURNS TABLE (
  email_id         bigint,
  gmail_message_id text,
  sender           text,
  recipient        text,
  email_date       timestamptz,
  subject          text,
  snippet          text,
  body             text,
  sender_type      text,
  has_attachments  boolean
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
  SELECT
    e.id, e.gmail_message_id, e.sender, e.recipient, e.email_date,
    e.subject, e.snippet, e.body, e.sender_type, e.has_attachments
  FROM public.emails e
  WHERE e.thread_id = p_thread_id
  ORDER BY e.email_date ASC NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION public.comms_thread_messages(bigint) TO authenticated, service_role;
```

- [ ] **Step 2: Aplicar via MCP**

```
mcp__claude_ai_Supabase__apply_migration(
  project_id='tozqezmivpblmcubmnpi',
  name='20260429_comms_layer_mvp_task3',
  query=<append content>)
```

- [ ] **Step 3: Smoke verify**

Run:
```sql
SELECT count(*) FROM comms_thread_messages(
  (SELECT id FROM threads WHERE message_count > 1 LIMIT 1)
);
```

Expected: returns count > 0 si hay datos reales.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260429_comms_layer_mvp.sql
git commit -m "feat(comms): RPC comms_thread_messages (Task 3)"
```

---

### Task 4: `detect_comms_unanswered_external_thread`

**Files:**
- Modify: `supabase/migrations/20260429_comms_layer_mvp.sql`
- Create: `supabase/tests/comms_invariants.sql`

- [ ] **Step 1: Crear test SQL**

Crear `supabase/tests/comms_invariants.sql`:

```sql
-- Test: detect_comms_unanswered_external_thread + auto-resolve
-- Expected: NOTICE 'TEST 1A PASSED' y 'TEST 1B PASSED' al final.

DO $$
DECLARE
  v_company_id bigint := -999003;
  v_thread_id  bigint;
  v_issue_count int;
  v_resolved   timestamptz;
BEGIN
  -- Seed: 1 thread external 100h sin respuesta
  INSERT INTO threads (gmail_thread_id, account, company_id, last_sender_type,
                       hours_without_response, last_activity, message_count,
                       has_internal_reply, has_external_reply, status)
  VALUES ('test_invariant_' || extract(epoch from now()), 'test@example.com',
          v_company_id, 'external', 100, now() - interval '5 days',
          2, false, true, 'open')
  RETURNING id INTO v_thread_id;

  -- TEST 1A: detect crea issue
  PERFORM detect_comms_unanswered_external_thread();
  SELECT count(*) INTO v_issue_count
    FROM reconciliation_issues
    WHERE issue_type = 'comms.unanswered_external_thread'
      AND canonical_entity_id = v_company_id::text
      AND (metadata->>'thread_id')::bigint = v_thread_id
      AND resolved_at IS NULL;
  IF v_issue_count = 1 THEN
    RAISE NOTICE 'TEST 1A PASSED: issue creado para thread externo no respondido';
  ELSE
    RAISE EXCEPTION 'TEST 1A FAILED: issue_count=%', v_issue_count;
  END IF;

  -- TEST 1B: flip thread a internal, re-detect, auto-resolve
  UPDATE threads SET last_sender_type = 'internal', hours_without_response = 0
    WHERE id = v_thread_id;
  PERFORM detect_comms_unanswered_external_thread();
  SELECT resolved_at INTO v_resolved
    FROM reconciliation_issues
    WHERE issue_type = 'comms.unanswered_external_thread'
      AND (metadata->>'thread_id')::bigint = v_thread_id;
  IF v_resolved IS NOT NULL THEN
    RAISE NOTICE 'TEST 1B PASSED: issue auto-resolved cuando thread se respondió';
  ELSE
    RAISE EXCEPTION 'TEST 1B FAILED: issue no auto-resolved';
  END IF;

  -- Cleanup
  DELETE FROM reconciliation_issues
    WHERE (metadata->>'thread_id')::bigint = v_thread_id;
  DELETE FROM threads WHERE id = v_thread_id;
END $$;
```

- [ ] **Step 2: Correr test (debe fallar — function no existe)**

Run el SQL de Step 1.

Expected: ERROR `function detect_comms_unanswered_external_thread() does not exist`.

- [ ] **Step 3: Append function al migration**

Append a `supabase/migrations/20260429_comms_layer_mvp.sql`:

```sql
-- ----------------------------------------------------------------------------
-- 4. Detect: unanswered external thread
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.detect_comms_unanswered_external_thread()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_inserted int := 0;
BEGIN
  WITH detected AS (
    SELECT
      t.id AS thread_id,
      t.company_id,
      t.subject,
      t.hours_without_response,
      t.last_sender,
      t.last_activity,
      CASE
        WHEN t.hours_without_response > 168 THEN 'high'
        WHEN t.hours_without_response > 72  THEN 'medium'
        ELSE 'low'
      END AS severity
    FROM public.threads t
    WHERE t.last_sender_type = 'external'
      AND t.hours_without_response > 48
      AND COALESCE(t.status, 'open') NOT IN ('closed', 'archived')
      AND t.company_id IS NOT NULL
  )
  INSERT INTO public.reconciliation_issues (
    issue_type, severity, canonical_entity_type, canonical_entity_id,
    description, metadata, detected_at
  )
  SELECT
    'comms.unanswered_external_thread',
    severity,
    'company',
    company_id::text,
    format('Thread sin respuesta hace %sh: %s',
           round(hours_without_response), COALESCE(subject, '(sin asunto)')),
    jsonb_build_object(
      'thread_id', thread_id,
      'subject', subject,
      'hours_without_response', hours_without_response,
      'last_sender', last_sender,
      'last_activity', last_activity
    ),
    now()
  FROM detected
  ON CONFLICT (issue_type, canonical_entity_type, canonical_entity_id, (metadata->>'thread_id'))
  WHERE issue_type = 'comms.unanswered_external_thread'
  DO UPDATE SET
    severity    = EXCLUDED.severity,
    metadata    = EXCLUDED.metadata,
    description = EXCLUDED.description,
    detected_at = EXCLUDED.detected_at,
    resolved_at = NULL;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- Auto-resolve: threads que ya no califican
  UPDATE public.reconciliation_issues ri
  SET resolved_at = now(),
      resolution_note = 'auto: thread responded or closed'
  WHERE ri.issue_type = 'comms.unanswered_external_thread'
    AND ri.resolved_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.threads t
      WHERE t.id = (ri.metadata->>'thread_id')::bigint
        AND t.last_sender_type = 'external'
        AND t.hours_without_response > 48
        AND COALESCE(t.status, 'open') NOT IN ('closed', 'archived')
    );

  RETURN v_inserted;
EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.audit_runs (run_type, status, error_message, started_at, finished_at)
  VALUES ('comms_unanswered_thread_detect', 'error', SQLERRM, now(), now());
  RAISE;
END;
$$;
```

**Nota:** `ON CONFLICT (cols) WHERE pred` requiere que el partial UNIQUE INDEX exista (creado en Task 1). Si la sintaxis falla en Postgres < 15, sustituir con MERGE o pre-DELETE+INSERT pattern (decidir tras dry-run).

- [ ] **Step 4: Aplicar migration parcial**

```
mcp__claude_ai_Supabase__apply_migration(
  project_id='tozqezmivpblmcubmnpi',
  name='20260429_comms_layer_mvp_task4',
  query=<append content>)
```

- [ ] **Step 5: Re-correr test, verificar TEST 1A + 1B PASSED**

Expected NOTICE:
```
TEST 1A PASSED: issue creado para thread externo no respondido
TEST 1B PASSED: issue auto-resolved cuando thread se respondió
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260429_comms_layer_mvp.sql supabase/tests/comms_invariants.sql
git commit -m "feat(comms): detect_comms_unanswered_external_thread + test (Task 4)"
```

---

### Task 5: `detect_comms_activity_overdue`

**Files:**
- Modify: `supabase/migrations/20260429_comms_layer_mvp.sql`
- Modify: `supabase/tests/comms_invariants.sql` (append TEST 2)

- [ ] **Step 1: Append test al SQL test file**

Append antes del último `END $$;` de `supabase/tests/comms_invariants.sql`:

Mejor reemplazar el bloque entero — escribir un nuevo DO con TEST 2A/2B que reuse pattern. Append como bloque DO separado:

```sql
-- TEST 2: detect_comms_activity_overdue
DO $$
DECLARE
  v_company_id bigint := -999004;
  v_activity_id bigint;
  v_issue_count int;
  v_resolved   timestamptz;
BEGIN
  -- Asumimos canonical_companies con id_negativo no choca (test isolation).
  -- canonical_activities tiene PK probable bronze_id. Insertamos directo.
  INSERT INTO canonical_activities
    (bronze_id, canonical_company_id, activity_type, summary, res_model, res_id,
     date_deadline, assigned_to, is_overdue, synced_from_bronze_at, updated_at)
  VALUES
    (-999004, v_company_id, 'call', 'Llamar a cliente urgente', 'res.partner',
     v_company_id, current_date - interval '5 days', 'Test User', TRUE, now(), now())
  RETURNING bronze_id INTO v_activity_id;

  -- TEST 2A
  PERFORM detect_comms_activity_overdue();
  SELECT count(*) INTO v_issue_count
    FROM reconciliation_issues
    WHERE issue_type = 'comms.activity_overdue'
      AND (metadata->>'activity_id')::bigint = v_activity_id
      AND resolved_at IS NULL;
  IF v_issue_count = 1 THEN
    RAISE NOTICE 'TEST 2A PASSED: activity overdue genera issue';
  ELSE
    RAISE EXCEPTION 'TEST 2A FAILED: issue_count=%', v_issue_count;
  END IF;

  -- TEST 2B: borrar canonical_activity = simula cierre en Odoo (delete_all push)
  DELETE FROM canonical_activities WHERE bronze_id = v_activity_id;
  PERFORM detect_comms_activity_overdue();
  SELECT resolved_at INTO v_resolved
    FROM reconciliation_issues
    WHERE issue_type = 'comms.activity_overdue'
      AND (metadata->>'activity_id')::bigint = v_activity_id;
  IF v_resolved IS NOT NULL THEN
    RAISE NOTICE 'TEST 2B PASSED: issue auto-resolved cuando activity desaparece';
  ELSE
    RAISE EXCEPTION 'TEST 2B FAILED: no auto-resolved';
  END IF;

  -- Cleanup
  DELETE FROM reconciliation_issues
    WHERE (metadata->>'activity_id')::bigint = v_activity_id;
END $$;
```

- [ ] **Step 2: Correr test (debe fallar — function no existe aún)**

Run el contenido nuevo. Expected: ERROR `function detect_comms_activity_overdue() does not exist`.

- [ ] **Step 3: Append function al migration**

```sql
-- ----------------------------------------------------------------------------
-- 5. Detect: activity overdue
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.detect_comms_activity_overdue()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_inserted int := 0;
BEGIN
  WITH detected AS (
    SELECT
      ca.bronze_id                       AS activity_id,
      ca.canonical_company_id,
      ca.assigned_canonical_contact_id,
      ca.summary,
      ca.activity_type,
      ca.date_deadline,
      ca.assigned_to,
      ca.res_model,
      ca.res_id,
      (CURRENT_DATE - ca.date_deadline)::int AS days_overdue,
      CASE
        WHEN (CURRENT_DATE - ca.date_deadline)::int > 14 THEN 'high'
        WHEN (CURRENT_DATE - ca.date_deadline)::int > 3  THEN 'medium'
        ELSE 'low'
      END AS severity
    FROM public.canonical_activities ca
    WHERE ca.date_deadline < CURRENT_DATE
      AND ca.is_overdue = TRUE
      AND ca.canonical_company_id IS NOT NULL
  )
  INSERT INTO public.reconciliation_issues (
    issue_type, severity, canonical_entity_type, canonical_entity_id,
    description, metadata, detected_at, assignee_canonical_contact_id
  )
  SELECT
    'comms.activity_overdue',
    severity,
    'company',
    canonical_company_id::text,
    format('Actividad %s días vencida: %s',
           days_overdue, COALESCE(summary, activity_type, '(sin descripción)')),
    jsonb_build_object(
      'activity_id', activity_id,
      'activity_type', activity_type,
      'date_deadline', date_deadline,
      'assigned_to', assigned_to,
      'days_overdue', days_overdue,
      'res_model', res_model,
      'res_id', res_id
    ),
    now(),
    assigned_canonical_contact_id
  FROM detected
  ON CONFLICT (issue_type, canonical_entity_type, canonical_entity_id, (metadata->>'activity_id'))
  WHERE issue_type = 'comms.activity_overdue'
  DO UPDATE SET
    severity    = EXCLUDED.severity,
    metadata    = EXCLUDED.metadata,
    description = EXCLUDED.description,
    detected_at = EXCLUDED.detected_at,
    assignee_canonical_contact_id = EXCLUDED.assignee_canonical_contact_id,
    resolved_at = NULL;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- Auto-resolve: activity ya no en canonical (cerrada en Odoo, delete_all del push)
  UPDATE public.reconciliation_issues ri
  SET resolved_at = now(),
      resolution_note = 'auto: activity completed or removed'
  WHERE ri.issue_type = 'comms.activity_overdue'
    AND ri.resolved_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.canonical_activities ca
      WHERE ca.bronze_id = (ri.metadata->>'activity_id')::bigint
        AND ca.is_overdue = TRUE
        AND ca.date_deadline < CURRENT_DATE
        AND ca.canonical_company_id IS NOT NULL
    );

  RETURN v_inserted;
EXCEPTION WHEN OTHERS THEN
  INSERT INTO public.audit_runs (run_type, status, error_message, started_at, finished_at)
  VALUES ('comms_activity_overdue_detect', 'error', SQLERRM, now(), now());
  RAISE;
END;
$$;
```

- [ ] **Step 4: Aplicar migration parcial**

```
mcp__claude_ai_Supabase__apply_migration(
  project_id='tozqezmivpblmcubmnpi',
  name='20260429_comms_layer_mvp_task5',
  query=<append content>)
```

- [ ] **Step 5: Correr ambos tests, verificar 4 PASSED**

Run `supabase/tests/comms_invariants.sql` completo. Expected:
```
TEST 1A PASSED
TEST 1B PASSED
TEST 2A PASSED
TEST 2B PASSED
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260429_comms_layer_mvp.sql supabase/tests/comms_invariants.sql
git commit -m "feat(comms): detect_comms_activity_overdue + test (Task 5)"
```

---

### Task 6: invariant_routing seeds + cron schedule

**Files:**
- Modify: `supabase/migrations/20260429_comms_layer_mvp.sql`

- [ ] **Step 1: Verificar shape real de `invariant_routing` (puede haber UNIQUE constraint que ajustar)**

Run:
```sql
SELECT pg_get_constraintdef(c.oid)
FROM pg_constraint c
JOIN pg_class t ON c.conrelid = t.oid
WHERE t.relname = 'invariant_routing';
```

Anotar nombre de UNIQUE (ej. `invariant_routing_issue_type_key` o `invariant_routing_pkey`). Si hay UNIQUE en `issue_type`, usar `ON CONFLICT (issue_type) DO NOTHING`. Si no, simplemente `ON CONFLICT DO NOTHING`.

- [ ] **Step 2: Append seeds + cron al migration**

```sql
-- ----------------------------------------------------------------------------
-- 6. Routing seeds
-- ----------------------------------------------------------------------------
INSERT INTO public.invariant_routing
  (issue_type, invariant_namespace, department_name, match_predicate, priority)
VALUES
  ('comms.unanswered_external_thread', 'comms', 'Ventas', '{}'::jsonb, 100),
  ('comms.activity_overdue',           'comms', 'Ventas', '{}'::jsonb, 100)
ON CONFLICT DO NOTHING;

-- ----------------------------------------------------------------------------
-- 7. pg_cron schedule (hourly at HH:25)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  -- Unschedule si ya existe (idempotente)
  PERFORM cron.unschedule('comms_invariants_hourly')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'comms_invariants_hourly');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'comms_invariants_hourly',
  '25 * * * *',
  $cron$
    SELECT public.detect_comms_unanswered_external_thread();
    SELECT public.detect_comms_activity_overdue();
  $cron$
);
```

**Nota:** si la versión de pg_cron no soporta `WHERE` en `cron.unschedule`, simplificar:
```sql
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'comms_invariants_hourly') THEN
    PERFORM cron.unschedule('comms_invariants_hourly');
  END IF;
END $$;
```

- [ ] **Step 3: Aplicar migration parcial**

```
mcp__claude_ai_Supabase__apply_migration(
  project_id='tozqezmivpblmcubmnpi',
  name='20260429_comms_layer_mvp_task6',
  query=<append content>)
```

- [ ] **Step 4: Verificar cron registrado**

Run:
```sql
SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'comms_invariants_hourly';
```

Expected: 1 row con `active=true`, schedule `25 * * * *`.

- [ ] **Step 5: Correr cron manualmente**

```sql
SELECT detect_comms_unanswered_external_thread();
SELECT detect_comms_activity_overdue();
```

Expected: returns int (count de issues nuevos en producción).

- [ ] **Step 6: Smoke verify gold_ceo_inbox tiene los nuevos issue_types**

```sql
SELECT issue_type, COUNT(*)
FROM gold_ceo_inbox
WHERE issue_type LIKE 'comms.%'
GROUP BY 1;
```

Expected: 0-N rows con issue_type comms.* — incluso 0 está bien si no hay condiciones que disparen hoy.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260429_comms_layer_mvp.sql
git commit -m "feat(comms): invariant_routing seeds + pg_cron schedule (Task 6)"
```

---

## Phase B — Frontend helpers

### Task 7: Helper `getCommsTimeline` + Zod + test

**Files:**
- Create: `src/lib/queries/comms/timeline.ts`
- Create: `src/lib/queries/comms/timeline.test.ts`

- [ ] **Step 1: Crear test primero**

Crear `src/lib/queries/comms/timeline.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase-server", () => ({
  getServiceClient: vi.fn(),
}));

vi.mock("next/cache", () => ({
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
}));

import { getCommsTimeline } from "./timeline";
import { getServiceClient } from "@/lib/supabase-server";

const mockedGetServiceClient = vi.mocked(getServiceClient);

function makeRpcReturn(rows: unknown[] | null, error: unknown = null) {
  return {
    rpc: vi.fn().mockResolvedValue({ data: rows, error }),
  } as unknown as Awaited<ReturnType<typeof getServiceClient>>;
}

describe("getCommsTimeline", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns empty payload when RPC errors (throw-safe)", async () => {
    mockedGetServiceClient.mockResolvedValue(
      makeRpcReturn(null, new Error("boom"))
    );
    const result = await getCommsTimeline({ entityType: "company", entityId: 1 });
    expect(result).toEqual({ threads: [], total: 0, hasMore: false });
  });

  it("returns empty payload when data is null", async () => {
    mockedGetServiceClient.mockResolvedValue(makeRpcReturn(null, null));
    const result = await getCommsTimeline({ entityType: "company", entityId: 1 });
    expect(result.threads).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("parses valid rows and computes hasMore", async () => {
    mockedGetServiceClient.mockResolvedValue(
      makeRpcReturn([
        {
          thread_id: 10,
          gmail_thread_id: "gt_10",
          subject: "Cotización",
          last_activity: "2026-04-29T12:00:00Z",
          last_sender: "maria@cliente.com",
          last_sender_type: "external",
          hours_without_response: 96,
          status: "open",
          message_count: 4,
          has_internal_reply: true,
          has_external_reply: true,
          participant_emails: ["maria@cliente.com", "ventas@quimibond.com"],
          severity: "medium",
          total_count: 50,
        },
      ])
    );
    const result = await getCommsTimeline({
      entityType: "company",
      entityId: 1,
      limit: 25,
      offset: 0,
    });
    expect(result.threads).toHaveLength(1);
    expect(result.threads[0].subject).toBe("Cotización");
    expect(result.threads[0].severity).toBe("medium");
    expect(result.total).toBe(50);
    expect(result.hasMore).toBe(true); // offset(0) + limit(25) < total(50)
  });

  it("hasMore is false when offset+limit >= total", async () => {
    mockedGetServiceClient.mockResolvedValue(
      makeRpcReturn([
        {
          thread_id: 1,
          gmail_thread_id: "gt_1",
          subject: null,
          last_activity: "2026-04-29T12:00:00Z",
          last_sender: null,
          last_sender_type: null,
          hours_without_response: null,
          status: null,
          message_count: 1,
          has_internal_reply: false,
          has_external_reply: true,
          participant_emails: null,
          severity: "none",
          total_count: 1,
        },
      ])
    );
    const result = await getCommsTimeline({ entityType: "company", entityId: 1 });
    expect(result.hasMore).toBe(false);
  });

  it("returns empty when rows fail Zod validation", async () => {
    mockedGetServiceClient.mockResolvedValue(
      makeRpcReturn([{ invalid: "shape" }])
    );
    const result = await getCommsTimeline({ entityType: "company", entityId: 1 });
    expect(result.threads).toEqual([]);
  });
});
```

- [ ] **Step 2: Correr test (debe fallar — helper no existe)**

```bash
npx vitest run src/lib/queries/comms/timeline.test.ts
```

Expected: FAIL `Cannot find module './timeline'`.

- [ ] **Step 3: Crear helper**

Crear `src/lib/queries/comms/timeline.ts`:

```ts
import { z } from "zod";
import { unstable_cache } from "next/cache";

import { getServiceClient } from "@/lib/supabase-server";

export const CommsThreadSchema = z.object({
  thread_id: z.number(),
  gmail_thread_id: z.string(),
  subject: z.string().nullable(),
  last_activity: z.string().nullable(),
  last_sender: z.string().nullable(),
  last_sender_type: z
    .enum(["internal", "external", "unknown"])
    .nullable()
    .or(z.string().nullable()),
  hours_without_response: z.number().nullable(),
  status: z.string().nullable(),
  message_count: z.number(),
  has_internal_reply: z.boolean(),
  has_external_reply: z.boolean(),
  participant_emails: z.array(z.string()).nullable(),
  severity: z.enum(["high", "medium", "low", "none"]),
  total_count: z.number(),
});

export type CommsThread = z.infer<typeof CommsThreadSchema>;

export type CommsScope = "external" | "internal" | "all";

export type CommsTimelinePayload = {
  threads: CommsThread[];
  total: number;
  hasMore: boolean;
};

export type CommsEntityType = "company" | "contact";

export interface GetCommsTimelineArgs {
  entityType: CommsEntityType;
  entityId: number;
  scope?: CommsScope;
  limit?: number;
  offset?: number;
}

const EMPTY: CommsTimelinePayload = { threads: [], total: 0, hasMore: false };

async function fetchCommsTimeline(args: GetCommsTimelineArgs): Promise<CommsTimelinePayload> {
  const { entityType, entityId, scope = "external", limit = 25, offset = 0 } = args;
  try {
    const supabase = await getServiceClient();
    const { data, error } = await supabase.rpc("comms_timeline", {
      p_entity_type: entityType,
      p_entity_id: entityId,
      p_scope: scope,
      p_limit: limit,
      p_offset: offset,
    });
    if (error || !Array.isArray(data)) {
      if (error) console.error("[comms_timeline] rpc error", error);
      return EMPTY;
    }
    const parsed = z.array(CommsThreadSchema).safeParse(data);
    if (!parsed.success) {
      console.error("[comms_timeline] zod parse error", parsed.error.issues.slice(0, 3));
      return EMPTY;
    }
    const total = parsed.data[0]?.total_count ?? 0;
    return {
      threads: parsed.data,
      total,
      hasMore: offset + limit < total,
    };
  } catch (err) {
    console.error("[comms_timeline] unexpected", err);
    return EMPTY;
  }
}

export async function getCommsTimeline(
  args: GetCommsTimelineArgs
): Promise<CommsTimelinePayload> {
  const cacheKey = `comms-timeline-v1:${args.entityType}:${args.entityId}:${args.scope ?? "external"}:${args.limit ?? 25}:${args.offset ?? 0}`;
  return unstable_cache(() => fetchCommsTimeline(args), [cacheKey], {
    revalidate: 60,
    tags: [`comms:${args.entityType}:${args.entityId}`],
  })();
}
```

- [ ] **Step 4: Re-correr test**

```bash
npx vitest run src/lib/queries/comms/timeline.test.ts
```

Expected: PASS 5/5.

- [ ] **Step 5: Commit**

```bash
git add src/lib/queries/comms/timeline.ts src/lib/queries/comms/timeline.test.ts
git commit -m "feat(comms): getCommsTimeline helper + tests (Task 7)"
```

---

### Task 8: Helper `getCommsThreadMessages`

**Files:**
- Create: `src/lib/queries/comms/messages.ts`

- [ ] **Step 1: Crear helper**

```ts
import { z } from "zod";

import { getServiceClient } from "@/lib/supabase-server";

export const CommsMessageSchema = z.object({
  email_id: z.number(),
  gmail_message_id: z.string(),
  sender: z.string(),
  recipient: z.string().nullable(),
  email_date: z.string().nullable(),
  subject: z.string().nullable(),
  snippet: z.string().nullable(),
  body: z.string().nullable(),
  sender_type: z.string().nullable(),
  has_attachments: z.boolean().nullable(),
});

export type CommsMessage = z.infer<typeof CommsMessageSchema>;

export async function getCommsThreadMessages(threadId: number): Promise<CommsMessage[]> {
  try {
    const supabase = await getServiceClient();
    const { data, error } = await supabase.rpc("comms_thread_messages", {
      p_thread_id: threadId,
    });
    if (error || !Array.isArray(data)) {
      if (error) console.error("[comms_thread_messages] rpc error", error);
      return [];
    }
    const parsed = z.array(CommsMessageSchema).safeParse(data);
    if (!parsed.success) {
      console.error("[comms_thread_messages] zod parse error", parsed.error.issues.slice(0, 3));
      return [];
    }
    return parsed.data;
  } catch (err) {
    console.error("[comms_thread_messages] unexpected", err);
    return [];
  }
}
```

- [ ] **Step 2: Smoke (no test unitario formal — endpoint trivial; integration cubre)**

```bash
npx tsc --noEmit src/lib/queries/comms/messages.ts || npx tsc --noEmit
```

Expected: PASS (sin errores TS).

- [ ] **Step 3: Commit**

```bash
git add src/lib/queries/comms/messages.ts
git commit -m "feat(comms): getCommsThreadMessages helper (Task 8)"
```

---

## Phase C — Componentes UI

### Task 9: `<CommsEmptyState>` + test

**Files:**
- Create: `src/components/comms/CommsEmptyState.tsx`
- Create: `src/components/comms/CommsEmptyState.test.tsx`

- [ ] **Step 1: Crear test**

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { CommsEmptyState } from "./CommsEmptyState";

describe("CommsEmptyState", () => {
  it("muestra texto contextual para empresa", () => {
    render(<CommsEmptyState entityType="company" />);
    expect(screen.getByText(/no hay comunicaciones/i)).toBeInTheDocument();
    expect(screen.getByText(/contacto principal/i)).toBeInTheDocument();
  });

  it("muestra texto contextual para contacto", () => {
    render(<CommsEmptyState entityType="contact" />);
    expect(screen.getByText(/sin emails sincronizados/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test (debe fallar)**

```bash
npx vitest run src/components/comms/CommsEmptyState.test.tsx
```

Expected: FAIL `Cannot find module './CommsEmptyState'`.

- [ ] **Step 3: Crear componente**

```tsx
import { Mail } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";

export interface CommsEmptyStateProps {
  entityType: "company" | "contact";
}

export function CommsEmptyState({ entityType }: CommsEmptyStateProps) {
  const message =
    entityType === "company"
      ? "No hay comunicaciones registradas con esta empresa. Verifica que el email del contacto principal esté en Odoo y se haya sincronizado a Gmail."
      : "Este contacto aún no tiene emails sincronizados. Verifica el email registrado en Odoo.";

  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center">
        <Mail className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
        <p className="max-w-md text-sm text-muted-foreground">{message}</p>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Re-correr test**

Expected: PASS 2/2.

- [ ] **Step 5: Commit**

```bash
git add src/components/comms/CommsEmptyState.tsx src/components/comms/CommsEmptyState.test.tsx
git commit -m "feat(comms): CommsEmptyState + test (Task 9)"
```

---

### Task 10: `<CommsThreadCard>` + test

**Files:**
- Create: `src/components/comms/CommsThreadCard.tsx`
- Create: `src/components/comms/CommsThreadCard.test.tsx`

- [ ] **Step 1: Crear test**

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { CommsThreadCard } from "./CommsThreadCard";
import type { CommsThread } from "@/lib/queries/comms/timeline";

const baseThread: CommsThread = {
  thread_id: 1,
  gmail_thread_id: "gt_xyz",
  subject: "Cotización paño",
  last_activity: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(),
  last_sender: "maria@cliente.com",
  last_sender_type: "external",
  hours_without_response: 96,
  status: "open",
  message_count: 4,
  has_internal_reply: true,
  has_external_reply: true,
  participant_emails: ["maria@cliente.com"],
  severity: "medium",
  total_count: 1,
};

describe("CommsThreadCard", () => {
  it("muestra subject + last_sender + message_count", () => {
    render(<CommsThreadCard thread={baseThread} onSelect={() => {}} />);
    expect(screen.getByText("Cotización paño")).toBeInTheDocument();
    expect(screen.getByText(/maria@cliente.com/)).toBeInTheDocument();
    expect(screen.getByText(/4 mensajes/)).toBeInTheDocument();
  });

  it("muestra horas sin respuesta cuando severity != none", () => {
    render(<CommsThreadCard thread={baseThread} onSelect={() => {}} />);
    expect(screen.getByText(/96h sin respuesta/)).toBeInTheDocument();
  });

  it("oculta horas sin respuesta cuando severity = none", () => {
    render(
      <CommsThreadCard
        thread={{ ...baseThread, severity: "none" }}
        onSelect={() => {}}
      />
    );
    expect(screen.queryByText(/sin respuesta/)).not.toBeInTheDocument();
  });

  it("dispara onSelect con thread_id al click", () => {
    const onSelect = vi.fn();
    render(<CommsThreadCard thread={baseThread} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /Cotización paño/ }));
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it("usa fallback '(sin asunto)' cuando subject es null", () => {
    render(
      <CommsThreadCard
        thread={{ ...baseThread, subject: null }}
        onSelect={() => {}}
      />
    );
    expect(screen.getByText("(sin asunto)")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test (debe fallar)**

```bash
npx vitest run src/components/comms/CommsThreadCard.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Crear componente**

```tsx
"use client";

import { Paperclip, MessageSquare, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { CommsThread } from "@/lib/queries/comms/timeline";

const SEVERITY_DOT: Record<CommsThread["severity"], string> = {
  high: "bg-red-500",
  medium: "bg-amber-500",
  low: "bg-yellow-400",
  none: "bg-slate-300",
};

export interface CommsThreadCardProps {
  thread: CommsThread;
  onSelect: (threadId: number) => void;
}

export function CommsThreadCard({ thread, onSelect }: CommsThreadCardProps) {
  const isExternal = thread.has_external_reply;
  const subject = thread.subject ?? "(sin asunto)";
  const lastActivityHuman = thread.last_activity
    ? formatDistanceToNow(new Date(thread.last_activity), { addSuffix: true, locale: es })
    : "—";

  return (
    <Card
      role="button"
      tabIndex={0}
      aria-label={subject}
      onClick={() => onSelect(thread.thread_id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(thread.thread_id);
        }
      }}
      className="cursor-pointer transition hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-primary"
    >
      <CardContent className="flex items-start gap-3 py-3">
        <span
          className={cn("mt-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full", SEVERITY_DOT[thread.severity])}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={isExternal ? "secondary" : "outline"} className="shrink-0">
              {isExternal ? "external" : "internal"}
            </Badge>
            <span className="truncate text-sm font-medium">{subject}</span>
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            Último: {thread.last_sender ?? "—"} · {lastActivityHuman}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            {thread.severity !== "none" && thread.hours_without_response != null && (
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {Math.round(thread.hours_without_response)}h sin respuesta
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <MessageSquare className="h-3 w-3" />
              {thread.message_count} mensajes
            </span>
            {/* Attachments badge: requiere dato extra del RPC; deferred a iteración futura */}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Re-correr test**

Expected: PASS 5/5.

- [ ] **Step 5: Commit**

```bash
git add src/components/comms/CommsThreadCard.tsx src/components/comms/CommsThreadCard.test.tsx
git commit -m "feat(comms): CommsThreadCard + test (Task 10)"
```

---

### Task 11: `<CommsScopeToggle>`

**Files:**
- Create: `src/components/comms/CommsScopeToggle.tsx`

- [ ] **Step 1: Crear componente**

```tsx
"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import type { CommsScope } from "@/lib/queries/comms/timeline";

const OPTIONS: Array<{ value: CommsScope; label: string }> = [
  { value: "external", label: "Externos" },
  { value: "internal", label: "Internos" },
  { value: "all", label: "Todos" },
];

export interface CommsScopeToggleProps {
  scope: CommsScope;
}

export function CommsScopeToggle({ scope }: CommsScopeToggleProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const setScope = (next: CommsScope) => {
    const sp = new URLSearchParams(searchParams.toString());
    if (next === "external") sp.delete("comms_scope");
    else sp.set("comms_scope", next);
    sp.delete("comms_page"); // reset paging on scope change
    const qs = sp.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  return (
    <div className="inline-flex rounded-md border" role="tablist" aria-label="Filtro de comunicaciones">
      {OPTIONS.map((opt) => (
        <Button
          key={opt.value}
          variant={scope === opt.value ? "default" : "ghost"}
          size="sm"
          role="tab"
          aria-selected={scope === opt.value}
          onClick={() => setScope(opt.value)}
          className="rounded-none first:rounded-l-md last:rounded-r-md"
        >
          {opt.label}
        </Button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Smoke typecheck**

```bash
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/comms/CommsScopeToggle.tsx
git commit -m "feat(comms): CommsScopeToggle URL-state segmented (Task 11)"
```

---

### Task 12: `<CommsThreadDrawer>`

**Files:**
- Create: `src/components/comms/CommsThreadDrawer.tsx`

- [ ] **Step 1: Crear componente**

```tsx
"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Mail } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import type { CommsMessage } from "@/lib/queries/comms/messages";

export interface CommsThreadDrawerProps {
  threadId: number | null;
  gmailThreadId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

async function fetchMessages(threadId: number): Promise<CommsMessage[]> {
  const res = await fetch(`/api/comms/thread/${threadId}`, { cache: "no-store" });
  if (!res.ok) return [];
  return (await res.json()) as CommsMessage[];
}

export function CommsThreadDrawer({
  threadId,
  gmailThreadId,
  open,
  onOpenChange,
}: CommsThreadDrawerProps) {
  const [messages, setMessages] = useState<CommsMessage[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || threadId == null) {
      setMessages(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchMessages(threadId)
      .then((m) => {
        if (!cancelled) setMessages(m);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, threadId]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Mail className="h-4 w-4" />
            Hilo de comunicación
          </SheetTitle>
        </SheetHeader>

        {gmailThreadId && (
          <Button asChild variant="outline" size="sm" className="mt-3 gap-2">
            <a
              href={`https://mail.google.com/mail/u/0/#inbox/${gmailThreadId}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink className="h-3 w-3" />
              Abrir en Gmail
            </a>
          </Button>
        )}

        <ScrollArea className="mt-4 h-[calc(100vh-180px)] pr-3">
          {loading && (
            <div className="space-y-3">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          )}
          {!loading && messages != null && messages.length === 0 && (
            <p className="text-sm text-muted-foreground">No se cargaron mensajes. Intenta de nuevo o abre en Gmail.</p>
          )}
          {!loading &&
            messages != null &&
            messages.map((m) => (
              <article
                key={m.email_id}
                className="mb-4 rounded-md border bg-card p-3 text-sm"
              >
                <header className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge variant={m.sender_type === "external" ? "secondary" : "outline"}>
                    {m.sender_type ?? "unknown"}
                  </Badge>
                  <span className="font-medium">{m.sender}</span>
                  {m.email_date && (
                    <span className="text-xs text-muted-foreground">
                      {format(new Date(m.email_date), "d MMM yyyy HH:mm", { locale: es })}
                    </span>
                  )}
                </header>
                {m.subject && <h4 className="mb-1 font-medium">{m.subject}</h4>}
                <p className="whitespace-pre-wrap text-sm text-foreground/90">
                  {m.body ?? m.snippet ?? "(sin contenido)"}
                </p>
              </article>
            ))}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 2: Crear API route que invoca helper messages**

Crear `src/app/api/comms/thread/[threadId]/route.ts`:

```ts
import { NextResponse } from "next/server";

import { getCommsThreadMessages } from "@/lib/queries/comms/messages";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const { threadId } = await params;
  const id = Number(threadId);
  if (!Number.isFinite(id)) {
    return NextResponse.json([], { status: 200 });
  }
  const messages = await getCommsThreadMessages(id);
  return NextResponse.json(messages);
}
```

- [ ] **Step 3: Smoke typecheck**

```bash
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/comms/CommsThreadDrawer.tsx src/app/api/comms/thread/\[threadId\]/route.ts
git commit -m "feat(comms): CommsThreadDrawer + API route (Task 12)"
```

---

### Task 13: `<CommsThreadList>` (client)

**Files:**
- Create: `src/components/comms/CommsThreadList.tsx`

- [ ] **Step 1: Crear componente**

```tsx
"use client";

import { useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { CommsScopeToggle } from "./CommsScopeToggle";
import { CommsThreadCard } from "./CommsThreadCard";
import { CommsThreadDrawer } from "./CommsThreadDrawer";
import type { CommsScope, CommsThread } from "@/lib/queries/comms/timeline";

export interface CommsThreadListProps {
  threads: CommsThread[];
  total: number;
  hasMore: boolean;
  scope: CommsScope;
  page: number;
  pageSize: number;
}

export function CommsThreadList({
  threads,
  total,
  hasMore,
  scope,
  page,
  pageSize,
}: CommsThreadListProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [activeThread, setActiveThread] = useState<CommsThread | null>(null);

  const goToPage = (next: number) => {
    const sp = new URLSearchParams(searchParams.toString());
    if (next <= 0) sp.delete("comms_page");
    else sp.set("comms_page", String(next));
    const qs = sp.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  return (
    <section className="space-y-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <CommsScopeToggle scope={scope} />
        <span className="text-xs text-muted-foreground">
          Mostrando {threads.length} de {total}
        </span>
      </header>

      <div className="space-y-2">
        {threads.map((t) => (
          <CommsThreadCard
            key={t.thread_id}
            thread={t}
            onSelect={() => setActiveThread(t)}
          />
        ))}
      </div>

      <footer className="flex justify-between gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page === 0}
          onClick={() => goToPage(page - 1)}
        >
          Anterior
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!hasMore}
          onClick={() => goToPage(page + 1)}
        >
          Siguiente
        </Button>
      </footer>

      <CommsThreadDrawer
        threadId={activeThread?.thread_id ?? null}
        gmailThreadId={activeThread?.gmail_thread_id ?? null}
        open={activeThread !== null}
        onOpenChange={(open) => {
          if (!open) setActiveThread(null);
        }}
      />
    </section>
  );
}
```

- [ ] **Step 2: Smoke typecheck**

```bash
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/comms/CommsThreadList.tsx
git commit -m "feat(comms): CommsThreadList client paging (Task 13)"
```

---

### Task 14: `<CommsTimeline>` (server entry)

**Files:**
- Create: `src/components/comms/CommsTimeline.tsx`

- [ ] **Step 1: Crear componente**

```tsx
import { z } from "zod";

import { getCommsTimeline, type CommsScope, type CommsEntityType } from "@/lib/queries/comms/timeline";
import { CommsEmptyState } from "./CommsEmptyState";
import { CommsThreadList } from "./CommsThreadList";

const scopeSchema = z
  .enum(["external", "internal", "all"])
  .catch("external") as z.ZodType<CommsScope>;
const pageSchema = z.coerce.number().int().min(0).catch(0);

export interface CommsTimelineProps {
  entityType: CommsEntityType;
  entityId: number;
  searchParams?: Record<string, string | string[] | undefined>;
}

const PAGE_SIZE = 25;

export async function CommsTimeline({
  entityType,
  entityId,
  searchParams,
}: CommsTimelineProps) {
  const scope = scopeSchema.parse(searchParams?.comms_scope ?? "external");
  const page = pageSchema.parse(searchParams?.comms_page ?? 0);

  const payload = await getCommsTimeline({
    entityType,
    entityId,
    scope,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  if (payload.total === 0) {
    return <CommsEmptyState entityType={entityType} />;
  }

  return (
    <CommsThreadList
      threads={payload.threads}
      total={payload.total}
      hasMore={payload.hasMore}
      scope={scope}
      page={page}
      pageSize={PAGE_SIZE}
    />
  );
}
```

- [ ] **Step 2: Smoke typecheck**

```bash
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/comms/CommsTimeline.tsx
git commit -m "feat(comms): CommsTimeline server entry (Task 14)"
```

---

## Phase D — Integration

### Task 15: Tab "Comunicaciones" en `/empresas/[id]`

**Files:**
- Modify: `src/app/empresas/[id]/_components/TabPicker.tsx`
- Modify: `src/app/empresas/[id]/page.tsx`

- [ ] **Step 1: Editar TabPicker — agregar `comunicaciones` a TabKey, TAB_ORDER, TAB_LABELS**

En `src/app/empresas/[id]/_components/TabPicker.tsx`, modificar:

```diff
 export type TabKey =
   | "panorama"
   | "comercial"
   | "financiero"
   | "operativo"
   | "fiscal"
   | "pagos"
+  | "comunicaciones"
   | "auditoria_sat";

 const TAB_ORDER: TabKey[] = [
   "panorama",
   "comercial",
   "financiero",
   "operativo",
   "fiscal",
   "pagos",
+  "comunicaciones",
   "auditoria_sat",
 ];

 const TAB_LABELS: Record<TabKey, string> = {
   panorama: "Panorama",
   comercial: "Comercial",
   financiero: "Financiero",
   operativo: "Operativo",
   fiscal: "Fiscal",
   pagos: "Pagos",
+  comunicaciones: "Comunicaciones",
   auditoria_sat: "Auditoría SAT",
 };
```

- [ ] **Step 2: Editar `page.tsx` — agregar enum + BASE_TAB_ORDER + render block**

En `src/app/empresas/[id]/page.tsx`:

```diff
 const detailSchema = z.object({
   tab: z
     .enum([
       "panorama",
       "comercial",
       "financiero",
       "operativo",
       "fiscal",
       "pagos",
+      "comunicaciones",
       "auditoria_sat",
     ])
     .catch("panorama"),
 });

 const BASE_TAB_ORDER: TabKey[] = [
   "panorama",
   "comercial",
   "financiero",
   "operativo",
   "fiscal",
   "pagos",
+  "comunicaciones",
 ];
```

Y al lado de los otros imports de tabs:

```diff
 import { TabPicker, type TabKey } from "./_components/TabPicker";
 import { PanoramaTab } from "./_components/PanoramaTab";
 ...
 import { AuditoriaSatTab } from "./_components/AuditoriaSatTab";
+import { CommsTimeline } from "@/components/comms/CommsTimeline";
```

Y en el bloque de render de tabs (después del `pagos` tab y antes del `auditoria_sat`):

```diff
         {activeTab === "pagos" && (
           <PagosTab company={legacyDetail} searchParams={raw} />
         )}
+        {activeTab === "comunicaciones" && (
+          <CommsTimeline
+            entityType="company"
+            entityId={id}
+            searchParams={raw}
+          />
+        )}
         {activeTab === "auditoria_sat" && (
```

**Nota:** ubicar el cambio leyendo primero el `page.tsx` (líneas 260-285 donde están los `activeTab === ...` blocks). Mantener el orden visual coherente con `TAB_ORDER`.

- [ ] **Step 3: Build + typecheck**

```bash
npx tsc --noEmit
npm run build
```

Expected: ambos PASS. Build con `--max-old-space-size=8192` si NODE_OPTIONS no lo cubre:

```bash
NODE_OPTIONS="--max-old-space-size=8192" npm run build
```

- [ ] **Step 4: Smoke local**

```bash
npm run dev
```

Navegar a `http://localhost:3000/empresas/<ID_real>?tab=comunicaciones`. Verificar:
- Tab visible en TabPicker.
- Renderiza `<CommsTimeline>` con datos o empty state.
- Toggle scope cambia URL y re-fetch.

- [ ] **Step 5: Commit**

```bash
git add src/app/empresas/\[id\]/_components/TabPicker.tsx src/app/empresas/\[id\]/page.tsx
git commit -m "feat(comms): integrate Comunicaciones tab in /empresas/[id] (Task 15)"
```

---

### Task 16: Sección "Comunicaciones" en `/contactos/[id]`

**Files:**
- Modify: `src/app/contactos/[id]/page.tsx`

- [ ] **Step 1: Inspeccionar estructura actual del contactos page**

Run: `head -60 src/app/contactos/[id]/page.tsx`

Identificar dónde insertar la sección — preferiblemente al final del JSX, después de las cards existentes pero antes del cierre del `<div className="space-y-5 ...">`.

- [ ] **Step 2: Agregar import + sección**

En `src/app/contactos/[id]/page.tsx`:

```diff
 import { getContactDetail } from "@/lib/queries/_shared/contacts";
+import { CommsTimeline } from "@/components/comms/CommsTimeline";
```

Y firma de la función — agregar searchParams:

```diff
 export default async function ContactDetailPage({
   params,
+  searchParams,
 }: {
   params: Promise<{ id: string }>;
+  searchParams: Promise<Record<string, string | string[] | undefined>>;
 }) {
   const { id } = await params;
+  const raw = await searchParams;
   const contact = await getContactDetail(id);
   if (!contact) notFound();
```

Antes del cierre del último `</div>` del return (antes de `);`):

```tsx
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Comunicaciones</h2>
        <CommsTimeline entityType="contact" entityId={Number(id)} searchParams={raw} />
      </section>
```

**Nota:** `Number(id)` puede dar NaN si el id no es numérico (el path es `[id]` text). Si en este repo los contactos usan IDs no numéricos, ajustar a string y modificar `getCommsTimeline` (ver type `entityId: number` — quizás ampliar a `number | string`). Verificar al ejecutar este task.

- [ ] **Step 3: Build + typecheck**

```bash
npx tsc --noEmit
NODE_OPTIONS="--max-old-space-size=8192" npm run build
```

Expected: PASS.

- [ ] **Step 4: Smoke local**

Navegar a `http://localhost:3000/contactos/<ID_real>?comms_scope=external`. Verificar sección visible al pie del detail.

- [ ] **Step 5: Commit**

```bash
git add src/app/contactos/\[id\]/page.tsx
git commit -m "feat(comms): integrate Comunicaciones section in /contactos/[id] (Task 16)"
```

---

### Task 17: Tests + DoD

**Files:** ninguno nuevo, sólo verificación.

- [ ] **Step 1: Correr todos los tests vitest**

```bash
npx vitest run src/lib/queries/comms src/components/comms
```

Expected: 100% PASS (5 tests timeline + 2 emptystate + 5 threadcard = 12 tests).

- [ ] **Step 2: Correr SQL tests**

```
mcp__claude_ai_Supabase__execute_sql con contenido de supabase/tests/comms_timeline_rpc.sql
mcp__claude_ai_Supabase__execute_sql con contenido de supabase/tests/comms_invariants.sql
```

Expected: NOTICE 4 + 4 = 8 PASSED messages.

- [ ] **Step 3: Cron run manual + smoke gold_ceo_inbox**

```sql
SELECT detect_comms_unanswered_external_thread();
SELECT detect_comms_activity_overdue();

SELECT issue_type, severity, COUNT(*) AS open_count
FROM gold_ceo_inbox
WHERE issue_type LIKE 'comms.%'
GROUP BY 1, 2
ORDER BY 1, 2;
```

Expected: 0..N rows con issue_type comms.*. Sanity check: no flood (>500 unanswered_external sería raro para 50k threads → si pasa, ajustar threshold de 48h en plan.md anexo).

- [ ] **Step 4: Build verde**

```bash
NODE_OPTIONS="--max-old-space-size=8192" npm run build
```

Expected: PASS.

- [ ] **Step 5: Smoke navegacional**

```bash
npm run dev
```

- Visitar `/empresas/<id_con_comms>?tab=comunicaciones` — timeline visible.
- Toggle external/internal/all — re-fetch correcto.
- Click en card — drawer abre, mensajes aparecen, "Abrir en Gmail" funciona.
- Visitar `/empresas/<id_sin_comms>?tab=comunicaciones` — empty state.
- Visitar `/contactos/<id>` — sección al pie aparece.

- [ ] **Step 6: Open PR a `main`**

```bash
git push -u origin comms-mvp
gh pr create --title "feat(comms): MVP timeline tabs + 2 inbox invariants" --body "$(cat <<'EOF'
## Summary
- Tab/sección Comunicaciones en /empresas/[id] y /contactos/[id]
- 2 nuevos issue_types en gold_ceo_inbox: unanswered_external_thread + activity_overdue
- Read-only sobre emails/threads existentes; cero cambios al addon Odoo

Spec: docs/superpowers/specs/2026-04-29-comms-layer-mvp-design.md
Plan: docs/superpowers/plans/2026-04-29-comms-layer-mvp-plan.md

## Test plan
- [ ] tsc --noEmit verde
- [ ] npm run build verde
- [ ] vitest run pasa 12 tests
- [ ] SQL tests pasan 8 NOTICE
- [ ] Smoke /empresas/[id]?tab=comunicaciones con datos
- [ ] Smoke empty state
- [ ] Drawer + Gmail link funcionan
- [ ] gold_ceo_inbox muestra issue_types nuevos

🤖 Generated with [claude-flow](https://github.com/ruvnet/claude-flow)
EOF
)"
```

- [ ] **Step 7: 24h post-merge monitoring**

A las 24h, run:

```sql
SELECT issue_type, COUNT(*) FILTER (WHERE resolved_at IS NULL) AS open
FROM reconciliation_issues
WHERE issue_type LIKE 'comms.%'
GROUP BY 1;

SELECT run_type, COUNT(*) FROM audit_runs
WHERE run_type LIKE 'comms_%' AND status = 'error'
  AND started_at > now() - interval '24 hours'
GROUP BY 1;
```

Expected:
- Línea 1: counts razonables (esperado ~10-100 unanswered_external, ~50-200 activity_overdue dependiendo del estado real).
- Línea 2: 0 errores.

Si counts >500 unanswered_external, considerar relajar threshold de 48h → 96h en patch follow-up.

- [ ] **Step 8: Cleanup**

Eliminar branch local + remote tras merge:

```bash
git checkout main
git pull
git branch -d comms-mvp
git push origin --delete comms-mvp
```

---

## Self-Review Checklist (post-write)

**Spec coverage:**
- §3.1 (1) migration con RPC + 2 detect funcs + routing + cron → Tasks 1-6 ✓
- §3.1 (2) helper getCommsTimeline + Zod + cache → Task 7 ✓
- §3.1 (3) 5 componentes → Tasks 9-14 ✓ (CommsTimeline, ThreadList, ThreadCard, ThreadDrawer, ScopeToggle, EmptyState = 6 archivos; spec dice 5 mais ScopeToggle es razonable adicional)
- §3.1 (4) integración detail pages → Tasks 15-16 ✓
- §3.1 (5) tests → Tasks 9, 10 + SQL tests Tasks 2, 4, 5 ✓
- §3.1 (6) spec doc → ya existe ✓
- §6 RPC `comms_timeline` SQL → Task 2 ✓
- §6 RPC `comms_thread_messages` → Task 3 ✓
- §6.3 detect funcs → Tasks 4, 5 ✓
- §6.4 routing → Task 6 ✓
- §6.5 cron → Task 6 ✓
- §6.6 indexes → Task 1 ✓
- §7.1 error handling — throw-safe en helper → Task 7 (test verifies) ✓
- §7.4 rollout — straight to main, sin feature flag → Task 17 step 6 ✓
- §9 DoD checklist → Task 17 ✓

**Placeholder scan:** no "TBD"/"TODO"/"implement later" como placeholders. Las "Notas" son guidance legítimo (sintaxis fallback, validación de constraints, etc.).

**Type consistency:**
- `CommsScope` definido en `timeline.ts` ✓ usado en `CommsScopeToggle`, `CommsThreadList`, `CommsTimeline` ✓
- `CommsEntityType` definido en `timeline.ts` ✓ usado en `CommsTimeline` ✓
- `CommsThread` exportado ✓ usado en `CommsThreadCard`, `CommsThreadList`, `CommsThreadDrawer` (vía thread.gmail_thread_id) ✓
- `CommsMessage` definido en `messages.ts` ✓ usado en `CommsThreadDrawer` ✓
- `getCommsTimeline` signature consistente: `{entityType, entityId, scope?, limit?, offset?} → Promise<CommsTimelinePayload>` en helper, llamado correctamente en `CommsTimeline` ✓
- RPC param names: `p_entity_type`, `p_entity_id`, `p_scope`, `p_limit`, `p_offset` — consistente entre SQL y helper ✓
- API route `/api/comms/thread/[threadId]` ↔ fetch en `CommsThreadDrawer.fetchMessages` ✓

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-29-comms-layer-mvp-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** — Yo despacho un subagente fresco por task, reviso entre tasks, iteración rápida.

**2. Inline Execution** — Ejecutar tasks en esta sesión usando executing-plans, batch con checkpoints para review.

¿Cuál prefieres?
