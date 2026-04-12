# Grounding Hard Stops + Refactor del Orchestrate

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Matar la clase completa de insights alucinados (ejemplo reciente: "Director Financiero ausente en 14 sesiones del CEO" — concepto inexistente, inventado por un director a partir del feedback loop meta) añadiendo tres hard stops antes del INSERT a `agent_insights`, cortando las fuentes de cross-pollination entre directores, validando los tipos de datos que vienen de Claude, y exponiendo `health_scores` al Director Comercial. Refactor mínimo del dedup loop para eliminar 20 queries secuenciales por run.

**Architecture:** Cambios quirúrgicos en `src/app/api/agents/orchestrate/route.ts` (3 waves) + una migración SQL que reescribe `system_prompt` de los 7 directores activos con un bloque negativo explícito. Sin archivos nuevos salvo un helper chico `src/lib/agents/grounding.ts` para los validadores. Sin tocar los builders del financiero ni el DirectorConfig del plan anterior.

**Tech Stack:** TypeScript strict, Vitest para los validadores puros, `mcp__claude_ai_Supabase__apply_migration` para el SQL prod.

**Assumptions verificadas:**
- `agent_insights.evidence` es columna JSONB array (el código hace `i.evidence || []`).
- `health_scores` existe en Supabase.
- `cross_director_signals` es una VIEW que lee de `agent_insights` (no base table) — eliminarla del prompt no rompe integridad.
- Los 7 directores activos tienen `system_prompt` distinto (verificado en Task 4 del plan original).
- Worktree `/Users/jj/qi-costos-invoice-lines` sigue vivo; crearé branch nuevo desde origin/main.

**Fuera de scope (planes separados):**
- Fix del sync de `odoo_manufacturing` en qb19 (addon, no frontend).
- Fix del sync de `discount` en odoo_invoice_lines.
- Hard-delete de los 9 agentes archivados + eliminación de los 8 cases legacy del switch.
- Timeout explícito en `callClaudeJSON`.
- Batch de companies resolution completo (solo hago el fix del dedup loop, no todo el archivo).

---

## Waves

**Wave 1 — Anti-hallucination hard stops (Tasks 1-5).** Lo más urgente. Cierra el loop meta y añade grounding gates. Ship standalone, checkpoint antes del push.

**Wave 2 — Data gap: health_scores a comercial (Task 6).** Chico, independiente. Ship con Wave 1 o después.

**Wave 3 — Refactor del dedup loop (Tasks 7-8).** Perf + corrige _companyNameMap global. Ship standalone después de validar Wave 1.

---

## File Structure

**Crear:**
- `src/lib/agents/grounding.ts` — dos funciones puras: `hasConcreteEvidence(insight, contextString)` y `looksLikeMetaHallucination(insight)`.
- `src/__tests__/agents/grounding.test.ts` — tests de las 2 funciones.
- `supabase/migrations/20260412_director_prompts_negative_scope.sql` — rewrite de `system_prompt` de 7 directores.

**Modificar:**
- `src/app/api/agents/orchestrate/route.ts`:
  - `buildAgentContext` (L814-972): eliminar las cargas de `cross_director_signals` y `company_insight_history` del Promise.all, eliminar las secciones correspondientes del template literal.
  - Insert loop (L354-420): añadir validación de `severity` contra enum, validación de `business_impact_estimate` contra NaN, aplicar `hasConcreteEvidence` y `looksLikeMetaHallucination` filtros.
  - Dedup loop (L286-344): pre-cargar `companies` en una sola query antes del for loop.
  - `getDomainData` case `"comercial"` (L1091): añadir query a `health_scores`.
  - `_companyNameMap` (L1369): mover a variable local dentro de `getDomainData`.

---

## Wave 1: Anti-hallucination hard stops

### Task 1: Helper `grounding.ts` con tests (TDD)

**Files:**
- Create: `src/lib/agents/grounding.ts`
- Create: `src/__tests__/agents/grounding.test.ts`

- [ ] **Step 1: Escribir los tests que fallan**

Contenido exacto de `src/__tests__/agents/grounding.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { hasConcreteEvidence, looksLikeMetaHallucination } from "@/lib/agents/grounding";

describe("hasConcreteEvidence", () => {
  const sampleContext = `
## CARTERA VENCIDA POR EMPRESA
[{"name":"GRUPO ISMARK","overdue_amount":450000},{"name":"BRAZZI","overdue_amount":120000}]

