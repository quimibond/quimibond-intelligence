-- =========================================================================
-- Data Integrity Audit
-- Audit 2026-04-15 follow-up.
--
-- Run this against production Supabase. Each block returns a summary row
-- (or zero rows if clean). Any non-zero `broken` count is a finding to
-- investigate. The whole script is read-only — no mutations.
--
-- Usage:
--   supabase db execute --file scripts/data_integrity_audit.sql
-- or paste section-by-section into the Supabase SQL editor.
-- =========================================================================

\echo '════════════════════════════════════════════════════════════════'
\echo '1. REFERENTIAL INTEGRITY (FKs, orphans, broken links)'
\echo '════════════════════════════════════════════════════════════════'

-- 1.1 Odoo → Supabase company link coverage
SELECT 'invoices_no_company_id'       AS check, COUNT(*)::int AS broken, (SELECT COUNT(*) FROM odoo_invoices)::int AS total FROM odoo_invoices WHERE company_id IS NULL AND odoo_partner_id IS NOT NULL
UNION ALL SELECT 'sale_orders_no_company_id',           COUNT(*)::int, (SELECT COUNT(*) FROM odoo_sale_orders)::int       FROM odoo_sale_orders     WHERE company_id IS NULL AND odoo_partner_id IS NOT NULL
UNION ALL SELECT 'purchase_orders_no_company_id',       COUNT(*)::int, (SELECT COUNT(*) FROM odoo_purchase_orders)::int   FROM odoo_purchase_orders WHERE company_id IS NULL AND odoo_partner_id IS NOT NULL
UNION ALL SELECT 'order_lines_no_company_id',           COUNT(*)::int, (SELECT COUNT(*) FROM odoo_order_lines)::int       FROM odoo_order_lines     WHERE company_id IS NULL AND odoo_partner_id IS NOT NULL
UNION ALL SELECT 'invoice_lines_no_company_id',         COUNT(*)::int, (SELECT COUNT(*) FROM odoo_invoice_lines)::int     FROM odoo_invoice_lines   WHERE company_id IS NULL AND odoo_partner_id IS NOT NULL
UNION ALL SELECT 'deliveries_no_company_id',            COUNT(*)::int, (SELECT COUNT(*) FROM odoo_deliveries)::int        FROM odoo_deliveries      WHERE company_id IS NULL AND odoo_partner_id IS NOT NULL
UNION ALL SELECT 'payments_no_company_id',              COUNT(*)::int, (SELECT COUNT(*) FROM odoo_payments)::int          FROM odoo_payments        WHERE company_id IS NULL AND odoo_partner_id IS NOT NULL
UNION ALL SELECT 'account_payments_no_company_id',      COUNT(*)::int, (SELECT COUNT(*) FROM odoo_account_payments)::int  FROM odoo_account_payments WHERE company_id IS NULL AND odoo_partner_id IS NOT NULL
ORDER BY check;

-- 1.2 Dangling FKs — rows pointing to companies that don't exist
SELECT 'invoices_dangling_company_fk' AS check, COUNT(*)::int AS broken FROM odoo_invoices      i LEFT JOIN companies c ON c.id = i.company_id WHERE i.company_id IS NOT NULL AND c.id IS NULL
UNION ALL SELECT 'sale_orders_dangling_company_fk',       COUNT(*)::int FROM odoo_sale_orders   o LEFT JOIN companies c ON c.id = o.company_id WHERE o.company_id IS NOT NULL AND c.id IS NULL
UNION ALL SELECT 'purchase_orders_dangling_company_fk',   COUNT(*)::int FROM odoo_purchase_orders o LEFT JOIN companies c ON c.id = o.company_id WHERE o.company_id IS NOT NULL AND c.id IS NULL
UNION ALL SELECT 'order_lines_dangling_company_fk',       COUNT(*)::int FROM odoo_order_lines   o LEFT JOIN companies c ON c.id = o.company_id WHERE o.company_id IS NOT NULL AND c.id IS NULL
UNION ALL SELECT 'contacts_dangling_company_fk',          COUNT(*)::int FROM contacts           t LEFT JOIN companies c ON c.id = t.company_id WHERE t.company_id IS NOT NULL AND c.id IS NULL
UNION ALL SELECT 'agent_insights_dangling_company_fk',    COUNT(*)::int FROM agent_insights     i LEFT JOIN companies c ON c.id = i.company_id WHERE i.company_id IS NOT NULL AND c.id IS NULL
ORDER BY check;

