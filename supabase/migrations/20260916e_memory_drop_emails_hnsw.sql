-- Memoria: se quita el índice HNSW de emails.embedding.
--
-- Causa raíz de la caída del 2026-09-16 (base colgada 40 min tras el primer
-- fan-out del backfill): cada UPDATE de ingest_emails_v2 reescribe columnas
-- TOAST grandes (body_full/body_html), la fila no cabe como HOT y Postgres
-- inserta la fila nueva en TODOS los índices, incluido idx_emails_embedding_hnsw
-- (818 MB, contra shared_buffers de 256 MB). Cada inserción HNSW toca decenas
-- de páginas del grafo en disco: 50 filas tardaban 60-176 s bajo concurrencia
-- y el I/O saturó la instancia.
--
-- El único consumidor era search_similar_emails (chat RAG del frontend, ya
-- retirado). La columna embedding se conserva; la Fase 2 la reemplaza por
-- memory.chunks y la Fase 5 la dropea. Rehacer el índice, si hiciera falta:
--   CREATE INDEX CONCURRENTLY idx_emails_embedding_hnsw ON public.emails
--     USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

DROP INDEX IF EXISTS public.idx_emails_embedding_hnsw;

INSERT INTO public.schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
SELECT 'DROP', 'emails',
       'Memoria: drop idx_emails_embedding_hnsw (818 MB). Hacía que cada update de ingest_emails_v2 costara segundos y tumbó la base en el backfill.',
       'supabase/migrations/20260916e_memory_drop_emails_hnsw.sql', 'memoria-drop-hnsw', true
WHERE NOT EXISTS (SELECT 1 FROM public.schema_changes WHERE triggered_by = 'memoria-drop-hnsw');
