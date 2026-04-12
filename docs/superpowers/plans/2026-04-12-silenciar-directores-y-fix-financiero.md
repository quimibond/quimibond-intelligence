# Silenciar Directores Ruidosos + Fix Director Financiero

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Subir la action-rate de los 4 directores ruidosos (financiero 3%, equipo 6%, operaciones 8%, riesgo 9%) a ≥20% activando filtros per-agente via `ai_agents.config`, contando `expired` como señal negativa en la calibración adaptiva, y partiendo al Director Financiero en 2 modos (operativo/estratégico) con menos secciones y conectando la view `budget_vs_actual` que hoy nadie consulta.

**Architecture:** Todo vive en `src/app/api/agents/orchestrate/route.ts` + helpers nuevos en `src/lib/agents/`. Introducimos una capa `DirectorConfig` que lee `ai_agents.config` (jsonb) con defaults conservadores y la aplicamos ANTES de insertar insights (filtra por `business_impact_estimate`, limita `max_insights_per_run` per-agente, rota modo). Cambiamos `getAgentConfidenceThreshold` para incluir `expired` como soft-dismiss. Para financiero, la función `buildAgentContext` elige entre dos builders según el modo persistido en `agent_memory` (`memory_type='mode_rotation'`). Migración SQL siembra `config` para los 7 directores activos.

**Tech Stack:** TypeScript, Next.js 15 API route, Supabase JS client, Vitest + jsdom, Claude API.

**Assumptions verificadas:**
- `ai_agents.config` es `jsonb`, actualmente `{}` en los 8 activos.
- `agent_memory` tiene columnas `agent_id, memory_type, content, importance, created_at, updated_at`.
- View `budget_vs_actual` existe (confirmado) y tabla `budgets` existe (input manual).
- `agent_insights` tiene `state` con valores `new|seen|acted_on|dismissed|expired|archived` y `business_impact_estimate numeric`.
- Vitest config usa jsdom y alias `@` → `./src`.
- `getAgentConfidenceThreshold` hoy NO considera `expired`, solo `acted_on|dismissed`.
- Archivo `src/app/api/agents/orchestrate/route.ts` tiene ~1385 líneas. Toda función auxiliar nueva vive fuera para mantenerlo manejable.

**Fuera de scope (planes separados):**
- Desactivar/borrar los 9 agentes archivados (no bloquea este plan; solo ruido en métricas históricas).
- Conectar `odoo_manufacturing` (tabla NO existe en Supabase hoy pese a CLAUDE.md; requiere fix en addon qb19 primero).
- Datos de `odoo_invoice_lines` product-level a costos, `odoo_purchase_orders.date_approve` a compras, `employee_metrics` a equipo. Cada uno es su propio plan.

---

## File Structure

**Crear:**
- `src/lib/agents/director-config.ts` — tipo `DirectorConfig`, `loadDirectorConfig(supabase, agentId)`, `filterInsightsByConfig(insights, config)`.
- `src/lib/agents/mode-rotation.ts` — `getNextMode(supabase, agentId, modes)`, persiste en `agent_memory`.
- `src/lib/agents/financiero-context.ts` — `buildFinancieroContextOperativo(sb, profileSection)` y `buildFinancieroContextEstrategico(sb, profileSection)`.
- `src/__tests__/agents/director-config.test.ts`
- `src/__tests__/agents/mode-rotation.test.ts`
- `supabase/migrations/20260412_director_config_seed.sql`

**Modificar:**
- `src/app/api/agents/orchestrate/route.ts`
  - `getAgentConfidenceThreshold` (L493–560): sumar `expired` al denominador de `acted_rate`/`dismiss_rate`.
  - Bloque de inserción (L355–420): llamar `filterInsightsByConfig` antes del `.insert`.
  - `buildAgentContext` case `"financiero"` (L1108–1146): delegar a los builders nuevos según modo retornado por `getNextMode`.

---

## Tareas

### Task 1: Tipo y loader de `DirectorConfig` (test first)

**Files:**
- Create: `src/lib/agents/director-config.ts`
- Test: `src/__tests__/agents/director-config.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
// src/__tests__/agents/director-config.test.ts
import { describe, it, expect, vi } from "vitest";
import { loadDirectorConfig, DEFAULT_DIRECTOR_CONFIG } from "@/lib/agents/director-config";

function mockSupabase(configRow: Record<string, unknown> | null) {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: configRow, error: null }),
        }),
      }),
    }),
  };
}

describe("loadDirectorConfig", () => {
  it("devuelve defaults cuando config es {}", async () => {
    const sb = mockSupabase({ config: {} });
    const cfg = await loadDirectorConfig(sb as never, 14);
    expect(cfg).toEqual(DEFAULT_DIRECTOR_CONFIG);
  });

  it("merge con defaults: override solo de campos presentes", async () => {
    const sb = mockSupabase({ config: { min_business_impact_mxn: 50000, max_insights_per_run: 2 } });
    const cfg = await loadDirectorConfig(sb as never, 14);
    expect(cfg.min_business_impact_mxn).toBe(50000);
    expect(cfg.max_insights_per_run).toBe(2);
    expect(cfg.mode_rotation).toEqual(DEFAULT_DIRECTOR_CONFIG.mode_rotation);
  });

  it("si no hay fila, devuelve defaults", async () => {
    const sb = mockSupabase(null);
    const cfg = await loadDirectorConfig(sb as never, 999);
    expect(cfg).toEqual(DEFAULT_DIRECTOR_CONFIG);
  });

  it("valida tipos: rechaza max_insights > 10 (clamp a 10)", async () => {
    const sb = mockSupabase({ config: { max_insights_per_run: 99 } });
    const cfg = await loadDirectorConfig(sb as never, 14);
    expect(cfg.max_insights_per_run).toBe(10);
  });

  it("valida tipos: min_business_impact < 0 → 0", async () => {
    const sb = mockSupabase({ config: { min_business_impact_mxn: -500 } });
    const cfg = await loadDirectorConfig(sb as never, 14);
    expect(cfg.min_business_impact_mxn).toBe(0);
  });
});
```