## VENTAS BAJO COSTO
[{"move_name":"INV/2026/01/0075","product_ref":"KF4032T11BL","company_name":"GRUPO ISMARK"}]
`;

  it("acepta insight con invoice name del contexto", () => {
    const insight = { evidence: ["La factura INV/2026/01/0075 tiene margen -42%"] };
    expect(hasConcreteEvidence(insight, sampleContext)).toBe(true);
  });

  it("acepta insight con company name del contexto", () => {
    const insight = { evidence: ["GRUPO ISMARK acumula cartera vencida"] };
    expect(hasConcreteEvidence(insight, sampleContext)).toBe(true);
  });

  it("acepta insight con product_ref del contexto", () => {
    const insight = { evidence: ["KF4032T11BL se vendió bajo costo"] };
    expect(hasConcreteEvidence(insight, sampleContext)).toBe(true);
  });

  it("rechaza insight sin evidence", () => {
    const insight = { evidence: [] };
    expect(hasConcreteEvidence(insight, sampleContext)).toBe(false);
  });

  it("rechaza insight con evidence generica no anclada al contexto", () => {
    const insight = { evidence: ["Los margenes estan bajos en general", "Hay varios problemas"] };
    expect(hasConcreteEvidence(insight, sampleContext)).toBe(false);
  });

  it("rechaza cuando evidence es null o undefined", () => {
    expect(hasConcreteEvidence({ evidence: null }, sampleContext)).toBe(false);
    expect(hasConcreteEvidence({}, sampleContext)).toBe(false);
  });

  it("acepta cuando description (no solo evidence) contiene anclaje", () => {
    const insight = { evidence: ["Patron detectado"], description: "GRUPO ISMARK tiene 4 facturas vencidas" };
    expect(hasConcreteEvidence(insight, sampleContext)).toBe(true);
  });
});

describe("looksLikeMetaHallucination", () => {
  it("flag insight sobre sesiones del CEO", () => {
    const insight = { title: "Director financiero ausente en sesiones del CEO", description: "x" };
    expect(looksLikeMetaHallucination(insight)).toBe(true);
  });

  it("flag insight sobre interacciones entre directores", () => {
    const insight = { title: "Falta de interaccion entre agentes", description: "x" };
    expect(looksLikeMetaHallucination(insight)).toBe(true);
  });

  it("flag insight sobre governance del sistema", () => {
    const insight = { title: "x", description: "El Director de Riesgo no esta participando en la gobernanza" };
    expect(looksLikeMetaHallucination(insight)).toBe(true);
  });

  it("flag insight que menciona 'activar director'", () => {
    const insight = { title: "Activar Director Financiero para decisiones criticas", description: "x" };
    expect(looksLikeMetaHallucination(insight)).toBe(true);
  });

  it("NO flag insight legitimo de negocio aunque mencione 'financiero'", () => {
    const insight = { title: "Cartera vencida de GRUPO ISMARK", description: "El cliente tiene 4 facturas vencidas >90d" };
    expect(looksLikeMetaHallucination(insight)).toBe(false);
  });

  it("NO flag insight legitimo que mencione 'sistema' en contexto de negocio", () => {
    const insight = { title: "Sistema de produccion con backlog alto", description: "MRP reporta 15 ordenes atrasadas" };
    expect(looksLikeMetaHallucination(insight)).toBe(false);
  });
});
```

- [ ] **Step 2: Correr el test y confirmar fail**

```bash
cd /Users/jj/qi-costos-invoice-lines
npx vitest run src/__tests__/agents/grounding.test.ts
```

Expected: FAIL — módulo `@/lib/agents/grounding` no existe.

- [ ] **Step 3: Implementar `grounding.ts`**

Contenido exacto de `src/lib/agents/grounding.ts`:

