-- 2026-09-19e — Situación plan A: lectura (spec §7.1) y escritura de la IA (§6.5).
BEGIN;

CREATE OR REPLACE FUNCTION public.situacion_mapa(p_area text DEFAULT NULL, p_calidad text DEFAULT 'viva', p_min_severidad integer DEFAULT 1, p_limit integer DEFAULT 100)
RETURNS TABLE (id bigint, area text, tipo text, senal text, titulo text, severidad smallint, estado text, calidad text,
               contraparte text, responsable text, responsable_user_id integer, dias_abierta integer, dias_sin_cambio integer,
               ultimo_cambio text, n_documentos integer, valor numeric, valor_texto text, vence date, redactada boolean, recomendacion text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT s.id, s.area, s.tipo, s.senal, s.titulo, s.severidad, s.estado, s.calidad,
         coalesce(c.name, situacion_nombre_agrupador(s.agrupador, s.company_id, s.odoo_partner_id, s.documentos)) AS contraparte,
         u.name AS responsable, s.responsable_sugerido_user_id,
         (current_date - s.desde) AS dias_abierta,
         extract(day FROM now() - s.ultimo_cambio_en)::int AS dias_sin_cambio,
         s.ultimo_cambio, jsonb_array_length(s.documentos) AS n_documentos, s.valor, s.valor_texto, s.vence,
         (s.ia_version >= s.version) AS redactada, s.recomendacion
  FROM situaciones s
  LEFT JOIN companies c ON c.id = s.company_id
  LEFT JOIN odoo_users u ON u.odoo_user_id = s.responsable_sugerido_user_id
  WHERE s.estado NOT IN ('resuelta', 'descartada') AND s.fusionada_en IS NULL
    AND (p_area IS NULL OR s.area = p_area)
    AND (p_calidad IS NULL OR s.calidad = p_calidad)
    AND s.severidad >= coalesce(p_min_severidad, 1)
  ORDER BY s.severidad DESC, s.ultimo_cambio_en DESC
  LIMIT greatest(coalesce(p_limit, 100), 1)
$$;
COMMENT ON FUNCTION public.situacion_mapa(text, text, integer, integer) IS 'El mapa (spec §7.1): situaciones abiertas por área, calidad (default viva; NULL = todas) y severidad mínima. Ejemplo MCP: select * from situacion_mapa(''finanzas'').';

CREATE OR REPLACE FUNCTION public.situacion_contexto(p_id bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s situaciones%ROWTYPE; brief jsonb; out jsonb;
BEGIN
  SELECT * INTO s FROM situaciones WHERE id = p_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  brief := CASE WHEN s.company_id IS NOT NULL THEN memoria_brief(p_company_id => s.company_id) ELSE NULL END;
  IF brief IS NOT NULL THEN
    brief := (brief - 'hilos') || jsonb_build_object('hilos', coalesce(jsonb_path_query_array(brief->'hilos', '$[0 to 4]'), '[]'));
  END IF;
  SELECT jsonb_build_object(
    'situacion', jsonb_build_object('id', s.id, 'clave', s.clave, 'senal', s.senal, 'area', s.area, 'tipo', s.tipo, 'titulo', s.titulo,
        'resumen', s.resumen, 'recomendacion', s.recomendacion, 'severidad', s.severidad, 'estado', s.estado, 'calidad', s.calidad,
        'desde', s.desde, 'vence', s.vence, 'dias_abierta', current_date - s.desde, 'dias_sin_cambio', extract(day FROM now() - s.ultimo_cambio_en)::int,
        'ultimo_cambio', s.ultimo_cambio, 'valor', s.valor, 'valor_texto', s.valor_texto, 'n_senales', s.n_senales, 'version', s.version, 'ia_version', s.ia_version,
        'responsable_sugerido_user_id', s.responsable_sugerido_user_id, 'responsable_motivo', s.responsable_motivo, 'delegacion', s.delegacion),
    'senal_config', (SELECT jsonb_build_object('titulo', titulo, 'descripcion', descripcion, 'severidad_base', severidad_base, 'severidad_max', severidad_max, 'umbrales', umbrales) FROM senales_config WHERE senal = s.senal),
    'senales', (SELECT coalesce(jsonb_agg(jsonb_build_object('clave', x.clave, 'episodio', x.episodio, 'calidad', x.calidad, 'calidad_motivo', x.calidad_motivo,
                  'valor', x.valor, 'valor_texto', x.valor_texto, 'vence', x.vence, 'primera_vista', x.primera_vista, 'valor_cambio_en', x.valor_cambio_en,
                  'documentos', x.documentos, 'responsable_odoo_user_id', x.responsable_odoo_user_id, 'payload', x.payload - 'pendientes') ORDER BY x.valor DESC NULLS LAST), '[]')
                FROM senales x WHERE x.resuelta_en IS NULL AND x.clave IN (SELECT jsonb_array_elements_text(s.evidencia->'senales'))),
    'documentos', s.documentos,
    'contraparte', CASE WHEN s.company_id IS NULL THEN NULL ELSE jsonb_build_object(
        'company_id', s.company_id, 'odoo_partner_id', s.odoo_partner_id,
        'empresa', (SELECT jsonb_build_object('name', name, 'rfc', rfc, 'is_customer', is_customer, 'is_supplier', is_supplier, 'domain', domain) FROM companies WHERE id = s.company_id),
        'memoria', brief) END,
    'conversaciones', (SELECT coalesce(jsonb_agg(jsonb_build_object('thread_id', m.thread_id, 'tema', m.tema, 'resumen', m.resumen, 'estado', m.estado, 'esperando_a', m.esperando_a, 'tono', m.tono, 'pendientes', m.pendientes, 'summarized_through', m.summarized_through)), '[]')
                       FROM (SELECT * FROM memoria_thread_summaries WHERE thread_id IN (SELECT (jsonb_array_elements_text(coalesce(s.evidencia->'threads', '[]')))::bigint) ORDER BY summarized_through DESC LIMIT 5) m),
    'hermanas', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'titulo', h.titulo, 'senal', h.senal, 'severidad', h.severidad, 'estado', h.estado, 'dias_abierta', current_date - h.desde) ORDER BY h.severidad DESC), '[]')
                 FROM situaciones h WHERE h.id <> s.id AND h.company_id IS NOT NULL AND h.company_id = s.company_id AND h.estado NOT IN ('resuelta', 'descartada') AND h.fusionada_en IS NULL),
    'posibles_duplicados', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'titulo', h.titulo, 'senal', h.senal, 'similitud', round(similarity(h.titulo, s.titulo)::numeric, 2), 'documentos_comunes', dc.n) ORDER BY dc.n DESC), '[]')
                            FROM situaciones h
                            CROSS JOIN LATERAL (SELECT count(*) AS n FROM jsonb_array_elements(h.documentos) a JOIN jsonb_array_elements(s.documentos) b ON a->>'modelo' = b->>'modelo' AND a->>'id' = b->>'id') dc
                            WHERE h.id <> s.id AND h.estado NOT IN ('resuelta', 'descartada') AND h.fusionada_en IS NULL
                              AND ((h.company_id IS NOT NULL AND h.company_id = s.company_id AND similarity(h.titulo, s.titulo) > 0.3) OR dc.n > 0)),
    'reglas', (SELECT coalesce(jsonb_agg(to_jsonb(r)), '[]') FROM situacion_reglas r
               WHERE (r.vigente_hasta IS NULL OR r.vigente_hasta > now())
                 AND ((r.alcance = 'senal' AND r.clave_alcance = s.senal) OR (r.alcance = 'situacion' AND r.clave_alcance = s.clave)
                   OR (r.alcance = 'contraparte' AND r.clave_alcance IN ('company:' || s.company_id, 'partner:' || s.odoo_partner_id)))),
    'personas', (SELECT coalesce(jsonb_agg(DISTINCT jsonb_build_object('odoo_user_id', u.odoo_user_id, 'name', u.name, 'department', u.department, 'motivo', p.motivo)), '[]')
                 FROM (SELECT x.responsable_odoo_user_id AS uid, 'dueño del documento en Odoo' AS motivo FROM senales x WHERE x.resuelta_en IS NULL AND x.clave IN (SELECT jsonb_array_elements_text(s.evidencia->'senales'))
                       UNION SELECT situacion_user_de_buzon(e.mailbox), 'buzón que más atiende a la empresa (' || e.mailbox || ', ' || e.share || '%)' FROM memoria_encargados e WHERE e.company_id = s.company_id AND e.area IS NULL AND e.rank <= 2) p
                 JOIN odoo_users u ON u.odoo_user_id = p.uid),
    'historia', (SELECT coalesce(jsonb_agg(e ORDER BY i), '[]') FROM (SELECT e, i FROM jsonb_array_elements(s.historia) WITH ORDINALITY t(e, i) ORDER BY i DESC LIMIT 10) q)
  ) INTO out;
  RETURN out;
