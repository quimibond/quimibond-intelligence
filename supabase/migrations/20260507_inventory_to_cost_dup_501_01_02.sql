-- Audit 2026-05-07 (extensión): generaliza el RPC de TVAR a TODOS los
-- patrones de duplicación inventario→501.01.02. El audit completo
-- reveló 4 patrones (TVAR + TL/ENC + SP/ + TL/REQP/) que cubren el
-- 100% del 501.01.02 YTD ($4.15M YTD 2026):
--
--   TVAR     $2,865,800 (69.0%)  Refacciones operativas
--   SP/      $  775,057 (18.7%)  Empaque (bolsas, tubos cartón)
--   TL/ENC// $  425,056 (10.2%)  Encogimientos textiles
--   TL/REQP/ $   52,012 ( 1.3%)  Requisición producción
--   Otros TL $   37,068 ( 0.9%)  Misc Tlatelolco
--
-- Todos siguen el flujo Dr 501.01.02 / Cr 115.* y todos son duplicación
-- bajo el régimen actual (P&L limpio usa costo BOM-MP recursivo, que ya
-- incluye estas MPs/refacciones/empaque vía AVCO de compras).
--
-- Por contexto: post-1-abril-2026 RSI56 fue archivado, por lo que
-- 501.01.02 (cuenta de cierre histórica para CAPA mensual) debería
-- estar prácticamente vacía. Los $4.15M YTD son todo duplicación.
--
-- Pending action: refacciones-tvar-doble-conteo-501-01-02 (extendida)

DROP FUNCTION IF EXISTS public.get_tvar_amount_501_01_02(date, date);

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
  WITH lines AS (
    SELECT
      to_char(date_trunc('month', e.date), 'YYYY-MM') AS period,
      COALESCE(
        SUBSTRING(e.ref FROM '^[A-Z/]+(?=[/0-9])'),
        SUBSTRING(line->>'name' FROM '^[A-Z/]+(?=[/0-9])')
      ) AS raw_prefix,
      ((line->>'debit')::numeric - (line->>'credit')::numeric) AS net
    FROM public.odoo_account_entries_stock e,
         jsonb_array_elements(e.lines_stock) line
    WHERE e.date >= p_from AND e.date < p_to
      AND line->>'account_code' LIKE '501.01.02%'
      AND (line->>'debit')::numeric > 0
  )
  SELECT
    period,
    COALESCE(raw_prefix, 'OTROS') AS prefix,
    CASE
      WHEN raw_prefix = 'TVAR' THEN 'Refacciones (agujas, bombas, EPP, etc.)'
      WHEN raw_prefix LIKE 'TL/ENC%' THEN 'Encogimientos textiles (proceso)'
      WHEN raw_prefix LIKE 'SP/%' OR raw_prefix = 'SP' THEN 'Empaque (bolsas, tubos cartón)'
      WHEN raw_prefix LIKE 'TL/REQP%' THEN 'Requisición producción (MP/PT a línea)'
      WHEN raw_prefix LIKE 'TL%' THEN 'Otros movimientos Tlatelolco'
      ELSE 'Otros patrones'
    END AS prefix_label,
    SUM(net)::numeric AS amount_mxn,
    COUNT(*)::integer AS n_lines
  FROM lines
  GROUP BY period, raw_prefix
  ORDER BY period, ABS(SUM(net)) DESC;
$function$;
