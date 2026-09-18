-- 2026-09-18e — Adjuntos: ritmo de extracción y entrada a la memoria.
--
-- Diagnóstico del 18-sep (al terminar el backfill v2): 145,849 adjuntos
-- `pending` (PDF/Office, ~47k documentos distintos: cada uno está 3 veces
-- porque el mismo correo llega a 3 buzones), el extractor sacaba 8 por minuto
-- (~15 días de cola), los .docx fallaban al 100 % y NADIE leía
-- `extracted_text`: ni memoria_hilo_mensajes ni memoria_buscar ni
-- memory-consolidate. Decisión del CEO: solo adjuntos de correos de 2026.
--
-- Qué hace:
--   1. Solo 2026: los pendientes de correos anteriores quedan `skipped`
--      (`antes_2026`). Reversible: UPDATE ... SET extract_status='pending'.
--   2. Hermanos: cuando un adjunto ya tiene sha256 (bajado por un buzón), sus
--      copias en los otros buzones (mismo Message-ID, mismo nombre y tamaño)
--      heredan sha/archivo/texto sin bajarse. memoria_adjuntos_reusar_hermanos().
--   3. Reclamo atómico (FOR UPDATE SKIP LOCKED + claimed_at) para poder correr
--      dos invocaciones del extractor por minuto sin que se pisen.
--   4. memoria_hilo_mensajes devuelve `adjuntos_texto` (texto de los adjuntos
--      del correo, deduplicado por sha256, recortado) para memory-consolidate.
--   5. Columna tsvector + índice GIN sobre extracted_text; memoria_buscar
--      devuelve también filas tipo 'adjunto' con un fragmento resaltado.

-- ---------------------------------------------------------------------------
-- 1. Solo 2026
-- ---------------------------------------------------------------------------
UPDATE email_attachments a
   SET extract_status = 'skipped', skip_reason = 'antes_2026', updated_at = now()
  FROM emails e
 WHERE e.id = a.email_id
   AND a.extract_status = 'pending'
   AND e.email_date < '2026-01-01';

-- ---------------------------------------------------------------------------
-- 2. Índices para la cola y para los hermanos
-- ---------------------------------------------------------------------------
ALTER TABLE email_attachments ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

-- La cola se sirve chicos primero.
CREATE INDEX IF NOT EXISTS email_attachments_pending_size_idx
  ON email_attachments (size_bytes)
  WHERE extract_status = 'pending';

-- Los recién resueltos (con sha) son la semilla del paso de hermanos.
CREATE INDEX IF NOT EXISTS email_attachments_resueltos_idx
  ON email_attachments (updated_at)
  WHERE sha256 IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Hermanos: heredar sha/archivo/texto entre buzones sin volver a bajar
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.memoria_adjuntos_reusar_hermanos(p_desde interval DEFAULT interval '30 minutes')
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  n integer;
BEGIN
  -- Semilla: adjuntos resueltos (done o skipped con archivo) en la ventana.
  -- Destino: sus copias pendientes en correos con el mismo Message-ID.
  WITH d AS (
    SELECT d.email_id, d.filename, d.size_bytes, d.sha256, d.storage_path, d.extracted_text,
           d.extract_status, d.skip_reason, e2.message_id_hdr
      FROM email_attachments d
      JOIN emails e2 ON e2.id = d.email_id
     WHERE d.sha256 IS NOT NULL
       AND d.extract_status IN ('done', 'skipped')
       AND d.updated_at > now() - p_desde
       AND e2.message_id_hdr IS NOT NULL
  ), upd AS (
    UPDATE email_attachments a
       SET sha256 = d.sha256,
           storage_path = d.storage_path,
           extracted_text = d.extracted_text,
           extract_status = d.extract_status,
           skip_reason = d.skip_reason,
           last_error = NULL,
           updated_at = now()
      FROM d
      JOIN emails e ON e.message_id_hdr = d.message_id_hdr AND e.id <> d.email_id
     WHERE a.email_id = e.id
       AND a.filename = d.filename
       AND a.size_bytes = d.size_bytes
       AND a.extract_status = 'pending'
    RETURNING a.id
  )
  SELECT count(*) INTO n FROM upd;
  RETURN n;
END;
$$;

COMMENT ON FUNCTION public.memoria_adjuntos_reusar_hermanos(interval) IS
  'Copia sha256/archivo/texto de un adjunto ya resuelto a sus copias pendientes en otros buzones (mismo Message-ID, nombre y tamaño). La llama attachments-extract al inicio de cada corrida.';

-- Pasada inicial sobre todo lo ya resuelto.
SELECT public.memoria_adjuntos_reusar_hermanos(interval '10 years');

