-- 2026-04-24 — Category flags to suppress false-positive drift_*_needs_review.
--
-- is_foreign: supplier with no Mexican RFC (NULL, empty, or XEXX010101000 genérico).
--             Cannot emit Mexican CFDI → Odoo-only is expected, not drift.
-- is_bank: commercial banks + casas de bolsa. CFDIs bancarios (comisiones, intereses,
--          estados de cuenta) go via journal entry, not in_invoice. Business decision
--          to document them that way — tagged as noise for drift purposes.
-- is_government: SAT, IMSS, INFONAVIT, gobiernos estatales. CFDIs de gobierno se
--                registran como pago de impuestos/cuotas, no invoice.
-- is_payroll_entity: counterparty used to dump nómina CFDIs en Odoo (e.g., "NOMINA"
--                    pseudo-partner). Tagged payroll distinct from regular suppliers.
--
-- Scope: purely flags + refresh logic tweak. Amount values stay populated (for audit),
--        only the needs_review booleans are suppressed.

ALTER TABLE canonical_companies
  ADD COLUMN IF NOT EXISTS is_foreign boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_bank boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_government boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_payroll_entity boolean DEFAULT false;

COMMENT ON COLUMN canonical_companies.is_foreign IS 'No Mexican RFC → cannot emit CFDI. Suppresses drift_ap_needs_review.';
COMMENT ON COLUMN canonical_companies.is_bank IS 'Banks / brokerage houses. CFDI bancario ≠ invoice. Suppresses drift flags.';
COMMENT ON COLUMN canonical_companies.is_government IS 'SAT/IMSS/INFONAVIT/etc. CFDI gobierno ≠ invoice. Suppresses drift flags.';
COMMENT ON COLUMN canonical_companies.is_payroll_entity IS 'Payroll pseudo-counterparty. Suppresses drift flags.';

-- Auto-populate is_foreign
UPDATE canonical_companies cc
SET is_foreign = true
WHERE (cc.rfc IS NULL OR TRIM(cc.rfc) = '' OR cc.rfc ILIKE 'XEXX%')
  AND NOT cc.is_internal;

-- Auto-populate is_bank (pattern + whitelist)
UPDATE canonical_companies cc
SET is_bank = true
WHERE (cc.display_name ILIKE '%BANCA%'
    OR cc.display_name ILIKE '%CASA DE BOLSA%'
    OR cc.display_name ILIKE '%BANCO %'
    OR cc.display_name ILIKE 'BANCO %'
    OR cc.display_name ILIKE '%HSBC%'
    OR cc.display_name ILIKE '%BANAMEX%'
    OR cc.display_name ILIKE '%BBVA%'
    OR cc.display_name ILIKE '%SANTANDER%'
    OR cc.display_name ILIKE '%SCOTIABANK%'
    OR cc.display_name ILIKE '%BANORTE%'
    OR cc.display_name ILIKE '%INBURSA%'
    OR cc.display_name ILIKE '%ACTINVER%'
    OR cc.display_name ILIKE '%MASARI%'
    OR cc.display_name ILIKE '%MIFEL%')
  AND NOT cc.is_internal;

-- Auto-populate is_government
UPDATE canonical_companies cc
SET is_government = true
WHERE (cc.display_name ILIKE 'SERVICIO DE ADMIN%'
    OR cc.display_name ILIKE 'INSTITUTO MEXICANO DEL SEGURO SOCIAL%'
    OR cc.display_name ILIKE '%Instituto del Fondo Nacional%'
    OR cc.display_name ILIKE 'INFONAVIT%'
    OR cc.display_name ILIKE '%Gobierno del Estado%'
    OR cc.display_name ILIKE '%SECRETARIA DE%'
    OR cc.display_name ILIKE '%COMISION FEDERAL DE ELECTRICIDAD%'
    OR cc.display_name ILIKE 'CFE %'
    OR cc.rfc IN ('SAT970701NN3','IMS421231I45','INF830502951'))
  AND NOT cc.is_internal;

-- Auto-populate is_payroll_entity
UPDATE canonical_companies cc
SET is_payroll_entity = true
WHERE UPPER(cc.display_name) = 'NOMINA'
   OR UPPER(cc.display_name) LIKE 'NOMINA %'
   OR UPPER(cc.display_name) LIKE '% NOMINA';

