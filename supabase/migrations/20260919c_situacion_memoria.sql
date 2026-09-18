-- 2026-09-19c — Situación plan A: señales de la memoria (spec §4, fuente=memoria).
-- SQL puro, sin Claude. Cada señal manda su lista completa por senales_ingestar.
BEGIN;

-- Buzón que más participa en una conversación (conv_key) → persona.
CREATE OR REPLACE FUNCTION public.situacion_responsable_conv(p_conv_key text)
RETURNS integer LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT situacion_user_de_buzon(t.account)
  FROM threads t
  WHERE coalesce(t.conv_key, t.gmail_thread_id) = p_conv_key
  ORDER BY t.message_count DESC, t.id LIMIT 1
$$;

-- Buzón que más atiende a una empresa (vista memoria_encargados, rank 1) → persona.
CREATE OR REPLACE FUNCTION public.situacion_responsable_empresa(p_company_id bigint)
RETURNS integer LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT situacion_user_de_buzon(mailbox) FROM memoria_encargados
  WHERE company_id = p_company_id AND area IS NULL ORDER BY rank LIMIT 1
$$;

-- Turno de una señal: sin lote bueno más reciente que cada_horas (menos 5 min de holgura).
CREATE OR REPLACE FUNCTION public.senales_en_turno(p_senal text)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM senales_lotes l JOIN senales_config c ON c.senal = l.senal
    WHERE l.senal = p_senal AND l.ok
      AND l.recibido_en > now() - make_interval(hours => c.cada_horas) + interval '5 minutes')
$$;

CREATE OR REPLACE FUNCTION public.senales_memoria(p_corrida uuid DEFAULT gen_random_uuid())
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  out jsonb := '{}'::jsonb; filas jsonb; u jsonb;
  v_dias int; v_factor numeric; v_min_dias int; v_min_correos int;
  noise CONSTANT text := '(no-?reply|postmaster|mailer-daemon|notificacion|notification|newsletter|digest|automated|donotreply)';
