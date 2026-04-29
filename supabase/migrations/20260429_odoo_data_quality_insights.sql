-- Reporte recurrente de "Cosas a arreglar en Odoo".
-- Emite agent_insights(category='datos', insight_type='odoo_*') por cada
-- patrón detectado, idempotente y con auto-archive cuando el issue desaparece.
--
-- Patrones detectados:
--   1) odoo_duplicate_partner_rfc — mismo RFC en >1 partner_id (mergear en Odoo)
--   2) odoo_partner_no_canonical — partner activo en payments sin canonical match
--   3) odoo_foreign_tax_id_in_rfc — tax_id no-mexicano capturado en columna RFC
--
-- Schedule: cron diario 06:00 UTC (después del sync de Odoo ~03:00).

DROP FUNCTION IF EXISTS detect_odoo_data_quality_issues();

CREATE OR REPLACE FUNCTION detect_odoo_data_quality_issues()
RETURNS TABLE(out_insight_type text, out_new_count int, out_archived_count int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_id bigint;
  v_agent_id bigint := 8;
  v_new_dup int := 0;
  v_arc_dup int := 0;
  v_new_orph int := 0;
  v_arc_orph int := 0;
  v_new_for int := 0;
  v_arc_for int := 0;
BEGIN
  INSERT INTO agent_runs (agent_id, status, trigger_type, metadata)
  VALUES (v_agent_id, 'running', 'scheduled',
          jsonb_build_object('source','detect_odoo_data_quality_issues'))
  RETURNING id INTO v_run_id;

  -- ============================================================
  -- 1) odoo_duplicate_partner_rfc
  -- ============================================================
  WITH dups AS (
    SELECT rfc,
      array_agg(DISTINCT odoo_partner_id ORDER BY odoo_partner_id) AS partner_ids,
      array_agg(DISTINCT name ORDER BY name) AS names,
      COUNT(DISTINCT odoo_partner_id) AS dup_count
    FROM companies
    WHERE rfc IS NOT NULL AND rfc NOT IN ('XAXX010101000','XEXX010101000')
      AND length(rfc) BETWEEN 12 AND 13 AND odoo_partner_id IS NOT NULL
    GROUP BY rfc HAVING COUNT(DISTINCT odoo_partner_id) > 1
  ),
  inserted AS (
    INSERT INTO agent_insights (agent_id, run_id, insight_type, category, severity,
      title, description, evidence, recommendation, state, assignee_department)
    SELECT v_agent_id, v_run_id, 'odoo_duplicate_partner_rfc', 'datos', 'medium',
      'RFC ' || rfc || ' duplicado en ' || dup_count || ' partners de Odoo',
      'En Odoo hay ' || dup_count || ' rows con el mismo RFC. Solo el primer partner_id se canonicalizó.',
      jsonb_build_object('rfc', rfc, 'partner_ids', partner_ids, 'names', names, 'dup_count', dup_count),
      'Mergear duplicados en Odoo (Settings > Technical > Database Structure > Merge Records).',
      'new', 'datos'
    FROM dups d
    WHERE NOT EXISTS (
      SELECT 1 FROM agent_insights ai
      WHERE ai.insight_type = 'odoo_duplicate_partner_rfc'
        AND ai.state IN ('new','seen') AND ai.evidence->>'rfc' = d.rfc
    )
    RETURNING id
  )
  SELECT COUNT(*) INTO v_new_dup FROM inserted;

  WITH archived AS (
    UPDATE agent_insights ai SET state='acted_on', updated_at=now()
    WHERE ai.insight_type='odoo_duplicate_partner_rfc' AND ai.state IN ('new','seen')
      AND NOT EXISTS (
        SELECT 1 FROM companies c WHERE c.rfc = ai.evidence->>'rfc' AND c.odoo_partner_id IS NOT NULL
        GROUP BY c.rfc HAVING COUNT(DISTINCT c.odoo_partner_id) > 1
      )
    RETURNING ai.id
  )
  SELECT COUNT(*) INTO v_arc_dup FROM archived;

  -- ============================================================
  -- 2) odoo_partner_no_canonical
  -- ============================================================
  WITH orphan_payment_partners AS (
    SELECT DISTINCT cp.odoo_partner_id FROM canonical_payments cp
    WHERE cp.counterparty_canonical_company_id IS NULL
      AND cp.sources_present = ARRAY['odoo']::text[]
      AND cp.odoo_partner_id IS NOT NULL AND cp.odoo_partner_id <> 1
      AND NOT EXISTS (SELECT 1 FROM canonical_companies cc WHERE cc.odoo_partner_id = cp.odoo_partner_id)
      AND NOT EXISTS (SELECT 1 FROM odoo_account_payments oap WHERE oap.odoo_partner_id = cp.odoo_partner_id AND oap.journal_name = 'Salarios')
  ),
  inserted AS (
    INSERT INTO agent_insights (agent_id, run_id, insight_type, category, severity,
      title, description, evidence, recommendation, state, assignee_department)
    SELECT v_agent_id, v_run_id, 'odoo_partner_no_canonical', 'datos', 'low',
      'Partner Odoo #' || op.odoo_partner_id || ' sin canonical_company',
      'Aparece en pagos pero nunca fue canonicalizado. Probablemente nunca tuvo invoice asociada.',
      jsonb_build_object(
        'odoo_partner_id', op.odoo_partner_id,
        'payment_count', (SELECT COUNT(*) FROM canonical_payments WHERE odoo_partner_id = op.odoo_partner_id),
        'sample_journals', (SELECT array_agg(DISTINCT oap.journal_name) FROM odoo_account_payments oap WHERE oap.odoo_partner_id = op.odoo_partner_id)
      ),
      'En Odoo (res.partner browse #' || op.odoo_partner_id || '): si existe archivado, reactivarlo y triggear sync. Si no existe, capturarlo manualmente con RFC correcto.',
      'new', 'datos'
    FROM orphan_payment_partners op
    WHERE NOT EXISTS (
      SELECT 1 FROM agent_insights ai
      WHERE ai.insight_type = 'odoo_partner_no_canonical' AND ai.state IN ('new','seen')
        AND (ai.evidence->>'odoo_partner_id')::int = op.odoo_partner_id
    )
    RETURNING id
  )
  SELECT COUNT(*) INTO v_new_orph FROM inserted;

  WITH archived AS (
    UPDATE agent_insights ai SET state='acted_on', updated_at=now()
    WHERE ai.insight_type='odoo_partner_no_canonical' AND ai.state IN ('new','seen')
      AND EXISTS (SELECT 1 FROM canonical_companies cc WHERE cc.odoo_partner_id = (ai.evidence->>'odoo_partner_id')::int)
    RETURNING ai.id
  )
  SELECT COUNT(*) INTO v_arc_orph FROM archived;

  -- ============================================================
  -- 3) odoo_foreign_tax_id_in_rfc
  -- ============================================================
  WITH foreign_in_rfc AS (
    SELECT odoo_partner_id, name, rfc, country FROM companies
    WHERE rfc IS NOT NULL
      AND rfc NOT IN ('XAXX010101000','XEXX010101000','MITJ991130TV7')
      AND (length(rfc) NOT BETWEEN 12 AND 13 OR rfc ~ '^[0-9]+$'
           OR (rfc !~ '^[A-Z&Ñ]{3,4}[0-9]{6}[A-Z0-9]{3}$' AND length(rfc) IN (12,13)))
  ),
  inserted AS (
    INSERT INTO agent_insights (agent_id, run_id, insight_type, category, severity,
      title, description, evidence, recommendation, state, assignee_department)
    SELECT v_agent_id, v_run_id, 'odoo_foreign_tax_id_in_rfc', 'datos', 'medium',
      'Tax-ID extranjero en columna RFC: ' || COALESCE(name, 'partner #' || odoo_partner_id),
      'Tax_id no cumple formato RFC mexicano (' || rfc || '). Probablemente US/EU. Rompe matching SAT.',
      jsonb_build_object('odoo_partner_id', odoo_partner_id, 'name', name, 'invalid_rfc', rfc, 'country', country),
      'En Odoo (res.partner browse #' || odoo_partner_id || '): cambiar VAT a XEXX010101000 y guardar tax_id real en otro campo.',
      'new', 'datos'
    FROM foreign_in_rfc f
    WHERE NOT EXISTS (
      SELECT 1 FROM agent_insights ai
      WHERE ai.insight_type = 'odoo_foreign_tax_id_in_rfc' AND ai.state IN ('new','seen')
        AND (ai.evidence->>'odoo_partner_id')::int = f.odoo_partner_id
    )
    RETURNING id
  )
  SELECT COUNT(*) INTO v_new_for FROM inserted;

  WITH archived AS (
    UPDATE agent_insights ai SET state='acted_on', updated_at=now()
    WHERE ai.insight_type='odoo_foreign_tax_id_in_rfc' AND ai.state IN ('new','seen')
      AND NOT EXISTS (
        SELECT 1 FROM companies c WHERE c.odoo_partner_id = (ai.evidence->>'odoo_partner_id')::int
          AND c.rfc IS NOT NULL AND c.rfc NOT IN ('XAXX010101000','XEXX010101000','MITJ991130TV7')
          AND (length(c.rfc) NOT BETWEEN 12 AND 13 OR c.rfc ~ '^[0-9]+$'
               OR (c.rfc !~ '^[A-Z&Ñ]{3,4}[0-9]{6}[A-Z0-9]{3}$' AND length(c.rfc) IN (12,13)))
      )
    RETURNING ai.id
  )
  SELECT COUNT(*) INTO v_arc_for FROM archived;

  UPDATE agent_runs SET status='completed', completed_at=now(),
    duration_seconds = EXTRACT(EPOCH FROM (now() - started_at)),
    insights_generated = v_new_dup + v_new_orph + v_new_for,
    metadata = metadata || jsonb_build_object(
      'new_duplicate_partner_rfc', v_new_dup, 'archived_duplicate_partner_rfc', v_arc_dup,
      'new_partner_no_canonical', v_new_orph, 'archived_partner_no_canonical', v_arc_orph,
      'new_foreign_tax_id_in_rfc', v_new_for, 'archived_foreign_tax_id_in_rfc', v_arc_for)
  WHERE id = v_run_id;

  RETURN QUERY VALUES
    ('odoo_duplicate_partner_rfc'::text, v_new_dup, v_arc_dup),
    ('odoo_partner_no_canonical'::text, v_new_orph, v_arc_orph),
    ('odoo_foreign_tax_id_in_rfc'::text, v_new_for, v_arc_for);
END;
$$;

COMMENT ON FUNCTION detect_odoo_data_quality_issues() IS
'Reporte recurrente de problemas de calidad de datos en Odoo (res.partner). Emite agent_insights(category=datos, insight_type=odoo_*) idempotentes.';

-- Programar cron diario 06:00 UTC
DO $$ BEGIN
  PERFORM cron.unschedule('odoo_data_quality_daily');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule('odoo_data_quality_daily', '0 6 * * *',
  $cron$ SELECT public.detect_odoo_data_quality_issues(); $cron$);
