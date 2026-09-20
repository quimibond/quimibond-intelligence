-- Situación plan A — corrección 2 (safeupdate, ver 20260919g): situacion_guardar
-- tenía `UPDATE _grupos gr SET …` sin WHERE externo (el WHERE de la subconsulta
-- no cuenta). Con eso fallaba situacion_ciclo desde la Edge Function. Mismo
-- cuerpo, con `WHERE true`.

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
      'episodio_max', gr.episodio_max)
  WHERE true;   -- safeupdate (PostgREST) exige WHERE, también en tablas temporales

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

INSERT INTO pipeline_logs (level, phase, message, details)
VALUES ('info', 'migration', 'Situación plan A: situacion_guardar con WHERE explícito en _grupos (safeupdate de PostgREST)',
        jsonb_build_object('migration', '20260919h_situacion_safeupdate_guardar'));
