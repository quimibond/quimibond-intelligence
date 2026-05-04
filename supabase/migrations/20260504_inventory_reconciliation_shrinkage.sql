-- /inventario/conciliacion — book vs físico + shrinkage tracker
--
-- Soporta la página /inventario/conciliacion que expone:
--   1. Reconciliación de inventario contable (115.x) vs físico
--      (canonical_products.stock_qty * avg_cost_mxn)
--   2. Tracker de shrinkage por SKU desde 501.01.08 DIFERENCIAS POR CONTEO
--
-- El shrinkage de Quimibond creció exponencialmente en 2026:
--   Ene: −$11k, Feb: $4k, Mar: $62k, Abr: $379k.
-- Cada faltante físico se contabiliza como:
--   Cr 115.02.01 (raw materials)   X
--   Dr 501.01.08 (diferencias)     X     ← esto es la pérdida por SKU
--
-- La info per-SKU vive en odoo_account_entries_stock.lines_stock (jsonb).
-- Filtrar por cogs_account_codes era O(n) sin índice → timeout. Agregamos
-- un GIN index sobre el array, después una RPC que hace el unnest del
-- jsonb server-side y devuelve eventos planos.

-- ─────────────────────────────────────────────────────────────────────────
-- Index GIN para filtros @> sobre cogs_account_codes
-- ─────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS ix_oaes_cogs_codes_gin
  ON public.odoo_account_entries_stock USING GIN (cogs_account_codes);

-- ─────────────────────────────────────────────────────────────────────────
-- RPC: get_shrinkage_events
-- Devuelve NET shrinkage (debit − credit) por (entry, producto) en 501.01.08.
-- net > 0 = pérdida real | net < 0 = corrección positiva (sobrante encontrado)
--
-- ¿Por qué net y no gross debit? Quimibond a veces hace ajustes masivos +
-- reversa inmediata (ej. STJ/2026/01/4104 con 247 debits + STJ/2026/01/4111
-- con 247 credits que se cancelan). El gross debit reportaba $4.6M YTD pero
-- el real shrinkage neto es $434k.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_shrinkage_events(
  p_from_period text,
  p_to_period text
)
RETURNS TABLE(
  date date,
  entry_name text,
  product_id int,
  product_ref text,
  product_name text,
  loss_mxn numeric,
  inventory_account text
)
LANGUAGE sql STABLE
AS $function$
WITH events AS (
  SELECT
    e.date,
    e.name AS entry_name,
    e.lines_stock
  FROM public.odoo_account_entries_stock e
  WHERE e.date >= (p_from_period || '-01')::date
    AND e.date < (date_trunc('month', (p_to_period || '-01')::date) + interval '1 month')::date
    AND e.cogs_account_codes @> ARRAY['501.01.08']::text[]
),
all_lines AS (
  SELECT
    e.date,
    e.entry_name,
    line->>'name' AS line_name,
    (line->>'product_id')::int AS product_id,
    line->>'product_ref' AS product_ref,
    COALESCE((line->>'debit')::numeric, 0) AS debit,
    COALESCE((line->>'credit')::numeric, 0) AS credit,
    line->>'account_code' AS account_code
  FROM events e, jsonb_array_elements(e.lines_stock) AS line
),
net_per_sku AS (
  SELECT
    date,
    entry_name,
    product_id,
    product_ref,
    MAX(line_name) AS product_name,
    SUM(debit - credit) AS net_loss
  FROM all_lines
  WHERE account_code = '501.01.08'
  GROUP BY date, entry_name, product_id, product_ref
  HAVING SUM(debit - credit) <> 0
),
inv_per_sku AS (
  SELECT DISTINCT ON (entry_name, product_id)
    entry_name,
    product_id,
    account_code
  FROM all_lines
  WHERE account_code LIKE '115.%'
    AND credit > 0
  ORDER BY entry_name, product_id, credit DESC
)
SELECT
  n.date,
  n.entry_name,
  n.product_id,
  n.product_ref,
  n.product_name,
  ROUND(n.net_loss::numeric, 2) AS loss_mxn,
  i.account_code AS inventory_account
FROM net_per_sku n
LEFT JOIN inv_per_sku i
  ON i.entry_name = n.entry_name AND i.product_id = n.product_id
ORDER BY n.date DESC, n.net_loss DESC;
$function$;
