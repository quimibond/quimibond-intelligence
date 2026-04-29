-- 2026-04-28: Add auto-resolver for delivery.late_active.
--
-- BACKGROUND
-- _sp4_run_extra creates a new reconciliation_issue when canonical_deliveries
-- is_late=true AND state NOT IN ('done','cancel'). When the delivery later
-- reaches state='done' or 'cancel', the issue is NOT auto-closed because
-- _sp4_run_extra only INSERTs, never UPDATEs. Result: 50 of 324 currently
-- open delivery.late_active issues correspond to deliveries that already
-- completed.
--
-- FIX
-- Standalone helper that closes stale issues whose underlying delivery is
-- no longer late. Scheduled via pg_cron 10 min after silver_sp4_reconcile_daily.
-- Same one-time function call drains current backlog.

CREATE OR REPLACE FUNCTION public._sp4_auto_resolve_delivery_late_active()
RETURNS integer
LANGUAGE plpgsql
SET statement_timeout TO '5min'
AS $fn$
DECLARE v_count integer;
BEGIN
  UPDATE reconciliation_issues ri
  SET resolved_at = now(),
      resolution  = 'auto_delivery_completed'
  WHERE ri.invariant_key = 'delivery.late_active'
    AND ri.resolved_at IS NULL
    AND EXISTS (
      SELECT 1 FROM canonical_deliveries cd
      WHERE cd.canonical_id::text = ri.canonical_id
        AND (cd.state IN ('done','cancel') OR NOT cd.is_late)
    );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$fn$;

COMMENT ON FUNCTION public._sp4_auto_resolve_delivery_late_active() IS
'Auto-resolves delivery.late_active issues whose underlying canonical_deliveries.state has reached done/cancel or is no longer late. Created 2026-04-28 to drain 50 stale issues; scheduled daily after silver_sp4_reconcile_daily.';

UPDATE audit_tolerances
SET auto_resolve = true,
    notes = COALESCE(notes,'') ||
            ' [2026-04-28: auto_resolve via _sp4_auto_resolve_delivery_late_active() pg_cron 6:40 UTC daily]'
WHERE invariant_key = 'delivery.late_active';

SELECT cron.schedule(
  'delivery_late_active_auto_resolve_daily',
  '40 6 * * *',
  'SELECT _sp4_auto_resolve_delivery_late_active()'
);

-- One-time backfill to drain the 50 currently stale
SELECT _sp4_auto_resolve_delivery_late_active() AS one_time_resolved_count;
