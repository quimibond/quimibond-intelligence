BEGIN;

-- Tabla de overrides manuales (append-only)
CREATE TABLE IF NOT EXISTS public.invoice_bridge_manual (
  id bigserial PRIMARY KEY,
  odoo_invoice_id bigint,
  syntage_uuid text,
  linked_by text NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT now(),
  note text,
  CONSTRAINT invoice_bridge_manual_unique UNIQUE (odoo_invoice_id, syntage_uuid),
  CONSTRAINT invoice_bridge_manual_not_both_null CHECK (odoo_invoice_id IS NOT NULL OR syntage_uuid IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_invoice_bridge_manual_odoo
  ON public.invoice_bridge_manual (odoo_invoice_id) WHERE odoo_invoice_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invoice_bridge_manual_syntage
  ON public.invoice_bridge_manual (syntage_uuid) WHERE syntage_uuid IS NOT NULL;

COMMENT ON TABLE public.invoice_bridge_manual IS
  'Overrides manuales del bridge invoice Odoo↔Syntage. Append-only. Usa reconcile_invoice_manually() para insertar.';

-- View del bridge (cheap SELECT de unified_invoices)
-- NOTE: plan referenced "invoices_unified" but actual view name is "unified_invoices"
CREATE OR REPLACE VIEW public.invoice_bridge AS
SELECT
  iu.canonical_id,
  iu.odoo_invoice_id,
  iu.uuid_sat AS syntage_uuid,
  iu.direction,
  iu.match_status,
  iu.match_quality AS match_confidence,
  CASE
    WHEN iu.odoo_invoice_id IS NOT NULL AND iu.uuid_sat IS NOT NULL THEN 'uuid_exact'
    WHEN iu.odoo_invoice_id IS NOT NULL AND iu.uuid_sat IS NULL THEN 'odoo_only'
    WHEN iu.odoo_invoice_id IS NULL AND iu.uuid_sat IS NOT NULL THEN 'syntage_only'
    ELSE 'none'
  END AS match_method,
  iu.odoo_amount_total_mxn AS amount_op,
  iu.total_mxn_fiscal      AS amount_sat,
  iu.amount_diff,
  iu.invoice_date          AS date_op,
  iu.fecha_timbrado::date  AS date_sat,
  iu.odoo_state            AS state_op,
  iu.estado_sat            AS state_sat,
  iu.payment_state,
  iu.emisor_rfc,
  iu.receptor_rfc,
  iu.company_id,
  iu.partner_name,
  -- Gap flags
  (iu.odoo_invoice_id IS NOT NULL AND iu.uuid_sat IS NULL AND iu.invoice_date >= '2021-01-01'::date) AS is_gap_missing_sat,
  (iu.odoo_invoice_id IS NULL AND iu.uuid_sat IS NOT NULL AND iu.fecha_timbrado >= '2021-01-01'::timestamptz) AS is_gap_missing_odoo,
  (iu.odoo_state = 'cancel' AND iu.estado_sat = 'vigente') AS is_state_mismatch_cancel_vigente,
  (iu.odoo_state = 'posted' AND iu.estado_sat = 'cancelado') AS is_state_mismatch_posted_cancel,
  -- Manual link flag
  EXISTS (
    SELECT 1 FROM public.invoice_bridge_manual m
    WHERE (m.odoo_invoice_id = iu.odoo_invoice_id)
       OR (m.syntage_uuid = iu.uuid_sat)
  ) AS has_manual_link
FROM public.unified_invoices iu;

COMMENT ON VIEW public.invoice_bridge IS
  'Puente operativo (Odoo) ↔ fiscal (Syntage). Cada fila = factura con su contraparte, método de match, y flags de gap.';

INSERT INTO public.schema_changes (change_type, table_name, description, sql_executed) VALUES
  ('create_table', 'invoice_bridge_manual', 'Fase 2.5 — overrides manuales bridge Odoo↔Syntage', 'CREATE TABLE invoice_bridge_manual (id bigserial PK, odoo_invoice_id bigint, syntage_uuid text, linked_by text NOT NULL, linked_at timestamptz, note text)'),
  ('create_view',  'invoice_bridge',        'Fase 2.5 — view unificada de bridge con flags de gap', 'CREATE OR REPLACE VIEW invoice_bridge AS SELECT ... FROM unified_invoices');

COMMIT;
