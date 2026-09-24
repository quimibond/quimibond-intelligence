-- 2026-09-24a — Situación plan B, paso 4: situacion_cambios (spec §7.1), delegada pegajosa y cierre
-- humano pegajoso en situacion_guardar, delegación visible en situacion_mapa, senales_config.en_mapa,
-- tabla situacion_digests.
--
-- El cuerpo de situacion_guardar es el de 20260922a_ahorro_ia_situaciones.sql (tolerancia ±5 % sobre
-- abs(valor)) más los cambios del plan B: filtro en_mapa, 'delegada' se conserva al empeorar/mejorar,
-- evidencia.cerrada_manual (hecha por el delegado o resuelta por el director) mantiene la situación
-- resuelta mientras la señal no crezca, y la marca caduca cuando la señal desaparece del todo.
BEGIN;

-- 1. senales_config.en_mapa: señales que informan pero no forman situaciones (delegacion_estado, paso 5).
ALTER TABLE public.senales_config ADD COLUMN IF NOT EXISTS en_mapa boolean NOT NULL DEFAULT true;
UPDATE public.senales_config SET en_mapa = false WHERE senal = 'delegacion_estado';
COMMENT ON COLUMN public.senales_config.en_mapa IS 'false: la señal se ingiere y se ve en situacion_salud pero no agrupa situaciones (delegacion_estado se refleja en la situación delegada).';

