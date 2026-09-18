DO $t$
DECLARE r jsonb; c uuid := gen_random_uuid(); sid bigint; s record;
BEGIN
  INSERT INTO senales_config (senal, titulo, area, tipo, fuente, agrupar_por, agregar, umbrales, reglas_calidad)
  VALUES ('_prueba', 'Prueba', 'finanzas', 'credito', 'odoo', 'contraparte', 'suma',
          '{"rfc_relacionados":["RELA010101AAA"]}', '{"antigua_dias":30,"zombie_dias":90}');
  PERFORM senales_ingestar('_prueba', 'odoo', c, '[
    {"clave":"_prueba:partner:990000001","odoo_partner_id":990000001,"valor":100,"documentos":[{"modelo":"account.move","id":11,"nombre":"F/1"}]},
    {"clave":"_prueba:partner:990000001b","odoo_partner_id":990000001,"valor":50,"documentos":[{"modelo":"account.move","id":12,"nombre":"F/2"}]},
    {"clave":"_prueba:partner:990000002","odoo_partner_id":990000002,"valor":5,"payload":{"rfc":"RELA010101AAA"}},
    {"clave":"_prueba:partner:990000003","odoo_partner_id":990000003,"valor":7,"payload":{"fecha_base":"2025-01-01"}},
    {"clave":"_prueba:partner:990000004","odoo_partner_id":990000004,"valor":1,"payload":{"dato_malo":"costo 0"}}
  ]'::jsonb);
  INSERT INTO situacion_reglas (alcance, clave_alcance, accion, motivo) VALUES ('contraparte', 'partner:990000004', 'ignorar', 'prueba');

  -- Calidad.
  r := senales_actualizar();
  ASSERT (SELECT calidad FROM senales WHERE clave = '_prueba:partner:990000002' AND resuelta_en IS NULL) = 'dato_malo', 'RFC relacionado → dato_malo';
  ASSERT (SELECT calidad FROM senales WHERE clave = '_prueba:partner:990000003' AND resuelta_en IS NULL) = 'zombie', 'fecha_base vieja → zombie';
  ASSERT (SELECT calidad FROM senales WHERE clave = '_prueba:partner:990000004' AND resuelta_en IS NULL) = 'ignorada', 'regla del CEO gana a dato_malo';
  ASSERT (SELECT calidad FROM senales WHERE clave = '_prueba:partner:990000001' AND resuelta_en IS NULL) = 'viva', 'viva';
  UPDATE senales SET primera_vista = now() - interval '40 days', valor_cambio_en = now() - interval '40 days' WHERE clave = '_prueba:partner:990000001b';
  r := senales_actualizar();
  ASSERT (SELECT calidad FROM senales WHERE clave = '_prueba:partner:990000001b' AND resuelta_en IS NULL) = 'antigua', 'antigua';

  -- Situaciones: partner 1 (dos señales, una viva y una antigua) = una situación; zombie y dato_malo = higiene; ignorada no aparece.
  r := situacion_guardar(c);
  ASSERT (SELECT count(*) FROM situaciones WHERE senal = '_prueba') = 3, 'tres situaciones de _prueba (partner 1, higiene:zombie, higiene:dato_malo): ' || r::text;
  SELECT * INTO s FROM situaciones WHERE clave = '_prueba|partner:990000001';
  ASSERT s.estado = 'abierta' AND s.n_senales = 2 AND s.valor = 150 AND s.calidad = 'viva' AND s.titulo LIKE 'Prueba · %', 'situación partner 1 (una señal viva basta para que la situación sea viva): ' || row_to_json(s)::text;
  ASSERT jsonb_array_length(s.documentos) = 2 AND (s.evidencia->'senales') @> '["_prueba:partner:990000001"]', 'documentos y evidencia';
  ASSERT (SELECT tipo FROM situaciones WHERE clave = '_prueba|higiene:zombie') = 'higiene', 'higiene zombie';
  ASSERT NOT EXISTS (SELECT 1 FROM situaciones WHERE clave = '_prueba|partner:990000004'), 'ignorada no crea situación';
  ASSERT (r->>'ignoradas')::int >= 1, 'ignoradas contadas';

  -- Empeora: sube el valor → estado empeoro, version 2, historia.
  PERFORM senales_ingestar('_prueba', 'odoo', gen_random_uuid(), '[
    {"clave":"_prueba:partner:990000001","odoo_partner_id":990000001,"valor":300,"documentos":[{"modelo":"account.move","id":11,"nombre":"F/1"}]},
    {"clave":"_prueba:partner:990000001b","odoo_partner_id":990000001,"valor":50,"documentos":[{"modelo":"account.move","id":12,"nombre":"F/2"}]},
    {"clave":"_prueba:partner:990000002","odoo_partner_id":990000002,"valor":5,"payload":{"rfc":"RELA010101AAA"}},
    {"clave":"_prueba:partner:990000003","odoo_partner_id":990000003,"valor":7,"payload":{"fecha_base":"2025-01-01"}}
  ]'::jsonb);
  PERFORM senales_actualizar();
  r := situacion_guardar(gen_random_uuid());
  SELECT * INTO s FROM situaciones WHERE clave = '_prueba|partner:990000001';
  ASSERT s.estado = 'empeoro' AND s.version = 2 AND s.ultimo_cambio LIKE 'empeoró%', 'empeoró: ' || row_to_json(s)::text;
  ASSERT jsonb_array_length(s.historia) = 2, 'historia con dos eventos';
  -- Candidata: nueva/empeorada sin redacción vigente.
  ASSERT EXISTS (SELECT 1 FROM situacion_candidatas(40) WHERE id = s.id), 'es candidata';
  -- Lote sin partner 1 → sus señales se resuelven → situación resuelta, y ya no es candidata.
  PERFORM senales_ingestar('_prueba', 'odoo', gen_random_uuid(), '[{"clave":"_prueba:partner:990000002","odoo_partner_id":990000002,"valor":5,"payload":{"rfc":"RELA010101AAA"}}]'::jsonb);
  PERFORM senales_actualizar();
  r := situacion_guardar(gen_random_uuid());
  SELECT * INTO s FROM situaciones WHERE clave = '_prueba|partner:990000001';
  ASSERT s.estado = 'resuelta' AND s.resuelta_en IS NOT NULL, 'resuelta por evidencia: ' || s.estado;
  ASSERT NOT EXISTS (SELECT 1 FROM situacion_candidatas(40) WHERE id = s.id), 'resuelta no es candidata';
  -- Sin datos: si el último lote bueno de la señal es viejo, sus situaciones no se tocan.
  UPDATE senales_lotes SET recibido_en = now() - interval '5 hours' WHERE senal = '_prueba';
  PERFORM senales_ingestar('_prueba', 'odoo', gen_random_uuid(), '[]'::jsonb);  -- lote vacío pero…
  UPDATE senales_lotes SET ok = false WHERE senal = '_prueba' AND n_claves = 0;  -- …marcado malo: no cuenta
  UPDATE senales SET resuelta_en = NULL WHERE clave = '_prueba:partner:990000002';       -- reabrimos a mano para la prueba
  r := situacion_guardar(gen_random_uuid());
  ASSERT (r->'sin_datos') @> '["_prueba"]', 'señal sin datos reportada: ' || r::text;
  ASSERT (SELECT estado FROM situaciones WHERE clave = '_prueba|higiene:dato_malo') <> 'resuelta', 'sin datos no resuelve';

  -- Ciclo completo y cierre de corrida.
  r := situacion_ciclo(gen_random_uuid(), 'prueba');
  ASSERT (r->>'corrida_id') IS NOT NULL AND (SELECT sql_lista_en IS NOT NULL FROM situacion_corridas WHERE id = (r->>'corrida_id')::bigint), 'ciclo registra corrida';
  PERFORM situacion_corrida_cerrar((r->>'corrida_id')::bigint, '{"n_candidatas":3,"n_redactadas":2,"tokens_in":100,"tokens_out":10,"modelo":"x"}'::jsonb);
  ASSERT (SELECT terminada_en IS NOT NULL AND n_redactadas = 2 FROM situacion_corridas WHERE id = (r->>'corrida_id')::bigint), 'corrida cerrada';
  RAISE EXCEPTION 'PRUEBA_OK';
END $t$;
