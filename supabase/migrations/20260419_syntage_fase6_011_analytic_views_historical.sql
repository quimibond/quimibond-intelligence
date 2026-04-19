-- Fase 6 · 011: 5 vistas analíticas sobre 12 años de data Syntage (2014-2026).
-- Aprovecha la data histórica completa para análisis robustos de negocio.

-- 1. Revenue fiscal mensual (148 meses ~ 12 años)
CREATE OR REPLACE VIEW public.syntage_revenue_fiscal_monthly AS
SELECT
  date_trunc('month', fecha_timbrado)::date AS month,
  count(*) FILTER (WHERE direction='issued') AS cfdis_emitidos,
  count(*) FILTER (WHERE direction='received') AS cfdis_recibidos,
  sum(total_mxn) FILTER (WHERE direction='issued' AND estado_sat != 'cancelado') AS revenue_mxn,
  sum(total_mxn) FILTER (WHERE direction='received' AND estado_sat != 'cancelado') AS gasto_mxn,
  sum(impuestos_trasladados) FILTER (WHERE direction='issued') AS iva_trasladado_mxn,
  sum(impuestos_retenidos) FILTER (WHERE direction='received') AS retenciones_mxn,
  count(*) FILTER (WHERE estado_sat='cancelado') AS cancelados,
  count(DISTINCT CASE WHEN direction='issued' THEN receptor_rfc END) AS clientes_unicos,
  count(DISTINCT CASE WHEN direction='received' THEN emisor_rfc END) AS proveedores_unicos
FROM public.syntage_invoices
WHERE fecha_timbrado IS NOT NULL
GROUP BY 1
ORDER BY 1 DESC;

-- 2. Top 100 clientes fiscal lifetime + YoY
CREATE OR REPLACE VIEW public.syntage_top_clients_fiscal_lifetime AS
WITH lifetime AS (
  SELECT
    receptor_rfc AS rfc,
    max(receptor_nombre) AS name,
    count(*) AS total_cfdis,
    sum(total_mxn) FILTER (WHERE estado_sat != 'cancelado') AS lifetime_revenue_mxn,
    sum(total_mxn) FILTER (WHERE estado_sat != 'cancelado' AND fecha_timbrado >= now() - interval '12 months') AS revenue_12m_mxn,
    sum(total_mxn) FILTER (WHERE estado_sat != 'cancelado' AND fecha_timbrado BETWEEN now() - interval '24 months' AND now() - interval '12 months') AS revenue_prev_12m_mxn,
    count(*) FILTER (WHERE estado_sat='cancelado') AS cancelled_count,
    min(fecha_timbrado)::date AS first_cfdi,
    max(fecha_timbrado)::date AS last_cfdi
  FROM public.syntage_invoices
  WHERE direction='issued' AND receptor_rfc IS NOT NULL
  GROUP BY receptor_rfc
  HAVING sum(total_mxn) FILTER (WHERE estado_sat != 'cancelado') > 0
)
SELECT
  rfc, name, total_cfdis,
  lifetime_revenue_mxn,
  revenue_12m_mxn,
  revenue_prev_12m_mxn,
  CASE
    WHEN revenue_prev_12m_mxn IS NULL OR revenue_prev_12m_mxn = 0 THEN NULL
    ELSE round(((revenue_12m_mxn - revenue_prev_12m_mxn) / revenue_prev_12m_mxn * 100)::numeric, 1)
  END AS yoy_pct,
  cancelled_count,
  round((cancelled_count::numeric / NULLIF(total_cfdis, 0) * 100), 2) AS cancellation_rate_pct,
  first_cfdi, last_cfdi,
  (CURRENT_DATE - last_cfdi) AS days_since_last_cfdi,
  (SELECT id FROM public.companies WHERE lower(companies.rfc) = lower(lifetime.rfc) LIMIT 1) AS company_id
FROM lifetime
ORDER BY lifetime_revenue_mxn DESC
LIMIT 100;

