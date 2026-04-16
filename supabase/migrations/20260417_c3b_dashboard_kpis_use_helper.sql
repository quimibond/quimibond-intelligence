-- C3 final — get_dashboard_kpis: delegar cash a get_dashboard_cash_kpi()
-- Audit 2026-04-16. Aplicada en prod via MCP: migración `c3_dashboard_kpis_use_helper`.
-- El bloque v_cash tenía `current_balance * 17.4` hardcoded. Ahora
-- delega al helper creado en 20260417_c3_dashboard_cash_helper.sql,
-- que usa cfo_dashboard (FX live post migration cfo_capture).
--
-- Efecto: total_mxn pasa de 4,165,138 (buggy) → 4,141,649 (correcto);
-- dashboard ahora expone también runway_days_cash_only=7.

CREATE OR REPLACE FUNCTION public.get_dashboard_kpis()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v_revenue jsonb;
  v_collections jsonb;
  v_cash jsonb;
  v_insights jsonb;
  v_predictions jsonb;
  v_operations jsonb;
  v_this_month text := to_char(CURRENT_DATE, 'YYYY-MM');
  v_last_month text := to_char(CURRENT_DATE - interval '1 month', 'YYYY-MM');
  v_year_prefix text := to_char(CURRENT_DATE, 'YYYY') || '-';
BEGIN
  SELECT jsonb_build_object(
    'this_month', COALESCE((SELECT round(ingresos) FROM pl_estado_resultados WHERE period = v_this_month), 0),
    'last_month', COALESCE((SELECT round(ingresos) FROM pl_estado_resultados WHERE period = v_last_month), 0),
    'ytd', COALESCE((SELECT round(sum(ingresos)) FROM pl_estado_resultados WHERE period LIKE v_year_prefix || '%'), 0)
  ) INTO v_revenue;

  SELECT jsonb_build_object(
    'total_overdue_mxn', round(sum(COALESCE(i.amount_residual_mxn, i.amount_residual))),
    'overdue_count', count(*),
    'expected_collections_30d', (
      SELECT round(sum(expected_amount))
      FROM cashflow_projection cp
      LEFT JOIN companies cc ON cc.id = cp.company_id
      WHERE cp.flow_type = 'receivable_by_month'
        AND cp.projected_date >= CURRENT_DATE
        AND cp.projected_date <= CURRENT_DATE + 30
        AND COALESCE(cc.relationship_type, '') <> 'self'
    ),
    'clients_at_risk', (
      SELECT count(*)
      FROM customer_ltv_health l
      LEFT JOIN companies cc ON cc.id = l.company_id
      WHERE l.churn_risk_score > 70 AND l.ltv_mxn > 100000
        AND COALESCE(cc.relationship_type, '') <> 'self'
    )
  ) INTO v_collections
  FROM odoo_invoices i
  LEFT JOIN companies c ON c.id = i.company_id
  WHERE i.move_type = 'out_invoice'
    AND i.state = 'posted'
    AND i.payment_state IN ('not_paid','partial')
    AND i.days_overdue > 0
    AND COALESCE(c.relationship_type, '') <> 'self';

  -- C3 fix: delegar cash a get_dashboard_cash_kpi() (cfo_dashboard FX live).
  v_cash := get_dashboard_cash_kpi();

  SELECT jsonb_build_object(
    'new_count', count(*) FILTER (WHERE state = 'new'),
    'urgent_count', count(*) FILTER (WHERE state IN ('new','seen') AND severity IN ('critical','high')),
    'acted_this_month', count(*) FILTER (WHERE state = 'acted_on' AND updated_at >= date_trunc('month', CURRENT_DATE::timestamp)),
    'acceptance_rate', CASE WHEN count(*) FILTER (WHERE state IN ('acted_on','dismissed')) > 0
      THEN round(100.0 * count(*) FILTER (WHERE state = 'acted_on') / count(*) FILTER (WHERE state IN ('acted_on','dismissed')), 1)
      ELSE 0 END
  ) INTO v_insights
  FROM agent_insights
  WHERE agent_id NOT IN (SELECT id FROM ai_agents WHERE slug IN ('data_quality','meta','cleanup','odoo'));

  SELECT jsonb_build_object(
    'reorders_overdue', (
      SELECT count(*) FROM client_reorder_predictions r
      LEFT JOIN companies cc ON cc.id = r.company_id
      WHERE r.reorder_status = 'overdue' AND COALESCE(cc.relationship_type, '') <> 'self'
    ),
    'reorders_lost', (
      SELECT count(*) FROM client_reorder_predictions r
      LEFT JOIN companies cc ON cc.id = r.company_id
      WHERE r.reorder_status = 'lost' AND COALESCE(cc.relationship_type, '') <> 'self'
    ),
    'reorders_at_risk_mxn', (
      SELECT round(sum(r.total_revenue::numeric))
      FROM client_reorder_predictions r
      LEFT JOIN companies cc ON cc.id = r.company_id
      WHERE r.reorder_status IN ('overdue','lost')
        AND COALESCE(cc.relationship_type, '') <> 'self'
    ),
    'payments_at_risk', (
      SELECT count(*) FROM payment_predictions p
      LEFT JOIN companies cc ON cc.id = p.company_id
      WHERE (p.payment_risk LIKE 'CRITICO%' OR p.payment_risk LIKE 'ALTO%')
        AND COALESCE(cc.relationship_type, '') <> 'self'
    ),
    'payments_improving', (
      SELECT count(*) FROM payment_predictions p
      LEFT JOIN companies cc ON cc.id = p.company_id
      WHERE p.payment_trend = 'mejorando'
        AND COALESCE(cc.relationship_type, '') <> 'self'
    )
  ) INTO v_predictions;

  SELECT jsonb_build_object(
    'otd_rate', (
      SELECT round(100.0 * count(*) FILTER (WHERE date_done::date <= scheduled_date::date)
                   / NULLIF(count(*), 0), 1)
      FROM odoo_deliveries
      WHERE state = 'done'
        AND date_done >= CURRENT_DATE - 30
        AND picking_type IN ('Órdenes de entrega','Delivery Orders')
    ),
    'pending_deliveries', (
      SELECT count(*) FROM odoo_deliveries
      WHERE state NOT IN ('done','cancel')
        AND picking_type IN ('Órdenes de entrega','Delivery Orders')
    ),
    'late_deliveries', (
      SELECT count(*) FROM odoo_deliveries
      WHERE state NOT IN ('done','cancel') AND scheduled_date < now()
        AND picking_type IN ('Órdenes de entrega','Delivery Orders')
    ),
    'manufacturing_active', (SELECT count(*) FROM odoo_manufacturing WHERE state NOT IN ('done','cancel')),
    'overdue_activities', (SELECT count(*) FROM odoo_activities WHERE is_overdue)
  ) INTO v_operations;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'revenue', COALESCE(v_revenue, '{}'::jsonb),
    'collections', COALESCE(v_collections, '{}'::jsonb),
    'cash', COALESCE(v_cash, '{}'::jsonb),
    'insights', COALESCE(v_insights, '{}'::jsonb),
    'predictions', COALESCE(v_predictions, '{}'::jsonb),
    'operations', COALESCE(v_operations, '{}'::jsonb)
  );
END;
$function$;
