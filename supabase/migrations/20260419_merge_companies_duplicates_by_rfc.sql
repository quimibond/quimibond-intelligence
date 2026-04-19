-- Merge companies duplicates por RFC (excluyendo genéricos XAXX/XEXX/PNT).
-- Reasigna 22 tablas al keeper y elimina los 13 duplicates.

DO $$
DECLARE
  v_rfc text;
  v_keeper_id bigint;
  v_dup_ids bigint[];
  v_merged int := 0;
BEGIN
  FOR v_rfc IN
    SELECT rfc FROM public.companies
    WHERE rfc IS NOT NULL AND rfc<>''
      AND rfc NOT IN ('XAXX010101000','XEXX010101000','PNT920218IW5')
    GROUP BY rfc HAVING count(*)>1
  LOOP
    SELECT id INTO v_keeper_id FROM public.companies
    WHERE rfc = v_rfc
    ORDER BY COALESCE(is_customer, false) DESC, COALESCE(is_supplier, false) DESC, id ASC
    LIMIT 1;

    SELECT array_agg(id) INTO v_dup_ids FROM public.companies
    WHERE rfc = v_rfc AND id <> v_keeper_id;

    -- 19 tablas con UPDATE simple
    UPDATE public.action_items         SET company_id = v_keeper_id WHERE company_id = ANY(v_dup_ids);
    UPDATE public.agent_insights       SET company_id = v_keeper_id WHERE company_id = ANY(v_dup_ids);
    UPDATE public.briefings            SET company_id = v_keeper_id WHERE company_id = ANY(v_dup_ids);
    UPDATE public.contacts             SET company_id = v_keeper_id WHERE company_id = ANY(v_dup_ids);
    UPDATE public.emails               SET company_id = v_keeper_id WHERE company_id = ANY(v_dup_ids);
    UPDATE public.health_scores        SET company_id = v_keeper_id WHERE company_id = ANY(v_dup_ids);
    UPDATE public.insight_follow_ups   SET company_id = v_keeper_id WHERE company_id = ANY(v_dup_ids);
    UPDATE public.odoo_account_payments SET company_id = v_keeper_id WHERE company_id = ANY(v_dup_ids);
    UPDATE public.odoo_activities      SET company_id = v_keeper_id WHERE company_id = ANY(v_dup_ids);
    UPDATE public.odoo_crm_leads       SET company_id = v_keeper_id WHERE company_id = ANY(v_dup_ids);
    UPDATE public.odoo_deliveries      SET company_id = v_keeper_id WHERE company_id = ANY(v_dup_ids);
    UPDATE public.odoo_invoice_lines   SET company_id = v_keeper_id WHERE company_id = ANY(v_dup_ids);
    UPDATE public.odoo_invoices        SET company_id = v_keeper_id WHERE company_id = ANY(v_dup_ids);
    UPDATE public.odoo_order_lines     SET company_id = v_keeper_id WHERE company_id = ANY(v_dup_ids);
    UPDATE public.odoo_payments        SET company_id = v_keeper_id WHERE company_id = ANY(v_dup_ids);
    UPDATE public.revenue_metrics      SET company_id = v_keeper_id WHERE company_id = ANY(v_dup_ids);
    UPDATE public.syntage_invoices     SET company_id = v_keeper_id WHERE company_id = ANY(v_dup_ids);
    UPDATE public.threads              SET company_id = v_keeper_id WHERE company_id = ANY(v_dup_ids);
    UPDATE public.odoo_purchase_orders SET company_id = v_keeper_id WHERE company_id = ANY(v_dup_ids);
    UPDATE public.odoo_sale_orders     SET company_id = v_keeper_id WHERE company_id = ANY(v_dup_ids);
    UPDATE public.reconciliation_issues SET company_id = v_keeper_id WHERE company_id = ANY(v_dup_ids);

    -- odoo_snapshots: UNIQUE(company_id, snapshot_date) requires special handling
    DELETE FROM public.odoo_snapshots
    WHERE company_id = ANY(v_dup_ids)
      AND snapshot_date IN (SELECT snapshot_date FROM public.odoo_snapshots WHERE company_id = v_keeper_id);
    UPDATE public.odoo_snapshots SET company_id = v_keeper_id WHERE company_id = ANY(v_dup_ids);

    DELETE FROM public.companies WHERE id = ANY(v_dup_ids);
    v_merged := v_merged + array_length(v_dup_ids, 1);
  END LOOP;
  RAISE NOTICE 'Total merged: % duplicates across 22 tables', v_merged;
END $$;
