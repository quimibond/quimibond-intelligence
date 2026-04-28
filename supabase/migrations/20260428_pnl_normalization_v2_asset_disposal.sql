-- F-PNL-NORM v2: separar baja_activo_fijo_book_value de depreciacion_catch_up
--
-- Hallazgo 2026-04-28 (audit P&L 2025): el contador carga el book value
-- remanente de activos vendidos en la cuenta de DEPRECIACIÓN original
-- (504.08.0001 para maquinaria), no en una cuenta de costo.
--
-- Caso 2025: dic-25 muestra $5,903,236 en 504.08.0001 (vs ~$91K mensual
-- normal) — exactamente el book value del activo cuya utilidad de venta
-- se reportó en 704.23.0003 como $5,896,997. Diferencia $6K (round-trip).
--
-- v1 detectaba esto como "Catch-up depreciación year-end" — etiqueta
-- engañosa. v2 separa:
--
--   * baja_activo_fijo_book_value: spike de depreciación en meses CON
--     venta activo fijo (704.23.0003 > $500K) → re-etiquetado correcto
--   * depreciacion_catch_up:       spike en meses SIN venta activo →
--     genuine year-end catch-up
--
-- Mejora adicional: el baseline de depreciación ahora EXCLUYE meses con
-- venta activo. v1 promediaba todos los meses (incluyendo dec-25 con
-- $6.25M), inflando el avg y bajando el umbral. Resultado v1: detectaba
-- solo $3.10M de los $5.90M reales. v2 detecta $4.52M (más preciso).
--
-- Validación 2025 post-fix:
--   * venta_activo_fijo:           -$5,896,997  (utilidad - one-off)
--   * baja_activo_fijo_book_value: +$4,516,218  (book value writeoff)
--   * otros_ingresos_extraord:     -$1,254,522
--   * ajuste_inventario_year_end:  +$6,499,555
--   * depreciacion_catch_up:       $0 (ya no hay falso positivo)
--   ─────────────────────────────────────────────
--   Total impact:                  +$3,864,253
--
--   Utilidad reportada:    $41,052,229
--   Utilidad NORMALIZADA:  $44,916,483 (era $43,498,411 con v1)

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
-- Mes a mes de venta activo fijo (para correlacionar con depreciación)
venta_activo_monthly AS (
  SELECT period, COALESCE(-SUM(balance), 0) AS sale_gain
  FROM balances
  WHERE account_code = '704.23.0003' OR account_code = '701.01.0004'
  GROUP BY period
),
asset_sale_months AS (
  SELECT period FROM venta_activo_monthly WHERE sale_gain > 500000
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
-- Baseline EXCLUYE meses con venta de activo (donde el book value writeoff
-- distorsiona el promedio). v1 incluía todos los meses, inflando el avg
-- y subdetectando el spike real.
dep_normal AS (
  SELECT COALESCE(AVG(monthly), 0) AS avg_normal
  FROM dep_monthly
  WHERE period NOT IN (SELECT period FROM asset_sale_months)
),
dep_threshold AS (
  SELECT GREATEST(ABS(avg_normal) * 3, 500000) AS thresh FROM dep_normal
),
-- Spike en meses CON venta activo = book value writeoff (re-label)
dep_writeoff AS (
  SELECT COALESCE(SUM(GREATEST(0, dm.monthly - t.thresh)), 0)::numeric AS extra
  FROM dep_monthly dm, dep_threshold t
  WHERE dm.period IN (SELECT period FROM asset_sale_months)
),
-- Spike en meses SIN venta activo = catch-up real de depreciación
dep_catch_up_real AS (
  SELECT COALESCE(SUM(GREATEST(0, dm.monthly - t.thresh)), 0)::numeric AS extra
  FROM dep_monthly dm, dep_threshold t
  WHERE dm.period NOT IN (SELECT period FROM asset_sale_months)
)
SELECT * FROM (
  SELECT 'venta_activo_fijo'::text, 'Venta de activo fijo (one-off)'::text,
    ARRAY['704.23.0003','701.01.0004']::text[], net_gain, -net_gain,
    'Ingresos por venta de maquinaria/activos. No es operación recurrente. Net económico = utilidad reportada (book value y precio venta se compensan).'::text,
    (ABS(net_gain) > 100)::boolean
  FROM venta_activo
  UNION ALL
  SELECT 'baja_activo_fijo_book_value', 'Costo en libros de activo vendido (one-off)',
    ARRAY['504.08','504.09','504.10','504.11','504.22','504.23'], extra, extra,
    'Cuando Quimibond vende un activo fijo, el book value remanente se carga a la cuenta de depreciación original (no a 502). Detectado por correlación con 704.23.0003 en mismo período. Es one-off, no depreciación recurrente.',
    (extra > 500000)
  FROM dep_writeoff
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
  SELECT 'depreciacion_catch_up', 'Catch-up de depreciación year-end (sin venta activo)',
    ARRAY['504.08','504.09','504.10','504.11','504.22','504.23','613'], extra, extra,
    'Depreciación excesiva concentrada en un mes que NO coincide con venta de activo fijo. Si la asignación correcta es mensual, este catch-up infla el gasto del mes.',
    (extra > 500000)
  FROM dep_catch_up_real
) t;
$fn$;
