-- Memoria Fase 3c: qué entra a la cola de consolidación.
--
-- Primera hora en producción (119 llamadas): los resúmenes salen bien, pero
-- (1) entraban conversaciones 100 % internas ligadas a "empresas" que son
-- empleados dados de alta como partner (viáticos, asistencias) o el banco;
-- (2) 31,680 conversaciones en 120 días, de las cuales 4,799 tienen más de un
-- correo. Un hilo de un solo correo solo vale la pena si es reciente y lo
-- escribió la contraparte (una solicitud nueva). Con esto la cola queda en
-- ~5,800 conversaciones (≈ 1 día a 10 cada 5 min) y el gasto baja 5×.

DROP FUNCTION IF EXISTS public.memoria_hilos_pendientes(int, int);
CREATE OR REPLACE FUNCTION public.memoria_hilos_pendientes(p_days int DEFAULT 120, p_limit int DEFAULT 20)
RETURNS TABLE (thread_id bigint, conv_key text, thread_ids bigint[], subject text, account text, company_id bigint, company_name text,
               is_customer boolean, is_supplier boolean, message_count int, last_activity timestamptz,
               summarized_through timestamptz, prev_version int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH cand AS (
    SELECT t.id, coalesce(t.conv_key, t.gmail_thread_id, t.id::text) AS ck, t.company_id, t.last_activity, t.message_count,
           t.has_external_reply, t.last_sender_type
    FROM threads t
    JOIN companies c ON c.id = t.company_id AND c.odoo_partner_id IS NOT NULL AND (c.is_customer OR c.is_supplier)
                    AND NOT memoria_generic_domain(coalesce(nullif(c.domain, ''), 'sin-dominio.x'))
    WHERE t.last_activity > now() - make_interval(days => p_days)
      AND coalesce(t.last_sender, '') !~* '(no-?reply|postmaster|mailer-daemon|notificacion|notification|newsletter|digest|automated|donotreply)'
      AND coalesce(t.subject, '') !~* '^(accepted|aceptado|invitación actualizada|updated invitation|delivery status|undeliverable)'
  ), conv AS (
    SELECT ck, min(id) AS thread_id, max(last_activity) AS last_activity, max(message_count) AS message_count,
           array_agg(id ORDER BY id) AS thread_ids,
           bool_or(has_external_reply) AS has_external,
           bool_or(last_sender_type = 'external') AS last_external
    FROM cand GROUP BY ck
  )
  SELECT conv.thread_id, conv.ck, conv.thread_ids, t.subject, t.account, t.company_id, c.name, c.is_customer, c.is_supplier,
         conv.message_count, conv.last_activity, s.summarized_through, s.version
  FROM conv
  JOIN threads t ON t.id = conv.thread_id
  JOIN companies c ON c.id = t.company_id
  LEFT JOIN LATERAL (
    SELECT ms.summarized_through, ms.version FROM memoria_thread_summaries ms
    WHERE ms.conv_key = conv.ck OR ms.thread_id = ANY (conv.thread_ids)
    ORDER BY ms.summarized_through DESC LIMIT 1) s ON true
  WHERE conv.has_external                                            -- alguien de fuera participó
    AND (conv.message_count >= 2                                     -- conversación real
         OR (conv.last_external AND conv.last_activity > now() - interval '14 days'))  -- o solicitud nueva
    AND (s.summarized_through IS NULL OR s.summarized_through < conv.last_activity)
  ORDER BY (s.summarized_through IS NOT NULL) DESC, (conv.message_count >= 2) DESC, conv.last_activity DESC
  LIMIT p_limit
$$;
REVOKE ALL ON FUNCTION public.memoria_hilos_pendientes(int, int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.memoria_hilos_pendientes(int, int) TO service_role;
COMMENT ON FUNCTION public.memoria_hilos_pendientes(int, int) IS
  'Cola de consolidación: conversaciones de clientes/proveedores de Odoo (dominio no genérico) con alguien de fuera, de 2+ correos o de 1 correo reciente de la contraparte, con correo posterior al último resumen. Una fila por conversación.';

INSERT INTO pipeline_logs (level, phase, message, details)
VALUES ('info', 'migration', 'Memoria Fase 3c: cola de consolidación solo con conversaciones externas (2+ correos, o 1 reciente de la contraparte)',
        jsonb_build_object('migration', '20260918c_memoria_cola'));
