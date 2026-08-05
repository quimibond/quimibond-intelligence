-- 20260804_stock_config_tables.sql
-- Bronze: catálogos de configuración logística/contable de Odoo.
-- Los llena el push hourly de qb19 (_push_stock_config). Full refresh por
-- upsert; los archivados vienen con active=false.
--
-- Motivación: auditar el comportamiento contable de los tipos de operación
-- requiere ver la config REAL (tipo de operación → ubicaciones default;
-- ubicación → cuenta forzada; categoría → cuenta de gastos). Hasta ahora el
-- mapa se deducía de los folios de stock_moves.

create table if not exists odoo_picking_types (
  odoo_picking_type_id     bigint primary key,
  name                     text,
  code                     text,          -- incoming / outgoing / internal / mrp_operation
  sequence_code            text,
  sequence_prefix          text,          -- ej. 'TL/OUT/', 'TVAR/ENT-REF/'
  warehouse_name           text,
  default_location_src_id  bigint,
  default_location_src     text,
  default_location_dest_id bigint,
  default_location_dest    text,
  active                   boolean default true,
  synced_at                timestamptz default now()
);

create table if not exists odoo_stock_routes (
  odoo_route_id            bigint primary key,
  name                     text,
  active                   boolean default true,
  product_selectable       boolean,
  product_categ_selectable boolean,
  warehouse_selectable     boolean,
  synced_at                timestamptz default now()
);

create table if not exists odoo_stock_rules (
  odoo_rule_id     bigint primary key,
  name             text,
  action           text,               -- pull / push / pull_push / buy / manufacture
  picking_type_id  bigint,
  picking_type     text,
  location_src_id  bigint,
  location_src     text,
  location_dest_id bigint,
  location_dest    text,
  route_id         bigint,
  route            text,
  procure_method   text,
  active           boolean default true,
  synced_at        timestamptz default now()
);

create table if not exists odoo_product_categories (
  odoo_category_id        bigint primary key,
  complete_name           text,
  parent_id               bigint,
  cost_method             text,          -- average / fifo / standard
  valuation               text,          -- real_time / manual_periodic
  expense_account         text,          -- LA cuenta que decide a dónde caen ajustes/consumos
  income_account          text,
  stock_valuation_account text,          -- la 115 de la categoría
  stock_input_account     text,
  stock_output_account    text,
  stock_journal           text,
  synced_at               timestamptz default now()
);

-- odoo_stock_locations: campos nuevos del push extendido (capa 2 del
-- comportamiento contable: cuentas forzadas por ubicación + flags).
alter table odoo_stock_locations
  add column if not exists parent_location_id    bigint,
  add column if not exists scrap_location        boolean,
  add column if not exists return_location       boolean,
  add column if not exists valuation_in_account  text,
  add column if not exists valuation_out_account text,
  add column if not exists synced_at             timestamptz default now();