-- 1.3 Contacts/emails linkage
SELECT 'contacts_missing_entity'     AS check, COUNT(*)::int AS broken FROM contacts WHERE entity_id IS NULL AND email IS NOT NULL
UNION ALL SELECT 'contacts_missing_name',       COUNT(*)::int FROM contacts WHERE name IS NULL OR name = ''
UNION ALL SELECT 'contacts_lowercase_violated', COUNT(*)::int FROM contacts WHERE email IS NOT NULL AND email <> LOWER(email)
UNION ALL SELECT 'emails_no_contact',           COUNT(*)::int FROM emails   WHERE sender_contact_id IS NULL AND sender IS NOT NULL AND kg_processed = true
UNION ALL SELECT 'emails_no_company',           COUNT(*)::int FROM emails   WHERE company_id IS NULL AND sender_contact_id IS NOT NULL
ORDER BY check;


\echo '════════════════════════════════════════════════════════════════'
\echo '2. FINANCIAL CONSISTENCY (amounts, currencies, payments)'
\echo '════════════════════════════════════════════════════════════════'

-- 2.1 Invoice amount equation violations
SELECT 'invoices_amount_equation_broken' AS check,
  COUNT(*)::int AS broken
FROM odoo_invoices
WHERE state = 'posted'
  AND amount_total IS NOT NULL AND amount_untaxed IS NOT NULL AND amount_tax IS NOT NULL
  AND ABS(amount_total - (amount_untaxed + amount_tax)) > 0.05
UNION ALL
SELECT 'invoices_residual_gt_total',
  COUNT(*)::int
FROM odoo_invoices
WHERE amount_total IS NOT NULL AND amount_residual IS NOT NULL
  AND amount_residual > amount_total + 0.01
UNION ALL
SELECT 'invoices_negative_amount_total',
  COUNT(*)::int
FROM odoo_invoices
WHERE amount_total < 0 AND move_type NOT IN ('out_refund', 'in_refund')
UNION ALL
SELECT 'invoices_missing_amount_mxn',
  COUNT(*)::int
FROM odoo_invoices
WHERE state = 'posted' AND amount_total_mxn IS NULL
UNION ALL
SELECT 'invoices_unknown_currency',
  COUNT(*)::int
FROM odoo_invoices
WHERE currency IS NOT NULL AND currency NOT IN ('MXN','USD','EUR','GBP','JPY','CAD')
UNION ALL
SELECT 'payments_negative_amount',
  COUNT(*)::int
FROM odoo_account_payments
WHERE amount < 0
UNION ALL
SELECT 'sale_orders_missing_amount_mxn',
  COUNT(*)::int
FROM odoo_sale_orders
WHERE state IN ('sale','done') AND amount_total_mxn IS NULL
UNION ALL
SELECT 'purchase_orders_missing_amount_mxn',
  COUNT(*)::int
FROM odoo_purchase_orders
WHERE state IN ('purchase','done') AND amount_total_mxn IS NULL
ORDER BY check;

-- 2.2 Payment reconciliation — sum of payments per invoice ≈ (total − residual)
WITH paid_per_invoice AS (
  SELECT odoo_move_id, SUM(amount) AS paid_sum
  FROM odoo_payments
  WHERE state = 'posted'
  GROUP BY odoo_move_id
)
SELECT 'invoices_payment_reconciliation_drift' AS check,
  COUNT(*)::int AS broken
