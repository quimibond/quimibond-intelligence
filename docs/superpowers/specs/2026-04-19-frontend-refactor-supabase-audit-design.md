# Frontend Refactor + Supabase Audit — Design Spec

**Fecha:** 2026-04-19
**Status:** Spec approved, pending implementation plan
**Origen:** `docs/superpowers/specs/2026-04-19-frontend-refactor-handoff.md` (handoff prompt original)
**Tiempo estimado:** 6-8h
**Baseline commit:** `a3bd5a0`

---

## 1. Objetivo

Eliminar el feel de "desorganización" del frontend de Quimibond Intelligence y consolidar la capa de data en Supabase. Específicamente:

1. Jerarquía de navegación clara (sidebar con 4 grupos).
2. Naming consistente en español para rutas ejecutivas.
3. Design system documentado + componentes canónicos reutilizables.
4. Queries y componentes organizados por dominio.
5. Capa Supabase con naming convention L1-L5 consistente, sin views huérfanas.
6. Data gaps de alto valor integrados al frontend.

Lo que **no** busca este refactor: cambiar arquitectura de agentes, modificar Layer 3 fiscal de Fase 6, rediseñar insights, tocar addon Odoo.

---

## 2. Decisiones de diseño (resueltas en brainstorm 2026-04-19)

| # | Decisión | Resolución |
|---|---|---|
| 1 | Orden de fases | **C Interleaved** — S1 → F1 → F2 → S3 → F3 → F4. S1 primero desbloquea F3 (queries reorg) con nombres canónicos. S2 (Data Quality) se omite. |
| 2 | Sidebar | **A · 4 grupos collapsibles** — Decisión / Operación / Entidades / Sistema. Estado colapsado persiste en localStorage. |
| 3 | Renames a español | **Todos** — `/agents→/directores`, `/system→/sistema`, `/companies→/empresas`, `/contacts→/contactos`. 301 redirects permanentes. |
| 4 | Home page | **A · `/inbox` se queda** — no hay `/dashboard` nuevo. |
| 5 | Scope Supabase | **C · S1 + S3** — Audit organización + Data utilization. S2 (Data Quality) queda OUT (existen `dq_*` views). |
| 6 | Validación | **A · V1-V4 antes de cada commit** — lint + tsc + test + build. `main` auto-deploya a prod, un build roto rompe producción. |
| 7 | F2 v2 vs patterns | **A · Renombrar v2 → patterns + agregar 3 faltantes** — no crear duplicados. `shared/v2` ya tiene 30+ componentes canónicos. |

---

## 3. Arquitectura

```
         ┌──────────────────────────────────────────────┐
         │ Supabase (6 layers, naming convention)       │
         │  L1 raw:      odoo_* syntage_*               │
         │  L2 canonical: companies, contacts, entities │
         │  L3 unified:  invoices_unified MV, ...       │
         │  L4 analytics: analytics_* (14 aliases)      │
         │  L5 intel:    agent_insights, ai_agents, ... │
         └────────────────┬─────────────────────────────┘
                          │  read via typed queries
         ┌────────────────┴─────────────────────────────┐
         │ src/lib/queries/ (reorganizado por dominio)  │
         │  fiscal/ operational/ unified/ analytics/    │
         │  intelligence/ _shared/                      │
         └────────────────┬─────────────────────────────┘
                          │
         ┌────────────────┴─────────────────────────────┐
         │ src/components/                              │
         │  ui/       shadcn primitives (no tocar)      │
         │  patterns/ PageLayout, PageHeader, DataTable │
         │  domain/   feature-specific components       │
         │  shared/   legacy (migrar a patterns/domain) │
         └────────────────┬─────────────────────────────┘
                          │
         ┌────────────────┴─────────────────────────────┐
         │ src/app/ (16 rutas + sidebar + renames ES)   │
         │  Decisión:  /inbox /briefings /chat          │
         │  Operación: /ventas /cobranza /compras ...   │
         │  Entidades: /empresas /contactos /productos  │
         │  Sistema:   /directores /sistema             │
         │  Shell:     /login /profile                  │
         └──────────────────────────────────────────────┘
```

---

## 4. Fases

### 4.1 S1 — Audit de organización Supabase (~1h)

**Objetivo:** inventariar el esquema, renombrar views huérfanas, detectar tablas never-read.

**Pasos:**