-- 2. situacion_guardar: una situación delegada sigue delegada aunque empeore o mejore (la actividad vive en Odoo);
--    el cambio queda en historia y en ultimo_cambio. Un cierre humano (evidencia.cerrada_manual = {n, valor, fecha, por},
--    lo deja situacion_decidir / la actividad hecha en el paso 5) es pegajoso mientras la señal no crezca.
--    (Cuerpo = 20260922a con estos cambios marcados "plan B".)
CREATE OR REPLACE FUNCTION public.situacion_guardar(p_corrida uuid DEFAULT gen_random_uuid())
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  -- La variable se llama `sit` (no `s`): plpgsql resolvería `s.senal` de los SELECT como la variable y no como el alias de tabla.
  g record; sit record; n_nuevas int := 0; n_act int := 0; n_res int := 0; n_ign int := 0; n_sin int := 0;
  v_estado text; v_cambio text; v_evento jsonb; v_sin_datos text[]; v_cerrado_n int; v_cerrado numeric;
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
    AND coalesce(c.en_mapa, true)                                   -- plan B: delegacion_estado no forma situaciones
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
        -- plan B: un cierre humano (hecha por el delegado, o resuelta por el director) es pegajoso mientras la señal
        -- no crezca (evidencia.cerrada_manual guarda n y valor al cerrar). Si crece (más señales o valor > +5 % de
        -- abs, misma tolerancia que empeoró), reabre como 'empeoro' y la marca se quita.
        IF sit.evidencia ? 'cerrada_manual' THEN
          v_cerrado_n := coalesce((sit.evidencia->'cerrada_manual'->>'n')::int, 0);
          v_cerrado := (sit.evidencia->'cerrada_manual'->>'valor')::numeric;
          IF NOT (g.n > v_cerrado_n
                  OR (g.valor IS NOT NULL AND v_cerrado IS NOT NULL AND g.valor > v_cerrado + abs(v_cerrado) * 0.05)) THEN
            CONTINUE;
          END IF;
          v_estado := 'empeoro';
          v_cambio := format('reapareció tras cierre manual: empeoró %s → %s documentos, valor %s → %s',
                             v_cerrado_n, g.n, coalesce(v_cerrado::text, '-'), coalesce(g.valor::text, '-'));
        ELSE
          v_estado := 'abierta'; v_cambio := 'reapareció: ' || g.n || ' señal(es), valor ' || coalesce(g.valor::text, '-');
        END IF;
      -- Tolerancia de ±5 % sobre abs(valor): con valores negativos (margen) `valor * 1.05` es MENOR que valor y
      -- el mismo número contaba como "empeoró" en cada corrida (−84,111 > −88,317).
      ELSIF g.n > sit.n_senales OR (g.valor IS NOT NULL AND sit.valor IS NOT NULL AND g.valor > sit.valor + abs(sit.valor) * 0.05) THEN
        v_estado := 'empeoro'; v_cambio := format('empeoró: %s → %s documentos, valor %s → %s', sit.n_senales, g.n, coalesce(sit.valor::text, '-'), coalesce(g.valor::text, '-'));
      ELSIF g.n < sit.n_senales OR (g.valor IS NOT NULL AND sit.valor IS NOT NULL AND g.valor < sit.valor - abs(sit.valor) * 0.05) THEN
        v_estado := 'mejoro'; v_cambio := format('mejoró: %s → %s documentos, valor %s → %s', sit.n_senales, g.n, coalesce(sit.valor::text, '-'), coalesce(g.valor::text, '-'));
      END IF;
      UPDATE situaciones SET
        documentos = g.documentos,
        -- plan B: al reabrir una resuelta se quita la marca del cierre manual (si la había).
        evidencia = CASE WHEN sit.estado = 'resuelta' THEN (sit.evidencia || g.evidencia) - 'cerrada_manual' ELSE sit.evidencia || g.evidencia END,
        calidad = g.calidad, n_senales = g.n, valor = g.valor,
        valor_texto = left(g.valor_texto, 600), vence = g.vence, company_id = coalesce(g.company_id, sit.company_id),
        odoo_partner_id = coalesce(g.odoo_partner_id, sit.odoo_partner_id),
        responsable_sugerido_user_id = coalesce(sit.responsable_sugerido_user_id, g.responsable),
        -- plan B: delegada es pegajosa (la actividad vive en Odoo); el cambio se ve en historia y ultimo_cambio.
        estado = CASE WHEN sit.estado = 'delegada' AND v_estado IN ('empeoro', 'mejoro') THEN 'delegada' ELSE coalesce(v_estado, sit.estado) END,
        resuelta_en = CASE WHEN sit.estado = 'resuelta' THEN NULL ELSE sit.resuelta_en END,
        version = CASE WHEN v_estado IS NOT NULL THEN sit.version + 1 ELSE sit.version END,
        ultimo_cambio = coalesce(v_cambio, sit.ultimo_cambio),
        ultimo_cambio_en = CASE WHEN v_estado IS NOT NULL THEN now() ELSE sit.ultimo_cambio_en END,
        historia = CASE WHEN v_estado IS NOT NULL THEN sit.historia || jsonb_build_object('fecha', now(), 'evento', v_estado, 'detalle', v_cambio || CASE WHEN sit.estado = 'delegada' THEN ' (sigue delegada)' ELSE '' END, 'corrida', p_corrida) ELSE sit.historia END,
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
  -- plan B: la marca del cierre humano caduca cuando la señal desaparece del todo. Si la clave vuelve después
  -- (episodio nuevo: otra factura vencida meses más tarde) la situación reaparece como 'abierta', aunque sea más chica que al cerrar.
  UPDATE situaciones s SET evidencia = s.evidencia - 'cerrada_manual', updated_at = now()
  WHERE s.estado = 'resuelta' AND s.evidencia ? 'cerrada_manual'
    AND NOT (s.senal = ANY (v_sin_datos))
    AND NOT EXISTS (SELECT 1 FROM _grupos gr WHERE gr.senal || '|' || gr.agrupador = s.clave);
  DROP TABLE IF EXISTS _grupos;

  RETURN jsonb_build_object('nuevas', n_nuevas, 'actualizadas', n_act, 'resueltas', n_res, 'ignoradas', n_ign,
                            'sin_datos', to_jsonb(v_sin_datos), 'corrida', p_corrida);
END $$;

