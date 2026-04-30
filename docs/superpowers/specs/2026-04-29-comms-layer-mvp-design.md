# Comms Layer MVP — Design Spec

**Fecha:** 2026-04-29
**Branch sugerida:** `comms-mvp` (cortada de `main@cdc823b`)
**Estado:** Draft — aprobado vía brainstorming, pendiente user review.
**Sub-spec de:** standalone (no parte de SP6 ni SP13). Sienta base para SP14 futuro (bidireccional + canonical_communications).

---

## 1. Contexto

`emails` (117,621) + `threads` (50,961) ya están sincronizados desde Gmail vía `/api/pipeline/sync-emails` (cron 30min). Resolución actual: 76.5% emails con `sender_contact_id`, 82.1% con `company_id`, 775 contactos distintos con email, 582 empresas distintas. `canonical_activities` (~184k) ya refleja `mail.activity` desde el addon qb19.

Lo que NO existe hoy:
- Ninguna UI dedicada para ver historial de comunicación por empresa o contacto.
- Cero invariants de comunicación en `gold_ceo_inbox`.
- Cero gold views agregadas sobre `emails`/`threads`.

**Objetivo del MVP:** entregar el menor incremento útil que (a) exponga el historial de comms en las páginas de detalle existentes y (b) inyecte 2 alertas de comms al inbox del CEO. Sin tocar el addon, sin outbound, sin AI features.

---

## 2. Decisiones arquitectónicas (del brainstorming)

| # | Decisión | Alternativas descartadas |
|---|---|---|
| D1 | **Read-only sobre `emails`+`threads` existentes.** Cero DDL en bronze. | Sincronizar `mail.message` · construir `canonical_communications` Pattern B · pushear `phone`/`mobile` |
| D2 | **Tabs `Comunicaciones` en `/empresas/[id]` y `/contactos/[id]`.** Sin página top-level `/comunicaciones`. | Solo empresas · página dedicada · sólo tab + sección global |
| D3 | **Solo emails + threads en el timeline.** No mezclar con `canonical_activities` aquí. | Mixed timeline · timeline contextual con invoices/payments |
| D4 | **2 invariants en `gold_ceo_inbox`:** `comms.unanswered_external_thread` + `comms.activity_overdue`. | 1 solo · 4 (incluyendo stale_relationship + slow_responder) |
| D5 | **RPC directo sobre `threads` sin MV intermedio.** `threads` ya tiene `hours_without_response`, `last_sender_type`, etc. | Crear `gold_communications_threads` MV · view materializada |
| D6 | **Severity 24h/72h/168h** (low/medium/high), invariant fires a 48h. | 8h/24h/72h · 24h/72h/240h |
| D7 | **`SECURITY INVOKER` + `search_path` pinned** en RPC; `SECURITY DEFINER` solo en detect funcs (necesitan escribir a `reconciliation_issues`). | Todo INVOKER · todo DEFINER |
| D8 | **Straight to main, sin feature flag.** Cambio aditivo, daño acotado a tab nuevo + 2 issue_types nuevos. | Feature flag con rollout gradual |
| D9 | **Drawer read-only con CTA "Abrir en Gmail" externo.** | Modal con replies in-line · sólo CTA externo |
| D10 | **Out of scope:** outbound, mail.message push, phone push, canonical_communications Pattern B, AI extraction expuesto, activity body completo, página top-level. Quedan para SP14. | Bidireccional bundled · todo en una sola sesión |

---

## 3. Alcance

### 3.1 Qué hace este sub-proyecto

1. Una migration Supabase con:
   - RPC `comms_timeline(p_entity_type, p_entity_id, p_scope, p_limit, p_offset)`.
   - Función `detect_comms_unanswered_external_thread()` (cron-callable).
   - Función `detect_comms_activity_overdue()` (cron-callable).
   - 2 INSERT en `invariant_routing` para los nuevos `issue_type`.
   - Cron pg_cron hourly que dispare ambas detect funcs (engancharse a `silver_sp2_reconcile_hourly` existente o crear `comms_invariants_hourly`).
2. Helper Server Component `lib/queries/comms/timeline.ts` con Zod schema y `unstable_cache` 60s.
3. 5 componentes nuevos en `components/comms/`:
   - `<CommsTimeline>` (server boundary, lazy por tab).
   - `<CommsThreadList>` (client, paginación + scope toggle).
   - `<CommsThreadCard>` (presentational, traffic-light token).
   - `<CommsThreadDrawer>` (read-only thread detail con CTA Gmail).
   - `<CommsEmptyState>` (empty + CTA orientativo).
