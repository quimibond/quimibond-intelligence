# SP6-03 `/cobranza` Redesign — Design Spec

**Fecha:** 2026-04-22
**Branch:** `sp6-03-cobranza` (cortada desde `main@52999a6`, post SP6-02 merged PR #54).
**Estado:** Draft — aprobado vía brainstorming, pendiente user review.
**Sub-spec de:** SP6 foundation. 3 de 7 páginas.

---

## 1. Contexto

Post SP6-01 y SP6-02 (ambos merged), patrones confirmados: foundation primitives + zod URL state + cards-mobile/table-desktop + scroll con SectionNav. `/cobranza` (1528 líneas) es la siguiente página de alto impacto: dashboard CEO para AR — "¿quién me debe, cuánto, quién va a pagar mal?".

El objetivo es rediseñar las 6 secciones conservando estructura (SectionNav), reemplazando componentes internos con foundation primitives, agregando AgingBuckets clickable que filtra la tabla de Facturas Vencidas vía URL state.

Todas las sources (ar_aging_detail, cash_flow_aging, payment_predictions, collection_effectiveness_index, canonical_invoices) están en la KEEP list de §12 — sin legacy MVs que remover.

---

## 2. Decisiones arquitectónicas (del brainstorming)

| # | Decisión | Alternativas descartadas |
|---|---|---|
| D1 | **Rewrite completo de las 6 secciones.** Todas consumen sources KEEP. | Core 3+deferir · Core 4+top debtors |
| D2 | **AgingBuckets clickable** filtra tabla de Facturas Vencidas (§6) vía URL state `?aging=X`. Workflow CEO cohesivo. | Solo visualización sin click |

---

## 3. Alcance

### 3.1 Qué hace sp6-03

Rediseñar las 6 secciones de `/cobranza` con foundation primitives, preservando SectionNav como backbone de navegación:

1. **Resumen KPIs (§1)** — `StatGrid` + 4 `KpiCard`: AR total, vencida, 90+ días, DSO. Helper nuevo `fetchCobranzaKpis()` si no existe uno directo.
2. **CEI (§2)** — `Chart type="bar"` horizontal con cohorts + `StatusBadge kind="severity"` según `health_status`. Existing `getCollectionEffectivenessIndex()`.
3. **Aging buckets (§3)** — `<AgingBuckets>` foundation primitive con `onBucketClick` que hace `router.push(?aging=BUCKET)`. Adapter desde `getArAging()` (hyphen keys) a shape del componente (`d1_30` etc).
4. **Riesgo de pago (§4)** — Cards con `StatusBadge` severity + checkbox selection → `BatchActionBar`. `payment-risk-batch-actions.tsx` existente **preservado sin cambios**.
5. **Cartera por cliente (§5)** — Card list con mini `<AgingBuckets>` por cliente (cartera bar compacta) + link a `/empresas/[id]`. Helper `getCompanyAgingPage()`.
6. **Facturas vencidas (§6)** — Card list con filtros: chip aging removible (sincronizado con `?aging=`), search debounced, salesperson dropdown. Helper `getOverdueInvoicesPage()`.

### 3.2 Qué NO hace

- **No cambios** a helpers en `src/lib/queries/*` excepto agregar `fetchCobranzaKpis` si el KPI shape necesario no existe en helpers actuales.
- **No toca** `payment-risk-batch-actions.tsx` — componente existente con `navigator.clipboard` se reusa.
- **No tocar** páginas fuera de `/cobranza`.
- **No** real-time subscriptions, bulk email sending, CEI deep-dive breakdown.

---

## 4. Archivos en scope

| Archivo | Acción |
|---|---|
| `src/app/cobranza/page.tsx` | Rewrite (1528→~200 líneas, orquestador de secciones) |
| `src/app/cobranza/_components/CobranzaHeroKpis.tsx` | Create |
| `src/app/cobranza/_components/CeiSection.tsx` | Create |
| `src/app/cobranza/_components/AgingSection.tsx` | Create (Client wrapper — router.push on bucket click) |
| `src/app/cobranza/_components/PaymentRiskSection.tsx` | Create (Server data + Client select state) |
| `src/app/cobranza/_components/CompanyAgingSection.tsx` | Create |
| `src/app/cobranza/_components/OverdueSection.tsx` | Create (Server data + Client OverdueFilterBar) |
| `src/app/cobranza/_components/OverdueFilterBar.tsx` | Create |
| `src/app/cobranza/_components/payment-risk-batch-actions.tsx` | **Untouched** |
| `src/lib/queries/unified/invoices.ts` (or `analytics/index.ts`) | Edit — append `fetchCobranzaKpis` if needed |
| `src/__tests__/cobranza/kpis-section.test.tsx` | Create |
| `src/__tests__/cobranza/cei-section.test.tsx` | Create |
| `src/__tests__/cobranza/aging-section.test.tsx` | Create |
| `src/__tests__/cobranza/payment-risk-section.test.tsx` | Create |
| `src/__tests__/cobranza/company-aging-section.test.tsx` | Create |
| `src/__tests__/cobranza/overdue-filter-bar.test.tsx` | Create |
| `src/__tests__/cobranza/page.test.tsx` | Create (integration) |
| `src/__tests__/patterns/axe-a11y.test.tsx` | Extend (+2 `it` blocks) |

---

## 5. URL state schema

```typescript
const searchSchema = z.object({
  aging:       z.enum(["current", "1-30", "31-60", "61-90", "90+"]).optional().catch(undefined),
  q:           z.string().trim().max(100).catch(""),
  salesperson: z.coerce.number().int().optional().catch(undefined),
  page:        z.coerce.number().int().min(1).catch(1),  // overdue
  prPage:      z.coerce.number().int().min(1).catch(1),  // payment risk
  caPage:      z.coerce.number().int().min(1).catch(1),  // company aging
  limit:       z.coerce.number().int().min(10).max(200).catch(50),
});
```

Link ejemplo: `/cobranza?aging=31-60&q=contitech&salesperson=5`.

---

## 6. Architecture / flow

### 6.1 Server Component tree

```
CobranzaPage (Server) — reads searchParams, dispatches 6 Suspense boundaries
├── Hero KPIs (Server, Suspense)
├── CEI section (Server, Suspense)
├── Aging section (Server data + Client AgingSection wrapper for onBucketClick)
├── Payment Risk (Server data + Client select state + preserved BatchActionBar)
├── Company Aging (Server, Suspense)
└── Overdue (Server data + Client OverdueFilterBar + aging chip)
```

### 6.2 AgingSection (Client wrapper)

```tsx
"use client";
import { useRouter, usePathname } from "next/navigation";
import { AgingBuckets, type AgingBucketKey, type AgingData } from "@/components/patterns/aging-buckets";
import { toSearchString } from "@/lib/url-state";

// Map AgingBucketKey ("d1_30" etc) back to URL value ("1-30" etc)
const KEY_TO_URL: Record<AgingBucketKey, string> = {
  current: "current", d1_30: "1-30", d31_60: "31-60", d61_90: "61-90", d90_plus: "90+",
};

export function AgingSection({ data, currentAging }: { data: AgingData; currentAging?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <AgingBuckets
      data={data}
      ariaLabel="Aging de cartera"
      onBucketClick={(bucket) => {
        const urlValue = KEY_TO_URL[bucket];
        const next = currentAging === urlValue ? undefined : urlValue;
        const qs = toSearchString({ aging: next }, { dropEqual: {} });
        router.push(`${pathname}${qs}#overdue`);
      }}
    />
  );
}
```

### 6.3 OverdueFilterBar (Client)

Renderiza 3 controls: aging chip removible (si `params.aging` set), search input debounced, salesperson `<Select>`. On change → `router.push` con nuevos params preservando los demás.

### 6.4 Aging data adapter

`getArAging()` retorna `{ current, "1-30", "31-60", "61-90", "90+" }`. Adaptar a `{ current, d1_30, d31_60, d61_90, d90_plus }` que espera `<AgingBuckets>`:

```typescript
function adaptAging(b: Record<string, number>): AgingData {
  return {
    current: b.current ?? 0,
    d1_30: b["1-30"] ?? 0,
    d31_60: b["31-60"] ?? 0,
    d61_90: b["61-90"] ?? 0,
    d90_plus: b["90+"] ?? 0,
  };
}
```

### 6.5 Overdue filter → server

`getOverdueInvoicesPage()` ya soporta filtros. Verificar al implementar si tiene parámetro `agingBucket` — si no, agregarlo (mínimo, 1 param + `where` clause). El implementer debe primero leer el helper para confirmar signature antes de escribir código que asuma.

---

## 7. Testing strategy

### 7.1 Vitest component (6 section tests)

- `kpis-section.test.tsx` — 4 KPIs renderizan con format MXN, overdue > 0 triggers red color class.
- `cei-section.test.tsx` — último cohort percentage + StatusBadge severity mapping (good → ok, warning → warning, critical → critical).
- `aging-section.test.tsx` — AgingBuckets renderiza, click dispara router.push con nuevo `?aging=X` en la URL.
- `payment-risk-section.test.tsx` — N cards render, checkbox state management, BatchActionBar aparece on selection.
- `company-aging-section.test.tsx` — cards render con mini aging bars + correct links to `/empresas/[id]`.
- `overdue-filter-bar.test.tsx` — aging chip cierra (onClick ✕), search debounced, salesperson dropdown.

### 7.2 Vitest integration

- `page.test.tsx` — Server Component parsea searchParams, pasa `?aging=31-60` a `getOverdueInvoicesPage`. Invalid aging → catch undefined. Mock each helper.

### 7.3 axe-core extension

Append 2 `it` blocks a `src/__tests__/patterns/axe-a11y.test.tsx`:
- `AgingSection` rendered (checks clickable bars don't violate a11y).
- `OverdueSection` rendered populated.

Cada uno: 0 critical violations.

---

## 8. Definition of Done (12 gates)

1. `/cobranza` mantiene las 6 secciones (grep section ids in rewritten page = 6).
2. URL state zod schema working; `?aging=31-60` preserva filtro y se sincroniza con chip removible.
3. Hero KPIs via `<StatGrid>` + 4 `<KpiCard>`.
4. CEI section con `<Chart type="bar">` + `<StatusBadge kind="severity">` según health.
5. `<AgingBuckets>` clickable → `router.push(?aging=X)` con scroll-anchor `#overdue`.
6. Payment Risk section: cards + `BatchActionBar` preservado.
7. Company Aging section: cards con mini-aging bar + link `/empresas/[id]`.
8. Overdue section: cards + `<OverdueFilterBar>` (aging chip + search debounced + salesperson).
9. Suspense boundary por sección (streaming independiente).
10. Mobile-first: SectionNav horizontal scroll en mobile, tap targets ≥44px.
11. Vitest: ≥7 new tests passing; axe: 0 critical violations on 2 new blocks.
12. Build compiles (allowing known `/equipo` prerender).

