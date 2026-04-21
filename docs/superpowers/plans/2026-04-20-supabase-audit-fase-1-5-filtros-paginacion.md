# Fase 1.5 — Filtros & Paginación: Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar al usuario control total de "cuándo" en las vistas unificadas. Reemplazar "muestras" (`.limit()` silencioso, ventanas hardcoded 90d/12m/13w) con filtros explícitos por año/rango de fechas + paginación real. Crear página `/pagos` unificada.

**Architecture:** (1) Componente `<YearSelector>` reutilizable con URL state (`?year=2026`); (2) extender queries para aceptar `{year?, dateFrom?, dateTo?}`; (3) exponer `DataTableToolbar dateRange` en las 4 tablas donde ya existía en backend; (4) eliminar `.limit(N)` sin offset; (5) nueva página `/pagos` con aging CxC + CxP + complementos SAT.

**Tech Stack:** Next.js 14 app router, shadcn/Radix UI, TanStack Table, Supabase (MVs `invoices_unified`, `payments_unified`, `company_profile`).

**Spec parent:** [02-ui-unificada.md](../specs/2026-04-19-supabase-audit-02-ui-unificada.md) — esta fase extiende la usabilidad de lo construido en Fase 1.

**Repos afectados:**
- Frontend: `/Users/jj/quimibond-intelligence/quimibond-intelligence/` (branch `fase-1-5-filtros`)
- qb19: `/Users/jj/` — posibles migraciones SQL si alguna MV necesita índices para filtros por año

## UX decisiones (ya confirmadas por el user "como tú creas")

1. **YearSelector default:** `año actual` (2026). Opción "Todos" disponible pero no default.
2. **Página nueva `/pagos`:** crear, con aging CxC (cobranza) + aging CxP (cuentas por pagar) + complementos SAT missing + detalle de pagos recibidos/enviados.
3. **`/finanzas` con año filtrado:** override inteligente — secciones históricas (P&L, working capital, ingresos 12m) filtran al año seleccionado; secciones de proyección (runway, 13w, reorder risk) ignoran el filtro y muestran chip "(proyección, desde hoy)".

---

## Estructura de archivos

### Crear en frontend
- `src/components/patterns/year-selector.tsx` — dropdown reutilizable
- `src/lib/queries/_shared/year-filter.ts` — helpers `yearBounds(year: number | 'all'): {from: Date, to: Date}` + parsing URL param
- `src/app/pagos/page.tsx` — página nueva unificada
- `src/app/pagos/_components/**` — subcomponentes específicos

### Modificar
- `src/lib/queries/unified/invoices.ts` — añadir param year a `getOverdueInvoicesPage`, `getCompanyAgingPage`, `getUnifiedInvoicesForCompany` (quitar `.limit(500)`)
- `src/lib/queries/unified/index.ts` — idem
- `src/lib/queries/analytics/finance.ts` — param year
- `src/lib/queries/operational/purchases.ts` — param year
- `src/lib/queries/_shared/companies.ts` — param year
- `src/lib/queries/sales/*` — param year
- `src/app/cobranza/page.tsx` — añadir `<YearSelector>` + expose dateRange en 3 tablas sin él
- `src/app/finanzas/page.tsx` — añadir `<YearSelector>` + lógica de override inteligente
- `src/app/ventas/page.tsx` — añadir `<YearSelector>` + expose dateRange en 2 tablas
- `src/app/empresas/page.tsx` — añadir `<YearSelector>` (opt-in, empresas son atemporales pero métricas sí)
- `src/app/compras/**/*.tsx` — añadir `<YearSelector>` en subpáginas

---

## Task 0: Setup + YearSelector component + year-filter helper

**Files:**
- Create: `src/components/patterns/year-selector.tsx`
- Create: `src/lib/queries/_shared/year-filter.ts`

- [ ] **Step 0.1: Verificar/crear branch**

