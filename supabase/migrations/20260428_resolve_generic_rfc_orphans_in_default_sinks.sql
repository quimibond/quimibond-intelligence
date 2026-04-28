-- 20260428_resolve_generic_rfc_orphans_in_default_sinks.sql
-- ─────────────────────────────────────────────────────────────────────────
-- BUG #3: SAT-only invoices con generic RFC quedan apuntando a "default
-- sinks" porque matcher_company fuzzy threshold (0.90) es muy estricto y
-- el bug original llenó esos default sinks con cientos de facturas
-- desperdigadas de clientes reales distintos.
--
-- Default sinks identificados:
--   * id=11   MARÍA DE LOURDES HERNÁNDEZ ZAMORA, MOSTRADOR (XAXX): 2,076 invoices
--   * id=630  HANGZHOU FENG HAI ELECTRONIC Co., LTD (XEXX):         299 invoices
--
-- Fragmentación verificada (2026-04-28):
--   SHAWMUT (5 spellings):         $17.27M   debería ir a id=1606 (existing)
--   FXI INC (3 spellings):         $96.28M   no canonical, autocreate
--   MNT LATINOAMERICANA (1):       $ 4.86M   no canonical, autocreate
--   CGT CANADIAN GENERAL TOWER (2): $ 3.97M   no canonical, autocreate
--   VERATEX LINING (2):            $ 2.85M   no canonical, autocreate
--   LEAR MEXICAN SEATING (2):      $ 1.79M   no canonical, autocreate
--   JOSÉ CARRILLO VILLEGAS (3):    $   ~352K  existing id=634, re-fuzzy
--   JORGE JUAREZ (2):              $   ~211K  existing id=317, re-fuzzy
--   JESUS ESCAMILLA JAIMES (2):    $   ~117K  existing id=633, re-fuzzy
--   ALEJANDRO CERVANTES (1):       $ 7.30M   no canonical, autocreate
--   ZENEN ZEPEDA, HERMINIA PIMENTEL, etc. — autocreate per nombre
--
-- DEPENDS ON: 20260428_REDO_fix_matcher_generic_rfc_canonical_invoices.sql
--   (este migration asume que matcher_company ya tiene la lógica correcta)
--
-- STRATEGY:
--   1. Helper fn _orphan_match: usa fuzzy threshold relajado (0.70) para
--      capturar SHAWMUT vs SHAWMUT CORPORATION, JORGE vs JORGE JUÁREZ, etc.
--   2. Para invoices en default sinks con SAT-only generic-RFC:
--      a. Llamar _orphan_match(rfc, name) → retorna canonical_id si encuentra
--         match >= 0.70 fuzzy (excluyendo el default sink mismo)
--      b. Si NULL, llamar matcher_company con autocreate_shadow=true
--   3. UPDATE canonical_invoices con el nuevo FK
--
-- BLAST RADIUS post-fix esperado:
--   * MOSTRADOR id=11: ~2,076 invoices → distribuidas en ~75-200 nuevos
--                      canonical_companies (shadows con XAXX). Algunas
--                      legítimas se quedan ahí (true mostrador walk-ins).
--   * HANGZHOU id=630: ~299 invoices → ~30-50 nuevos canonicals + algunas
--                      en SHAWMUT id=1606 existing.
--   * Revenue por cliente: SHAWMUT YTD sube de ~$8M a ~$25M+, FXI aparece
--                          en el dashboard como top customer ($96M+).
-- ─────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1. Helper: relaxed orphan matcher ──────────────────────────────────
-- Threshold 0.70 (vs 0.90 default). Solo usa para resolución de orphans;
-- NO reemplaza matcher_company general porque 0.70 es demasiado permisivo
-- para Bronze-trigger inserts.
--
-- Excluye los default sinks (id=11, id=630) del candidato pool — estos
-- son precisamente los buckets contaminados que estamos vaciando.
CREATE OR REPLACE FUNCTION _orphan_match(p_rfc text, p_name text)
RETURNS bigint AS $$
DECLARE v_id bigint;
BEGIN
  IF p_name IS NULL OR p_name = '' THEN RETURN NULL; END IF;

  -- Fuzzy match con threshold relajado, excluyendo los default sinks.
  SELECT id INTO v_id
  FROM canonical_companies
  WHERE id NOT IN (11, 630)
    AND similarity(canonical_name, LOWER(p_name)) >= 0.70
  ORDER BY similarity(canonical_name, LOWER(p_name)) DESC,
           has_manual_override DESC,
           is_internal DESC,
           has_shadow_flag ASC,
           id ASC
  LIMIT 1;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql STABLE;

