-- Memoria Fase 3: ligas determinísticas, resumen vivo por hilo, hechos con
-- vigencia y grafo de conocimiento (nodos + aristas con evidencia).
--
-- Diagnóstico 2026-09-18 que motiva la parte A: el ingest v2 crea hilos pero
-- no liga sender_contact_id (0 % desde el 14-sep) ni threads.company_id
-- (9 hilos con empresa de 17,530 en 30 días); el trigger por dominio solo
-- toca emails.company_id (31 %) y los pipelines viejos de Vercel que
-- completaban las ligas están apagados. Sin ligas no hay memoria por empresa.
--
-- A. memoria_link_recent(): contactos nuevos por dominio de empresa de Odoo,
--    sender_contact_id, company_id (contacto > dominio; internos por
--    destinatario), agregados del hilo recomputados desde emails
--    (message_count, last_*, status, company_id, started_by_contact_id) y
--    ritmo del contacto. pg_cron memoria_ligas cada 10 min.
-- B. kg_nodes / kg_edges (unique por kind+key y src+dst+rel; evidencia jsonb),
--    memoria_facts (hechos con vigencia por nodo), memoria_thread_summaries.
-- C. kg_refresh_deterministic(): empresas de Odoo, contactos, buzones,
--    usuarios y las aristas trabaja_en / persona_de / atiende / escribe_a
--    desde los datos, cada noche (memoria_grafo_nocturno).
-- D. memoria_hilos_pendientes() (qué consolidar), memoria_guardar_consolidacion()
--    (escribe lo que devuelve Claude: resumen, hechos, personas, aristas),
--    memoria_brief() (ficha por empresa para Odoo y MCP), memoria_buscar()
--    (búsqueda en resúmenes y hechos). Job memoria_consolidar (*/5) →
--    Edge Function memory-consolidate.

-- ───────────────────────── A. Ligas determinísticas ─────────────────────────

