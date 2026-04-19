# Frontend Refactor + Supabase Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor Quimibond Intelligence frontend con sidebar de 4 grupos, renames de rutas a español, consolidación de design system, reorg de queries/components por dominio, audit de Supabase L1-L5, e integración de gaps de data de alto valor.

**Architecture:** 6 fases interleaved — S1 (supabase inventory + view renames) → F1 (sidebar + route renames) → F2 (v2 → patterns consolidation + 3 nuevos) → S3 (data gaps integration) → F3 (queries + components reorg) → F4 (page consistency sweep).

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Tailwind, shadcn/ui primitives, Supabase PostgreSQL (MCP `mcp__claude_ai_Supabase__{execute_sql,apply_migration,list_tables}`), vitest, Vercel auto-deploy on push to `main`.

**Baseline:**
- Commit: `1409f60` (post-spec update)
- Tests: 4 failures pre-existing (sentimentColor ×3 + unified-helpers ×1) — never mark as passing, never "fix"
- 35 imports de `@/components/shared/v2`
- ~70 refs a rutas `companies|agents|system|contacts` en TSX/TS
- 80 imports de `@/lib/queries/`
- 16 rutas en `src/app/` (15 pages + login)

**Validación por commit (V-gate):**
```bash
npm run lint                    # 0 errors
npx tsc --noEmit --skipLibCheck # 0 errors
npm run test                    # 4 failures baseline (NO nuevos)
npm run build                   # success (ignorar /equipo env warning pre-existente)
```
Si cualquiera rompe: **NO hacer commit**, diagnosticar, arreglar.

---

## Task 0: Baseline Verification

**Files:** none (just verify state).

- [ ] **Step 0.1: Verify clean working tree**

Run:
```bash
git status
```
Expected: `nothing to commit, working tree clean`. Si hay cambios: stash o commit antes de empezar.

- [ ] **Step 0.2: Verify baseline on main**

Run:
```bash
git log --oneline -1
```
Expected: commit SHA = `1409f60` o descendiente.

- [ ] **Step 0.3: Run V-gate baseline**

Run:
```bash
npm run lint && npx tsc --noEmit --skipLibCheck && npm run test && npm run build
```
Expected:
- lint: 0 errors
- tsc: 0 errors
- test: 4 failures (sentimentColor ×3 + unified-helpers ×1)
- build: success con solo `/equipo` env warning

Si falla algo más: detener, reportar al user.

---

# FASE S1 — Audit Supabase (1h)

**Goal:** inventariar schema, renombrar views sin prefijo canónico, reportar tablas never-read.

## Task S1.1: Inventory query

**Files:**
- Create: `supabase/audits/2026-04-19-inventory.sql` (sólo para archivo, no se ejecuta desde CLI)

- [ ] **Step 1: Crear el archivo de audit**

Create `supabase/audits/2026-04-19-inventory.sql`:
```sql
-- Inventory query: clasifica tablas de public schema por layer convention
SELECT
  CASE
    WHEN table_name LIKE 'odoo_%'      THEN 'L1-raw-odoo'
    WHEN table_name LIKE 'syntage_%'   THEN 'L1-raw-syntage'
    WHEN table_name LIKE 'unified_%'   THEN 'L3-unified'
    WHEN table_name LIKE 'analytics_%' THEN 'L4-analytics'
    WHEN table_name LIKE 'agent_%'
      OR table_name LIKE 'ai_%'        THEN 'L5-intelligence'
    WHEN table_name LIKE 'dq_%'        THEN 'DQ'
    ELSE 'L2-canonical-or-legacy'
  END AS layer,
  table_type,
  table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY 1, 3;
```

- [ ] **Step 2: Ejecutar inventory vía MCP**

Usar `mcp__claude_ai_Supabase__execute_sql` con el SQL del paso 1. Capturar salida.

- [ ] **Step 3: Analizar salida e identificar views sin prefijo canónico**

Buscar en layer `L2-canonical-or-legacy` nombres que sean views de analytics disfrazadas. Candidatos del spec §4.1:
- `cfo_dashboard`, `pl_estado_resultados`, `monthly_revenue_trend`, `customer_ltv_health`, `company_profile`, `company_narrative`, `cash_position`, `expense_breakdown`, `payment_analysis`, `cash_flow_aging`, `margin_analysis`, `working_capital`, `budget_vs_actual`, `cfdi_invoice_match`.

Para cada uno: verificar si ya existe alias `analytics_*` con `SELECT viewname FROM pg_views WHERE viewname LIKE 'analytics_%'`.

- [ ] **Step 4: Ejecutar never-read scan**

Vía `mcp__claude_ai_Supabase__execute_sql`:
```sql
SELECT relname, n_live_tup, seq_scan, idx_scan,
       pg_size_pretty(pg_total_relation_size(relid)) as size
FROM pg_stat_user_tables
WHERE schemaname = 'public' AND seq_scan = 0 AND idx_scan = 0
ORDER BY n_live_tup DESC;
```
Capturar salida.

- [ ] **Step 5: Escribir reporte**

Create `supabase/audits/2026-04-19-inventory-report.md` con:
- Layer distribution (tabla count por L1/L2/L3/L4/L5/DQ)
- Views sin prefijo canónico encontradas (lista)
- Tablas never-read (lista con row count)

- [ ] **Step 6: Commit**
```bash
git add supabase/audits/
git commit -m "feat(db-audit): S1 · inventory query + never-read scan report"
```

## Task S1.2: Rename legacy views to L4 convention

**Files:**
- Create: `supabase/migrations/20260419_s1_legacy_view_aliases.sql`

- [ ] **Step 1: Identificar views que NO tienen alias L4**

De Task S1.1 §Step 3, filtrar las que AÚN no tienen `analytics_*` equivalente. Por cada view sin alias:

Ejemplo: si `margin_analysis` no tiene alias, propondríamos `analytics_margin_analysis`. Si `cash_flow_aging` no tiene alias → `analytics_cash_flow_aging`. Etc.

Crear lista canónica de alias needed:
- `margin_analysis` → `analytics_margin_analysis`
- `cash_flow_aging` → `analytics_cash_flow_aging`
- `working_capital` → `analytics_working_capital`
- `budget_vs_actual` → `analytics_budget_vs_actual`
- `payment_analysis` → `analytics_payment_analysis`
- `expense_breakdown` → `analytics_expense_breakdown`
- `cash_position` → `analytics_cash_position`

(Sólo aplicar a las que S1.1 confirmó que NO tienen alias; skip las que ya lo tienen.)

- [ ] **Step 2: Escribir la migración**

Create `supabase/migrations/20260419_s1_legacy_view_aliases.sql`:
```sql
-- S1 · Legacy view canonical aliases
-- Aliasing legacy views to L4 analytics_* convention.
-- Originals permanecen como VIEW-of-VIEW para backward compat.
-- Sunset date para originals: 2026-06-01 (30 días post-deploy).

-- (POR CADA view sin alias detectada en S1.1)
CREATE OR REPLACE VIEW analytics_margin_analysis AS
  SELECT * FROM margin_analysis;
COMMENT ON VIEW analytics_margin_analysis IS
  'L4 · Margen por producto/cliente. Source: margin_analysis (legacy). Coverage: all closed sales.';

CREATE OR REPLACE VIEW analytics_cash_flow_aging AS
  SELECT * FROM cash_flow_aging;
COMMENT ON VIEW analytics_cash_flow_aging IS
  'L4 · Aging de cartera por empresa (1-30/31-60/61-90/90+). Source: cash_flow_aging (legacy).';

-- ... (uno por cada view en lista S1.2 Step 1)
```

