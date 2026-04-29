-- 2026-04-28: Tighten mfg.stock_drift — bound to recent MOs and auto-resolve when stock rebounds.
--
-- BACKGROUND
-- _sp4_run_extra block flags MOs in state='done' where the product's
-- current stock_qty is less than half of qty_produced. The condition is
-- time-dependent without a date bound: stock naturally drops as goods
-- are sold, and stock_qty is shared across all MOs of the same product
-- (so a new MO producing more inflates stock_qty for everyone).
--
-- ANALYSIS (2026-04-28)
-- 1,028 open issues:
--    <30d:    200
--   30-90d:   623
--   3-6mo:    205
-- All state='done'. Many are stale because:
--   (a) stock was naturally consumed by sales (normal activity)
--   (b) a later MO produced the same product, lifting stock_qty above
--       the threshold, but the historical issue stays open
--
-- Sample: MO TL/OP-ACA/05622-003 (qty=5,967, finished 4/23) → flagged.
-- Now stock_qty=46,406 because subsequent MOs of same product produced
-- more; issue should be closed.
--
-- DECISION
-- Same pattern: standalone helper with strict 14-day window for new
-- issues + auto-resolve for issues where condition no longer holds.

CREATE OR REPLACE FUNCTION public._sp4_check_mfg_stock_drift()
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
    SELECT gen_random_uuid(), 'mfg.stock_drift',
           'manufacturing', cm.canonical_id::text, cm.canonical_id::text,
           NULL, 'medium', now(),
           'mfg.stock_drift', 'review_manual',
           format('MO %s closed qty_produced=%s but product stock_qty=%s',
                  cm.name, cm.qty_produced, cp.stock_qty),
           jsonb_build_object('mo_name', cm.name,
                              'qty_produced', cm.qty_produced,
                              'stock_qty', cp.stock_qty,
                              'date_finished', cm.date_finished)
    FROM canonical_manufacturing cm
    JOIN canonical_products cp ON cp.id = cm.canonical_product_id
    WHERE cm.state='done'
      AND cm.qty_produced > 0
      AND cm.date_finished >= NOW() - INTERVAL '14 days'
      AND cp.stock_qty < cm.qty_produced * 0.5
      AND NOT EXISTS (
        SELECT 1 FROM reconciliation_issues ri
        WHERE ri.invariant_key='mfg.stock_drift'
          AND ri.canonical_id=cm.canonical_id::text
          AND ri.resolved_at IS NULL
      )
    RETURNING 1
  )
  SELECT count(*) INTO v_inserted FROM ins;

  WITH classify AS (
    SELECT ri.issue_id,
           CASE
             WHEN cm.canonical_id IS NULL                              THEN 'auto_mo_deleted'
             WHEN cm.state <> 'done'                                   THEN 'auto_mo_state_changed'
             WHEN cm.date_finished < NOW() - INTERVAL '14 days'        THEN 'auto_outside_14d_window'
             WHEN cp.id IS NULL                                        THEN 'auto_product_deleted'
             WHEN cp.stock_qty >= cm.qty_produced * 0.5                THEN 'auto_stock_rebounded'
             ELSE NULL
           END AS resolution_class
    FROM reconciliation_issues ri
    LEFT JOIN canonical_manufacturing cm ON cm.canonical_id::text = ri.canonical_id
    LEFT JOIN canonical_products cp ON cp.id = cm.canonical_product_id
    WHERE ri.invariant_key = 'mfg.stock_drift'
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

COMMENT ON FUNCTION public._sp4_check_mfg_stock_drift() IS
'mfg.stock_drift strict checker (2026-04-28). Replaces over-eager block in _sp4_run_extra (no date bound, no auto-resolve when stock rebounds). Strict 14-day window post-MO completion + auto-resolve when stock_qty >= qty_produced*0.5 (e.g., later MO produced more of same product). Daily pg_cron 7:20 UTC.';

UPDATE audit_tolerances
SET enabled = false,
    auto_resolve = true,
    notes = COALESCE(notes,'') ||
            ' [2026-04-28: disabled in _sp4_run_extra (time-dependent condition without date bound; stock_qty naturally drops or rebounds). Replaced by _sp4_check_mfg_stock_drift() pg_cron 7:20 UTC with strict 14-day window.]'
WHERE invariant_key = 'mfg.stock_drift';

SELECT cron.schedule(
  'mfg_stock_drift_strict_daily',
  '20 7 * * *',
  'SELECT _sp4_check_mfg_stock_drift()'
);

SELECT _sp4_check_mfg_stock_drift() AS one_time_result;