```ts
// Grounding validators — ejecutados antes del INSERT de cada insight para
// evitar alucinaciones que pasan el confidence threshold.

export interface InsightCandidate {
  title?: unknown;
  description?: unknown;
  evidence?: unknown;
  [k: string]: unknown;
}

/**
 * Un insight está "grounded" si AL MENOS UN fragmento de su evidence o description
 * contiene una referencia literal a algo del contexto: invoice name (`INV/2026/...`),
 * product ref (`KF4032T11...`), o una company name presente en las secciones de datos.
 */
export function hasConcreteEvidence(
  insight: InsightCandidate,
  contextString: string
): boolean {
  const evidenceArr = Array.isArray(insight.evidence) ? insight.evidence : [];
  const description = typeof insight.description === "string" ? insight.description : "";
  const title = typeof insight.title === "string" ? insight.title : "";
  const haystack = [...evidenceArr.map(String), description, title].join(" ");

  if (!haystack.trim()) return false;

  // 1) Invoice name pattern (INV/2026/01/0075, P00123, SO/2026/0001, TL/OUT/...)
  if (/[A-Z]{2,4}[/\d]{2,}\/\d+/i.test(haystack)) return true;
  if (/\b[A-Z]\d{5,}\b/.test(haystack)) return true;

  // 2) Product ref pattern (typical: 2-4 letters + digits + letters/digits, >=6 chars total)
  if (/\b[A-Z]{2,5}\d{2,}[A-Z0-9./]{0,10}\b/.test(haystack)) return true;

  // 3) Company name anchoring — extract candidate company names from the context
  //    (anything inside "name":"X" or "company_name":"X") and check if any appears in the insight.
  const companyNames = new Set<string>();
  const nameRegex = /"(?:name|company_name|canonical_name)":\s*"([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = nameRegex.exec(contextString)) !== null) {
    const n = m[1].trim();
    if (n.length >= 4) companyNames.add(n);
  }
  for (const name of companyNames) {
    if (haystack.includes(name)) return true;
  }

  return false;
}

const META_HALLUCINATION_PATTERNS: RegExp[] = [
  /sesi[oó]n(es)? del ceo/i,
  /sesi[oó]n(es)? de direcci[oó]n/i,
  /interacci[oó]n(es)? (entre|de|del) (director|agente)/i,
  /participaci[oó]n del (director|agente)/i,
  /gobernanza del sistema/i,
  /gobernanza del agente/i,
  /activar (al )?director/i,
  /forzar (la )?participaci[oó]n/i,
  /ausente en (sesiones|flujos|decisiones)/i,
  /\bkpi de participaci[oó]n\b/i,
  /\bno se activa\b/i,
  /trigger del director/i,
];

export function looksLikeMetaHallucination(insight: InsightCandidate): boolean {
  const text = [
    typeof insight.title === "string" ? insight.title : "",
    typeof insight.description === "string" ? insight.description : "",
  ].join(" ");
  return META_HALLUCINATION_PATTERNS.some(p => p.test(text));
}
```

- [ ] **Step 4: Correr tests y confirmar pass**

```bash
npx vitest run src/__tests__/agents/grounding.test.ts
```

Expected: PASS 13 tests (7 hasConcreteEvidence + 6 looksLikeMetaHallucination).

- [ ] **Step 5: tsc check**

```bash
npx tsc --noEmit 2>&1 | tail -10
```

Expected: clean.

- [ ] **Step 6: Stage**

```bash
git add src/lib/agents/grounding.ts src/__tests__/agents/grounding.test.ts
git status --short
```

---

### Task 2: Aplicar `grounding.ts` en el insert loop + validar severity/impact

**Files:**
- Modify: `src/app/api/agents/orchestrate/route.ts` — insert loop aprox L354-420

**Objetivo:** Antes de cada `rows.push(...)`, aplicar los 4 validadores: (a) `looksLikeMetaHallucination` → descarta, (b) severity debe ser uno de `medium|high|critical`, (c) `business_impact_estimate` debe ser número finito o null (nunca NaN), (d) `hasConcreteEvidence(insight, context)` → si falla, el insight se mete con `state='archived'` (no se descarta porque puede ser legítimo pero pobre, el CEO nunca lo verá pero queda auditable). El contexto pasado al validator es el `context` string que ya existe en scope.

- [ ] **Step 1: Añadir import al top del archivo**

Localizar el bloque de imports (aprox L17-20, cerca de `import { loadDirectorConfig, filterInsightsByConfig } from "@/lib/agents/director-config";`). Añadir:

```ts
import { hasConcreteEvidence, looksLikeMetaHallucination } from "@/lib/agents/grounding";
```

- [ ] **Step 2: Añadir el set de severities válidas como constante top-level**

Cerca de otros `const` top-level (aprox L22-45, donde vive `DEFAULT_CONFIDENCE_THRESHOLD`), añadir:

```ts
/** Severities validas segun schema de agent_insights */
const VALID_SEVERITIES = new Set(["medium", "high", "critical"]);
```

- [ ] **Step 3: Reemplazar el bloque de construcción del row**

Localizar el loop que empieza con `for (const i of cappedInsights)` (aprox L356). Dentro del loop, ANTES del `rows.push(...)`, el código actual tiene validaciones META_TITLE_PATTERNS y unit-error. Añadir DESPUÉS de esas dos validaciones y ANTES del `rows.push`:

```ts
        // Grounding stop 1: meta hallucination (sesiones del CEO, participacion de directores, etc.)
        if (looksLikeMetaHallucination(i as Record<string, unknown>)) {
          duplicatesSkipped++;
          console.log(`[orchestrate] ${agent.slug} dropped meta hallucination: ${titleStr.slice(0, 80)}`);
          continue;
        }

        // Validate severity against enum — silently coerce to "medium" if Claude hallucinated
        const rawSeverity = String(i.severity || "medium").toLowerCase();
        const severity = VALID_SEVERITIES.has(rawSeverity) ? rawSeverity : "medium";

        // Validate business_impact_estimate — NaN/Infinity become null
        let businessImpact: number | null = null;
        if (i.business_impact_estimate !== undefined && i.business_impact_estimate !== null) {
          const asNum = typeof i.business_impact_estimate === "number"
            ? i.business_impact_estimate
            : Number(String(i.business_impact_estimate).replace(/[^\d.-]/g, ""));
          if (Number.isFinite(asNum) && asNum >= 0) {
            businessImpact = asNum;
          }
        }

        // Grounding stop 2: concrete evidence check. If the insight does not reference
        // any ID from the provided context, force state='archived' (auditable, invisible to CEO).
        const isGrounded = hasConcreteEvidence(i as Record<string, unknown>, context);
```

**IMPORTANT**: el código existente tiene estas 2 líneas cerca del `rows.push`:

```ts
        const severity = String(i.severity || "medium");
        const insightType = String(i.insight_type || "recommendation");
        const expiresAt = computeExpiresAt({ severity, insight_type: insightType });
```

Eliminar el `const severity = String(i.severity || "medium");` (ya lo reemplazaste arriba). Dejar los otros dos intactos. El `expiresAt` seguirá usando el nuevo `severity` validado.

- [ ] **Step 4: Actualizar el objeto que se pushea**

Localizar el `rows.push({ ... })` actual y:

1. Reemplazar `business_impact_estimate: i.business_impact_estimate ? Number(i.business_impact_estimate) : null,` por:
```ts
          business_impact_estimate: businessImpact,
```

2. Reemplazar `state: confidence < effectiveThreshold ? "archived" : "new",` por:
```ts
          state: (confidence < effectiveThreshold || !isGrounded) ? "archived" : "new",
```

(El archivo ya tiene `effectiveThreshold` del plan anterior.)

3. NO tocar el campo `severity` del rows.push — la variable local `severity` ahora es el validado.

- [ ] **Step 5: Verify**

```bash
npx tsc --noEmit 2>&1 | tail -10
npx vitest run src/__tests__/agents/ 2>&1 | tail -10
```

Expected: tsc clean, 3+1 test files = al menos 32 tests passing (19 previos + 13 nuevos de grounding).

- [ ] **Step 6: Stage**

```bash
git add src/app/api/agents/orchestrate/route.ts
git status --short
```

---

### Task 3: Eliminar `cross_director_signals` y `company_insight_history` del prompt

**Files:**
- Modify: `src/app/api/agents/orchestrate/route.ts` — `buildAgentContext` L814-972

**Objetivo:** Estas dos fuentes de datos inyectan al prompt lo que OTROS directores dijeron recientemente, generando un feedback loop donde directores comentan sobre insights de otros directores en vez de analizar data cruda. Son la causa principal de las alucinaciones meta. Se eliminan completamente.

- [ ] **Step 1: Leer el `Promise.all` actual de `buildAgentContext`**

```bash
sed -n '814,905p' src/app/api/agents/orchestrate/route.ts
```

Debe mostrar un `Promise.all` con 8 queries incluyendo `cross_director_signals` (L823-828 aprox) y `company_insight_history` (L838-844 aprox). Confirmar las líneas exactas.

- [ ] **Step 2: Eliminar las dos queries del array**

En el destructuring `const [crossSignals, emailFacts, insightHistory, emailIntel, recentFeedback, pendingTickets, recentKGFacts, myDismissed] = await Promise.all([...])`:

1. Eliminar `crossSignals` del destructuring.
2. Eliminar `insightHistory` del destructuring.
3. Eliminar las dos queries correspondientes del array (la que hace `from("cross_director_signals")` y la que hace `from("company_insight_history")`).

El nuevo destructuring queda:

```ts
  const [emailFacts, emailIntel, recentFeedback, pendingTickets, recentKGFacts, myDismissed] = await Promise.all([
    // Email facts per company (reduced from 15 to 8)
    supabase
      .from("company_email_intelligence")
      .select("company_name, fact_type, fact_text")
      .in("fact_type", ["complaint", "commitment", "request", "price"])
      .limit(8),

    // Domain-specific email facts
    getEmailIntelligence(supabase, domain),

    // CEO feedback last 48h (reduced from 15 to 8)
    supabase
      .from("agent_insights")
      .select("title, state, category, severity, user_feedback")
      .in("state", ["acted_on", "dismissed"])
      .gte("updated_at", new Date(Date.now() - 48 * 3600_000).toISOString())
      .order("updated_at", { ascending: false })
      .limit(8),

    // Tickets from other directors (reduced from 10 to 5)
    supabase
      .from("agent_tickets")
      .select("from_agent_id, insight_id, ticket_type, message, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(5),

    // High-confidence KG facts (reduced from 20 to 10)
    supabase
      .from("facts")
      .select("fact_text, fact_type, confidence, fact_date")
      .gte("confidence", 0.85)
      .eq("expired", false)
      .order("fact_date", { ascending: false, nullsFirst: false })
      .limit(10),

    // This agent's dismissals (kept at 8 — important for learning)
    agentId ? supabase
      .from("agent_insights")
      .select("title, category, user_feedback")
      .eq("agent_id", agentId)
      .in("state", ["dismissed"])
      .gte("updated_at", new Date(Date.now() - 14 * 86400_000).toISOString())
      .order("updated_at", { ascending: false })
      .limit(8) : Promise.resolve({ data: [] }),
  ]);
```

- [ ] **Step 3: Eliminar las secciones del template del prompt**

Después del Promise.all, el código actual tiene bloques tipo:

```ts
  // Cross-director signals: what are OTHER directors saying?
  if (crossSignals.data?.length) {
    ...
    sections.push(...);
  }
```

Y similar para `insightHistory.data`. Eliminar AMBOS bloques completos. También eliminar cualquier `sections.push` que mencione "QUE DICEN OTROS DIRECTORES" o "HISTORIAL: empresas flaggeadas".

Usar `grep -n "crossSignals\|insightHistory\|QUE DICEN OTROS\|HISTORIAL: empresas flaggeadas" src/app/api/agents/orchestrate/route.ts` para encontrar TODAS las referencias y eliminarlas. Al final del Step 3, ese grep no debe devolver ningún resultado dentro de `buildAgentContext`.

- [ ] **Step 4: Verify**

```bash
grep -n "crossSignals\|insightHistory\|cross_director_signals\|company_insight_history" src/app/api/agents/orchestrate/route.ts
```

Expected: sin resultados (o solo en comentarios históricos irrelevantes).

```bash
npx tsc --noEmit 2>&1 | tail -10
npx vitest run src/__tests__/agents/ 2>&1 | tail -10
```

Expected: clean, tests passing.

- [ ] **Step 5: Stage**

```bash
git add src/app/api/agents/orchestrate/route.ts
git status --short
```

---

### Task 4: SQL migration — reescribir `system_prompt` con negative scope

**Files:**
- Create: `supabase/migrations/20260412_director_prompts_negative_scope.sql`

**Objetivo:** Añadir un bloque explícito "PROHIBIDO" al final del `system_prompt` de cada director activo para que Claude no genere insights meta. Esto complementa los filtros en código — redundancia intencional (defense in depth).

- [ ] **Step 1: Escribir la migración**

Contenido exacto de `supabase/migrations/20260412_director_prompts_negative_scope.sql`:

```sql
-- Añade bloque PROHIBIDO al final del system_prompt de los 7 directores activos.
-- El bloque es idempotente: si ya existe, el concat lo duplicaría — por eso usamos
-- una comprobación con NOT LIKE para evitar doble aplicación.

UPDATE ai_agents
SET system_prompt = system_prompt || E'\n\n---\n\nPROHIBIDO ABSOLUTAMENTE (reglas de grounding, no negociables):\n' ||
  E'1. No generes insights sobre OTROS directores, sobre el sistema, sobre procesos internos, o sobre "sesiones del CEO" — no existen sesiones: los directores corren en cron.\n' ||
  E'2. No inventes metricas. Si un dato no aparece LITERALMENTE en las secciones "## ..." del contexto que recibes, no lo afirmes. Si tienes una sospecha, marca confidence < 0.85 y no lo emitas como insight.\n' ||
  E'3. Cada insight DEBE referenciar al menos UN identificador concreto del contexto: nombre de factura (INV/..., P0..., SO/...), nombre de empresa del bloque de datos, o product_ref (ej: KF4032T11). Si no puedes citar uno, no emitas el insight.\n' ||
  E'4. Severity="critical" esta reservada para eventos con impacto economico >= $100,000 MXN o riesgo operacional inmediato. Usa "medium" por defecto.\n' ||
  E'5. business_impact_estimate debe ser un numero en MXN (no string, no rango). Si no puedes estimarlo, pon null.\n' ||
  E'6. Categorias validas: cobranza, ventas, entregas, operaciones, proveedores, riesgo, equipo, datos. Cualquier otra sera rechazada.'
WHERE is_active = true
  AND archived_at IS NULL
  AND slug IN ('comercial', 'financiero', 'compras', 'costos', 'operaciones', 'equipo', 'riesgo')
  AND system_prompt NOT LIKE '%PROHIBIDO ABSOLUTAMENTE%';
```

