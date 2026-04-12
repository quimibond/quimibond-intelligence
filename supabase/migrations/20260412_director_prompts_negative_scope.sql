-- Adds bloque PROHIBIDO (grounding rules) al final de system_prompt de los 7 directores activos.
-- Idempotente via NOT LIKE guard.

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
