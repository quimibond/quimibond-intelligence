-- Memoria de Quimibond — pipelines de correo en Supabase (sin Vercel).
-- Ver docs/memoria-quimibond-diseno.md, "Infraestructura: Edge Functions + pg_cron".
--
-- 1. pg_net para que pg_cron invoque Edge Functions por HTTP.
-- 2. gmail_accounts: catálogo de buzones (antes GMAIL_ACCOUNTS_JSON en Vercel).
-- 3. Vault: cron_secret (compartido pg_cron ↔ Edge Functions) y, opcional,
--    google_service_account_json. RPC edge_secret(p_name) solo para service_role.
-- 4. Funciones invoke_edge / invoke_edge_per_account que arman la llamada.
-- 5. Jobs pg_cron INACTIVOS hasta el cutover (para no correr en paralelo con
--    los crons de Vercel sobre el mismo cursor de Gmail). Activar con:
--      SELECT cron.alter_job(jobid, active := true) FROM cron.job WHERE jobname LIKE 'memoria_%';

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- 2. Catálogo de buzones ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.gmail_accounts (
  email      text PRIMARY KEY,
  department text,
  active     boolean NOT NULL DEFAULT true,
  notes      text,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.gmail_accounts IS
  'Buzones de Gmail que sincroniza la memoria (delegación de dominio del service account). Reemplaza a GMAIL_ACCOUNTS_JSON.';

INSERT INTO public.gmail_accounts (email)
SELECT account FROM public.sync_state
ON CONFLICT (email) DO NOTHING;

-- 3. Secretos en Vault ----------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'cron_secret') THEN
    PERFORM vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'cron_secret',
      'Secreto compartido pg_cron → Edge Functions de memoria (header x-cron-secret)');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.edge_secret(p_name text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = p_name LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.edge_secret(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.edge_secret(text) TO service_role;
COMMENT ON FUNCTION public.edge_secret(text) IS
  'Lee un secreto de Vault (cron_secret, google_service_account_json). Solo service_role; lo usan las Edge Functions.';

-- 4. Invocación de Edge Functions desde SQL ---------------------------------
CREATE OR REPLACE FUNCTION public.invoke_edge(p_function text, p_body jsonb DEFAULT '{}'::jsonb)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_url    text := 'https://tozqezmivpblmcubmnpi.supabase.co/functions/v1/' || p_function;
  v_secret text := public.edge_secret('cron_secret');
  v_id     bigint;
BEGIN
  IF v_secret IS NULL THEN
    RAISE EXCEPTION 'cron_secret no existe en Vault';
  END IF;
  SELECT net.http_post(
    url     := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body    := p_body,
    timeout_milliseconds := 300000
  ) INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.invoke_edge(text, jsonb) FROM public, anon, authenticated;

-- Una llamada por cuenta activa (fan-out; cada invocación queda bajo el límite de CPU).
CREATE OR REPLACE FUNCTION public.invoke_edge_per_account(p_function text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  r record;
  n integer := 0;
BEGIN
  FOR r IN SELECT email FROM public.gmail_accounts WHERE active ORDER BY email LOOP
    PERFORM public.invoke_edge(p_function, jsonb_build_object('account', r.email));
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.invoke_edge_per_account(text) FROM public, anon, authenticated;

-- Backfill: una llamada por cuenta pendiente (no-op si la cola está vacía).
CREATE OR REPLACE FUNCTION public.invoke_edge_backfill_pending()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  r record;
  n integer := 0;
BEGIN
  FOR r IN SELECT account FROM public.email_backfill_state WHERE NOT done ORDER BY updated_at LOOP
    PERFORM public.invoke_edge('backfill-sweep', jsonb_build_object('account', r.account));
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.invoke_edge_backfill_pending() FROM public, anon, authenticated;

-- 5. Jobs pg_cron (inactivos hasta el cutover) -----------------------------
DO $$
DECLARE
  j record;
BEGIN
  FOR j IN SELECT jobid FROM cron.job WHERE jobname IN ('memoria_sync_emails', 'memoria_backfill_sweep', 'memoria_attachments_extract') LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;
END $$;

SELECT cron.schedule('memoria_sync_emails',         '*/30 * * * *', $$SELECT public.invoke_edge_per_account('sync-emails')$$);
SELECT cron.schedule('memoria_backfill_sweep',      '*/5 * * * *',  $$SELECT public.invoke_edge_backfill_pending()$$);
SELECT cron.schedule('memoria_attachments_extract', '*/2 * * * *',  $$SELECT public.invoke_edge('attachments-extract')$$);

-- cron.job no es actualizable directamente por el rol de migración; usar alter_job.
DO $$
DECLARE
  j record;
BEGIN
  FOR j IN SELECT jobid FROM cron.job WHERE jobname LIKE 'memoria_%' LOOP
    PERFORM cron.alter_job(job_id := j.jobid, active := false);
  END LOOP;
END $$;

INSERT INTO public.schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
SELECT 'CREATE', 'gmail_accounts',
       'Memoria: pg_net + gmail_accounts + Vault cron_secret + invoke_edge* + 3 jobs pg_cron inactivos (sync-emails, backfill-sweep, attachments-extract)',
       'supabase/migrations/20260916c_memory_edge_cron.sql', 'memoria-edge-cron', true
WHERE NOT EXISTS (SELECT 1 FROM public.schema_changes WHERE triggered_by = 'memoria-edge-cron');

COMMIT;
