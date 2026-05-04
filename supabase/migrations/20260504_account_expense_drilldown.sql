-- /contabilidad/cuenta/[code] — drilldown por proveedor en cada cuenta GL
--
-- Fuente: odoo_account_entries_stock.lines_stock (jsonb) que tiene per-line:
--   { partner_id, account_code, debit, credit, product_id, product_ref, name }
--
-- A pesar del sufijo "stock" en el nombre de la tabla, esta tabla incluye
-- TODOS los asientos contables (NOMINAS, Facturas de proveedores, GSTVAR,
-- Depreciaciones, etc.), no solo los relacionados a inventario. Es el único
-- lugar donde tenemos per-line account_code + partner_id.
--
-- Resuelve: "¿en qué se está yendo el dinero por proveedor?" con drilldown
-- desde cualquier cuenta GL de la pestaña "Gastos por cuenta" en /contabilidad.

-- ─────────────────────────────────────────────────────────────────────────
-- RPC 1: vendor breakdown por cuenta GL
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_account_vendor_breakdown(
  p_account_code text,
  p_from_period text,
  p_to_period text
)
RETURNS TABLE(
  vendor_company_id bigint,
  vendor_name text,
  vendor_rfc text,
  total_mxn numeric,
  line_count bigint,
  invoice_count bigint,
  first_date date,
  last_date date
)
LANGUAGE sql STABLE
AS $function$
WITH lines AS (
  SELECT
    e.date,
    e.name AS entry_name,
    (line->>'partner_id')::int AS partner_id,
    COALESCE((line->>'debit')::numeric, 0) AS debit,
    COALESCE((line->>'credit')::numeric, 0) AS credit
  FROM public.odoo_account_entries_stock e,
       jsonb_array_elements(e.lines_stock) AS line
  WHERE e.date >= (p_from_period || '-01')::date
    AND e.date < (date_trunc('month', (p_to_period || '-01')::date) + interval '1 month')::date
    AND line->>'account_code' = p_account_code
)
SELECT
  c.id::bigint AS vendor_company_id,
  COALESCE(c.canonical_name, '(sin proveedor)') AS vendor_name,
  c.rfc AS vendor_rfc,
  ROUND(SUM(l.debit - l.credit)::numeric, 2) AS total_mxn,
  COUNT(*)::bigint AS line_count,
  COUNT(DISTINCT l.entry_name)::bigint AS invoice_count,
  MIN(l.date) AS first_date,
  MAX(l.date) AS last_date
FROM lines l
LEFT JOIN public.companies c ON c.odoo_partner_id = l.partner_id
GROUP BY c.id, c.canonical_name, c.rfc
HAVING SUM(l.debit - l.credit) <> 0
ORDER BY ABS(SUM(l.debit - l.credit)) DESC;
$function$;

