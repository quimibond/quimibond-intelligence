-- 2026-04-24 — Fix LTV inflation: sin-IVA convention + cancel filter + hourly refresh.
--
-- Problem (discovered during Contitech audit 2026-04-23):
--   canonical_companies.lifetime_value_mxn used SUM(amount_total_mxn_resolved), which:
--     * was CON IVA (Syntage dashboard shows sin IVA)
--     * did NOT filter estado_sat='cancelado' → Contitech had $31M of cancelled CFDIs summed
--     * was a one-shot backfill from SP3/SP4 migrations, never refreshed
--   Contitech stored $620M vs Syntage $490.7M = 27% inflation.
--   Universe-wide: $2.16B stored vs $1.66B correct = 13% over-reporting.
--
-- Fix:
--   1. New reusable function refresh_canonical_company_financials(p_id) that recomputes
--      all financial aggregates with the correct formula.
--   2. LTV / revenue / total_invoiced_* switched to sin-IVA:
--        SUM(COALESCE(amount_untaxed_sat * tipo_cambio_sat, odoo_invoices.amount_untaxed_mxn))
--      AR/AP residuals stay CON IVA (that's what you actually collect/pay).
--   3. Cancel filter: estado_sat NOT IN ('cancelado','c') AND state_odoo <> 'cancel'.
--   4. Credit notes use same sin-IVA convention via bronze JOIN
--      (canonical_credit_notes has no amount_untaxed column).
--   5. Hourly cron at :45 to keep values fresh.
--
-- Verification (Contitech id=1448):
--   lifetime_value_mxn   = $491,998,690 (COALESCE; $1.27M over pure Syntage $490.7M
--                          due to 3 Odoo-only invoices without SAT UUID)
--   total_invoiced_sat_mxn = $490,726,118 (matches Syntage exactly)
--   total_credit_notes_mxn = $13,843,481  (was stale $4.2M)

CREATE OR REPLACE FUNCTION public.refresh_canonical_company_financials(p_id bigint DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_updated integer;
BEGIN
  SET LOCAL statement_timeout = '10min';

  -- AR: customers (receptor). sin IVA via amount_untaxed_sat * tipo_cambio_sat,
  -- fallback to odoo_invoices.amount_untaxed_mxn (already in MXN) for Odoo-only rows.
  WITH agg AS (
    SELECT ci.receptor_canonical_company_id AS cc_id,
           SUM(COALESCE(ci.amount_untaxed_sat * ci.tipo_cambio_sat, oi.amount_untaxed_mxn)) AS ltv_mxn,
           SUM(oi.amount_untaxed_mxn)                                                        AS odoo_mxn,
           SUM(ci.amount_untaxed_sat * ci.tipo_cambio_sat)                                   AS sat_mxn,
           SUM(CASE WHEN ci.invoice_date_resolved >= date_trunc('year', CURRENT_DATE)
                     THEN COALESCE(ci.amount_untaxed_sat * ci.tipo_cambio_sat, oi.amount_untaxed_mxn) END) AS ytd_mxn,
           SUM(CASE WHEN ci.invoice_date_resolved >= CURRENT_DATE - interval '90 days'
                     THEN COALESCE(ci.amount_untaxed_sat * ci.tipo_cambio_sat, oi.amount_untaxed_mxn) END) AS last_90d_mxn,
           SUM(CASE WHEN ci.invoice_date_resolved >= CURRENT_DATE - interval '180 days'
                      AND ci.invoice_date_resolved <  CURRENT_DATE - interval '90 days'
                     THEN COALESCE(ci.amount_untaxed_sat * ci.tipo_cambio_sat, oi.amount_untaxed_mxn) END) AS prior_90d_mxn,
           COUNT(*)                                                                          AS invoices_count,
           MAX(ci.invoice_date_resolved)                                                     AS last_invoice_date,
           SUM(ci.amount_residual_mxn_resolved)                                              AS ar_mxn,
           SUM(CASE WHEN ci.due_date_resolved < CURRENT_DATE
                      AND ci.amount_residual_mxn_resolved > 0
                     THEN ci.amount_residual_mxn_resolved END)                               AS overdue_mxn,
           COUNT(*) FILTER (WHERE ci.due_date_resolved < CURRENT_DATE
                              AND ci.amount_residual_mxn_resolved > 0)                      AS overdue_count,
           MAX(CASE WHEN ci.due_date_resolved < CURRENT_DATE
                     THEN (CURRENT_DATE - ci.due_date_resolved) END)                         AS max_overdue_days
    FROM canonical_invoices ci
    LEFT JOIN odoo_invoices oi ON oi.id = ci.odoo_invoice_id
    WHERE ci.direction='issued'
      AND ci.receptor_canonical_company_id IS NOT NULL
      AND LOWER(COALESCE(ci.estado_sat,'vigente')) NOT IN ('cancelado','c')
      AND COALESCE(ci.state_odoo,'posted') <> 'cancel'
      AND (p_id IS NULL OR ci.receptor_canonical_company_id = p_id)
    GROUP BY 1
  )
  UPDATE canonical_companies cc
  SET lifetime_value_mxn      = COALESCE(agg.ltv_mxn, 0),
      total_invoiced_odoo_mxn = COALESCE(agg.odoo_mxn, 0),
      total_invoiced_sat_mxn  = COALESCE(agg.sat_mxn, 0),
      revenue_ytd_mxn         = COALESCE(agg.ytd_mxn, 0),
      revenue_90d_mxn         = COALESCE(agg.last_90d_mxn, 0),
      revenue_prior_90d_mxn   = COALESCE(agg.prior_90d_mxn, 0),
      trend_pct = CASE WHEN agg.prior_90d_mxn > 0
                        THEN ROUND(100.0 * (agg.last_90d_mxn - agg.prior_90d_mxn) / agg.prior_90d_mxn, 2) END,
      invoices_count          = COALESCE(agg.invoices_count, 0),
      last_invoice_date       = agg.last_invoice_date,
      total_receivable_mxn    = COALESCE(agg.ar_mxn, 0),
      overdue_amount_mxn      = COALESCE(agg.overdue_mxn, 0),
      overdue_count           = COALESCE(agg.overdue_count, 0),
      max_days_overdue        = agg.max_overdue_days,
      updated_at              = now()
  FROM agg WHERE cc.id = agg.cc_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  -- Zero-out companies that no longer have qualifying invoices (only cancelled left).
  UPDATE canonical_companies cc
  SET lifetime_value_mxn=0, total_invoiced_odoo_mxn=0, total_invoiced_sat_mxn=0,
      revenue_ytd_mxn=0, revenue_90d_mxn=0, revenue_prior_90d_mxn=0, trend_pct=NULL,
      invoices_count=0, last_invoice_date=NULL,
      total_receivable_mxn=0, overdue_amount_mxn=0, overdue_count=0, max_days_overdue=NULL,
      updated_at=now()
  WHERE (p_id IS NULL OR cc.id = p_id)
    AND cc.lifetime_value_mxn > 0
    AND NOT EXISTS (
      SELECT 1 FROM canonical_invoices ci
      WHERE ci.direction='issued'
        AND ci.receptor_canonical_company_id = cc.id
        AND LOWER(COALESCE(ci.estado_sat,'vigente')) NOT IN ('cancelado','c')
        AND COALESCE(ci.state_odoo,'posted') <> 'cancel'
    );

  -- Credit notes (sin IVA) — canonical_credit_notes has no untaxed column, join bronze.
  WITH cn_agg AS (
    SELECT ccn.receptor_canonical_company_id AS cc_id,
           SUM(COALESCE(si.subtotal * si.tipo_cambio, oi.amount_untaxed_mxn)) AS cn_sin_iva_mxn
    FROM canonical_credit_notes ccn
    LEFT JOIN syntage_invoices si ON si.uuid = ccn.sat_uuid
    LEFT JOIN odoo_invoices    oi ON oi.id   = ccn.odoo_invoice_id
    WHERE ccn.direction='issued'
      AND ccn.receptor_canonical_company_id IS NOT NULL
      AND LOWER(COALESCE(ccn.estado_sat,'vigente')) NOT IN ('cancelado','c')
      AND COALESCE(ccn.state_odoo,'posted') <> 'cancel'
      AND (p_id IS NULL OR ccn.receptor_canonical_company_id = p_id)
    GROUP BY 1
  )
  UPDATE canonical_companies cc
  SET total_credit_notes_mxn = COALESCE(cn_agg.cn_sin_iva_mxn, 0),
      updated_at = now()
  FROM cn_agg WHERE cc.id = cn_agg.cc_id;

  UPDATE canonical_companies cc
  SET total_credit_notes_mxn = 0, updated_at = now()
  WHERE (p_id IS NULL OR cc.id = p_id)
    AND cc.total_credit_notes_mxn > 0
    AND NOT EXISTS (
      SELECT 1 FROM canonical_credit_notes ccn
      WHERE ccn.direction='issued'
        AND ccn.receptor_canonical_company_id = cc.id
        AND LOWER(COALESCE(ccn.estado_sat,'vigente')) NOT IN ('cancelado','c')
        AND COALESCE(ccn.state_odoo,'posted') <> 'cancel'
    );

  -- AP: suppliers (emisor). Keep con-IVA (residual = actual cash owed).
  WITH ap_agg AS (
    SELECT ci.emisor_canonical_company_id AS cc_id,
           SUM(ci.amount_residual_mxn_resolved) AS ap_mxn
    FROM canonical_invoices ci
    WHERE ci.direction='received'
      AND ci.emisor_canonical_company_id IS NOT NULL
      AND LOWER(COALESCE(ci.estado_sat,'vigente')) NOT IN ('cancelado','c')
      AND COALESCE(ci.state_odoo,'posted') <> 'cancel'
      AND (p_id IS NULL OR ci.emisor_canonical_company_id = p_id)
    GROUP BY 1
  )
  UPDATE canonical_companies cc
  SET total_payable_mxn = COALESCE(ap_agg.ap_mxn, 0),
      total_pending_mxn = COALESCE(cc.total_receivable_mxn, 0) + COALESCE(ap_agg.ap_mxn, 0),
      updated_at        = now()
  FROM ap_agg WHERE cc.id = ap_agg.cc_id;

  RETURN v_updated;
END;
$fn$;

-- Full backfill
SELECT public.refresh_canonical_company_financials(NULL);

-- Hourly refresh
SELECT cron.schedule(
  'refresh_canonical_company_financials_hourly',
  '45 * * * *',
  $body$ SELECT public.refresh_canonical_company_financials(NULL); $body$
);

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('refactor','canonical_companies',
        'LTV + revenue + CN switched to sin-IVA (amount_untaxed * tipo_cambio). Cancel filter (SAT+Odoo). AR/AP stays con-IVA. Hourly refresh cron :45.',
        '20260424_ltv_sin_iva_writer.sql','audit-contitech-2026-04-23', true);