- [ ] **Step 2: Correr el test y confirmar que falla**

Run: `npx vitest run src/__tests__/agents/director-config.test.ts`
Expected: FAIL con `Cannot find module '@/lib/agents/director-config'`.

- [ ] **Step 3: Implementar `director-config.ts`**

```ts
// src/lib/agents/director-config.ts
import type { SupabaseClient } from "@supabase/supabase-js";

export interface DirectorConfig {
  /** Mínimo de impacto económico (MXN) para que un insight pase. 0 = sin filtro. */
  min_business_impact_mxn: number;
  /** Máx insights insertados por corrida (0 = usar default global de la ruta). */
  max_insights_per_run: number;
  /** Modos rotativos del director. Si tiene 2+, cada corrida usa el siguiente. */
  mode_rotation: string[];
  /** Piso de confianza adicional (si > 0, se aplica sobre el adaptive threshold). */
  min_confidence_floor: number;
}

export const DEFAULT_DIRECTOR_CONFIG: DirectorConfig = {
  min_business_impact_mxn: 0,
  max_insights_per_run: 0,
  mode_rotation: [],
  min_confidence_floor: 0,
};

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export async function loadDirectorConfig(
  supabase: SupabaseClient,
  agentId: number
): Promise<DirectorConfig> {
  const { data } = await supabase
    .from("ai_agents")
    .select("config")
    .eq("id", agentId)
    .maybeSingle();

  const raw = (data?.config ?? {}) as Record<string, unknown>;
  return {
    min_business_impact_mxn: clamp(Number(raw.min_business_impact_mxn ?? 0), 0, 10_000_000),
    max_insights_per_run: clamp(Number(raw.max_insights_per_run ?? 0), 0, 10),
    mode_rotation: Array.isArray(raw.mode_rotation)
      ? (raw.mode_rotation as unknown[]).map(String).filter(Boolean)
      : [],
    min_confidence_floor: clamp(Number(raw.min_confidence_floor ?? 0), 0, 1),
  };
}
```

- [ ] **Step 4: Correr el test y confirmar pase**

Run: `npx vitest run src/__tests__/agents/director-config.test.ts`
Expected: PASS 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agents/director-config.ts src/__tests__/agents/director-config.test.ts
git commit -m "feat(agents): DirectorConfig loader con defaults y clamps"
```

---

### Task 2: Filtro `filterInsightsByConfig` (test first)

**Files:**
- Modify: `src/lib/agents/director-config.ts`
- Modify: `src/__tests__/agents/director-config.test.ts`

- [ ] **Step 1: Añadir test que falla**

```ts
// Añadir al final de src/__tests__/agents/director-config.test.ts
import { filterInsightsByConfig, DEFAULT_DIRECTOR_CONFIG } from "@/lib/agents/director-config";