1. Ejecutar inventory query (handoff §S1.1) vía `mcp__claude_ai_Supabase__execute_sql`:
   ```sql
   SELECT table_schema, table_type,
     CASE
       WHEN table_name LIKE 'odoo_%'      THEN 'L1-raw-odoo'
       WHEN table_name LIKE 'syntage_%'   THEN 'L1-raw-syntage'
       WHEN table_name LIKE 'unified_%'   THEN 'L3-unified'
       WHEN table_name LIKE 'analytics_%' THEN 'L4-analytics'
       WHEN table_name LIKE 'agent_%'
         OR table_name LIKE 'ai_%'        THEN 'L5-intelligence'
       WHEN table_name LIKE 'dq_%'        THEN 'DQ'
       ELSE 'L2-canonical'
     END AS layer, table_name
   FROM information_schema.tables
   WHERE table_schema='public'
   ORDER BY 3, 4;
   ```

2. Reportar items sin prefijo adecuado. Candidatos conocidos a migrar:
   - `cfo_dashboard` → ya tiene alias `analytics_finance_cfo_snapshot`. Migrar TS → alias → deprecar view original.
   - `pl_estado_resultados` → alias existe, migrar TS.
   - `monthly_revenue_trend` → alias existe, migrar TS.
   - `customer_ltv_health`, `company_profile`, `company_narrative` → considerar merge en `analytics_customer_360`.

3. Detectar tablas never-read:
   ```sql
   SELECT relname, n_live_tup, seq_scan, idx_scan
   FROM pg_stat_user_tables
   WHERE schemaname='public' AND seq_scan=0 AND idx_scan=0
   ORDER BY n_live_tup DESC;
   ```
   Reportar al user. **No DROP sin confirmación.**

4. Commit: `refactor(db): rename legacy views to L4 convention + deprecation aliases`.

**Gate para F3:** los nombres canónicos que F3 usará en imports salen de esta fase.

---

### 4.2 F1 — Sidebar + renames (~1.5h)

**Objetivo:** jerarquía de navegación clara con 4 grupos + naming consistente en español.

**Pasos:**

1. Verificar/instalar shadcn components faltantes:
   ```bash
   npx shadcn@latest add sidebar breadcrumb command sonner
   ```

2. Crear `src/components/layout/AppSidebar.tsx`:
   - Header: logo Quimibond + Command palette (shadcn `<Command>`) para search rápido.
   - 4 grupos collapsibles con iconos Lucide:
     - **Decisión**: inbox, briefings, chat
     - **Operación**: ventas, cobranza, compras, operaciones, equipo, finanzas
     - **Entidades**: empresas, contactos, productos
     - **Sistema**: directores, sistema
   - Badge de contador opcional por item (ej. inbox con open insights).
   - Footer: user profile dropdown.
   - Estado de grupo colapsado persistido en `localStorage['sidebar-collapsed-groups']`.

3. Reemplazar navegación actual en `src/app/layout.tsx` con `<SidebarProvider>` + `<AppSidebar>`.

4. Renames de rutas (4 total, todos con 301 redirect):
   - `src/app/agents/` → `src/app/directores/`
   - `src/app/system/` → `src/app/sistema/`
   - `src/app/companies/` → `src/app/empresas/`
   - `src/app/contacts/` → `src/app/contactos/`

   Para cada rename:
   ```tsx
   // src/app/<old>/page.tsx
   import { redirect } from "next/navigation";
   export default function Page() { redirect("/<new>"); }
   ```
   Y para rutas dinámicas viejas (`/companies/[id]`, `/contacts/[id]`):
   ```tsx
   export default function Page({ params }) {
     redirect(`/<new>/${params.id}`);
   }
   ```

5. Grep global + replace de `<Link href="">` internos:
   ```bash
   grep -r 'href="/\(agents\|system\|companies\|contacts\)' src
   ```
   Actualizar cada match. TypeScript valida que no haya refs rotas.

6. Commit: `feat(ia): sidebar + 4 grupos collapsibles + route renames to ES`.

**Validación:** tsc + build + click-through manual de cada nueva ruta + verificar redirects funcionan.

---

### 4.3 F2 — Design system + consolidación de patterns (~1.5h)

