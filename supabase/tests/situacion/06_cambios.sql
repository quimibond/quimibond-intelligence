-- Prueba en seco de situacion_cambios: en_mapa, nueva, empeorada, resuelta, delegada pegajosa, grave, conteos por lista,
-- rezago, contadores y cierre humano pegajoso (evidencia.cerrada_manual). Termina en PRUEBA_OK.
DO $t$
DECLARE r jsonb; c uuid := gen_random_uuid(); sid bigint; sid2 bigint; sid3 bigint; sid4 bigint; a jsonb; uid int; sit record;
  -- Partner 4: grave que ni es nueva ni cambia; va en todos los lotes. Partner 3 solo en el primero (se resuelve).
  p4 CONSTANT text := '{"clave":"_prueba:partner:990000004","odoo_partner_id":990000004,"valor":30,"documentos":[{"modelo":"account.move","id":16,"nombre":"F/6"}]}';
  p1 CONSTANT text := '{"clave":"_prueba:partner:990000001","odoo_partner_id":990000001,"valor":100,"documentos":[{"modelo":"account.move","id":11,"nombre":"F/1"}]}';
  p1b CONSTANT text := '{"clave":"_prueba:partner:990000001b","odoo_partner_id":990000001,"valor":80,"documentos":[{"modelo":"account.move","id":14,"nombre":"F/4"}]}';
  p1c CONSTANT text := '{"clave":"_prueba:partner:990000001c","odoo_partner_id":990000001,"valor":40,"documentos":[{"modelo":"account.move","id":17,"nombre":"F/7"}]}';
  p2 CONSTANT text := '{"clave":"_prueba:partner:990000002","odoo_partner_id":990000002,"valor":50,"documentos":[{"modelo":"account.move","id":12,"nombre":"F/2"}]}';
  p2b CONSTANT text := '{"clave":"_prueba:partner:990000002b","odoo_partner_id":990000002,"valor":500,"documentos":[{"modelo":"account.move","id":15,"nombre":"F/5"}]}';
  p3 CONSTANT text := '{"clave":"_prueba:partner:990000003","odoo_partner_id":990000003,"valor":7,"documentos":[{"modelo":"account.move","id":13,"nombre":"F/3"}]}';
