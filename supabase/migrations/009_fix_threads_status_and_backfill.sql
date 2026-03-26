-- Migration 009: Fix threads status CHECK and backfill from emails
-- The original CHECK allowed (open, waiting, resolved, stale) but the
-- pipeline sends (new, active, needs_response, stalled, resolved).
-- This mismatch caused ALL thread inserts to fail silently.
-- Applied via Supabase MCP on 2026-03-26.

-- Fix CHECK constraint to match pipeline values
ALTER TABLE threads DROP CONSTRAINT IF EXISTS threads_status_check;
ALTER TABLE threads ADD CONSTRAINT threads_status_check
  CHECK (status IN ('new', 'active', 'needs_response', 'stalled', 'resolved'));

-- Backfill threads from existing emails (one-time data migration)
INSERT INTO threads (
  gmail_thread_id, subject, subject_normalized, account,
  started_by, started_by_type, started_at, last_activity,
  last_sender, last_sender_type,
  status, message_count, participant_emails,
  has_internal_reply, has_external_reply, hours_without_response
)
SELECT
  e.gmail_thread_id,
  (array_agg(e.subject ORDER BY e.email_date ASC))[1],
  lower(regexp_replace(
    (array_agg(e.subject ORDER BY e.email_date ASC))[1],
    '^(re:|fwd?:|rv:)\s*', '', 'gi'
  )),
  (array_agg(e.account ORDER BY e.email_date ASC))[1],
  (array_agg(e.sender ORDER BY e.email_date ASC))[1],
  (array_agg(e.sender_type ORDER BY e.email_date ASC))[1],
  min(e.email_date), max(e.email_date),
  (array_agg(e.sender ORDER BY e.email_date DESC))[1],
  (array_agg(e.sender_type ORDER BY e.email_date DESC))[1],
  CASE
    WHEN EXTRACT(EPOCH FROM (now() - max(e.email_date)))/3600 > 48
      AND (array_agg(e.sender_type ORDER BY e.email_date DESC))[1] = 'external'
    THEN 'stalled'
    WHEN EXTRACT(EPOCH FROM (now() - max(e.email_date)))/3600 > 24
      AND (array_agg(e.sender_type ORDER BY e.email_date DESC))[1] = 'external'
    THEN 'needs_response'
    WHEN count(*) = 1 THEN 'new'
    ELSE 'active'
  END,
  count(*),
  array_agg(DISTINCT e.sender) FILTER (WHERE e.sender IS NOT NULL),
  bool_or(e.sender_type = 'internal'),
  bool_or(e.sender_type = 'external'),
  CASE
    WHEN (array_agg(e.sender_type ORDER BY e.email_date DESC))[1] = 'external'
    THEN round(EXTRACT(EPOCH FROM (now() - max(e.email_date)))/3600, 1)
    ELSE 0
  END
FROM emails e
WHERE e.gmail_thread_id IS NOT NULL
GROUP BY e.gmail_thread_id
ON CONFLICT (gmail_thread_id) DO UPDATE SET
  last_activity = EXCLUDED.last_activity,
  message_count = EXCLUDED.message_count,
  status = EXCLUDED.status;

-- Link emails to thread records
UPDATE emails e SET thread_id = t.id
FROM threads t
WHERE e.gmail_thread_id = t.gmail_thread_id AND e.thread_id IS NULL;
