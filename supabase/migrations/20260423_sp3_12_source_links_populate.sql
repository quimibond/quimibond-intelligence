-- SP3 Task 12: populate source_links retroactively
-- Applied in sub-batches to avoid timeouts:
--   12a+12b  companies (odoo + sat shadow)
--   12c      contacts (employee + user + partner)
--   12d      products (odoo + fiscal_map override)
--   12e_odoo invoices → odoo  (~27k rows)
--   12e_sat  invoices → sat   (~86k rows)
--   12f      payments (odoo + sat)
--   12g      credit_notes (odoo + sat)
--   12h      tax_events → sat (CASE mapping per event_type)
--
-- Fix applied vs plan: tax_events source_table uses explicit CASE mapping
--   retention            → syntage_tax_retentions
--   tax_return           → syntage_tax_returns
--   electronic_accounting → syntage_electronic_accounting
-- (plan's string concat would have produced wrong table names)
--
-- Pre-gate counts (2026-04-20):
--   cc_odoo=2197  cc_sat_shadow=2162
--   cct_emp=150   cct_user=40   cct_partner=1839
--   cprod_odoo=6004
--   ci_odoo=27198  ci_sat=86299
--   cp_odoo=17869  cp_sat=25511
--   ccn_odoo=583   ccn_sat=2016
--   cte_sat=398

BEGIN;

-- 12a. companies → odoo
INSERT INTO source_links (canonical_entity_type, canonical_entity_id, source, source_table, source_id, source_natural_key, match_method, match_confidence, matched_by)
SELECT 'company', cc.id::text, 'odoo', 'companies',
       (SELECT c.id::text FROM companies c WHERE c.canonical_name = cc.canonical_name LIMIT 1),
       cc.odoo_partner_id::text,
       COALESCE(cc.match_method, 'odoo_partner_id'),
       COALESCE(cc.match_confidence, 0.99),
       'system'
FROM canonical_companies cc
WHERE cc.odoo_partner_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- 12b. companies → sat (shadows by rfc)
INSERT INTO source_links (canonical_entity_type, canonical_entity_id, source, source_table, source_id, source_natural_key, match_method, match_confidence, matched_by)
SELECT 'company', cc.id::text, 'sat', 'syntage_invoices', cc.rfc, cc.rfc,
       'sat_only', 0.50, 'system'
FROM canonical_companies cc
WHERE cc.has_shadow_flag = true AND cc.rfc IS NOT NULL
ON CONFLICT DO NOTHING;

-- 12c. contacts → odoo_employees
INSERT INTO source_links (canonical_entity_type, canonical_entity_id, source, source_table, source_id, source_natural_key, match_method, match_confidence, matched_by)
SELECT 'contact', cct.id::text, 'odoo', 'odoo_employees', cct.odoo_employee_id::text, cct.primary_email, 'email_exact', 0.99, 'system'
FROM canonical_contacts cct WHERE cct.odoo_employee_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- 12c. contacts → odoo_users
INSERT INTO source_links (canonical_entity_type, canonical_entity_id, source, source_table, source_id, source_natural_key, match_method, match_confidence, matched_by)
SELECT 'contact', cct.id::text, 'odoo', 'odoo_users', cct.odoo_user_id::text, cct.primary_email, 'email_exact', 0.99, 'system'
FROM canonical_contacts cct WHERE cct.odoo_user_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- 12c. contacts → contacts (partner)
INSERT INTO source_links (canonical_entity_type, canonical_entity_id, source, source_table, source_id, source_natural_key, match_method, match_confidence, matched_by)
SELECT 'contact', cct.id::text, 'odoo', 'contacts', cct.odoo_partner_id::text, cct.primary_email, 'email_exact', 0.99, 'system'
FROM canonical_contacts cct WHERE cct.odoo_partner_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- 12d. products → odoo_products
INSERT INTO source_links (canonical_entity_type, canonical_entity_id, source, source_table, source_id, source_natural_key, match_method, match_confidence, matched_by)
SELECT 'product', cp.id::text, 'odoo', 'odoo_products', cp.odoo_product_id::text, cp.internal_ref, 'internal_ref_exact', 1.000, 'system'
FROM canonical_products cp
WHERE cp.odoo_product_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- 12d. products → products_fiscal_map (manual overrides)
INSERT INTO source_links (canonical_entity_type, canonical_entity_id, source, source_table, source_id, source_natural_key, match_method, match_confidence, matched_by)
SELECT 'product', cp.id::text, 'manual', 'products_fiscal_map', pfm.id::text, cp.internal_ref, 'manual_override', 1.000, COALESCE(pfm.created_by,'system')
FROM canonical_products cp
JOIN products_fiscal_map pfm ON pfm.odoo_product_id = cp.odoo_product_id
ON CONFLICT DO NOTHING;

-- 12e_odoo. invoices → odoo
INSERT INTO source_links (canonical_entity_type, canonical_entity_id, source, source_table, source_id, source_natural_key, match_method, match_confidence, matched_by)
SELECT 'invoice', ci.canonical_id, 'odoo', 'odoo_invoices', ci.odoo_invoice_id::text, ci.cfdi_uuid_odoo,
       COALESCE(ci.resolved_from, 'odoo_only'),
       CASE ci.match_confidence WHEN 'exact' THEN 1.000 WHEN 'high' THEN 0.90 WHEN 'medium' THEN 0.80 ELSE 0.50 END,
       'system'
FROM canonical_invoices ci WHERE ci.odoo_invoice_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- 12e_sat. invoices → sat
INSERT INTO source_links (canonical_entity_type, canonical_entity_id, source, source_table, source_id, source_natural_key, match_method, match_confidence, matched_by)
SELECT 'invoice', ci.canonical_id, 'sat', 'syntage_invoices', ci.sat_uuid, ci.sat_uuid,
       COALESCE(ci.resolved_from, 'uuid_exact'),
       CASE ci.match_confidence WHEN 'exact' THEN 1.000 WHEN 'high' THEN 0.90 WHEN 'medium' THEN 0.80 ELSE 1.000 END,
       'system'
FROM canonical_invoices ci WHERE ci.sat_uuid IS NOT NULL
ON CONFLICT DO NOTHING;

-- 12f. payments → odoo_account_payments
INSERT INTO source_links (canonical_entity_type, canonical_entity_id, source, source_table, source_id, source_natural_key, match_method, match_confidence, matched_by)
SELECT 'payment', cp.canonical_id, 'odoo', 'odoo_account_payments', cp.odoo_payment_id::text, cp.odoo_ref,
       CASE WHEN cp.sat_uuid_complemento IS NOT NULL THEN 'num_operacion_exact' ELSE 'odoo_only' END,
       CASE WHEN cp.sat_uuid_complemento IS NOT NULL THEN 0.85 ELSE 0.99 END, 'system'
FROM canonical_payments cp WHERE cp.odoo_payment_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- 12f. payments → sat (syntage_invoice_payments)
INSERT INTO source_links (canonical_entity_type, canonical_entity_id, source, source_table, source_id, source_natural_key, match_method, match_confidence, matched_by)
SELECT 'payment', cp.canonical_id, 'sat', 'syntage_invoice_payments', cp.sat_uuid_complemento, cp.sat_uuid_complemento,
       'uuid_exact', 1.000, 'system'
FROM canonical_payments cp WHERE cp.sat_uuid_complemento IS NOT NULL
ON CONFLICT DO NOTHING;

-- 12g. credit_notes → odoo_invoices
INSERT INTO source_links (canonical_entity_type, canonical_entity_id, source, source_table, source_id, source_natural_key, match_method, match_confidence, matched_by)
SELECT 'credit_note', ccn.canonical_id, 'odoo', 'odoo_invoices', ccn.odoo_invoice_id::text, ccn.sat_uuid, 'odoo_partner_id', 0.99, 'system'
FROM canonical_credit_notes ccn WHERE ccn.odoo_invoice_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- 12g. credit_notes → sat (syntage_invoices)
INSERT INTO source_links (canonical_entity_type, canonical_entity_id, source, source_table, source_id, source_natural_key, match_method, match_confidence, matched_by)
SELECT 'credit_note', ccn.canonical_id, 'sat', 'syntage_invoices', ccn.sat_uuid, ccn.sat_uuid, 'uuid_exact', 1.000, 'system'
FROM canonical_credit_notes ccn WHERE ccn.sat_uuid IS NOT NULL
ON CONFLICT DO NOTHING;

-- 12h. tax_events → sat (CORRECTED: explicit CASE for table names)
INSERT INTO source_links (canonical_entity_type, canonical_entity_id, source, source_table, source_id, source_natural_key, match_method, match_confidence, matched_by)
SELECT 'tax_event', cte.canonical_id, 'sat',
       CASE cte.event_type
         WHEN 'retention'              THEN 'syntage_tax_retentions'
         WHEN 'tax_return'             THEN 'syntage_tax_returns'
         WHEN 'electronic_accounting'  THEN 'syntage_electronic_accounting'
       END,
       cte.sat_record_id,
       COALESCE(cte.retention_uuid, cte.return_numero_operacion, cte.acct_hash),
       'uuid_exact', 1.000, 'system'
FROM canonical_tax_events cte
WHERE cte.sat_record_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('populate','source_links','SP3 Task 12: retroactive populate from canonical_*','20260423_sp3_12_source_links_populate.sql','silver-sp3',true);

COMMIT;
