-- Sprint 0 — Fixes de refs rotas detectadas en auditoría frontend/DB
--
-- Descubierto: cash_flow_aging, weekly_trends, populate_revenue_metrics()
-- YA EXISTÍAN (probablemente de una migración previa no committeada).
-- El único bug real es que chat_memory tiene un schema diferente al que
-- el frontend espera (QA cache: question/answer/thumbs_up/times_retrieved).
--
-- La tabla tiene 0 filas, safe to ALTER.

------------------------------------------------------------------------------
-- chat_memory — agregar columnas faltantes para soportar patrón QA cache
--                que usa /api/chat/route.ts
------------------------------------------------------------------------------
ALTER TABLE public.chat_memory
  ADD COLUMN IF NOT EXISTS question        TEXT,
  ADD COLUMN IF NOT EXISTS answer          TEXT,
  ADD COLUMN IF NOT EXISTS thumbs_up       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS thumbs_down     BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS times_retrieved INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS embedding       vector(1536),
  ADD COLUMN IF NOT EXISTS last_retrieved  TIMESTAMPTZ;

-- Hacer session_id, role, content nullable porque en modo QA-cache no aplican
ALTER TABLE public.chat_memory
  ALTER COLUMN session_id DROP NOT NULL,
  ALTER COLUMN role       DROP NOT NULL,
  ALTER COLUMN content    DROP NOT NULL;

-- Constraint: o es un mensaje de conversación (role+content) o es un QA entry (question+answer)
ALTER TABLE public.chat_memory
  DROP CONSTRAINT IF EXISTS chat_memory_kind_check;
ALTER TABLE public.chat_memory
  ADD  CONSTRAINT chat_memory_kind_check
  CHECK (
    (role IS NOT NULL AND content IS NOT NULL)  -- conversation log
    OR
    (question IS NOT NULL AND answer IS NOT NULL) -- QA cache entry
  );

CREATE INDEX IF NOT EXISTS idx_chat_memory_thumbs
  ON public.chat_memory (thumbs_up, times_retrieved DESC)
  WHERE thumbs_up = TRUE;

CREATE INDEX IF NOT EXISTS idx_chat_memory_qa_recent
  ON public.chat_memory (last_retrieved DESC NULLS LAST)
  WHERE question IS NOT NULL;

COMMENT ON TABLE public.chat_memory IS
'Doble propósito: (a) historial de conversación multi-turn (session_id+role+content); (b) cache de QA con thumbs_up (question+answer+thumbs_up+times_retrieved) que /api/chat/route.ts usa para recuperar respuestas buenas anteriores.';

COMMENT ON COLUMN public.chat_memory.question IS
'QA cache: la pregunta del usuario (modo cache). NULL en modo conversation log.';
COMMENT ON COLUMN public.chat_memory.answer IS
'QA cache: respuesta generada por Claude que fue thumbed-up.';
COMMENT ON COLUMN public.chat_memory.times_retrieved IS
'QA cache: cuántas veces esta entrada se usó como contexto RAG.';