BEGIN
  SELECT odoo_user_id INTO uid FROM odoo_users ORDER BY odoo_user_id LIMIT 1;
  ASSERT uid IS NOT NULL, 'hace falta al menos un odoo_users';
  INSERT INTO senales_config (senal, titulo, area, tipo, fuente, agrupar_por, agregar, severidad_base, severidad_max)
  VALUES ('_prueba', 'Prueba', 'finanzas', 'credito', 'odoo', 'contraparte', 'suma', 4, 5);
  PERFORM senales_ingestar('_prueba', 'odoo', c, ('[' || p1 || ',' || p2 || ',' || p3 || ',' || p4 || ']')::jsonb);
  PERFORM senales_actualizar();

  -- en_mapa = false: la señal se ingiere pero no forma situaciones.
  UPDATE senales_config SET en_mapa = false WHERE senal = '_prueba';
  PERFORM situacion_guardar(c);
  ASSERT NOT EXISTS (SELECT 1 FROM situaciones WHERE senal = '_prueba'), 'en_mapa=false no forma situaciones';
  UPDATE senales_config SET en_mapa = true WHERE senal = '_prueba';

  PERFORM situacion_guardar(c);
  SELECT id INTO sid  FROM situaciones WHERE clave = '_prueba|partner:990000001';
  SELECT id INTO sid2 FROM situaciones WHERE clave = '_prueba|partner:990000002';
  SELECT id INTO sid3 FROM situaciones WHERE clave = '_prueba|partner:990000003';
  SELECT id INTO sid4 FROM situaciones WHERE clave = '_prueba|partner:990000004';
  ASSERT sid IS NOT NULL AND sid2 IS NOT NULL AND sid3 IS NOT NULL AND sid4 IS NOT NULL, 'en_mapa=true forma las cuatro situaciones';

  -- sid2: delegada (a mano, como lo dejará situacion_decidir en el paso 5). sid3: vieja y sin cambio → rezago; además resuelta hoy.
  UPDATE situaciones SET estado = 'delegada', delegacion = jsonb_build_object('user_id', uid, 'fecha', now(), 'estado', 'creada', 'texto', 'cobrar'),
    historia = historia || jsonb_build_object('fecha', now(), 'evento', 'delegada', 'detalle', 'a Ana') WHERE id = sid2;
  UPDATE situaciones SET desde = current_date - 60, calidad = 'antigua' WHERE id = sid3;
  -- sid nació "ayer": así el empeoro de abajo cuenta como empeorada y no como nueva (una situación sale en una sola lista).
  UPDATE situaciones SET created_at = now() - interval '2 days', desde = current_date - 2 WHERE id = sid;
  -- sid4 también nació hace 2 días y no cambia: grave y nada más. Severidad 5 (tope de la banda) y 400 días abierta
  -- para que encabece la lista de graves: en producción hay más de 25 graves en finanzas y la lista se recorta a 25.
  UPDATE situaciones SET created_at = now() - interval '2 days', desde = current_date - 400, severidad = 5 WHERE id = sid4;
  -- sid: empeoró en una segunda corrida (más valor).
  PERFORM senales_ingestar('_prueba', 'odoo', c, ('[' || p1 || ',' || p1b || ',' || p2 || ',' || p4 || ']')::jsonb);
  PERFORM senales_actualizar(); PERFORM situacion_guardar(c);
  ASSERT (SELECT estado FROM situaciones WHERE id = sid) = 'empeoro', 'sid empeoró';
  ASSERT (SELECT estado FROM situaciones WHERE id = sid2) = 'delegada', 'delegada se conserva cuando no cambia';
  ASSERT (SELECT estado FROM situaciones WHERE id = sid3) = 'resuelta', 'sid3 resuelta por evidencia';

  -- delegada pegajosa: si empeora, sigue delegada y queda en historia.
  PERFORM senales_ingestar('_prueba', 'odoo', c, ('[' || p1 || ',' || p1b || ',' || p2 || ',' || p2b || ',' || p4 || ']')::jsonb);
  PERFORM senales_actualizar(); PERFORM situacion_guardar(c);
  ASSERT (SELECT estado FROM situaciones WHERE id = sid2) = 'delegada', 'delegada pegajosa al empeorar';
  ASSERT EXISTS (SELECT 1 FROM jsonb_array_elements((SELECT historia FROM situaciones WHERE id = sid2)) e WHERE e->>'evento' = 'empeoro'), 'historia registra el empeoro de la delegada';
  ASSERT (SELECT ultimo_cambio FROM situaciones WHERE id = sid4) LIKE 'creada%', 'sid4 no cambió';

  -- mapa: la delegada muestra a quién y en qué estado.
  -- límite alto: en producción hay ~1,000 situaciones y el mapa ordena por severidad; con el default (100) la fila de prueba puede quedar fuera.
  ASSERT (SELECT delegacion_estado FROM situacion_mapa('finanzas', 'viva', 1, 10000) WHERE id = sid2) = 'creada', 'mapa expone delegacion_estado';
  ASSERT (SELECT delegada_a FROM situacion_mapa('finanzas', 'viva', 1, 10000) WHERE id = sid2) IS NOT NULL, 'mapa expone delegada_a';

  -- cambios de las últimas 24 h.
  r := situacion_cambios(now() - interval '1 day');
  ASSERT r ? 'areas' AND r ? 'rezago' AND r ? 'ignoradas' AND r ? 'higiene' AND r ? 'salud' AND r ? 'totales', 'llaves: ' || (SELECT string_agg(k, ',') FROM jsonb_object_keys(r) k);
  ASSERT r->'salud' ?& ARRAY['odoo_push_edad_h', 'odoo_push_status', 'bot_terminada_en', 'sin_datos'], 'salud: ' || (r->'salud')::text;
  SELECT x INTO a FROM jsonb_array_elements(r->'areas') x WHERE x->>'area' = 'finanzas';
  ASSERT a IS NOT NULL, 'área finanzas presente';
  ASSERT EXISTS (SELECT 1 FROM jsonb_array_elements(a->'empeoradas') e WHERE (e->>'id')::bigint = sid), 'sid en empeoradas: ' || (a->'empeoradas')::text;
  ASSERT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(a->'nuevas') e WHERE (e->>'id')::bigint = sid), 'sid NO en nuevas (nació hace 2 días; una situación sale en una sola lista)';
  ASSERT EXISTS (SELECT 1 FROM jsonb_array_elements(a->'delegadas') e WHERE (e->>'id')::bigint = sid2), 'sid2 en delegadas';
  ASSERT EXISTS (SELECT 1 FROM jsonb_array_elements(a->'resueltas') e WHERE (e->>'id')::bigint = sid3), 'sid3 en resueltas';
  -- grave: severidad ≥ 4, viva, ni nueva ni cambiada → solo en graves.
  ASSERT EXISTS (SELECT 1 FROM jsonb_array_elements(a->'graves') e WHERE (e->>'id')::bigint = sid4), 'sid4 en graves: ' || (a->'graves')::text;
  ASSERT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(a->'nuevas') e WHERE (e->>'id')::bigint = sid4), 'sid4 NO en nuevas';
  -- conteo real al lado de cada lista recortada.
  ASSERT (a->>'n_empeoradas')::int >= jsonb_array_length(a->'empeoradas') AND (a->>'n_empeoradas')::int >= 1, 'n_empeoradas: ' || (a->>'n_empeoradas');
  ASSERT (a->>'n_graves')::int >= jsonb_array_length(a->'graves') AND jsonb_array_length(a->'graves') <= 25, 'n_graves: ' || (a->>'n_graves');
  ASSERT (r->'totales'->>'empeoradas')::int >= 1 AND (r->'totales'->>'delegadas')::int >= 1 AND (r->'totales'->>'graves')::int >= 1, 'totales: ' || (r->'totales')::text;
  -- cada fila trae lo que el correo imprime.
  ASSERT (SELECT e FROM jsonb_array_elements(a->'empeoradas') e WHERE (e->>'id')::bigint = sid) ?& ARRAY['titulo','contraparte','severidad','dias_abierta','responsable','recomendacion','ultimo_cambio','redactada'], 'campos de la fila';
  -- ventana vacía: nada. NULL explícito = default (24 h).
  r := situacion_cambios(now() + interval '1 hour');
  ASSERT (r->'totales'->>'nuevas')::int = 0 AND (r->'totales'->>'empeoradas')::int = 0, 'ventana futura vacía';
  r := situacion_cambios(NULL);
  ASSERT (r->>'desde')::timestamptz BETWEEN now() - interval '25 hours' AND now() - interval '23 hours', 'p_desde NULL usa el default: ' || (r->>'desde');

  -- Cierre humano pegajoso (evidencia.cerrada_manual, como lo dejarán situacion_decidir y la actividad hecha en el paso 5).
  SELECT * INTO sit FROM situaciones WHERE id = sid;
  UPDATE situaciones SET estado = 'resuelta', resuelta_en = now(),
    evidencia = evidencia || jsonb_build_object('cerrada_manual', jsonb_build_object('n', sit.n_senales, 'valor', sit.valor, 'fecha', current_date, 'por', 'prueba'))
  WHERE id = sid;
  -- 1) el mismo lote: sigue resuelta y la marca sigue.
  PERFORM senales_ingestar('_prueba', 'odoo', c, ('[' || p1 || ',' || p1b || ',' || p2 || ',' || p2b || ',' || p4 || ']')::jsonb);
  PERFORM senales_actualizar(); PERFORM situacion_guardar(c);
  SELECT * INTO sit FROM situaciones WHERE id = sid;
  ASSERT sit.estado = 'resuelta' AND sit.evidencia ? 'cerrada_manual' AND sit.resuelta_en IS NOT NULL, 'cierre pegajoso: sigue resuelta con la señal igual: ' || sit.estado;
  -- 2) crece (un documento más, valor > 5 %): reabre como empeoro, marca fuera.
  PERFORM senales_ingestar('_prueba', 'odoo', c, ('[' || p1 || ',' || p1b || ',' || p1c || ',' || p2 || ',' || p2b || ',' || p4 || ']')::jsonb);
  PERFORM senales_actualizar(); PERFORM situacion_guardar(c);
  SELECT * INTO sit FROM situaciones WHERE id = sid;
  ASSERT sit.estado = 'empeoro' AND sit.resuelta_en IS NULL AND NOT (sit.evidencia ? 'cerrada_manual') AND sit.ultimo_cambio LIKE 'reapareció tras cierre manual%',
    'cierre pegajoso: reabre al crecer: ' || sit.estado || ' / ' || sit.ultimo_cambio;
  -- 3) cerrada otra vez y la señal desaparece del todo: la marca caduca.
  UPDATE situaciones SET estado = 'resuelta', resuelta_en = now(),
    evidencia = evidencia || jsonb_build_object('cerrada_manual', jsonb_build_object('n', sit.n_senales, 'valor', sit.valor, 'fecha', current_date, 'por', 'prueba'))
  WHERE id = sid;
  PERFORM senales_ingestar('_prueba', 'odoo', c, ('[' || p2 || ',' || p2b || ',' || p4 || ']')::jsonb);
  PERFORM senales_actualizar(); PERFORM situacion_guardar(c);
  SELECT * INTO sit FROM situaciones WHERE id = sid;
  ASSERT sit.estado = 'resuelta' AND NOT (sit.evidencia ? 'cerrada_manual'), 'cierre pegajoso: la marca caduca al desaparecer la señal: ' || sit.evidencia::text;
  -- 4) vuelve más chica que al cerrar (episodio nuevo): reaparece abierta.
  PERFORM senales_ingestar('_prueba', 'odoo', c, ('[' || replace(p1, '"valor":100', '"valor":5') || ',' || p2 || ',' || p2b || ',' || p4 || ']')::jsonb);
  PERFORM senales_actualizar(); PERFORM situacion_guardar(c);
  SELECT * INTO sit FROM situaciones WHERE id = sid;
  ASSERT sit.estado = 'abierta' AND sit.ultimo_cambio LIKE 'reapareció: %', 'cierre pegajoso: episodio nuevo reaparece abierta: ' || sit.estado || ' / ' || sit.ultimo_cambio;
  RAISE EXCEPTION 'PRUEBA_OK';
END $t$;
