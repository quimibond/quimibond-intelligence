-- 2026-06-12j: costeo por MARGEN DE CONTRIBUCION (mejor practica para decisiones).
-- CEO confirmo: solo la ENERGIA (luz/gas/agua) es variable; MOD, renta, deprec,
-- otros OH y operacion (6xx) son FIJOS. La absorcion total (smear de fijos por
-- unidad) sirve para el P&L pero distorsiona decisiones de precio/mezcla. Aqui:
-- costo variable por unidad (MP + energia) y margen de contribucion; los fijos
-- van como costo del periodo (punto de equilibrio).

CREATE TABLE IF NOT EXISTS public.costing_variable_accounts (
  account_pattern text PRIMARY KEY,
  note text
);
INSERT INTO public.costing_variable_accounts(account_pattern, note) VALUES
  ('504.01.0001%','Energeticos / electricidad'),
  ('504.01.0003%','Gas'),
  ('504.01.0004%','Agua')
ON CONFLICT (account_pattern) DO NOTHING;

CREATE OR REPLACE FUNCTION public.get_fixed_costs_monthly(p_months_back integer DEFAULT 12)
RETURNS TABLE(mes text, fijos_mxn numeric, variable_energia_mxn numeric)
LANGUAGE sql STABLE AS $function$
  SELECT ab.period,
    SUM(ab.balance) FILTER (WHERE
        (ab.account_code LIKE '501.06%' OR ab.account_code LIKE '504.01%' OR ab.account_code ~ '^504\.(0[89]|1[0-9]|2[0-3])' OR ab.account_code LIKE '6%')
        AND NOT EXISTS (SELECT 1 FROM public.costing_variable_accounts va WHERE ab.account_code LIKE va.account_pattern)
    )::numeric AS fijos,
    SUM(ab.balance) FILTER (WHERE EXISTS (SELECT 1 FROM public.costing_variable_accounts va WHERE ab.account_code LIKE va.account_pattern))::numeric AS variable_energia
  FROM public.odoo_account_balances ab
  WHERE ab.period >= to_char(date_trunc('month',CURRENT_DATE) - p_months_back*interval '1 month','YYYY-MM')
  GROUP BY ab.period ORDER BY ab.period;
$function$;

CREATE OR REPLACE FUNCTION public.get_contribution_by_product(p_period text)
RETURNS TABLE(odoo_product_id integer, product_ref text, product_name text, uom text, qty_sold numeric, revenue_mxn numeric, mp_mxn numeric, energia_var_mxn numeric, costo_variable_mxn numeric, contribucion_mxn numeric, cm_unit_mxn numeric, cm_pct numeric)
LANGUAGE sql STABLE AS $function$
WITH ef AS (
  SELECT SUM(e.energia)/NULLIF(SUM(f.kg),0) AS fkg
  FROM (
    SELECT ab.period mes, SUM(ab.balance) AS energia
    FROM public.odoo_account_balances ab
    WHERE ab.period <= p_period AND ab.period > to_char(((p_period||'-01')::date - interval '12 months'),'YYYY-MM')
      AND EXISTS (SELECT 1 FROM public.costing_variable_accounts va WHERE ab.account_code LIKE va.account_pattern)
    GROUP BY 1 HAVING SUM(ab.balance) > 0
  ) e
  JOIN (SELECT mes, kg_inspeccion kg FROM public.get_cost_factors_monthly(48)) f ON f.mes = e.mes AND f.kg > 0
),
r AS (SELECT * FROM public.get_full_cost_reconstruction(p_period))
SELECT r.odoo_product_id, r.product_ref, r.product_name, r.uom, r.qty_sold, r.revenue_mxn,
  ROUND(r.costo_primo_total_mxn,2),
  ROUND((CASE WHEN r.product_ref ~ ' I$' THEN 0 ELSE r.qty_sold * r.kg_per_unit * COALESCE((SELECT fkg FROM ef),0) END),2),
  ROUND(r.costo_primo_total_mxn + (CASE WHEN r.product_ref ~ ' I$' THEN 0 ELSE r.qty_sold * r.kg_per_unit * COALESCE((SELECT fkg FROM ef),0) END),2),
  ROUND(r.revenue_mxn - (r.costo_primo_total_mxn + (CASE WHEN r.product_ref ~ ' I$' THEN 0 ELSE r.qty_sold * r.kg_per_unit * COALESCE((SELECT fkg FROM ef),0) END)),2),
  ROUND(CASE WHEN r.qty_sold>0 THEN (r.revenue_mxn - (r.costo_primo_total_mxn + (CASE WHEN r.product_ref ~ ' I$' THEN 0 ELSE r.qty_sold * r.kg_per_unit * COALESCE((SELECT fkg FROM ef),0) END)))/r.qty_sold END,4),
  ROUND(CASE WHEN r.revenue_mxn>0 THEN (r.revenue_mxn - (r.costo_primo_total_mxn + (CASE WHEN r.product_ref ~ ' I$' THEN 0 ELSE r.qty_sold * r.kg_per_unit * COALESCE((SELECT fkg FROM ef),0) END)))/r.revenue_mxn*100 END,1)
FROM r;
$function$;
