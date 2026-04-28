-- 20260428_REDO_fix_matcher_generic_rfc_canonical_invoices.sql
-- ─────────────────────────────────────────────────────────────────────────
-- BUG #1: matcher_company en producción TODAVÍA tiene el bug original.
--
-- La migration `20260427_fix_matcher_generic_rfc_and_backfill_canonical_invoices_fk.sql`
-- (commit 1df34b1) NO se aplicó correctamente o fue sobreescrita. Verificación
-- live 2026-04-28: la versión deployed tiene esta lógica buggy:
--
--   IF p_rfc IS NULL THEN ... fuzzy by name ... END IF;
--   SELECT WHERE rfc = p_rfc ORDER BY ... LIMIT 1;  ← captura genérico
--   IF FOUND THEN RETURN v_id;                      ← retorna de inmediato
--   IF p_rfc IN (generic) THEN ... fuzzy ... END IF; ← nunca se ejecuta
--
-- Test live: matcher_company('XEXX010101000', 'SHAWMUT LLC') retorna id=630
-- (HANGZHOU FENG HAI) cuando debería retornar id=1606 (SHAWMUT real).
--
-- Esta migration RE-APLICA el fix correcto y RE-EJECUTA todos los backfills.
-- Es idempotente: si por alguna razón la versión correcta ya está deployed,
-- esta migration no causa daño (CREATE OR REPLACE + UPDATE WHERE).
--
-- BLAST RADIUS verificado:
-- - 2,076 facturas SAT-only en MOSTRADOR id=11 (851 nombres distintos),
--   incluyendo ALEJANDRO CERVANTES MARTÍNEZ ($7.30M en 57 facturas).
-- - 299 facturas SAT-only en HANGZHOU id=630, incluyendo:
--     FXI INC ($90.96M, 169 facturas)
--     SHAWMUT LLC ($15.78M, 37 facturas) — SHOULD repoint to id=1606
--     CGT CANADIAN ($3.13M, 19), MNT LATINOAMERICANA ($4.86M, 9)
-- ─────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1. Re-apply patched matcher_company ─────────────────────────────────
-- Detecta generic RFC ANTES de exact match para evitar el bucket effect.
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

  -- Generic RFC: SKIP exact match (these RFCs are wildcards). Fuzzy by name first.
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
    -- Sin fuzzy hit — fall through a domain match y autocreate_shadow.
    -- DO NOT exact-match on the generic RFC.
  ELSE
    -- Real RFC: exact match con preferencia determinística.
    SELECT id INTO v_id FROM canonical_companies
      WHERE rfc = p_rfc
      ORDER BY has_manual_override DESC, is_internal DESC, has_shadow_flag ASC, id ASC
      LIMIT 1;
    IF FOUND THEN RETURN v_id; END IF;
  END IF;

  -- Domain match (works for both generic-rfc no-fuzzy-hit y unmatched-real-rfc paths)
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

-- ── 2. Backfill receptor_canonical_company_id (issued, with odoo source) ─
-- For invoices that have an odoo source, the receptor (customer) is unique
-- via odoo_partner_id. canonical_companies.odoo_partner_id is the post-MDM map.
WITH fix AS (
  SELECT
    ci.canonical_id,
    cc.id AS correct_canonical_company_id
  FROM canonical_invoices ci
  JOIN odoo_invoices oi ON oi.id = ci.odoo_invoice_id
  JOIN canonical_companies cc ON cc.odoo_partner_id = oi.odoo_partner_id
  WHERE ci.direction = 'issued'
    AND ci.odoo_invoice_id IS NOT NULL
    AND oi.odoo_partner_id IS NOT NULL
    AND ci.receptor_canonical_company_id IS DISTINCT FROM cc.id
)
UPDATE canonical_invoices ci
SET receptor_canonical_company_id = fix.correct_canonical_company_id
FROM fix
WHERE ci.canonical_id = fix.canonical_id;

-- ── 3. Backfill emisor_canonical_company_id (received, with odoo source) ─
WITH fix AS (
  SELECT
    ci.canonical_id,
    cc.id AS correct_canonical_company_id
  FROM canonical_invoices ci
  JOIN odoo_invoices oi ON oi.id = ci.odoo_invoice_id
  JOIN canonical_companies cc ON cc.odoo_partner_id = oi.odoo_partner_id
  WHERE ci.direction = 'received'
    AND ci.odoo_invoice_id IS NOT NULL
    AND oi.odoo_partner_id IS NOT NULL
    AND ci.emisor_canonical_company_id IS DISTINCT FROM cc.id
)
UPDATE canonical_invoices ci
SET emisor_canonical_company_id = fix.correct_canonical_company_id
FROM fix
WHERE ci.canonical_id = fix.canonical_id;

-- ── 4. Backfill SAT-only invoices via patched matcher_company ─────────
-- Para SAT-only con generic RFC, re-ejecutar matcher (que ahora hace fuzzy
-- por nombre en lugar de exact-match al genérico).
UPDATE canonical_invoices ci
SET receptor_canonical_company_id = matcher_company(ci.receptor_rfc, ci.receptor_nombre, NULL, false)
WHERE ci.direction = 'issued'
  AND ci.odoo_invoice_id IS NULL
  AND ci.receptor_rfc IN ('XEXX010101000','XAXX010101000')
  AND matcher_company(ci.receptor_rfc, ci.receptor_nombre, NULL, false) IS NOT NULL;

UPDATE canonical_invoices ci
SET emisor_canonical_company_id = matcher_company(ci.emisor_rfc, ci.emisor_nombre, NULL, false)
WHERE ci.direction = 'received'
  AND ci.odoo_invoice_id IS NULL
  AND ci.emisor_rfc IN ('XEXX010101000','XAXX010101000')
  AND matcher_company(ci.emisor_rfc, ci.emisor_nombre, NULL, false) IS NOT NULL;

-- ── 5. Refresh canonical_companies financials ──────────────────────────
-- Las cifras agregadas (revenue_ytd, total_receivable, etc.) dependen de
-- estos FKs. Después del backfill, recomputar.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'refresh_canonical_company_financials') THEN
    PERFORM refresh_canonical_company_financials(NULL);
  END IF;
END $$;

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES (
  'create_function', 'canonical_companies',
  'REDO fix matcher_company generic RFC bug (deployed version still buggy 2026-04-28). Re-apply patched matcher + re-run all backfills. Verified live: matcher_company(XEXX, SHAWMUT LLC) returned 630 instead of 1606.',
  '20260428_REDO_fix_matcher_generic_rfc_canonical_invoices.sql', 'audit-mdm-cleanup', true
);

COMMIT;