-- ---------------------------------------------------------------------------
-- 4. Reclamo atómico de un lote
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.memoria_adjuntos_reclamar(
  p_batch integer DEFAULT 8,
  p_max_bytes integer DEFAULT 3000000,
  p_max_attempts integer DEFAULT 3
)
RETURNS TABLE (
  id bigint, email_id bigint, gmail_attachment_id text, filename text, mime_type text,
  size_bytes integer, attempts smallint, account text, gmail_message_id text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH c AS (
    SELECT a.id
      FROM email_attachments a
      JOIN emails e ON e.id = a.email_id
     WHERE a.extract_status = 'pending'
       AND a.attempts < p_max_attempts
       AND a.size_bytes <= p_max_bytes
       AND (a.claimed_at IS NULL OR a.claimed_at < now() - interval '3 minutes')
       AND e.email_date >= '2026-01-01'
     ORDER BY a.size_bytes
     LIMIT greatest(p_batch, 1)
       FOR UPDATE OF a SKIP LOCKED
  ), u AS (
    UPDATE email_attachments a
       SET attempts = a.attempts + 1, claimed_at = now(), updated_at = now()
      FROM c
     WHERE a.id = c.id
    RETURNING a.id, a.email_id, a.gmail_attachment_id, a.filename, a.mime_type, a.size_bytes, a.attempts
  )
  SELECT u.id, u.email_id, u.gmail_attachment_id, u.filename, u.mime_type, u.size_bytes, u.attempts,
         e.account, e.gmail_message_id
    FROM u JOIN emails e ON e.id = u.email_id
   ORDER BY u.size_bytes;
$$;

COMMENT ON FUNCTION public.memoria_adjuntos_reclamar(integer, integer, integer) IS
  'Reclama un lote de adjuntos pendientes (chicos primero, solo correos de 2026): sube attempts y marca claimed_at. Dos invocaciones concurrentes no reciben las mismas filas (SKIP LOCKED); una fila reclamada que no se resolvió vuelve a ser elegible a los 3 minutos.';

-- ---------------------------------------------------------------------------
-- 5. Dos invocaciones del extractor por minuto
-- ---------------------------------------------------------------------------
SELECT cron.alter_job(
  jobid,
  command => 'SELECT public.invoke_edge(''attachments-extract'') FROM generate_series(1, 2)'
) FROM cron.job WHERE jobname = 'memoria_attachments_extract';

-- ---------------------------------------------------------------------------
-- 6. memoria_hilo_mensajes: texto de adjuntos por correo
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.memoria_hilo_mensajes(bigint[], integer);

CREATE FUNCTION public.memoria_hilo_mensajes(p_thread_ids bigint[], p_limit integer DEFAULT 40)
RETURNS TABLE (
  id bigint, thread_id bigint, account text, email_date timestamptz, sender text, sender_type text,
  recipient text, cc text, subject text, cuerpo text, adjuntos text, adjuntos_texto text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT * FROM (
    SELECT DISTINCT ON (coalesce(e.message_id_hdr, e.gmail_message_id, e.id::text))
           e.id, e.thread_id, e.account, e.email_date, e.sender, e.sender_type, e.recipient, e.cc, e.subject,
           left(coalesce(nullif(e.body_clean, ''), nullif(e.body, ''), e.snippet, ''), 6000) AS cuerpo,
           (SELECT string_agg(a->>'filename', ', ')
              FROM jsonb_array_elements(CASE WHEN jsonb_typeof(e.attachments) = 'array' THEN e.attachments ELSE '[]'::jsonb END) a) AS adjuntos,
           -- Texto extraído de los adjuntos de este correo (o de su copia en otro
           -- buzón: mismo Message-ID), un archivo por sha256, máximo 3, 2,500
           -- caracteres cada uno. memory-consolidate lo pasa a Claude.
           (SELECT string_agg('[adjunto: ' || x.filename || '] ' || x.txt, E'\n' ORDER BY x.id)
              FROM (
                SELECT DISTINCT ON (a.sha256) a.id, a.filename,
                       left(regexp_replace(a.extracted_text, '\s+', ' ', 'g'), 2500) AS txt
                  FROM email_attachments a
                  JOIN emails e2 ON e2.id = a.email_id
                 WHERE a.extract_status = 'done'
                   AND a.extracted_text IS NOT NULL
                   AND (e2.id = e.id OR (e.message_id_hdr IS NOT NULL AND e2.message_id_hdr = e.message_id_hdr))
                 ORDER BY a.sha256, a.id
                 LIMIT 3
              ) x) AS adjuntos_texto
      FROM emails e
     WHERE e.thread_id = ANY (p_thread_ids)
     ORDER BY coalesce(e.message_id_hdr, e.gmail_message_id, e.id::text), e.ingest_version DESC, e.id
  ) m
  ORDER BY m.email_date DESC, m.id DESC
  LIMIT greatest(p_limit, 1)
$$;

COMMENT ON FUNCTION public.memoria_hilo_mensajes(bigint[], integer) IS
  'Correos de una conversación sin duplicar entre buzones (DISTINCT ON Message-ID), con cuerpo limpio, nombres de adjuntos y texto extraído de los adjuntos (adjuntos_texto).';

-- ---------------------------------------------------------------------------
-- 7. Búsqueda en el texto de los adjuntos
-- ---------------------------------------------------------------------------
ALTER TABLE email_attachments
  ADD COLUMN IF NOT EXISTS texto_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('spanish'::regconfig, left(coalesce(extracted_text, ''), 60000))) STORED;

CREATE INDEX IF NOT EXISTS email_attachments_texto_tsv_idx
  ON email_attachments USING gin (texto_tsv);

CREATE OR REPLACE FUNCTION public.memoria_buscar(p_texto text, p_company_id bigint DEFAULT NULL::bigint, p_limit integer DEFAULT 20)
RETURNS TABLE (tipo text, company_id bigint, empresa text, thread_id bigint, texto text, fecha timestamptz, rank real)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  WITH q AS (SELECT websearch_to_tsquery('spanish', p_texto) AS tsq)
  SELECT * FROM (
    SELECT 'hilo'::text AS tipo, s.company_id, c.name AS empresa, s.thread_id,
           coalesce(s.tema, '') || ': ' || s.resumen AS texto, s.updated_at AS fecha,
           ts_rank(to_tsvector('spanish', coalesce(s.tema, '') || ' ' || s.resumen), q.tsq) AS rank
      FROM memoria_thread_summaries s CROSS JOIN q LEFT JOIN companies c ON c.id = s.company_id
     WHERE to_tsvector('spanish', coalesce(s.tema, '') || ' ' || s.resumen) @@ q.tsq
       AND (p_company_id IS NULL OR s.company_id = p_company_id)
    UNION ALL
    SELECT 'hecho', (CASE WHEN n.kind = 'empresa' THEN n.key::bigint ELSE (n.props->>'company_id')::bigint END), c.name,
           (f.evidencia->0->>'thread_id')::bigint, f.categoria || ': ' || f.hecho, f.updated_at,
           ts_rank(to_tsvector('spanish', f.hecho), q.tsq)
      FROM memoria_facts f JOIN kg_nodes n ON n.id = f.node_id CROSS JOIN q
      LEFT JOIN companies c ON c.id = (CASE WHEN n.kind = 'empresa' THEN n.key::bigint ELSE (n.props->>'company_id')::bigint END)
     WHERE f.status = 'vigente' AND to_tsvector('spanish', f.hecho) @@ q.tsq
       AND (p_company_id IS NULL OR (CASE WHEN n.kind = 'empresa' THEN n.key::bigint ELSE (n.props->>'company_id')::bigint END) = p_company_id)
    UNION ALL
    -- Adjuntos: un archivo por sha256; el fragmento resaltado solo se calcula
    -- para los mejores p_limit (ts_headline sobre 20k caracteres no es gratis).
    SELECT 'adjunto', z.company_id, z.empresa, z.thread_id,
           z.filename || ' (' || to_char(z.fecha, 'YYYY-MM-DD') || '): '
             || ts_headline('spanish', left(z.extracted_text, 20000), q.tsq,
                            'MaxWords=45, MinWords=20, MaxFragments=2, FragmentDelimiter= … '),
           z.fecha, z.rank
      FROM (
        SELECT * FROM (
          SELECT DISTINCT ON (a.sha256)
                 coalesce(e.company_id, t.company_id) AS company_id, c.name AS empresa, e.thread_id,
                 a.filename, a.extracted_text, e.email_date AS fecha, ts_rank(a.texto_tsv, q.tsq) AS rank
            FROM email_attachments a CROSS JOIN q
            JOIN emails e ON e.id = a.email_id
            LEFT JOIN threads t ON t.id = e.thread_id
            LEFT JOIN companies c ON c.id = coalesce(e.company_id, t.company_id)
           WHERE a.extract_status = 'done'
             AND a.texto_tsv @@ q.tsq
             AND (p_company_id IS NULL OR coalesce(e.company_id, t.company_id) = p_company_id)
           ORDER BY a.sha256, a.id
        ) y
        ORDER BY y.rank DESC, y.fecha DESC
        LIMIT greatest(p_limit, 1)
      ) z CROSS JOIN q
  ) r
  ORDER BY rank DESC, fecha DESC
  LIMIT greatest(p_limit, 1)
$$;

COMMENT ON FUNCTION public.memoria_buscar(text, bigint, integer) IS
  'Búsqueda websearch en español sobre resúmenes de conversaciones (hilo), hechos vigentes (hecho) y texto de adjuntos (adjunto, con fragmento resaltado).';
