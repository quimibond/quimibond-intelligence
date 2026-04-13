-- Fase 3 del plan "fix-director-data-integrity":
-- Fuzzy-resolve de company_id en agent_insights cuando el director no lo llena.
--
-- Contexto:
-- 44% de los insights recientes (1,444 de 3,284 en 14 dias) llegan con
-- company_id NULL. El trigger route_insight solo usa company_id para elegir
-- assignee (Tier 1/2). Si llega NULL, cae a Tier 3 (category → department)
-- o Tier 4 (CEO fallback). El resultado es que insights concretos tipo
-- "COSMO MODA: 8 facturas vencidas" nunca se enlazan con la ficha de COSMO
-- MODA en el sidebar — huerfanos para el CEO.
--
-- Fix:
-- 1. resolve_company_from_text(text) — fuzzy match contra companies.canonical_name
--    buscando coincidencias por substring, ILIKE y trigramas.
-- 2. route_insight ahora intenta llenar NEW.company_id con esa funcion ANTES de
--    decidir assignee (asi Tier 1/2 pueden atrapar al vendedor real).
-- 3. Backfill one-shot: resolver orphans de los ultimos 30 dias.
--
-- Requiere pg_trgm (ya esta instalado para resolve_company_by_name).

BEGIN;

-- ── 1. resolve_company_from_text ────────────────────────────────────────
-- Recibe texto libre (ej: title || ' ' || description) y devuelve el
-- company_id con mayor match. Estrategia:
--   a) ILIKE substring: busca companies cuyo canonical_name aparezca
--      literalmente en el texto. Prefiere el nombre mas largo (mas especifico).
--   b) Trigram similarity > 0.5 sobre tokens del texto. Solo si (a) falla.
-- Devuelve NULL si nada alcanza el umbral.
CREATE OR REPLACE FUNCTION public.resolve_company_from_text(p_text text)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_id bigint;
  v_clean text;
BEGIN
  IF p_text IS NULL OR length(trim(p_text)) < 3 THEN RETURN NULL; END IF;
  v_clean := lower(p_text);

  -- (a) Substring match contra canonical_name (>= 4 chars, preferir el mas largo)
  SELECT id INTO v_id FROM companies
  WHERE canonical_name IS NOT NULL
    AND length(canonical_name) >= 4
    AND v_clean LIKE '%' || lower(canonical_name) || '%'
  ORDER BY length(canonical_name) DESC
  LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  -- (b) Trigram: toma tokens significativos del texto y busca el mejor match
  SELECT id INTO v_id FROM companies
  WHERE canonical_name IS NOT NULL
    AND length(canonical_name) >= 4
    AND similarity(canonical_name, v_clean) > 0.5
  ORDER BY similarity(canonical_name, v_clean) DESC
  LIMIT 1;
  RETURN v_id;
END;
$function$;

-- ── 2. Extender route_insight para intentar resolver company_id ─────────
-- Mantiene toda la logica existente (Tier 1/2/3/4), solo agrega un paso
-- previo que llena NEW.company_id si viene NULL.
CREATE OR REPLACE FUNCTION public.route_insight()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user RECORD;
  v_rule RECORD;
  v_search text;
  v_is_purchase boolean;
  v_resolved bigint;
