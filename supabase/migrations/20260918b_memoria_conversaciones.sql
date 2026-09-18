-- Memoria Fase 3b: una conversación = un resumen.
--
-- Gmail asigna un hilo por buzón: el mismo intercambio con un cliente que
-- copia a innovacion@, aurelio@ e irma.luna@ son TRES threads con los mismos
-- Message-ID. En 30 días: 15,155 hilos de clientes/proveedores = 8,727
-- conversaciones. Resumirlos por separado triplica el costo y fragmenta la
-- memoria. Clave de conversación (threads.conv_key): el Message-ID raíz
-- (references_hdr[1] o message_id_hdr del correo más antiguo del hilo);
-- sin headers (ingest v1) cae al gmail_thread_id.
--
-- También: kg_refresh_deterministic fallaba con dos usuarios de Odoo que
-- comparten correo (tac@, almacen@) — DISTINCT ON por correo.

ALTER TABLE public.threads ADD COLUMN IF NOT EXISTS conv_key text;
CREATE INDEX IF NOT EXISTS threads_conv_key_idx ON public.threads (conv_key);
ALTER TABLE public.memoria_thread_summaries ADD COLUMN IF NOT EXISTS conv_key text;
ALTER TABLE public.memoria_thread_summaries ADD COLUMN IF NOT EXISTS thread_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
CREATE INDEX IF NOT EXISTS memoria_thread_summaries_conv_idx ON public.memoria_thread_summaries (conv_key);

CREATE OR REPLACE FUNCTION public.memoria_thread_conv_key(p_thread_id bigint)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    (SELECT coalesce(nullif(e.references_hdr[1], ''), e.message_id_hdr)
       FROM emails e WHERE e.thread_id = p_thread_id AND (e.message_id_hdr IS NOT NULL OR e.references_hdr IS NOT NULL)
       ORDER BY e.email_date, e.id LIMIT 1),
    (SELECT t.gmail_thread_id FROM threads t WHERE t.id = p_thread_id))
$$;
COMMENT ON FUNCTION public.memoria_thread_conv_key(bigint) IS 'Clave de conversación de un hilo: Message-ID raíz (references[1] o message_id del correo más antiguo); fallback gmail_thread_id.';

-- Backfill: hilos con actividad en 120 días.
UPDATE threads t SET conv_key = memoria_thread_conv_key(t.id)
WHERE t.conv_key IS NULL AND t.last_activity > now() - interval '120 days';

-- memoria_link_recent: además de los agregados, mantiene conv_key.
CREATE OR REPLACE FUNCTION public.memoria_link_recent(p_since interval DEFAULT interval '3 days')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_from timestamptz := now() - p_since;
  n_contacts int := 0; n_sender int := 0; n_company int := 0; n_internal int := 0; n_threads int := 0; n_stats int := 0;
