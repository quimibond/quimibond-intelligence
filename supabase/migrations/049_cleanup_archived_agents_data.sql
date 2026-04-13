-- Fase 7b: Cleanup de basura de agentes archivados.
--
-- Los 11 agentes viejos (meta, cleanup, sales, finance, operations,
-- relationships, risk, growth, suppliers, predictive, odoo) fueron
-- archivados el 12-abr-2026 pero su data quedaba consumiendo espacio:
-- ~2,829 insights + ~1,268 runs + 187 lessons silenciadas.
--
-- Politica: mantener la fila en ai_agents como audit trail, pero limpiar
-- todo lo que cuelga. action_items.alert_id es ON DELETE SET NULL, asi
-- que las acciones historicas pierden el link al insight pero sobreviven.
-- insight_follow_ups es ON DELETE CASCADE.
--
-- Cero tickets bloqueadores (verificado pre-delete).
-- Aplicado en vivo el 13-abr-2026.

BEGIN;

-- Log de lo que se va a borrar (snapshot antes)
INSERT INTO pipeline_logs (level, phase, message, details)
SELECT
  'info',
  'cleanup_archived',
  format('Cleanup pre-snapshot: %s insights, %s runs, %s memories',
    (SELECT COUNT(*) FROM agent_insights WHERE agent_id IN (SELECT id FROM ai_agents WHERE archived_at IS NOT NULL)),
    (SELECT COUNT(*) FROM agent_runs WHERE agent_id IN (SELECT id FROM ai_agents WHERE archived_at IS NOT NULL)),
    (SELECT COUNT(*) FROM agent_memory WHERE importance = 0)
  ),
  jsonb_build_object(
    'archived_slugs', (SELECT array_agg(slug) FROM ai_agents WHERE archived_at IS NOT NULL),
    'insights_to_delete', (SELECT COUNT(*) FROM agent_insights WHERE agent_id IN (SELECT id FROM ai_agents WHERE archived_at IS NOT NULL)),
    'runs_to_delete', (SELECT COUNT(*) FROM agent_runs WHERE agent_id IN (SELECT id FROM ai_agents WHERE archived_at IS NOT NULL)),
    'silenced_lessons_to_delete', (SELECT COUNT(*) FROM agent_memory WHERE importance = 0)
  );

-- 1. Insights de agentes archivados (CASCADE se lleva insight_follow_ups)
DELETE FROM agent_insights
WHERE agent_id IN (SELECT id FROM ai_agents WHERE archived_at IS NOT NULL);

-- 2. Runs de agentes archivados
DELETE FROM agent_runs
WHERE agent_id IN (SELECT id FROM ai_agents WHERE archived_at IS NOT NULL);

-- 3. Lessons silenciadas en Fase 1 (importance=0, ya no se cargan al prompt)
DELETE FROM agent_memory WHERE importance = 0;

-- 4. Analizar tablas afectadas para que los stats queden frescos
ANALYZE agent_insights;
ANALYZE agent_runs;
ANALYZE agent_memory;

COMMIT;