FROM odoo_invoices i
LEFT JOIN paid_per_invoice p ON p.odoo_move_id = i.odoo_move_id
WHERE i.state = 'posted'
  AND i.payment_state IN ('paid','in_payment','partial')
  AND ABS(
    COALESCE(i.amount_total, 0) - COALESCE(i.amount_residual, 0)
    - COALESCE(p.paid_sum, 0)
  ) > 1.0;  -- 1 MXN tolerance


\echo '════════════════════════════════════════════════════════════════'
\echo '3. DUPLICATES (canonical uniqueness violations)'
\echo '════════════════════════════════════════════════════════════════'

-- 3.1 Companies: duplicate canonical_name (case-insensitive) or odoo_partner_id
SELECT 'companies_dup_canonical_name' AS check, COUNT(*)::int AS broken FROM (
  SELECT LOWER(canonical_name), COUNT(*) c FROM companies
  WHERE canonical_name IS NOT NULL GROUP BY 1 HAVING COUNT(*) > 1
) s
UNION ALL
SELECT 'companies_dup_odoo_partner_id',
  COUNT(*)::int FROM (
    SELECT odoo_partner_id FROM companies WHERE odoo_partner_id IS NOT NULL
    GROUP BY 1 HAVING COUNT(*) > 1
  ) s
UNION ALL
SELECT 'contacts_dup_email',
  COUNT(*)::int FROM (
    SELECT LOWER(email) FROM contacts WHERE email IS NOT NULL GROUP BY 1 HAVING COUNT(*) > 1
  ) s
UNION ALL
SELECT 'contacts_dup_odoo_partner_id',
  COUNT(*)::int FROM (
    SELECT odoo_partner_id FROM contacts WHERE odoo_partner_id IS NOT NULL
    GROUP BY 1 HAVING COUNT(*) > 1
  ) s
UNION ALL
SELECT 'entities_dup_canonical',
  COUNT(*)::int FROM (
    SELECT entity_type, LOWER(canonical_name) FROM entities
    WHERE canonical_name IS NOT NULL GROUP BY 1,2 HAVING COUNT(*) > 1
  ) s
UNION ALL
SELECT 'odoo_invoices_dup_move_id',
  COUNT(*)::int FROM (
    SELECT odoo_move_id FROM odoo_invoices WHERE odoo_move_id IS NOT NULL
    GROUP BY 1 HAVING COUNT(*) > 1
  ) s
UNION ALL
SELECT 'odoo_sale_orders_dup_odoo_id',
  COUNT(*)::int FROM (
    SELECT odoo_order_id FROM odoo_sale_orders WHERE odoo_order_id IS NOT NULL
    GROUP BY 1 HAVING COUNT(*) > 1
  ) s
UNION ALL
SELECT 'odoo_purchase_orders_dup_odoo_id',
  COUNT(*)::int FROM (
    SELECT odoo_order_id FROM odoo_purchase_orders WHERE odoo_order_id IS NOT NULL
    GROUP BY 1 HAVING COUNT(*) > 1
  ) s
UNION ALL
SELECT 'odoo_products_dup_product_id',
  COUNT(*)::int FROM (
    SELECT odoo_product_id FROM odoo_products WHERE odoo_product_id IS NOT NULL
    GROUP BY 1 HAVING COUNT(*) > 1
  ) s
UNION ALL
SELECT 'facts_dup_hash',
  COUNT(*)::int FROM (
    SELECT fact_hash FROM facts WHERE fact_hash IS NOT NULL
    GROUP BY 1 HAVING COUNT(*) > 1
  ) s
ORDER BY check;


\echo '════════════════════════════════════════════════════════════════'
\echo '4. COMPLETENESS (missing fields directors depend on)'
\echo '════════════════════════════════════════════════════════════════'

