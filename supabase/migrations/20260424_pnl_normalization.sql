-- F-PNL-NORM: P&L normalization adjustments.
--
-- Detecta one-offs y ajustes year-end para separar la operación core
-- de eventos no recurrentes. Cada categoría retorna:
--   amount_mxn         — monto bruto de la cuenta(s) en el período
--   impact_on_utility  — signo CFO de quitar este ajuste
--                        positivo = la utilidad normalizada SUBE
--                        negativo = la utilidad normalizada BAJA
--   detected           — boolean, si supera el umbral material
--
-- Categorías:
--   1. venta_activo_fijo (704.23.0003 + 701.01.0004): siempre one-off,
--      la ganancia INFLA la utilidad reportada → impact = -gain
--   2. siniestros_incobrables (701.01.0003/05/06): pérdidas no recurrentes,
--      DEFLATAN reportada → impact = -loss (positivo si era loss)
--   3. otros_ingresos_extraordinarios (704.23.0001 si > $500k):
--      INFLA reportada → impact = -ingreso
--   4. ajuste_inventario_year_end (501.01.02 atípico):
--      catch-up que INFLA gastos del mes → impact = +exceso
--   5. depreciacion_catch_up (504.08-23 + 613 atípico):
--      INFLA gastos del mes → impact = +exceso
--
-- Detección de "atípico" (ajustes 4 y 5):
--   Para cada mes en el rango, comparar el monto vs un umbral derivado
--   del promedio mensual del período × multiplicador. Cualquier exceso
--   sobre ese umbral cuenta como "atípico" (catch-up year-end).
--
-- Multiplicadores hardcoded:
--   501.01.02: 5× promedio o $1M (lo mayor)
--   depreciación: 3× promedio o $500k (lo mayor)

CREATE OR REPLACE FUNCTION public.get_pnl_normalization_adjustments(
  p_date_from date,
  p_date_to date
)
RETURNS TABLE(
  category text,
  category_label text,
  account_codes text[],
  amount_mxn numeric,
  impact_on_utility_mxn numeric,
  reason text,
  detected boolean
)
LANGUAGE sql STABLE
AS $fn$
WITH bounds AS (
  SELECT
    to_char(p_date_from, 'YYYY-MM') AS from_month,
    to_char((p_date_to - interval '1 day')::date, 'YYYY-MM') AS to_month
),
balances AS (
  SELECT cab.account_code, cab.period, cab.balance, cab.account_type
  FROM public.canonical_account_balances cab, bounds b
  WHERE cab.deprecated = false
    AND cab.period >= b.from_month
    AND cab.period <= b.to_month
),
venta_activo AS (
  SELECT COALESCE(-SUM(balance), 0)::numeric AS net_gain
  FROM balances
  WHERE account_code = '704.23.0003' OR account_code = '701.01.0004'
),
siniestros AS (
  SELECT COALESCE(-SUM(balance), 0)::numeric AS impact
  FROM balances
  WHERE account_code IN ('701.01.0003','701.01.0005','701.01.0006')
),
otros_ingresos AS (
  SELECT COALESCE(-SUM(balance), 0)::numeric AS amount
  FROM balances
  WHERE account_code = '704.23.0001'
),
inv_501_01_02 AS (
  SELECT period, COALESCE(SUM(balance), 0) AS monthly
  FROM balances
  WHERE account_code = '501.01.02'
  GROUP BY period
),
inv_normal AS (
  SELECT COALESCE(AVG(monthly), 0) AS avg_normal FROM inv_501_01_02
),
inv_outliers AS (
  SELECT COALESCE(SUM(GREATEST(0, monthly - GREATEST(ABS(avg_normal) * 5, 1000000))), 0)::numeric AS extra
  FROM inv_501_01_02, inv_normal
),
dep_monthly AS (
  SELECT period, COALESCE(SUM(balance), 0) AS monthly
  FROM balances
  WHERE (account_code LIKE '504.0%' OR account_code LIKE '504.1%' OR account_code LIKE '504.2%' OR account_code LIKE '613%')
    AND account_type = 'expense_depreciation'
  GROUP BY period
),
dep_normal AS (
  SELECT COALESCE(AVG(monthly), 0) AS avg_normal FROM dep_monthly
),
dep_outliers AS (
  SELECT COALESCE(SUM(GREATEST(0, monthly - GREATEST(ABS(avg_normal) * 3, 500000))), 0)::numeric AS extra
  FROM dep_monthly, dep_normal
)
SELECT * FROM (
  SELECT 'venta_activo_fijo'::text, 'Venta de activo fijo (one-off)'::text,
    ARRAY['704.23.0003','701.01.0004']::text[], net_gain, -net_gain,
    'Ingresos por venta de maquinaria/activos. No es operación recurrente.'::text,
    (ABS(net_gain) > 100)::boolean
  FROM venta_activo
  UNION ALL
  SELECT 'siniestros_incobrables', 'Siniestros y cuentas incobrables (one-off)',
    ARRAY['701.01.0003','701.01.0005','701.01.0006'], impact, -impact,
    'Pérdidas por siniestros materiales o cuentas incobrables. Eventos no recurrentes.',
    (ABS(impact) > 100)
  FROM siniestros
  UNION ALL
  SELECT 'otros_ingresos_extraordinarios', 'Otros ingresos 704.23.0001 (extraordinarios)',
    ARRAY['704.23.0001'], amount, -amount,
    'Otros ingresos no clasificados como venta. Suele ser ingresos no recurrentes.',
    (ABS(amount) > 500000)
  FROM otros_ingresos
  UNION ALL
  SELECT 'ajuste_inventario_year_end', 'Ajuste de inventario year-end (501.01.02 atípico)',
    ARRAY['501.01.02'], extra, extra,
    'Reclasificación de costo de inventario en cierre anual. Es ajuste contable, no costo recurrente.',
    (extra > 500000)
  FROM inv_outliers
  UNION ALL
  SELECT 'depreciacion_catch_up', 'Catch-up de depreciación year-end',
    ARRAY['504.08','504.09','504.10','504.11','504.23','613'], extra, extra,
    'Depreciación excesiva concentrada en un mes. Si la asignación correcta es mensual, este catch-up infla el gasto del mes.',
    (extra > 500000)
  FROM dep_outliers
) t;
$fn$;