-- 3. situacion_mapa: delegación visible. Misma firma + dos columnas al final (RETURNS TABLE cambia: hay que soltarla antes).
DROP FUNCTION IF EXISTS public.situacion_mapa(text, text, integer, integer);
CREATE OR REPLACE FUNCTION public.situacion_mapa(p_area text DEFAULT NULL, p_calidad text DEFAULT 'viva', p_min_severidad integer DEFAULT 1, p_limit integer DEFAULT 100)
RETURNS TABLE (id bigint, area text, tipo text, senal text, titulo text, severidad smallint, estado text, calidad text,
               contraparte text, responsable text, responsable_user_id integer, dias_abierta integer, dias_sin_cambio integer,
               ultimo_cambio text, n_documentos integer, valor numeric, valor_texto text, vence date, redactada boolean, recomendacion text,
               delegada_a text, delegacion_estado text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT s.id, s.area, s.tipo, s.senal, s.titulo, s.severidad, s.estado, s.calidad,
         coalesce(c.name, situacion_nombre_agrupador(s.agrupador, s.company_id, s.odoo_partner_id, s.documentos)) AS contraparte,
         u.name AS responsable, s.responsable_sugerido_user_id,
         (current_date - s.desde) AS dias_abierta,
         extract(day FROM now() - s.ultimo_cambio_en)::int AS dias_sin_cambio,
         s.ultimo_cambio, jsonb_array_length(s.documentos) AS n_documentos, s.valor, s.valor_texto, s.vence,
         (s.ia_version >= s.version) AS redactada, s.recomendacion,
         d.name AS delegada_a, s.delegacion->>'estado' AS delegacion_estado
  FROM situaciones s
  LEFT JOIN companies c ON c.id = s.company_id
  LEFT JOIN odoo_users u ON u.odoo_user_id = s.responsable_sugerido_user_id
  LEFT JOIN odoo_users d ON d.odoo_user_id = (s.delegacion->>'user_id')::int
  WHERE s.estado NOT IN ('resuelta', 'descartada') AND s.fusionada_en IS NULL
    AND (p_area IS NULL OR s.area = p_area)
    AND (p_calidad IS NULL OR s.calidad = p_calidad)
    AND s.severidad >= coalesce(p_min_severidad, 1)
  ORDER BY s.severidad DESC, s.ultimo_cambio_en DESC
  LIMIT greatest(coalesce(p_limit, 100), 1)
$$;
COMMENT ON FUNCTION public.situacion_mapa(text, text, integer, integer) IS 'El mapa (spec §7.1): situaciones abiertas por área, calidad (default viva; NULL = todas) y severidad mínima, con a quién está delegada y en qué estado. Ejemplo MCP: select * from situacion_mapa(''finanzas'').';

-- 4. situacion_cambios: lo que cambió desde p_desde, por área, más lo grave que sigue abierto, el rezago y los contadores.
--    Es la ÚNICA fuente del correo diario (situacion-digest) para que rutina y correo digan lo mismo.
--    Una situación aparece en una sola lista, en este orden de prioridad: resueltas, delegadas, empeoradas, mejoradas, nuevas, graves.
--    VOLATILE a propósito: crea una tabla temporal (plpgsql no permite DROP/CREATE TABLE en funciones STABLE).
CREATE OR REPLACE FUNCTION public.situacion_cambios(p_desde timestamptz DEFAULT now() - interval '24 hours')
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_out jsonb; v_hasta timestamptz := now(); v_areas jsonb := '[]'; a record; v_area jsonb; l text;
BEGIN
  DROP TABLE IF EXISTS _cambios;
  CREATE TEMP TABLE _cambios AS
  SELECT s.id, s.area, s.tipo, s.senal, s.titulo, s.severidad, s.estado, s.calidad,
         coalesce(c.name, situacion_nombre_agrupador(s.agrupador, s.company_id, s.odoo_partner_id, s.documentos)) AS contraparte,
         u.name AS responsable, d.name AS delegada_a, s.delegacion->>'estado' AS delegacion_estado,
         (current_date - s.desde) AS dias_abierta, s.recomendacion, s.ultimo_cambio, s.valor_texto,
         (s.ia_version >= s.version) AS redactada, s.ultimo_cambio_en, s.resuelta_en,
         CASE
           WHEN s.estado = 'resuelta' AND s.resuelta_en >= p_desde THEN 'resueltas'
           WHEN s.estado = 'delegada' AND (s.delegacion->>'fecha')::timestamptz >= p_desde THEN 'delegadas'
           WHEN s.estado = 'empeoro' AND s.ultimo_cambio_en >= p_desde THEN 'empeoradas'
           WHEN s.estado = 'delegada' AND s.ultimo_cambio_en >= p_desde AND s.ultimo_cambio LIKE 'empeor%' THEN 'empeoradas'
           WHEN s.estado IN ('mejoro', 'delegada') AND s.ultimo_cambio_en >= p_desde AND s.ultimo_cambio LIKE 'mejor%' THEN 'mejoradas'
           WHEN s.estado IN ('abierta', 'empeoro', 'mejoro', 'delegada') AND s.created_at >= p_desde THEN 'nuevas'
           WHEN s.estado IN ('abierta', 'empeoro', 'mejoro', 'delegada') AND s.severidad >= 4 AND s.calidad = 'viva' THEN 'graves'
           ELSE NULL END AS lista
  FROM situaciones s
  LEFT JOIN companies c ON c.id = s.company_id
  LEFT JOIN odoo_users u ON u.odoo_user_id = s.responsable_sugerido_user_id
  LEFT JOIN odoo_users d ON d.odoo_user_id = (s.delegacion->>'user_id')::int
  WHERE s.fusionada_en IS NULL AND s.tipo <> 'higiene' AND s.calidad IN ('viva', 'antigua', 'vencida_memoria')
    AND (s.estado NOT IN ('resuelta', 'descartada') OR s.resuelta_en >= p_desde);

  FOR a IN SELECT DISTINCT area FROM _cambios WHERE lista IS NOT NULL ORDER BY area LOOP
    v_area := jsonb_build_object('area', a.area, 'abiertas', (SELECT count(*) FROM _cambios x WHERE x.area = a.area AND x.estado NOT IN ('resuelta', 'descartada')));
    FOREACH l IN ARRAY ARRAY['nuevas', 'empeoradas', 'mejoradas', 'resueltas', 'delegadas', 'graves'] LOOP
      v_area := v_area || jsonb_build_object(l, (
        SELECT coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'titulo', x.titulo, 'senal', x.senal, 'tipo', x.tipo, 'contraparte', x.contraparte,
                 'severidad', x.severidad, 'estado', x.estado, 'calidad', x.calidad, 'dias_abierta', x.dias_abierta, 'responsable', x.responsable,
                 'delegada_a', x.delegada_a, 'delegacion_estado', x.delegacion_estado, 'recomendacion', x.recomendacion, 'ultimo_cambio', x.ultimo_cambio,
                 'valor_texto', x.valor_texto, 'redactada', x.redactada) ORDER BY x.severidad DESC, x.dias_abierta DESC), '[]')
        FROM (SELECT * FROM _cambios x WHERE x.area = a.area AND x.lista = l ORDER BY x.severidad DESC, x.dias_abierta DESC LIMIT 25) x));
    END LOOP;
    v_areas := v_areas || v_area;
  END LOOP;

  SELECT jsonb_build_object(
    'desde', p_desde, 'hasta', v_hasta, 'areas', v_areas,
    'rezago', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'area', x.area, 'titulo', x.titulo, 'contraparte', x.contraparte, 'severidad', x.severidad,
                 'dias_abierta', x.dias_abierta, 'responsable', x.responsable, 'recomendacion', x.recomendacion, 'ultimo_cambio', x.ultimo_cambio) ORDER BY x.dias_abierta DESC), '[]')
               FROM (SELECT * FROM _cambios WHERE calidad = 'antigua' AND estado NOT IN ('resuelta', 'descartada') ORDER BY dias_abierta DESC LIMIT 25) x),
    'ignoradas', (SELECT count(*) FROM senales WHERE resuelta_en IS NULL AND calidad = 'ignorada'),
    'reglas_vigentes', (SELECT count(*) FROM situacion_reglas WHERE vigente_hasta IS NULL OR vigente_hasta > now()),
    'higiene', jsonb_build_object(
      'zombie', (SELECT count(*) FROM senales WHERE resuelta_en IS NULL AND calidad = 'zombie'),
      'dato_malo', (SELECT count(*) FROM senales WHERE resuelta_en IS NULL AND calidad = 'dato_malo')),
    'salud', jsonb_build_object(
      'odoo_push_edad_h', (SELECT round(extract(epoch FROM now() - max(created_at)) / 3600, 1) FROM odoo_push_last_events WHERE method = 'senales' AND status = 'success'),
      'bot_terminada_en', (SELECT max(terminada_en) FROM situacion_corridas),
      'sin_datos', (SELECT coalesce(jsonb_agg(c.senal), '[]') FROM senales_config c WHERE c.activa AND c.fuente = 'odoo'
                    AND EXISTS (SELECT 1 FROM senales s WHERE s.senal = c.senal AND s.resuelta_en IS NULL)
                    AND NOT EXISTS (SELECT 1 FROM senales_lotes l WHERE l.senal = c.senal AND l.ok AND l.recibido_en > now() - make_interval(hours => coalesce(c.sin_datos_horas, 2 * c.cada_horas))))),
    'totales', (SELECT jsonb_build_object(
      'nuevas', count(*) FILTER (WHERE lista = 'nuevas'), 'empeoradas', count(*) FILTER (WHERE lista = 'empeoradas'),
      'mejoradas', count(*) FILTER (WHERE lista = 'mejoradas'), 'resueltas', count(*) FILTER (WHERE lista = 'resueltas'),
      'delegadas', count(*) FILTER (WHERE lista = 'delegadas'), 'graves', count(*) FILTER (WHERE lista = 'graves'),
      'abiertas', count(*) FILTER (WHERE estado NOT IN ('resuelta', 'descartada')),
      'rezago', count(*) FILTER (WHERE calidad = 'antigua' AND estado NOT IN ('resuelta', 'descartada')))
      FROM _cambios)
  ) INTO v_out;
  DROP TABLE IF EXISTS _cambios;
  RETURN v_out;
