-- 2026-04-24 — Auto-link Odoo↔SAT invoice pairs where UUID join failed but amount+date+party match.
-- These are mostly CFDI UUIDs never propagated from Odoo to Supabase (or stored in different
-- casing — see memory project_sp10_6_uuid_case_fix). This function finds same-company, same-amount
-- (±$1), close-date (±7 days) candidates and links them by writing the UUID onto the Odoo row.
--
-- IMPORTANT: This is a SEED, not a deterministic matcher. Only links rows that have exactly
-- ONE candidate on each side (prevents ambiguous merges). Ambiguous candidates stay unlinked.

-- Extend mdm_manual_overrides action CHECK to accept the new audit verb. Plan note said no CHECK
-- existed; production has one limited to {link, unlink, merge, split, assign_attribute}. Add
-- 'autolink_drift_pair' so Step 2.4 audit query works and invariants in Task 4 can filter by it.
ALTER TABLE public.mdm_manual_overrides
  DROP CONSTRAINT IF EXISTS mdm_manual_overrides_action_check;
ALTER TABLE public.mdm_manual_overrides
  ADD CONSTRAINT mdm_manual_overrides_action_check
  CHECK (action = ANY (ARRAY['link','unlink','merge','split','assign_attribute','autolink_drift_pair']));

CREATE OR REPLACE FUNCTION public.autolink_drift_pairs(
  p_direction text DEFAULT 'issued',
  p_from_date date DEFAULT '2022-01-01',
  p_amount_tol_mxn numeric DEFAULT 1.0,
  p_days_tol integer DEFAULT 7
)
RETURNS TABLE(linked_pairs integer, failed_pairs integer) LANGUAGE plpgsql
SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_linked integer := 0;
  v_failed integer := 0;
  r record;
BEGIN
  SET LOCAL statement_timeout = '10min';

  FOR r IN
    WITH sat_rows AS (
      SELECT ci.canonical_id AS sat_canonical_id,
             ci.sat_uuid,
             CASE WHEN p_direction='issued' THEN ci.receptor_canonical_company_id
                  ELSE ci.emisor_canonical_company_id END AS cc_id,
             (ci.amount_untaxed_sat * ci.tipo_cambio_sat)::numeric AS amt_mxn,
             ci.invoice_date_resolved AS inv_date
      FROM canonical_invoices ci
      WHERE ci.direction=p_direction
        AND ci.has_sat_record AND NOT ci.has_odoo_record
        AND ci.invoice_date_resolved >= p_from_date
        AND LOWER(COALESCE(ci.estado_sat,'vigente')) NOT IN ('cancelado','c')
        AND ci.sat_uuid IS NOT NULL
    ),
    odoo_rows AS (
      SELECT ci.canonical_id AS odoo_canonical_id,
             ci.odoo_invoice_id,
             CASE WHEN p_direction='issued' THEN ci.receptor_canonical_company_id
                  ELSE ci.emisor_canonical_company_id END AS cc_id,
             oi.amount_untaxed_mxn AS amt_mxn,
             ci.invoice_date_resolved AS inv_date
      FROM canonical_invoices ci
      JOIN odoo_invoices oi ON oi.id = ci.odoo_invoice_id
      WHERE ci.direction=p_direction
        AND ci.has_odoo_record AND NOT ci.has_sat_record
        AND ci.invoice_date_resolved >= p_from_date
        AND COALESCE(ci.state_odoo,'posted') <> 'cancel'
    ),
    candidates AS (
      SELECT s.sat_canonical_id, s.sat_uuid, o.odoo_canonical_id, o.odoo_invoice_id,
             s.cc_id, s.amt_mxn AS sat_amt, o.amt_mxn AS odoo_amt,
             ABS(s.inv_date - o.inv_date) AS day_diff
      FROM sat_rows s JOIN odoo_rows o
        ON s.cc_id = o.cc_id
       AND ABS(s.amt_mxn - o.amt_mxn) <= p_amount_tol_mxn
       AND ABS(s.inv_date - o.inv_date) <= p_days_tol
    ),
    -- Only keep candidates that are unambiguous (1 SAT matches exactly 1 Odoo and vice versa)
    sat_counts AS (SELECT sat_canonical_id, COUNT(*) AS n FROM candidates GROUP BY 1),
    odoo_counts AS (SELECT odoo_canonical_id, COUNT(*) AS n FROM candidates GROUP BY 1)
    SELECT c.*
    FROM candidates c
    JOIN sat_counts sc ON sc.sat_canonical_id = c.sat_canonical_id AND sc.n = 1
    JOIN odoo_counts oc ON oc.odoo_canonical_id = c.odoo_canonical_id AND oc.n = 1
  LOOP
    BEGIN
      -- Write the SAT UUID onto the Odoo invoice; the canonical_invoices trigger will merge
      UPDATE odoo_invoices SET cfdi_uuid = r.sat_uuid WHERE id = r.odoo_invoice_id;

      -- Record the link in mdm_manual_overrides (audit trail).
      -- NOTE: plan spec used {action, source_link_id, payload, is_active, created_by, created_at};
      -- production schema also requires {entity_type, canonical_id, override_field, override_value,
      -- override_source, linked_by} NOT NULL. Populated here to match actual schema.
      INSERT INTO mdm_manual_overrides (
        entity_type, canonical_id, override_field, override_value,
        override_source, linked_by,
        action, source_link_id, payload, is_active, created_at
      ) VALUES (
        'invoice',
        r.odoo_canonical_id,
        'cfdi_uuid',
        r.sat_uuid,
        'autolink_drift_pairs',
        'autolink_drift_pairs',
        'autolink_drift_pair',
        NULL,
        jsonb_build_object(
          'sat_canonical_id', r.sat_canonical_id,
          'odoo_canonical_id', r.odoo_canonical_id,
          'sat_uuid', r.sat_uuid,
          'odoo_invoice_id', r.odoo_invoice_id,
          'cc_id', r.cc_id,
          'sat_amt_mxn', r.sat_amt,
          'odoo_amt_mxn', r.odoo_amt,
          'day_diff', r.day_diff,
          'direction', p_direction
        ),
        true, now()
      );

      v_linked := v_linked + 1;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
    END;
  END LOOP;

  linked_pairs := v_linked;
  failed_pairs := v_failed;
  RETURN NEXT;
END;$fn$;

COMMENT ON FUNCTION public.autolink_drift_pairs IS 'Auto-link sat_only+odoo_only candidates by writing SAT uuid on Odoo row. Safe: only links 1:1 unambiguous pairs.';

-- Run for AR (2022+) and AP (2025+)
SELECT 'ar_autolink' AS run, linked_pairs, failed_pairs
FROM public.autolink_drift_pairs('issued', '2022-01-01'::date, 1.0, 7);

SELECT 'ap_autolink' AS run, linked_pairs, failed_pairs
FROM public.autolink_drift_pairs('received', '2025-01-01'::date, 1.0, 7);

-- Refresh financials to let the new UUID matches propagate
SELECT public.refresh_canonical_company_financials(NULL);

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('SEED','odoo_invoices',
        'Autolinked unambiguous Odoo↔SAT drift pairs (1:1 by cc_id + amount±$1 + date±7d).',
        '20260424_drift_pair_autolink.sql','audit-contitech-2026-04-23', true);
