-- Sprint 6 — RPC para bulk update de campos CFDI/EDI de odoo_invoices.
--
-- Necesario porque _push_invoices en qb19 nunca pusheó cfdi_state ni edi_state
-- (sólo cfdi_uuid + cfdi_sat_state). Audit 2026-04-14: 14,490 facturas posteadas
-- con cfdi_state=NULL → cumplimiento SAT esencialmente offline.
--
-- El backfill desde Odoo (sync_backfill.manual_backfill_cfdi_states) llama
-- esta RPC en batches con array de objetos {name, odoo_partner_id, cfdi_state,
-- edi_state, cfdi_uuid, cfdi_sat_state}.
--
-- La función NO inserta filas nuevas, sólo actualiza las existentes que
-- matchean por (odoo_partner_id, name). Si una factura no existe, se ignora
-- silenciosamente (resultado: rows_updated < input length).

CREATE OR REPLACE FUNCTION public.update_invoice_cfdi_states_bulk(
  p_data jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_rows_updated int := 0;
  v_input_count int := 0;
BEGIN
  IF p_data IS NULL OR jsonb_typeof(p_data) <> 'array' THEN
    RAISE EXCEPTION 'p_data must be a JSON array';
  END IF;

  v_input_count := jsonb_array_length(p_data);

  WITH input AS (
    SELECT
      (elem->>'odoo_partner_id')::bigint AS partner_id,
      (elem->>'name')::text              AS name,
      NULLIF(elem->>'cfdi_state','')     AS cfdi_state,
      NULLIF(elem->>'edi_state','')      AS edi_state,
      NULLIF(elem->>'cfdi_uuid','')      AS cfdi_uuid,
      NULLIF(elem->>'cfdi_sat_state','') AS cfdi_sat_state
    FROM jsonb_array_elements(p_data) AS elem
  ), upd AS (
    UPDATE odoo_invoices i SET
      cfdi_state     = COALESCE(input.cfdi_state,     i.cfdi_state),
      edi_state      = COALESCE(input.edi_state,      i.edi_state),
      cfdi_uuid      = COALESCE(input.cfdi_uuid,      i.cfdi_uuid),
      cfdi_sat_state = COALESCE(input.cfdi_sat_state, i.cfdi_sat_state)
    FROM input
    WHERE i.odoo_partner_id = input.partner_id
      AND i.name            = input.name
      AND (
        -- Only update if at least one field changes (avoid no-op writes)
        i.cfdi_state     IS DISTINCT FROM COALESCE(input.cfdi_state,     i.cfdi_state)
        OR i.edi_state   IS DISTINCT FROM COALESCE(input.edi_state,      i.edi_state)
        OR i.cfdi_uuid   IS DISTINCT FROM COALESCE(input.cfdi_uuid,      i.cfdi_uuid)
        OR i.cfdi_sat_state IS DISTINCT FROM COALESCE(input.cfdi_sat_state, i.cfdi_sat_state)
      )
    RETURNING 1
  )
  SELECT count(*) INTO v_rows_updated FROM upd;

  RETURN jsonb_build_object(
    'input_count', v_input_count,
    'rows_updated', v_rows_updated,
    'ts', NOW()
  );
END;
$$;

COMMENT ON FUNCTION public.update_invoice_cfdi_states_bulk(jsonb) IS
'Bulk update de campos CFDI/EDI sobre odoo_invoices. Input: array de objetos {name, odoo_partner_id, cfdi_state, edi_state, cfdi_uuid, cfdi_sat_state}. Sólo actualiza filas existentes que matchean por (odoo_partner_id, name). COALESCE garantiza que valores NULL en input no sobreescriben datos existentes. Sprint 6 / audit 2026-04-14.';
