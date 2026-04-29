-- Audit completo de data quality. Aplica fixes deterministicos y crea detectores
-- informativos para casos que requieren revisión manual.
--
-- Fixes deterministicos:
--   - 3 canonical_companies con tax-ID extranjero en columna RFC → XEXX010101000
--     (Unitech Italia IT02408480974, CMA CGM Francia FR72562024422,
--      Dhagatex Tailandia 0115565006723)
--   - 1 canonical_company con espacio adentro del RFC (KAFE DISEÑOS:
--     "KDT 2010299L5" → "KDT2010299L5")
--
-- Detectores nuevos en agent_insights category='datos':
--   - mdm_contact_name_is_email     (103 contactos con email como canonical_name)
--   - canonical_partner_orphan      (5 canonical_companies con partner_id sin bronze match)
--   - canonical_invoice_pre_history (7 facturas pre-2013, posible date corruption)
-- Cron diario 06:50 UTC (después de mdm_duplicates_daily).

BEGIN;

-- Fix 1: 3 foreign tax-IDs en canonical_companies → XEXX010101000
UPDATE canonical_companies
SET rfc = 'XEXX010101000', last_matched_at = now()
WHERE id IN (1150, 1282, 191)
  AND rfc IN ('IT02408480974', 'FR72562024422', '0115565006723');

-- Fix 2: KAFE DISEÑOS con espacio en el RFC → quitar espacio
UPDATE canonical_companies
SET rfc = 'KDT2010299L5', last_matched_at = now()
WHERE id = 765 AND rfc = 'KDT 2010299L5';