BEGIN
  -- 1. cliente_sin_respuesta: por empresa, hilos donde el último correo es del cliente.
  SELECT coalesce((umbrales->>'dias')::int, 3) INTO v_dias FROM senales_config WHERE senal = 'cliente_sin_respuesta';
  SELECT coalesce(jsonb_agg(x), '[]') INTO filas FROM (
    SELECT jsonb_build_object(
      'clave', 'cliente_sin_respuesta:company:' || c.id,
      'company_id', c.id, 'odoo_partner_id', c.odoo_partner_id,
      'responsable_odoo_user_id', situacion_user_de_buzon(mode() WITHIN GROUP (ORDER BY t.account)),
      'valor', count(*),
      'valor_texto', count(*) || ' conversación(es) sin respuesta; la más vieja lleva ' || max(extract(day FROM now() - t.last_activity))::int || ' días',
      'documentos', to_jsonb((array_agg(jsonb_build_object('modelo', 'thread', 'id', t.id, 'nombre', left(coalesce(t.subject, '(sin asunto)'), 120), 'fecha', t.last_activity::date) ORDER BY t.last_activity))[1:5]),
      'payload', jsonb_build_object('ultimo_correo', max(t.last_activity), 'dias_max', max(extract(day FROM now() - t.last_activity))::int)
    ) AS x
    FROM threads t
    JOIN companies c ON c.id = t.company_id AND c.odoo_partner_id IS NOT NULL
    WHERE t.status IN ('needs_response', 'stalled') AND t.last_sender_type = 'external'
      AND t.last_activity < now() - make_interval(days => v_dias) AND t.last_activity > now() - interval '90 days'
      AND NOT memoria_generic_domain(coalesce(nullif(c.domain, ''), 'sin-dominio.x'))
      AND coalesce(t.last_sender, '') !~* noise
    GROUP BY c.id, c.odoo_partner_id) q;
  out := out || jsonb_build_object('cliente_sin_respuesta', senales_ingestar('cliente_sin_respuesta', 'memoria', p_corrida, filas));

  -- 2. compromiso_correo: pendientes quien=nosotros de conversaciones abiertas (clave por conversación + hash del texto).
  --    Se dejan de emitir las que ya están etiquetadas vencida_memoria (§5.2): así se resuelven por lote.
  SELECT coalesce(jsonb_agg(x), '[]') INTO filas FROM (
    SELECT jsonb_build_object(
      'clave', k.clave,
      'company_id', s.company_id, 'odoo_partner_id', c.odoo_partner_id,
      'responsable_odoo_user_id', coalesce(situacion_user_de_buzon(s.account), situacion_responsable_conv(s.conv_key)),
      'valor', extract(day FROM now() - t.last_activity)::int,
      'valor_texto', left(p.value->>'que', 200),
      'vence', situacion_fecha(p.value->>'vence'),
      'documentos', jsonb_build_array(jsonb_build_object('modelo', 'thread', 'id', s.thread_id, 'nombre', left(coalesce(s.tema, t.subject, ''), 120), 'fecha', t.last_activity::date)),
      'payload', jsonb_build_object('que', left(p.value->>'que', 300), 'ultimo_correo', t.last_activity, 'conv_key', s.conv_key, 'buzon', s.account)
    ) AS x
    FROM memoria_thread_summaries s
    JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(s.pendientes) = 'array' THEN s.pendientes ELSE '[]'::jsonb END) p ON true
    JOIN threads t ON t.id = s.thread_id
    JOIN companies c ON c.id = s.company_id AND c.odoo_partner_id IS NOT NULL
    CROSS JOIN LATERAL (SELECT 'compromiso_correo:conv:' || md5(coalesce(s.conv_key, s.thread_id::text) || '|' || lower(trim(coalesce(p.value->>'que', '')))) AS clave) k
    WHERE s.estado = 'abierto' AND p.value->>'quien' = 'nosotros' AND coalesce(p.value->>'que', '') <> ''
      AND s.summarized_through > now() - interval '120 days'
      AND NOT EXISTS (SELECT 1 FROM senales z WHERE z.clave = k.clave AND z.resuelta_en IS NULL AND z.calidad = 'vencida_memoria')) q;
  out := out || jsonb_build_object('compromiso_correo', senales_ingestar('compromiso_correo', 'memoria', p_corrida, filas));

  -- 3. promesa_pago_vencida: email_pending_actions tipo promesa_pago, abiertas, deadline pasado.
  SELECT coalesce(jsonb_agg(x), '[]') INTO filas FROM (
    SELECT jsonb_build_object(
      'clave', 'promesa_pago_vencida:epa:' || a.id,
      'company_id', a.company_id, 'odoo_partner_id', c.odoo_partner_id,
      'responsable_odoo_user_id', situacion_user_de_buzon(a.account),
      'valor', (current_date - a.deadline), 'valor_texto', left(a.descripcion, 200), 'vence', a.deadline,
      'documentos', jsonb_build_array(jsonb_build_object('modelo', 'thread', 'id', a.thread_id, 'nombre', left(coalesce(t.subject, ''), 120), 'fecha', t.last_activity::date)),
      'payload', jsonb_build_object('ultimo_correo', t.last_activity, 'epa_id', a.id)
    ) AS x
    FROM email_pending_actions a
    JOIN companies c ON c.id = a.company_id AND c.odoo_partner_id IS NOT NULL
    LEFT JOIN threads t ON t.id = a.thread_id
    WHERE a.tipo = 'promesa_pago' AND a.status = 'open' AND a.deadline < current_date
      AND NOT EXISTS (SELECT 1 FROM senales z WHERE z.clave = 'promesa_pago_vencida:epa:' || a.id AND z.resuelta_en IS NULL AND z.calidad = 'vencida_memoria')) q;
  out := out || jsonb_build_object('promesa_pago_vencida', senales_ingestar('promesa_pago_vencida', 'memoria', p_corrida, filas));

  -- 4/5. proveedor_esperando (nosotros debemos) y esperando_proveedor (ellos deben): conversaciones abiertas con proveedor.
  FOR u IN SELECT value FROM jsonb_array_elements('[{"senal":"proveedor_esperando","esperando":"nosotros"},{"senal":"esperando_proveedor","esperando":"ellos"}]'::jsonb) LOOP
    SELECT coalesce(jsonb_agg(x), '[]') INTO filas FROM (
      SELECT jsonb_build_object(
        'clave', (u->>'senal') || ':conv:' || md5(coalesce(s.conv_key, s.thread_id::text)),
        'company_id', s.company_id, 'odoo_partner_id', c.odoo_partner_id,
        'responsable_odoo_user_id', coalesce(situacion_user_de_buzon(s.account), situacion_responsable_conv(s.conv_key)),
        'valor', extract(day FROM now() - t.last_activity)::int, 'valor_texto', left(coalesce(s.tema, t.subject, ''), 200),
        'documentos', jsonb_build_array(jsonb_build_object('modelo', 'thread', 'id', s.thread_id, 'nombre', left(coalesce(s.tema, t.subject, ''), 120), 'fecha', t.last_activity::date)),
        'payload', jsonb_build_object('ultimo_correo', t.last_activity, 'conv_key', s.conv_key, 'pendientes', s.pendientes)
      ) AS x
      FROM memoria_thread_summaries s
      JOIN threads t ON t.id = s.thread_id
      JOIN companies c ON c.id = s.company_id AND c.odoo_partner_id IS NOT NULL AND c.is_supplier AND NOT c.is_customer
      WHERE s.estado = 'abierto' AND s.esperando_a = (u->>'esperando') AND t.last_activity > now() - interval '90 days') q;
    out := out || jsonb_build_object(u->>'senal', senales_ingestar(u->>'senal', 'memoria', p_corrida, filas));
  END LOOP;

  -- 6. reclamacion_cliente: conversación abierta con cliente en tono tenso.
  SELECT coalesce(jsonb_agg(x), '[]') INTO filas FROM (
    SELECT jsonb_build_object(
      'clave', 'reclamacion_cliente:conv:' || md5(coalesce(s.conv_key, s.thread_id::text)),
      'company_id', s.company_id, 'odoo_partner_id', c.odoo_partner_id,
      'responsable_odoo_user_id', coalesce(situacion_user_de_buzon(s.account), situacion_responsable_conv(s.conv_key)),
      'valor', extract(day FROM now() - t.last_activity)::int, 'valor_texto', left(coalesce(s.tema, t.subject, ''), 200),
      'documentos', jsonb_build_array(jsonb_build_object('modelo', 'thread', 'id', s.thread_id, 'nombre', left(coalesce(s.tema, t.subject, ''), 120), 'fecha', t.last_activity::date)),
      'payload', jsonb_build_object('ultimo_correo', t.last_activity, 'conv_key', s.conv_key, 'esperando_a', s.esperando_a)
    ) AS x
    FROM memoria_thread_summaries s
    JOIN threads t ON t.id = s.thread_id
    JOIN companies c ON c.id = s.company_id AND c.odoo_partner_id IS NOT NULL AND c.is_customer
    WHERE s.estado = 'abierto' AND s.tono = 'tenso' AND t.last_activity > now() - interval '90 days') q;
  out := out || jsonb_build_object('reclamacion_cliente', senales_ingestar('reclamacion_cliente', 'memoria', p_corrida, filas));

  -- 7. oportunidad_demanda: una por señal de demanda reciente.
  SELECT coalesce((umbrales->>'dias')::int, 60) INTO v_dias FROM senales_config WHERE senal = 'oportunidad_demanda';
  SELECT coalesce(jsonb_agg(x), '[]') INTO filas FROM (
    SELECT jsonb_build_object(
      'clave', 'oportunidad_demanda:demand:' || d.id,
      'company_id', d.company_id, 'odoo_partner_id', c.odoo_partner_id,
      'responsable_odoo_user_id', situacion_responsable_empresa(d.company_id),
      'valor', d.qty, 'valor_texto', left(concat_ws(' ', d.qty, d.uom, coalesce(d.product_ref, d.product_desc), d.period_label), 200),
      'vence', d.demand_date,
      'documentos', jsonb_build_array(jsonb_build_object('modelo', 'thread', 'id', d.thread_id, 'nombre', left(coalesce(t.subject, ''), 120), 'fecha', d.detected_at::date)),
      'payload', jsonb_build_object('ultimo_correo', d.detected_at, 'product_ref', d.product_ref, 'product_desc', d.product_desc)
    ) AS x
    FROM customer_demand_signals d
    JOIN companies c ON c.id = d.company_id AND c.odoo_partner_id IS NOT NULL
    LEFT JOIN threads t ON t.id = d.thread_id
    WHERE d.detected_at > now() - make_interval(days => v_dias)) q;
  out := out || jsonb_build_object('oportunidad_demanda', senales_ingestar('oportunidad_demanda', 'memoria', p_corrida, filas));

  -- 8. cliente_callado: sin correo entrante en > factor × su mediana de días entre correos (12 meses).
  --    (El spec dice "memoria + facturas"; la parte de pedidos queda para cuando la señal se cruce con Odoo.)
  --    Es la única cara (barre 12 meses de emails): cada_horas=24 en config, y aquí se respeta el turno.
  IF senales_en_turno('cliente_callado') THEN
  SELECT coalesce((umbrales->>'factor')::numeric, 2), coalesce((umbrales->>'min_dias')::int, 14), coalesce((umbrales->>'min_correos')::int, 6)
    INTO v_factor, v_min_dias, v_min_correos FROM senales_config WHERE senal = 'cliente_callado';
  SELECT coalesce(jsonb_agg(x), '[]') INTO filas FROM (
    WITH dias AS (
      SELECT e.company_id, e.email_date::date AS d
      FROM emails e
      WHERE e.email_date > now() - interval '12 months' AND e.sender_type = 'external' AND e.company_id IS NOT NULL
      GROUP BY 1, 2
    ), gaps AS (
      SELECT company_id, d, d - lag(d) OVER (PARTITION BY company_id ORDER BY d) AS gap FROM dias
    ), stats AS (
      SELECT company_id, count(*) AS n, max(d) AS ultimo,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY gap) AS mediana
      FROM gaps GROUP BY company_id HAVING count(*) >= v_min_correos
    )
    SELECT jsonb_build_object(
      'clave', 'cliente_callado:company:' || s.company_id,
      'company_id', s.company_id, 'odoo_partner_id', c.odoo_partner_id,
      'responsable_odoo_user_id', situacion_responsable_empresa(s.company_id),
      'valor', (current_date - s.ultimo),
      'valor_texto', (current_date - s.ultimo) || ' días sin correo; escribía cada ' || round(s.mediana) || ' días',
      'payload', jsonb_build_object('ultimo_correo', s.ultimo, 'mediana_dias', round(s.mediana::numeric, 1), 'correos_12m', s.n)
    ) AS x
    FROM stats s
    JOIN companies c ON c.id = s.company_id AND c.odoo_partner_id IS NOT NULL AND c.is_customer
    WHERE (current_date - s.ultimo) > greatest(v_factor * s.mediana, v_min_dias)) q;
  out := out || jsonb_build_object('cliente_callado', senales_ingestar('cliente_callado', 'memoria', p_corrida, filas));
  ELSE
    out := out || jsonb_build_object('cliente_callado', jsonb_build_object('ok', true, 'saltada', 'fuera de turno'));
  END IF;

  -- 9. pendiente_rh_correo: pendientes (quien=nosotros) en buzones de RH (buzon_personas.area='rh' o nombre del buzón).
  SELECT coalesce(jsonb_agg(x), '[]') INTO filas FROM (
    SELECT jsonb_build_object(
      'clave', 'pendiente_rh_correo:conv:' || md5(coalesce(s.conv_key, s.thread_id::text) || '|' || lower(trim(coalesce(p.value->>'que', '')))),
      'company_id', s.company_id, 'odoo_partner_id', c.odoo_partner_id,
      'responsable_odoo_user_id', situacion_user_de_buzon(s.account),
      'valor', extract(day FROM now() - t.last_activity)::int, 'valor_texto', left(p.value->>'que', 200), 'vence', situacion_fecha(p.value->>'vence'),
      'documentos', jsonb_build_array(jsonb_build_object('modelo', 'thread', 'id', s.thread_id, 'nombre', left(coalesce(s.tema, t.subject, ''), 120), 'fecha', t.last_activity::date)),
      'payload', jsonb_build_object('que', left(p.value->>'que', 300), 'ultimo_correo', t.last_activity, 'buzon', s.account)
    ) AS x
    FROM memoria_thread_summaries s
    JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(s.pendientes) = 'array' THEN s.pendientes ELSE '[]'::jsonb END) p ON true
    JOIN threads t ON t.id = s.thread_id
    LEFT JOIN companies c ON c.id = s.company_id
    WHERE s.estado = 'abierto' AND p.value->>'quien' = 'nosotros' AND coalesce(p.value->>'que', '') <> ''
      AND t.last_activity > now() - interval '90 days'
      AND (s.account ~* '^(rh|rrhh|recursoshumanos|nomina|capitalhumano)' OR EXISTS (SELECT 1 FROM buzon_personas b WHERE b.buzon = lower(s.account) AND b.area = 'rh'))) q;
  out := out || jsonb_build_object('pendiente_rh_correo', senales_ingestar('pendiente_rh_correo', 'memoria', p_corrida, filas));

  RETURN out;
END $$;
REVOKE ALL ON FUNCTION public.senales_memoria(uuid) FROM public, anon, authenticated;
COMMENT ON FUNCTION public.senales_memoria(uuid) IS 'Señales fuente=memoria (spec §4): SQL puro sobre threads, resúmenes, pendientes y demanda; cada una pasa por senales_ingestar con la lista completa. Devuelve el resultado de cada lote.';

COMMIT;