4. Edición surgical en:
   - `src/app/empresas/[id]/page.tsx` — agregar entry `comunicaciones` al `TabPicker`.
   - `src/app/contactos/[id]/page.tsx` — agregar tab equivalente.
5. Tests: 3 unit/component + 1 RPC test + 1 invariant test.
6. Spec doc (este archivo) + plan en `docs/superpowers/plans/`.

### 3.2 Qué NO hace (out of scope)

- ❌ Modificar el addon qb19. Cero PR a `main` del addon.
- ❌ Outbound (compose, send, scheduling, templates).
- ❌ Webhook inbound para tracking de respuestas.
- ❌ AI draft suggestions, summary, extraction expuesto en UI.
- ❌ Sincronizar `mail.message`, `mail.mail`, `mail.thread`, `phone`, `mobile`.
- ❌ Crear `canonical_communications` (Pattern B) — eso es SP14.
- ❌ Página top-level `/comunicaciones`.
- ❌ Tocar el backlog de seguridad existente (35 security_definer_view, 14 RLS off, 269 search_path WARN). El RLS off en bronze/canonical es decisión consciente (anon-key no expuesto, frontend usa service_key — ver CLAUDE.md §RLS posture).
- ❌ Mezclar `canonical_activities` en el timeline visual (la invariant SI las usa, pero no se renderizan en `<CommsThreadList>`).

---

## 4. Arquitectura

```
Bronze (sin cambios)
  emails (117k)  threads (50k)  canonical_activities (~184k)
        │              │                    │
        └──────────────┼────────────────────┘
                       ▼
Backend nuevo
  RPC comms_timeline(...)              ← lee threads + emails directo
  detect_comms_unanswered_external_thread()
  detect_comms_activity_overdue()
                       ▼
  reconciliation_issues                ← UPSERT 2 nuevos issue_type
                       ▼
  gold_ceo_inbox                       ← UNION existente, sin cambios
                       ▼
Frontend nuevo
  lib/queries/comms/timeline.ts
  components/comms/* (5)
                       ▼
UI integrada
  app/empresas/[id]/page.tsx           ← +1 tab
  app/contactos/[id]/page.tsx          ← +1 tab
```

**Data flow del tab `Comunicaciones`:**

1. Usuario navega a `/empresas/123` y hace click en tab `Comunicaciones`.
2. URL state se actualiza: `?tab=comunicaciones&comms_scope=external&comms_page=0`.
3. Server component `<CommsTimeline entityType="company" entityId={123}>` se monta y llama `getCommsTimeline({...})`.
4. Helper invoca RPC `comms_timeline('company', 123, 'external', 25, 0)` con `getServiceClient()`.
5. RPC ejecuta `SELECT FROM threads WHERE company_id = 123 ...` con filtros y orden, devuelve filas + `total_count`.
6. Helper valida con Zod, retorna `CommsTimelinePayload`.
7. Client component `<CommsThreadList>` renderiza `<CommsThreadCard>` por thread.
8. Click en card abre `<CommsThreadDrawer>` que lista emails del thread (segunda RPC `comms_thread_messages(p_thread_id)` o reuso de un helper directo a `emails`).
9. Toggle scope (external/internal/all) actualiza URL state, re-fetch.

**Invariant detection (cron hourly):**

1. pg_cron `comms_invariants_hourly` (HH:25) llama `detect_comms_unanswered_external_thread()` y `detect_comms_activity_overdue()`.
2. Cada función UPSERT a `reconciliation_issues` con `issue_type` correspondiente, `canonical_entity_type`, `canonical_entity_id`, `metadata` con context.
3. Cuando un thread se responde (`last_sender_type` flips a internal) o una activity se cierra en Odoo (desaparece del push porque `_push_activities` hace delete_all), la próxima corrida del cron detecta la ausencia de la condición y marca el issue como `resolved_at = now()` en `reconciliation_issues`.
4. `gold_ceo_inbox` (view) automáticamente muestra/oculta según `resolved_at IS NULL`.

---

## 5. Componentes (frontend)

### 5.1 `lib/queries/comms/timeline.ts`

