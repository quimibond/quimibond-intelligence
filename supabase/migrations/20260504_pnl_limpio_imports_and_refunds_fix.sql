-- /finanzas P&L limpio — fixes 2026-05-04
--
-- Tres correcciones al cálculo de costo primo recursivo (BOM) que se usa
-- como reemplazo de COGS contable en `/finanzas`:
--
-- 1. PRODUCTOS IMPORTADOS (sufijo " I"): hoy 89/119 SKUs importados
--    tienen BOM activa que sólo refleja el costo del proveedor extranjero
--    + un componente token "GASTOS IND DE IMPORTACIÓN" (~$0.03). El flete,
--    aduana, agente y otros costos de importación viven sólo en el
--    avg_cost_mxn (Odoo moving-average de las compras). El BOM-recursivo
--    SUBESTIMA el costo de importados ~13% (ej. WM4032NG152 I: BOM=$4.55
--    vs avg_cost=$7.51).
--    FIX: para productos cuyo internal_ref termina en " I" o "I", retornar
--    avg_cost_mxn directamente sin explosionar BOM.
--
-- 2. NOTAS DE CRÉDITO (out_refund): el revenue 4xx ya viene neto de
--    notas de crédito (asientos contables las restan), pero el COGS
--    BOM-recursivo sólo sumaba lineas con move_type='out_invoice' y
--    nunca restaba las devoluciones. Asimetría → COGS sobreestimado por
--    el costo de bienes devueltos. Abril 2026: 9 NCs, 31k unidades, ~$409k
--    de COGS BOM no revertido.
--    FIX: incluir out_refund en la CTE deduped con quantity negativa.
--
-- 3. (no en este archivo) La normalización de venta-leaseback Lepezo ya
--    está cubierta por get_pnl_normalization_adjustments con las
--    categorías 'venta_activo_fijo' y 'otros_ingresos_extraordinarios'
--    (704.23.0003 + 704.23.0001).

-- ─────────────────────────────────────────────────────────────────────────
-- Fix 1: get_bom_raw_material_cost_per_unit — short-circuit imports
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_bom_raw_material_cost_per_unit(
  p_product_id integer,
  p_max_depth integer DEFAULT 10
)
RETURNS numeric
LANGUAGE sql STABLE
AS $function$
WITH RECURSIVE
  -- Si es importado (sufijo " I" o "I" al final del internal_ref), usar
  -- avg_cost_mxn directo. El moving-average de Odoo ya incluye el costo
  -- aduanal/flete/agente que la BOM no captura (la BOM sólo tiene el
  -- componente foreign-source + gastos token).
  imported_short_circuit AS (
    SELECT cp.avg_cost_mxn AS imported_cost
    FROM public.canonical_products cp
    WHERE cp.odoo_product_id = p_product_id
      AND cp.internal_ref ~ ' ?I$'
  ),
  -- BOM primary: prefer code='' (default), tiebreak por menor odoo_bom_id.
  primary_bom AS (
    SELECT DISTINCT ON (odoo_product_id)
      odoo_bom_id,
      odoo_product_id,
      product_qty
    FROM public.mrp_boms
    WHERE active
    ORDER BY odoo_product_id,
             CASE WHEN COALESCE(code, '') = '' THEN 0 ELSE 1 END,
             odoo_bom_id
  ),
  explode AS (
    SELECT
      p_product_id::bigint AS current_product_id,
      1.0::numeric AS qty_ratio,
      0 AS depth,
      ARRAY[p_product_id]::bigint[] AS visited
    UNION ALL
    SELECT
      bl.odoo_product_id::bigint,
      e.qty_ratio * (bl.product_qty / NULLIF(pb.product_qty, 0)),
      e.depth + 1,
      e.visited || bl.odoo_product_id::bigint
    FROM explode e
    JOIN primary_bom pb ON pb.odoo_product_id = e.current_product_id
    JOIN public.mrp_bom_lines bl ON bl.odoo_bom_id = pb.odoo_bom_id
    WHERE e.depth < p_max_depth
      AND NOT bl.odoo_product_id = ANY(e.visited)
  ),
  bom_recursive AS (
    SELECT COALESCE(SUM(e.qty_ratio * COALESCE(cp.avg_cost_mxn, 0)), 0)::numeric AS bom_cost
    FROM explode e
    LEFT JOIN public.canonical_products cp
      ON cp.odoo_product_id = e.current_product_id
    WHERE NOT EXISTS (
      SELECT 1 FROM primary_bom pb
      WHERE pb.odoo_product_id = e.current_product_id
    )
  )
SELECT COALESCE(
  (SELECT imported_cost FROM imported_short_circuit),
  (SELECT bom_cost FROM bom_recursive),
  0
)::numeric;
$function$;

-- ─────────────────────────────────────────────────────────────────────────
-- Fix 2: get_cogs_recursive_mp — restar notas de crédito
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_cogs_recursive_mp(
  p_date_from date,
  p_date_to date
)
RETURNS TABLE(
  lines_total bigint,
  lines_with_cost bigint,
  revenue_mxn numeric,
  cogs_recursive_mp numeric
)
LANGUAGE sql STABLE
AS $function$
WITH lines AS (
  -- Facturas de venta: qty positivo
  SELECT
    il.odoo_move_id,
    il.odoo_product_id,
    il.quantity AS quantity_signed,
    il.quantity AS quantity_abs,
    'sale'::text AS kind
  FROM public.odoo_invoice_lines il
  WHERE il.move_type = 'out_invoice'
    AND il.invoice_date >= p_date_from
    AND il.invoice_date < p_date_to
  UNION ALL
  -- Notas de crédito: qty negativo para reversar el COGS
  SELECT
    il.odoo_move_id,
    il.odoo_product_id,
    -il.quantity AS quantity_signed,
    il.quantity AS quantity_abs,
    'refund'::text AS kind
  FROM public.odoo_invoice_lines il
  WHERE il.move_type = 'out_refund'
    AND il.invoice_date >= p_date_from
    AND il.invoice_date < p_date_to
),
deduped AS (
  -- Dedup por (move, product, qty_abs, kind) — el triplet IEPS
  -- (lista+, descuento−, neta+) tiene el mismo (move, product, qty)
  -- y aquí colapsamos a una sola línea por venta o devolución.
  SELECT DISTINCT ON (odoo_move_id, odoo_product_id, quantity_abs, kind)
    odoo_move_id,
    odoo_product_id,
    quantity_signed
  FROM lines
),
line_costs AS (
  SELECT d.quantity_signed AS quantity,
    public.get_bom_raw_material_cost_per_unit(d.odoo_product_id::int) AS rm_per_unit
  FROM deduped d
)
SELECT
  (SELECT COUNT(*) FROM deduped)::bigint,
  (SELECT COUNT(*) FROM line_costs WHERE rm_per_unit > 0)::bigint,
  public.get_product_sales_revenue(p_date_from, p_date_to) AS revenue_mxn,
  COALESCE((SELECT SUM(quantity * COALESCE(rm_per_unit, 0)) FROM line_costs), 0)::numeric AS cogs_recursive_mp;
$function$;
