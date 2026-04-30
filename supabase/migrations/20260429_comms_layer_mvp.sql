-- ============================================================================
-- Comms Layer MVP (2026-04-29)
-- Spec: docs/superpowers/specs/2026-04-29-comms-layer-mvp-design.md
-- ----------------------------------------------------------------------------
-- - 2 RPCs públicas (comms_timeline, comms_thread_messages)
-- - 2 detect funcs (unanswered_external_thread, activity_overdue)
-- - invariant_routing seeds + pg_cron schedule
-- - 5 indexes (3 nuevos + 2 unique partial para ON CONFLICT)
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Indexes
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_threads_company_id_last_activity
  ON public.threads (company_id, last_activity DESC)
  WHERE company_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_threads_unanswered_external
  ON public.threads (last_sender_type, hours_without_response)
  WHERE last_sender_type = 'external';

CREATE INDEX IF NOT EXISTS idx_emails_sender_contact_thread
  ON public.emails (sender_contact_id, thread_id)
  WHERE sender_contact_id IS NOT NULL AND thread_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_recon_issues_thread_metadata
  ON public.reconciliation_issues (
    issue_type, canonical_entity_type, canonical_entity_id, (metadata->>'thread_id')
  )
  WHERE issue_type = 'comms.unanswered_external_thread';

CREATE UNIQUE INDEX IF NOT EXISTS uq_recon_issues_activity_metadata
  ON public.reconciliation_issues (
    issue_type, canonical_entity_type, canonical_entity_id, (metadata->>'activity_id')
  )
  WHERE issue_type = 'comms.activity_overdue';

COMMIT;
