-- 2026-04-26 — Silver SP2 stale invoice-issue sweep
--
-- Audit triggered by user screenshot of /inbox/insight/[uuid]: the page
-- showed a critical $1.4M alert "Odoo posted sin cfdi_uuid (post-addon-fix)"
-- pointing to invoice INV/2025/03/0185 (Contitech) — but the invoice already
-- had sat_uuid + has_sat_record=true in canonical_invoices. Investigation:
--
--   1. invoice.posted_without_uuid has NO auto-resolve block in
--      run_reconciliation(). audit_tolerances.auto_resolve = false. Each
--      hourly run inserts new rows for any invoice whose Odoo addon hasn't
--      synced cfdi_uuid yet — even if the canonical row already has the
--      sat_uuid via SAT-side match.
--
--   2. invoice.missing_sat_timbrado has an auto-resolve block but only
--      checks has_sat_record=true. The matcher sometimes populates sat_uuid
--      without flipping has_sat_record (observed on 5 invoices today).
--
-- Fix: a new RPC `silver_close_stale_invoice_issues()` that closes both
-- invariants when canonical_invoices proves the invoice is timbrada
-- (sat_uuid IS NOT NULL OR has_sat_record = true). Wired into
-- /api/pipeline/reconcile so it runs after every reconcile cron.
--
-- Already applied to production via execute_safe_ddl on 2026-04-26.
-- This file documents the change for repo-history parity.
--
-- Cleanup of the historical 53 stale rows happened in two passes:
--   - 22 posted_without_uuid + 20 missing_sat_timbrado closed manually with
--     resolution = 'auto_closed_stale_data' before the RPC existed.
--   - 11 + 5 closed by silver_close_stale_invoice_issues() during testing
--     with resolution = 'auto_close_stale_uuid' / 'auto_close_stale_sat_record'.

CREATE OR REPLACE FUNCTION silver_close_stale_invoice_issues()
RETURNS TABLE(invariant_key text, closed_count integer)
LANGUAGE plpgsql
AS $$
DECLARE
  v_p_uuid integer := 0;
  v_m_sat  integer := 0;
BEGIN
  WITH closed AS (
    UPDATE reconciliation_issues ri
    SET    resolved_at     = now(),
           resolution      = 'auto_close_stale_uuid',
           resolution_note = 'silver_close_stale_invoice_issues: invoice has sat_uuid or has_sat_record'
    WHERE  ri.invariant_key = 'invoice.posted_without_uuid'
      AND  ri.resolved_at IS NULL
      AND  EXISTS (
        SELECT 1 FROM canonical_invoices ci
        WHERE  ci.canonical_id = ri.canonical_entity_id
          AND  (ci.sat_uuid IS NOT NULL OR ci.has_sat_record = true)
      )
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_p_uuid FROM closed;

  WITH closed AS (
    UPDATE reconciliation_issues ri
    SET    resolved_at     = now(),
           resolution      = 'auto_close_stale_sat_record',
           resolution_note = 'silver_close_stale_invoice_issues: invoice has sat_uuid or has_sat_record'
    WHERE  ri.invariant_key = 'invoice.missing_sat_timbrado'
      AND  ri.resolved_at IS NULL
      AND  EXISTS (
        SELECT 1 FROM canonical_invoices ci
        WHERE  ci.canonical_id = ri.canonical_entity_id
          AND  (ci.sat_uuid IS NOT NULL OR ci.has_sat_record = true)
      )
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_m_sat FROM closed;

  RETURN QUERY VALUES
    ('invoice.posted_without_uuid'::text, v_p_uuid),
    ('invoice.missing_sat_timbrado'::text, v_m_sat);
END;
$$;

-- Permissions: service role calls it from /api/pipeline/reconcile, but the
-- function is SECURITY INVOKER (default) so it inherits the caller's perms.
-- service_role has full access to reconciliation_issues so no GRANT needed.
