-- 2026-04-24 — Parallel drift_ap_* columns for direction='received' (supplier / AP side).
--
-- Per-year match rates for AP (stats at migration time):
--   2022:  34.83% matched  (1,354 / 3,887)
--   2023:  54.74%          (2,106 / 3,847)
--   2024:  65.36%          (2,760 / 4,223)
--   2025:  82.07%          (3,511 / 4,278)   ← scope threshold
--   2026:  70.71% YTD      (939 / 1,328)
--
-- Why scope 2025+ instead of 2022+ (unlike AR):
-- Pre-2025 match rates are too low to make drift aggregates actionable. Using 2022+ would
-- flag ~95% of suppliers and drown signal. Memory `project_purchase_invoice_uuid_history`
-- confirms Odoo historically didn't store in_invoice/in_refund CFDI UUIDs reliably.
--
-- drift_ap_needs_review threshold: $5,000 (higher than AR's $1,000) because AP has more
-- legitimate noise: foreign suppliers (CN/TH/DE/SG) without CFDI, IMSS/SAT/INFONAVIT
-- government CFDIs not posted as invoices in Odoo, nómina, etc.
--
-- Universe 2025+ drift: ~$235M across 117 suppliers flagged. Top offenders:
--   BANCA MIFEL              $109.5M  (198 CFDIs SAT sin Odoo — bank comisiones/intereses)
--   MASARI CASA DE BOLSA     $48.2M   (97 CFDIs — operaciones financieras)
--   ICOMATEX                 $10.8M   (2 Odoo sin CFDI)
--   SAT                      $7.9M    (126 CFDIs gobierno)
--   IMSS                     $7.0M    (31 CFDIs seguridad social)

ALTER TABLE canonical_companies
  ADD COLUMN IF NOT EXISTS drift_ap_sat_only_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS drift_ap_sat_only_mxn numeric(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS drift_ap_odoo_only_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS drift_ap_odoo_only_mxn numeric(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS drift_ap_matched_diff_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS drift_ap_matched_abs_mxn numeric(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS drift_ap_total_abs_mxn numeric(14,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS drift_ap_needs_review boolean DEFAULT false;

COMMENT ON COLUMN canonical_companies.drift_ap_sat_only_mxn IS 'SAT vigente sin match Odoo (received), sin IVA MXN, 2025+';
COMMENT ON COLUMN canonical_companies.drift_ap_odoo_only_mxn IS 'Odoo posted sin CFDI SAT (received), sin IVA MXN, 2025+. Incluye proveedores extranjeros que no emiten CFDI.';
COMMENT ON COLUMN canonical_companies.drift_ap_total_abs_mxn IS 'Sum of ap_sat_only + ap_odoo_only + ap_matched_abs (2025+)';
COMMENT ON COLUMN canonical_companies.drift_ap_needs_review IS 'true si drift_ap_total_abs_mxn > $5,000';

CREATE OR REPLACE FUNCTION public.refresh_canonical_company_financials(p_id bigint DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_updated integer;
BEGIN
  SET LOCAL statement_timeout = '10min';

  -- AR (sin IVA)
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

  -- Credit notes sin IVA
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

  -- AP (con IVA residual)
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

  -- AR drift (2022+, receptor side)
  WITH drift_base AS (
    SELECT ci.receptor_canonical_company_id AS cc_id,
           ci.has_odoo_record, ci.has_sat_record,
           (ci.amount_untaxed_sat * ci.tipo_cambio_sat) AS sat_mxn,
           oi.amount_untaxed_mxn AS odoo_mxn
    FROM canonical_invoices ci
    LEFT JOIN odoo_invoices oi ON oi.id = ci.odoo_invoice_id
    WHERE ci.direction='issued'
      AND ci.receptor_canonical_company_id IS NOT NULL
      AND ci.invoice_date_resolved >= '2022-01-01'
      AND LOWER(COALESCE(ci.estado_sat,'vigente')) NOT IN ('cancelado','c')
      AND COALESCE(ci.state_odoo,'posted') <> 'cancel'
      AND (p_id IS NULL OR ci.receptor_canonical_company_id = p_id)
  ),
  drift_agg AS (
    SELECT cc_id,
           COUNT(*) FILTER (WHERE has_odoo_record AND NOT has_sat_record) AS odoo_only_count,
           COUNT(*) FILTER (WHERE NOT has_odoo_record AND has_sat_record) AS sat_only_count,
           COUNT(*) FILTER (WHERE has_odoo_record AND has_sat_record
                              AND ABS(COALESCE(sat_mxn,0) - COALESCE(odoo_mxn,0)) > 1) AS matched_diff_count,
           SUM(odoo_mxn) FILTER (WHERE has_odoo_record AND NOT has_sat_record) AS odoo_only_mxn,
           SUM(sat_mxn)  FILTER (WHERE NOT has_odoo_record AND has_sat_record) AS sat_only_mxn,
           SUM(ABS(COALESCE(sat_mxn,0) - COALESCE(odoo_mxn,0)))
               FILTER (WHERE has_odoo_record AND has_sat_record) AS matched_abs_mxn
    FROM drift_base GROUP BY 1
  )
  UPDATE canonical_companies cc
  SET drift_sat_only_count   = COALESCE(d.sat_only_count, 0),
      drift_sat_only_mxn     = COALESCE(d.sat_only_mxn, 0),
      drift_odoo_only_count  = COALESCE(d.odoo_only_count, 0),
      drift_odoo_only_mxn    = COALESCE(d.odoo_only_mxn, 0),
      drift_matched_diff_count = COALESCE(d.matched_diff_count, 0),
      drift_matched_abs_mxn  = COALESCE(d.matched_abs_mxn, 0),
      drift_total_abs_mxn    = COALESCE(d.sat_only_mxn,0) + COALESCE(d.odoo_only_mxn,0) + COALESCE(d.matched_abs_mxn,0),
      drift_needs_review     = (COALESCE(d.sat_only_mxn,0) + COALESCE(d.odoo_only_mxn,0) + COALESCE(d.matched_abs_mxn,0)) > 1000,
      drift_last_computed_at = now(),
      updated_at             = now()
  FROM drift_agg d WHERE cc.id = d.cc_id;

  UPDATE canonical_companies cc
  SET drift_sat_only_count=0, drift_sat_only_mxn=0,
      drift_odoo_only_count=0, drift_odoo_only_mxn=0,
      drift_matched_diff_count=0, drift_matched_abs_mxn=0,
      drift_total_abs_mxn=0, drift_needs_review=false,
      drift_last_computed_at=now()
  WHERE (p_id IS NULL OR cc.id = p_id)
    AND (cc.drift_total_abs_mxn > 0 OR cc.drift_needs_review IS TRUE)
    AND NOT EXISTS (
      SELECT 1 FROM canonical_invoices ci
      WHERE ci.direction='issued'
        AND ci.receptor_canonical_company_id = cc.id
        AND ci.invoice_date_resolved >= '2022-01-01'
        AND LOWER(COALESCE(ci.estado_sat,'vigente')) NOT IN ('cancelado','c')
        AND COALESCE(ci.state_odoo,'posted') <> 'cancel'
        AND ((ci.has_odoo_record AND NOT ci.has_sat_record)
          OR (NOT ci.has_odoo_record AND ci.has_sat_record)
          OR (ci.has_odoo_record AND ci.has_sat_record
              AND ABS(COALESCE(ci.amount_untaxed_sat * ci.tipo_cambio_sat, 0) - COALESCE((
                SELECT amount_untaxed_mxn FROM odoo_invoices WHERE id = ci.odoo_invoice_id), 0)) > 1))
    );

  -- AP drift (2025+, emisor side)
  WITH drift_ap_base AS (
    SELECT ci.emisor_canonical_company_id AS cc_id,
           ci.has_odoo_record, ci.has_sat_record,
           (ci.amount_untaxed_sat * ci.tipo_cambio_sat) AS sat_mxn,
           oi.amount_untaxed_mxn AS odoo_mxn
    FROM canonical_invoices ci
    LEFT JOIN odoo_invoices oi ON oi.id = ci.odoo_invoice_id
    WHERE ci.direction='received'
      AND ci.emisor_canonical_company_id IS NOT NULL
      AND ci.invoice_date_resolved >= '2025-01-01'
      AND LOWER(COALESCE(ci.estado_sat,'vigente')) NOT IN ('cancelado','c')
      AND COALESCE(ci.state_odoo,'posted') <> 'cancel'
      AND (p_id IS NULL OR ci.emisor_canonical_company_id = p_id)
  ),
  drift_ap_agg AS (
    SELECT cc_id,
           COUNT(*) FILTER (WHERE has_odoo_record AND NOT has_sat_record) AS odoo_only_count,
           COUNT(*) FILTER (WHERE NOT has_odoo_record AND has_sat_record) AS sat_only_count,
           COUNT(*) FILTER (WHERE has_odoo_record AND has_sat_record
                              AND ABS(COALESCE(sat_mxn,0) - COALESCE(odoo_mxn,0)) > 1) AS matched_diff_count,
           SUM(odoo_mxn) FILTER (WHERE has_odoo_record AND NOT has_sat_record) AS odoo_only_mxn,
           SUM(sat_mxn)  FILTER (WHERE NOT has_odoo_record AND has_sat_record) AS sat_only_mxn,
           SUM(ABS(COALESCE(sat_mxn,0) - COALESCE(odoo_mxn,0)))
               FILTER (WHERE has_odoo_record AND has_sat_record) AS matched_abs_mxn
    FROM drift_ap_base GROUP BY 1
  )
  UPDATE canonical_companies cc
  SET drift_ap_sat_only_count    = COALESCE(d.sat_only_count, 0),
      drift_ap_sat_only_mxn      = COALESCE(d.sat_only_mxn, 0),
      drift_ap_odoo_only_count   = COALESCE(d.odoo_only_count, 0),
      drift_ap_odoo_only_mxn     = COALESCE(d.odoo_only_mxn, 0),
      drift_ap_matched_diff_count= COALESCE(d.matched_diff_count, 0),
      drift_ap_matched_abs_mxn   = COALESCE(d.matched_abs_mxn, 0),
      drift_ap_total_abs_mxn     = COALESCE(d.sat_only_mxn,0) + COALESCE(d.odoo_only_mxn,0) + COALESCE(d.matched_abs_mxn,0),
      drift_ap_needs_review      = (COALESCE(d.sat_only_mxn,0) + COALESCE(d.odoo_only_mxn,0) + COALESCE(d.matched_abs_mxn,0)) > 5000,
      updated_at                 = now()
  FROM drift_ap_agg d WHERE cc.id = d.cc_id;

  UPDATE canonical_companies cc
  SET drift_ap_sat_only_count=0, drift_ap_sat_only_mxn=0,
      drift_ap_odoo_only_count=0, drift_ap_odoo_only_mxn=0,
      drift_ap_matched_diff_count=0, drift_ap_matched_abs_mxn=0,
      drift_ap_total_abs_mxn=0, drift_ap_needs_review=false
  WHERE (p_id IS NULL OR cc.id = p_id)
    AND (cc.drift_ap_total_abs_mxn > 0 OR cc.drift_ap_needs_review IS TRUE)
    AND NOT EXISTS (
      SELECT 1 FROM canonical_invoices ci
      WHERE ci.direction='received'
        AND ci.emisor_canonical_company_id = cc.id
        AND ci.invoice_date_resolved >= '2025-01-01'
        AND LOWER(COALESCE(ci.estado_sat,'vigente')) NOT IN ('cancelado','c')
        AND COALESCE(ci.state_odoo,'posted') <> 'cancel'
        AND ((ci.has_odoo_record AND NOT ci.has_sat_record)
          OR (NOT ci.has_odoo_record AND ci.has_sat_record)
          OR (ci.has_odoo_record AND ci.has_sat_record
              AND ABS(COALESCE(ci.amount_untaxed_sat * ci.tipo_cambio_sat, 0) - COALESCE((
                SELECT amount_untaxed_mxn FROM odoo_invoices WHERE id = ci.odoo_invoice_id), 0)) > 1))
    );

  RETURN v_updated;
END;
$fn$;

DROP VIEW IF EXISTS gold_company_odoo_sat_drift;
CREATE VIEW gold_company_odoo_sat_drift AS
WITH drift_lines AS (
  -- AR (customer side, 2022+)
  SELECT 'customer'::text AS side,
         ci.receptor_canonical_company_id AS cc_id,
         ci.canonical_id, ci.sat_uuid, ci.odoo_invoice_id, ci.odoo_name,
         ci.invoice_date_resolved AS invoice_date,
         ci.has_odoo_record, ci.has_sat_record,
         (ci.amount_untaxed_sat * ci.tipo_cambio_sat) AS sat_mxn,
         oi.amount_untaxed_mxn AS odoo_mxn,
         CASE
           WHEN ci.has_odoo_record AND NOT ci.has_sat_record THEN 'odoo_only'
           WHEN NOT ci.has_odoo_record AND ci.has_sat_record THEN 'sat_only'
           WHEN ABS(COALESCE(ci.amount_untaxed_sat * ci.tipo_cambio_sat,0) - COALESCE(oi.amount_untaxed_mxn,0)) > 1 THEN 'amount_mismatch'
           ELSE NULL
         END AS drift_kind,
         ABS(COALESCE(ci.amount_untaxed_sat * ci.tipo_cambio_sat,0) - COALESCE(oi.amount_untaxed_mxn,0)) AS diff_mxn
  FROM canonical_invoices ci
  LEFT JOIN odoo_invoices oi ON oi.id = ci.odoo_invoice_id
  WHERE ci.direction='issued'
    AND ci.receptor_canonical_company_id IS NOT NULL
    AND ci.invoice_date_resolved >= '2022-01-01'
    AND LOWER(COALESCE(ci.estado_sat,'vigente')) NOT IN ('cancelado','c')
    AND COALESCE(ci.state_odoo,'posted') <> 'cancel'

  UNION ALL

  -- AP (supplier side, 2025+)
  SELECT 'supplier'::text AS side,
         ci.emisor_canonical_company_id AS cc_id,
         ci.canonical_id, ci.sat_uuid, ci.odoo_invoice_id, ci.odoo_name,
         ci.invoice_date_resolved AS invoice_date,
         ci.has_odoo_record, ci.has_sat_record,
         (ci.amount_untaxed_sat * ci.tipo_cambio_sat) AS sat_mxn,
         oi.amount_untaxed_mxn AS odoo_mxn,
         CASE
           WHEN ci.has_odoo_record AND NOT ci.has_sat_record THEN 'odoo_only'
           WHEN NOT ci.has_odoo_record AND ci.has_sat_record THEN 'sat_only'
           WHEN ABS(COALESCE(ci.amount_untaxed_sat * ci.tipo_cambio_sat,0) - COALESCE(oi.amount_untaxed_mxn,0)) > 1 THEN 'amount_mismatch'
           ELSE NULL
         END AS drift_kind,
         ABS(COALESCE(ci.amount_untaxed_sat * ci.tipo_cambio_sat,0) - COALESCE(oi.amount_untaxed_mxn,0)) AS diff_mxn
  FROM canonical_invoices ci
  LEFT JOIN odoo_invoices oi ON oi.id = ci.odoo_invoice_id
  WHERE ci.direction='received'
    AND ci.emisor_canonical_company_id IS NOT NULL
    AND ci.invoice_date_resolved >= '2025-01-01'
    AND LOWER(COALESCE(ci.estado_sat,'vigente')) NOT IN ('cancelado','c')
    AND COALESCE(ci.state_odoo,'posted') <> 'cancel'
)
SELECT dl.side, cc.id AS canonical_company_id, cc.display_name,
       dl.canonical_id, dl.drift_kind,
       dl.invoice_date, dl.sat_uuid, dl.odoo_invoice_id, dl.odoo_name,
       dl.sat_mxn, dl.odoo_mxn, dl.diff_mxn
FROM drift_lines dl
JOIN canonical_companies cc ON cc.id = dl.cc_id
WHERE dl.drift_kind IS NOT NULL;

COMMENT ON VIEW gold_company_odoo_sat_drift IS 'Per-invoice Odoo↔SAT drift. side=customer (AR 2022+) | supplier (AP 2025+).';

SELECT public.refresh_canonical_company_financials(NULL);

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('ADD COLUMN','canonical_companies',
        'Added 8 drift_ap_* columns + extended gold_company_odoo_sat_drift view with side column. AP scope 2025+ (>80% match rate).',
        '20260424_odoo_sat_drift_ap_aggregates.sql','audit-contitech-2026-04-23', true);
