# SP13 — Frontend Rebuild (data-first)

**Fecha:** 2026-04-23
**Supersede:** SP6 (foundation + sub-specs) — abandonado
**Status:** Foundation spec. Pending per-page sub-specs SP13.1–SP13.8.

---

## Por qué

Auditoría KPI (`2026-04-23-frontend-kpi-audit-design.md`) encontró que los números "incorrectos" no son bugs de datos sino de **semántica y presentación**:

- El P&L contable y la facturación SAT se muestran como si fueran lo mismo (gap promedio 15-20%, caso extremo 45% en marzo 2026).
- Historiales truncados a 12 meses cuando canonical tiene 60.
- Tablas con columnas que no accionan decisiones.
- Métricas cuyo cálculo el usuario no entiende (overhead estimado, margen real).
- Páginas que no responden a preguntas concretas del CEO.
- Números sin comparación (vs mes pasado, vs año, vs meta).
- Ninguna evidencia de dónde viene cada número.

**Decisión:** rebuild total con principios data-first, no parches.

---

## Principios de diseño

### P1 — Cada página responde preguntas, no muestra tablas

Cada sección tiene un nombre que es una pregunta, no un dataset. Prohibido:

- ❌ "Top clientes" (sin pregunta)
- ✅ "¿Quiénes me compran más este trimestre?"

- ❌ "Reorder risk"
- ✅ "¿Quién dejó de comprarme y debería llamarle?"

- ❌ "Pedidos del mes"
- ✅ "¿Qué órdenes están abiertas este mes y en qué estado van?"

**Implementación:** `<QuestionSection title="..." answer={...}>` — wrapper de Section que fuerza el framing.

### P2 — Cada número trae su fuente visible

Todo KPI y toda celda con valor MXN trae un `<SourceBadge>` con el origen, y cuando hay divergencia entre fuentes (SAT vs P&L, Odoo vs Syntage), trae un `<DriftPill>` clickable que muestra el detalle.

Ejemplo:

```
Ingresos mes    [SAT]  $8.31M   ↑ +12% vs marzo
                [P&L]  $7.38M   ⚠ -11% vs SAT (IVA + ajustes)
```

**Primitiva:** `<KpiCard value sources={[{source, value}]} comparison>`.

### P3 — Cada número trae contexto

Prohibido mostrar un número sin comparación. Toda KpiCard incluye al menos UNA de:

- MoM (vs mes anterior)
- YoY (vs mismo mes año pasado)
- vs meta (cuando la hay)
- vs promedio LTM

**Implementación:** `<KpiCard comparison={{ label, value, delta, deltaPct, direction }}>`. Si no se puede calcular, el helper devuelve `comparison: null` y la card lo indica explícitamente (no lo oculta).

### P4 — Cada métrica se auto-explica

Todo KPI y todo encabezado de columna tiene un tooltip (`<MetricTooltip>`) con:

- **Definición** (qué mide)
- **Fórmula** (cómo se calcula)
- **Fuente** (qué tabla/view/columna)
- **Ejemplo** (un caso concreto)

Para métricas derivadas (Margen real %, DSO, OTD), el tooltip incluye el decomposition.

### P5 — Tablas minimalistas por default

Reglas duras:

- **Máximo 6 columnas visibles por default**, el resto `defaultHidden`.
- Cada columna visible justifica su existencia respondiendo: "¿qué acción toma el usuario al ver este valor?". Si no hay respuesta clara, va a `defaultHidden` o se elimina.
- Columnas numéricas siempre con formato consistente (tabular-nums, miles con coma, 2 decimales MXN, compact ≥ 10k).
- Cada fila clickable → vista de detalle (no re-ordenar en la misma página).

### P6 — Historiales abiertos por default

Ningún helper hardcodea `months = 12`. Todos aceptan `{from, to}` y toda página con serie temporal expone `<HistorySelector>` con opciones:

- MTD (mes actual)
- YTD (año actual)
- LTM (últimos 12 meses)
- 3y
- 5y
- All (límite = lo que haya en canonical)

Default por página: decisión per-spec (ej. /ventas default LTM, /cobranza default MTD).

### P7 — Drift como ciudadano de primera

Cuando las fuentes divergen, no se esconde — se muestra como insight.

Ejemplo: marzo 2026 tiene $13.4M en CFDIs timbrados que no están asentados en P&L. Eso NO es un bug de UI, es información operativa. La página /ventas debe mostrarlo como alerta ("⚠ $13.4M timbrados sin booking contable en marzo — revisar").