**IMPORTANTE:** si S1.1 detecta que `margin_analysis` ya tiene alias `analytics_margin_analysis`, **skip esa línea**. Solo añadir las que falten.

- [ ] **Step 3: Aplicar migración vía MCP**

Usar `mcp__claude_ai_Supabase__apply_migration` con el SQL del step 2. Capturar confirmación.

- [ ] **Step 4: Verificar**

Vía `mcp__claude_ai_Supabase__execute_sql`:
```sql
SELECT viewname FROM pg_views
WHERE schemaname = 'public' AND viewname LIKE 'analytics_%'
ORDER BY viewname;
```
Expected: todos los nuevos alias aparecen.

- [ ] **Step 5: Commit**
```bash
git add supabase/migrations/20260419_s1_legacy_view_aliases.sql
git commit -m "feat(db): S1 · legacy views aliased to L4 analytics_* convention"
```

## Task S1.3: Document legacy view deprecation plan

**Files:**
- Create: `supabase/audits/2026-04-19-view-deprecation-plan.md`

- [ ] **Step 1: Escribir plan de deprecación**

Create `supabase/audits/2026-04-19-view-deprecation-plan.md`:
```markdown
# Legacy View Deprecation Plan

**Date:** 2026-04-19
**Sunset:** 2026-06-01 (30 days post-deploy)

## Views with new L4 alias

| Legacy | New alias | Sunset | TS references migrated |
|---|---|---|---|
| cfo_dashboard | analytics_finance_cfo_snapshot | 2026-06-01 | pending (see F4/F3 migration) |
| pl_estado_resultados | analytics_pl_estado_resultados | 2026-06-01 | pending |
| monthly_revenue_trend | analytics_monthly_revenue_trend | 2026-06-01 | pending |
| margin_analysis | analytics_margin_analysis | 2026-06-01 | pending |
| (continuar con cada alias de S1.2) | | | |

## Views candidate to merge

| Legacy | Proposed target | Reason |
|---|---|---|
| customer_ltv_health | analytics_customer_360 | Data subset; 360 ya contiene lifetime + health |
| company_profile | analytics_customer_360 | Metadata duplicada |
| company_narrative | analytics_customer_360 | Narrative field en 360 |

**ACCIÓN:** user decide si merge o preservar. Hasta decisión, preservar originals.

## Views never-referenced in TS

(lista generada por `grep -rn "from ..." src + search de view names`)

## Drop candidates (post-sunset)

Legacy originals que AÚN no se usan por 30 días post-2026-06-01. NO drop ahora — audit trail needed.
```

- [ ] **Step 2: Commit**
```bash
git add supabase/audits/2026-04-19-view-deprecation-plan.md
git commit -m "docs(db): S1 · deprecation plan for legacy views (sunset 2026-06-01)"
```

## Task S1.4: V-gate S1 finalize

- [ ] **Step 1: Ejecutar V-gate**
```bash
npm run lint && npx tsc --noEmit --skipLibCheck && npm run test && npm run build
```
Expected: todas las checks passing con baseline 4 test failures.

- [ ] **Step 2: Push a main**
```bash
git push origin main
```
Monitorear Vercel deploy preview por 2min. Si OK, pasar a F1.

---

# FASE F1 — Sidebar + Route Renames (1.5h)

**Goal:** sidebar con 4 grupos collapsibles (Decisión / Operación / Entidades / Sistema) + 4 renames de rutas a español con 301 redirects.

## Task F1.1: Audit current sidebar structure

**Files:**
- Read: `src/components/layout/app-sidebar.tsx:1-375`
- Read: `src/components/layout/sidebar-context.tsx`
- Read: `src/components/layout/sidebar-badges.tsx`

- [ ] **Step 1: Leer sidebar existente**

Read `src/components/layout/app-sidebar.tsx` en su totalidad. Identificar:
- Cómo se estructuran los `topGroups` / `bottomGroups`.
- Cómo se manejan íconos Lucide.
- Cómo se renderiza el badge de `alerts`.
- Cómo se maneja `active` state via `usePathname()`.

- [ ] **Step 2: Identificar qué preservar vs reescribir**

Preservar:
- `useSidebar()` hook
- `PipelineStatus`, `ThemeToggle`, `useSidebarCounts` children
- Lucide icons strategy

Reescribir:
- Estructura de grupos (6 → 4)
- Labels a español
- Collapsible behavior (añadir si no existe)

## Task F1.2: Restructure sidebar to 4 groups

**Files:**
- Modify: `src/components/layout/app-sidebar.tsx`

- [ ] **Step 1: Actualizar `NavGroup` interface para soportar collapsible**

Si la interface actual no tiene `collapsible`, añadir en `src/components/layout/app-sidebar.tsx`:

```tsx
interface NavGroup {
  /** Label del grupo (en uppercase pequeño). */
  label: string;
  /** Si true, el grupo puede colapsar/expandir con click en header. */
  collapsible?: boolean;
  /** Key para persistir estado collapsed en localStorage. */
  storageKey?: string;
  items: NavItem[];
}
```

- [ ] **Step 2: Reemplazar `topGroups` con 4 grupos del spec**

Reemplazar completamente el array `topGroups` (eliminar también `bottomGroups` si existe — se fusionan en estos 4):

```tsx
const topGroups: NavGroup[] = [
  {
    label: "Decisión",
    collapsible: true,
    storageKey: "sidebar-group-decision",
    items: [
      { href: "/inbox", label: "Inbox", icon: Inbox, badgeKey: "alerts" },
      { href: "/briefings", label: "Briefings", icon: FileText },
      { href: "/chat", label: "Chat", icon: Sparkles },
    ],
  },
  {
    label: "Operación",
    collapsible: true,
    storageKey: "sidebar-group-operacion",
    items: [
      { href: "/ventas", label: "Ventas", icon: TrendingUp },
      { href: "/cobranza", label: "Cobranza", icon: Banknote },
      { href: "/compras", label: "Compras", icon: ShoppingBag },
      { href: "/operaciones", label: "Operaciones", icon: Factory },
      { href: "/equipo", label: "Equipo", icon: Users },
      { href: "/finanzas", label: "Finanzas", icon: Banknote },
    ],
  },
  {
    label: "Entidades",
    collapsible: true,
    storageKey: "sidebar-group-entidades",
    items: [
      { href: "/empresas", label: "Empresas", icon: Building2 },
      { href: "/contactos", label: "Contactos", icon: UserCircle },
      { href: "/productos", label: "Productos", icon: Package },
    ],
  },
  {
    label: "Sistema",
    collapsible: true,
    storageKey: "sidebar-group-sistema",
    items: [
      { href: "/directores", label: "Directores", icon: Bot },
      { href: "/sistema", label: "Sistema", icon: Settings },
    ],
  },
];
```

Eliminar el array `bottomGroups` si existe (ya no hay grupos fuera de estos 4).

- [ ] **Step 3: Añadir estado de collapsed groups + toggle**

Dentro del componente `AppSidebar()`, añadir state management:

```tsx
const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

useEffect(() => {
  const loaded: Record<string, boolean> = {};
  for (const g of topGroups) {
    if (g.collapsible && g.storageKey) {
      const stored = typeof window !== "undefined"
        ? window.localStorage.getItem(g.storageKey)
        : null;
      loaded[g.storageKey] = stored === "1";
    }
  }
  setCollapsedGroups(loaded);
}, []);

const toggleGroup = useCallback((storageKey: string) => {
  setCollapsedGroups((prev) => {
    const next = { ...prev, [storageKey]: !prev[storageKey] };
    try {
      window.localStorage.setItem(storageKey, next[storageKey] ? "1" : "0");
    } catch {}
    return next;
  });
}, []);
```

- [ ] **Step 4: Actualizar JSX de grupos para usar collapsible**

