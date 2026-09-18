-- 2026-09-19d — Situación plan A: calidad (§5), situaciones determinísticas (§6.2) y ciclo.
BEGIN;

-- Orden de "peor calidad" para agregar en la situación.
CREATE OR REPLACE FUNCTION public.situacion_calidad_rango(p text)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p WHEN 'viva' THEN 0 WHEN 'antigua' THEN 1 WHEN 'vencida_memoria' THEN 2 WHEN 'zombie' THEN 3 WHEN 'dato_malo' THEN 4 WHEN 'ignorada' THEN 5 ELSE 0 END
$$;

-- ¿Hay una regla del CEO vigente que cubra esta señal? (alcance senal / contraparte / documento / situacion)
CREATE OR REPLACE FUNCTION public.situacion_regla_aplica(p_accion text[], p_senal text, p_agrupador text, p_company_id bigint, p_partner integer, p_documentos jsonb)
RETURNS text LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT 'regla #' || r.id || ' (' || r.alcance || ' ' || r.clave_alcance || '): ' || coalesce(r.motivo, r.accion)
  FROM situacion_reglas r
  WHERE r.accion = ANY (p_accion) AND (r.vigente_hasta IS NULL OR r.vigente_hasta > now())
    AND ((r.alcance = 'senal' AND r.clave_alcance = p_senal)
      OR (r.alcance = 'contraparte' AND r.clave_alcance IN ('company:' || p_company_id, 'partner:' || p_partner))
      OR (r.alcance = 'situacion' AND r.clave_alcance = p_senal || '|' || p_agrupador)
      OR (r.alcance = 'documento' AND EXISTS (
            SELECT 1 FROM jsonb_array_elements(p_documentos) d
            WHERE (d->>'modelo') || ':' || (d->>'id') = r.clave_alcance)))
  ORDER BY r.creada_en DESC LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.senales_actualizar()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE out jsonb;
BEGIN
  -- Un CTE calcula cada condición una sola vez; los dos CASE (etiqueta y motivo) usan las mismas banderas.
  WITH base AS (
    SELECT s.id, s.fuente, s.vence, s.primera_vista, s.valor_cambio_en, s.payload,
      situacion_regla_aplica(ARRAY['ignorar','no_es_problema'], s.senal, s.agrupador, s.company_id, s.odoo_partner_id, s.documentos) AS regla,
      coalesce(s.payload->>'rfc', comp.rfc) AS rfc,
      (c.umbrales ? 'rfc_relacionados') AND (c.umbrales->'rfc_relacionados') ? coalesce(s.payload->>'rfc', comp.rfc, '') AS rfc_relacionado,
      coalesce((c.reglas_calidad->>'antigua_dias')::int, 30) AS antigua_dias,
      (c.reglas_calidad->>'zombie_dias')::int AS zombie_dias,
      coalesce((c.reglas_calidad->>'vencida_dias')::int, 21) AS vencida_dias,
      situacion_fecha(s.payload->>'fecha_base') AS fecha_base,
      coalesce(nullif(s.payload->>'ultimo_correo', '')::timestamptz, s.primera_vista) AS ultimo_correo
    FROM senales s
    JOIN senales_config c ON c.senal = s.senal
    LEFT JOIN companies comp ON comp.id = s.company_id
    WHERE s.resuelta_en IS NULL
  ), calc AS (
    SELECT id, regla, rfc, vence, antigua_dias, zombie_dias, vencida_dias, fecha_base,
      regla IS NOT NULL                                                                              AS es_ignorada,
      coalesce(payload->>'dato_malo', '') <> ''                                                      AS es_dato_malo_fuente,
      rfc_relacionado                                                                                AS es_relacionada,
      zombie_dias IS NOT NULL AND fecha_base IS NOT NULL AND fecha_base < current_date - zombie_dias AS es_zombie,
      fuente = 'memoria' AND vence IS NOT NULL AND vence < current_date
        AND ultimo_correo < now() - make_interval(days => vencida_dias)                              AS es_vencida,
      primera_vista < now() - make_interval(days => antigua_dias)
        AND valor_cambio_en < now() - make_interval(days => antigua_dias)
        AND ultimo_correo < now() - make_interval(days => antigua_dias)                              AS es_antigua,
      payload->>'dato_malo'                                                                          AS dato_malo_fuente
    FROM base
  ), etiqueta AS (
    SELECT id,
      CASE WHEN es_ignorada THEN 'ignorada' WHEN es_dato_malo_fuente OR es_relacionada THEN 'dato_malo'
           WHEN es_zombie THEN 'zombie' WHEN es_vencida THEN 'vencida_memoria' WHEN es_antigua THEN 'antigua' ELSE 'viva' END AS calidad,
      CASE WHEN es_ignorada THEN regla
           WHEN es_dato_malo_fuente THEN dato_malo_fuente
           WHEN es_relacionada THEN 'parte relacionada (RFC ' || rfc || ')'
           WHEN es_zombie THEN 'fecha base ' || fecha_base || ' (> ' || zombie_dias || ' días)'
           WHEN es_vencida THEN 'venció el ' || vence || ' sin correo nuevo en ' || vencida_dias || ' días'
           WHEN es_antigua THEN 'sin cambio de valor ni correo en ' || antigua_dias || ' días'
           ELSE NULL END AS motivo
    FROM calc
  )
  UPDATE senales s SET calidad = e.calidad, calidad_motivo = e.motivo
  FROM etiqueta e
  WHERE s.id = e.id AND (s.calidad IS DISTINCT FROM e.calidad OR s.calidad_motivo IS DISTINCT FROM e.motivo);

  SELECT coalesce(jsonb_object_agg(calidad, n), '{}'::jsonb) INTO out
  FROM (SELECT calidad, count(*) AS n FROM senales WHERE resuelta_en IS NULL GROUP BY calidad) z;
  RETURN out;