**Primitiva:** `<DriftAlert>` — banner en páginas afectadas.

### P8 — Sin bronze legacy

Ningún helper lee de `contacts`, `companies`, `odoo_*`, `syntage_*`, `v_*` salvo excepciones documentadas (/sistema diagnostic). Todo viene de `canonical_*` o `gold_*`. Si un dato no existe en canonical, se abre ticket para canonicalizarlo, no se consume bronze.

---

## Primitivas nuevas/extendidas

La foundation SP6 (PR #52, c989f98) dejó primitives utilizables: `PageLayout`, `PageHeader`, `SectionNav`, `StatGrid`, `DataTable`, `DataView`, `MobileCard`, `TableViewOptions`, `PeriodSelector`. **Se mantienen.**

Nuevas o extendidas en SP13:

| Primitiva | Estado | Qué hace |
|---|---|---|
| `<KpiCard>` | extender | Acepta `sources[]` + `comparison` + `definition` + `asOfDate` |
| `<SourceBadge source>` | nueva | Pill: SAT / Odoo / P&L / Syntage / Mixed / Canonical |
| `<DriftPill>` | nueva | Clickable, abre popover con sources[] y diff |
| `<MetricTooltip>` | nueva | Wraps any label, opens `{definition, formula, source, example}` |
| `<HistorySelector>` | nueva | Reemplaza PeriodSelector. Options: MTD/YTD/LTM/3y/5y/All |
| `<QuestionSection>` | nueva | Section wrapper con pregunta como título |
| `<DriftAlert>` | nueva | Banner para divergencias sistémicas (ej: marzo 2026) |
| `<ComparisonCell>` | nueva | Cell de tabla con value + delta + color |

---

## Contrato de helpers de datos

Todo helper de KPI devuelve la forma:

```ts
interface KpiResult<T = number> {
  value: T;
  asOfDate: string;               // ISO
  source: SourceLabel;            // 'sat' | 'pl' | 'odoo' | 'canonical' | ...
  definition: {
    title: string;                // "Ingresos del mes"
    description: string;          // "Suma de facturación SAT del mes actual..."
    formula: string;              // "SUM(amount_total_mxn_resolved) WHERE ..."
    table: string;                // "canonical_invoices"
  };
  comparison: {
    label: string;                // "vs mes anterior"
    priorValue: T;
    delta: T;
    deltaPct: number | null;
    direction: 'up' | 'down' | 'flat';
  } | null;
  sources?: Array<{               // Only when multi-source
    source: SourceLabel;
    value: T;
    diffFromPrimary: T;
    diffPct: number;
  }>;
  drift?: {                       // Only when sources diverge significantly
    severity: 'info' | 'warning' | 'critical';
    message: string;
  } | null;
}
```

Todo helper de serie temporal:

```ts
interface TimeSeries<T = number> {
  points: Array<{ period: string; value: T; source: SourceLabel }>;
  fullRange: { earliest: string; latest: string };
  selectedRange: { from: string; to: string };
  source: SourceLabel;
}
```

---

## Page structure pattern (default)

Cada página sigue esta estructura salvo que un sub-spec justifique desviación:

1. **Hero question** — `<PageHeader>` con la pregunta principal de la página
2. **Primary answer** — 1-3 `<KpiCard>` grandes con el número que responde la pregunta
3. **Drift alert** (si aplica) — `<DriftAlert>` cuando hay divergencia sistémica
4. **Comparison** — `<StatGrid>` con KPIs de contexto (MoM, YoY, segmentaciones)
5. **Secondary questions** — `<QuestionSection>` por cada pregunta secundaria con su respuesta
6. **Action zone** — al final, "¿Qué hacer?" con links a otras páginas o CTAs

Prohibido: dumping de tablas sin pregunta arriba.

---

## Roadmap de decomposición

Cada `SP13.x` es un sub-proyecto independiente: brainstorm → spec → plan → implementation.

| # | Sub-proyecto | Prioridad | Notas |
|---|---|---|---|
| SP13.0 | Foundation primitives (este spec + código) | Blocker | Todo lo demás depende |
| SP13.1 | `/ventas` (canary) | P1 | Demuestra el patrón end-to-end |
| SP13.2 | `/finanzas` | P1 | Segundo más crítico (cash + runway) |
| SP13.3 | `/cobranza` | P1 | Reemplaza SP6-03; AR $285M, overdue $67M |
| SP13.4 | `/compras` | P2 | Migra a canonical |
| SP13.5 | `/empresas` (lista + detail) | P2 | Reemplaza SP6-02 |
| SP13.6 | `/inbox` | P2 | Reemplaza SP6-01 |
| SP13.7 | `/operaciones` + `/productos` | P3 | Puede incorporar SP11 stock-vs-accounting widgets |
| SP13.8 | Resto: `/equipo` `/directores` `/briefings` `/contactos` `/sistema` `/chat` `/showcase` `/profile` `/login` | P3 | Varios pueden quedar igual |

---

## Metas de éxito por sub-proyecto

Cada página terminada en SP13.x debe cumplir:

1. Cada KPI usa `KpiResult` contract con source/comparison/definition.
2. Toda tabla tiene ≤6 cols visibles default, tooltips en headers.
3. Toda serie temporal tiene `HistorySelector` abierto (no 12m hardcoded).
4. Ninguna lectura de bronze (salvo excepciones explícitas).
5. Responde al menos 2 preguntas concretas arriba del fold (mobile).
6. Drift alerts visibles cuando aplican.
7. Passes `npm run build` + `tsc --noEmit` + axe a11y.
8. Tests: 1 integration + 1 axe por página mínimo.

---

## Out of scope

- Autenticación, login, `/profile` (no tocar salvo bug crítico)
- API routes (`/api/*`) salvo que un sub-spec lo requiera
- El pipeline de agentes, evolve, learn (son separados)
- La migración de canonical de tablas faltantes (se abre ticket separado si aparece)
- Performance optimization (dedicarle una pasada al final)
- Mobile-specific rebuild (seguimos responsive-first del SP6 foundation)

---

## Orden de trabajo propuesto

**Sesión 1** (siguiente) — SP13.0 foundation primitives:
1. Implementar `SourceBadge`, `DriftPill`, `MetricTooltip`, `HistorySelector`, `QuestionSection`, `DriftAlert`, `ComparisonCell`
2. Extender `KpiCard` con sources/comparison/definition
3. Definir types + helpers en `src/lib/kpi/` (new module)
4. Showcase page (`/showcase/sp13`) con todos los primitives en estado happy/edge
5. Tests de primitives

**Sesión 2** — SP13.1 /ventas canary:
1. Brainstorm (qué preguntas responde /ventas)
2. Spec + plan
3. Implementación usando primitives de SP13.0
4. Validar contra ground truth (SAT $8.31M abril MTD, etc.)

**Sesión 3+** — SP13.2+ en orden.

---

## Decisiones cerradas (defaults confirmados 2026-04-23)

1. **Nomenclatura de fuente:** simple, 4 labels canónicos: `'sat' | 'pl' | 'odoo' | 'canonical'`. Si un sub-spec necesita más granularidad, amplía enum ahí.
2. **Default history por página:** caso-por-caso en cada sub-spec (no unánime). /cobranza→MTD, /ventas→LTM, /finanzas→MTD. Cada sub-spec justifica el default.
3. **Meta/targets:** no existe tabla en Supabase. Diferido a P3. Las cards de SP13.0 omiten "vs meta" en la comparison enum; se agrega cuando exista la tabla.
4. **Preguntas canónicas del CEO:** no se bloquea SP13.0. Cada sub-spec (SP13.1+) abre con brainstorm de "qué 3-5 preguntas responde esta página"; propuesta inicial va en el spec y el usuario valida.

---

## Antecedentes

- Audit origen: `docs/superpowers/specs/2026-04-23-frontend-kpi-audit-design.md`
- SP6 foundation merged (primitives reutilizables): PR #52 c989f98
- Canonical migration sweep: `project_canonical_migration_2026_04_23.md`
- Ground truth verificado contra Supabase hoy 2026-04-23

---

## Review request

Este spec define principios + roadmap. Aún NO toca código. Pide al usuario revisar:

- ¿Principios P1–P8 alineados con lo que pide?
- ¿Orden de decomposición correcto (/ventas primero como canary)?
- ¿Decisiones abiertas (4) tienen respuesta?

Una vez aprobado, el siguiente paso es brainstorming SP13.0 (¿qué primitives exactas + contract de API de KPI?) antes de escribir el plan de implementación.
