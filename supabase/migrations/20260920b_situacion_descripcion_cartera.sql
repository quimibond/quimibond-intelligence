-- Situación plan A — ajuste tras la primera revisión (2026-09-20): la descripción de
-- cartera_vencida decía "RFC en rfc_relacionados = dato_malo (parte relacionada)" y el
-- bot la convertía en hechos sobre clientes que no lo son ("validar el estatus de parte
-- relacionada", título con "(RFC parte relacionada)"). Se redacta la descripción como
-- regla de cálculo y se re-encolan las situaciones de cartera ya redactadas
-- (version + 1 > ia_version → vuelven a ser candidatas con el prompt corregido).
UPDATE senales_config
SET descripcion = 'Facturas de cliente publicadas, no pagadas o parciales, con vencimiento pasado, por cliente. Los RFC de partes relacionadas (umbrales.rfc_relacionados) se apartan como dato_malo y no entran al mapa: si la situación está viva, el cliente no es parte relacionada.'
WHERE senal = 'cartera_vencida';

UPDATE situaciones
SET version = version + 1,
    historia = historia || jsonb_build_object('fecha', now(), 'evento', 'reencolada', 'detalle', 'redacción con descripción de señal corregida (20260920b)')
WHERE senal = 'cartera_vencida' AND ia_version > 0 AND ia_version >= version
  AND estado NOT IN ('resuelta', 'descartada');

INSERT INTO pipeline_logs (level, phase, message, details)
VALUES ('info', 'migration', 'Situación: descripción de cartera_vencida sin "parte relacionada" y re-encolado de sus redacciones',
        jsonb_build_object('migration', '20260920b_situacion_descripcion_cartera'));
