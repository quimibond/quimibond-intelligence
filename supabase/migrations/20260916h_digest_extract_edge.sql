-- Retiro de Vercel (3/3): correo diario y extractores en Edge Functions.
--   email-digest   → job memoria_email_digest 12:45 UTC (6:45 CDMX), antes /api/pipeline/email-digest
--   email-extract  → {task: pending | demand | demand_files}, antes /api/pipeline/extract-*
-- Secreto en Vault: anthropic_api_key (RPC edge_secret). Modelos: claude-opus-5
-- (digest) y claude-sonnet-5 (extractores), override con CLAUDE_MODEL / CLAUDE_MODEL_BULK.

DO $do$
DECLARE
  j record;
BEGIN
  FOR j IN SELECT jobid FROM cron.job WHERE jobname IN ('memoria_email_digest', 'memoria_extract_pending', 'memoria_extract_demand', 'memoria_extract_demand_files') LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;
END $do$;

SELECT cron.schedule('memoria_email_digest',         '45 12 * * *',  $cmd$SELECT public.invoke_edge('email-digest')$cmd$);
SELECT cron.schedule('memoria_extract_pending',      '40 */2 * * *', $cmd$SELECT public.invoke_edge('email-extract', '{"task":"pending"}'::jsonb)$cmd$);
SELECT cron.schedule('memoria_extract_demand',       '50 */2 * * *', $cmd$SELECT public.invoke_edge('email-extract', '{"task":"demand"}'::jsonb)$cmd$);
SELECT cron.schedule('memoria_extract_demand_files', '55 */2 * * *', $cmd$SELECT public.invoke_edge('email-extract', '{"task":"demand_files"}'::jsonb)$cmd$);

INSERT INTO public.schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
SELECT 'CREATE', 'cron.job',
       'Retiro de Vercel: jobs memoria_email_digest (12:45 UTC) y memoria_extract_{pending,demand,demand_files} (cada 2h) → Edge Functions email-digest / email-extract',
       'supabase/migrations/20260916h_digest_extract_edge.sql', 'vercel-retiro-digest', true
WHERE NOT EXISTS (SELECT 1 FROM public.schema_changes WHERE triggered_by = 'vercel-retiro-digest');
