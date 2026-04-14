-- Sprint 1 — Expandir data_quality_scorecard con 15 checks nuevos
-- derivados del audit Odoo/Supabase del 2026-04-14.
--
-- CRITICAL: Preserva los 17 checks existentes (integridad FK, duplicados,
-- freshness, business_logic, cost) verbatim. Agrega 15 nuevos organizados en
-- categorías: sync_gap, price_integrity, inventory_sanity, collection_health,
-- accounting_integrity, cfdi_sat, credit_risk, fx, activities_dead, anomalies.

CREATE OR REPLACE VIEW public.data_quality_scorecard AS
SELECT category, metric, value, threshold, severity, description FROM (
  ----------------------------------------------------------------------------
  -- EXISTING CHECKS (preservados del scorecard original)
  ----------------------------------------------------------------------------
  SELECT 'fk_integrity'::text AS category, 'invoices_no_company'::text AS metric,
    (SELECT count(*) FROM odoo_invoices WHERE company_id IS NULL)::bigint AS value,
    0::bigint AS threshold, 'critical'::text AS severity,
    'Odoo invoices that cannot be attributed to a company'::text AS description
  UNION ALL SELECT 'fk_integrity','orders_no_company',
    (SELECT count(*) FROM odoo_sale_orders WHERE company_id IS NULL)::bigint,
    0, 'critical', 'Sale orders without company link'
  UNION ALL SELECT 'fk_integrity','action_items_pending_no_assignee',
    (SELECT count(*) FROM action_items WHERE assignee_email IS NULL AND state='pending')::bigint,
    0, 'critical', 'Pending action items with nobody assigned'
  UNION ALL SELECT 'fk_integrity','agent_insights_open_no_assignee',
    (SELECT count(*) FROM agent_insights WHERE assignee_email IS NULL AND state IN ('new','seen'))::bigint,
    5, 'high', 'Open insights with no assignee'
  UNION ALL SELECT 'fk_integrity','emails_no_sender_contact',
    (SELECT count(*) FROM emails WHERE sender_contact_id IS NULL)::bigint,
    100, 'medium', 'Emails from senders not yet in contacts table'
  UNION ALL SELECT 'fk_integrity','contacts_no_company',
    (SELECT count(*) FROM contacts WHERE company_id IS NULL AND contact_type<>'noise')::bigint,
    50, 'medium', 'Business contacts not linked to any company'
  UNION ALL SELECT 'duplicates','dup_companies_by_odoo_partner',
    (SELECT count(*) FROM (SELECT odoo_partner_id FROM companies WHERE odoo_partner_id IS NOT NULL GROUP BY odoo_partner_id HAVING count(*)>1) d)::bigint,
    0, 'critical', 'Multiple company records with same Odoo partner_id'
  UNION ALL SELECT 'duplicates','dup_contacts_by_odoo_partner',
    (SELECT count(*) FROM (SELECT odoo_partner_id FROM contacts WHERE odoo_partner_id IS NOT NULL GROUP BY odoo_partner_id HAVING count(*)>1) d)::bigint,
    0, 'critical', 'Multiple contacts with same Odoo partner_id'
  UNION ALL SELECT 'duplicates','dup_entities',
    (SELECT count(*) FROM (SELECT canonical_name, entity_type FROM entities GROUP BY canonical_name, entity_type HAVING count(*)>1) d)::bigint,
    0, 'high', 'Duplicate entities'
  UNION ALL SELECT 'freshness','emails_last_24h',
    GREATEST(0::bigint, 50 - (SELECT count(*) FROM emails WHERE created_at > now() - interval '24 hours')),
    0, 'high', 'Emails below 50/day threshold (value = how many below)'
  UNION ALL SELECT 'freshness','insights_last_24h',
    GREATEST(0::bigint, 5 - (SELECT count(*) FROM agent_insights WHERE created_at > now() - interval '24 hours')),
    0, 'high', 'Insights below 5/day threshold'
  UNION ALL SELECT 'freshness','briefings_today',
    GREATEST(0::bigint, 1 - (SELECT count(*) FROM briefings WHERE briefing_date=CURRENT_DATE)),
    0, 'high', 'Daily briefing missing for today'
  UNION ALL SELECT 'freshness','revenue_metrics_stale_days',
    GREATEST(0::bigint,
      EXTRACT(day FROM now() - COALESCE((SELECT max(created_at) FROM revenue_metrics), now() - interval '999 days'))::bigint - 2),
    0, 'medium', 'Days past freshness SLA for revenue_metrics'
  UNION ALL SELECT 'freshness','pipeline_errors_24h',
    (SELECT count(*) FROM pipeline_logs WHERE level='error' AND created_at > now() - interval '24 hours')::bigint,
    0, 'high', 'Pipeline errors in last 24h'
  UNION ALL SELECT 'business_logic','overdue_invoices_miscalculated',
    (SELECT count(*) FROM odoo_invoices
      WHERE payment_state='not_paid' AND due_date < CURRENT_DATE AND (days_overdue IS NULL OR days_overdue=0))::bigint,
    0, 'medium', 'Overdue invoices with incorrect days_overdue'
  UNION ALL SELECT 'business_logic','invoices_residual_gt_total',
    (SELECT count(*) FROM odoo_invoices WHERE amount_residual > amount_total AND amount_total > 0)::bigint,
    0, 'high', 'Invoices where residual > total (impossible)'
  UNION ALL SELECT 'business_logic','facts_invalid_confidence',
    (SELECT count(*) FROM facts WHERE confidence < 0 OR confidence > 1)::bigint,
    0, 'high', 'Facts with confidence outside [0,1]'
  UNION ALL SELECT 'cost','tokens_24h_cost_usd',
    (SELECT ROUND(
      COALESCE(SUM(input_tokens)  FILTER (WHERE model ILIKE '%sonnet%'),0)::numeric * 3.0/1000000
     + COALESCE(SUM(output_tokens) FILTER (WHERE model ILIKE '%sonnet%'),0)::numeric * 15.0/1000000
     + COALESCE(SUM(input_tokens)  FILTER (WHERE model ILIKE '%haiku%'),0)::numeric * 0.80/1000000
     + COALESCE(SUM(output_tokens) FILTER (WHERE model ILIKE '%haiku%'),0)::numeric * 4.0/1000000, 0)::bigint
     FROM token_usage WHERE created_at > now() - interval '24 hours'),
    20, 'high', 'Estimated Claude API cost in last 24h (USD)'

  ----------------------------------------------------------------------------
  -- NEW CHECKS (Sprint 1 — audit 2026-04-14)
  ----------------------------------------------------------------------------
  UNION ALL SELECT 'sync_gap','invoice_lines_backfill_gap',
    (SELECT count(*) FROM odoo_invoices i
      WHERE i.state='posted' AND i.move_type IN ('out_invoice','in_invoice')
        AND NOT EXISTS (SELECT 1 FROM odoo_invoice_lines l WHERE l.odoo_move_id=i.id))::bigint,
    100, 'critical',
    'Posted invoices without any line items synced — breaks margin analysis'
  UNION ALL SELECT 'price_integrity','products_list_below_cost',
    (SELECT count(*) FROM odoo_products
      WHERE active=true AND standard_price>0 AND list_price>0 AND list_price < standard_price)::bigint,
    50, 'high',
    'Active products where list_price is below standard_price (broken pricing)'
  UNION ALL SELECT 'inventory_sanity','products_reserved_exceeds_stock',
    (SELECT count(*) FROM odoo_products WHERE reserved_qty > stock_qty)::bigint,
    0, 'high',
    'Products with reserved_qty > stock_qty (physically impossible)'
  UNION ALL SELECT 'inventory_sanity','products_negative_stock',
    (SELECT count(*) FROM odoo_products WHERE stock_qty < 0)::bigint,
    0, 'critical',
    'Products with negative stock_qty'
  UNION ALL SELECT 'collection_health','collection_cei_below_85',
    (SELECT count(*) FROM (
      SELECT to_char(invoice_date,'YYYY-MM') AS m,
             SUM(CASE WHEN payment_state='paid' THEN amount_total_mxn ELSE 0 END)
               / NULLIF(SUM(amount_total_mxn),0) AS rate
      FROM odoo_invoices
      WHERE move_type='out_invoice' AND state='posted'
        AND invoice_date BETWEEN CURRENT_DATE - interval '5 months' AND CURRENT_DATE - interval '3 months'
      GROUP BY 1 HAVING SUM(amount_total_mxn)>100000
    ) x WHERE rate < 0.85)::bigint,
    0, 'critical',
    'Cohort months (3-5mo old) with Collection Effectiveness Index below 85% — collection process breakdown'
  UNION ALL SELECT 'accounting_integrity','invalid_account_period',
    (SELECT count(*) FROM odoo_account_balances WHERE period !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$')::bigint,
    0, 'high',
    'odoo_account_balances rows with malformed period (non YYYY-MM in 2000-2099)'
  UNION ALL SELECT 'cfdi_sat','cfdi_state_missing_60d',
    (SELECT count(*) FROM odoo_invoices
      WHERE move_type='out_invoice' AND state='posted' AND cfdi_state IS NULL
        AND invoice_date >= CURRENT_DATE - interval '60 days')::bigint,
    10, 'high',
    'Recent out-invoices (60d) without SAT cfdi_state — compliance gap'
  UNION ALL SELECT 'credit_risk','customers_over_credit_limit',
    (SELECT count(*) FROM (
      SELECT c.id
      FROM companies c
      JOIN odoo_invoices i ON i.company_id=c.id AND i.state='posted' AND i.move_type='out_invoice'
      WHERE c.credit_limit > 0
      GROUP BY c.id, c.credit_limit
      HAVING SUM(CASE WHEN i.payment_state IN ('not_paid','partial') THEN i.amount_residual_mxn ELSE 0 END) > c.credit_limit
    ) x)::bigint,
    0, 'high',
    'Customers whose outstanding AR exceeds their configured credit_limit'
  UNION ALL SELECT 'fx','usd_rate_stale_days',
    GREATEST(0::bigint,
      EXTRACT(day FROM CURRENT_DATE -
        COALESCE((SELECT max(rate_date) FROM odoo_currency_rates WHERE currency='USD'),
                 CURRENT_DATE - interval '999 days'))::bigint - 3),
    0, 'critical',
    'Days past SLA (3d) since last USD exchange rate update'
  UNION ALL SELECT 'process_dead','activities_overdue_pct',
    (SELECT CASE
       WHEN COUNT(*) = 0 THEN 0
       WHEN (100.0 * COUNT(*) FILTER (WHERE is_overdue=true) / NULLIF(COUNT(*),0)) >= 90 THEN
         (100 * COUNT(*) FILTER (WHERE is_overdue=true) / NULLIF(COUNT(*),0))::bigint
       ELSE 0
     END
     FROM odoo_activities)::bigint,
    80, 'medium',
    'Percentage of Odoo activities that are overdue (high = workflow abandoned)'
  UNION ALL SELECT 'sync_gap','briefings_zero_accounts',
    (SELECT count(*) FROM briefings WHERE briefing_date >= CURRENT_DATE - interval '7 days' AND accounts_processed=0)::bigint,
    0, 'high',
    'Recent briefings with accounts_processed=0 — pipeline counter bug'
  UNION ALL SELECT 'process_dead','crm_pipeline_empty',
    (SELECT count(*) FROM odoo_crm_leads WHERE active=true AND lead_type='opportunity' AND COALESCE(expected_revenue,0)=0)::bigint,
    2, 'medium',
    'Active CRM opportunities with zero expected_revenue — pipeline not being maintained'
  UNION ALL SELECT 'attribution','sale_orders_no_salesperson',
    (SELECT count(*) FROM odoo_sale_orders
      WHERE salesperson_user_id IS NULL AND state IN ('sale','done')
        AND date_order >= CURRENT_DATE - interval '90 days')::bigint,
    5, 'medium',
    'Recent sale orders without salesperson attribution — commission tracking gap'
  UNION ALL SELECT 'anomalies','purchase_price_anomalies_180d',
    (SELECT count(*) FROM (
      SELECT ol.id,
        ol.price_unit,
        AVG(ol.price_unit) OVER (PARTITION BY ol.odoo_product_id) AS avg_p,
        COUNT(*) OVER (PARTITION BY ol.odoo_product_id) AS n
      FROM odoo_order_lines ol
      WHERE ol.order_type='purchase'
        AND ol.order_date >= CURRENT_DATE - interval '180 days'
        AND ol.price_unit > 0 AND ol.odoo_product_id IS NOT NULL
    ) x WHERE n >= 3 AND avg_p > 0 AND ABS((price_unit-avg_p)/avg_p) > 0.5)::bigint,
    20, 'medium',
    'Purchase lines (180d) priced >50% away from the product avg — supplier price drift'
  UNION ALL SELECT 'concentration','top5_share_pct',
    (SELECT COALESCE(ROUND(SUM(share)*100)::bigint, 0) FROM (
      SELECT r/NULLIF(SUM(r) OVER (),0) AS share, ROW_NUMBER() OVER (ORDER BY r DESC) AS rk
      FROM (
        SELECT company_id, SUM(amount_total_mxn) AS r
        FROM odoo_invoices
        WHERE move_type='out_invoice' AND state='posted' AND invoice_date >= CURRENT_DATE - interval '365 days'
        GROUP BY company_id HAVING SUM(amount_total_mxn)>0
      ) t
    ) ranked WHERE rk<=5),
    50, 'high',
    'Percentage of revenue (12m) concentrated in top 5 customers — existential concentration risk'
) checks;

COMMENT ON VIEW public.data_quality_scorecard IS
'Tablero consolidado de data quality. Cada fila es un check con value vs threshold. Los alerts aparecen cuando value > threshold. Reglas originales + 15 nuevos checks del audit 2026-04-14 (sync gaps, price integrity, inventory sanity, collection health, accounting integrity, CFDI-SAT, credit risk, FX, process dead signals, anomalies, concentration).';