BEGIN
  WITH ext AS (
    SELECT memoria_email_addr(e.sender) AS addr, memoria_email_name(e.sender) AS nm, min(e.email_date) AS first_at, max(e.email_date) AS last_at
    FROM emails e
    WHERE e.email_date >= v_from AND e.sender_type = 'external' AND e.sender_contact_id IS NULL
    GROUP BY 1, 2
  ), cand AS (
    SELECT DISTINCT ON (x.addr) x.addr, x.nm, x.first_at, x.last_at, c.id AS company_id
    FROM ext x
    JOIN companies c ON c.domain IS NOT NULL AND c.domain <> '' AND c.domain = split_part(x.addr, '@', 2)
                    AND c.odoo_partner_id IS NOT NULL
    WHERE x.addr LIKE '%@%' AND NOT memoria_generic_domain(split_part(x.addr, '@', 2))
      AND x.addr !~* '(no-?reply|postmaster|mailer-daemon|notificacion|notification|newsletter|donotreply|noreply|bounce)'
      AND NOT EXISTS (SELECT 1 FROM contacts k WHERE k.email = x.addr)
    ORDER BY x.addr, (c.is_customer OR c.is_supplier) DESC, c.lifetime_value DESC NULLS LAST, c.id
  )
  INSERT INTO contacts (email, name, company_id, contact_type, first_seen, last_activity, source_ref)
  SELECT addr, CASE WHEN nm IS NULL OR nm = addr THEN NULL ELSE left(nm, 120) END, company_id, 'external', first_at, last_at, 'memoria_link'
  FROM cand
  ON CONFLICT (email) DO NOTHING;
  GET DIAGNOSTICS n_contacts = ROW_COUNT;

  UPDATE emails e SET sender_contact_id = k.id
  FROM contacts k
  WHERE e.email_date >= v_from AND e.sender_contact_id IS NULL AND k.email = memoria_email_addr(e.sender);
  GET DIAGNOSTICS n_sender = ROW_COUNT;

  UPDATE emails e SET company_id = coalesce(k.company_id, (
      SELECT c.id FROM companies c
      WHERE c.domain IS NOT NULL AND c.domain <> '' AND c.odoo_partner_id IS NOT NULL
        AND c.domain = split_part(memoria_email_addr(e.sender), '@', 2)
        AND NOT memoria_generic_domain(c.domain)
      ORDER BY (c.is_customer OR c.is_supplier) DESC, c.lifetime_value DESC NULLS LAST, c.id LIMIT 1))
  FROM contacts k
  WHERE e.email_date >= v_from AND e.company_id IS NULL AND e.sender_type = 'external' AND k.id = e.sender_contact_id;
  GET DIAGNOSTICS n_company = ROW_COUNT;
  UPDATE emails e SET company_id = x.cid
  FROM (
    SELECT e2.id, (SELECT c.id FROM companies c
                   WHERE c.domain IS NOT NULL AND c.domain <> '' AND c.odoo_partner_id IS NOT NULL
                     AND c.domain = split_part(memoria_email_addr(e2.sender), '@', 2) AND NOT memoria_generic_domain(c.domain)
                   ORDER BY (c.is_customer OR c.is_supplier) DESC, c.lifetime_value DESC NULLS LAST, c.id LIMIT 1) AS cid
    FROM emails e2
    WHERE e2.email_date >= v_from AND e2.company_id IS NULL AND e2.sender_type = 'external' AND e2.sender LIKE '%@%'
  ) x
  WHERE x.id = e.id AND x.cid IS NOT NULL;
  GET DIAGNOSTICS n_internal = ROW_COUNT;
  n_company := n_company + n_internal;

  UPDATE emails e SET company_id = x.company_id
  FROM (
    SELECT e2.id, coalesce(k.company_id, (
        SELECT c.id FROM companies c
        WHERE c.domain IS NOT NULL AND c.domain <> '' AND c.odoo_partner_id IS NOT NULL
          AND c.domain = split_part(memoria_email_addr(e2.recipient), '@', 2) AND NOT memoria_generic_domain(c.domain)
        ORDER BY (c.is_customer OR c.is_supplier) DESC, c.lifetime_value DESC NULLS LAST, c.id LIMIT 1)) AS company_id
    FROM emails e2
    LEFT JOIN contacts k ON k.email = memoria_email_addr(e2.recipient)
    WHERE e2.email_date >= v_from AND e2.company_id IS NULL AND e2.sender_type = 'internal' AND e2.recipient LIKE '%@%'
  ) x
  WHERE x.id = e.id AND x.company_id IS NOT NULL;
  GET DIAGNOSTICS n_internal = ROW_COUNT;

  WITH touched AS (
    SELECT DISTINCT thread_id FROM emails WHERE email_date >= v_from AND thread_id IS NOT NULL
  ), agg AS (
    SELECT e.thread_id,
           count(*)::int AS message_count,
           min(e.email_date) AS started_at, max(e.email_date) AS last_activity,
           (array_agg(memoria_email_addr(e.sender) ORDER BY e.email_date))[1] AS started_by,
           (array_agg(e.sender_type ORDER BY e.email_date))[1] AS started_by_type,
           (array_agg(e.sender_contact_id ORDER BY e.email_date))[1] AS started_by_contact_id,
           (array_agg(memoria_email_addr(e.sender) ORDER BY e.email_date DESC))[1] AS last_sender,
           (array_agg(e.sender_type ORDER BY e.email_date DESC))[1] AS last_sender_type,
           array_agg(DISTINCT memoria_email_addr(e.sender)) FILTER (WHERE e.sender IS NOT NULL) AS participant_emails,
           bool_or(e.sender_type = 'internal') AS has_internal_reply,
           bool_or(e.sender_type = 'external') AS has_external_reply,
           (array_agg(coalesce(nullif(e.references_hdr[1], ''), e.message_id_hdr) ORDER BY e.email_date, e.id)
              FILTER (WHERE e.message_id_hdr IS NOT NULL OR e.references_hdr IS NOT NULL))[1] AS conv_key,
           (SELECT e3.company_id FROM emails e3 WHERE e3.thread_id = e.thread_id AND e3.company_id IS NOT NULL
             GROUP BY e3.company_id ORDER BY bool_or(e3.sender_type = 'external') DESC, count(*) DESC, e3.company_id LIMIT 1) AS company_id
    FROM emails e
    JOIN touched t ON t.thread_id = e.thread_id
    GROUP BY e.thread_id
  )
  UPDATE threads t SET
    message_count = a.message_count, started_at = a.started_at, last_activity = a.last_activity,
    started_by = coalesce(a.started_by, t.started_by), started_by_type = coalesce(a.started_by_type, t.started_by_type),
    started_by_contact_id = coalesce(a.started_by_contact_id, t.started_by_contact_id),
    last_sender = coalesce(a.last_sender, t.last_sender), last_sender_type = coalesce(a.last_sender_type, t.last_sender_type),
    participant_emails = a.participant_emails,
    has_internal_reply = a.has_internal_reply, has_external_reply = a.has_external_reply,
    hours_without_response = CASE WHEN a.last_sender_type = 'external' THEN round(extract(epoch FROM now() - a.last_activity) / 3600, 1) ELSE 0 END,
    status = CASE WHEN a.last_sender_type = 'external' AND now() - a.last_activity > interval '48 hours' THEN 'stalled'
                  WHEN a.last_sender_type = 'external' AND now() - a.last_activity > interval '24 hours' THEN 'needs_response'
                  WHEN a.message_count = 1 THEN 'new' ELSE 'active' END,
    company_id = coalesce(t.company_id, a.company_id),
    conv_key = coalesce(a.conv_key, t.conv_key, t.gmail_thread_id),
    updated_at = now()
  FROM agg a
  WHERE a.thread_id = t.id;
  GET DIAGNOSTICS n_threads = ROW_COUNT;

  UPDATE contacts k SET last_activity = s.last_at, interaction_count = s.n, updated_at = now()
  FROM (
    SELECT e.sender_contact_id AS id, max(e.email_date) AS last_at, count(*)::int AS n
    FROM emails e
    WHERE e.sender_contact_id IN (SELECT DISTINCT sender_contact_id FROM emails WHERE email_date >= v_from AND sender_contact_id IS NOT NULL)
    GROUP BY e.sender_contact_id
  ) s
  WHERE s.id = k.id AND (k.last_activity IS DISTINCT FROM s.last_at OR k.interaction_count IS DISTINCT FROM s.n);
  GET DIAGNOSTICS n_stats = ROW_COUNT;

  RETURN jsonb_build_object('since', v_from, 'contacts_new', n_contacts, 'emails_contact', n_sender,
                            'emails_company_external', n_company, 'emails_company_internal', n_internal,
                            'threads_updated', n_threads, 'contacts_stats', n_stats);
