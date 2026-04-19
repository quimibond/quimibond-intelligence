# Syntage Fase 6 — Directores IA consumen Layer 3 · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrar un Director Compliance IA nuevo y conectar 4 directores existentes a Layer 3 (invoices_unified, payments_unified, reconciliation_issues), con annotation automática pre-publish en insights y fiscal one-liner + sección condicional en briefings diarios, sin poder de veto.

**Architecture:** 8º director `compliance` simétrico en `ai_agents` consume Layer 3 en modo operativo/estratégico. Post-filter `applyFiscalAnnotation()` enriquece cada `agent_insight` con JSONB determinístico antes del INSERT. Meta reconcilia conflictos fiscal-vs-operativo en briefing semanal; briefing diario agrega one-liner permanente + sección condicional a delta 24h vía snapshot table.

**Tech Stack:** Next.js 15 · Supabase (PostgreSQL + pg_cron) · Claude API via `callClaudeJSON` · vitest · TypeScript

**Spec:** `docs/superpowers/specs/2026-04-19-syntage-fase-6-directores-ia-design.md`

## ⚠️ Schema corrections (descubierto en Task 2)

La tabla `public.reconciliation_issues` (verified via `information_schema.columns` 2026-04-19) tiene estas columnas reales que difieren del spec/plan:

| Plan/Spec asumió | Schema real |
|---|---|
| `id bigint` | `issue_id uuid` |
| `status = 'open'` | **NO existe columna `status`.** Open = `resolved_at IS NULL` |
| `created_at` | `detected_at timestamptz` |
| — | `metadata jsonb NOT NULL` (adicional, útil para enrichment) |

**TODAS las queries en Tasks 3-16 deben usar:**
- `issue_id` en lugar de `id`
- `resolved_at IS NULL` en lugar de `status = 'open'`
- `detected_at` en lugar de `created_at`
- `issue_ids` en `FiscalAnnotation` TypeScript type es `string[]` (UUIDs as text), NO `number[]`

Task 2 ya aplicó estas correcciones. El resto del plan se lee con este patching implícito.

### Otras tablas/RPCs reales (verificadas 2026-04-19)

**`partner_blacklist_69b`** NO es una tabla separada. Es un `issue_type` value en `reconciliation_issues` (2 rows actuales). Todas las queries deben ser:
```sql
SELECT * FROM public.reconciliation_issues
WHERE issue_type='partner_blacklist_69b' AND resolved_at IS NULL
```

**`syntage_tax_status`** columnas reales (1 row actual):
- `opinion_cumplimiento` (text) — NO `opinion`
- `fecha_consulta` (timestamptz) — NO `retrieved_at`

**`get_syntage_reconciliation_summary()`** devuelve JSONB con estas keys reales:
- `by_type` (array of {type, open, resolved_7d, severity}) — NO `by_issue_type` (map)
- `by_severity` (object {critical, high, medium, low}) — OK como planeado
- `top_companies`, `resolution_rate_7d`, `recent_critical`, `generated_at`, `invoices_unified_refreshed_at`, `payments_unified_refreshed_at`
- **NO tiene** `total_open` — hay que computarlo sumando `by_severity` o con query directo

**Issue types vigentes (counts al 2026-04-19):**
- `sat_only_cfdi_received`: 10,929
- `sat_only_cfdi_issued`: 9,985
- `payment_missing_complemento`: 5,552
- `complemento_missing_payment`: 933
- `posted_but_sat_uncertified`: 124
- `cancelled_but_posted`: 97
- `amount_mismatch`: 19
- `partner_blacklist_69b`: 2

---

## File Structure

**Created:**
- `supabase/migrations/20260419_syntage_fase6_001_fiscal_annotation_column.sql` — agrega columna JSONB a `agent_insights`
- `supabase/migrations/20260419_syntage_fase6_002_get_fiscal_annotation.sql` — función PL/pgSQL determinística
- `supabase/migrations/20260419_syntage_fase6_003_reconciliation_summary_daily.sql` — tabla snapshot diario
- `supabase/migrations/20260419_syntage_fase6_004_snapshot_cron.sql` — pg_cron 6:15am
- `supabase/migrations/20260419_syntage_fase6_005_compliance_director_row.sql` — INSERT en `ai_agents` + `director_config`
- `src/lib/agents/compliance-context.ts` — context builder fiscal operativo + estratégico
- `src/lib/agents/fiscal-annotation.ts` — helper `applyFiscalAnnotation()`
- `src/__tests__/agents/compliance-context.test.ts` — unit tests del builder
- `src/__tests__/agents/fiscal-annotation.test.ts` — unit tests del helper
- `src/__tests__/pipeline/briefing-fiscal.test.ts` — tests del renglón + sección condicional

**Modified:**
- `src/lib/agents/grounding.ts` — agrega UUID_SAT + RFC como HARD identifiers
- `src/__tests__/agents/grounding.test.ts` — casos nuevos para UUID/RFC
- `src/lib/agents/financiero-context.ts` — agrega Layer 3 en operativo + estratégico
- `src/lib/agents/director-chat-context.ts` — agrega slug `compliance`, extiende `riesgo`/`compras`/`comercial`
- `src/app/api/agents/orchestrate/route.ts` — branch compliance + post-filter annotation
- `src/app/api/pipeline/briefing/route.ts` — one-liner + sección condicional + Meta weekly reconciliation
- `src/lib/queries/evidence.ts` — `getDirectorBriefing('compliance')` path
- `.env.example` — flag `ENABLE_COMPLIANCE_DIRECTOR`

---

## Task group order

A (migrations) → B (grounding) → C (compliance context) → D (fiscal annotation) → E (orchestrate) → F (chat) → G (financiero) → H (briefing) → I (flag) → J (manual QA + deploy)

---

### Task 1: Migración 001 — columna `fiscal_annotation`

**Files:**
- Create: `supabase/migrations/20260419_syntage_fase6_001_fiscal_annotation_column.sql`

- [ ] **Step 1: Crear el archivo de migración**

```sql
-- Fase 6 · 001: agent_insights.fiscal_annotation JSONB
-- NULL-able. Poblada por applyFiscalAnnotation() pre-INSERT cuando company_id
-- tiene issues abiertos en reconciliation_issues.

ALTER TABLE public.agent_insights
  ADD COLUMN IF NOT EXISTS fiscal_annotation JSONB;

-- Index parcial para queries "insights con flag fiscal activo"
-- (Meta reconciliation semanal lo usa cada domingo).
CREATE INDEX IF NOT EXISTS idx_agent_insights_fiscal_annotation
  ON public.agent_insights ((fiscal_annotation->>'flag'))
  WHERE fiscal_annotation IS NOT NULL;

COMMENT ON COLUMN public.agent_insights.fiscal_annotation IS
  'Fase 6: flag fiscal determinístico inyectado por applyFiscalAnnotation() pre-INSERT. Forma: {flag, severity, issue_count, detail, issue_ids}. NULL si no hay match o si insight es de agent_slug=compliance.';
```

- [ ] **Step 2: Aplicar migración contra proyecto Supabase**

Run: `cd /Users/jj/quimibond-intelligence/quimibond-intelligence && supabase db push --include-all` (o aplicar por MCP `apply_migration` si `supabase` CLI no está configurado).

Expected: `Applied migration 20260419_syntage_fase6_001_fiscal_annotation_column.sql`.

- [ ] **Step 3: Verificar columna**

Run SQL (via MCP o SQL editor):
```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name='agent_insights' AND column_name='fiscal_annotation';
```
Expected: una fila con `fiscal_annotation | jsonb`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260419_syntage_fase6_001_fiscal_annotation_column.sql
git commit -m "feat(syntage): Fase 6 · 001 agent_insights.fiscal_annotation JSONB

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

### Task 2: Migración 002 — `get_fiscal_annotation()` function

**Files:**
- Create: `supabase/migrations/20260419_syntage_fase6_002_get_fiscal_annotation.sql`

- [ ] **Step 1: Crear migración**

```sql
-- Fase 6 · 002: función PL/pgSQL determinística para fiscal annotation.
-- Recibe company_id, devuelve JSONB con flag prioritizado o NULL.
-- Prioridad: partner_blacklist_69b > cancelled_but_posted > sat_only_cfdi_issued(critical)
--         > payment_missing_complemento.

CREATE OR REPLACE FUNCTION public.get_fiscal_annotation(p_company_id bigint)
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  WITH prioritized AS (
    SELECT
      CASE
        WHEN issue_type = 'partner_blacklist_69b'     THEN 1
        WHEN issue_type = 'cancelled_but_posted'      THEN 2
        WHEN issue_type = 'sat_only_cfdi_issued' AND severity='critical' THEN 3
        WHEN issue_type = 'payment_missing_complemento' THEN 4
        ELSE 99
      END AS priority,
      issue_type, severity, id, description
    FROM public.reconciliation_issues
    WHERE company_id = p_company_id
      AND status = 'open'
  ),
  winner AS (
    SELECT * FROM prioritized
    WHERE priority < 99
    ORDER BY priority, severity DESC
    LIMIT 1
  )
  SELECT CASE
    WHEN w.id IS NULL THEN NULL
    ELSE jsonb_build_object(
      'flag',        w.issue_type,
      'severity',    w.severity,
      'issue_count', (SELECT count(*) FROM public.reconciliation_issues
                      WHERE company_id = p_company_id AND status='open'),
      'detail',      w.description,
      'issue_ids',   (SELECT array_agg(id ORDER BY id)
                      FROM public.reconciliation_issues
                      WHERE company_id = p_company_id AND status='open')
    )
  END
  FROM winner w;
$$;

-- service_role necesita ejecutarla desde el post-filter Node.
GRANT EXECUTE ON FUNCTION public.get_fiscal_annotation(bigint) TO service_role;

COMMENT ON FUNCTION public.get_fiscal_annotation(bigint) IS
  'Fase 6: devuelve flag fiscal prioritario para una company_id con issues open en reconciliation_issues. Usado por applyFiscalAnnotation() en orchestrate pre-INSERT.';
```

