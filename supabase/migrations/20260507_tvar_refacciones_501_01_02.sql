-- Audit 2026-05-07: refacciones TVAR/ENT-REF duplicando 501.01.02.
--
-- Hallazgo del CEO: refacciones (agujas, bombas, válvulas, EPP, laptops,
-- equipo de mantenimiento) entran a 501.01.02 al darse de baja con flujo:
--   Dr 501.01.02 COSTO PRIMO  / Cr 115.02.* INVENTARIO REFACCIONES
--
-- Pero estas refacciones YA se registraron contablemente al momento de
-- la compra (probablemente como gasto en 504.01.* o equivalente), por
-- lo que el cargo a 501.01.02 al consumirse es DOBLE CONTEO.
--
-- Cuantificación YTD 2026:
--   Ene: $316,976  (42% de 501.01.02)
--   Feb: $905,908  (76%)
--   Mar: $624,966  (62%)
--   Abr: $1,016,789 (85%)
--   YTD: $2,864,639 — 126 asientos, 69% del 501.01.02 total
--
-- Plan del CEO (ver pending action refacciones-tvar-doble-conteo-501-01-02):
--   1. Postear asientos de ajuste por mes para limpiar duplicado YTD
--   2. Crear cuenta dedicada (ej. 115.05.*) para inventario refacciones
--      operativas que NO impacte 501.* al consumir
--   3. Reconfigurar categoría de productos TVAR en Odoo (Stock Output
--      Account → cuenta de gasto operativo, no 501.01.02)
--
-- Workaround silver: get_tvar_amount_501_01_02(p_from, p_to) retorna
-- el monto TVAR del período. pnl.ts lo expone como cogs501_01_02TvarMxn
-- y cogs501_01_02CleanMxn, y el P&L limpio usa el clean (sin duplicado).

CREATE OR REPLACE FUNCTION public.get_tvar_amount_501_01_02(
  p_from date,
  p_to date
)
RETURNS TABLE (
  period text,
  tvar_amount_mxn numeric,
  n_lines integer,
  n_moves integer
)
LANGUAGE sql
STABLE
AS $function$
  WITH lines AS (
    SELECT
      to_char(date_trunc('month', e.date), 'YYYY-MM') AS period,
      e.odoo_move_id,
      ((line->>'debit')::numeric - (line->>'credit')::numeric) AS net
    FROM public.odoo_account_entries_stock e,
         jsonb_array_elements(e.lines_stock) line
    WHERE e.date >= p_from AND e.date < p_to
      AND line->>'account_code' LIKE '501.01.02%'
      AND line->>'name' ~ '^TVAR/ENT-REF'
  )
  SELECT period, SUM(net)::numeric AS tvar_amount_mxn,
         COUNT(*)::integer AS n_lines,
         COUNT(DISTINCT odoo_move_id)::integer AS n_moves
  FROM lines
  GROUP BY period
  ORDER BY period;
$function$;
