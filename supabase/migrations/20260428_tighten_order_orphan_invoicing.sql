-- 2026-04-28: Tighten order.orphan_invoicing — require qty_delivered > qty_invoiced.
--
-- BACKGROUND
-- _sp4_run_extra block uses canonical_order_lines.has_pending_invoicing,
-- defined as `qty_invoiced < qty`. That fires for any line where the full
-- ordered quantity hasn't been invoiced — including lines that were never
-- delivered (qty_delivered=0) and lines fully invoiced for what was
-- delivered (qty_delivered <= qty_invoiced).
--
-- ANALYSIS (2026-04-28)
-- Of 3,149 currently-open order.orphan_invoicing issues:
--   1,820 (58%) qty_delivered = 0 → covered by order.orphan_delivery
--   1,284 (41%) qty_delivered ≤ qty_invoiced → fully invoiced for delivery
--      48 (1.5%) qty_delivered > qty_invoiced → REAL invoicing backlog
-- 99% false-positive rate. Real backlog only $527k vs claimed $40.8M.
--
-- DECISION
-- Pattern matches clave_prodserv_drift fix (P0-2): disable original block
-- in _sp4_run_extra, add standalone helper with stricter criteria + auto-
-- resolve. Daily pg_cron after silver_sp4_reconcile_daily.

CREATE OR REPLACE FUNCTION public._sp4_check_order_orphan_invoicing()
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
    SELECT gen_random_uuid(), 'order.orphan_invoicing',
           'order_line', col.canonical_id::text, col.canonical_id::text,
           ((COALESCE(col.qty_delivered,0) - COALESCE(col.qty_invoiced,0)) * col.price_unit)::numeric,
           'medium', now(), 'order.orphan_invoicing', 'operationalize',
           format('SO %s line: %s units delivered but not invoiced (%s days old)',
                  col.order_name,
                  COALESCE(col.qty_delivered,0) - COALESCE(col.qty_invoiced,0),
                  (CURRENT_DATE - col.order_date)::integer),
           jsonb_build_object(
             'order_name',    col.order_name,
             'qty_delivered', col.qty_delivered,
             'qty_invoiced',  col.qty_invoiced
           )
    FROM canonical_order_lines col
    WHERE col.order_type = 'sale'
      AND col.order_state IN ('sale','done')
      AND COALESCE(col.qty_delivered,0) > COALESCE(col.qty_invoiced,0)
      AND col.order_date < CURRENT_DATE - INTERVAL '30 days'
      AND NOT EXISTS (
        SELECT 1 FROM reconciliation_issues ri
        WHERE ri.invariant_key = 'order.orphan_invoicing'
          AND ri.canonical_id = col.canonical_id::text
          AND ri.resolved_at IS NULL
      )
    RETURNING 1
  )
  SELECT count(*) INTO v_inserted FROM ins;

  WITH classify AS (
    SELECT ri.issue_id,
           CASE
             WHEN col.canonical_id IS NULL                                     THEN 'auto_line_deleted'
             WHEN col.order_state NOT IN ('sale','done')                       THEN 'auto_order_state_changed'
             WHEN COALESCE(col.qty_delivered,0) = 0                            THEN 'auto_never_delivered'
             WHEN COALESCE(col.qty_delivered,0) <= COALESCE(col.qty_invoiced,0) THEN 'auto_fully_invoiced'
             ELSE NULL
           END AS resolution_class
    FROM reconciliation_issues ri
    LEFT JOIN canonical_order_lines col ON col.canonical_id::text = ri.canonical_id
    WHERE ri.invariant_key = 'order.orphan_invoicing'
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

COMMENT ON FUNCTION public._sp4_check_order_orphan_invoicing() IS
'order.orphan_invoicing strict checker (2026-04-28). Replaces over-eager block in _sp4_run_extra (which used has_pending_invoicing = qty_invoiced < qty, producing 99% false positives). Strict criterion: qty_delivered > qty_invoiced. Daily pg_cron 6:50 UTC.';

UPDATE audit_tolerances
SET enabled = false,
    auto_resolve = true,
    notes = COALESCE(notes,'') ||
            ' [2026-04-28: disabled in _sp4_run_extra (over-eager has_pending_invoicing flag). Replaced by _sp4_check_order_orphan_invoicing() pg_cron 6:50 UTC with strict qty_delivered > qty_invoiced.]'
WHERE invariant_key = 'order.orphan_invoicing';

SELECT cron.schedule(
  'order_orphan_invoicing_strict_daily',
  '50 6 * * *',
  'SELECT _sp4_check_order_orphan_invoicing()'
);

-- One-time drain: clear ~3,100 false-positive backlog
SELECT _sp4_check_order_orphan_invoicing() AS one_time_result;
