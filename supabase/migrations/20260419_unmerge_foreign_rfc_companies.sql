-- Undo incorrect merge de clientes exportación que compartían tax ID foráneo.
-- LEAR Zaragoza plant (odoo_partner_id=8101) y Shawmut Corporation (odoo_partner_id=1783)
-- fueron merged incorrectamente porque comparten tax ID foráneo con su entidad matriz
-- (743184599 y 830963693). Para exportaciones, tax IDs foráneos NO son únicos por entidad.
-- Restore separando las rows y reasignando FKs según odoo_partner_id original.

DO $$
DECLARE
  v_lear_plant_id bigint;
  v_shawmut_corp_id bigint;
BEGIN
  INSERT INTO public.companies
    (canonical_name, name, odoo_partner_id, is_customer, is_supplier, rfc, country, created_at, updated_at)
  VALUES ('lear mexican seating corp. zaragoza plant',
          'Lear Mexican Seating Corp. Zaragoza Plant',
          8101, true, false, '743184599', 'Mexico', now(), now())
  RETURNING id INTO v_lear_plant_id;

  INSERT INTO public.companies
    (canonical_name, name, odoo_partner_id, is_customer, is_supplier, rfc, country, created_at, updated_at)
  VALUES ('shawmut corporation', 'Shawmut Corporation',
          1783, true, true, '830963693', 'USA', now(), now())
  RETURNING id INTO v_shawmut_corp_id;

  -- Reasignar FKs que pertenecen a Zaragoza plant
  UPDATE public.odoo_invoices        SET company_id = v_lear_plant_id WHERE odoo_partner_id=8101 AND company_id=6042;
  UPDATE public.odoo_sale_orders     SET company_id = v_lear_plant_id WHERE odoo_partner_id=8101 AND company_id=6042;
  UPDATE public.odoo_purchase_orders SET company_id = v_lear_plant_id WHERE odoo_partner_id=8101 AND company_id=6042;
  UPDATE public.odoo_deliveries      SET company_id = v_lear_plant_id WHERE odoo_partner_id=8101 AND company_id=6042;
  UPDATE public.odoo_order_lines     SET company_id = v_lear_plant_id WHERE odoo_partner_id=8101 AND company_id=6042;
  UPDATE public.odoo_invoice_lines   SET company_id = v_lear_plant_id WHERE odoo_partner_id=8101 AND company_id=6042;
  UPDATE public.odoo_payments        SET company_id = v_lear_plant_id WHERE odoo_partner_id=8101 AND company_id=6042;
  UPDATE public.odoo_account_payments SET company_id = v_lear_plant_id WHERE odoo_partner_id=8101 AND company_id=6042;
  UPDATE public.odoo_crm_leads       SET company_id = v_lear_plant_id WHERE odoo_partner_id=8101 AND company_id=6042;
  UPDATE public.odoo_activities      SET company_id = v_lear_plant_id WHERE odoo_partner_id=8101 AND company_id=6042;

  -- Reasignar FKs que pertenecen a Shawmut Corporation
  UPDATE public.odoo_invoices        SET company_id = v_shawmut_corp_id WHERE odoo_partner_id=1783 AND company_id=6031;
  UPDATE public.odoo_sale_orders     SET company_id = v_shawmut_corp_id WHERE odoo_partner_id=1783 AND company_id=6031;
  UPDATE public.odoo_purchase_orders SET company_id = v_shawmut_corp_id WHERE odoo_partner_id=1783 AND company_id=6031;
  UPDATE public.odoo_deliveries      SET company_id = v_shawmut_corp_id WHERE odoo_partner_id=1783 AND company_id=6031;
  UPDATE public.odoo_order_lines     SET company_id = v_shawmut_corp_id WHERE odoo_partner_id=1783 AND company_id=6031;
  UPDATE public.odoo_invoice_lines   SET company_id = v_shawmut_corp_id WHERE odoo_partner_id=1783 AND company_id=6031;
  UPDATE public.odoo_payments        SET company_id = v_shawmut_corp_id WHERE odoo_partner_id=1783 AND company_id=6031;
  UPDATE public.odoo_account_payments SET company_id = v_shawmut_corp_id WHERE odoo_partner_id=1783 AND company_id=6031;
  UPDATE public.odoo_crm_leads       SET company_id = v_shawmut_corp_id WHERE odoo_partner_id=1783 AND company_id=6031;
  UPDATE public.odoo_activities      SET company_id = v_shawmut_corp_id WHERE odoo_partner_id=1783 AND company_id=6031;
END $$;

-- dq_company_duplicates: exclude tax IDs foráneos del auto-merge detection
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
  AND rfc ~ '^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$'  -- solo RFCs mexicanos patrón estricto
GROUP BY rfc HAVING count(*)>1
ORDER BY count(*) DESC, rfc;

COMMENT ON VIEW public.dq_company_duplicates IS
  'DQ audit: companies con RFC MEXICANO duplicado (patrón estricto 12-13 chars). Excluye genéricos + tax IDs foráneos. Clientes export con plantas/entidades separadas NO deben auto-merge.';
