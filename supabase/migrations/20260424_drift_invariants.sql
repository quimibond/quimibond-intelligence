-- 2026-04-24 — Register 3 drift invariantes so they flow into /inbox via
-- reconciliation_issues / silver_sp2_reconcile_* crons.
--
-- Schema deltas vs plan 2026-04-24-odoo-sat-drift-hardening.md Task 4:
--   * audit_tolerances has column `notes` (not `description`). The plan's
--     INSERT referenced `description`; mapped to `notes` here. abs_tolerance
--     and pct_tolerance are NOT NULL but carry defaults (0.01 / 0.001) so
--     we omit them and rely on the defaults.
--   * reconciliation_issues schema matches plan exactly.
--   * schema_changes uses `created_at` (auto-default), no column to insert
--     the executed timestamp into — plan's INSERT is fine as-is.

INSERT INTO audit_tolerances (invariant_key, check_cadence, enabled, severity_default, notes)
VALUES
  ('invoice.ar_sat_only_drift', 'hourly', true, 'medium',
   'CFDI vigente emitido (AR) sin contraparte en Odoo (2022+, Contitech-style gap).'),
  ('invoice.ar_odoo_only_drift', 'hourly', true, 'medium',
   'Factura out_invoice posted sin CFDI UUID en SAT (2022+, timbrado pendiente).'),
  ('invoice.ap_sat_only_drift', '2h', true, 'medium',
   'CFDI vigente recibido (AP) sin asiento en Odoo (2025+, categorías no-supplier excluidas).')
ON CONFLICT (invariant_key) DO UPDATE
SET enabled = EXCLUDED.enabled,
    severity_default = EXCLUDED.severity_default,
    notes = EXCLUDED.notes,
    check_cadence = EXCLUDED.check_cadence;