```ts
import { z } from 'zod';
import { getServiceClient } from '@/lib/supabase-server';
import { unstable_cache } from 'next/cache';

export const CommsThreadSchema = z.object({
  thread_id: z.number(),
  gmail_thread_id: z.string(),
  subject: z.string().nullable(),
  last_activity: z.string(),
  last_sender: z.string().nullable(),
  last_sender_type: z.enum(['internal', 'external', 'unknown']).nullable(),
  hours_without_response: z.number().nullable(),
  status: z.string().nullable(),
  message_count: z.number(),
  has_internal_reply: z.boolean(),
  has_external_reply: z.boolean(),
  participant_emails: z.array(z.string()).nullable(),
  severity: z.enum(['high', 'medium', 'low', 'none']),
});

export type CommsThread = z.infer<typeof CommsThreadSchema>;

export type CommsTimelinePayload = {
  threads: CommsThread[];
  total: number;
  hasMore: boolean;
};

export async function getCommsTimeline(args: {
  entityType: 'company' | 'contact';
  entityId: number;
  scope?: 'external' | 'internal' | 'all';
  limit?: number;
  offset?: number;
}): Promise<CommsTimelinePayload> { /* ... */ }
```

- Cache key: `comms-timeline-v1:${entityType}:${entityId}:${scope}:${limit}:${offset}`.
- TTL 60s (alineado a otros gold reads).
- Throw-safe: si RPC falla, log y retorna `{threads:[], total:0, hasMore:false}` (cumple `feedback_server_component_top_level_throws.md`).

### 5.2 Componentes UI

**`<CommsTimeline entityType, entityId, initialScope='external'>`**
Server component, lazy por tab. Llama `getCommsTimeline`, renderiza `<CommsEmptyState>` si total=0, sino `<CommsThreadList>`.

**`<CommsThreadList threads, total, scope, entityType, entityId>`**
Client component. Maneja URL state (`comms_scope`, `comms_page` vía Zod). Renderiza array de `<CommsThreadCard>`. Footer con paginación (Load more vs page numbers — se decide en plan).

**`<CommsThreadCard thread>`**
Presentational. Layout:

```
┌──────────────────────────────────────────────────┐
│ ●  [external|internal] Subject del thread       │
│    Último: maria@cliente.com — hace 3d           │
│    ⏱ 72h sin respuesta · 4 mensajes · 📎        │
└──────────────────────────────────────────────────┘
```

- `●` color por `severity` usando traffic-light tokens SP6 (`bg-red-500` high / `bg-amber-500` medium / `bg-yellow-400` low / `bg-slate-300` none).
- Badge `external|internal` derivado de `has_external_reply` / `has_internal_reply`.
- "hace 3d" computed con `formatDistanceToNow` de `date-fns`.
- "⏱ 72h sin respuesta" sólo si `last_sender_type='external'` y `hours_without_response > 24`.
- "📎" sólo si algún email del thread tiene `has_attachments` (lookup ligero en card render — o se trae como flag en RPC, decisión menor).
- Click abre `<CommsThreadDrawer>` (Sheet de shadcn).

**`<CommsThreadDrawer threadId, open, onClose>`**
Client component. Llama `getCommsThreadMessages(threadId)` (helper similar a timeline pero pulls emails del thread). Renderiza lista de mensajes con sender, fecha, body (truncado con expand). Footer con CTA "Abrir thread en Gmail" → `https://mail.google.com/mail/u/0/#inbox/{gmail_thread_id}` (target=_blank).

**`<CommsScopeToggle scope, onChange>`**
Client. SegmentedControl con `External | Internal | All`. Cambia URL state.

**`<CommsEmptyState entityType, entityId>`**
Presentational. Mensaje contextual + CTA.

- Empresa: *"No hay comunicaciones registradas con esta empresa. Verifica que el email del contacto principal esté registrado en Odoo y se haya sincronizado a Gmail."*
- Contacto: *"Este contacto aún no tiene emails sincronizados. Verifica el email registrado en Odoo."* + link a `/contactos/[id]` para editar (si edit existe; sino sólo mensaje).

### 5.3 Integración en detail pages

**`src/app/empresas/[id]/page.tsx`:**

