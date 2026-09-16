-- Memoria de Quimibond — Fase 1: crudo completo (bronze).
-- Ver docs/memoria-quimibond-diseno.md, sección "Capa 1".
--
-- Qué hace (todo aditivo, sin drops):
--   1. emails: columnas para cuerpo completo, HTML, cuerpo limpio (sin citas),
--      headers de threading, cc/bcc, labels, puntero al raw en Storage y
--      versión de ingest (1 = legacy truncado a 5k chars, 2 = completo).
--   2. email_attachments: una fila por adjunto con estado de extracción.
--   3. Buckets privados de Storage: email-raw y email-attachments.
--   4. RPC ingest_emails_v2(jsonb): upsert que SOLO actualiza si la versión
--      entrante es mayor (el backfill enriquece lo viejo sin pisar lo nuevo).
--   5. Vista memory_coverage para /datos y el watchdog.

BEGIN;

-- 1. emails -------------------------------------------------------------
ALTER TABLE public.emails
  ADD COLUMN IF NOT EXISTS body_full        text,
  ADD COLUMN IF NOT EXISTS body_html        text,
  ADD COLUMN IF NOT EXISTS body_clean       text,
  ADD COLUMN IF NOT EXISTS message_id_hdr   text,
  ADD COLUMN IF NOT EXISTS in_reply_to_hdr  text,
  ADD COLUMN IF NOT EXISTS references_hdr   text[],
  ADD COLUMN IF NOT EXISTS cc               text,
  ADD COLUMN IF NOT EXISTS bcc              text,
  ADD COLUMN IF NOT EXISTS labels           text[],
  ADD COLUMN IF NOT EXISTS raw_storage_path text,
  ADD COLUMN IF NOT EXISTS raw_size_bytes   integer,
  ADD COLUMN IF NOT EXISTS ingest_version   smallint NOT NULL DEFAULT 1;

COMMENT ON COLUMN public.emails.body        IS 'LEGACY: texto colapsado y cortado a 5,000 chars. Usar body_clean / body_full.';
COMMENT ON COLUMN public.emails.body_full   IS 'Texto plano completo del mensaje (text/plain o HTML convertido), con saltos de línea.';
COMMENT ON COLUMN public.emails.body_html   IS 'HTML original del mensaje si existe (cap 1 MB).';
COMMENT ON COLUMN public.emails.body_clean  IS 'Solo el mensaje nuevo: sin citas de correos anteriores, sin firma ni banners. Base para chunking.';
COMMENT ON COLUMN public.emails.raw_storage_path IS 'Ruta en bucket email-raw del payload completo de Gmail (format=full) en JSON.';
COMMENT ON COLUMN public.emails.ingest_version IS '1 = ingest legacy (truncado); 2 = ingest completo (Fase 1 memoria).';

CREATE INDEX IF NOT EXISTS emails_message_id_hdr_idx
  ON public.emails (message_id_hdr) WHERE message_id_hdr IS NOT NULL;
CREATE INDEX IF NOT EXISTS emails_ingest_v1_idx
  ON public.emails (email_date DESC) WHERE ingest_version < 2;

-- 2. email_attachments ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.email_attachments (
  id                  bigserial PRIMARY KEY,
  email_id            bigint NOT NULL REFERENCES public.emails(id) ON DELETE CASCADE,
  gmail_attachment_id text,
  filename            text NOT NULL,
  mime_type           text NOT NULL,
  size_bytes          integer NOT NULL,
  sha256              text,
  storage_path        text,
  extracted_text      text,
  extract_status      text NOT NULL DEFAULT 'pending'
                      CHECK (extract_status IN ('pending','done','skipped','failed')),
  skip_reason         text,
  attempts            smallint NOT NULL DEFAULT 0,
  last_error          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  -- Los attachmentId de Gmail no son estables entre lecturas del mismo
  -- mensaje; la identidad natural es (correo, nombre, tamaño).
  UNIQUE (email_id, filename, size_bytes)
);
CREATE INDEX IF NOT EXISTS email_attachments_sha_idx
  ON public.email_attachments (sha256) WHERE sha256 IS NOT NULL;
CREATE INDEX IF NOT EXISTS email_attachments_pending_idx
  ON public.email_attachments (created_at) WHERE extract_status = 'pending';
CREATE INDEX IF NOT EXISTS email_attachments_email_idx
  ON public.email_attachments (email_id);

COMMENT ON TABLE public.email_attachments IS
  'Memoria Fase 1: un adjunto por fila. El archivo vive en el bucket email-attachments (dedup por sha256); extracted_text alimenta el chunking.';

ALTER TABLE public.email_attachments ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'email_attachments' AND policyname = 'email_attachments_service_all') THEN
    CREATE POLICY email_attachments_service_all ON public.email_attachments
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 3. Storage buckets (privados) ------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES
  ('email-raw',         'email-raw',         false, 52428800),   -- 50 MB
  ('email-attachments', 'email-attachments', false, 26214400)    -- 25 MB
ON CONFLICT (id) DO NOTHING;