END $$;
REVOKE ALL ON FUNCTION public.senales_actualizar() FROM public, anon, authenticated;
COMMENT ON FUNCTION public.senales_actualizar() IS 'Recalcula calidad y calidad_motivo de las señales abiertas (spec §5.2): ignorada > dato_malo > zombie > vencida_memoria > antigua > viva. Devuelve conteo por calidad.';

-- Nombre legible del agrupador para el título provisional.
CREATE OR REPLACE FUNCTION public.situacion_nombre_agrupador(p_agrupador text, p_company_id bigint, p_partner integer, p_documentos jsonb)
RETURNS text LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN p_agrupador LIKE 'higiene:%' THEN CASE split_part(p_agrupador, ':', 2) WHEN 'zombie' THEN 'zombis' ELSE 'datos malos' END
    WHEN p_agrupador LIKE 'company:%' OR p_agrupador LIKE 'partner:%' THEN
      coalesce((SELECT name FROM companies WHERE id = p_company_id), (SELECT name FROM companies WHERE odoo_partner_id = p_partner ORDER BY id LIMIT 1), 'contraparte ' || p_agrupador)
    WHEN p_agrupador LIKE 'user:%' THEN coalesce((SELECT name FROM odoo_users WHERE odoo_user_id = split_part(p_agrupador, ':', 2)::int LIMIT 1), 'sin responsable')
    WHEN p_agrupador LIKE 'doc:%' THEN coalesce(p_documentos->0->>'nombre', p_agrupador)
    WHEN p_agrupador LIKE 'grupo:%' THEN substr(p_agrupador, 7)
    WHEN p_agrupador LIKE 'situacion:%' THEN 'situación #' || substr(p_agrupador, 11)
    ELSE 'general' END
$$;

CREATE OR REPLACE FUNCTION public.situacion_guardar(p_corrida uuid DEFAULT gen_random_uuid())
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  -- La variable se llama `sit` (no `s`): plpgsql resolvería `s.senal` de los SELECT como la variable y no como el alias de tabla.
  g record; sit record; n_nuevas int := 0; n_act int := 0; n_res int := 0; n_ign int := 0; n_sin int := 0;
  v_estado text; v_cambio text; v_evento jsonb; v_sin_datos text[];