- [ ] **Step 2: Aplicar migración**

Run: `supabase db push --include-all` (o apply_migration via MCP).

- [ ] **Step 3: Verificar con una company real**

Run SQL (usa company conocida con issues — Top empresa SONIGAS de la memoria Fase 3):
```sql
SELECT public.get_fiscal_annotation(
  (SELECT id FROM public.companies WHERE name ILIKE '%SONIGAS%' LIMIT 1)
);
```
Expected: JSONB con shape `{flag, severity, issue_count, detail, issue_ids}` o NULL si la company no tiene issues open hoy.

- [ ] **Step 4: Verificar NULL para company sin issues**

Run SQL:
```sql
SELECT public.get_fiscal_annotation(-999999);
```
Expected: `NULL`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260419_syntage_fase6_002_get_fiscal_annotation.sql
git commit -m "feat(syntage): Fase 6 · 002 get_fiscal_annotation(bigint) function

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

### Task 3: Migración 003 — `reconciliation_summary_daily` table

**Files:**
- Create: `supabase/migrations/20260419_syntage_fase6_003_reconciliation_summary_daily.sql`

- [ ] **Step 1: Crear migración**

```sql
-- Fase 6 · 003: snapshot diario para cálculo de delta 24h en briefing.
-- Poblada por pg_cron 6:15am (migración 004).

CREATE TABLE IF NOT EXISTS public.reconciliation_summary_daily (
  snapshot_date date PRIMARY KEY,
  total_open int NOT NULL,
  severity_counts jsonb NOT NULL,   -- {critical, high, medium, low}
  by_issue_type jsonb NOT NULL,     -- {sat_only_cfdi_issued, ...}
  tax_status_opinion text,          -- 'positive' | 'negative' | null
  blacklist_69b_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.reconciliation_summary_daily TO service_role;

COMMENT ON TABLE public.reconciliation_summary_daily IS
  'Fase 6: snapshot diario de get_syntage_reconciliation_summary() + tax status + blacklist count. Poblada por pg_cron 6:15am. Consumida por briefing diario para delta 24h.';
```

- [ ] **Step 2: Aplicar migración**

Run: `supabase db push --include-all`.

- [ ] **Step 3: Backfill manual del primer snapshot**

Run SQL (para que el briefing de HOY tenga referencia):
```sql
INSERT INTO public.reconciliation_summary_daily
  (snapshot_date, total_open, severity_counts, by_issue_type,
   tax_status_opinion, blacklist_69b_count)
SELECT
  CURRENT_DATE,
  (summary->>'total_open')::int,
  summary->'by_severity',
  summary->'by_issue_type',
  (SELECT opinion FROM public.syntage_tax_status
   ORDER BY retrieved_at DESC LIMIT 1),
  (SELECT count(*) FROM public.reconciliation_issues
   WHERE issue_type='partner_blacklist_69b' AND status='open')
FROM (SELECT public.get_syntage_reconciliation_summary() AS summary) s
ON CONFLICT (snapshot_date) DO UPDATE SET
  total_open = EXCLUDED.total_open,
  severity_counts = EXCLUDED.severity_counts,
  by_issue_type = EXCLUDED.by_issue_type,
  tax_status_opinion = EXCLUDED.tax_status_opinion,
  blacklist_69b_count = EXCLUDED.blacklist_69b_count;
```

- [ ] **Step 4: Verificar snapshot**

Run SQL:
```sql
SELECT snapshot_date, total_open, severity_counts, blacklist_69b_count
FROM public.reconciliation_summary_daily
WHERE snapshot_date = CURRENT_DATE;
```
Expected: una fila con totales >0.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260419_syntage_fase6_003_reconciliation_summary_daily.sql
git commit -m "feat(syntage): Fase 6 · 003 reconciliation_summary_daily snapshot table

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

### Task 4: Migración 004 — pg_cron snapshot 6:15am

**Files:**
- Create: `supabase/migrations/20260419_syntage_fase6_004_snapshot_cron.sql`

- [ ] **Step 1: Crear migración**

```sql
-- Fase 6 · 004: pg_cron para poblar reconciliation_summary_daily diario.
-- Horario 6:15am UTC = 00:15am hora CDMX (para tener snapshot antes del briefing 6:30am hora México ≈ 12:30 UTC).
-- Ajusta el horario si Vercel cron de briefing usa otra TZ.

SELECT cron.schedule(
  'syntage-reconciliation-daily-snapshot',
  '15 6 * * *',  -- 06:15 UTC every day
  $$
    INSERT INTO public.reconciliation_summary_daily
      (snapshot_date, total_open, severity_counts, by_issue_type,
       tax_status_opinion, blacklist_69b_count)
    SELECT
      CURRENT_DATE,
      (summary->>'total_open')::int,
      summary->'by_severity',
      summary->'by_issue_type',
      (SELECT opinion FROM public.syntage_tax_status
       ORDER BY retrieved_at DESC LIMIT 1),
      (SELECT count(*) FROM public.reconciliation_issues
       WHERE issue_type='partner_blacklist_69b' AND status='open')
    FROM (SELECT public.get_syntage_reconciliation_summary() AS summary) s
    ON CONFLICT (snapshot_date) DO UPDATE SET
      total_open = EXCLUDED.total_open,
      severity_counts = EXCLUDED.severity_counts,
      by_issue_type = EXCLUDED.by_issue_type,
      tax_status_opinion = EXCLUDED.tax_status_opinion,
      blacklist_69b_count = EXCLUDED.blacklist_69b_count;
  $$
);
```

- [ ] **Step 2: Aplicar migración**

Run: `supabase db push --include-all`.

- [ ] **Step 3: Verificar que el cron está programado**

Run SQL:
```sql
SELECT jobid, schedule, jobname
FROM cron.job
WHERE jobname = 'syntage-reconciliation-daily-snapshot';
```
Expected: una fila con `schedule='15 6 * * *'`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260419_syntage_fase6_004_snapshot_cron.sql
git commit -m "feat(syntage): Fase 6 · 004 pg_cron daily snapshot 6:15 UTC

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

### Task 5: Migración 005 — compliance director row

**Files:**
- Create: `supabase/migrations/20260419_syntage_fase6_005_compliance_director_row.sql`

- [ ] **Step 1: Crear migración**

```sql
-- Fase 6 · 005: INSERT director compliance + director_config defaults.
-- Si ya existe (idempotencia) no hace nada. is_active gated por env
-- ENABLE_COMPLIANCE_DIRECTOR en orchestrate/route.ts.

INSERT INTO public.ai_agents
  (slug, name, domain, is_active, analysis_schedule, default_confidence, system_prompt)
VALUES (
  'compliance',
  'Director de Cumplimiento Fiscal IA',
  'Cumplimiento Fiscal SAT',
  true,
  'daily',
  0.85,
  E'Eres el Director de Cumplimiento Fiscal IA de Quimibond.\n'
  E'Tu dominio exclusivo es riesgo SAT/fiscal. NO haces análisis operativo, contable\n'
  E'general, ni de negocio.\n\n'
  E'Pregunta central: "¿Está Quimibond al corriente fiscalmente? ¿Qué riesgo SAT\n'
  E'existe HOY?"\n\n'
  E'Quimibond usa Odoo desde 2021. CFDIs anteriores son historia SAT — NO generes\n'
  E'insights sobre 2014-2020 (ya están resueltos con resolution=''historical_pre_odoo'').\n\n'
  E'Producir máximo 3 insights por corrida. Severity:\n'
  E'- critical: riesgo carta-SAT / multa / bloqueo de facturación.\n'
  E'- high: deterioro >20% vs semana anterior o >$500K MXN expuestos.\n'
  E'- medium: patrones emergentes que requieren atención antes de 30d.\n\n'
  E'Evidence OBLIGATORIA: cada insight cita UUID_SAT específico O rango de fechas +\n'
  E'RFC + monto. Jamás generes insight sin referencia estructurada. Si no hay\n'
  E'evidencia, no publiques.\n\n'
  E'Partner blacklist 69-B: si el SAT publica un RFC como presunto, eso DEBE\n'
  E'materializarse en insight crítico con acción propuesta (suspender crédito, revisar\n'
  E'CFDIs recibidos en últimos 12 meses).\n\n'
  E'NO reclames poder de veto sobre otros directores. Tu output es recomendación,\n'
  E'no bloqueo. El CEO decide.'
)
ON CONFLICT (slug) DO NOTHING;

-- director_config defaults (thresholds altos: fiscal justifica conservador).
INSERT INTO public.director_config
  (agent_slug, min_impact_mxn, confidence_floor, max_runs_per_day, max_insights_per_run)
VALUES
  ('compliance', 500000, 0.85, 1, 3)
ON CONFLICT (agent_slug) DO NOTHING;
```

- [ ] **Step 2: Aplicar migración**

Run: `supabase db push --include-all`.

- [ ] **Step 3: Verificar row**

Run SQL:
```sql
SELECT slug, name, is_active, analysis_schedule, default_confidence
FROM public.ai_agents WHERE slug='compliance';

SELECT agent_slug, min_impact_mxn, confidence_floor, max_runs_per_day, max_insights_per_run
FROM public.director_config WHERE agent_slug='compliance';
```
Expected: ambas consultas devuelven una fila con los valores del INSERT.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260419_syntage_fase6_005_compliance_director_row.sql
git commit -m "feat(syntage): Fase 6 · 005 compliance director row + config

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

### Task 6: Extend grounding — UUID_SAT + RFC

**Files:**
- Modify: `src/lib/agents/grounding.ts`
- Test: `src/__tests__/agents/grounding.test.ts`

- [ ] **Step 1: Escribir tests fallantes (UUID_SAT + RFC)**