-- Extension: add invariant-emitting block.
-- Piggybacks on _sp4_run_extra style: inserts rows into reconciliation_issues if not
-- already open for the same canonical_entity_id.
CREATE OR REPLACE FUNCTION public.sp5_drift_invariants(p_key text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql
SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE
  v_log jsonb := '[]'::jsonb;
BEGIN
  -- AR sat_only (2022+)
  IF (p_key IS NULL OR p_key='invoice.ar_sat_only_drift')
     AND (SELECT enabled FROM audit_tolerances WHERE invariant_key='invoice.ar_sat_only_drift') THEN
    INSERT INTO reconciliation_issues
      (issue_id, issue_type, canonical_entity_type, canonical_entity_id, canonical_id,
       impact_mxn, severity, detected_at, invariant_key, action_cta, description, metadata)
    SELECT gen_random_uuid(), 'invoice.ar_sat_only_drift', 'invoice',
           ci.canonical_id, ci.canonical_id,
           (ci.amount_untaxed_sat * ci.tipo_cambio_sat),
           CASE WHEN (ci.amount_untaxed_sat * ci.tipo_cambio_sat) > 100000 THEN 'high' ELSE 'medium' END,
           now(), 'invoice.ar_sat_only_drift', 'link_manual',
           format('CFDI SAT %s emitido a %s sin match en Odoo',
                  ci.sat_uuid, ci.receptor_nombre),
           jsonb_build_object('sat_uuid', ci.sat_uuid, 'receptor_rfc', ci.receptor_rfc,
                              'invoice_date', ci.invoice_date_resolved)
    FROM canonical_invoices ci
    WHERE ci.direction='issued'
      AND ci.has_sat_record AND NOT ci.has_odoo_record
      AND ci.invoice_date_resolved >= '2022-01-01'
      AND LOWER(COALESCE(ci.estado_sat,'vigente')) NOT IN ('cancelado','c')
      AND NOT EXISTS (SELECT 1 FROM reconciliation_issues ri
        WHERE ri.invariant_key='invoice.ar_sat_only_drift'
          AND ri.canonical_id=ci.canonical_id AND ri.resolved_at IS NULL);
    v_log := v_log || jsonb_build_object('k','invoice.ar_sat_only_drift','status','ok');
  END IF;

  -- AR odoo_only (2022+)
  IF (p_key IS NULL OR p_key='invoice.ar_odoo_only_drift')
     AND (SELECT enabled FROM audit_tolerances WHERE invariant_key='invoice.ar_odoo_only_drift') THEN
    INSERT INTO reconciliation_issues
      (issue_id, issue_type, canonical_entity_type, canonical_entity_id, canonical_id,
       impact_mxn, severity, detected_at, invariant_key, action_cta, description, metadata)
    SELECT gen_random_uuid(), 'invoice.ar_odoo_only_drift', 'invoice',
           ci.canonical_id, ci.canonical_id,
           COALESCE(oi.amount_untaxed_mxn, 0),
           CASE WHEN COALESCE(oi.amount_untaxed_mxn,0) > 100000 THEN 'high' ELSE 'medium' END,
           now(), 'invoice.ar_odoo_only_drift', 'review_timbrado',
           format('Odoo %s posted sin CFDI UUID (timbrado pendiente o fallido)', ci.odoo_name),
           jsonb_build_object('odoo_invoice_id', ci.odoo_invoice_id, 'odoo_name', ci.odoo_name,
                              'invoice_date', ci.invoice_date_resolved)
    FROM canonical_invoices ci
    LEFT JOIN odoo_invoices oi ON oi.id = ci.odoo_invoice_id
    WHERE ci.direction='issued'
      AND ci.has_odoo_record AND NOT ci.has_sat_record
      AND ci.invoice_date_resolved >= '2022-01-01'
      AND COALESCE(ci.state_odoo,'posted') <> 'cancel'
      AND NOT EXISTS (SELECT 1 FROM reconciliation_issues ri
        WHERE ri.invariant_key='invoice.ar_odoo_only_drift'
          AND ri.canonical_id=ci.canonical_id AND ri.resolved_at IS NULL);
    v_log := v_log || jsonb_build_object('k','invoice.ar_odoo_only_drift','status','ok');
  END IF;

  -- AP sat_only (2025+, excluir categorías)
  IF (p_key IS NULL OR p_key='invoice.ap_sat_only_drift')
     AND (SELECT enabled FROM audit_tolerances WHERE invariant_key='invoice.ap_sat_only_drift') THEN
    INSERT INTO reconciliation_issues
      (issue_id, issue_type, canonical_entity_type, canonical_entity_id, canonical_id,
       impact_mxn, severity, detected_at, invariant_key, action_cta, description, metadata)
    SELECT gen_random_uuid(), 'invoice.ap_sat_only_drift', 'invoice',
           ci.canonical_id, ci.canonical_id,
           (ci.amount_untaxed_sat * ci.tipo_cambio_sat),
           'medium', now(), 'invoice.ap_sat_only_drift', 'link_manual',
           format('CFDI SAT %s recibido de %s sin asiento Odoo',
                  ci.sat_uuid, ci.emisor_nombre),
           jsonb_build_object('sat_uuid', ci.sat_uuid, 'emisor_rfc', ci.emisor_rfc,
                              'invoice_date', ci.invoice_date_resolved)
    FROM canonical_invoices ci
    JOIN canonical_companies cc ON cc.id = ci.emisor_canonical_company_id
    WHERE ci.direction='received'
      AND ci.has_sat_record AND NOT ci.has_odoo_record
      AND ci.invoice_date_resolved >= '2025-01-01'
      AND LOWER(COALESCE(ci.estado_sat,'vigente')) NOT IN ('cancelado','c')
      AND NOT cc.is_foreign AND NOT cc.is_bank
      AND NOT cc.is_government AND NOT cc.is_payroll_entity
      AND NOT EXISTS (SELECT 1 FROM reconciliation_issues ri
        WHERE ri.invariant_key='invoice.ap_sat_only_drift'
          AND ri.canonical_id=ci.canonical_id AND ri.resolved_at IS NULL);
    v_log := v_log || jsonb_build_object('k','invoice.ap_sat_only_drift','status','ok');
  END IF;

  RETURN jsonb_build_object('drift_invariants', v_log);
END;
$fn$;

-- Wire into existing run_reconciliation: extend to call sp5_drift_invariants when full-run.
-- The existing run_reconciliation composes sp2 + sp4 results. We add sp5-drift.
CREATE OR REPLACE FUNCTION public.run_reconciliation(p_key text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE v_sp2 jsonb; v_sp4 jsonb; v_sp5d jsonb;
BEGIN
  SELECT json_agg(r) INTO v_sp2
  FROM run_reconciliation_sp2(p_key) r;
  v_sp4 := _sp4_run_extra(p_key);
  v_sp5d := public.sp5_drift_invariants(p_key);
  RETURN jsonb_build_object('sp2', v_sp2, 'sp4', v_sp4, 'sp5_drift', v_sp5d);
END;
$fn$;

-- Seed immediate run so issues appear without waiting for cron
SELECT public.sp5_drift_invariants(NULL);

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('ADD FUNCTION','reconciliation_issues',
        '3 drift invariantes (AR sat_only, AR odoo_only, AP sat_only) wired into run_reconciliation.',
        '20260424_drift_invariants.sql','audit-contitech-2026-04-23', true);
