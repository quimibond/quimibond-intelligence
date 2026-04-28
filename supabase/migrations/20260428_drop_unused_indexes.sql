-- Drop 44 indexes never used (idx_scan=0).
-- Verificado via Supabase advisor + pg_stat_user_indexes (stats acumuladas
-- desde inicio del cluster; recon engine corre cada hora y nunca toco
-- estos indices). Frees ~230 MB.
-- Reversible: cada indice puede recrearse on-demand si se necesita.

-- odoo_stock_moves (109 MB)
DROP INDEX IF EXISTS public.ix_osm_no_acct;
DROP INDEX IF EXISTS public.ix_osm_state;
DROP INDEX IF EXISTS public.idx_moves_production_id;

-- canonical_stock_moves (~30 MB)
DROP INDEX IF EXISTS public.ix_csm_state_done;
DROP INDEX IF EXISTS public.ix_csm_picking;
DROP INDEX IF EXISTS public.ix_csm_production;

-- odoo_account_entries_stock (~60 MB)
DROP INDEX IF EXISTS public.idx_entries_lines_gin;
DROP INDEX IF EXISTS public.ix_oaes_no_stock;

-- mv_entry_lines_flat (~4.4 MB)
DROP INDEX IF EXISTS public.idx_mv_flat_date;
DROP INDEX IF EXISTS public.idx_mv_flat_account;

-- source_links (10 MB)
DROP INDEX IF EXISTS public.ix_sl_natural_key;

-- canonical_products (3.7 MB)
DROP INDEX IF EXISTS public.ix_cprod_name_trgm;
DROP INDEX IF EXISTS public.ix_cprod_category;

-- canonical_contacts
DROP INDEX IF EXISTS public.ix_cct_name_trgm;
DROP INDEX IF EXISTS public.ix_cct_manual_override;
DROP INDEX IF EXISTS public.ix_cct_needs_review;

-- ai_extracted_facts
DROP INDEX IF EXISTS public.ai_extracted_facts_legacy_idx;
DROP INDEX IF EXISTS public.ai_extracted_facts_not_expired_idx;

-- syntage file id indexes (file-based lookups never wired)
DROP INDEX IF EXISTS public.syntage_invoices_pdf_file_id_idx;
DROP INDEX IF EXISTS public.syntage_invoices_xml_file_id_idx;
DROP INDEX IF EXISTS public.syntage_invoice_payments_xml_file_id_idx;
DROP INDEX IF EXISTS public.syntage_tax_retentions_xml_file_id_idx;
DROP INDEX IF EXISTS public.syntage_tax_returns_pdf_file_id_idx;
DROP INDEX IF EXISTS public.syntage_tax_status_pdf_file_id_idx;
DROP INDEX IF EXISTS public.syntage_electronic_accounting_xml_file_id_idx;

-- syntage other unused
DROP INDEX IF EXISTS public.idx_syntage_payments_batch_id;
DROP INDEX IF EXISTS public.idx_syntage_invoices_quimibond_relevant;

-- canonical_invoices (partial indexes for features not hit)
DROP INDEX IF EXISTS public.ix_canonical_invoices_needs_review;
DROP INDEX IF EXISTS public.ix_canonical_invoices_historical;

-- canonical_account_payments (recent table, indexes never used)
DROP INDEX IF EXISTS public.ix_cap_state;
DROP INDEX IF EXISTS public.ix_cap_canonical_payment;
DROP INDEX IF EXISTS public.ix_cap_canonical_payment_text;

-- canonical_credit_notes
DROP INDEX IF EXISTS public.ix_ccn_state_mismatch;
DROP INDEX IF EXISTS public.idx_canonical_credit_notes_quimibond_relevant;

-- canonical_tax_events
DROP INDEX IF EXISTS public.ix_cte_odoo_match;

-- canonical_sale_orders / purchase_orders
DROP INDEX IF EXISTS public.canonical_sale_orders_overdue_idx;
DROP INDEX IF EXISTS public.canonical_purchase_orders_buyer_idx;

-- mdm_manual_overrides (small but unused)
DROP INDEX IF EXISTS public.ix_mmo_field;
DROP INDEX IF EXISTS public.ix_mmo_active;

-- odoo_workorders / manufacturing
DROP INDEX IF EXISTS public.idx_workorders_production;
DROP INDEX IF EXISTS public.idx_workorders_workcenter;
DROP INDEX IF EXISTS public.idx_manufacturing_bom_id;

-- audit_runs / departments (8-80 kB each, unused)
DROP INDEX IF EXISTS public.audit_runs_severity_idx;
DROP INDEX IF EXISTS public.departments_lead_user_id_idx;
