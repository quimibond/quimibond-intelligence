-- Ahorro IA (20260922a): valores negativos estables y freno de 6 h del bot.
DO $t$
DECLARE c uuid := gen_random_uuid(); sid bigint; v int;
  filas jsonb := '[{"clave":"_prueba_neg:1","odoo_partner_id":990000011,"valor":-84111.93,"documentos":[{"modelo":"sale.order","id":1,"nombre":"PV1"}]}]';
BEGIN
  INSERT INTO senales_config (senal, titulo, area, tipo, fuente, agrupar_por, agregar)
  VALUES ('_prueba_neg', 'Prueba', 'comercial', 'riesgo', 'odoo', 'contraparte', 'suma');
  PERFORM senales_ingestar('_prueba_neg', 'odoo', c, filas);
  PERFORM senales_actualizar(); PERFORM situacion_guardar(c);
  SELECT id, version INTO sid, v FROM situaciones WHERE clave = '_prueba_neg|partner:990000011';
  ASSERT sid IS NOT NULL, 'situación creada';

  -- Mismo valor negativo en la corrida siguiente: no es "empeoró" (antes: -84111.93 > -84111.93 * 1.05).
  PERFORM senales_ingestar('_prueba_neg', 'odoo', gen_random_uuid(), filas);
  PERFORM situacion_guardar(gen_random_uuid());
  ASSERT (SELECT version FROM situaciones WHERE id = sid) = v, 'mismo valor negativo no sube versión';

  -- Cambio real (> 5 % de abs): sí sube versión.
  PERFORM senales_ingestar('_prueba_neg', 'odoo', gen_random_uuid(), jsonb_set(filas, '{0,valor}', '-120000'));
  PERFORM situacion_guardar(gen_random_uuid());
  ASSERT (SELECT version FROM situaciones WHERE id = sid) = v + 1, 'cambio de más de 5 % sube versión';

  -- Freno: redactada hace 1 h → no es candidata aunque ia_version < version; hace 7 h → sí.
  UPDATE situaciones SET ia_version = version - 1,
    historia = historia || jsonb_build_object('fecha', now() - interval '1 hour', 'evento', 'redactada', 'detalle', 'x')
  WHERE id = sid;
  ASSERT NOT EXISTS (SELECT 1 FROM situacion_candidatas(100000) WHERE id = sid), 'redactada hace 1 h: fuera';
  UPDATE situaciones SET historia = jsonb_build_array(jsonb_build_object('fecha', now() - interval '7 hours', 'evento', 'redactada', 'detalle', 'x'))
  WHERE id = sid;
  ASSERT EXISTS (SELECT 1 FROM situacion_candidatas(100000) WHERE id = sid), 'redactada hace 7 h: candidata';

  -- Nueva (ia_version = 0): candidata de inmediato.
  UPDATE situaciones SET ia_version = 0, historia = jsonb_build_array(jsonb_build_object('fecha', now(), 'evento', 'redactada', 'detalle', 'x'))
  WHERE id = sid;
  ASSERT EXISTS (SELECT 1 FROM situacion_candidatas(100000) WHERE id = sid), 'nueva: candidata sin freno';

  RAISE EXCEPTION 'PRUEBA_OK';
END $t$;
