-- Prueba en seco de situacion_cambios: nueva, empeorada, resuelta, delegada, grave, rezago, contadores. Termina en PRUEBA_OK.
DO $t$
DECLARE r jsonb; c uuid := gen_random_uuid(); sid bigint; sid2 bigint; sid3 bigint; a jsonb; uid int;
BEGIN
  SELECT odoo_user_id INTO uid FROM odoo_users ORDER BY odoo_user_id LIMIT 1;
  ASSERT uid IS NOT NULL, 'hace falta al menos un odoo_users';
  INSERT INTO senales_config (senal, titulo, area, tipo, fuente, agrupar_por, agregar, severidad_base, severidad_max)
  VALUES ('_prueba', 'Prueba', 'finanzas', 'credito', 'odoo', 'contraparte', 'suma', 4, 5);
  PERFORM senales_ingestar('_prueba', 'odoo', c, '[
    {"clave":"_prueba:partner:990000001","odoo_partner_id":990000001,"valor":100,"documentos":[{"modelo":"account.move","id":11,"nombre":"F/1"}]},
    {"clave":"_prueba:partner:990000002","odoo_partner_id":990000002,"valor":50,"documentos":[{"modelo":"account.move","id":12,"nombre":"F/2"}]},
    {"clave":"_prueba:partner:990000003","odoo_partner_id":990000003,"valor":7,"documentos":[{"modelo":"account.move","id":13,"nombre":"F/3"}]}
  ]'::jsonb);
  PERFORM senales_actualizar(); PERFORM situacion_guardar(c);
  SELECT id INTO sid  FROM situaciones WHERE clave = '_prueba|partner:990000001';
  SELECT id INTO sid2 FROM situaciones WHERE clave = '_prueba|partner:990000002';
  SELECT id INTO sid3 FROM situaciones WHERE clave = '_prueba|partner:990000003';

  -- sid2: delegada (a mano, como lo dejará situacion_decidir en el paso 5). sid3: vieja y sin cambio → rezago; además resuelta hoy.
  UPDATE situaciones SET estado = 'delegada', delegacion = jsonb_build_object('user_id', uid, 'fecha', now(), 'estado', 'creada', 'texto', 'cobrar'),
    historia = historia || jsonb_build_object('fecha', now(), 'evento', 'delegada', 'detalle', 'a Ana') WHERE id = sid2;
  UPDATE situaciones SET desde = current_date - 60, calidad = 'antigua' WHERE id = sid3;
  -- sid nació "ayer": así el empeoro de abajo cuenta como empeorada y no como nueva (una situación sale en una sola lista).
  UPDATE situaciones SET created_at = now() - interval '2 days', desde = current_date - 2 WHERE id = sid;
  -- sid: empeoró en una segunda corrida (más valor).
  PERFORM senales_ingestar('_prueba', 'odoo', c, '[
    {"clave":"_prueba:partner:990000001","odoo_partner_id":990000001,"valor":100,"documentos":[{"modelo":"account.move","id":11,"nombre":"F/1"}]},
    {"clave":"_prueba:partner:990000001b","odoo_partner_id":990000001,"valor":80,"documentos":[{"modelo":"account.move","id":14,"nombre":"F/4"}]},
    {"clave":"_prueba:partner:990000002","odoo_partner_id":990000002,"valor":50,"documentos":[{"modelo":"account.move","id":12,"nombre":"F/2"}]}
  ]'::jsonb);
  PERFORM senales_actualizar(); PERFORM situacion_guardar(c);
  ASSERT (SELECT estado FROM situaciones WHERE id = sid) = 'empeoro', 'sid empeoró';
  ASSERT (SELECT estado FROM situaciones WHERE id = sid2) = 'delegada', 'delegada se conserva cuando no cambia';
  ASSERT (SELECT estado FROM situaciones WHERE id = sid3) = 'resuelta', 'sid3 resuelta por evidencia';

  -- delegada pegajosa: si empeora, sigue delegada y queda en historia.
  PERFORM senales_ingestar('_prueba', 'odoo', c, '[
    {"clave":"_prueba:partner:990000001","odoo_partner_id":990000001,"valor":100,"documentos":[{"modelo":"account.move","id":11,"nombre":"F/1"}]},
    {"clave":"_prueba:partner:990000001b","odoo_partner_id":990000001,"valor":80,"documentos":[{"modelo":"account.move","id":14,"nombre":"F/4"}]},
    {"clave":"_prueba:partner:990000002","odoo_partner_id":990000002,"valor":50,"documentos":[{"modelo":"account.move","id":12,"nombre":"F/2"}]},
    {"clave":"_prueba:partner:990000002b","odoo_partner_id":990000002,"valor":500,"documentos":[{"modelo":"account.move","id":15,"nombre":"F/5"}]}
  ]'::jsonb);
  PERFORM senales_actualizar(); PERFORM situacion_guardar(c);
  ASSERT (SELECT estado FROM situaciones WHERE id = sid2) = 'delegada', 'delegada pegajosa al empeorar';
  ASSERT EXISTS (SELECT 1 FROM jsonb_array_elements((SELECT historia FROM situaciones WHERE id = sid2)) e WHERE e->>'evento' = 'empeoro'), 'historia registra el empeoro de la delegada';

  -- mapa: la delegada muestra a quién y en qué estado.
  -- límite alto: en producción hay ~1,000 situaciones y el mapa ordena por severidad; con el default (100) la fila de prueba puede quedar fuera.
  ASSERT (SELECT delegacion_estado FROM situacion_mapa('finanzas', 'viva', 1, 10000) WHERE id = sid2) = 'creada', 'mapa expone delegacion_estado';
  ASSERT (SELECT delegada_a FROM situacion_mapa('finanzas', 'viva', 1, 10000) WHERE id = sid2) IS NOT NULL, 'mapa expone delegada_a';

  -- cambios de las últimas 24 h.
  r := situacion_cambios(now() - interval '1 day');
  ASSERT r ? 'areas' AND r ? 'rezago' AND r ? 'ignoradas' AND r ? 'higiene' AND r ? 'salud' AND r ? 'totales', 'llaves: ' || (SELECT string_agg(k, ',') FROM jsonb_object_keys(r) k);
  SELECT x INTO a FROM jsonb_array_elements(r->'areas') x WHERE x->>'area' = 'finanzas';
  ASSERT a IS NOT NULL, 'área finanzas presente';
  ASSERT EXISTS (SELECT 1 FROM jsonb_array_elements(a->'empeoradas') e WHERE (e->>'id')::bigint = sid), 'sid en empeoradas: ' || (a->'empeoradas')::text;
  ASSERT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(a->'nuevas') e WHERE (e->>'id')::bigint = sid), 'sid NO en nuevas (nació hace 2 días; una situación sale en una sola lista)';
  ASSERT EXISTS (SELECT 1 FROM jsonb_array_elements(a->'nuevas') e WHERE (e->>'id')::bigint = sid2) OR EXISTS (SELECT 1 FROM jsonb_array_elements(a->'delegadas') e WHERE (e->>'id')::bigint = sid2), 'sid2 sale (delegada hoy)';
  ASSERT EXISTS (SELECT 1 FROM jsonb_array_elements(a->'delegadas') e WHERE (e->>'id')::bigint = sid2), 'sid2 en delegadas';
  ASSERT EXISTS (SELECT 1 FROM jsonb_array_elements(a->'resueltas') e WHERE (e->>'id')::bigint = sid3), 'sid3 en resueltas';
  ASSERT (SELECT count(*) FROM jsonb_array_elements(a->'graves')) >= 0, 'graves es lista';
  ASSERT (r->'totales'->>'empeoradas')::int >= 1 AND (r->'totales'->>'delegadas')::int >= 1, 'totales: ' || (r->'totales')::text;
  -- cada fila trae lo que el correo imprime.
  ASSERT (SELECT e FROM jsonb_array_elements(a->'empeoradas') e WHERE (e->>'id')::bigint = sid) ?& ARRAY['titulo','contraparte','severidad','dias_abierta','responsable','recomendacion','ultimo_cambio','redactada'], 'campos de la fila';
  -- ventana vacía: nada.
  r := situacion_cambios(now() + interval '1 hour');
  ASSERT (r->'totales'->>'nuevas')::int = 0 AND (r->'totales'->>'empeoradas')::int = 0, 'ventana futura vacía';
  RAISE EXCEPTION 'PRUEBA_OK';
END $t$;
