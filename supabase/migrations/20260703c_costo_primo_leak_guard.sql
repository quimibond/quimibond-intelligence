-- Guardia: asientos operativos (TL/*) tocando costo primo 501.01.0x (2026-07-03)
--
-- Hallazgo (forense 2026-07-03): los asientos "TL/OP-TEJ - Mano de obra" del
-- workcenter Tejido eran CIRCULARES desde el go-live (cargo y abono a 115.03.01,
-- $3.03M may + $1.13M jun, efecto neto cero — la absorción nunca operó). El
-- ~30-jun la cuenta del abono cambió a 501.01.01 COSTO PRIMO: capitaliza WIP
-- pero contamina el costo primo y rompe la calibración costo primo = recetas.
-- Además TL/EMB ($442,537) y TL/REQP ($7,977) pegan a 501.01.02.
-- Fix real en Odoo: cuenta de absorción dedicada (501.06.90) en el workcenter
-- + cuentas de salida de categorías/tipos de operación. Pending actions:
-- workcenter-mano-obra-cuenta-absorcion, categorias-salida-501-emb-reqp.
CREATE OR REPLACE FUNCTION public._check_costo_primo_leak()
RETURNS integer LANGUAGE plpgsql AS $fn$
DECLARE v_count integer := 0;
BEGIN
  INSERT INTO reconciliation_issues (
    issue_id, issue_type, canonical_entity_type, canonical_entity_id, canonical_id,
    impact_mxn, severity, detected_at, invariant_key, action_cta, description, metadata
  )
  SELECT gen_random_uuid(), 'inventory.costo_primo_leak', 'account_entry',
         g.odoo_move_id::text, g.odoo_move_id::text,
         g.mov, 'high', now(), 'inventory.costo_primo_leak', 'review_accounting',
         format('Asiento operativo %s (%s, %s) toca %s por $%s — debería mover cuentas 115 o una cuenta de absorción dedicada, no costo primo. Config de workcenter/categoría.',
                g.name, left(g.ref,40), g.date::date, g.cuentas, ROUND(g.mov)),
         jsonb_build_object('name', g.name, 'ref', g.ref, 'date', g.date, 'cuentas', g.cuentas)
  FROM (
    SELECT e.odoo_move_id, e.name, e.ref, e.date,
           string_agg(DISTINCT ln->>'account_code', ',') AS cuentas,
           SUM((ln->>'debit')::numeric + (ln->>'credit')::numeric) AS mov
    FROM odoo_account_entries_stock e, jsonb_array_elements(e.lines_stock) ln
    WHERE e.state = 'posted' AND e.date >= '2026-06-25'
      AND e.ref ~* '^TL/'
      AND (ln->>'account_code') IN ('501.01.01','501.01.02')
      AND ((ln->>'debit')::numeric + (ln->>'credit')::numeric) > 50
    GROUP BY 1,2,3,4
  ) g
  WHERE NOT EXISTS (
    SELECT 1 FROM reconciliation_issues ri
    WHERE ri.invariant_key = 'inventory.costo_primo_leak'
      AND ri.canonical_id = g.odoo_move_id::text
      AND ri.resolved_at IS NULL);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END; $fn$;

INSERT INTO audit_tolerances (invariant_key, abs_tolerance, pct_tolerance, severity_default, entity, enabled, auto_resolve, check_cadence, notes)
VALUES ('inventory.costo_primo_leak', 50, 0, 'high', 'account_entry', true, false, 'hourly',
        'Asientos TL/* (producción/embarque/requisición) tocando 501.01.01/02. Fix real: cuenta de absorción del workcenter + cuentas de salida de categorías. Detectado 2026-07-03.')
ON CONFLICT (invariant_key) DO NOTHING;

SELECT cron.schedule('inventory_costo_primo_leak_hourly', '26 * * * *',
                     'SELECT _check_costo_primo_leak()');
