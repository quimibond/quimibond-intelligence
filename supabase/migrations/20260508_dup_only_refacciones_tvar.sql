-- Audit 2026-05-08: refinamiento del filtro de duplicación. Verificación
-- con CEO confirmó que SOLO refacciones (TVAR) duplican gasto. Empaque
-- (SP/), encogimientos (TL/ENC) y requisición (TL/REQP) son flujo NORMAL
-- de inventario (compra entra a 115.x, sale a 501.01.02 al consumir =
-- una sola vez al P&L).
--
-- Las refacciones SÍ duplican porque su factura va directo a 504.01.x
-- (gasto operativo) Y además crea entrada al inventario que sale a
-- 501.01.02 al consumirse → triple punto / duplicación.
--
-- Validación 2026-05-08 con compras YTD 2026:
--   EMPAQUE (Tubo/Bolsa/Etiq) → 97% va a 115.x   ← NO duplica
--   REFACC. (Aguja/Motor/etc) → 95% va a 504.x   ← SÍ duplica
--   MP TEXT.                  → 99.97% va a 115.x ← NO duplica
--
-- CEO posteó asiento de ajuste 2026-05-08: Cr 501.01.02 / Dr 115.x
-- (revaluar inventario refacciones físicas que perdieron valor por
-- el TVAR contable). Pending action sigue abierta hasta que se
-- reconfigure Odoo para que las refacciones NO dupliquen.
--
-- v3 ajusta filtro a SOLO 'TVAR' prefix (excluye SP/, TL/ENC, TL/REQP).
-- YTD 2026 nuevo: $2,865,800 (era $4,154,994 antes).

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
      -- Filtro v3: SOLO refacciones (TVAR) duplican gasto.
      -- Empaque (SP/), encogimientos (TL/ENC), requisición (TL/REQP)
      -- son flujo normal de inventario y NO se filtran del P&L limpio.
      AND COALESCE(
        SUBSTRING(e.ref FROM '^[A-Z/]+(?=[/0-9])'),
        SUBSTRING(line->>'name' FROM '^[A-Z/]+(?=[/0-9])')
      ) = 'TVAR'
  )
  SELECT
    period,
    COALESCE(raw_prefix, 'OTROS') AS prefix,
    'Refacciones operativas (TVAR/ENT-REF)' AS prefix_label,
    SUM(net)::numeric AS amount_mxn,
    COUNT(*)::integer AS n_lines
  FROM lines
  GROUP BY period, raw_prefix
  ORDER BY period;
$function$;