BEGIN
  -- Skip if already assigned
  IF NEW.assignee_user_id IS NOT NULL THEN RETURN NEW; END IF;

  -- ── Fase 3: fuzzy-resolve company_id cuando el director no lo llena ──
  IF NEW.company_id IS NULL THEN
    v_resolved := resolve_company_from_text(
      COALESCE(NEW.title, '') || ' ' || COALESCE(NEW.description, '')
    );
    IF v_resolved IS NOT NULL THEN
      NEW.company_id := v_resolved;
    END IF;
  END IF;

  -- ══════════════════════════════════════════════════════════════════
  -- TIER 1: Real salesperson from sale_orders (highest revenue wins)
  -- ══════════════════════════════════════════════════════════════════
  IF NEW.company_id IS NOT NULL THEN
    v_search := LOWER(COALESCE(NEW.category, '') || ' ' || COALESCE(NEW.title, ''));
    v_is_purchase := v_search ~ 'compra|purchase|proveedor|supplier|materia|proveedores';

    IF NOT v_is_purchase THEN
      SELECT ou.odoo_user_id, ou.name, ou.email, ou.department
      INTO v_user
      FROM odoo_sale_orders so
      JOIN odoo_users ou ON ou.odoo_user_id = so.salesperson_user_id
      WHERE so.company_id = NEW.company_id
        AND so.salesperson_user_id IS NOT NULL
      GROUP BY ou.odoo_user_id, ou.name, ou.email, ou.department
      ORDER BY SUM(so.amount_total) DESC
      LIMIT 1;

      IF v_user IS NOT NULL THEN
        NEW.assignee_user_id := v_user.odoo_user_id;
        NEW.assignee_email := v_user.email;
        NEW.assignee_name := v_user.name;
        NEW.assignee_department := COALESCE(v_user.department, 'Ventas');
        RETURN NEW;
      END IF;
    END IF;

    -- TIER 2: Buyer from purchase_orders (for supplier-related insights)
    IF v_is_purchase THEN
      SELECT ou.odoo_user_id, ou.name, ou.email, ou.department
      INTO v_user
      FROM odoo_purchase_orders po
      JOIN odoo_users ou ON ou.odoo_user_id = po.buyer_user_id
      WHERE po.company_id = NEW.company_id
        AND po.buyer_user_id IS NOT NULL
      GROUP BY ou.odoo_user_id, ou.name, ou.email, ou.department
      ORDER BY SUM(po.amount_total) DESC
      LIMIT 1;

      IF v_user IS NOT NULL THEN
        NEW.assignee_user_id := v_user.odoo_user_id;
        NEW.assignee_email := v_user.email;
        NEW.assignee_name := v_user.name;
        NEW.assignee_department := COALESCE(v_user.department, 'Compras');
        RETURN NEW;
      END IF;
    END IF;

    -- Tier 1b: Fallback to company_handlers (backward compat)
    DECLARE v_handler RECORD;
    BEGIN
      SELECT * INTO v_handler FROM company_handlers WHERE company_id = NEW.company_id;
      IF v_handler IS NOT NULL AND v_handler.sales_handler_email IS NOT NULL AND NOT v_is_purchase THEN
        SELECT odoo_user_id, name, email, department INTO v_user
        FROM odoo_users WHERE LOWER(email) = LOWER(v_handler.sales_handler_email) LIMIT 1;
        IF v_user IS NOT NULL THEN
          NEW.assignee_user_id := v_user.odoo_user_id;
          NEW.assignee_email := v_user.email;
          NEW.assignee_name := v_user.name;
          NEW.assignee_department := COALESCE(v_user.department, 'Ventas');
          RETURN NEW;
        END IF;
      END IF;
    END;
  END IF;

  -- ══════════════════════════════════════════════════════════════════
  -- TIER 3: Category → Department routing
  -- ══════════════════════════════════════════════════════════════════
  v_search := LOWER(COALESCE(NEW.category, '') || ' ' || COALESCE(NEW.title, '') || ' ' || COALESCE(NEW.insight_type, ''));

  FOR v_rule IN
    SELECT r.*, d.lead_user_id, d.lead_name, d.lead_email, d.name AS dept_name
    FROM insight_routing r
    JOIN departments d ON d.id = r.department_id
    WHERE r.is_active = true
    ORDER BY r.priority DESC
  LOOP
    IF v_search ~ v_rule.category_pattern THEN
      NEW.assignee_user_id := v_rule.lead_user_id;
      NEW.assignee_email := v_rule.lead_email;
      NEW.assignee_name := v_rule.lead_name;
      NEW.assignee_department := v_rule.dept_name;
      RETURN NEW;
    END IF;
  END LOOP;

  -- TIER 4: Default to CEO
  NEW.assignee_user_id := 7;
  NEW.assignee_email := 'jose.mizrahi@quimibond.com';
  NEW.assignee_name := 'Jose J. Mizrahi';
  NEW.assignee_department := 'Direccion';
  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  -- Never block insight creation due to routing failure
  NEW.assignee_user_id := 7;
  NEW.assignee_email := 'jose.mizrahi@quimibond.com';
  NEW.assignee_name := 'Jose J. Mizrahi';
  NEW.assignee_department := 'Direccion';
  RETURN NEW;
END;
$function$;

-- ── 3. Seeds de ai_agents.config: max_business_impact_mxn ───────────────
-- equipo: issues de HR/performance no valen mas de 500K en impacto real.
-- Cualquier >500K es alucinacion. Despues del cap, avg_impact deberia caer
-- de 5.8M a <400K.
UPDATE ai_agents
SET config = config || jsonb_build_object('max_business_impact_mxn', 500000)
WHERE slug = 'equipo';

-- operaciones/costos: avg actual de 9-12M es sospechoso. Cap razonable 10M.
UPDATE ai_agents
SET config = config || jsonb_build_object('max_business_impact_mxn', 10000000)
WHERE slug IN ('operaciones', 'costos');

-- financiero: cartera vencida real puede ser alta, pero 50M es un buen cap
-- (insights arriba deberian venir de flujos estrategicos, no alertas).
UPDATE ai_agents
SET config = config || jsonb_build_object('max_business_impact_mxn', 50000000)
WHERE slug = 'financiero';

-- riesgo: similar a financiero
UPDATE ai_agents
SET config = config || jsonb_build_object('max_business_impact_mxn', 50000000)
WHERE slug = 'riesgo';

-- ── 4. Backfill one-shot: resolver orphans recientes ────────────────────
-- Solo toca insights de los ultimos 30 dias en estado new/seen (no historico).
UPDATE agent_insights i
SET company_id = resolve_company_from_text(COALESCE(i.title,'') || ' ' || COALESCE(i.description,''))
WHERE i.company_id IS NULL
  AND i.created_at >= NOW() - INTERVAL '30 days'
  AND i.state IN ('new','seen')
  AND resolve_company_from_text(COALESCE(i.title,'') || ' ' || COALESCE(i.description,'')) IS NOT NULL;

COMMIT;