describe("filterInsightsByConfig", () => {
  const baseInsight = (overrides: Record<string, unknown>) => ({
    title: "x", description: "x", severity: "medium", confidence: 0.9,
    business_impact_estimate: 100_000, category: "cobranza", ...overrides,
  });

  it("deja pasar todo con config default", () => {
    const ins = [baseInsight({}), baseInsight({ business_impact_estimate: 0 })];
    const out = filterInsightsByConfig(ins, DEFAULT_DIRECTOR_CONFIG);
    expect(out).toHaveLength(2);
  });

  it("descarta insights bajo min_business_impact_mxn", () => {
    const ins = [
      baseInsight({ business_impact_estimate: 10_000 }),
      baseInsight({ business_impact_estimate: 100_000 }),
      baseInsight({ business_impact_estimate: null }),
    ];
    const cfg = { ...DEFAULT_DIRECTOR_CONFIG, min_business_impact_mxn: 50_000 };
    const out = filterInsightsByConfig(ins, cfg);
    expect(out).toHaveLength(1);
    expect(out[0].business_impact_estimate).toBe(100_000);
  });

  it("excepción: severity='critical' pasa aunque no tenga impacto", () => {
    const ins = [baseInsight({ severity: "critical", business_impact_estimate: null })];
    const cfg = { ...DEFAULT_DIRECTOR_CONFIG, min_business_impact_mxn: 50_000 };
    const out = filterInsightsByConfig(ins, cfg);
    expect(out).toHaveLength(1);
  });

  it("aplica max_insights_per_run (ordena por impacto desc)", () => {
    const ins = [
      baseInsight({ business_impact_estimate: 10_000, title: "a" }),
      baseInsight({ business_impact_estimate: 500_000, title: "b" }),
      baseInsight({ business_impact_estimate: 100_000, title: "c" }),
    ];
    const cfg = { ...DEFAULT_DIRECTOR_CONFIG, max_insights_per_run: 2 };
    const out = filterInsightsByConfig(ins, cfg);
    expect(out).toHaveLength(2);
    expect(out.map(i => i.title)).toEqual(["b", "c"]);
  });

  it("aplica min_confidence_floor", () => {
    const ins = [
      baseInsight({ confidence: 0.82 }),
      baseInsight({ confidence: 0.90 }),
    ];
    const cfg = { ...DEFAULT_DIRECTOR_CONFIG, min_confidence_floor: 0.88 };
    const out = filterInsightsByConfig(ins, cfg);
    expect(out).toHaveLength(1);
    expect(out[0].confidence).toBe(0.90);
  });
});
```

- [ ] **Step 2: Correr y confirmar fail**

Run: `npx vitest run src/__tests__/agents/director-config.test.ts`
Expected: FAIL — `filterInsightsByConfig is not exported`.

- [ ] **Step 3: Implementar la función**

```ts
// Añadir al final de src/lib/agents/director-config.ts
export interface RawInsight {
  title?: unknown;
  description?: unknown;
  severity?: unknown;
  confidence?: unknown;
  business_impact_estimate?: unknown;
  category?: unknown;
  [k: string]: unknown;
}

export function filterInsightsByConfig<T extends RawInsight>(
  insights: T[],
  cfg: DirectorConfig
): T[] {
  let out = insights.slice();

  if (cfg.min_confidence_floor > 0) {
    out = out.filter(i => Number(i.confidence ?? 0) >= cfg.min_confidence_floor);
  }

  if (cfg.min_business_impact_mxn > 0) {
    out = out.filter(i => {
      if (String(i.severity ?? "") === "critical") return true;
      const impact = Number(i.business_impact_estimate ?? 0);
      return impact >= cfg.min_business_impact_mxn;
    });
  }

  if (cfg.max_insights_per_run > 0 && out.length > cfg.max_insights_per_run) {
    out.sort((a, b) => {
      const ai = Number(a.business_impact_estimate ?? 0);
      const bi = Number(b.business_impact_estimate ?? 0);
      return bi - ai;
    });
    out = out.slice(0, cfg.max_insights_per_run);
  }

  return out;
}
```

- [ ] **Step 4: Correr y confirmar pase**

Run: `npx vitest run src/__tests__/agents/director-config.test.ts`
Expected: PASS 10 tests (5 loader + 5 filter).

- [ ] **Step 5: Commit**

```bash
git add src/lib/agents/director-config.ts src/__tests__/agents/director-config.test.ts
git commit -m "feat(agents): filterInsightsByConfig con min_impact, max_run, confidence floor"
```

---

### Task 3: `mode-rotation.ts` — rotación persistente de modos

**Files:**
- Create: `src/lib/agents/mode-rotation.ts`
- Test: `src/__tests__/agents/mode-rotation.test.ts`

- [ ] **Step 1: Test que falla**

```ts
// src/__tests__/agents/mode-rotation.test.ts
import { describe, it, expect, vi } from "vitest";
import { getNextMode } from "@/lib/agents/mode-rotation";

function mockSb(existing: { content?: string; id?: number } | null) {
  const upsert = vi.fn().mockResolvedValue({ data: null, error: null });
  return {
    _upsert: upsert,
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: existing, error: null }),
          }),
        }),
      }),
      upsert,
    }),
  };
}

describe("getNextMode", () => {
  it("devuelve primer modo si no hay memoria previa", async () => {
    const sb = mockSb(null);
    const mode = await getNextMode(sb as never, 14, ["operativo", "estrategico"]);
    expect(mode).toBe("operativo");
    expect(sb._upsert).toHaveBeenCalled();
  });

  it("rota al siguiente modo", async () => {
    const sb = mockSb({ content: "operativo", id: 1 });
    const mode = await getNextMode(sb as never, 14, ["operativo", "estrategico"]);
    expect(mode).toBe("estrategico");
  });

  it("vuelve al inicio tras el último", async () => {
    const sb = mockSb({ content: "estrategico", id: 1 });
    const mode = await getNextMode(sb as never, 14, ["operativo", "estrategico"]);
    expect(mode).toBe("operativo");
  });

  it("si modes está vacío devuelve cadena vacía y no escribe", async () => {
    const sb = mockSb(null);
    const mode = await getNextMode(sb as never, 14, []);
    expect(mode).toBe("");
    expect(sb._upsert).not.toHaveBeenCalled();
  });

  it("si el modo guardado ya no está en la lista, arranca desde 0", async () => {
    const sb = mockSb({ content: "legacy", id: 1 });
    const mode = await getNextMode(sb as never, 14, ["operativo", "estrategico"]);
    expect(mode).toBe("operativo");
  });
});
```

- [ ] **Step 2: Confirmar fail**

Run: `npx vitest run src/__tests__/agents/mode-rotation.test.ts`
Expected: FAIL — módulo no existe.

- [ ] **Step 3: Implementar**

```ts
// src/lib/agents/mode-rotation.ts
import type { SupabaseClient } from "@supabase/supabase-js";