Reemplazar el map de `topGroups` con renderizado condicional. El header del grupo debe ser clickable si `collapsible`:

```tsx
{topGroups.map((group) => {
  const isCollapsed = group.storageKey ? collapsedGroups[group.storageKey] : false;
  return (
    <div key={group.label} className="mb-4">
      <button
        onClick={() => group.collapsible && group.storageKey && toggleGroup(group.storageKey)}
        className={cn(
          "flex w-full items-center justify-between px-3 py-1 text-xs uppercase tracking-wider text-muted-foreground",
          group.collapsible && "cursor-pointer hover:text-foreground"
        )}
      >
        <span>{group.label}</span>
        {group.collapsible && (
          <span className="text-xs">{isCollapsed ? "▸" : "▾"}</span>
        )}
      </button>
      {!isCollapsed && (
        <div className="mt-1 space-y-0.5">
          {group.items.map((item) => (
            // ... existing NavItem render logic
          ))}
        </div>
      )}
    </div>
  );
})}
```

(Preservar la lógica interna de renderizado de `NavItem` con iconos, badges, active state.)

## Task F1.3: V-gate F1.2 before renames

- [ ] **Step 1: Ejecutar V-gate**
```bash
npm run lint && npx tsc --noEmit --skipLibCheck && npm run test && npm run build
```
Expected: passing con baseline.

- [ ] **Step 2: Manual smoke test**

Start `npm run dev`. Abrir http://localhost:3000. Verificar:
- Sidebar muestra 4 grupos (Decisión, Operación, Entidades, Sistema).
- Click en header de grupo colapsa/expande.
- Refresh: estado colapsado persiste.
- Click en item activo marca como active.

Los links a `/empresas`, `/contactos`, `/directores`, `/sistema` van a 404 (todavía). Eso es esperado — se arregla en F1.4.

- [ ] **Step 3: Commit sidebar change**
```bash
git add src/components/layout/app-sidebar.tsx
git commit -m "feat(ia): F1 · sidebar restructured to 4 collapsible groups"
```

## Task F1.4: Route renames — move folders

**Files:**
- Move: `src/app/agents/` → `src/app/directores/`
- Move: `src/app/system/` → `src/app/sistema/`
- Move: `src/app/companies/` → `src/app/empresas/`
- Move: `src/app/contacts/` → `src/app/contactos/`

- [ ] **Step 1: Git move `agents` → `directores`**
```bash
git mv src/app/agents src/app/directores
```

- [ ] **Step 2: Git move `system` → `sistema`**
```bash
git mv src/app/system src/app/sistema
```

- [ ] **Step 3: Git move `companies` → `empresas`**
```bash
git mv src/app/companies src/app/empresas
```

- [ ] **Step 4: Git move `contacts` → `contactos`**
```bash
git mv src/app/contacts src/app/contactos
```

- [ ] **Step 5: Verify moves**
```bash
ls src/app/ | grep -E "directores|sistema|empresas|contactos"
```
Expected: los 4 folders nuevos presentes. `agents/system/companies/contacts` ausentes.

## Task F1.5: Create 301 redirect stubs for old routes

**Files:**
- Create: `src/app/agents/page.tsx`
- Create: `src/app/system/page.tsx`
- Create: `src/app/companies/page.tsx`
- Create: `src/app/companies/[id]/page.tsx`
- Create: `src/app/contacts/page.tsx`
- Create: `src/app/contacts/[id]/page.tsx`

- [ ] **Step 1: Crear `src/app/agents/page.tsx`**

```tsx
import { redirect, RedirectType } from "next/navigation";

export default function Page() {
  redirect("/directores", RedirectType.replace);
}
```

- [ ] **Step 2: Crear `src/app/system/page.tsx`**

```tsx
import { redirect, RedirectType } from "next/navigation";

export default function Page() {
  redirect("/sistema", RedirectType.replace);
}
```

- [ ] **Step 3: Crear `src/app/companies/page.tsx`**

```tsx
import { redirect, RedirectType } from "next/navigation";

export default function Page() {
  redirect("/empresas", RedirectType.replace);
}
```

- [ ] **Step 4: Crear `src/app/companies/[id]/page.tsx`**

```tsx
import { redirect, RedirectType } from "next/navigation";

interface Params { params: Promise<{ id: string }> }

export default async function Page({ params }: Params) {
  const { id } = await params;
  redirect(`/empresas/${id}`, RedirectType.replace);
}
```

- [ ] **Step 5: Crear `src/app/contacts/page.tsx`**

```tsx
import { redirect, RedirectType } from "next/navigation";

export default function Page() {
  redirect("/contactos", RedirectType.replace);
}
```

- [ ] **Step 6: Crear `src/app/contacts/[id]/page.tsx`**

```tsx
import { redirect, RedirectType } from "next/navigation";

interface Params { params: Promise<{ id: string }> }

export default async function Page({ params }: Params) {
  const { id } = await params;
  redirect(`/contactos/${id}`, RedirectType.replace);
}
```

- [ ] **Step 7: Verify structure**
```bash
ls src/app/agents src/app/system src/app/companies src/app/contacts
```
Expected: cada uno tiene solo `page.tsx` (y `[id]/page.tsx` donde aplique).

## Task F1.6: Update internal Link/href references

**Files:**
- Modify: múltiples (grep-driven)

- [ ] **Step 1: Enumerar referencias a rutas viejas**

Run:
```bash
grep -rln 'href="/\(agents\|system\|companies\|contacts\)' src --include="*.tsx" --include="*.ts"
```
Capturar lista de archivos.

- [ ] **Step 2: Enumerar otros patterns de rutas (paths relativos en strings)**

Run:
```bash
grep -rlnE '"/(agents|system|companies|contacts)(/|")' src --include="*.tsx" --include="*.ts"
```
Capturar lista.

- [ ] **Step 3: Por cada archivo en la unión de listas, replace manualmente**

Por cada archivo, usar Read + Edit para reemplazar:
- `/agents` → `/directores`
- `/system` → `/sistema`
- `/companies` → `/empresas`
- `/contacts` → `/contactos`

**Cuidado:** NO tocar:
- Strings en tests (si hay) que estén validando el redirect mismo.
- Comentarios que describan el rename histórico.
- Textos de UI tipo "Ver en sistema" (eso SÍ tocar porque navega).

- [ ] **Step 4: tsc after each batch**

Cada 5-10 archivos tocados: `npx tsc --noEmit --skipLibCheck`. Errors se resuelven antes de continuar.

- [ ] **Step 5: Verify zero remaining internal references**

```bash
grep -rn 'href="/\(agents\|system\|companies\|contacts\)[/"]' src --include="*.tsx" --include="*.ts"
```
Expected: matches solo en `src/app/{agents,system,companies,contacts}/page.tsx` (los redirect stubs — OK) y en tests de redirect si aplica.

## Task F1.7: V-gate F1 + commit

- [ ] **Step 1: V-gate**
```bash
npm run lint && npx tsc --noEmit --skipLibCheck && npm run test && npm run build
```
Expected: passing con 4 baseline test failures.

- [ ] **Step 2: Manual smoke test**

`npm run dev`. Verificar:
- `/empresas` carga la lista de empresas.
- `/empresas/<id>` carga detalle con 5 tabs.
- `/companies` → redirect 307/308 a `/empresas` (Chrome devtools network tab).
- Cada sidebar link navega correctamente.
- Sidebar active state marca el item correcto.

- [ ] **Step 3: Commit**
```bash
git add -A
git commit -m "feat(ia): F1 · route renames to ES + 301 redirects + internal links"
```

- [ ] **Step 4: Push + monitor Vercel**
```bash
git push origin main
```
Esperar Vercel deploy (~2min). Verificar preview URL funciona.