-- 4. RPC de ingest condicional --------------------------------------------
CREATE OR REPLACE FUNCTION public.ingest_emails_v2(p_rows jsonb)
RETURNS TABLE (id bigint, gmail_message_id text, action text)
-- LANGUAGE sql (no plpgsql): los nombres de las columnas de salida
-- coincidirían con variables PL/pgSQL y el ON CONFLICT (gmail_message_id)
-- se vuelve ambiguo.
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH src AS (
    SELECT *
    FROM jsonb_to_recordset(p_rows) AS r(
      account           text,
      sender            text,
      recipient         text,
      cc                text,
      bcc               text,
      subject           text,
      body              text,
      body_full         text,
      body_html         text,
      body_clean        text,
      snippet           text,
      email_date        timestamptz,
      gmail_message_id  text,
      gmail_thread_id   text,
      thread_id         bigint,
      attachments       jsonb,
      is_reply          boolean,
      sender_type       text,
      has_attachments   boolean,
      message_id_hdr    text,
      in_reply_to_hdr   text,
      references_hdr    text[],
      labels            text[],
      raw_storage_path  text,
      raw_size_bytes    integer,
      ingest_version    smallint
    )
  ),
  ins AS (
    INSERT INTO public.emails AS e (
      account, sender, recipient, cc, bcc, subject, body, body_full, body_html,
      body_clean, snippet, email_date, gmail_message_id, gmail_thread_id,
      thread_id, attachments, is_reply, sender_type, has_attachments,
      message_id_hdr, in_reply_to_hdr, references_hdr, labels,
      raw_storage_path, raw_size_bytes, ingest_version
    )
    SELECT
      s.account, s.sender, s.recipient, s.cc, s.bcc, s.subject, s.body,
      s.body_full, s.body_html, s.body_clean, s.snippet, s.email_date,
      s.gmail_message_id, s.gmail_thread_id, s.thread_id, s.attachments,
      s.is_reply, s.sender_type, s.has_attachments, s.message_id_hdr,
      s.in_reply_to_hdr, s.references_hdr, s.labels, s.raw_storage_path,
      s.raw_size_bytes, COALESCE(s.ingest_version, 2)
    FROM src s
    WHERE s.gmail_message_id IS NOT NULL
    ON CONFLICT (gmail_message_id) DO UPDATE SET
      cc               = EXCLUDED.cc,
      bcc              = EXCLUDED.bcc,
      body             = EXCLUDED.body,
      body_full        = EXCLUDED.body_full,
      body_html        = EXCLUDED.body_html,
      body_clean       = EXCLUDED.body_clean,
      attachments      = EXCLUDED.attachments,
      has_attachments  = EXCLUDED.has_attachments,
      thread_id        = COALESCE(e.thread_id, EXCLUDED.thread_id),
      message_id_hdr   = EXCLUDED.message_id_hdr,
      in_reply_to_hdr  = EXCLUDED.in_reply_to_hdr,
      references_hdr   = EXCLUDED.references_hdr,
      labels           = EXCLUDED.labels,
      raw_storage_path = COALESCE(EXCLUDED.raw_storage_path, e.raw_storage_path),
      raw_size_bytes   = COALESCE(EXCLUDED.raw_size_bytes, e.raw_size_bytes),
      ingest_version   = EXCLUDED.ingest_version,
      updated_at       = now()
    WHERE e.ingest_version < EXCLUDED.ingest_version
    RETURNING e.id, e.gmail_message_id, (xmax = 0) AS inserted
  )
  SELECT ins.id, ins.gmail_message_id,
         CASE WHEN ins.inserted THEN 'inserted' ELSE 'updated' END
  FROM ins;
$$;

COMMENT ON FUNCTION public.ingest_emails_v2(jsonb) IS
  'Memoria Fase 1: inserta correos nuevos y actualiza los existentes SOLO si ingest_version entrante > actual. Filas no devueltas = ya estaban en versión igual o mayor (skipped).';

REVOKE ALL ON FUNCTION public.ingest_emails_v2(jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ingest_emails_v2(jsonb) TO service_role;

-- 5. Vista de cobertura ---------------------------------------------------
CREATE OR REPLACE VIEW public.memory_coverage AS
SELECT
  (SELECT count(*) FROM public.emails)                                            AS emails_total,
  (SELECT count(*) FROM public.emails WHERE ingest_version >= 2)                  AS emails_v2,
  (SELECT count(*) FROM public.emails WHERE ingest_version < 2
      AND email_date > now() - interval '7 days')                                 AS emails_v1_last7d,
  (SELECT count(*) FROM public.emails WHERE raw_storage_path IS NOT NULL)         AS emails_with_raw,
  (SELECT count(*) FROM public.emails WHERE length(body) >= 4990
      AND body_full IS NULL)                                                      AS emails_truncated_unrecovered,
  (SELECT count(*) FROM public.email_attachments)                                 AS attachments_total,
  (SELECT count(*) FROM public.email_attachments WHERE extract_status = 'pending') AS attachments_pending,
  (SELECT count(*) FROM public.email_attachments WHERE extract_status = 'done')    AS attachments_done,
  (SELECT count(*) FROM public.email_attachments WHERE extract_status = 'failed')  AS attachments_failed,
  (SELECT min(created_at) FROM public.email_attachments WHERE extract_status = 'pending') AS oldest_pending_attachment,
  (SELECT max(email_date) FROM public.emails)                                     AS last_email_at;

COMMENT ON VIEW public.memory_coverage IS
  'Memoria: cobertura del ingest completo (v2), raw en Storage y extracción de adjuntos. Se amplía en Fase 2 con chunks/embeddings.';

INSERT INTO public.schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
SELECT 'ALTER_TABLE', 'emails',
       'Memoria Fase 1: columnas crudas + email_attachments + buckets + ingest_emails_v2 + memory_coverage',
       'supabase/migrations/20260916_memory_01_emails_raw.sql', 'memoria-fase-1', true
WHERE NOT EXISTS (SELECT 1 FROM public.schema_changes WHERE triggered_by = 'memoria-fase-1');

COMMIT;
