-- Limpieza de entidades Syntage que no son Quimibond.
-- Regla: 1 odoo_company_id ↔ 1 syntage_entity_id. Solo Quimibond (PNT920218IW5,
-- odoo_company_id=1, syntage_entity_id=a13aaec4-e56d-48c6-8f74-038d8ff6c1e5) está
-- en alcance. Los entities personales de Jacobo y Jose Mizrahi (marcados [IGNORE]
-- desde 2026-04-23) generaron 19,441 webhooks descartados que contaminan
-- pipeline_logs y syntage_webhook_events sin uso productivo.

-- 1) Borrar mapping rows de RFCs no-Quimibond
DELETE FROM syntage_entity_map
WHERE taxpayer_rfc <> 'PNT920218IW5';

-- 2) Borrar webhook events recibidos pero descartados como Unmapped RFC
DELETE FROM syntage_webhook_events e
WHERE EXISTS (
  SELECT 1 FROM pipeline_logs p
  WHERE p.phase='syntage_webhook' AND p.level='warning'
    AND p.details->>'rfc' IN ('MIPJ691003QJ1','MITJ991130TV7')
    AND p.details->>'event_id' = e.event_id
);

-- 3) Borrar warnings históricos de pipeline_logs para esos RFCs
DELETE FROM pipeline_logs
WHERE phase='syntage_webhook' AND level='warning'
  AND details->>'rfc' IN ('MIPJ691003QJ1','MITJ991130TV7');

-- 4) Defensa en profundidad: registrar nota en pipeline_logs sobre la limpieza
INSERT INTO pipeline_logs (level, phase, message, details)
VALUES (
  'info',
  'cleanup_non_quimibond_syntage_entities',
  'Removed 2 entity_map rows + 19,441 webhook_events + 19,441 pipeline_logs warnings for RFCs MIPJ691003QJ1 and MITJ991130TV7',
  jsonb_build_object(
    'entity_map_deleted', 2,
    'webhook_events_deleted', 19441,
    'pipeline_logs_warnings_deleted', 19441,
    'kept_taxpayer_rfc', 'PNT920218IW5',
    'kept_odoo_company_id', 1,
    'kept_syntage_entity_id', 'a13aaec4-e56d-48c6-8f74-038d8ff6c1e5'
  )
);