```diff
  const tabs = [
    { key: 'panorama', label: 'Panorama', component: PanoramaTab },
    { key: 'financiero', label: 'Financiero', component: FinancieroTab },
    /* ... otros tabs ... */
+   { key: 'comunicaciones', label: 'Comunicaciones', component: CommsTimelineTab },
  ];
```

- `CommsTimelineTab` es wrapper que recibe `companyId` y monta `<CommsTimeline entityType="company" entityId={companyId} />`.
- Lazy: el RPC sólo se ejecuta cuando el tab está activo (Next.js Suspense + dynamic import opcional).

**`src/app/contactos/[id]/page.tsx`:**
Análogo. Si el archivo no usa el patrón `tabs` aún (verificar en plan), envolver en condición o crear estructura mínima de tabs reutilizando `<TabPicker>` de SP6.

---

## 6. Data layer (Supabase)

> **Schemas verificados 2026-04-29:**
> - `reconciliation_issues.canonical_entity_id` es `text` (no bigint) — casts a `::text` requeridos al insertar.
> - `canonical_activities` tiene `canonical_company_id` ✓ y `assigned_canonical_contact_id` (NO `canonical_contact_id`). Si una actividad no tiene `canonical_company_id` resuelto, no la subimos al inbox (no tenemos buena entidad para asignarla).
> - `invariant_routing` schema real: `(routing_id, issue_type, invariant_namespace, department_name, canonical_contact_id, match_predicate jsonb, priority, updated_at)`. NO existe `severity_default`/`domain`/`default_assignee_role`/`default_action`.

### 6.1 RPC `comms_timeline`

```sql
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
    SELECT array_agg(t.id)
      INTO v_thread_ids
      FROM threads t
      WHERE t.company_id = p_entity_id;
  ELSIF p_entity_type = 'contact' THEN
    SELECT array_agg(DISTINCT thread_ids.tid)
      INTO v_thread_ids
      FROM (
        SELECT id AS tid FROM threads WHERE started_by_contact_id = p_entity_id
        UNION
        SELECT DISTINCT thread_id AS tid FROM emails
          WHERE sender_contact_id = p_entity_id AND thread_id IS NOT NULL
      ) thread_ids;
  ELSE
    RAISE EXCEPTION 'Unknown entity_type %', p_entity_type;
  END IF;

  RETURN QUERY
  WITH filtered AS (
    SELECT t.*
    FROM threads t
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
  ORDER BY f.last_activity DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

GRANT EXECUTE ON FUNCTION public.comms_timeline(text, bigint, text, int, int)
  TO authenticated, service_role;
```

### 6.2 RPC `comms_thread_messages` (para Drawer)

```sql
CREATE OR REPLACE FUNCTION public.comms_thread_messages(p_thread_id bigint)
RETURNS TABLE (
  email_id        bigint,
  gmail_message_id text,
  sender          text,
  recipient       text,
  email_date      timestamptz,
  subject         text,
  snippet         text,
  body            text,
  sender_type     text,
  has_attachments boolean
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
  SELECT id, gmail_message_id, sender, recipient, email_date, subject, snippet, body, sender_type, has_attachments
  FROM emails
  WHERE thread_id = p_thread_id
  ORDER BY email_date ASC;
$$;

GRANT EXECUTE ON FUNCTION public.comms_thread_messages(bigint) TO authenticated, service_role;
```

### 6.3 Detect functions

**`detect_comms_unanswered_external_thread()`**

```sql
CREATE OR REPLACE FUNCTION public.detect_comms_unanswered_external_thread()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_inserted int;
BEGIN
  -- Open new issues
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
    FROM threads t
    WHERE t.last_sender_type = 'external'
      AND t.hours_without_response > 48
      AND COALESCE(t.status, 'open') NOT IN ('closed', 'archived')
      AND t.company_id IS NOT NULL
  )
  INSERT INTO reconciliation_issues (
    issue_type, severity, canonical_entity_type, canonical_entity_id,
    description, metadata, detected_at
  )
  SELECT
    'comms.unanswered_external_thread',
    severity,
    'company',
    company_id::text,                -- canonical_entity_id es text en reconciliation_issues
    format('Thread sin respuesta hace %sh: %s', round(hours_without_response), COALESCE(subject, '(sin asunto)')),
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
  DO UPDATE SET
    severity = EXCLUDED.severity,
    metadata = EXCLUDED.metadata,
    detected_at = EXCLUDED.detected_at,
    resolved_at = NULL;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- Auto-resolve issues whose thread no longer matches
  UPDATE reconciliation_issues ri
  SET resolved_at = now()
  WHERE ri.issue_type = 'comms.unanswered_external_thread'
    AND ri.resolved_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM threads t
      WHERE t.id = (ri.metadata->>'thread_id')::bigint
        AND t.last_sender_type = 'external'
        AND t.hours_without_response > 48
        AND COALESCE(t.status, 'open') NOT IN ('closed', 'archived')
    );

  RETURN v_inserted;
EXCEPTION WHEN OTHERS THEN
  INSERT INTO audit_runs (run_type, status, error_message, started_at, finished_at)
  VALUES ('comms_unanswered_thread_detect', 'error', SQLERRM, now(), now());
  RAISE;
END;
$$;
```

