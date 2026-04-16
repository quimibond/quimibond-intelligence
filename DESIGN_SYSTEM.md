# Design System — Quimibond Intelligence

**Single source of truth for UI patterns.** If something isn't documented here, it shouldn't exist in the codebase.

## Core principle

**No hardcoded colors. No custom replicas of shadcn components. Reuse or add to the design system.**

When in doubt:
1. Check `src/components/ui/*` (shadcn primitives)
2. Check `src/components/shared/v2/*` (app-specific primitives — canonical)
3. Only then add a new shared component

> **Nota (2026-04-16):** `src/components/shared/*` (v1) fue borrado. Solo quedan 4 legacy (`realtime-alerts`, `route-error`, `search-command`, `severity-badge` — importados por `layout.tsx` / error boundaries). **Todo código nuevo debe usar `@/components/shared/v2`.**

---

## Semantic color tokens

All colors in this app are defined as CSS variables in `src/app/globals.css`. **Never use raw Tailwind colors** (`bg-red-500`, `text-amber-600`, etc.).

### Base (shadcn)
| Token | Usage |
|-------|-------|
| `primary` | Main brand/action color |
| `secondary` | Subtle background accents |
| `muted` | Disabled/inactive backgrounds |
| `muted-foreground` | Secondary/helper text |
| `card` / `card-foreground` | Card surfaces |
| `background` / `foreground` | Page base |
| `border` | All borders |
| `ring` | Focus rings |
| `destructive` | Delete/destructive actions |

### Semantic status (custom)
| Token | Usage |
|-------|-------|
| `success` / `success-foreground` | Positive state (paid, improved, on-time) |
| `warning` / `warning-foreground` | Attention needed (overdue 1-30d, medium severity) |
| `danger` / `danger-foreground` | Critical state (overdue 60d+, high severity) |
| `info` / `info-foreground` | Informational / neutral highlight |

### Domain colors (agent areas)
| Token | Domain |
|-------|--------|
| `domain-sales` | Comercial / ventas |
| `domain-finance` | Financiero / cobranza |
| `domain-operations` | Operaciones / logística |
| `domain-relationships` | Equipo / relaciones |
| `domain-risk` | Riesgo |
| `domain-growth` | Crecimiento |
| `domain-meta` | Meta-agent |

### ❌ Forbidden
```tsx
// ❌ Raw Tailwind colors
<div className="bg-red-500 text-amber-600 border-emerald-400">

// ✅ Semantic tokens
<div className="bg-danger text-warning border-success/30">
```

---

## Component catalog

### shadcn primitives (`src/components/ui/`)

| Component | When to use |
|-----------|-------------|
| `Button` | All clickable buttons. Never `<button>` directly. |
| `Input` | Text input. Never `<input type="text">`. |
| `Textarea` | Multi-line text. Never `<textarea>`. |
| `Select` | Dropdown. Never `<select>`. |
| `Label` | Form labels with `htmlFor`. Never `<label>`. |
| `Checkbox` | Checkboxes. Never `<input type="checkbox">`. |
| `Card` / `CardContent` / `CardHeader` / `CardTitle` | Content containers |
| `Badge` | Status pills, counts, tags |
| `Dialog` | Modals |
| `Sheet` | Side panels (mobile menus) |
| `Tabs` / `TabsList` / `TabsTrigger` | Tabbed interfaces |
| `Table` | Data tables |
| `Skeleton` | Loading placeholders |
| `Separator` | Dividers |
| `Switch` | On/off toggles |
| `Progress` | Progress bars (not status bars — use `role="meter"`) |
| `Avatar` | User/company avatars |
| `Tooltip` | Hover hints |
| `DropdownMenu` | Action menus |
| `Chart` (`ChartContainer` / `ChartTooltipContent` / `ChartLegendContent`) | shadcn chart primitive sobre recharts. **Único wrapper permitido para gráficas** — no usar recharts directo. |

### App primitives (`src/components/shared/v2/`)

Importar vía barrel: `import { DataView, KpiCard } from "@/components/shared/v2"`.

| Component | Purpose |
|-----------|---------|
| `PageHeader` | Title + breadcrumbs + actions at top of every page |
| `EmptyState` | When a list is empty (always show, never blank) |
| `KpiCard` / `StatGrid` | KPI tiles con tone (success / warning / danger / info) |
| `MetricRow` | Métrica inline: label + value + optional trend |
| `SeverityBadge` | critical / high / medium / low / info |
| `StatusBadge` | Action/insight state (new/seen/acted_on/dismissed/expired) |
| `TrendIndicator` | ↑ / ↓ con % y color semántico |
| `DataTable` | Tabla server-rendered con sort via URL (canónico) |
| `DataView` | **`DataTable` + toggle opcional a gráfica.** Usar este para cualquier tabla que tenga sentido visualizar también como chart. |
| `DataTableToolbar` / `DataTablePagination` / `TableViewOptions` / `TableExportButton` | Composición de toolbar para DataTable |
| `FilterBar` | Fila de filtros/búsqueda |
| `MiniChart` | Sparkline inline para KPIs y celdas de tabla |
| `CompanyLink` / `PersonCard` | Entity chips |
| `Currency` / `DateDisplay` | Formateadores seguros de valores |
| `EvidencePackView` / `EvidenceTimeline` / `EvidenceChip` | Render de evidencia IA |
| `PredictionCard` / `PredictionDelta` | Tarjetas de predicción |
| `InvoiceDetailView` | Detalle de factura reutilizable |
| `BottomSheet` / `MobileCard` / `PullToRefresh` | Primitivas mobile-first |
| `ConfirmDialog` | Confirmación destructiva |
| `SectionNav` | Navegación entre secciones dentro de una página |

