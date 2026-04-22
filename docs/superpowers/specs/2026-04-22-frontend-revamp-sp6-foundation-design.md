# Frontend Revamp SP6 — Foundation Design

**Fecha:** 2026-04-22
**Autor:** Claude + Jose Mizrahi (brainstorm sesión)
**Branch:** `frontend-revamp-sp6-ui` (cortada de `main@d57a389`, post-SP5 cutover)
**Estado:** Draft — aprobado vía brainstorming, pendiente review del spec escrito
**Tamaño:** 1 foundation spec + 7 sub-specs por página (este documento = foundation, los 7 se generan después)

---

## 1. Contexto

Post-SP5 cutover, la capa de queries (`src/lib/queries/*`) ya consume canonical_* y gold_* exclusivamente. Las 7 páginas del CEO (`/inbox`, `/empresas`, `/cobranza`, `/finanzas`, `/ventas`, `/productos`, `/operaciones`) cargan sin errores, pero siguen renderizando con shapes preservados via back-compat aliases: no exponen la riqueza de los nuevos campos (priority_score, impact_mxn, blacklist_level, has_shadow_flag, source_pattern, estado_sat, match_confidence, action_cta, assignee_canonical_contact_id, etc.).

El objetivo de SP6 es rediseñar tablas y gráficas de esas 7 páginas para exponer la información que ya existe en Silver/Gold, bajo dos restricciones duras:

- **Solo shadcn/ui** (+ dependencias ya instaladas: `@radix-ui/*`, `recharts`, `lucide-react`, `class-variance-authority`, `tailwind-merge`). Sin nuevas librerías de UI.
- **Mobile-first estricto.** Viewport canónico 375px. El CEO usa iPhone >70% del tiempo (decisión de brainstorming).

Este documento es la **foundation** — sienta la base de design system, componentes compartidos, tokens, contratos transversales y convenciones — para que los 7 sub-specs de página subsecuentes compongan sin re-decidir.

---

## 2. Decisiones arquitectónicas (del brainstorming)