const MEMORY_TYPE = "mode_rotation";

export async function getNextMode(
  supabase: SupabaseClient,
  agentId: number,
  modes: string[]
): Promise<string> {
  if (!modes.length) return "";

  const { data: existing } = await supabase
    .from("agent_memory")
    .select("id, content")
    .eq("agent_id", agentId)
    .eq("memory_type", MEMORY_TYPE)
    .maybeSingle();

  const currentIdx = existing?.content ? modes.indexOf(existing.content) : -1;
  const nextIdx = currentIdx < 0 ? 0 : (currentIdx + 1) % modes.length;
  const nextMode = modes[nextIdx];

  await supabase.from("agent_memory").upsert(
    {
      id: existing?.id,
      agent_id: agentId,
      memory_type: MEMORY_TYPE,
      content: nextMode,
      importance: 1,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" }
  );

  return nextMode;
}
```

- [ ] **Step 4: Pase**

Run: `npx vitest run src/__tests__/agents/mode-rotation.test.ts`
Expected: PASS 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agents/mode-rotation.ts src/__tests__/agents/mode-rotation.test.ts
git commit -m "feat(agents): mode-rotation persistente en agent_memory"
```

---

### Task 4: `getAgentConfidenceThreshold` cuenta `expired` como soft-dismiss

**Files:**
- Modify: `src/app/api/agents/orchestrate/route.ts:517-557`

- [ ] **Step 1: Añadir test de regresión contra la lógica antigua (fail)**

No hay test unitario actual para esta función (está inline en el route). Creamos uno extrayendo una copia aislada:

Crear `src/__tests__/agents/confidence-threshold.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
// Importamos la función desde un módulo nuevo que vamos a crear en step 3
import { computeAdaptiveThreshold } from "@/lib/agents/confidence-threshold";

describe("computeAdaptiveThreshold", () => {
  it("sin datos suficientes → 0.80", () => {
    expect(computeAdaptiveThreshold({ acted: 1, dismissed: 1, expired: 0, total: 5 })).toBe(0.80);
  });

  it("expired alto (CEO ignora) → soft dismiss suma al ratio negativo", () => {
    // 2 acted, 0 dismissed, 30 expired de 32 → dismissRate efectivo = 94% → 0.92
    const t = computeAdaptiveThreshold({ acted: 2, dismissed: 0, expired: 30, total: 32 });
    expect(t).toBe(0.92);
  });

  it("acted_rate alto (>25%) → 0.70", () => {
    expect(computeAdaptiveThreshold({ acted: 10, dismissed: 2, expired: 3, total: 15 })).toBe(0.70);
  });

  it("acted_rate bajo (<10%) → 0.85", () => {
    expect(computeAdaptiveThreshold({ acted: 1, dismissed: 2, expired: 12, total: 15 })).toBe(0.85);
  });
});
```

- [ ] **Step 2: Confirmar fail**

Run: `npx vitest run src/__tests__/agents/confidence-threshold.test.ts`
Expected: FAIL — módulo no existe.

- [ ] **Step 3: Crear módulo con función pura**

```ts
// src/lib/agents/confidence-threshold.ts
export interface ThresholdInput {
  acted: number;
  dismissed: number;
  /** Insights que expiraron sin acción — soft dismiss */
  expired: number;
  total: number;
}

export function computeAdaptiveThreshold(input: ThresholdInput): number {
  const { acted, dismissed, expired, total } = input;

  if (total < 10) return 0.80;

  // Soft dismiss: expired cuenta como 0.5 dismiss (CEO vio la notif pero no actuó)
  const effectiveDismiss = dismissed + expired * 0.5;
  const decided = acted + effectiveDismiss;
  if (decided <= 0) return 0.80;

  const dismissRate = (effectiveDismiss / decided) * 100;
  const actedRate = (acted / decided) * 100;

  if (dismissRate > 60) return 0.92;
  if (dismissRate > 40) return 0.88;
  if (dismissRate > 20) return 0.83;

  if (actedRate < 10) return 0.85;
  if (actedRate < 20) return 0.80;
  if (actedRate > 25) return 0.70;

  return 0.80;
}
```

- [ ] **Step 4: Pase**

Run: `npx vitest run src/__tests__/agents/confidence-threshold.test.ts`
Expected: PASS 4 tests.

- [ ] **Step 5: Reemplazar la lógica inline en `orchestrate/route.ts`**

Abrir `src/app/api/agents/orchestrate/route.ts`. Localizar `getAgentConfidenceThreshold` (empieza en L493). Dentro del bloque `if (eff && eff.total_insights >= 10)` reemplazar el ladder de ifs manual por una llamada. Query la vista también trayendo `expired_rate_pct` si existe, y si no, traerlo via un count separado.

Cambio mínimo exacto — reemplazar L517-540 por:

```ts
    if (eff && eff.total_insights >= 10) {
      const actedRate = Number(eff.acted_rate_pct ?? 0);
      const dismissRate = Number(eff.dismiss_rate_pct ?? 0);
      const total = Number(eff.total_insights ?? 0);

      const { count: expiredCount } = await supabase
        .from("agent_insights")
        .select("id", { count: "exact", head: true })
        .eq("agent_id", agentId)
        .eq("state", "expired")
        .gte("created_at", new Date(Date.now() - 30 * 86400_000).toISOString());

      const acted = Math.round((actedRate / 100) * total);
      const dismissed = Math.round((dismissRate / 100) * total);
      const { computeAdaptiveThreshold } = await import("@/lib/agents/confidence-threshold");
      return computeAdaptiveThreshold({
        acted,
        dismissed,
        expired: Number(expiredCount ?? 0),
        total,
      });
    }
```

- [ ] **Step 6: Type-check + re-run todos los tests del módulo**

Run: `npx tsc --noEmit && npx vitest run src/__tests__/agents/`
Expected: sin errores, todos los tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/agents/confidence-threshold.ts src/__tests__/agents/confidence-threshold.test.ts src/app/api/agents/orchestrate/route.ts
git commit -m "fix(agents): expired cuenta como soft-dismiss en adaptive threshold"
```

---

### Task 5: Wire `DirectorConfig` en el bloque de inserción del orchestrate

**Files:**
- Modify: `src/app/api/agents/orchestrate/route.ts:219` y `:416`

- [ ] **Step 1: Importar en el top del archivo**

Añadir junto a los otros imports (después de `import { computeExpiresAt } from "@/lib/insight-ttl";`):

```ts
import { loadDirectorConfig, filterInsightsByConfig } from "@/lib/agents/director-config";
```

- [ ] **Step 2: Cargar config después de `confidenceThreshold`**

Localizar L219:
```ts
const confidenceThreshold = await getAgentConfidenceThreshold(supabase, agent.id);
```

Añadir justo después:
```ts
const directorConfig = await loadDirectorConfig(supabase, agent.id);
// Piso adicional desde config (si está seteado)
const effectiveThreshold = Math.max(confidenceThreshold, directorConfig.min_confidence_floor);
```

Luego reemplazar todas las usos de `confidenceThreshold` de esta corrida por `effectiveThreshold` (grep el símbolo en el scope de `runAgent`, hay 3 ocurrencias en L235, L407, L468).

- [ ] **Step 3: Aplicar `filterInsightsByConfig` antes del `.insert`**

Localizar L416 (`const { data: savedInsights, error: insertErr } = await supabase.from("agent_insights").insert(rows).select("id");`).

Justo ANTES del `console.log` de L410 añadir:

```ts
// Apply per-director config filter (min_business_impact, max_insights, etc.)
const filteredRows = filterInsightsByConfig(rows, directorConfig);
if (filteredRows.length < rows.length) {
  console.log(`[orchestrate] ${agent.slug} config filter: ${rows.length} → ${filteredRows.length}`);
}
```

Luego reemplazar `insert(rows)` por `insert(filteredRows)` en la línea del insert, y `rows[idx]` por `filteredRows[idx]` en el bloque de `actionRows` (L439).

- [ ] **Step 4: Type-check y lint**

Run: `npx tsc --noEmit && npx next lint`
Expected: sin errores.

- [ ] **Step 5: Smoke test local (si hay servidor dev)**

Opcional si `npm run dev` está disponible:
```bash
curl -s "http://localhost:3000/api/agents/run?agent=comercial" -H "x-cron-secret: $CRON_SECRET" | jq '.insights_generated, .duplicates_skipped'
```
Expected: no errores 500, `insights_generated` es un número.

Si no hay dev server corriendo, saltar a commit.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/agents/orchestrate/route.ts
git commit -m "feat(agents): aplica DirectorConfig (filter + confidence floor) antes del insert"
```

---

### Task 6: Split Director Financiero en 2 modos (operativo/estratégico)

**Files:**
- Create: `src/lib/agents/financiero-context.ts`
- Modify: `src/app/api/agents/orchestrate/route.ts:1108-1146` (case `"financiero"`)

- [ ] **Step 1: Extraer los dos builders del switch actual**

Crear `src/lib/agents/financiero-context.ts`:

```ts
// src/lib/agents/financiero-context.ts
import type { SupabaseClient } from "@supabase/supabase-js";

function safeJSON(v: unknown): string {
  try { return JSON.stringify(v, null, 2); } catch { return "[]"; }
}

/**
 * MODO OPERATIVO: lo que debe pasar ESTA SEMANA.
 * Foco: cartera vencida, cobros, pagos, runway.
 * 6 queries — contexto chico y accionable.
 */
export async function buildFinancieroContextOperativo(
  sb: SupabaseClient,
  profileSection: string
): Promise<string> {
  const [overdueByCompany, inboundPayments, supplierOverdue, outboundPayments, runwayRes, payPredictions] = await Promise.all([
    sb.from("company_profile")
      .select("name, pending_amount, overdue_amount, overdue_count, max_days_overdue, total_revenue, tier")
      .gt("overdue_amount", 0)
      .order("overdue_amount", { ascending: false })
      .limit(15),
    sb.from("odoo_account_payments")
      .select("company_id, amount, date, journal_name, payment_method")
      .eq("payment_type", "inbound")
      .order("date", { ascending: false })
      .limit(10),
    sb.from("odoo_invoices")
      .select("company_id, name, amount_total, amount_residual, days_overdue, due_date, payment_term")
      .eq("move_type", "in_invoice")
      .in("payment_state", ["not_paid", "partial"])
      .gt("days_overdue", 0)
      .order("days_overdue", { ascending: false })
      .limit(15),
    sb.from("odoo_account_payments")
      .select("company_id, amount, date, journal_name, payment_method")
      .eq("payment_type", "outbound")
      .order("date", { ascending: false })
      .limit(10),
    sb.rpc("cashflow_runway").then((r: { data: unknown }) => r).catch(() => ({ data: null })),
    sb.from("payment_predictions")
      .select("company_name, tier, avg_days_to_pay, max_days_overdue, total_pending, payment_risk")
      .in("payment_risk", ["CRITICO: excede maximo historico", "ALTO: fuera de patron normal"])
      .order("total_pending", { ascending: false })
      .limit(10),
  ]);

  const runway = runwayRes.data as Record<string, unknown> | null;

  return `${profileSection}## MODO: OPERATIVO (qué cobrar/pagar esta semana)
## ALERTA CASH FLOW (runway)
${runway?.alerta ?? "Sin datos"}
Dias de runway: ${runway?.dias_runway ?? "?"} | Nomina mensual estimada: $${runway?.nomina_mensual_estimada ?? "?"}
Proyeccion 7d: ${safeJSON(runway?.proyeccion_7d)}
Proyeccion 15d: ${safeJSON(runway?.proyeccion_15d)}

## CARTERA VENCIDA POR EMPRESA
${safeJSON(overdueByCompany.data)}

## PREDICCION DE PAGO (clientes fuera de patrón)
${safeJSON(payPredictions.data)}

## COBROS RECIENTES
${safeJSON(inboundPayments.data)}

## FACTURAS PROVEEDOR VENCIDAS (lo que debemos ya)
${safeJSON(supplierOverdue.data)}

## PAGOS A PROVEEDORES (recientes)
${safeJSON(outboundPayments.data)}`;
}

/**
 * MODO ESTRATÉGICO: la foto del mes y desvíos estructurales.
 * Foco: P&L, capital de trabajo, presupuesto vs real, anomalías.
 * 6 queries — análisis profundo.
 */
export async function buildFinancieroContextEstrategico(
  sb: SupabaseClient,
  profileSection: string
): Promise<string> {
  const [cfoDash, plReport, workingCap, bankBalances, anomalies, budgetVsActual] = await Promise.all([
    sb.from("cfo_dashboard").select("*").limit(1),
    sb.from("pl_estado_resultados").select("*").order("period", { ascending: false }).limit(6),
    sb.from("working_capital").select("*").limit(1),
    sb.from("odoo_bank_balances").select("name, journal_type, currency, current_balance").order("current_balance", { ascending: false }),
    sb.from("accounting_anomalies")
      .select("anomaly_type, severity, description, company_name, amount")
      .order("amount", { ascending: false })
      .limit(15),
    sb.from("budget_vs_actual")
      .select("*")
      .order("period", { ascending: false })
      .limit(30),
  ]);

  const dash = (cfoDash.data ?? [])[0] as Record<string, unknown> | undefined;
  const wc = ((workingCap.data ?? []) as Record<string, unknown>[])[0];
  const activeBanks = ((bankBalances.data ?? []) as Record<string, unknown>[]).filter(b => Number(b.current_balance ?? 0) !== 0);

  return `${profileSection}## MODO: ESTRATEGICO (foto del mes y desvios)
## RESUMEN EJECUTIVO CFO
Efectivo disponible: $${dash?.efectivo_disponible ?? "?"} | Deuda tarjetas: $${dash?.deuda_tarjetas ?? "?"} | Posición neta: $${dash?.posicion_neta ?? "?"} | CxC: $${dash?.cuentas_por_cobrar ?? "?"} | CxP: $${dash?.cuentas_por_pagar ?? "?"} | Cartera vencida: $${dash?.cartera_vencida ?? "?"} | Ventas 30d: $${dash?.ventas_30d ?? "?"} | Cobros 30d: $${dash?.cobros_30d ?? "?"}

## CAPITAL DE TRABAJO
Efectivo neto: $${wc?.efectivo_neto ?? "?"} | Capital de trabajo: $${wc?.capital_de_trabajo ?? "?"} | Ratio liquidez: ${wc?.ratio_liquidez ?? "?"}

## ESTADO DE RESULTADOS (P&L últimos 6 meses)
${safeJSON(plReport.data)}

## SALDOS BANCARIOS (solo cuentas con movimiento)
${safeJSON(activeBanks)}

## PRESUPUESTO VS REAL (desvíos por cuenta contable)
${safeJSON(budgetVsActual.data)}

## ANOMALIAS CONTABLES
${safeJSON(anomalies.data)}`;
}
```

- [ ] **Step 2: Sustituir el case `"financiero"` en el switch**

En `src/app/api/agents/orchestrate/route.ts` localizar el bloque que empieza con `case "financiero": {` (cerca L1108) y terminar en su `}`. Reemplazar TODO el cuerpo del case por:

```ts
    case "financiero": {
      const { buildFinancieroContextOperativo, buildFinancieroContextEstrategico } =
        await import("@/lib/agents/financiero-context");
      const { getNextMode } = await import("@/lib/agents/mode-rotation");
      const modes = directorConfig.mode_rotation.length
        ? directorConfig.mode_rotation
        : ["operativo", "estrategico"];
      const mode = await getNextMode(sb, agentId!, modes);
      if (mode === "estrategico") {
        return buildFinancieroContextEstrategico(sb, profileSection);
      }
      return buildFinancieroContextOperativo(sb, profileSection);
    }
```

**Importante:** `buildAgentContext` recibe `domain` pero no `directorConfig`. Hay dos opciones:

a) Cambiar la firma de `buildAgentContext` a `(supabase, domain, agentId?, directorConfig?)` — propagar el parámetro desde L189.
b) Volver a cargar el config dentro del case (una query extra).

