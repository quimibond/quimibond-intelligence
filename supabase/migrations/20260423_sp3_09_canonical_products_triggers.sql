BEGIN;

CREATE OR REPLACE FUNCTION canonical_products_upsert_from_odoo() RETURNS trigger AS $$
BEGIN
  IF NEW.internal_ref IS NULL OR NEW.internal_ref = '' THEN RETURN NEW; END IF;
  INSERT INTO canonical_products (
    internal_ref, display_name, canonical_name, odoo_product_id,
    category, uom, product_type, barcode, weight,
    standard_price_mxn, avg_cost_mxn, list_price_mxn,
    stock_qty, reserved_qty, available_qty, reorder_min, reorder_max,
    is_active, last_matched_at
  ) VALUES (
    NEW.internal_ref, NEW.name, LOWER(NEW.name), NEW.odoo_product_id,
    NEW.category, NEW.uom, NEW.product_type, NEW.barcode, NEW.weight,
    NEW.standard_price, NEW.avg_cost, NEW.list_price,
    NEW.stock_qty, NEW.reserved_qty, NEW.available_qty, NEW.reorder_min, NEW.reorder_max,
    COALESCE(NEW.active, true), now()
  )
  ON CONFLICT (internal_ref) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    canonical_name = EXCLUDED.canonical_name,
    category = EXCLUDED.category,
    uom = EXCLUDED.uom,
    product_type = EXCLUDED.product_type,
    barcode = EXCLUDED.barcode,
    weight = EXCLUDED.weight,
    standard_price_mxn = EXCLUDED.standard_price_mxn,
    avg_cost_mxn = EXCLUDED.avg_cost_mxn,
    list_price_mxn = CASE
      WHEN canonical_products.list_price_mxn IS DISTINCT FROM EXCLUDED.list_price_mxn
      THEN EXCLUDED.list_price_mxn ELSE canonical_products.list_price_mxn END,
    last_list_price_change_at = CASE
      WHEN canonical_products.list_price_mxn IS DISTINCT FROM EXCLUDED.list_price_mxn
      THEN now() ELSE canonical_products.last_list_price_change_at END,
    stock_qty = EXCLUDED.stock_qty,
    reserved_qty = EXCLUDED.reserved_qty,
    available_qty = EXCLUDED.available_qty,
    reorder_min = EXCLUDED.reorder_min,
    reorder_max = EXCLUDED.reorder_max,
    is_active = EXCLUDED.is_active,
    last_matched_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cprod_from_odoo ON odoo_products;
CREATE TRIGGER trg_cprod_from_odoo AFTER INSERT OR UPDATE ON odoo_products
  FOR EACH ROW EXECUTE FUNCTION canonical_products_upsert_from_odoo();

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('create_trigger','canonical_products','SP3 Task 9: incremental trigger','20260423_sp3_09_canonical_products_triggers.sql','silver-sp3',true);

COMMIT;
