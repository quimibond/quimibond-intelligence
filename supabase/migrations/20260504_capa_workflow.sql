-- CAPA workflow — calculadora del ajuste mensual
--
-- Mientras 501.01.01 reciba el auto-COGS de Odoo (que viene inflado por
-- overhead embebido en standard_price), cada mes hay que hacer un ajuste
-- manual ("CAPA de Valoración") para llevar el saldo de 501.01.01 al
-- costo MP real recursivo BOM.
--
-- Componente UI: /contabilidad/cuenta/501.01.01 muestra calculadora +
-- asiento sugerido + history. Pending action 'monthly-capa-workflow'
-- documenta el proceso paso a paso.

-- RPC: suma neta de movimientos a 501.01.01 desde el journal CAPA
CREATE OR REPLACE FUNCTION public.get_capa_posted_per_month(
  p_from_period text,
  p_to_period text
)
RETURNS TABLE(period text, net_capa numeric)
LANGUAGE sql STABLE
AS $function$
WITH lines AS (
  SELECT
    to_char(e.date, 'YYYY-MM') AS period,
    COALESCE((line->>'debit')::numeric, 0) AS debit,
    COALESCE((line->>'credit')::numeric, 0) AS credit
  FROM public.odoo_account_entries_stock e,
       jsonb_array_elements(e.lines_stock) AS line
  WHERE e.date >= (p_from_period || '-01')::date
    AND e.date < (date_trunc('month', (p_to_period || '-01')::date) + interval '1 month')::date
    AND e.journal_name = 'CAPA DE VALORACIÓN'
    AND line->>'account_code' = '501.01.01'
)
SELECT
  period,
  ROUND(SUM(debit - credit)::numeric, 2) AS net_capa
FROM lines
GROUP BY period
ORDER BY period DESC;
$function$;

-- Pending action específica: workflow mensual de CAPA
INSERT INTO public.odoo_pending_actions
(action_key, area, severity, title, problem_description, fix_in_odoo, workaround_in_silver, estimated_impact_mxn, evidence_url, assignee)
VALUES (
  'monthly-capa-workflow',
  'contabilidad',
  'high',
  'Workflow mensual: ajuste CAPA en Odoo para alinear 501.01.01 con costo MP real',
  'Mientras 501.01.01 reciba el auto-COGS de Odoo (que viene inflado por overhead embebido en standard_price), cada mes hay que hacer un ajuste manual ("CAPA de Valoración") para llevar el saldo de 501.01.01 al costo MP real recursivo BOM. Hoy solo se hace de forma esporádica e incompleta — abril 2026: residual fue $1.82M pero el ajuste registrado fue solo $62k. Sin este workflow disciplinado, el P&L contable de cada mes queda sistemáticamente con utilidad falsa.',
  'PROCESO MENSUAL (último día hábil del mes, después del cierre de facturación):

1. Abrir /contabilidad/cuenta/501.01.01?from=YYYY-MM&to=YYYY-MM en el sistema. La sección "CAPA del mes a aplicar" muestra el monto exacto a remover.

2. En Odoo, ir a Accounting → Journal Entries → New.

3. Crear el asiento con:
   - Journal: "CAPA DE VALORACIÓN"
   - Date: último día del mes (ej. 2026-04-30)
   - Reference: "Ajuste CAPA overhead [Mes] [Año]"
   - Lines (donde X = residual del mes):
     * Línea 1: Cr 501.01.01 Cost of sales       $X
     * Línea 2: Dr 504.01.0099 Overhead absorbido $X
       (si la cuenta no existe, crearla primero — ver paso 0)

4. Validar (Post) el asiento.

5. Verificar en el sistema que /contabilidad/cuenta/501.01.01 ahora muestra residual ≈ $0.

PASO 0 (solo primera vez): crear cuenta 504.01.0099 "Overhead absorbido CAPA"
- Tipo: expense_direct_cost
- Padre: 504.01 OVERHEAD FÁBRICA

ALTERNATIVA — si tu contadora prefiere:
   * Línea 2 alterna: Dr 115.04.01 Productos terminados $X
     (regresa overhead al inventario)
Esto es el patrón que ya usas hoy ($62k abril). Es válido pero crea
inventario "fantasma" de overhead — preferible 504.01.0099 si quieres
visibilidad clara del overhead absorbido en P&L.

¿CUÁL ES EL MONTO EXACTO DE X?
El sistema lo calcula así:
  X = saldo neto 501.01.01 del mes
      − costo MP real recursivo BOM del mes
      − ajustes CAPA ya posteados en el mes

Verlo en /contabilidad/cuenta/501.01.01 (sección "CAPA del mes a aplicar").',
  'El P&L LIMPIO ya muestra el número correcto (swap 501.01.01 ↔ BOM). Pero el P&L CONTABLE oficial sigue inflado hasta que se hagan los CAPA mensuales. Para conciliar libros vs realidad sin esperar el fix Odoo de fondo (acción reclassify-501-01-01-as-mp), este workflow es el puente.',
  1820000,
  '/contabilidad/cuenta/501.01.01?from=2026-04&to=2026-04',
  'Contadora (mensual)'
)
ON CONFLICT (action_key) DO UPDATE SET
  title = EXCLUDED.title,
  problem_description = EXCLUDED.problem_description,
  fix_in_odoo = EXCLUDED.fix_in_odoo,
  workaround_in_silver = EXCLUDED.workaround_in_silver,
  estimated_impact_mxn = EXCLUDED.estimated_impact_mxn,
  evidence_url = EXCLUDED.evidence_url;
