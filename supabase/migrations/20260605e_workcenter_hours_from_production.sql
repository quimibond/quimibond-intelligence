-- 2026-06-05e: horas-máquina del costo de workcenter DERIVADAS de producción,
-- no de las duraciones de workorders (que son basura).
--
-- Hallazgo: las duraciones de los workorders de circular en mayo-2026 van de
-- 432 kg/h (44 órdenes con tiempo casi 0 → sub-registrado) a 5 kg/h (50 órdenes
-- >72h, una de 578h = 24 días → orden abierta sin cerrar). duration_expected=0.
-- Una circular produce ~11 kg/h, así que sumar duraciones (10,201h en mayo) es
-- inservible. Peor: Odoo multiplica costo/hora × esa duración → absorbe mal.
--
-- Fix: horas_maquina = producción del centro (get_production_by_cost_center, kg
-- COMPLETOS) ÷ std_kg_per_machine_hour (config, 11 para Tejido). Robusto al
-- tracking roto. La tarifa sube de ~$126/h (con 10,200h infladas) a ~$144/h
-- (con ~8,900h reales): costs_hour ~$94, employee_costs_hour ~$50.
--
-- También registra el problema operativo en odoo_pending_actions
-- (workorder-tiempos-no-confiables) — el fix real es cerrar workorders en Odoo.

ALTER TABLE public.workcenter_cost_config
  ADD COLUMN IF NOT EXISTS std_kg_per_machine_hour numeric;

UPDATE public.workcenter_cost_config
  SET std_kg_per_machine_hour = 11, target_machine_hours = NULL,
      notes = 'Horas-máquina DERIVADAS de producción (kg ÷ std_kg_per_machine_hour), porque los tiempos de workorders son basura (órdenes 5-432 kg/h). Std 11 kg/h por circular — confirmar con ingeniería. Deprec 50% del 504.08 — confirmar activo fijo.'
WHERE cost_center_code = 'TEJIDO';

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
fabril AS (SELECT code FROM public.cost_center_config WHERE nature='fabril_directo' AND active),
mapped AS (SELECT DISTINCT account_code FROM public.overhead_account_assignment
           WHERE effective_to IS NULL OR effective_to >= CURRENT_DATE),
nomina AS (
  SELECT m.mes, n.cost_center_code AS cc, n.total_nomina_mxn AS amt
  FROM months m, LATERAL public.get_nomina_by_cost_center(m.mes) n
),
mod_c AS (SELECT mes, SUM(amt) amt FROM nomina WHERE cc=p_cost_center GROUP BY 1),
mod_fabril AS (SELECT n.mes, SUM(n.amt) amt FROM nomina n JOIN fabril f ON f.code=n.cc GROUP BY 1),
prod AS (
  SELECT m.mes, COALESCE(p.qty_produced,0) AS kg
  FROM months m LEFT JOIN LATERAL public.get_production_by_cost_center(m.mes) p
    ON p.cost_center_code=p_cost_center
),
energia AS (
  SELECT cab.period AS mes, SUM(cab.balance*oaa.allocation_pct/100.0) AS amt
  FROM public.overhead_account_assignment oaa
  JOIN public.canonical_account_balances cab ON cab.account_code=oaa.account_code AND cab.deprecated=false
  WHERE oaa.cost_center_code=p_cost_center AND oaa.account_code<>'504.01.0008'
    AND (oaa.effective_to IS NULL OR oaa.effective_to>=CURRENT_DATE)
  GROUP BY 1
),
pool AS (
  SELECT cab.period AS mes, SUM(cab.balance) AS amt
  FROM public.canonical_account_balances cab
  WHERE cab.deprecated=false AND cab.account_code LIKE '504.01%'
    AND cab.account_code<>'504.01.0008'
    AND NOT EXISTS (SELECT 1 FROM mapped WHERE mapped.account_code=cab.account_code)
  GROUP BY 1
),
deprec AS (
  SELECT cab.period AS mes, SUM(cab.balance) AS amt
  FROM public.canonical_account_balances cab
  WHERE cab.deprecated=false AND cab.account_code LIKE '504.08%'
  GROUP BY 1
),
base AS (
  SELECT m.mes,
    COALESCE((SELECT amt FROM mod_c WHERE mod_c.mes=m.mes),0) AS mod_mxn,
    (SELECT r FROM renta) AS renta_mxn,
    COALESCE((SELECT amt FROM energia WHERE energia.mes=m.mes),0) AS energia,
    COALESCE((SELECT amt FROM pool WHERE pool.mes=m.mes),0)
      * COALESCE((SELECT amt FROM mod_c WHERE mod_c.mes=m.mes),0)
      / NULLIF((SELECT amt FROM mod_fabril WHERE mod_fabril.mes=m.mes),0) AS otros,
    COALESCE((SELECT amt FROM deprec WHERE deprec.mes=m.mes),0)
      * COALESCE((SELECT machine_deprec_pct FROM cfg),0)/100.0 AS deprec_maq,
    COALESCE((SELECT kg FROM prod WHERE prod.mes=m.mes),0)
      / NULLIF((SELECT std_kg_per_machine_hour FROM cfg),0) AS hm
  FROM months m
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

INSERT INTO public.odoo_pending_actions
  (action_key, area, severity, title, problem_description, fix_in_odoo, workaround_in_silver, status, assignee)
VALUES (
  'workorder-tiempos-no-confiables',
  'produccion', 'high',
  'Tiempos de workorders (tejido) no son confiables',
  'Las duraciones de los workorders de circular van de 432 kg/h (tiempo sub-registrado, casi 0) a 5 kg/h (tiempo inflado, orden abierta dias sin cerrar; una llego a 578h = 24 dias). El duration_expected esta en 0 (sin tiempos estandar). El total mensual (~10,201h en mayo) es inservible para valuar produccion: Odoo multiplica costo/hora x esa duracion basura -> absorbe mal cada orden.',
  'Que los operarios CIERREN el workorder al terminar (o auto-cierre al registrar la produccion). Cargar tiempos estandar (duration_expected) por producto/maquina. Revisar las ordenes con duracion >72h o <0.1h.',
  'El costo estandar del workcenter deriva las horas-maquina de la PRODUCCION (kg / tasa estandar 11 kg/h), no de las duraciones rotas.',
  'open', 'Produccion / Sistemas'
) ON CONFLICT (action_key) DO UPDATE SET problem_description=EXCLUDED.problem_description, fix_in_odoo=EXCLUDED.fix_in_odoo;
