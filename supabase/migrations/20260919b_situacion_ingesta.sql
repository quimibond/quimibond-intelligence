-- 2026-09-19b — Situación plan A: ingesta por lote (spec §3.1.1, §4 regla 2).
-- senales_ingestar: UNA llamada por señal con la lista COMPLETA de claves
-- activas. Upsert por clave abierta, episodio nuevo si reaparece, cierre de
-- lo que no viene, y una fila en senales_lotes. Un lote malformado devuelve
-- ok=false (y su fila con error) sin tocar señales: así la resolución nunca
-- ocurre por un lote roto. Señal desconocida o fuente equivocada = excepción.
BEGIN;

-- Fecha tolerante: texto inválido → NULL, nunca error (los pendientes de la memoria traen fechas libres).
CREATE OR REPLACE FUNCTION public.situacion_fecha(p text)
RETURNS date LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN p::date;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$;

-- Persona detrás de un buzón: catálogo buzon_personas (compartidos) y, si no, el usuario con ese correo.
CREATE OR REPLACE FUNCTION public.situacion_user_de_buzon(p_buzon text)
RETURNS integer LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT coalesce(
    (SELECT odoo_user_id FROM buzon_personas WHERE buzon = lower(p_buzon) ORDER BY updated_at DESC LIMIT 1),
    (SELECT odoo_user_id FROM odoo_users WHERE lower(email) = lower(p_buzon) LIMIT 1))
$$;

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
      ELSE 'todas' END;

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
REVOKE ALL ON FUNCTION public.senales_ingestar(text, text, uuid, jsonb) FROM public, anon, authenticated;
COMMENT ON FUNCTION public.senales_ingestar(text, text, uuid, jsonb) IS
  'Ingesta por lote (spec §3.1.1). Una llamada por señal con TODAS sus claves activas: upsert por clave abierta, episodio nuevo si reaparece, cierra lo que no viene, registra el lote. Lote malformado → ok=false, nada se toca. Filas: {clave, documentos[], company_id?, odoo_partner_id?, responsable_odoo_user_id?, valor?, valor_texto?, vence?, payload{}}.';

-- Fin del push: dispara la consolidación por evento. Tolera que la Edge Function no exista (pasos 2→3 del plan).
CREATE OR REPLACE FUNCTION public.senales_push_terminado(p_corrida uuid, p_origen text DEFAULT 'odoo')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE v_req bigint; v_lotes int; v_err text;
BEGIN
  SELECT count(*) INTO v_lotes FROM senales_lotes WHERE corrida = p_corrida;
  BEGIN
    v_req := invoke_edge('situacion-consolidar', jsonb_build_object('corrida', p_corrida, 'origen', p_origen));
  EXCEPTION WHEN OTHERS THEN
    v_err := left(SQLERRM, 300);
  END;
  INSERT INTO pipeline_logs (level, phase, message, details)
  VALUES (CASE WHEN v_err IS NULL THEN 'info' ELSE 'warning' END, 'situacion',
          format('Push terminado (%s): %s lotes; consolidación %s', p_origen, v_lotes, CASE WHEN v_err IS NULL THEN 'disparada' ELSE 'NO disparada: ' || v_err END),
          jsonb_build_object('corrida', p_corrida, 'origen', p_origen, 'lotes', v_lotes, 'request_id', v_req, 'error', v_err));
  RETURN jsonb_build_object('ok', true, 'corrida', p_corrida, 'lotes', v_lotes, 'request_id', v_req, 'error', v_err);
END $$;
REVOKE ALL ON FUNCTION public.senales_push_terminado(uuid, text) FROM public, anon, authenticated;

COMMIT;