-- 3. Top 100 proveedores fiscal lifetime + retenciones
CREATE OR REPLACE VIEW public.syntage_top_suppliers_fiscal_lifetime AS
WITH lifetime AS (
  SELECT
    emisor_rfc AS rfc,
    max(emisor_nombre) AS name,
    count(*) AS total_cfdis,
    sum(total_mxn) FILTER (WHERE estado_sat != 'cancelado') AS lifetime_spend_mxn,
    sum(total_mxn) FILTER (WHERE estado_sat != 'cancelado' AND fecha_timbrado >= now() - interval '12 months') AS spend_12m_mxn,
    sum(total_mxn) FILTER (WHERE estado_sat != 'cancelado' AND fecha_timbrado BETWEEN now() - interval '24 months' AND now() - interval '12 months') AS spend_prev_12m_mxn,
    sum(impuestos_retenidos) AS retenciones_lifetime_mxn,
    min(fecha_timbrado)::date AS first_cfdi,
    max(fecha_timbrado)::date AS last_cfdi
  FROM public.syntage_invoices
  WHERE direction='received' AND emisor_rfc IS NOT NULL
  GROUP BY emisor_rfc
  HAVING sum(total_mxn) FILTER (WHERE estado_sat != 'cancelado') > 0
)
SELECT
  rfc, name, total_cfdis,
  lifetime_spend_mxn,
  spend_12m_mxn,
  spend_prev_12m_mxn,
  CASE
    WHEN spend_prev_12m_mxn IS NULL OR spend_prev_12m_mxn = 0 THEN NULL
    ELSE round(((spend_12m_mxn - spend_prev_12m_mxn) / spend_prev_12m_mxn * 100)::numeric, 1)
  END AS yoy_pct,
  retenciones_lifetime_mxn,
  first_cfdi, last_cfdi,
  (CURRENT_DATE - last_cfdi) AS days_since_last_cfdi,
  (SELECT id FROM public.companies WHERE lower(companies.rfc) = lower(lifetime.rfc) LIMIT 1) AS company_id
FROM lifetime
ORDER BY lifetime_spend_mxn DESC
LIMIT 100;

-- 4. Client cancellation rates últimos 24m
CREATE OR REPLACE VIEW public.syntage_client_cancellation_rates AS
SELECT
  receptor_rfc AS rfc,
  max(receptor_nombre) AS name,
  count(*) AS total_cfdis_24m,
  count(*) FILTER (WHERE estado_sat='cancelado') AS cancelados_24m,
  round(
    count(*) FILTER (WHERE estado_sat='cancelado')::numeric
    / NULLIF(count(*), 0) * 100, 2
  ) AS cancellation_rate_pct,
  sum(total_mxn) FILTER (WHERE estado_sat='cancelado') AS cancelled_amount_mxn,
  (SELECT id FROM public.companies WHERE lower(companies.rfc) = lower(receptor_rfc) LIMIT 1) AS company_id
FROM public.syntage_invoices
WHERE direction='issued'
  AND receptor_rfc IS NOT NULL
  AND fecha_timbrado >= now() - interval '24 months'
GROUP BY receptor_rfc
HAVING count(*) >= 5
   AND count(*) FILTER (WHERE estado_sat='cancelado') > 0
ORDER BY cancellation_rate_pct DESC, cancelled_amount_mxn DESC
LIMIT 50;

-- 5. Product line analysis (172K line items via JOIN tipo_cambio de invoice parent)
CREATE OR REPLACE VIEW public.syntage_product_line_analysis AS
SELECT
  li.clave_prod_serv,
  max(li.descripcion) AS descripcion,
  count(*) AS total_lineas,
  sum(li.cantidad) AS cantidad_total,
  sum(li.importe * COALESCE(i.tipo_cambio, 1)) AS revenue_mxn_aprox,
  count(DISTINCT li.invoice_uuid) AS cfdis_distintos,
  avg(li.valor_unitario * COALESCE(i.tipo_cambio, 1)) AS precio_promedio_mxn,
  stddev(li.valor_unitario * COALESCE(i.tipo_cambio, 1)) AS precio_stddev,
  min(li.valor_unitario * COALESCE(i.tipo_cambio, 1)) AS precio_min_mxn,
  max(li.valor_unitario * COALESCE(i.tipo_cambio, 1)) AS precio_max_mxn
FROM public.syntage_invoice_line_items li
LEFT JOIN public.syntage_invoices i ON i.uuid = li.invoice_uuid
WHERE li.importe IS NOT NULL
  AND li.importe > 0
  AND li.clave_prod_serv IS NOT NULL
GROUP BY li.clave_prod_serv
HAVING count(*) >= 10
ORDER BY revenue_mxn_aprox DESC NULLS LAST
LIMIT 200;

GRANT SELECT ON public.syntage_revenue_fiscal_monthly TO service_role, authenticated;
GRANT SELECT ON public.syntage_top_clients_fiscal_lifetime TO service_role, authenticated;
GRANT SELECT ON public.syntage_top_suppliers_fiscal_lifetime TO service_role, authenticated;
GRANT SELECT ON public.syntage_client_cancellation_rates TO service_role, authenticated;
GRANT SELECT ON public.syntage_product_line_analysis TO service_role, authenticated;