---

# FASE F2 — Design System + Patterns Consolidation (1.5h)

**Goal:** renombrar `shared/v2/` → `patterns/`, añadir 3 componentes faltantes (`PageLayout`, `SectionHeader`, `LoadingCard/Table/List`), escribir `docs/design-system.md`.

## Task F2.1: Rename v2 folder to patterns

**Files:**
- Move: `src/components/shared/v2/` → `src/components/patterns/`

- [ ] **Step 1: Git move folder**
```bash
git mv src/components/shared/v2 src/components/patterns
```

- [ ] **Step 2: Verify**
```bash
ls src/components/patterns/ | head -5
```
Expected: ver `index.ts`, `page-header.tsx`, `data-table.tsx`, etc.

## Task F2.2: Update all v2 imports

**Files:**
- Modify: 35 archivos que importan de `@/components/shared/v2`

- [ ] **Step 1: Enumerar archivos con imports de v2**
```bash
grep -rln "from \"@/components/shared/v2" src --include="*.tsx" --include="*.ts"
```
Expected: ~35 archivos.

- [ ] **Step 2: Por cada archivo, replace import path**

Para cada archivo: Read + Edit para cambiar:
- `from "@/components/shared/v2"` → `from "@/components/patterns"`
- `from "@/components/shared/v2/<subfile>"` → `from "@/components/patterns/<subfile>"`

Usar el flag `replace_all` en Edit para acelerar si el pattern aparece múltiples veces en el mismo archivo.

- [ ] **Step 3: Verify zero residual v2 imports**
```bash
grep -rn "from \"@/components/shared/v2" src
```
Expected: cero matches.

- [ ] **Step 4: tsc**
```bash
npx tsc --noEmit --skipLibCheck
```
Expected: 0 errors.

- [ ] **Step 5: Commit rename**
```bash
git add -A
git commit -m "refactor(patterns): F2 · rename shared/v2 → patterns (35 imports updated)"
```

## Task F2.3: Create `<PageLayout>` component

**Files:**
- Create: `src/components/patterns/page-layout.tsx`
- Modify: `src/components/patterns/index.ts`
- Test: `src/__tests__/patterns/page-layout.test.tsx`

- [ ] **Step 1: Write failing test**

Create `src/__tests__/patterns/page-layout.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PageLayout } from "@/components/patterns/page-layout";

describe("PageLayout", () => {
  it("renders children inside a main element with spacing", () => {
    render(
      <PageLayout>
        <p>hello</p>
      </PageLayout>
    );
    const main = screen.getByRole("main");
    expect(main).toBeInTheDocument();
    expect(main.className).toMatch(/max-w-7xl/);
    expect(main.className).toMatch(/space-y-6/);
    expect(screen.getByText("hello")).toBeInTheDocument();
  });

  it("accepts className override and merges with defaults", () => {
    render(
      <PageLayout className="bg-red-500">
        <p>x</p>
      </PageLayout>
    );
    const main = screen.getByRole("main");
    expect(main.className).toMatch(/bg-red-500/);
    expect(main.className).toMatch(/max-w-7xl/);
  });
});
```

- [ ] **Step 2: Check testing-library already installed**
```bash
grep -E "@testing-library/(react|dom)" package.json
```
Si NO está: `npm install -D @testing-library/react @testing-library/jest-dom @testing-library/dom`. Si ya está: skip.

- [ ] **Step 3: Run test to see it fail**
```bash
npm test -- page-layout
```
Expected: FAIL "Cannot find module '@/components/patterns/page-layout'".

- [ ] **Step 4: Create PageLayout**

Create `src/components/patterns/page-layout.tsx`:
```tsx
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface PageLayoutProps {
  children: ReactNode;
  className?: string;
}

export function PageLayout({ children, className }: PageLayoutProps) {
  return (
    <main
      id="main-content"
      className={cn("max-w-7xl mx-auto px-6 py-8 space-y-6", className)}
    >
      {children}
    </main>
  );
}
```

- [ ] **Step 5: Add export to index**

Modify `src/components/patterns/index.ts` — añadir línea:
```ts
export { PageLayout } from "./page-layout";
```

- [ ] **Step 6: Run test passes**
```bash
npm test -- page-layout
```
Expected: 2 tests PASS.

## Task F2.4: Create `<SectionHeader>` component

**Files:**
- Create: `src/components/patterns/section-header.tsx`
- Modify: `src/components/patterns/index.ts`
- Test: `src/__tests__/patterns/section-header.test.tsx`

- [ ] **Step 1: Inspect existing PageHeader for consistency**

Read `src/components/patterns/page-header.tsx` para entender prop contract y reutilizar estilos.

- [ ] **Step 2: Write failing test**

Create `src/__tests__/patterns/section-header.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SectionHeader } from "@/components/patterns/section-header";

describe("SectionHeader", () => {
  it("renders title", () => {
    render(<SectionHeader title="Top clientes" />);
    expect(screen.getByRole("heading", { name: "Top clientes" })).toBeInTheDocument();
  });

  it("renders description when provided", () => {
    render(<SectionHeader title="x" description="desc text" />);
    expect(screen.getByText("desc text")).toBeInTheDocument();
  });

  it("renders action slot", () => {
    render(<SectionHeader title="x" action={<button>Click</button>} />);
    expect(screen.getByRole("button", { name: "Click" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to see it fail**
```bash
npm test -- section-header
```
Expected: FAIL.

- [ ] **Step 4: Create SectionHeader**

Create `src/components/patterns/section-header.tsx`:
```tsx
import type { ReactNode } from "react";

interface SectionHeaderProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