BEGIN
  -- Señales cuyo último lote bueno es más viejo que sin_datos_horas: no se tocan sus situaciones.
  SELECT coalesce(array_agg(c.senal), '{}') INTO v_sin_datos
  FROM senales_config c
  WHERE c.activa AND EXISTS (SELECT 1 FROM senales s WHERE s.senal = c.senal AND s.resuelta_en IS NULL)
    AND NOT EXISTS (SELECT 1 FROM senales_lotes l WHERE l.senal = c.senal AND l.ok
                    AND l.recibido_en > now() - make_interval(hours => coalesce(c.sin_datos_horas, 2 * c.cada_horas)));
  n_sin := coalesce(array_length(v_sin_datos, 1), 0);
  SELECT count(*) INTO n_ign FROM senales WHERE resuelta_en IS NULL AND calidad = 'ignorada';

  DROP TABLE IF EXISTS _grupos;
  CREATE TEMP TABLE _grupos AS
  SELECT s.senal, c.area, c.tipo, c.titulo AS titulo_senal, c.severidad_base,
         CASE WHEN s.calidad IN ('zombie', 'dato_malo') THEN 'higiene:' || s.calidad ELSE s.agrupador END AS agrupador,
         count(*) AS n,
         CASE c.agregar WHEN 'cuenta' THEN count(*)::numeric WHEN 'maximo' THEN max(s.valor) ELSE coalesce(sum(s.valor), count(*)::numeric) END AS valor,
         min(s.primera_vista)::date AS desde, min(s.vence) AS vence, max(s.vista_en) AS vista_en,
         mode() WITHIN GROUP (ORDER BY s.company_id) AS company_id,
         mode() WITHIN GROUP (ORDER BY s.odoo_partner_id) AS odoo_partner_id,
         mode() WITHIN GROUP (ORDER BY s.responsable_odoo_user_id) AS responsable,
         -- Calidad de la situación: la MEJOR de sus señales (zombis y datos malos ya se apartaron en higiene;
         -- entre viva/antigua/vencida_memoria, una señal viva basta para que la situación se razone).
         (array_agg(s.calidad ORDER BY situacion_calidad_rango(s.calidad)))[1] AS calidad,
         jsonb_path_query_array(jsonb_agg(s.documentos), '$[*][*]') AS docs_flat,   -- todos los documentos, aplanados
         NULL::jsonb AS documentos, NULL::jsonb AS evidencia,
         jsonb_agg(s.clave ORDER BY s.clave) AS claves, max(s.episodio) AS episodio_max,
         string_agg(DISTINCT s.valor_texto, '; ') FILTER (WHERE s.valor_texto IS NOT NULL) AS valor_texto
  FROM senales s JOIN senales_config c ON c.senal = s.senal
  WHERE s.resuelta_en IS NULL AND s.calidad <> 'ignorada' AND NOT (s.senal = ANY (v_sin_datos))
  GROUP BY s.senal, c.area, c.tipo, c.titulo, c.severidad_base, c.agregar,
           CASE WHEN s.calidad IN ('zombie', 'dato_malo') THEN 'higiene:' || s.calidad ELSE s.agrupador END;
  -- Segundo paso (los agregados no pueden ir dentro de subconsultas): primeros 40 documentos y evidencia.
  UPDATE _grupos gr SET   -- alias gr: `g` es la variable del loop de abajo
    documentos = (SELECT coalesce(jsonb_agg(d), '[]') FROM (SELECT d FROM jsonb_array_elements(gr.docs_flat) d LIMIT 40) q),
    evidencia = jsonb_build_object(
      'senales', gr.claves,
      'threads', coalesce((SELECT jsonb_agg(DISTINCT (d->>'id')::bigint) FROM jsonb_array_elements(gr.docs_flat) d WHERE d->>'modelo' = 'thread'), '[]'::jsonb),
      'episodio_max', gr.episodio_max);

  FOR g IN SELECT * FROM _grupos LOOP
    SELECT * INTO sit FROM situaciones WHERE clave = g.senal || '|' || g.agrupador;
    IF NOT FOUND THEN
      INSERT INTO situaciones (clave, senal, agrupador, area, tipo, titulo, company_id, odoo_partner_id, documentos, evidencia,
                               responsable_sugerido_user_id, severidad, desde, vence, estado, calidad, n_senales, valor, valor_texto,
                               ultimo_cambio, historia)
      VALUES (g.senal || '|' || g.agrupador, g.senal, g.agrupador, g.area,
              CASE WHEN g.agrupador LIKE 'higiene:%' THEN 'higiene' ELSE g.tipo END,
              g.titulo_senal || ' · ' || situacion_nombre_agrupador(g.agrupador, g.company_id, g.odoo_partner_id, g.documentos),
              g.company_id, g.odoo_partner_id, g.documentos, g.evidencia, g.responsable, g.severidad_base, g.desde, g.vence,
              'abierta', g.calidad, g.n, g.valor, left(g.valor_texto, 600),
              'creada: ' || g.n || ' señal(es)',
              jsonb_build_array(jsonb_build_object('fecha', now(), 'evento', 'creada', 'detalle', g.n || ' señal(es), valor ' || coalesce(g.valor::text, '-'), 'corrida', p_corrida)));
      n_nuevas := n_nuevas + 1;
    ELSE
      v_estado := NULL; v_cambio := NULL;
      IF sit.estado IN ('resuelta', 'descartada') THEN
        IF sit.estado = 'descartada' THEN CONTINUE; END IF;  -- el CEO la descartó: no reabrir (una regla la esconde; aquí solo se respeta)
        v_estado := 'abierta'; v_cambio := 'reapareció: ' || g.n || ' señal(es), valor ' || coalesce(g.valor::text, '-');
      ELSIF g.n > sit.n_senales OR (g.valor IS NOT NULL AND sit.valor IS NOT NULL AND g.valor > sit.valor * 1.05) THEN
        v_estado := 'empeoro'; v_cambio := format('empeoró: %s → %s documentos, valor %s → %s', sit.n_senales, g.n, coalesce(sit.valor::text, '-'), coalesce(g.valor::text, '-'));
      ELSIF g.n < sit.n_senales OR (g.valor IS NOT NULL AND sit.valor IS NOT NULL AND g.valor < sit.valor * 0.95) THEN
        v_estado := 'mejoro'; v_cambio := format('mejoró: %s → %s documentos, valor %s → %s', sit.n_senales, g.n, coalesce(sit.valor::text, '-'), coalesce(g.valor::text, '-'));
      END IF;
      UPDATE situaciones SET
        documentos = g.documentos, evidencia = sit.evidencia || g.evidencia, calidad = g.calidad, n_senales = g.n, valor = g.valor,
        valor_texto = left(g.valor_texto, 600), vence = g.vence, company_id = coalesce(g.company_id, sit.company_id),
        odoo_partner_id = coalesce(g.odoo_partner_id, sit.odoo_partner_id),
        responsable_sugerido_user_id = coalesce(sit.responsable_sugerido_user_id, g.responsable),
        estado = coalesce(v_estado, CASE WHEN sit.estado = 'delegada' THEN 'delegada' ELSE sit.estado END),
        resuelta_en = CASE WHEN v_estado = 'abierta' THEN NULL ELSE sit.resuelta_en END,
        version = CASE WHEN v_estado IS NOT NULL THEN sit.version + 1 ELSE sit.version END,
        ultimo_cambio = coalesce(v_cambio, sit.ultimo_cambio),
        ultimo_cambio_en = CASE WHEN v_estado IS NOT NULL THEN now() ELSE sit.ultimo_cambio_en END,
        historia = CASE WHEN v_estado IS NOT NULL THEN sit.historia || jsonb_build_object('fecha', now(), 'evento', v_estado, 'detalle', v_cambio, 'corrida', p_corrida) ELSE sit.historia END,
        updated_at = now()
      WHERE id = sit.id;
      IF v_estado IS NOT NULL THEN n_act := n_act + 1; END IF;
    END IF;
  END LOOP;

  -- Abiertas cuyo grupo desapareció (y cuya señal sí tuvo lote bueno): resueltas por evidencia.
  UPDATE situaciones s SET
    estado = 'resuelta', resuelta_en = now(), version = s.version + 1,
    ultimo_cambio = 'resuelta por evidencia: la señal ' || s.senal || ' desapareció', ultimo_cambio_en = now(),
    historia = s.historia || jsonb_build_object('fecha', now(), 'evento', 'resuelta', 'detalle', 'por evidencia: ' || s.senal || ' desapareció', 'corrida', p_corrida),
    updated_at = now()
  WHERE s.estado NOT IN ('resuelta', 'descartada')
    AND NOT (s.senal = ANY (v_sin_datos))
    AND NOT EXISTS (SELECT 1 FROM _grupos gr WHERE gr.senal || '|' || gr.agrupador = s.clave);  -- alias gr: `g` es la variable del loop
  GET DIAGNOSTICS n_res = ROW_COUNT;
  DROP TABLE IF EXISTS _grupos;

  RETURN jsonb_build_object('nuevas', n_nuevas, 'actualizadas', n_act, 'resueltas', n_res, 'ignoradas', n_ign,
                            'sin_datos', to_jsonb(v_sin_datos), 'corrida', p_corrida);
