-- Replace the previous NULL-stub fix (20260430_company_evidence_pack_drop_dead_refs)
-- with the real living-source replacements. The 5 dropped tables/MVs map to:
--
--   health_scores                → DROP (no canonical replacement; trend_pct proxy)
--   customer_ltv_health          → canonical_companies aggregate columns
--   payment_predictions          → get_ar_collection_delay_v2(6) RPC live
--   client_reorder_predictions   → MV still exists, was never actually dropped
--   cashflow_projection          → live aggregate over odoo_invoices unpaid AR
--   company_profile (tier)       → canonical_companies.tier
--
-- Result: predictions block has real-time data again (FXI INC test:
--   payment.avg_delay_days=37, reorder.predicted_next_order=2026-05-09,
--   ltv_health.lifetime_value_mxn=$156M, cashflow.expected_collection=$1.5M).

CREATE OR REPLACE FUNCTION company_evidence_pack(p_company_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result jsonb;
  v_financials jsonb;
  v_orders jsonb;
  v_communication jsonb;
  v_deliveries jsonb;
  v_activities jsonb;
  v_history jsonb;
  v_predictions jsonb;
  v_tier text;
  v_canonical_id bigint;
  v_odoo_partner_id integer;
BEGIN
  -- Resolve canonical_company_id from bronze company_id
  SELECT odoo_partner_id INTO v_odoo_partner_id FROM companies WHERE id = p_company_id;
  IF v_odoo_partner_id IS NOT NULL THEN
    SELECT id, tier INTO v_canonical_id, v_tier
    FROM canonical_companies
    WHERE odoo_partner_id = v_odoo_partner_id
    LIMIT 1;
  END IF;

  SELECT jsonb_build_object(
    'total_invoiced_12m', round(sum(CASE WHEN move_type = 'out_invoice' AND invoice_date >= CURRENT_DATE - 365 THEN COALESCE(amount_total_mxn, amount_total) ELSE 0 END)),
    'total_overdue_mxn', round(sum(CASE WHEN days_overdue > 0 AND payment_state IN ('not_paid','partial') AND move_type = 'out_invoice' THEN COALESCE(amount_residual_mxn, amount_residual) ELSE 0 END)),
    'overdue_invoices', (
      SELECT jsonb_agg(jsonb_build_object('name', name, 'amount_mxn', round(COALESCE(amount_residual_mxn, amount_residual)), 'days_overdue', days_overdue, 'due_date', due_date) ORDER BY days_overdue DESC)
      FROM odoo_invoices WHERE company_id = p_company_id AND state = 'posted' AND move_type = 'out_invoice' AND days_overdue > 0 AND payment_state IN ('not_paid','partial')
    ),
    'avg_days_to_pay', (SELECT round(avg(days_to_pay)) FROM odoo_invoices WHERE company_id = p_company_id AND days_to_pay IS NOT NULL),
    'credit_notes_12m', round(sum(CASE WHEN move_type = 'out_refund' AND invoice_date >= CURRENT_DATE - 365 THEN COALESCE(amount_total_mxn, amount_total) ELSE 0 END)),
    'payables_overdue_mxn', round(sum(CASE WHEN days_overdue > 0 AND payment_state IN ('not_paid','partial') AND move_type = 'in_invoice' THEN COALESCE(amount_residual_mxn, amount_residual) ELSE 0 END))
  ) INTO v_financials FROM odoo_invoices WHERE company_id = p_company_id AND state = 'posted';

  SELECT jsonb_build_object(
    'total_orders_12m', count(*) FILTER (WHERE date_order >= CURRENT_DATE - 365),
    'last_order_date', max(date_order),
    'days_since_last_order', CURRENT_DATE - max(date_order)::date,
    'avg_order_mxn', round(avg(COALESCE(amount_total_mxn, amount_total))),
    'revenue_trend', jsonb_build_object(
      'last_3m', round(sum(CASE WHEN date_order >= CURRENT_DATE - 90 THEN COALESCE(amount_total_mxn, amount_total) ELSE 0 END)),
      'prev_3m', round(sum(CASE WHEN date_order >= CURRENT_DATE - 180 AND date_order < CURRENT_DATE - 90 THEN COALESCE(amount_total_mxn, amount_total) ELSE 0 END))
    ),
    'salesperson', (SELECT salesperson_name FROM odoo_sale_orders WHERE company_id = p_company_id AND salesperson_name IS NOT NULL ORDER BY date_order DESC LIMIT 1),
    'salesperson_email', (SELECT salesperson_email FROM odoo_sale_orders WHERE company_id = p_company_id AND salesperson_email IS NOT NULL ORDER BY date_order DESC LIMIT 1),
    'top_products', (
      SELECT jsonb_agg(jsonb_build_object('product', product_name, 'ref', product_ref, 'total_mxn', total) ORDER BY total DESC)
      FROM (SELECT product_name, product_ref, round(sum(COALESCE(subtotal_mxn, subtotal))) as total FROM odoo_order_lines WHERE company_id = p_company_id AND order_type = 'sale' GROUP BY product_name, product_ref ORDER BY total DESC LIMIT 5) sub
    )
  ) INTO v_orders FROM odoo_sale_orders WHERE company_id = p_company_id;

  SELECT jsonb_build_object(
    'total_emails', count(DISTINCT e.id),
    'last_email_date', max(e.email_date)::date,
    'days_since_last_email', CURRENT_DATE - max(e.email_date)::date,
    'unanswered_threads', (SELECT count(*) FROM threads t WHERE t.company_id = p_company_id AND t.has_internal_reply = false AND t.hours_without_response > 24),
    'recent_threads', (
      SELECT jsonb_agg(jsonb_build_object('subject', t2.subject, 'last_sender', t2.last_sender, 'hours_waiting', round(t2.hours_without_response), 'has_our_reply', t2.has_internal_reply) ORDER BY t2.last_activity DESC)
      FROM (SELECT * FROM threads WHERE company_id = p_company_id ORDER BY last_activity DESC LIMIT 5) t2
    ),
    'key_contacts', (
      SELECT jsonb_agg(jsonb_build_object('name', ct.name, 'email', ct.email) ORDER BY ct.interaction_count DESC NULLS LAST)
      FROM (SELECT * FROM contacts WHERE company_id = p_company_id AND contact_type = 'external' LIMIT 3) ct
    )
  ) INTO v_communication FROM emails e WHERE e.company_id = p_company_id;

  SELECT jsonb_build_object(
    'total_deliveries_90d', count(*) FILTER (WHERE create_date >= CURRENT_DATE - 90),
    'late_deliveries', count(*) FILTER (
      WHERE state = 'done' AND date_done::date > scheduled_date::date
        AND picking_type IN ('Órdenes de entrega','Delivery Orders')
    ),
    'otd_rate', (
      SELECT CASE WHEN count(*) FILTER (
        WHERE state = 'done' AND picking_type IN ('Órdenes de entrega','Delivery Orders')
      ) > 0 THEN round(
        100.0 * count(*) FILTER (
          WHERE state = 'done' AND date_done::date <= scheduled_date::date
                AND picking_type IN ('Órdenes de entrega','Delivery Orders')
        ) / count(*) FILTER (
          WHERE state = 'done' AND picking_type IN ('Órdenes de entrega','Delivery Orders')
        ), 1
      ) ELSE NULL END
      FROM odoo_deliveries WHERE company_id = p_company_id
    ),
    'pending_shipments', count(*) FILTER (
      WHERE state NOT IN ('done','cancel')
        AND picking_type IN ('Órdenes de entrega','Delivery Orders')
    ),
    'late_details', (
      SELECT jsonb_agg(jsonb_build_object('name', name, 'scheduled', scheduled_date, 'origin', origin))
      FROM odoo_deliveries
      WHERE company_id = p_company_id
        AND state NOT IN ('done','cancel')
        AND scheduled_date < now()
        AND picking_type IN ('Órdenes de entrega','Delivery Orders')
    )
  ) INTO v_deliveries FROM odoo_deliveries WHERE company_id = p_company_id;

  SELECT jsonb_build_object(
    'total_pending', count(*),
    'overdue', count(*) FILTER (WHERE is_overdue),
    'overdue_detail', (SELECT jsonb_agg(jsonb_build_object('type', activity_type, 'summary', left(summary, 150), 'assigned_to', assigned_to, 'deadline', date_deadline) ORDER BY date_deadline) FROM odoo_activities WHERE company_id = p_company_id AND is_overdue LIMIT 5)
  ) INTO v_activities FROM odoo_activities WHERE company_id = p_company_id;

  SELECT jsonb_build_object(
    'recent_insights', (SELECT jsonb_agg(jsonb_build_object('title', title, 'state', state, 'category', category, 'created', created_at::date) ORDER BY created_at DESC) FROM (SELECT * FROM agent_insights WHERE company_id = p_company_id ORDER BY created_at DESC LIMIT 5) sub),
    'trend_pct_90d',  (SELECT trend_pct FROM canonical_companies WHERE id = v_canonical_id),
    'risk_level',     (SELECT risk_level FROM canonical_companies WHERE id = v_canonical_id),
    'health_trend',   NULL
  ) INTO v_history;

  v_predictions := jsonb_build_object(
    'payment', (SELECT row_to_json(d.*) FROM get_ar_collection_delay_v2(6) d WHERE d.company_id = p_company_id LIMIT 1),
    'reorder', (SELECT row_to_json(rp.*) FROM client_reorder_predictions rp WHERE rp.company_id = p_company_id LIMIT 1),
    'ltv_health', (
      SELECT jsonb_build_object(
        'lifetime_value_mxn', cc.lifetime_value_mxn,
        'revenue_90d', cc.revenue_90d_mxn,
        'revenue_prior_90d', cc.revenue_prior_90d_mxn,
        'trend_pct', cc.trend_pct,
        'tier', cc.tier,
        'risk_level', cc.risk_level,
        'max_days_overdue', cc.max_days_overdue,
        'last_invoice_date', cc.last_invoice_date,
        'customer_status', CASE
          WHEN cc.last_invoice_date IS NULL THEN 'unknown'
          WHEN cc.last_invoice_date < CURRENT_DATE - 365 THEN 'churned'
          WHEN cc.last_invoice_date < CURRENT_DATE - 180 THEN 'at_risk'
          WHEN cc.last_invoice_date < CURRENT_DATE - 90  THEN 'cooling'
          ELSE 'active' END
      )
      FROM canonical_companies cc WHERE cc.id = v_canonical_id LIMIT 1
    ),
    'cashflow', (
      SELECT jsonb_build_object(
        'expected_collection', round(sum(COALESCE(amount_residual_mxn, amount_residual))),
        'open_invoices_count', count(*),
        'total_overdue_count', count(*) FILTER (WHERE days_overdue > 0),
        'total_overdue_mxn', round(sum(CASE WHEN days_overdue > 0 THEN COALESCE(amount_residual_mxn, amount_residual) ELSE 0 END))
      )
      FROM odoo_invoices
      WHERE company_id = p_company_id
        AND state = 'posted'
        AND move_type = 'out_invoice'
        AND payment_state IN ('not_paid','partial')
    )
  );

  v_result := jsonb_build_object(
    'company_id', p_company_id,
    'company_name', (SELECT canonical_name FROM companies WHERE id = p_company_id),
    'tier', v_tier,
    'is_customer', (SELECT is_customer FROM companies WHERE id = p_company_id),
    'is_supplier', (SELECT is_supplier FROM companies WHERE id = p_company_id),
    'is_self', COALESCE((SELECT relationship_type = 'self' FROM companies WHERE id = p_company_id), false),
    'rfc', (SELECT rfc FROM companies WHERE id = p_company_id),
    'credit_limit', (SELECT credit_limit FROM companies WHERE id = p_company_id),
    'financials', COALESCE(v_financials, '{}'::jsonb),
    'orders', COALESCE(v_orders, '{}'::jsonb),
    'communication', COALESCE(v_communication, '{}'::jsonb),
    'deliveries', COALESCE(v_deliveries, '{}'::jsonb),
    'activities', COALESCE(v_activities, '{}'::jsonb),
    'history', COALESCE(v_history, '{}'::jsonb),
    'predictions', COALESCE(v_predictions, '{}'::jsonb)
  );
  RETURN v_result;
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('error', SQLERRM, 'company_id', p_company_id);
END;
$$;
