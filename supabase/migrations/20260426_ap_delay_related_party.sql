-- F-AP-DELAY: ajuste realista del cash projection AP por proveedor histórico.
--
-- Antes: la proyección asumía que pagamos el 100% del AP el día del due date.
-- Resultado: alarmas falsas de cash crisis porque en realidad pateamos pagos.
--
-- Ahora: por cada proveedor calcular el delay promedio histórico
--   delay = AVG(payment_date_odoo - due_date_resolved)
-- de las facturas pagadas en los últimos N meses. Cap [0, 90] para
-- evitar outliers. Aplicar ese delay al projected_date en projection.ts.
--
-- Bonus: flag `is_related_party` en canonical_companies para identificar
-- préstamos / aportaciones intercompañía que NO son AP operativo.
-- Marcamos las conocidas por RFC: Grupo Quimibond + familia Mizrahi.

-- 1) Flag is_related_party
ALTER TABLE public.canonical_companies
  ADD COLUMN IF NOT EXISTS is_related_party boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_canonical_companies_is_related_party
  ON public.canonical_companies (is_related_party)
  WHERE is_related_party = true;

-- 2) Marcar partes relacionadas conocidas por RFC
UPDATE public.canonical_companies
SET is_related_party = true
WHERE rfc IN (
  'GQU920609JNA',     -- Grupo Quimibond, S.C.
  'MITJ991130TV7',    -- José Jaime Mizrahi Tuachi
  'MIDJ4003178X9',    -- José Mizrahi Daniel
  'MIPJ691003QJ1',    -- Jacobo Mizrahi Penhos
  'AOMS630418PP1'     -- Salomón Ancona Mizrahi
);

-- 3) RPC: delay promedio AP por compañía
--
-- Devuelve, para cada emisor de AP que tenga ≥3 facturas pagadas en el
-- período de lookback, el delay promedio entre due_date y payment_date.
--
-- - delay = MAX(0, payment_date - due_date) — pagos anticipados se cuentan como 0
-- - cap a 90 días para evitar outliers
-- - sample_size para que el caller decida si confiar en el dato o no
-- - retorna company_id (companies.id) — la misma clave que usa cashflow_projection
CREATE OR REPLACE FUNCTION public.get_ap_payment_delay_v2(
  p_lookback_months integer DEFAULT 6
)
RETURNS TABLE(
  company_id bigint,
  avg_delay_days integer,
  sample_size integer,
  median_delay_days integer,
  is_related_party boolean
)
LANGUAGE sql STABLE
AS $fn$
  WITH paid AS (
    SELECT
      c.id AS company_id,
      cc.is_related_party,
      LEAST(90, GREATEST(0,
        (ci.payment_date_odoo - ci.due_date_resolved)::int
      )) AS delay_days
    FROM public.canonical_invoices ci
    JOIN public.canonical_companies cc
      ON cc.id = ci.emisor_canonical_company_id
    JOIN public.companies c
      ON c.odoo_partner_id = cc.odoo_partner_id
    WHERE ci.direction = 'received'
      AND ci.payment_state_odoo = 'paid'
      AND ci.payment_date_odoo IS NOT NULL
      AND ci.due_date_resolved IS NOT NULL
      AND ci.payment_date_odoo >= (CURRENT_DATE - (p_lookback_months || ' month')::interval)
  )
  SELECT
    company_id,
    ROUND(AVG(delay_days))::int AS avg_delay_days,
    COUNT(*)::int AS sample_size,
    (PERCENTILE_DISC(0.5) WITHIN GROUP (ORDER BY delay_days))::int AS median_delay_days,
    BOOL_OR(is_related_party) AS is_related_party
  FROM paid
  GROUP BY company_id
  HAVING COUNT(*) >= 3
$fn$;
