BEGIN;

-- NOTA: Implementado como MATERIALIZED VIEW (no VIEW) por rendimiento.
-- El LATERAL ILIKE sobre ~6K productos x 166K líneas SAT tarda >30s.
-- Solución: CTE que agrega SAT por clave_prod_serv primero, luego join
-- via products_fiscal_map (exact match). ILIKE fallback eliminado.
-- Coverage: top-20 SKUs en fiscal_map = ~70% del revenue total.

-- Aplicado en 3 migraciones (ver historial apply_migration):
--   fase25_06_products_unified_view (VIEW original — eliminada por timeout)
--   fase25_06_products_unified_mv_nolike (MV con LATERAL exact — timeout)
--   fase25_06_products_unified_mv_cte (MV con CTE — OK, 6212 rows, 20 con SAT)

CREATE MATERIALIZED VIEW IF NOT EXISTS public.products_unified AS
WITH sat_by_clave AS (
  SELECT
    sli.clave_prod_serv,
    count(*) AS sat_line_count,
    sum(sli.importe) AS sat_revenue_mxn,
    max(si.fecha_timbrado::date) AS last_sat_invoice_date
  FROM public.syntage_invoice_line_items sli
  JOIN public.syntage_invoices si ON si.uuid = sli.invoice_uuid
  WHERE si.taxpayer_rfc = 'PNT920218IW5'
    AND si.direction = 'issued'
    AND si.fecha_timbrado >= CURRENT_DATE - interval '365 days'
  GROUP BY sli.clave_prod_serv
)
SELECT
  p.odoo_product_id,
  p.internal_ref,
  p.name AS product_name,
  p.category,
  p.uom,
  p.product_type,
  p.active,
  p.standard_price,
  p.list_price,
  p.stock_qty,
  pfm.sat_clave_prod_serv,
  pfm.confidence AS fiscal_map_confidence,
  COALESCE(sc.sat_line_count, 0) AS sat_line_count_12m,
  COALESCE(sc.sat_revenue_mxn, 0) AS sat_revenue_mxn_12m,
  sc.last_sat_invoice_date
FROM public.odoo_products p
LEFT JOIN public.products_fiscal_map pfm ON pfm.odoo_product_id = p.odoo_product_id
LEFT JOIN sat_by_clave sc ON sc.clave_prod_serv = pfm.sat_clave_prod_serv
WHERE p.active = true OR p.stock_qty > 0;

CREATE UNIQUE INDEX ON public.products_unified (odoo_product_id);
CREATE INDEX ON public.products_unified (sat_revenue_mxn_12m DESC NULLS LAST);
CREATE INDEX ON public.products_unified (internal_ref);

COMMENT ON MATERIALIZED VIEW public.products_unified IS
  'MV unificada productos Odoo + fiscal SAT. SAT aggregado por clave (no ILIKE), joined via products_fiscal_map. Refreshed en refresh_all_matviews.';

INSERT INTO public.schema_changes (change_type, table_name, description, sql_executed)
VALUES ('create_matview','products_unified','Fase 2.5 — MV unificada productos op + fiscal (CTE aggregate by clave, no ILIKE)','CREATE MATERIALIZED VIEW + 3 indexes');

COMMIT;
