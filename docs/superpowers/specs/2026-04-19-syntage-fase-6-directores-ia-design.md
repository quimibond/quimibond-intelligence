# Syntage Fase 6 — Directores IA consumen Layer 3

**Fecha:** 2026-04-19
**Fase:** 6 (Directores IA)
**Status:** Spec approved, pending implementation plan
**Fases previas:** 1 (plumbing) ✅ · 2 (onboarding) ✅ · 3 (Layer 3 canónico) ✅ · 3.5 (MV enrichment) ✅ · 5 (frontend L2→L3) ✅

---

## 1. Objetivo

Los 7 directores de negocio IA actuales + 3 de sistema (Meta, Data Quality —inactivo—, Odoo Advisor) + **1 nuevo director Compliance IA** leen de Layer 3 (`invoices_unified`, `payments_unified`, `reconciliation_issues`, `get_syntage_reconciliation_summary()`) como fiscal truth. Los briefings diarios del CEO incluyen un renglón fiscal permanente + sección expandida condicional a severity. El Meta director reconcilia conflictos fiscal-vs-operativo en briefings semanales sin arbitrar decisiones.

Este es el valor principal del producto — Project Prometheus per la visión padre (`2026-04-12-flujo-datos-vision-ideal.md` §2.3).

---

## 2. Decisiones de diseño (pre-implementación)

Las 4 decisiones abiertas se resolvieron así:

| # | Decisión | Resolución |
|---|---|---|
| 1 | Compliance director placement | **A** — 8º director simétrico en `ai_agents`, mismo plumbing (cron + context builder + `director_config` + insights + `@compliance` en chat) |
| 2 | Fiscal findings en briefings | **C** (híbrido) — one-liner permanente siempre + sección expandida condicional a delta |
| 3 | Meta y conflictos fiscal-vs-operativo | **C** (combinado) — annotation automática pre-publish en insights + Meta reconcilia narrativamente en briefing semanal, sin veto |
| 4 | Directores escriben a `reconciliation_issues` | **A + B ligero** — read-only MVP; escalation explícita via agent_tickets se pospone a Fase 7 si surge patrón recurrente |

Consecuencia estructural: Compliance **no tiene poder de veto**. Su output son recomendaciones anotadas, el CEO decide. La autoridad fiscal anota; no sobreescribe autoridad operativa.

---

## 3. Arquitectura

```
                ┌─────────────────────────────────────┐
                │ Layer 3 (Supabase)                  │
                │  - invoices_unified MV              │
                │  - payments_unified MV              │
                │  - payment_allocations_unified VIEW │
                │  - reconciliation_issues table      │
                │  - partner_blacklist_69b            │
                │  - syntage_tax_returns              │
                │  - syntage_tax_status               │
                │  - get_syntage_reconciliation_summary() │
                └────────────────┬────────────────────┘
                                 │ read-only
         ┌───────────────────────┼────────────────────────────┐
         ▼                       ▼                            ▼
  CONTEXT BUILDERS       FISCAL ANNOTATION           META BRIEFING
  (per director)         (post-filter, <50ms)       (daily + weekly)
  - compliance-context   - Enriches agent_insights  - One-liner fiscal
  - financiero (add)       before INSERT with         (siempre)
  - riesgo (add)           fiscal_flag field        - Delta-triggered
  - compras (add)        - reutiliza companies.id     "Fiscal Truth"
  - comercial (lite)       FK cuando existe           sección
  - chat/@compliance     - Skip si insight es de    - Weekly narrative
                           compliance (no self)       reconciliation
                                                      fiscal↔operativo
```

### 3.1 Módulos tocados (5 modif + 3 nuevos + 2 migraciones)