---

## 9. Non-goals (explicit)

- Cambios a `payment-risk-batch-actions.tsx` (preservar).
- Cambios a helpers existentes en `queries/` excepto agregar `fetchCobranzaKpis` si es necesario.
- Cambios a páginas fuera de `/cobranza`.
- Real-time subscriptions / bulk email sending / CEI cohort-by-customer deep-dive.
- Nuevos componentes en `src/components/patterns/` (foundation estable).

---

## 10. Branch / PR flow

- Branch: `sp6-03-cobranza` (ya cortada desde `main@52999a6`).
- Commits atómicos por sección.
- PR único **"SP6-03 /cobranza redesign — foundation primitives + click-to-filter aging"**.
- User mergea manualmente.

---

## 11. Referencias

- Foundation spec: `docs/superpowers/specs/2026-04-22-frontend-revamp-sp6-foundation-design.md`.
- sp6-01 /inbox: `docs/superpowers/specs/2026-04-22-sp6-01-inbox-design.md`.
- sp6-02 /empresas: `docs/superpowers/specs/2026-04-22-sp6-02-empresas-design.md`.
- Helpers existentes: `src/lib/queries/unified/invoices.ts` (getArAging, getCompanyAgingPage, getOverdueInvoicesPage, getPaymentPredictionsPage), `src/lib/queries/analytics/index.ts` (getCollectionEffectivenessIndex).
- Foundation primitives: `AgingBuckets`, `Chart`, `StatusBadge`, `StatGrid`, `KpiCard`, `SectionNav`, `BatchActionBar`.