**Elegir (a)**. Cambios adicionales:

1. L795: cambiar a `async function buildAgentContext(supabase: any, domain: string, agentId?: number, directorConfig?: import("@/lib/agents/director-config").DirectorConfig): Promise<string> {`
2. L189: cambiar a `const context = await buildAgentContext(supabase, agent.domain, agent.id, directorConfig);`
3. Dentro del case `"financiero"`, si `directorConfig` es undefined, usar defaults: `const cfg = directorConfig ?? { mode_rotation: [] as string[], ... };` — más simple: el case asume que siempre viene porque lo pasamos en L189.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 4: Test manual del switch de modos (si hay dev server)**

```bash
curl -s "http://localhost:3000/api/agents/run?agent=financiero" -H "x-cron-secret: $CRON_SECRET" > /tmp/run1.json
curl -s "http://localhost:3000/api/agents/run?agent=financiero" -H "x-cron-secret: $CRON_SECRET" > /tmp/run2.json
grep -o "MODO: [A-Z]*" /tmp/run1.json /tmp/run2.json
```

Expected: uno dice `MODO: OPERATIVO` y el otro `MODO: ESTRATEGICO` (no importa el orden).

Si no hay dev server, verificar con una query a Supabase:
```sql
SELECT content, updated_at FROM agent_memory WHERE agent_id=14 AND memory_type='mode_rotation';
```
(se actualiza tras la primera corrida real en prod).