-- ─────────────────────────────────────────────────────────────────────────
-- RPC: get_account_source_breakdown — añadido 2026-05-04 PM
-- Para una cuenta GL, agrupa el saldo del período por journal_name (de
-- Odoo) + lista las top 3 cuentas contraparte por journal. Permite ver de
-- un vistazo si los asientos a esta cuenta son los esperados (ej. una
-- cuenta de COGS automático debería venir 100% de "Facturas de cliente",
-- una cuenta de scrap debería venir de "Valoración del inventario", etc.).
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_account_source_breakdown(
  p_account_code text,
  p_from_period text,
  p_to_period text
)
RETURNS TABLE(
  journal_name text,
  line_count bigint,
  debit_mxn numeric,
  credit_mxn numeric,
  net_mxn numeric,
  top_contra_accounts text
)
LANGUAGE sql STABLE
AS $function$
WITH events AS (
  SELECT
    e.journal_name,
    e.lines_stock
  FROM public.odoo_account_entries_stock e
  WHERE e.date >= (p_from_period || '-01')::date
    AND e.date < (date_trunc('month', (p_to_period || '-01')::date) + interval '1 month')::date
    AND e.lines_stock @> ('[{"account_code":"' || p_account_code || '"}]')::jsonb
),
target_lines AS (
  SELECT
    e.journal_name,
    COALESCE((line->>'debit')::numeric, 0) AS debit,
    COALESCE((line->>'credit')::numeric, 0) AS credit
  FROM events e, jsonb_array_elements(e.lines_stock) AS line
  WHERE line->>'account_code' = p_account_code
),
contra_agg AS (
  SELECT
    e.journal_name,
    line->>'account_code' AS contra_account,
    SUM(COALESCE((line->>'debit')::numeric, 0) + COALESCE((line->>'credit')::numeric, 0)) AS total
  FROM events e, jsonb_array_elements(e.lines_stock) AS line
  WHERE line->>'account_code' != p_account_code
  GROUP BY e.journal_name, line->>'account_code'
),
top_contra_per_journal AS (
  SELECT
    journal_name,
    STRING_AGG(
      contra_account || ' ($' || (ROUND(total/1000.0))::text || 'k)',
      ', '
      ORDER BY total DESC
    ) AS top_contra_accounts
  FROM (
    SELECT journal_name, contra_account, total,
      ROW_NUMBER() OVER (PARTITION BY journal_name ORDER BY total DESC) AS rn
    FROM contra_agg
  ) sub
  WHERE rn <= 3
  GROUP BY journal_name
)
SELECT
  tl.journal_name,
  COUNT(*)::bigint AS line_count,
  ROUND(SUM(tl.debit)::numeric, 2) AS debit_mxn,
  ROUND(SUM(tl.credit)::numeric, 2) AS credit_mxn,
  ROUND(SUM(tl.debit - tl.credit)::numeric, 2) AS net_mxn,
  COALESCE(tcj.top_contra_accounts, '') AS top_contra_accounts
FROM target_lines tl
LEFT JOIN top_contra_per_journal tcj USING (journal_name)
GROUP BY tl.journal_name, tcj.top_contra_accounts
ORDER BY ABS(SUM(tl.debit - tl.credit)) DESC;
$function$;

-- ─────────────────────────────────────────────────────────────────────────
-- RPC 2: detalle factura por factura por cuenta GL
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_account_invoice_lines(
  p_account_code text,
  p_from_period text,
  p_to_period text,
  p_limit int DEFAULT 100
)
RETURNS TABLE(
  date date,
  entry_name text,
  journal_name text,
  vendor_company_id bigint,
  vendor_name text,
  product_id int,
  product_ref text,
  description text,
  debit_mxn numeric,
  credit_mxn numeric,
  net_mxn numeric
)
LANGUAGE sql STABLE
AS $function$
WITH lines AS (
  SELECT
    e.date,
    e.name AS entry_name,
    e.journal_name,
    (line->>'partner_id')::int AS partner_id,
    (line->>'product_id')::int AS product_id,
    line->>'product_ref' AS product_ref,
    line->>'name' AS description,
    COALESCE((line->>'debit')::numeric, 0) AS debit,
    COALESCE((line->>'credit')::numeric, 0) AS credit
  FROM public.odoo_account_entries_stock e,
       jsonb_array_elements(e.lines_stock) AS line
  WHERE e.date >= (p_from_period || '-01')::date
    AND e.date < (date_trunc('month', (p_to_period || '-01')::date) + interval '1 month')::date
    AND line->>'account_code' = p_account_code
)
SELECT
  l.date,
  l.entry_name,
  l.journal_name,
  c.id::bigint AS vendor_company_id,
  COALESCE(c.canonical_name, '(sin proveedor)') AS vendor_name,
  l.product_id,
  l.product_ref,
  l.description,
  ROUND(l.debit::numeric, 2) AS debit_mxn,
  ROUND(l.credit::numeric, 2) AS credit_mxn,
  ROUND((l.debit - l.credit)::numeric, 2) AS net_mxn
FROM lines l
LEFT JOIN public.companies c ON c.odoo_partner_id = l.partner_id
WHERE l.debit + l.credit > 0
ORDER BY l.date DESC, ABS(l.debit - l.credit) DESC
LIMIT p_limit;
$function$;
