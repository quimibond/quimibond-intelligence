-- Situación plan A — corrección: PostgREST carga `safeupdate` (rol authenticator:
-- session_preload_libraries=safeupdate), que rechaza UPDATE/DELETE sin WHERE
-- aunque estén dentro de una función. Los tests SQL (rol postgres) no lo vieron.
-- Afectaba a senales_ingestar (UPDATE _lote SET agrupador) y a
-- buzon_personas_reemplazar (DELETE FROM buzon_personas), es decir, a TODO el
-- push de señales desde Odoo y al ciclo del bot. Mismo cuerpo, con `WHERE true`.

CREATE OR REPLACE FUNCTION public.buzon_personas_reemplazar(p_filas jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE n integer;
BEGIN
  DELETE FROM buzon_personas WHERE true;   -- safeupdate (PostgREST) exige WHERE
  INSERT INTO buzon_personas (buzon, odoo_user_id, area)
  SELECT lower(f->>'buzon'), (f->>'odoo_user_id')::int, f->>'area'
  FROM jsonb_array_elements(coalesce(p_filas, '[]'::jsonb)) f
  WHERE coalesce(f->>'buzon', '') <> '' AND (f->>'odoo_user_id') IS NOT NULL
  ON CONFLICT (buzon, odoo_user_id) DO UPDATE SET area = EXCLUDED.area, updated_at = now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.senales_ingestar(p_senal text, p_fuente text, p_corrida uuid, p_filas jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  cfg record; n_nuevas int := 0; n_act int := 0; n_res int := 0; n_in int := 0;
BEGIN
  SELECT * INTO cfg FROM senales_config WHERE senal = p_senal;
  IF NOT FOUND THEN RAISE EXCEPTION 'senal % no está en senales_config', p_senal; END IF;
  IF cfg.fuente <> p_fuente THEN RAISE EXCEPTION 'senal % es de fuente %, no %', p_senal, cfg.fuente, p_fuente; END IF;
  IF p_corrida IS NULL THEN RAISE EXCEPTION 'p_corrida es obligatorio'; END IF;

  BEGIN
    IF jsonb_typeof(p_filas) <> 'array' THEN RAISE EXCEPTION 'p_filas debe ser un array'; END IF;
    DROP TABLE IF EXISTS _lote;
    CREATE TEMP TABLE _lote AS
    SELECT DISTINCT ON (f->>'clave')
           f->>'clave'                              AS clave,
           coalesce(f->'documentos', '[]'::jsonb)   AS documentos,
           (f->>'company_id')::bigint               AS company_id,
           (f->>'odoo_partner_id')::int             AS odoo_partner_id,
           (f->>'responsable_odoo_user_id')::int    AS responsable_odoo_user_id,
           (f->>'valor')::numeric                   AS valor,
           left(f->>'valor_texto', 300)             AS valor_texto,
           situacion_fecha(f->>'vence')             AS vence,
           coalesce(f->'payload', '{}'::jsonb)      AS payload,
           NULL::text                               AS agrupador
    FROM jsonb_array_elements(p_filas) f
    WHERE coalesce(f->>'clave', '') <> '';
    GET DIAGNOSTICS n_in = ROW_COUNT;

    -- Contraparte: Odoo manda odoo_partner_id; la empresa de la memoria se resuelve aquí.
    UPDATE _lote l SET company_id = (SELECT c.id FROM companies c WHERE c.odoo_partner_id = l.odoo_partner_id ORDER BY c.id LIMIT 1)
    WHERE l.company_id IS NULL AND l.odoo_partner_id IS NOT NULL;

    UPDATE _lote SET agrupador = CASE cfg.agrupar_por
      WHEN 'contraparte' THEN coalesce('company:' || company_id, 'partner:' || odoo_partner_id, 'sin_contraparte')
      WHEN 'documento'   THEN coalesce('doc:' || (documentos->0->>'modelo') || ':' || (documentos->0->>'id'), 'doc:' || clave)
      WHEN 'responsable' THEN 'user:' || coalesce(responsable_odoo_user_id::text, '0')
      WHEN 'situacion'   THEN 'situacion:' || coalesce(payload->>'situacion_id', '0')
      WHEN 'payload'     THEN 'grupo:' || coalesce(payload->>'grupo', 'todas')
      ELSE 'todas' END
    WHERE true;   -- safeupdate (PostgREST) exige WHERE, también en tablas temporales

    -- Abiertas que vienen en el lote: se actualizan (valor_cambio_en solo si el valor cambió).
    -- clock_timestamp(): now() es la hora de inicio de la transacción y senales_memoria llama esto N veces en una sola.
    UPDATE senales s SET
      vista_en = clock_timestamp(),
      valor_cambio_en = CASE WHEN s.valor IS DISTINCT FROM l.valor THEN clock_timestamp() ELSE s.valor_cambio_en END,
      valor = l.valor, valor_texto = l.valor_texto, vence = l.vence, documentos = l.documentos,
      company_id = coalesce(l.company_id, s.company_id),
      odoo_partner_id = coalesce(l.odoo_partner_id, s.odoo_partner_id),
      responsable_odoo_user_id = coalesce(l.responsable_odoo_user_id, s.responsable_odoo_user_id),
      payload = s.payload || l.payload, agrupador = l.agrupador
    FROM _lote l
    WHERE s.clave = l.clave AND s.senal = p_senal AND s.resuelta_en IS NULL;
    GET DIAGNOSTICS n_act = ROW_COUNT;

    -- Claves sin fila abierta: episodio nuevo.
    INSERT INTO senales (clave, episodio, senal, area, tipo, fuente, agrupador, documentos, company_id, odoo_partner_id,
                         responsable_odoo_user_id, valor, valor_texto, vence, payload, primera_vista, vista_en, valor_cambio_en)
    SELECT l.clave, 1 + (SELECT count(*) FROM senales p WHERE p.clave = l.clave), p_senal, cfg.area, cfg.tipo, p_fuente,
           l.agrupador, l.documentos, l.company_id, l.odoo_partner_id, l.responsable_odoo_user_id, l.valor, l.valor_texto, l.vence, l.payload,
           clock_timestamp(), clock_timestamp(), clock_timestamp()
    FROM _lote l
    WHERE NOT EXISTS (SELECT 1 FROM senales s WHERE s.clave = l.clave AND s.resuelta_en IS NULL);
    GET DIAGNOSTICS n_nuevas = ROW_COUNT;

    -- Lo abierto de ESTA señal que no vino: resuelto (lista completa).
    UPDATE senales s SET resuelta_en = clock_timestamp()
    WHERE s.senal = p_senal AND s.resuelta_en IS NULL
      AND NOT EXISTS (SELECT 1 FROM _lote l WHERE l.clave = s.clave);
    GET DIAGNOSTICS n_res = ROW_COUNT;

    INSERT INTO senales_lotes (senal, fuente, corrida, n_claves, n_nuevas, n_actualizadas, n_resueltas, ok)
    VALUES (p_senal, p_fuente, p_corrida, n_in, n_nuevas, n_act, n_res, true);
    DROP TABLE IF EXISTS _lote;
    RETURN jsonb_build_object('ok', true, 'senal', p_senal, 'n', n_in, 'nuevas', n_nuevas, 'actualizadas', n_act, 'resueltas', n_res);
  EXCEPTION WHEN OTHERS THEN
    -- Todo lo anterior del bloque se deshace; solo queda el registro del lote fallido.
    INSERT INTO senales_lotes (senal, fuente, corrida, n_claves, ok, error)
    VALUES (p_senal, p_fuente, p_corrida, coalesce(jsonb_array_length(CASE WHEN jsonb_typeof(p_filas) = 'array' THEN p_filas END), 0), false, left(SQLERRM, 500));
    RETURN jsonb_build_object('ok', false, 'senal', p_senal, 'error', left(SQLERRM, 500));
  END;
END $$;

INSERT INTO pipeline_logs (level, phase, message, details)
VALUES ('info', 'migration', 'Situación plan A: senales_ingestar y buzon_personas_reemplazar con WHERE explícito (safeupdate de PostgREST)',
        jsonb_build_object('migration', '20260919g_situacion_safeupdate'));
