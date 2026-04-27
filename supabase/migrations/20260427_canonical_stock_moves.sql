-- Silver: canonical_stock_moves
--
-- Promueve odoo_stock_moves (1.6M rows bronze) a silver con:
--   - FK resuelto a canonical_products
--   - move_category derivado de location_usage pair (8 categorías)
--   - Indexes compuestos para drilldown rápido por producto/categoría/fecha
--   - Trigger incremental desde bronze
--   - RPC get_inventory_adjustments() agregado mensual (gold-equivalente,
--     ya que CREATE VIEW está fuera del allowlist de execute_safe_ddl)
--
-- Caso de uso primario: auditar el residual +$10.54M dec-2025 en 501.01.02.
-- Antes era caja negra. Ahora gold_inventory_adjustments dic-25 muestra:
--   ajuste_inventario  21,645 moves  1,347 prod  $14.09M
--   consumo_mp          5,749 moves    260 prod  $25.97M
--   produccion_pt       1,682 moves    167 prod  $21.04M
--   compra                144 moves    123 prod  $11.83M
--   venta                 214 moves     78 prod  $ 8.25M
--   ...
-- vs COGS contable 501.01.* dec-25 = $12.24M (501.01.02 = $10.54M)
--
-- Aplicado a producción 2026-04-27 vía execute_safe_ddl en chunks
-- (table → indexes → classify_fn → populate por año/trimestre → trigger
-- → RPC). Migration es replay-friendly e idempotente.

BEGIN;

