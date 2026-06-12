-- 2026-06-12i: RPCs de auditoria de costos (por departamento y por familia).
-- Alimentan la pagina /contabilidad/auditoria-costos: reconciliacion GL ↔
-- absorbido, sin duplicados. Reusan la clasificacion del modelo (tejida/carda).

CREATE OR REPLACE FUNCTION public.get_cost_audit_by_department(p_period text)
RETURNS TABLE(departamento text, mod_mxn numeric, overhead_mxn numeric, total_mxn numeric)
LANGUAGE sql STABLE AS $function$
  WITH n AS (SELECT cost_center_code c, total_nomina_mxn v FROM public.get_nomina_by_cost_center(p_period)),
       o AS (SELECT cost_center_code c, total_overhead_mxn v FROM public.get_overhead_by_cost_center(p_period))
  SELECT COALESCE(n.c,o.c)::text, COALESCE(n.v,0)::numeric, COALESCE(o.v,0)::numeric, (COALESCE(n.v,0)+COALESCE(o.v,0))::numeric
  FROM n FULL JOIN o ON o.c=n.c
  WHERE COALESCE(n.v,0)+COALESCE(o.v,0) <> 0
  ORDER BY 4 DESC;
$function$;

CREATE OR REPLACE FUNCTION public.get_cost_audit_by_family(p_period text)
RETURNS TABLE(familia text, n integer, mp_mxn numeric, fab_mxn numeric, op_mxn numeric, revenue_mxn numeric)
LANGUAGE sql STABLE AS $function$
  SELECT
    CASE
      WHEN op.category ILIKE '%Entretela%' AND op.category ILIKE '%Importaci%' THEN 'Entretela importada'
      WHEN op.category ILIKE '%Entretela%' AND op.name NOT ILIKE '%no tejid%' AND (op.name ILIKE '%tejido circular%' OR op.name ILIKE '%tejida%' OR op.category ILIKE '%Puntos%') THEN 'Entretela tejida'
      WHEN op.category ILIKE '%Entretela%' THEN 'Entretela carda'
      WHEN r.product_ref ~ ' I$' THEN 'Importado (tela)'
      WHEN op.uom='kg' THEN 'Tela greige (kg)'
      WHEN op.category ILIKE '%Tac-%' OR op.category ILIKE '%Acabado%' THEN 'Tela acabado (m)'
      ELSE 'Otro'
    END AS familia,
    count(*)::int,
    COALESCE(sum(r.costo_primo_total_mxn),0)::numeric,
    COALESCE(sum(r.gastos_fab_total_mxn),0)::numeric,
    COALESCE(sum(r.gastos_op_total_mxn),0)::numeric,
    COALESCE(sum(r.revenue_mxn),0)::numeric
  FROM public.get_full_cost_reconstruction(p_period) r
  JOIN public.odoo_products op ON op.odoo_product_id = r.odoo_product_id
  GROUP BY 1 ORDER BY 4 DESC;
$function$;
