-- Fase 1 del plan "fix-director-data-integrity":
-- 1. Revivir el agente data_quality (estaba en analysis_schedule='manual' + SILENT_AGENTS)
-- 2. Enforce el catalogo fijo de categorias con CHECK constraint (normaliza historico antes)
-- 3. Limpiar memorias contaminadas del director equipo (lessons pre migracion PROHIBIDO)
-- 4. Indices para dedup mas rapido en el hot path del orchestrator
--
-- Seguro de aplicar en produccion: todas las operaciones son reversibles.
-- El fix de SILENT_AGENTS vive en src/app/api/agents/orchestrate/route.ts (mismo commit).

BEGIN;

-- ── 1. data_quality: manual → daily ─────────────────────────────────────
UPDATE ai_agents
SET analysis_schedule = 'daily', updated_at = NOW()
WHERE slug = 'data_quality'
  AND is_active = true
  AND archived_at IS NULL;

-- ── 2. Backfill de categorias invalidas previo al CHECK ─────────────────
-- Valores observados en DB que NO pertenecen al catalogo:
--   team_performance, crm, risk, efficiency, agent_calibration, payment,
--   process_improvement, inventory, cash_flow, data_quality.
-- El mapping refleja CATEGORY_MAP de orchestrate/route.ts.
UPDATE agent_insights SET category = 'equipo'      WHERE category IN ('team_performance');
UPDATE agent_insights SET category = 'ventas'      WHERE category IN ('crm');
UPDATE agent_insights SET category = 'riesgo'      WHERE category IN ('risk');
UPDATE agent_insights SET category = 'datos'       WHERE category IN ('efficiency','agent_calibration','process_improvement','data_quality');
UPDATE agent_insights SET category = 'cobranza'    WHERE category IN ('payment','cash_flow');
UPDATE agent_insights SET category = 'operaciones' WHERE category IN ('inventory');

-- Defensive: cualquier categoria residual fuera del catalogo va a 'datos' (internal noise).
UPDATE agent_insights
SET category = 'datos'
WHERE category NOT IN ('cobranza','ventas','entregas','operaciones','proveedores','riesgo','equipo','datos');

-- ── 3. CHECK constraint sobre category ──────────────────────────────────
ALTER TABLE agent_insights
  DROP CONSTRAINT IF EXISTS agent_insights_category_check;
ALTER TABLE agent_insights
  ADD CONSTRAINT agent_insights_category_check
  CHECK (category IN ('cobranza','ventas','entregas','operaciones','proveedores','riesgo','equipo','datos'));

-- ── 4. Limpiar memorias contaminadas del director equipo ────────────────
-- Las 206 "lessons" del director equipo previas al 12-abr-2026 incluyen
-- las que reforzaban el delirio de "sesiones del CEO" y "directores fantasma".
-- La migracion 20260412_director_prompts_negative_scope.sql ya prohibio este scope
-- a nivel prompt, pero las memorias viejas contradicen al nuevo prompt.
-- Fix: bajarles importance a 0 para que dejen de cargarse (el prompt solo lee importance>0.2).
UPDATE agent_memory
SET importance = 0, updated_at = NOW()
WHERE agent_id = (SELECT id FROM ai_agents WHERE slug = 'equipo')
  AND memory_type = 'lesson'
  AND created_at < '2026-04-12 22:00:00+00';

-- ── 5. Indice para acelerar el dedup del orchestrator ───────────────────
-- El orchestrator hace: SELECT title, company_id, category FROM agent_insights
--   WHERE state IN ('new','seen','expired') AND created_at >= NOW()-72h
-- Sin indice dedicado escanea la tabla entera (~10k rows ya) cada corrida.
CREATE INDEX IF NOT EXISTS idx_agent_insights_dedup_hot
  ON agent_insights (created_at DESC)
  WHERE state IN ('new','seen','expired');

-- ── 6. Gatillo: que el proximo run del orchestrator agarre data_quality ─
-- (opcional) No hay next_run_at; el round-robin usa lastRunMap que ya pondera
-- al agente menos reciente. Al remover SILENT_AGENTS en el route, automaticamente
-- sera seleccionado en la siguiente corrida del cron (/15min).

COMMIT;
