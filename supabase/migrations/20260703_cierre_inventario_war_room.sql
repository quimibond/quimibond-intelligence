-- Cierre de Inventario Limpio — war room (2026-07-03)
--
-- Fuente: docs/audit-2026-07-02-inventario-contabilidad.md (plan Fase 4 adelantada).
-- Piezas:
--   1. get_inventory_close_status()  — cuadre en vivo GL vs físico por bucket (norte: $0.00)
--   2. get_inventory_close_alarms()  — alarmas de reincidencia (CAPA, 999998, 501.01.02, 115 negativas)
--   3. _check_inventory_close_guards() — invariantes en el motor (reconciliation_issues → CEO inbox),
--      pg_cron horario. Dedup por (invariant_key, canonical_id) con resolved_at IS NULL.
--
-- El "físico" usa odoo_products.stock_qty × avg_cost (valuación viva de Odoo).
-- El bucket se deriva de la categoría (misma clasificación de la auditoría 2026-07-02).

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Cuadre en vivo por bucket
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_inventory_close_status()
RETURNS TABLE (
  bucket text,
  cuentas text,
  gl_mxn numeric,
  fisico_mxn numeric,
  drift_mxn numeric,
  skus integer
)
LANGUAGE sql STABLE AS $$
WITH fis AS (
  SELECT
    CASE
      WHEN p.category ILIKE '%refacc%' THEN 'refacciones'
      WHEN p.category ILIKE 'Producto en Proceso%' THEN 'semiterminados'
      WHEN p.category ILIKE 'Producto Terminado%' THEN 'producto_terminado'
      ELSE 'materia_prima_otros'
    END AS b,
    SUM(p.stock_qty * COALESCE(p.avg_cost, 0)) AS v,
    COUNT(*)::int AS n
  FROM odoo_products p
  WHERE p.active AND p.stock_qty <> 0
  GROUP BY 1
),
gl AS (
  SELECT
    CASE
      WHEN account_code = '115.02.02' THEN 'refacciones'
      WHEN account_code LIKE '115.03%' THEN 'wip_y_semiterminados'
      WHEN account_code LIKE '115.04%' THEN 'producto_terminado'
      WHEN account_code = '115.01.01' THEN 'cuenta_115_01_hueco'
      ELSE 'materia_prima_otros'
    END AS b,
    SUM(balance) AS v
  FROM odoo_account_balances
  WHERE account_code LIKE '115%'
  GROUP BY 1
)
SELECT * FROM (
  SELECT 'Materia prima / otros'::text, '115.02.01'::text,
         ROUND(COALESCE((SELECT v FROM gl WHERE b='materia_prima_otros'),0)),
         ROUND(COALESCE((SELECT v FROM fis WHERE b='materia_prima_otros'),0)),
         ROUND(COALESCE((SELECT v FROM gl WHERE b='materia_prima_otros'),0) - COALESCE((SELECT v FROM fis WHERE b='materia_prima_otros'),0)),
         COALESCE((SELECT n FROM fis WHERE b='materia_prima_otros'),0)
  UNION ALL
  SELECT 'Refacciones', '115.02.02',
         ROUND(COALESCE((SELECT v FROM gl WHERE b='refacciones'),0)),
         ROUND(COALESCE((SELECT v FROM fis WHERE b='refacciones'),0)),
         ROUND(COALESCE((SELECT v FROM gl WHERE b='refacciones'),0) - COALESCE((SELECT v FROM fis WHERE b='refacciones'),0)),
         COALESCE((SELECT n FROM fis WHERE b='refacciones'),0)
  UNION ALL
  SELECT 'WIP + Semiterminados', '115.03.01 (+115.03.02 futura)',
         ROUND(COALESCE((SELECT v FROM gl WHERE b='wip_y_semiterminados'),0)),
         ROUND(COALESCE((SELECT v FROM fis WHERE b='semiterminados'),0)),
         ROUND(COALESCE((SELECT v FROM gl WHERE b='wip_y_semiterminados'),0) - COALESCE((SELECT v FROM fis WHERE b='semiterminados'),0)),
         COALESCE((SELECT n FROM fis WHERE b='semiterminados'),0)
  UNION ALL
  SELECT 'Producto terminado', '115.04.01',
         ROUND(COALESCE((SELECT v FROM gl WHERE b='producto_terminado'),0)),
         ROUND(COALESCE((SELECT v FROM fis WHERE b='producto_terminado'),0)),
         ROUND(COALESCE((SELECT v FROM gl WHERE b='producto_terminado'),0) - COALESCE((SELECT v FROM fis WHERE b='producto_terminado'),0)),
         COALESCE((SELECT n FROM fis WHERE b='producto_terminado'),0)
  UNION ALL
  SELECT '115.01.01 Inventario (a cerrar)', '115.01.01',
         ROUND(COALESCE((SELECT v FROM gl WHERE b='cuenta_115_01_hueco'),0)),
         0,
         ROUND(COALESCE((SELECT v FROM gl WHERE b='cuenta_115_01_hueco'),0)),
         0
) t(bucket, cuentas, gl_mxn, fisico_mxn, drift_mxn, skus);
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Alarmas de reincidencia (ventana configurable, default 30 días)
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
-- 2.2 999998: movimiento fuera del cierre automático de enero
SELECT '999998: movimiento manual a equity', 'critical',
       ROUND(SUM(debit + credit)), COUNT(*)::int,
       'Débitos $' || ROUND(SUM(debit))::text || ' / créditos $' || ROUND(SUM(credit))::text ||
       ' en ' || string_agg(DISTINCT period, ', ')
