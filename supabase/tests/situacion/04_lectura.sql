DO $t$
DECLARE r jsonb; c uuid := gen_random_uuid(); sid bigint; sid2 bigint; m record;
BEGIN
  INSERT INTO senales_config (senal, titulo, area, tipo, fuente, agrupar_por, agregar) VALUES ('_prueba', 'Prueba', 'finanzas', 'credito', 'odoo', 'contraparte', 'suma');
  PERFORM senales_ingestar('_prueba', 'odoo', c, '[
    {"clave":"_prueba:partner:990000001","odoo_partner_id":990000001,"responsable_odoo_user_id":2,"valor":100,"valor_texto":"cien","documentos":[{"modelo":"account.move","id":11,"nombre":"F/1"}]},
    {"clave":"_prueba:partner:990000001b","odoo_partner_id":990000001,"valor":50,"documentos":[{"modelo":"account.move","id":12,"nombre":"F/2"}]},
    {"clave":"_prueba:partner:990000003","odoo_partner_id":990000003,"valor":7,"payload":{"fecha_base":"2025-01-01"}}
  ]'::jsonb);
  UPDATE senales_config SET reglas_calidad = '{"zombie_dias":90,"limpieza":"borrar"}' WHERE senal = '_prueba';
  PERFORM senales_actualizar(); PERFORM situacion_guardar(c);
  SELECT id INTO sid FROM situaciones WHERE clave = '_prueba|partner:990000001';

  -- mapa: la situación viva sale; la de higiene no (calidad zombie) salvo p_calidad = NULL.
  SELECT * INTO m FROM situacion_mapa('finanzas') WHERE id = sid;
  ASSERT m.id IS NOT NULL AND m.dias_abierta = 0 AND m.calidad = 'viva' AND m.ultimo_cambio LIKE 'creada%', 'mapa: ' || row_to_json(m)::text;
  ASSERT NOT EXISTS (SELECT 1 FROM situacion_mapa('finanzas') WHERE senal = '_prueba' AND calidad = 'zombie'), 'zombie fuera del mapa por defecto';
  ASSERT EXISTS (SELECT 1 FROM situacion_mapa('finanzas', NULL) WHERE senal = '_prueba' AND calidad = 'zombie'), 'p_calidad NULL trae todas';
  ASSERT NOT EXISTS (SELECT 1 FROM situacion_mapa('comercial') WHERE senal = '_prueba'), 'filtro por área';

  -- contexto: señales, documentos, contraparte, hermanas, reglas, historia.
  r := situacion_contexto(sid);
  ASSERT jsonb_array_length(r->'senales') = 2 AND (r->'situacion'->>'clave') = '_prueba|partner:990000001', 'contexto señales: ' || left(r::text, 300);
  ASSERT r ? 'contraparte' AND r ? 'hermanas' AND r ? 'posibles_duplicados' AND r ? 'reglas' AND r ? 'historia' AND r ? 'personas', 'llaves del contexto: ' || (SELECT string_agg(k, ',') FROM jsonb_object_keys(r) k);
  ASSERT (r->'senales'->0) ? 'calidad' AND (r->'senales'->0) ? 'episodio', 'señales con calidad y episodio';

  -- por persona.
  ASSERT EXISTS (SELECT 1 FROM situacion_por_persona(2) WHERE id = sid), 'por persona (responsable de la señal)';

  -- higiene y salud.
  r := situacion_higiene();
  ASSERT EXISTS (SELECT 1 FROM jsonb_array_elements(r->'clases') x WHERE x->>'senal' = '_prueba' AND x->>'calidad' = 'zombie' AND (x->>'n')::int = 1 AND x->>'limpieza' = 'borrar'), 'higiene: ' || r::text;
  r := situacion_salud();
  ASSERT r ? 'senales' AND r ? 'bot' AND r ? 'memoria' AND r ? 'odoo_push', 'salud llaves';
  ASSERT EXISTS (SELECT 1 FROM jsonb_array_elements(r->'senales') x WHERE x->>'senal' = '_prueba' AND (x->>'edad_h')::numeric < 1 AND NOT (x->>'sin_datos')::bool), 'salud señal reciente: ' || (r->'senales')::text;

  -- redactar: escribe solo lo suyo, respeta la banda, sube ia_version, fusiona.
  INSERT INTO situaciones (clave, senal, agrupador, area, tipo, titulo, company_id, odoo_partner_id, severidad, estado)
  VALUES ('_prueba|partner:990000001x', '_prueba', 'partner:990000001x', 'finanzas', 'credito', 'Prueba · duplicada', (SELECT company_id FROM situaciones WHERE id = sid), 990000001, 2, 'abierta') RETURNING id INTO sid2;
  r := situacion_redactar(sid, format('{"titulo":"Cartera de prueba","resumen":"Debe 150.","recomendacion":"Cobrar.","severidad":9,"responsable_sugerido_user_id":2,"responsable_motivo":"dueño","evento_historia":"redactada","duplicados":[{"id":%s,"decision":"fusionar","motivo":"misma cartera"}]}', sid2)::jsonb, 'modelo-x', NULL);
  ASSERT (r->>'ok')::bool AND (r->>'fusiones')::int = 1, 'redactar: ' || r::text;
  SELECT * INTO m FROM situaciones WHERE id = sid;
  ASSERT m.titulo = 'Cartera de prueba' AND m.severidad = 4 AND m.ia_version = m.version AND m.ia_modelo = 'modelo-x' AND m.estado = 'abierta' AND m.clave = '_prueba|partner:990000001', 'redactar escribe solo lo suyo y recorta severidad a la banda: ' || row_to_json(m)::text;
  ASSERT (SELECT fusionada_en FROM situaciones WHERE id = sid2) = sid, 'fusionada_en';
  ASSERT NOT EXISTS (SELECT 1 FROM situacion_mapa('finanzas') WHERE id = sid2), 'la fusionada sale del mapa';
  ASSERT NOT EXISTS (SELECT 1 FROM situacion_candidatas(40) WHERE id = sid), 'ya redactada no es candidata';
  RAISE EXCEPTION 'PRUEBA_OK';
END $t$;
