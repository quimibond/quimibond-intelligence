-- ============================================================================
-- 20260918d — Limpieza: Supabase solo con la memoria de correo
-- ============================================================================
--
-- YA APLICADO EN PRODUCCIÓN (proyecto tozqezmivpblmcubmnpi) el 2026-09-18 con
-- cinco migraciones ejecutadas directo en Supabase:
--
--   limpieza_20260918_01_triggers          triggers y FKs de companies/contacts
--   limpieza_20260918_02_vistas            vistas y vistas materializadas
--   limpieza_20260918_03_tablas            silver, costeo, agentes, grafo viejo…
--   limpieza_20260918_04_bronze_funciones  odoo_* (menos odoo_users), syntage_*,
--                                          jobs pg_cron y ~660 funciones
--   limpieza_20260918_05_schema_ingestion  esquema ingestion
--
-- Este archivo DOCUMENTA lo que se hizo y es idempotente: cada sentencia usa
-- IF EXISTS y los bloques DO consultan el catálogo antes de borrar. Volver a
-- correrlo en producción no hace nada; correrlo en una base restaurada de un
-- backup anterior la deja en el mismo estado.
--
-- Decisión del CEO (2026-09-16/17/18): "Supabase solo guarda lo que Odoo no
-- tiene; aprovechar Odoo sin duplicar". El SAT vive en Odoo (quimibond_sat),
-- el costeo en Odoo (qb_capacidad_costeo), los indicadores en SGI. Supabase se
-- queda con la memoria de correo (52 buzones de Gmail) y lo mínimo de Odoo que
-- la memoria necesita: contacts, companies y odoo_users (para el grafo).
-- Resultado: la base pasó de 9.4 GB a 5.0 GB.
--
-- LO QUE QUEDA (no se toca aquí):
--   Tablas (21): emails, threads, email_attachments, email_backfill_state,
--     gmail_accounts, sync_state, sync_commands, backfill_log, contacts,
--     companies, odoo_users, memoria_thread_summaries, memoria_facts, kg_nodes,
--     kg_edges, email_pending_actions, customer_demand_signals, demand_scan_log,
--     email_digests, pipeline_logs, token_usage.
--   Vistas (4): memoria_encargados, memory_coverage, odoo_push_last_events,
--     claude_cost_summary.
--   Funciones (32): ver la lista `vivas` del paso 5.
--   Buckets: email-raw, email-attachments.
--   Jobs pg_cron: solo memoria_* (10).
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Triggers y FKs de las tablas que se conservan (companies, contacts,
--    odoo_users) que apuntaban a lo que se borra.
-- ----------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_cc_from_odoo                   ON public.companies;
DROP TRIGGER IF EXISTS trg_classify_company_entity_type   ON public.companies;
DROP TRIGGER IF EXISTS trg_auto_source                    ON public.companies;
DROP TRIGGER IF EXISTS auto_link_company_entity           ON public.companies;
DROP TRIGGER IF EXISTS trg_auto_source                    ON public.contacts;
DROP TRIGGER IF EXISTS trg_cct_from_contact               ON public.contacts;
DROP TRIGGER IF EXISTS trg_auto_resolve_contact_identity  ON public.contacts;
DROP TRIGGER IF EXISTS auto_link_contact_entity           ON public.contacts;
DROP TRIGGER IF EXISTS trg_cct_from_odoo_user             ON public.odoo_users;

-- FKs desde tablas vivas hacia tablas que se borran (entities, data_sources,
-- canonical_*, departments…). Se buscan por catálogo para no depender del nombre.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname, c.conrelid::regclass AS tbl
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_class ref ON ref.oid = c.confrelid
    WHERE c.contype = 'f'
      AND n.nspname = 'public'
      AND t.relname IN ('companies', 'contacts', 'odoo_users', 'emails', 'threads',
                        'email_pending_actions', 'customer_demand_signals')
      AND ref.relname IN ('entities', 'data_sources', 'departments',
                          'canonical_companies', 'canonical_contacts', 'agent_insights')
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT IF EXISTS %I', r.tbl, r.conname);
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 2. Vistas y vistas materializadas de análisis (gold, canonical, mv_, legacy
--    y las vistas financieras del frontend retirado). El bloque distingue
--    view / matview por relkind para que sea idempotente.
-- ----------------------------------------------------------------------------