---

## DataView pattern (tabla ⇄ gráfica)

**Problema:** El app tiene ~35 tablas y solo ~5 gráficas. Casi cualquier tabla numérica (top productos, aging, costos, revenue por cliente, etc.) es más legible como gráfica.

**Solución:** `<DataView>` en `src/components/shared/v2/data-view.tsx`. Envuelve `<DataTable>` y añade un toggle server-rendered al param `?view=table|chart` de la URL.

```tsx
import { DataView, type DataViewChartSpec } from "@/components/shared/v2";
import { formatCurrencyCompact } from "@/lib/utils";

const chart: DataViewChartSpec = {
  type: "bar",           // "bar" | "line" | "area" | "pie"
  xKey: "product_ref",
  series: [{ dataKey: "revenue_90d", label: "Revenue 90d" }],
  valueFormatter: formatCurrencyCompact,
};

// Server component
export default async function Page({ searchParams }) {
  const sp = await searchParams;
  const view = sp.view === "chart" ? "chart" : "table";
  const rows = await getTopMovers();

  return (
    <DataView
      data={rows}
      columns={columns}
      chart={chart}
      view={view}
      viewHref={(v) => {
        const p = new URLSearchParams(sp);
        p.set("view", v);
        return `?${p.toString()}`;
      }}
    />
  );
}
```

Reglas:
- **Si no pasas `chart`**, `DataView` se comporta idéntico a `<DataTable>` (sin toggle).
- **Colores:** Rota `--chart-1..5` de `globals.css` por default. Puedes pasar `color: "var(--success)"` en cada serie.
- **Tooltip/Leyenda:** Heredados de `ChartContainer` shadcn — no los reimplementes.
- **SSR:** La tabla y el toggle son server-rendered. La gráfica es client (recharts no hidrata server-side); se carga solo cuando `view=chart`.
- **No usar** recharts directo en páginas nuevas — siempre pasar por `DataView` o `ChartContainer`.

---

## Form pattern

```tsx
<div className="space-y-1.5">
  <Label htmlFor="my-field">Field name</Label>
  <Input
    id="my-field"
    type="text"
    value={value}
    onChange={(e) => setValue(e.target.value)}
    placeholder="..."
  />
</div>
```

- Always `Label` + `htmlFor` (a11y requirement)
- Use `space-y-1.5` between label and input
- Use `space-y-4` between form fields
- Error message: `<p className="text-sm text-destructive">{error}</p>`
- Never inline `<input>` without shadcn wrapper

---

## Icon pattern

Every `lucide-react` icon inside an interactive element needs a label:

```tsx
// ❌ Icon-only button with no label
<button onClick={close}><X className="h-4 w-4" /></button>

// ✅ Icon-only button with aria-label
<button onClick={close} aria-label="Cerrar panel">
  <X className="h-4 w-4" />
</button>

// ✅ Decorative icon next to text (no label needed)
<button>
  <Save className="h-4 w-4 mr-1" />
  Guardar
</button>

// ✅ Icon as status indicator (role="img" + aria-label)
<Paperclip className="h-3.5 w-3.5" aria-label="Tiene adjuntos" />
```

---

## Status meter pattern (not progress)

For "X of Y" health indicators use `role="meter"`:

```tsx
<div
  role="meter"
  aria-label={`Salud ${score} de 100`}
  aria-valuenow={score}
  aria-valuemin={0}
  aria-valuemax={100}
>
  <div className="h-1.5 w-12 rounded-full bg-muted overflow-hidden">
    <div className="h-full bg-success" style={{ width: `${score}%` }} />
  </div>
</div>
```

Use `<Progress>` from shadcn only for task progress (% of completion).

---

## State machine patterns

Every list should handle 3+ states:

```tsx
if (loading) return <LoadingGrid rows={5} />;
if (error) return <EmptyState icon={AlertTriangle} title="Error al cargar" description={error} />;
if (rows.length === 0) return <EmptyState icon={MyIcon} title="Sin resultados" description="..." />;
return <YourList rows={rows} />;
```

---

## Adding a new shared component

Before creating a new file in `src/components/shared/`:

1. **Is it reused in 3+ places?** If no, keep it inline.
2. **Does a shadcn primitive exist?** Use that first.
3. **Can it extend an existing shared component?** Prefer composition.
4. **Does it have clear props?** Define a TypeScript interface.

When you do add one:
- Add entry to this doc (component catalog table)
- Include JSDoc with usage example
- Use semantic tokens only
- Support light/dark mode automatically (no hardcoded colors)
- Keyboard accessible (focus-visible ring)
- Screen reader accessible (aria-labels on icons)

---

## Current state (2026-04-12)

✅ **Clean:**
- 0 raw Tailwind colors (except test files)
- 0 raw `<input>` / `<textarea>` / `<select>` elements in `src/app/`
- All directors use semantic domain tokens
- All forms use `Label` + `htmlFor`
- All pages use `PageHeader` + `EmptyState` + `LoadingGrid`

🚧 **In progress:**
- Migrating 20+ remaining div-card duplicates to `<LinkCard>`
- Tokenizing chart colors in `recharts` components
- Adding `aria-label` sweep to icon-only buttons

**Enforcement:** Every PR should not increase hardcoded color count or add raw HTML form elements. Run:
```bash
grep -rnE "bg-(red|blue|green|yellow|orange|amber|emerald)-\d+" src/ | grep -v test
grep -rn "<input type" src/app
```
Both should return zero results.
