-- Fase 2 Limpieza: remove odoo_payments row from odoo_sync_freshness view.
-- Prep step before DROP TABLE odoo_payments (happens in Task 13 after
-- deploy confirms no live reader). odoo_account_payments row remains.

BEGIN;
  CREATE OR REPLACE VIEW public.odoo_sync_freshness AS
   WITH per_table AS (
         SELECT 'odoo_sale_orders'::text AS table_name,
            'sale_orders'::text AS push_method,
            2 AS expected_hours,
            ( SELECT count(*) AS count
                   FROM odoo_sale_orders) AS row_count,
            ( SELECT max(odoo_sale_orders.synced_at) AS max
                   FROM odoo_sale_orders) AS row_last_sync
        UNION ALL
         SELECT 'odoo_purchase_orders'::text,
            'purchase_orders'::text,
            2,
            ( SELECT count(*) AS count
                   FROM odoo_purchase_orders) AS count,
            ( SELECT max(odoo_purchase_orders.synced_at) AS max
                   FROM odoo_purchase_orders) AS max
        UNION ALL
         SELECT 'odoo_invoices'::text,
            'invoices'::text,
            2,
            ( SELECT count(*) AS count
                   FROM odoo_invoices) AS count,
            ( SELECT max(odoo_invoices.synced_at) AS max
                   FROM odoo_invoices) AS max
        UNION ALL
         SELECT 'odoo_invoice_lines'::text,
            'invoice_lines'::text,
            2,
            ( SELECT count(*) AS count
                   FROM odoo_invoice_lines) AS count,
            ( SELECT max(odoo_invoice_lines.synced_at) AS max
                   FROM odoo_invoice_lines) AS max
        UNION ALL
         SELECT 'odoo_account_payments'::text,
            'account_payments'::text,
            2,
            ( SELECT count(*) AS count
                   FROM odoo_account_payments) AS count,
            ( SELECT max(odoo_account_payments.synced_at) AS max
                   FROM odoo_account_payments) AS max
        UNION ALL
         SELECT 'odoo_deliveries'::text,
            'deliveries'::text,
            2,
            ( SELECT count(*) AS count
                   FROM odoo_deliveries) AS count,
            ( SELECT max(odoo_deliveries.synced_at) AS max
                   FROM odoo_deliveries) AS max
        UNION ALL
         SELECT 'odoo_products'::text,
            'products'::text,
            6,
            ( SELECT count(*) AS count
                   FROM odoo_products) AS count,
            ( SELECT max(odoo_products.updated_at) AS max
                   FROM odoo_products) AS max
        UNION ALL
         SELECT 'odoo_crm_leads'::text,
            'crm_leads'::text,
            6,
            ( SELECT count(*) AS count
                   FROM odoo_crm_leads) AS count,
            ( SELECT max(odoo_crm_leads.synced_at) AS max
                   FROM odoo_crm_leads) AS max
        UNION ALL
         SELECT 'odoo_activities'::text,
            'activities'::text,
            2,
            ( SELECT count(*) AS count
                   FROM odoo_activities) AS count,
            ( SELECT max(odoo_activities.synced_at) AS max
                   FROM odoo_activities) AS max
        UNION ALL
         SELECT 'odoo_users'::text,
            'users'::text,
            6,
            ( SELECT count(*) AS count
                   FROM odoo_users) AS count,
            ( SELECT max(odoo_users.updated_at) AS max
                   FROM odoo_users) AS max
        UNION ALL
         SELECT 'odoo_employees'::text,
            'employees'::text,
            6,
            ( SELECT count(*) AS count
                   FROM odoo_employees) AS count,
            ( SELECT max(odoo_employees.synced_at) AS max
                   FROM odoo_employees) AS max
        UNION ALL
         SELECT 'odoo_departments'::text,
            'departments'::text,
            12,
            ( SELECT count(*) AS count
                   FROM odoo_departments) AS count,
            ( SELECT max(odoo_departments.synced_at) AS max
                   FROM odoo_departments) AS max
        UNION ALL
         SELECT 'odoo_orderpoints'::text,
            'orderpoints'::text,
            6,
            ( SELECT count(*) AS count
                   FROM odoo_orderpoints) AS count,
            ( SELECT max(odoo_orderpoints.synced_at) AS max
                   FROM odoo_orderpoints) AS max
        UNION ALL
         SELECT 'odoo_chart_of_accounts'::text,
            'chart_of_accounts'::text,
            12,
            ( SELECT count(*) AS count
                   FROM odoo_chart_of_accounts) AS count,
            ( SELECT max(odoo_chart_of_accounts.synced_at) AS max
                   FROM odoo_chart_of_accounts) AS max
        UNION ALL
         SELECT 'odoo_account_balances'::text,
            'account_balances'::text,
            2,
            ( SELECT count(*) AS count
                   FROM odoo_account_balances) AS count,
            ( SELECT max(odoo_account_balances.synced_at) AS max
                   FROM odoo_account_balances) AS max
        UNION ALL
         SELECT 'odoo_bank_balances'::text,
            'bank_balances'::text,
            2,
            ( SELECT count(*) AS count
                   FROM odoo_bank_balances) AS count,
            ( SELECT max(odoo_bank_balances.updated_at) AS max
                   FROM odoo_bank_balances) AS max
        UNION ALL
         SELECT 'odoo_manufacturing'::text,
            'manufacturing'::text,
            6,
            ( SELECT count(*) AS count
                   FROM odoo_manufacturing) AS count,
            ( SELECT max(odoo_manufacturing.synced_at) AS max
                   FROM odoo_manufacturing) AS max
        UNION ALL
         SELECT 'mrp_boms'::text,
            'boms'::text,
            12,
            ( SELECT count(*) AS count
                   FROM mrp_boms) AS count,
            ( SELECT max(mrp_boms.synced_at) AS max
                   FROM mrp_boms) AS max
        ), last_events AS (
         SELECT odoo_push_last_events.method,
            max(odoo_push_last_events.created_at) AS last_successful_run
           FROM odoo_push_last_events
          WHERE (odoo_push_last_events.status = 'success'::text)
          GROUP BY odoo_push_last_events.method
        ), merged AS (
         SELECT pt.table_name,
            pt.push_method,
            pt.expected_hours,
            pt.row_count,
            pt.row_last_sync,
            le.last_successful_run,
            GREATEST(pt.row_last_sync, le.last_successful_run) AS last_sync
           FROM (per_table pt
             LEFT JOIN last_events le ON ((le.method = pt.push_method)))
        )
 SELECT table_name,
    row_count,
    last_sync,
    expected_hours,
    ((EXTRACT(epoch FROM (now() - last_sync)))::bigint / 60) AS minutes_ago,
    (EXTRACT(epoch FROM (now() - last_sync)) / (3600)::numeric) AS hours_ago,
        CASE
            WHEN (last_sync IS NULL) THEN 'unknown'::text
            WHEN (EXTRACT(epoch FROM (now() - last_sync)) <= (((expected_hours * 3600) * 2))::numeric) THEN 'fresh'::text
            WHEN (EXTRACT(epoch FROM (now() - last_sync)) <= (((expected_hours * 3600) * 4))::numeric) THEN 'warning'::text
            ELSE 'stale'::text
        END AS status
   FROM merged
  ORDER BY
        CASE
            WHEN (last_sync IS NULL) THEN 0
            WHEN (EXTRACT(epoch FROM (now() - last_sync)) > (((expected_hours * 3600) * 4))::numeric) THEN 1
            WHEN (EXTRACT(epoch FROM (now() - last_sync)) > (((expected_hours * 3600) * 2))::numeric) THEN 2
            ELSE 3
        END, last_sync NULLS FIRST;

  INSERT INTO public.schema_changes (change_type, table_name, description, sql_executed)
  VALUES (
    'replace_view',
    'odoo_sync_freshness',
    'Fase 2 — removida row odoo_payments de per_table CTE (prep para drop tabla)',
    'CREATE OR REPLACE VIEW public.odoo_sync_freshness AS …'
  );
COMMIT;
