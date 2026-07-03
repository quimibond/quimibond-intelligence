-- 999998 es SINTÉTICA en odoo_account_balances — re-apuntar guardia a líneas reales (2026-07-03)
--
-- Hallazgo: la fila mensual de 999998 "Ganancias/pérdidas no distribuidas" en
-- odoo_account_balances NO viene de asientos — la fabrica _push_account_balances
-- (qb19, SP5 §14.2) como utilidad neta del período para que gold_balance_sheet
-- cuadre (en Odoo equity_unaffected es un saldo calculado sin move lines).
-- Verificado 2026-07-03: cuadra al centavo con Σingresos−Σgastos los 7 meses de
-- 2026, y tras extender el filtro del sync a cuentas 999% y re-push completo
-- desde 2025-12-31, hay CERO líneas reales de 999998 en lines_stock (all-time).
--
-- Consecuencias:
--   1. El hallazgo F3 de la auditoría 2026-07-02 ("$3.57M del conteo de junio
--      fueron a equity 999998") era un FALSO POSITIVO — leímos la fila sintética
--      como asiento real. Lo que sí pasó: los asientos del conteo se CANCELARON.
--   2. La guardia inventory.equity_999998_manual (20260703) leía
--      odoo_account_balances → disparaba cada mes sobre la utilidad neta.
--      Se re-apunta a las líneas reales de odoo_account_entries_stock.lines_stock
--      (que desde hoy capturan 999% — filtro extendido en qb19).
--   3. Ídem la alarma 2.2 de get_inventory_close_alarms.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Alarmas: 2.2 usa líneas reales
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_inventory_close_alarms(p_days integer DEFAULT 30)
RETURNS TABLE (
  alarma text,
  severidad text,
  valor_mxn numeric,
  eventos integer,
  detalle text
)
LANGUAGE sql STABLE AS $$
-- 2.1 CAPA: cualquier asiento nuevo en el journal congelado
SELECT 'CAPA: asiento nuevo en journal congelado'::text, 'critical'::text,
       ROUND(COALESCE(SUM(e.amount_total),0)), COUNT(*)::int,
       'Últimos: ' || string_agg(e.name || ' (' || e.date || ')', ', ' ORDER BY e.date DESC)
FROM odoo_account_entries_stock e
WHERE e.journal_name = 'CAPA DE VALORACIÓN' AND e.state = 'posted'
  AND e.date >= CURRENT_DATE - p_days
HAVING COUNT(*) > 0
UNION ALL
-- 2.2 999998: asiento REAL a equity (la fila de odoo_account_balances es
--     sintética = utilidad neta del mes; aquí miramos líneas reales, que el
--     sync captura desde el fix de filtro 999% en qb19 2026-07-03)
SELECT '999998: asiento real a equity', 'critical',
       ROUND(SUM((ln->>'debit')::numeric + (ln->>'credit')::numeric)),
       COUNT(DISTINCT e.odoo_move_id)::int,
       'Nadie debe postear a 999998 (utilidad acumulada es saldo calculado). Asientos: ' ||
       string_agg(DISTINCT e.name || ' (' || e.date || ')', ', ')
FROM odoo_account_entries_stock e,
     jsonb_array_elements(e.lines_stock) ln
WHERE (ln->>'account_code') = '999998'
  AND e.state = 'posted'
  AND e.date >= CURRENT_DATE - p_days
HAVING COUNT(*) > 0
UNION ALL
-- 2.3 501.01.02: debe estar muerta
SELECT '501.01.02 COSTO POR AJUSTES A CANTIDAD: actividad en cuenta zombie', 'high',
       ROUND(SUM(debit + credit)), COUNT(*)::int,
       'La cuenta debe estar en $0 permanente (fugas EMB/SP/REQP o manuales) — meses: ' ||
       string_agg(DISTINCT period, ', ')
FROM odoo_account_balances
WHERE account_code = '501.01.02'
  AND period >= to_char(CURRENT_DATE - p_days, 'YYYY-MM')
  AND (debit > 1000 OR credit > 1000)
HAVING SUM(debit + credit) > 1000
UNION ALL
-- 2.4 Cuentas 115 con saldo negativo (imposible para un activo)
SELECT '115.* con saldo NEGATIVO: ' || account_code, 'critical',
       ROUND(SUM(balance)), 1,
       'Un activo de inventario nunca puede ser negativo — categorías sin transferencia'
FROM odoo_account_balances
WHERE account_code LIKE '115%'
GROUP BY account_code
HAVING SUM(balance) < -1000;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Guardias: 3.4 usa líneas reales (un issue por asiento, no por mes)
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._check_inventory_close_guards()
RETURNS integer
LANGUAGE plpgsql AS $fn$
DECLARE
  v_count integer := 0;
  v_ins integer;
BEGIN
  -- 3.1 asiento nuevo en CAPA (journal congelado 2026-07-02)
  INSERT INTO reconciliation_issues (
    issue_id, issue_type, canonical_entity_type, canonical_entity_id, canonical_id,
    impact_mxn, severity, detected_at, invariant_key, action_cta, description, metadata
  )
  SELECT gen_random_uuid(),
         'inventory.capa_journal_activity',
         'account_entry',
         ae.odoo_move_id::text,
         ae.odoo_move_id::text,
         ABS(COALESCE(ae.amount_total, 0)),
         'critical', now(),
         'inventory.capa_journal_activity',
         'review_accounting',
         format('Asiento nuevo en journal CAPA (CONGELADO por CEO 2026-07-02): %s del %s por $%s. Revertir por reclasificación.',
                ae.name, ae.date::date, ROUND(COALESCE(ae.amount_total,0))),
         jsonb_build_object('odoo_move_id', ae.odoo_move_id, 'name', ae.name,
                            'date', ae.date, 'amount_total', ae.amount_total)
  FROM odoo_account_entries_stock ae
  WHERE ae.journal_name = 'CAPA DE VALORACIÓN' AND ae.state = 'posted'
    AND ae.date >= '2026-07-03'  -- solo asientos posteriores al congelamiento
    AND NOT EXISTS (
      SELECT 1 FROM reconciliation_issues ri
      WHERE ri.invariant_key = 'inventory.capa_journal_activity'
        AND ri.canonical_id = ae.odoo_move_id::text
        AND ri.resolved_at IS NULL);
  GET DIAGNOSTICS v_ins = ROW_COUNT; v_count := v_count + v_ins;

  -- 3.2 saldo negativo en cuentas 115
  INSERT INTO reconciliation_issues (
    issue_id, issue_type, canonical_entity_type, canonical_entity_id, canonical_id,
    impact_mxn, severity, detected_at, invariant_key, action_cta, description, metadata
  )
  SELECT gen_random_uuid(),
         'inventory.negative_bucket',
         'account',
         g.account_code,
         g.account_code,
         ABS(g.bal),
         'critical', now(),
         'inventory.negative_bucket',
         'review_accounting',
         format('Cuenta de inventario NEGATIVA: %s ($%s). Un activo nunca puede ser negativo — categorías re-apuntadas sin asiento de transferencia.',
                g.account_code, ROUND(g.bal)),
         jsonb_build_object('account_code', g.account_code, 'balance', g.bal)
  FROM (
    SELECT account_code, SUM(balance) AS bal
    FROM odoo_account_balances WHERE account_code LIKE '115%'
    GROUP BY account_code HAVING SUM(balance) < -1000
  ) g
  WHERE NOT EXISTS (
    SELECT 1 FROM reconciliation_issues ri
    WHERE ri.invariant_key = 'inventory.negative_bucket'
      AND ri.canonical_id = g.account_code
      AND ri.resolved_at IS NULL);
  GET DIAGNOSTICS v_ins = ROW_COUNT; v_count := v_count + v_ins;

  -- 3.3 actividad en 501.01.02 (cuenta zombie) — un issue por mes con actividad
  INSERT INTO reconciliation_issues (
    issue_id, issue_type, canonical_entity_type, canonical_entity_id, canonical_id,
    impact_mxn, severity, detected_at, invariant_key, action_cta, description, metadata
  )
  SELECT gen_random_uuid(),
         'inventory.zombie_501_01_02',
         'account',
         '501.01.02:' || g.period,
         '501.01.02:' || g.period,
         g.mov,
         'high', now(),
         'inventory.zombie_501_01_02',
         'review_accounting',
         format('Actividad en 501.01.02 COSTO POR AJUSTES A CANTIDAD (%s): $%s. La cuenta debe estar en $0 — fugas de config (EMB/SP/REQP) o manuales.',
                g.period, ROUND(g.mov)),
         jsonb_build_object('period', g.period, 'debit', g.deb, 'credit', g.cred)
  FROM (
    SELECT period, SUM(debit) AS deb, SUM(credit) AS cred, SUM(debit+credit) AS mov
    FROM odoo_account_balances
    WHERE account_code = '501.01.02' AND period >= '2026-07'
    GROUP BY period HAVING SUM(debit+credit) > 1000
  ) g
  WHERE NOT EXISTS (
    SELECT 1 FROM reconciliation_issues ri
    WHERE ri.invariant_key = 'inventory.zombie_501_01_02'
      AND ri.canonical_id = '501.01.02:' || g.period
      AND ri.resolved_at IS NULL);
  GET DIAGNOSTICS v_ins = ROW_COUNT; v_count := v_count + v_ins;

  -- 3.4 asiento REAL en 999998. La fila mensual de odoo_account_balances es
  --     SINTÉTICA (utilidad neta que _push_account_balances fabrica para
  --     gold_balance_sheet — verificado 2026-07-03: cuadra al centavo con
  --     ingresos−gastos y 0 líneas reales all-time). Aquí miramos las líneas
  --     reales de lines_stock, que capturan cuentas 999% desde el fix qb19.
  INSERT INTO reconciliation_issues (
    issue_id, issue_type, canonical_entity_type, canonical_entity_id, canonical_id,
    impact_mxn, severity, detected_at, invariant_key, action_cta, description, metadata
  )
  SELECT gen_random_uuid(),
         'inventory.equity_999998_manual',
         'account_entry',
         '999998:' || g.odoo_move_id,
         '999998:' || g.odoo_move_id,
         g.mov,
         'critical', now(),
         'inventory.equity_999998_manual',
         'review_accounting',
         format('Asiento REAL en 999998 equity: %s del %s (débitos $%s / créditos $%s). Nadie debe postear ahí — la utilidad acumulada es un saldo calculado por Odoo.',
                g.name, g.date::date, ROUND(g.deb), ROUND(g.cred)),
         jsonb_build_object('odoo_move_id', g.odoo_move_id, 'name', g.name,
                            'date', g.date, 'debit', g.deb, 'credit', g.cred)
  FROM (
    SELECT e.odoo_move_id, e.name, e.date,
           SUM((ln->>'debit')::numeric)  AS deb,
           SUM((ln->>'credit')::numeric) AS cred,
           SUM((ln->>'debit')::numeric + (ln->>'credit')::numeric) AS mov
    FROM odoo_account_entries_stock e,
         jsonb_array_elements(e.lines_stock) ln
    WHERE (ln->>'account_code') = '999998'
      AND e.state = 'posted'
      AND e.date >= '2026-01-01'
    GROUP BY 1, 2, 3
    HAVING SUM((ln->>'debit')::numeric + (ln->>'credit')::numeric) > 1000
  ) g
  WHERE NOT EXISTS (
    SELECT 1 FROM reconciliation_issues ri
    WHERE ri.invariant_key = 'inventory.equity_999998_manual'
      AND ri.canonical_id = '999998:' || g.odoo_move_id
      AND ri.resolved_at IS NULL);
  GET DIAGNOSTICS v_ins = ROW_COUNT; v_count := v_count + v_ins;

  -- 3.5 drift GL vs físico por bucket (tolerancia inicial $250k; bajar a $50k
  --     post-limpieza y a $1 post-revaluación editando audit_tolerances)
  INSERT INTO reconciliation_issues (
    issue_id, issue_type, canonical_entity_type, canonical_entity_id, canonical_id,
    impact_mxn, severity, detected_at, invariant_key, action_cta, description, metadata
  )
  SELECT gen_random_uuid(),
         'inventory.gl_vs_physical_drift',
         'bucket',
         s.bucket || ':' || to_char(CURRENT_DATE, 'IYYY-IW'),
         s.bucket || ':' || to_char(CURRENT_DATE, 'IYYY-IW'),
         ABS(s.drift_mxn),
         CASE WHEN ABS(s.drift_mxn) > 2000000 THEN 'critical' ELSE 'high' END,
         now(),
         'inventory.gl_vs_physical_drift',
         'review_accounting',
         format('Drift GL vs físico en %s: $%s (GL $%s vs físico $%s). Meta post-limpieza: $0.',
                s.bucket, ROUND(s.drift_mxn), ROUND(s.gl_mxn), ROUND(s.fisico_mxn)),
         jsonb_build_object('bucket', s.bucket, 'gl', s.gl_mxn, 'fisico', s.fisico_mxn)
  FROM get_inventory_close_status() s
  CROSS JOIN LATERAL (
    SELECT COALESCE((SELECT abs_tolerance FROM audit_tolerances
                     WHERE invariant_key='inventory.gl_vs_physical_drift'), 250000) AS tol
  ) t
  WHERE ABS(s.drift_mxn) > t.tol
    AND NOT EXISTS (
      SELECT 1 FROM reconciliation_issues ri
      WHERE ri.invariant_key = 'inventory.gl_vs_physical_drift'
        AND ri.canonical_id = s.bucket || ':' || to_char(CURRENT_DATE, 'IYYY-IW')
        AND ri.resolved_at IS NULL);
  GET DIAGNOSTICS v_ins = ROW_COUNT; v_count := v_count + v_ins;

  -- auto-resolve: cuentas 115 que dejaron de estar negativas
  UPDATE reconciliation_issues ri
  SET resolved_at = now(), resolution = 'auto_balance_recovered'
  WHERE ri.invariant_key = 'inventory.negative_bucket'
    AND ri.resolved_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM (
        SELECT account_code FROM odoo_account_balances
        WHERE account_code LIKE '115%'
        GROUP BY account_code HAVING SUM(balance) < -1000
      ) neg WHERE neg.account_code = ri.canonical_id);

  -- auto-resolve: asientos 999998 que dejaron de existir posteados
  UPDATE reconciliation_issues ri
  SET resolved_at = now(), resolution = 'auto_entry_removed'
  WHERE ri.invariant_key = 'inventory.equity_999998_manual'
    AND ri.resolved_at IS NULL
    AND ri.canonical_entity_type = 'account_entry'
    AND NOT EXISTS (
      SELECT 1 FROM odoo_account_entries_stock e,
                    jsonb_array_elements(e.lines_stock) ln
      WHERE '999998:' || e.odoo_move_id = ri.canonical_id
        AND (ln->>'account_code') = '999998'
        AND e.state = 'posted');

  RETURN v_count;
