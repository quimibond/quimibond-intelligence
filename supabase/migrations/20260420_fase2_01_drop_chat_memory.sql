-- Fase 2 Limpieza: drop chat_memory (0 rows, unused).
-- Writer never existed; reader in /api/chat retired in this commit.

BEGIN;
  DO $$
  BEGIN
    IF (SELECT count(*) FROM public.chat_memory) > 0 THEN
      RAISE EXCEPTION 'chat_memory is not empty; aborting drop';
    END IF;
  END $$;

  DROP TABLE public.chat_memory;

  INSERT INTO public.schema_changes (change_type, table_name, description, sql_executed)
  VALUES (
    'drop_table',
    'chat_memory',
    'Fase 2 — 0 rows, never populated; reader in /api/chat/route.ts retired in same commit',
    'DROP TABLE public.chat_memory'
  );
COMMIT;