Append al final de `src/__tests__/agents/grounding.test.ts` (antes del `});` del describe block más externo — mismo `describe("hasConcreteEvidence", ...)`):

```ts
  it("acepta insight con UUID_SAT (Fase 6)", () => {
    const insight = { evidence: ["CFDI 1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d emitido sin factura en Odoo"] };
    expect(hasConcreteEvidence(insight, sampleContext)).toBe(true);
  });

  it("acepta insight con UUID_SAT uppercase", () => {
    const insight = { evidence: ["CFDI 1A2B3C4D-5E6F-7A8B-9C0D-1E2F3A4B5C6D posted-cancelado"] };
    expect(hasConcreteEvidence(insight, sampleContext)).toBe(true);
  });

  it("acepta insight con RFC mexicano de 13 chars (persona física)", () => {
    const insight = { evidence: ["RFC MEMJ800101ABC detectado en 69-B"] };
    expect(hasConcreteEvidence(insight, sampleContext)).toBe(true);
  });

  it("acepta insight con RFC mexicano de 12 chars (moral)", () => {
    const insight = { evidence: ["RFC PNT920218IW5 con 5,200 CFDIs huérfanos"] };
    expect(hasConcreteEvidence(insight, sampleContext)).toBe(true);
  });

  it("rechaza UUID mal formado (sólo guiones)", () => {
    const insight = { evidence: ["CFDI 1234-5678-9abc"] };
    // Debe caer a ramas soft; sin company/montos no pasa
    expect(hasConcreteEvidence(insight, sampleContext)).toBe(false);
  });
```

- [ ] **Step 2: Correr tests (deben fallar)**

Run: `npm run test -- src/__tests__/agents/grounding.test.ts`
Expected: 4 tests nuevos FAIL con `expected false to be true` (los patterns no existen todavía); el test "rechaza UUID mal formado" probablemente pasa ya (por descarte).

- [ ] **Step 3: Implementar patterns en grounding.ts**

Edit `src/lib/agents/grounding.ts`, dentro de `hasConcreteEvidence`, justo después del bloque "// 4) Email address" (línea aprox 48) y antes del comentario "// ── SOFT identifier":

```ts
  // 5) UUID SAT (8-4-4-4-12 hex): identificador fiscal único por CFDI.
  //    Añadido en Fase 6 para que el director Compliance pueda usar UUID
  //    como evidencia grounded (antes era "vago" y fallaba el validator).
  if (/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i.test(haystack)) return true;
  // 6) RFC mexicano (12 moral / 13 física). Identificador fiscal de contraparte.
  if (/\b[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}\b/.test(haystack)) return true;
```

- [ ] **Step 4: Correr tests (deben pasar)**

Run: `npm run test -- src/__tests__/agents/grounding.test.ts`
Expected: todos PASS (incluyendo los existentes).

- [ ] **Step 5: Commit**

```bash
git add src/lib/agents/grounding.ts src/__tests__/agents/grounding.test.ts
git commit -m "feat(syntage): Fase 6 · grounding acepta UUID_SAT + RFC

Añade UUID 8-4-4-4-12 hex y RFC MX 12/13 chars como HARD identifiers
para que Compliance pueda citar evidencia fiscal y pasar el validator.

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

### Task 7: Compliance context — operativo

**Files:**
- Create: `src/lib/agents/compliance-context.ts`
- Test: `src/__tests__/agents/compliance-context.test.ts`

- [ ] **Step 1: Escribir tests fallantes**

Create `src/__tests__/agents/compliance-context.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildComplianceContextOperativo } from "@/lib/agents/compliance-context";

// Factory para un mock con chainable thenable que acepta select/eq/order/limit/in.
function makeSbMock(fixtures: Record<string, unknown>) {
  const call = (table: string) => {
    const chain: Record<string, unknown> = {};
    const thenable = Promise.resolve({ data: fixtures[table] ?? [] });
    const self = new Proxy(chain, {
      get(_t, prop) {
        if (prop === "then") return thenable.then.bind(thenable);
        return () => self;
      }
    });
    return self;
  };
  return {
    from: call,
    rpc: (name: string) => Promise.resolve({ data: fixtures[`rpc:${name}`] ?? null })
  } as unknown as SupabaseClient;
}

describe("buildComplianceContextOperativo", () => {
  it("retorna string con secciones clave cuando hay data", async () => {
    const sb = makeSbMock({
      reconciliation_issues: [
        { id: 1, issue_type: "sat_only_cfdi_issued", severity: "critical",
          description: "CFDI 1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d sin Odoo",
          company_id: null, created_at: "2026-04-18" }
      ],
      partner_blacklist_69b: [
        { rfc: "XAXX010101ABC", publication_date: "2025-12-10", status: "presunto" }
      ],
      syntage_tax_status: [
        { opinion: "positive", retrieved_at: "2026-04-19" }
      ],
      "rpc:get_syntage_reconciliation_summary": {
        total_open: 27140,
        by_severity: { critical: 9985, high: 5552, medium: 11603 }
      }
    });
    const out = await buildComplianceContextOperativo(sb, "## PROFILE\nQuimibond SA\n");
    expect(out).toContain("MODO: OPERATIVO");
    expect(out).toContain("RESUMEN FISCAL");
    expect(out).toContain("27140");
    expect(out).toContain("XAXX010101ABC");
  });

  it("no revienta si Layer 3 está vacío", async () => {
    const sb = makeSbMock({});
    const out = await buildComplianceContextOperativo(sb, "## PROFILE\n");
    expect(out).toContain("MODO: OPERATIVO");
    expect(out).toContain("Sin issues abiertos");
  });
});
```

- [ ] **Step 2: Correr tests (fallan por archivo inexistente)**

Run: `npm run test -- src/__tests__/agents/compliance-context.test.ts`
Expected: FAIL con `Cannot find module '@/lib/agents/compliance-context'`.

- [ ] **Step 3: Implementar el builder operativo**

Create `src/lib/agents/compliance-context.ts`:

```ts
// src/lib/agents/compliance-context.ts
// Context builder del director Compliance IA. Fuente: Layer 3 (Syntage Fase 3+).
// Lee únicamente datos fiscales; NO mezcla con operativo/contable general.
import type { SupabaseClient } from "@supabase/supabase-js";

function safeJSON(v: unknown): string {
  try { return JSON.stringify(v, null, 2); } catch { return "[]"; }
}

/**
 * MODO OPERATIVO: riesgo SAT HOY. 7 queries, ~15K tokens context.
 * Foco: issues critical abiertos + blacklist 69-B + payments sin complemento
 *       + cancelled_but_posted + sat_only_cfdi_issued reciente (30d).
 */