END $$;
COMMENT ON FUNCTION public.situacion_contexto(bigint) IS 'Todo lo que un bot o el CEO necesita sobre una situación (spec §7.1): señales con calidad y episodio, documentos, ficha de memoria de la empresa, conversaciones ligadas (resúmenes), hermanas, posibles duplicados (trigram + documentos comunes), reglas, personas candidatas, historia.';

CREATE OR REPLACE FUNCTION public.situacion_por_persona(p_odoo_user_id integer)
RETURNS TABLE (id bigint, area text, tipo text, titulo text, severidad smallint, estado text, calidad text, rol text, dias_abierta integer, dias_sin_cambio integer, ultimo_cambio text, recomendacion text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT s.id, s.area, s.tipo, s.titulo, s.severidad, s.estado, s.calidad,
         CASE WHEN (s.delegacion->>'user_id')::int = p_odoo_user_id THEN 'delegada' ELSE 'responsable sugerido' END AS rol,
         current_date - s.desde, extract(day FROM now() - s.ultimo_cambio_en)::int, s.ultimo_cambio, s.recomendacion
  FROM situaciones s
  WHERE s.estado NOT IN ('resuelta', 'descartada') AND s.fusionada_en IS NULL
    AND (s.responsable_sugerido_user_id = p_odoo_user_id OR (s.delegacion->>'user_id')::int = p_odoo_user_id
         OR EXISTS (SELECT 1 FROM senales x WHERE x.resuelta_en IS NULL AND x.responsable_odoo_user_id = p_odoo_user_id AND x.clave IN (SELECT jsonb_array_elements_text(s.evidencia->'senales'))))
  ORDER BY s.severidad DESC, s.ultimo_cambio_en DESC
$$;

CREATE OR REPLACE FUNCTION public.situacion_higiene()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'generado', now(),
    'clases', coalesce((SELECT jsonb_agg(jsonb_build_object('senal', q.senal, 'titulo', c.titulo, 'area', c.area, 'calidad', q.calidad, 'n', q.n, 'valor', q.valor,
                          'motivos', q.motivos, 'ejemplos', q.ejemplos, 'limpieza', c.reglas_calidad->>'limpieza',
                          'situacion_id', (SELECT id FROM situaciones WHERE clave = q.senal || '|higiene:' || q.calidad)) ORDER BY q.n DESC)
      FROM (SELECT s.senal, s.calidad, count(*) AS n, sum(s.valor) AS valor,
                   (SELECT jsonb_agg(m) FROM (SELECT DISTINCT calidad_motivo m FROM senales z WHERE z.senal = s.senal AND z.calidad = s.calidad AND z.resuelta_en IS NULL LIMIT 5) mm) AS motivos,
                   (SELECT jsonb_agg(jsonb_build_object('clave', z.clave, 'valor_texto', z.valor_texto, 'documento', z.documentos->0, 'motivo', z.calidad_motivo))
                      FROM (SELECT * FROM senales z WHERE z.senal = s.senal AND z.calidad = s.calidad AND z.resuelta_en IS NULL ORDER BY z.valor DESC NULLS LAST LIMIT 5) z) AS ejemplos
            FROM senales s WHERE s.resuelta_en IS NULL AND s.calidad IN ('zombie', 'dato_malo') GROUP BY s.senal, s.calidad) q
      JOIN senales_config c ON c.senal = q.senal), '[]'),
    'ignoradas', (SELECT count(*) FROM senales WHERE resuelta_en IS NULL AND calidad = 'ignorada'))
