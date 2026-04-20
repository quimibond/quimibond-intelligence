-- Fase 2 Limpieza: drop agent_insights_archive_pre_fase6.
-- 529 rows exportadas a /tmp/agent_insights_archive_pre_fase6_backup_2026-04-20.json
-- pre-drop. Nada la consume en frontend/DB/MVs.

BEGIN;
  DROP TABLE public.agent_insights_archive_pre_fase6;

  INSERT INTO public.schema_changes (change_type, table_name, description, sql_executed)
  VALUES (
    'drop_table',
    'agent_insights_archive_pre_fase6',
    'Fase 2 — 529 rows exportadas a /tmp backup antes del drop; sin deps',
    'DROP TABLE public.agent_insights_archive_pre_fase6'
  );
COMMIT;