END;
$$;

-- kg_refresh_deterministic: DISTINCT ON por correo en usuarios y buzones.
CREATE OR REPLACE FUNCTION public.kg_refresh_deterministic()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_started timestamptz := now();
  v_clock timestamptz := clock_timestamp();
  n_emp int; n_con int; n_buz int; n_usr int; n_edges int := 0; n_pruned int;
BEGIN
  INSERT INTO kg_nodes (kind, key, name, props)
  SELECT 'empresa', c.id::text, c.name,
         jsonb_strip_nulls(jsonb_build_object('odoo_partner_id', c.odoo_partner_id, 'rfc', c.rfc, 'domain', c.domain,
           'is_customer', c.is_customer, 'is_supplier', c.is_supplier, 'payment_term', c.payment_term, 'city', c.city, 'country', c.country))
  FROM companies c WHERE c.odoo_partner_id IS NOT NULL
  ON CONFLICT (kind, key) DO UPDATE SET name = EXCLUDED.name, props = kg_nodes.props || EXCLUDED.props, last_seen = now();
  GET DIAGNOSTICS n_emp = ROW_COUNT;

  INSERT INTO kg_nodes (kind, key, name, props)
  SELECT 'contacto', k.email, k.name,
         jsonb_strip_nulls(jsonb_build_object('company_id', k.company_id, 'rol', k.role, 'departamento', k.department,
           'odoo_partner_id', k.odoo_partner_id, 'interacciones', k.interaction_count, 'ultimo_correo', k.last_activity))
  FROM contacts k JOIN companies c ON c.id = k.company_id AND c.odoo_partner_id IS NOT NULL
  WHERE k.email IS NOT NULL AND coalesce(k.contact_type, 'external') <> 'noise'
  ON CONFLICT (kind, key) DO UPDATE SET name = coalesce(EXCLUDED.name, kg_nodes.name), props = kg_nodes.props || EXCLUDED.props, last_seen = now();
  GET DIAGNOSTICS n_con = ROW_COUNT;

  INSERT INTO kg_nodes (kind, key, name, props)
  SELECT DISTINCT ON (lower(g.email)) 'buzon', lower(g.email), lower(g.email),
         jsonb_strip_nulls(jsonb_build_object('departamento', g.department, 'activo', g.active))
  FROM gmail_accounts g
  ORDER BY lower(g.email), g.active DESC
  ON CONFLICT (kind, key) DO UPDATE SET props = kg_nodes.props || EXCLUDED.props, last_seen = now();
  GET DIAGNOSTICS n_buz = ROW_COUNT;

  INSERT INTO kg_nodes (kind, key, name, props)
  SELECT DISTINCT ON (lower(u.email)) 'usuario', lower(u.email), u.name,
         jsonb_strip_nulls(jsonb_build_object('odoo_user_id', u.odoo_user_id, 'departamento', u.department, 'puesto', u.job_title))
  FROM odoo_users u WHERE u.email IS NOT NULL
  ORDER BY lower(u.email), u.updated_at DESC NULLS LAST, u.odoo_user_id
  ON CONFLICT (kind, key) DO UPDATE SET name = EXCLUDED.name, props = kg_nodes.props || EXCLUDED.props, last_seen = now();
  GET DIAGNOSTICS n_usr = ROW_COUNT;

  INSERT INTO kg_edges (src, dst, rel, weight, props)
  SELECT nc.id, ne.id, 'trabaja_en', greatest(coalesce(k.interaction_count, 0), 1), jsonb_strip_nulls(jsonb_build_object('rol', k.role))
  FROM contacts k
  JOIN kg_nodes nc ON nc.kind = 'contacto' AND nc.key = k.email
  JOIN kg_nodes ne ON ne.kind = 'empresa' AND ne.key = k.company_id::text
  ON CONFLICT (src, dst, rel) DO UPDATE SET weight = EXCLUDED.weight, props = kg_edges.props || EXCLUDED.props, last_seen = now();
  GET DIAGNOSTICS n_edges = ROW_COUNT;

  INSERT INTO kg_edges (src, dst, rel)
  SELECT nu.id, nb.id, 'persona_de'
  FROM kg_nodes nu JOIN kg_nodes nb ON nb.kind = 'buzon' AND nb.key = nu.key
  WHERE nu.kind = 'usuario'
  ON CONFLICT (src, dst, rel) DO UPDATE SET last_seen = now();

  INSERT INTO kg_edges (src, dst, rel, weight, props)
  SELECT nb.id, ne.id, CASE WHEN m.area IS NULL THEN 'atiende' ELSE 'atiende:' || m.area END, m.n,
         jsonb_build_object('share', m.share, 'rank', m.rank, 'last_at', m.last_at)
  FROM memoria_encargados m
  JOIN kg_nodes nb ON nb.kind = 'buzon' AND nb.key = m.mailbox
  JOIN kg_nodes ne ON ne.kind = 'empresa' AND ne.key = m.company_id::text
  WHERE m.rank <= 3
  ON CONFLICT (src, dst, rel) DO UPDATE SET weight = EXCLUDED.weight, props = kg_edges.props || EXCLUDED.props, last_seen = now();

  INSERT INTO kg_edges (src, dst, rel, weight, props)
  SELECT nc.id, nb.id, 'escribe_a', s.n, jsonb_build_object('last_at', s.last_at)
  FROM (
    SELECT e.sender_contact_id, lower(e.account) AS account, count(*)::int AS n, max(e.email_date) AS last_at
    FROM emails e WHERE e.sender_type = 'external' AND e.sender_contact_id IS NOT NULL AND e.email_date > now() - interval '180 days'
    GROUP BY 1, 2
  ) s
  JOIN contacts k ON k.id = s.sender_contact_id
  JOIN kg_nodes nc ON nc.kind = 'contacto' AND nc.key = k.email
  JOIN kg_nodes nb ON nb.kind = 'buzon' AND nb.key = s.account
  ON CONFLICT (src, dst, rel) DO UPDATE SET weight = EXCLUDED.weight, props = kg_edges.props || EXCLUDED.props, last_seen = now();

  DELETE FROM kg_edges
  WHERE source = 'determinista' AND last_seen < v_started
    AND (rel IN ('trabaja_en', 'persona_de', 'escribe_a') OR rel LIKE 'atiende%');
  GET DIAGNOSTICS n_pruned = ROW_COUNT;

  RETURN jsonb_build_object('empresas', n_emp, 'contactos', n_con, 'buzones', n_buz, 'usuarios', n_usr,
                            'trabaja_en', n_edges, 'pruned', n_pruned, 'ms', round(extract(epoch FROM clock_timestamp() - v_clock) * 1000));
