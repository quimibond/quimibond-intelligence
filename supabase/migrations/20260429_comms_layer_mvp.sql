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

-- ----------------------------------------------------------------------------
-- 2. RPC comms_timeline
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.comms_timeline(
  p_entity_type   text,
  p_entity_id     bigint,
  p_scope         text DEFAULT 'external',
  p_limit         int  DEFAULT 25,
  p_offset        int  DEFAULT 0
)
RETURNS TABLE (
  thread_id              bigint,
  gmail_thread_id        text,
  subject                text,
  last_activity          timestamptz,
  last_sender            text,
  last_sender_type       text,
  hours_without_response numeric,
  status                 text,
  message_count          int,
  has_internal_reply     boolean,
  has_external_reply     boolean,
  participant_emails     text[],
  severity               text,
  total_count            bigint
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $func$
DECLARE
  v_thread_ids bigint[];
BEGIN
  IF p_entity_type = 'company' THEN
    SELECT array_agg(t.id) INTO v_thread_ids
      FROM public.threads t WHERE t.company_id = p_entity_id;
  ELSIF p_entity_type = 'contact' THEN
    SELECT array_agg(DISTINCT tid) INTO v_thread_ids
      FROM (
        SELECT id AS tid FROM public.threads WHERE started_by_contact_id = p_entity_id
        UNION
        SELECT DISTINCT thread_id AS tid FROM public.emails
          WHERE sender_contact_id = p_entity_id AND thread_id IS NOT NULL
      ) thread_ids;
  ELSE
    RAISE EXCEPTION 'Unknown entity_type %', p_entity_type;
  END IF;

  IF v_thread_ids IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH filtered AS (
    SELECT t.*
    FROM public.threads t
    WHERE t.id = ANY(v_thread_ids)
      AND CASE p_scope
        WHEN 'external' THEN t.has_external_reply IS TRUE
        WHEN 'internal' THEN t.has_internal_reply IS TRUE AND t.has_external_reply IS NOT TRUE
        ELSE TRUE
      END
  ),
  counted AS (SELECT COUNT(*) AS n FROM filtered)
  SELECT
    f.id, f.gmail_thread_id, f.subject, f.last_activity, f.last_sender,
    f.last_sender_type, f.hours_without_response, f.status, f.message_count,
    f.has_internal_reply, f.has_external_reply, f.participant_emails,
    CASE
      WHEN f.last_sender_type = 'external' AND f.hours_without_response > 168 THEN 'high'
      WHEN f.last_sender_type = 'external' AND f.hours_without_response > 72  THEN 'medium'
      WHEN f.last_sender_type = 'external' AND f.hours_without_response > 24  THEN 'low'
      ELSE 'none'
    END AS severity,
    c.n AS total_count
  FROM filtered f, counted c
  ORDER BY f.last_activity DESC NULLS LAST
  LIMIT p_limit OFFSET p_offset;
END;
$func$;

GRANT EXECUTE ON FUNCTION public.comms_timeline(text, bigint, text, int, int)
  TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. RPC comms_thread_messages (drawer detail)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.comms_thread_messages(p_thread_id bigint)
RETURNS TABLE (
  email_id         bigint,
  gmail_message_id text,
  sender           text,
  recipient        text,
  email_date       timestamptz,
  subject          text,
  snippet          text,
  body             text,
  sender_type      text,
  has_attachments  boolean
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $func$
  SELECT
    e.id, e.gmail_message_id, e.sender, e.recipient, e.email_date,
    e.subject, e.snippet, e.body, e.sender_type, e.has_attachments
  FROM public.emails e
  WHERE e.thread_id = p_thread_id
  ORDER BY e.email_date ASC NULLS LAST;
$func$;

GRANT EXECUTE ON FUNCTION public.comms_thread_messages(bigint) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4. Detect: unanswered external thread
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.detect_comms_unanswered_external_thread()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $func$
DECLARE
  v_inserted int := 0;
BEGIN
  WITH detected AS (
    SELECT
      t.id AS thread_id,
      t.company_id,
      t.subject,
      t.hours_without_response,
      t.last_sender,
      t.last_activity,
      CASE
        WHEN t.hours_without_response > 168 THEN 'high'
        WHEN t.hours_without_response > 72  THEN 'medium'
        ELSE 'low'
      END AS severity
    FROM public.threads t
    WHERE t.last_sender_type = 'external'
      AND t.hours_without_response > 48
      AND t.status IS DISTINCT FROM 'resolved'
      AND t.company_id IS NOT NULL
  )
  INSERT INTO public.reconciliation_issues (
    issue_type, invariant_key, severity, canonical_entity_type, canonical_entity_id,
    description, metadata, detected_at
  )
  SELECT
    'comms.unanswered_external_thread',
    'comms.unanswered_external_thread',
    severity,
    'company',
    company_id::text,
    format('Thread sin respuesta hace %sh: %s',
           round(hours_without_response), COALESCE(subject, '(sin asunto)')),
    jsonb_build_object(
      'thread_id', thread_id,
      'subject', subject,
      'hours_without_response', hours_without_response,
      'last_sender', last_sender,
      'last_activity', last_activity
    ),
    now()
  FROM detected
  ON CONFLICT (issue_type, canonical_entity_type, canonical_entity_id, (metadata->>'thread_id'))
  WHERE issue_type = 'comms.unanswered_external_thread'
  DO UPDATE SET
    severity    = EXCLUDED.severity,
    metadata    = EXCLUDED.metadata,
    description = EXCLUDED.description,
    detected_at = EXCLUDED.detected_at,
    resolved_at = NULL;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- Auto-resolve: threads que ya no califican
  UPDATE public.reconciliation_issues ri
  SET resolved_at = now(),
      resolution_note = 'auto: thread responded or closed'
  WHERE ri.issue_type = 'comms.unanswered_external_thread'
    AND ri.resolved_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.threads t
      WHERE t.id = (ri.metadata->>'thread_id')::bigint
        AND t.last_sender_type = 'external'
        AND t.hours_without_response > 48
        AND t.status IS DISTINCT FROM 'resolved'
    );

  RETURN v_inserted;
EXCEPTION WHEN OTHERS THEN
  -- audit_runs real schema: (run_at, source, invariant_key, severity, details)
  INSERT INTO public.audit_runs (run_at, source, invariant_key, severity, details)
  VALUES (now(), 'detect_comms_unanswered_external_thread', 'comms.unanswered_external_thread',
          'error', jsonb_build_object('error', SQLERRM));
  RAISE;
END;
$func$;

GRANT EXECUTE ON FUNCTION public.detect_comms_unanswered_external_thread()
  TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5. Detect: activity overdue
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.detect_comms_activity_overdue()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $func$
DECLARE
  v_inserted int := 0;
BEGIN
  WITH detected AS (
    SELECT
      ca.bronze_id                       AS activity_id,
      ca.canonical_company_id,
      ca.assigned_canonical_contact_id,
      ca.summary,
      ca.activity_type,
      ca.date_deadline,
      ca.assigned_to,
      ca.res_model,
      ca.res_id,
      (CURRENT_DATE - ca.date_deadline)::int AS days_overdue,
      CASE
        WHEN (CURRENT_DATE - ca.date_deadline)::int > 14 THEN 'high'
        WHEN (CURRENT_DATE - ca.date_deadline)::int > 3  THEN 'medium'
        ELSE 'low'
      END AS severity
    FROM public.canonical_activities ca
    WHERE ca.date_deadline < CURRENT_DATE
      AND ca.date_deadline > CURRENT_DATE - INTERVAL '90 days'
      AND ca.is_overdue = TRUE
      AND ca.canonical_company_id IS NOT NULL
      AND COALESCE(ca.activity_type, '') NOT IN (
        'Crear factura de compras',
        'Exception',
        'Excepción'
      )
  )
  INSERT INTO public.reconciliation_issues (
    issue_type, invariant_key, severity, canonical_entity_type, canonical_entity_id,
    description, metadata, detected_at, assignee_canonical_contact_id
  )
  SELECT
    'comms.activity_overdue',
    'comms.activity_overdue',
    severity,
    'company',
    canonical_company_id::text,
    format('Actividad %s días vencida: %s',
           days_overdue, COALESCE(summary, activity_type, '(sin descripción)')),
    jsonb_build_object(
      'activity_id', activity_id,
      'activity_type', activity_type,
      'date_deadline', date_deadline,
      'assigned_to', assigned_to,
      'days_overdue', days_overdue,
      'res_model', res_model,
      'res_id', res_id
    ),
    now(),
    assigned_canonical_contact_id
  FROM detected
  ON CONFLICT (issue_type, canonical_entity_type, canonical_entity_id, (metadata->>'activity_id'))
  WHERE issue_type = 'comms.activity_overdue'
  DO UPDATE SET
    severity    = EXCLUDED.severity,
    metadata    = EXCLUDED.metadata,
    description = EXCLUDED.description,
    detected_at = EXCLUDED.detected_at,
    assignee_canonical_contact_id = EXCLUDED.assignee_canonical_contact_id,
    resolved_at = NULL;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- Auto-resolve: activity ya no en canonical (cerrada en Odoo, delete_all del push)
  UPDATE public.reconciliation_issues ri
  SET resolved_at = now(),
      resolution_note = 'auto: activity completed or removed'
  WHERE ri.issue_type = 'comms.activity_overdue'
    AND ri.resolved_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.canonical_activities ca
      WHERE ca.bronze_id = (ri.metadata->>'activity_id')::bigint
        AND ca.is_overdue = TRUE
        AND ca.date_deadline < CURRENT_DATE
        AND ca.date_deadline > CURRENT_DATE - INTERVAL '90 days'
        AND ca.canonical_company_id IS NOT NULL
        AND COALESCE(ca.activity_type, '') NOT IN (
          'Crear factura de compras',
          'Exception',
          'Excepción'
        )
    );

  RETURN v_inserted;