$$;
COMMENT ON FUNCTION public.situacion_higiene() IS 'Zombis y datos malos por señal con conteo, motivos, ejemplos y la limpieza recomendada en Odoo (spec §7.1).';

CREATE OR REPLACE FUNCTION public.situacion_salud()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'generado', now(),
    'senales', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                  'senal', c.senal, 'fuente', c.fuente, 'activa', c.activa, 'cada_horas', c.cada_horas,
                  'ultimo_lote_ok', l.recibido_en, 'edad_h', round(extract(epoch FROM now() - l.recibido_en) / 3600, 1),
                  'sin_datos', l.recibido_en IS NULL OR l.recibido_en < now() - make_interval(hours => coalesce(c.sin_datos_horas, 2 * c.cada_horas)),
                  'n_abiertas', (SELECT count(*) FROM senales s WHERE s.senal = c.senal AND s.resuelta_en IS NULL),
                  'ultimo_error', (SELECT jsonb_build_object('en', e.recibido_en, 'error', e.error) FROM senales_lotes e WHERE e.senal = c.senal AND NOT e.ok ORDER BY e.recibido_en DESC LIMIT 1)
                ) ORDER BY c.fuente, c.senal), '[]')
                FROM senales_config c
                LEFT JOIN LATERAL (SELECT recibido_en FROM senales_lotes x WHERE x.senal = c.senal AND x.ok ORDER BY recibido_en DESC LIMIT 1) l ON true
                WHERE c.activa),
    'bot', (SELECT to_jsonb(r) FROM (SELECT id, corrida, origen, iniciada_en, sql_lista_en, terminada_en, n_senales, n_candidatas, n_nuevas, n_actualizadas, n_resueltas, n_redactadas, n_fusiones, n_ignoradas, tokens_in, tokens_out, modelo, errores FROM situacion_corridas ORDER BY iniciada_en DESC LIMIT 1) r),
    'memoria', (SELECT coalesce(jsonb_agg(to_jsonb(h)), '[]') FROM memoria_cron_health() h WHERE h.jobname IN ('memoria_consolidar', 'memoria_sync_emails', 'memoria_ligas')),
    'odoo_push', (SELECT to_jsonb(r) FROM (SELECT method, status, created_at, round(extract(epoch FROM now() - created_at) / 3600, 1) AS edad_h FROM odoo_push_last_events WHERE method IN ('contacts', 'senales') ORDER BY created_at DESC LIMIT 1) r),
    'sgi_fuentes_apagadas', (SELECT count(*) FROM senales WHERE senal = 'fuente_sgi_apagada' AND resuelta_en IS NULL),
    'situaciones', (SELECT jsonb_object_agg(estado, n) FROM (SELECT estado, count(*) AS n FROM situaciones WHERE fusionada_en IS NULL GROUP BY estado) z))