**Nota de implementación:** la cláusula `ON CONFLICT` requiere un UNIQUE INDEX sobre `(issue_type, canonical_entity_type, canonical_entity_id, (metadata->>'thread_id'))`. Verificar si existe; si no, crearlo en la misma migration.

**`detect_comms_activity_overdue()`**

```sql
CREATE OR REPLACE FUNCTION public.detect_comms_activity_overdue()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_inserted int;
BEGIN
  WITH detected AS (
    SELECT
      ca.bronze_id       AS activity_id,
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
    FROM canonical_activities ca
    WHERE ca.date_deadline < CURRENT_DATE
      AND ca.is_overdue = TRUE
      AND ca.canonical_company_id IS NOT NULL  -- skip activities sin entidad resuelta
  )
  INSERT INTO reconciliation_issues (
    issue_type, severity, canonical_entity_type, canonical_entity_id,
    description, metadata, detected_at, assignee_canonical_contact_id
  )
  SELECT
    'comms.activity_overdue',
    severity,
    'company',
    canonical_company_id::text,    -- canonical_entity_id es text
    format('Actividad %s días vencida: %s', days_overdue, COALESCE(summary, activity_type, '(sin descripción)')),
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
    assigned_canonical_contact_id  -- assignee del canonical_activities
  FROM detected
  ON CONFLICT (issue_type, canonical_entity_type, canonical_entity_id, (metadata->>'activity_id'))
  DO UPDATE SET
    severity = EXCLUDED.severity,
    metadata = EXCLUDED.metadata,
    detected_at = EXCLUDED.detected_at,
    resolved_at = NULL;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- Auto-resolve: activities removed from canonical (= cerradas en Odoo)
  UPDATE reconciliation_issues ri
  SET resolved_at = now()
  WHERE ri.issue_type = 'comms.activity_overdue'
    AND ri.resolved_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM canonical_activities ca
      WHERE ca.id = (ri.metadata->>'activity_id')::bigint
        AND ca.is_overdue = TRUE
        AND ca.date_deadline < CURRENT_DATE
    );

  RETURN v_inserted;
EXCEPTION WHEN OTHERS THEN
  INSERT INTO audit_runs (run_type, status, error_message, started_at, finished_at)
  VALUES ('comms_activity_overdue_detect', 'error', SQLERRM, now(), now());
  RAISE;
END;
$$;
```

**Nota:** schema exacto de `canonical_activities` (`canonical_company_id`, `canonical_contact_id`) requiere validación en plan. Si no existen estos campos, ajustar con joins via `odoo_partner_id` → `canonical_companies.odoo_partner_id`.

### 6.4 Routing

Schema real de `invariant_routing`: `(routing_id, issue_type, invariant_namespace, department_name, canonical_contact_id, match_predicate jsonb, priority)`.

```sql
-- Asignamos namespace 'comms' y department a Ventas (vendedor responde threads + cierra activities)
INSERT INTO invariant_routing (issue_type, invariant_namespace, department_name, match_predicate, priority)
VALUES
  ('comms.unanswered_external_thread', 'comms', 'Ventas', '{}'::jsonb, 100),
  ('comms.activity_overdue',           'comms', 'Ventas', '{}'::jsonb, 100)
ON CONFLICT DO NOTHING;
```

