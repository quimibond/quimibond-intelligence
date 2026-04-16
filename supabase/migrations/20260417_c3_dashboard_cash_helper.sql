-- ═══════════════════════════════════════════════════════════════
-- C3 — get_dashboard_kpis.cash: delegar a cfo_dashboard
-- ═══════════════════════════════════════════════════════════════
-- Audit finding (DATA_AUDIT_REPORT.md §C3):
-- La RPC `get_dashboard_kpis` re-convierte USD→MXN con literal
-- `17.4` hardcoded en vez de usar `current_balance_mxn` ya
-- calculado por sync con FX real. Produce 3 FX rates simultáneos:
--   17.2688 (live en odoo_currency_rates)
--   17.4    (hardcoded en la RPC)
--   17.69   (implícito en current_balance_mxn stored)
-- Total cash en `/` ($4,165,138) no coincide con cfo_dashboard
-- ($4,141,649 post fix FX-live de migración cfo_dashboard_capture).
--
-- Fix: helper function que devuelve el JSONB `cash` correcto,
-- delegando a `cfo_dashboard` y `financial_runway` (fuentes de
-- verdad canónicas post-audit).
--
-- Adicional: hay que editar `get_dashboard_kpis()` para llamar
-- este helper en su sección cash. Como el body actual de la RPC
-- NO está en ninguna migración (vive solo en prod), NO intento
-- reescribirla completa aquí. El último paso es manual:
--
--   1. Aplicar esta migración (crea helper).
--   2. Ejecutar en Supabase:
--        SELECT pg_get_functiondef(oid) FROM pg_proc
--         WHERE proname = 'get_dashboard_kpis';
--   3. Pegar el body actual; yo te doy el patch preciso donde
--      reemplazar el bloque cash por:
--        'cash', get_dashboard_cash_kpi()
--   4. Commit + aplicar el CREATE OR REPLACE FUNCTION final.
-- ═══════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION get_dashboard_cash_kpi()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  -- Fuente canónica: cfo_dashboard (FX live tras migración
  -- 20260416_cfo_dashboard_and_cash_position_capture.sql) +
  -- financial_runway (runway dual).
  SELECT jsonb_build_object(
    -- Cash en MXN nativo (solo cuentas MXN con saldo > 0)
    'cash_mxn',     COALESCE(cfo.efectivo_mxn, 0),
    -- Cash en USD nativo (solo para UI badge "USD X")
    'cash_usd',     COALESCE(cfo.efectivo_usd, 0),
    -- Total MXN (FX live) — MISMO que /finanzas "Efectivo disponible"
    'total_mxn',    COALESCE(cfo.efectivo_total_mxn, 0),
    -- Runway net (incluye cobros esperados 30d) — MISMO que /finanzas
    -- banner. El audit recomendó exponer también cash_only; dashboard.ts
    -- actualmente solo consume 'runway_days', así que devolvemos el net
    -- como canonical y agregamos 'runway_days_cash_only' opcional.
    'runway_days',            COALESCE(fr.runway_days_net, 0),
    'runway_days_cash_only',  COALESCE(fr.runway_days_cash_only, 0)
  )
  FROM cfo_dashboard cfo
  CROSS JOIN financial_runway fr
  LIMIT 1;
$$;

COMMENT ON FUNCTION get_dashboard_cash_kpi() IS
  'Single source of truth para la sección cash de get_dashboard_kpis. Delega a cfo_dashboard + financial_runway. Post-audit 2026-04-16.';

-- Diagnóstico: valor actual vs lo que el dashboard está devolviendo.
DO $$
DECLARE
  new_kpi    jsonb;
  new_total  numeric;
BEGIN
  new_kpi := get_dashboard_cash_kpi();
  new_total := (new_kpi->>'total_mxn')::numeric;
  RAISE NOTICE '---';
  RAISE NOTICE 'get_dashboard_cash_kpi() canónico:';
  RAISE NOTICE '  total_mxn (FX live):      %', new_total;
  RAISE NOTICE '  runway_days (net):        %', new_kpi->>'runway_days';
  RAISE NOTICE '  runway_days_cash_only:    %', new_kpi->>'runway_days_cash_only';
  RAISE NOTICE '---';
  RAISE NOTICE 'Siguiente paso manual: patchar get_dashboard_kpis() para';
  RAISE NOTICE 'que su sección cash llame a este helper en vez del SELECT';
  RAISE NOTICE 'inline que usa 17.4 hardcoded. Ver comentario en migración.';
  RAISE NOTICE '---';
END $$;

COMMIT;