DO $$
DECLARE
  r record;
  explicitas text[] := ARRAY[
    -- gold (CEO-facing)
    'gold_company_360', 'gold_ceo_inbox', 'gold_pl_statement', 'gold_cashflow',
    'gold_revenue_monthly', 'gold_balance_sheet', 'gold_reconciliation_health',
    'gold_company_odoo_sat_drift', 'gold_product_performance', 'gold_sale_chain_trace',
    -- canonical (vistas y MVs de la capa silver)
    'canonical_employees', 'canonical_bank_balances', 'canonical_sale_orders',
    'canonical_purchase_orders', 'canonical_order_lines', 'canonical_deliveries',
    'canonical_manufacturing',
    -- MVs intermedias
    'mv_entry_lines_flat', 'mv_stock_move_account_matches', 'mv_bom_standard_cost',
    'mv_mo_actual_material_cost',
    -- MVs legacy de análisis
    'client_reorder_predictions', 'payment_predictions', 'cashflow_projection',
    'inventory_velocity', 'dead_stock_analysis', 'purchase_price_intelligence',
    'customer_product_matrix', 'accounting_anomalies', 'bom_duplicate_components',
    'ar_aging_detail', 'ops_delivery_health_weekly', 'journal_flow_profile',
    'product_real_cost', 'real_sale_price',
    -- vistas financieras (frontend retirado)
    'pl_estado_resultados', 'cash_position', 'expense_breakdown', 'payment_analysis',
    'cfo_dashboard', 'cash_flow_aging', 'margin_analysis', 'working_capital',
    'cfdi_invoice_match', 'odoo_sync_freshness'
  ];
BEGIN
  FOR r IN
    SELECT c.relname, c.relkind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('v', 'm')
      AND (c.relname = ANY (explicitas)
           OR c.relname ~ '^(gold_|canonical_|mv_|syntage_|v_)')
      -- las 4 vistas vivas
      AND c.relname NOT IN ('memoria_encargados', 'memory_coverage',
                            'odoo_push_last_events', 'claude_cost_summary')
  LOOP
    IF r.relkind = 'm' THEN
      EXECUTE format('DROP MATERIALIZED VIEW IF EXISTS public.%I CASCADE', r.relname);
    ELSE
      EXECUTE format('DROP VIEW IF EXISTS public.%I CASCADE', r.relname);
    END IF;
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 3. Tablas silver / MDM / reconciliación, costeo, agentes, grafo viejo y
--    tablas sueltas del frontend retirado.
-- ----------------------------------------------------------------------------

-- Silver canonical + MDM + reconciliación
DROP TABLE IF EXISTS public.canonical_invoices            CASCADE;
DROP TABLE IF EXISTS public.canonical_payments            CASCADE;
DROP TABLE IF EXISTS public.canonical_payment_allocations CASCADE;
DROP TABLE IF EXISTS public.canonical_credit_notes        CASCADE;
DROP TABLE IF EXISTS public.canonical_tax_events          CASCADE;
DROP TABLE IF EXISTS public.canonical_account_payments    CASCADE;
DROP TABLE IF EXISTS public.canonical_activities          CASCADE;
DROP TABLE IF EXISTS public.canonical_stock_moves         CASCADE;
DROP TABLE IF EXISTS public.canonical_companies           CASCADE;
DROP TABLE IF EXISTS public.canonical_contacts            CASCADE;
DROP TABLE IF EXISTS public.canonical_products            CASCADE;
DROP TABLE IF EXISTS public.reconciliation_issues         CASCADE;
DROP TABLE IF EXISTS public.source_links                  CASCADE;
DROP TABLE IF EXISTS public.mdm_manual_overrides          CASCADE;
DROP TABLE IF EXISTS public.audit_runs                    CASCADE;
DROP TABLE IF EXISTS public.audit_tolerances              CASCADE;
DROP TABLE IF EXISTS public.invoice_bridge_manual         CASCADE;
DROP TABLE IF EXISTS public.payment_bridge_manual         CASCADE;
DROP TABLE IF EXISTS public.products_fiscal_map           CASCADE;
DROP TABLE IF EXISTS public.mrp_boms                      CASCADE;
DROP TABLE IF EXISTS public.mrp_bom_lines                 CASCADE;
DROP TABLE IF EXISTS public.cfdi_documents                CASCADE;
DROP TABLE IF EXISTS public.email_cfdi_links              CASCADE;

