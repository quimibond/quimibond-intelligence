-- v4 (2026-05-08): retorna TVAR NETO (duplicación pendiente).
-- Suma Dr de líneas TVAR/ENT-REF originales y RESTA Cr de reversos
-- manuales del CEO en 501.01.02 (estructura: Cr 501.01.02 / Dr 115.x
-- + journal != "Valoración del inventario").
--
-- Asiento del CEO confirmado 2026-05-08 (abril):
--   Cr 501.01.02 COSTO POR AJUSTES A CANTIDAD  $1,016,788.77
--   Dr 115.02.01 Materia prima y materiales    $1,016,788.77
--   Concepto: TRASLADO SALDO POR SALIDA DE REFACCIONES A FABRICA
--
-- Cuando este asiento se sincronice, el RPC retornará $0 para abril.

CREATE OR REPLACE FUNCTION public.get_inventory_to_cost_dup_501_01_02(
  p_from date,
  p_to date
)
RETURNS TABLE (
  period text,
  prefix text,
  prefix_label text,
  amount_mxn numeric,
  n_lines integer
)
LANGUAGE sql
STABLE
AS $function$
  WITH tvar_dr AS (
    SELECT
      to_char(date_trunc('month', e.date), 'YYYY-MM') AS period,
      ((line->>'debit')::numeric - (line->>'credit')::numeric) AS net
    FROM public.odoo_account_entries_stock e,
         jsonb_array_elements(e.lines_stock) line
    WHERE e.date >= p_from AND e.date < p_to
      AND line->>'account_code' LIKE '501.01.02%'
      AND (line->>'debit')::numeric > 0
      AND COALESCE(
        SUBSTRING(e.ref FROM '^[A-Z/]+(?=[/0-9])'),
        SUBSTRING(line->>'name' FROM '^[A-Z/]+(?=[/0-9])')
      ) = 'TVAR'
  ),
  reversos_manual AS (
    SELECT
      to_char(date_trunc('month', e.date), 'YYYY-MM') AS period,
      -((line->>'debit')::numeric - (line->>'credit')::numeric) AS net
    FROM public.odoo_account_entries_stock e,
         jsonb_array_elements(e.lines_stock) line
    WHERE e.date >= p_from AND e.date < p_to
      AND line->>'account_code' LIKE '501.01.02%'
      AND (line->>'credit')::numeric > 0
      AND e.journal_name != 'Valoración del inventario'
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(e.lines_stock) l2
        WHERE l2->>'account_code' LIKE '115.%'
          AND (l2->>'debit')::numeric > 0
      )
  ),
  combined AS (
    SELECT period, net FROM tvar_dr
    UNION ALL
    SELECT period, net FROM reversos_manual
  )
  SELECT
    period,
    'TVAR' AS prefix,
    'Refacciones operativas TVAR (neto: Dr originales − Cr reversos)' AS prefix_label,
    SUM(net)::numeric AS amount_mxn,
    COUNT(*)::integer AS n_lines
  FROM combined
  GROUP BY period
  HAVING ABS(SUM(net)) > 1
  ORDER BY period;
$function$;
