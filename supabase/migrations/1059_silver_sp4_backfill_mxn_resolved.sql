-- supabase/migrations/1059_silver_sp4_backfill_mxn_resolved.sql
--
-- Silver SP4 — Task 19: backfill canonical_invoices.amount_total_mxn_resolved
--                       + canonical_companies metrics refresh
-- Spec §11 SP4 (carryover from SP3); Plan Task 19 (GATED, user approved).
-- Chunked to avoid long locks. The row is already in prod — chunked UPDATE is pure DML on an existing table.

-- NOTE: the plan originally reserved file 1058; that number was consumed by the
-- SP4 issue_type constraint-widen migration discovered during Task 18.

-- ===== chunked UPDATE (6 chunks via md5 modulo) ======================
DO $$
DECLARE
  i integer;
  affected bigint;
  total bigint := 0;
BEGIN
  FOR i IN 0..5 LOOP
    UPDATE canonical_invoices
    SET amount_total_mxn_resolved = COALESCE(amount_total_mxn_sat,
                                             amount_total_mxn_odoo,
                                             amount_total_mxn_ops,
                                             amount_total_mxn_fiscal,
                                             0),
        updated_at = now()
    WHERE (amount_total_mxn_resolved IS NULL OR amount_total_mxn_resolved = 0)
      AND ('x' || substr(md5(canonical_id), 1, 2))::bit(8)::int % 6 = i;
    GET DIAGNOSTICS affected = ROW_COUNT;
    total := total + affected;
    RAISE NOTICE 'Chunk % updated % rows (cumulative %)', i, affected, total;
  END LOOP;
END;
$$;

-- ===== canonical_companies AR metrics (from issued invoices) ========
UPDATE canonical_companies cc
SET
  total_invoiced_odoo_mxn = agg.odoo_mxn,
  total_invoiced_sat_mxn  = agg.sat_mxn,
  lifetime_value_mxn      = agg.resolved_mxn,
  revenue_ytd_mxn         = agg.ytd_mxn,
  revenue_90d_mxn         = agg.last_90d_mxn,
  revenue_prior_90d_mxn   = agg.prior_90d_mxn,
  trend_pct = CASE WHEN agg.prior_90d_mxn > 0
                    THEN ROUND(100.0 * (agg.last_90d_mxn - agg.prior_90d_mxn) / agg.prior_90d_mxn, 2) END,
  invoices_count          = agg.invoices_count,
  last_invoice_date       = agg.last_invoice_date,
  total_receivable_mxn    = agg.ar_mxn,
  overdue_amount_mxn      = agg.overdue_mxn,
  overdue_count           = agg.overdue_count,
  max_days_overdue        = agg.max_overdue_days,
  updated_at              = now()
FROM (
  SELECT ci.receptor_canonical_company_id AS cc_id,
         SUM(ci.amount_total_mxn_odoo)                                              AS odoo_mxn,
         SUM(ci.amount_total_mxn_sat)                                               AS sat_mxn,
         SUM(ci.amount_total_mxn_resolved)                                          AS resolved_mxn,
         SUM(CASE WHEN ci.invoice_date >= date_trunc('year', CURRENT_DATE)
                   THEN ci.amount_total_mxn_resolved END)                           AS ytd_mxn,
         SUM(CASE WHEN ci.invoice_date >= CURRENT_DATE - interval '90 days'
                   THEN ci.amount_total_mxn_resolved END)                           AS last_90d_mxn,
         SUM(CASE WHEN ci.invoice_date >= CURRENT_DATE - interval '180 days'
                    AND ci.invoice_date <  CURRENT_DATE - interval '90 days'
                   THEN ci.amount_total_mxn_resolved END)                           AS prior_90d_mxn,
         COUNT(*)                                                                    AS invoices_count,
         MAX(ci.invoice_date)                                                        AS last_invoice_date,
         SUM(ci.amount_residual_mxn_resolved)                                        AS ar_mxn,
         SUM(CASE WHEN ci.due_date_resolved < CURRENT_DATE
                    AND ci.amount_residual_mxn_resolved > 0
                   THEN ci.amount_residual_mxn_resolved END)                        AS overdue_mxn,
         COUNT(*) FILTER (WHERE ci.due_date_resolved < CURRENT_DATE
                            AND ci.amount_residual_mxn_resolved > 0)                AS overdue_count,
         MAX(CASE WHEN ci.due_date_resolved < CURRENT_DATE
                   THEN (CURRENT_DATE - ci.due_date_resolved) END)                   AS max_overdue_days
  FROM canonical_invoices ci
  WHERE ci.direction='issued'
    AND ci.receptor_canonical_company_id IS NOT NULL
  GROUP BY 1
) agg
WHERE cc.id = agg.cc_id;

-- ===== canonical_companies AP pass (supplier side) ==================
UPDATE canonical_companies cc
SET total_payable_mxn = agg.ap_mxn,
    total_pending_mxn = COALESCE(cc.total_receivable_mxn, 0) + COALESCE(agg.ap_mxn, 0),
    updated_at        = now()
FROM (
  SELECT ci.emisor_canonical_company_id AS cc_id,
         SUM(ci.amount_residual_mxn_resolved) AS ap_mxn
  FROM canonical_invoices ci
  WHERE ci.direction='received'
    AND ci.emisor_canonical_company_id IS NOT NULL
  GROUP BY 1
) agg
WHERE cc.id = agg.cc_id;

-- ===== Audit snapshot + schema_changes ==============================
INSERT INTO audit_runs (run_id, source, model, invariant_key, bucket_key, severity, details)
SELECT gen_random_uuid(), 'supabase', 'silver_sp4', 'sp4.backfill', 'sp4_task_19', 'ok',
       jsonb_build_object(
         'label', 'task_19_backfill_mxn_resolved',
         'resolved_after',
           (SELECT COUNT(*) FROM canonical_invoices
              WHERE amount_total_mxn_resolved IS NOT NULL AND amount_total_mxn_resolved > 0),
         'companies_with_ltv',
           (SELECT COUNT(*) FROM canonical_companies WHERE lifetime_value_mxn > 0),
         'top5_companies_ltv',
           (SELECT jsonb_agg(row_to_json(x))
              FROM (SELECT display_name, lifetime_value_mxn
                      FROM canonical_companies
                      WHERE is_customer=true
                      ORDER BY lifetime_value_mxn DESC NULLS LAST LIMIT 5) x)
       );

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
SELECT 'BACKFILL', 'canonical_invoices',
       'amount_total_mxn_resolved chunked backfill + canonical_companies metrics refresh',
       'supabase/migrations/1059_silver_sp4_backfill_mxn_resolved.sql',
       'silver-sp4-task-19', true
WHERE NOT EXISTS (SELECT 1 FROM schema_changes WHERE triggered_by = 'silver-sp4-task-19');
