-- 20260428_fix_mdm_merge_companies_new_silvers.sql
-- ─────────────────────────────────────────────────────────────────────────
-- BUG #4: mdm_merge_companies() no propaga a las silvers nuevas creadas
-- en la sesión del 2026-04-27 (canonical_account_payments, canonical_activities).
--
-- Síntoma detectado al consolidar duplicados de la migration #3:
--   merge(151492, 633) → ERROR 23503:
--   "Key (id)=(633) is still referenced from table canonical_account_payments"
--
-- Root cause: cuando se agregaron canonical_account_payments y
-- canonical_activities con FK a canonical_companies(id) (commits c89ee95,
-- b8a8dcc), nadie actualizó mdm_merge_companies para propagar el merge
-- a esas tablas. Esto rompe el patrón de "single source of truth post-merge".
--
-- Patrón general a vigilar: CADA tabla con FK a canonical_companies(id)
-- debe estar en el body de mdm_merge_companies.
--
-- Tablas con FK actuales (verificadas 2026-04-28):
--   canonical_invoices.emisor_canonical_company_id        ✓ original
--   canonical_invoices.receptor_canonical_company_id      ✓ original
--   canonical_payments.counterparty_canonical_company_id  ✓ original
--   canonical_credit_notes.emisor_canonical_company_id    ✓ original
--   canonical_credit_notes.receptor_canonical_company_id  ✓ original
--   canonical_contacts.canonical_company_id               ✓ original
--   canonical_account_payments.canonical_company_id       ⨯ FALTABA
--   canonical_activities.canonical_company_id             ⨯ FALTABA
--   source_links.canonical_entity_id (text, type='company') ✓ original
--
-- FIX: añadir UPDATEs para canonical_account_payments y canonical_activities.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.mdm_merge_companies(
  p_canonical_a bigint,
  p_canonical_b bigint,
  p_user_email text,
  p_note text DEFAULT NULL::text
)
RETURNS bigint
LANGUAGE plpgsql
AS $function$
DECLARE
  v_survivor bigint;
  v_victim   bigint;
BEGIN
  IF p_canonical_a = p_canonical_b THEN
    RAISE EXCEPTION 'Cannot merge a company with itself';
  END IF;

  SELECT id INTO v_survivor
  FROM canonical_companies
  WHERE id IN (p_canonical_a, p_canonical_b)
  ORDER BY has_manual_override DESC,
           lifetime_value_mxn DESC NULLS LAST,
           (NOT has_shadow_flag) DESC,
           id ASC
  LIMIT 1;

  v_victim := CASE WHEN v_survivor = p_canonical_a THEN p_canonical_b ELSE p_canonical_a END;

  -- Re-asignar FKs en TODAS las canonical_* tablas que tienen FK a canonical_companies
  UPDATE canonical_invoices
     SET emisor_canonical_company_id = v_survivor
   WHERE emisor_canonical_company_id = v_victim;

  UPDATE canonical_invoices
     SET receptor_canonical_company_id = v_survivor
   WHERE receptor_canonical_company_id = v_victim;

  UPDATE canonical_payments
     SET counterparty_canonical_company_id = v_survivor
   WHERE counterparty_canonical_company_id = v_victim;

  UPDATE canonical_credit_notes
     SET emisor_canonical_company_id = v_survivor
   WHERE emisor_canonical_company_id = v_victim;

  UPDATE canonical_credit_notes
     SET receptor_canonical_company_id = v_survivor
   WHERE receptor_canonical_company_id = v_victim;

  UPDATE canonical_contacts
     SET canonical_company_id = v_survivor
   WHERE canonical_company_id = v_victim;

  -- BUG #4 fix (2026-04-28): tablas creadas en sesión audit-supabase-frontend
  -- que tenían FK a canonical_companies pero no estaban en mdm_merge.
  UPDATE canonical_account_payments
     SET canonical_company_id = v_survivor
   WHERE canonical_company_id = v_victim;

  UPDATE canonical_activities
     SET canonical_company_id = v_survivor
   WHERE canonical_company_id = v_victim;

  UPDATE source_links
     SET canonical_entity_id = v_survivor::text
   WHERE canonical_entity_type = 'company'
     AND canonical_entity_id = v_victim::text;

  UPDATE canonical_companies
     SET has_manual_override = true,
         last_matched_at = now()
   WHERE id = v_survivor;

  INSERT INTO mdm_manual_overrides (
    entity_type, canonical_id, override_field, override_value,
    action, payload, linked_by, note, is_active
  )
  VALUES (
    'company', v_survivor::text, 'canonical_id', v_survivor::text,
    'merge',
    jsonb_build_object('merged_from', v_victim, 'merged_into', v_survivor),
    p_user_email, p_note, true
  );

  DELETE FROM canonical_companies WHERE id = v_victim;

  RETURN v_survivor;
END;
$function$;

INSERT INTO public.schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES (
  'create_function', 'mdm_merge_companies',
  'BUG #4 fix: propagate merge a canonical_account_payments + canonical_activities (FK creadas en sesión 2026-04-27 nunca se agregaron al body de mdm_merge).',
  '20260428_fix_mdm_merge_companies_new_silvers.sql', 'audit-mdm-cleanup', true
);
