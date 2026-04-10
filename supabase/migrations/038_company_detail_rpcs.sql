-- ============================================================================
-- Migration 038: Create missing RPCs for company detail page
--
-- 1. get_company_products — products sold to company with volume trends
-- 2. get_company_logistics — delivery performance + pending deliveries
-- 3. get_company_pipeline — CRM leads, pipeline summary, activities
-- ============================================================================

-- 1. get_company_products
CREATE OR REPLACE FUNCTION get_company_products(p_company_id bigint)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN (
    SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
    FROM (
      SELECT
        p.name AS product_name,
        p.internal_ref AS product_ref,
        count(DISTINCT ol.odoo_order_id) AS orders,
        round(sum(ol.qty)::numeric, 2) AS total_qty,
        round(sum(ol.subtotal)::numeric, 2) AS total_revenue,
        round(avg(ol.price_unit)::numeric, 2) AS avg_price,
        p.stock_qty,
        p.available_qty,
        round(COALESCE(sum(ol.qty) FILTER (WHERE ol.order_date >= current_date - interval '180 days'), 0)::numeric, 2) AS qty_6m,
        round(COALESCE(sum(ol.qty) FILTER (WHERE ol.order_date >= current_date - interval '360 days' AND ol.order_date < current_date - interval '180 days'), 0)::numeric, 2) AS qty_prev_6m
      FROM odoo_order_lines ol
      JOIN odoo_products p ON p.odoo_product_id = ol.odoo_product_id
      WHERE ol.company_id = p_company_id
        AND ol.order_type = 'sale'
        AND ol.order_state IN ('sale', 'done')
      GROUP BY p.odoo_product_id, p.name, p.internal_ref, p.stock_qty, p.available_qty
      ORDER BY sum(ol.subtotal) DESC
      LIMIT 50
    ) t
  );
END;
$$;

-- 2. get_company_logistics
CREATE OR REPLACE FUNCTION get_company_logistics(p_company_id bigint)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN json_build_object(
    'pending_deliveries', (
      SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
      FROM (
        SELECT name, picking_type, origin, scheduled_date, state, is_late
        FROM odoo_deliveries
        WHERE company_id = p_company_id
          AND state NOT IN ('done', 'cancel')
        ORDER BY scheduled_date ASC
        LIMIT 20
      ) t
    ),
    'delivery_performance', (
      SELECT json_build_object(
        'total_delivered', count(*),
        'on_time_rate', CASE WHEN count(*) > 0
          THEN round(100.0 * count(*) FILTER (WHERE NOT is_late) / count(*))
          ELSE NULL END,
        'avg_lead_time_days', round(avg(lead_time_days)::numeric, 1)
      )
      FROM odoo_deliveries
      WHERE company_id = p_company_id
        AND state = 'done'
    ),
    'late_count', (
      SELECT count(*)
      FROM odoo_deliveries
      WHERE company_id = p_company_id
        AND is_late = true
        AND state NOT IN ('done', 'cancel')
    )
  );
END;
$$;

-- 3. get_company_pipeline
CREATE OR REPLACE FUNCTION get_company_pipeline(p_company_id bigint)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_partner_id bigint;
BEGIN
  SELECT odoo_partner_id INTO v_partner_id FROM companies WHERE id = p_company_id;

  RETURN json_build_object(
    'leads', (
      SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
      FROM (
        SELECT name, lead_type, stage, expected_revenue, probability, assigned_user, days_open, date_deadline
        FROM odoo_crm_leads
        WHERE odoo_partner_id = v_partner_id
          AND active = true
        ORDER BY expected_revenue DESC NULLS LAST
        LIMIT 20
      ) t
    ),
    'pipeline_summary', (
      SELECT json_build_object(
        'total_opportunities', count(*) FILTER (WHERE lead_type = 'opportunity'),
        'total_leads', count(*) FILTER (WHERE lead_type = 'lead'),
        'pipeline_value', COALESCE(sum(expected_revenue), 0),
        'weighted_value', COALESCE(sum(expected_revenue * probability / 100.0), 0)
      )
      FROM odoo_crm_leads
      WHERE odoo_partner_id = v_partner_id
        AND active = true
    ),
    'activities', (
      SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json)
      FROM (
        SELECT activity_type, summary, date_deadline, assigned_to, is_overdue
        FROM odoo_activities
        WHERE odoo_partner_id = v_partner_id
        ORDER BY date_deadline ASC
        LIMIT 20
      ) t
    ),
    'overdue_activities', (
      SELECT count(*)
      FROM odoo_activities
      WHERE odoo_partner_id = v_partner_id
        AND is_overdue = true
    )
  );
END;
$$;

-- Reload PostgREST schema
NOTIFY pgrst, 'reload schema';