export function SectionHeader({ title, description, action }: SectionHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border pb-3">
      <div className="space-y-1">
        <h2 className="text-lg font-medium text-foreground">{title}</h2>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
```

- [ ] **Step 5: Add export**

Modify `src/components/patterns/index.ts`:
```ts
export { SectionHeader } from "./section-header";
```

- [ ] **Step 6: Run test passes**
```bash
npm test -- section-header
```
Expected: 3 tests PASS.

## Task F2.5: Create Loading skeleton components

**Files:**
- Create: `src/components/patterns/loading.tsx`
- Modify: `src/components/patterns/index.ts`
- Test: `src/__tests__/patterns/loading.test.tsx`

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/patterns/loading.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LoadingCard, LoadingTable, LoadingList } from "@/components/patterns/loading";

describe("Loading skeletons", () => {
  it("LoadingCard renders skeleton container", () => {
    const { container } = render(<LoadingCard />);
    expect(container.querySelector('[data-testid="loading-card"]')).toBeInTheDocument();
  });

  it("LoadingTable renders default 5 rows", () => {
    const { container } = render(<LoadingTable />);
    const rows = container.querySelectorAll('[data-testid="loading-table-row"]');
    expect(rows.length).toBe(5);
  });

  it("LoadingTable respects rows prop", () => {
    const { container } = render(<LoadingTable rows={3} />);
    expect(container.querySelectorAll('[data-testid="loading-table-row"]').length).toBe(3);
  });

  it("LoadingList renders default 4 items", () => {
    const { container } = render(<LoadingList />);
    expect(container.querySelectorAll('[data-testid="loading-list-item"]').length).toBe(4);
  });
});
```

- [ ] **Step 2: Run test to see it fail**
```bash
npm test -- loading
```
Expected: FAIL "Cannot find module ...".

- [ ] **Step 3: Create Loading components**

Create `src/components/patterns/loading.tsx`:
```tsx
import { Skeleton } from "@/components/ui/skeleton";

interface LoadingCardProps {
  className?: string;
}

export function LoadingCard({ className }: LoadingCardProps) {
  return (
    <div
      data-testid="loading-card"
      className={`rounded-lg border border-border bg-card p-6 space-y-3 ${className ?? ""}`}
    >
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-3 w-1/4" />
    </div>
  );
}

interface LoadingTableProps {
  rows?: number;
  columns?: number;
}

export function LoadingTable({ rows = 5, columns = 4 }: LoadingTableProps) {
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="border-b border-border bg-muted/30 p-3 flex gap-4">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} className="h-3 flex-1" />
        ))}
      </div>
      <div className="divide-y divide-border">
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            data-testid="loading-table-row"
            className="p-3 flex gap-4"
          >
            {Array.from({ length: columns }).map((_, j) => (
              <Skeleton key={j} className="h-4 flex-1" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

interface LoadingListProps {
  items?: number;
}

export function LoadingList({ items = 4 }: LoadingListProps) {
  return (
    <div className="space-y-2">
      {Array.from({ length: items }).map((_, i) => (
        <div
          key={i}
          data-testid="loading-list-item"
          className="flex items-center gap-3 rounded border border-border p-3"
        >
          <Skeleton className="h-10 w-10 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Add exports**

Modify `src/components/patterns/index.ts`:
```ts
export { LoadingCard, LoadingTable, LoadingList } from "./loading";
```

- [ ] **Step 5: Run tests pass**
```bash
npm test -- loading
```
Expected: 4 tests PASS.

## Task F2.6: Write design-system.md

**Files:**
- Create: `docs/design-system.md`

- [ ] **Step 1: Leer componentes para inventariar en el doc**
```bash
ls src/components/patterns/
```

- [ ] **Step 2: Escribir el doc**

Create `docs/design-system.md`:

```markdown
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
- `<PageLayout>` — wrapper canónico de toda page. `max-w-7xl mx-auto px-6 py-8 space-y-6`.
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
```

## Task F2.7: V-gate F2 + commit

- [ ] **Step 1: V-gate**
```bash
npm run lint && npx tsc --noEmit --skipLibCheck && npm run test && npm run build
```
Expected: 4 baseline failures + 2+3+4=9 nuevos PASS. Total tests failing = 4 (sin regresión).

- [ ] **Step 2: Commit F2 additions**
```bash
git add src/components/patterns/page-layout.tsx \
        src/components/patterns/section-header.tsx \
        src/components/patterns/loading.tsx \
        src/components/patterns/index.ts \
        src/__tests__/patterns/ \
        docs/design-system.md
git commit -m "feat(ds): F2 · 3 new patterns (PageLayout, SectionHeader, Loading*) + design-system.md"
```

- [ ] **Step 3: Push**
```bash
git push origin main
```

---

# FASE S3 — Data Utilization (1h)

**Goal:** Integrar 2-4 data gaps de alto valor al frontend.

## Task S3.1: Audit tablas populated-but-never-read

**Files:**
- Modify: `supabase/audits/2026-04-19-inventory-report.md`

- [ ] **Step 1: Query contenido de candidatos**

Vía `mcp__claude_ai_Supabase__execute_sql`:
```sql
SELECT 'syntage_electronic_accounting' AS t, count(*) AS rows,
       to_char(min(created_at), 'YYYY-MM-DD') AS first_seen,
       to_char(max(created_at), 'YYYY-MM-DD') AS last_seen
  FROM syntage_electronic_accounting
UNION ALL
SELECT 'syntage_tax_retentions', count(*),
       to_char(min(created_at), 'YYYY-MM-DD'),
       to_char(max(created_at), 'YYYY-MM-DD')
  FROM syntage_tax_retentions
UNION ALL
SELECT 'syntage_webhook_events', count(*),
       to_char(min(created_at), 'YYYY-MM-DD'),
       to_char(max(created_at), 'YYYY-MM-DD')
  FROM syntage_webhook_events
UNION ALL
SELECT 'syntage_files', count(*),
       to_char(min(created_at), 'YYYY-MM-DD'),
       to_char(max(created_at), 'YYYY-MM-DD')
  FROM syntage_files
UNION ALL
SELECT 'pipeline_logs', count(*),
       to_char(min(created_at), 'YYYY-MM-DD'),
       to_char(max(created_at), 'YYYY-MM-DD')
  FROM pipeline_logs;
```

- [ ] **Step 2: grep TS para ver cuáles YA tienen query helper**
```bash
grep -rln "syntage_electronic_accounting\|syntage_tax_retentions\|syntage_webhook_events\|syntage_files\|pipeline_logs" src --include="*.ts" --include="*.tsx"
```

- [ ] **Step 3: Decidir 2-4 gaps a integrar**

De los que NO aparecen en grep (never-read), priorizar los que tengan rows > 30 y `last_seen` dentro de últimos 30 días. Seleccionar 2-4 máximo.

Candidatos típicos (orden esperado de prioridad):
1. `pipeline_logs` → `/sistema` tab Pipeline (auditoría, visibilidad)
2. `syntage_webhook_events` → `/sistema` tab Integraciones (auditoría)
3. `syntage_electronic_accounting` → `/sistema` tab Fiscal (balanzas + pólizas)
4. `syntage_tax_retentions` → `/finanzas` sección fiscal (retenciones)

- [ ] **Step 4: Documentar decisión en inventory report**

Append a `supabase/audits/2026-04-19-inventory-report.md`:
```markdown
## S3 · Data utilization findings

### Integrating

1. (tabla) → (destino) · (razón)
2. ...

### Reporting (not integrating now)

- `syntage_files` — 16k rows, requiere diseño de download UI — propuesta: Fase futura.
- `odoo_manufacturing` — ya expuesta en /operaciones (check via grep).
- ...
```

- [ ] **Step 5: Commit audit update**
```bash
git add supabase/audits/2026-04-19-inventory-report.md
git commit -m "feat(db-audit): S3 · findings y plan de integración de 2-4 gaps"
```

## Task S3.2: Integrate gap #1 (example: pipeline_logs → /sistema tab Pipeline)

**Files (ejemplo — ajustar según decisión Task S3.1):**
- Create: `src/lib/queries/_shared/pipeline-logs.ts` (o la carpeta que aplique pre-F3 — por ahora va al flat `src/lib/queries/`)
- Create: `src/components/domain/system/pipeline-logs-panel.tsx` (o `src/components/system/` pre-F3)
- Modify: `src/app/sistema/page.tsx` (o la sub-page del tab)

- [ ] **Step 1: Schema check**

Vía `mcp__claude_ai_Supabase__execute_sql`:
```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'pipeline_logs'
ORDER BY ordinal_position;
```

- [ ] **Step 2: Write failing test**

Create `src/__tests__/queries/pipeline-logs.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";
import { getRecentPipelineLogs } from "@/lib/queries/pipeline-logs";

vi.mock("@/lib/supabase-server", () => ({
  getSupabaseServerClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        order: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve({
            data: [
              {
                id: 1,
                created_at: "2026-04-19T10:00:00Z",
                level: "info",
                message: "test log",
                source: "test-source",
              },
            ],
            error: null,
          })),
        })),
      })),
    })),
  })),
}));

describe("getRecentPipelineLogs", () => {
  it("returns rows sorted desc with limit", async () => {
    const result = await getRecentPipelineLogs(50);
    expect(result).toHaveLength(1);
    expect(result[0].message).toBe("test log");
  });
});
```

- [ ] **Step 3: Run test — see fail**
```bash
npm test -- pipeline-logs
```
Expected: FAIL (cannot find module).

- [ ] **Step 4: Create query helper**

Create `src/lib/queries/pipeline-logs.ts`:
```ts
import { getSupabaseServerClient } from "@/lib/supabase-server";