$$;
COMMENT ON FUNCTION public.situacion_salud() IS 'Edad del último lote bueno por señal (sin_datos), última corrida del bot, salud de la memoria, último push de Odoo, fuentes SGI apagadas (spec §7.1).';

-- La IA escribe SOLO esto (spec §6.5). Severidad recortada a la banda; estado, clave, documentos y evidencia nunca se tocan.
CREATE OR REPLACE FUNCTION public.situacion_redactar(p_id bigint, p jsonb, p_modelo text DEFAULT NULL, p_corrida_id bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s situaciones%ROWTYPE; cfg record; v_sev int; d jsonb; n_fus int := 0; v_user int; v_evento text;
BEGIN
  SELECT * INTO s FROM situaciones WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'situación % no existe', p_id; END IF;
  SELECT * INTO cfg FROM senales_config WHERE senal = s.senal;
  v_sev := least(greatest(coalesce((p->>'severidad')::int, s.severidad), cfg.severidad_base), cfg.severidad_max);
  v_user := (p->>'responsable_sugerido_user_id')::int;
  IF v_user IS NOT NULL AND NOT EXISTS (SELECT 1 FROM odoo_users WHERE odoo_user_id = v_user) THEN v_user := NULL; END IF;
  v_evento := coalesce(nullif(p->>'evento_historia', ''), 'redactada');

  -- Fusiones: solo hermanas abiertas de la misma contraparte (o sin contraparte ambas), nunca la propia.
  FOR d IN SELECT * FROM jsonb_array_elements(coalesce(p->'duplicados', '[]'::jsonb)) LOOP
    IF d->>'decision' = 'fusionar' AND (d->>'id')::bigint <> p_id THEN
      UPDATE situaciones h SET fusionada_en = p_id, updated_at = now(),
        historia = h.historia || jsonb_build_object('fecha', now(), 'evento', 'fusionada', 'detalle', 'en #' || p_id || ': ' || coalesce(d->>'motivo', ''), 'corrida', p_corrida_id)
      WHERE h.id = (d->>'id')::bigint AND h.fusionada_en IS NULL AND h.estado NOT IN ('resuelta', 'descartada')
        AND h.company_id IS NOT DISTINCT FROM s.company_id;
      IF FOUND THEN
        n_fus := n_fus + 1;
        UPDATE situaciones SET
          documentos = (SELECT coalesce(jsonb_agg(x), '[]') FROM (SELECT DISTINCT x FROM jsonb_array_elements(s.documentos || (SELECT documentos FROM situaciones WHERE id = (d->>'id')::bigint)) x LIMIT 60) q),
          evidencia = s.evidencia || jsonb_build_object('fusionadas', coalesce(s.evidencia->'fusionadas', '[]'::jsonb) || to_jsonb((d->>'id')::bigint)),
          historia = historia || jsonb_build_object('fecha', now(), 'evento', 'fusion', 'detalle', 'absorbe #' || (d->>'id') || ': ' || coalesce(d->>'motivo', ''), 'corrida', p_corrida_id)
        WHERE id = p_id;
        SELECT * INTO s FROM situaciones WHERE id = p_id;
      END IF;
    END IF;
  END LOOP;

  UPDATE situaciones SET
    titulo = coalesce(nullif(left(p->>'titulo', 160), ''), titulo),
    resumen = coalesce(nullif(p->>'resumen', ''), resumen),
    recomendacion = coalesce(nullif(p->>'recomendacion', ''), recomendacion),
    severidad = v_sev,
    responsable_sugerido_user_id = coalesce(v_user, responsable_sugerido_user_id),
    responsable_motivo = coalesce(nullif(p->>'responsable_motivo', ''), responsable_motivo),
    ultimo_cambio = CASE WHEN v_evento <> 'redactada' THEN left(v_evento, 300) ELSE ultimo_cambio END,
    historia = historia || jsonb_build_object('fecha', now(), 'evento', 'redactada', 'detalle', left(v_evento, 300), 'modelo', p_modelo, 'corrida', p_corrida_id),
    ia_version = version, ia_modelo = p_modelo, updated_at = now()
  WHERE id = p_id;
  RETURN jsonb_build_object('ok', true, 'id', p_id, 'severidad', v_sev, 'fusiones', n_fus, 'ia_version', s.version);
END $$;
REVOKE ALL ON FUNCTION public.situacion_redactar(bigint, jsonb, text, bigint) FROM public, anon, authenticated;
COMMENT ON FUNCTION public.situacion_redactar(bigint, jsonb, text, bigint) IS 'Escribe lo que devuelve Claude (spec §6.5): titulo, resumen, recomendacion, severidad (recortada a [severidad_base, severidad_max]), responsable sugerido + motivo, fusiones (duplicados[].decision=fusionar) y el evento de historia. Nunca clave, documentos, evidencia ni estado.';

COMMIT;
