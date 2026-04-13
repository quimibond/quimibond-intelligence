-- Fase 6 del plan "fix-director-data-integrity":
-- View de salud de directores + helper de scoring top-3 para el briefing.
--
-- Objetivo: que el CEO pueda en un solo vistazo ver como se comporta cada
-- director despues de las Fases 1-3. Metricas clave:
--   - acted_rate (target >= 20%)
--   - avg_impact (detector de alucinaciones: equipo deberia ser <500K)
--   - pct_grounded (% de insights con company_id real, target >= 80%)
--   - lessons_active (post-fase1 solo deberian tener las nuevas)
--
-- Combina agent_insights + ai_agents.config + agent_memory + agent_runs.

BEGIN;

-- ── 1. View director_health_30d ─────────────────────────────────────────
CREATE OR REPLACE VIEW director_health_30d AS
WITH insights_30d AS (
  SELECT
    agent_id,
    COUNT(*) AS total,
    COUNT(*) FILTER (WHERE state = 'acted_on') AS acted,
    COUNT(*) FILTER (WHERE state = 'dismissed') AS dismissed,
    COUNT(*) FILTER (WHERE state = 'expired') AS expired,
    COUNT(*) FILTER (WHERE state IN ('new','seen')) AS open_,
    COUNT(*) FILTER (WHERE state = 'archived') AS archived,
    COUNT(*) FILTER (WHERE company_id IS NOT NULL) AS with_company,
    AVG(confidence) FILTER (WHERE state IN ('acted_on','dismissed','expired')) AS avg_conf,
    AVG(business_impact_estimate) FILTER (WHERE business_impact_estimate IS NOT NULL AND business_impact_estimate > 0) AS avg_impact,
    MAX(business_impact_estimate) AS max_impact
  FROM agent_insights
  WHERE created_at >= NOW() - INTERVAL '30 days'
  GROUP BY agent_id
),
memories AS (
  SELECT
    agent_id,
    COUNT(*) AS total_lessons,
    COUNT(*) FILTER (WHERE importance > 0.2) AS active_lessons
  FROM agent_memory
  WHERE memory_type = 'lesson'
  GROUP BY agent_id
),
last_runs AS (
  SELECT agent_id, MAX(started_at) AS last_run_at
  FROM agent_runs
  WHERE started_at >= NOW() - INTERVAL '7 days'
  GROUP BY agent_id
)
SELECT
  a.id AS agent_id,
  a.slug,
  a.name,
  a.domain,
  COALESCE(i.total, 0) AS insights_30d,
  COALESCE(i.acted, 0) AS acted,
  COALESCE(i.dismissed, 0) AS dismissed,
  COALESCE(i.expired, 0) AS expired,
  COALESCE(i.open_, 0) AS open_insights,
  COALESCE(i.archived, 0) AS archived,
  CASE
    WHEN COALESCE(i.acted + i.dismissed + i.expired, 0) = 0 THEN NULL
    ELSE ROUND(100.0 * i.acted / NULLIF(i.acted + i.dismissed + i.expired, 0), 1)
  END AS acted_rate_pct,
  CASE
    WHEN COALESCE(i.total, 0) = 0 THEN NULL
    ELSE ROUND(100.0 * i.with_company / NULLIF(i.total, 0), 1)
  END AS pct_grounded,
  ROUND(COALESCE(i.avg_conf, 0)::numeric, 2) AS avg_confidence,
  ROUND(COALESCE(i.avg_impact, 0)::numeric, 0) AS avg_impact_mxn,
  ROUND(COALESCE(i.max_impact, 0)::numeric, 0) AS max_impact_mxn,
  COALESCE(m.total_lessons, 0) AS total_lessons,
  COALESCE(m.active_lessons, 0) AS active_lessons,
  lr.last_run_at,
  a.config->'max_business_impact_mxn' AS cap_impact,
  a.config->'min_business_impact_mxn' AS cap_min_impact,
  a.config->'min_confidence_floor' AS cap_min_conf,
  a.config->'max_insights_per_run' AS cap_max_per_run,
  -- Status categorico: good / warning / critical / silent
  CASE
    WHEN COALESCE(i.total, 0) = 0 THEN 'silent'
    WHEN i.acted + i.dismissed + i.expired = 0 THEN 'new'
    WHEN ROUND(100.0 * i.acted / NULLIF(i.acted + i.dismissed + i.expired, 0), 1) >= 20 THEN 'good'
    WHEN ROUND(100.0 * i.acted / NULLIF(i.acted + i.dismissed + i.expired, 0), 1) >= 10 THEN 'warning'
    ELSE 'critical'
  END AS health_status
