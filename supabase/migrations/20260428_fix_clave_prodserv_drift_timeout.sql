-- supabase/migrations/20260428_fix_clave_prodserv_drift_timeout.sql
--
-- P0-2 audit fix (2026-04-28): clave_prodserv_drift invariant timeout
-- (4 jobs daily fallaron por timeout en silver_sp4_reconcile_daily).
--
-- ROOT CAUSE
-- ----------
-- _sp4_run_extra() bloque clave_prodserv_drift hace LATERAL JOIN:
--   FROM canonical_products cp
--   JOIN LATERAL (
--     SELECT clave_prod_serv FROM syntage_invoice_line_items
--     WHERE descripcion LIKE '[' || cp.internal_ref || ']%'
--     ORDER BY synced_at DESC LIMIT 1
--   ) ON true
--
-- Cada producto (~6k) escanea ~181k filas con LIKE concatenado prefix —
-- no hay índice usable porque el patrón se construye en runtime. Costo:
-- ~1.1B comparaciones por corrida, lo que excede el statement_timeout.
--
-- FIX
-- ---
-- Pre-agregar en una sola pasada con regexp_match para extraer el ref
-- entre corchetes, DISTINCT ON para tomar el más reciente por ref,
-- y JOIN equality contra canonical_products.internal_ref (ya tiene
-- UNIQUE INDEX uq_cprod_internal_ref). Costo: ~181k regex + ~6k joins.
--
-- Como _sp4_run_extra() son 600+ líneas, en lugar de re-emitir la función
-- entera, extraemos este bloque a un helper standalone y lo desactivamos
-- en audit_tolerances (el IF block en _sp4_run_extra checa enabled).
-- pg_cron lo ejecuta diario a las 4:45 UTC.

BEGIN;

-- ============================================================
-- 1. Helper function con query optimizada
-- ============================================================

CREATE OR REPLACE FUNCTION _sp4_check_clave_prodserv_drift()
RETURNS integer LANGUAGE plpgsql AS $fn$
DECLARE
  v_count integer;
BEGIN
  WITH latest_clave_per_ref AS (
    SELECT DISTINCT ON (extracted_ref)
           extracted_ref,
           clave_prod_serv,
           synced_at
    FROM (
      SELECT (regexp_match(descripcion, '^\[([^\]]+)\]'))[1] AS extracted_ref,
             clave_prod_serv,
             synced_at
      FROM syntage_invoice_line_items
      WHERE descripcion ~ '^\[[^\]]+\]'
    ) t
    WHERE extracted_ref IS NOT NULL
    ORDER BY extracted_ref, synced_at DESC NULLS LAST
  )
  INSERT INTO reconciliation_issues
    (issue_id, issue_type, canonical_entity_type, canonical_entity_id, canonical_id,
     impact_mxn, severity, detected_at, invariant_key, action_cta, description, metadata)
  SELECT gen_random_uuid(), 'clave_prodserv_drift', 'product', cp.id::text, cp.id::text,
         NULL, 'low', now(),
         'clave_prodserv_drift', 'review_fiscal_map',
         format('Product %s clave drift: canonical=%s last_sat=%s',
                cp.internal_ref, cp.sat_clave_prod_serv, lc.clave_prod_serv),
         jsonb_build_object('internal_ref', cp.internal_ref)
  FROM canonical_products cp
  JOIN latest_clave_per_ref lc ON lc.extracted_ref = cp.internal_ref
  WHERE cp.sat_clave_prod_serv IS NOT NULL
    AND lc.clave_prod_serv IS NOT NULL
    AND lc.clave_prod_serv <> cp.sat_clave_prod_serv
    AND NOT EXISTS (
      SELECT 1 FROM reconciliation_issues ri
       WHERE ri.invariant_key = 'clave_prodserv_drift'
         AND ri.canonical_id  = cp.id::text
         AND ri.resolved_at IS NULL
    );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$fn$;

COMMENT ON FUNCTION _sp4_check_clave_prodserv_drift() IS
  'P0-2 fix (2026-04-28): single-scan replacement for clave_prodserv_drift block in _sp4_run_extra. Returns # nuevas issues insertadas.';

-- ============================================================
-- 2. Desactivar el bloque viejo en _sp4_run_extra
-- (el IF dentro de _sp4_run_extra checa audit_tolerances.enabled
-- y skip si false — ver migration 1057 línea 478)
-- ============================================================

UPDATE audit_tolerances
   SET enabled = false,
       notes   = notes || ' [P0-2 2026-04-28: disabled in _sp4_run_extra; replaced by _sp4_check_clave_prodserv_drift() pg_cron]'
 WHERE invariant_key = 'clave_prodserv_drift';

-- ============================================================
-- 3. Schedule pg_cron (idempotente)
-- ============================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'clave_prodserv_drift_optimized') THEN
    PERFORM cron.unschedule('clave_prodserv_drift_optimized');
  END IF;
END $$;

SELECT cron.schedule(
  'clave_prodserv_drift_optimized',
  '45 4 * * *',  -- 4:45 UTC daily, after recon_issues_retention_cleanup (4:15)
  $$SELECT _sp4_check_clave_prodserv_drift()$$
);

-- ============================================================
-- 4. Audit trail
-- ============================================================

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES
  ('CREATE_FUNCTION', '_sp4_check_clave_prodserv_drift',
   'P0-2 audit fix: optimized helper for clave_prodserv_drift (replaces O(n*m) LATERAL with O(n+m) regex + equality JOIN)',
   'supabase/migrations/20260428_fix_clave_prodserv_drift_timeout.sql',
   'audit-2026-04-28-p0-2', true);

COMMIT;
