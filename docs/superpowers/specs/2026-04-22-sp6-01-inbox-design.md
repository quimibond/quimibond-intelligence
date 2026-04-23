# SP6-01 `/inbox` Redesign — Design Spec

**Fecha:** 2026-04-22
**Branch:** `sp6-01-inbox` (cortada desde `main@c989f98`, post foundation SP6 PR #52)
**Estado:** Draft — aprobado vía brainstorming, pendiente review del spec escrito
**Sub-spec de:** SP6 foundation (`docs/superpowers/specs/2026-04-22-frontend-revamp-sp6-foundation-design.md`). 1 de 7 páginas.

---

## 1. Contexto

Post-foundation (PR #52), `src/components/patterns/` ya tiene los primitives canónicos: `InboxCard`, `SwipeStack`, `StatusBadge (kind+value+density)`, `TrendSpark`, `AgingBuckets`, `CompanyKpiHero`, `Chart`. Tokens traffic-light y `CHART_PALETTE` semánticos en `globals.css`. URL state helpers con zod en `src/lib/url-state.ts`.

El `/inbox` actual mezcla dos feeds (`agent_insights` + `gold_ceo_inbox`), usa el `SeverityBadge` legacy (ahora shim), y no expone la riqueza de `gold_ceo_inbox` (priority_score, impact_mxn, action_cta, assignee) ni la capa de evidencia (email_signals, ai_extracted_facts, manual_notes, attachments).

El objetivo de SP6-01 es rediseñar `/inbox` y `/inbox/insight/[id]` (UUID branch) para que el CEO procese alertas fiscales/operativas accionables desde su iPhone, con flujo mobile-primario y paridad desktop.

---

## 2. Decisiones arquitectónicas (del brainstorming)

| # | Decisión | Alternativas descartadas |
|---|---|---|
| D1 | **Feed único: `gold_ceo_inbox`** en `/inbox`. `agent_insights` sale de esta página (sigue vivo en `/`, `/equipo`, APIs y `/directores`). | Dos feeds en tabs · Feed merged unificado |
| D2 | **Lista plana ordenada por `priority_score DESC`**, filtros sutiles en header (severity chips + assignee dropdown + search). | Grupos por entity_type · Tabs temporales (hoy/semana/mes) |
| D3 | **Detail single-scroll** con sticky bottom action bar (mobile) / sticky sidebar (desktop). | Tabs shadcn · Sticky top action bar |
| D4 | **Sin bulk actions** v1 — YAGNI. | Checkboxes + BatchActionBar |
| D5 | **Mantener bifurcación UUID vs numeric** en `/inbox/insight/[id]`. El rediseño solo toca el path UUID. | Separar rutas `/insights/[id]` |
| D6 | **Sin side panel desktop** v1 — click en card navega a `/inbox/insight/[id]` tanto mobile como desktop. | Side panel split + selected-id URL state |

---

## 3. Alcance

### 3.1 Qué hace sp6-01

1. **Rewrite `/inbox`** → Server Component lee `searchParams` via zod schema, llama `listInbox()`, adapta rows a `InboxCardIssue`, pasa a Client Component con filter bar + list.
2. **Rewrite detail UUID branch** de `/inbox/insight/[id]` → header + merged evidence timeline + attachments + notes form + sticky action bar (mobile) / sticky sidebar (desktop). Acciones: resolve / assign / operationalize / link_manual via API routes existentes. Add-note via server action.
3. **Nuevos componentes de page** (no patterns — específicos a inbox): `InboxFilterBar`, `InboxListClient`, `IssueDetailClient`, `EvidenceSection`, `AttachmentsSection`, `NotesSection`.
4. **Adapter helper:** `src/lib/queries/intelligence/inbox-adapter.ts` extrayendo `adaptInboxRow()` del `/showcase` para reutilizarlo aquí.
5. **Server action:** `addManualNote()` en `src/app/inbox/actions.ts` — insert en `manual_notes` + `revalidatePath("/inbox/insight/...")`.
6. **Vitest + axe-core** tests para cada componente nuevo + page/detail integration.

### 3.2 Qué NO hace sp6-01

- **No rediseñar el numeric-id branch del detail** (`agent_insights`) — legacy intacto hasta una sub-spec futura que rediseñe `/` o `/equipo`.
- **No tocar** `src/lib/queries/intelligence/inbox.ts` (ya correcto post-SP5) ni las API routes `/api/inbox/*` (existen desde SP5 Task 20).
- **No tocar** páginas fuera de scope: `/`, `/equipo`, `/directores`, `/empresas`, `/cobranza`, `/finanzas`, `/ventas`, `/productos`, `/operaciones`, `/compras`, `/contactos`, `/briefings`, `/chat`, `/profile`, `/sistema`. Los agentes siguen escribiendo a `agent_insights` sin cambios.
- **No implementar** bulk actions, desktop side-panel split, real-time subscriptions, offline mode.
- **No introducir** librerías UI nuevas. Si `sonner` está instalado úsalo; si no, toast pattern existente del proyecto o `<Alert>` inline.
- **No cambiar** la capa de patterns/ (foundation ya es estable).

---

## 4. Archivos en scope

| Archivo | Acción | Descripción |
|---|---|---|
| `src/app/inbox/page.tsx` | Rewrite | Server Component — parseSearchParams + listInbox + adapta + render InboxListClient |
| `src/app/inbox/_components/InboxListClient.tsx` | Create | Client — recibe lista adaptada + counts, renderiza SwipeStack(mobile)/lista(desktop) |
| `src/app/inbox/_components/InboxFilterBar.tsx` | Create | Client — severity chips toggle, assignee Select shadcn, search Input debounced |
| `src/app/inbox/insight/[id]/page.tsx` | Edit | Sustituir body del UUID branch por IssueDetailClient; numeric branch intacto |
| `src/app/inbox/insight/[id]/_components/IssueDetailClient.tsx` | Create | Client — renderiza header + sections + sticky action bar / sidebar |
| `src/app/inbox/insight/[id]/_components/EvidenceSection.tsx` | Create | Merged email_signals + ai_extracted_facts ordenados por fecha, cap-25 + ver-más |
| `src/app/inbox/insight/[id]/_components/AttachmentsSection.tsx` | Create | Lista attachments con icons |
| `src/app/inbox/insight/[id]/_components/NotesSection.tsx` | Create | Lista manual_notes + form agregar |
| `src/app/inbox/insight/[id]/_components/insight-actions.tsx` | Inspect + keep-or-remove | **First step of implementation:** grep consumers. Current imports: `page.tsx` imports `InsightActions`. Decision rule: if the numeric branch of `page.tsx` still renders `<InsightActions>` after the UUID branch is rewritten to `<IssueDetailClient>`, keep `insight-actions.tsx` intact (legacy). If the numeric branch does not render it (only UUID branch did), delete the file and remove the import. Never touch the component itself; replacement for the UUID branch is `<IssueDetailClient>`. |
| `src/app/inbox/actions.ts` | Edit | Agregar server action `addManualNote()` |
| `src/lib/queries/intelligence/inbox-adapter.ts` | Create | `adaptInboxRow(row: InboxRow): InboxCardIssue` extraído de showcase |
| `src/__tests__/inbox/page.test.tsx` | Create | Server-side filter parsing + render |
| `src/__tests__/inbox/filter-bar.test.tsx` | Create | Chips toggle, assignee dropdown, debounced search |
| `src/__tests__/inbox/evidence-section.test.tsx` | Create | Merge + sort + cap behavior |
| `src/__tests__/inbox/issue-detail-client.test.tsx` | Create | Action handlers call correct API, sticky bar renders |
| `src/__tests__/inbox/notes-form.test.tsx` | Create | Form calls server action on submit |
| `src/__tests__/patterns/axe-a11y.test.tsx` | Extend | 1 nuevo `it` con render de IssueDetailClient full |

---

## 5. URL state schema

En `src/app/inbox/page.tsx`:

```typescript
import { z } from "zod";
import { parseSearchParams } from "@/lib/url-state";

const searchSchema = z.object({
  severity: z.enum(["critical", "high", "medium", "low"]).optional().catch(undefined),
  entity:   z.enum(["invoice", "payment", "company", "contact", "product"]).optional().catch(undefined),
  assignee: z.coerce.number().int().optional().catch(undefined),
  q:        z.string().trim().max(100).catch(""),
  limit:    z.coerce.number().int().min(10).max(200).catch(50),
});

export default async function InboxPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const params = parseSearchParams(raw, searchSchema);
  // ...
}
```

Link compartible: `/inbox?severity=critical&assignee=5&q=contitech&limit=100`.

---

## 6. Listado `/inbox`

### 6.1 Server → Client data flow

1. Server lee `searchParams` + parsea con zod.
2. Llama `listInbox({ severity, canonicalEntityType: entity, assigneeCanonicalContactId: assignee, limit })`.
3. Si `q`, filtra rows en memoria por `description.toLowerCase().includes(q.toLowerCase())`. *TODO sp6-01.1:* mover a DB-side cuando el helper lo soporte.
4. Calcula counts por severity de los rows retornados (para chips).
5. Extrae `assigneeOptions = unique(row.assignee_name) + "Sin asignar" + "Todos"`.
6. Adapta rows via `adaptInboxRow()` a `InboxCardIssue[]`.
7. Renderiza `<InboxFilterBar params={params} counts={counts} assigneeOptions={...} />` + `<InboxListClient items={adapted} params={params} />`.

### 6.2 InboxFilterBar

- 4 severity chips (critical/high/medium/low) con count. Click toggle. Chip activo con `data-active` + `StatusBadge kind="severity"` density regular. Chip inactivo outline muted.
- Assignee `<Select>` shadcn — trigger = "Asignado: Todos" o el nombre. Mobile: Sheet variant.
- Search `<Input>` debounced 300ms → `router.push` con nuevo `q`.
- "Limpiar" button aparece cuando ≥1 filter activo.
- Tap targets ≥44px.

### 6.3 InboxListClient

Props: `items: InboxCardIssue[]`, `params: { severity, ... }`.

**Mobile (<lg):**

```tsx
<SwipeStack ariaLabel="Alertas priorizadas">
  {items.map((issue) => (
    <Link key={issue.issue_id} href={`/inbox/insight/${issue.issue_id}`}>
      <InboxCard issue={issue} onAction={handleInlineCta} />
    </Link>
  ))}
</SwipeStack>
```

`handleInlineCta` dispara el action_cta desde la card sin navegar (ej. Operacionalizar) — para issues donde el CEO no necesita ver evidencia antes.

**Desktop (≥lg):**

```tsx
<div className="grid gap-3">
  {items.map((issue) => <Link key={...}><InboxCard issue={issue} /></Link>)}
</div>
```

Mismo flow, layout grid sin snap.

### 6.4 Empty / Loading / Error

- `<Suspense fallback={<LoadingList />}>` envolviendo el componente que hace la query. Header + filter bar renderizan instantáneo.
- Empty sin data: `<EmptyState icon={Inbox} title="Sin alertas pendientes" description="Todo está al día." />` con link a `/cobranza`.
- Empty con filtros: `<EmptyState title="Sin resultados" action={<Button onClick={clearFilters}>Limpiar filtros</Button>} />`.
- Error: el `src/app/inbox/error.tsx` existente se mantiene; verificar que use shadcn `<Alert variant="destructive">` + botón retry.

---

## 7. Detail `/inbox/insight/[id]` (UUID branch)

### 7.1 Server flow

```typescript
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function InsightDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (!UUID_RE.test(id)) {
    // Legacy path — render the numeric branch untouched.
    return renderNumericInsight(id);
  }

  const item = await fetchInboxItem(id);
  if (!item) notFound();

  return <IssueDetailClient item={item} />;
}
```

### 7.2 IssueDetailClient

Props: `item: InboxRow & { email_signals, ai_extracted_facts, manual_notes, attachments }`.

Sections:
- **Header:** `<StatusBadge kind="severity" density="regular">` + descripción + meta row (priority + age + impact) + entidad link + assignee.
- **Evidencia:** `<EvidenceSection signals={item.email_signals} facts={item.ai_extracted_facts} />` — merges & sorts.
- **Archivos:** `<AttachmentsSection items={item.attachments} />`.
- **Notas:** `<NotesSection notes={item.manual_notes} entityType={...} entityId={...} />` con form.

**Mobile bottom action bar** (sticky):

```tsx
<div className="fixed bottom-0 inset-x-0 bg-background/95 backdrop-blur border-t p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
  <div className="flex gap-2 max-w-screen-md mx-auto">
    <Button className="flex-1 min-h-[44px]" onClick={handlePrimary}>{primaryLabel}</Button>
    <Button variant="outline" className="min-h-[44px]" onClick={handleAssign}>Asignar</Button>
    <Button variant="ghost" size="icon" aria-label="Más acciones" onClick={openBottomSheet}><MoreHorizontal /></Button>
  </div>
</div>
```

Parent page lleva `pb-24` para clearance del sticky bar.

**Desktop sidebar** (sticky):

```tsx
<aside className="hidden lg:block lg:col-span-1 sticky top-4 self-start space-y-4">
  <div className="rounded-lg border bg-card p-4 space-y-3">
    <MetricRow label="Severidad" value={<StatusBadge kind="severity" value={item.severity!} />} />
    <MetricRow label="Prioridad" value={Math.round(item.priority_score ?? 0)} />
    <MetricRow label="Impacto" value={formatMxn(item.impact_mxn)} />
    <MetricRow label="Edad" value={`${item.age_days}d`} />
    <MetricRow label="Asignado" value={item.assignee_name ?? "—"} />
  </div>
  <div className="flex flex-col gap-2">
    <Button onClick={handlePrimary}>{primaryLabel}</Button>
    <Button variant="outline" onClick={handleAssign}>Asignar</Button>
    <Button variant="outline" onClick={handleOperationalize}>Operacionalizar</Button>
    <Button variant="outline" onClick={handleLinkManual}>Ligar manual</Button>
  </div>
</aside>
```

### 7.3 Primary action resolution

`action_cta` del issue mapea al botón primario:

```typescript
const CTA_MAP = {
  operationalize: { label: "Operacionalizar", api: "/api/inbox/action/operationalize" },
  confirm_cancel: { label: "Confirmar cancelación", api: "/api/inbox/resolve" },
  link_manual:    { label: "Ligar manual", api: "/api/inbox/action/link_manual" },
  resolve:        { label: "Resolver", api: "/api/inbox/resolve" },
};
```

Si `action_cta` es `null`, primary button = "Resolver" → `/api/inbox/resolve`.

### 7.4 Action handler pattern

```tsx
"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";

function useIssueAction(issue_id: string) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return {
    isPending,
    resolve: (note?: string) => startTransition(async () => {
      const res = await fetch("/api/inbox/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issue_id, resolution: "manual", note }),
      });
      if (!res.ok) return onError("No se pudo resolver");
      onSuccess("Issue resuelto");
      router.push("/inbox");
    }),
    // assign, operationalize, linkManual similar
  };
}
```

Toast integration: si el proyecto tiene `sonner` o un toast pattern existente, usarlo. Si no, simple `<Alert>` inline persistente 3s con state.

### 7.5 EvidenceSection merge

```typescript
interface EvidenceItem {
  kind: "email" | "fact";
  title: string;
  body: string;
  at: string; // ISO
  raw: EmailSignal | AiFact; // for extra rendering
}

function mergeEvidence(signals: EmailSignal[], facts: AiFact[]): EvidenceItem[] {
  const items: EvidenceItem[] = [
    ...signals.map((s) => ({
      kind: "email" as const,
      title: s.signal_type ?? "Señal de email",
      body: s.payload_text ?? "(sin texto)",
      at: s.signal_timestamp ?? s.created_at ?? new Date().toISOString(),
      raw: s,
    })),
    ...facts.map((f) => ({
      kind: "fact" as const,
      title: f.fact_type ?? "Hecho extraído",
      body: f.fact_text ?? "(sin texto)",
      at: f.extracted_at ?? f.created_at ?? new Date().toISOString(),
      raw: f,
    })),
  ];
  return items.sort((a, b) => (b.at > a.at ? 1 : -1));
}
```

Renderiza con `<EvidenceTimeline>` (componente patterns existente). Cap 25 visible + "Ver más" expande sin navegar.

### 7.6 NotesSection

- Lista notes ordenadas por `created_at DESC`.
- Form: `<Textarea placeholder="Agregar nota...">` + `<Button>Agregar</Button>`.
- Submit → server action `addManualNote({ canonical_entity_type, canonical_entity_id, body })` → inserta en `manual_notes` → `revalidatePath`.

Server action en `src/app/inbox/actions.ts`:

```typescript
"use server";
export async function addManualNote(input: {
  canonical_entity_type: string;
  canonical_entity_id: string;
  body: string;
}): Promise<{ ok: boolean; error?: string }> {
  const body = input.body.trim();
  if (!body) return { ok: false, error: "Nota vacía" };
  const sb = getServiceClient();
  const { error } = await sb.from("manual_notes").insert({
    canonical_entity_type: input.canonical_entity_type,
    canonical_entity_id: input.canonical_entity_id,
    body,
    note_type: "inbox_detail",
    created_by: "ceo", // TODO sp6-02+: get real user
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/inbox`);
  return { ok: true };
}
```

---

## 8. Testing strategy

### 8.1 Vitest component tests

- `InboxFilterBar` (filter-bar.test.tsx): renders 4 chips, clicking severity navigates with correct URL, assignee select + debounced search.
- `EvidenceSection` (evidence-section.test.tsx): merges streams, orders by date desc, caps at 25, "Ver más" expands.
- `IssueDetailClient` (issue-detail-client.test.tsx): renders header + sections + action bar; Resolve click triggers fetch to `/api/inbox/resolve` with correct body (mocked fetch via `vi.spyOn`).
- `NotesSection` (notes-form.test.tsx): form submit calls server action mock; empty body → error message shown.

### 8.2 Vitest page tests

- `page.test.tsx`: mocks `listInbox` returning 3 rows, verifies Server Component calls `listInbox` with parsed filters + passes adapted items to client.
- `insight-detail.test.tsx`: UUID branch calls `fetchInboxItem`, numeric branch renders legacy; notFound on invalid id.

### 8.3 axe-core

Extend `src/__tests__/patterns/axe-a11y.test.tsx` with one new `it` rendering `<IssueDetailClient item={fixtureIssue} />` inside a mock page wrapper — 0 critical violations.

---

## 9. Definition of Done (9 gates)

1. `/inbox` lee solo `gold_ceo_inbox`. Grep `agent_insights|getInsights|InsightRow` en `src/app/inbox/page.tsx` → **0 matches**.
2. URL state schema zod activo. Link `/inbox?severity=critical&assignee=5&q=test` re-hidrata filtros correctamente en Server Component.
3. `InboxFilterBar` funcional: chips toggle, assignee dropdown, search debounced 300ms. ≥44px tap targets.
4. Listado: `SwipeStack` mobile + grid desktop, Suspense con `LoadingList`, `<InboxCard>` renderiza con adapter.
5. Detail UUID branch: header + EvidenceSection + AttachmentsSection + NotesSection + sticky bottom bar (mobile) / sidebar (desktop). Acciones conectadas a API routes.
6. Add-note server action funcional: inserta en `manual_notes`, revalidatePath.
7. Vitest: 5+ nuevos tests passing. Existing suite (mapping, chart, etc.) aún verde.
8. axe-core en `<IssueDetailClient>`: 0 critical violations.
9. Build compila: `NODE_OPTIONS="--max-old-space-size=8192" npm run build`. Pre-existing `/equipo` prerender issue documentado y no introducido por esta PR.

---

## 10. Non-goals (explícitos)

- Rediseño del numeric-id branch del detail (agent_insights) — legacy intacto.
- Bulk actions / checkboxes / BatchActionBar — YAGNI v1.
- Desktop side-panel split — v1 usa flow mobile + desktop idéntico (click navega a detail).
- Real-time Supabase subscriptions en `/inbox` — v1 refresca en cada mount (dynamic = "force-dynamic").
- Cambios a `src/lib/queries/intelligence/inbox.ts` o `/api/inbox/*`.
- Cambios a cualquier página fuera de `/inbox` y `/inbox/insight/[id]` (UUID branch).
- Nuevas librerías UI o toast system. Usar lo existente o `<Alert>` inline.
- Nuevos componentes en `src/components/patterns/` — todo lo genérico ya está en foundation.

---

## 11. Branch / PR flow

- Branch: `sp6-01-inbox` (ya cortada desde `main@c989f98`).
- Commits atómicos por archivo/componente (`feat(sp6-01): add InboxFilterBar`, `refactor(sp6-01): rewrite /inbox page to single feed`, etc.).
- PR único **"SP6-01 /inbox redesign — single feed + evidence-first detail"** → mergea a `main` cuando 9/9 DoD gates pasan.
- User mergea manualmente vía `gh pr merge N --merge --delete-branch`.

---

## 12. Referencias

- Foundation spec: `docs/superpowers/specs/2026-04-22-frontend-revamp-sp6-foundation-design.md`.
- Foundation plan: `docs/superpowers/plans/2026-04-22-frontend-revamp-sp6-foundation.md`.
- Silver arquitectura §13.1 (inbox contract): `docs/superpowers/specs/2026-04-21-silver-architecture.md`.
- SP5 Task 20 (API routes de inbox): `docs/superpowers/plans/2026-04-21-silver-sp5-cutover-notes.md`.
- Helper existente: `src/lib/queries/intelligence/inbox.ts`.
- API routes existentes: `src/app/api/inbox/{top,resolve,assign,action/operationalize,action/link_manual}`.