| Tipo | Archivo | Cambio |
|---|---|---|
| NUEVO | `src/lib/agents/compliance-context.ts` | Context builder fiscal, modo operativo (7 queries) y estratégico (5 adicionales) |
| NUEVO | `src/lib/agents/fiscal-annotation.ts` | Post-filter pre-INSERT que popula `fiscal_annotation` JSONB |
| NUEVO | Migración SQL: `INSERT INTO ai_agents` | Row para `compliance` director + `director_config` defaults |
| NUEVO | Migración SQL: `reconciliation_summary_daily` | Tabla snapshot diario para calcular delta 24h en briefing |
| NUEVO | Migración SQL: `agent_insights.fiscal_annotation JSONB` | Columna NULL-able para annotation |
| NUEVO | Migración SQL: `get_fiscal_annotation(p_company_id bigint)` | Función PL/pgSQL determinística |
| NUEVO | Migración SQL: pg_cron row para `reconciliation_summary_daily` 6:15am | Populate diario antes del briefing |
| MODIF | `src/lib/agents/financiero-context.ts` | +2 queries operativo, +1 estratégico, +prompt addition separar "posted Y validado SAT" vs "posted sin UUID" |
| MODIF | `src/lib/agents/director-chat-context.ts` | +slug `compliance`, +fiscal queries en `riesgo`/`compras`/`comercial` |
| MODIF | `src/lib/agents/grounding.ts` | +UUID_SAT regex, +RFC regex como HARD identifiers |
| MODIF | `src/app/api/agents/orchestrate/route.ts` | +branch compliance, +`applyFiscalAnnotation()` post-filter antes del INSERT |
| MODIF | `src/app/api/pipeline/briefing/route.ts` | +one-liner permanente, +sección Fiscal Truth condicional, +Meta weekly reconciliation |
| MODIF | `src/lib/queries/evidence.ts` | +`getDirectorBriefing('compliance')` path |

### 3.2 Categorías de insights

Compliance escribe en categoría existente **`riesgo`** (no se agrega categoría `fiscal`). Razón: el `fiscal_annotation` JSONB + filtrado por `agent_slug='compliance'` son suficientes para distinguir en UI. Agregar categoría nueva rompería `route_insight` trigger y `insight_routing` con cambios marginales.

---

## 4. Compliance director IA

### 4.1 Row en `ai_agents`

```sql
INSERT INTO ai_agents (slug, name, domain, is_active, analysis_schedule, default_confidence, system_prompt)
VALUES (
  'compliance',
  'Director de Cumplimiento Fiscal IA',
  'Cumplimiento Fiscal SAT',
  true,
  'daily',
  0.85,
  '<<ver §4.3 system prompt>>'
);
```

### 4.2 director_config defaults

```json
{
  "min_impact_mxn":       500000,
  "confidence_floor":     0.85,
  "max_runs_per_day":     1,
  "max_insights_per_run": 3
}
```

Razón de thresholds altos: el costo de un falso positivo fiscal (pánico innecesario en CEO) supera al costo de un falso negativo (issue ya está en `/system → Reconciliación`). Empezamos conservadores; bajamos si vemos que Compliance no produce suficiente señal.

### 4.3 System prompt (texto completo)

```
Eres el Director de Cumplimiento Fiscal IA de Quimibond.
Tu dominio exclusivo es riesgo SAT/fiscal. NO haces análisis operativo, contable
general, ni de negocio.

Pregunta central: "¿Está Quimibond al corriente fiscalmente? ¿Qué riesgo SAT
existe HOY?"

Quimibond usa Odoo desde 2021. CFDIs anteriores son historia SAT — NO generes
insights sobre 2014-2020 (ya están resueltos con resolution='historical_pre_odoo').

Producir máximo 3 insights por corrida. Severity:
- critical: riesgo carta-SAT / multa / bloqueo de facturación.
- high: deterioro >20% vs semana anterior o >$500K MXN expuestos.
- medium: patrones emergentes que requieren atención antes de 30d.

Evidence OBLIGATORIA: cada insight cita UUID_SAT específico O rango de fechas +
RFC + monto. Jamás generes insight sin referencia estructurada. Si no hay
evidencia, no publiques.

Partner blacklist 69-B: si el SAT publica un RFC como presunto, eso DEBE
materializarse en insight crítico con acción propuesta (suspender crédito, revisar
CFDIs recibidos en últimos 12 meses).

NO reclames poder de veto sobre otros directores. Tu output es recomendación,
no bloqueo. El CEO decide.
```

### 4.4 Context builder — modo operativo (7 queries, ~15K tokens)

`src/lib/agents/compliance-context.ts` exporta `buildComplianceContextOperativo(sb, profileSection)`:

1. **Top 20 `reconciliation_issues`** — `severity='critical' AND status='open'` ordenados por `created_at DESC`, con `LEFT JOIN companies c ON c.id = ri.company_id` para name (LEFT para no perder los 39% sin company match).
2. **`get_syntage_reconciliation_summary()` RPC** — totales por severity + issue_type.
3. **`partner_blacklist_69b`** — full (decenas de rows).
4. **`syntage_tax_status`** — última opinión 32-D y opinión SAT (`ORDER BY retrieved_at DESC LIMIT 1`).
5. **`payment_missing_complemento`** detail — top 15 facturas PPD paid sin Tipo P via `reconciliation_issues WHERE issue_type='payment_missing_complemento' AND status='open' ORDER BY created_at DESC LIMIT 15`.
6. **`cancelled_but_posted`** — `reconciliation_issues WHERE issue_type='cancelled_but_posted' AND status='open'`.
7. **`sat_only_cfdi_issued` reciente** — últimos 30 días únicamente, para evitar traer los 9,985 históricos. `WHERE issue_type='sat_only_cfdi_issued' AND created_at >= now() - interval '30 days'`.

### 4.5 Context builder — modo estratégico (5 queries adicionales, ~18K tokens)

`buildComplianceContextEstrategico` agrega:

1. **Trend open issues semana-sobre-semana por severity** — `reconciliation_issues` `GROUP BY date_trunc('week', created_at), severity` últimas 12 semanas.
2. **`syntage_tax_returns`** últimos 12 meses — `totalTax`, `status`, `period`.
3. **Top 10 RFCs con más `sat_only_cfdi_received` no linkeados** — `WHERE company_id IS NULL GROUP BY rfc ORDER BY count(*) DESC LIMIT 10`.
4. **Cobertura de validación** — ratio `validated/posted` trailing 6 meses desde `invoices_unified`.
5. **Resolutions últimos 30 días** — breakdown por `resolution` de `reconciliation_issues WHERE status='resolved' AND resolved_at >= now() - interval '30 days'`.

### 4.6 Schedule

`analysis_schedule='daily'`. El eligible filter en `orchestrate/route.ts` requiere ≥20h desde la última corrida (`MIN_INTERVAL_MS.daily = 20 * 3600_000`). En la práctica: Compliance corre 1x/día entre 6am y 8am (primer slot after midnight que matchea round-robin).

El refresh del MV (pg_cron */15min) garantiza que Compliance lee data fresca sin importar cuándo corra.

### 4.7 @compliance en chat

