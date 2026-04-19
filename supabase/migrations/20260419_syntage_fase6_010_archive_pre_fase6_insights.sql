-- Fase 6 · 010: archivar los 529 insights pre-Layer3/Compliance.
-- Razón: se generaron sin fiscal_annotation, sin contexto Syntage histórico.
-- El feedback (acted_on/dismissed) se preserva vía tabla snapshot + state intacto
-- para que learning pipeline siga funcionando.

-- 1. Snapshot table (estado completo antes del reset)
CREATE TABLE IF NOT EXISTS public.agent_insights_archive_pre_fase6 AS
SELECT *, 'archived_by_fase6_reset_2026_04_19' AS archive_reason, now() AS archived_at
FROM public.agent_insights
WHERE state IN ('new', 'seen', 'acted_on', 'dismissed', 'expired', 'archived');

-- 2. Marcar activos (new/seen/expired) como archived
UPDATE public.agent_insights
SET state = 'archived',
    updated_at = now()
WHERE state IN ('new', 'seen', 'expired');

-- acted_on / dismissed NO se tocan — son señales de learning valiosas.