END;
$fn$;

COMMENT ON FUNCTION public._check_inventory_close_guards() IS
'Guardias del Cierre de Inventario Limpio (2026-07-03b): CAPA congelado, 115 negativas, 501.01.02 zombie, 999998 con líneas REALES (la fila de odoo_account_balances es sintética = utilidad neta), drift GL-físico por bucket. pg_cron horario HH:25.';

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Resolver los falsos positivos de la versión anterior (keyed por período)
-- ─────────────────────────────────────────────────────────────────────────
UPDATE reconciliation_issues
SET resolved_at = now(), resolution = 'false_positive_synthetic_row'
WHERE invariant_key = 'inventory.equity_999998_manual'
  AND resolved_at IS NULL
  AND canonical_entity_type = 'account'; -- versión vieja usaba entity_type=account, keyed 999998:YYYY-MM

UPDATE audit_tolerances
SET notes = 'Detecta asientos REALES posteados a 999998 (lines_stock). La fila mensual de odoo_account_balances es SINTÉTICA (utilidad neta del período, fabricada por _push_account_balances para gold_balance_sheet) — NO usarla como evidencia de asientos.'
WHERE invariant_key = 'inventory.equity_999998_manual';

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Corregir la premisa del pending action (F3 de la auditoría 2026-07-02)
-- ─────────────────────────────────────────────────────────────────────────
UPDATE odoo_pending_actions
SET title = 'Incorporar el conteo físico de junio al corte final (asientos cancelados; 999998 limpia)',
    problem_description = 'CORRECCIÓN 2026-07-03: el hallazgo original decía que $3.57M del conteo de junio se reclasificaron a equity 999998. Era un FALSO POSITIVO — la fila de 999998 en odoo_account_balances es sintética (utilidad neta mensual que el sync fabrica para el balance sheet); tras extender el sync a cuentas 999% y re-push completo 2026 se verificó que existen CERO asientos reales en 999998. Lo que sí pasó: los asientos del conteo (Cantidad de producto actualizada, $6.4M de cargos) fueron CANCELADOS por el CEO, así que las diferencias físicas del conteo hoy NO están reflejadas en el GL.',
    fix_in_odoo = 'En el corte final, incorporar el resultado del conteo con destino correcto por grupo (evidencia en clasificacion-conteo-evidencia-2026.xlsx): (1) máquinas de tejer y equipo ($4.24M SIN_PRODUCTO) → verificar físicamente y dar de alta como ACTIVO FIJO, no inventario; (2) refacciones fantasma ($3.60M) → ajuste contra resultados acumulados (REA) como corrección de error de períodos anteriores (NIF B-1), no P&L del año; (3) diferencias textiles reales (neto −$520k, sobrante) → 501.01.08; (4) refacciones reales ($69k) → gasto de mantenimiento 504.01.0005.'
WHERE action_key = 'conteo-junio-reclasificado-999998';
