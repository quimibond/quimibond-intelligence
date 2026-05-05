-- Cleanup post-corrección de premisa AVCO (2026-05-05)
--
-- Después de la sesión 2026-05-04 PM que reemplazó "Standard valuation +
-- CAPA inflada" por "AVCO + variable costing implícito":
--
--  (a) `get_capa_posted_per_month` quedó huérfana (CapaWorkflowCard fue
--      eliminado, sin consumers en código).
--  (b) 5 pending actions están en wont_fix pero su `problem_description`
--      mantiene la narrativa CAPA-era. Reescribir para que cualquiera que
--      lea el ledger entienda por qué se cerraron.
--  (c) `fix-bom-empty-priority` está implementada (commit 0f038f7) — cerrar.
--  (d) Refraseamiento del framing Standard en 2 actions abiertas que ya no
--      hacen sentido bajo AVCO.

-- ───────────────────────────────────────────────────────────────────────
-- (a) Drop RPC huérfana
-- ───────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_capa_posted_per_month(text, text);

-- ───────────────────────────────────────────────────────────────────────
-- (b) Reescribir problem_description de actions wont_fix con narrativa AVCO
-- ───────────────────────────────────────────────────────────────────────
UPDATE public.odoo_pending_actions
SET problem_description =
'[OBSOLETO 2026-05-04] La premisa que motivó esta acción (Standard valuation con CAPA inflada en 501.01.01) era incorrecta. Quimibond usa AVCO. Workcenters configurados sólo en Tejido Circular (go-live mayo 2026); el resto de los procesos NO absorbe MOD+OH al PT al producirse (variable costing implícito).

Pre-1-abril-2026 las BOMs incluían MOD+gastos vía productos token RSI56 (archivados). El COGS posteado a 501.01.01 NO está "inflado por CAPA" — es el AVCO real al despacho, contaminado por PT producido pre-abril.

Esta acción se mantiene en wont_fix por trazabilidad histórica. El reemplazo bajo la premisa correcta es ''pnl-limpio-rewrite-avco-regimen''.'
WHERE action_key IN (
  'reclassify-501-01-01-as-mp',
  'reclassify-501-01-02-as-scrap',
  'monthly-capa-workflow',
  'reinterpret-pnl-limpio-mod-oh',
  'investigate-real-cost-method'
)
AND status = 'wont_fix';

-- ───────────────────────────────────────────────────────────────────────
-- (c) Cerrar fix-bom-empty-priority — implementada en commit 0f038f7
-- ───────────────────────────────────────────────────────────────────────
UPDATE public.odoo_pending_actions
SET
  status = 'resolved',
  workaround_in_silver = COALESCE(workaround_in_silver, '') ||
    E'\n\n[2026-05-05] RESUELTA: get_bom_raw_material_cost_per_unit ahora prioriza BOMs activas con num_lines > 0 sobre las vacías (commit 0f038f7).'
WHERE action_key = 'fix-bom-empty-priority'
  AND status = 'open';

-- ───────────────────────────────────────────────────────────────────────
-- (d) Reframing de actions abiertas con framing Standard
-- ───────────────────────────────────────────────────────────────────────

-- manufacturing-variance-tracking: el "variance" asume Standard. Bajo AVCO,
-- el gap es entre stock_moves (AVCO al consumo) y BOM-recursivo (avg_cost
-- canonical). Reescribir el problem_description para que sea accionable.
UPDATE public.odoo_pending_actions
SET
  title = 'Tracking gap entre stock_moves AVCO y BOM-recursivo en MOs activos',
  problem_description =
'Bajo régimen AVCO + variable costing implícito, la diferencia entre el value de stock_moves de venta (AVCO al despacho real) y el BOM-recursivo (qty × canonical.avg_cost por hoja) es la métrica relevante — NO un "variance" de Standard.

Ejemplo abril 2026:
- Stock moves de venta value: $6.68M
- COGS posteado a 501.01.01: $6.60M (cuadra al 99% con stock_moves)
- BOM-recursivo (sólo MP): $4.25M
- Gap: ~$2.35M (35%)

El gap NO es un bug. Refleja:
1. Contaminación AVCO histórica del PT producido pre-1-abril (MOD+gastos absorbidos vía RSI56, archivado).
2. Drift entre canonical_products.avg_cost_mxn (snapshot) y costo MP real al producir/despachar.

Lo que sí hay que trackear: si el gap se aleja del esperado mes a mes (bajo régimen estable post-abril, debería tender a 0% conforme se rota el PT viejo).',
  workaround_in_silver = COALESCE(workaround_in_silver, '') ||
    E'\n\n[2026-05-05] Reframe AVCO: el "variance" original asumía Standard. Bajo AVCO el gap es esperado y se reduce conforme rota el PT pre-abril.'
WHERE action_key = 'manufacturing-variance-tracking';

-- configure-product-categories-for-variance: bajo AVCO no hay "variance" en
-- el sentido Standard. La acción pierde sentido — cerrarla como wont_fix.
UPDATE public.odoo_pending_actions
SET
  status = 'wont_fix',
  workaround_in_silver = COALESCE(workaround_in_silver, '') ||
    E'\n\n[2026-05-05] OBSOLETO: bajo régimen AVCO no existe el concepto de "variance" tipo Standard. Las categorías de producto no se necesitan configurar para tracking de variance porque no hay variance — hay gap AVCO/BOM (cubierto por manufacturing-variance-tracking, ahora reframeada).'
WHERE action_key = 'configure-product-categories-for-variance'
  AND status = 'open';