EXCEPTION WHEN OTHERS THEN
  -- audit_runs real schema: (run_at, source, invariant_key, severity, details)
  INSERT INTO public.audit_runs (run_at, source, invariant_key, severity, details)
  VALUES (now(), 'detect_comms_activity_overdue', 'comms.activity_overdue',
          'error', jsonb_build_object('error', SQLERRM));
  RAISE;
END;
$func$;

GRANT EXECUTE ON FUNCTION public.detect_comms_activity_overdue()
  TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 6. Routing seeds
-- ----------------------------------------------------------------------------
INSERT INTO public.invariant_routing
  (issue_type, invariant_namespace, department_name, match_predicate, priority)
SELECT * FROM (VALUES
  ('comms.unanswered_external_thread'::text, 'comms'::text, 'Ventas'::text, '{}'::jsonb, 100),
  ('comms.activity_overdue'::text,           'comms'::text, 'Ventas'::text, '{}'::jsonb, 100)
) AS v(issue_type, invariant_namespace, department_name, match_predicate, priority)
WHERE NOT EXISTS (
  SELECT 1 FROM public.invariant_routing ir WHERE ir.issue_type = v.issue_type
);

-- ----------------------------------------------------------------------------
-- 7. Performance index for auto-resolve scans
-- ----------------------------------------------------------------------------
-- The detect functions UPDATE reconciliation_issues with NOT EXISTS subqueries
-- filtered by (issue_type LIKE 'comms.%' AND resolved_at IS NULL). Without this
-- index the UPDATE scans 245k+ rows each cron run. Partial index narrows scope.
CREATE INDEX IF NOT EXISTS idx_recon_issues_open_comms
  ON public.reconciliation_issues (issue_type)
  WHERE resolved_at IS NULL AND issue_type LIKE 'comms.%';

-- ----------------------------------------------------------------------------
-- 8. pg_cron schedule (hourly at HH:25)
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'comms_invariants_hourly') THEN
    PERFORM cron.unschedule('comms_invariants_hourly');
  END IF;
END $$;

SELECT cron.schedule(
  'comms_invariants_hourly',
  '25 * * * *',
  $cron$
    SELECT public.detect_comms_unanswered_external_thread();
    SELECT public.detect_comms_activity_overdue();
  $cron$
);

COMMIT;
