# SP6-02 `/empresas` Redesign — Design Spec

**Fecha:** 2026-04-22
**Branch:** `sp6-02-empresas` (cortada de `main@84855ef`, post SP6-01 /inbox merged as PR #53).
**Estado:** Draft — aprobado vía brainstorming, pendiente user review.
**Sub-spec de:** SP6 foundation. 2 de 7 páginas.

---

## 1. Contexto

Post-SP6-01 (PR #53 merged `84855ef`), foundation primitives estables y /inbox rediseñado. `/empresas` (list 871 líneas) + `/empresas/[id]` (detail con 6 tabs, 1714 líneas totales) son las siguientes páginas de alto impacto para el CEO — expone el portfolio completo de empresas con canonical/gold shape post-SP5.

Este sub-spec redesigna:
- **List page** con KPIs header + portfolio DataTable/Cards con filtros URL-state.
- **Detail page header** con `<CompanyKpiHero>` (foundation) arriba de los Tabs.
- **Tab picker** mobile-friendly (Select en mobile, Tabs horizontales en desktop).
- **Panorama tab** rewrite con `AgingBuckets` + revenue chart + recent activity.
- **Financiero tab** rewrite con `AgingBuckets` + P&L chart + cashflow snapshot.
- **4 tabs restantes** (Comercial, Operativo, Fiscal, Pagos) quedan intactos; solo heredan el nuevo header global.
- **`/empresas/at-risk` redirect** legacy → `/empresas` (fix rota-a-muerto).

Reactivación RFM queda diferida a `sp6-02.1`.

---

## 2. Decisiones arquitectónicas (del brainstorming)

| # | Decisión | Alternativas descartadas |
|---|---|---|
| D1 | **6 tabs preservados** con `<TabPicker>` adaptativo (Select mobile / Tabs desktop). | Consolidar a 4 · Single-scroll con SectionNav |
| D2 | **`/empresas/at-risk` redirect → `/empresas`** (sin anchor). | Borrar archivo · preservar anchor `#reactivacion` |
| D3 | **List page = Resumen KPIs + Portfolio.** Reactivación RFM diferida a sp6-02.1. | Rewrite completo 3 secciones · Portfolio minimal |
| D4 | **Rewrite: header (CompanyKpiHero) + Panorama + Financiero.** Otros 4 tabs intactos. | Rewrite 6 tabs · solo header + Panorama |

---

## 3. Alcance

### 3.1 Qué hace sp6-02

1. **`/empresas/page.tsx`** — rewrite (~871→~180 líneas):
   - `StatGrid` 2×2 mobile / 1×4 desktop con KPIs del portfolio (LTV total, count customers, count suppliers, count blacklist != none).
   - `CompanyFilterBar` — `type` chips (customer/supplier/all), blacklist dropdown, shadowOnly toggle, search, sort dropdown, clear.
   - `CompanyListClient` — DataTable desktop / MobileCard stack mobile. Row fields: display_name, rfc, ltv_mxn, revenue_ytd_mxn, overdue_amount_mxn, open_company_issues_count, blacklist `<StatusBadge>`, shadow `<StatusBadge>`.
   - URL state zod (spec §5).

2. **`/empresas/[id]/page.tsx`** — edit surgical:
   - Arriba del Tabs: render `<CompanyKpiHero>` con `canonical` + `gold_company_360` + trend 90d.
   - `<TabPicker>` adaptativo reemplaza los `<Tabs>` directos.
   - Los 6 tab components se mantienen; solo PanoramaTab + FinancieroTab se rewritean.

3. **`/empresas/at-risk/page.tsx`** — 1-line fix: `redirect("/companies#reactivacion")` → `redirect("/empresas")`.

4. **`PanoramaTab.tsx`** rewrite — reemplazar contenido con secciones no-redundantes vs CompanyKpiHero:
   - `<AgingBuckets>` (si canonical_invoices del company tiene cartera abierta).
   - `<Chart type="area">` revenue 12m — datos de `gold_revenue_monthly` filtrados por `canonical_company_id`.
   - Top 3 recent sale orders con links a /ventas.
   - Últimos 5 `email_signals` + `ai_extracted_facts` del entity — renderizado inline como lista simple (no reusar `EvidenceSection` de sp6-01 para evitar cross-feature import; los 5 items son suficientes sin cap-25 lógica).

5. **`FinancieroTab.tsx`** rewrite:
   - `<AgingBuckets>` de receivables por company.
   - `<Chart type="area">` P&L 12m (revenue + expenses 2 series).
   - MetricRow grid de cashflow snapshot (AR total, AP total, working capital, DSO si disponible).

6. **Nuevos componentes page-local:**
   - `CompanyFilterBar.tsx`
   - `CompanyListClient.tsx`
   - `TabPicker.tsx` (Select on mobile, Tabs on desktop)

7. **Nuevo helper:** `fetchPortfolioKpis()` en `src/lib/queries/_shared/companies.ts` o módulo separado — agregaciones portfolio-level sobre `gold_company_360` sin filtros (KPIs del header son totales, no filtrados).

8. **Nuevo helper (opcional):** `fetchCompanyRevenueTrend(canonical_company_id: number, months: number = 12)` — query sobre `gold_revenue_monthly` para el sparkline del hero y el chart del Panorama/Financiero.

9. **Vitest + axe** tests.

### 3.2 Qué NO hace

- **No rewrite** Comercial, Operativo, Fiscal, Pagos tabs — sub-specs futuros `sp6-02.1..4`.
- **No** RFM Reactivación section → sub-spec futuro `sp6-02.1`.
- **No** cambios a query layer más allá de (1) añadir `fetchPortfolioKpis` y (2) opcional `fetchCompanyRevenueTrend`. `listCompanies` / `fetchCompanyById` / `fetchCompany360` se usan as-is si soportan el shape; si no, extensión mínima documentada en el plan.
- **No** tocar páginas fuera de `/empresas`.
- **No** desktop side-panel split ni bulk actions.
- **No** nuevas librerías UI o toast system nuevo (sonner ya instalado post-sp6-01).
- **No** cambios a `src/components/patterns/*` — foundation estable.

---

## 4. Archivos en scope

| Archivo | Acción |
|---|---|
| `src/app/empresas/page.tsx` | Rewrite (871→~180 líneas estimadas) |
| `src/app/empresas/_components/CompanyFilterBar.tsx` | Create |
| `src/app/empresas/_components/CompanyListClient.tsx` | Create |
| `src/app/empresas/at-risk/page.tsx` | Edit (1-line redirect fix) |
| `src/app/empresas/[id]/page.tsx` | Edit (add CompanyKpiHero + TabPicker) |
| `src/app/empresas/[id]/_components/TabPicker.tsx` | Create |
| `src/app/empresas/[id]/_components/PanoramaTab.tsx` | Rewrite |
| `src/app/empresas/[id]/_components/FinancieroTab.tsx` | Rewrite |
| `ComercialTab`, `OperativoTab`, `FiscalTab`, `PagosTab` | **Untouched** (legacy, shims transparentes) |
| `src/lib/queries/_shared/companies.ts` | Edit — append `fetchPortfolioKpis` (+ optional `fetchCompanyRevenueTrend`) |
| `src/__tests__/empresas/filter-bar.test.tsx` | Create |
| `src/__tests__/empresas/list-client.test.tsx` | Create |
| `src/__tests__/empresas/page.test.tsx` | Create |
| `src/__tests__/empresas/tab-picker.test.tsx` | Create |
| `src/__tests__/empresas/panorama-tab.test.tsx` | Create |
| `src/__tests__/empresas/financiero-tab.test.tsx` | Create |
| `src/__tests__/empresas/detail-page.test.tsx` | Create |
| `src/__tests__/patterns/axe-a11y.test.tsx` | Extend (+2 `it` blocks) |

---

## 5. URL state schemas

### List page (`/empresas`):

```typescript
const searchSchema = z.object({
  q:          z.string().trim().max(100).catch(""),
  type:       z.enum(["customer", "supplier", "all"]).catch("all"),
  blacklist:  z.enum(["none", "any", "69b_presunto", "69b_definitivo"]).catch("any"),
  shadowOnly: z.coerce.boolean().catch(false),
  sort: z.enum([
    "-ltv_mxn",
    "-revenue_ytd_mxn",
    "-overdue_amount_mxn",
    "-open_company_issues_count",
    "display_name",
  ]).catch("-ltv_mxn"),
  page:  z.coerce.number().int().min(1).catch(1),
  limit: z.coerce.number().int().min(10).max(200).catch(50),
});
```

Link ejemplo: `/empresas?type=customer&blacklist=69b_definitivo&sort=-overdue_amount_mxn`.

### Detail page (`/empresas/[id]`):

```typescript
const detailSchema = z.object({
  tab: z.enum([
    "panorama", "comercial", "financiero", "operativo", "fiscal", "pagos",
  ]).catch("panorama"),
});
```

Link ejemplo: `/empresas/868?tab=financiero`.

---

## 6. List page `/empresas`

### 6.1 Server flow

1. `EmpresasPage` (Server Component) lee `searchParams` + `parseSearchParams(raw, searchSchema)`.
2. `fetchPortfolioKpis()` → totals no filtrados (LTV sum, customers count, suppliers count, blacklist count).
3. `listCompanies({ q, onlyCustomers: type==="customer", onlySuppliers: type==="supplier", blacklistLevel: blacklist==="any"?undefined:blacklist, sort })` → filtered rows.
4. Client-side filter: `shadowOnly` → `rows.filter(r => r.has_shadow_flag)` (TODO: push to DB in sp6-02.2).
5. Pass to `<CompanyFilterBar>` + `<CompanyListClient>` + `<StatGrid>`.

### 6.2 Mobile layout

- `<StatGrid columns={{ mobile: 2, desktop: 4 }}>` — 4 KPIs con `<KpiCard>`.
- `<CompanyFilterBar>` — type chips, blacklist dropdown, shadowOnly toggle, search input.
- `<CompanyListClient>`:
  - Mobile (`<sm:`): stack de `<Card>` por company, cada una con display_name + rfc + type badge + 3 KPI mini-values (LTV, YTD, Vencida) + blacklist/shadow badges.
  - Desktop (`≥sm:`): DataTable con columnas sortables (sort via URL state).
  - Row click → `/empresas/{id}`.

### 6.3 Empty / Loading / Error

- `<Suspense fallback={<LoadingList />}>` wrapping content.
- Empty sin filtros: `<EmptyState>` — "Sin empresas" (muy improbable en prod).
- Empty con filtros: `<EmptyState>` + clear filters button.
- Error: `src/app/empresas/error.tsx` existente (verificar que use shadcn Alert).

---

## 7. Detail page `/empresas/[id]`

### 7.1 Server flow

1. `InsightDetailPage` recibe `params.id` + `searchParams.tab`.
2. `fetchCompanyById(Number(id))` + `fetchCompany360(Number(id))` en paralelo.
3. Si no existe → `notFound()`.
4. (Opcional) `fetchCompanyRevenueTrend(id, 12)` para el sparkline del hero + Panorama chart.
5. Render:
   - `<PageHeader breadcrumbs={[...]} />`
   - `<CompanyKpiHero canonical={canonical} company360={c360} trend={trend} />`
   - `<TabPicker activeTab={tab} />` — estado URL.
   - Content: active tab component.

### 7.2 `<TabPicker>` component

```tsx
interface TabPickerProps {
  activeTab: "panorama" | "comercial" | "financiero" | "operativo" | "fiscal" | "pagos";
  // Tab components rendered by parent; picker just switches selection.
  // Picker pushes the new tab to URL state.
}
```

- Mobile (`<md:`): renderiza `<Select>` shadcn + label "Vista".
- Desktop (`≥md:`): renderiza `<Tabs>` horizontal shadcn.
- On change: `router.push(toSearchString({ tab: newTab }))`.

### 7.3 PanoramaTab rewrite

Secciones en orden vertical (mobile) / grid 2-col (desktop):

1. **Cartera abierta** — si `receivables.length > 0`, `<AgingBuckets data={...}>`.
2. **Revenue 12 meses** — `<Chart type="area">` con datos de `gold_revenue_monthly` filtrado por canonical_company_id, using `CHART_PALETTE.positive`.
3. **Pedidos recientes** — Top 3 `canonical_sale_orders` por date_order DESC, con links a detail.
4. **Actividad reciente** — `<EvidenceSection>` reusing sp6-01, últimos 5 merged de email_signals + ai_extracted_facts scoped al canonical company.

Empty states por cada sección independiente.

### 7.4 FinancieroTab rewrite

1. **Cartera abierta** — `<AgingBuckets>` (mismo dato que Panorama — OK repetido, es el contexto primario del Financiero view).
2. **Revenue 12 meses del cliente** — `<Chart type="area">` con 1 serie: revenue (positive) — data de `gold_revenue_monthly` filtrado por `canonical_company_id`. **NOTA:** `gold_pl_statement` es portfolio-wide (no by-company); per-company full P&L (revenue - expenses = net) no existe hoy. Mostramos solo revenue en este tab, explícito vía section header "Ingresos de este cliente" (no "P&L").
3. **Cashflow snapshot** — `<MetricRow>` grid con datos per-company de `gold_company_360`: `overdue_amount_mxn` (cartera vencida), `lifetime_value_mxn` (LTV), `revenue_90d_mxn` (actividad reciente). DSO/DPO/working_capital portfolio-level no se muestran aquí (son métricas globales, viven en `/finanzas`).

**Implementer nota:** si `gold_revenue_monthly` no tiene shape esperado por company, fallback a agregación client-side sobre `canonical_invoices WHERE receptor_canonical_company_id = X GROUP BY month` — documentar decisión al implementar.

---

## 8. Testing strategy

### 8.1 Vitest component

- `CompanyFilterBar` — chips, debounced search, sort, clear.
- `CompanyListClient` — empty states (sin filtros / con filtros), row→link, mobile card collapse.
- `TabPicker` — Select on mobile, Tabs on desktop, URL state on change.
- `PanoramaTab` — renders AgingBuckets, chart, recent orders list.
- `FinancieroTab` — renders AgingBuckets + P&L chart + cashflow metrics.

### 8.2 Vitest integration

- `/empresas/page.tsx` — URL state parses, listCompanies mock called with correct filters, rendered items.
- `/empresas/[id]/page.tsx` — renders CompanyKpiHero + TabPicker + correct tab content on `?tab=X`.

### 8.3 axe-core

Extend `src/__tests__/patterns/axe-a11y.test.tsx` with:
1. `CompanyListClient` fully populated (5 rows with mix of blacklist/shadow).
2. `/empresas/[id]` detail page with CompanyKpiHero + Panorama tab content.

Each: 0 critical violations.

---

## 9. Definition of Done (10 gates)

1. `/empresas` reads only `gold_company_360` + `canonical_companies` (grep `rfm_segments|customer_ltv_health|company_profile_sat` in `src/app/empresas/page.tsx` = 0).
2. URL state schema zod working; links shareable and back-button safe.
3. `CompanyFilterBar` + `CompanyListClient` rendered mobile-first (cards-as-rows under `sm:`).
4. Portfolio KPIs via `<StatGrid>` + `<KpiCard>` × 4.
5. `/empresas/[id]` header = `<CompanyKpiHero>` above Tabs.
6. `<TabPicker>` renders `<Select>` mobile / `<Tabs>` desktop, preserving `?tab=` URL state.
7. `PanoramaTab` rewrite: AgingBuckets (if receivables) + revenue 12m chart + recent orders + EvidenceSection.
8. `FinancieroTab` rewrite: AgingBuckets + P&L 12m chart + cashflow MetricRow snapshot.
9. `/empresas/at-risk` redirect fixed to `/empresas`.
10. Vitest: ≥6 new tests passing; axe: 0 critical violations on new components; build compiles (allowing known `/equipo` prerender issue).

---

## 10. Non-goals (explicit)

- Rewrite de Comercial, Operativo, Fiscal, Pagos tabs — sub-specs futuros `sp6-02.1..4`.
- RFM Reactivación en list page — `sp6-02.1`.
- Cambios a páginas fuera de `/empresas` (incluye APIs, agents).
- Nuevos componentes en `src/components/patterns/` (foundation es estable).
- Desktop side-panel split / bulk actions / real-time subscriptions.
- Nuevas librerías UI.

---

## 11. Branch / PR flow

- Branch: `sp6-02-empresas` (ya cortada desde `main@84855ef`).
- Commits atómicos por archivo / componente.
- PR único **"SP6-02 /empresas redesign — CompanyKpiHero + Panorama/Financiero rewrite"** → mergea a `main` cuando 10/10 DoD pasan.
- User mergea manualmente con `gh pr merge N --merge --delete-branch`.

---

## 12. Referencias

- Foundation spec: `docs/superpowers/specs/2026-04-22-frontend-revamp-sp6-foundation-design.md`.
- sp6-01 /inbox: `docs/superpowers/specs/2026-04-22-sp6-01-inbox-design.md` (patrón del rewrite).
- Silver arquitectura §13.1: `docs/superpowers/specs/2026-04-21-silver-architecture.md`.
- Helpers existentes: `src/lib/queries/_shared/companies.ts` (listCompanies, fetchCompanyById, fetchCompany360, getCompanyDetail).
- Foundation primitives: `CompanyKpiHero`, `AgingBuckets`, `Chart`, `StatusBadge`, `TrendSpark` en `src/components/patterns/*`.
- sp6-01 page-local: `EvidenceSection` en `src/app/inbox/insight/[id]/_components/` (reusable desde /empresas/[id]).