CREATE OR REPLACE FUNCTION public.memoria_email_addr(p text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT nullif(lower(trim(both ' "''<>' from split_part(regexp_replace(coalesce(p, ''), '^.*<([^>]+)>.*$', '\1'), ',', 1))), '')
$$;
COMMENT ON FUNCTION public.memoria_email_addr(text) IS 'Dirección en minúsculas de un header From/To ("Nombre <a@b.c>" → a@b.c; listas: la primera).';

CREATE OR REPLACE FUNCTION public.memoria_email_name(p text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT nullif(trim(both ' "''' from regexp_replace(coalesce(p, ''), '\s*<[^>]*>\s*$', '')), '')
$$;

CREATE OR REPLACE FUNCTION public.memoria_generic_domain(p_domain text)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT p_domain IS NULL OR p_domain = ANY (ARRAY[
    'gmail.com','googlemail.com','hotmail.com','hotmail.es','outlook.com','outlook.es','live.com','live.com.mx',
    'yahoo.com','yahoo.com.mx','icloud.com','me.com','msn.com','prodigy.net.mx','aol.com','protonmail.com',
    'quimibond.com','quimibond.com.mx'])
$$;

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
  -- 1. Contactos nuevos: remitentes externos cuyo dominio es de una empresa de Odoo.
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

  -- 2. sender_contact_id por dirección exacta.
  UPDATE emails e SET sender_contact_id = k.id
  FROM contacts k
  WHERE e.email_date >= v_from AND e.sender_contact_id IS NULL AND k.email = memoria_email_addr(e.sender);
  GET DIAGNOSTICS n_sender = ROW_COUNT;

  -- 3a. company_id externos: por contacto, luego por dominio (solo empresas de Odoo).
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

  -- 3b. company_id internos: por el primer destinatario externo (contacto o dominio).
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

  -- 4. Agregados del hilo desde sus correos (el ingest solo ve el lote que trae).
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
    updated_at = now()
  FROM agg a
  WHERE a.thread_id = t.id;
  GET DIAGNOSTICS n_threads = ROW_COUNT;

  -- 5. Ritmo del contacto (lo lee la pestaña Memoria de Odoo).
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
REVOKE ALL ON FUNCTION public.memoria_link_recent(interval) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.memoria_link_recent(interval) TO service_role;
COMMENT ON FUNCTION public.memoria_link_recent(interval) IS
  'Ligas determinísticas del correo reciente: contactos nuevos por dominio de empresa de Odoo, sender_contact_id, company_id, agregados del hilo y ritmo del contacto. pg_cron memoria_ligas cada 10 min.';

-- ───────────────────────── B. Grafo, hechos y resúmenes ─────────────────────

CREATE TABLE IF NOT EXISTS public.kg_nodes (
  id          bigserial PRIMARY KEY,
  kind        text NOT NULL CHECK (kind IN ('empresa','contacto','usuario','buzon','hilo','producto','tema')),
  key         text NOT NULL,
  name        text,
  props       jsonb NOT NULL DEFAULT '{}'::jsonb,
  source      text NOT NULL DEFAULT 'determinista',
  first_seen  timestamptz NOT NULL DEFAULT now(),
  last_seen   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, key)
);
COMMENT ON TABLE public.kg_nodes IS 'Grafo de conocimiento: nodos (empresa=companies.id, contacto=email, usuario=email Odoo, buzon=gmail_accounts.email, hilo=threads.id, producto=ref, tema=slug).';
CREATE INDEX IF NOT EXISTS kg_nodes_name_idx ON public.kg_nodes USING gin (to_tsvector('spanish', coalesce(name, '')));

CREATE TABLE IF NOT EXISTS public.kg_edges (
  id          bigserial PRIMARY KEY,
  src         bigint NOT NULL REFERENCES public.kg_nodes(id) ON DELETE CASCADE,
  dst         bigint NOT NULL REFERENCES public.kg_nodes(id) ON DELETE CASCADE,
  rel         text NOT NULL,
  weight      numeric NOT NULL DEFAULT 1,
  props       jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence    jsonb NOT NULL DEFAULT '[]'::jsonb,
  source      text NOT NULL DEFAULT 'determinista',
  first_seen  timestamptz NOT NULL DEFAULT now(),
  last_seen   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (src, dst, rel)
);
CREATE INDEX IF NOT EXISTS kg_edges_dst_idx ON public.kg_edges (dst, rel);
CREATE INDEX IF NOT EXISTS kg_edges_src_idx ON public.kg_edges (src, rel);
COMMENT ON TABLE public.kg_edges IS 'Aristas: trabaja_en (contacto→empresa), persona_de (usuario→buzon), atiende / atiende:<area> (buzon→empresa), escribe_a (contacto→buzon), sobre (hilo→empresa), participa (contacto|buzon→hilo), menciona (hilo→producto|tema). evidence: ids de correo/hilo.';

CREATE TABLE IF NOT EXISTS public.memoria_facts (
  id            bigserial PRIMARY KEY,
  node_id       bigint NOT NULL REFERENCES public.kg_nodes(id) ON DELETE CASCADE,
  categoria     text NOT NULL CHECK (categoria IN ('condiciones_pago','precio','producto','logistica','calidad','contacto_clave','proceso','preferencia','riesgo','otro')),
  hecho         text NOT NULL,
  hecho_hash    text NOT NULL,
  vigente_desde date,
  vigente_hasta date,
  status        text NOT NULL DEFAULT 'vigente' CHECK (status IN ('vigente','superado','dudoso')),
  confianza     numeric NOT NULL DEFAULT 0.7,
  evidencia     jsonb NOT NULL DEFAULT '[]'::jsonb,
  veces         int NOT NULL DEFAULT 1,
  source        text NOT NULL DEFAULT 'claude',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (node_id, hecho_hash)
);
CREATE INDEX IF NOT EXISTS memoria_facts_node_idx ON public.memoria_facts (node_id, status);
CREATE INDEX IF NOT EXISTS memoria_facts_tsv_idx ON public.memoria_facts USING gin (to_tsvector('spanish', hecho));
COMMENT ON TABLE public.memoria_facts IS 'Hechos con vigencia sobre un nodo (empresa/contacto), con categoría, evidencia (hilo/correos) y cuántas veces se confirmó. Dedup por hash del texto.';

CREATE TABLE IF NOT EXISTS public.memoria_thread_summaries (
  thread_id           bigint PRIMARY KEY REFERENCES public.threads(id) ON DELETE CASCADE,
  company_id          bigint,
  account             text,
  tema                text,
  resumen             text NOT NULL,
  estado              text NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto','cerrado','informativo')),
  esperando_a         text CHECK (esperando_a IN ('nosotros','ellos','nadie')),
  tono                text CHECK (tono IN ('positivo','neutral','tenso')),
  acuerdos            jsonb NOT NULL DEFAULT '[]'::jsonb,
  pendientes          jsonb NOT NULL DEFAULT '[]'::jsonb,
  summarized_through  timestamptz NOT NULL,
  emails_seen         int NOT NULL DEFAULT 0,
  version             int NOT NULL DEFAULT 1,
  model               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS memoria_thread_summaries_company_idx ON public.memoria_thread_summaries (company_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS memoria_thread_summaries_tsv_idx ON public.memoria_thread_summaries USING gin (to_tsvector('spanish', coalesce(tema, '') || ' ' || resumen));
COMMENT ON TABLE public.memoria_thread_summaries IS 'Resumen vivo por hilo (Claude): tema, resumen, estado, quién debe responder, acuerdos y pendientes. Se rehace cuando el hilo tiene correo posterior a summarized_through.';

CREATE OR REPLACE FUNCTION public.kg_upsert_node(p_kind text, p_key text, p_name text, p_props jsonb DEFAULT '{}'::jsonb, p_source text DEFAULT 'determinista')
RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO kg_nodes (kind, key, name, props, source)
  VALUES (p_kind, p_key, p_name, coalesce(p_props, '{}'::jsonb), p_source)
  ON CONFLICT (kind, key) DO UPDATE SET
    name = coalesce(EXCLUDED.name, kg_nodes.name),
    props = kg_nodes.props || coalesce(EXCLUDED.props, '{}'::jsonb),
    last_seen = now()
  RETURNING id
$$;

CREATE OR REPLACE FUNCTION public.kg_upsert_edge(p_src bigint, p_dst bigint, p_rel text, p_weight numeric DEFAULT 1, p_props jsonb DEFAULT '{}'::jsonb, p_evidence jsonb DEFAULT '[]'::jsonb, p_source text DEFAULT 'determinista')
RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO kg_edges (src, dst, rel, weight, props, evidence, source)
  VALUES (p_src, p_dst, p_rel, coalesce(p_weight, 1), coalesce(p_props, '{}'::jsonb), coalesce(p_evidence, '[]'::jsonb), p_source)
  ON CONFLICT (src, dst, rel) DO UPDATE SET
    weight = CASE WHEN EXCLUDED.source = 'determinista' THEN EXCLUDED.weight ELSE kg_edges.weight + EXCLUDED.weight END,
    props = kg_edges.props || coalesce(EXCLUDED.props, '{}'::jsonb),
    evidence = (SELECT coalesce(jsonb_agg(DISTINCT s.val), '[]'::jsonb) FROM (
                  SELECT val FROM jsonb_array_elements(kg_edges.evidence || coalesce(EXCLUDED.evidence, '[]'::jsonb)) AS x(val) LIMIT 50) s),
    last_seen = now()
  RETURNING id
$$;
REVOKE ALL ON FUNCTION public.kg_upsert_node(text, text, text, jsonb, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.kg_upsert_edge(bigint, bigint, text, numeric, jsonb, jsonb, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kg_upsert_node(text, text, text, jsonb, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.kg_upsert_edge(bigint, bigint, text, numeric, jsonb, jsonb, text) TO service_role;

-- ───────────────────────── C. Grafo determinístico ──────────────────────────

CREATE OR REPLACE FUNCTION public.kg_refresh_deterministic()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_started timestamptz := now();  -- las filas tocadas aquí quedan con last_seen = now()
  v_clock timestamptz := clock_timestamp();
  n_emp int; n_con int; n_buz int; n_usr int; n_edges int := 0; n_pruned int;
BEGIN
  -- Empresas de Odoo (las de notificaciones/ruido no entran al grafo).
  INSERT INTO kg_nodes (kind, key, name, props)
  SELECT 'empresa', c.id::text, c.name,
         jsonb_strip_nulls(jsonb_build_object('odoo_partner_id', c.odoo_partner_id, 'rfc', c.rfc, 'domain', c.domain,
           'is_customer', c.is_customer, 'is_supplier', c.is_supplier, 'payment_term', c.payment_term, 'city', c.city, 'country', c.country))
  FROM companies c WHERE c.odoo_partner_id IS NOT NULL
  ON CONFLICT (kind, key) DO UPDATE SET name = EXCLUDED.name, props = kg_nodes.props || EXCLUDED.props, last_seen = now();
  GET DIAGNOSTICS n_emp = ROW_COUNT;

  -- Contactos externos con correo y empresa de Odoo.
  INSERT INTO kg_nodes (kind, key, name, props)
  SELECT 'contacto', k.email, k.name,
         jsonb_strip_nulls(jsonb_build_object('company_id', k.company_id, 'rol', k.role, 'departamento', k.department,
           'odoo_partner_id', k.odoo_partner_id, 'interacciones', k.interaction_count, 'ultimo_correo', k.last_activity))
  FROM contacts k JOIN companies c ON c.id = k.company_id AND c.odoo_partner_id IS NOT NULL
  WHERE k.email IS NOT NULL AND coalesce(k.contact_type, 'external') <> 'noise'
  ON CONFLICT (kind, key) DO UPDATE SET name = coalesce(EXCLUDED.name, kg_nodes.name), props = kg_nodes.props || EXCLUDED.props, last_seen = now();
  GET DIAGNOSTICS n_con = ROW_COUNT;

  INSERT INTO kg_nodes (kind, key, name, props)
  SELECT 'buzon', lower(g.email), lower(g.email), jsonb_strip_nulls(jsonb_build_object('departamento', g.department, 'activo', g.active))
  FROM gmail_accounts g
  ON CONFLICT (kind, key) DO UPDATE SET props = kg_nodes.props || EXCLUDED.props, last_seen = now();
  GET DIAGNOSTICS n_buz = ROW_COUNT;

  INSERT INTO kg_nodes (kind, key, name, props)
  SELECT 'usuario', lower(u.email), u.name,
         jsonb_strip_nulls(jsonb_build_object('odoo_user_id', u.odoo_user_id, 'departamento', u.department, 'puesto', u.job_title))
  FROM odoo_users u WHERE u.email IS NOT NULL
  ON CONFLICT (kind, key) DO UPDATE SET name = EXCLUDED.name, props = kg_nodes.props || EXCLUDED.props, last_seen = now();
  GET DIAGNOSTICS n_usr = ROW_COUNT;

  -- trabaja_en: contacto → empresa
  INSERT INTO kg_edges (src, dst, rel, weight, props)
  SELECT nc.id, ne.id, 'trabaja_en', greatest(coalesce(k.interaction_count, 0), 1), jsonb_strip_nulls(jsonb_build_object('rol', k.role))
  FROM contacts k
  JOIN kg_nodes nc ON nc.kind = 'contacto' AND nc.key = k.email
  JOIN kg_nodes ne ON ne.kind = 'empresa' AND ne.key = k.company_id::text
  ON CONFLICT (src, dst, rel) DO UPDATE SET weight = EXCLUDED.weight, props = kg_edges.props || EXCLUDED.props, last_seen = now();
  GET DIAGNOSTICS n_edges = ROW_COUNT;

  -- persona_de: usuario → buzón personal (mismo correo)
  INSERT INTO kg_edges (src, dst, rel)
  SELECT nu.id, nb.id, 'persona_de'
  FROM kg_nodes nu JOIN kg_nodes nb ON nb.kind = 'buzon' AND nb.key = nu.key
  WHERE nu.kind = 'usuario'
  ON CONFLICT (src, dst, rel) DO UPDATE SET last_seen = now();

  -- atiende / atiende:<area>: buzón → empresa (vista memoria_encargados)
  INSERT INTO kg_edges (src, dst, rel, weight, props)
  SELECT nb.id, ne.id, CASE WHEN m.area IS NULL THEN 'atiende' ELSE 'atiende:' || m.area END, m.n,
         jsonb_build_object('share', m.share, 'rank', m.rank, 'last_at', m.last_at)
  FROM memoria_encargados m
  JOIN kg_nodes nb ON nb.kind = 'buzon' AND nb.key = m.mailbox
  JOIN kg_nodes ne ON ne.kind = 'empresa' AND ne.key = m.company_id::text
  WHERE m.rank <= 3
  ON CONFLICT (src, dst, rel) DO UPDATE SET weight = EXCLUDED.weight, props = kg_edges.props || EXCLUDED.props, last_seen = now();

  -- escribe_a: contacto → buzón (180 días)
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

  -- Aristas determinísticas que ya no salen de los datos.
  DELETE FROM kg_edges
  WHERE source = 'determinista' AND last_seen < v_started
    AND (rel IN ('trabaja_en', 'persona_de', 'escribe_a') OR rel LIKE 'atiende%');
  GET DIAGNOSTICS n_pruned = ROW_COUNT;

  RETURN jsonb_build_object('empresas', n_emp, 'contactos', n_con, 'buzones', n_buz, 'usuarios', n_usr,
                            'trabaja_en', n_edges, 'pruned', n_pruned, 'ms', round(extract(epoch FROM clock_timestamp() - v_clock) * 1000));
END;
$$;
REVOKE ALL ON FUNCTION public.kg_refresh_deterministic() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kg_refresh_deterministic() TO service_role;
COMMENT ON FUNCTION public.kg_refresh_deterministic() IS 'Reconstruye nodos y aristas del grafo que salen de los datos (empresas de Odoo, contactos, buzones, usuarios, quién atiende a quién, quién escribe a qué buzón). Nocturno.';

-- ───────────────────────── D. Consolidación y consulta ──────────────────────

CREATE OR REPLACE FUNCTION public.memoria_hilos_pendientes(p_days int DEFAULT 120, p_limit int DEFAULT 20)
RETURNS TABLE (thread_id bigint, subject text, account text, company_id bigint, company_name text, is_customer boolean, is_supplier boolean,
               message_count int, last_activity timestamptz, summarized_through timestamptz, prev_version int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT t.id, t.subject, t.account, t.company_id, c.name, c.is_customer, c.is_supplier,
         t.message_count, t.last_activity, s.summarized_through, s.version
  FROM threads t
  JOIN companies c ON c.id = t.company_id AND c.odoo_partner_id IS NOT NULL AND (c.is_customer OR c.is_supplier)
  LEFT JOIN memoria_thread_summaries s ON s.thread_id = t.id
  WHERE t.last_activity > now() - make_interval(days => p_days)
    AND (s.thread_id IS NULL OR s.summarized_through < t.last_activity)
    AND coalesce(t.last_sender, '') !~* '(no-?reply|postmaster|mailer-daemon|notificacion|notification|newsletter|digest|automated|donotreply)'
    AND coalesce(t.subject, '') !~* '^(accepted|aceptado|invitación actualizada|updated invitation|delivery status|undeliverable)'
  ORDER BY (s.thread_id IS NOT NULL) DESC, (t.message_count >= 2) DESC, t.last_activity DESC
  LIMIT p_limit
$$;
REVOKE ALL ON FUNCTION public.memoria_hilos_pendientes(int, int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.memoria_hilos_pendientes(int, int) TO service_role;

CREATE OR REPLACE FUNCTION public.memoria_guardar_consolidacion(p_thread_id bigint, p jsonb, p_model text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  t record; n_hilo bigint; n_emp bigint; n_node bigint; f jsonb; pr jsonb; h text; d date;
  n_facts int := 0; n_people int := 0; v_email_ids jsonb; v_through timestamptz; v_seen int;
BEGIN
  SELECT * INTO t FROM threads WHERE id = p_thread_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'thread % no existe', p_thread_id; END IF;
  v_through := coalesce((p->>'summarized_through')::timestamptz, t.last_activity);
  v_seen := coalesce((p->>'emails_seen')::int, t.message_count);
  v_email_ids := coalesce(p->'email_ids', '[]'::jsonb);

  INSERT INTO memoria_thread_summaries AS s (thread_id, company_id, account, tema, resumen, estado, esperando_a, tono, acuerdos, pendientes,
                                             summarized_through, emails_seen, model)
  VALUES (p_thread_id, t.company_id, t.account, left(p->>'tema', 160), coalesce(p->>'resumen', ''),
          CASE WHEN p->>'estado' IN ('abierto','cerrado','informativo') THEN p->>'estado' ELSE 'abierto' END,
          CASE WHEN p->>'esperando_a' IN ('nosotros','ellos','nadie') THEN p->>'esperando_a' END,
          CASE WHEN p->>'tono' IN ('positivo','neutral','tenso') THEN p->>'tono' END,
          coalesce(p->'acuerdos', '[]'::jsonb), coalesce(p->'pendientes', '[]'::jsonb), v_through, v_seen, p_model)
  ON CONFLICT (thread_id) DO UPDATE SET
    company_id = EXCLUDED.company_id, account = EXCLUDED.account, tema = EXCLUDED.tema, resumen = EXCLUDED.resumen,
    estado = EXCLUDED.estado, esperando_a = EXCLUDED.esperando_a, tono = EXCLUDED.tono, acuerdos = EXCLUDED.acuerdos,
    pendientes = EXCLUDED.pendientes, summarized_through = EXCLUDED.summarized_through, emails_seen = EXCLUDED.emails_seen,
    model = EXCLUDED.model, version = s.version + 1, updated_at = now();

  n_hilo := kg_upsert_node('hilo', p_thread_id::text, left(coalesce(p->>'tema', t.subject), 160),
                           jsonb_strip_nulls(jsonb_build_object('account', t.account, 'estado', p->>'estado', 'last_activity', t.last_activity)), 'claude');
  IF t.company_id IS NOT NULL THEN
    n_emp := kg_upsert_node('empresa', t.company_id::text, (SELECT name FROM companies WHERE id = t.company_id), '{}'::jsonb, 'determinista');
    PERFORM kg_upsert_edge(n_hilo, n_emp, 'sobre', 1, '{}'::jsonb, v_email_ids, 'claude');
  END IF;

  -- Personas: contraparte → nodo contacto (+ trabaja_en si falta); nosotros → buzón/usuario.
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

  -- Hechos con vigencia sobre la empresa o un contacto.
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
REVOKE ALL ON FUNCTION public.memoria_guardar_consolidacion(bigint, jsonb, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.memoria_guardar_consolidacion(bigint, jsonb, text) TO service_role;
COMMENT ON FUNCTION public.memoria_guardar_consolidacion(bigint, jsonb, text) IS
  'Escribe lo que Claude consolidó de un hilo: resumen vivo, nodo hilo, aristas sobre/participa/trabaja_en, hechos con vigencia (dedup por hash, evidencia acumulada).';

CREATE OR REPLACE FUNCTION public.memoria_brief(p_company_id bigint DEFAULT NULL, p_odoo_partner_id int DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_cid bigint; v_node bigint; out jsonb;
BEGIN
  v_cid := coalesce(p_company_id, (SELECT id FROM companies WHERE odoo_partner_id = p_odoo_partner_id ORDER BY (is_customer OR is_supplier) DESC, id LIMIT 1));
  IF v_cid IS NULL THEN RETURN NULL; END IF;
  v_node := (SELECT id FROM kg_nodes WHERE kind = 'empresa' AND key = v_cid::text);
  SELECT jsonb_build_object(
    'empresa', (SELECT jsonb_build_object('id', c.id, 'name', c.name, 'rfc', c.rfc, 'odoo_partner_id', c.odoo_partner_id,
                  'is_customer', c.is_customer, 'is_supplier', c.is_supplier, 'domain', c.domain) FROM companies c WHERE c.id = v_cid),
    'encargados', coalesce((SELECT jsonb_agg(jsonb_build_object('buzon', n.key, 'area', nullif(substr(e.rel, 9), ''), 'n', e.weight,
                    'share', e.props->'share', 'last_at', e.props->'last_at') ORDER BY (e.rel = 'atiende') DESC, e.weight DESC)
                  FROM kg_edges e JOIN kg_nodes n ON n.id = e.src WHERE e.dst = v_node AND e.rel LIKE 'atiende%' AND (e.props->>'rank')::int = 1), '[]'::jsonb),
    'contactos', coalesce((SELECT jsonb_agg(jsonb_build_object('email', n.key, 'nombre', n.name, 'rol', n.props->>'rol', 'interacciones', e.weight,
                    'ultimo_correo', n.props->'ultimo_correo') ORDER BY e.weight DESC) FROM (
                    SELECT * FROM kg_edges WHERE dst = v_node AND rel = 'trabaja_en' ORDER BY weight DESC LIMIT 15) e
                  JOIN kg_nodes n ON n.id = e.src), '[]'::jsonb),
    'hechos', coalesce((SELECT jsonb_agg(jsonb_build_object('categoria', f.categoria, 'hecho', f.hecho, 'vigente_desde', f.vigente_desde,
                    'veces', f.veces, 'confianza', f.confianza, 'sobre', CASE WHEN n.kind = 'contacto' THEN n.key ELSE 'empresa' END,
                    'evidencia', f.evidencia -> 0) ORDER BY f.categoria, f.updated_at DESC) FROM (
                    SELECT mf.* FROM memoria_facts mf JOIN kg_nodes kn ON kn.id = mf.node_id
                    WHERE mf.status = 'vigente' AND (mf.node_id = v_node OR (kn.kind = 'contacto' AND (kn.props->>'company_id')::bigint = v_cid))
                    ORDER BY mf.updated_at DESC LIMIT 40) f JOIN kg_nodes n ON n.id = f.node_id), '[]'::jsonb),
    'hilos', coalesce((SELECT jsonb_agg(jsonb_build_object('thread_id', s.thread_id, 'gmail_thread_id', t.gmail_thread_id, 'asunto', t.subject,
                    'buzon', s.account, 'tema', s.tema, 'resumen', s.resumen, 'estado', s.estado, 'esperando_a', s.esperando_a, 'tono', s.tono,
                    'acuerdos', s.acuerdos, 'pendientes', s.pendientes, 'ultimo', t.last_activity, 'mensajes', t.message_count)
                    ORDER BY (s.estado = 'abierto') DESC, t.last_activity DESC) FROM (
                    SELECT * FROM memoria_thread_summaries WHERE company_id = v_cid ORDER BY (estado = 'abierto') DESC, updated_at DESC LIMIT 12) s
                  JOIN threads t ON t.id = s.thread_id), '[]'::jsonb),
    'stats', jsonb_build_object(
      'hilos_90d', (SELECT count(*) FROM threads WHERE company_id = v_cid AND last_activity > now() - interval '90 days'),
      'esperan_respuesta_nuestra', (SELECT count(*) FROM threads WHERE company_id = v_cid AND last_sender_type = 'external' AND status IN ('needs_response', 'stalled') AND last_activity > now() - interval '90 days'),
      'hilos_resumidos', (SELECT count(*) FROM memoria_thread_summaries WHERE company_id = v_cid),
      'hilos_abiertos', (SELECT count(*) FROM memoria_thread_summaries WHERE company_id = v_cid AND estado = 'abierto'),
      'ultimo_correo', (SELECT max(last_activity) FROM threads WHERE company_id = v_cid))
  ) INTO out;
  RETURN out;
END;
$$;
REVOKE ALL ON FUNCTION public.memoria_brief(bigint, int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.memoria_brief(bigint, int) TO service_role;
COMMENT ON FUNCTION public.memoria_brief(bigint, int) IS 'Ficha de memoria de una empresa (por companies.id o por odoo_partner_id): quién la atiende, contactos, hechos vigentes, resúmenes de hilos y stats. La lee Odoo (qb_memoria) y Claude por MCP.';

CREATE OR REPLACE FUNCTION public.memoria_buscar(p_texto text, p_company_id bigint DEFAULT NULL, p_limit int DEFAULT 20)
RETURNS TABLE (tipo text, company_id bigint, empresa text, thread_id bigint, texto text, fecha timestamptz, rank real)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH q AS (SELECT websearch_to_tsquery('spanish', p_texto) AS tsq)
  SELECT * FROM (
    SELECT 'hilo'::text AS tipo, s.company_id, c.name AS empresa, s.thread_id,
           coalesce(s.tema, '') || ': ' || s.resumen AS texto, s.updated_at AS fecha,
           ts_rank(to_tsvector('spanish', coalesce(s.tema, '') || ' ' || s.resumen), q.tsq) AS rank
    FROM memoria_thread_summaries s CROSS JOIN q LEFT JOIN companies c ON c.id = s.company_id
    WHERE to_tsvector('spanish', coalesce(s.tema, '') || ' ' || s.resumen) @@ q.tsq AND (p_company_id IS NULL OR s.company_id = p_company_id)
    UNION ALL
    SELECT 'hecho', (CASE WHEN n.kind = 'empresa' THEN n.key::bigint ELSE (n.props->>'company_id')::bigint END), c.name,
           (f.evidencia->0->>'thread_id')::bigint, f.categoria || ': ' || f.hecho, f.updated_at,
           ts_rank(to_tsvector('spanish', f.hecho), q.tsq)
    FROM memoria_facts f JOIN kg_nodes n ON n.id = f.node_id CROSS JOIN q
    LEFT JOIN companies c ON c.id = (CASE WHEN n.kind = 'empresa' THEN n.key::bigint ELSE (n.props->>'company_id')::bigint END)
    WHERE f.status = 'vigente' AND to_tsvector('spanish', f.hecho) @@ q.tsq
      AND (p_company_id IS NULL OR (CASE WHEN n.kind = 'empresa' THEN n.key::bigint ELSE (n.props->>'company_id')::bigint END) = p_company_id)
  ) r
  ORDER BY rank DESC, fecha DESC
  LIMIT greatest(p_limit, 1)
$$;
REVOKE ALL ON FUNCTION public.memoria_buscar(text, bigint, int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.memoria_buscar(text, bigint, int) TO service_role;
COMMENT ON FUNCTION public.memoria_buscar(text, bigint, int) IS 'Búsqueda en lenguaje natural (websearch, español) sobre resúmenes de hilos y hechos vigentes. Primer paso para preguntarle a la memoria.';

-- ───────────────────────── E. Jobs ──────────────────────────────────────────

DO $$
DECLARE j record;
BEGIN
  FOR j IN SELECT jobid FROM cron.job WHERE jobname IN ('memoria_ligas', 'memoria_consolidar', 'memoria_grafo_nocturno') LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;
END $$;
SELECT cron.schedule('memoria_ligas',          '*/10 * * * *', $$SELECT public.memoria_link_recent(interval '3 days')$$);
SELECT cron.schedule('memoria_consolidar',     '*/5 * * * *',  $$SELECT public.invoke_edge('memory-consolidate')$$);
SELECT cron.schedule('memoria_grafo_nocturno', '15 8 * * *',   $$SELECT public.kg_refresh_deterministic()$$);

INSERT INTO pipeline_logs (level, phase, message, details)
VALUES ('info', 'migration', 'Memoria Fase 3: ligas determinísticas (memoria_ligas), grafo kg_nodes/kg_edges, memoria_facts, memoria_thread_summaries, memoria_brief/buscar, jobs memoria_consolidar y memoria_grafo_nocturno',
        jsonb_build_object('migration', '20260918_memoria_grafo'));
