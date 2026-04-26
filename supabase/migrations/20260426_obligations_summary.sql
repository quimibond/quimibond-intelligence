-- F-OBL: vista única de obligaciones totales.
--
-- Consolida todas las obligaciones financieras pendientes al cierre del mes
-- especificado, agrupadas en categorías accionables para el CEO:
--
--   1. Tarjetas de crédito       (204.*)
--   2. Proveedores nacionales    (201.01.*)
--   3. Proveedores extranjeros   (201.02.*)
--   4. Acreedores diversos       (205.*  no arrendamiento)
--   5. Arrendamiento financiero  (205.02.0002 + 205.02.0003 + 250.*)
--   6. IVA por pagar             (208.* + 209.*)
--   7. Sueldos por pagar         (210.*)
--   8. IMSS/INFONAVIT por pagar  (211.*)
--   9. ISR/Retenciones SAT       (216.*)
--   10. Préstamos bancarios CP   (252.*  liability_current)
--   11. Préstamos bancarios LP   (252.*  liability_non_current)
--
-- "Saldos acumulados": SUM(balance) hasta el corte (canonical_account_balances
-- almacena MOVIMIENTOS por mes, no acumulados; ver get_cash_reconciliation).
--
-- Signo display: outstanding_mxn > 0 = obligación pendiente.
-- Cuentas con saldo prácticamente cero (|cum| < 100) o positivo (anticipo
-- nuestro a la contraparte) se excluyen del top.
--
-- 206.* (anticipos de clientes) no son obligación real de pago — los excluimos.

CREATE OR REPLACE FUNCTION public.get_obligations_summary(
  p_as_of_period text DEFAULT NULL
)
RETURNS TABLE(
  category text,
  category_label text,
  outstanding_mxn numeric,
  account_count integer,
  payment_horizon text,
  detail jsonb
)
LANGUAGE sql STABLE
AS $fn$
WITH cutoff AS (
  SELECT COALESCE(p_as_of_period,
    to_char((date_trunc('month', CURRENT_DATE) - interval '1 day')::date, 'YYYY-MM')
  ) AS period
),
cumulative AS (
  SELECT
    cab.account_code,
    MAX(cab.account_name) AS account_name,
    SUM(cab.balance) AS cumulative_balance,
    MAX(cab.balance_sheet_bucket) AS bucket,
    MAX(cab.account_type) AS account_type
  FROM public.canonical_account_balances cab, cutoff c
  WHERE cab.deprecated = false
    AND cab.period <= c.period
  GROUP BY cab.account_code
),
classified AS (
  SELECT
    account_code,
    account_name,
    account_type,
    -- Para pasivos: balance es credit-normal (negativo). Outstanding = -balance.
    -- Si outstanding negativo (= balance positivo), es contra-cuenta o anticipo,
    -- lo dejamos pero no se considera obligación.
    (-cumulative_balance)::numeric AS outstanding,
    CASE
      WHEN account_code LIKE '204%' THEN 'tarjetas'
      WHEN account_code LIKE '201.01%' THEN 'ap_nacional'
      WHEN account_code LIKE '201.02%' THEN 'ap_extranjero'
      WHEN account_code LIKE '205.02.0002%' OR account_code LIKE '205.02.0003%'
        OR account_code LIKE '250%' THEN 'arrendamiento'
      WHEN account_code LIKE '205%' THEN 'acreedores_diversos'
      WHEN account_code LIKE '208%' OR account_code LIKE '209%' THEN 'iva'
      WHEN account_code LIKE '210%' THEN 'sueldos'
      WHEN account_code LIKE '211%' THEN 'imss_infonavit'
      WHEN account_code LIKE '216%' THEN 'isr_retenciones'
      WHEN account_code LIKE '252%' AND account_type = 'liability_non_current' THEN 'prestamos_lp'
      WHEN account_code LIKE '252%' THEN 'prestamos_cp'
      WHEN account_code LIKE '206%' THEN 'anticipos_clientes'
      WHEN account_code LIKE '219%' OR account_code LIKE '220%' THEN 'otros_lp'
      ELSE 'otros'
    END AS category
  FROM cumulative
  WHERE bucket = 'liability'
),
agg AS (
  SELECT
    category,
    SUM(GREATEST(outstanding, 0)) AS outstanding_total,
    COUNT(*) FILTER (WHERE outstanding > 100) AS cuentas_count,
    jsonb_agg(
      jsonb_build_object(
        'account_code', account_code,
        'account_name', account_name,
        'outstanding_mxn', ROUND(outstanding::numeric, 2)
      )
      ORDER BY outstanding DESC
    ) FILTER (WHERE outstanding > 1000) AS detail_arr
  FROM classified
  GROUP BY category
)
SELECT
  cat.category,
  cat.label,
  COALESCE(a.outstanding_total, 0)::numeric AS outstanding_mxn,
  COALESCE(a.cuentas_count, 0)::integer AS account_count,
  cat.horizon,
  COALESCE(a.detail_arr, '[]'::jsonb) AS detail
FROM (VALUES
  ('tarjetas',            'Tarjetas de crédito',                  'inmediato', 1),
  ('imss_infonavit',      'IMSS / INFONAVIT por pagar',           '30d_sat',   2),
  ('isr_retenciones',     'ISR / Retenciones SAT',                '30d_sat',   3),
  ('iva',                 'IVA por pagar',                        '30d_sat',   4),
  ('sueldos',             'Sueldos por pagar',                    'inmediato', 5),
  ('ap_nacional',         'Proveedores nacionales',               '30_60d',    6),
  ('ap_extranjero',       'Proveedores extranjeros',              '30_60d',    7),
  ('acreedores_diversos', 'Acreedores diversos',                  '30_60d',    8),
  ('arrendamiento',       'Arrendamiento financiero',             'mensual',   9),
  ('prestamos_cp',        'Préstamos bancarios (CP)',             'meses',     10),
  ('prestamos_lp',        'Préstamos bancarios (LP)',             'lp',        11),
  ('otros_lp',            'Otros pasivos LP',                     'lp',        12)
) AS cat(category, label, horizon, sort_order)
LEFT JOIN agg a ON a.category = cat.category
ORDER BY cat.sort_order;
$fn$;
