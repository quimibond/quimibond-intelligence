-- 2026-09-18f — Extraer ya los adjuntos de correos concretos.
--
-- La cola se sirve chicos primero; cuando alguien necesita los adjuntos de un
-- correo en particular (p.ej. la verificación de nómina: incidencias, NOI y
-- PDF de la semana), esperar la cola no sirve. attachments-extract acepta
-- body { email_ids: [...] } o { gmail_message_ids: [...] } y reclama solo
-- esos. El RPC gana p_email_ids; se recrea porque cambia la firma (dejar dos
-- sobrecargas haría ambigua la llamada por PostgREST).

DROP FUNCTION IF EXISTS public.memoria_adjuntos_reclamar(integer, integer, integer);

CREATE FUNCTION public.memoria_adjuntos_reclamar(
  p_batch integer DEFAULT 8,
  p_max_bytes integer DEFAULT 3000000,
  p_max_attempts integer DEFAULT 3,
  p_email_ids bigint[] DEFAULT NULL
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
       AND (p_email_ids IS NULL OR a.email_id = ANY (p_email_ids))
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

COMMENT ON FUNCTION public.memoria_adjuntos_reclamar(integer, integer, integer, bigint[]) IS
  'Reclama un lote de adjuntos pendientes (chicos primero, solo correos de 2026): sube attempts y marca claimed_at. Dos invocaciones concurrentes no reciben las mismas filas (SKIP LOCKED); una fila reclamada que no se resolvió vuelve a ser elegible a los 3 minutos. p_email_ids acota a correos concretos (modo prioritario de attachments-extract).';
