-- 20260427_fix_matcher_generic_rfc_and_backfill_canonical_invoices_fk.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Bug: matcher_company() did exact RFC match BEFORE checking for generic
-- RFCs (XAXX010101000 / XEXX010101000). These are wildcard Mexican RFCs
-- shared by hundreds of distinct customers (público en general / extranjero).
--
-- Concrete consequence:
--   ~2,500 canonical_invoices for SHAWMUT LLC (rfc=830963693 OR generic XEXX)
--   were ALL pointed at canonical_company id=11 ("MARÍA DE LOURDES HERNÁNDEZ
--   ZAMORA, MOSTRADOR" with rfc=XAXX010101000) or id=630 ("HANGZHOU FENG HAI
--   ELECTRONIC Co., LTD" with rfc=XEXX010101000), instead of id=1606 (real
--   SHAWMUT LLC). Same for any customer that ever issued an invoice using
--   a generic RFC.
--
--   Result: revenue analysis by customer wildly wrong. SHAWMUT 2026 YTD
--   reported as $1.45M when real number is $8.05M.
--
-- Fix in 2 parts:
--   1. matcher_company(): for generic RFCs, SKIP exact RFC match and go
--      straight to fuzzy name matching. Only use exact RFC when RFC is real
--      (not in the generic set).
--   2. Backfill: for canonical_invoices already FK-pointing to wrong
--      canonical_companies, repoint via odoo_partner_id of the linked
--      odoo_invoice. odoo_partner_id is unique per company in Odoo and
--      canonical_companies.odoo_partner_id is the post-MDM mapping.
-- ─────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1. Patched matcher_company ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION matcher_company(
  p_rfc text,
  p_name text DEFAULT NULL,
  p_domain text DEFAULT NULL,
  p_autocreate_shadow boolean DEFAULT false
) RETURNS bigint AS $$
DECLARE v_id bigint;
        v_is_generic boolean;
BEGIN
  IF p_rfc IS NULL OR p_rfc = '' THEN
    IF p_name IS NULL OR p_name = '' THEN RETURN NULL; END IF;
    SELECT id INTO v_id FROM canonical_companies
      WHERE similarity(canonical_name, LOWER(p_name)) >= 0.85
      ORDER BY similarity(canonical_name, LOWER(p_name)) DESC,
               has_manual_override DESC, is_internal DESC,
               has_shadow_flag ASC, id ASC
      LIMIT 1;
    RETURN v_id;
  END IF;

  v_is_generic := p_rfc IN ('XEXX010101000','XAXX010101000');

  -- Generic RFC: skip exact match (these RFCs are wildcards). Go fuzzy on name.
  IF v_is_generic THEN
    IF p_name IS NOT NULL AND p_name <> '' THEN
      SELECT id INTO v_id FROM canonical_companies
        WHERE similarity(canonical_name, LOWER(p_name)) >= 0.90
        ORDER BY similarity(canonical_name, LOWER(p_name)) DESC,
                 has_manual_override DESC, is_internal DESC,
                 has_shadow_flag ASC, id ASC
        LIMIT 1;
      IF FOUND THEN RETURN v_id; END IF;
    END IF;
    -- No fuzzy hit — try domain, otherwise fall through to autocreate_shadow.
    -- DO NOT exact-match on the generic RFC.
  ELSE
    -- Real RFC: exact match with deterministic preference.
    SELECT id INTO v_id FROM canonical_companies
      WHERE rfc = p_rfc
      ORDER BY has_manual_override DESC, is_internal DESC, has_shadow_flag ASC, id ASC
      LIMIT 1;
    IF FOUND THEN RETURN v_id; END IF;
  END IF;

  -- Domain match (works for both generic-rfc and unmatched-real-rfc paths)
  IF p_domain IS NOT NULL THEN
    SELECT id INTO v_id FROM canonical_companies
      WHERE primary_email_domain = LOWER(p_domain)
      ORDER BY has_manual_override DESC, is_internal DESC, has_shadow_flag ASC, id ASC
      LIMIT 1;
    IF FOUND THEN RETURN v_id; END IF;
  END IF;

  IF p_autocreate_shadow THEN
    INSERT INTO canonical_companies (
      canonical_name, display_name, rfc,
      has_shadow_flag, shadow_reason,
      match_method, match_confidence, needs_review, review_reason, last_matched_at
    ) VALUES (
      LOWER(COALESCE(p_name, p_rfc)),
      COALESCE(p_name, p_rfc),
      p_rfc, true,
      CASE WHEN v_is_generic THEN 'generic_rfc_no_fuzzy_match' ELSE 'sat_cfdi_only_post_2021' END,
      'sat_only', 0.50, true, ARRAY['sat_only_shadow'], now()
    )
    ON CONFLICT (canonical_name) DO NOTHING
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      -- Conflict on canonical_name: fetch existing
      SELECT id INTO v_id FROM canonical_companies
        WHERE canonical_name = LOWER(COALESCE(p_name, p_rfc))
        ORDER BY has_manual_override DESC, is_internal DESC, has_shadow_flag ASC, id ASC
        LIMIT 1;
    END IF;
  END IF;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

