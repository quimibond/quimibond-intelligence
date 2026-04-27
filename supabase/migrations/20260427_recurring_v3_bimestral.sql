-- F5+ v3: separa SAR/INFONAVIT bimestral del IMSS/ISR retenido mensual.
--
-- Audit 2026-04-27 finding #6.
-- Already applied to production via execute_safe_ddl on 2026-04-27.
--
-- ANTES (v2, 20260425_cash_projection_recurring_v2_taxes.sql):
--   `impuestos_sat` agrupaba TODO en una sola línea mensual día 17 del
--   mes siguiente:
--     501.06.0020-23 (cuotas patronales IMSS/SAR/INFONAVIT)
--   + 602.26-29, 603.26-29 (retenciones e ISR sueldos)
--
--   Problema: SAR (.0021) e INFONAVIT (.0022) NO son mensuales — el SUA
--   los entera bimestralmente cada 2 meses (feb, abr, jun, ago, oct, dic
--   con corte al día 17). El v2 los proyectaba cada mes, lo que infla
--   ~$200-400k MXN en meses non-pago (impares: ene, mar, may, jul, sep, nov)
--   y deflama meses pares.
--
-- AHORA (v3): split en dos categorías separadas:
--
--   imss_isr_mensual = 501.06.0020 (IMSS patrón)
--                    + 501.06.0023 (cuotas misc. mensuales)
--                    + 602.26-29 + 603.26-29 (retenciones e ISR)
--                    → mensual día 17 mes siguiente.
--
--   sar_infonavit_bimestral = 501.06.0021 (SAR/RCV)
--                           + 501.06.0022 (INFONAVIT)
--                           → bimestral día 17 mes par (feb/abr/jun/ago/oct/dic).
--                           Como el accrual GL es mensual pero el cash pago es
--                           bimestral, el monto a pagar = (avg mensual × 2).
--
-- ASSUMPTION: el mapping de subcuentas .0020-23 sigue convención Quimibond
-- (.0020=IMSS, .0021=SAR/RCV, .0022=INFONAVIT, .0023=otras cuotas mensuales).
-- Si la realidad difiere (verificar `canonical_account_balances` con
-- `account_code LIKE '501.06.002%'` + nombres), revisar y ajustar.
--
-- Resto de categorías (nómina pura, renta, servicios, arrendamiento,
-- ventas_proyectadas) sin cambios respecto a v2.

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
    -- IMSS patrón + ISR retenido + ISN: MENSUAL día 17
    (SELECT COALESCE(AVG(monthly), 0)::numeric FROM (
      SELECT period, SUM(balance) AS monthly
      FROM public.canonical_account_balances, lookback lb
      WHERE deprecated = false
        AND (
          account_code LIKE '501.06.0020%' OR account_code LIKE '501.06.0023%' OR
          account_code LIKE '602.26%' OR account_code LIKE '602.27%' OR
          account_code LIKE '602.28%' OR account_code LIKE '602.29%' OR
          account_code LIKE '603.26%' OR account_code LIKE '603.27%' OR
          account_code LIKE '603.28%' OR account_code LIKE '603.29%'
        )
        AND period >= lb.from_month AND period <= lb.to_month
      GROUP BY period
    ) t) AS imss_isr_mensual,
    -- SAR + INFONAVIT: BIMESTRAL día 17 meses pares
    -- accrual mensual GL → pago bimestral (×2)
    (SELECT COALESCE(AVG(monthly), 0)::numeric FROM (
      SELECT period, SUM(balance) AS monthly
      FROM public.canonical_account_balances, lookback lb
      WHERE deprecated = false
        AND (
          account_code LIKE '501.06.0021%' OR
          account_code LIKE '501.06.0022%'
        )
        AND period >= lb.from_month AND period <= lb.to_month
      GROUP BY period
    ) t) AS sar_infonavit_monthly_accrual,
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
  -- IMSS patrón + ISR retenido + ISN: MENSUAL día 17 mes siguiente
  SELECT
    (hm.month_start + interval '1 month' + interval '16 day')::date,
    'impuestos_sat', 'IMSS + ISR retenido (mensual)', 'recurring_outflow',
    ma.imss_isr_mensual::numeric, 1.0,
    'IMSS patrón (.0020) + retenciones ISR/ISN. Día 17 mes siguiente.'
  FROM horizon_months hm, monthly_avg ma
  WHERE (hm.month_start + interval '1 month' + interval '16 day')::date BETWEEN CURRENT_DATE AND (CURRENT_DATE + (p_horizon_days || ' day')::interval)::date
    AND ma.imss_isr_mensual > 0
  UNION ALL
  -- SAR + INFONAVIT: BIMESTRAL día 17 meses pares (feb/abr/jun/ago/oct/dic)
  -- El pago cubre 2 meses de accrual → ma.sar_infonavit_monthly_accrual × 2
  SELECT
    (hm.month_start + interval '1 month' + interval '16 day')::date,
    'sar_infonavit', 'SAR + INFONAVIT (bimestral)', 'recurring_outflow',
    (ma.sar_infonavit_monthly_accrual * 2)::numeric, 1.0,
    'Cuotas patronales SAR/RCV (.0021) + INFONAVIT (.0022). Día 17 meses pares.'
  FROM horizon_months hm, monthly_avg ma
  WHERE (hm.month_start + interval '1 month' + interval '16 day')::date BETWEEN CURRENT_DATE AND (CURRENT_DATE + (p_horizon_days || ' day')::interval)::date
    -- mes pago = mes_siguiente_de_acumulación. Pago en feb/abr/jun/ago/oct/dic
    -- (es decir, cuando month_start del horizonte es ene/mar/may/jul/sep/nov)
    AND EXTRACT(MONTH FROM hm.month_start)::int IN (1, 3, 5, 7, 9, 11)
    AND ma.sar_infonavit_monthly_accrual > 0
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
