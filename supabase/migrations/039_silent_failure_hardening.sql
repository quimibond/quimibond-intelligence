-- Migration 039 — Silent failure hardening (2026-04-12)
--
-- Context: Discovered a 7-day silent insert failure on agent_insights caused by
-- RLS being enabled with a SELECT+UPDATE policy but no INSERT policy. Supabase
-- client returned {data: [], error: null} silently. Applied defense-in-depth:
--
-- 1. Added INSERT/UPDATE/DELETE policies to 27 tables that need backend writes
-- 2. Added 'archived' state to agent_insights CHECK constraint
-- 3. Added 'noise' contact_type for marketing/no-reply senders
-- 4. Added 'cfdi_failed' enrichment_status for non-parseable XMLs
-- 5. Added UNIQUE constraints on odoo_partner_id (companies + contacts)

-- ── RLS write policies (defense-in-depth) ──────────────────────────────
DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'emails', 'threads', 'entities', 'facts', 'entity_relationships',
    'sync_state', 'health_scores', 'revenue_metrics', 'contacts', 'companies',
    'odoo_products', 'odoo_invoices', 'odoo_invoice_lines', 'odoo_payments',
    'odoo_order_lines', 'odoo_deliveries', 'odoo_activities', 'odoo_crm_leads',
    'odoo_users', 'odoo_orderpoints', 'odoo_account_payments',
    'odoo_chart_of_accounts', 'odoo_account_balances', 'odoo_bank_balances',
    'odoo_snapshots', 'odoo_schema_catalog', 'cfdi_documents'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS "anon_write_%I" ON public.%I', tbl, tbl);
    EXECUTE format(
      'CREATE POLICY "anon_write_%I" ON public.%I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)',
      tbl, tbl
    );
  END LOOP;
END $$;

-- agent_insights: already had SELECT + UPDATE, add INSERT
DROP POLICY IF EXISTS "anon_insert_agent_insights" ON public.agent_insights;
CREATE POLICY "anon_insert_agent_insights" ON public.agent_insights
  FOR INSERT TO anon, authenticated WITH CHECK (true);

-- ai_agents: add INSERT + DELETE (had SELECT + UPDATE)
DROP POLICY IF EXISTS "anon_insert_ai_agents" ON public.ai_agents;
CREATE POLICY "anon_insert_ai_agents" ON public.ai_agents
  FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_ai_agents" ON public.ai_agents;
CREATE POLICY "anon_delete_ai_agents" ON public.ai_agents
  FOR DELETE TO anon, authenticated USING (true);

-- ── Constraint extensions ──────────────────────────────────────────────

-- Add 'archived' to agent_insights state (for low-confidence filtering)
ALTER TABLE agent_insights DROP CONSTRAINT IF EXISTS agent_insights_state_check;
ALTER TABLE agent_insights ADD CONSTRAINT agent_insights_state_check
  CHECK (state = ANY (ARRAY['new', 'seen', 'acted_on', 'dismissed', 'expired', 'archived']));

-- Add 'noise' contact_type (for marketing/no-reply senders)
ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_contact_type_check;
ALTER TABLE contacts ADD CONSTRAINT contacts_contact_type_check
  CHECK (contact_type = ANY (ARRAY['internal', 'external', 'noise']));

-- Add 'cfdi_failed' enrichment_status (for unparseable CFDI XMLs)
ALTER TABLE emails DROP CONSTRAINT IF EXISTS emails_enrichment_status_check;
ALTER TABLE emails ADD CONSTRAINT emails_enrichment_status_check
  CHECK (enrichment_status = ANY (ARRAY['pending', 'matched', 'unresolved', 'cfdi_failed']));

-- ── Unique constraints (prevent dup sync) ──────────────────────────────
ALTER TABLE companies DROP CONSTRAINT IF EXISTS companies_odoo_partner_id_unique;
ALTER TABLE companies ADD CONSTRAINT companies_odoo_partner_id_unique UNIQUE (odoo_partner_id);

ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_odoo_partner_id_unique;
ALTER TABLE contacts ADD CONSTRAINT contacts_odoo_partner_id_unique UNIQUE (odoo_partner_id);

-- ── archived_at column on ai_agents (for legacy agent archival) ────────
ALTER TABLE ai_agents ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- ── Missing FK indexes ─────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_agent_tickets_from_agent_id ON agent_tickets(from_agent_id);
CREATE INDEX IF NOT EXISTS idx_cfdi_documents_emisor_company_id ON cfdi_documents(emisor_company_id) WHERE emisor_company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cfdi_documents_receptor_company_id ON cfdi_documents(receptor_company_id) WHERE receptor_company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_departments_lead_user_id ON departments(lead_user_id);
CREATE INDEX IF NOT EXISTS idx_insight_routing_department_id ON insight_routing(department_id);

-- ── Trigram indexes for fuzzy matching in resolve_identities ───────────
CREATE INDEX IF NOT EXISTS idx_companies_canonical_name_trgm
  ON companies USING gin (canonical_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_entities_canonical_name_trgm
  ON entities USING gin (canonical_name gin_trgm_ops);