- [ ] **Step 5: Commit**

```bash
git add src/lib/agents/financiero-context.ts src/app/api/agents/orchestrate/route.ts
git commit -m "feat(financiero): split en modos operativo/estrategico + wire budget_vs_actual"
```

---

### Task 7: Migración SQL — seed `config` para los 7 directores activos

**Files:**
- Create: `supabase/migrations/20260412_director_config_seed.sql`

- [ ] **Step 1: Escribir la migración**

```sql
-- supabase/migrations/20260412_director_config_seed.sql
-- Seeds ai_agents.config para los 7 directores activos.
-- Valores calibrados con base en acted/expired rate de últimos 30d.

-- Financiero: muy ruidoso (3% acted). Solo insights >$50K o severity critical.
-- Rotación operativo/estratégico.
UPDATE ai_agents
SET config = jsonb_build_object(
  'min_business_impact_mxn', 50000,
  'max_insights_per_run', 2,
  'mode_rotation', jsonb_build_array('operativo', 'estrategico'),
  'min_confidence_floor', 0.85
)
WHERE slug = 'financiero';

-- Equipo: 6% acted. Floor alto y tope bajo.
UPDATE ai_agents
SET config = jsonb_build_object(
  'min_business_impact_mxn', 25000,
  'max_insights_per_run', 2,
  'mode_rotation', jsonb_build_array(),
  'min_confidence_floor', 0.85
)
WHERE slug = 'equipo';

-- Riesgo: 9% acted. Tope bajo, confidence alto.
UPDATE ai_agents
SET config = jsonb_build_object(
  'min_business_impact_mxn', 100000,
  'max_insights_per_run', 2,
  'mode_rotation', jsonb_build_array(),
  'min_confidence_floor', 0.85
)
WHERE slug = 'riesgo';

-- Operaciones: 8% acted. Moderado.
UPDATE ai_agents
SET config = jsonb_build_object(
  'min_business_impact_mxn', 20000,
  'max_insights_per_run', 3,
  'mode_rotation', jsonb_build_array(),
  'min_confidence_floor', 0.82
)
WHERE slug = 'operaciones';

-- Comercial: 21% acted — aceptable. Solo tope estándar.
UPDATE ai_agents
SET config = jsonb_build_object(
  'min_business_impact_mxn', 0,
  'max_insights_per_run', 3,
  'mode_rotation', jsonb_build_array(),
  'min_confidence_floor', 0
)
WHERE slug = 'comercial';

-- Compras: 23% acted — aceptable.
UPDATE ai_agents
SET config = jsonb_build_object(
  'min_business_impact_mxn', 0,
  'max_insights_per_run', 3,
  'mode_rotation', jsonb_build_array(),
  'min_confidence_floor', 0
)
WHERE slug = 'compras';

-- Costos: 22% acted — aceptable.
UPDATE ai_agents
SET config = jsonb_build_object(
  'min_business_impact_mxn', 0,
  'max_insights_per_run', 3,
  'mode_rotation', jsonb_build_array(),
  'min_confidence_floor', 0
)
WHERE slug = 'costos';
```

