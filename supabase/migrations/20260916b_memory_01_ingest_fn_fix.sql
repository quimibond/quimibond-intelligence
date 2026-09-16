-- Fix a 20260916_memory_01: ingest_emails_v2 en LANGUAGE sql.
-- En plpgsql, las columnas de salida (id, gmail_message_id) son variables y
-- ON CONFLICT (gmail_message_id) fallaba con "column reference is ambiguous".
-- El archivo 20260916_memory_01 ya trae la versión corregida; este archivo
-- refleja lo aplicado en producción después del primer intento.

BEGIN;
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

COMMIT;