`director-chat-context.ts` agrega:

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
}
```

Builder reutilizable (operativo-only, sin estratégico para latencia baja de chat).

---

## 5. Directores existentes con Layer 3

### 5.1 Financiero (modificado)

**Modo operativo** (`financiero-context.ts`) agrega 2 queries:
- `invoices_unified` para cobranza validada SAT — `WHERE payment_state IN ('not_paid','partial') AND days_overdue > 0 AND uuid_sat IS NOT NULL LIMIT 15` (nombre de columna exacto se confirma en plan; puede ser `uuid_sat` o campo booleano derivado — el predicado "UUID SAT presente" es lo que importa).
- `payment_missing_complemento` count + top 5 vía `reconciliation_issues`.

**Modo estratégico** agrega 1 query:
- Validated/posted ratio trailing 6 meses desde `invoices_unified`.

**Prompt addition:**
> "Cuando reportes revenue o CxC, separa 'posted Y validado SAT' de 'posted sin UUID'. Los números SAT son la foto que verá Hacienda."

### 5.2 Riesgo (chat context)

Agrega 2 queries en `director-chat-context.ts`:
- `reconciliation_issues WHERE severity IN ('critical','high') AND status='open'` top 10.
- `partner_blacklist_69b` completo.

`sampleQuestions` suma: `"@riesgo proveedores 69-B"`, `"@riesgo exposición fiscal"`.

### 5.3 Compras (chat context)

Agrega 1 query:
- Top 10 proveedores con `sat_only_cfdi_received` (gasto no capturado). JOIN `reconciliation_issues` con `companies` via rfc. Los 39% con `company_id=NULL` se agrupan por RFC.

`sampleQuestions` suma: `"@compras proveedores con gasto no capturado en SAT"`.

### 5.4 Comercial (chat context lite)

1 query solamente: `cancelled_but_posted` CFDIs de emisión. Ventas no es dueño de compliance; solo necesita saber cuándo un cliente canceló algo que Odoo sigue mostrando como facturado.

### 5.5 Directores que NO cambian

`costos`, `operaciones`, `equipo` — su foco es margen, lead times, carga. Layer 3 les agrega ruido sin valor. Excluidos explícitamente.

---

## 6. Fiscal annotation (pre-publish post-filter)

### 6.1 Ubicación en el flow

`src/app/api/agents/orchestrate/route.ts`, justo después del grounding check (`hasConcreteEvidence`) y antes del INSERT a `agent_insights`. También aplica en `/api/agents/run` (ejecución manual).

### 6.2 Schema del annotation

Columna nueva `agent_insights.fiscal_annotation JSONB NULL` con forma:

```ts
// Los valores de `flag` son `issue_type` tal como viven en reconciliation_issues.
// Mantener 1:1 evita divergencias entre la fuente canónica y la annotation.
type FiscalAnnotation = {
  flag: 'partner_blacklist_69b'
      | 'cancelled_but_posted'
      | 'sat_only_cfdi_issued'
      | 'payment_missing_complemento'
      | null;
  severity: 'critical' | 'high' | 'medium';
  issue_count: number;   // total open issues de la company (no solo del flag ganador)
  detail: string;        // description del issue ganador
  issue_ids: number[];   // FKs a reconciliation_issues (todos los open de la company)
}
```

### 6.3 Función SQL

```sql
CREATE OR REPLACE FUNCTION get_fiscal_annotation(p_company_id bigint)
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  WITH prioritized AS (
    -- Prioridad: blacklist_69b > cancelled_but_posted > sat_only_issued_critical
    --         > payment_ppd_sin_complemento
    SELECT
      CASE
        WHEN issue_type = 'partner_blacklist_69b' THEN 1
        WHEN issue_type = 'cancelled_but_posted'  THEN 2
        WHEN issue_type = 'sat_only_cfdi_issued' AND severity='critical' THEN 3
        WHEN issue_type = 'payment_missing_complemento' THEN 4
        ELSE 99
      END AS priority,
      issue_type, severity, id, description
    FROM reconciliation_issues
    WHERE company_id = p_company_id
      AND status = 'open'
  ),
  top AS (
    SELECT * FROM prioritized WHERE priority < 99 ORDER BY priority, severity DESC LIMIT 1
  )
  SELECT CASE
    WHEN t.id IS NULL THEN NULL
    ELSE jsonb_build_object(
      'flag',        t.issue_type,
      'severity',    t.severity,
      'issue_count', (SELECT count(*) FROM reconciliation_issues
                      WHERE company_id = p_company_id AND status='open'),
      'detail',      t.description,
      'issue_ids',   (SELECT array_agg(id) FROM reconciliation_issues
                      WHERE company_id = p_company_id AND status='open')
    )
  END
  FROM top t;
