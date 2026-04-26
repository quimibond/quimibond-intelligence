-- F5+ v2: cash projection con calendario fiscal SAT/IMSS separado de nómina.
--
-- ANTES (v1, 20260425_cash_projection_recurring.sql):
--   nómina = 501.06.* + 602.01.* + 603.01.* (todo junto, día 15 + último)
--   Esto mezclaba sueldos puros (~$2.76M) con cuotas IMSS/SAR/INFONAVIT/ISR
--   retenido (~$0.65M) que se pagan en distinto día.
--
-- AHORA (v2):
--   nómina         = 501.06.* (excluyendo .0020-.0023) + 602.01-25 + 603.01-25
--                    Solo sueldos puros, día 15 + último día.
--   impuestos_sat  = 501.06.0020-0023 + 602.26-29 + 603.26-29 + retenciones
--                    IMSS / SAR / INFONAVIT / ISN / ISR retenido sueldos.
--                    Día 17 del mes siguiente (calendario SAT estándar).
--
-- Validación 2026 (lookback 3 meses ene-mar):
--   Nómina pura mensual:    ~$2.76M (antes era ~$3.21M)
--   Impuestos SAT mensual:  ~$0.65M (nuevo, no estaba)
--   Total laboral:          ~$3.41M (mismo total, mejor distribuido en calendario)
--
-- Cuentas categorizadas (actualizadas):
--   Nómina pura: 501.06.0001-0019 + 501.06.0024+ + 602.01-25 + 603.01-25
--   Impuestos:   501.06.0020-23 (cuotas patronales) +
--                602.26-29 + 603.26-29 (retenciones e impuestos s/nómina)
--   Renta:       504.01.0008 + 603.45.*
--   Servicios:   504.01.0002/0003/0004/0005/0023/0035/0040/0042/0043
--   Arrendam.:   701.11.*
--   Ventas:      4xx (negar — son income credit-normal)