```bash
cd /Users/jj/quimibond-intelligence/quimibond-intelligence
git fetch origin main && git checkout main && git pull origin main
git checkout -b fase-1-5-filtros
```

Espera que el main del frontend tenga ya la Fase 1 (PR #38 mergeado). Si NO, reportar BLOCKED — Fase 1.5 depende de eso.

- [ ] **Step 0.2: Obtener rango de años disponibles (para el dropdown)**

```
mcp__claude_ai_Supabase__execute_sql
  project_id: "tozqezmivpblmcubmnpi"
  query: "SELECT EXTRACT(YEAR FROM MIN(invoice_date))::int AS min_year, EXTRACT(YEAR FROM MAX(invoice_date))::int AS max_year FROM public.invoices_unified;"
```

Guardar resultado. Probablemente 2019-2026 o similar.

- [ ] **Step 0.3: Escribir helper year-filter**

Crear `src/lib/queries/_shared/year-filter.ts`:

```typescript
/**
 * Year filter — convierte año seleccionado en rango de fechas [from, to).
 *
 * - `year = 'all'` → sin límites (desde 2019 hasta hoy+1)
 * - `year = <número>` → ['YYYY-01-01', 'YYYY+1-01-01')
 * - `year = 'current'` → año actual
 */

export type YearValue = number | 'all' | 'current';

export const MIN_AVAILABLE_YEAR = 2019;

export function resolveYear(value: YearValue | undefined): number | 'all' {
  if (value === 'all') return 'all';
  if (value === 'current' || value === undefined) return new Date().getFullYear();
  return value;
}

export function yearBounds(value: YearValue | undefined): { from: Date; to: Date } {
  const resolved = resolveYear(value);
  if (resolved === 'all') {
    return {
      from: new Date(`${MIN_AVAILABLE_YEAR}-01-01`),
      to: new Date(new Date().getFullYear() + 1, 0, 1),
    };
  }
  return {
    from: new Date(resolved, 0, 1),
    to: new Date(resolved + 1, 0, 1),
  };
}

export function parseYearParam(searchParam: string | string[] | undefined): YearValue {
  if (Array.isArray(searchParam)) searchParam = searchParam[0];
  if (!searchParam) return 'current';
  if (searchParam === 'all') return 'all';
  const n = parseInt(searchParam, 10);
  if (!Number.isFinite(n) || n < MIN_AVAILABLE_YEAR || n > new Date().getFullYear() + 1) {
    return 'current';
  }
  return n;
}

export function availableYears(maxYear: number = new Date().getFullYear()): number[] {
  const years: number[] = [];
  for (let y = maxYear; y >= MIN_AVAILABLE_YEAR; y--) years.push(y);
  return years;
}

export function yearLabel(value: YearValue): string {
  const resolved = resolveYear(value);
  return resolved === 'all' ? 'Todos los años' : String(resolved);
}
```

- [ ] **Step 0.4: Escribir componente YearSelector**

Crear `src/components/patterns/year-selector.tsx`:

```tsx
"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { availableYears, MIN_AVAILABLE_YEAR, parseYearParam, YearValue } from "@/lib/queries/_shared/year-filter";
import { Calendar } from "lucide-react";

interface YearSelectorProps {
  /** URL param name. Default: "year" */
  paramName?: string;
  /** Preserve otros params al cambiar year */
  preserveParams?: boolean;
  /** Etiqueta visible */
  label?: string;
  /** Min year disponible (default: MIN_AVAILABLE_YEAR del helper) */
  minYear?: number;
}

export function YearSelector({
  paramName = "year",
  preserveParams = true,
  label = "Año",
  minYear = MIN_AVAILABLE_YEAR,
}: YearSelectorProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const currentRaw = searchParams.get(paramName);
  const currentValue: YearValue = parseYearParam(currentRaw ?? undefined);
  const displayValue = currentValue === "all" ? "all" : String(currentValue);

  const years = availableYears().filter((y) => y >= minYear);

  function handleChange(value: string) {
    const newParams = preserveParams ? new URLSearchParams(searchParams.toString()) : new URLSearchParams();
    if (value === String(new Date().getFullYear())) {
      newParams.delete(paramName); // current year is default, cleaner URL
    } else {
      newParams.set(paramName, value);
    }
    router.push(`${pathname}?${newParams.toString()}`);
  }

  return (
    <div className="flex items-center gap-2">
      <Calendar className="h-4 w-4 text-muted-foreground" aria-hidden />
      <label className="text-sm text-muted-foreground">{label}:</label>
      <Select value={displayValue} onValueChange={handleChange}>
        <SelectTrigger className="w-[140px] h-8">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos los años</SelectItem>
          {years.map((y) => (
            <SelectItem key={y} value={String(y)}>
              {y}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
```

- [ ] **Step 0.5: Type-check**

```bash
cd /Users/jj/quimibond-intelligence/quimibond-intelligence
pnpm type-check 2>&1 | tail -10
```
Expected: 0 errores.

- [ ] **Step 0.6: Commit**

```bash
git add src/components/patterns/year-selector.tsx src/lib/queries/_shared/year-filter.ts
git commit -m "feat(ui): YearSelector component + year-filter helper

URL state via ?year=2026. Default 'current', supports 'all' y años específicos.
Base para Fase 1.5 filtros unificados."
```

---

## Task 1: Auditar y fixear `.limit()` sin paginación

**Files:**
- Modify: `src/lib/queries/unified/index.ts` (línea 92 aprox: `getUnifiedInvoicesForCompany`)
- Modify: otros identificados por grep

- [ ] **Step 1.1: Grep exhaustivo**

```
Grep pattern: "\\.limit\\([0-9]+\\)"
     path: /Users/jj/quimibond-intelligence/quimibond-intelligence/src/lib/queries
     output_mode: content
     -n: true
     head_limit: 50
```

Lista cada ocurrencia. Para cada una, determinar:
- **Legítimo** (ej: `.limit(3)` para "top 3 insights en sidebar") → mantener + comment `// intentional: top N`
- **Fake "muestra"** (ej: `.limit(500)` sin offset) → refactor a paginación real

- [ ] **Step 1.2: Fix `getUnifiedInvoicesForCompany`**

Read el archivo y localizar la función. Cambiar firma:

```typescript
// ANTES
export async function getUnifiedInvoicesForCompany(companyId: number, opts?: {...}) {
  return supabase.from('invoices_unified').select(...).eq('company_id', companyId).limit(500);
}

// DESPUÉS
export async function getUnifiedInvoicesForCompany(
  companyId: number,
  opts?: { year?: YearValue; page?: number; pageSize?: number; from?: Date; to?: Date }
) {
  const { page = 0, pageSize = 50 } = opts ?? {};
  const { from, to } = opts?.from && opts?.to
    ? { from: opts.from, to: opts.to }
    : yearBounds(opts?.year);

  const offset = page * pageSize;

  const { data, error, count } = await supabase
    .from('invoices_unified')
    .select('*', { count: 'exact' })
    .eq('company_id', companyId)
    .gte('invoice_date', from.toISOString().slice(0, 10))
    .lt('invoice_date', to.toISOString().slice(0, 10))
    .order('invoice_date', { ascending: false })
    .range(offset, offset + pageSize - 1);

  if (error) throw error;
  return { data: data ?? [], totalCount: count ?? 0, page, pageSize };
}
```

Type-check + ajustar callsites rotos.

- [ ] **Step 1.3: Fix otras ocurrencias según Step 1.1**

Iterativo. Después de cada cambio: type-check.

- [ ] **Step 1.4: Commit**

```bash
git add src/lib/queries/**
git commit -m "fix(queries): eliminar .limit() sin paginación — todo va por range() con totalCount"
```

---

## Task 2: `/cobranza` — filtros completos

**Files:**
- Modify: `src/app/cobranza/page.tsx`
- Modify: `src/lib/queries/unified/invoices.ts` — `getCompanyAgingPage`, `getPaymentPredictionsPage`

### Step 2.1: Extender queries

En `getCompanyAgingPage` y `getPaymentPredictionsPage` (y `getOverdueInvoicesPage` si no lo tiene ya), añadir param `year?: YearValue`.

```typescript
export async function getCompanyAgingPage(params: TableParams & { tier?: string[]; year?: YearValue }) {
  const { year } = params;
  const { from, to } = year ? yearBounds(year) : { from: null, to: null };
  let q = supabase.from('company_profile').select(...);
  if (from && to) {
    q = q.gte('last_invoice_date', from.toISOString().slice(0, 10))
         .lt('last_invoice_date', to.toISOString().slice(0, 10));
  }
  // ... resto igual
}
```

### Step 2.2: Exponer YearSelector page-level + dateRange en tablas internas

Edit `src/app/cobranza/page.tsx`. Añadir arriba (debajo del header, antes del primer `<Card>`):

```tsx
import { YearSelector } from "@/components/patterns/year-selector";
import { parseYearParam } from "@/lib/queries/_shared/year-filter";

// en el componente:
const year = parseYearParam(searchParams.year);

// en el JSX header:
<div className="flex items-center justify-between mb-6">
  <h1 className="text-2xl font-bold">Cobranza</h1>
  <YearSelector />
</div>
```

Pasar `year` a cada query interna: `getCompanyAgingPage({ ...params, year })`, idem para las otras.

Para las 3 tablas sin `DataTableToolbar dateRange` expuesto (payment risk, company aging), añadir la prop:

```tsx
<DataTableToolbar
  dateRange={{ label: "Filtrar por fecha de factura", paramPrefix: "pr_" }}
  // ...
/>
```

### Step 2.3: Type-check + smoke

```bash
pnpm type-check 2>&1 | tail -10
pnpm dev &
sleep 8
curl -s "http://localhost:3000/cobranza?year=2025" 2>&1 | head -c 400
curl -s "http://localhost:3000/cobranza?year=all" 2>&1 | head -c 400
# mata dev
```

### Step 2.4: Commit

```bash
git add src/app/cobranza/page.tsx src/lib/queries/unified/invoices.ts
git commit -m "feat(cobranza): YearSelector page-level + dateRange en 3 tablas (aging, payment risk, predictions)"
```

---

## Task 3: `/finanzas` — YearSelector + override inteligente

**Files:**
- Modify: `src/app/finanzas/page.tsx`
- Modify: `src/lib/queries/analytics/finance.ts`

### Step 3.1: Clasificar secciones

Antes de tocar, leer `src/app/finanzas/page.tsx` y anotar cada sección:
- **Histórica** (afecta filtro year): P&L 12m, Working capital cycle, Ingresos mensuales, Perfiles de cashflow, Unificado SAT.
- **Proyección** (NO afecta filtro — muestra chip "(proyección, desde hoy)"): Runway alert, Proyección 13 semanas, Reorder risk, Predictions.

### Step 3.2: Extender queries históricas

Para cada función que alimenta una sección histórica, añadir param `year?: YearValue`:
- `getCFODashboardSnapshot(year)` → filtra el P&L period al año
- `getIncomeStatement(year)` → en vez de rolling 12m, full year
- `getWorkingCapitalCycle(year)`
- `getUnifiedRevenueAggregates(year)`

Si `year === 'current'` o es el año actual: comportamiento actual (YTD o rolling 12m — decidir por sección).
Si `year === <pasado>`: fixed year bounds.
Si `year === 'all'`: sin límite.

### Step 3.3: UI — YearSelector + chip proyección

```tsx
<div className="flex items-center justify-between mb-6">
  <h1 className="text-2xl font-bold">Finanzas</h1>
  <YearSelector />
</div>
```

En cada `<Card>` de sección de proyección, añadir badge:

```tsx
<Card>
  <CardHeader>
    <CardTitle className="flex items-center gap-2">
      Runway
      <Badge variant="outline" className="text-xs">proyección · desde hoy</Badge>
    </CardTitle>
  </CardHeader>
  ...
</Card>
```

### Step 3.4: Type-check + smoke

Mismo pattern que Task 2. Probar `?year=2024` y verificar que P&L muestra 2024 completo, runway sigue desde hoy.

### Step 3.5: Commit

```bash
git commit -m "feat(finanzas): YearSelector con override inteligente (histórico filtrado, proyecciones desde hoy)"
```

---

## Task 4: `/ventas` — YearSelector + expose dateRange

**Files:**
- Modify: `src/app/ventas/page.tsx`
- Modify: `src/lib/queries/sales/**` (top customers, reorder risk)

### Step 4.1: Extender queries

- `getTopCustomersPage(params & { year })` — reemplaza el "90d hardcoded" por el rango del año seleccionado. Si `year='current'`, mantener 90d rolling para no romper semántica.
- `getReorderRiskPage(params & { year })` — filtrar por rango de órdenes recientes.
- Ya existen: `getSaleOrdersPage` tiene `dateRange`, exponer.

### Step 4.2: UI

`<YearSelector>` page-level + `dateRange` prop en las 2 tablas que no lo tienen (reorder risk, top customers).

### Step 4.3: Type-check + smoke + commit

```bash
git commit -m "feat(ventas): YearSelector page-level + dateRange en reorder risk + top customers"
```

---

## Task 5: `/empresas` — YearSelector

**Files:**
- Modify: `src/app/empresas/page.tsx`

### Step 5.1

El filtro year en empresas aplica a las métricas (revenue_ytd, last_order_date within year, etc.), no a la existencia del cliente.

Añadir `<YearSelector>`. Pasar el año a `getCompaniesPage({...params, year})` y en esa función usar el año para filtrar `last_activity_at` o similar.

**Decisión pragmática:** si el cliente tuvo actividad (cualquier invoice/order/payment) dentro del rango, aparece. Si no tuvo actividad en el año filtrado, se excluye de la vista.

### Step 5.2: Commit

```bash
git commit -m "feat(empresas): YearSelector — filtra por actividad dentro del año"
```

---

## Task 6: `/compras` — YearSelector en sub-páginas

**Files:**
- Modify: `src/app/compras/page.tsx` (si existe) + subrutas (`price-variance`, `stockouts`, `costos-bom`)

### Step 6.1

Leer las 3 subpáginas. Cada una:
- Añadir `<YearSelector>` page-level
- Extender queries de purchases/suppliers con `year?` param
- Exponer `dateRange` en tablas

Si alguna subpágina es puramente "snapshot actual" (ej: stockouts es por definición estado hoy), dejar sin year filter y añadir chip "(snapshot actual)".

### Step 6.2: Commit

```bash
git commit -m "feat(compras): YearSelector en price-variance + costos-bom; stockouts snapshot actual"
```

---

## Task 7: Crear `/pagos` — página nueva unificada

**Files:**
- Create: `src/app/pagos/page.tsx`
- Create: `src/app/pagos/_components/aging-cxc-card.tsx`
- Create: `src/app/pagos/_components/aging-cxp-card.tsx`
- Create: `src/app/pagos/_components/pagos-recibidos-table.tsx`
- Create: `src/app/pagos/_components/pagos-enviados-table.tsx`
- Create: `src/app/pagos/_components/complementos-sat-missing.tsx`
- Create: `src/lib/queries/unified/payments.ts` (si no existe ya)

### Step 7.1: Queries

Crear/extender `src/lib/queries/unified/payments.ts`:

```typescript
// Pagos recibidos (CxC) desde invoices_unified + payments_unified
export async function getPagosRecibidosPage(params: TableParams & { year?: YearValue }) {
  // SELECT de payments_unified WHERE direction='received' AND payment_date in year bounds
  // ORDER BY payment_date DESC, paginated
}

// Pagos enviados (CxP)
export async function getPagosEnviadosPage(params: TableParams & { year?: YearValue }) {
  // idem direction='sent'
}

// Aging CXC y CXP
export async function getAgingCXCSummary(year: YearValue) {
  // aggregates from company_profile.ar_aging_buckets
}
export async function getAgingCXPSummary(year: YearValue) {
  // similar pero para proveedores (usar invoices_unified direction='received' + residual)
}

// Complementos SAT missing (reconciliation_issues open del tipo complemento_missing_payment)
export async function getComplementosMissingPage(params: TableParams & { year?: YearValue }) {
  // SELECT FROM reconciliation_issues WHERE issue_type='complemento_missing_payment' AND resolved_at IS NULL
  // filtrar por metadata->>'fecha_pago' dentro del year
}
```

### Step 7.2: Page

`src/app/pagos/page.tsx`:

```tsx
import { YearSelector } from "@/components/patterns/year-selector";
import { parseYearParam } from "@/lib/queries/_shared/year-filter";
import { AgingCXCCard } from "./_components/aging-cxc-card";
import { AgingCXPCard } from "./_components/aging-cxp-card";
import { PagosRecibidosTable } from "./_components/pagos-recibidos-table";
import { PagosEnviadosTable } from "./_components/pagos-enviados-table";
import { ComplementosSATMissing } from "./_components/complementos-sat-missing";

export default async function PagosPage({ searchParams }: { searchParams: Record<string, string> }) {
  const year = parseYearParam(searchParams.year);

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Pagos</h1>
        <YearSelector />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <AgingCXCCard year={year} />
        <AgingCXPCard year={year} />
      </div>

      <ComplementosSATMissing year={year} searchParams={searchParams} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <PagosRecibidosTable year={year} searchParams={searchParams} />
        <PagosEnviadosTable year={year} searchParams={searchParams} />
      </div>
    </div>
  );
}
```

### Step 7.3: Implementar cada componente

Componentes async server components que llaman las queries + renderizan con `<DataTable>` reutilizable.

Cada uno:
- Recibe `year: YearValue` y `searchParams` (para paginación interna)
- Lee la query con paginación
- Renderiza con `<DataTablePagination>` y `<DataTableToolbar>`

**Nota:** si algún MV/view necesario para esto no existe (ej: `payments_unified` con direction recibida/enviada), crear migración SQL en `/Users/jj/supabase/migrations/` y documentar.

### Step 7.4: Añadir link en sidebar

Buscar la sidebar component (probable `src/components/sidebar.tsx` o similar), añadir entrada `/pagos` entre `/cobranza` y `/finanzas`.

### Step 7.5: Smoke test

```bash
pnpm dev & sleep 8
curl -s "http://localhost:3000/pagos?year=2025" 2>&1 | head -c 600
```

### Step 7.6: Commit

```bash
git add src/app/pagos src/lib/queries/unified/payments.ts src/components/sidebar.tsx
git commit -m "feat(pagos): nueva página unificada — aging CxC + CxP + complementos SAT + pagos recibidos/enviados"
```

---

## Task 8: DoD + PR

### Step 8.1: Validación "no limits silenciosos"

```
Grep pattern: "\\.limit\\(" path: src/lib/queries output_mode: content -n: true head_limit: 30
```
Expected: cada ocurrencia tiene comment `// intentional: top N` o contexto obvio.

### Step 8.2: Validación type-check + build

```bash
cd /Users/jj/quimibond-intelligence/quimibond-intelligence
pnpm type-check 2>&1 | tail -10
pnpm build 2>&1 | tail -30
```

### Step 8.3: Matrix de smoke tests manual

Páginas × años × casos básicos:

| Página | year=2026 (default) | year=2024 | year=all |
|---|---|---|---|
| /cobranza | KPIs + 4 tablas coherentes | histórico 2024 | todos los años |
| /finanzas | P&L YTD + proyecciones desde hoy | P&L 2024 + proyecciones desde hoy | P&L all-time + proyecciones |
| /ventas | idem |  |  |
| /empresas | solo clientes con actividad en 2026 | |  |
| /compras | idem |  |  |
| /pagos | idem |  |  |

Ejecuta cada celda con `curl localhost:3000/<ruta>?year=<X>` y verifica response shape razonable (status 200, contenido con data).

### Step 8.4: Push + PR

```bash
cd /Users/jj/quimibond-intelligence/quimibond-intelligence
git push -u origin fase-1-5-filtros

gh pr create --title "ui: Fase 1.5 — Filtros por año + página /pagos + quitar limits fake" --body "$(cat <<'EOF'
## Summary

Extensión de Fase 1 UI Unificada: añadir control temporal al usuario en todas las vistas unificadas.

## Changes

### Nuevo componente
- `<YearSelector>` reutilizable con URL state (`?year=2026`). Default año actual.
- `year-filter` helper con `yearBounds()`, `parseYearParam()`, `availableYears()`.

### Páginas actualizadas
- `/cobranza` — YearSelector + dateRange expuesto en 3 tablas (company aging, payment risk, predictions)
- `/finanzas` — YearSelector con override inteligente (histórico filtra, proyecciones siempre desde hoy con badge "(proyección)")
- `/ventas` — YearSelector + dateRange en reorder risk + top customers
- `/empresas` — YearSelector filtra por actividad en el año
- `/compras/price-variance`, `/compras/costos-bom` — YearSelector; `/compras/stockouts` mantiene snapshot actual

### Nueva página
- `/pagos` — unificada con aging CxC + CxP + complementos SAT missing + pagos recibidos/enviados

### Fixes
- `getUnifiedInvoicesForCompany`: eliminado `.limit(500)` silencioso → paginación real con `range(offset, offset+size)` y `totalCount`

## DoD
- [x] 0 `.limit(N)` en queries sin comment justificando "top N"
- [x] YearSelector visible en 6 páginas principales
- [x] `pnpm type-check` passing
- [x] Smoke tests: 5 páginas × 3 años × 1 caso básico

🤖 Generated with [claude-flow](https://github.com/ruvnet/claude-flow)
EOF
)"
```

### Step 8.5: Update memoria

Añadir a `/Users/jj/.claude/projects/-Users-jj/memory/project_supabase_audit_2026_04_19.md` sección estado:

```markdown
- **Fase 1.5 COMPLETADA** 2026-04-XX. PR #<n>.
  - YearSelector component + year-filter helper
  - 6 páginas con filtro por año (cobranza, finanzas, ventas, empresas, compras, pagos)
  - /pagos nueva página unificada
  - getUnifiedInvoicesForCompany paginado real (sin limit silencioso)
```

### Step 8.6: Reporte

```
STATUS: DONE
PR URL: <url>
```

---

## DoD de la fase

1. ✓ `<YearSelector>` component implementado + usado en 6 páginas
2. ✓ URL state vía `?year=YYYY` en todas las vistas (default current)
3. ✓ Queries extendidas con param `year?: YearValue`
4. ✓ `getUnifiedInvoicesForCompany` sin `.limit(500)` — paginación real
5. ✓ Página `/pagos` unificada creada
6. ✓ `/finanzas` con override inteligente (proyecciones fuera del filtro)
7. ✓ type-check + build pasan
8. ✓ PR abierto en frontend repo

## Out of scope

- Filtros combinados avanzados (mes dentro del año, quarter, custom range) — eso lo añadimos en Fase 2 si el usuario lo pide explícitamente
- Backend MV nuevos (este trabajo usa `invoices_unified`, `payments_unified`, `company_profile` que ya existen)
- Cambios visuales al layout general de páginas (solo añadimos el YearSelector arriba)
