-- supabase/migrations/1057_silver_sp4_run_reconciliation_part2.sql
--
-- Silver SP4 — Task 18: _sp4_run_extra() part 2 + enable 22 invariants
-- Spec §9.2; Plan Task 18 (GATED — user approved).

BEGIN;

CREATE OR REPLACE FUNCTION _sp4_run_extra(p_key text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE
  v_log jsonb := '[]'::jsonb;
BEGIN

  -- ================================================================
  -- === PART 1 (from Task 17) — 10 invariant blocks ================
  -- ================================================================

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

  -- ================================================================
  -- === PART 2 (new in Task 18) — 12 invariant blocks ==============
  -- ================================================================

  -- order.orphan_invoicing ------------------------------------------
  IF (p_key IS NULL OR p_key='order.orphan_invoicing')
     AND (SELECT enabled FROM audit_tolerances WHERE invariant_key='order.orphan_invoicing') THEN
    INSERT INTO reconciliation_issues
      (issue_id, issue_type, canonical_entity_type, canonical_entity_id, canonical_id,
       impact_mxn, severity, detected_at, invariant_key, action_cta, description, metadata)
    SELECT gen_random_uuid(), 'order.orphan_invoicing', 'order_line', col.canonical_id::text, col.canonical_id::text,
           (col.qty_pending_invoice * col.price_unit), 'medium', now(),
           'order.orphan_invoicing', 'operationalize',
           format('SO %s line pending invoicing %s units (%s days old)',
                  col.order_name, col.qty_pending_invoice,
                  (CURRENT_DATE - col.order_date)::integer),
           jsonb_build_object('order_name', col.order_name, 'qty_pending', col.qty_pending_invoice)
    FROM canonical_order_lines col
    WHERE col.order_type='sale'
      AND col.has_pending_invoicing
      AND col.order_date < CURRENT_DATE - interval '30 days'
      AND NOT EXISTS (
        SELECT 1 FROM reconciliation_issues ri
         WHERE ri.invariant_key='order.orphan_invoicing'
           AND ri.canonical_id=col.canonical_id::text AND ri.resolved_at IS NULL
      );
    v_log := v_log || jsonb_build_object('k','order.orphan_invoicing','status','ok');
  END IF;

  -- order.orphan_delivery -------------------------------------------
  IF (p_key IS NULL OR p_key='order.orphan_delivery')
     AND (SELECT enabled FROM audit_tolerances WHERE invariant_key='order.orphan_delivery') THEN
    INSERT INTO reconciliation_issues
      (issue_id, issue_type, canonical_entity_type, canonical_entity_id, canonical_id,
       impact_mxn, severity, detected_at, invariant_key, action_cta, description, metadata)
    SELECT gen_random_uuid(), 'order.orphan_delivery', 'order_line', col.canonical_id::text, col.canonical_id::text,
           NULL, 'medium', now(),
           'order.orphan_delivery', 'operationalize',
           format('SO %s line pending delivery %s units (%s days old)',
                  col.order_name, (col.qty - COALESCE(col.qty_delivered,0)),
                  (CURRENT_DATE - col.order_date)::integer),
           jsonb_build_object('order_name', col.order_name,
                              'qty_pending', (col.qty - COALESCE(col.qty_delivered,0)))
    FROM canonical_order_lines col
    WHERE col.order_type='sale'
      AND col.has_pending_delivery
      AND col.order_date < CURRENT_DATE - interval '14 days'
      AND NOT EXISTS (
        SELECT 1 FROM reconciliation_issues ri
         WHERE ri.invariant_key='order.orphan_delivery'
           AND ri.canonical_id=col.canonical_id::text AND ri.resolved_at IS NULL
      );
    v_log := v_log || jsonb_build_object('k','order.orphan_delivery','status','ok');
  END IF;

  -- delivery.late_active --------------------------------------------
  IF (p_key IS NULL OR p_key='delivery.late_active')
     AND (SELECT enabled FROM audit_tolerances WHERE invariant_key='delivery.late_active') THEN
    INSERT INTO reconciliation_issues
      (issue_id, issue_type, canonical_entity_type, canonical_entity_id, canonical_id,
       impact_mxn, severity, detected_at, invariant_key, action_cta, description, metadata)
    SELECT gen_random_uuid(), 'delivery.late_active', 'delivery', cd.canonical_id::text, cd.canonical_id::text,
           NULL, 'medium', now(),
           'delivery.late_active', 'operationalize',
           format('Delivery %s late (scheduled %s, state=%s)', cd.name, cd.scheduled_date, cd.state),
           jsonb_build_object('name', cd.name, 'state', cd.state,
                              'scheduled_date', cd.scheduled_date)
    FROM canonical_deliveries cd
    WHERE cd.is_late AND cd.state NOT IN ('done','cancel')
      AND NOT EXISTS (
        SELECT 1 FROM reconciliation_issues ri
         WHERE ri.invariant_key='delivery.late_active'
           AND ri.canonical_id=cd.canonical_id::text AND ri.resolved_at IS NULL
      );
    v_log := v_log || jsonb_build_object('k','delivery.late_active','status','ok');
  END IF;

  -- mfg.stock_drift -------------------------------------------------
  IF (p_key IS NULL OR p_key='mfg.stock_drift')
     AND (SELECT enabled FROM audit_tolerances WHERE invariant_key='mfg.stock_drift') THEN
    INSERT INTO reconciliation_issues
      (issue_id, issue_type, canonical_entity_type, canonical_entity_id, canonical_id,
       impact_mxn, severity, detected_at, invariant_key, action_cta, description, metadata)
    SELECT gen_random_uuid(), 'mfg.stock_drift', 'manufacturing', cm.canonical_id::text, cm.canonical_id::text,
           NULL, 'medium', now(),
           'mfg.stock_drift', 'review_manual',
           format('MO %s closed qty_produced=%s but product stock_qty=%s',
                  cm.name, cm.qty_produced, cp.stock_qty),
           jsonb_build_object('mo_name', cm.name, 'qty_produced', cm.qty_produced)
    FROM canonical_manufacturing cm
    JOIN canonical_products cp ON cp.id = cm.canonical_product_id
    WHERE cm.state='done' AND cm.qty_produced > 0
      AND cp.stock_qty < cm.qty_produced * 0.5
      AND NOT EXISTS (
        SELECT 1 FROM reconciliation_issues ri
         WHERE ri.invariant_key='mfg.stock_drift'
           AND ri.canonical_id=cm.canonical_id::text AND ri.resolved_at IS NULL
      );
    v_log := v_log || jsonb_build_object('k','mfg.stock_drift','status','ok');
  END IF;

  -- line_price_mismatch (capped at 5000 first run) -------------------
  IF (p_key IS NULL OR p_key='line_price_mismatch')
     AND (SELECT enabled FROM audit_tolerances WHERE invariant_key='line_price_mismatch') THEN
    INSERT INTO reconciliation_issues
      (issue_id, issue_type, canonical_entity_type, canonical_entity_id, canonical_id,
       impact_mxn, severity, detected_at, invariant_key, action_cta, description, metadata)
    SELECT * FROM (
      SELECT gen_random_uuid() issue_id, 'line_price_mismatch' issue_type,
             'invoice_line' cet, oil.id::text ceid, oil.id::text cid,
             ABS(oil.price_unit - sil.valor_unitario) impact,
             'medium' sev, now() detected,
             'line_price_mismatch' ik, 'review_manual' cta,
             format('Line price diff: odoo=%s sat=%s line_id=%s',
                    oil.price_unit, sil.valor_unitario, oil.id) descr,
             jsonb_build_object('odoo_line_id', oil.id,
                                'odoo_price', oil.price_unit,
                                'sat_price',  sil.valor_unitario) md
      FROM odoo_invoice_lines oil
      JOIN odoo_invoices oi       ON oi.id = oil.odoo_move_id
      JOIN syntage_invoice_line_items sil ON sil.invoice_uuid = oi.cfdi_uuid
      WHERE oil.product_ref IS NOT NULL
        AND sil.descripcion LIKE '[' || oil.product_ref || ']%'
        AND ABS(oil.price_unit - sil.valor_unitario)
            / NULLIF(GREATEST(oil.price_unit, sil.valor_unitario), 0) > 0.005
        AND NOT EXISTS (
          SELECT 1 FROM reconciliation_issues ri
          WHERE ri.invariant_key='line_price_mismatch'
            AND ri.canonical_id=oil.id::text AND ri.resolved_at IS NULL
        )
      LIMIT 5000
    ) s;
    v_log := v_log || jsonb_build_object('k','line_price_mismatch','status','ok_capped_5000');
  END IF;

  -- orderpoint_untuned ----------------------------------------------
  IF (p_key IS NULL OR p_key='orderpoint_untuned')
     AND (SELECT enabled FROM audit_tolerances WHERE invariant_key='orderpoint_untuned') THEN
    INSERT INTO reconciliation_issues
      (issue_id, issue_type, canonical_entity_type, canonical_entity_id, canonical_id,
       impact_mxn, severity, detected_at, invariant_key, action_cta, description, metadata)
    SELECT gen_random_uuid(), 'orderpoint_untuned', 'inventory',
           ci.canonical_product_id::text, ci.canonical_product_id::text,
           NULL, 'low', now(),
           'orderpoint_untuned', 'review_inventory',
           format('Orderpoint %s untuned: min=0 qty_to_order=%s', ci.internal_ref, ci.qty_to_order),
           jsonb_build_object('internal_ref', ci.internal_ref, 'qty_to_order', ci.qty_to_order)
    FROM canonical_inventory ci
    WHERE ci.orderpoint_untuned
      AND NOT EXISTS (
        SELECT 1 FROM reconciliation_issues ri
         WHERE ri.invariant_key='orderpoint_untuned'
           AND ri.canonical_id=ci.canonical_product_id::text AND ri.resolved_at IS NULL
      );
    v_log := v_log || jsonb_build_object('k','orderpoint_untuned','status','ok');
  END IF;

  -- clave_prodserv_drift --------------------------------------------
  IF (p_key IS NULL OR p_key='clave_prodserv_drift')
     AND (SELECT enabled FROM audit_tolerances WHERE invariant_key='clave_prodserv_drift') THEN
    INSERT INTO reconciliation_issues
      (issue_id, issue_type, canonical_entity_type, canonical_entity_id, canonical_id,
       impact_mxn, severity, detected_at, invariant_key, action_cta, description, metadata)
    SELECT gen_random_uuid(), 'clave_prodserv_drift', 'product', cp.id::text, cp.id::text,
           NULL, 'low', now(),
           'clave_prodserv_drift', 'review_fiscal_map',
           format('Product %s clave drift: canonical=%s last_sat=%s',
                  cp.internal_ref, cp.sat_clave_prod_serv, latest_clave.clave),
           jsonb_build_object('internal_ref', cp.internal_ref)
    FROM canonical_products cp
    JOIN LATERAL (
      SELECT sil.clave_prod_serv AS clave
      FROM syntage_invoice_line_items sil
      WHERE sil.descripcion LIKE '[' || cp.internal_ref || ']%'
      ORDER BY sil.synced_at DESC LIMIT 1
    ) latest_clave ON true
    WHERE cp.sat_clave_prod_serv IS NOT NULL
      AND latest_clave.clave IS NOT NULL
      AND latest_clave.clave <> cp.sat_clave_prod_serv
      AND NOT EXISTS (
        SELECT 1 FROM reconciliation_issues ri
         WHERE ri.invariant_key='clave_prodserv_drift'
           AND ri.canonical_id=cp.id::text AND ri.resolved_at IS NULL
      );
    v_log := v_log || jsonb_build_object('k','clave_prodserv_drift','status','ok');
  END IF;

  -- entity_unresolved_30d -------------------------------------------
  IF (p_key IS NULL OR p_key='entity_unresolved_30d')
     AND (SELECT enabled FROM audit_tolerances WHERE invariant_key='entity_unresolved_30d') THEN
    INSERT INTO reconciliation_issues
      (issue_id, issue_type, canonical_entity_type, canonical_entity_id, canonical_id,
       impact_mxn, severity, detected_at, invariant_key, action_cta, description, metadata)
    SELECT gen_random_uuid(), 'entity_unresolved_30d', 'company',
           e.id::text, e.id::text,
           NULL, 'low', now(),
           'entity_unresolved_30d', 'link_manual',
           format('Entity KG %s unresolved > 30d', e.canonical_name),
           jsonb_build_object('entity_id', e.id, 'name', e.canonical_name)
    FROM entities e
    WHERE e.created_at < now() - interval '30 days'
      AND NOT EXISTS (
        SELECT 1 FROM source_links sl
         WHERE sl.source='kg_entity' AND sl.source_table='entities'
           AND sl.source_id = e.id::text
           AND sl.superseded_at IS NULL
      )
      AND (SELECT COUNT(*) FROM facts f WHERE f.entity_id = e.id) > 3
      AND NOT EXISTS (
        SELECT 1 FROM reconciliation_issues ri
         WHERE ri.invariant_key='entity_unresolved_30d'
           AND ri.canonical_id=e.id::text AND ri.resolved_at IS NULL
      );
    v_log := v_log || jsonb_build_object('k','entity_unresolved_30d','status','ok');
  END IF;

  -- ambiguous_match --------------------------------------------------
  IF (p_key IS NULL OR p_key='ambiguous_match')
     AND (SELECT enabled FROM audit_tolerances WHERE invariant_key='ambiguous_match') THEN
    INSERT INTO reconciliation_issues
      (issue_id, issue_type, canonical_entity_type, canonical_entity_id, canonical_id,
       impact_mxn, severity, detected_at, invariant_key, action_cta, description, metadata)
    SELECT gen_random_uuid(), 'ambiguous_match', 'company', cc.id::text, cc.id::text,
           NULL, 'high', now(),
           'ambiguous_match', 'link_manual',
           format('Ambiguous canonical_company %s — needs review', cc.display_name),
           jsonb_build_object('review_reason', cc.review_reason)
    FROM canonical_companies cc
    WHERE cc.needs_review AND 'ambiguous_match' = ANY(cc.review_reason)
      AND NOT EXISTS (
        SELECT 1 FROM reconciliation_issues ri
         WHERE ri.invariant_key='ambiguous_match'
           AND ri.canonical_id=cc.id::text AND ri.resolved_at IS NULL
      );
    v_log := v_log || jsonb_build_object('k','ambiguous_match','status','ok');
  END IF;

  -- bank_balance.stale -----------------------------------------------
  IF (p_key IS NULL OR p_key='bank_balance.stale')
     AND (SELECT enabled FROM audit_tolerances WHERE invariant_key='bank_balance.stale') THEN
    INSERT INTO reconciliation_issues
      (issue_id, issue_type, canonical_entity_type, canonical_entity_id, canonical_id,
       impact_mxn, severity, detected_at, invariant_key, action_cta, description, metadata)
    SELECT gen_random_uuid(), 'bank_balance.stale', 'bank_balance',
           cbb.canonical_id::text, cbb.canonical_id::text,
           cbb.current_balance_mxn, 'medium', now(),
           'bank_balance.stale', 'refresh_source',
           format('Bank %s stale since %s', cbb.name, cbb.updated_at),
           jsonb_build_object('journal', cbb.name, 'updated_at', cbb.updated_at)
    FROM canonical_bank_balances cbb
    WHERE cbb.is_stale
      AND NOT EXISTS (
        SELECT 1 FROM reconciliation_issues ri
         WHERE ri.invariant_key='bank_balance.stale'
           AND ri.canonical_id=cbb.canonical_id::text AND ri.resolved_at IS NULL
      );
    v_log := v_log || jsonb_build_object('k','bank_balance.stale','status','ok');
  END IF;

  -- fx_rate.stale ----------------------------------------------------
  IF (p_key IS NULL OR p_key='fx_rate.stale')
     AND (SELECT enabled FROM audit_tolerances WHERE invariant_key='fx_rate.stale') THEN
    INSERT INTO reconciliation_issues
      (issue_id, issue_type, canonical_entity_type, canonical_entity_id, canonical_id,
       impact_mxn, severity, detected_at, invariant_key, action_cta, description, metadata)
    SELECT gen_random_uuid(), 'fx_rate.stale', 'fx_rate', cfr.currency, cfr.currency,
           NULL, 'high', now(),
           'fx_rate.stale', 'refresh_source',
           format('FX %s latest rate date %s', cfr.currency, cfr.rate_date),
           jsonb_build_object('currency', cfr.currency, 'rate_date', cfr.rate_date)
    FROM canonical_fx_rates cfr
    WHERE cfr.recency_rank = 1 AND cfr.is_stale AND cfr.currency IN ('USD','EUR')
      AND NOT EXISTS (
        SELECT 1 FROM reconciliation_issues ri
         WHERE ri.invariant_key='fx_rate.stale'
           AND ri.canonical_id=cfr.currency AND ri.resolved_at IS NULL
      );
    v_log := v_log || jsonb_build_object('k','fx_rate.stale','status','ok');
  END IF;

  -- tax.blacklist_69b_definitive_active ------------------------------
  IF (p_key IS NULL OR p_key='tax.blacklist_69b_definitive_active')
     AND (SELECT enabled FROM audit_tolerances WHERE invariant_key='tax.blacklist_69b_definitive_active') THEN
    INSERT INTO reconciliation_issues
      (issue_id, issue_type, canonical_entity_type, canonical_entity_id, canonical_id,
       impact_mxn, severity, detected_at, invariant_key, action_cta, description, metadata)
    SELECT gen_random_uuid(), 'tax.blacklist_69b_definitive_active', 'company',
           cc.id::text, cc.id::text,
           COALESCE(cc.total_pending_mxn, 0), 'critical', now(),
           'tax.blacklist_69b_definitive_active', 'review_manual',
           format('Counterparty %s flagged 69B definitive — CFDI exposure %s MXN',
                  cc.display_name, COALESCE(cc.total_pending_mxn, 0)),
           jsonb_build_object('rfc', cc.rfc, 'level', cc.blacklist_level)
    FROM canonical_companies cc
    WHERE cc.blacklist_level = 'definitive'
      AND NOT EXISTS (
        SELECT 1 FROM reconciliation_issues ri
         WHERE ri.invariant_key='tax.blacklist_69b_definitive_active'
           AND ri.canonical_id=cc.id::text AND ri.resolved_at IS NULL
      );
    v_log := v_log || jsonb_build_object('k','tax.blacklist_69b_definitive_active','status','ok');
  END IF;

  PERFORM compute_priority_scores();

  RETURN jsonb_build_object('part', 2, 'log', v_log);
END;
$fn$;

-- ===== enable all 22 new invariants ===================================
UPDATE audit_tolerances SET enabled = true
 WHERE invariant_key IN (
  'invoice.amount_diff_post_fx','invoice.uuid_mismatch_rfc','invoice.without_order',
  'payment.amount_mismatch','payment.date_mismatch','payment.allocation_over','payment.allocation_under',
  'tax.retention_accounting_drift','tax.return_payment_missing','tax.accounting_sat_drift','tax.blacklist_69b_definitive_active',
  'order.orphan_invoicing','order.orphan_delivery',
  'delivery.late_active','mfg.stock_drift',
  'line_price_mismatch','orderpoint_untuned','clave_prodserv_drift',
  'entity_unresolved_30d','ambiguous_match',
  'bank_balance.stale','fx_rate.stale'
);

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
SELECT 'CREATE_FUNCTION', '_sp4_run_extra',
       'Part 2: 12 additional invariant bodies + enable 22 (GATED)',
       'supabase/migrations/1057_silver_sp4_run_reconciliation_part2.sql',
       'silver-sp4-task-18', true
WHERE NOT EXISTS (SELECT 1 FROM schema_changes WHERE triggered_by = 'silver-sp4-task-18');

COMMIT;
