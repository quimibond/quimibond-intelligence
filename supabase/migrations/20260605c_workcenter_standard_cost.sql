-- 2026-06-05c: costo estándar normalizado por centro de trabajo, mes con mes.
--
-- El GL contable es lumpy: la renta se paga cuando hay flujo (un mes $0, el
-- siguiente al doble), hay reversos de cierre anual (dic-2025 −$7.6M en renta)
-- y la energía se factura con rezago. Para fijar el costo/hora de un workcenter
-- en Odoo NO sirve el mes contable — hay que normalizar.
--
-- Tabla de config editable (horas-máquina objetivo + % depreciación de
-- maquinaria atribuible) + RPC que devuelve los componentes mes con mes con la
-- renta CONTRACTUAL fija (rent_lot_assignment) en vez del GL.

CREATE TABLE IF NOT EXISTS public.workcenter_cost_config (
  cost_center_code text PRIMARY KEY,
  n_machines integer,
  machine_deprec_pct numeric NOT NULL DEFAULT 0,   -- % del 504.08 (maquinaria) atribuible al centro
  target_machine_hours numeric,                    -- horas-máquina/mes objetivo (editable)
  workcenter_name_pattern text,                    -- ILIKE para sumar horas de odoo_workorders
  notes text,
  updated_at timestamptz DEFAULT now()
);

INSERT INTO public.workcenter_cost_config
  (cost_center_code, n_machines, machine_deprec_pct, target_machine_hours, workcenter_name_pattern, notes)
VALUES
  ('TEJIDO', 40, 50, 10200, '%CIRCULAR%',
   'Depreciación: 50% del 504.08 (CONFIRMAR con registro de activo fijo). Horas objetivo: tracking mayo-2026 ~10,200/mes.')
ON CONFLICT (cost_center_code) DO NOTHING;

CREATE OR REPLACE FUNCTION public.get_cost_center_cost_monthly(p_cost_center text, p_months_back integer DEFAULT 18)
RETURNS TABLE(
  mes text, mod_mxn numeric, renta_mxn numeric, energia_servicios_mxn numeric,
  mantto_otros_mxn numeric, deprec_maquinaria_mxn numeric, total_fabril_mxn numeric,
  horas_maquina numeric, costs_hour numeric, employee_costs_hour numeric, total_hour numeric
)
LANGUAGE sql STABLE AS $function$
WITH months AS (
  SELECT to_char(gs,'YYYY-MM') AS mes
  FROM generate_series(date_trunc('month',CURRENT_DATE)-(p_months_back-1)*interval '1 month',
    date_trunc('month',CURRENT_DATE), interval '1 month') gs
),
cfg AS (SELECT * FROM public.workcenter_cost_config WHERE cost_center_code=p_cost_center),
renta AS (
  SELECT COALESCE(SUM(monthly_amount_mxn*allocation_pct/100.0),0) AS r
  FROM public.rent_lot_assignment WHERE cost_center_code=p_cost_center
),
deprec AS (
  SELECT period AS mes, SUM(balance) AS d
  FROM public.odoo_account_balances WHERE account_code LIKE '504.08%' GROUP BY 1
),
horas AS (
  SELECT to_char(COALESCE(wo.date_finished,wo.date_start)::date,'YYYY-MM') AS mes, SUM(wo.duration)/60.0 AS h
  FROM public.odoo_workorders wo
  JOIN public.odoo_workcenters wc ON wc.odoo_workcenter_id=wo.odoo_workcenter_id
  JOIN cfg ON wc.name ILIKE cfg.workcenter_name_pattern
  WHERE wo.duration>0
  GROUP BY 1
),
base AS (
  SELECT m.mes,
    COALESCE(nom.total_nomina_mxn,0) AS mod_mxn,
    (SELECT r FROM renta) AS renta_mxn,
    COALESCE(oh.utilities_mxn,0) AS energia,
    COALESCE(oh.other_overhead_mxn,0) AS otros,
    COALESCE((SELECT d FROM deprec WHERE deprec.mes=m.mes),0)
      * COALESCE((SELECT machine_deprec_pct FROM cfg),0)/100.0 AS deprec_maq,
    COALESCE((SELECT h FROM horas WHERE horas.mes=m.mes),0) AS hm
  FROM months m
  LEFT JOIN LATERAL public.get_nomina_by_cost_center(m.mes) nom ON nom.cost_center_code=p_cost_center
  LEFT JOIN LATERAL public.get_overhead_by_cost_center(m.mes) oh ON oh.cost_center_code=p_cost_center
)
SELECT b.mes, ROUND(b.mod_mxn,0), ROUND(b.renta_mxn,0), ROUND(b.energia,0), ROUND(b.otros,0),
  ROUND(b.deprec_maq,0),
  ROUND(b.mod_mxn+b.renta_mxn+b.energia+b.otros+b.deprec_maq,0),
  ROUND(b.hm,0),
  CASE WHEN b.hm>0 THEN ROUND((b.renta_mxn+b.energia+b.otros+b.deprec_maq)/b.hm,2) END,
  CASE WHEN b.hm>0 THEN ROUND(b.mod_mxn/b.hm,2) END,
  CASE WHEN b.hm>0 THEN ROUND((b.mod_mxn+b.renta_mxn+b.energia+b.otros+b.deprec_maq)/b.hm,2) END
FROM base b ORDER BY b.mes;
$function$;
