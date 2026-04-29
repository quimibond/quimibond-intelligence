-- 2026-04-28: Tighten order.orphan_delivery — limit to operationally-relevant window.
--
-- BACKGROUND
-- _sp4_run_extra block uses canonical_order_lines.has_pending_delivery
-- (qty_delivered < qty for sale lines in state sale|done) and order_date <
-- 14 days ago. With no upper bound, any SO line ever opened with undelivered
-- qty stays flagged forever, even after years of inactivity.
--
-- ANALYSIS (2026-04-28)
-- 3,134 open issues. Distribution by age:
--    <30d:    19
--    30-90d:  126
--    3-6mo:   102
--    6-12mo:  350
--    1-2y:  1,831
--    >2y:     706
--
-- User confirmed operational reality: ~69 orders to deliver. Matches
-- 68 distinct orders for state=sale, qty_del<qty, order_date >=30d ago.
-- The 2,989 issues >90d old are zombie SOs that nobody cancelled.
--
-- DECISION
-- Same pattern as order.orphan_invoicing fix: disable original block,
-- standalone helper with strict criteria + auto-resolve.
--
-- Strict window: order_date BETWEEN now-90d AND now-14d. Lower bound 14d
-- because some legitimate orders need a few days to fulfil; upper bound
-- 90d because anything older is abandoned (separate issue type if needed).

CREATE OR REPLACE FUNCTION public._sp4_check_order_orphan_delivery()
RETURNS jsonb
LANGUAGE plpgsql
SET statement_timeout TO '5min'
AS $fn$
DECLARE
  v_inserted integer := 0;
  v_resolved integer := 0;
BEGIN
  WITH ins AS (
    INSERT INTO reconciliation_issues (
      issue_id, issue_type, canonical_entity_type, canonical_entity_id, canonical_id,
      impact_mxn, severity, detected_at, invariant_key, action_cta, description, metadata
    )
    SELECT gen_random_uuid(), 'order.orphan_delivery',
           'order_line', col.canonical_id::text, col.canonical_id::text,
           NULL,
           'medium', now(), 'order.orphan_delivery', 'operationalize',
           format('SO %s line: %s units pending delivery (%s days old)',
                  col.order_name,
                  (col.qty - COALESCE(col.qty_delivered,0)),
                  (CURRENT_DATE - col.order_date)::integer),
           jsonb_build_object(
             'order_name',    col.order_name,
             'qty_pending',   (col.qty - COALESCE(col.qty_delivered,0)),
             'qty_delivered', col.qty_delivered
           )
    FROM canonical_order_lines col
    WHERE col.order_type = 'sale'
      AND col.order_state = 'sale'
      AND COALESCE(col.qty_delivered,0) < col.qty
      AND col.order_date >= CURRENT_DATE - INTERVAL '90 days'
      AND col.order_date <  CURRENT_DATE - INTERVAL '14 days'
      AND NOT EXISTS (
        SELECT 1 FROM reconciliation_issues ri
        WHERE ri.invariant_key = 'order.orphan_delivery'
          AND ri.canonical_id = col.canonical_id::text
          AND ri.resolved_at IS NULL
      )
    RETURNING 1
  )
  SELECT count(*) INTO v_inserted FROM ins;

  WITH classify AS (
    SELECT ri.issue_id,
           CASE
             WHEN col.canonical_id IS NULL                            THEN 'auto_line_deleted'
             WHEN col.order_state <> 'sale'                           THEN 'auto_order_state_changed'
             WHEN COALESCE(col.qty_delivered,0) >= col.qty            THEN 'auto_delivered'
             WHEN col.order_date < CURRENT_DATE - INTERVAL '90 days'  THEN 'auto_stale_abandoned_so'
             ELSE NULL
           END AS resolution_class
    FROM reconciliation_issues ri
    LEFT JOIN canonical_order_lines col ON col.canonical_id::text = ri.canonical_id
    WHERE ri.invariant_key = 'order.orphan_delivery'
      AND ri.resolved_at IS NULL
  ), upd AS (
    UPDATE reconciliation_issues ri
    SET resolved_at = now(),
        resolution  = c.resolution_class
    FROM classify c
    WHERE ri.issue_id = c.issue_id
      AND c.resolution_class IS NOT NULL
    RETURNING 1
  )
  SELECT count(*) INTO v_resolved FROM upd;

  RETURN jsonb_build_object('inserted', v_inserted, 'resolved', v_resolved);
END;
$fn$;

COMMENT ON FUNCTION public._sp4_check_order_orphan_delivery() IS
'order.orphan_delivery strict checker (2026-04-28). Replaces over-eager block in _sp4_run_extra (no order_date upper bound, kept zombie SOs flagged forever). Strict window: order_date BETWEEN now-90d AND now-14d. Daily pg_cron 7:00 UTC.';

UPDATE audit_tolerances
SET enabled = false,
    auto_resolve = true,
    notes = COALESCE(notes,'') ||
            ' [2026-04-28: disabled in _sp4_run_extra (no upper-bound order_date, kept zombie SOs forever). Replaced by _sp4_check_order_orphan_delivery() pg_cron 7:00 UTC with strict 14-90d window matching operational view (~69 SOs).]'
WHERE invariant_key = 'order.orphan_delivery';

SELECT cron.schedule(
  'order_orphan_delivery_strict_daily',
  '0 7 * * *',
  'SELECT _sp4_check_order_orphan_delivery()'
);

-- One-time drain
SELECT _sp4_check_order_orphan_delivery() AS one_time_result;