SELECT 'so_posted_no_salesperson'       AS check, COUNT(*)::int AS broken FROM odoo_sale_orders     WHERE state IN ('sale','done') AND salesperson_user_id IS NULL
UNION ALL SELECT 'po_posted_no_buyer',              COUNT(*)::int FROM odoo_purchase_orders WHERE state IN ('purchase','done') AND buyer_user_id IS NULL
UNION ALL SELECT 'products_no_internal_ref',        COUNT(*)::int FROM odoo_products        WHERE active = true AND (internal_ref IS NULL OR internal_ref = '')
UNION ALL SELECT 'out_invoices_missing_cfdi_uuid',  COUNT(*)::int FROM odoo_invoices        WHERE move_type='out_invoice' AND state='posted' AND cfdi_uuid IS NULL
UNION ALL SELECT 'companies_no_country',            COUNT(*)::int FROM companies            WHERE is_customer = true AND country IS NULL
UNION ALL SELECT 'customer_companies_no_rfc',       COUNT(*)::int FROM companies            WHERE is_customer = true AND rfc IS NULL
UNION ALL SELECT 'strategic_companies_no_contact',  COUNT(*)::int FROM company_profile      WHERE tier IN ('strategic','important') AND contact_count = 0
UNION ALL SELECT 'out_invoices_no_invoice_date',    COUNT(*)::int FROM odoo_invoices        WHERE move_type='out_invoice' AND state='posted' AND invoice_date IS NULL
UNION ALL SELECT 'out_invoices_no_due_date',        COUNT(*)::int FROM odoo_invoices        WHERE move_type='out_invoice' AND state='posted' AND due_date IS NULL
ORDER BY check;


\echo '════════════════════════════════════════════════════════════════'
\echo '5. TEMPORAL CONSISTENCY (impossible dates, logical order)'
\echo '════════════════════════════════════════════════════════════════'

SELECT 'invoices_due_before_issue' AS check, COUNT(*)::int AS broken
FROM odoo_invoices WHERE due_date IS NOT NULL AND invoice_date IS NOT NULL AND due_date < invoice_date
UNION ALL SELECT 'invoices_future_dated',
  COUNT(*)::int FROM odoo_invoices WHERE invoice_date > CURRENT_DATE + INTERVAL '1 day'
UNION ALL SELECT 'sale_orders_future_dated',
  COUNT(*)::int FROM odoo_sale_orders WHERE date_order > NOW() + INTERVAL '1 day'
UNION ALL SELECT 'mrp_finished_before_start',
  COUNT(*)::int FROM odoo_manufacturing WHERE date_start IS NOT NULL AND date_finished IS NOT NULL AND date_finished < date_start
UNION ALL SELECT 'deliveries_done_before_create',
  COUNT(*)::int FROM odoo_deliveries WHERE create_date IS NOT NULL AND date_done IS NOT NULL AND date_done < create_date
UNION ALL SELECT 'deliveries_future_scheduled_year_plus',
  COUNT(*)::int FROM odoo_deliveries WHERE scheduled_date > NOW() + INTERVAL '365 days'
UNION ALL SELECT 'overdue_flag_inconsistent',
  COUNT(*)::int FROM odoo_invoices
  WHERE days_overdue > 0 AND (due_date IS NULL OR due_date >= CURRENT_DATE)
    AND payment_state IN ('not_paid','partial')
UNION ALL SELECT 'activities_overdue_flag_wrong',
  COUNT(*)::int FROM odoo_activities
  WHERE is_overdue = true AND (date_deadline IS NULL OR date_deadline >= CURRENT_DATE)
ORDER BY check;


\echo '════════════════════════════════════════════════════════════════'
\echo '6. DOMAIN LOGIC (enum validity, range sanity)'
\echo '════════════════════════════════════════════════════════════════'

