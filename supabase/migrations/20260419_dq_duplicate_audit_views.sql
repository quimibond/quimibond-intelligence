-- Data quality audit views · reveals duplicates for manual review

-- 1. companies duplicates (excluyendo RFCs genéricos legítimos XAXX/XEXX/propio)
CREATE OR REPLACE VIEW public.dq_company_duplicates AS
SELECT
  rfc,
  count(*) AS duplicate_count,
  array_agg(id ORDER BY id) AS company_ids,
  array_agg(canonical_name ORDER BY id) AS names,
  array_agg(is_customer ORDER BY id) AS customer_flags,
  array_agg(is_supplier ORDER BY id) AS supplier_flags,
  (SELECT id FROM public.companies c2 WHERE c2.rfc = c.rfc ORDER BY
    c2.is_customer DESC NULLS LAST, c2.is_supplier DESC NULLS LAST, c2.id ASC
    LIMIT 1) AS recommended_keeper_id
FROM public.companies c
WHERE rfc IS NOT NULL AND rfc<>''
  AND rfc NOT IN ('XAXX010101000','XEXX010101000','PNT920218IW5')
GROUP BY rfc
HAVING count(*)>1
ORDER BY count(*) DESC, rfc;

COMMENT ON VIEW public.dq_company_duplicates IS
  'DQ audit: companies con RFC duplicado (11 groups / 13 dups). Requieren merge manual — deduplicate_all() no los detecta (canonical_names difieren).';

-- 2. odoo_products duplicates (pattern archived+active con mismo code)
CREATE OR REPLACE VIEW public.dq_product_code_duplicates AS
SELECT
  internal_ref,
  count(*) AS duplicate_count,
  array_agg(odoo_product_id ORDER BY active DESC NULLS LAST, odoo_product_id) AS product_ids,
  array_agg(active ORDER BY active DESC NULLS LAST, odoo_product_id) AS active_flags,
  array_agg(stock_qty ORDER BY active DESC NULLS LAST, odoo_product_id) AS stock_qtys,
  (SELECT odoo_product_id FROM public.odoo_products p2
   WHERE p2.internal_ref = p.internal_ref
   ORDER BY active DESC NULLS LAST, stock_qty DESC NULLS LAST, odoo_product_id ASC
   LIMIT 1) AS recommended_keeper
FROM public.odoo_products p
WHERE internal_ref IS NOT NULL AND internal_ref<>''
GROUP BY internal_ref HAVING count(*)>1
ORDER BY count(*) DESC, internal_ref;

COMMENT ON VIEW public.dq_product_code_duplicates IS
  '48 codes duplicados (active + archived mismo code). Fix en Odoo — archived products deben cambiar default_code.';

-- 3. odoo_invoices cfdi_uuid duplicates (Odoo DQ known issue)
CREATE OR REPLACE VIEW public.dq_invoice_uuid_duplicates AS
SELECT
  cfdi_uuid,
  count(*) AS duplicate_count,
  (SELECT max(move_type) FROM public.odoo_invoices o2 WHERE o2.cfdi_uuid = o.cfdi_uuid) AS move_type,
  (SELECT max(state) FROM public.odoo_invoices o2 WHERE o2.cfdi_uuid = o.cfdi_uuid) AS state,
  array_agg(DISTINCT name ORDER BY name) AS invoice_names,
  sum(amount_total_mxn) AS total_amount_mxn,
  (SELECT id FROM public.odoo_invoices o2 WHERE o2.cfdi_uuid = o.cfdi_uuid
   ORDER BY invoice_date DESC NULLS LAST, id DESC LIMIT 1) AS recommended_keeper
FROM public.odoo_invoices o
WHERE cfdi_uuid IS NOT NULL AND cfdi_uuid<>''
GROUP BY cfdi_uuid HAVING count(*)>1
ORDER BY count(*) DESC LIMIT 100;

COMMENT ON VIEW public.dq_invoice_uuid_duplicates IS
  '1547 UUIDs con múltiples invoices (hasta 38). invoices_unified MV usa DISTINCT ON. Fix en Odoo: UUID debe ser único.';

-- 4. Payments matching broken (data ingestion gap)
CREATE OR REPLACE VIEW public.dq_payments_unmatchable AS
SELECT
  'missing_num_operacion' AS issue,
  count(*) AS affected_rows,
  'Re-ingesta enriquecida Syntage API (CSV no tenía num_operacion ni rfc_emisor)' AS fix
FROM public.syntage_invoice_payments
WHERE num_operacion IS NULL OR num_operacion=''
UNION ALL SELECT 'odoo_payments_missing_ref',
  (SELECT count(*) FROM public.odoo_account_payments WHERE ref IS NULL OR ref=''),
  'Fix qb19 addon sync_push.py · account.payment incluir campo ref';

COMMENT ON VIEW public.dq_payments_unmatchable IS
  'payments_unified tiene 0 matches: campos clave vacíos en ambos lados. Requiere re-ingesta.';

GRANT SELECT ON public.dq_company_duplicates TO service_role, authenticated;
GRANT SELECT ON public.dq_product_code_duplicates TO service_role, authenticated;
GRANT SELECT ON public.dq_invoice_uuid_duplicates TO service_role, authenticated;
GRANT SELECT ON public.dq_payments_unmatchable TO service_role, authenticated;