- [ ] **Step 2: Aplicar migración via MCP Supabase**

Usar `mcp__claude_ai_Supabase__apply_migration` con `project_id=tozqezmivpblmcubmnpi`, `name=20260412_director_config_seed`, `query=` el contenido anterior.

- [ ] **Step 3: Verificar la siembra**

Query:
```sql
SELECT slug, config FROM ai_agents WHERE is_active ORDER BY slug;
```

Expected: las 7 filas con `config` no vacío. Financiero con `mode_rotation=["operativo","estrategico"]`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260412_director_config_seed.sql
git commit -m "chore(db): seed config para 7 directores activos"
```

---

### Task 8: Validación en producción (24h de observación)

**Files:** N/A — tarea de monitoreo.

- [ ] **Step 1: Merge a `main` y deploy a Vercel**

```bash
git push origin main
```

Vercel auto-deploya. Confirmar en el dashboard que el deployment pasa.

- [ ] **Step 2: Snapshot baseline antes del primer ciclo**

```sql
SELECT
  a.slug,
  count(*) FILTER (WHERE i.state='acted_on') AS acted,
  count(*) FILTER (WHERE i.state='dismissed') AS dismissed,
  count(*) FILTER (WHERE i.state='expired') AS expired,
  count(*) AS total,
  round(100.0 * count(*) FILTER (WHERE i.state='acted_on') / NULLIF(count(*),0), 1) AS action_pct
