-- Fase 2 Limpieza: drop revenue_metrics table + populate_revenue_metrics fn.
-- Update data_quality_scorecard to remove the revenue_metrics freshness check.
-- 7349 rows in the table are DEPRECATED; writer API retired in this commit.

BEGIN;
  -- Recreate view without the revenue_metrics freshness check.
  -- Definition obtained from pg_views, stripped of the UNION ALL block
  -- that queried max(revenue_metrics.created_at).
  CREATE OR REPLACE VIEW public.data_quality_scorecard AS
   SELECT category,
    metric,
    value,
    threshold,
    severity,
    description
   FROM ( SELECT 'fk_integrity'::text AS category,
            'invoices_no_company'::text AS metric,
            ( SELECT count(*) AS count
                   FROM odoo_invoices
                  WHERE (odoo_invoices.company_id IS NULL)) AS value,
            (0)::bigint AS threshold,
            'critical'::text AS severity,
            'Odoo invoices that cannot be attributed to a company'::text AS description
        UNION ALL
         SELECT 'fk_integrity'::text,
            'orders_no_company'::text,
            ( SELECT count(*) AS count
                   FROM odoo_sale_orders
                  WHERE (odoo_sale_orders.company_id IS NULL)) AS count,
            0,
            'critical'::text,
            'Sale orders without company link'::text
        UNION ALL
         SELECT 'fk_integrity'::text,
            'action_items_pending_no_assignee'::text,
            ( SELECT count(*) AS count
                   FROM action_items
                  WHERE ((action_items.assignee_email IS NULL) AND (action_items.state = 'pending'::text))) AS count,
            0,
            'critical'::text,
            'Pending action items with nobody assigned'::text
        UNION ALL
         SELECT 'fk_integrity'::text,
            'agent_insights_open_no_assignee'::text,
            ( SELECT count(*) AS count
                   FROM agent_insights
                  WHERE ((agent_insights.assignee_email IS NULL) AND (agent_insights.state = ANY (ARRAY['new'::text, 'seen'::text])))) AS count,
            5,
            'high'::text,
            'Open insights with no assignee'::text
        UNION ALL
         SELECT 'fk_integrity'::text,
            'emails_no_sender_contact'::text,
            ( SELECT count(*) AS count
                   FROM emails
                  WHERE (emails.sender_contact_id IS NULL)) AS count,
            100,
            'medium'::text,
            'Emails from senders not yet in contacts table'::text
        UNION ALL
         SELECT 'fk_integrity'::text,
            'contacts_no_company'::text,
            ( SELECT count(*) AS count
                   FROM contacts
                  WHERE ((contacts.company_id IS NULL) AND (contacts.contact_type <> 'noise'::text))) AS count,
            50,
            'medium'::text,
            'Business contacts not linked to any company'::text
        UNION ALL
         SELECT 'duplicates'::text,
            'dup_companies_by_odoo_partner'::text,
            ( SELECT count(*) AS count
                   FROM ( SELECT companies.odoo_partner_id
                           FROM companies
                          WHERE (companies.odoo_partner_id IS NOT NULL)
                          GROUP BY companies.odoo_partner_id
                         HAVING (count(*) > 1)) d) AS count,
            0,
            'critical'::text,
            'Multiple company records with same Odoo partner_id'::text
        UNION ALL
         SELECT 'duplicates'::text,
            'dup_contacts_by_odoo_partner'::text,
            ( SELECT count(*) AS count
                   FROM ( SELECT contacts.odoo_partner_id
                           FROM contacts
                          WHERE (contacts.odoo_partner_id IS NOT NULL)
                          GROUP BY contacts.odoo_partner_id
                         HAVING (count(*) > 1)) d) AS count,
            0,
            'critical'::text,
            'Multiple contacts with same Odoo partner_id'::text
        UNION ALL
         SELECT 'duplicates'::text,
            'dup_entities'::text,
            ( SELECT count(*) AS count
                   FROM ( SELECT entities.canonical_name,
                            entities.entity_type
                           FROM entities
                          GROUP BY entities.canonical_name, entities.entity_type
                         HAVING (count(*) > 1)) d) AS count,
            0,
            'high'::text,
            'Duplicate entities'::text
        UNION ALL
         SELECT 'freshness'::text,
            'emails_last_24h'::text,
            GREATEST((0)::bigint, (50 - ( SELECT count(*) AS count
                   FROM emails
                  WHERE (emails.created_at > (now() - '24:00:00'::interval))))) AS "greatest",
            0,
            'high'::text,
            'Emails below 50/day threshold (value = how many below)'::text
        UNION ALL
         SELECT 'freshness'::text,
            'insights_last_24h'::text,
            GREATEST((0)::bigint, (5 - ( SELECT count(*) AS count
                   FROM agent_insights
                  WHERE (agent_insights.created_at > (now() - '24:00:00'::interval))))) AS "greatest",
            0,
            'high'::text,
            'Insights below 5/day threshold'::text
        UNION ALL
         SELECT 'freshness'::text,
            'briefings_today'::text,
            GREATEST((0)::bigint, (1 - ( SELECT count(*) AS count
                   FROM briefings
                  WHERE (briefings.briefing_date = CURRENT_DATE)))) AS "greatest",
            0,
            'high'::text,
            'Daily briefing missing for today'::text
        UNION ALL
         SELECT 'freshness'::text,
            'pipeline_errors_24h'::text,
            ( SELECT count(*) AS count
                   FROM pipeline_logs
                  WHERE ((pipeline_logs.level = 'error'::text) AND (pipeline_logs.created_at > (now() - '24:00:00'::interval)))) AS count,
            0,
            'high'::text,
            'Pipeline errors in last 24h'::text
        UNION ALL
         SELECT 'business_logic'::text,
            'overdue_invoices_miscalculated'::text,
            ( SELECT count(*) AS count
                   FROM odoo_invoices
                  WHERE ((odoo_invoices.payment_state = 'not_paid'::text) AND (odoo_invoices.due_date < CURRENT_DATE) AND ((odoo_invoices.days_overdue IS NULL) OR (odoo_invoices.days_overdue = 0)))) AS count,
            0,
            'medium'::text,
            'Overdue invoices with incorrect days_overdue'::text
        UNION ALL
         SELECT 'business_logic'::text,
            'invoices_residual_gt_total'::text,
            ( SELECT count(*) AS count
                   FROM odoo_invoices
                  WHERE ((odoo_invoices.amount_residual > odoo_invoices.amount_total) AND (odoo_invoices.amount_total > (0)::numeric))) AS count,
            0,
            'high'::text,
            'Invoices where residual > total (impossible)'::text
        UNION ALL
         SELECT 'business_logic'::text,
            'facts_invalid_confidence'::text,
            ( SELECT count(*) AS count
                   FROM facts
                  WHERE ((facts.confidence < (0)::numeric) OR (facts.confidence > (1)::numeric))) AS count,
            0,
            'high'::text,
            'Facts with confidence outside [0,1]'::text
        UNION ALL
         SELECT 'cost'::text,
            'tokens_24h_cost_usd'::text,
            ( SELECT (round(((((((COALESCE(sum(token_usage.input_tokens) FILTER (WHERE (token_usage.model ~~* '%sonnet%'::text)), (0)::bigint))::numeric * 3.0) / (1000000)::numeric) + (((COALESCE(sum(token_usage.output_tokens) FILTER (WHERE (token_usage.model ~~* '%sonnet%'::text)), (0)::bigint))::numeric * 15.0) / (1000000)::numeric)) + (((COALESCE(sum(token_usage.input_tokens) FILTER (WHERE (token_usage.model ~~* '%haiku%'::text)), (0)::bigint))::numeric * 0.80) / (1000000)::numeric)) + (((COALESCE(sum(token_usage.output_tokens) FILTER (WHERE (token_usage.model ~~* '%haiku%'::text)), (0)::bigint))::numeric * 4.0) / (1000000)::numeric)), 0))::bigint AS round
                   FROM token_usage
                  WHERE (token_usage.created_at > (now() - '24:00:00'::interval))) AS round,
            20,
            'high'::text,
            'Estimated Claude API cost in last 24h (USD)'::text
        UNION ALL
         SELECT 'sync_gap'::text,
            'invoice_lines_backfill_gap'::text,
            ( SELECT count(*) AS count
                   FROM odoo_invoices i
                  WHERE ((i.state = 'posted'::text) AND (i.move_type = ANY (ARRAY['out_invoice'::text, 'in_invoice'::text])) AND (NOT (EXISTS ( SELECT 1
                           FROM odoo_invoice_lines l
                          WHERE (l.odoo_move_id = i.id)))))) AS count,
            100,
            'critical'::text,
            'Posted invoices without any line items synced — breaks margin analysis'::text
        UNION ALL
         SELECT 'price_integrity'::text,
            'products_list_below_cost'::text,
            ( SELECT count(*) AS count
                   FROM odoo_products
                  WHERE ((odoo_products.active = true) AND (odoo_products.standard_price > (0)::numeric) AND (odoo_products.list_price > (0)::numeric) AND (odoo_products.list_price < odoo_products.standard_price))) AS count,
            50,
            'high'::text,
            'Active products where list_price is below standard_price (broken pricing)'::text
        UNION ALL
         SELECT 'inventory_sanity'::text,
            'products_reserved_exceeds_stock'::text,
            ( SELECT count(*) AS count
                   FROM odoo_products
                  WHERE (odoo_products.reserved_qty > odoo_products.stock_qty)) AS count,
            0,
            'high'::text,
            'Products with reserved_qty > stock_qty (physically impossible)'::text
        UNION ALL
         SELECT 'inventory_sanity'::text,
            'products_negative_stock'::text,
            ( SELECT count(*) AS count
                   FROM odoo_products
                  WHERE (odoo_products.stock_qty < (0)::numeric)) AS count,
            0,
            'critical'::text,
            'Products with negative stock_qty'::text
        UNION ALL
         SELECT 'collection_health'::text,
            'collection_cei_below_85'::text,
            ( SELECT count(*) AS count
                   FROM ( SELECT to_char((odoo_invoices.invoice_date)::timestamp with time zone, 'YYYY-MM'::text) AS m,
                            (sum(
                                CASE
                                    WHEN (odoo_invoices.payment_state = 'paid'::text) THEN odoo_invoices.amount_total_mxn
                                    ELSE (0)::numeric
                                END) / NULLIF(sum(odoo_invoices.amount_total_mxn), (0)::numeric)) AS rate
                           FROM odoo_invoices
                          WHERE ((odoo_invoices.move_type = 'out_invoice'::text) AND (odoo_invoices.state = 'posted'::text) AND ((odoo_invoices.invoice_date >= (CURRENT_DATE - '5 mons'::interval)) AND (odoo_invoices.invoice_date <= (CURRENT_DATE - '3 mons'::interval))))
                          GROUP BY (to_char((odoo_invoices.invoice_date)::timestamp with time zone, 'YYYY-MM'::text))
                         HAVING (sum(odoo_invoices.amount_total_mxn) > (100000)::numeric)) x
                  WHERE (x.rate < 0.85)) AS count,
            0,
            'critical'::text,
            'Cohort months (3-5mo old) with Collection Effectiveness Index below 85%'::text
        UNION ALL
         SELECT 'accounting_integrity'::text,
            'invalid_account_period'::text,
            ( SELECT count(*) AS count
                   FROM odoo_account_balances
                  WHERE (odoo_account_balances.period !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'::text)) AS count,
            0,
            'high'::text,
            'odoo_account_balances rows with malformed period'::text
        UNION ALL
         SELECT 'cfdi_sat'::text,
            'cfdi_state_missing_60d'::text,
            ( SELECT count(*) AS count
                   FROM odoo_invoices
                  WHERE ((odoo_invoices.move_type = 'out_invoice'::text) AND (odoo_invoices.state = 'posted'::text) AND (odoo_invoices.cfdi_state IS NULL) AND (odoo_invoices.invoice_date >= (CURRENT_DATE - '60 days'::interval)))) AS count,
            10,
            'high'::text,
            'Recent out-invoices (60d) without SAT cfdi_state'::text
        UNION ALL
         SELECT 'credit_risk'::text,
            'customers_over_credit_limit'::text,
            ( SELECT count(*) AS count
                   FROM ( SELECT c.id
                           FROM (companies c
                             JOIN odoo_invoices i ON (((i.company_id = c.id) AND (i.state = 'posted'::text) AND (i.move_type = 'out_invoice'::text))))
                          WHERE (c.credit_limit > (0)::numeric)
                          GROUP BY c.id, c.credit_limit
                         HAVING (sum(
                                CASE
                                    WHEN (i.payment_state = ANY (ARRAY['not_paid'::text, 'partial'::text])) THEN i.amount_residual_mxn
                                    ELSE (0)::numeric
                                END) > c.credit_limit)) x) AS count,
            0,
            'high'::text,
            'Customers whose outstanding AR exceeds credit_limit'::text
        UNION ALL
         SELECT 'fx'::text,
            'usd_rate_stale_days'::text,
            GREATEST((0)::bigint, ((EXTRACT(day FROM ((CURRENT_DATE)::timestamp without time zone - COALESCE((( SELECT max(odoo_currency_rates.rate_date) AS max
                   FROM odoo_currency_rates
                  WHERE (odoo_currency_rates.currency = 'USD'::text)))::timestamp without time zone, (CURRENT_DATE - '999 days'::interval)))))::bigint - 3)) AS "greatest",
            0,
            'critical'::text,
            'Days past SLA (3d) since last USD exchange rate update'::text
        UNION ALL
         SELECT 'process_dead'::text,
            'activities_overdue_pct'::text,
            ( SELECT
                        CASE
                            WHEN (count(*) = 0) THEN (0)::bigint
                            WHEN (((100.0 * (count(*) FILTER (WHERE (odoo_activities.is_overdue = true)))::numeric) / (NULLIF(count(*), 0))::numeric) >= (90)::numeric) THEN ((100 * count(*) FILTER (WHERE (odoo_activities.is_overdue = true))) / NULLIF(count(*), 0))
                            ELSE (0)::bigint
                        END AS "case"
                   FROM odoo_activities) AS "case",
            80,
            'medium'::text,
            'Percentage of Odoo activities that are overdue'::text
        UNION ALL
         SELECT 'sync_gap'::text,
            'briefings_zero_accounts'::text,
            ( SELECT count(*) AS count
                   FROM briefings
                  WHERE ((briefings.briefing_date >= (CURRENT_DATE - '7 days'::interval)) AND (briefings.accounts_processed = 0))) AS count,
            0,
            'high'::text,
            'Recent briefings with accounts_processed=0'::text
        UNION ALL
         SELECT 'process_dead'::text,
            'crm_pipeline_empty'::text,
            ( SELECT count(*) AS count
                   FROM odoo_crm_leads
                  WHERE ((odoo_crm_leads.active = true) AND (odoo_crm_leads.lead_type = 'opportunity'::text) AND (COALESCE(odoo_crm_leads.expected_revenue, (0)::numeric) = (0)::numeric))) AS count,
            2,
            'medium'::text,
            'Active CRM opportunities with zero expected_revenue'::text
        UNION ALL
         SELECT 'attribution'::text,
            'sale_orders_no_salesperson'::text,
            ( SELECT count(*) AS count
                   FROM odoo_sale_orders
                  WHERE ((odoo_sale_orders.salesperson_user_id IS NULL) AND (odoo_sale_orders.state = ANY (ARRAY['sale'::text, 'done'::text])) AND (odoo_sale_orders.date_order >= (CURRENT_DATE - '90 days'::interval)))) AS count,
            5,
            'medium'::text,
            'Recent sale orders without salesperson attribution'::text
        UNION ALL
         SELECT 'anomalies'::text,
            'purchase_price_anomalies_180d'::text,
            ( SELECT count(*) AS count
                   FROM ( SELECT ol.id,
                            ol.price_unit,
                            avg(ol.price_unit) OVER (PARTITION BY ol.odoo_product_id) AS avg_p,
                            count(*) OVER (PARTITION BY ol.odoo_product_id) AS n
                           FROM odoo_order_lines ol
                          WHERE ((ol.order_type = 'purchase'::text) AND (ol.order_date >= (CURRENT_DATE - '180 days'::interval)) AND (ol.price_unit > (0)::numeric) AND (ol.odoo_product_id IS NOT NULL))) x
                  WHERE ((x.n >= 3) AND (x.avg_p > (0)::numeric) AND (abs(((x.price_unit - x.avg_p) / x.avg_p)) > 0.5))) AS count,
            20,
            'medium'::text,
            'Purchase lines (180d) priced >50% from product avg'::text
        UNION ALL
         SELECT 'concentration'::text,
            'top5_share_pct'::text,
            ( SELECT COALESCE((round((sum(ranked.share) * (100)::numeric)))::bigint, (0)::bigint) AS "coalesce"
                   FROM ( SELECT (t.r / NULLIF(sum(t.r) OVER (), (0)::numeric)) AS share,
                            row_number() OVER (ORDER BY t.r DESC) AS rk
                           FROM ( SELECT odoo_invoices.company_id,
                                    sum(odoo_invoices.amount_total_mxn) AS r
                                   FROM odoo_invoices
                                  WHERE ((odoo_invoices.move_type = 'out_invoice'::text) AND (odoo_invoices.state = 'posted'::text) AND (odoo_invoices.invoice_date >= (CURRENT_DATE - '365 days'::interval)))
                                  GROUP BY odoo_invoices.company_id
                                 HAVING (sum(odoo_invoices.amount_total_mxn) > (0)::numeric)) t) ranked
                  WHERE (ranked.rk <= 5)) AS "coalesce",
            50,
            'high'::text,
            'Pct of revenue 12m in top 5 customers'::text) checks;

  DROP FUNCTION IF EXISTS public.populate_revenue_metrics();
  DROP TABLE public.revenue_metrics;

  INSERT INTO public.schema_changes (change_type, table_name, description, sql_executed) VALUES
    ('replace_view', 'data_quality_scorecard', 'Fase 2 — removida freshness check de revenue_metrics', 'CREATE OR REPLACE VIEW public.data_quality_scorecard …'),
    ('drop_function', 'revenue_metrics', 'Fase 2 — populate_revenue_metrics() ya no tiene tabla destino', 'DROP FUNCTION public.populate_revenue_metrics()'),
    ('drop_table', 'revenue_metrics', 'Fase 2 — 7349 rows DEPRECATED; writer en /api/pipeline/snapshot retirado', 'DROP TABLE public.revenue_metrics');
COMMIT;