SELECT 'invoices_invalid_move_type' AS check, COUNT(*)::int AS broken
FROM odoo_invoices WHERE move_type IS NOT NULL AND move_type NOT IN ('out_invoice','out_refund','in_invoice','in_refund','entry','out_receipt','in_receipt')
UNION ALL SELECT 'invoices_invalid_payment_state',
  COUNT(*)::int FROM odoo_invoices WHERE payment_state IS NOT NULL AND payment_state NOT IN ('not_paid','partial','paid','in_payment','reversed','invoicing_legacy','blocked')
UNION ALL SELECT 'sale_orders_invalid_state',
  COUNT(*)::int FROM odoo_sale_orders WHERE state IS NOT NULL AND state NOT IN ('draft','sent','sale','done','cancel')
UNION ALL SELECT 'mrp_invalid_state',
  COUNT(*)::int FROM odoo_manufacturing WHERE state IS NOT NULL AND state NOT IN ('draft','confirmed','progress','to_close','done','cancel')
UNION ALL SELECT 'mrp_qty_produced_over_110pct_planned',
  COUNT(*)::int FROM odoo_manufacturing WHERE state='done' AND qty_planned > 0 AND qty_produced > qty_planned * 1.10
UNION ALL SELECT 'health_scores_out_of_range',
  COUNT(*)::int FROM health_scores WHERE overall_score < 0 OR overall_score > 100
UNION ALL SELECT 'insight_confidence_out_of_range',
  COUNT(*)::int FROM agent_insights WHERE confidence IS NOT NULL AND (confidence < 0 OR confidence > 1)
UNION ALL SELECT 'insight_invalid_severity',
  COUNT(*)::int FROM agent_insights WHERE severity IS NOT NULL AND severity NOT IN ('medium','high','critical')
UNION ALL SELECT 'insight_invalid_category',
  COUNT(*)::int FROM agent_insights WHERE category IS NOT NULL AND category NOT IN ('cobranza','ventas','entregas','operaciones','proveedores','riesgo','equipo','datos')
UNION ALL SELECT 'insight_invalid_state',
  COUNT(*)::int FROM agent_insights WHERE state IS NOT NULL AND state NOT IN ('new','seen','acted_on','dismissed','expired','archived')
ORDER BY check;


\echo '════════════════════════════════════════════════════════════════'
\echo '7. DIRECTORS / AGENTS (runs, insights, memory)'
\echo '════════════════════════════════════════════════════════════════'

SELECT 'agent_runs_stuck_running' AS check, COUNT(*)::int AS broken
FROM agent_runs WHERE status='running' AND started_at < NOW() - INTERVAL '15 minutes'
UNION ALL SELECT 'agent_runs_completed_no_end_time',
  COUNT(*)::int FROM agent_runs WHERE status='completed' AND completed_at IS NULL
UNION ALL SELECT 'agent_runs_failed_no_error',
  COUNT(*)::int FROM agent_runs WHERE status='failed' AND (error_message IS NULL OR error_message = '')
UNION ALL SELECT 'insights_no_agent_id',
  COUNT(*)::int FROM agent_insights WHERE agent_id IS NULL
UNION ALL SELECT 'insights_dangling_agent_fk',
  COUNT(*)::int FROM agent_insights i LEFT JOIN ai_agents a ON a.id = i.agent_id WHERE i.agent_id IS NOT NULL AND a.id IS NULL
UNION ALL SELECT 'insights_expired_should_be_closed',
  COUNT(*)::int FROM agent_insights WHERE expires_at < NOW() AND state IN ('new','seen')
UNION ALL SELECT 'memory_dangling_agent_fk',
  COUNT(*)::int FROM agent_memory m LEFT JOIN ai_agents a ON a.id = m.agent_id WHERE m.agent_id IS NOT NULL AND a.id IS NULL
UNION ALL SELECT 'active_agents_never_ran_7d',
  COUNT(*)::int FROM ai_agents a WHERE a.is_active = true AND a.analysis_schedule != 'manual'
    AND NOT EXISTS (SELECT 1 FROM agent_runs r WHERE r.agent_id = a.id AND r.started_at > NOW() - INTERVAL '7 days')
