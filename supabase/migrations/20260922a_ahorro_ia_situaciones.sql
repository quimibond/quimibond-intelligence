-- Ahorro de créditos de Claude (2026-09-22).
--
-- El bot situacion-consolidar gastaba ~80 % del costo de la API (≈750 llamadas/día) redactando
-- una y otra vez las mismas ~70 situaciones, por dos bugs y sin ningún freno:
--
-- 1. senales_memoria: compromiso_correo y promesa_pago_vencida dejaban de emitir una señal cuando ya estaba
--    etiquetada vencida_memoria. El lote la resolvía, a la hora siguiente volvía a emitirse (ya no había fila
--    vencida abierta) como episodio nuevo, se volvía a etiquetar vencida… Cada 2 h por señal; la situación
--    alternaba 18↔19 documentos (mejoró / empeoró) y subía de versión en cada corrida. Ahora el filtro de
--    "vencida" se evalúa sobre el dato (vence pasado y sin correo en vencida_dias), igual que senales_actualizar.
-- 2. situacion_guardar: la tolerancia de ±5 % se calculaba como valor × 1.05; con valores negativos
--    (venta_margen_negativo, cliente_pierde) el mismo número daba "empeoró" cada hora. Ahora es ±5 % de abs(valor).
-- 3. situacion_candidatas: freno de 6 h. Una situación ya redactada no se vuelve a mandar a Claude antes de
--    6 h aunque cambie (las nuevas, ia_version = 0, siguen pasando de inmediato). Tope: 4 redacciones/día.
-- 4. claude_cost_summary: precios de la generación actual (Sonnet 5 $2/$10, Opus 5 $5/$25, Haiku 4.5 $1/$5
--    por millón); la vista cobraba Sonnet a $3/$15 y Opus a $15/$75.

CREATE OR REPLACE FUNCTION public.situacion_vencida_dias(p_senal text)
RETURNS int LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT coalesce((SELECT (reglas_calidad->>'vencida_dias')::int FROM senales_config WHERE senal = p_senal), 21)
$$;
COMMENT ON FUNCTION public.situacion_vencida_dias(text) IS 'Días sin correo tras el vencimiento para que una señal de memoria cuente como vencida (senales_config.reglas_calidad.vencida_dias, default 21 como senales_actualizar).';
REVOKE ALL ON FUNCTION public.situacion_vencida_dias(text) FROM public, anon, authenticated;

-- 1. senales_memoria (cuerpo de 20260919c; solo cambian los filtros de vencidas de compromiso_correo y promesa_pago_vencida)
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
  --    Se dejan de emitir las vencidas (§5.2: vence pasado y sin correo en vencida_dias): así se resuelven por lote y no regresan.
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
      -- Vencida = misma regla que senales_actualizar, pero sobre el dato y no sobre el estado de la señal
      -- (antes: "no emitir si ya está vencida_memoria" → el lote la resolvía, reaparecía a la hora siguiente como
      -- episodio nuevo y la situación parpadeaba 18↔19 cada hora, con una redacción de Claude en cada vuelta).
      AND NOT coalesce(situacion_fecha(p.value->>'vence') < current_date
                       AND t.last_activity < now() - make_interval(days => situacion_vencida_dias('compromiso_correo')), false)) q;
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
      AND NOT coalesce(t.last_activity < now() - make_interval(days => situacion_vencida_dias('promesa_pago_vencida')), false)) q;
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


-- 2. situacion_guardar (cuerpo de 20260919h; solo cambia la tolerancia de empeoró/mejoró)
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
      -- Tolerancia de ±5 % sobre abs(valor): con valores negativos (margen) `valor * 1.05` es MENOR que valor y
      -- el mismo número contaba como "empeoró" en cada corrida (−84,111 > −88,317).
      ELSIF g.n > sit.n_senales OR (g.valor IS NOT NULL AND sit.valor IS NOT NULL AND g.valor > sit.valor + abs(sit.valor) * 0.05) THEN
        v_estado := 'empeoro'; v_cambio := format('empeoró: %s → %s documentos, valor %s → %s', sit.n_senales, g.n, coalesce(sit.valor::text, '-'), coalesce(g.valor::text, '-'));
      ELSIF g.n < sit.n_senales OR (g.valor IS NOT NULL AND sit.valor IS NOT NULL AND g.valor < sit.valor - abs(sit.valor) * 0.05) THEN
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