- [ ] **Step 2: Aplicar via MCP**

Usar `mcp__claude_ai_Supabase__apply_migration`:
- `project_id`: `tozqezmivpblmcubmnpi`
- `name`: `20260412_director_prompts_negative_scope`
- `query`: contenido exacto de arriba

Expected: `{"success": true}`.

- [ ] **Step 3: Verificar**

Usar `mcp__claude_ai_Supabase__execute_sql`:

```sql
SELECT slug, substring(system_prompt from '.{200}$') AS tail
FROM ai_agents
WHERE is_active AND archived_at IS NULL
ORDER BY slug;
```

Expected: los 7 directores activos tienen la cola del prompt terminando en `business_impact_estimate debe ser un numero...` o similar. `data_quality` puede quedar sin el bloque (no está en la lista del WHERE) y eso es correcto — es interno.

- [ ] **Step 4: Stage**

```bash
git add supabase/migrations/20260412_director_prompts_negative_scope.sql
git status --short
```

---

### Task 5: Wave 1 checkpoint + push

**Files:** N/A (deploy)

- [ ] **Step 1: Verify test + tsc suite completa**

```bash
cd /Users/jj/qi-costos-invoice-lines
npx tsc --noEmit 2>&1 | tail -10
npx vitest run src/__tests__/agents/ 2>&1 | tail -10
```

Expected: clean, 32+ tests passing.

- [ ] **Step 2: Commit todos los cambios de Wave 1 en 4 commits**

```bash
# Task 1: grounding helpers + tests
git add src/lib/agents/grounding.ts src/__tests__/agents/grounding.test.ts
git commit -m "feat(agents): grounding helpers — hasConcreteEvidence + looksLikeMetaHallucination"

# Task 2: wire grounding + severity/impact validation en insert loop
# (ya staged en Task 2 Step 6)

# Task 3: eliminar cross_director_signals y company_insight_history del prompt
# (ya staged en Task 3 Step 5)

# Hacer los commits granulares si ya están staged juntos:
git diff --cached --stat
```

Si Tasks 2 y 3 están mezcladas en el mismo staging (porque ambas tocan el mismo archivo), hacer UN commit:

```bash
git commit -m "fix(agents): grounding gates + severity/impact validation + kill feedback loop"
```

Task 4 (migration):

```bash
git add supabase/migrations/20260412_director_prompts_negative_scope.sql
git commit -m "chore(db): negative scope en system_prompt de 7 directores"
```

- [ ] **Step 3: Rebase sobre origin/main**

```bash
git fetch origin main
git rebase origin/main
```

Expected: clean. Si hay conflictos, resolverlos manteniendo ambos sets.

- [ ] **Step 4: CHECKPOINT humano**

Pausa aquí. Mostrar al usuario:
- SHAs de los commits del wave
- `git diff origin/main..HEAD --stat`
- Verificación que la migración fue aplicada en prod (re-correr el verify del Task 4 Step 3)

Esperar aprobación antes del push.

- [ ] **Step 5: Push**

```bash
git push origin HEAD:main
```

- [ ] **Step 6: Smoke check post-deploy (después de 15 min del próximo cron)**

```sql
SELECT a.slug, count(*) AS insights_last_hour,
       count(*) FILTER (WHERE state='archived') AS archived,
       count(*) FILTER (WHERE state='new') AS active
FROM agent_insights i JOIN ai_agents a ON a.id=i.agent_id
WHERE a.is_active AND i.created_at > now() - interval '1 hour'
GROUP BY a.slug ORDER BY a.slug;
```

Expected: insights nuevos en los directores que corrieron en la última hora. Si todo `state='archived'`, el grounding check es demasiado estricto — investigar. Si no hay insights del todo y no hay errores en `pipeline_logs`, los directores están ejecutando pero todos sus outputs son alucinados (no deseable pero al menos ya no contaminan el inbox del CEO).

Buscar específicamente insights con los patrones meta bloqueados (deben ser 0):