END $$;
REVOKE ALL ON FUNCTION public.situacion_guardar(uuid) FROM public, anon, authenticated;
COMMENT ON FUNCTION public.situacion_guardar(uuid) IS 'Agrupa señales abiertas por senal|agrupador (zombis y datos malos → higiene:<calidad>) y crea/actualiza/resuelve situaciones sin IA (spec §6.2). Señales sin lote bueno reciente (sin_datos) no se tocan.';

-- Candidatas a redacción: nuevas/empeoradas/mejoradas sin redacción vigente, vivas, no de higiene.
CREATE OR REPLACE FUNCTION public.situacion_candidatas(p_limit integer DEFAULT 40)
RETURNS TABLE (id bigint, clave text, titulo text, estado text, version integer, ia_version integer, severidad smallint, calidad text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT id, clave, titulo, estado, version, ia_version, severidad, calidad
  FROM situaciones
  WHERE estado IN ('abierta', 'empeoro', 'mejoro') AND fusionada_en IS NULL AND calidad = 'viva' AND tipo <> 'higiene'
    AND ia_version < version
  ORDER BY (ia_version = 0) DESC, severidad DESC, ultimo_cambio_en DESC
  LIMIT greatest(p_limit, 1)
$$;
REVOKE ALL ON FUNCTION public.situacion_candidatas(integer) FROM public, anon, authenticated;

-- Ciclo SQL completo (lo llama el bot al arrancar y también sirve a mano): memoria → calidad → situaciones.
CREATE OR REPLACE FUNCTION public.situacion_ciclo(p_corrida uuid DEFAULT gen_random_uuid(), p_origen text DEFAULT 'manual')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id bigint; r_mem jsonb; r_cal jsonb; r_sit jsonb; n_sen int;
BEGIN
  INSERT INTO situacion_corridas (corrida, origen) VALUES (p_corrida, p_origen) RETURNING id INTO v_id;
  r_mem := senales_memoria(p_corrida);
  r_cal := senales_actualizar();
  r_sit := situacion_guardar(p_corrida);
  SELECT count(*) INTO n_sen FROM senales WHERE resuelta_en IS NULL;
  UPDATE situacion_corridas SET sql_lista_en = now(), n_senales = n_sen,
    n_nuevas = (r_sit->>'nuevas')::int, n_actualizadas = (r_sit->>'actualizadas')::int, n_resueltas = (r_sit->>'resueltas')::int,
    n_ignoradas = (r_sit->>'ignoradas')::int,
    detalle = jsonb_build_object('memoria', r_mem, 'calidad', r_cal, 'situaciones', r_sit)
  WHERE id = v_id;
  RETURN jsonb_build_object('corrida_id', v_id, 'corrida', p_corrida, 'senales', n_sen, 'calidad', r_cal, 'situaciones', r_sit);
END $$;
REVOKE ALL ON FUNCTION public.situacion_ciclo(uuid, text) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.situacion_corrida_cerrar(p_id bigint, p jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE situacion_corridas SET terminada_en = now(),
    n_candidatas = coalesce((p->>'n_candidatas')::int, n_candidatas), n_redactadas = coalesce((p->>'n_redactadas')::int, n_redactadas),
    n_fusiones = coalesce((p->>'n_fusiones')::int, n_fusiones), tokens_in = coalesce((p->>'tokens_in')::int, tokens_in),
    tokens_out = coalesce((p->>'tokens_out')::int, tokens_out), modelo = coalesce(p->>'modelo', modelo),
    errores = coalesce(p->'errores', errores)
  WHERE id = p_id
$$;
REVOKE ALL ON FUNCTION public.situacion_corrida_cerrar(bigint, jsonb) FROM public, anon, authenticated;

COMMIT;
