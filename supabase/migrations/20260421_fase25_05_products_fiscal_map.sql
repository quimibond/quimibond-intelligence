BEGIN;

CREATE TABLE IF NOT EXISTS public.products_fiscal_map (
  id bigserial PRIMARY KEY,
  odoo_product_id integer NOT NULL,
  internal_ref text NOT NULL,
  sat_clave_prod_serv text NOT NULL,
  description_pattern text,
  confidence text NOT NULL CHECK (confidence IN ('manual_confirmed','inferred_high','inferred_medium','inferred_low')),
  created_by text NOT NULL DEFAULT 'seed',
  created_at timestamptz NOT NULL DEFAULT now(),
  note text,
  UNIQUE (odoo_product_id, sat_clave_prod_serv)
);

CREATE INDEX IF NOT EXISTS idx_pfm_internal_ref ON public.products_fiscal_map (internal_ref);
CREATE INDEX IF NOT EXISTS idx_pfm_clave ON public.products_fiscal_map (sat_clave_prod_serv);

COMMENT ON TABLE public.products_fiscal_map IS
  'Mapping entre odoo_products.internal_ref y SAT claveProdServ. Seed inicial top 20 SKUs (2026-04-20, user-approved inferred_high).';

-- Seed: top 20 SKUs por revenue 12m, clave SAT inferida por mode() sobre
-- descripciones ILIKE'%internal_ref%' + RFC Quimibond. Todos con distinct_claves=1.
INSERT INTO public.products_fiscal_map
  (odoo_product_id, internal_ref, sat_clave_prod_serv, confidence, created_by, note)
VALUES
  (8630,  'X140NT165',         '11161800', 'inferred_high', 'seed_phase_2_5', 'top 20 revenue 12m: 16.2M MXN'),
  (11192, 'WJ042Q22JNT160',    '11161800', 'inferred_high', 'seed_phase_2_5', '12.9M MXN'),
  (12032, 'WJ053Q22JNT160',    '11161800', 'inferred_high', 'seed_phase_2_5', '11.2M MXN'),
  (18507, 'IWJ045Q22JNT160',   '11161800', 'inferred_high', 'seed_phase_2_5', '10.7M MXN'),
  (16182, 'WN075Q66JBL205',    '11161800', 'inferred_high', 'seed_phase_2_5', '8.9M MXN'),
  (8623,  'WC090Q11JNT165',    '11161800', 'inferred_high', 'seed_phase_2_5', '7.1M MXN'),
  (16089, 'IWJ038Q22JNT160',   '11161800', 'inferred_high', 'seed_phase_2_5', '5.2M MXN'),
  (8687,  'WD3846NT163m2',     '11161800', 'inferred_high', 'seed_phase_2_5', '4.7M MXN'),
  (10874, 'WJ060Q21JNT165',    '11161800', 'inferred_high', 'seed_phase_2_5', '4.3M MXN'),
  (17935, 'WD3846NT159M2',     '11161800', 'inferred_high', 'seed_phase_2_5', '4.3M MXN'),
  (18156, 'IWJ060Q21JNT157',   '11161800', 'inferred_high', 'seed_phase_2_5', '3.7M MXN'),
  (17638, 'IWJ042Q22JNT160',   '11161800', 'inferred_high', 'seed_phase_2_5', '3.5M MXN'),
  (8631,  'XJ14021GO165',      '11161800', 'inferred_high', 'seed_phase_2_5', '3.1M MXN'),
  (12748, 'WJ045Q22JNT160M2',  '11161800', 'inferred_high', 'seed_phase_2_5', '3.0M MXN'),
  (10881, 'WJ038Q22JNT160M2',  '11161800', 'inferred_high', 'seed_phase_2_5', '3.0M MXN'),
  (8607,  'A55BL172',          '11162201', 'inferred_high', 'seed_phase_2_5', '2.7M MXN — tela NO TEJIDA (distinct clave)'),
  (15847, 'WJ060Q21JNT157M2',  '11161800', 'inferred_high', 'seed_phase_2_5', '2.4M MXN'),
  (16408, 'TJ085Q22JNT157',    '11161800', 'inferred_high', 'seed_phase_2_5', '2.1M MXN'),
  (18377, 'WP4032BL152 I',     '11161800', 'inferred_high', 'seed_phase_2_5', '2.1M MXN'),
  (18378, 'WP4032NG152 I',     '11161800', 'inferred_high', 'seed_phase_2_5', '1.9M MXN');

INSERT INTO public.schema_changes (change_type, table_name, description, sql_executed)
VALUES ('create_table','products_fiscal_map','Fase 2.5 — mapping SKU Odoo ↔ clave SAT (seed top 20 user-approved)','CREATE TABLE + seed 20 rows');

COMMIT;
