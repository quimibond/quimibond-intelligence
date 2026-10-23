-- Situación: el correo diario deja de hablar de la plomería y prioriza por dinero (pedido del CEO 2026-10-23).
--
-- 1. situacion_es_ruido(): lo que no es de la empresa sino de nuestros sistemas. El área sistemas
--    (watchdog job_caido: "push de Odoo sin ejecutar"; tickets de TI), las nóminas piloto en
--    borrador (ya timbradas en NOI, no se validan en Odoo) y las aprobaciones que son cambios de
--    software (despliegues de módulos, PRs, "Cambios SGI"). Las situaciones siguen existiendo y se
--    pueden consultar; solo no entran a situacion_cambios (correo y narrativa).
-- 2. situacion_cambios(): mismo cuerpo que 20260924a con el filtro de ruido en el WHERE.
-- 3. situacion_negocio(): los montos del día que el prompt usa para ordenar por impacto (la
--    narrativa ponía en severidad 5 cuentas de $5 mil y callaba carteras de $2.6 M). Sale de
--    `senales` (el push diario de Odoo), una fila por empresa.
--
-- Rollback: volver a crear situacion_cambios de 20260924a y borrar las dos funciones nuevas.

CREATE OR REPLACE FUNCTION public.situacion_es_ruido(p_senal text, p_area text, p_titulo text, p_valor_texto text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(p_area, '') = 'sistemas'
      OR coalesce(p_senal, '') IN ('job_caido', 'ticket_abierto', 'nomina_borrador')
      OR concat_ws(' ', p_titulo, p_valor_texto) ~* '(despliegue|cambio en odoo|push de odoo|cambios sgi|c-sgi[0-9]|\mPR #[0-9]+)'
$$;

CREATE OR REPLACE FUNCTION public.situacion_cambios(p_desde timestamp with time zone DEFAULT (now() - '24:00:00'::interval))
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_out jsonb; v_hasta timestamptz := now(); v_areas jsonb := '[]'; a record; v_area jsonb; l text;
BEGIN
  p_desde := coalesce(p_desde, now() - interval '24 hours');   -- un NULL explícito (MCP/PostgREST) se salta el default
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
    AND NOT situacion_es_ruido(s.senal, s.area, s.titulo, s.valor_texto)
    AND (s.estado NOT IN ('resuelta', 'descartada') OR s.resuelta_en >= p_desde);

  FOR a IN SELECT DISTINCT area FROM _cambios WHERE lista IS NOT NULL ORDER BY area LOOP
    v_area := jsonb_build_object('area', a.area, 'abiertas', (SELECT count(*) FROM _cambios x WHERE x.area = a.area AND x.estado NOT IN ('resuelta', 'descartada')));
    -- Cada lista va recortada a 25 filas y al lado su conteo real (n_<lista>), para que el correo diga "25 de 209".
    FOREACH l IN ARRAY ARRAY['nuevas', 'empeoradas', 'mejoradas', 'resueltas', 'delegadas', 'graves'] LOOP
      v_area := v_area || jsonb_build_object('n_' || l, (SELECT count(*) FROM _cambios x WHERE x.area = a.area AND x.lista = l)) || jsonb_build_object(l, (
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
      -- Edad del último push de señales que SÍ terminó bien, leída de pipeline_logs (la vista odoo_push_last_events
      -- guarda solo el último evento por método: filtrarla por success daba NULL justo cuando el push falla).
      'odoo_push_edad_h', (SELECT round(extract(epoch FROM now() - max(created_at)) / 3600, 1) FROM pipeline_logs
                           WHERE phase = 'odoo_push' AND details->>'method' = 'senales' AND details->>'status' = 'success'),
      'odoo_push_status', (SELECT status FROM odoo_push_last_events WHERE method = 'senales'),
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
END $function$;

-- Montos del negocio para la narrativa: totales por señal y las empresas que más pesan.
CREATE OR REPLACE FUNCTION public.situacion_negocio()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH s AS (
    SELECT s.senal, s.valor, s.valor_texto,
           coalesce(c.name, situacion_nombre_agrupador(s.agrupador, s.company_id, s.odoo_partner_id, s.documentos)) AS empresa
    FROM senales s LEFT JOIN companies c ON c.id = s.company_id
    WHERE s.resuelta_en IS NULL AND coalesce(s.calidad, 'viva') NOT IN ('ignorada', 'zombie', 'dato_malo')
  ),
  top AS (
    SELECT senal, jsonb_agg(jsonb_build_object('empresa', empresa, 'monto', round(valor), 'detalle', left(valor_texto, 120)) ORDER BY abs(valor) DESC) AS filas
    FROM (SELECT *, row_number() OVER (PARTITION BY senal ORDER BY abs(valor) DESC NULLS LAST) AS rn
          FROM s WHERE senal IN ('cartera_vencida', 'cxp_vencida', 'entregado_sin_facturar', 'venta_margen_negativo', 'cliente_pierde', 'producto_pierde')) x
    WHERE rn <= 8
    GROUP BY senal
  )
  SELECT jsonb_build_object(
    'montos_mxn', (SELECT jsonb_object_agg(senal, jsonb_build_object('total', round(sum_v), 'empresas', n))
                   FROM (SELECT senal, sum(valor) AS sum_v, count(*) AS n FROM s
                         WHERE senal IN ('cartera_vencida', 'cxp_vencida', 'entregado_sin_facturar', 'venta_margen_negativo', 'cliente_pierde', 'producto_pierde')
                         GROUP BY senal) m),
    'conteos', (SELECT jsonb_object_agg(senal, n)
                FROM (SELECT senal, count(*) AS n FROM s
                      WHERE senal IN ('entrega_vencida', 'op_atrasada', 'op_sin_componentes', 'reclamacion_cliente', 'cliente_sin_respuesta', 'recepcion_vencida', 'pedido_sin_fecha')
                      GROUP BY senal) k),
    'principales', (SELECT jsonb_object_agg(senal, filas) FROM top)
  )
$function$;

INSERT INTO pipeline_logs (level, phase, message, details)
VALUES ('info', 'migration', 'Situación: correo diario sin ruido de sistemas y con montos del negocio (situacion_es_ruido, situacion_negocio)',
        jsonb_build_object('migration', '20261023a_situacion_digest_ceo'));
