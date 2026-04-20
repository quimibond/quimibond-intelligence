BEGIN;

CREATE TABLE IF NOT EXISTS public.payment_bridge_manual (
  id bigserial PRIMARY KEY,
  odoo_payment_id bigint,
  syntage_complemento_uuid text,
  linked_by text NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT now(),
  note text,
  CONSTRAINT payment_bridge_manual_unique UNIQUE (odoo_payment_id, syntage_complemento_uuid),
  CONSTRAINT payment_bridge_manual_not_both_null CHECK (odoo_payment_id IS NOT NULL OR syntage_complemento_uuid IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_payment_bridge_manual_op ON public.payment_bridge_manual (odoo_payment_id) WHERE odoo_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payment_bridge_manual_sat ON public.payment_bridge_manual (syntage_complemento_uuid) WHERE syntage_complemento_uuid IS NOT NULL;

COMMENT ON TABLE public.payment_bridge_manual IS
  'Overrides manuales del bridge pago Odoo↔Syntage. Append-only. Usa reconcile_payment_manually() para insertar.';

CREATE OR REPLACE FUNCTION public.reconcile_payment_manually(
  p_odoo_payment_id bigint,
  p_syntage_complemento_uuid text,
  p_linked_by text,
  p_note text DEFAULT NULL
) RETURNS bigint
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE v_id bigint;
BEGIN
  IF p_odoo_payment_id IS NULL AND p_syntage_complemento_uuid IS NULL THEN
    RAISE EXCEPTION 'Al menos uno de odoo_payment_id o syntage_complemento_uuid debe ser NOT NULL';
  END IF;
  IF p_linked_by IS NULL OR p_linked_by = '' THEN
    RAISE EXCEPTION 'linked_by es obligatorio';
  END IF;

  INSERT INTO public.payment_bridge_manual (odoo_payment_id, syntage_complemento_uuid, linked_by, note)
  VALUES (p_odoo_payment_id, p_syntage_complemento_uuid, p_linked_by, p_note)
  ON CONFLICT (odoo_payment_id, syntage_complemento_uuid)
  DO UPDATE SET note = EXCLUDED.note, linked_by = EXCLUDED.linked_by, linked_at = now()
  RETURNING id INTO v_id;

  -- Resolver issues payment_missing_complemento / complemento_missing_payment relacionados
  UPDATE public.reconciliation_issues ri
  SET resolved_at = now(),
      resolution = format('manual_payment_link by %s: %s', p_linked_by, COALESCE(p_note,''))
  WHERE ri.resolved_at IS NULL
    AND ri.issue_type IN ('payment_missing_complemento','complemento_missing_payment')
    AND (
      (p_odoo_payment_id IS NOT NULL AND ri.odoo_payment_id = p_odoo_payment_id) OR
      (p_syntage_complemento_uuid IS NOT NULL AND ri.uuid_sat = p_syntage_complemento_uuid)
    );

  RETURN v_id;
END $$;

COMMENT ON FUNCTION public.reconcile_payment_manually IS
  'UX reconciliation: vincula manualmente pago Odoo ↔ complemento SAT.';

INSERT INTO public.schema_changes (change_type, table_name, description, sql_executed) VALUES
  ('create_table',    'payment_bridge_manual',                              'Fase 2.5 — manual overrides payment bridge',         'CREATE TABLE payment_bridge_manual (id bigserial PK, odoo_payment_id bigint, syntage_complemento_uuid text, linked_by text NOT NULL, linked_at timestamptz, note text)'),
  ('create_function', 'reconcile_payment_manually(bigint,text,text,text)',  'Fase 2.5 — reconciliación manual pago',              'CREATE OR REPLACE FUNCTION reconcile_payment_manually(p_odoo_payment_id bigint, p_syntage_complemento_uuid text, p_linked_by text, p_note text) RETURNS bigint');

COMMIT;
