BEGIN;

CREATE TABLE IF NOT EXISTS canonical_products (
  id bigserial PRIMARY KEY,
  internal_ref text NOT NULL,
  display_name text NOT NULL,
  canonical_name text NOT NULL,
  odoo_product_id integer NOT NULL,
  primary_entity_kg_id bigint,
  category text,
  uom text,
  product_type text,
  sat_clave_prod_serv text,
  sat_clave_unidad text,
  barcode text,
  weight numeric(10,3),
  standard_price_mxn numeric(14,2),
  avg_cost_mxn numeric(14,2),
  list_price_mxn numeric(14,2),
  last_list_price_change_at timestamptz,
  stock_qty numeric(14,4),
  reserved_qty numeric(14,4),
  available_qty numeric(14,4),
  reorder_min numeric(14,4),
  reorder_max numeric(14,4),
  sat_revenue_mxn_12m numeric(14,2) DEFAULT 0,
  sat_line_count_12m integer DEFAULT 0,
  last_sat_invoice_date date,
  odoo_revenue_mxn_12m numeric(14,2) DEFAULT 0,
  margin_pct_12m numeric(8,4),
  top_customers_canonical_ids bigint[],
  top_suppliers_canonical_ids bigint[],
  is_active boolean DEFAULT true,
  fiscal_map_confidence text,
  fiscal_map_updated_at timestamptz,
  has_manual_override boolean DEFAULT false,
  needs_review boolean DEFAULT false,
  completeness_score numeric(4,3),
  last_matched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cprod_internal_ref ON canonical_products (internal_ref);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cprod_odoo_product_id ON canonical_products (odoo_product_id);
CREATE INDEX IF NOT EXISTS ix_cprod_sat_clave ON canonical_products (sat_clave_prod_serv);
CREATE INDEX IF NOT EXISTS ix_cprod_category ON canonical_products (category);
CREATE INDEX IF NOT EXISTS ix_cprod_active ON canonical_products (is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS ix_cprod_name_trgm ON canonical_products USING GIN (canonical_name gin_trgm_ops);

CREATE OR REPLACE FUNCTION trg_canonical_products_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cprod_updated_at ON canonical_products;
CREATE TRIGGER trg_cprod_updated_at BEFORE UPDATE ON canonical_products
  FOR EACH ROW EXECUTE FUNCTION trg_canonical_products_updated_at();

COMMENT ON TABLE canonical_products IS 'Silver SP3 Pattern C. Product golden record. internal_ref never changes (Odoo default_code).';

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('create_table','canonical_products','SP3 Task 7: DDL','20260423_sp3_07_canonical_products_ddl.sql','silver-sp3',true);

COMMIT;
