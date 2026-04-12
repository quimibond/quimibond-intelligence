-- Seeds ai_agents.config para los 7 directores activos.
-- Valores calibrados con base en acted/expired rate de últimos 30 dias.
-- Los valores solo surten efecto una vez que el deploy de feat/silenciar-directores
-- entra a producción (la ruta orchestrate lee estos campos via loadDirectorConfig).

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