END $$;
COMMENT ON FUNCTION public.situacion_cambios(timestamptz) IS 'Lo que cambió desde p_desde (spec §7.1): por área nuevas, empeoradas, mejoradas, resueltas, delegadas y lo grave (sev ≥ 4) que sigue abierto; rezago (antiguas); ignoradas, reglas vigentes, higiene, salud y totales. Única fuente del correo diario. Ejemplo MCP: select situacion_cambios(now() - interval ''1 day'').';

-- 5. Bitácora del correo diario de situación (sustituye a email_digests para este correo).
CREATE TABLE IF NOT EXISTS public.situacion_digests (
  id            bigserial PRIMARY KEY,
  fecha         date NOT NULL,
  desde         timestamptz NOT NULL,
  hasta         timestamptz NOT NULL,
  cambios       jsonb NOT NULL,
  narrativa_md  text,
  emailed       boolean NOT NULL DEFAULT false,
  email_error   text,
  trigger       text NOT NULL DEFAULT 'cron',
  modelo        text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS situacion_digests_fecha_idx ON public.situacion_digests (fecha DESC);
REVOKE ALL ON public.situacion_digests FROM public, anon, authenticated;

INSERT INTO pipeline_logs (level, phase, message, details)
VALUES ('info', 'migration', 'Situación plan B paso 4: situacion_cambios, delegada pegajosa, cierre humano pegajoso (evidencia.cerrada_manual), delegación en situacion_mapa, en_mapa, situacion_digests',
        jsonb_build_object('migration', '20260924a_situacion_cambios'));
COMMIT;
