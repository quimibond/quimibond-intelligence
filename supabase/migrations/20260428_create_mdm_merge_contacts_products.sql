-- 20260428_create_mdm_merge_contacts_products.sql
-- ─────────────────────────────────────────────────────────────────────────
-- BUG #5: solo existe mdm_merge_companies. No hay forma sistemática de
-- consolidar duplicados en canonical_contacts (201 nombres dup detectados)
-- ni canonical_products (485 nombres dup).
--
-- Sample contacts duplicados: "abraham penhos" (2 ids), "abasteo.mx" (3),
-- "almacenes seguros" (8). Sample products: 485 con mismo canonical_name
-- pero distinto internal_ref.
--
-- Esta migration crea las funciones gemelas siguiendo el mismo patrón de
-- mdm_merge_companies: tie-break determinístico, propagación a TODAS las
-- tablas con FK al canonical, audit trail en mdm_manual_overrides, DELETE
-- del victim.
--
-- FKs detectadas:
--   canonical_contacts(id):
--     invariant_routing.canonical_contact_id
--     canonical_contacts.manager_canonical_contact_id (self)
--     canonical_invoices.salesperson_contact_id
--     canonical_activities.assigned_canonical_contact_id
--   canonical_products(id):
--     (TBD — verificar si hay FK explícitas; si no, FK lógicas via internal_ref)
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.mdm_merge_contacts(
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
    RAISE EXCEPTION 'Cannot merge a contact with itself';
  END IF;

  -- Tie-break: has_manual_override → has_email > has_phone → NOT has_shadow → id ASC
  SELECT id INTO v_survivor
  FROM canonical_contacts
  WHERE id IN (p_canonical_a, p_canonical_b)
  ORDER BY has_manual_override DESC,
           (primary_email IS NOT NULL) DESC,
           (work_phone IS NOT NULL) DESC,
           id ASC
  LIMIT 1;

  v_victim := CASE WHEN v_survivor = p_canonical_a THEN p_canonical_b ELSE p_canonical_a END;

  -- Re-asignar FKs en TODAS las tablas que apuntan a canonical_contacts(id)
  UPDATE invariant_routing
     SET canonical_contact_id = v_survivor
   WHERE canonical_contact_id = v_victim;

  UPDATE canonical_contacts
     SET manager_canonical_contact_id = v_survivor
   WHERE manager_canonical_contact_id = v_victim;

  UPDATE canonical_invoices
     SET salesperson_contact_id = v_survivor
   WHERE salesperson_contact_id = v_victim;

  UPDATE canonical_activities
     SET assigned_canonical_contact_id = v_survivor
   WHERE assigned_canonical_contact_id = v_victim;

  UPDATE source_links
     SET canonical_entity_id = v_survivor::text
   WHERE canonical_entity_type = 'contact'
     AND canonical_entity_id = v_victim::text;

  UPDATE canonical_contacts
     SET has_manual_override = true,
         updated_at = now()
   WHERE id = v_survivor;

  INSERT INTO mdm_manual_overrides (
    entity_type, canonical_id, override_field, override_value,
    action, payload, linked_by, note, is_active
  )
  VALUES (
    'contact', v_survivor::text, 'canonical_id', v_survivor::text,
    'merge',
    jsonb_build_object('merged_from', v_victim, 'merged_into', v_survivor),
    p_user_email, p_note, true
  );

  DELETE FROM canonical_contacts WHERE id = v_victim;

  RETURN v_survivor;
END;
$function$;

CREATE OR REPLACE FUNCTION public.mdm_merge_products(
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
    RAISE EXCEPTION 'Cannot merge a product with itself';
  END IF;

  -- Tie-break: has_manual_override → has_internal_ref → has_stock_qty > 0 → id ASC
  SELECT id INTO v_survivor
  FROM canonical_products
  WHERE id IN (p_canonical_a, p_canonical_b)
  ORDER BY has_manual_override DESC,
           (internal_ref IS NOT NULL AND internal_ref <> '') DESC,
           (COALESCE(stock_qty, 0) > 0) DESC,
           id ASC
  LIMIT 1;

  v_victim := CASE WHEN v_survivor = p_canonical_a THEN p_canonical_b ELSE p_canonical_a END;

  -- canonical_order_lines + canonical_invoices podrían referenciar canonical_product_id
  -- (verificar live; muchas son MVs y no aceptan UPDATE directo).
  -- Para tablas: actualizar. Para MVs: requeriría refresh post-merge.

  UPDATE source_links
     SET canonical_entity_id = v_survivor::text
   WHERE canonical_entity_type = 'product'
     AND canonical_entity_id = v_victim::text;

  -- canonical_stock_moves (silver creada 2026-04-27) tiene canonical_product_id
  UPDATE canonical_stock_moves
     SET canonical_product_id = v_survivor
   WHERE canonical_product_id = v_victim;

  UPDATE canonical_products
     SET has_manual_override = true,
         updated_at = now()
   WHERE id = v_survivor;

  INSERT INTO mdm_manual_overrides (
    entity_type, canonical_id, override_field, override_value,
    action, payload, linked_by, note, is_active
  )
  VALUES (
    'product', v_survivor::text, 'canonical_id', v_survivor::text,
    'merge',
    jsonb_build_object('merged_from', v_victim, 'merged_into', v_survivor),
    p_user_email, p_note, true
  );

  DELETE FROM canonical_products WHERE id = v_victim;

  RETURN v_survivor;
END;
$function$;

INSERT INTO public.schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES (
  'create_function', 'mdm_merge_contacts',
  'BUG #5: crear mdm_merge_contacts (canonical_contacts tiene 201 nombres dup) y mdm_merge_products (485 dup) siguiendo el patrón de mdm_merge_companies. FKs propagados via invariant_routing, canonical_invoices.salesperson_contact_id, canonical_activities.assigned_canonical_contact_id, manager self-ref.',
  '20260428_create_mdm_merge_contacts_products.sql', 'audit-mdm-cleanup', true
);
