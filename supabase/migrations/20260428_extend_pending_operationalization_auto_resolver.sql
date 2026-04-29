-- 2026-04-28: Extend auto-resolver for invoice.pending_operationalization to align
-- with SP10.25 strict filter applied to the INSERT path.
--
-- BACKGROUND
-- run_reconciliation_sp2's INSERT for this invariant already has SP10.25
-- filters (excludes pre-2026 supplier invoices, personal RFCs, pre-2022,
-- etc.). But the existing auto_resolve block only closes issues where
-- has_odoo_record=true, leaving 4,416 historical issues stuck open even
-- though the same SP10.25 filter would prevent re-creation.
--
-- ANALYSIS (2026-04-28)
-- 4,695 open. Distribution by scope/year:
--   purchase (PNT receptor) 2022:  2,051  ← excluded by SP10.25 going fwd
--   purchase (PNT receptor) 2023:    977  ← excluded by SP10.25 going fwd
--   purchase (PNT receptor) 2024:    851  ← excluded by SP10.25 going fwd
--   purchase (PNT receptor) 2025:    537  ← excluded by SP10.25 going fwd
--   purchase (PNT receptor) 2026:    239  (legitimate, current)
--   sale (PNT emisor) 2022-2026:      40  (legitimate)
--
-- Pre-2026 supplier invoices = 4,416 stale issues (94%). All have
-- has_odoo_record=false so the existing auto_resolve never closes them.
--
-- DECISION
-- Standalone helper that runs after run_reconciliation_sp2 to close
-- issues that fail any SP10.25 condition. Daily pg_cron 7:30 UTC.

CREATE OR REPLACE FUNCTION public._sp2_check_invoice_pending_op_strict()
RETURNS jsonb
LANGUAGE plpgsql
SET statement_timeout TO '5min'
AS $fn$
DECLARE
  v_resolved integer := 0;
BEGIN
  WITH classify AS (
    SELECT ri.issue_id,
           CASE
             WHEN ci.canonical_id IS NULL                              THEN 'auto_invoice_deleted'
             WHEN ci.pending_operationalization = false                THEN 'auto_now_operationalized'
             WHEN ci.has_odoo_record = true                            THEN 'auto_now_has_odoo'
             WHEN ci.estado_sat <> 'vigente'                           THEN 'auto_sat_status_changed'
             WHEN ci.fecha_timbrado < '2022-01-01'                     THEN 'auto_pre_2022_excluded'
             WHEN ci.emisor_rfc IN ('MIPJ691003QJ1','MITJ991130TV7')   THEN 'auto_personal_rfc_emisor'
             WHEN ci.receptor_rfc IN ('MIPJ691003QJ1','MITJ991130TV7') THEN 'auto_personal_rfc_receptor'
             WHEN ci.emisor_rfc <> 'PNT920218IW5'
              AND ci.receptor_rfc <> 'PNT920218IW5'                    THEN 'auto_not_quimibond_scope'
             WHEN ci.receptor_rfc = 'PNT920218IW5'
              AND ci.fecha_timbrado < '2026-01-01'                     THEN 'auto_sp10_25_pre_2026_supplier'
             ELSE NULL
           END AS resolution_class
    FROM reconciliation_issues ri
    LEFT JOIN canonical_invoices ci ON ci.canonical_id = ri.canonical_entity_id
    WHERE ri.invariant_key = 'invoice.pending_operationalization'
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

  RETURN jsonb_build_object('resolved', v_resolved);
END;
$fn$;

COMMENT ON FUNCTION public._sp2_check_invoice_pending_op_strict() IS
'invoice.pending_operationalization auto-resolver aligned with SP10.25 INSERT filters (run_reconciliation_sp2). Closes issues that fail any SP10.25 condition (pre-2022, personal RFC, not Quimibond, pre-2026 supplier, etc.). Existing auto_resolve only checks has_odoo_record. Daily pg_cron 7:30 UTC.';

UPDATE audit_tolerances
SET notes = COALESCE(notes,'') ||
            ' [2026-04-28: secondary auto-resolver _sp2_check_invoice_pending_op_strict() pg_cron 7:30 UTC closes issues failing SP10.25 conditions beyond just has_odoo_record.]'
WHERE invariant_key = 'invoice.pending_operationalization';

SELECT cron.schedule(
  'invoice_pending_op_strict_resolver_daily',
  '30 7 * * *',
  'SELECT _sp2_check_invoice_pending_op_strict()'
);

-- One-time backfill drain
SELECT _sp2_check_invoice_pending_op_strict() AS one_time_result;