-- ── 2. Pre-validation: count orphans before fix ────────────────────────
DO $$
DECLARE v_mostrador int; v_hangzhou int;
BEGIN
  SELECT COUNT(*) INTO v_mostrador
  FROM canonical_invoices
  WHERE receptor_canonical_company_id = 11
    AND odoo_invoice_id IS NULL
    AND receptor_rfc = 'XAXX010101000';
  SELECT COUNT(*) INTO v_hangzhou
  FROM canonical_invoices
  WHERE receptor_canonical_company_id = 630
    AND odoo_invoice_id IS NULL
    AND receptor_rfc = 'XEXX010101000';
  RAISE NOTICE 'Pre-fix: MOSTRADOR id=11 = % SAT-only orphans, HANGZHOU id=630 = % orphans', v_mostrador, v_hangzhou;
END $$;

-- ── 3. Step A: try fuzzy 0.70 against existing canonicals ──────────────
-- Para invoices en default sinks, busca match >= 0.70 con OTRO canonical.
-- Esto captura SHAWMUT LLC → SHAWMUT id=1606, JORGE JUAREZ → id=317, etc.
WITH fuzzy_resolved AS (
  SELECT
    ci.canonical_id,
    _orphan_match(ci.receptor_rfc, ci.receptor_nombre) AS new_fk
  FROM canonical_invoices ci
  WHERE ci.direction = 'issued'
    AND ci.receptor_canonical_company_id IN (11, 630)
    AND ci.odoo_invoice_id IS NULL
    AND ci.receptor_rfc IN ('XAXX010101000','XEXX010101000')
    AND ci.receptor_nombre IS NOT NULL
)
UPDATE canonical_invoices ci
SET receptor_canonical_company_id = fuzzy_resolved.new_fk,
    last_reconciled_at = now()
FROM fuzzy_resolved
WHERE ci.canonical_id = fuzzy_resolved.canonical_id
  AND fuzzy_resolved.new_fk IS NOT NULL;

DO $$
DECLARE v_mostrador int; v_hangzhou int;
BEGIN
  SELECT COUNT(*) INTO v_mostrador
  FROM canonical_invoices
  WHERE receptor_canonical_company_id = 11 AND odoo_invoice_id IS NULL AND receptor_rfc = 'XAXX010101000';
  SELECT COUNT(*) INTO v_hangzhou
  FROM canonical_invoices
  WHERE receptor_canonical_company_id = 630 AND odoo_invoice_id IS NULL AND receptor_rfc = 'XEXX010101000';
  RAISE NOTICE 'Post-fuzzy(0.70): MOSTRADOR=% remaining, HANGZHOU=% remaining', v_mostrador, v_hangzhou;
END $$;

-- ── 4. Step B: autocreate shadows for remaining orphans (issued) ───────
-- Para los que NO encontraron match >= 0.70, crear shadow canonical_company
-- usando el receptor_nombre como base del canonical_name.
--
-- Limit a high-volume orphans (count >= 5 OR total >= $50K) para evitar
-- crear miles de shadows espurios para mostradores reales walk-in. Los
-- de bajo volumen quedan en el default sink (acceptable noise).
WITH orphan_aggregated AS (
  SELECT
    receptor_nombre,
    receptor_rfc,
    COUNT(*) AS cnt,
    SUM(amount_total_mxn_resolved) AS total_mxn
  FROM canonical_invoices
  WHERE direction = 'issued'
    AND receptor_canonical_company_id IN (11, 630)
    AND odoo_invoice_id IS NULL
    AND receptor_rfc IN ('XAXX010101000','XEXX010101000')
    AND receptor_nombre IS NOT NULL
  GROUP BY 1, 2
  HAVING COUNT(*) >= 5 OR SUM(amount_total_mxn_resolved) >= 50000
),
shadows_created AS (
  INSERT INTO canonical_companies (
    canonical_name, display_name, rfc,
    has_shadow_flag, shadow_reason,
    match_method, match_confidence, needs_review, review_reason, last_matched_at
  )
  SELECT
    LOWER(receptor_nombre),
    receptor_nombre,
    receptor_rfc,
    true,
    'orphan_resolved_from_default_sink',
    'sat_only', 0.50, true,
    ARRAY['sat_only_shadow','high_volume_orphan_from_default_sink'],
    now()
  FROM orphan_aggregated
  ON CONFLICT (canonical_name) DO NOTHING
  RETURNING id, canonical_name
)
SELECT COUNT(*) FROM shadows_created;