END;
$$;

-- Qué consolidar: una fila por conversación (hilo canónico = menor id), con
-- la actividad máxima entre sus hilos hermanos y sus ids.
DROP FUNCTION IF EXISTS public.memoria_hilos_pendientes(int, int);
CREATE OR REPLACE FUNCTION public.memoria_hilos_pendientes(p_days int DEFAULT 120, p_limit int DEFAULT 20)
RETURNS TABLE (thread_id bigint, conv_key text, thread_ids bigint[], subject text, account text, company_id bigint, company_name text,
               is_customer boolean, is_supplier boolean, message_count int, last_activity timestamptz,
               summarized_through timestamptz, prev_version int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH cand AS (
    SELECT t.id, coalesce(t.conv_key, t.gmail_thread_id, t.id::text) AS ck, t.company_id, t.last_activity, t.message_count
    FROM threads t
    JOIN companies c ON c.id = t.company_id AND c.odoo_partner_id IS NOT NULL AND (c.is_customer OR c.is_supplier)
    WHERE t.last_activity > now() - make_interval(days => p_days)
      AND coalesce(t.last_sender, '') !~* '(no-?reply|postmaster|mailer-daemon|notificacion|notification|newsletter|digest|automated|donotreply)'
      AND coalesce(t.subject, '') !~* '^(accepted|aceptado|invitación actualizada|updated invitation|delivery status|undeliverable)'
  ), conv AS (
    SELECT ck, min(id) AS thread_id, max(last_activity) AS last_activity, max(message_count) AS message_count,
           array_agg(id ORDER BY id) AS thread_ids
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
  WHERE s.summarized_through IS NULL OR s.summarized_through < conv.last_activity
  ORDER BY (s.summarized_through IS NOT NULL) DESC, (conv.message_count >= 2) DESC, conv.last_activity DESC
  LIMIT p_limit
$$;
REVOKE ALL ON FUNCTION public.memoria_hilos_pendientes(int, int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.memoria_hilos_pendientes(int, int) TO service_role;
COMMENT ON FUNCTION public.memoria_hilos_pendientes(int, int) IS 'Conversaciones de clientes/proveedores con correo posterior al último resumen: una fila por conversación (hilo canónico + hilos hermanos por buzón).';

-- Mensajes de una conversación, sin duplicar el mismo correo visto por varios buzones.
CREATE OR REPLACE FUNCTION public.memoria_hilo_mensajes(p_thread_ids bigint[], p_limit int DEFAULT 40)
RETURNS TABLE (id bigint, thread_id bigint, account text, email_date timestamptz, sender text, sender_type text, recipient text,
               cc text, subject text, cuerpo text, adjuntos text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT * FROM (
    SELECT DISTINCT ON (coalesce(e.message_id_hdr, e.gmail_message_id, e.id::text))
           e.id, e.thread_id, e.account, e.email_date, e.sender, e.sender_type, e.recipient, e.cc, e.subject,
           left(coalesce(nullif(e.body_clean, ''), nullif(e.body, ''), e.snippet, ''), 6000) AS cuerpo,
           (SELECT string_agg(a->>'filename', ', ') FROM jsonb_array_elements(CASE WHEN jsonb_typeof(e.attachments) = 'array' THEN e.attachments ELSE '[]'::jsonb END) a) AS adjuntos
    FROM emails e
    WHERE e.thread_id = ANY (p_thread_ids)
    ORDER BY coalesce(e.message_id_hdr, e.gmail_message_id, e.id::text), e.ingest_version DESC, e.id
  ) m
  ORDER BY m.email_date DESC, m.id DESC
  LIMIT greatest(p_limit, 1)
$$;
REVOKE ALL ON FUNCTION public.memoria_hilo_mensajes(bigint[], int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.memoria_hilo_mensajes(bigint[], int) TO service_role;

-- Guardar consolidación: además registra conv_key y thread_ids.
CREATE OR REPLACE FUNCTION public.memoria_guardar_consolidacion(p_thread_id bigint, p jsonb, p_model text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  t record; n_hilo bigint; n_emp bigint; n_node bigint; f jsonb; pr jsonb; h text; d date;
  n_facts int := 0; n_people int := 0; v_email_ids jsonb; v_through timestamptz; v_seen int; v_ck text; v_tids jsonb;
BEGIN
  SELECT * INTO t FROM threads WHERE id = p_thread_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'thread % no existe', p_thread_id; END IF;
  v_through := coalesce((p->>'summarized_through')::timestamptz, t.last_activity);
  v_seen := coalesce((p->>'emails_seen')::int, t.message_count);
  v_email_ids := coalesce(p->'email_ids', '[]'::jsonb);
  v_ck := coalesce(p->>'conv_key', t.conv_key, t.gmail_thread_id);
  v_tids := CASE WHEN jsonb_typeof(p->'thread_ids') = 'array' THEN p->'thread_ids' ELSE jsonb_build_array(p_thread_id) END;

  INSERT INTO memoria_thread_summaries AS s (thread_id, company_id, account, tema, resumen, estado, esperando_a, tono, acuerdos, pendientes,
                                             summarized_through, emails_seen, model, conv_key, thread_ids)
  VALUES (p_thread_id, t.company_id, t.account, left(p->>'tema', 160), coalesce(p->>'resumen', ''),
          CASE WHEN p->>'estado' IN ('abierto','cerrado','informativo') THEN p->>'estado' ELSE 'abierto' END,
          CASE WHEN p->>'esperando_a' IN ('nosotros','ellos','nadie') THEN p->>'esperando_a' END,
          CASE WHEN p->>'tono' IN ('positivo','neutral','tenso') THEN p->>'tono' END,
          coalesce(p->'acuerdos', '[]'::jsonb), coalesce(p->'pendientes', '[]'::jsonb), v_through, v_seen, p_model, v_ck, v_tids)
  ON CONFLICT (thread_id) DO UPDATE SET
    company_id = EXCLUDED.company_id, account = EXCLUDED.account, tema = EXCLUDED.tema, resumen = EXCLUDED.resumen,
    estado = EXCLUDED.estado, esperando_a = EXCLUDED.esperando_a, tono = EXCLUDED.tono, acuerdos = EXCLUDED.acuerdos,
    pendientes = EXCLUDED.pendientes, summarized_through = EXCLUDED.summarized_through, emails_seen = EXCLUDED.emails_seen,
    model = EXCLUDED.model, conv_key = EXCLUDED.conv_key, thread_ids = EXCLUDED.thread_ids, version = s.version + 1, updated_at = now();

  n_hilo := kg_upsert_node('hilo', p_thread_id::text, left(coalesce(p->>'tema', t.subject), 160),
                           jsonb_strip_nulls(jsonb_build_object('account', t.account, 'estado', p->>'estado', 'last_activity', t.last_activity,
                                                                'conv_key', v_ck, 'thread_ids', v_tids)), 'claude');
  IF t.company_id IS NOT NULL THEN
    n_emp := kg_upsert_node('empresa', t.company_id::text, (SELECT name FROM companies WHERE id = t.company_id), '{}'::jsonb, 'determinista');
    PERFORM kg_upsert_edge(n_hilo, n_emp, 'sobre', 1, '{}'::jsonb, v_email_ids, 'claude');
  END IF;

  FOR pr IN SELECT * FROM jsonb_array_elements(coalesce(p->'personas', '[]'::jsonb)) LOOP
    CONTINUE WHEN pr->>'email' IS NULL OR pr->>'email' !~ '@';
    IF pr->>'lado' = 'quimibond' OR lower(pr->>'email') ~ '@quimibond\.com(\.mx)?$' THEN
      n_node := (SELECT id FROM kg_nodes WHERE kind IN ('buzon', 'usuario') AND key = lower(pr->>'email') ORDER BY (kind = 'usuario') DESC LIMIT 1);
    ELSE
      n_node := kg_upsert_node('contacto', lower(pr->>'email'), nullif(left(pr->>'nombre', 120), ''),
                               jsonb_strip_nulls(jsonb_build_object('rol', nullif(left(pr->>'rol', 120), ''))), 'claude');
      IF n_emp IS NOT NULL AND NOT EXISTS (SELECT 1 FROM kg_edges WHERE src = n_node AND rel = 'trabaja_en') THEN
        PERFORM kg_upsert_edge(n_node, n_emp, 'trabaja_en', 1, jsonb_strip_nulls(jsonb_build_object('rol', pr->>'rol')), v_email_ids, 'claude');
      END IF;
      UPDATE contacts SET role = left(pr->>'rol', 120) WHERE email = lower(pr->>'email') AND role IS NULL AND nullif(pr->>'rol', '') IS NOT NULL;
    END IF;
    IF n_node IS NOT NULL THEN
      PERFORM kg_upsert_edge(n_node, n_hilo, 'participa', 1, '{}'::jsonb, v_email_ids, 'claude');
      n_people := n_people + 1;
    END IF;
  END LOOP;

  FOR f IN SELECT * FROM jsonb_array_elements(coalesce(p->'hechos', '[]'::jsonb)) LOOP
    CONTINUE WHEN nullif(trim(f->>'hecho'), '') IS NULL;
    IF f->>'sobre' = 'contacto' AND f->>'email' ~ '@' THEN
      n_node := (SELECT id FROM kg_nodes WHERE kind = 'contacto' AND key = lower(f->>'email'));
    ELSE
      n_node := n_emp;
    END IF;
    CONTINUE WHEN n_node IS NULL;
    h := md5(lower(regexp_replace(f->>'hecho', '\s+', ' ', 'g')));
    d := CASE WHEN f->>'vigente_desde' ~ '^\d{4}-\d{2}-\d{2}$' THEN (f->>'vigente_desde')::date END;
    INSERT INTO memoria_facts AS mf (node_id, categoria, hecho, hecho_hash, vigente_desde, evidencia, confianza)
    VALUES (n_node, CASE WHEN f->>'categoria' IN ('condiciones_pago','precio','producto','logistica','calidad','contacto_clave','proceso','preferencia','riesgo','otro')
                         THEN f->>'categoria' ELSE 'otro' END,
            left(trim(f->>'hecho'), 400), h, d, jsonb_build_array(jsonb_build_object('thread_id', p_thread_id, 'email_ids', v_email_ids)),
            least(greatest(coalesce((f->>'confianza')::numeric, 0.7), 0.1), 1))
    ON CONFLICT (node_id, hecho_hash) DO UPDATE SET
      veces = mf.veces + 1, vigente_desde = coalesce(EXCLUDED.vigente_desde, mf.vigente_desde),
      evidencia = (SELECT coalesce(jsonb_agg(s.val), '[]'::jsonb) FROM (SELECT val FROM jsonb_array_elements(mf.evidencia || EXCLUDED.evidencia) AS x(val) LIMIT 20) s),
      confianza = least(mf.confianza + 0.1, 1), updated_at = now();
    n_facts := n_facts + 1;
  END LOOP;

  RETURN jsonb_build_object('thread_id', p_thread_id, 'hechos', n_facts, 'personas', n_people, 'hilo_node', n_hilo, 'empresa_node', n_emp);
END;
$$;

INSERT INTO pipeline_logs (level, phase, message, details)
VALUES ('info', 'migration', 'Memoria Fase 3b: conv_key en threads (una conversación = un resumen), memoria_hilo_mensajes, kg_refresh sin duplicados de correo',
        jsonb_build_object('migration', '20260918b_memoria_conversaciones'));