FROM ai_agents a
LEFT JOIN insights_30d i ON i.agent_id = a.id
LEFT JOIN memories m ON m.agent_id = a.id
LEFT JOIN last_runs lr ON lr.agent_id = a.id
WHERE a.is_active = true
  AND a.archived_at IS NULL
ORDER BY
  CASE COALESCE(
    CASE
      WHEN COALESCE(i.total, 0) = 0 THEN 'silent'
      WHEN i.acted + i.dismissed + i.expired = 0 THEN 'new'
      WHEN ROUND(100.0 * i.acted / NULLIF(i.acted + i.dismissed + i.expired, 0), 1) >= 20 THEN 'good'
      WHEN ROUND(100.0 * i.acted / NULLIF(i.acted + i.dismissed + i.expired, 0), 1) >= 10 THEN 'warning'
      ELSE 'critical'
    END, 'silent')
    WHEN 'critical' THEN 1
    WHEN 'warning' THEN 2
    WHEN 'silent' THEN 3
    WHEN 'new' THEN 4
    WHEN 'good' THEN 5
    ELSE 6
  END,
  COALESCE(i.total, 0) DESC;

COMMENT ON VIEW director_health_30d IS
  'Salud de cada director activo en los ultimos 30 dias. acted_rate target >= 20%, pct_grounded target >= 80%. health_status good/warning/critical/silent/new.';

-- ── 2. Scoring function: top-N insights accionables ────────────────────
-- Rankea insights activos por (impact_norm * 0.4) + (confidence * 0.3) + (recency * 0.3).
-- Se usa en el briefing diario para seleccionar las 3 decisiones del CEO.
CREATE OR REPLACE FUNCTION top_actionable_insights(p_limit int DEFAULT 3)
RETURNS TABLE (
  id bigint,
  title text,
  description text,
  severity text,
  category text,
  confidence numeric,
  business_impact_estimate numeric,
  company_id bigint,
  company_name text,
  assignee_name text,
  assignee_department text,
  agent_slug text,
  agent_name text,
  hours_old numeric,
  score numeric
)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH candidates AS (
    SELECT
      i.id,
      i.title,
      i.description,
      i.severity,
      i.category,
      i.confidence,
      i.business_impact_estimate,
      i.company_id,
      i.assignee_name,
      i.assignee_department,
      c.canonical_name AS company_name,
      a.slug AS agent_slug,
      a.name AS agent_name,
      EXTRACT(EPOCH FROM (NOW() - i.created_at)) / 3600 AS hours_old,
      -- impact normalized: log scale capped at 10M
      LEAST(GREATEST(LN(GREATEST(i.business_impact_estimate, 1000)) / LN(10000000), 0), 1) AS impact_norm,
      COALESCE(i.confidence, 0) AS conf,
      GREATEST(1 - (EXTRACT(EPOCH FROM (NOW() - i.created_at)) / (48 * 3600)), 0) AS recency
    FROM agent_insights i
    LEFT JOIN ai_agents a ON a.id = i.agent_id
    LEFT JOIN companies c ON c.id = i.company_id
    WHERE i.state IN ('new', 'seen')
      AND i.confidence >= 0.80
      AND i.severity IN ('critical', 'high')
      AND i.created_at >= NOW() - INTERVAL '72 hours'
  )
  SELECT
    id,
    title,
    description,
    severity,
    category,
    confidence,
    business_impact_estimate,
    company_id,
    company_name,
    assignee_name,
    assignee_department,
    agent_slug,
    agent_name,
    ROUND(hours_old::numeric, 1) AS hours_old,
    ROUND((impact_norm * 0.4 + conf * 0.3 + recency * 0.3)::numeric, 3) AS score
  FROM candidates
  ORDER BY (impact_norm * 0.4 + conf * 0.3 + recency * 0.3) DESC
  LIMIT p_limit;
$function$;

COMMENT ON FUNCTION top_actionable_insights IS
  'Top N insights accionables para el CEO. Score = impact_norm*0.4 + confidence*0.3 + recency*0.3. Filtra a new/seen, confidence>=0.8, severity critical|high, ultimas 72h.';

COMMIT;
