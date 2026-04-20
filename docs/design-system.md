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
- `recharts` wrapped por componentes del dominio.
- Tabla densa para tabulares, no gráfico.

## Catálogo de componentes (`@/components/patterns`)

### Layout
- `<PageLayout>` — wrapper canónico de contenido de page. Renderiza un `<div>` con `space-y-6 pb-24 md:pb-6` (spacing entre secciones + clearance del mobile tab bar). El `<main id="main-content">` lo aporta `MainContent` — no duplicar.
- `<PageHeader>` — título + breadcrumbs + DataSourceBadge + actions.
- `<SectionHeader>` — título interno de sección + description + action.

### Data display
- `<DataTable>` — tabla sortable/filterable con shadcn Table.
- `<DataView>` — wrapper con toggle tabla/chart, density, export.
- `<KpiCard>` — figura grande + label + trend + source.
- `<StatGrid>` — grid de KPIs.
- `<MetricRow>` — label + value + delta inline.
- `<MobileCard>` — alternativa mobile de row de tabla.

### Feedback
- `<EmptyState>` — variants: default, search, error.
- `<LoadingCard>` / `<LoadingTable>` / `<LoadingList>` — skeletons.
- `<SeverityBadge>` / `<StatusBadge>` / `<TrendIndicator>`.

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