-- ── 2. Backfill receptor_canonical_company_id for issued invoices ──────
-- For invoices that have an odoo source, the receptor (customer) is unique:
-- canonical_invoices.odoo_invoice_id is the local PK in odoo_invoices.id
-- (NOT odoo_invoices.odoo_invoice_id — the column names are confusing).
-- canonical_companies.odoo_partner_id maps each company 1:1 post-MDM.
WITH fix AS (
  SELECT
    ci.canonical_id,
    cc.id AS correct_canonical_company_id,
    ci.receptor_canonical_company_id AS old_id
  FROM canonical_invoices ci
  JOIN odoo_invoices oi ON oi.id = ci.odoo_invoice_id
  JOIN canonical_companies cc ON cc.odoo_partner_id = oi.odoo_partner_id
  WHERE ci.direction = 'issued'
    AND ci.odoo_invoice_id IS NOT NULL
    AND oi.odoo_partner_id IS NOT NULL
    AND (
      ci.receptor_canonical_company_id IS DISTINCT FROM cc.id
    )
)
UPDATE canonical_invoices ci
SET receptor_canonical_company_id = fix.correct_canonical_company_id
FROM fix
WHERE ci.canonical_id = fix.canonical_id;

-- ── 3. Backfill emisor_canonical_company_id for received invoices ─────
-- For received invoices, emisor (supplier) = odoo_invoices.odoo_partner_id.
WITH fix AS (
  SELECT
    ci.canonical_id,
    cc.id AS correct_canonical_company_id,
    ci.emisor_canonical_company_id AS old_id
  FROM canonical_invoices ci
  JOIN odoo_invoices oi ON oi.id = ci.odoo_invoice_id
  JOIN canonical_companies cc ON cc.odoo_partner_id = oi.odoo_partner_id
  WHERE ci.direction = 'received'
    AND ci.odoo_invoice_id IS NOT NULL
    AND oi.odoo_partner_id IS NOT NULL
    AND (
      ci.emisor_canonical_company_id IS DISTINCT FROM cc.id
    )
)
UPDATE canonical_invoices ci
SET emisor_canonical_company_id = fix.correct_canonical_company_id
FROM fix
WHERE ci.canonical_id = fix.canonical_id;

-- ── 4. Backfill SAT-only invoices via patched matcher_company ─────────
-- For invoices with no odoo_invoice_id but generic RFC, re-run matcher
-- (which now correctly does fuzzy name instead of trusting generic RFC).
UPDATE canonical_invoices ci
SET receptor_canonical_company_id = matcher_company(ci.receptor_rfc, ci.receptor_nombre, NULL, false)
WHERE ci.direction = 'issued'
  AND ci.odoo_invoice_id IS NULL
  AND ci.receptor_rfc IN ('XEXX010101000','XAXX010101000');

UPDATE canonical_invoices ci
SET emisor_canonical_company_id = matcher_company(ci.emisor_rfc, ci.emisor_nombre, NULL, false)
WHERE ci.direction = 'received'
  AND ci.odoo_invoice_id IS NULL
  AND ci.emisor_rfc IN ('XEXX010101000','XAXX010101000');

-- ── 5. Refresh derived fields if any (revenue per company) ─────────────
-- canonical_companies.revenue_ytd_mxn etc. are pre-computed. Trigger refresh
-- so the affected companies (SHAWMUT, etc.) reflect correct numbers.
-- The refresh job is `refresh_canonical_companies_revenue` (if it exists).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'refresh_canonical_companies_revenue') THEN
    PERFORM refresh_canonical_companies_revenue();
  END IF;
END $$;

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES (
  'create_function',
  'canonical_companies',
  'Fix matcher_company generic RFC bug + backfill receptor_canonical_company_id + emisor_canonical_company_id via odoo_partner_id (was: ~2,500 SHAWMUT invoices pointed at MOSTRADOR/HANGZHOU due to generic-RFC exact match)',
  '20260427_fix_matcher_generic_rfc_and_backfill_canonical_invoices_fk.sql',
  'audit-revenue-customer',
  true
);

COMMIT;