FROM odoo_account_balances
WHERE account_code = '999998'
  AND period >= to_char(CURRENT_DATE - p_days, 'YYYY-MM')
  AND RIGHT(period, 2) <> '01'
  AND (debit > 1000 OR credit > 1000)
HAVING SUM(debit + credit) > 1000
UNION ALL
-- 2.3 501.01.02 COSTO PRIMO: debe estar muerta
SELECT '501.01.02 COSTO PRIMO: actividad en cuenta zombie', 'high',
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
-- 3. Invariantes en el motor de reconciliación (mismo patrón que
--    _sp11_check_accounting_without_move, 20260428)
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
         format('Actividad en 501.01.02 COSTO PRIMO (%s): $%s. La cuenta debe estar en $0 — fugas de config (EMB/SP/REQP) o manuales.',
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

  -- 3.4 movimiento manual a 999998 (fuera de enero = cierre automático)
  INSERT INTO reconciliation_issues (
    issue_id, issue_type, canonical_entity_type, canonical_entity_id, canonical_id,
    impact_mxn, severity, detected_at, invariant_key, action_cta, description, metadata
  )
  SELECT gen_random_uuid(),
         'inventory.equity_999998_manual',
         'account',
         '999998:' || g.period,
         '999998:' || g.period,
         g.mov,
         'critical', now(),
         'inventory.equity_999998_manual',
         'review_accounting',
         format('Movimiento en 999998 equity fuera del cierre automático (%s): débitos $%s / créditos $%s. Solo Odoo debe moverla.',
                g.period, ROUND(g.deb), ROUND(g.cred)),
         jsonb_build_object('period', g.period, 'debit', g.deb, 'credit', g.cred)
  FROM (
    SELECT period, SUM(debit) AS deb, SUM(credit) AS cred, SUM(debit+credit) AS mov
    FROM odoo_account_balances
    WHERE account_code = '999998' AND period >= '2026-07' AND RIGHT(period,2) <> '01'
    GROUP BY period HAVING SUM(debit+credit) > 1000
  ) g
  WHERE NOT EXISTS (
    SELECT 1 FROM reconciliation_issues ri
    WHERE ri.invariant_key = 'inventory.equity_999998_manual'
      AND ri.canonical_id = '999998:' || g.period
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

  RETURN v_count;
END;
$fn$;

COMMENT ON FUNCTION public._check_inventory_close_guards() IS
'Guardias del Cierre de Inventario Limpio (2026-07-03): CAPA congelado, 115 negativas, 501.01.02 zombie, 999998 manual, drift GL-físico por bucket. pg_cron horario HH:25. Ver docs/audit-2026-07-02-inventario-contabilidad.md.';



-- Config de tolerancias (editable sin migración)
INSERT INTO audit_tolerances (invariant_key, abs_tolerance, pct_tolerance, severity_default, entity, enabled, auto_resolve, check_cadence, notes)
VALUES
 ('inventory.capa_journal_activity', 0, 0, 'critical', 'account_entry', true, false, 'hourly', 'Journal CAPA congelado por CEO 2026-07-02. Cualquier asiento nuevo es violación de política.'),
 ('inventory.negative_bucket', 1000, 0, 'critical', 'account', true, true, 'hourly', 'Saldo negativo en cuentas 115.* — imposible para un activo.'),
 ('inventory.zombie_501_01_02', 1000, 0, 'high', 'account', true, true, 'hourly', 'COSTO PRIMO debe quedar en $0 permanente tras el fix de config EMB/SP/REQP/TVAR.'),
 ('inventory.equity_999998_manual', 1000, 0, 'critical', 'account', true, false, 'hourly', 'Solo el cierre automático (enero) mueve 999998.'),
 ('inventory.gl_vs_physical_drift', 250000, 0, 'high', 'bucket', true, true, 'hourly', 'Tolerancia inicial $250k. Bajar a $50k post-limpieza (Fase 2) y a $1 post-revaluación (Fase 3).')
ON CONFLICT (invariant_key) DO NOTHING;

-- pg_cron horario (después del push de Odoo :00 y el rebuild de balances)
SELECT cron.schedule(
  'inventory_close_guards_hourly',
  '25 * * * *',
  'SELECT _check_inventory_close_guards()'
);