**Contexto:** Ya existe `src/components/shared/v2/` (30+ componentes auto-descritos como "Catálogo v2 de 15 componentes reutilizables"). Incluye `PageHeader`, `DataTable`, `KpiCard`, `EmptyState`, `MetricRow`, `FilterBar`, `DataView`, `SeverityBadge`, etc. Decisión brainstorm 2026-04-19 (opción A): **renombrar v2 → patterns/** + agregar los 3 faltantes (`PageLayout`, `SectionHeader`, `LoadingCard/Table/List`). Consolidamos en un solo home canónico.

**Pasos:**

1. Escribir `docs/design-system.md` con:
   - **Spacing**: reglas de uso de `space-y-2/4/6/8`.
   - **Typography**: `h1=text-3xl font-bold`, `h2=text-2xl font-semibold`, `h3=text-lg font-medium`, `body=text-sm`.
   - **Colors**: solo tokens semánticos (`bg-background`, `bg-card`, `bg-muted`, `border-border`, `text-foreground`, `text-muted-foreground`, `destructive`, `primary`).
   - **Density**: compact (tablas densas) vs comfortable (cards).
   - **Loading**: `<Skeleton>` con shape del content. Sin spinners.
   - **Empty**: icon Lucide + heading + description + CTA.
   - **Charts**: `recharts` vía componente wrapper, tabla densa para tabulares.
   - **Catálogo patterns**: lista de los 30+ componentes existentes + 3 nuevos, con ejemplo por cada.

2. Renombrar `src/components/shared/v2/` → `src/components/patterns/`.
   Actualizar todos los imports `@/components/shared/v2` → `@/components/patterns`. Grep global. ~60+ archivos.

3. Agregar 3 componentes nuevos en `src/components/patterns/`:

   | Componente | Prop contract | Notas |
   |---|---|---|
   | `<PageLayout>` | `children`, `className?` | Wrap en `<main className="max-w-7xl mx-auto px-6 py-8 space-y-6">`. Compone con `PageHeader` existente. |
   | `<SectionHeader>` | `title`, `description?`, `sources?`, `action?` | Variant pequeño de `PageHeader` para secciones internas. |
   | `<LoadingCard>` / `<LoadingTable>` / `<LoadingList>` | `rows?: number` | Skeletons con shape semántico; usa `<Skeleton>` internamente. |

4. Actualizar `src/components/patterns/index.ts` (antes `v2/index.ts`) con los 3 nuevos exports.

5. Commit: `feat(ds): design system doc + patterns consolidation (v2 → patterns + 3 new)`.

**Validación:** tsc + build pasan. Cada nuevo componente renderiza (verificable en siguiente fase F4 al usarlos).

---

### 4.4 S3 — Data utilization (~1h)

**Objetivo:** identificar data ya sincronizada que ningún UI/director consume, e integrar los gaps de alto valor.

**Pasos:**

1. Por cada tabla flagged en S1 como populated-but-never-read, revisar contenido:
   ```sql
   SELECT count(*), min(created_at), max(created_at) FROM <table>;
   ```

2. Candidatos concretos del handoff §S3.2-S3.3 a evaluar:

   | Tabla | Volumen aprox | Destino propuesto |
   |---|---|---|
   | `syntage_electronic_accounting` | 35 rows | `/sistema` tab Fiscal — balanzas/pólizas/catálogo |
   | `syntage_tax_retentions` | 78 rows | `/finanzas` sección fiscal — retenciones |
   | `syntage_files` | 16k rows | Eval: `/sistema` tab Archivos fiscales o integrar en `/empresas/[id]` tab Fiscal |
   | `syntage_webhook_events` | 42k rows | `/sistema` tab Integraciones — auditoría |
   | `pipeline_logs` | — | `/sistema` tab Pipeline — log de operaciones |
   | `odoo_manufacturing` | — | Check si `/operaciones` lo muestra; si no, integrar |
   | `odoo_chart_of_accounts` | — | Check uso; si huérfano, integrar en `/finanzas` |
   | `odoo_currency_rates` | — | Check uso en FX recalc |
   | `odoo_activities` | — | Check exposición en `/equipo` |

3. Para cada gap integrado:
   - Query helper en `src/lib/queries/<dominio>/<file>.ts`.
   - Component en `src/components/domain/<feature>.tsx`.
   - Insertion point en page correspondiente.
   - Commit: `feat(data): expose <table> in <page>`.

4. Reglas de scope:
   - **Integrar** solo 2-4 tablas de mayor valor (auditoría + fiscal retentions + electronic accounting + pipeline logs son los más probables).
   - **Reportar** el resto al user sin integrar, con recomendación.
   - **NO integrar** si la tabla requiere rediseño mayor (ej. si necesita un dashboard nuevo).

---

### 4.5 F3 — Reorg queries + components (~1h)

**Objetivo:** agrupar por dominio para facilitar discovery y evitar flat folders con 22 archivos.

**Pasos:**

1. `src/lib/queries/` (22 archivos actuales) → subfolders:
   ```
   fiscal/        syntage-reconciliation.ts, syntage-health.ts, fiscal-historical.ts
   operational/   sales.ts, purchases.ts, operations.ts, team.ts
   unified/       unified.ts, invoices.ts, invoice-detail.ts
   analytics/     analytics.ts, finance.ts, dashboard.ts, products.ts, customer-360.ts
   intelligence/  insights.ts, evidence.ts, evidence-helpers.ts
   _shared/       companies.ts, contacts.ts, system.ts, table-params.ts, _helpers.ts
   ```

2. Listar todos los imports afectados:
   ```bash
   grep -rn 'from "@/lib/queries/' src | awk -F: '{print $3}' | sort -u
   ```

3. Mover archivos, luego actualizar imports de forma determinista (por archivo target). `tsc --noEmit` debe pasar sin errores.

4. `src/components/` → reorganizar:
   ```
   ui/         (shadcn primitives, no tocar)
   patterns/   (ex-v2 + 3 nuevos de F2)
   domain/     (feature-specific: mover `components/fiscal/*`, `components/system/*` aquí)
   layout/     (AppSidebar, MainContent, etc. — se queda)
   shared/     (legacy restante: realtime-alerts, route-error, search-command, severity-badge. Mover severity-badge a patterns si aplica)
   ```
   `src/app/[route]/_components/` se mantiene (page-local).

5. Commit: `refactor(structure): queries + components reorganized by domain`.

**Validación:** tsc + test + build sin errores nuevos.

---

### 4.6 F4 — Page consistency sweep (~1.5h)

**Objetivo:** cada page usa `PageLayout` + `PageHeader` + patrones canónicos.

**Pasos:**

1. Priority order (por tráfico):
   1. `/inbox`
   2. `/cobranza`
   3. `/finanzas`
   4. `/ventas`
   5. `/compras`
   6. `/empresas/[id]` (ya rediseñado — solo aplicar `PageLayout` wrapper)
   7. `/chat`
   8. `/briefings`
   9. `/directores`
   10. `/operaciones`
   11. `/equipo`
   12. `/productos`
   13. `/contactos`
   14. `/sistema`
   15. `/profile`
   (`/login` tiene layout propio, no aplica.)

2. Por cada page:
   - Wrap en `<PageLayout>`.
   - Top con `<PageHeader title description? sources? actions?>`.
   - Spacing interno `space-y-6`.
   - Loading states con `<LoadingCard>` / `<LoadingTable>` dentro de `<Suspense>`.
   - Empty states con `<EmptyState>`.
   - Tablas con `<DataTable>` o shadcn Table directo — **no** custom `<div>` con roles.
   - KPIs con `<KPICard>`.

3. Commits incrementales: 3-4 pages por commit → ~4 commits.
   - `refactor(ui): PageLayout sweep /inbox /cobranza /finanzas`
   - `refactor(ui): PageLayout sweep /ventas /compras /empresas`
   - `refactor(ui): PageLayout sweep /chat /briefings /directores /operaciones`
   - `refactor(ui): PageLayout sweep /equipo /productos /contactos /sistema /profile`

**Validación final:** `npm run build` + manual QA de las 15 pages.

---

## 5. Validación

### 5.1 Por fase (antes de cada commit)

| Check | Comando | Umbral |
|---|---|---|
| V1 Lint | `npm run lint` | 0 errors |
| V2 Types | `npx tsc --noEmit --skipLibCheck` | 0 errors |
| V3 Tests | `npm run test` | 4 failures baseline (no nuevos) |
| V4 Build | `npm run build` | success (ignorar `/equipo` env warning pre-existente) |

### 5.2 Final post-F4

| Check | Cómo |
|---|---|
| Layout consistency | Manual QA: 16 rutas, cada una con `PageLayout` + `PageHeader` |
| Loading states | Refresh c/página, `LoadingCard`/`LoadingTable` visible |
| Empty states | Filtros que vacían data muestran `EmptyState` |
| DataSourceBadges | Visibles donde aplica (finanzas/cobranza/empresas) |
| Sidebar | 4 grupos funcionales, collapse persiste, todos los items navegan |
| Redirects | `/agents`, `/system`, `/companies`, `/contacts` redirigen 301 |
| Supabase inventory | 0 tablas flagged sin review, vistas L4 con COMMENT ON, `dq_*` existen |

### 5.3 Lighthouse (medir, no bloquear)

Ejecutar sobre `/inbox`, `/cobranza`, `/finanzas`. Accessibility + performance > 80 deseable, no gate.

---

## 6. Scope OUT (explícito)

1. **S2 · Data Quality audit completo.** Existen `dq_*` views operativas (`dq_company_duplicates`, `dq_product_code_duplicates`, `dq_invoice_uuid_duplicates`, `dq_payments_unmatchable`). Se revisan on-demand.
2. **`/dashboard` como home nuevo.** `/inbox` es la landing.
3. **Eliminar pages existentes.** Ninguna candidata clara (las 16 rutas tienen uso).
4. **Addon Odoo (qb19).** Repo separado, no tocar.
5. **Cambios a Layer 3 fiscal.** `invoices_unified`, `reconciliation_issues`, pg_cron refresh, insights con `fiscal_annotation` se preservan intactos.
6. **Arquitectura de agentes.** Categorías de insights, routing, triggers, prompts — no tocar.
7. **Tests nuevos.** Mantenemos baseline (4 failures pre-existentes). No agregamos tests unitarios más allá de lo necesario.
8. **Lighthouse como gate bloqueante.** Se mide, no se bloquea por score.
9. **DROP de tablas never-read.** Se reporta, no se ejecuta sin confirmación del user.

---

## 7. Riesgos y mitigaciones

| # | Riesgo | Mitigación |
|---|---|---|
| 1 | Rename de rutas rompe `<Link>` internos | Grep global + 301 redirects + `tsc --noEmit` antes de commit |
| 2 | F3 reorg de queries rompe imports | S1 primero (nombres canónicos), grep antes de mover, tsc valida |
| 3 | F4 sweep toca 15 pages, riesgo de regresión | 4 commits incrementales + `npm run build` después de cada |
| 4 | S1 rename de views rompe código TS | Migrar TS → alias primero, luego deprecar view vieja con COMMENT ON |
| 5 | shadcn Sidebar new component | Instalar CLI, no reimplementar. Seguir docs oficiales. |
| 6 | Vercel auto-deploy en `main` | Validar V1-V4 antes de cada push. `main` = prod. |

### 7.1 Stop-and-ask triggers

Detener trabajo y preguntar al user cuando:
- Se contempla DROP o DELETE masivo.
- Merge de companies con datos ambiguos.
- Test nuevo falla por razón no-obvia después de 15min de diagnóstico.
- Build roto >15min sin causa identificada.
- Rename o cambio afecta URLs referenciadas en emails/docs externos.

---

## 8. Conocidos a preservar (no romper)

- `DataSourceBadge` en `src/components/ui/DataSourceBadge.tsx` — mantener como está, es valioso para transparencia.
- `/empresas/[id]` 5 tabs (Panorama / Comercial / Financiero / Operativo / Fiscal) — rediseño Fase 6, mantener estructura.
- URL routing con `?tab=<slug>` en empresas y `?section=<slug>` en finanzas — preservar para deep-links.
- `unstable_cache` en queries principales (`getCfoSnapshot`, invoice queries, etc.) — no remover.
- 72 insights con `fiscal_annotation` poblados — no tocar.
- `reconciliation_issues` + pg_cron `refresh-syntage-unified` — no tocar.
- Baseline de 4 test failures pre-existentes (sentimentColor ×3 + unified-helpers ×1) — documentar, no "arreglar" ahora.

---

## 9. Tracking

- **Spec:** este archivo.
- **Plan:** `docs/superpowers/plans/2026-04-19-frontend-refactor-supabase-audit.md` (pendiente, post-aprobación de spec).
- **Handoff original:** `docs/superpowers/specs/2026-04-19-frontend-refactor-handoff.md`.
- **Project memory:** `/Users/jj/.claude/projects/-Users-jj/memory/project_syntage_integration.md` (update al terminar).
- **Ref Fase 6:** `docs/superpowers/specs/2026-04-19-syntage-fase-6-directores-ia-design.md`.
