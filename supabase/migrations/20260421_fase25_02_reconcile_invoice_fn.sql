BEGIN;

CREATE OR REPLACE FUNCTION public.reconcile_invoice_manually(
  p_odoo_invoice_id bigint,
  p_syntage_uuid text,
  p_linked_by text,
  p_note text DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_id bigint;
  v_existing_uuid text;
BEGIN
  IF p_odoo_invoice_id IS NULL AND p_syntage_uuid IS NULL THEN
    RAISE EXCEPTION 'Al menos uno de odoo_invoice_id o syntage_uuid debe ser NOT NULL';
  END IF;

  IF p_linked_by IS NULL OR p_linked_by = '' THEN
    RAISE EXCEPTION 'linked_by es obligatorio (quién hizo el link)';
  END IF;

  -- Insert del manual link (idempotente)
  INSERT INTO public.invoice_bridge_manual (odoo_invoice_id, syntage_uuid, linked_by, note)
  VALUES (p_odoo_invoice_id, p_syntage_uuid, p_linked_by, p_note)
  ON CONFLICT (odoo_invoice_id, syntage_uuid)
  DO UPDATE SET note = EXCLUDED.note, linked_by = EXCLUDED.linked_by, linked_at = now()
  RETURNING id INTO v_id;

  -- Poblar cfdi_uuid en odoo_invoices si estaba NULL
  IF p_odoo_invoice_id IS NOT NULL AND p_syntage_uuid IS NOT NULL THEN
    SELECT cfdi_uuid INTO v_existing_uuid FROM public.odoo_invoices WHERE id = p_odoo_invoice_id;
    IF v_existing_uuid IS NULL THEN
      UPDATE public.odoo_invoices SET cfdi_uuid = p_syntage_uuid WHERE id = p_odoo_invoice_id;
    ELSIF v_existing_uuid <> p_syntage_uuid THEN
      RAISE WARNING 'odoo_invoice % already has cfdi_uuid % (distinto al solicitado %) — manual link guardado pero NO se sobrescribe odoo_invoices.cfdi_uuid',
        p_odoo_invoice_id, v_existing_uuid, p_syntage_uuid;
    END IF;
  END IF;

  -- Resolver issues relacionados
  UPDATE public.reconciliation_issues ri
  SET resolved_at = now(),
      resolution = format('manual_link by %s: %s', p_linked_by, COALESCE(p_note,''))
  WHERE ri.resolved_at IS NULL
    AND ri.issue_type IN ('sat_only_cfdi_issued','sat_only_cfdi_received','cancelled_but_posted')
    AND (
      (p_odoo_invoice_id IS NOT NULL AND ri.odoo_invoice_id = p_odoo_invoice_id) OR
      (p_syntage_uuid IS NOT NULL AND ri.uuid_sat = p_syntage_uuid)
    );

  RETURN v_id;
END $$;

COMMENT ON FUNCTION public.reconcile_invoice_manually IS
  'UX reconciliation: vincula manualmente factura Odoo ↔ CFDI SAT. Pobla cfdi_uuid si NULL (nunca sobrescribe). Resuelve issues.';

INSERT INTO public.schema_changes (change_type, table_name, description, sql_executed)
VALUES ('create_function', 'reconcile_invoice_manually(bigint,text,text,text)', 'Fase 2.5 — reconciliación manual invoice bridge', 'CREATE OR REPLACE FUNCTION reconcile_invoice_manually(p_odoo_invoice_id bigint, p_syntage_uuid text, p_linked_by text, p_note text) RETURNS bigint');

COMMIT;