$$;
```

### 6.4 Regla "no self-flag"

Si `agent_slug='compliance'` o el `description` del insight ya contiene un patrón que coincide con el flag (`"69-B"`, `"sat_only"`, `"complemento"`, etc.), `fiscal_annotation = NULL`. Evita badge redundante en insights fiscales nativos.

### 6.5 Caso borde

- `company_id=NULL` → `fiscal_annotation = NULL` (no se fuerza lookup por RFC).
- Company con 0 issues → `fiscal_annotation = NULL`.
- Company con múltiples issue types → el de mayor prioridad gana; `issue_ids` incluye todos para profundización desde UI.

---

## 7. Briefings (daily + weekly)

### 7.1 Daily briefing

**One-liner permanente** (al inicio, después del saludo):

```
Fiscal: 27,140 issues abiertos (crítico 9,985 · alto 5,552 · medio 11,603). Δ 24h: -45.
```

Data source: `get_syntage_reconciliation_summary()` RPC (<300ms) + `reconciliation_summary_daily` (row del día anterior) para el delta.

**Sección condicional "Fiscal Truth"** — se incluye si cualquiera de:
- ≥1 issue nuevo `critical` en últimas 24h.
- `open_count.critical` subió vs ayer.
- `syntage_tax_status.opinion` cambió a `negative` (Fase 4.5 lo populará).
- ≥1 partner nuevo en `partner_blacklist_69b`.
- `cancelled_but_posted` añadió rows.

Si se dispara, contenido: top 3 issues nuevos por impacto $ + listado de cambios de estado + recomendación de Compliance si corrió ese día.

**Fallback**: si `reconciliation_summary_daily` no tiene row del día anterior, one-liner dice `"Fiscal: primer snapshot en proceso"` y desaparece al día siguiente. Si el RPC falla o el MV está stale >2h, one-liner dice `"Fiscal: pipeline degradado (último refresh Xh Ym)"` donde X/Y se calculan desde `pg_stat_user_tables.last_autoanalyze` o un `last_refreshed_at` que guarda pg_cron — eso *es* la señal.

### 7.2 Weekly briefing (Meta reconciliation)

Meta busca conflictos fiscal-vs-operativo:

```sql
SELECT ai.id, ai.agent_slug, ai.fiscal_annotation, ai.company_id
FROM agent_insights ai
WHERE ai.created_at >= now() - interval '7 days'
  AND ai.fiscal_annotation IS NOT NULL
  AND ai.agent_slug != 'compliance';
