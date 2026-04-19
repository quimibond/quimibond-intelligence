# Prompt de Handoff · Frontend Refactor + Supabase Audit

Copia y pega este prompt entero en una nueva sesión de Claude Code.

---

```
Eres un frontend + data engineer encargado de un refactor profundo de Quimibond
Intelligence. Objetivo: eliminar el "feel desorganizado" del frontend,
consolidar la arquitectura de data en Supabase, y asegurar que estamos
aprovechando toda la data disponible. Trabajo estimado: 6-10h en total.

═══════════════════════════════════════════════════════════════════════
CONTEXTO
═══════════════════════════════════════════════════════════════════════

Repos:
- Frontend: /Users/jj/quimibond-intelligence/quimibond-intelligence
  (Next.js 15, React 19, TypeScript, Tailwind, shadcn/ui). Deploy Vercel.
- Addon Odoo: /Users/jj/addons/quimibond_intelligence (Odoo.sh branch
  `quimibond`). NO toques este repo a menos que sea necesario para habilitar
  matching de payments.

Supabase:
- Project ID: tozqezmivpblmcubmnpi
- MCP tools disponibles: mcp__claude_ai_Supabase__apply_migration (DDL),
  mcp__claude_ai_Supabase__execute_sql (query), mcp__claude_ai_Supabase__list_tables
- Usa estos MCPs en vez de supabase CLI local.

Branch: main. Commits directos autorizados. Push a origin/main triggers Vercel
auto-deploy.

Baseline tests: 4 failures pre-existentes (sentimentColor x3 + unified-helpers x1).
No introducir nuevos.

Vercel CRON_SECRET + URL para triggers manuales: los guarda el user. Si los
necesitas, pídelos.

═══════════════════════════════════════════════════════════════════════
ESTADO ACTUAL (trabajo previo ya en main)
═══════════════════════════════════════════════════════════════════════

Último commit: a3bd5a0

Arquitectura Supabase en 6 capas (parcialmente implementada):
- L1 RAW: odoo_* (25 tables), syntage_* (10 tables)
- L2 CANONICAL: companies, contacts, entities, emails, threads
- L3 UNIFIED: invoices_unified MV + aliases unified_*, reconciliation_issues,
  reconciliation_summary_daily, payments_unified MV
- L4 ANALYTICS: analytics_customer_360, analytics_supplier_360,
  analytics_finance_cfo_snapshot, analytics_revenue_fiscal_monthly, etc.
  (14 aliases con COMMENT ON citando source + coverage)
- L5 INTELLIGENCE: agent_insights, ai_agents (incluye director compliance),
  briefings, action_items
- L6 FRONTEND: 15 pages + shadcn/ui strict

Directores IA activos (8): comercial, financiero, compras, costos, operaciones,
riesgo, equipo, compliance.

Frontend ya tocado:
- DataSourceBadge component en src/components/ui/DataSourceBadge.tsx
  (sources: odoo, syntage, unified, ia, gmail).
- /companies/[id] rediseñado con 5 tabs (Panorama, Comercial, Financiero,
  Operativo, Fiscal) vía src/app/companies/[id]/_components/*Tab.tsx.
- /finanzas reorganizado en 3 secciones anchoradas (#operativo, #fiscal,
  #unificado).
- Badges en headers de /cobranza, /ventas, /compras, /operaciones, /equipo.
- 21 files migrados a shadcn strict (0 <button>/<table>/<input> raw).

shadcn/ui instalados (25): accordion, avatar, badge, button, card, chart,
checkbox, dialog, dropdown-menu, input, label, pagination, popover, progress,
scroll-area, select, select-native, separator, sheet, skeleton, switch, table,
tabs, textarea, tooltip. Plus DataSourceBadge custom.

Pages actuales (15 al mismo nivel en src/app/):
agents, briefings, chat, cobranza, companies, compras, contacts, equipo,
finanzas, inbox, login, operaciones, productos, profile, system, ventas.

═══════════════════════════════════════════════════════════════════════
PROBLEMAS PERCIBIDOS COMO "DESORGANIZACIÓN"
═══════════════════════════════════════════════════════════════════════

1. 15 pages sin jerarquía — todas siblings sin grupos (Decisión vs Operación
   vs Entidades vs Sistema).

2. Naming bilingüe inconsistente — ventas/cobranza/compras en español, agents/
   briefings en inglés. Decidir español-único (CEO es mexicano).

3. src/lib/queries/ flat con 22 archivos — necesita subfolders por dominio:
   fiscal/, operational/, unified/, analytics/, intelligence/, _shared/.

4. Sin design system documentado — densidad/spacing/typography/loading states
   inconsistentes entre pages.

5. Navigation sin estructura — probablemente sidebar/header evolucionó
   incrementalmente.

6. Pages con layout templates inconsistentes — unas con sidebar, otras con
   sectionnav, otras nada.

7. Loading + empty states no estandarizados.

═══════════════════════════════════════════════════════════════════════
CONOCIDOS A PRESERVAR (no romper)
═══════════════════════════════════════════════════════════════════════

- DataSourceBadge en /src/components/ui/DataSourceBadge.tsx — mantenerlo,
  es valioso para transparencia de fuentes.
- /companies/[id] 5 tabs (Panorama/Comercial/Financiero/Operativo/Fiscal) —
  mantener, es el rediseño Fase 6.
- URL routing con ?tab=<slug> en companies y ?section=<slug> en finanzas —
  preservar para deep-links.
- unstable_cache en queries principales — no remover.
- 72 insights con fiscal_annotation poblados — NO tocar.
- reconciliation_issues y pg_cron refresh — no tocar.

═══════════════════════════════════════════════════════════════════════
PARTE 1 · REFACTOR FRONTEND (4 fases)
═══════════════════════════════════════════════════════════════════════

────────────────────────────────────────────────────────────────────
FASE F1 — Information Architecture + Navigation
────────────────────────────────────────────────────────────────────

Objetivo: jerarquía clara de surfaces. 4 grupos.

F1.1 Decidir grupos de surfaces (proponer al user antes de ejecutar):

  Grupo "Decisión" (dónde vive el trabajo del CEO):
    /inbox  → acciones urgentes
    /briefings  → narrativa diaria/semanal
    /chat  → RAG conversacional con @directores

  Grupo "Operación" (por rol/función):
    /ventas, /cobranza, /compras, /operaciones, /equipo, /finanzas

  Grupo "Entidades":
    /empresas (rename /companies), /contactos (rename /contacts),
    /productos

  Grupo "Sistema":
    /directores (rename /agents), /sistema (rename /system)

  Auth: /login, /profile (sin grupo, parte del shell).

F1.2 Rediseñar navegación. Usar shadcn `<Sidebar>` pattern
  (https://ui.shadcn.com/docs/components/sidebar) con:
  - Header: logo Quimibond Intelligence + search (shadcn Command palette)
  - 4 grupos collapsibles con iconos Lucide consistentes
  - Badge por item si tiene nuevo contenido (ej. inbox count)
  - Footer: user profile dropdown

F1.3 Rename routes decididos (mantener redirects):
  /agents → /directores (301 redirect)
  /system → /sistema
  /companies → /empresas (si el user aprueba)
  /contacts → /contactos
  Ojo: actualizar todos los <Link href=""> internos (60+ archivos
  probablemente). Usa grep global + replace.

F1.4 Commit + push con mensaje "feat(ia): information architecture
  + sidebar rediseño + renames to español"

────────────────────────────────────────────────────────────────────
FASE F2 — Design System + Core Components
────────────────────────────────────────────────────────────────────

Objetivo: consistencia visual + patterns reutilizables.

F2.1 Crear docs/design-system.md con:
  - Spacing scale (uso de space-y-2/4/6/8 reglas)
  - Typography scale (h1/h2/h3/body/muted — tamaños y weights)
  - Color tokens semánticos (bg-background/muted/card/accent/destructive)
  - Layout density (compact vs comfortable)
  - Loading state patterns (Skeleton + SuspenseBoundary)
  - Empty state patterns (icon + heading + description + CTA)
  - Chart patterns (cuándo usar shadcn chart vs tabla CSS)

F2.2 Crear componentes canónicos en src/components/patterns/:

  <PageLayout> — wrapper standard para toda page:
    - max-w-7xl mx-auto px-6 py-8 space-y-6
    - Recibe: header (PageHeader), children, actions (opcional)

  <PageHeader> — title + breadcrumbs + DataSourceBadge(s) + actions:
    - Breadcrumbs opcionales via prop
    - Badge(s) opcional vía prop sources: SourceKind[]
    - Actions slot (botones + links)
    - title: string, description?: string

  <SectionHeader> — título interno de sección con badge + description

  <LoadingCard> / <LoadingTable> / <LoadingList> — skeletons estándar

  <EmptyState> — icon (Lucide) + heading + description + CTA
    variants: default, search-no-results, error

  <KPICard> — figura grande + label + trend (up/down/flat) +
    DataSourceBadge opcional

  <DataTable> — wrapper de shadcn Table con:
    - Sort/filter/pagination built-in
    - Column types: text, number (right-align), currency, date, badge, action
    - Empty state integrado

F2.3 Instalar shadcn componentes que falten para estos patterns:
  - Si falta breadcrumb: `npx shadcn@latest add breadcrumb`
  - Si falta command: `npx shadcn@latest add command`
  - Si falta sidebar: `npx shadcn@latest add sidebar`
  - Si falta sonner (toasts): `npx shadcn@latest add sonner`

F2.4 Docs usage: cada componente canónico tiene ejemplo en design-system.md.

F2.5 Commit: "feat(ds): design system doc + core pattern components"

────────────────────────────────────────────────────────────────────
FASE F3 — File Structure Reorganization
────────────────────────────────────────────────────────────────────

Objetivo: descubrir archivos más fácil, agrupar por dominio.

F3.1 src/lib/queries/ → subfolders:
  fiscal/        syntage-reconciliation.ts, syntage-health.ts,
                 fiscal-historical.ts
  operational/   sales.ts, purchases.ts, operations.ts, team.ts
  unified/       unified.ts, invoices.ts, invoice-detail.ts
  analytics/     analytics.ts, finance.ts, dashboard.ts, products.ts,
                 customer-360.ts
  intelligence/  insights.ts, evidence.ts, evidence-helpers.ts
  _shared/       companies.ts, contacts.ts, system.ts, table-params.ts,
                 _helpers.ts

  Actualiza imports (50-80 files probablemente). Usa:
  ```
  grep -r "from \"@/lib/queries/" src | awk '{print $NF}' | sort -u
  ```
  Para ver todos los imports, luego sed-like replaces.

F3.2 src/components/ → estructura:
  ui/            (shadcn primitives — no tocar)
  patterns/      (PageLayout, PageHeader, KPICard, DataTable, etc. de F2)
  domain/        (componentes específicos por feature, ej. FiscalRevenueKpiCard,
                  TopClientsFiscalTable)
  shared/        (legacy compartidos, marcados para migrar a patterns o domain)

F3.3 src/app/[route]/_components/ se mantiene (page-local components).

F3.4 Commit: "refactor(structure): queries + components reorganization por
  dominio"

────────────────────────────────────────────────────────────────────
FASE F4 — Page Consistency Sweep
────────────────────────────────────────────────────────────────────

Objetivo: cada page usa PageLayout + PageHeader consistente.

F4.1 Para CADA page (15 total + subpages dinámicas):
  1. Wrappearla en <PageLayout>
  2. Top con <PageHeader title=... description=... sources=[...] actions=...>
  3. Spacing interno uniforme (space-y-6)
  4. Loading states usan <LoadingCard>/<LoadingTable> via Suspense
  5. Empty states usan <EmptyState>
  6. Tablas usan <DataTable> o shadcn Table directo (no custom)
  7. KPIs usan <KPICard> con DataSourceBadge embed

F4.2 Orden de migración (priority por tráfico):
  /inbox, /cobranza, /finanzas (ya parcialmente), /ventas, /compras,
  /companies/[id] (ya rediseñado — solo aplicar PageLayout wrapper),
  /chat, /briefings, /agents, /operaciones, /equipo, /productos,
  /contacts, /system, /profile.

F4.3 Auditoría final: correr `npm run build` y ver warnings sobre
  inconsistencias (raw <div> en lugares que deberían ser Card, etc.).

F4.4 Commit incremental: 1 commit por 3-4 pages. Total ~4-5 commits en
  esta fase.

═══════════════════════════════════════════════════════════════════════
PARTE 2 · SUPABASE AUDIT + DATA CORRECTNESS
═══════════════════════════════════════════════════════════════════════

────────────────────────────────────────────────────────────────────
FASE S1 — Audit de organización Supabase
────────────────────────────────────────────────────────────────────

S1.1 Ejecutar inventory query:
  ```sql
  SELECT table_schema, table_type,
    CASE WHEN table_name LIKE 'odoo_%' THEN 'L1-raw-odoo'
         WHEN table_name LIKE 'syntage_%' THEN 'L1-raw-syntage'
         WHEN table_name LIKE 'unified_%' THEN 'L3-unified'
         WHEN table_name LIKE 'analytics_%' THEN 'L4-analytics'
         WHEN table_name LIKE 'agent_%' OR table_name LIKE 'ai_%' THEN 'L5-intelligence'
         WHEN table_name LIKE 'dq_%' THEN 'DQ'
         ELSE 'L2-canonical'
    END AS layer,
    table_name
  FROM information_schema.tables WHERE table_schema='public'
  ORDER BY 3, 4;
  ```
  Identifica items que NO encajan en el layer (ej. vistas sueltas sin prefijo).

S1.2 Rename + deprecate objects sin prefijo adecuado. Ejemplos:
  - `cfo_dashboard` → ya tiene alias `analytics_finance_cfo_snapshot`.
    Actualizar TS para usar el nuevo name, luego deprecar el viejo.
  - `pl_estado_resultados` → alias existe, migrar código.
  - `monthly_revenue_trend` → alias existe, migrar.
  - `customer_ltv_health`, `company_profile`, `company_narrative` → estos se
    deberían mergear en `analytics_customer_360` (ya existe). Migrar código a
    usar 360 y deprecar los 3 originales.

S1.3 Invoke view `pg_stat_user_tables` para detectar tablas nunca-read:
  ```sql
  SELECT relname, n_live_tup, seq_scan, idx_scan
  FROM pg_stat_user_tables
  WHERE schemaname='public' AND seq_scan=0 AND idx_scan=0
  ORDER BY n_live_tup DESC;
  ```
  Estas son candidatos para DROP.

S1.4 Commit migrations de rename/drop con 30-day alias donde aplique.

────────────────────────────────────────────────────────────────────
FASE S2 — Data Quality Audit Completo
────────────────────────────────────────────────────────────────────

S2.1 Verificar que NO haya duplicados en ninguna tabla clave. Ya existen:
  - dq_company_duplicates (debería estar vacío post-merge + restore foreign)
  - dq_product_code_duplicates (48 dups esperados)
  - dq_invoice_uuid_duplicates (1547 conocidos, Odoo DQ)
  - dq_payments_unmatchable

  Si algún dq_* retorna >0 inesperado, investigar.

S2.2 Verificar integridad referencial:
  ```sql
  -- Invoices sin company
  SELECT count(*) FROM odoo_invoices WHERE company_id IS NULL;
  -- Issues sin company (esperado >0 para sat_only_received)
  SELECT issue_type, count(*) FROM reconciliation_issues
  WHERE company_id IS NULL AND resolved_at IS NULL GROUP BY 1;
  -- Insights orfanos
  SELECT count(*) FROM agent_insights WHERE agent_id IS NULL;
  ```

S2.3 Verificar sync freshness:
  ```sql
  SELECT table_name, max(synced_at) AS last_sync,
    extract(epoch from (now() - max(synced_at)))/3600 AS hours_ago
  FROM (SELECT 'odoo_invoices' AS table_name, synced_at FROM odoo_invoices
        UNION ALL ...) t
  GROUP BY 1 ORDER BY 2 DESC;
  ```
  Alert si alguna tabla >2h sin sync (debería ser 1h).

S2.4 Reportar findings al user. NO auto-fix sin confirmación si hay issues
  que requieren decisión de negocio (ej. merge de entidades legales).

────────────────────────────────────────────────────────────────────
FASE S3 — Data Utilization Audit
────────────────────────────────────────────────────────────────────

Objetivo: ¿estamos aprovechando TODA la data disponible?

S3.1 Identificar columnas populated pero never-read. Para cada tabla big:
  ```sql
  -- Sample de columnas no-NULL en syntage_invoices
  SELECT column_name,
    (SELECT count(*) FROM syntage_invoices WHERE column_name IS NOT NULL)
  FROM information_schema.columns
  WHERE table_name='syntage_invoices';
  ```
  Grep código TS para ver qué columnas realmente se usan.

S3.2 Identificar tablas que TIENEN data pero ninguna UI/director las lee:
  - syntage_electronic_accounting (35 rows, balanzas/pólizas/catálogo) —
    ¿alguna página expone? Si no, agregar a /sistema tab Fiscal.
  - syntage_tax_retentions (78 rows) — ¿alguna UI? Si no, agregar a
    /finanzas sección fiscal o /sistema.
  - syntage_files (16k rows) — ¿descargables via UI? Eval si agregar
    /fiscal/files o integrar a company detail.
  - syntage_webhook_events (42k rows, auditoría) — debería vivir en
    /sistema tab Integraciones.
  - pipeline_logs — debería estar accesible en /sistema.

S3.3 Identificar data Odoo no-explotada:
  - odoo_manufacturing (MRP orders) — ¿/operaciones muestra? Check.
  - odoo_chart_of_accounts — ¿usada en algún análisis?
  - odoo_currency_rates — ¿usada para FX recalc?
  - odoo_activities — ¿/equipo las expone?

S3.4 Integrar gaps detectados. Para cada uno:
  - Query helper en lib/queries/<dominio>/<file>.ts
  - Component en components/domain/<feature>.tsx
  - Insertion point en página correspondiente

S3.5 Directores IA: asegurar que tu context builders leen de las nuevas
  vistas L4 (analytics_customer_360, etc.) en vez de las fuentes L1 directas.
  El objetivo es que los directores vean TODA la data con el mismo lens.

S3.6 Commit por cada integration: "feat(data): expose <table> en <page>"

═══════════════════════════════════════════════════════════════════════
PARTE 3 · VALIDACIÓN FINAL
═══════════════════════════════════════════════════════════════════════

Antes de declarar done:

V1. npm run lint → 0 errors
V2. npx tsc --noEmit --skipLibCheck → 0 errors
V3. npm run test → 4 failures (baseline), no new
V4. npm run build → success (ignorar /equipo env warning pre-existente)
V5. Manual QA: navegar 15 pages, validar:
    - Layout consistente (PageLayout envuelve todo)
    - Loading skeletons visibles al refrescar
    - Empty states se ven cuando data vacía
    - DataSourceBadges visibles donde corresponde
    - Navigation sidebar funciona con grupos
    - Rename routes redirigen correctamente

V6. Lighthouse score > 80 en /inbox, /cobranza, /finanzas (accessibility +
    performance).

V7. Supabase inventory final:
    - 0 tablas huérfanas (never-read)
    - 0 duplicados en layer canonical
    - Todas las vistas L4 con COMMENT ON
    - dq_* views existen y dan counts razonables

═══════════════════════════════════════════════════════════════════════
SHADCN/UI BEST PRACTICES (referencia)
═══════════════════════════════════════════════════════════════════════

1. SIEMPRE importar desde '@/components/ui/<comp>', nunca desde radix direct.

2. Variants para Button: default (primary action), secondary (alt action),
   outline (tertiary), ghost (nav/icon-like), destructive (delete). NO usar
   className override para color.

3. Card structure: <Card> > <CardHeader> (title+description) > <CardContent> >
   <CardFooter> (actions). No <div className="border rounded">.

4. Forms: siempre <Form> + react-hook-form + zod. Nunca setState manual.

5. Tables: shadcn <Table> para data estática. Para sortable/filterable, usar
   @tanstack/react-table (instalado) con shadcn wrapper.

6. Dialogs: <Dialog> para modales centrados, <Sheet> para side drawers
   (mobile-friendly).

7. Dropdowns: <DropdownMenu> + <DropdownMenuTrigger asChild>. Nunca <select>
   custom excepto navigation nativo.

8. Loading: <Skeleton> con shape del content. No spinners.

9. Notifications: <Toaster> de sonner. Imported once en layout.

10. Dark mode: todo con `bg-background`, `text-foreground`, `bg-card`,
    `bg-muted`, `border-border` — nunca `bg-white text-black`.

11. Responsive: mobile-first. Cada page debe funcionar en 375px width.

12. Icons: exclusivamente Lucide React. No emoji como UI (solo en
    DataSourceBadge con tooltip).

13. Typography: Tailwind + shadcn defaults. h1=text-3xl font-bold, h2=text-2xl
    font-semibold, h3=text-lg font-medium, body=text-sm.

14. Spacing: stack con space-y-6 entre secciones, space-y-4 dentro de section,
    space-y-2 dentro de card. No margin vertical manual.

15. Colors: solo colores semánticos (primary, secondary, accent, destructive,
    muted). Nunca hex hardcoded.

═══════════════════════════════════════════════════════════════════════
REFERENCIAS
═══════════════════════════════════════════════════════════════════════

- shadcn/ui docs: https://ui.shadcn.com/docs
- shadcn sidebar pattern: https://ui.shadcn.com/docs/components/sidebar
- shadcn data-table: https://ui.shadcn.com/docs/components/data-table
- shadcn blocks: https://ui.shadcn.com/blocks (inspiration)
- Next.js App Router: https://nextjs.org/docs/app
- Supabase JS client: @supabase/supabase-js v2
- project memory: /Users/jj/.claude/projects/-Users-jj/memory/project_syntage_integration.md
- reorg spec previo: docs/superpowers/specs/2026-04-19-syntage-fase-6-directores-ia-design.md

═══════════════════════════════════════════════════════════════════════
WORKFLOW
═══════════════════════════════════════════════════════════════════════

1. Lee primero: docs/superpowers/specs/2026-04-19-syntage-fase-6-directores-ia-design.md
   y el project memory para entender el sistema.

2. Brainstorm con el user (usa superpowers:brainstorming skill) las
   decisiones ambiguas:
   - ¿Rename a español? Cuáles?
   - ¿Sidebar con grupos collapsibles o flat?
   - ¿Eliminar páginas que nadie usa?
   - ¿Agregar /dashboard como home o dejar /inbox?

3. Después del brainstorm, usa superpowers:writing-plans para plan detallado.

4. Ejecuta con superpowers:subagent-driven-development (dispatch 1 subagent
   por fase F1-F4 + S1-S3).

5. Commit incrementales, push frecuente (cada fase). NO merge a rama
   quimibond (Odoo) — el refactor frontend no toca addon.

6. Al final: update project memory con el estado nuevo post-refactor.

═══════════════════════════════════════════════════════════════════════
RED FLAGS (detente y pregunta al user)
═══════════════════════════════════════════════════════════════════════

- Si vas a borrar data (drop table, delete rows sin filtro, etc.).
- Si vas a renombrar routes que ya están en emails/docs externos.
- Si vas a introducir breaking change en API pública.
- Si vas a mergear companies basado en datos ambiguos.
- Si un test nuevo falla por razones no-obvias.
- Si el build rompe y no sabes por qué después de 15 min.

Siempre verifica tu trabajo con tsc + test + build antes de commit.

═══════════════════════════════════════════════════════════════════════
INICIO
═══════════════════════════════════════════════════════════════════════

Primera acción: lee el proyecto memory + este doc + el spec Fase 6. Luego
pregunta al user qué fase prefiere arrancar primero (F1 IA o S1 Supabase
audit), y cuáles decisiones ambiguas necesitas resolver antes.

No asumas nada sobre renames de rutas o eliminación de páginas sin confirmar.
Fin del prompt.
```