**Notas:**
- `match_predicate` lo dejamos vacío en MVP — el routing va por `issue_type` único; predicates más finos (por ejemplo, asignar `comms.activity_overdue` por `res_model` a Compras vs Ventas) van a SP14.
- `canonical_contact_id` queda NULL — el assignee específico lo escribe `detect_comms_activity_overdue` directamente en `reconciliation_issues.assignee_canonical_contact_id` (viene de `canonical_activities.assigned_canonical_contact_id`). Para `comms.unanswered_external_thread`, el assignee se resolverá downstream (gold_ceo_inbox) o queda NULL si no se puede determinar — decisión menor a confirmar en plan.
- Verificar en plan si `invariant_routing` tiene UNIQUE en `issue_type` (probable, basado en el ON CONFLICT existente en migrations); ajustar si la constraint requiere columnas adicionales.
- El routing por categoría regex de `insight_routing` (CLAUDE.md §Routing) NO aplica aquí — esa tabla rige `agent_insights`. `reconciliation_issues` se rige por `invariant_routing`.

### 6.5 Cron

```sql
SELECT cron.schedule(
  'comms_invariants_hourly',
  '25 * * * *',
  $$SELECT detect_comms_unanswered_external_thread();
    SELECT detect_comms_activity_overdue();$$
);
```

**Alternativa simpler:** agregar las dos llamadas a la función `silver_sp2_reconcile_hourly` existente (decisión en plan según contenido de esa función).

### 6.6 Indexes

Crear si no existen (verificar antes con `pg_indexes`):

```sql
CREATE INDEX IF NOT EXISTS idx_threads_company_id_last_activity
  ON threads (company_id, last_activity DESC);

CREATE INDEX IF NOT EXISTS idx_threads_unanswered_external
  ON threads (last_sender_type, hours_without_response)
  WHERE last_sender_type = 'external';

CREATE INDEX IF NOT EXISTS idx_emails_sender_contact_thread
  ON emails (sender_contact_id, thread_id)
  WHERE sender_contact_id IS NOT NULL AND thread_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_recon_issues_thread_metadata
  ON reconciliation_issues (issue_type, canonical_entity_type, canonical_entity_id, (metadata->>'thread_id'))
  WHERE issue_type = 'comms.unanswered_external_thread';

CREATE UNIQUE INDEX IF NOT EXISTS uq_recon_issues_activity_metadata
  ON reconciliation_issues (issue_type, canonical_entity_type, canonical_entity_id, (metadata->>'activity_id'))
  WHERE issue_type = 'comms.activity_overdue';
```

---

## 7. Errores, performance, seguridad

### 7.1 Error handling

| Capa | Falla | Comportamiento |
|---|---|---|
| RPC `comms_timeline` | DB error | Helper captura, log a console, retorna payload vacío. Tab muestra fallback ("No pudimos cargar comunicaciones, reintenta"). NO throw arriba del Server Component (cumple `feedback_server_component_top_level_throws.md`). |
| Helper `getCommsTimeline` | Zod parse falla | Log con shape recibido vs esperado. Retorna `{threads:[], total:0, hasMore:false}`. |
| Detect funcs | Excepción | Log a `audit_runs` + RAISE. El cron orchestrator captura y no tira otros invariants. |
| Drawer | RPC falla | Skeleton timeout 5s, fallback "No se cargaron mensajes, reintenta o abre en Gmail". |
| Empty state | total = 0 | `<CommsEmptyState>` orientativo, no skeleton. |

### 7.2 Performance

- Query budget: RPC `comms_timeline` < 200ms p95 con threads = 50k.
- Cache: `unstable_cache` 60s en helper. Sin invalidación por mutation (timeline es read-only).
- Cron load: 50k threads scan + 184k canonical_activities scan = trivial. Hourly OK.
- Indexes nuevos cubren ambos accesos (company_id timeline, last_sender_type detection).

### 7.3 Seguridad

- RPCs públicas (`comms_timeline`, `comms_thread_messages`):
  - `SECURITY INVOKER`, `search_path` pinned.
  - Frontend usa `getServiceClient()` con service_key — bypassea RLS por diseño (consistente con CLAUDE.md §RLS posture).
  - GRANT a `authenticated, service_role`. NO `anon`.
- Detect funcs (`detect_comms_*`):
  - `SECURITY DEFINER` necesario (escriben a `reconciliation_issues` desde cron).
  - `search_path` pinned.
  - Owner = `postgres`.
- No expone bodies de emails internos a usuarios externos: el frontend está detrás de `AUTH_PASSWORD` (single-tenant CEO), y el filtro default `scope=external` ofrece protección visual razonable. El drawer respeta el scope al filtrar emails del thread por `sender_type`.