-- Costeo (frontend /contabilidad/*, hoy vive en Odoo qb_capacidad_costeo)
DROP TABLE IF EXISTS public.product_cost_catalog          CASCADE;
DROP TABLE IF EXISTS public.bom_recursive_cost_cache      CASCADE;
DROP TABLE IF EXISTS public.product_kg_per_unit           CASCADE;
DROP TABLE IF EXISTS public.cost_center_config            CASCADE;
DROP TABLE IF EXISTS public.overhead_account_assignment   CASCADE;
DROP TABLE IF EXISTS public.rent_lot_assignment           CASCADE;
DROP TABLE IF EXISTS public.workcenter_cost_config        CASCADE;
DROP TABLE IF EXISTS public.product_uom_conversion        CASCADE;
DROP TABLE IF EXISTS public.product_mp_breakdown          CASCADE;
DROP TABLE IF EXISTS public.product_real_avg_cost         CASCADE;
DROP TABLE IF EXISTS public.cogs_monthly_cache            CASCADE;

-- Agentes de IA (desactivados desde 2026-08-05) e insights
DROP TABLE IF EXISTS public.agent_insights                CASCADE;
DROP TABLE IF EXISTS public.agent_runs                    CASCADE;
DROP TABLE IF EXISTS public.agent_memory                  CASCADE;
DROP TABLE IF EXISTS public.ai_agents                     CASCADE;
DROP TABLE IF EXISTS public.briefings                     CASCADE;
DROP TABLE IF EXISTS public.action_items                  CASCADE;
DROP TABLE IF EXISTS public.insight_routing               CASCADE;

-- Grafo viejo (extraído por `analyze`, sin consumidor; lo reemplazan
-- memoria_facts + kg_nodes/kg_edges)
DROP TABLE IF EXISTS public.entities                      CASCADE;
DROP TABLE IF EXISTS public.entity_relationships          CASCADE;
DROP TABLE IF EXISTS public.facts                         CASCADE;
DROP TABLE IF EXISTS public.ai_extracted_facts            CASCADE;
DROP TABLE IF EXISTS public.email_signals                 CASCADE;

-- Tablas sueltas del frontend / sistema viejo
DROP TABLE IF EXISTS public.odoo_pending_actions          CASCADE;  -- exportado a qb19/docs/HALLAZGOS_ODOO_PENDIENTES_2026-09-18.md
DROP TABLE IF EXISTS public.departments                   CASCADE;
DROP TABLE IF EXISTS public.data_sources                  CASCADE;
DROP TABLE IF EXISTS public.manual_notes                  CASCADE;
DROP TABLE IF EXISTS public.schema_changes                CASCADE;
DROP TABLE IF EXISTS public.health_scores                 CASCADE;
DROP TABLE IF EXISTS public.employee_metrics              CASCADE;
DROP TABLE IF EXISTS public.department_metrics            CASCADE;
DROP TABLE IF EXISTS public.company_behavior              CASCADE;
DROP TABLE IF EXISTS public.odoo_models_catalog           CASCADE;

-- Familias por patrón (data_integrity_*, costing_*, insight_*, audit_*, agent_*)
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relname ~ '^(data_integrity_|costing_|insight_|audit_|agent_|canonical_|mdm_)'
  LOOP
    EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE', r.relname);
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 4. Bronze: odoo_* (excepto odoo_users, que alimenta el grafo y la vista
--    memoria_encargados) y syntage_* (el SAT vive en Odoo).
-- ----------------------------------------------------------------------------

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relname ~ '^(odoo_|syntage_)'
      AND c.relname <> 'odoo_users'
  LOOP
    EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE', r.relname);
  END LOOP;
END $$;

-- Jobs pg_cron que alimentaban silver/gold, Syntage y el backfill terminado.
-- Quedan solo los memoria_* vivos (10). memoria_backfill_sweep se desprograma
-- porque el backfill v2 terminó (52/52 buzones); memoria_syntage_daily porque
-- el webhook de Syntage apunta a Odoo.
DO $$
DECLARE
  r record;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RETURN;
  END IF;
  FOR r IN
    SELECT jobid, jobname
    FROM cron.job
    WHERE jobname IS NULL
       OR jobname !~ '^memoria_'
       OR jobname IN ('memoria_backfill_sweep', 'memoria_syntage_daily')
  LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 5. Funciones (~660 en producción). No se enumeran: se borran por patrón de
--    nombre o porque su cuerpo menciona tablas que ya no existen, excluyendo
--    las 32 funciones vivas y las que pertenecen a extensiones
--    (pg_depend.deptype = 'e').
-- ----------------------------------------------------------------------------

DO $$
DECLARE
  r record;
  vivas text[] := ARRAY[
    'analyst_query', 'auto_link_email_company_by_domain', 'auto_resolve_contact_company',
    'companies_sanitize_name', 'edge_secret', 'expire_email_pending_actions',
    'extract_company_payment_terms', 'extract_email', 'get_silent_customers',
    'get_unanswered_client_threads', 'ingest_emails_v2', 'invoke_edge',
    'invoke_edge_backfill_pending', 'invoke_edge_per_account', 'kg_refresh_deterministic',
    'kg_upsert_edge', 'kg_upsert_node', 'memoria_brief', 'memoria_buscar',
    'memoria_cron_health', 'memoria_email_addr', 'memoria_email_name',
    'memoria_generic_domain', 'memoria_guardar_consolidacion', 'memoria_hilo_mensajes',
    'memoria_hilos_pendientes', 'memoria_link_recent', 'memoria_thread_conv_key',
    'normalize_company_name', 'normalize_contact_email', 'resolve_contact_by_email',
    'set_updated_at'
  ];
  patron_nombre text := '^(_|test_|diagnose_|backfill_|run_|refresh_|matcher_|mdm_|'
                     || 'compute_|reconcile_|fix_|link_|deduplicate_|resolve_company_|'
                     || 'execute_safe_ddl|cashflow_|silver_|gold_|canonical_|'
                     || 'get_|route_insight|classify_|auto_source|trg_|fn_|sp[0-9]+_|'
                     || 'search_similar|match_|calc_|sync_|audit_|invariant_|'
                     || 'cost_|pnl_|bom_|kg_)';  -- get_* y kg_* vivas quedan fuera por `vivas`
  -- tablas borradas: si el cuerpo las menciona, la función ya no sirve
  patron_cuerpo text := '\m(canonical_[a-z_]+|syntage_[a-z_]+|gold_[a-z_]+|mv_[a-z_]+|'
                     || 'agent_insights|agent_runs|agent_memory|ai_agents|briefings|'
                     || 'action_items|insight_routing|reconciliation_issues|source_links|'
                     || 'mdm_manual_overrides|audit_runs|audit_tolerances|entities|'
                     || 'entity_relationships|ai_extracted_facts|email_signals|'
                     || 'odoo_pending_actions|data_sources|manual_notes|schema_changes|'
                     || 'product_cost_catalog|bom_recursive_cost_cache|product_kg_per_unit|'
                     || 'cost_center_config|overhead_account_assignment|rent_lot_assignment|'
                     || 'workcenter_cost_config|costing_[a-z_]+|product_uom_conversion|'
                     || 'product_mp_breakdown|product_real_avg_cost|cogs_monthly_cache|'
                     || 'mrp_boms|mrp_bom_lines|cfdi_documents|email_cfdi_links|'
                     || 'invoice_bridge_manual|payment_bridge_manual|products_fiscal_map|'
                     || 'health_scores|employee_metrics|department_metrics|company_behavior|'
                     || 'ingestion\.[a-z_]+)\M';
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, p.prokind, p.oid::regprocedure AS firma
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind IN ('f', 'p')
      AND p.proname <> ALL (vivas)
      -- no tocar funciones de extensiones (pg_net, pgcrypto, vector, pg_cron…)
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e'
      )
      AND (
        p.proname ~ patron_nombre
        -- odoo_* borradas, menos odoo_users (se quita del cuerpo antes de comparar)
        OR regexp_replace(coalesce(p.prosrc, ''), '\modoo_users\M', '', 'g') ~* '\modoo_[a-z_]+'
        OR regexp_replace(coalesce(p.prosrc, ''), '\mmemoria_facts\M', '', 'g') ~* '\mfacts\M'
        OR coalesce(p.prosrc, '') ~* patron_cuerpo
      )
  LOOP
    IF r.prokind = 'p' THEN
      EXECUTE format('DROP PROCEDURE IF EXISTS %s CASCADE', r.firma);
    ELSE
      EXECUTE format('DROP FUNCTION IF EXISTS %s CASCADE', r.firma);
    END IF;
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 6. Esquema `ingestion` (adaptadores de ingest del frontend, sin consumidor).
-- ----------------------------------------------------------------------------

DROP SCHEMA IF EXISTS ingestion CASCADE;

COMMIT;

-- ----------------------------------------------------------------------------
-- Verificación (solo lectura, para correr a mano después):
--
--   SELECT count(*) FROM pg_tables WHERE schemaname = 'public';          -- 21
--   SELECT count(*) FROM pg_views  WHERE schemaname = 'public';          -- 4
--   SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND NOT EXISTS (SELECT 1 FROM pg_depend d
--    WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e');  -- 32
--   SELECT jobname FROM cron.job ORDER BY 1;                             -- 10 memoria_*
--   SELECT pg_size_pretty(pg_database_size(current_database()));         -- ~5.0 GB
-- ----------------------------------------------------------------------------
