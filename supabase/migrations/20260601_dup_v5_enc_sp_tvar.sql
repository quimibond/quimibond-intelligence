-- v5 (2026-06-01): Amplía la duplicación a TVAR + TL/ENC + SP/
--
-- TL/ENC// (encogimiento textil): Odoo registra el encogimiento como
--   Dr 501.01.02 / Cr 115.x (Valoración del inventario). Esto clasifica
--   el shrinkage textil como COSTO PRIMO cuando debería ser un ajuste de
--   inventario (115.x). El BOM recursivo ya absorbe el yield real de la
--   materia prima — el encogimiento en 501.01.02 es duplicación.
--   YTD 2026: $425k (263 líneas).
--
-- SP/ (scrap/desecho): Al desechar material con SP/, Odoo genera
--   Dr 501.01.02 / Cr 115.02.01 (Valoración del inventario). El material
--   ya fue expensado al comprar (Dr 504.x). El desecho crea una segunda
--   carga al P&L. YTD 2026: $775k (202 líneas).
--
-- TVAR/ENT-REF (refacciones): sin cambio respecto a v4. Sigue neteando
--   vs. reversos manuales del CEO (Cr 501.01.02 / Dr 115.x, journal !=
--   'Valoración del inventario'). YTD 2026 neto ≈ $1.8M pendiente.
--
-- Total YTD 2026 con v5: ~$3M (TVAR $1.8M + ENC $425k + SP $775k).
-- vs. v4 ($2.9M solo TVAR bruto antes de neting).

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
  WITH dup_dr AS (
    -- Dr entries in 501.01.02 for the 3 duplicate patterns
    SELECT
      to_char(date_trunc('month', e.date), 'YYYY-MM') AS period,
      CASE
        WHEN e.ref LIKE 'TVAR%' THEN 'TVAR'
        WHEN e.ref LIKE 'TL/ENC%' THEN 'TL/ENC'
        WHEN e.ref LIKE 'SP/%' THEN 'SP/'
        ELSE NULL
      END AS prefix,
      ((line->>'debit')::numeric - (line->>'credit')::numeric) AS net
    FROM public.odoo_account_entries_stock e,
         jsonb_array_elements(e.lines_stock) line
    WHERE e.date >= p_from AND e.date < p_to
      AND line->>'account_code' LIKE '501.01.02%'
      AND (line->>'debit')::numeric > 0
      AND (e.ref LIKE 'TVAR%' OR e.ref LIKE 'TL/ENC%' OR e.ref LIKE 'SP/%')
  ),
  -- CEO manual reversals: Cr 501.01.02 / Dr 115.x from non-inventory journals
  -- (e.g. "TRASLADO SALDO POR SALIDA DE REFACCIONES A FABRICA").
  -- These correct the duplicate, so they net against TVAR.
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
    -- TVAR entries netted with CEO reversals
    SELECT period, 'TVAR' AS prefix, net FROM dup_dr WHERE prefix = 'TVAR'
    UNION ALL
    SELECT period, 'TVAR' AS prefix, net FROM reversos_manual
    -- ENC and SP/ entries (no reversals applied yet)
    UNION ALL
    SELECT period, prefix, net FROM dup_dr WHERE prefix IN ('TL/ENC', 'SP/')
  )
  SELECT
    period,
    prefix,
    CASE prefix
      WHEN 'TVAR'   THEN 'Refacciones operativas (TVAR/ENT-REF)'
      WHEN 'TL/ENC' THEN 'Encogimiento textil (TL/ENC//)'
      WHEN 'SP/'    THEN 'Desecho/scrap empaque y materiales (SP/)'
      ELSE prefix
    END AS prefix_label,
    SUM(net)::numeric AS amount_mxn,
    COUNT(*)::integer AS n_lines
  FROM combined
  GROUP BY period, prefix
  HAVING ABS(SUM(net)) > 1
  ORDER BY period, prefix;
$function$;