-- Detector: 3 patrones nuevos
CREATE OR REPLACE FUNCTION detect_canonical_data_quality_insights()
RETURNS TABLE(out_kind text, out_count int, out_action text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_id bigint;
  v_agent_id bigint := 8;
  v_email_count int;
  v_email_sample jsonb;
  v_orphan_count int;
  v_orphan_sample jsonb;
  v_pre_count int;
  v_pre_sample jsonb;
  v_eid bigint;
  v_oid bigint;
  v_pid bigint;
  v_action_e text;
  v_action_o text;
  v_action_p text;
BEGIN
  INSERT INTO agent_runs (agent_id, status, trigger_type, metadata)
  VALUES (v_agent_id, 'running', 'scheduled',
          jsonb_build_object('source','detect_canonical_data_quality_insights'))
  RETURNING id INTO v_run_id;

  -- 1) email_as_name in canonical_contacts
  SELECT COUNT(*),
    (SELECT jsonb_agg(jsonb_build_object('id', id, 'name', canonical_name) ORDER BY id)
     FROM (SELECT id, canonical_name FROM canonical_contacts WHERE canonical_name LIKE '%@%' ORDER BY id LIMIT 10) s)
  INTO v_email_count, v_email_sample
  FROM canonical_contacts WHERE canonical_name LIKE '%@%';

  SELECT id INTO v_eid FROM agent_insights
  WHERE insight_type='mdm_contact_name_is_email' AND state IN ('new','seen')
  ORDER BY created_at DESC LIMIT 1;

  IF v_email_count = 0 THEN
    IF v_eid IS NOT NULL THEN
      UPDATE agent_insights SET state='acted_on', updated_at=now() WHERE id = v_eid;
      v_action_e := 'archived';
    ELSE v_action_e := 'noop'; END IF;
  ELSIF v_eid IS NULL THEN
    INSERT INTO agent_insights (agent_id, run_id, insight_type, category, severity,
      title, description, evidence, recommendation, state, assignee_department)
    VALUES (v_agent_id, v_run_id, 'mdm_contact_name_is_email', 'datos', 'medium',
      v_email_count || ' contactos con email como nombre canónico',
      'canonical_contacts.canonical_name contiene direcciones de email en lugar del nombre real de la persona. Bug del matcher_contact que toma el email del CFDI cuando no encuentra nombre persona.',
      jsonb_build_object('count', v_email_count, 'sample', v_email_sample),
      'Para cada uno: actualizar canonical_name al nombre real de la persona (puede consultarse en res.partner de Odoo o en el CFDI original). Fix raíz: mejorar matcher_contact() para excluir patrones email del campo name.',
      'new', 'datos');
    v_action_e := 'new';
  ELSE
    UPDATE agent_insights SET
      title = v_email_count || ' contactos con email como nombre canónico',
      evidence = evidence || jsonb_build_object('count', v_email_count, 'sample', v_email_sample, 'last_refreshed', now()),
      updated_at = now()
    WHERE id = v_eid;
    v_action_e := 'refreshed';
  END IF;

  -- 2) canonical_partner_orphan
  SELECT COUNT(*),
    (SELECT jsonb_agg(jsonb_build_object('id', cc.id, 'name', cc.canonical_name, 'odoo_partner_id', cc.odoo_partner_id, 'rfc', cc.rfc) ORDER BY cc.id)
     FROM (SELECT id, canonical_name, odoo_partner_id, rfc FROM canonical_companies cc2
           WHERE cc2.odoo_partner_id IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM companies c WHERE c.odoo_partner_id = cc2.odoo_partner_id)
           ORDER BY cc2.id LIMIT 20) cc)
  INTO v_orphan_count, v_orphan_sample
  FROM canonical_companies cc
  WHERE cc.odoo_partner_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM companies c WHERE c.odoo_partner_id = cc.odoo_partner_id);

  SELECT id INTO v_oid FROM agent_insights
  WHERE insight_type='canonical_partner_orphan' AND state IN ('new','seen')
  ORDER BY created_at DESC LIMIT 1;

  IF v_orphan_count = 0 THEN
    IF v_oid IS NOT NULL THEN
      UPDATE agent_insights SET state='acted_on', updated_at=now() WHERE id = v_oid;
      v_action_o := 'archived';
    ELSE v_action_o := 'noop'; END IF;
  ELSIF v_oid IS NULL THEN
    INSERT INTO agent_insights (agent_id, run_id, insight_type, category, severity,
      title, description, evidence, recommendation, state, assignee_department)
    VALUES (v_agent_id, v_run_id, 'canonical_partner_orphan', 'datos', 'low',
      v_orphan_count || ' canonical companies con odoo_partner_id sin bronze match',
      'canonical_companies tiene odoo_partner_id NOT NULL pero el partner_id no existe en companies (bronze). Posiblemente partners borrados/archivados en Odoo o errores históricos de sync.',
      jsonb_build_object('count', v_orphan_count, 'sample', v_orphan_sample),
      'Re-sync de res.partner desde Odoo para esos partner_ids específicos. Si el partner ya no existe, limpiar el odoo_partner_id de canonical_companies (set NULL).',
      'new', 'datos');
    v_action_o := 'new';
  ELSE
    UPDATE agent_insights SET
      title = v_orphan_count || ' canonical companies con odoo_partner_id sin bronze match',
      evidence = evidence || jsonb_build_object('count', v_orphan_count, 'sample', v_orphan_sample, 'last_refreshed', now()),
      updated_at = now()
    WHERE id = v_oid;
    v_action_o := 'refreshed';
  END IF;

  -- 3) canonical_invoice_pre_history (pre-2013)
  SELECT COUNT(*),
    (SELECT jsonb_agg(jsonb_build_object('sat_uuid', sat_uuid, 'fecha', invoice_date_resolved::date, 'amount', amount_total_mxn_resolved) ORDER BY invoice_date_resolved)
     FROM (SELECT sat_uuid, invoice_date_resolved, amount_total_mxn_resolved FROM canonical_invoices WHERE invoice_date_resolved < '2013-01-01' ORDER BY invoice_date_resolved LIMIT 20) s)
  INTO v_pre_count, v_pre_sample
  FROM canonical_invoices WHERE invoice_date_resolved < '2013-01-01';

  SELECT id INTO v_pid FROM agent_insights
  WHERE insight_type='canonical_invoice_pre_history' AND state IN ('new','seen')
  ORDER BY created_at DESC LIMIT 1;

  IF v_pre_count = 0 THEN
    IF v_pid IS NOT NULL THEN
      UPDATE agent_insights SET state='acted_on', updated_at=now() WHERE id = v_pid;
      v_action_p := 'archived';
    ELSE v_action_p := 'noop'; END IF;
  ELSIF v_pid IS NULL THEN
    INSERT INTO agent_insights (agent_id, run_id, insight_type, category, severity,
      title, description, evidence, recommendation, state, assignee_department)
    VALUES (v_agent_id, v_run_id, 'canonical_invoice_pre_history', 'datos', 'low',
      v_pre_count || ' facturas con fecha pre-2013 (posible corrupción)',
      'canonical_invoices tiene rows con invoice_date_resolved anterior a 2013. Quimibond opera desde 1992 pero CFDIs solo desde 2014. Probable corrupción de fecha o errores de captura.',
      jsonb_build_object('count', v_pre_count, 'sample', v_pre_sample),
      'Revisar manualmente cada UUID en SAT (https://verificacfdi.facturaelectronica.sat.gob.mx/) y corregir invoice_date_resolved en canonical_invoices. Si la fecha real es post-2014, fue captura errónea; si es histórica, marcar como out-of-scope.',
      'new', 'datos');
    v_action_p := 'new';
  ELSE
    UPDATE agent_insights SET
      title = v_pre_count || ' facturas con fecha pre-2013 (posible corrupción)',
      evidence = evidence || jsonb_build_object('count', v_pre_count, 'sample', v_pre_sample, 'last_refreshed', now()),
      updated_at = now()
    WHERE id = v_pid;
    v_action_p := 'refreshed';
  END IF;

  UPDATE agent_runs SET status='completed', completed_at=now(),
    duration_seconds = EXTRACT(EPOCH FROM (now() - started_at)),
    insights_generated = (CASE WHEN v_action_e='new' THEN 1 ELSE 0 END
                        + CASE WHEN v_action_o='new' THEN 1 ELSE 0 END
                        + CASE WHEN v_action_p='new' THEN 1 ELSE 0 END)
  WHERE id = v_run_id;

  RETURN QUERY VALUES
    ('contact_name_is_email'::text, v_email_count, v_action_e),
    ('canonical_partner_orphan'::text, v_orphan_count, v_action_o),
    ('canonical_invoice_pre_history'::text, v_pre_count, v_action_p);
END;
$$;

COMMENT ON FUNCTION detect_canonical_data_quality_insights() IS
'Detector adicional para issues encontrados en audit comprehensivo: contacts con email-as-name, partner_id orphans, facturas pre-history.';

DO $$ BEGIN
  PERFORM cron.unschedule('canonical_data_quality_daily');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule('canonical_data_quality_daily', '50 6 * * *',
  $cron$ SELECT public.detect_canonical_data_quality_insights(); $cron$);

INSERT INTO pipeline_logs (level, phase, message, details)
VALUES (
  'info',
  'canonical_data_quality_fixes_and_detectors',
  'Applied 4 deterministic fixes (3 foreign tax-IDs + 1 RFC space) + created 3 new detectors',
  jsonb_build_object(
    'foreign_tax_id_fixes', 3,
    'rfc_space_fixes', 1,
    'new_detectors', ARRAY['mdm_contact_name_is_email','canonical_partner_orphan','canonical_invoice_pre_history']
  )
);

COMMIT;