### 7.4 Rollout

**Estrategia:** straight to main, sin feature flag.

1. Migration Supabase → review en Supabase Studio → apply via MCP `apply_migration` (nombre: `2026_04_29_comms_layer_mvp`).
2. Frontend PR a `main` → Vercel preview → smoke manual del tab en 3 empresas (1 con muchas comms, 1 sin comms, 1 con respuesta pendiente).
3. Merge a main → Vercel auto-deploys.
4. Monitor 24h:
   - `audit_runs` para errores en cron.
   - Logs de RPC tail (Supabase).
   - SQL ad-hoc: `SELECT issue_type, COUNT(*) FROM reconciliation_issues WHERE issue_type LIKE 'comms.%' AND resolved_at IS NULL GROUP BY 1`.
   - Verificar que `gold_ceo_inbox` muestre los nuevos issue_types.

**Rollback:** si algo se rompe:
- Frontend: revert PR.
- Supabase: `DROP FUNCTION` + `DELETE FROM reconciliation_issues WHERE issue_type LIKE 'comms.%'` + `DELETE FROM invariant_routing WHERE issue_type LIKE 'comms.%'` + `SELECT cron.unschedule('comms_invariants_hourly')`.

---

## 8. Tests

### Frontend
- `lib/queries/comms/timeline.test.ts` — mock RPC, valida shape Zod, valida scope filter, valida throw-safe.
- `components/comms/CommsThreadCard.test.tsx` — render con cada severity, badge correcto.
- `components/comms/CommsEmptyState.test.tsx` — texto contextual por entityType.

### Backend
- `tests/comms_timeline_rpc.sql` — seed 5 threads (mix scopes, mix sender_type), llama `comms_timeline('company', X, ...)`, verifica order/filter/pagination/severity.
- `tests/comms_invariants.sql` — seed 1 thread external 72h sin respuesta, run `detect_comms_unanswered_external_thread()`, verifica row en `reconciliation_issues`. Flip `last_sender_type` a internal, re-run, verifica `resolved_at IS NOT NULL`.

### Smoke E2E
- Diferido. SP6-DoD requiere `npm run build` + `tsc --noEmit` verdes; smoke manual cubre el resto en MVP.

---

## 9. Definition of Done

- [ ] Migration aplicada a prod: RPCs, 2 detect funcs, 2 invariant_routing rows, cron, indexes.
- [ ] `npm run build` verde (con `--max-old-space-size=8192`).
- [ ] `tsc --noEmit` verde.
- [ ] Tests verdes: 3 frontend + 2 SQL.
- [ ] Smoke manual:
  - Tab `Comunicaciones` visible en `/empresas/[id]` y `/contactos/[id]`.
  - 1 empresa con threads → timeline poblado, severity correcta, drawer abre.
  - 1 empresa sin threads → empty state.
  - Toggle scope cambia URL y resultados.
  - Click "Abrir en Gmail" abre nueva pestaña con URL correcta.
- [ ] Cron run manual: `SELECT detect_comms_unanswered_external_thread()` → `n > 0`. Verificar issues en `gold_ceo_inbox`.
- [ ] 24h post-deploy: 0 errores en `audit_runs` para `comms_*`. Issues count razonable (no flood de >500 unanswered_external).
- [ ] Spec doc commited (este archivo).
- [ ] Plan en `docs/superpowers/plans/2026-04-29-comms-layer-mvp-plan.md` (próximo paso).

---

## 10. Sub-proyectos siguientes (NO en este spec)

Cuando este MVP esté en main, los siguientes incrementos lógicos son:

- **SP14.1 — mail.message + canonical_communications.** Push de `mail.message` desde el addon. Pushear `phone`/`mobile`. Crear `canonical_communications` Pattern B unificando emails + activities + messages.
- **SP14.2 — Outbound.** Compose UI, send vía Resend/Gmail API, audit log, scheduling, templates.
- **SP14.3 — AI features.** Draft suggestions con `emails.embedding`. Auto-categorize. Extract actionables → `action_items`.
- **SP14.4 — Dashboard CEO global.** Página top-level `/comunicaciones` con métricas agregadas, slow_responder por vendedor, stale_relationship por empresa con saldo abierto.

Cada uno merece spec propio.