CREATE OR REPLACE FUNCTION public.get_cash_projection_recurring(
  p_horizon_days integer DEFAULT 90,
  p_lookback_months integer DEFAULT 3
)
RETURNS TABLE(
  projected_date date,
  category text,
  category_label text,
  flow_type text,
  amount_mxn numeric,
  probability numeric,
  notes text
)
LANGUAGE sql STABLE
AS $fn$
WITH lookback AS (
  SELECT
    to_char(date_trunc('month', (CURRENT_DATE - (p_lookback_months || ' month')::interval))::date, 'YYYY-MM') AS from_month,
    to_char((date_trunc('month', CURRENT_DATE) - interval '1 day')::date, 'YYYY-MM') AS to_month
),
monthly_avg AS (
  SELECT
    -- Nómina PURA (sin cuotas IMSS/SAR/INFONAVIT ni retenciones)
    (SELECT COALESCE(AVG(monthly), 0)::numeric FROM (
      SELECT period, SUM(balance) AS monthly
      FROM public.canonical_account_balances, lookback lb
      WHERE deprecated = false
        AND (
          (account_code LIKE '501.06%'
            AND account_code NOT LIKE '501.06.0020%'
            AND account_code NOT LIKE '501.06.0021%'
            AND account_code NOT LIKE '501.06.0022%'
            AND account_code NOT LIKE '501.06.0023%')
          OR (account_code LIKE '602.01%' OR account_code LIKE '602.02%' OR account_code LIKE '602.03%' OR
              account_code LIKE '602.04%' OR account_code LIKE '602.05%' OR account_code LIKE '602.06%' OR
              account_code LIKE '602.07%' OR account_code LIKE '602.08%' OR account_code LIKE '602.09%' OR
              account_code LIKE '602.10%' OR account_code LIKE '602.11%' OR account_code LIKE '602.12%' OR
              account_code LIKE '602.13%' OR account_code LIKE '602.14%' OR account_code LIKE '602.15%' OR
              account_code LIKE '602.16%' OR account_code LIKE '602.17%' OR account_code LIKE '602.18%' OR
              account_code LIKE '602.19%' OR account_code LIKE '602.20%' OR account_code LIKE '602.21%' OR
              account_code LIKE '602.22%' OR account_code LIKE '602.23%' OR account_code LIKE '602.24%' OR
              account_code LIKE '602.25%')
          OR (account_code LIKE '603.01%' OR account_code LIKE '603.02%' OR account_code LIKE '603.03%' OR
              account_code LIKE '603.04%' OR account_code LIKE '603.05%' OR account_code LIKE '603.06%' OR
              account_code LIKE '603.07%' OR account_code LIKE '603.08%' OR account_code LIKE '603.09%' OR
              account_code LIKE '603.10%' OR account_code LIKE '603.11%' OR account_code LIKE '603.12%' OR
              account_code LIKE '603.13%' OR account_code LIKE '603.14%' OR account_code LIKE '603.15%' OR
              account_code LIKE '603.16%' OR account_code LIKE '603.17%' OR account_code LIKE '603.18%' OR
              account_code LIKE '603.19%' OR account_code LIKE '603.20%' OR account_code LIKE '603.21%' OR
              account_code LIKE '603.22%' OR account_code LIKE '603.23%' OR account_code LIKE '603.24%' OR
              account_code LIKE '603.25%')
        )
        AND period >= lb.from_month AND period <= lb.to_month
      GROUP BY period
    ) t) AS nomina,
    -- Impuestos SAT/IMSS (cuotas patronales + retenciones e ISN)
    (SELECT COALESCE(AVG(monthly), 0)::numeric FROM (
      SELECT period, SUM(balance) AS monthly
      FROM public.canonical_account_balances, lookback lb
      WHERE deprecated = false
        AND (
          account_code LIKE '501.06.0020%' OR account_code LIKE '501.06.0021%' OR
          account_code LIKE '501.06.0022%' OR account_code LIKE '501.06.0023%' OR
          account_code LIKE '602.26%' OR account_code LIKE '602.27%' OR
          account_code LIKE '602.28%' OR account_code LIKE '602.29%' OR
          account_code LIKE '603.26%' OR account_code LIKE '603.27%' OR
          account_code LIKE '603.28%' OR account_code LIKE '603.29%'
        )
        AND period >= lb.from_month AND period <= lb.to_month
      GROUP BY period
    ) t) AS impuestos_sat,
    (SELECT COALESCE(AVG(monthly), 0)::numeric FROM (
      SELECT period, SUM(balance) AS monthly
      FROM public.canonical_account_balances, lookback lb
      WHERE deprecated = false
        AND (account_code LIKE '504.01.0008%' OR account_code LIKE '603.45%')
        AND period >= lb.from_month AND period <= lb.to_month
      GROUP BY period
    ) t) AS renta,
    (SELECT COALESCE(AVG(monthly), 0)::numeric FROM (
      SELECT period, SUM(balance) AS monthly
      FROM public.canonical_account_balances, lookback lb
      WHERE deprecated = false
        AND (
          account_code LIKE '504.01.0002%' OR account_code LIKE '504.01.0003%' OR
          account_code LIKE '504.01.0004%' OR account_code LIKE '504.01.0005%' OR
          account_code LIKE '504.01.0023%' OR account_code LIKE '504.01.0035%' OR
          account_code LIKE '504.01.0040%' OR account_code LIKE '504.01.0042%' OR
          account_code LIKE '504.01.0043%'
        )
        AND period >= lb.from_month AND period <= lb.to_month
      GROUP BY period
    ) t) AS servicios,
    (SELECT COALESCE(AVG(monthly), 0)::numeric FROM (
      SELECT period, SUM(balance) AS monthly
      FROM public.canonical_account_balances, lookback lb
      WHERE deprecated = false AND account_code LIKE '701.11%'
        AND period >= lb.from_month AND period <= lb.to_month
      GROUP BY period
    ) t) AS arrendamiento,
    (SELECT COALESCE(-AVG(monthly), 0)::numeric FROM (
      SELECT period, SUM(balance) AS monthly
      FROM public.canonical_account_balances, lookback lb
      WHERE deprecated = false AND balance_sheet_bucket = 'income' AND account_code LIKE '4%'
        AND period >= lb.from_month AND period <= lb.to_month
      GROUP BY period
    ) t) AS ventas
),
ar_total AS (
  SELECT COALESCE(SUM(amount_residual_mxn_resolved), 0)::numeric AS total
  FROM public.canonical_invoices
  WHERE direction = 'issued' AND amount_residual_mxn_resolved > 0
    AND COALESCE(estado_sat, '') <> 'cancelado'
),
dso_calc AS (
  SELECT GREATEST(15, LEAST(120,
    CASE WHEN ma.ventas > 0 THEN ROUND(ar.total / (ma.ventas / 30)) ELSE 60 END
  ))::int AS days
  FROM monthly_avg ma, ar_total ar
),
horizon_months AS (
  SELECT generate_series(
    date_trunc('month', CURRENT_DATE)::date,
    (CURRENT_DATE + (p_horizon_days || ' day')::interval)::date,
    interval '1 month'
  )::date AS month_start
),
all_flows AS (
  -- Nómina pura: día 15
  SELECT
    (hm.month_start + interval '14 day')::date AS pdate,
    'nomina'::text AS pcat, 'Nómina (quincena 15)'::text AS plabel,
    'recurring_outflow'::text AS pflow,
    (ma.nomina / 2)::numeric AS pamount, 1.0::numeric AS pprob,
    'Sueldos sin IMSS/ISR. Día 15.'::text AS pnotes
  FROM horizon_months hm, monthly_avg ma
  WHERE (hm.month_start + interval '14 day')::date BETWEEN CURRENT_DATE AND (CURRENT_DATE + (p_horizon_days || ' day')::interval)::date
    AND ma.nomina > 0
  UNION ALL
  -- Nómina pura: último día del mes
  SELECT
    (hm.month_start + interval '1 month' - interval '1 day')::date,
    'nomina', 'Nómina (quincena fin de mes)', 'recurring_outflow',
    (ma.nomina / 2)::numeric, 1.0, 'Sueldos sin IMSS/ISR. Último día.'
  FROM horizon_months hm, monthly_avg ma
  WHERE (hm.month_start + interval '1 month' - interval '1 day')::date BETWEEN CURRENT_DATE AND (CURRENT_DATE + (p_horizon_days || ' day')::interval)::date
    AND ma.nomina > 0
  UNION ALL
  -- Impuestos SAT/IMSS: día 17 del mes SIGUIENTE (calendario fiscal)
  SELECT
    (hm.month_start + interval '1 month' + interval '16 day')::date,
    'impuestos_sat', 'Impuestos SAT/IMSS (cuotas + retenciones)', 'recurring_outflow',
    ma.impuestos_sat::numeric, 1.0,
    'IMSS/SAR/INFONAVIT + ISR retenido + ISN. Día 17 mes siguiente.'
  FROM horizon_months hm, monthly_avg ma
  WHERE (hm.month_start + interval '1 month' + interval '16 day')::date BETWEEN CURRENT_DATE AND (CURRENT_DATE + (p_horizon_days || ' day')::interval)::date
    AND ma.impuestos_sat > 0
  UNION ALL
  SELECT hm.month_start, 'renta', 'Renta del local', 'recurring_outflow',
    ma.renta::numeric, 1.0, 'Día 1 del mes'
  FROM horizon_months hm, monthly_avg ma
  WHERE hm.month_start BETWEEN CURRENT_DATE AND (CURRENT_DATE + (p_horizon_days || ' day')::interval)::date
    AND ma.renta > 0
  UNION ALL
  SELECT (hm.month_start + interval '9 day')::date,
    'servicios', 'Servicios (energía/agua/gas/mtto)', 'recurring_outflow',
    ma.servicios::numeric, 1.0, 'Día 10 del mes'
  FROM horizon_months hm, monthly_avg ma
  WHERE (hm.month_start + interval '9 day')::date BETWEEN CURRENT_DATE AND (CURRENT_DATE + (p_horizon_days || ' day')::interval)::date
    AND ma.servicios > 0
  UNION ALL
  SELECT (hm.month_start + interval '4 day')::date,
    'arrendamiento', 'Arrendamiento financiero', 'recurring_outflow',
    ma.arrendamiento::numeric, 1.0, 'Día 5 del mes'
  FROM horizon_months hm, monthly_avg ma
  WHERE (hm.month_start + interval '4 day')::date BETWEEN CURRENT_DATE AND (CURRENT_DATE + (p_horizon_days || ' day')::interval)::date
    AND ma.arrendamiento > 0
  UNION ALL
  SELECT gen.day::date,
    'ventas_proyectadas', 'Cobranza ventas futuras', 'recurring_inflow',
    (ma.ventas / 30 * 0.85)::numeric, 0.85,
    ('Run rate × 85% (DSO ' || d.days || 'd)')::text
  FROM monthly_avg ma, dso_calc d,
    LATERAL generate_series(
      CURRENT_DATE + (d.days || ' day')::interval,
      CURRENT_DATE + (p_horizon_days || ' day')::interval,
      interval '1 day'
    ) gen(day)
  WHERE ma.ventas > 0
)
SELECT pdate, pcat, plabel, pflow, pamount, pprob, pnotes
FROM all_flows
ORDER BY pdate, pcat;
$fn$;