ORDER BY check;


\echo '════════════════════════════════════════════════════════════════'
\echo '8. KNOWLEDGE GRAPH (facts, entities, relationships)'
\echo '════════════════════════════════════════════════════════════════'

SELECT 'facts_no_entity_id' AS check, COUNT(*)::int AS broken FROM facts WHERE entity_id IS NULL
UNION ALL SELECT 'facts_dangling_entity_fk',
  COUNT(*)::int FROM facts f LEFT JOIN entities e ON e.id = f.entity_id WHERE f.entity_id IS NOT NULL AND e.id IS NULL
UNION ALL SELECT 'facts_empty_text',
  COUNT(*)::int FROM facts WHERE fact_text IS NULL OR LENGTH(TRIM(fact_text)) < 5
UNION ALL SELECT 'facts_invalid_type',
  COUNT(*)::int FROM facts WHERE fact_type NOT IN ('commitment','complaint','request','price','change','information','statement','mentioned_with','follow_up','sells_to','buys_from','payment')
UNION ALL SELECT 'facts_information_type_leaked',
  COUNT(*)::int FROM facts WHERE fact_type = 'information' AND created_at > '2026-04-15 20:00:00'
UNION ALL SELECT 'entities_empty_canonical',
  COUNT(*)::int FROM entities WHERE canonical_name IS NULL OR canonical_name = ''
UNION ALL SELECT 'entities_uppercase_violated',
  COUNT(*)::int FROM entities WHERE canonical_name IS NOT NULL AND canonical_name <> LOWER(canonical_name)
UNION ALL SELECT 'entity_rels_invalid_type',
  COUNT(*)::int FROM entity_relationships WHERE relationship_type NOT IN ('works_at','buys_from','sells_to','supplies','mentioned_with')
UNION ALL SELECT 'facts_stale_information_still_queryable',
  COUNT(*)::int FROM facts WHERE fact_type = 'information' AND expired = false
ORDER BY check;


\echo '════════════════════════════════════════════════════════════════'
\echo '9. MATVIEWS & SYNC HEALTH'
\echo '════════════════════════════════════════════════════════════════'

-- 9.1 Sync freshness (one row per tracked table)
SELECT table_name, row_count, hours_ago::numeric(6,2) AS h_ago, status
FROM odoo_sync_freshness
WHERE status <> 'fresh';

-- 9.2 Matview row counts for sanity
SELECT c.relname AS matview, (SELECT n_live_tup FROM pg_stat_all_tables s WHERE s.relname = c.relname) AS rows
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname='public' AND c.relkind='m'
ORDER BY c.relname;

-- 9.3 Product real cost missing components (data quality cue)
SELECT 'product_real_cost_missing_components' AS check,
  COUNT(*) FILTER (WHERE has_missing_costs) AS with_missing,
  COUNT(*) AS total,
  ROUND(100.0 * COUNT(*) FILTER (WHERE has_missing_costs) / NULLIF(COUNT(*), 0), 1) AS pct_missing
FROM product_real_cost;


\echo '════════════════════════════════════════════════════════════════'
\echo '10. PRODUCTION_DELAYS VIEW (new — audit 2026-04-15)'
\echo '════════════════════════════════════════════════════════════════'

SELECT
  COUNT(*) AS total_rows,
  COUNT(*) FILTER (WHERE is_overdue) AS overdue,
  COUNT(*) FILTER (WHERE is_underproduced) AS underproduced,
  COUNT(*) FILTER (WHERE customer_name IS NOT NULL) AS with_customer_ctx,
  ROUND(100.0 * COUNT(*) FILTER (WHERE customer_name IS NOT NULL) / NULLIF(COUNT(*), 0), 1) AS pct_linked_to_customer
FROM production_delays;
