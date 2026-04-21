-- SP3 Task 8: populate canonical_products
-- Sources: odoo_products (primary) + products_fiscal_map (manual SAT claves)
--          + syntage_invoice_line_items aggregate (inferred SAT claves + revenue)
--
-- Column mapping verified empirically 2026-04-23:
--   syntage_invoice_line_items: clave_prod_serv, descripcion, importe, invoice_uuid
--   syntage_invoices:           uuid, fecha_timbrado, tipo_comprobante, emisor_rfc
--   products_fiscal_map:        odoo_product_id, sat_clave_prod_serv, confidence,
--                               created_at  (confidence='inferred_high' for all 20 rows,
--                               NOT 'manual' as originally assumed)
--   odoo_products:              internal_ref, name, odoo_product_id, standard_price,
--                               avg_cost, list_price, stock_qty, reserved_qty,
--                               available_qty, reorder_min, reorder_max, active,
--                               category, uom, product_type, barcode, weight
--                               (NO created_at column -- omitted)
--
-- Key discovery for 8c/8d join:
--   Syntage descripcion format: "[internal_ref] product name" (brackets present on ~77%
--   of lines). Correct join = extract bracket content and match vs canonical.internal_ref.
--   Plain display_name match fails because Odoo names differ from SAT descriptions.
--   139,470 / 181,059 line items have clave_prod_serv populated (8c viable).

BEGIN;

-- -------------------------------------------------------------------------
-- 8a. Insert from odoo_products (skip NULL/empty internal_ref)
-- -------------------------------------------------------------------------
INSERT INTO canonical_products (
  internal_ref,
  display_name,
  canonical_name,
  odoo_product_id,
  category,
  uom,
  product_type,
  barcode,
  weight,
  standard_price_mxn,
  avg_cost_mxn,
  list_price_mxn,
  stock_qty,
  reserved_qty,
  available_qty,
  reorder_min,
  reorder_max,
  is_active,
  last_matched_at
)
SELECT
  op.internal_ref,
  op.name,
  LOWER(op.name),
  op.odoo_product_id,
  op.category,
  op.uom,
  op.product_type,
  op.barcode,
  op.weight,
  op.standard_price,
  op.avg_cost,
  op.list_price,
  op.stock_qty,
  op.reserved_qty,
  op.available_qty,
  op.reorder_min,
  op.reorder_max,
  COALESCE(op.active, true),
  now()
FROM odoo_products op
WHERE op.internal_ref IS NOT NULL
  AND op.internal_ref <> ''
ON CONFLICT (internal_ref) DO NOTHING;

-- -------------------------------------------------------------------------
-- 8b. Manual/curated sat_clave_prod_serv from products_fiscal_map
--     (highest confidence -- these 20 rows have confidence='inferred_high')
-- -------------------------------------------------------------------------
UPDATE canonical_products cp
SET
  sat_clave_prod_serv   = pfm.sat_clave_prod_serv,
  fiscal_map_confidence = pfm.confidence,
  fiscal_map_updated_at = pfm.created_at,
  has_manual_override   = (pfm.confidence = 'manual')
FROM products_fiscal_map pfm
WHERE cp.odoo_product_id = pfm.odoo_product_id
  AND cp.sat_clave_prod_serv IS NULL;

-- -------------------------------------------------------------------------
-- 8c. Infer sat_clave_prod_serv from syntage_invoice_line_items (last 365d)
--     Quimibond as emisor, tipo_comprobante='I' only.
--
--     Join strategy: syntage descriptions have format "[internal_ref] text".
--     Extract bracket content -> match against canonical_products.internal_ref.
--     Most-frequent clave per ref wins (ROW_NUMBER DESC). Only fills NULLs.
-- -------------------------------------------------------------------------
WITH product_claves AS (
  SELECT
    LOWER(TRIM(SUBSTRING(sil.descripcion FROM '^\[([^\]]+)\]'))) AS ref_norm,
    sil.clave_prod_serv                                           AS clave,
    COUNT(*)                                                      AS cnt
  FROM syntage_invoice_line_items sil
  JOIN syntage_invoices si ON si.uuid = sil.invoice_uuid
  WHERE sil.clave_prod_serv IS NOT NULL
    AND sil.descripcion ~ '^\['
    AND si.fecha_timbrado >= (CURRENT_DATE - INTERVAL '365 days')
    AND si.tipo_comprobante = 'I'
    AND si.emisor_rfc = 'PNT920218IW5'
  GROUP BY
    LOWER(TRIM(SUBSTRING(sil.descripcion FROM '^\[([^\]]+)\]'))),
    sil.clave_prod_serv
),
ranked AS (
  SELECT
    ref_norm,
    clave,
    cnt,
    ROW_NUMBER() OVER (PARTITION BY ref_norm ORDER BY cnt DESC) AS rnk
  FROM product_claves
)
UPDATE canonical_products cp
SET
  sat_clave_prod_serv   = r.clave,
  fiscal_map_confidence = 'inferred_frequent',
  fiscal_map_updated_at = now()
FROM ranked r
WHERE r.rnk = 1
  AND cp.sat_clave_prod_serv IS NULL
  AND LOWER(TRIM(cp.internal_ref)) = r.ref_norm;

-- -------------------------------------------------------------------------
-- 8d. sat_revenue_mxn_12m aggregate (Quimibond emisor, last 365 days)
--     Uses importe (pre-tax line amount). Same bracket-extraction join as 8c.
-- -------------------------------------------------------------------------
WITH revenue AS (
  SELECT
    LOWER(TRIM(SUBSTRING(sil.descripcion FROM '^\[([^\]]+)\]'))) AS ref_norm,
    SUM(sil.importe)               AS revenue_mxn,
    COUNT(*)                       AS line_count,
    MAX(si.fecha_timbrado)::date   AS last_invoice
  FROM syntage_invoice_line_items sil
  JOIN syntage_invoices si ON si.uuid = sil.invoice_uuid
  WHERE si.emisor_rfc = 'PNT920218IW5'
    AND si.fecha_timbrado >= (CURRENT_DATE - INTERVAL '365 days')
    AND si.tipo_comprobante = 'I'
    AND sil.descripcion ~ '^\['
  GROUP BY LOWER(TRIM(SUBSTRING(sil.descripcion FROM '^\[([^\]]+)\]')))
)
UPDATE canonical_products cp
SET
  sat_revenue_mxn_12m   = COALESCE(rv.revenue_mxn, 0),
  sat_line_count_12m    = COALESCE(rv.line_count, 0),
  last_sat_invoice_date = rv.last_invoice
FROM revenue rv
WHERE LOWER(TRIM(cp.internal_ref)) = rv.ref_norm
  AND COALESCE(cp.sat_revenue_mxn_12m, 0) = 0;

-- -------------------------------------------------------------------------
-- Audit log
-- -------------------------------------------------------------------------
INSERT INTO schema_changes (
  change_type, table_name, description, sql_executed, triggered_by, success
)
VALUES (
  'populate',
  'canonical_products',
  'SP3 Task 8: populate from odoo_products + products_fiscal_map + syntage aggregate (last 365d, bracket-ref join)',
  '20260423_sp3_08_canonical_products_populate.sql',
  'silver-sp3',
  true
);

COMMIT;