-- 3. situacion_candidatas con freno de 6 h para las ya redactadas
CREATE OR REPLACE FUNCTION public.situacion_candidatas(p_limit integer DEFAULT 40)
RETURNS TABLE(id bigint, clave text, titulo text, estado text, version integer, ia_version integer, severidad smallint, calidad text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT s.id, s.clave, s.titulo, s.estado, s.version, s.ia_version, s.severidad, s.calidad
  FROM situaciones s
  WHERE s.estado IN ('abierta', 'empeoro', 'mejoro') AND s.fusionada_en IS NULL AND s.calidad = 'viva' AND s.tipo <> 'higiene'
    AND s.ia_version < s.version
    AND (s.ia_version = 0 OR NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(s.historia) h
          WHERE h->>'evento' = 'redactada' AND (h->>'fecha')::timestamptz > now() - interval '6 hours'))
  ORDER BY (s.ia_version = 0) DESC, s.severidad DESC, s.ultimo_cambio_en DESC
  LIMIT greatest(p_limit, 1)
$$;

-- 4. Costo con precios vigentes (USD por millón de tokens de entrada / salida)
CREATE OR REPLACE VIEW public.claude_cost_summary AS
 WITH cost_per_row AS (
   SELECT endpoint, model, created_at, input_tokens, output_tokens,
     (CASE
       WHEN model ~ 'sonnet-5'         THEN input_tokens * 2.0  + output_tokens * 10.0
       WHEN model ~ 'sonnet'           THEN input_tokens * 3.0  + output_tokens * 15.0
       WHEN model ~ 'haiku-4-5'        THEN input_tokens * 1.0  + output_tokens * 5.0
       WHEN model ~ 'haiku'            THEN input_tokens * 0.8  + output_tokens * 4.0
       WHEN model ~ 'opus-5-5'         THEN input_tokens * 4.0  + output_tokens * 20.0
       WHEN model ~ 'opus-(5|4-[5-8])' THEN input_tokens * 5.0  + output_tokens * 25.0
       WHEN model ~ 'opus'             THEN input_tokens * 15.0 + output_tokens * 75.0
       ELSE 0
     END / 1000000)::numeric AS cost_usd
   FROM token_usage
 )
 SELECT endpoint, model,
    count(*) AS calls,
    sum(input_tokens) AS total_input_tokens,
    sum(output_tokens) AS total_output_tokens,
    round(sum(cost_usd), 4) AS total_cost_usd,
    round(sum(cost_usd) FILTER (WHERE created_at > now() - interval '24 hours'), 4) AS cost_24h,
    round(sum(cost_usd) FILTER (WHERE created_at > now() - interval '7 days'), 4) AS cost_7d,
    round(sum(cost_usd) FILTER (WHERE created_at > now() - interval '30 days'), 4) AS cost_30d,
    count(*) FILTER (WHERE created_at > now() - interval '24 hours') AS calls_24h,
    max(created_at) AS last_call
   FROM cost_per_row
  GROUP BY endpoint, model
  ORDER BY round(sum(cost_usd) FILTER (WHERE created_at > now() - interval '7 days'), 4) DESC NULLS LAST;

INSERT INTO pipeline_logs (level, phase, message, details)
VALUES ('info', 'migration', 'Ahorro IA: sin parpadeo de señales vencidas, tolerancia con abs(valor), freno de 6 h al bot, precios vigentes en claude_cost_summary',
        jsonb_build_object('migration', '20260922a_ahorro_ia_situaciones'));
