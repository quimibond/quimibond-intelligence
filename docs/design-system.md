# Quimibond Intelligence · Design System

## Tokens

### Spacing
- `space-y-2` dentro de cards (items estrechos: tabla + labels).
- `space-y-4` dentro de sección (sub-items: badges, pequeños componentes).
- `space-y-6` entre secciones (default de PageLayout).
- `space-y-8` sólo para separar bloques top-level en pages muy largas.

### Typography
- `h1` = `text-3xl font-bold` — título de page.
- `h2` = `text-2xl font-semibold` — título de sección mayor.
- `h3` = `text-lg font-medium` — título de sección interna (usar `SectionHeader`).
- `body` = `text-sm` — texto default.
- `muted` = `text-xs text-muted-foreground` — labels, metadata.

### Colors (tokens semánticos únicamente)
- `bg-background` — fondo de página.
- `bg-card` — fondo de Cards.
- `bg-muted` — fondo de inputs deshabilitados, hover sutil.
- `text-foreground` — texto primario.
- `text-muted-foreground` — texto secundario.
- `border-border` — bordes.
- `primary` / `accent` / `destructive` — solo para acciones.
- **NUNCA** hex hardcoded.

### Status semántico (SP6)

Traffic-light tokens en `globals.css` (light + dark):
- `--status-ok` (verde salvia) — positivo, on-time, paid
- `--status-warning` (ámbar cálido) — atención, partial, stale
- `--status-critical` (coral) — overdue, blacklist definitivo
- `--status-info` (azul apagado) — baseline, unmatched
- `--status-muted` (gris) — inactivo, low severity

Aging gradient 5-stop: `--aging-current → --aging-1-30 → --aging-31-60 → --aging-61-90 → --aging-90-plus`.

Tailwind utilities: `text-status-ok`, `bg-aging-90-plus`, etc. (vía `@theme inline`).

### Density
- `compact` — tablas densas (default en `/cobranza`, `/empresas`).
- `normal` — cards y páginas orientadas a lectura.

Controlado vía `data-table-density` en `<html>` (persistido en localStorage).

### Loading
- Usar `<LoadingCard>`, `<LoadingTable>`, `<LoadingList>` de `@/components/patterns`.
- **Nunca** spinners. Siempre skeletons con shape semántico.

### Empty states
- Usar `<EmptyState>` de `@/components/patterns`.
- Icon Lucide + heading + description + CTA opcional.

### Charts
> @deprecated SP6 — Ver sección "Chart (SP6 unificado)" en Catálogo de componentes abajo.
- `recharts` wrapped por componentes del dominio.
- Tabla densa para tabulares, no gráfico.
- `<MiniChart values>` — reemplazado por `<Chart type="sparkline">` vía shim `@deprecated SP6`.

## Catálogo de componentes (`@/components/patterns`)

### Layout
- `<PageLayout>` — wrapper canónico de contenido de page. Renderiza un `<div>` con `space-y-6 pb-24 md:pb-6` (spacing entre secciones + clearance del mobile tab bar). El `<main id="main-content">` lo aporta `MainContent` — no duplicar.
- `<PageHeader>` — título + breadcrumbs + DataSourceBadge + actions.
- `<SectionHeader>` — título interno de sección + description + action.

### Data display
- `<DataTable>` — tabla sortable/filterable con shadcn Table.
- `<DataView>` — wrapper con toggle tabla/chart, density, export.
  > @deprecated SP6 — `DataView`, `DataViewChart`, `DataViewToggle` reemplazados por `<Chart type=...>` unificado (ver sección "Chart (SP6 unificado)" abajo). Shims disponibles.
- `<KpiCard>` — figura grande + label + trend + source.
- `<StatGrid>` — grid de KPIs.
- `<MetricRow>` — label + value + delta inline.
- `<MobileCard>` — alternativa mobile de row de tabla.