| # | Decisión | Alternativas descartadas |
|---|---|---|
| D1 | **Descomposición: 1 foundation + 7 sub-specs** | 1 spec monolítico · 3 sub-specs agrupados por dominio |
| D2 | **Reusar y endurecer `src/components/patterns/*`, consolidar quirúrgicamente** | Reconstrucción total desde shadcn crudo (A) · Reconstrucción scoped a las 7 páginas (A') · Greenfield v2 paralelo |
| D3 | **Mobile primario (>70% del uso)** — inversión fuerte en swipe/sheets/pull-to-refresh | Desktop primario · Split 50/50 |
| D4 | **Paleta semáforo desaturada** (moderno/minimalista, Linear/Vercel/Stripe aesthetic) | Shadcn chart defaults (naranja/teal/azul/amarillo/oro) · Semáforo saturado (neón) |
| D5 | **StatusBadge con prop `density`** — compact=dot+texto (Linear), regular=pill suave (Stripe) | Outline+dot (GitHub) · Leftbar (Notion) · Estilo único |

---

## 3. Alcance

### 3.1 Qué hace la foundation

1. **Consolidar** 2 familias de componentes con duplicación:
   - `Chart` unifica `DataView` + `DataViewChart` + `DataViewToggle` + `MiniChart`.
   - `StatusBadge` unifica `SeverityBadge` + `StatusBadge` legacy + `sat-badge` + `refresh-staleness-badge` + `<Badge>` ad-hoc.
2. **Agregar 5 componentes nuevos** al servicio de exponer canonical/gold:
   - `InboxCard` — tarjeta gold_ceo_inbox item con priority/severity/impact/age/cta/assignee.
   - `SwipeStack` — stack vertical scroll-snap para `/inbox` mobile (CSS puro, sin librería).
   - `AgingBuckets` — stacked bar reusable (current/1-30/31-60/61-90/90+) con click-to-filter.
   - `CompanyKpiHero` — header unificado para entity detail con blacklist/shadow badges + 4 KPIs + sparkline.
   - `TrendSpark` — sparkline mini embebible en `KpiCard`.
3. **Endurecer mobile** en los ~30 componentes que se mantienen: audit a 375×812, collapse a `MobileCard` bajo `sm:`, tap targets ≥44px, gestos touch donde aplique.
4. **Fijar contratos transversales:**
   - `chart-theme.ts` con paleta semántica `CHART_PALETTE` + tokens `--status-*`.
   - URL state vía `searchParams` (sin nuqs / Zustand / libs).
   - Empty / Loading / Error convention.
   - A11y baseline.
5. **Actualizar `docs/design-system.md`** con las decisiones tomadas.
6. **`/showcase` page** (`src/app/showcase/page.tsx`, ruta interna excluida manualmente del sidebar) renderizando cada componente nuevo y consolidado con datos reales de canonical/gold.

### 3.2 Qué NO hace la foundation

- **No rediseña ninguna de las 7 páginas en scope.** Eso es trabajo de los 7 sub-specs (`sp6-01-inbox`, `sp6-02-empresas`, `sp6-03-cobranza`, `sp6-04-finanzas`, `sp6-05-ventas`, `sp6-06-productos`, `sp6-07-operaciones`).
- **No toca 9 páginas fuera de scope:** `/`, `/briefings`, `/chat`, `/compras`, `/contactos`, `/directores`, `/equipo`, `/profile`, `/sistema`. Deben seguir funcionando sin cambios visibles.
- **No cambia la capa de queries** (`src/lib/queries/*`). Post-SP5 ya consume canonical/gold.
- **No introduce nuevas librerías de UI.** Solo lo ya instalado.
- **No dark mode toggle UI** — los tokens soportan ambos modos, el `theme-toggle.tsx` existente sigue funcionando.
- **No refactoriza tabs del detail `/empresas/[id]`** — eso es del sub-spec correspondiente.
- **No toca `app-sidebar.tsx`** — si requiere cambios para mobile sheet, se agendan en el sub-spec que lo motive.

---

## 4. Inventario de componentes

### 4.1 Agregar (5 nuevos)

| Componente | Fuente de datos | Páginas consumidoras (post-sub-specs) | Notas clave |
|---|---|---|---|
| `InboxCard` | `gold_ceo_inbox` row | `/inbox`, `/empresas/[id]` tab Insights | Props: `issue`, `onResolve`, `onAssign`. Renderiza priority_score chip + StatusBadge severity + impact_mxn pill + age_days + assignee avatar + action_cta button. Mobile = full-width, tap target 44px |
| `SwipeStack` | cualquier lista de items | `/inbox` mobile | CSS puro: `scroll-snap-type: y mandatory` en container, `scroll-snap-align: center` en cada child. Desktop = lista normal (sin scroll-snap, renderizada con grid) |
| `AgingBuckets` | aging agregado { current, d1_30, d31_60, d61_90, d90_plus } | `/cobranza`, `/empresas/[id]` Cobranza tab, `/finanzas` AR widget | StackedBar recharts con paleta semáforo gradient. Click a bucket dispara callback `onBucketClick(bucket)` que el consumer usa para filtrar su tabla |
| `CompanyKpiHero` | `gold_company_360` + `canonical_companies` | `/empresas/[id]`, futuro `/proveedores/[id]` | Props: `company360`, `canonical`. Renderiza display_name, rfc, `<StatusBadge kind="blacklist">` (si != none), `<StatusBadge kind="shadow">` (si has_shadow_flag), 4 KPIs (LTV, YTD, overdue, open_issues) en `StatGrid`, + `TrendSpark` revenue 90d |
| `TrendSpark` | series numérica | Embebido en `KpiCard` | Recharts LineChart 60×20px. Sin ejes, sin tooltips. Color auto según direccionalidad (up=`--status-ok`, down=`--status-critical`, flat=`--status-muted`) |

### 4.2 Consolidar (4+5 → 2)

**`Chart`** reemplaza `DataView` + `DataViewChart` + `DataViewToggle` + `MiniChart`:

```tsx
<Chart
  type="line" | "area" | "bar" | "stackedBar" | "pie" | "sparkline"
  data={...}
  series={[{ key, label, color? }]}
  xKey
  yFormatter?
  height?
  ariaLabel  // requerido — screen reader summary
/>
```

- Wraps `ResponsiveContainer` + recharts primitive según `type`.
- Color default = `CHART_PALETTE.series[i]` si no se especifica `color` por serie; soporta tokens semánticos (`"positive"`, `"negative"`, etc.).
- Si `type="sparkline"` → sin ejes/tooltips, altura default 20.
- Los 4 wrappers viejos se renombran a `*.deprecated.tsx` como re-exports con JSDoc `@deprecated`. Se borran en cada sub-spec cuando se migra el último consumer.

**`StatusBadge`** reemplaza `SeverityBadge` + `StatusBadge` legacy + `sat-badge` + `refresh-staleness-badge` + `<Badge>` ad-hoc:

```tsx
<StatusBadge
  kind="severity" | "reconciliation" | "match" | "estado_sat" | "payment" | "blacklist" | "shadow" | "staleness" | "generic"
  value={...}
  density="compact" | "regular"  // default: "compact"
  variant?="dot" | "pill" | "outline" | "leftbar"  // default auto por density: compact→dot, regular→pill. outline/leftbar = escape hatch
  ariaLabel?  // override del default semántico
/>
```

- Mapeo interno `kind + value → { color token, label, icon?, ariaLabel }` en `src/components/patterns/status-badge-mapping.ts`.
- `compact`: Linear-style, `●` + texto, sin background, ideal en rows de tabla / listas densas / sidebar.
- `regular`: Stripe-style, pill tinted (12-18% bg opacity), ideal en detail headers / KPI cards / `InboxCard`.
- Nunca falla silenciosamente: si `kind + value` no mapea, lanza warning en dev + renderiza `kind="generic"`.

### 4.3 Mantener y endurecer (~32 componentes)

API pública estable. Internals endurecidos: audit 375px, collapse a `MobileCard` bajo `sm:`, a11y baseline.

`DataTable`, `DataTableToolbar`, `DataTablePagination`, `KpiCard`, `StatGrid`, `MetricRow`, `MobileCard`, `BottomSheet`, `PullToRefresh`, `EmptyState`, `LoadingCard/Table/List`, `TrendIndicator`, `FilterBar`, `PageLayout`, `PageHeader`, `SectionNav`, `SectionHeader`, `Currency`, `DateDisplay`, `CompanyLink`, `EvidenceChip`, `EvidenceTimeline`, `EvidencePackView`, `InvoiceDetailView`, `PredictionCard`, `PersonCard`, `SelectionProvider`, `BatchActionBar`, `RowCheckbox`, `PeriodSelector`, `YearSelector`, `GroupByToggle`, `ConfirmDialog`.

### 4.4 Decomisar (audit uno-por-uno en foundation)

Candidatos con `<3` callers o uso trivial colapsable a shadcn primitive:

- `TableDensityToggle`, `TableViewOptions`, `TableExportButton` — dudoso que se usen en mobile primario. Si audit confirma `<3` callers o uso trivial, se mueven a `_legacy/` con TODO SP7 para borrar. Si tienen uso real, se mantienen con hardening mobile.
- `data-view.tsx`, `data-view-chart.tsx`, `data-view-toggle.tsx` — cubiertos por `Chart`. Se mueven a re-export deprecated.
- `mini-chart.tsx` — fusionado en `Chart type="sparkline"`. Re-export deprecated.
- `sat-badge.tsx`, `refresh-staleness-badge.tsx` — fusionados en `StatusBadge`. Re-export deprecated.

Balance neto esperado: **+5 nuevos, -8 consolidados en 2, -3 a -6 decomisos pendientes de audit ⇒ net ≈ -6 a -9 archivos**.

---

## 5. Design tokens y chart theme

### 5.1 Paleta semáforo desaturada (modern/minimalist)

Agrego a `src/app/globals.css` en ambos modos light y dark:

```css
:root {
  /* Traffic-light status tokens (SP6 foundation) */
  --status-ok:        oklch(0.72 0.14 155);  /* verde salvia */
  --status-warning:   oklch(0.78 0.12 75);   /* ámbar cálido */
  --status-critical:  oklch(0.62 0.20 25);   /* coral, no neón */
  --status-info:      oklch(0.66 0.12 235);  /* azul apagado */
  --status-muted:     oklch(0.60 0.02 235);  /* gris neutro */

  /* Aging 5-stop gradient */
  --aging-current:  var(--status-ok);          /* verde */
  --aging-1-30:     oklch(0.75 0.14 120);      /* verde-lima */
  --aging-31-60:    var(--status-warning);     /* ámbar */
  --aging-61-90:    oklch(0.70 0.18 50);       /* naranja */
  --aging-90-plus:  var(--status-critical);    /* rojo */
}

.dark {
  /* Aumentar luminosidad +0.08 para WCAG AA sobre fondo oscuro */
  --status-ok:        oklch(0.80 0.14 155);
  --status-warning:   oklch(0.85 0.12 75);
  --status-critical:  oklch(0.70 0.20 25);
  --status-info:      oklch(0.74 0.12 235);
  --status-muted:     oklch(0.70 0.02 235);

  --aging-current:  var(--status-ok);
  --aging-1-30:     oklch(0.82 0.14 120);
  --aging-31-60:    var(--status-warning);
  --aging-61-90:    oklch(0.78 0.18 50);
  --aging-90-plus:  var(--status-critical);
}
```

Los `--chart-1..5` existentes **se preservan sin cambios** — se usan exclusivamente para series multi-categoría sin semántica inherente (top 5 clientes, departamentos, etc.).

### 5.2 `chart-theme.ts` — paleta semántica

```typescript
// src/lib/chart-theme.ts
export const CHART_PALETTE = {
  positive:    "var(--status-ok)",
  warning:     "var(--status-warning)",
  negative:    "var(--status-critical)",
  neutral:     "var(--status-info)",
  muted:       "var(--status-muted)",

  aging: {
    current:  "var(--aging-current)",
    d1_30:    "var(--aging-1-30)",
    d31_60:   "var(--aging-31-60)",
    d61_90:   "var(--aging-61-90)",
    d90_plus: "var(--aging-90-plus)",
  },

  series: [
    "var(--chart-1)",
    "var(--chart-2)",
    "var(--chart-3)",
    "var(--chart-4)",
    "var(--chart-5)",
  ],
} as const;
```

Mapeo de uso:

| Contexto | Token |
|---|---|
| Ingresos, net income, on-time, paid, current AR | `positive` |
| Gastos, partial, stale, shadow, aging 31-60 | `warning` |
| Overdue, critical, blacklist, unbalanced, aging 90+ | `negative` |
| Baseline, comparativos, unmatched, aging 1-30 | `neutral` |
| Inactivo, histórico, low-priority | `muted` |
| Series sin semántica (top 5 clientes, deptos) | `series[0..4]` |

### 5.3 StatusBadge variant mapping

`src/components/patterns/status-badge-mapping.ts`:

| kind | value | color token | `aria-label` base (es-MX) |
|---|---|---|---|
| severity | critical | critical | "Severidad crítica" |
| severity | high | warning | "Severidad alta" |
| severity | medium | warning | "Severidad media" |
| severity | low | muted | "Severidad baja" |
| blacklist | 69b_definitivo | critical | "Lista negra 69B definitivo" |
| blacklist | 69b_presunto | warning | "Lista negra 69B presunto" |
| blacklist | none | — (no render) | — |
| shadow | true | warning (dashed outline, ícono Ghost) | "Empresa sombra — no confirmada en Odoo" |
| payment | paid | ok | "Pagada" |
| payment | partial | warning | "Pago parcial" |
| payment | not_paid | critical | "Sin pagar" |
| payment | in_payment | info | "En proceso de pago" |
| estado_sat | vigente | ok | "CFDI vigente" |
| estado_sat | cancelado | critical | "CFDI cancelado" |
| match | ≥0.9 | ok | "Match de alta confianza" |
| match | 0.6–0.9 | warning | "Match de confianza media" |
| match | <0.6 | critical | "Match de baja confianza" |
| reconciliation | unmatched | info | "Sin reconciliar" |
| staleness | fresh | ok | "Datos recientes" |
| staleness | stale | critical | "Datos desactualizados" |

Íconos Lucide por kind: severity→`AlertCircle`, blacklist→`Ban`, shadow→`Ghost`, payment→`CheckCircle2/Clock/XCircle`, estado_sat→`FileCheck/FileX`, match→`Link/Unlink`, staleness→`Clock`.

### 5.4 Breakpoints mobile-first

Tailwind defaults, viewport canónico **375×812** (iPhone 13/14/15 base):

| Breakpoint | Width | Layout |
|---|---|---|
| base | <640px | 1 col. DataTable → MobileCard stack. Sidebar → Sheet drawer. Bottom tab bar visible. |
| `sm:` | ≥640 | 2 col KPIs. Tablas visibles. Filtros inline. |
| `md:` | ≥768 | 3 col KPIs. Sidebar permanente. Tabs horizontales. |
| `lg:` | ≥1024 | 4 col KPIs. Layout desktop completo. Drawers → side panels. |
| `xl:`/`2xl:` | ≥1280/1536 | Max content width 1440px, sin stretching. |

### 5.5 Mobile interaction primitives

- **Tap target ≥44×44px** en todo lo clickeable (Apple HIG).
- **Swipe horizontal** en rows de tabla → revela acciones (Resolve/Dismiss) via `BottomSheet`. Opt-in por página.
- **Pull-to-refresh** en `/inbox` y `/cobranza`. Otras páginas no.
- **Sticky bottom actions** en detail pages — CTA principal siempre alcanzable con pulgar.
- **Scroll-snap** CSS en `SwipeStack`.
- **No hover-only UI.** Todo lo que hoy aparece en hover tiene equivalente touch.

---

## 6. Contratos transversales

### 6.1 URL state

- Fuente de verdad: `searchParams` de Next.js 15. Sin librerías de client-state (no nuqs, no Zustand).
- Keys canónicas: `q` (search), `severity`, `status`, `from`, `to` (ISO), `page` (1-based), `sort` (ej. `-ltv_mxn`), `view` (`table|chart`), `density`.
- Helper nuevo `src/lib/url-state.ts`:
  - `parseSearchParams<T>(raw, schema: z.ZodSchema<T>) → T` — valida con zod (ya instalado, `zod@^4.3.6`). Páginas declaran un schema zod pequeño por página; el helper aplica `.catch()` con defaults para que URLs inválidas no rompan la página.
  - `toSearchString(params) → string` — build para `router.push`; elimina keys con valor vacío/default.
- Back-button y links compartibles funcionan por construcción.

### 6.2 Empty / Loading / Error

- **Loading**: `<Suspense fallback={<LoadingCard | LoadingTable | LoadingList />}>` granular por sección. Nunca un skeleton gigante bloqueando la página completa.
- **Empty**: `<EmptyState>` con icono Lucide + heading + description + CTA opcional. Textos en español neutro, sin jerga técnica. La descripción apunta a la siguiente acción.
- **Error**: `error.tsx` por route group. Renderiza shadcn `<Alert variant="destructive">` + `<Button onClick={reset}>`. Nunca stack trace al usuario. `console.error(error)` para captura en Vercel.

### 6.3 A11y baseline

- Rows/cards clickeables: `role="button" tabIndex={0}` + `onKeyDown` Enter/Space.
- StatusBadge: `aria-label` semántico en español.
- Charts: `role="img"` + `aria-label` resumen + tabla `.sr-only` adyacente con datos crudos.
- Color no es único portador de significado: cada estado crítico tiene ícono Lucide.
- Contraste WCAG AA (4.5:1 texto, 3:1 UI) verificado en dark mode.
- `<html lang="es-MX">` en `layout.tsx` (verificar).
- Botones icon-only: `aria-label` obligatorio.

### 6.4 Testing strategy

- **Vitest component tests** para los 5 nuevos (`InboxCard`, `SwipeStack`, `AgingBuckets`, `CompanyKpiHero`, `TrendSpark`) + `Chart` + `StatusBadge`. Assert rendering con datos representativos, states (empty/error), a11y attrs.
- **Playwright e2e** único `e2e/foundation.spec.ts` que carga `/_showcase`, screenshots mobile (375×812) + desktop (1440×900), verifica tap target ≥44px en CTAs.
- **Axe-core** corrido en el showcase — 0 violaciones críticas, warnings documentados.
- No visual regression tooling (YAGNI).
- CI bloqueante: `npm run test` + `npm run e2e`.

---

## 7. `/showcase` page

- Ruta: `/showcase` (`src/app/showcase/page.tsx`). Ruta accesible vía URL directa.
- **Excluida manualmente de `app-sidebar.tsx`.** El sidebar es hardcoded (no auto-generado); basta no agregar el item. No depende del naming trick de Next.js (`_folder` sí excluye del routing, pero eso también rompe acceso directo — no sirve aquí).
- `export const dynamic = "force-dynamic"` — evita pre-rendering y depende de env vars en runtime.
- Gate opcional: renderizar `notFound()` cuando `process.env.NODE_ENV === "production" && !process.env.NEXT_PUBLIC_ENABLE_SHOWCASE`. Decisión final en el plan (default: visible en todos los entornos, documentado).
- Renderiza cada componente nuevo + consolidado con datos reales via helpers SP5 (`listInbox`, `fetchCompany360`, `invoicesReceivableAging`, `fetchTopCustomers`, etc.).
- Sirve como:
  - Verificación visual en branch antes de rebuilds de páginas.
  - Base para screenshot del Playwright e2e.
  - Documentación viva del design system.

---

## 8. Migration strategy (back-compat)

- **Consolidaciones usan shim pattern.** Wrappers viejos se renombran a `*.deprecated.tsx` como re-exports con JSDoc `@deprecated`. Compilan bien. Las 9 páginas fuera de scope los siguen usando sin cambios visibles.
- Los 7 sub-specs de página migran los imports de deprecated-wrappers a los nuevos al rediseñar cada página. Cuando el último consumer migra, el sub-spec correspondiente borra el wrapper.
- **StatusBadge cutover:** el viejo `StatusBadge` genérico se preserva como modo `kind="generic"` del nuevo API; el file viejo se vuelve re-export. `SeverityBadge` se mantiene re-exportado con `@deprecated`.
- **Tokens aditivos, no sustitutivos.** `--chart-1..5` se preservan. Solo se agregan `--status-*` y `--aging-*`.

---

## 9. Definition of Done

Foundation PR no se mergea hasta que los 11 gates pasen:

1. **5 componentes nuevos** implementados + exportados en `src/components/patterns/index.ts` con tests Vitest.
2. **Chart primitive** reemplaza 4 wrappers viejos (deprecated re-exports conservados).
3. **StatusBadge consolidado** reemplaza 4 badges (deprecated re-exports conservados).
4. **Tokens `--status-*` y `--aging-*`** en `globals.css` (light + dark) + `chart-theme.ts` con `CHART_PALETTE` semántico.
5. **URL state helpers** en `src/lib/url-state.ts` con tests unitarios.
6. **`/_showcase` page** renderiza los 5 nuevos + Chart + StatusBadge con datos reales.
7. **Mobile audit completo** — ~30 componentes preservados probados a 375×812, regresiones fixed in place, reporte breve en PR description.
8. **A11y audit con axe-core** en `/_showcase` — 0 violaciones críticas, warnings documentados.
9. **`docs/design-system.md` actualizado** con nuevas decisiones.
10. **CI verde**: `npm run build` (con `NODE_OPTIONS=--max-old-space-size=8192`), `npm run test`, `npm run e2e`.
11. **9 páginas fuera de scope** (`/`, `/briefings`, `/chat`, `/compras`, `/contactos`, `/directores`, `/equipo`, `/profile`, `/sistema`) siguen funcionando sin cambios visibles — smoke test por página.

---

## 10. Branch / PR flow

- Branch: `frontend-revamp-sp6-ui` (ya cortada desde `main@d57a389`).
- Commits atómicos por componente (`feat(patterns): add InboxCard`, `refactor(patterns): consolidate Chart primitive`, etc.).
- PR único **"SP6 Foundation — design system revamp"** → mergea a `main` cuando 11/11 DoD gates pasan.
- Los 7 sub-specs posteriores se cortan como branches **hijas de `main` post-merge** (no en cadena; cada una independiente).
- User mergea manualmente vía `gh pr merge N --merge --delete-branch`.

---

## 11. Non-goals (explícitos)

- Rediseñar las 7 páginas en scope. (Es trabajo de los 7 sub-specs posteriores.)
- Migrar las 9 páginas fuera de scope a nuevos tokens/componentes.
- Cambiar la capa de queries.
- Introducir librerías nuevas.
- Dark mode toggle UI.
- Refactorizar tabs del detail `/empresas/[id]`.
- Tocar `app-sidebar.tsx`.
- Visual regression testing (Chromatic/Percy).

---

## 12. Referencias

- Arquitectura Silver: `docs/superpowers/specs/2026-04-21-silver-architecture.md` §13.1 (frontend query contracts).
- SP5 cutover: `docs/superpowers/plans/2026-04-21-silver-sp5-cutover.md` + notes.
- Schema drift (post-SP5): `/Users/jj/.claude/projects/-Users-jj/memory/project_silver_sp5_schema_drift.md`.
- Design system actual: `docs/design-system.md` (se actualiza en foundation).
- Project CLAUDE.md: convenciones globales.