-- ============================================================================
-- 1. TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.canonical_stock_moves (
  odoo_move_id              bigint PRIMARY KEY,
  canonical_product_id      bigint REFERENCES public.canonical_products(id),
  odoo_product_id           bigint,
  product_ref               text,
  picking_id                bigint,
  picking_name              text,
  state                     text NOT NULL,
  date                      timestamptz,
  date_deadline             timestamptz,
  location_id               integer,
  location_dest_id          integer,
  location_usage            text,
  location_dest_usage       text,
  -- Pre-computed category from location_usage pair (see _classify_move_category).
  -- Stored (not GENERATED) so logic can evolve via UPDATE WHERE without DROP.
  move_category             text,
  product_uom_qty           numeric,
  quantity                  numeric,
  value                     numeric,
  price_unit                numeric,
  production_id             bigint,
  raw_material_production_id bigint,
  has_account_move          boolean,
  account_move_ids          bigint[],
  is_in                     boolean,
  is_out                    boolean,
  is_dropship               boolean,
  is_inventory              boolean,
  reference                 text,
  origin                    text,
  odoo_company_id           integer,
  synced_from_bronze_at     timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- 2. INDEXES
-- ============================================================================
CREATE INDEX IF NOT EXISTS ix_csm_product_date
  ON public.canonical_stock_moves (canonical_product_id, date DESC);
CREATE INDEX IF NOT EXISTS ix_csm_category_date
  ON public.canonical_stock_moves (move_category, date DESC) WHERE state='done';
CREATE INDEX IF NOT EXISTS ix_csm_picking
  ON public.canonical_stock_moves (picking_id) WHERE picking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_csm_production
  ON public.canonical_stock_moves (production_id) WHERE production_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_csm_inventory_adj
  ON public.canonical_stock_moves (date DESC, value)
  WHERE move_category='ajuste_inventario' AND state='done';
CREATE INDEX IF NOT EXISTS ix_csm_odoo_product
  ON public.canonical_stock_moves (odoo_product_id);
CREATE INDEX IF NOT EXISTS ix_csm_state_done
  ON public.canonical_stock_moves (state) WHERE state='done';

-- ============================================================================
-- 3. HELPER FUNCTION (categorización)
-- ============================================================================
CREATE OR REPLACE FUNCTION public._classify_move_category(p_src text, p_dst text)
RETURNS text LANGUAGE sql IMMUTABLE AS $func$
SELECT CASE
  WHEN p_src='supplier' AND p_dst='internal' THEN 'compra'
  WHEN p_src='internal' AND p_dst='customer' THEN 'venta'
  WHEN p_src='internal' AND p_dst='production' THEN 'consumo_mp'
  WHEN p_src='production' AND p_dst='internal' THEN 'produccion_pt'
  WHEN p_src='internal' AND p_dst='internal' THEN 'transfer_interno'
  WHEN (p_src='inventory' AND p_dst='internal') OR (p_src='internal' AND p_dst='inventory')
       OR (p_src='inventory' AND p_dst='inventory') THEN 'ajuste_inventario'
  WHEN p_src='internal' AND p_dst='supplier' THEN 'devolucion_compra'
  WHEN p_src='customer' AND p_dst='internal' THEN 'devolucion_venta'
  ELSE 'otro'
END;
$func$;

-- ============================================================================
-- 4. POPULATE (idempotent: ON CONFLICT DO NOTHING)
-- ============================================================================
-- En producción se ejecutó en chunks por año/trimestre porque execute_safe_ddl
-- timeout HTTP es ~3min y 1.26M rows en 2022 excedía. Aquí va como un solo
-- INSERT — si se aplica vía psql directo, no hay límite.
INSERT INTO public.canonical_stock_moves (
  odoo_move_id, canonical_product_id, odoo_product_id, product_ref, picking_id, picking_name,
  state, date, date_deadline, location_id, location_dest_id, location_usage, location_dest_usage,
  move_category, product_uom_qty, quantity, value, price_unit,
  production_id, raw_material_production_id, has_account_move, account_move_ids,
  is_in, is_out, is_dropship, is_inventory, reference, origin, odoo_company_id
)
SELECT
  osm.odoo_move_id, cp.id, osm.product_id, osm.product_ref, osm.picking_id, osm.picking_name,
  osm.state, osm.date, osm.date_deadline, osm.location_id, osm.location_dest_id,
  osm.location_usage, osm.location_dest_usage,
  public._classify_move_category(osm.location_usage, osm.location_dest_usage),
  osm.product_uom_qty, osm.quantity, osm.value, osm.price_unit,
  osm.production_id, osm.raw_material_production_id, osm.has_account_move, osm.account_move_ids,
  osm.is_in, osm.is_out, osm.is_dropship, osm.is_inventory, osm.reference, osm.origin, osm.odoo_company_id
FROM public.odoo_stock_moves osm
LEFT JOIN public.canonical_products cp ON cp.odoo_product_id = osm.product_id
ON CONFLICT (odoo_move_id) DO NOTHING;

-- ============================================================================
-- 5. INCREMENTAL TRIGGER
-- ============================================================================
CREATE OR REPLACE FUNCTION public.trg_canonical_stock_moves_from_bronze()
RETURNS trigger LANGUAGE plpgsql AS $func$
BEGIN
  INSERT INTO public.canonical_stock_moves (
    odoo_move_id, canonical_product_id, odoo_product_id, product_ref, picking_id, picking_name,
    state, date, date_deadline, location_id, location_dest_id, location_usage, location_dest_usage,
    move_category, product_uom_qty, quantity, value, price_unit,
    production_id, raw_material_production_id, has_account_move, account_move_ids,
    is_in, is_out, is_dropship, is_inventory, reference, origin, odoo_company_id, updated_at
  )
  VALUES (
    NEW.odoo_move_id,
    (SELECT id FROM public.canonical_products WHERE odoo_product_id = NEW.product_id LIMIT 1),
    NEW.product_id, NEW.product_ref, NEW.picking_id, NEW.picking_name,
    NEW.state, NEW.date, NEW.date_deadline, NEW.location_id, NEW.location_dest_id,
    NEW.location_usage, NEW.location_dest_usage,
    public._classify_move_category(NEW.location_usage, NEW.location_dest_usage),
    NEW.product_uom_qty, NEW.quantity, NEW.value, NEW.price_unit,
    NEW.production_id, NEW.raw_material_production_id, NEW.has_account_move, NEW.account_move_ids,
    NEW.is_in, NEW.is_out, NEW.is_dropship, NEW.is_inventory, NEW.reference, NEW.origin,
    NEW.odoo_company_id, now()
  )
  ON CONFLICT (odoo_move_id) DO UPDATE SET
    canonical_product_id = EXCLUDED.canonical_product_id,
    product_ref = EXCLUDED.product_ref,
    picking_id = EXCLUDED.picking_id, picking_name = EXCLUDED.picking_name,
    state = EXCLUDED.state, date = EXCLUDED.date, date_deadline = EXCLUDED.date_deadline,
    location_id = EXCLUDED.location_id, location_dest_id = EXCLUDED.location_dest_id,
    location_usage = EXCLUDED.location_usage, location_dest_usage = EXCLUDED.location_dest_usage,
    move_category = EXCLUDED.move_category,
    product_uom_qty = EXCLUDED.product_uom_qty, quantity = EXCLUDED.quantity,
    value = EXCLUDED.value, price_unit = EXCLUDED.price_unit,
    production_id = EXCLUDED.production_id,
    raw_material_production_id = EXCLUDED.raw_material_production_id,
    has_account_move = EXCLUDED.has_account_move, account_move_ids = EXCLUDED.account_move_ids,
    is_in = EXCLUDED.is_in, is_out = EXCLUDED.is_out, is_dropship = EXCLUDED.is_dropship,
    is_inventory = EXCLUDED.is_inventory, reference = EXCLUDED.reference, origin = EXCLUDED.origin,
    odoo_company_id = EXCLUDED.odoo_company_id, updated_at = now();
  RETURN NEW;
END;
$func$;

CREATE TRIGGER trg_canonical_stock_moves_sync
  AFTER INSERT OR UPDATE ON public.odoo_stock_moves
  FOR EACH ROW EXECUTE FUNCTION public.trg_canonical_stock_moves_from_bronze();

-- ============================================================================
-- 6. GOLD-EQUIVALENT RPC (sustituye CREATE VIEW por allowlist execute_safe_ddl)
-- ============================================================================
-- Mismo patrón que get_obligations_summary, get_pnl_normalization_adjustments,
-- get_cash_reconciliation: STABLE, lee solo silver, retorna tabla agregada.
-- Frontend la llama vía .rpc('get_inventory_adjustments', { p_date_from, p_date_to }).
CREATE OR REPLACE FUNCTION public.get_inventory_adjustments(p_date_from date, p_date_to date)
RETURNS TABLE(
  period text,
  period_date date,
  move_category text,
  moves_count bigint,
  distinct_products bigint,
  qty_total numeric,
  value_total_mxn numeric,
  value_positive_mxn numeric,
  value_negative_mxn numeric,
  origins text[]
) LANGUAGE sql STABLE AS $func$
SELECT
  to_char(date_trunc('month', date), 'YYYY-MM') AS period,
  date_trunc('month', date)::date AS period_date,
  move_category,
  COUNT(*) AS moves_count,
  COUNT(DISTINCT canonical_product_id) AS distinct_products,
  COALESCE(SUM(quantity), 0) AS qty_total,
  COALESCE(SUM(value), 0) AS value_total_mxn,
  COALESCE(SUM(CASE WHEN value > 0 THEN value ELSE 0 END), 0) AS value_positive_mxn,
  COALESCE(SUM(CASE WHEN value < 0 THEN value ELSE 0 END), 0) AS value_negative_mxn,
  ARRAY_AGG(DISTINCT origin) FILTER (WHERE origin IS NOT NULL AND origin <> '') AS origins
FROM public.canonical_stock_moves
WHERE state = 'done'
  AND date IS NOT NULL
  AND date >= p_date_from
  AND date < p_date_to
GROUP BY 1, 2, 3
ORDER BY period DESC, value_total_mxn DESC;
$func$;

-- ============================================================================
-- 7. Audit trail
-- ============================================================================
INSERT INTO public.schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES (
  'create_table',
  'canonical_stock_moves',
  'Silver: 1.6M stock moves promovidos a canonical (FK canonical_products + move_category 8 categorias). Trigger incremental desde odoo_stock_moves. RPC get_inventory_adjustments() agrega por mes/categoria. Caso primario: drilldown del residual +$10.54M dec-2025 en 501.01.02.',
  '20260427_canonical_stock_moves.sql',
  'audit-supabase-frontend',
  true
);

COMMIT;