```

Si count ≥ 1, Meta genera párrafo narrativo:

> "Esta semana Ventas identificó a X como oportunidad de expansión (insight #1234), pero Compliance detectó a X con 5,200 sat_only_cfdi_issued críticos post-2021 (issue #5678). Antes de actuar sobre la recomendación de Ventas, conviene validar la integridad fiscal del cliente."

Si count = 0, Meta no fuerza sección — se omite el bloque.

**Prompt snippet agregado al Meta**:

```
Si en la ventana de 7 días encuentras ≥1 agent_insight de otro director donde
fiscal_annotation IS NOT NULL, agrupa los conflictos en un bloque llamado
"Cruce fiscal-operativo". Cada entrada: insight_id del director operativo,
insight_id de compliance correspondiente (si existe), y tu recomendación
neutral. Jamás concluyas quién gana. Entrega evidencia, no veredicto.
```

### 7.3 Tabla `reconciliation_summary_daily`

```sql
CREATE TABLE reconciliation_summary_daily (
  snapshot_date date PRIMARY KEY,
  total_open int NOT NULL,
  severity_counts jsonb NOT NULL,  -- {critical: N, high: N, medium: N, low: N}
  by_issue_type jsonb NOT NULL,    -- {sat_only_cfdi_issued: N, ...}
  tax_status_opinion text,         -- 'positive'|'negative'|null
  blacklist_69b_count int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

Poblada por pg_cron 6:15am (antes del briefing 6:30am) via `INSERT ... ON CONFLICT(snapshot_date) DO UPDATE` — idempotente.

---

## 8. Grounding (`grounding.ts`)

Compliance cita UUIDs SAT y RFCs constantemente. El validador actual los rechazaría como evidencia vaga. Cambio aditivo:

```ts
// UUID SAT: 8-4-4-4-12 hex, case-insensitive
if (/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i.test(haystack)) return true;
// RFC MX: 3-4 letras + 6 dígitos + 3 alfanumérico
if (/\b[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}\b/.test(haystack)) return true;
```

Los tests existentes deben seguir pasando — cambio es puramente aditivo. El helper `looksLikeMetaHallucination` no cambia.

---

## 9. Testing strategy

| Suite | Nuevas cobertura | Stack |
|---|---|---|
| `grounding.test.ts` (existing) | UUID_SAT válido pasa, UUID inválido no. RFC válido pasa. RFC genérico (XEXX010101000) pasa solo con montos/fechas adicionales | vitest |
| `compliance-context.test.ts` (NEW) | Builder operativo produce ≥3 secciones con data. Modo estratégico incluye trend semanal. Vacío graceful | vitest + supabase mock |
| `fiscal-annotation.test.ts` (NEW) | `company_id=NULL`→null. blacklist_69b tiene prioridad. Múltiples issue types→severo gana. Self-flag skip para compliance | vitest + supabase mock |
| `briefing-fiscal.test.ts` (NEW) | One-liner siempre. Sección Fiscal aparece si delta>0, no si delta=0. Fallback graceful sin snapshot | vitest + supabase mock |
| `orchestrate-compliance.int.test.ts` (NEW) | E2E: compliance corre → consume Layer 3 → insight grounded → INSERT con fiscal_annotation=null (self) | vitest + supabase testing |
| `meta-reconciliation.test.ts` (NEW) | Meta detecta conflicto Ventas↔Compliance. 0 conflictos → sección omitida. ≥1 conflicto → párrafo con ambos insight_ids | vitest + mock |

### 9.1 Manual QA checklist (pre-deploy)

1. `/api/agents/run?slug=compliance` manual → ≥1 insight con evidencia concreta (UUID/RFC + monto).
2. `@compliance` en `/chat` con "¿Está Quimibond al corriente?" → respuesta cita tax status + top issues.
3. Forzar insight de ventas sobre company en `partner_blacklist_69b` → confirmar `fiscal_annotation` poblada.
4. `/api/pipeline/briefing?force=1` un día con delta → bloque fiscal completo aparece.
5. Mismo trigger día sin delta → solo one-liner.
6. Verificar que `@compliance` chat NO trae datos pre-2021 en el context.

### 9.2 Rollback plan

- Env flag `ENABLE_COMPLIANCE_DIRECTOR=false`: director excluido por eligible filter + `applyFiscalAnnotation()` skip + briefing ignora secciones SAT.
- `ai_agents.is_active=false` para compliance row — no se borra.
- Rollback = env-var only. No migration reverse.

---

## 10. Gotchas a respetar (heredados de Fases 3 y 5)

- `reconciliation_issues.company_id NULL` para 39% de `sat_only_cfdi_received` (RFCs foráneos). Handle NULL en prompts y en annotation — la annotation solo funciona con `company_id NOT NULL`.
- `statement_timeout` de `service_role` es 180s; refresh del MV toma ~1-2min. Context builder de compliance debe tolerar stale reads cuando el refresh coincide.
- `sat_opinion_negative` issue type queda excluido de MVP (`syntage_tax_status` casi vacío, 1 row). Habilitar cuando Fase 4.5 popule la tabla.
- `payment_allocations_unified` es VIEW (no MV) — futuros MV rebuilds deben dropearla explícitamente antes del CASCADE.
- Filtro `fecha_timbrado >= '2021-01-01'` aplica implícitamente porque refresh functions ya lo aplican para `sat_only_*`. Compliance NO debe duplicar el filtro en sus queries — confía en Layer 3.
- El MV refresh ya excluye históricos resueltos con `resolution='historical_pre_odoo'` — no se cuentan en summary ni en context builders.

---

## 11. Scope out

Fuera de Fase 6 explícitamente:

- UI del badge "⚠️ Riesgo fiscal" en `/inbox` y `/companies/[id]` → Fase 6.5.
- Habilitar `sat_opinion_negative` como issue type → requiere Fase 4.5 (Compliance pull-sync) primero.
- Directores escriben a `reconciliation_issues` vía agent_tickets (Q4 opción B explícita) → Fase 7 si patrón surge.
- `/strategy` surface para recomendaciones estratégicas consolidadas → fase futura.
- `partner_blacklist_69b` auto-refresh desde SAT → supuesto que Fase 4.5 lo mantiene.

---

## 12. Tracking

- **Spec:** este archivo.
- **Plan:** `docs/superpowers/plans/2026-04-19-syntage-fase-6-directores-ia.md` (pendiente, tras aprobación de spec).
- **Project memory:** `/Users/jj/.claude/projects/-Users-jj/memory/project_syntage_integration.md` (update al terminar).
- **Ref spec padre:** `docs/superpowers/specs/2026-04-12-flujo-datos-vision-ideal.md` §2.3, §4.
- **Ref Fase 3:** `docs/superpowers/specs/2026-04-17-syntage-fase-3-layer-3-design.md`.
- **Ref Fase 5:** `docs/superpowers/specs/2026-04-17-syntage-fase-5-frontend-layer3-design.md`.