-- Tighten the needs_review predicates to exclude these categories.
-- We reuse the existing refresh function; just patch the two WHERE clauses.
CREATE OR REPLACE FUNCTION public.refresh_canonical_company_financials(p_id bigint DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public','pg_temp'
AS $fn$
DECLARE v_updated integer;
BEGIN
  SET LOCAL statement_timeout = '10min';

  -- [AR / LTV / CN / AP residual blocks preserved verbatim — see prior migration
  -- 20260424_odoo_sat_drift_ap_aggregates.sql for full definition. The only
  -- change below is in the two drift_*_needs_review assignments.]

  -- AR
  WITH agg AS (
    SELECT ci.receptor_canonical_company_id AS cc_id,
           SUM(COALESCE(ci.amount_untaxed_sat * ci.tipo_cambio_sat, oi.amount_untaxed_mxn)) AS ltv_mxn,
           SUM(oi.amount_untaxed_mxn) AS odoo_mxn,
           SUM(ci.amount_untaxed_sat * ci.tipo_cambio_sat) AS sat_mxn,
           SUM(CASE WHEN ci.invoice_date_resolved >= date_trunc('year', CURRENT_DATE)
                     THEN COALESCE(ci.amount_untaxed_sat * ci.tipo_cambio_sat, oi.amount_untaxed_mxn) END) AS ytd_mxn,
           SUM(CASE WHEN ci.invoice_date_resolved >= CURRENT_DATE - interval '90 days'
                     THEN COALESCE(ci.amount_untaxed_sat * ci.tipo_cambio_sat, oi.amount_untaxed_mxn) END) AS last_90d_mxn,
           SUM(CASE WHEN ci.invoice_date_resolved >= CURRENT_DATE - interval '180 days'
                      AND ci.invoice_date_resolved <  CURRENT_DATE - interval '90 days'
                     THEN COALESCE(ci.amount_untaxed_sat * ci.tipo_cambio_sat, oi.amount_untaxed_mxn) END) AS prior_90d_mxn,
           COUNT(*) AS invoices_count,
           MAX(ci.invoice_date_resolved) AS last_invoice_date,
           SUM(ci.amount_residual_mxn_resolved) AS ar_mxn,
           SUM(CASE WHEN ci.due_date_resolved < CURRENT_DATE AND ci.amount_residual_mxn_resolved > 0
                     THEN ci.amount_residual_mxn_resolved END) AS overdue_mxn,
           COUNT(*) FILTER (WHERE ci.due_date_resolved < CURRENT_DATE
                              AND ci.amount_residual_mxn_resolved > 0) AS overdue_count,
           MAX(CASE WHEN ci.due_date_resolved < CURRENT_DATE
                     THEN (CURRENT_DATE - ci.due_date_resolved) END) AS max_overdue_days
    FROM canonical_invoices ci
    LEFT JOIN odoo_invoices oi ON oi.id = ci.odoo_invoice_id
    WHERE ci.direction='issued' AND ci.receptor_canonical_company_id IS NOT NULL
      AND LOWER(COALESCE(ci.estado_sat,'vigente')) NOT IN ('cancelado','c')
      AND COALESCE(ci.state_odoo,'posted') <> 'cancel'
      AND (p_id IS NULL OR ci.receptor_canonical_company_id = p_id)
    GROUP BY 1
  )
  UPDATE canonical_companies cc
  SET lifetime_value_mxn=COALESCE(agg.ltv_mxn,0), total_invoiced_odoo_mxn=COALESCE(agg.odoo_mxn,0),
      total_invoiced_sat_mxn=COALESCE(agg.sat_mxn,0),
      revenue_ytd_mxn=COALESCE(agg.ytd_mxn,0), revenue_90d_mxn=COALESCE(agg.last_90d_mxn,0),
      revenue_prior_90d_mxn=COALESCE(agg.prior_90d_mxn,0),
      trend_pct = CASE WHEN agg.prior_90d_mxn > 0
                        THEN ROUND(100.0*(agg.last_90d_mxn-agg.prior_90d_mxn)/agg.prior_90d_mxn, 2) END,
      invoices_count=COALESCE(agg.invoices_count,0), last_invoice_date=agg.last_invoice_date,
      total_receivable_mxn=COALESCE(agg.ar_mxn,0), overdue_amount_mxn=COALESCE(agg.overdue_mxn,0),
      overdue_count=COALESCE(agg.overdue_count,0), max_days_overdue=agg.max_overdue_days,
      updated_at=now()
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
      WHERE ci.direction='issued' AND ci.receptor_canonical_company_id = cc.id
        AND LOWER(COALESCE(ci.estado_sat,'vigente')) NOT IN ('cancelado','c')
        AND COALESCE(ci.state_odoo,'posted') <> 'cancel'
    );

  -- CN sin IVA
  WITH cn_agg AS (
    SELECT ccn.receptor_canonical_company_id AS cc_id,
           SUM(COALESCE(si.subtotal * si.tipo_cambio, oi.amount_untaxed_mxn)) AS cn_sin_iva_mxn
    FROM canonical_credit_notes ccn
    LEFT JOIN syntage_invoices si ON si.uuid = ccn.sat_uuid
    LEFT JOIN odoo_invoices    oi ON oi.id   = ccn.odoo_invoice_id
    WHERE ccn.direction='issued' AND ccn.receptor_canonical_company_id IS NOT NULL
      AND LOWER(COALESCE(ccn.estado_sat,'vigente')) NOT IN ('cancelado','c')
      AND COALESCE(ccn.state_odoo,'posted') <> 'cancel'
      AND (p_id IS NULL OR ccn.receptor_canonical_company_id = p_id)
    GROUP BY 1
  )
  UPDATE canonical_companies cc
  SET total_credit_notes_mxn = COALESCE(cn_agg.cn_sin_iva_mxn, 0), updated_at = now()
  FROM cn_agg WHERE cc.id = cn_agg.cc_id;

  UPDATE canonical_companies cc
  SET total_credit_notes_mxn = 0, updated_at = now()
  WHERE (p_id IS NULL OR cc.id = p_id) AND cc.total_credit_notes_mxn > 0
    AND NOT EXISTS (
      SELECT 1 FROM canonical_credit_notes ccn
      WHERE ccn.direction='issued' AND ccn.receptor_canonical_company_id = cc.id
        AND LOWER(COALESCE(ccn.estado_sat,'vigente')) NOT IN ('cancelado','c')
        AND COALESCE(ccn.state_odoo,'posted') <> 'cancel'
    );

  -- AP residual con IVA
  WITH ap_agg AS (
    SELECT ci.emisor_canonical_company_id AS cc_id,
           SUM(ci.amount_residual_mxn_resolved) AS ap_mxn
    FROM canonical_invoices ci
    WHERE ci.direction='received' AND ci.emisor_canonical_company_id IS NOT NULL
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

  -- AR drift (2022+)
  WITH drift_base AS (
    SELECT ci.receptor_canonical_company_id AS cc_id,
           ci.has_odoo_record, ci.has_sat_record,
           (ci.amount_untaxed_sat * ci.tipo_cambio_sat) AS sat_mxn,
           oi.amount_untaxed_mxn AS odoo_mxn
    FROM canonical_invoices ci
    LEFT JOIN odoo_invoices oi ON oi.id = ci.odoo_invoice_id
    WHERE ci.direction='issued' AND ci.receptor_canonical_company_id IS NOT NULL
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
      -- PATCH: exclude categorized entities from needs_review
      drift_needs_review = (
        (COALESCE(d.sat_only_mxn,0) + COALESCE(d.odoo_only_mxn,0) + COALESCE(d.matched_abs_mxn,0)) > 1000
        AND NOT cc.is_foreign AND NOT cc.is_bank AND NOT cc.is_government AND NOT cc.is_payroll_entity
      ),
      drift_last_computed_at = now(),
      updated_at             = now()
  FROM drift_agg d WHERE cc.id = d.cc_id;

  -- AR drift zero-out
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
      WHERE ci.direction='issued' AND ci.receptor_canonical_company_id = cc.id
        AND ci.invoice_date_resolved >= '2022-01-01'
        AND LOWER(COALESCE(ci.estado_sat,'vigente')) NOT IN ('cancelado','c')
        AND COALESCE(ci.state_odoo,'posted') <> 'cancel'
        AND ((ci.has_odoo_record AND NOT ci.has_sat_record)
          OR (NOT ci.has_odoo_record AND ci.has_sat_record)
          OR (ci.has_odoo_record AND ci.has_sat_record
              AND ABS(COALESCE(ci.amount_untaxed_sat * ci.tipo_cambio_sat, 0) - COALESCE((
                SELECT amount_untaxed_mxn FROM odoo_invoices WHERE id = ci.odoo_invoice_id), 0)) > 1))
    );

  -- AP drift (2025+)
  WITH drift_ap_base AS (
    SELECT ci.emisor_canonical_company_id AS cc_id,
           ci.has_odoo_record, ci.has_sat_record,
           (ci.amount_untaxed_sat * ci.tipo_cambio_sat) AS sat_mxn,
           oi.amount_untaxed_mxn AS odoo_mxn
    FROM canonical_invoices ci
    LEFT JOIN odoo_invoices oi ON oi.id = ci.odoo_invoice_id
    WHERE ci.direction='received' AND ci.emisor_canonical_company_id IS NOT NULL
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
      -- PATCH: exclude categorized entities from needs_review
      drift_ap_needs_review = (
        (COALESCE(d.sat_only_mxn,0) + COALESCE(d.odoo_only_mxn,0) + COALESCE(d.matched_abs_mxn,0)) > 5000
        AND NOT cc.is_foreign AND NOT cc.is_bank AND NOT cc.is_government AND NOT cc.is_payroll_entity
      ),
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
      WHERE ci.direction='received' AND ci.emisor_canonical_company_id = cc.id
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

-- Trigger full refresh to apply category suppression
SELECT public.refresh_canonical_company_financials(NULL);

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('ADD COLUMN','canonical_companies',
        'Added is_foreign/is_bank/is_government/is_payroll_entity flags. Drift needs_review suppresses these categories.',
        '20260424_drift_category_flags.sql','audit-contitech-2026-04-23', true);