export interface PipelineLogRow {
  id: number;
  created_at: string;
  level: string;
  message: string;
  source: string | null;
  metadata: Record<string, unknown> | null;
}

export async function getRecentPipelineLogs(limit = 100): Promise<PipelineLogRow[]> {
  const sb = await getSupabaseServerClient();
  const { data, error } = await sb
    .from("pipeline_logs")
    .select("id, created_at, level, message, source, metadata")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`pipeline_logs query failed: ${error.message}`);
  return (data ?? []) as PipelineLogRow[];
}
```

**IMPORTANTE:** Adaptar el schema (`id, level, message, source, metadata`) al actual de Task S3.2 Step 1. Si hay campos distintos, ajustar.

- [ ] **Step 5: Run test passes**
```bash
npm test -- pipeline-logs
```
Expected: 1 test PASS.

- [ ] **Step 6: Create panel component**

Create `src/components/system/pipeline-logs-panel.tsx`:
```tsx
import { Suspense } from "react";
import { getRecentPipelineLogs } from "@/lib/queries/pipeline-logs";
import { LoadingTable, EmptyState, SectionHeader } from "@/components/patterns";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Activity } from "lucide-react";

async function PipelineLogsTable() {
  const logs = await getRecentPipelineLogs(100);
  if (logs.length === 0) {
    return (
      <EmptyState
        icon={Activity}
        heading="Sin logs recientes"
        description="El pipeline aún no ha registrado operaciones."
      />
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Fecha</TableHead>
          <TableHead>Nivel</TableHead>
          <TableHead>Fuente</TableHead>
          <TableHead>Mensaje</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {logs.map((log) => (
          <TableRow key={log.id}>
            <TableCell className="text-xs text-muted-foreground">
              {new Date(log.created_at).toLocaleString("es-MX")}
            </TableCell>
            <TableCell>{log.level}</TableCell>
            <TableCell className="text-xs">{log.source ?? "—"}</TableCell>
            <TableCell className="max-w-md truncate">{log.message}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function PipelineLogsPanel() {
  return (
    <section className="space-y-3">
      <SectionHeader
        title="Pipeline logs"
        description="Últimas 100 operaciones del pipeline. Auditoría de sync y jobs."
      />
      <Suspense fallback={<LoadingTable rows={10} columns={4} />}>
        <PipelineLogsTable />
      </Suspense>
    </section>
  );
}
```

- [ ] **Step 7: Integrate into /sistema**

Inspect `src/app/sistema/page.tsx`. Add import + section:
```tsx
import { PipelineLogsPanel } from "@/components/system/pipeline-logs-panel";

// ... dentro del JSX existente de /sistema:
<PipelineLogsPanel />
```

(Si `/sistema` tiene tabs, añadir en el tab de Pipeline o crear uno.)

- [ ] **Step 8: V-gate**
```bash
npm run lint && npx tsc --noEmit --skipLibCheck && npm run test && npm run build
```
Expected: passing.

- [ ] **Step 9: Commit**
```bash
git add src/lib/queries/pipeline-logs.ts \
        src/components/system/pipeline-logs-panel.tsx \
        src/app/sistema/ \
        src/__tests__/queries/pipeline-logs.test.ts
git commit -m "feat(data): S3 · expose pipeline_logs in /sistema"
```

## Task S3.3: Integrate gap #2

Repetir estructura de Task S3.2 con el gap #2 elegido en S3.1. Misma forma: schema check → test → query helper → panel → integración → V-gate → commit.

## Task S3.4: Integrate gap #3 (opcional)

Repetir si aplica. NO integrar más de 4 total; reportar el resto en inventory report.

## Task S3.5: S3 wrap-up

- [ ] **Step 1: V-gate final**
```bash
npm run lint && npx tsc --noEmit --skipLibCheck && npm run test && npm run build
```

- [ ] **Step 2: Push**
```bash
git push origin main
```
Monitorear Vercel ~2min.

---

# FASE F3 — File Reorganization (1h)

**Goal:** `src/lib/queries/` flat → 6 subfolders por dominio; `src/components/` reorg.

## Task F3.1: Enumerate query imports

**Files:** read-only discovery.

- [ ] **Step 1: Listar queries actuales**
```bash
ls src/lib/queries/
```
Expected: 22 archivos + subfolders ya creados en S3 si aplica.

- [ ] **Step 2: Enumerar importers de cada archivo**
```bash
grep -rln "from \"@/lib/queries/" src --include="*.tsx" --include="*.ts" > /tmp/query-importers.txt
wc -l /tmp/query-importers.txt
```
Expected: ~80 importer files.

- [ ] **Step 3: Mapear archivo → subfolder target**

Crear un mapa (mental o en scratch):
| File | Target folder |
|---|---|
| `syntage-reconciliation.ts` | `fiscal/` |
| `syntage-health.ts` | `fiscal/` |
| `fiscal-historical.ts` | `fiscal/` |
| `sales.ts` | `operational/` |
| `purchases.ts` | `operational/` |
| `operations.ts` | `operational/` |
| `team.ts` | `operational/` |
| `unified.ts` | `unified/` |
| `invoices.ts` | `unified/` |
| `invoice-detail.ts` | `unified/` |
| `analytics.ts` | `analytics/` |
| `finance.ts` | `analytics/` |
| `dashboard.ts` | `analytics/` |
| `products.ts` | `analytics/` |
| `customer-360.ts` | `analytics/` |
| `insights.ts` | `intelligence/` |
| `evidence.ts` | `intelligence/` |
| `evidence-helpers.ts` | `intelligence/` |
| `companies.ts` | `_shared/` |
| `contacts.ts` | `_shared/` |
| `system.ts` | `_shared/` |
| `table-params.ts` | `_shared/` |
| `_helpers.ts` | `_shared/` |
| `pipeline-logs.ts` (si se creó en S3) | `_shared/` o `analytics/` según uso |

## Task F3.2: Move query files to subfolders

**Files:**
- Move: 22+ archivos de `src/lib/queries/*.ts` → subfolders.

- [ ] **Step 1: Create subfolders**
```bash
mkdir -p src/lib/queries/fiscal \
         src/lib/queries/operational \
         src/lib/queries/unified \
         src/lib/queries/analytics \
         src/lib/queries/intelligence \
         src/lib/queries/_shared
```

- [ ] **Step 2: Mover fiscal/**
```bash
git mv src/lib/queries/syntage-reconciliation.ts src/lib/queries/fiscal/
git mv src/lib/queries/syntage-health.ts src/lib/queries/fiscal/
git mv src/lib/queries/fiscal-historical.ts src/lib/queries/fiscal/
```

- [ ] **Step 3: Mover operational/**
```bash
git mv src/lib/queries/sales.ts src/lib/queries/operational/
git mv src/lib/queries/purchases.ts src/lib/queries/operational/
git mv src/lib/queries/operations.ts src/lib/queries/operational/
git mv src/lib/queries/team.ts src/lib/queries/operational/
```

- [ ] **Step 4: Mover unified/**
```bash
git mv src/lib/queries/unified.ts src/lib/queries/unified/index.ts
git mv src/lib/queries/invoices.ts src/lib/queries/unified/
git mv src/lib/queries/invoice-detail.ts src/lib/queries/unified/
```

**NOTA:** `unified.ts` se renombra a `index.ts` dentro de `unified/` para preservar `@/lib/queries/unified` como import path (sin cambiar 30+ importers).

- [ ] **Step 5: Mover analytics/**
```bash
git mv src/lib/queries/analytics.ts src/lib/queries/analytics/index.ts
git mv src/lib/queries/finance.ts src/lib/queries/analytics/
git mv src/lib/queries/dashboard.ts src/lib/queries/analytics/
git mv src/lib/queries/products.ts src/lib/queries/analytics/
git mv src/lib/queries/customer-360.ts src/lib/queries/analytics/
```

- [ ] **Step 6: Mover intelligence/**
```bash
git mv src/lib/queries/insights.ts src/lib/queries/intelligence/
git mv src/lib/queries/evidence.ts src/lib/queries/intelligence/
git mv src/lib/queries/evidence-helpers.ts src/lib/queries/intelligence/
```

- [ ] **Step 7: Mover _shared/**
```bash
git mv src/lib/queries/companies.ts src/lib/queries/_shared/
git mv src/lib/queries/contacts.ts src/lib/queries/_shared/
git mv src/lib/queries/system.ts src/lib/queries/_shared/
git mv src/lib/queries/table-params.ts src/lib/queries/_shared/
git mv src/lib/queries/_helpers.ts src/lib/queries/_shared/
```

- [ ] **Step 8: Verify queries/ folder state**
```bash
ls src/lib/queries/
```
Expected: solo subfolders (`fiscal/ operational/ unified/ analytics/ intelligence/ _shared/`). No archivos sueltos.

- [ ] **Step 9: tsc probablemente falla con 80+ errors**
```bash
npx tsc --noEmit --skipLibCheck 2>&1 | head -50
```
Expected: muchos errores "Cannot find module '@/lib/queries/<name>'". Eso se arregla en F3.3.

## Task F3.3: Update query imports

**Files:** ~80 archivos.

- [ ] **Step 1: Generar lista de replacements**

Mapeo de imports (cada uno aplica a TSX/TS):
| Old | New |
|---|---|
| `@/lib/queries/syntage-reconciliation` | `@/lib/queries/fiscal/syntage-reconciliation` |
| `@/lib/queries/syntage-health` | `@/lib/queries/fiscal/syntage-health` |
| `@/lib/queries/fiscal-historical` | `@/lib/queries/fiscal/fiscal-historical` |
| `@/lib/queries/sales` | `@/lib/queries/operational/sales` |
| `@/lib/queries/purchases` | `@/lib/queries/operational/purchases` |
| `@/lib/queries/operations` | `@/lib/queries/operational/operations` |
| `@/lib/queries/team` | `@/lib/queries/operational/team` |
| `@/lib/queries/invoices` | `@/lib/queries/unified/invoices` |
| `@/lib/queries/invoice-detail` | `@/lib/queries/unified/invoice-detail` |
| `@/lib/queries/finance` | `@/lib/queries/analytics/finance` |
| `@/lib/queries/dashboard` | `@/lib/queries/analytics/dashboard` |
| `@/lib/queries/products` | `@/lib/queries/analytics/products` |
| `@/lib/queries/customer-360` | `@/lib/queries/analytics/customer-360` |
| `@/lib/queries/insights` | `@/lib/queries/intelligence/insights` |
| `@/lib/queries/evidence` | `@/lib/queries/intelligence/evidence` |
| `@/lib/queries/evidence-helpers` | `@/lib/queries/intelligence/evidence-helpers` |
| `@/lib/queries/companies` | `@/lib/queries/_shared/companies` |
| `@/lib/queries/contacts` | `@/lib/queries/_shared/contacts` |
| `@/lib/queries/system` | `@/lib/queries/_shared/system` |
| `@/lib/queries/table-params` | `@/lib/queries/_shared/table-params` |
| `@/lib/queries/_helpers` | `@/lib/queries/_shared/_helpers` |

**NO cambiar:**
- `@/lib/queries/unified` — mantiene el path (ahora resuelve a `unified/index.ts`).
- `@/lib/queries/analytics` — mantiene el path (ahora resuelve a `analytics/index.ts`).

- [ ] **Step 2: Por cada old→new, grep + Edit**

Estrategia: por cada row de la tabla, `grep -rln "old-path" src`, luego Read+Edit cada archivo. Usar Edit con `replace_all` si el import path aparece varias veces en el mismo file.

- [ ] **Step 3: Chequeo incremental de tsc cada 5 archivos**
```bash
npx tsc --noEmit --skipLibCheck 2>&1 | head -20
```
Errors deben ir bajando.

- [ ] **Step 4: tsc clean**
```bash
npx tsc --noEmit --skipLibCheck
```
Expected: 0 errors.

## Task F3.4: Reorg components — move fiscal/ + system/ to domain/

**Files:**
- Move: `src/components/fiscal/*` → `src/components/domain/fiscal/`
- Move: `src/components/system/*` → `src/components/domain/system/`

- [ ] **Step 1: Create domain folder**
```bash
mkdir -p src/components/domain/fiscal src/components/domain/system
```

- [ ] **Step 2: Git move fiscal/**
```bash
git mv src/components/fiscal/FiscalCompanyProfileCard.tsx src/components/domain/fiscal/
git mv src/components/fiscal/FiscalHistoricoPanel.tsx src/components/domain/fiscal/
git mv src/components/fiscal/FiscalRevenueKpiCard.tsx src/components/domain/fiscal/
git mv src/components/fiscal/FiscalRevenueTrendTable.tsx src/components/domain/fiscal/
git mv src/components/fiscal/TopClientsFiscalTable.tsx src/components/domain/fiscal/
git mv src/components/fiscal/TopSuppliersFiscalTable.tsx src/components/domain/fiscal/
rmdir src/components/fiscal
```

- [ ] **Step 3: Git move system/**
```bash
git mv src/components/system/CompanyReconciliationTab.tsx src/components/domain/system/
git mv src/components/system/SyntageHealthPanel.tsx src/components/domain/system/
git mv src/components/system/SyntageReconciliationPanel.tsx src/components/domain/system/
# Si S3 creó pipeline-logs-panel.tsx:
git mv src/components/system/pipeline-logs-panel.tsx src/components/domain/system/ 2>/dev/null || true
rmdir src/components/system 2>/dev/null || true
```

- [ ] **Step 4: Update imports**
```bash
grep -rln "@/components/fiscal\|@/components/system" src --include="*.tsx" --include="*.ts"
```
Por cada archivo: Read + Edit replace:
- `@/components/fiscal` → `@/components/domain/fiscal`
- `@/components/system` → `@/components/domain/system`

- [ ] **Step 5: tsc clean**
```bash
npx tsc --noEmit --skipLibCheck
```
Expected: 0 errors.

## Task F3.5: V-gate F3 + commit

- [ ] **Step 1: V-gate**
```bash
npm run lint && npx tsc --noEmit --skipLibCheck && npm run test && npm run build
```
Expected: passing con 4 baseline failures + N nuevos de F2 passing.

- [ ] **Step 2: Commit structure**
```bash
git add -A
git commit -m "refactor(structure): F3 · queries 6 subfolders + components domain/ reorg"
```

- [ ] **Step 3: Push + Vercel verify**
```bash
git push origin main
```

---

# FASE F4 — Page Consistency Sweep (1.5h)

**Goal:** 15 pages usan `<PageLayout>` + `<PageHeader>` + loading/empty patterns canónicos.

**Batching:** 4 commits incrementales, 3-4 pages por commit.

## Task F4.1: Sweep batch 1 — priority pages

**Pages:** `/inbox`, `/cobranza`, `/finanzas`

- [ ] **Step 1: Read current /inbox page**

Read `src/app/inbox/page.tsx`. Identificar si ya usa `PageLayout` (posible tras F2).

- [ ] **Step 2: Apply PageLayout pattern to /inbox**

Verificar que el componente top-level está envuelto en `<PageLayout>` con `<PageHeader>` al inicio. Si tiene loading state custom, reemplazar por `<LoadingCard>` o `<LoadingTable>`. Si tiene empty state custom, reemplazar por `<EmptyState>`.

Ejemplo target structure:
```tsx
import { PageLayout, PageHeader, LoadingCard, EmptyState } from "@/components/patterns";
import { Suspense } from "react";

export default async function InboxPage() {
  return (
    <PageLayout>
      <PageHeader
        title="Inbox"
        description="Acciones urgentes pendientes de revisión"
        sources={["ia"]}
      />
      <Suspense fallback={<LoadingCard />}>
        <InboxContent />
      </Suspense>
    </PageLayout>
  );
}
```

- [ ] **Step 3: Apply to /cobranza**

Read + Edit `src/app/cobranza/page.tsx`. Misma pattern.

- [ ] **Step 4: Apply to /finanzas**

Read + Edit `src/app/finanzas/page.tsx`. Misma pattern. **Cuidado:** /finanzas tiene URL routing con `?section=<slug>` — NO remover esa lógica; sólo envolver en PageLayout.

- [ ] **Step 5: V-gate**
```bash
npm run lint && npx tsc --noEmit --skipLibCheck && npm run test && npm run build
```

- [ ] **Step 6: Manual smoke test**

`npm run dev`. Verificar:
- `/inbox` renderiza con layout nuevo.
- `/cobranza` idem.
- `/finanzas` idem, y el deep-link `?section=fiscal` sigue funcionando.

- [ ] **Step 7: Commit batch 1**
```bash
git add -A
git commit -m "refactor(ui): F4 · PageLayout sweep /inbox /cobranza /finanzas"
```

## Task F4.2: Sweep batch 2

**Pages:** `/ventas`, `/compras`, `/empresas`, `/empresas/[id]`

- [ ] **Step 1: Apply to /ventas, /compras**

Misma pattern que Task F4.1.

- [ ] **Step 2: Apply to /empresas**

`src/app/empresas/page.tsx` — lista de empresas.

- [ ] **Step 3: Apply to /empresas/[id]**

`src/app/empresas/[id]/page.tsx` — **este ya tiene rediseño 5 tabs de Fase 6**. SOLO envolver en `<PageLayout>` (wrap), NO modificar lógica de tabs ni `?tab=<slug>` routing.

- [ ] **Step 4: V-gate**
```bash
npm run lint && npx tsc --noEmit --skipLibCheck && npm run test && npm run build
```

- [ ] **Step 5: Manual smoke test**

Verificar:
- `/empresas` lista carga.
- `/empresas/<id>?tab=fiscal` deep-link funciona.

- [ ] **Step 6: Commit batch 2**
```bash
git add -A
git commit -m "refactor(ui): F4 · PageLayout sweep /ventas /compras /empresas"
```

## Task F4.3: Sweep batch 3

**Pages:** `/chat`, `/briefings`, `/directores`, `/operaciones`

- [ ] **Step 1: Apply a cada uno**

Misma pattern. `/directores` (ex-agents) — verificar que el rediseño post-F1 no rompió nada.

- [ ] **Step 2: V-gate + smoke + commit**
```bash
npm run lint && npx tsc --noEmit --skipLibCheck && npm run test && npm run build
git add -A
git commit -m "refactor(ui): F4 · PageLayout sweep /chat /briefings /directores /operaciones"
```

## Task F4.4: Sweep batch 4 — finaliza

**Pages:** `/equipo`, `/productos`, `/contactos`, `/sistema`, `/profile`

- [ ] **Step 1: Apply a cada uno**

**Cuidado:** `/profile` puede tener layout especial (fuera del sidebar) — sólo wrap si tiene sentido.

- [ ] **Step 2: V-gate + smoke**
```bash
npm run lint && npx tsc --noEmit --skipLibCheck && npm run test && npm run build
```

- [ ] **Step 3: Manual QA final — navegar las 15 pages**

`npm run dev`. Click-through del sidebar. Cada page:
- [ ] Layout consistente con max-w-7xl + padding.
- [ ] PageHeader visible con title.
- [ ] Loading state al refrescar muestra skeleton.
- [ ] Empty state (filtrar data para vaciar) muestra EmptyState.
- [ ] Sidebar active state correcto.

- [ ] **Step 4: Commit batch 4**
```bash
git add -A
git commit -m "refactor(ui): F4 · PageLayout sweep /equipo /productos /contactos /sistema /profile"
```

## Task F4.5: Final validation + push

- [ ] **Step 1: V-gate completo**
```bash
npm run lint && npx tsc --noEmit --skipLibCheck && npm run test && npm run build
```
Expected: 4 baseline failures + N nuevos PASS de F2 patterns. Build succeeds.

- [ ] **Step 2: Push + monitor Vercel**
```bash
git push origin main
```
Esperar Vercel deploy ~2-3min.

- [ ] **Step 3: Smoke test on Vercel preview URL**

Navegar las rutas renamed (`/agents` → redirect, `/empresas/<id>` → 5 tabs, `/inbox` → layout nuevo). Confirmar 301s funcionan en prod.

- [ ] **Step 4: Update project memory**

Modify `/Users/jj/.claude/projects/-Users-jj/memory/project_syntage_integration.md` — añadir sección al final:

```markdown
### 2026-04-19 · Frontend refactor + Supabase audit

Completado: 6 fases interleaved (S1 → F1 → F2 → S3 → F3 → F4).

**F1:** sidebar 4 grupos collapsibles (Decisión/Operación/Entidades/Sistema). Renames: /agents→/directores, /system→/sistema, /companies→/empresas, /contacts→/contactos con 301 redirects.

**F2:** `shared/v2/` → `patterns/`. Añadidos PageLayout, SectionHeader, LoadingCard/Table/List. design-system.md en docs/.

**F3:** queries en 6 subfolders (fiscal/operational/unified/analytics/intelligence/_shared). components/{fiscal,system} → domain/{fiscal,system}.

**F4:** 15 pages sweep con PageLayout + PageHeader + patterns.

**S1:** legacy views aliased a analytics_* convention. Deprecation plan: sunset 2026-06-01.

**S3:** integradas N tablas (ej. pipeline_logs → /sistema, ...). Reportadas otras en audits/.

**Preservado:** DataSourceBadge, 5 tabs de /empresas/[id], URL routing con ?tab=/?section=, unstable_cache, 72 insights fiscal_annotation, reconciliation_issues + pg_cron, baseline 4 test failures.
```

- [ ] **Step 5: Final commit (memory)**

Memory no está en git del proyecto. No commit needed for that file.

---

## Final checklist

- [ ] S1 inventory query + legacy view aliases + deprecation plan committed.
- [ ] F1 sidebar 4 groups + 4 route renames + 301 redirects + internal links updated.
- [ ] F2 v2 → patterns + 3 new components + design-system.md.
- [ ] S3 2-4 data gaps integrated + inventory report updated.
- [ ] F3 queries 6 subfolders + components/domain reorg.
- [ ] F4 15 pages swept with PageLayout in 4 commits.
- [ ] All V-gates passing at each commit.
- [ ] Vercel deploy successful.
- [ ] Project memory updated.

---

## Self-review notes

- **Spec coverage:** Every section of `2026-04-19-frontend-refactor-supabase-audit-design.md` has a task: §4.1=S1.1-S1.4, §4.2=F1.1-F1.7, §4.3=F2.1-F2.7, §4.4=S3.1-S3.5, §4.5=F3.1-F3.5, §4.6=F4.1-F4.5.
- **Placeholder scan:** No TBDs. Gap placeholders in S3 are intentional — they depend on S1 output.
- **Type consistency:** PageLayout props, SectionHeader props, LoadingTable/Card/List props all match across tasks and examples.
- **Order dependencies:** S1 before F3 (view names canonical before queries reorg). F1 before F4 (rename routes before sweeping pages). F2 before F4 (patterns ready before page sweep).
