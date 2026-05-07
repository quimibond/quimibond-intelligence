-- Audit 2026-05-07: shrinkage de refacciones en 501.01.08 (continuación
-- del audit de duplicación inventario→501.01.02).
--
-- Hallazgo del CEO: 501.01.08 (DIFERENCIAS POR CONTEO) tiene ajustes
-- manuales de inventario ("Cantidad de producto actualizada"). Aunque
-- en concepto 501.01.08 es shrinkage físico legítimo, una porción son
-- AJUSTES SOBRE PRODUCTOS REFACCIÓN (motores, formatos, módulos,
-- pinturas, EPP, etc.) que ya se contabilizaron como gasto al comprar
-- — mismo bug que TVAR. Pegar el faltante a P&L es triple conteo.
--
-- Cuantificación YTD 2026:
--   Refacciones (duplicación):  $235k netos  (todo abril por conteo físico)
--   MP/PT/químicos textil:      $200k netos  (shrinkage real legítimo)
--   501.01.08 total:            $435k netos
--
-- El neto bruto fue $4.6M Dr y $4.2M Cr — ene tuvo el conteo físico
-- anual (cuadró cerca de cero). Abril destacó con $254k netos de
-- faltantes de refacciones.
--
-- Este RPC retorna el subset de refacciones para excluirlo del P&L
-- limpio. El shrinkage textil/MP real (~$200k YTD) se mantiene como
-- pérdida legítima.
--
-- Pending action: refacciones-tvar-doble-conteo-501-01-02

CREATE OR REPLACE FUNCTION public.get_refacciones_dup_501_01_08(
  p_from date,
  p_to date
)
RETURNS TABLE (
  period text,
  refacciones_amount_mxn numeric,
  faltantes numeric,
  sobrantes numeric,
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
      AND line->>'account_code' LIKE '501.01.08%'
      AND (line->>'name') ~* 'MOTOR|FORMATO|MODULO|PINTURA|PTR |CABLE|VALVULA|BOMBA|AGUJA|RODILLO|FILTRO|BANDA |RESISTENCIAS|VARIADOR|TRAMPA|GATO |LAMPARA|CONTACTOR|LLAVE|ACEITE|ZAPATO|PANTALON|PLAYERA|TARIMA|PASTILLA|ETIQUETA|LAPTOP|MINI PC|SERVOMOTOR|INTERRUPTOR|TUBO GALVANIZADO|TUBO CARTON|CARTON'
  )
  SELECT period,
         SUM(net)::numeric AS refacciones_amount_mxn,
         SUM(GREATEST(net, 0))::numeric AS faltantes,
         SUM(GREATEST(-net, 0))::numeric AS sobrantes,
         COUNT(*)::integer AS n_lines,
         COUNT(DISTINCT odoo_move_id)::integer AS n_moves
  FROM lines
  GROUP BY period
  ORDER BY period;
$function$;