### Feedback
- `<EmptyState>` — variants: default, search, error.
- `<LoadingCard>` / `<LoadingTable>` / `<LoadingList>` — skeletons.
- `<SeverityBadge>` / `<StatusBadge>` / `<TrendIndicator>`.
  > @deprecated SP6 — `SeverityBadge` y `StatusBadge` legacy han sido unificados en `<StatusBadge kind=...>` (ver sección "StatusBadge (SP6 unificado)" abajo). Los wrappers anteriores siguen funcionando vía shims.

### Data types
- `<Currency>` — formato MXN/USD consistente.
- `<DateDisplay>` — fechas relativas + absolute tooltip.
- `<CompanyLink>` — link canónico a `/empresas/[id]`.

### Inputs / actions
- `<FilterBar>`, `<DataTableToolbar>`.
- `<TableDensityToggle>`, `<TableViewOptions>`, `<TableExportButton>`.
- `<ConfirmDialog>`, `<BottomSheet>`.

### Evidence / predictions
- `<EvidenceChip>`, `<EvidenceTimeline>`, `<EvidencePackView>`.
- `<PredictionCard>`, `<PredictionDelta>`.

### Page-specific reusables
- `<InvoiceDetailView>`, `<PersonCard>`.

### SP6 nuevos

- `<InboxCard>` — gold_ceo_inbox row. Props: `issue: InboxCardIssue`, `onAction?`. Mobile-first; CTA tap target ≥ 44px.
- `<SwipeStack>` — CSS scroll-snap container. Props: `ariaLabel`, `snap?: boolean` (default `true`). Para listas Tinder-style en mobile (/inbox).
- `<AgingBuckets>` — stacked bar 5-stop. Props: `data: AgingData`, `ariaLabel`, `onBucketClick?`, `showLegend?` (default `true`).
- `<CompanyKpiHero>` — header entity detail con blacklist/shadow badges + 4 KPIs + sparkline opcional. Props: `canonical: CompanyKpiHeroCanonical`, `company360: CompanyKpiHero360`, `trend?: number[]`.
- `<TrendSpark>` — sparkline auto-coloreado (up=positive / down=negative / flat=muted). Props: `values: number[]`, `ariaLabel`, `width?`, `height?`.

### StatusBadge (SP6 unificado)

```tsx
<StatusBadge
  kind="severity|payment|estado_sat|blacklist|shadow|match|staleness|reconciliation|generic"
  value={...}
  density="compact" | "regular"                 // compact default — dot + text; regular — pill suave
  variant?="dot" | "pill" | "outline" | "leftbar"  // escape hatch
  ariaLabel?
  className?
/>
```

Reemplaza: `SeverityBadge`, `SatBadge`, `RefreshStalenessBadge`, y `StatusBadge` legacy (`status=`). Los 4 wrappers viejos siguen funcionando vía shims `@deprecated SP6` para no romper páginas fuera de alcance.

### Chart (SP6 unificado)

```tsx
<Chart
  type="line|area|bar|stackedBar|pie|sparkline"
  data={[...]}
  xKey
  series={[{ key, label, color? }]}    // color puede ser clave semántica (positive/warning/negative/neutral/muted) o CSS literal
  ariaLabel                            // REQUERIDO
  height?
  yFormatter?                          // aplica a ejes Y y tooltips
/>
```

Renderiza tabla `sr-only` espejo adyacente al chart para screen readers. Reemplaza: `DataView`, `DataViewChart`, `DataViewToggle`, `MiniChart` — todos shims `@deprecated SP6`.

Paleta semántica en `src/lib/chart-theme.ts` (`CHART_PALETTE`). Los tokens `--chart-1..5` de shadcn se preservan para series multi-categoría sin semántica (top 5 clientes, etc.) via `CHART_PALETTE.series[0..4]`.

## Reglas de uso

1. **Siempre** importar de `@/components/patterns` — nunca de `@/components/shared/v2` (deprecated) ni implementar manual.
2. Componentes específicos de feature van a `@/components/domain/<feature>`.
3. Componentes page-local: `src/app/<route>/_components/`.
4. No custom `<button>`, `<table>`, `<input>` — usar shadcn de `@/components/ui/`.
5. Dark mode: tokens semánticos, nunca `bg-white text-black`.
6. Icons: Lucide exclusivo. No emoji salvo `<DataSourceBadge>` con tooltip.

