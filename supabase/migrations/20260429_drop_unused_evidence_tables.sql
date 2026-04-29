-- supabase/migrations/20260429_drop_unused_evidence_tables.sql
--
-- Drop dead evidence-layer tables (audit 2026-04-29).
--
-- email_signals + attachments were scaffolded as part of the SP4 evidence
-- layer plan, but no ingestion pipeline was ever implemented:
--
--   email_signals:  0 rows, 0 inserts ever, 0 functions reference it.
--                   FE: 1 SELECT in fetchInboxItem + 2 type imports for
--                   empty-render only.
--   attachments:    0 rows, 0 inserts ever, 0 functions reference it
--                   (`get_contact_communications` matches `has_attachments`
--                    column on emails table, not this table).
--                   FE: 1 SELECT in fetchInboxItem + AttachmentsSection
--                   component for empty-render only.
--
-- manual_notes is intentionally kept — it has live INSERT call sites
-- (addManualNote action + 3 inbox API routes); empty today but the UX
-- feature is wired and operational.
--
-- Frontend cleanup ships in same commit (queries + components + tests).

DROP TABLE IF EXISTS public.email_signals;
DROP TABLE IF EXISTS public.attachments;
