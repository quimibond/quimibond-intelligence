-- 2026-06-05d: (1) arreglo del mapeo de energía por centro y (2) costo de
-- workcenter con componentes limpios (sin doble conteo de depreciación).
--
-- PROBLEMA 1 — agua sin mapear: la cuenta grande 504.01.0004 AGUA ($230k/mes,
-- el teñido) no estaba en overhead_account_assignment → caía al pool y se
-- prorrateaba mal; TINTORERIA (que consume el agua) salía en ~$4,745 de
-- overhead. Sólo estaba mapeada "504.01.0013 AGUA OFICINAS" ($4k). Fix: mapear
-- 504.01.0004 AGUA → TINTORERIA. Ahora Tintorería carga su agua (~$189k) y el
-- pool de "otros" baja para los demás (Tejido $255k → $190k antes de re-pool).
--
-- PROBLEMA 2 — doble conteo de depreciación en el costo del workcenter: el RPC
-- anterior usaba get_overhead_by_cost_center, cuyo pool "otros" YA incluye la
-- depreciación 504.08-23 (+ amortización de instalaciones $345k), y además yo
-- sumaba 504.08 × pct aparte. Fix: get_cost_center_cost_monthly se reescribe
-- con componentes directos:
--   energia_servicios = cuentas 504.01 DIRECTAMENTE mapeadas al centro (consumo
--     real, excl. renta 504.01.0008).
--   mantto_otros = pool operativo fabril (504.01.* no mapeado, sin renta) ÷
--     MOD-share del centro entre fabriles. EXCLUYE depreciación.
--   deprec_maquinaria = sólo 504.08 (MAQUINARIA Y EQUIPO) × machine_deprec_pct.
--     No incluye 504.23 amortización de instalaciones (leasehold, no es costo
--     por hora-máquina) ni 504.01.0035 gastos de importación (logística, no
--     overhead fabril).

INSERT INTO public.overhead_account_assignment (account_code, cost_center_code, allocation_pct)
VALUES ('504.01.0004', 'TINTORERIA', 100)
ON CONFLICT DO NOTHING;

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
    COALESCE((SELECT SUM(wo.duration)/60.0 FROM public.odoo_workorders wo
       JOIN public.odoo_workcenters wc ON wc.odoo_workcenter_id=wo.odoo_workcenter_id
       CROSS JOIN cfg
       WHERE wc.name ILIKE cfg.workcenter_name_pattern AND wo.duration>0
         AND to_char(COALESCE(wo.date_finished,wo.date_start)::date,'YYYY-MM')=m.mes),0) AS hm
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