## Ejemplos

### Page estándar
```tsx
import { PageLayout, PageHeader, LoadingCard } from "@/components/patterns";

export default async function Page() {
  return (
    <PageLayout>
      <PageHeader
        title="Ventas"
        description="Seguimiento de pipeline y cierres del mes"
        sources={["odoo", "unified"]}
      />
      <Suspense fallback={<LoadingCard />}>
        <SalesContent />
      </Suspense>
    </PageLayout>
  );
}
```

### Tabla con datos
```tsx
import { DataTable } from "@/components/patterns";

<DataTable
  columns={columns}
  data={rows}
  sortable
  paginate
/>
```

### KPI con source
```tsx
import { KpiCard } from "@/components/patterns";

<KpiCard
  label="Facturación mes"
  value={formatCurrencyMXN(total)}
  trend="up"
  delta="+12%"
  source="unified"
/>
```

### Sección con header + action
```tsx
import { SectionHeader } from "@/components/patterns";
import { Button } from "@/components/ui/button";

<SectionHeader
  title="Top clientes"
  description="Por facturación YTD"
  action={<Button variant="outline" size="sm">Ver todos</Button>}
/>
```

### Loading states
```tsx
import { LoadingCard, LoadingTable, LoadingList } from "@/components/patterns";

// KPIs cargando
<Suspense fallback={<LoadingCard />}>
  <KpisPanel />
</Suspense>

// Tabla densa cargando
<Suspense fallback={<LoadingTable rows={8} columns={5} />}>
  <InvoicesTable />
</Suspense>

// Lista de contactos / personas
<Suspense fallback={<LoadingList items={6} />}>
  <ContactsList />
</Suspense>
```

## Contratos transversales (SP6)

### URL state

`src/lib/url-state.ts` — `parseSearchParams(raw, schema)` + `toSearchString(params, opts?)`.
Schemas con zod (`z.ZodType<T>`). El helper aplica `.catch()` de zod para que URLs inválidas degradan a defaults en vez de tirar.

```tsx
import { z } from "zod";
import { parseSearchParams, toSearchString } from "@/lib/url-state";

const schema = z.object({
  q: z.string().catch(""),
  page: z.coerce.number().int().min(1).catch(1),
  severity: z.enum(["critical", "high", "medium", "low"]).optional().catch(undefined),
});

// En Server Component:
const params = parseSearchParams(searchParams, schema);

// En Client Component (filter handler):
router.push(`/ruta${toSearchString({ q, page }, { dropEqual: { page: 1 } })}`);
```

### Breakpoints mobile-first

Viewport canónico **375×812** (iPhone 13/14/15 base). Tailwind defaults:
- `base` (<640px): 1 col, DataTables colapsan a MobileCard stack, sidebar→Sheet drawer, bottom tab bar.
- `sm:` (≥640): 2 col KPIs.
- `md:` (≥768): 3 col KPIs, sidebar permanente.
- `lg:` (≥1024): 4 col KPIs, layout desktop completo.

### A11y baseline

- Rows / cards clickeables: `role="button" tabIndex={0}` + keyboard handlers Enter/Space.
- StatusBadge: `aria-label` semántico obligatorio en español (ej. "Factura vencida 67 días").
- Charts: `role="img"` + tabla `.sr-only` espejo con datos crudos.
- Color nunca es único portador de semántica — cada estado crítico tiene ícono Lucide adicional.
- Contraste WCAG AA (4.5:1 texto, 3:1 UI) objetivo en dark mode.
- `<html lang="es-MX">` en root layout.
- Botones icon-only: `aria-label` obligatorio.

### Empty / Loading / Error

- **Loading:** `<Suspense fallback={<LoadingCard | LoadingTable | LoadingList />}>` granular por sección.
- **Empty:** `<EmptyState>` con icon Lucide + heading + description + CTA opcional. Copy en español neutro.
- **Error:** `error.tsx` por route group — renderiza `<Alert variant="destructive">` + botón reset. Nunca stack trace al usuario.
