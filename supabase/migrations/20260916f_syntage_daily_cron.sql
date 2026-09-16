-- Retiro de Vercel (1/3): Syntage en Edge Functions.
--
-- syntage-webhook  → receptor de webhooks (firma HMAC; apuntar Syntage a
--                    https://tozqezmivpblmcubmnpi.supabase.co/functions/v1/syntage-webhook)
-- syntage-daily    → extracción incremental diaria (antes /api/syntage/cron-daily
--                    en Vercel a las 05:00 UTC).
-- Secretos en Vault: syntage_api_key, syntage_webhook_secret (RPC edge_secret).

DO $do$
DECLARE
  j record;
BEGIN
  FOR j IN SELECT jobid FROM cron.job WHERE jobname = 'memoria_syntage_daily' LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;
END $do$;

SELECT cron.schedule('memoria_syntage_daily', '0 5 * * *', $cmd$SELECT public.invoke_edge('syntage-daily')$cmd$);

INSERT INTO public.schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
SELECT 'CREATE', 'cron.job',
       'Retiro de Vercel: job memoria_syntage_daily (05:00 UTC → Edge Function syntage-daily); webhook de Syntage en Edge Function syntage-webhook',
       'supabase/migrations/20260916f_syntage_daily_cron.sql', 'vercel-retiro-syntage', true
WHERE NOT EXISTS (SELECT 1 FROM public.schema_changes WHERE triggered_by = 'vercel-retiro-syntage');