```sql
SELECT count(*) FROM agent_insights
WHERE created_at > now() - interval '1 hour'
  AND (title ~* 'sesion(es)? del ceo'
    OR title ~* 'interacci[oó]n.*director'
    OR description ~* 'activar.*director'
    OR description ~* 'gobernanza del sistema');
```

Expected: `0`.

---

## Wave 2: Data gap — health_scores a Director Comercial

### Task 6: Wire `health_scores` al case `"comercial"`

**Files:**
- Modify: `src/app/api/agents/orchestrate/route.ts` — case `"comercial"` (aprox L1091)

**Objetivo:** `health_scores` es una vista que expone score calculado por contacto (engagement, response rate, sentimiento). El Director Comercial hoy no la consulta. Es alta señal para detección de churn temprano.

- [ ] **Step 1: Verificar la shape de health_scores**

```sql
SELECT column_name, data_type FROM information_schema.columns WHERE table_name='health_scores' ORDER BY ordinal_position;
```

Si las columnas no son claras, ajustar el select a `*` y dejar que la vista hable.

- [ ] **Step 2: Añadir 1 query al Promise.all del case "comercial"**

Añadir al final del array:

```ts
        // NEW: health scores de contactos (churn temprano — engagement + sentiment)
        sb.from("health_scores").select("*").order("score", { ascending: true }).limit(10),
```

Añadir `atRiskContacts` al destructuring (antes del `]);`).

- [ ] **Step 3: Añadir sección al return template**

Insertar justo después de `## EMAILS DE CLIENTES SIN RESPUESTA (>24h)`:

```
## CONTACTOS CON HEALTH SCORE BAJO (churn risk temprano)
${safeJSON(atRiskContacts.data)}
```

**Nota:** si la query anterior ordena por `score` ascendente, podrían salir los peores primero. Si el nombre de la columna no es `score`, ajustar el `.order(...)`.

- [ ] **Step 4: Verify + stage**

```bash
npx tsc --noEmit 2>&1 | tail -10
npx vitest run src/__tests__/agents/ 2>&1 | tail -10
git add src/app/api/agents/orchestrate/route.ts
```

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(comercial): enchufar health_scores al director"
```

- [ ] **Step 6: Push (piggyback con Wave 3 si se hace junto, o directo)**

```bash
git push origin HEAD:main
```

---

## Wave 3: Refactor — batch company resolution + kill global map

### Task 7: Mover `_companyNameMap` a variable local + batch resolver

**Files:**
- Modify: `src/app/api/agents/orchestrate/route.ts` — dedup loop L286-344, `_companyNameMap` L1369

**Objetivo:** El dedup loop hace hasta 2 queries a `companies` POR CADA insight (L329, L341 aprox). Con 10 insights = 20 queries secuenciales en el hot path. Al mismo tiempo, `_companyNameMap` es un `let` mutable a nivel de módulo — race condition latente si MAX_PARALLEL sube. Ambos se arreglan juntos.

- [ ] **Step 1: Leer el estado actual del loop y del map**

```bash
sed -n '280,345p' src/app/api/agents/orchestrate/route.ts
sed -n '1365,1385p' src/app/api/agents/orchestrate/route.ts
```

Entender el uso actual antes de refactorizar.

- [ ] **Step 2: Pre-cargar todos los company names en una sola query al inicio de runSingleAgent**

Justo después de `const directorConfig = await loadDirectorConfig(supabase, agent.id);` (aprox L193), añadir:

```ts
    // Pre-load companies into a local map (kills N+1 in dedup loop + avoids global mutable state).
    const { data: companiesData } = await supabase
      .from("companies")
      .select("id, canonical_name")
      .limit(5000);
    const companyNameToId = new Map<string, number>();
    const companyIdToName = new Map<number, string>();
    for (const c of (companiesData ?? []) as Array<{ id: number; canonical_name: string }>) {
      if (c.canonical_name) {
        companyNameToId.set(c.canonical_name.toLowerCase(), c.id);
        companyIdToName.set(c.id, c.canonical_name);
      }
    }