FROM agent_insights i
JOIN ai_agents a ON a.id = i.agent_id
WHERE a.is_active AND i.created_at > now() - interval '30 days'
GROUP BY a.slug
ORDER BY a.slug;
```

Guardar el resultado en un comentario del commit o en `docs/superpowers/plans/2026-04-12-baseline.txt`.

- [ ] **Step 3: Esperar 24h y recolectar nueva muestra**

Re-ejecutar la misma query filtrando por `created_at > now() - interval '24 hours'`. Comparar:
- Volumen: debería bajar ~40-60% para financiero/equipo/riesgo/operaciones.
- Financiero: debería alternar modos (verificar con `SELECT content FROM agent_memory WHERE memory_type='mode_rotation'`).

- [ ] **Step 4: Criterio de éxito**

- Volumen de insights totales en 24h baja ≥ 30%.
- Al menos un insight del financiero menciona datos de `budget_vs_actual` (buscar "presupuesto" o "budget" en `description`).
- `action_pct` sube en al menos 2 de los 4 directores ruidosos (muestra pequeña, pero dirección correcta).

Si el criterio NO se cumple, abrir issue y planear ronda de ajustes (afinar thresholds en `config`, no revertir código).

- [ ] **Step 5: Documentar resultado**

Añadir sección "Resultados 24h" al final de este plan con los números reales.

```bash
git add docs/superpowers/plans/2026-04-12-silenciar-directores-y-fix-financiero.md
git commit -m "docs: resultados post-deploy del plan de silenciamiento"
```

---

## Self-review

**Spec coverage:**
- Diagnóstico #1 (silenciar ruido con config per-agente): Task 1, 2, 5, 7 ✓
- Diagnóstico #2 (fix financiero con modos + budget_vs_actual): Task 3, 6, 7 ✓
- `expired` ignorado en adaptive threshold (hallazgo intermedio): Task 4 ✓
- Validación en prod: Task 8 ✓
- Fuera de scope (manufacturing, invoice_lines, archivados): documentado arriba ✓

**Type consistency:**
- `DirectorConfig` mismos campos en tipo, loader, filter, seed SQL, uso en route. ✓
- `getNextMode(sb, agentId, modes)` signature igual en test, impl y uso en financiero case. ✓
- `buildFinancieroContext*(sb, profileSection)` — profileSection viene del scope padre en `buildAgentContext`, confirmado que existe antes del switch. ✓
- Firma extendida de `buildAgentContext` con `directorConfig` opcional — actualizar también la llamada en L189.

**Placeholder scan:** ninguno; cada step tiene código o comandos exactos.

**Nota de riesgo:** `import()` dinámico dentro del switch es intencional para evitar inflar el bundle inicial del route handler, pero si el tsc o next build se queja, mover a imports estáticos al tope del archivo.

---

## Execution

Plan guardado en `docs/superpowers/plans/2026-04-12-silenciar-directores-y-fix-financiero.md`.

Dos opciones de ejecución:

**1. Subagent-driven (recomendado)** — un subagente fresco por task, review entre tasks, iteración rápida.

**2. Inline** — ejecutar los tasks en esta sesión vía superpowers:executing-plans, batch con checkpoints.

¿Cuál prefieres?
