-- F-AR-DELAY: ajuste realista del cash projection AR por cliente histórico.
--
-- Antes: la proyección asumía cobranza en el due date (con probabilidad
-- por aging bucket genérico). Resultado: el chart muestra inflows que
-- llegan antes de cuando realmente cobramos.
--
-- Ahora: por cada cliente calcular delay promedio histórico
--   delay = AVG(payment_date_odoo - due_date_resolved)
-- de las facturas pagadas en los últimos N meses. Cap [0, 180] (algunos
-- clientes pagan hasta 6 meses tarde). Aplicar al projected_date en
-- projection.ts. La probabilidad por aging bucket se mantiene — es
-- ortogonal al delay (uno mide cuándo, el otro cuánto).
--
-- Validación 2026 (lookback 6 meses):
--   116 clientes con histórico, 965 facturas pagadas
--   Mediana delay: 9 días, p75: 28 días, max: 172 días
--   Promedio ponderado: 22 días después del vencimiento

CREATE OR REPLACE FUNCTION public.get_ar_collection_delay_v2(
  p_lookback_months integer DEFAULT 6
)
RETURNS TABLE(
  company_id bigint,
  avg_delay_days integer,
  sample_size integer,
  median_delay_days integer
)
LANGUAGE sql STABLE
AS $fn$
  WITH paid AS (
    SELECT
      c.id AS company_id,
      LEAST(180, GREATEST(0,
        (ci.payment_date_odoo - ci.due_date_resolved)::int
      )) AS delay_days
    FROM public.canonical_invoices ci
    JOIN public.canonical_companies cc
      ON cc.id = ci.receptor_canonical_company_id
    JOIN public.companies c
      ON c.odoo_partner_id = cc.odoo_partner_id
    WHERE ci.direction = 'issued'
      AND ci.payment_state_odoo = 'paid'
      AND ci.payment_date_odoo IS NOT NULL
      AND ci.due_date_resolved IS NOT NULL
      AND ci.payment_date_odoo >= (CURRENT_DATE - (p_lookback_months || ' month')::interval)
  )
  SELECT
    company_id,
    ROUND(AVG(delay_days))::int AS avg_delay_days,
    COUNT(*)::int AS sample_size,
    (PERCENTILE_DISC(0.5) WITHIN GROUP (ORDER BY delay_days))::int AS median_delay_days
  FROM paid
  GROUP BY company_id
  HAVING COUNT(*) >= 3
$fn$;
