-- 2026-05-14 — Recrea v_mo_material_variance dropeada por error en
-- migration 20260429_drop_unused_gold_views.sql.
--
-- La vista parecía no tener consumers (audit), pero la función
-- public._sp12_run_extra(text) la referencia para el invariante
-- manufacturing.material_cost_variance. Resultado: silver_sp2_reconcile_*
-- y silver_sp4_reconcile_daily fallan cada corrida desde 2026-04-29 con:
--   ERROR: relation "v_mo_material_variance" does not exist
--
-- Se recompone a partir de las 2 MVs que sí siguen vivas:
--   mv_mo_actual_material_cost (qty_produced, actual_material_cost_*)
--   mv_bom_standard_cost      (standard_cost_per_unit por BOM)

CREATE OR REPLACE VIEW public.v_mo_material_variance AS
SELECT
  mo.odoo_production_id,
  mo.bom_id,
  mo.finished_product_id,
  mo.finished_product_name,
  mo.qty_planned,
  mo.qty_produced,
  mo.state,
  mo.date_finished,
  mo.extra_cost,
  mo.consumed_moves_count,
  mo.actual_material_cost_total,
  mo.actual_material_cost_per_unit,
  bom.standard_cost_per_unit                        AS expected_cost_per_unit,
  (bom.standard_cost_per_unit * mo.qty_produced)::numeric AS expected_total,
  (mo.actual_material_cost_total
     - (bom.standard_cost_per_unit * mo.qty_produced))::numeric AS variance_mxn,
  CASE
    WHEN bom.standard_cost_per_unit * mo.qty_produced > 0
    THEN ROUND(
      (100.0 * (mo.actual_material_cost_total
                - (bom.standard_cost_per_unit * mo.qty_produced))
       / NULLIF(bom.standard_cost_per_unit * mo.qty_produced, 0)
      )::numeric, 2)
    ELSE NULL
  END AS variance_pct
FROM mv_mo_actual_material_cost mo
LEFT JOIN mv_bom_standard_cost bom ON bom.odoo_bom_id = mo.bom_id;

COMMENT ON VIEW public.v_mo_material_variance IS
  'Variance MO real vs BOM estándar. Consumida por _sp12_run_extra para invariante manufacturing.material_cost_variance. Recreada 2026-05-14 tras drop por error en 20260429.';