-- ── 5. Step C: re-point orphan invoices to newly-created shadows ───────
-- Match invoices via canonical_name (lowercase exact = creó match con el shadow)
WITH new_targets AS (
  SELECT id, canonical_name FROM canonical_companies
  WHERE shadow_reason IN ('orphan_resolved_from_default_sink')
    AND last_matched_at >= now() - interval '5 minutes'
)
UPDATE canonical_invoices ci
SET receptor_canonical_company_id = nt.id,
    last_reconciled_at = now()
FROM new_targets nt
WHERE ci.direction = 'issued'
  AND ci.receptor_canonical_company_id IN (11, 630)
  AND ci.odoo_invoice_id IS NULL
  AND ci.receptor_rfc IN ('XAXX010101000','XEXX010101000')
  AND LOWER(ci.receptor_nombre) = nt.canonical_name;

-- ── 6. Same flow for direction='received' (proveedores con generic RFC) ─
WITH fuzzy_resolved_recv AS (
  SELECT
    ci.canonical_id,
    _orphan_match(ci.emisor_rfc, ci.emisor_nombre) AS new_fk
  FROM canonical_invoices ci
  WHERE ci.direction = 'received'
    AND ci.emisor_canonical_company_id IN (11, 630)
    AND ci.odoo_invoice_id IS NULL
    AND ci.emisor_rfc IN ('XAXX010101000','XEXX010101000')
    AND ci.emisor_nombre IS NOT NULL
)
UPDATE canonical_invoices ci
SET emisor_canonical_company_id = fuzzy_resolved_recv.new_fk,
    last_reconciled_at = now()
FROM fuzzy_resolved_recv
WHERE ci.canonical_id = fuzzy_resolved_recv.canonical_id
  AND fuzzy_resolved_recv.new_fk IS NOT NULL;

-- ── 7. Final validation ────────────────────────────────────────────────
DO $$
DECLARE
  v_mostrador int; v_hangzhou int;
  v_shadows_created int;
  v_shawmut_post int;
  v_shawmut_revenue numeric;
BEGIN
  SELECT COUNT(*) INTO v_mostrador
  FROM canonical_invoices
  WHERE receptor_canonical_company_id = 11 AND odoo_invoice_id IS NULL AND receptor_rfc = 'XAXX010101000';
  SELECT COUNT(*) INTO v_hangzhou
  FROM canonical_invoices
  WHERE receptor_canonical_company_id = 630 AND odoo_invoice_id IS NULL AND receptor_rfc = 'XEXX010101000';
  SELECT COUNT(*) INTO v_shadows_created
  FROM canonical_companies
  WHERE shadow_reason = 'orphan_resolved_from_default_sink'
    AND last_matched_at >= now() - interval '5 minutes';
  SELECT COUNT(*), COALESCE(SUM(amount_total_mxn_resolved), 0) INTO v_shawmut_post, v_shawmut_revenue
  FROM canonical_invoices ci
  JOIN canonical_companies cc ON cc.id = ci.receptor_canonical_company_id
  WHERE cc.id = 1606;

  RAISE NOTICE 'POST-fix:';
  RAISE NOTICE '  MOSTRADOR id=11 remaining (low-volume mostradores reales): %', v_mostrador;
  RAISE NOTICE '  HANGZHOU id=630 remaining: %', v_hangzhou;
  RAISE NOTICE '  Shadows newly created: %', v_shadows_created;
  RAISE NOTICE '  SHAWMUT id=1606: % invoices, $% MXN', v_shawmut_post, v_shawmut_revenue;
END $$;

-- ── 8. Refresh canonical_companies financials para que dashboards reflejen ──
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'refresh_canonical_company_financials') THEN
    PERFORM refresh_canonical_company_financials(NULL);
  END IF;
END $$;

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES (
  'data_fix', 'canonical_invoices',
  'Resolve generic-RFC SAT-only orphans en default sinks (MOSTRADOR id=11, HANGZHOU id=630). Step 1: fuzzy 0.70 captura SHAWMUT/JORGE/JESUS hacia canonicals existentes. Step 2: autocreate shadows para FXI ($96M)/CGT/VERATEX/LEAR/ALEJANDRO etc. Estimado: ~50-100 shadows nuevos, ~2,375 invoices re-pointed.',
  '20260428_resolve_generic_rfc_orphans_in_default_sinks.sql', 'audit-mdm-cleanup', true
);

COMMIT;
