-- supabase/migrations/1056_silver_sp4_run_reconciliation_part1.sql
--
-- Silver SP4 — Task 17: _sp4_run_extra() part 1 (invoice + payment + tax invariants)
-- Spec §9.2; Plan Task 17. Invariants stay DISABLED until Task 18.
--
-- NOTE: SP2 run_reconciliation returns TABLE(invariant_key text, new_issues integer,
-- auto_resolved integer), so the wrapper aggregates its rows as jsonb via json_agg.

BEGIN;

-- ===== _sp4_run_extra =====================================================
CREATE OR REPLACE FUNCTION _sp4_run_extra(p_key text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE
  v_log jsonb := '[]'::jsonb;
BEGIN
  -- invoice.amount_diff_post_fx -----------------------------------
  IF (p_key IS NULL OR p_key='invoice.amount_diff_post_fx')
     AND (SELECT enabled FROM audit_tolerances WHERE invariant_key='invoice.amount_diff_post_fx') THEN

    INSERT INTO reconciliation_issues
      (issue_id, issue_type, canonical_entity_type, canonical_entity_id, canonical_id,
       impact_mxn, severity, detected_at, invariant_key, action_cta, description, metadata)
    SELECT gen_random_uuid(), 'invoice.amount_diff_post_fx', 'invoice', ci.canonical_id, ci.canonical_id,
           ABS(COALESCE(ci.amount_total_mxn_odoo,0) - COALESCE(ci.amount_total_mxn_sat,0)),
           CASE WHEN GREATEST(ABS(ci.amount_total_mxn_odoo),ABS(ci.amount_total_mxn_sat),1) > 0
                 AND 100.0*ABS(COALESCE(ci.amount_total_mxn_odoo,0)-COALESCE(ci.amount_total_mxn_sat,0))
                      /GREATEST(ABS(ci.amount_total_mxn_odoo),ABS(ci.amount_total_mxn_sat),1) > 5
                THEN 'high' ELSE 'medium' END,
           now(), 'invoice.amount_diff_post_fx', 'review_amount_diff',
           format('Post-FX amount diff: |%s - %s| = %s MXN',
                  ci.amount_total_mxn_odoo, ci.amount_total_mxn_sat,
                  ABS(COALESCE(ci.amount_total_mxn_odoo,0)-COALESCE(ci.amount_total_mxn_sat,0))),
           jsonb_build_object(
             'amount_mxn_odoo', ci.amount_total_mxn_odoo,
             'amount_mxn_sat',  ci.amount_total_mxn_sat,
             'abs_diff',        ABS(COALESCE(ci.amount_total_mxn_odoo,0)-COALESCE(ci.amount_total_mxn_sat,0))
           )
    FROM canonical_invoices ci
    WHERE ci.has_odoo_record AND ci.has_sat_record
      AND ci.currency_sat <> 'MXN'
      AND ABS(COALESCE(ci.amount_total_mxn_odoo,0) - COALESCE(ci.amount_total_mxn_sat,0)) > 50
      AND NOT EXISTS (
        SELECT 1 FROM reconciliation_issues ri
        WHERE ri.invariant_key='invoice.amount_diff_post_fx'
          AND ri.canonical_id=ci.canonical_id AND ri.resolved_at IS NULL
      );

    v_log := v_log || jsonb_build_object('k','invoice.amount_diff_post_fx','status','ok');
  END IF;

  -- invoice.uuid_mismatch_rfc --------------------------------------
  IF (p_key IS NULL OR p_key='invoice.uuid_mismatch_rfc')
     AND (SELECT enabled FROM audit_tolerances WHERE invariant_key='invoice.uuid_mismatch_rfc') THEN

    INSERT INTO reconciliation_issues
      (issue_id, issue_type, canonical_entity_type, canonical_entity_id, canonical_id,
       impact_mxn, severity, detected_at, invariant_key, action_cta, description, metadata)
    SELECT gen_random_uuid(), 'invoice.uuid_mismatch_rfc', 'invoice', ci.canonical_id, ci.canonical_id,
           ci.amount_total_mxn_resolved, 'critical', now(),
           'invoice.uuid_mismatch_rfc', 'review_manual',
           format('UUID %s match but RFC mismatch: odoo emisor=%s vs SAT emisor=%s; odoo receptor=%s vs SAT receptor=%s',
                  ci.sat_uuid, ci.emisor_rfc, si.emisor_rfc, ci.receptor_rfc, si.receptor_rfc),
           jsonb_build_object('sat_uuid', ci.sat_uuid, 'odoo_invoice_id', ci.odoo_invoice_id)
    FROM canonical_invoices ci
    JOIN syntage_invoices si ON si.uuid = ci.sat_uuid
    WHERE ci.has_odoo_record AND ci.has_sat_record
      AND ci.sat_uuid IS NOT NULL
      AND (si.emisor_rfc   IS DISTINCT FROM ci.emisor_rfc
        OR si.receptor_rfc IS DISTINCT FROM ci.receptor_rfc)
      AND NOT EXISTS (
        SELECT 1 FROM reconciliation_issues ri
        WHERE ri.invariant_key='invoice.uuid_mismatch_rfc'
          AND ri.canonical_id=ci.canonical_id AND ri.resolved_at IS NULL
      );

    v_log := v_log || jsonb_build_object('k','invoice.uuid_mismatch_rfc','status','ok');
  END IF;

  -- invoice.without_order -------------------------------------------
  IF (p_key IS NULL OR p_key='invoice.without_order')
     AND (SELECT enabled FROM audit_tolerances WHERE invariant_key='invoice.without_order') THEN

    INSERT INTO reconciliation_issues
      (issue_id, issue_type, canonical_entity_type, canonical_entity_id, canonical_id,
       impact_mxn, severity, detected_at, invariant_key, action_cta, description, metadata)
    SELECT gen_random_uuid(), 'invoice.without_order', 'invoice', ci.canonical_id, ci.canonical_id,
           ci.amount_total_mxn_resolved, 'low', now(),
           'invoice.without_order', 'link_manual',
           format('Invoice %s has no matching SO/PO', ci.odoo_name),
           jsonb_build_object('odoo_ref', ci.odoo_ref, 'odoo_name', ci.odoo_name)
    FROM canonical_invoices ci
    WHERE ci.has_odoo_record
      AND ci.invoice_date >= CURRENT_DATE - interval '365 days'
      AND (ci.odoo_ref IS NOT NULL OR ci.odoo_name IS NOT NULL)
      AND NOT EXISTS (
        SELECT 1 FROM canonical_sale_orders so
         WHERE so.name = ci.odoo_ref OR so.name = ci.odoo_name
      )
      AND NOT EXISTS (
        SELECT 1 FROM canonical_purchase_orders po
         WHERE po.name = ci.odoo_ref OR po.name = ci.odoo_name
      )
      AND NOT EXISTS (
        SELECT 1 FROM reconciliation_issues ri
         WHERE ri.invariant_key='invoice.without_order'
           AND ri.canonical_id=ci.canonical_id AND ri.resolved_at IS NULL
      );

    v_log := v_log || jsonb_build_object('k','invoice.without_order','status','ok');
  END IF;

  -- payment.amount_mismatch -----------------------------------------
  IF (p_key IS NULL OR p_key='payment.amount_mismatch')
     AND (SELECT enabled FROM audit_tolerances WHERE invariant_key='payment.amount_mismatch') THEN

    INSERT INTO reconciliation_issues
      (issue_id, issue_type, canonical_entity_type, canonical_entity_id, canonical_id,
       impact_mxn, severity, detected_at, invariant_key, action_cta, description, metadata)
    SELECT gen_random_uuid(), 'payment.amount_mismatch', 'payment', cp.canonical_id, cp.canonical_id,
           cp.amount_mxn_resolved, 'high', now(),
           'payment.amount_mismatch', 'review_amount_diff',
           format('Payment amount diff: odoo=%s sat=%s diff=%s', cp.amount_odoo, cp.amount_sat, cp.amount_diff_abs),
           jsonb_build_object('amount_diff_abs', cp.amount_diff_abs)
    FROM canonical_payments cp
    WHERE cp.has_odoo_record AND cp.has_sat_record
      AND cp.amount_diff_abs > 0.01
      AND NOT EXISTS (
        SELECT 1 FROM reconciliation_issues ri
         WHERE ri.invariant_key='payment.amount_mismatch'
           AND ri.canonical_id=cp.canonical_id AND ri.resolved_at IS NULL
      );

    v_log := v_log || jsonb_build_object('k','payment.amount_mismatch','status','ok');
  END IF;

  -- payment.date_mismatch -------------------------------------------
  IF (p_key IS NULL OR p_key='payment.date_mismatch')
     AND (SELECT enabled FROM audit_tolerances WHERE invariant_key='payment.date_mismatch') THEN

    INSERT INTO reconciliation_issues
      (issue_id, issue_type, canonical_entity_type, canonical_entity_id, canonical_id,
       impact_mxn, severity, detected_at, invariant_key, action_cta, description, metadata)
    SELECT gen_random_uuid(), 'payment.date_mismatch', 'payment', cp.canonical_id, cp.canonical_id,
           cp.amount_mxn_resolved, 'low', now(),
           'payment.date_mismatch', 'review_manual',
           format('Payment date off: odoo=%s sat=%s',
                  cp.payment_date_odoo, cp.fecha_pago_sat::date),
           jsonb_build_object('diff_days', ABS(cp.fecha_pago_sat::date - cp.payment_date_odoo))
    FROM canonical_payments cp
    WHERE cp.has_odoo_record AND cp.has_sat_record
      AND cp.payment_date_odoo IS NOT NULL AND cp.fecha_pago_sat IS NOT NULL
      AND ABS(cp.fecha_pago_sat::date - cp.payment_date_odoo) > 1
      AND NOT EXISTS (
        SELECT 1 FROM reconciliation_issues ri
         WHERE ri.invariant_key='payment.date_mismatch'
           AND ri.canonical_id=cp.canonical_id AND ri.resolved_at IS NULL
      );

    v_log := v_log || jsonb_build_object('k','payment.date_mismatch','status','ok');
  END IF;

  -- payment.allocation_over -----------------------------------------
  IF (p_key IS NULL OR p_key='payment.allocation_over')
     AND (SELECT enabled FROM audit_tolerances WHERE invariant_key='payment.allocation_over') THEN

    INSERT INTO reconciliation_issues
      (issue_id, issue_type, canonical_entity_type, canonical_entity_id, canonical_id,
       impact_mxn, severity, detected_at, invariant_key, action_cta, description, metadata)
    SELECT gen_random_uuid(), 'payment.allocation_over', 'payment', cp.canonical_id, cp.canonical_id,
           (a.total - cp.amount_resolved), 'medium', now(),
           'payment.allocation_over', 'review_manual',
           format('Allocations %s > payment %s', a.total, cp.amount_resolved),
           jsonb_build_object('total_allocated', a.total, 'amount_resolved', cp.amount_resolved)
    FROM canonical_payments cp
    JOIN (SELECT payment_canonical_id, SUM(allocated_amount) total
            FROM canonical_payment_allocations GROUP BY 1) a
      ON a.payment_canonical_id = cp.canonical_id
    WHERE a.total > COALESCE(cp.amount_resolved, 0) + 0.01
      AND NOT EXISTS (
        SELECT 1 FROM reconciliation_issues ri
         WHERE ri.invariant_key='payment.allocation_over'
           AND ri.canonical_id=cp.canonical_id AND ri.resolved_at IS NULL
      );

    v_log := v_log || jsonb_build_object('k','payment.allocation_over','status','ok');
  END IF;

  -- payment.allocation_under ----------------------------------------
  IF (p_key IS NULL OR p_key='payment.allocation_under')
     AND (SELECT enabled FROM audit_tolerances WHERE invariant_key='payment.allocation_under') THEN

    INSERT INTO reconciliation_issues
      (issue_id, issue_type, canonical_entity_type, canonical_entity_id, canonical_id,
       impact_mxn, severity, detected_at, invariant_key, action_cta, description, metadata)
    SELECT gen_random_uuid(), 'payment.allocation_under', 'payment', cp.canonical_id, cp.canonical_id,
           (cp.amount_resolved - a.total), 'low', now(),
           'payment.allocation_under', 'review_manual',
           format('Allocations %s < payment %s', a.total, cp.amount_resolved),
           jsonb_build_object('total_allocated', a.total, 'amount_resolved', cp.amount_resolved)
    FROM canonical_payments cp
    JOIN (SELECT payment_canonical_id, SUM(allocated_amount) total
            FROM canonical_payment_allocations GROUP BY 1) a
      ON a.payment_canonical_id = cp.canonical_id
    WHERE a.total < cp.amount_resolved - 0.01
      AND cp.direction = 'issued'
      AND NOT EXISTS (
        SELECT 1 FROM reconciliation_issues ri
         WHERE ri.invariant_key='payment.allocation_under'
           AND ri.canonical_id=cp.canonical_id AND ri.resolved_at IS NULL
      );

    v_log := v_log || jsonb_build_object('k','payment.allocation_under','status','ok');
  END IF;

  -- tax.retention_accounting_drift ----------------------------------
  IF (p_key IS NULL OR p_key='tax.retention_accounting_drift')
     AND (SELECT enabled FROM audit_tolerances WHERE invariant_key='tax.retention_accounting_drift') THEN

    WITH sat_monthly AS (
      SELECT to_char(retention_fecha_emision, 'YYYY-MM') AS period,
             SUM(monto_total_retenido) sat_total
      FROM canonical_tax_events
      WHERE event_type='retention' AND tipo_retencion ILIKE '%ISR%'
      GROUP BY 1
    ),
    odoo_monthly AS (
      SELECT ab.period, SUM(ab.balance) odoo_total
      FROM odoo_account_balances ab
      JOIN odoo_chart_of_accounts coa ON coa.odoo_account_id = ab.odoo_account_id
      WHERE coa.code LIKE '113.%' OR coa.code LIKE '213.%'
      GROUP BY 1
    ),
    j AS (
      SELECT COALESCE(s.period, o.period) period,
             COALESCE(s.sat_total, 0) sat_total,
             COALESCE(o.odoo_total, 0) odoo_total,
             ABS(COALESCE(s.sat_total,0) - COALESCE(o.odoo_total,0)) diff
      FROM sat_monthly s FULL OUTER JOIN odoo_monthly o ON s.period=o.period
    )
    INSERT INTO reconciliation_issues
      (issue_id, issue_type, canonical_entity_type, canonical_entity_id, canonical_id,
       impact_mxn, severity, detected_at, invariant_key, action_cta, description, metadata)
    SELECT gen_random_uuid(), 'tax.retention_accounting_drift', 'tax_event',
           'isr-retention-'||j.period, 'isr-retention-'||j.period,
           j.diff, 'medium', now(),
           'tax.retention_accounting_drift', 'review_accounting',
           format('ISR period %s: SAT %s vs Odoo %s (diff %s)', j.period, j.sat_total, j.odoo_total, j.diff),
           jsonb_build_object('period', j.period, 'sat_total', j.sat_total, 'odoo_total', j.odoo_total)
    FROM j
    WHERE (j.diff > 1.00
        OR (j.sat_total > 0
            AND j.diff/NULLIF(GREATEST(ABS(j.sat_total),ABS(j.odoo_total)),0) > 0.0005))
      AND NOT EXISTS (
        SELECT 1 FROM reconciliation_issues ri
         WHERE ri.invariant_key='tax.retention_accounting_drift'
           AND ri.canonical_id='isr-retention-'||j.period
           AND ri.resolved_at IS NULL
      );

    v_log := v_log || jsonb_build_object('k','tax.retention_accounting_drift','status','ok');
  END IF;

  -- tax.return_payment_missing --------------------------------------
  IF (p_key IS NULL OR p_key='tax.return_payment_missing')
     AND (SELECT enabled FROM audit_tolerances WHERE invariant_key='tax.return_payment_missing') THEN

    INSERT INTO reconciliation_issues
      (issue_id, issue_type, canonical_entity_type, canonical_entity_id, canonical_id,
       impact_mxn, severity, detected_at, invariant_key, action_cta, description, metadata)
    SELECT gen_random_uuid(), 'tax.return_payment_missing', 'tax_event', cte.canonical_id, cte.canonical_id,
           cte.return_monto_pagado, 'high', now(),
           'tax.return_payment_missing', 'link_manual',
           format('SAT return ejercicio %s periodo %s paid %s MXN without Odoo payment',
                  cte.return_ejercicio, cte.return_periodo, cte.return_monto_pagado),
           jsonb_build_object('ejercicio', cte.return_ejercicio, 'periodo', cte.return_periodo,
                              'impuesto', cte.return_impuesto)
    FROM canonical_tax_events cte
    WHERE cte.event_type='return'
      AND cte.return_monto_pagado > 0
      AND (cte.odoo_payment_id IS NULL OR cte.odoo_reconciled_amount IS NULL)
      AND NOT EXISTS (
        SELECT 1 FROM reconciliation_issues ri
         WHERE ri.invariant_key='tax.return_payment_missing'
           AND ri.canonical_id=cte.canonical_id AND ri.resolved_at IS NULL
      );

    v_log := v_log || jsonb_build_object('k','tax.return_payment_missing','status','ok');
  END IF;

  -- tax.accounting_sat_drift ----------------------------------------
  IF (p_key IS NULL OR p_key='tax.accounting_sat_drift')
     AND (SELECT enabled FROM audit_tolerances WHERE invariant_key='tax.accounting_sat_drift') THEN

    INSERT INTO reconciliation_issues
      (issue_id, issue_type, canonical_entity_type, canonical_entity_id, canonical_id,
       impact_mxn, severity, detected_at, invariant_key, action_cta, description, metadata)
    SELECT gen_random_uuid(), 'tax.accounting_sat_drift', 'tax_event',
           'ea-' || cte.acct_periodo, 'ea-' || cte.acct_periodo,
           NULL, 'medium', now(),
           'tax.accounting_sat_drift', 'review_accounting',
           format('Electronic Accounting %s tipo=%s', cte.acct_periodo, cte.acct_tipo_envio),
           jsonb_build_object('ejercicio', cte.acct_ejercicio, 'periodo', cte.acct_periodo,
                              'tipo_envio', cte.acct_tipo_envio)
    FROM canonical_tax_events cte
    WHERE cte.event_type='accounting'
      AND cte.needs_review = true
      AND NOT EXISTS (
        SELECT 1 FROM reconciliation_issues ri
         WHERE ri.invariant_key='tax.accounting_sat_drift'
           AND ri.canonical_id='ea-' || cte.acct_periodo
           AND ri.resolved_at IS NULL
      );

    v_log := v_log || jsonb_build_object('k','tax.accounting_sat_drift','status','ok');
  END IF;

  RETURN jsonb_build_object('part', 1, 'log', v_log);
END;
$fn$;

COMMENT ON FUNCTION _sp4_run_extra(text) IS
  'SP4 engine extension part 1: invoice + payment + tax invariant bodies. Disabled by default via audit_tolerances.enabled.';

-- ===== Wrap run_reconciliation (if not already wrapped) ==============
-- SP2 returns TABLE(invariant_key text, new_issues integer, auto_resolved integer),
-- so we aggregate its output via SELECT json_agg(r) FROM run_reconciliation_sp2(p_key) r.
DO $wrap$
DECLARE
  v_body text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_body FROM pg_proc WHERE proname='run_reconciliation';

  IF v_body IS NULL THEN
    -- Shouldn't happen post-SP2; but be safe.
    EXECUTE $inner$
      CREATE OR REPLACE FUNCTION run_reconciliation(p_key text DEFAULT NULL)
      RETURNS jsonb LANGUAGE plpgsql AS $f$
      DECLARE v_ext jsonb;
      BEGIN
        v_ext := _sp4_run_extra(p_key);
        RETURN jsonb_build_object('result', 'sp4_only', 'extra', v_ext);
      END;
      $f$;
    $inner$;
  ELSIF v_body NOT ILIKE '%_sp4_run_extra%' THEN
    -- Rename SP2 impl and create a jsonb-returning wrapper.
    -- SP2 returns TABLE so we aggregate it via json_agg in the wrapper.
    EXECUTE 'ALTER FUNCTION run_reconciliation(text) RENAME TO run_reconciliation_sp2';

    EXECUTE $inner$
      CREATE OR REPLACE FUNCTION run_reconciliation(p_key text DEFAULT NULL)
      RETURNS jsonb LANGUAGE plpgsql AS $f$
      DECLARE
        v_sp2 jsonb;
        v_sp4 jsonb;
      BEGIN
        -- SP2 returns TABLE; aggregate rows into jsonb array
        SELECT json_agg(r) INTO v_sp2
        FROM run_reconciliation_sp2(p_key) r;

        v_sp4 := _sp4_run_extra(p_key);
        RETURN jsonb_build_object('sp2', v_sp2, 'sp4', v_sp4);
      END;
      $f$;
    $inner$;
  END IF;
END;
$wrap$;

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
SELECT 'CREATE_FUNCTION', 'run_reconciliation',
       '_sp4_run_extra() part 1: invoice + payment + tax SQL bodies (still disabled)',
       'supabase/migrations/1056_silver_sp4_run_reconciliation_part1.sql',
       'silver-sp4-task-17', true
WHERE NOT EXISTS (SELECT 1 FROM schema_changes WHERE triggered_by = 'silver-sp4-task-17');

COMMIT;
