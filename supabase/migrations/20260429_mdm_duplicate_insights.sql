-- Detector de duplicates en canonical_contacts y canonical_products.
-- NO hace auto-merge porque análisis revela que la mayoría no son duplicates
-- reales sino "variantes que comparten canonical_name genérico" (bug de matcher).
-- Emite agent_insights informativos con top groups + sample IDs para revisión manual.

CREATE OR REPLACE FUNCTION detect_mdm_duplicate_insights()
RETURNS TABLE(out_kind text, out_groups int, out_action text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_id bigint;
  v_agent_id bigint := 8;
  v_contacts_groups int;
  v_contacts_rows int;
  v_contacts_sample jsonb;
  v_products_groups int;
  v_products_rows int;
  v_products_sample jsonb;
  v_existing_id bigint;
  v_action_c text;
  v_action_p text;
BEGIN
  INSERT INTO agent_runs (agent_id, status, trigger_type, metadata)
  VALUES (v_agent_id, 'running', 'scheduled',
          jsonb_build_object('source','detect_mdm_duplicate_insights'))
  RETURNING id INTO v_run_id;

  -- Contacts duplicates
  WITH groups_data AS (
    SELECT canonical_name, COUNT(*) AS dup
    FROM canonical_contacts WHERE canonical_name IS NOT NULL
    GROUP BY canonical_name HAVING COUNT(*) > 1
  ),
  totals AS (SELECT COUNT(*) AS groups, SUM(dup) AS total_rows FROM groups_data),
  top10 AS (
    SELECT jsonb_agg(jsonb_build_object(
      'name', canonical_name, 'dup_count', dup,
      'sample_ids', (SELECT jsonb_agg(id ORDER BY id) FROM
        (SELECT id FROM canonical_contacts cc WHERE cc.canonical_name = g.canonical_name
         ORDER BY id LIMIT 5) s)
    ) ORDER BY dup DESC) AS top
    FROM (SELECT * FROM groups_data ORDER BY dup DESC LIMIT 10) g
  )
  SELECT t.groups, t.total_rows, top.top
  INTO v_contacts_groups, v_contacts_rows, v_contacts_sample
  FROM totals t CROSS JOIN top10 top;

  SELECT id INTO v_existing_id FROM agent_insights
  WHERE insight_type = 'mdm_contacts_duplicates' AND state IN ('new','seen')
  ORDER BY created_at DESC LIMIT 1;

  IF v_contacts_groups = 0 THEN
    IF v_existing_id IS NOT NULL THEN
      UPDATE agent_insights SET state='acted_on', updated_at=now() WHERE id = v_existing_id;
      v_action_c := 'archived';
    ELSE v_action_c := 'noop'; END IF;
  ELSIF v_existing_id IS NULL THEN
    INSERT INTO agent_insights (
      agent_id, run_id, insight_type, category, severity,
      title, description, evidence, recommendation, state, assignee_department
    ) VALUES (
      v_agent_id, v_run_id, 'mdm_contacts_duplicates', 'datos', 'low',
      v_contacts_groups || ' grupos de contactos con nombres duplicados (' || v_contacts_rows || ' rows)',
      'canonical_contacts tiene rows con mismo canonical_name pero distintos emails/empresas. La mayoría son: (a) misma persona con varios emails, (b) bug de canonicalización donde el contact toma el nombre de la empresa, o (c) homónimos legítimos. Auto-merge es peligroso — usar mdm_merge_contacts() manualmente.',
      jsonb_build_object('groups', v_contacts_groups, 'total_rows', v_contacts_rows, 'top10', v_contacts_sample),
      'Revisar caso por caso. Para mergear: SELECT mdm_merge_contacts(losing_id, winning_id, ''email'', ''nota''). Para arreglar la raíz, mejorar matcher_contact() para incluir primary_email como discriminator.',
      'new', 'datos'
    );
    v_action_c := 'new';
  ELSE
    UPDATE agent_insights SET
      title = v_contacts_groups || ' grupos de contactos con nombres duplicados (' || v_contacts_rows || ' rows)',
      evidence = evidence || jsonb_build_object('groups', v_contacts_groups, 'total_rows', v_contacts_rows, 'top10', v_contacts_sample, 'last_refreshed', now()),
      updated_at = now()
    WHERE id = v_existing_id;
    v_action_c := 'refreshed';
  END IF;

  -- Products duplicates
  WITH groups_data AS (
    SELECT canonical_name, COUNT(*) AS dup
    FROM canonical_products WHERE canonical_name IS NOT NULL
    GROUP BY canonical_name HAVING COUNT(*) > 1
  ),
  totals AS (SELECT COUNT(*) AS groups, SUM(dup) AS total_rows FROM groups_data),
  top10 AS (
    SELECT jsonb_agg(jsonb_build_object(
      'name', canonical_name, 'dup_count', dup,
      'sample_internal_refs', (SELECT jsonb_agg(internal_ref ORDER BY internal_ref) FROM
        (SELECT internal_ref FROM canonical_products cp WHERE cp.canonical_name = g.canonical_name
         AND cp.internal_ref IS NOT NULL ORDER BY internal_ref LIMIT 5) s)
    ) ORDER BY dup DESC) AS top
    FROM (SELECT * FROM groups_data ORDER BY dup DESC LIMIT 10) g
  )
  SELECT t.groups, t.total_rows, top.top
  INTO v_products_groups, v_products_rows, v_products_sample
  FROM totals t CROSS JOIN top10 top;

  SELECT id INTO v_existing_id FROM agent_insights
  WHERE insight_type = 'mdm_products_duplicates' AND state IN ('new','seen')
  ORDER BY created_at DESC LIMIT 1;

  IF v_products_groups = 0 THEN
    IF v_existing_id IS NOT NULL THEN
      UPDATE agent_insights SET state='acted_on', updated_at=now() WHERE id = v_existing_id;
      v_action_p := 'archived';
    ELSE v_action_p := 'noop'; END IF;
  ELSIF v_existing_id IS NULL THEN
    INSERT INTO agent_insights (
      agent_id, run_id, insight_type, category, severity,
      title, description, evidence, recommendation, state, assignee_department
    ) VALUES (
      v_agent_id, v_run_id, 'mdm_products_duplicates', 'datos', 'medium',
      v_products_groups || ' grupos de productos con nombres duplicados (' || v_products_rows || ' rows)',
      'canonical_products tiene rows con mismo canonical_name pero distintos internal_refs. Análisis revela que la mayoría NO son duplicates — son variantes (color/tamaño/gramaje) que el matcher agrupó como "entretela no tejida fusionable" o "maquila cuellos y puños". El bug es de canonicalización, no de data dirty.',
      jsonb_build_object('groups', v_products_groups, 'total_rows', v_products_rows, 'top10', v_products_sample),
      'NO auto-mergear — destruiría stock real. Fix arquitectónico: incluir internal_ref/color/size en canonical_name (ej: "entretela no tejida fusionable A45BL155"). Para casos confirmados como dup, usar mdm_merge_products(losing_id, winning_id).',
      'new', 'datos'
    );
    v_action_p := 'new';
  ELSE
    UPDATE agent_insights SET
      title = v_products_groups || ' grupos de productos con nombres duplicados (' || v_products_rows || ' rows)',
      evidence = evidence || jsonb_build_object('groups', v_products_groups, 'total_rows', v_products_rows, 'top10', v_products_sample, 'last_refreshed', now()),
      updated_at = now()
    WHERE id = v_existing_id;
    v_action_p := 'refreshed';
  END IF;

  UPDATE agent_runs SET status='completed', completed_at=now(),
    duration_seconds = EXTRACT(EPOCH FROM (now() - started_at))
  WHERE id = v_run_id;

  RETURN QUERY VALUES
    ('contacts'::text, v_contacts_groups, v_action_c),
    ('products'::text, v_products_groups, v_action_p);
END;
$$;

COMMENT ON FUNCTION detect_mdm_duplicate_insights() IS
'Emite agent_insights informativos para canonical_contacts/products duplicates. NO auto-merge porque análisis revela bug de canonicalización (variantes agrupadas como duplicates).';

DO $$ BEGIN
  PERFORM cron.unschedule('mdm_duplicates_daily');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule('mdm_duplicates_daily', '45 6 * * *',
  $cron$ SELECT public.detect_mdm_duplicate_insights(); $cron$);