```

- [ ] **Step 3: Reemplazar las queries dentro del loop de dedup**

En el loop, reemplazar las llamadas del tipo:

```ts
const { data: existingInsight } = await supabase.from("agent_insights")...
const { data: company } = await supabase.from("companies").select("id").ilike("canonical_name", ...).single();
```

por lookups al `companyNameToId` map. Usar `companyNameToId.get(String(insight.company_name).toLowerCase())` en vez de la query.

La query a `agent_insights` para dedup se queda — ese no es el N+1 que estamos atacando. Solo eliminar las queries a `companies`.

- [ ] **Step 4: Eliminar `_companyNameMap` global y refactorizar `safeJSON`**

En L1369 aprox:

```ts
let _companyNameMap: Map<number, string> | null = null;
```

Borrar esa línea.

`safeJSON` actualmente lee `_companyNameMap`. Cambiarla para recibir el map como parámetro:

```ts
function safeJSON(data: unknown, nameMap?: Map<number, string>): string {
  // ... usar nameMap en vez de _companyNameMap ...
}
```

Y en `getDomainData`, pasar `companyIdToName` a cada llamada a `safeJSON`. Para evitar cambiar 30+ call sites, alternativa: declarar `const nameMap = companyIdToName` al tope de `getDomainData` y que `safeJSON` acepte el map via closure (hacer `safeJSON` una función anidada dentro de `getDomainData`).

**Decisión:** hacer `safeJSON` una función local dentro de `getDomainData` para que capture el map por closure. Eso mantiene las call sites iguales y elimina el global.

- [ ] **Step 5: Propagar companyIdToName a getDomainData**

La firma de `getDomainData` ya recibe `supabase, domain, agentId?, directorConfig?`. Añadir un parámetro más:

```ts
async function getDomainData(
  supabase: any,
  domain: string,
  agentId?: number,
  directorConfig?: DirectorConfig,
  companyIdToName?: Map<number, string>
): Promise<string> {
```

Y en `buildAgentContext` donde se llama `getDomainData`, pasar el map. Y en `runSingleAgent` donde se llama `buildAgentContext`, pasarlo también — que la firma de `buildAgentContext` lo reciba y lo reenvíe a `getDomainData`.

Cascada de firmas: `runSingleAgent → buildAgentContext → getDomainData`. Los tres necesitan aceptar `companyIdToName`.

- [ ] **Step 6: Verify**

```bash
npx tsc --noEmit 2>&1 | tail -20
npx vitest run src/__tests__/agents/ 2>&1 | tail -10
```

Expected: clean, tests passing.

- [ ] **Step 7: Commit + push**

```bash
git add src/app/api/agents/orchestrate/route.ts
git commit -m "refactor(agents): batch company resolution + kill global map"
git push origin HEAD:main
```

---

## Self-review

**Spec coverage:**
- Feedback loop meta (cross_director_signals) → Task 3 ✓
- Grounding check → Tasks 1, 2 ✓
- Severity/impact NaN → Task 2 ✓
- Prompt negative scope → Task 4 ✓
- health_scores gap → Task 6 ✓
- _companyNameMap global + dedup N+1 → Task 7 ✓

Pendientes documentados fuera de scope: odoo_manufacturing sync, legacy cases delete, callClaudeJSON timeout, 8 legacy cases cleanup.

**Placeholder scan:** ninguno, código y comandos exactos en cada step.

**Type consistency:**
- `InsightCandidate` interface en `grounding.ts` acepta evidence `unknown` — consistente con `RawInsight` del `director-config.ts`.
- `hasConcreteEvidence(insight, contextString)` firma usada en Task 1 (tests) y Task 2 (wire). ✓
- `looksLikeMetaHallucination(insight)` firma usada en Task 1 y Task 2. ✓
- `VALID_SEVERITIES` constante top-level nombrada consistentemente.
- `companyIdToName: Map<number, string>` consistente en runSingleAgent → buildAgentContext → getDomainData.

**Riesgos:**
- `hasConcreteEvidence` usa regex heurísticos — puede haber falsos positivos/negativos. Los tests cubren los casos principales; en prod habrá que ajustar patrones. Si muchos insights legítimos caen como `archived`, relajar el regex en un follow-up.
- Eliminar `cross_director_signals` reduce visibilidad entre directores. El Director de Riesgo actualmente usa esta señal para detectar patrones cross-dominio. Posible regresión: podría no detectar el patrón "comercial Y financiero están flaggeando misma empresa". Mitigación: confiar en `company_email_intelligence` + `agent_tickets` + el propio contexto domain-specific de riesgo_dir.
- La migración del system_prompt es NO idempotente si el `NOT LIKE '%PROHIBIDO ABSOLUTAMENTE%'` guard falla (ej. alguien editó el prompt para removerlo). Aceptable — riesgo bajo.

---

## Execution

Plan guardado en `docs/superpowers/plans/2026-04-12-grounding-y-refactor-orchestrate.md`.

Dos opciones:

**1. Subagent-driven por wave** (recomendado) — dispatch subagent por Wave 1 completo, checkpoint antes del push, luego Wave 2, luego Wave 3.

**2. Solo Wave 1 urgente** — ship el fix anti-hallucination hoy, Waves 2 y 3 en sesión futura.

¿Cuál prefieres?