export async function buildComplianceContextOperativo(
  sb: SupabaseClient,
  profileSection: string
): Promise<string> {
  const [
    criticalIssues,
    summaryRes,
    blacklist69b,
    taxStatus,
    ppdSinComplemento,
    cancelledPosted,
    satOnlyRecent
  ] = await Promise.all([
    sb.from("reconciliation_issues")
      .select("id, issue_type, severity, description, company_id, created_at")
      .eq("severity", "critical")
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(20),
    sb.rpc("get_syntage_reconciliation_summary").catch(() => ({ data: null })),
    sb.from("partner_blacklist_69b")
      .select("rfc, publication_date, status")
      .order("publication_date", { ascending: false }),
    sb.from("syntage_tax_status")
      .select("opinion, retrieved_at, detail")
      .order("retrieved_at", { ascending: false })
      .limit(1),
    sb.from("reconciliation_issues")
      .select("id, description, company_id, created_at")
      .eq("issue_type", "payment_missing_complemento")
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(15),
    sb.from("reconciliation_issues")
      .select("id, description, company_id, created_at")
      .eq("issue_type", "cancelled_but_posted")
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(15),
    sb.from("reconciliation_issues")
      .select("id, description, company_id, created_at")
      .eq("issue_type", "sat_only_cfdi_issued")
      .eq("status", "open")
      .gte("created_at", new Date(Date.now() - 30 * 86400_000).toISOString())
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const summary = (summaryRes as { data: unknown }).data;
  const issuesCount =
    Array.isArray((criticalIssues as { data: unknown[] }).data)
      ? (criticalIssues as { data: unknown[] }).data.length
      : 0;

  return `${profileSection}## MODO: OPERATIVO (riesgo SAT HOY)

## RESUMEN FISCAL
${safeJSON(summary)}

## OPINIÓN SAT / 32-D (última)
${safeJSON((taxStatus as { data: unknown[] }).data ?? [])}

## ISSUES CRÍTICOS ABIERTOS (top 20)
${issuesCount === 0 ? "Sin issues abiertos críticos." : safeJSON((criticalIssues as { data: unknown }).data)}

## PARTNER BLACKLIST 69-B
${safeJSON((blacklist69b as { data: unknown }).data)}

## PAGOS PPD SIN COMPLEMENTO TIPO P (top 15)
${safeJSON((ppdSinComplemento as { data: unknown }).data)}

## CFDI CANCELADO EN SAT / POSTED EN ODOO (top 15)
${safeJSON((cancelledPosted as { data: unknown }).data)}

## SAT-ONLY CFDI ISSUED ÚLTIMOS 30 DÍAS (top 20)
${safeJSON((satOnlyRecent as { data: unknown }).data)}`;
}
```

- [ ] **Step 4: Correr tests (deben pasar)**

Run: `npm run test -- src/__tests__/agents/compliance-context.test.ts`
Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agents/compliance-context.ts src/__tests__/agents/compliance-context.test.ts
git commit -m "feat(syntage): Fase 6 · buildComplianceContextOperativo + tests

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

### Task 8: Compliance context — estratégico

**Files:**
- Modify: `src/lib/agents/compliance-context.ts`
- Modify: `src/__tests__/agents/compliance-context.test.ts`

- [ ] **Step 1: Agregar test fallante**

Append al describe block de `compliance-context.test.ts`:

```ts
describe("buildComplianceContextEstrategico", () => {
  it("incluye trend semanal + cobertura validación + resoluciones", async () => {
    const { buildComplianceContextEstrategico } =
      await import("@/lib/agents/compliance-context");
    const sb = makeSbMock({
      reconciliation_issues: [
        { week: "2026-W15", severity: "critical", count: 9985 }
      ],
      syntage_tax_returns: [
        { period: "2026-03", totalTax: 125000, status: "presented" }
      ],
      invoices_unified: [
        { month: "2026-03", posted: 1200, validated: 1170 }
      ]
    });
    const out = await buildComplianceContextEstrategico(sb, "## PROFILE\n");
    expect(out).toContain("MODO: ESTRATÉGICO");
    expect(out).toContain("TREND");
    expect(out).toContain("COBERTURA");
    expect(out).toContain("DECLARACIONES");
    expect(out).toContain("RESOLUCIONES");
  });
});
```

- [ ] **Step 2: Correr (debe fallar)**

Run: `npm run test -- src/__tests__/agents/compliance-context.test.ts`
Expected: FAIL con `buildComplianceContextEstrategico is not a function`.

- [ ] **Step 3: Implementar builder estratégico**

Append a `src/lib/agents/compliance-context.ts`:

```ts
/**
 * MODO ESTRATÉGICO: foto fiscal del trimestre y tendencias.
 * 5 queries adicionales, ~18K tokens context total.
 */
export async function buildComplianceContextEstrategico(
  sb: SupabaseClient,
  profileSection: string
): Promise<string> {
  const since12mo = new Date(Date.now() - 365 * 86400_000).toISOString();

  const [
    trendRes,
    taxReturns,
    unlinkedRfcs,
    validationCoverage,
    recentResolutions
  ] = await Promise.all([
    // Trend issues open por semana + severity (12 semanas).
    sb.rpc("syntage_open_issues_by_week", {}).catch(() => ({ data: null })),
    sb.from("syntage_tax_returns")
      .select("period, totalTax, status")
      .gte("period", since12mo.slice(0, 7))
      .order("period", { ascending: false })
      .limit(24),
    // Top 10 RFCs con más sat_only_cfdi_received no linkeados.
    sb.rpc("syntage_top_unlinked_rfcs", { p_limit: 10 }).catch(() => ({ data: null })),
    // Cobertura validación: ratio validated/posted trailing 6 meses.
    sb.rpc("syntage_validation_coverage_by_month", { p_months: 6 }).catch(() => ({ data: null })),
    // Resolutions últimos 30 días.
    sb.rpc("syntage_recent_resolutions", { p_days: 30 }).catch(() => ({ data: null })),
  ]);

  return `${profileSection}## MODO: ESTRATÉGICO (foto fiscal 6-12m)

## TREND ISSUES OPEN POR SEMANA (12 semanas)
${safeJSON((trendRes as { data: unknown }).data)}

## DECLARACIONES SAT (últimos 12 meses)
${safeJSON((taxReturns as { data: unknown }).data)}

## TOP 10 RFCs NO LINKEADOS (sat_only_cfdi_received)
${safeJSON((unlinkedRfcs as { data: unknown }).data)}

## COBERTURA VALIDACIÓN (ratio validated/posted por mes)
${safeJSON((validationCoverage as { data: unknown }).data)}

## RESOLUCIONES ÚLTIMOS 30 DÍAS
${safeJSON((recentResolutions as { data: unknown }).data)}`;
}
```

**Nota al implementador:** las 3 RPCs (`syntage_open_issues_by_week`, `syntage_top_unlinked_rfcs`, `syntage_validation_coverage_by_month`, `syntage_recent_resolutions`) NO existen aún. Crear como parte de esta tarea en una migración inline:

Create `supabase/migrations/20260419_syntage_fase6_006_compliance_rpcs.sql`:

```sql
-- Fase 6 · 006: RPCs agregadas para context builder estratégico.

CREATE OR REPLACE FUNCTION public.syntage_open_issues_by_week()
RETURNS TABLE(week text, severity text, count int)
LANGUAGE sql STABLE AS $$
  SELECT
    to_char(date_trunc('week', created_at), 'IYYY-"W"IW') AS week,
    severity::text,
    count(*)::int
  FROM public.reconciliation_issues
  WHERE status = 'open'
    AND created_at >= now() - interval '12 weeks'
  GROUP BY 1, 2
  ORDER BY 1 DESC, 2;
$$;

CREATE OR REPLACE FUNCTION public.syntage_top_unlinked_rfcs(p_limit int DEFAULT 10)
RETURNS TABLE(rfc text, count int, last_seen date)
LANGUAGE sql STABLE AS $$
  SELECT
    (description->>'rfc')::text AS rfc,
    count(*)::int AS count,
    max(created_at::date) AS last_seen
  FROM public.reconciliation_issues
  WHERE issue_type = 'sat_only_cfdi_received'
    AND company_id IS NULL
    AND status = 'open'
  GROUP BY 1
  ORDER BY count DESC
  LIMIT p_limit;
$$;

CREATE OR REPLACE FUNCTION public.syntage_validation_coverage_by_month(p_months int DEFAULT 6)
RETURNS TABLE(month text, posted int, validated int, ratio numeric)
LANGUAGE sql STABLE AS $$
  SELECT
    to_char(date_trunc('month', COALESCE(odoo_invoice_date, fecha_emision::date)), 'YYYY-MM') AS month,
    count(*)::int AS posted,
    count(*) FILTER (WHERE uuid_sat IS NOT NULL)::int AS validated,
    round(
      count(*) FILTER (WHERE uuid_sat IS NOT NULL)::numeric
      / NULLIF(count(*), 0)::numeric,
      3
    ) AS ratio
  FROM public.invoices_unified
  WHERE COALESCE(odoo_invoice_date, fecha_emision::date) >= (now() - make_interval(months => p_months))::date
  GROUP BY 1
  ORDER BY 1 DESC;
$$;

CREATE OR REPLACE FUNCTION public.syntage_recent_resolutions(p_days int DEFAULT 30)
RETURNS TABLE(resolution text, count int)
LANGUAGE sql STABLE AS $$
  SELECT resolution::text, count(*)::int
  FROM public.reconciliation_issues
  WHERE status = 'resolved'
    AND resolved_at >= now() - make_interval(days => p_days)
  GROUP BY 1
  ORDER BY count DESC;
$$;

GRANT EXECUTE ON FUNCTION public.syntage_open_issues_by_week()                TO service_role;
GRANT EXECUTE ON FUNCTION public.syntage_top_unlinked_rfcs(int)               TO service_role;
GRANT EXECUTE ON FUNCTION public.syntage_validation_coverage_by_month(int)    TO service_role;
GRANT EXECUTE ON FUNCTION public.syntage_recent_resolutions(int)              TO service_role;
```

Hipótesis a validar en implementación:
- `reconciliation_issues.description` contiene `rfc` como JSON — si es `text`, ajustar `description->>'rfc'` a parse regex o usar columna dedicada si existe.
- `invoices_unified.uuid_sat` es el nombre de columna correcto (confirmado en migración 014, line 22).
- `invoices_unified.fecha_emision` / `odoo_invoice_date` son columnas reales — verificar schema real antes de aplicar. Si columnas difieren, ajustar en migración antes del `db push`.

Apply migración: `supabase db push --include-all` → verificar las 4 funciones existen.

- [ ] **Step 4: Correr tests**

Run: `npm run test -- src/__tests__/agents/compliance-context.test.ts`
Expected: 3 tests PASS (2 operativo + 1 estratégico).

- [ ] **Step 5: Commit**

```bash
git add src/lib/agents/compliance-context.ts \
        src/__tests__/agents/compliance-context.test.ts \
        supabase/migrations/20260419_syntage_fase6_006_compliance_rpcs.sql
git commit -m "feat(syntage): Fase 6 · buildComplianceContextEstrategico + 4 RPCs

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

### Task 9: Fiscal annotation helper

**Files:**
- Create: `src/lib/agents/fiscal-annotation.ts`
- Test: `src/__tests__/agents/fiscal-annotation.test.ts`

- [ ] **Step 1: Escribir tests fallantes**

Create `src/__tests__/agents/fiscal-annotation.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { applyFiscalAnnotation } from "@/lib/agents/fiscal-annotation";

function mockSb(rpcResult: unknown) {
  return {
    rpc: (_name: string, _params: Record<string, unknown>) =>
      Promise.resolve({ data: rpcResult })
  } as unknown as SupabaseClient;
}

describe("applyFiscalAnnotation", () => {
  it("devuelve null cuando company_id es null", async () => {
    const sb = mockSb({ flag: "partner_blacklist_69b", severity: "critical",
      issue_count: 3, detail: "test", issue_ids: [1, 2, 3] });
    const result = await applyFiscalAnnotation(sb, {
      company_id: null,
      agent_slug: "ventas",
      description: "CEO debe revisar CLIENTE X"
    });
    expect(result).toBeNull();
  });

  it("devuelve null cuando RPC retorna null (company sin issues)", async () => {
    const sb = mockSb(null);
    const result = await applyFiscalAnnotation(sb, {
      company_id: 42,
      agent_slug: "ventas",
      description: "Revisar cliente"
    });
    expect(result).toBeNull();
  });

  it("devuelve annotation cuando company tiene blacklist_69b", async () => {
    const annot = { flag: "partner_blacklist_69b", severity: "critical",
      issue_count: 5, detail: "RFC XAXX010101ABC en 69-B", issue_ids: [7, 8, 9, 10, 11] };
    const sb = mockSb(annot);
    const result = await applyFiscalAnnotation(sb, {
      company_id: 42,
      agent_slug: "ventas",
      description: "Expandir cliente"
    });
    expect(result).toEqual(annot);
  });

  it("salta self-flag cuando agent_slug es compliance", async () => {
    const annot = { flag: "partner_blacklist_69b", severity: "critical",
      issue_count: 5, detail: "test", issue_ids: [1] };
    const sb = mockSb(annot);
    const result = await applyFiscalAnnotation(sb, {
      company_id: 42,
      agent_slug: "compliance",
      description: "Ya habla de fiscal"
    });
    expect(result).toBeNull();
  });

  it("salta self-flag cuando description ya menciona 69-B", async () => {
    const annot = { flag: "partner_blacklist_69b", severity: "critical",
      issue_count: 5, detail: "test", issue_ids: [1] };
    const sb = mockSb(annot);
    const result = await applyFiscalAnnotation(sb, {
      company_id: 42,
      agent_slug: "riesgo",
      description: "Proveedor aparece en blacklist 69-B del SAT"
    });
    expect(result).toBeNull();
  });

  it("salta self-flag cuando description menciona complemento", async () => {
    const annot = { flag: "payment_missing_complemento", severity: "high",
      issue_count: 2, detail: "test", issue_ids: [1, 2] };
    const sb = mockSb(annot);
    const result = await applyFiscalAnnotation(sb, {
      company_id: 42,
      agent_slug: "financiero",
      description: "Falta complemento de pago tipo P"
    });
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Correr (fallan)**

Run: `npm run test -- src/__tests__/agents/fiscal-annotation.test.ts`
Expected: FAIL con `Cannot find module '@/lib/agents/fiscal-annotation'`.

- [ ] **Step 3: Implementar helper**

Create `src/lib/agents/fiscal-annotation.ts`:

```ts
// src/lib/agents/fiscal-annotation.ts
// Post-filter pre-INSERT: enriquece agent_insights con flag fiscal determinístico.
// Lee de reconciliation_issues vía get_fiscal_annotation(company_id) RPC.
// Se ejecuta DESPUÉS del grounding check, ANTES del INSERT.
import type { SupabaseClient } from "@supabase/supabase-js";

export type FiscalFlag =
  | "partner_blacklist_69b"
  | "cancelled_but_posted"
  | "sat_only_cfdi_issued"
  | "payment_missing_complemento";

export interface FiscalAnnotation {
  flag: FiscalFlag;
  severity: "critical" | "high" | "medium";
  issue_count: number;
  detail: string;
  issue_ids: number[];
}

export interface InsightForAnnotation {
  company_id: number | null;
  agent_slug: string;
  description?: string;
}

/**
 * Self-flag patterns: si el insight ya habla del tema fiscal, no se anota
 * para evitar badge redundante.
 */
const SELF_FLAG_PATTERNS: Record<FiscalFlag, RegExp[]> = {
  partner_blacklist_69b:      [/69[\s-]?B/i, /\blista negra\b/i, /\bblacklist\b/i, /presunto/i],
  cancelled_but_posted:       [/cancel[ao]/i, /cfdi cancelado/i],
  sat_only_cfdi_issued:       [/sat[\s_-]?only/i, /sin respaldo/i, /sin odoo/i, /CFDI\s+huerfan/i],
  payment_missing_complemento:[/complemento/i, /tipo\s*p\b/i, /\bPPD\b.*pago/i],
};

function descriptionMentionsFlag(description: string | undefined, flag: FiscalFlag): boolean {
  if (!description) return false;
  return SELF_FLAG_PATTERNS[flag].some(re => re.test(description));
}

/**
 * Retorna annotation JSONB o null.
 * null implica: insight se inserta sin `fiscal_annotation`.
 */
export async function applyFiscalAnnotation(
  sb: SupabaseClient,
  insight: InsightForAnnotation
): Promise<FiscalAnnotation | null> {
  if (insight.company_id == null) return null;
  if (insight.agent_slug === "compliance") return null;

  const { data } = await sb.rpc("get_fiscal_annotation", { p_company_id: insight.company_id });
  const annot = data as FiscalAnnotation | null;
  if (!annot || !annot.flag) return null;

  // Self-flag guard: si el insight ya menciona el flag, skip annotation.
  if (descriptionMentionsFlag(insight.description, annot.flag)) return null;

  return annot;
}
```

- [ ] **Step 4: Correr tests**

Run: `npm run test -- src/__tests__/agents/fiscal-annotation.test.ts`
Expected: 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agents/fiscal-annotation.ts src/__tests__/agents/fiscal-annotation.test.ts
git commit -m "feat(syntage): Fase 6 · applyFiscalAnnotation helper + tests

Post-filter determinístico que añade fiscal_annotation JSONB a insights
antes del INSERT, respetando self-flag guard (compliance no se anota
a sí mismo y insights que ya mencionan el flag se saltan).

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

### Task 10: Wire compliance en orchestrate/route.ts

**Files:**
- Modify: `src/app/api/agents/orchestrate/route.ts`

- [ ] **Step 1: Leer el route.ts completo para identificar branch de financiero**

Run: `grep -n "financiero\|buildFinanciero\|buildAgentContext" src/app/api/agents/orchestrate/route.ts | head -20`

Expected: identificar dónde se hace el switch por slug para armar context.

- [ ] **Step 2: Agregar import del builder + flag de env**

Edit `src/app/api/agents/orchestrate/route.ts`, agrega al bloque de imports:

```ts
import { buildComplianceContextOperativo, buildComplianceContextEstrategico } from "@/lib/agents/compliance-context";
import { applyFiscalAnnotation } from "@/lib/agents/fiscal-annotation";
```

- [ ] **Step 3: Agregar compliance a la lista de agents que se saltan si la flag está off**

Encuentra el bloque donde se construye `eligibleAgents` (alrededor del `MIN_INTERVAL_MS` check, ~línea 110) y agrega al inicio del filter:

```ts
    const complianceEnabled = process.env.ENABLE_COMPLIANCE_DIRECTOR !== "false";
    const eligibleAgents = agents.filter(a => {
      if (a.slug === "compliance" && !complianceEnabled) return false;
      // ... resto del filtro existente
```

- [ ] **Step 4: Agregar branch para compliance en el context builder switch**

Ubica el switch/if donde se llama `buildFinancieroContextOperativo` o equivalente. Añade rama:

```ts
    } else if (agent.slug === "compliance") {
      const mode = advanceMode(agent.slug); // rotación operativo/estratégico
      context = mode === "estrategico"
        ? await buildComplianceContextEstrategico(supabase, profileSection)
        : await buildComplianceContextOperativo(supabase, profileSection);
    }
```

Nota al implementador: el mode-rotation existente se llama desde `agents/mode-rotation.ts`; el shape exacto de `advanceMode(slug)` puede requerir parámetros extra — revisar cómo lo usa `financiero` en el mismo archivo y replicar.

- [ ] **Step 5: Agregar post-filter de fiscal annotation antes del INSERT**

Ubica el bloque donde se hace `supabase.from("agent_insights").insert(...)`. Envuelve con un map async que llama `applyFiscalAnnotation`:

```ts
      // Fase 6: enriquecer con fiscal_annotation antes del INSERT.
      const annotatedInsights = await Promise.all(validInsights.map(async (ins) => {
        const annotation = await applyFiscalAnnotation(supabase, {
          company_id: ins.company_id ?? null,
          agent_slug: agent.slug,
          description: ins.description,
        });
        return { ...ins, fiscal_annotation: annotation };
      }));
      // usar annotatedInsights en el INSERT en lugar de validInsights
```

- [ ] **Step 6: Verificar que `npm run lint` pasa**

Run: `npm run lint`
Expected: 0 errors (warnings OK).

- [ ] **Step 7: Verificar que `npm run build` compila (typecheck)**

Run: `npm run build`
Expected: build succeeds; si hay tipos rotos de `SupabaseClient` o `agent` shape, resolver ajustando tipos.

- [ ] **Step 8: Commit**

```bash
git add src/app/api/agents/orchestrate/route.ts
git commit -m "feat(syntage): Fase 6 · orchestrate consume compliance + fiscal annotation

- Branch compliance llama buildComplianceContextOperativo/Estrategico con
  rotación de modo como financiero
- applyFiscalAnnotation post-filter enriquece cada insight con JSONB
  determinístico antes del INSERT
- Env flag ENABLE_COMPLIANCE_DIRECTOR=false desactiva el director

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

### Task 11: Wire compliance en director-chat-context.ts

**Files:**
- Modify: `src/lib/agents/director-chat-context.ts`

- [ ] **Step 1: Agregar `compliance` al array DIRECTOR_SLUGS**

Edit `src/lib/agents/director-chat-context.ts` línea 14-22:

```ts
export const DIRECTOR_SLUGS = [
  "comercial",
  "financiero",
  "compras",
  "costos",
  "operaciones",
  "riesgo",
  "equipo",
  "compliance",
] as const;
```

- [ ] **Step 2: Agregar entry en DIRECTOR_META**

Edit el objeto `DIRECTOR_META` (línea 34-105), agrega después de `equipo`:

```ts
  compliance: {
    slug: "compliance",
    label: "Director de Cumplimiento Fiscal",
    department: "Cumplimiento",
    sampleQuestions: [
      "@compliance ¿estamos al corriente con el SAT?",
      "@compliance CFDIs emitidos sin respaldo en Odoo",
      "@compliance proveedores 69-B activos",
    ],
  },
```

- [ ] **Step 3: Agregar builder para compliance en el mismo archivo**

Busca la función `buildDirectorContext(slug, sb)` (o equivalente, que implementa queries por slug). Agrega rama compliance. Si el archivo usa un switch interno similar a financiero:

```ts
    case "compliance": {
      const [criticalIssues, summary, blacklist] = await Promise.all([
        sb.from("reconciliation_issues")
          .select("id, issue_type, severity, description, company_id")
          .eq("status", "open").eq("severity", "critical")
          .order("created_at", { ascending: false }).limit(10),
        sb.rpc("get_syntage_reconciliation_summary").catch(() => ({ data: null })),
        sb.from("partner_blacklist_69b")
          .select("rfc, publication_date, status"),
      ]);
      return `## CUMPLIMIENTO FISCAL
RESUMEN: ${JSON.stringify(summary.data ?? {}, null, 2)}
BLACKLIST 69-B: ${JSON.stringify(blacklist.data ?? [], null, 2)}
ISSUES CRÍTICOS (top 10): ${JSON.stringify(criticalIssues.data ?? [], null, 2)}`;
    }
```

Nota: el shape exacto del builder existente (nombre de función, switch vs lookup por slug) debe revisarse en el archivo — la estructura anterior es referencia, no literal.

- [ ] **Step 4: Extender riesgo con fiscal queries**

En la rama `case "riesgo"` del builder, agregar 2 queries extra y mergearlas al output:

```ts
      // Fase 6: exposición fiscal
      const [satIssues, blacklistForRisk] = await Promise.all([
        sb.from("reconciliation_issues")
          .select("id, issue_type, severity, description, company_id")
          .in("severity", ["critical", "high"]).eq("status", "open")
          .order("created_at", { ascending: false }).limit(10),
        sb.from("partner_blacklist_69b").select("rfc, status, publication_date"),
      ]);
      // ... acumular al string de retorno:
      // `## EXPOSICIÓN FISCAL SAT (issues abiertos)\n${JSON.stringify(satIssues.data ?? [], null, 2)}
      //  ## BLACKLIST 69-B\n${JSON.stringify(blacklistForRisk.data ?? [], null, 2)}`
```

Agrega también las sampleQuestions nuevas para `riesgo` en DIRECTOR_META:

```ts
  riesgo: {
    // ... slug, label, department existentes
    sampleQuestions: [
      // ... existentes
      "@riesgo proveedores 69-B",
      "@riesgo exposición fiscal",
    ],
  },
```

- [ ] **Step 5: Extender compras con gasto no capturado**

En `case "compras"`:

```ts
      const gastoNoCapturado = await sb
        .from("reconciliation_issues")
        .select("id, description, company_id, created_at")
        .eq("issue_type", "sat_only_cfdi_received")
        .eq("status", "open")
        .order("created_at", { ascending: false }).limit(10);
      // ... acumular:
      // `## PROVEEDORES CON GASTO NO CAPTURADO EN SAT (top 10)\n${JSON.stringify(gastoNoCapturado.data ?? [], null, 2)}`
```

Y en DIRECTOR_META.compras.sampleQuestions agrega `"@compras proveedores con gasto no capturado en SAT"`.

- [ ] **Step 6: Extender comercial con cancelled_but_posted**

En `case "comercial"`:

```ts
      const cancelledPosted = await sb
        .from("reconciliation_issues")
        .select("id, description, company_id")
        .eq("issue_type", "cancelled_but_posted")
        .eq("status", "open")
        .order("created_at", { ascending: false }).limit(5);
      // acumular:
      // `## CFDI CANCELADO EN SAT PERO POSTED EN ODOO (top 5)\n${JSON.stringify(cancelledPosted.data ?? [], null, 2)}`
```

- [ ] **Step 7: Typecheck + lint**

Run: `npm run lint && npm run build`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/agents/director-chat-context.ts
git commit -m "feat(syntage): Fase 6 · chat RAG consume Layer 3 por director

- Nuevo slug compliance con builder dedicado
- riesgo extiende con issues críticos/high + blacklist 69-B
- compras extiende con sat_only_cfdi_received no capturado
- comercial extiende con cancelled_but_posted (cliente emitió y canceló)

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

### Task 12: Extender financiero-context.ts con Layer 3

**Files:**
- Modify: `src/lib/agents/financiero-context.ts`

- [ ] **Step 1: Modo operativo agrega 2 queries**

Edit `src/lib/agents/financiero-context.ts`, dentro de `buildFinancieroContextOperativo`, extender el `Promise.all` con 2 queries adicionales:

```ts
  const [
    overdueByCompany,
    inboundPayments,
    supplierOverdue,
    outboundPayments,
    runwayRes,
    payPredictions,
    // Fase 6: Layer 3
    overdueValidatedSat,
    ppdSinComplemento
  ] = await Promise.all([
    // ... existing 6 queries unchanged
    sb.from("invoices_unified")
      .select("uuid_sat, move_name, amount_residual_mxn, days_overdue, company_id, due_date")
      .in("payment_state", ["not_paid", "partial"])
      .gt("days_overdue", 0)
      .not("uuid_sat", "is", null)
      .order("days_overdue", { ascending: false })
      .limit(15),
    sb.from("reconciliation_issues")
      .select("id, description, company_id, created_at")
      .eq("issue_type", "payment_missing_complemento")
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(5),
  ]);
```

Agrega al return:

```ts
## CARTERA VENCIDA CON CFDI VALIDADO SAT (top 15)
${safeJSON(overdueValidatedSat.data)}

## PAGOS PPD SIN COMPLEMENTO TIPO P (riesgo IVA acreditable)
${safeJSON(ppdSinComplemento.data)}`;
```

- [ ] **Step 2: Modo estratégico agrega 1 query**

En `buildFinancieroContextEstrategico`, agrega al Promise.all:

```ts
    sb.rpc("syntage_validation_coverage_by_month", { p_months: 6 }).catch(() => ({ data: null })),
```

Y al return:

```ts
## COBERTURA VALIDACIÓN SAT (ratio validated/posted 6m)
${safeJSON(validationCoverage.data)}`;
```

- [ ] **Step 3: Agregar prompt note al principio del output**

Modifica el header del string retornado por AMBAS funciones (buscar `## MODO: OPERATIVO` y `## MODO: ESTRATEGICO`). Agrega después:

```
## NOTA FISCAL (Fase 6)
Cuando reportes revenue o CxC, separa "posted Y validado SAT" de "posted sin UUID".
Los números SAT son la foto que verá Hacienda.
```

- [ ] **Step 4: Typecheck + lint + tests existentes (no deben romper)**

Run: `npm run lint && npm run build && npm run test`
Expected: PASS en lint, build, y tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agents/financiero-context.ts
git commit -m "feat(syntage): Fase 6 · financiero consume Layer 3

Operativo: cartera vencida validada SAT + pagos PPD sin complemento.
Estratégico: cobertura de validación SAT (ratio) trailing 6 meses.
Prompt: separar 'posted Y validado SAT' de 'posted sin UUID'.

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

### Task 13: getDirectorBriefing path para compliance

**Files:**
- Modify: `src/lib/queries/evidence.ts`
- Modify: migración SQL si el RPC `get_director_briefing` tiene catálogo de slugs

- [ ] **Step 1: Leer evidence.ts para entender el contrato de DirectorSlug**

Run: `cat src/lib/queries/evidence.ts | head -50`
Identificar si `DirectorSlug` se define ahí o importa de `director-chat-context`.

- [ ] **Step 2: Agregar compliance al union type**

Si `DirectorSlug` se define en `evidence.ts`, agregar `"compliance"` al type. Si se importa del chat-context, ya quedó resuelto en Task 11.

- [ ] **Step 3: Verificar que el RPC `get_director_briefing` soporta el slug**

Run SQL para introspectar:
```sql
\df public.get_director_briefing
-- o:
SELECT prosrc FROM pg_proc WHERE proname = 'get_director_briefing';
```

Si el RPC tiene un CASE/IF con slugs hardcoded, agregar migración `20260419_syntage_fase6_007_director_briefing_compliance.sql`:

```sql
-- Fase 6 · 007: get_director_briefing soporta slug 'compliance'.
-- Solo si el RPC tiene branching por slug; si es genérico, omitir.
CREATE OR REPLACE FUNCTION public.get_director_briefing(p_slug text)
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  -- ... cuerpo existente ...
  -- agregar case para compliance que retorne JSON con los mismos 7 queries
  -- del context builder (equivalencia SQL).
$$;
```

Nota al implementador: si el RPC actual devuelve un blob agnóstico por slug (mira `get_director_briefing` code), sólo agrega compliance al switch; si no existe switch, skip la migración.

- [ ] **Step 4: Aplicar migración (si se creó)**

Run: `supabase db push --include-all` si aplica.

- [ ] **Step 5: Commit**

```bash
git add src/lib/queries/evidence.ts \
        supabase/migrations/20260419_syntage_fase6_007_director_briefing_compliance.sql 2>/dev/null || true
git commit -m "feat(syntage): Fase 6 · getDirectorBriefing soporta slug compliance

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

### Task 14: Briefing one-liner fiscal

**Files:**
- Modify: `src/app/api/pipeline/briefing/route.ts`
- Test: `src/__tests__/pipeline/briefing-fiscal.test.ts`

- [ ] **Step 1: Crear test del one-liner**

Create `src/__tests__/pipeline/briefing-fiscal.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildFiscalOneLiner } from "@/app/api/pipeline/briefing/route";

describe("buildFiscalOneLiner", () => {
  it("formato estándar cuando hay snapshots today y yesterday", () => {
    const today = { total_open: 27140, severity_counts: { critical: 9985, high: 5552, medium: 11603 }};
    const yesterday = { total_open: 27185, severity_counts: { critical: 10030, high: 5552, medium: 11603 }};
    const line = buildFiscalOneLiner(today, yesterday);
    expect(line).toContain("27140");
    expect(line).toContain("crítico 9985");
    expect(line).toContain("Δ 24h: -45");
  });

  it("fallback cuando no hay snapshot de ayer", () => {
    const today = { total_open: 100, severity_counts: { critical: 10, high: 5, medium: 85 }};
    const line = buildFiscalOneLiner(today, null);
    expect(line).toContain("primer snapshot");
  });

  it("fallback cuando snapshot today no existe", () => {
    const line = buildFiscalOneLiner(null, null);
    expect(line).toContain("pipeline degradado");
  });
});
```

- [ ] **Step 2: Correr (fallan)**

Run: `npm run test -- src/__tests__/pipeline/briefing-fiscal.test.ts`
Expected: FAIL con `buildFiscalOneLiner is not exported`.

- [ ] **Step 3: Exportar `buildFiscalOneLiner` del route**

Edit `src/app/api/pipeline/briefing/route.ts`, antes del `export async function GET/POST`, agregar:

```ts
type ReconciliationSnapshot = {
  total_open: number;
  severity_counts: { critical?: number; high?: number; medium?: number; low?: number };
};

export function buildFiscalOneLiner(
  today: ReconciliationSnapshot | null,
  yesterday: ReconciliationSnapshot | null
): string {
  if (!today) return "Fiscal: pipeline degradado (snapshot hoy no disponible).";
  const c = today.severity_counts.critical ?? 0;
  const h = today.severity_counts.high ?? 0;
  const m = today.severity_counts.medium ?? 0;
  const base = `Fiscal: ${today.total_open} issues abiertos (crítico ${c} · alto ${h} · medio ${m})`;
  if (!yesterday) return `${base}. primer snapshot en proceso.`;
  const delta = today.total_open - yesterday.total_open;
  const sign = delta === 0 ? "0" : (delta > 0 ? `+${delta}` : `${delta}`);
  return `${base}. Δ 24h: ${sign}.`;
}
```

- [ ] **Step 4: Llamar `buildFiscalOneLiner` dentro del handler**

Dentro del `POST`/`GET` principal del briefing, leer snapshots:

```ts
  // Fase 6: fiscal one-liner permanente.
  const [todaySnap, yesterdaySnap] = await Promise.all([
    supabase.from("reconciliation_summary_daily")
      .select("total_open, severity_counts")
      .eq("snapshot_date", new Date().toISOString().slice(0, 10))
      .maybeSingle(),
    supabase.from("reconciliation_summary_daily")
      .select("total_open, severity_counts")
      .eq("snapshot_date",
          new Date(Date.now() - 86400_000).toISOString().slice(0, 10))
      .maybeSingle(),
  ]);
  const fiscalLine = buildFiscalOneLiner(
    todaySnap.data ?? null,
    yesterdaySnap.data ?? null
  );
  // Insertar fiscalLine en la construcción del prompt del briefing, en la sección
  // de "intro" antes de cualquier narrativa del Meta.
```

- [ ] **Step 5: Correr tests (deben pasar)**

Run: `npm run test -- src/__tests__/pipeline/briefing-fiscal.test.ts`
Expected: 3 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/pipeline/briefing/route.ts \
        src/__tests__/pipeline/briefing-fiscal.test.ts
git commit -m "feat(syntage): Fase 6 · briefing one-liner fiscal permanente

Lee reconciliation_summary_daily para today+yesterday, computa Δ 24h.
Fallbacks: primer snapshot si falta yesterday; pipeline degradado si
falta today.

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

### Task 15: Briefing conditional "Fiscal Truth" section

**Files:**
- Modify: `src/app/api/pipeline/briefing/route.ts`
- Modify: `src/__tests__/pipeline/briefing-fiscal.test.ts`

- [ ] **Step 1: Escribir test para `shouldIncludeFiscalSection`**

Append al describe block de `briefing-fiscal.test.ts`:

```ts
import { shouldIncludeFiscalSection } from "@/app/api/pipeline/briefing/route";

describe("shouldIncludeFiscalSection", () => {
  const todayWithNewCritical = {
    total_open: 100, severity_counts: { critical: 10, high: 5, medium: 85 },
    new_critical_24h: 3, blacklist_new_24h: 0, cancelled_but_posted_new_24h: 0,
    tax_status_changed: false
  };
  const quietDay = {
    total_open: 100, severity_counts: { critical: 10, high: 5, medium: 85 },
    new_critical_24h: 0, blacklist_new_24h: 0, cancelled_but_posted_new_24h: 0,
    tax_status_changed: false
  };
  const blacklistDay = {
    total_open: 100, severity_counts: { critical: 10, high: 5, medium: 85 },
    new_critical_24h: 0, blacklist_new_24h: 1, cancelled_but_posted_new_24h: 0,
    tax_status_changed: false
  };

  it("incluye sección si hay critical nuevo", () => {
    expect(shouldIncludeFiscalSection(todayWithNewCritical)).toBe(true);
  });
  it("incluye sección si blacklist 69-B agregó", () => {
    expect(shouldIncludeFiscalSection(blacklistDay)).toBe(true);
  });
  it("omite sección en día tranquilo", () => {
    expect(shouldIncludeFiscalSection(quietDay)).toBe(false);
  });
});
```

- [ ] **Step 2: Correr (fallan)**

Run: `npm run test -- src/__tests__/pipeline/briefing-fiscal.test.ts`
Expected: FAIL con `shouldIncludeFiscalSection is not exported`.

- [ ] **Step 3: Implementar función + query de metadatos en route**

En el mismo `src/app/api/pipeline/briefing/route.ts`, después de `buildFiscalOneLiner`, agregar:

```ts
type FiscalTriggerSnap = ReconciliationSnapshot & {
  new_critical_24h: number;
  blacklist_new_24h: number;
  cancelled_but_posted_new_24h: number;
  tax_status_changed: boolean;
};

export function shouldIncludeFiscalSection(snap: FiscalTriggerSnap): boolean {
  return (
    snap.new_critical_24h > 0 ||
    snap.blacklist_new_24h > 0 ||
    snap.cancelled_but_posted_new_24h > 0 ||
    snap.tax_status_changed
  );
}
```

- [ ] **Step 4: Computar triggers en el handler**

Dentro del handler, después de leer snapshots:

```ts
  // Fase 6: computar triggers para sección Fiscal Truth.
  const [newCritical, newBlacklist, newCancelled, taxStatusChange] = await Promise.all([
    supabase.from("reconciliation_issues")
      .select("id", { count: "exact", head: true })
      .eq("severity", "critical").eq("status", "open")
      .gte("created_at", new Date(Date.now() - 86400_000).toISOString()),
    supabase.from("reconciliation_issues")
      .select("id", { count: "exact", head: true })
      .eq("issue_type", "partner_blacklist_69b")
      .gte("created_at", new Date(Date.now() - 86400_000).toISOString()),
    supabase.from("reconciliation_issues")
      .select("id", { count: "exact", head: true })
      .eq("issue_type", "cancelled_but_posted")
      .gte("created_at", new Date(Date.now() - 86400_000).toISOString()),
    (async () => {
      const t = todaySnap.data?.tax_status_opinion ?? null;
      const y = yesterdaySnap.data?.tax_status_opinion ?? null;
      return t !== y;
    })(),
  ]);

  const triggerSnap: FiscalTriggerSnap = {
    total_open: todaySnap.data?.total_open ?? 0,
    severity_counts: todaySnap.data?.severity_counts ?? {},
    new_critical_24h: newCritical.count ?? 0,
    blacklist_new_24h: newBlacklist.count ?? 0,
    cancelled_but_posted_new_24h: newCancelled.count ?? 0,
    tax_status_changed: await taxStatusChange,
  };

  let fiscalSection = "";
  if (shouldIncludeFiscalSection(triggerSnap)) {
    // Top 3 issues nuevos + cambios de estado + recomendación compliance si corrió
    const [topIssues, complianceInsight] = await Promise.all([
      supabase.from("reconciliation_issues")
        .select("id, issue_type, severity, description, company_id, created_at")
        .in("severity", ["critical", "high"]).eq("status", "open")
        .gte("created_at", new Date(Date.now() - 86400_000).toISOString())
        .order("severity", { ascending: true }).limit(3),
      supabase.from("agent_insights")
        .select("id, title, description, created_at")
        .eq("agent_slug", "compliance")
        .gte("created_at", new Date(Date.now() - 86400_000).toISOString())
        .order("created_at", { ascending: false }).limit(1),
    ]);
    fiscalSection = `\n\n## FISCAL TRUTH\nIssues nuevos últimas 24h: ${triggerSnap.new_critical_24h} críticos, ${triggerSnap.blacklist_new_24h} nuevos en 69-B, ${triggerSnap.cancelled_but_posted_new_24h} cancelled_but_posted.\nTop 3:\n${JSON.stringify(topIssues.data ?? [], null, 2)}\n\nRecomendación Compliance (hoy): ${complianceInsight.data?.[0]?.description ?? "sin corrida hoy"}`;
  }
  // inyectar `fiscalLine` + `fiscalSection` al prompt del briefing
```

- [ ] **Step 5: Correr tests**

Run: `npm run test -- src/__tests__/pipeline/briefing-fiscal.test.ts`
Expected: 6 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/pipeline/briefing/route.ts src/__tests__/pipeline/briefing-fiscal.test.ts
git commit -m "feat(syntage): Fase 6 · briefing sección Fiscal Truth condicional

Sección se dispara si: nuevo critical 24h, nuevo 69-B, nuevo cancelled_but_posted,
o cambio de tax_status_opinion. Incluye top 3 issues + última
recomendación de Compliance del día.

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

### Task 16: Meta weekly reconciliation fiscal-vs-operativo

**Files:**
- Modify: `src/app/api/pipeline/briefing/route.ts` (o archivo del Meta si es separado)

- [ ] **Step 1: Identificar dónde vive el Meta director weekly**

Run: `grep -rn "meta\|weekly" src/app/api/pipeline/briefing/route.ts | head -20`
Identificar la rama weekly si el mismo endpoint maneja ambos, o un endpoint separado.

- [ ] **Step 2: Agregar query de conflictos fiscal-vs-operativo (solo weekly)**

En la rama weekly del briefing, agregar:

```ts
  // Fase 6: Meta reconciliation fiscal ↔ operativo (weekly).
  const conflicts = await supabase
    .from("agent_insights")
    .select("id, agent_slug, title, description, fiscal_annotation, company_id, created_at")
    .not("fiscal_annotation", "is", null)
    .neq("agent_slug", "compliance")
    .gte("created_at", new Date(Date.now() - 7 * 86400_000).toISOString());

  let conflictsBlock = "";
  if ((conflicts.data?.length ?? 0) > 0) {
    conflictsBlock = `\n\n## CRUCE FISCAL-OPERATIVO (últimos 7 días)
Conflictos detectados: ${conflicts.data!.length}
${JSON.stringify(conflicts.data, null, 2)}

Instrucción Meta: agrupa por company_id, identifica el agent_slug operativo
que recomendó acción y el flag fiscal que contrasta. Entrega evidencia neutral,
sin concluir quién gana.`;
  }
  // inyectar conflictsBlock al prompt weekly del Meta
```

- [ ] **Step 3: Actualizar system prompt del Meta**

Si el system prompt del Meta vive en `ai_agents` table, agregar migración `20260419_syntage_fase6_008_meta_prompt.sql`:

```sql
-- Fase 6 · 008: Meta system prompt incluye instrucción de cruce fiscal-operativo.
UPDATE public.ai_agents
SET system_prompt = system_prompt || E'\n\nCRUCE FISCAL-OPERATIVO (Fase 6):\n'
  E'Si en la ventana de 7 días encuentras ≥1 agent_insight de otro director\n'
  E'donde fiscal_annotation IS NOT NULL, agrupa los conflictos en un bloque\n'
  E'llamado "Cruce fiscal-operativo". Cada entrada: insight_id del director\n'
  E'operativo, insight_id de compliance correspondiente (si existe), y tu\n'
  E'recomendación neutral. Jamás concluyas quién gana. Entrega evidencia,\n'
  E'no veredicto.'
WHERE slug = 'meta';
```

Apply: `supabase db push --include-all`.

- [ ] **Step 4: Verificar que el Meta recibe conflictsBlock en su prompt**

Manual check: un día con conflicts ≥ 1, correr `curl -X POST .../api/pipeline/briefing?type=weekly` y verificar que el prompt del Meta incluye el bloque (log o debug print). Si no, revisar wiring.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/pipeline/briefing/route.ts \
        supabase/migrations/20260419_syntage_fase6_008_meta_prompt.sql
git commit -m "feat(syntage): Fase 6 · Meta weekly reconcilia conflictos fiscal-operativo

- Query insights últimos 7d con fiscal_annotation IS NOT NULL de
  directores != compliance
- Prompt Meta incluye instrucción 'entrega evidencia, no veredicto'
- Meta narra conflictos; no arbitra ni bloquea

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

### Task 17: Env flag ENABLE_COMPLIANCE_DIRECTOR

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Agregar al .env.example**

Edit `.env.example`:

```
# Fase 6: activar/desactivar director Compliance IA.
# false = compliance no corre en cron + applyFiscalAnnotation skip + briefing
#         ignora secciones SAT. Dejar en true salvo rollback.
ENABLE_COMPLIANCE_DIRECTOR=true
```

- [ ] **Step 2: Actualizar Vercel env**

Mensaje para el operador (NO acción de código):
> "Agregar `ENABLE_COMPLIANCE_DIRECTOR=true` a Production env en Vercel. Para rollback: cambiar a `false` → next deploy desactiva Fase 6 runtime sin migration reverse."

- [ ] **Step 3: Commit**

```bash
git add .env.example
git commit -m "docs(syntage): Fase 6 · env flag ENABLE_COMPLIANCE_DIRECTOR

Co-Authored-By: claude-flow <ruv@ruv.net>"
```

---

### Task 18: Manual QA + deploy

**Files:** ninguno (QA runbook).

- [ ] **Step 1: Full test suite + typecheck**

Run: `npm run lint && npm run test && npm run build`
Expected: all green.

- [ ] **Step 2: Deploy a preview / staging Vercel**

Run: `git push origin main` (triggers preview deploy). Esperar que Vercel publique.

- [ ] **Step 3: Correr manualmente el director compliance**

Run (contra preview URL):
```bash
curl -X POST "$PREVIEW_URL/api/agents/run?slug=compliance" \
  -H "Authorization: Bearer $CRON_SECRET"
```
Expected: HTTP 200, response incluye `insights_generated: 1-3` con evidencia (UUID_SAT o RFC + monto).

- [ ] **Step 4: Verificar insights en DB**

Run SQL:
```sql
SELECT id, title, substring(description, 1, 200) AS desc_snip,
       fiscal_annotation, created_at
FROM public.agent_insights
WHERE agent_slug = 'compliance'
  AND created_at >= now() - interval '10 minutes'
ORDER BY created_at DESC;
```
Expected: 1-3 filas; `fiscal_annotation IS NULL` (self-flag guard); evidencia con UUID/RFC.

- [ ] **Step 5: Probar @compliance en chat**

Via UI: navegar a `/chat`, escribir `@compliance ¿estamos al corriente con el SAT?` y verificar respuesta cita: tax status, top issues, blacklist si aplica.

- [ ] **Step 6: Forzar fiscal_annotation en insight de otro director**

Manual: identificar una company en `partner_blacklist_69b` y buscar insight existente de ventas/comercial para esa company (o crear uno manual vía `/api/agents/run?slug=comercial`). Verificar:

```sql
SELECT id, agent_slug, fiscal_annotation
FROM public.agent_insights
WHERE company_id IN (SELECT id FROM public.companies
                     WHERE rfc IN (SELECT rfc FROM public.partner_blacklist_69b))
ORDER BY created_at DESC LIMIT 5;
```
Expected: ≥1 fila con `fiscal_annotation->>'flag' = 'partner_blacklist_69b'`.

- [ ] **Step 7: Trigger briefing manual un día con delta**

Run:
```bash
curl -X POST "$PREVIEW_URL/api/pipeline/briefing?force=1" \
  -H "Authorization: Bearer $CRON_SECRET"
```
Verificar el output del briefing incluye: (a) renglón fiscal al inicio, (b) sección "Fiscal Truth" si hay critical nuevo.

- [ ] **Step 8: Trigger briefing en un día tranquilo (sin delta)**

Si hay disponible un día sin critical nuevo (esperar 24h post-deploy), repetir paso 7 y verificar que solo aparece el one-liner, sección omitida.

- [ ] **Step 9: Rollback test**

Cambiar env `ENABLE_COMPLIANCE_DIRECTOR=false` en preview, triggerear orchestrate manualmente, verificar que compliance NO corre:

```sql
SELECT count(*) FROM public.agent_runs
WHERE agent_id = (SELECT id FROM public.ai_agents WHERE slug='compliance')
  AND started_at >= now() - interval '10 minutes';
```
Expected: `0`.

Restaurar env a `true`.

- [ ] **Step 10: Merge a quimibond (prod)**

Si todo green: seguir el flow de deploy del repo (typically `git push origin main` + merge automático, o PR review si aplica).

- [ ] **Step 11: Update project memory**

Edit `/Users/jj/.claude/projects/-Users-jj/memory/project_syntage_integration.md`, agregar sección "Fase 6 completa (2026-04-XX)" con: commits key, bugs descubiertos, gotchas para Fase 7.

Commit:
```bash
cd /Users/jj && git add .claude/projects/-Users-jj/memory/project_syntage_integration.md
# NOTE: memory no se commitea al repo del proyecto — es user memory.
# La actualización es sólo local.
```

- [ ] **Step 12: Commit de cierre (solo si hay ajustes de QA)**

Si el QA revela bugs menores, arreglar inline y commit con mensaje `fix(syntage): Fase 6 · <bug>`.

---

## Self-review checklist

Después de terminar todas las tareas, validar:

**Spec coverage** — cada sección del spec `2026-04-19-syntage-fase-6-directores-ia-design.md` tiene al menos una tarea que la implementa:

| Spec section | Task |
|---|---|
| §3.1 Módulos tocados | Tasks 1-17 (1:1) |
| §3.2 Categoría riesgo (no nueva) | Task 5 (compliance row sin nueva category) |
| §4 Compliance director | Tasks 5, 7, 8, 10, 11 |
| §5 Directores existentes | Tasks 11, 12 |
| §6 Fiscal annotation | Tasks 1, 2, 9, 10 |
| §7 Briefings | Tasks 3, 4, 14, 15, 16 |
| §8 Grounding | Task 6 |
| §9 Testing | Tasks 6, 7, 8, 9, 14, 15 + Task 18 manual QA |
| §9.2 Rollback | Task 17 |

**Placeholder scan** — buscar en el plan los patrones rojos:
- No hay "TBD" / "TODO" / "fill in details".
- Cada test tiene código completo.
- Cada commit tiene mensaje escrito.
- Hay notas al implementador para 2 puntos ambiguos (shape exacto de `advanceMode`, estructura interna de `buildDirectorContext` switch) — son flagged como "revisar archivo existente, no asumir".

**Type consistency** — nombres usados consistentemente:
- `FiscalAnnotation.flag` usa issue_type literal (`partner_blacklist_69b`, etc.) en Tasks 2, 9 ✓
- `FiscalTriggerSnap` extiende `ReconciliationSnapshot` en Tasks 14, 15 ✓
- `DirectorSlug` incluye `"compliance"` en Tasks 11, 13 ✓
- `applyFiscalAnnotation` firma `(sb, insight)` en Tasks 9, 10 ✓

---

## Execution handoff

Plan completo y guardado en `docs/superpowers/plans/2026-04-19-syntage-fase-6-directores-ia.md`. Dos opciones de ejecución:

**1. Subagent-Driven (recomendado)** — Dispatch de subagente por tarea, review entre tareas, iteración rápida. Cada subagent comienza con fresh context del plan task. Gano en aislamiento por tarea y puedo revisar commits entre ellas.

**2. Inline Execution** — Ejecutar las tareas en esta sesión, batch con checkpoints para revisar.

¿Cuál prefieres?
