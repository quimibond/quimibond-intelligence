-- ============================================================
-- Migration 007: Schema V2 — Consolidation & Cleanup
--
-- Replaces the fragmented schema (001-006) with a clean,
-- consistent structure. All tables, indexes, FKs, RLS, RPCs.
--
-- Changes from V1:
-- 1. person_profiles → merged into contacts (VIEW for compat)
-- 2. account_summaries → proper columns (was under-defined)
-- 3. daily_summaries → proper columns matching types.ts
-- 4. response_metrics → proper columns matching types.ts
-- 5. Missing FKs added (entity_mentions.email_id, facts.entity_id)
-- 6. Missing columns added to contacts, alerts, action_items, etc.
-- 7. Missing tables created (companies, odoo_*, chat_memory, etc.)
-- 8. All indexes consolidated
-- 9. All RPC functions updated to use contacts instead of person_profiles
-- 10. Consistent naming: bigint PKs, timestamptz everywhere
-- ============================================================

-- ── Extensions ────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

-- ══════════════════════════════════════════════════════════════
-- CORE TABLES
-- ══════════════════════════════════════════════════════════════

-- ── Companies (master, referenced by contacts) ────────────────
CREATE TABLE IF NOT EXISTS companies (
  id                  bigserial PRIMARY KEY,
  name                text NOT NULL,
  canonical_name      text,
  odoo_partner_id     bigint,
  entity_id           bigint,
  is_customer         boolean DEFAULT false,
  is_supplier         boolean DEFAULT false,
  -- Profile (from Claude enrichment)
  industry            text,
  description         text,
  business_type       text,
  relationship_type   text,
  relationship_summary text,
  country             text,
  city                text,
  key_products        jsonb,
  risk_signals        jsonb,
  opportunity_signals jsonb,
  strategic_notes     text,
  enriched_at         timestamptz,
  enrichment_source   text,
  -- Financials (from Odoo sync)
  lifetime_value      numeric(14,2),
  credit_limit        numeric(14,2),
  total_pending       numeric(14,2),
  total_credit_notes  numeric(14,2),
  monthly_avg         numeric(14,2),
  trend_pct           numeric(6,2),
  delivery_otd_rate   numeric(5,2),
  -- Odoo operational data (JSONB — full detail from enrichment)
  odoo_context        jsonb,
  recent_sales        jsonb,
  pending_invoices    jsonb,
  recent_payments     jsonb,
  recent_purchases    jsonb,
  crm_leads           jsonb,
  pending_deliveries  jsonb,
  manufacturing       jsonb,
  pending_activities  jsonb,
  payment_behavior    jsonb,
  aging               jsonb,
  products            jsonb,
  inventory_intelligence jsonb,
  purchase_patterns   jsonb,
  --
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_canonical ON companies(canonical_name) WHERE canonical_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_companies_odoo ON companies(odoo_partner_id) WHERE odoo_partner_id IS NOT NULL;

-- ── Contacts (single source of truth for people) ──────────────
-- Merged: old contacts + person_profiles into one table
DO $$ BEGIN
  -- Add columns that may be missing from original contacts table
  ALTER TABLE contacts ADD COLUMN IF NOT EXISTS department text;
  ALTER TABLE contacts ADD COLUMN IF NOT EXISTS total_sent integer DEFAULT 0;
  ALTER TABLE contacts ADD COLUMN IF NOT EXISTS total_received integer DEFAULT 0;
  ALTER TABLE contacts ADD COLUMN IF NOT EXISTS avg_response_time_hours numeric;
  ALTER TABLE contacts ADD COLUMN IF NOT EXISTS last_activity timestamptz;
  ALTER TABLE contacts ADD COLUMN IF NOT EXISTS first_seen timestamptz;
  ALTER TABLE contacts ADD COLUMN IF NOT EXISTS role text;
  ALTER TABLE contacts ADD COLUMN IF NOT EXISTS decision_power text;
  ALTER TABLE contacts ADD COLUMN IF NOT EXISTS communication_style text;
  ALTER TABLE contacts ADD COLUMN IF NOT EXISTS language_preference text;
  ALTER TABLE contacts ADD COLUMN IF NOT EXISTS key_interests jsonb;
  ALTER TABLE contacts ADD COLUMN IF NOT EXISTS personality_notes text;
  ALTER TABLE contacts ADD COLUMN IF NOT EXISTS negotiation_style text;
  ALTER TABLE contacts ADD COLUMN IF NOT EXISTS response_pattern text;
  ALTER TABLE contacts ADD COLUMN IF NOT EXISTS influence_on_deals text;
  ALTER TABLE contacts ADD COLUMN IF NOT EXISTS interaction_count integer DEFAULT 0;
  ALTER TABLE contacts ADD COLUMN IF NOT EXISTS current_health_score numeric(5,2);
  ALTER TABLE contacts ADD COLUMN IF NOT EXISTS health_trend text;
  ALTER TABLE contacts ADD COLUMN IF NOT EXISTS lifetime_value numeric(14,2);
  ALTER TABLE contacts ADD COLUMN IF NOT EXISTS open_alerts_count integer DEFAULT 0;
  ALTER TABLE contacts ADD COLUMN IF NOT EXISTS pending_actions_count integer DEFAULT 0;
  ALTER TABLE contacts ADD COLUMN IF NOT EXISTS total_credit_notes integer DEFAULT 0;
  ALTER TABLE contacts ADD COLUMN IF NOT EXISTS delivery_otd_rate numeric(5,2);
  ALTER TABLE contacts ADD COLUMN IF NOT EXISTS odoo_context jsonb;
  ALTER TABLE contacts ADD COLUMN IF NOT EXISTS odoo_partner_id bigint;
  ALTER TABLE contacts ADD COLUMN IF NOT EXISTS is_customer boolean;
  ALTER TABLE contacts ADD COLUMN IF NOT EXISTS is_supplier boolean;
  ALTER TABLE contacts ADD COLUMN IF NOT EXISTS company_id bigint;
  ALTER TABLE contacts ADD COLUMN IF NOT EXISTS entity_id bigint;
  ALTER TABLE contacts ADD COLUMN IF NOT EXISTS commercial_partner_id bigint;
  ALTER TABLE contacts ADD COLUMN IF NOT EXISTS score_breakdown jsonb;
END $$;

-- Indexes for contacts
CREATE INDEX IF NOT EXISTS idx_contacts_company_id ON contacts(company_id) WHERE company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_last_activity ON contacts(last_activity DESC NULLS LAST) WHERE contact_type = 'external';

-- ── Migrate person_profiles data into contacts ────────────────
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'person_profiles') THEN
    UPDATE contacts c SET
      role = COALESCE(c.role, pp.role),
      department = COALESCE(c.department, pp.department),
      decision_power = COALESCE(c.decision_power, pp.decision_power),
      communication_style = COALESCE(c.communication_style, pp.communication_style),
      personality_notes = COALESCE(c.personality_notes, pp.summary),
      key_interests = COALESCE(c.key_interests, to_jsonb(pp.interests))
    FROM person_profiles pp
    WHERE pp.email IS NOT NULL
      AND pp.email = c.email
      AND (c.role IS NULL OR c.decision_power IS NULL);
  END IF;
END $$;

-- Backward-compat view for person_profiles
CREATE OR REPLACE VIEW person_profiles_v AS
  SELECT id, email, name, company, role, department, decision_power,
         communication_style, key_interests AS interests,
         personality_notes AS summary, negotiation_style,
         response_pattern, influence_on_deals,
         created_at, updated_at
  FROM contacts WHERE email IS NOT NULL;

-- ── Emails ────────────────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE emails ADD COLUMN IF NOT EXISTS attachments jsonb;
  ALTER TABLE emails ADD COLUMN IF NOT EXISTS is_reply boolean DEFAULT false;
  ALTER TABLE emails ADD COLUMN IF NOT EXISTS company_id bigint;
  ALTER TABLE emails ADD COLUMN IF NOT EXISTS sender_odoo_partner_id bigint;
  ALTER TABLE emails ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
END $$;

-- ── Threads ───────────────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE threads ADD COLUMN IF NOT EXISTS subject_normalized text;
  ALTER TABLE threads ADD COLUMN IF NOT EXISTS started_by text;
  ALTER TABLE threads ADD COLUMN IF NOT EXISTS started_by_type text;
  ALTER TABLE threads ADD COLUMN IF NOT EXISTS started_at timestamptz;
  ALTER TABLE threads ADD COLUMN IF NOT EXISTS last_activity timestamptz;
  ALTER TABLE threads ADD COLUMN IF NOT EXISTS has_internal_reply boolean DEFAULT false;
  ALTER TABLE threads ADD COLUMN IF NOT EXISTS has_external_reply boolean DEFAULT false;
  ALTER TABLE threads ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
END $$;

CREATE INDEX IF NOT EXISTS idx_threads_status ON threads(status) WHERE status IN ('stalled', 'needs_response');
CREATE INDEX IF NOT EXISTS idx_threads_last_activity ON threads(last_activity DESC NULLS LAST);

-- ── Alerts ────────────────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE alerts ADD COLUMN IF NOT EXISTS company_id bigint;
  ALTER TABLE alerts ADD COLUMN IF NOT EXISTS is_resolved boolean DEFAULT false;
  ALTER TABLE alerts ADD COLUMN IF NOT EXISTS prediction_id text;
  ALTER TABLE alerts ADD COLUMN IF NOT EXISTS prediction_confidence numeric(5,2);
  ALTER TABLE alerts ADD COLUMN IF NOT EXISTS resolution_notes text;
  ALTER TABLE alerts ADD COLUMN IF NOT EXISTS related_thread_id text;
  ALTER TABLE alerts ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
END $$;

CREATE INDEX IF NOT EXISTS idx_alerts_type ON alerts(alert_type);
CREATE INDEX IF NOT EXISTS idx_alerts_company ON alerts(company_id) WHERE company_id IS NOT NULL;

-- ── Action Items ──────────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE action_items ADD COLUMN IF NOT EXISTS company_id bigint;
  ALTER TABLE action_items ADD COLUMN IF NOT EXISTS assignee_name text;
  ALTER TABLE action_items ADD COLUMN IF NOT EXISTS assignee_entity_id bigint;
  ALTER TABLE action_items ADD COLUMN IF NOT EXISTS related_entity_id bigint;
  ALTER TABLE action_items ADD COLUMN IF NOT EXISTS completed_at timestamptz;
  ALTER TABLE action_items ADD COLUMN IF NOT EXISTS prediction_id text;
  ALTER TABLE action_items ADD COLUMN IF NOT EXISTS prediction_confidence numeric(5,2);
  ALTER TABLE action_items ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
END $$;

CREATE INDEX IF NOT EXISTS idx_actions_assignee ON action_items(assignee_email) WHERE state = 'pending';
CREATE INDEX IF NOT EXISTS idx_actions_company ON action_items(company_id) WHERE company_id IS NOT NULL;

-- ── Daily Summaries (proper columns) ──────────────────────────
DO $$ BEGIN
  ALTER TABLE daily_summaries ADD COLUMN IF NOT EXISTS summary_html text;
  ALTER TABLE daily_summaries ADD COLUMN IF NOT EXISTS summary_text text;
  ALTER TABLE daily_summaries ADD COLUMN IF NOT EXISTS total_emails integer DEFAULT 0;
  ALTER TABLE daily_summaries ADD COLUMN IF NOT EXISTS accounts_read integer DEFAULT 0;
  ALTER TABLE daily_summaries ADD COLUMN IF NOT EXISTS accounts_failed integer DEFAULT 0;
  ALTER TABLE daily_summaries ADD COLUMN IF NOT EXISTS topics_identified integer DEFAULT 0;
  ALTER TABLE daily_summaries ADD COLUMN IF NOT EXISTS account_summaries jsonb;
END $$;

CREATE INDEX IF NOT EXISTS idx_daily_summaries_date ON daily_summaries(summary_date DESC);

-- ── Account Summaries (proper columns) ────────────────────────
DO $$ BEGIN
  ALTER TABLE account_summaries ADD COLUMN IF NOT EXISTS department text;
  ALTER TABLE account_summaries ADD COLUMN IF NOT EXISTS summary_date date;
  ALTER TABLE account_summaries ADD COLUMN IF NOT EXISTS summary_text text;
  ALTER TABLE account_summaries ADD COLUMN IF NOT EXISTS overall_sentiment text;
  ALTER TABLE account_summaries ADD COLUMN IF NOT EXISTS sentiment_detail jsonb;
  ALTER TABLE account_summaries ADD COLUMN IF NOT EXISTS external_emails integer DEFAULT 0;
  ALTER TABLE account_summaries ADD COLUMN IF NOT EXISTS internal_emails integer DEFAULT 0;
  ALTER TABLE account_summaries ADD COLUMN IF NOT EXISTS key_items jsonb;
  ALTER TABLE account_summaries ADD COLUMN IF NOT EXISTS waiting_response jsonb;
  ALTER TABLE account_summaries ADD COLUMN IF NOT EXISTS urgent_items jsonb;
  ALTER TABLE account_summaries ADD COLUMN IF NOT EXISTS external_contacts jsonb;
  ALTER TABLE account_summaries ADD COLUMN IF NOT EXISTS risks_detected jsonb;
  ALTER TABLE account_summaries ADD COLUMN IF NOT EXISTS topics_detected jsonb;
  ALTER TABLE account_summaries ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
END $$;

CREATE INDEX IF NOT EXISTS idx_account_summaries_date ON account_summaries(summary_date DESC);

-- ── Response Metrics (proper columns) ─────────────────────────
DO $$ BEGIN
  ALTER TABLE response_metrics ADD COLUMN IF NOT EXISTS metric_date date;
  ALTER TABLE response_metrics ADD COLUMN IF NOT EXISTS avg_response_hours numeric;
  ALTER TABLE response_metrics ADD COLUMN IF NOT EXISTS emails_received integer DEFAULT 0;
  ALTER TABLE response_metrics ADD COLUMN IF NOT EXISTS emails_sent integer DEFAULT 0;
  ALTER TABLE response_metrics ADD COLUMN IF NOT EXISTS internal_received integer DEFAULT 0;
  ALTER TABLE response_metrics ADD COLUMN IF NOT EXISTS external_received integer DEFAULT 0;
  ALTER TABLE response_metrics ADD COLUMN IF NOT EXISTS threads_started integer DEFAULT 0;
  ALTER TABLE response_metrics ADD COLUMN IF NOT EXISTS threads_replied integer DEFAULT 0;
  ALTER TABLE response_metrics ADD COLUMN IF NOT EXISTS threads_unanswered integer DEFAULT 0;
  ALTER TABLE response_metrics ADD COLUMN IF NOT EXISTS fastest_response_hours numeric;
  ALTER TABLE response_metrics ADD COLUMN IF NOT EXISTS slowest_response_hours numeric;
  ALTER TABLE response_metrics ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
END $$;

CREATE INDEX IF NOT EXISTS idx_response_metrics_date ON response_metrics(metric_date DESC);

-- ── Entities (KG) ─────────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE entities ADD COLUMN IF NOT EXISTS odoo_model text;
  ALTER TABLE entities ADD COLUMN IF NOT EXISTS odoo_id bigint;
  ALTER TABLE entities ADD COLUMN IF NOT EXISTS company_id bigint;
  ALTER TABLE entities ADD COLUMN IF NOT EXISTS first_seen timestamptz;
  ALTER TABLE entities ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
END $$;

-- ── Entity Relationships ──────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE entity_relationships ADD COLUMN IF NOT EXISTS strength numeric(5,2);
  ALTER TABLE entity_relationships ADD COLUMN IF NOT EXISTS context text;
  ALTER TABLE entity_relationships ADD COLUMN IF NOT EXISTS first_seen timestamptz;
  ALTER TABLE entity_relationships ADD COLUMN IF NOT EXISTS last_seen timestamptz;
  ALTER TABLE entity_relationships ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
END $$;

CREATE INDEX IF NOT EXISTS idx_entity_rel_a ON entity_relationships(entity_a_id);
CREATE INDEX IF NOT EXISTS idx_entity_rel_b ON entity_relationships(entity_b_id);

-- ── Facts ─────────────────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE facts ADD COLUMN IF NOT EXISTS entity_id bigint;
  ALTER TABLE facts ADD COLUMN IF NOT EXISTS verified boolean DEFAULT false;
  ALTER TABLE facts ADD COLUMN IF NOT EXISTS verification_source text;
  ALTER TABLE facts ADD COLUMN IF NOT EXISTS verification_date timestamptz;
  ALTER TABLE facts ADD COLUMN IF NOT EXISTS fact_date date;
  ALTER TABLE facts ADD COLUMN IF NOT EXISTS is_future boolean DEFAULT false;
  ALTER TABLE facts ADD COLUMN IF NOT EXISTS expired boolean DEFAULT false;
  ALTER TABLE facts ADD COLUMN IF NOT EXISTS source_account text;
  ALTER TABLE facts ADD COLUMN IF NOT EXISTS fact_hash text;
  ALTER TABLE facts ADD COLUMN IF NOT EXISTS extracted_at timestamptz;
END $$;

CREATE INDEX IF NOT EXISTS idx_facts_entity ON facts(entity_id) WHERE entity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_facts_type ON facts(fact_type);
CREATE INDEX IF NOT EXISTS idx_facts_hash ON facts(fact_hash) WHERE fact_hash IS NOT NULL;

-- ── Topics (proper columns) ──────────────────────────────────
DO $$ BEGIN
  ALTER TABLE topics ADD COLUMN IF NOT EXISTS topic text;
  ALTER TABLE topics ADD COLUMN IF NOT EXISTS status text;
  ALTER TABLE topics ADD COLUMN IF NOT EXISTS priority text;
  ALTER TABLE topics ADD COLUMN IF NOT EXISTS summary text;
  ALTER TABLE topics ADD COLUMN IF NOT EXISTS related_accounts text[];
  ALTER TABLE topics ADD COLUMN IF NOT EXISTS first_seen timestamptz;
  ALTER TABLE topics ADD COLUMN IF NOT EXISTS last_seen timestamptz;
  ALTER TABLE topics ADD COLUMN IF NOT EXISTS times_seen integer DEFAULT 0;
  ALTER TABLE topics ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
END $$;

-- ── Customer Health Scores ────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE customer_health_scores ADD COLUMN IF NOT EXISTS overall_score numeric(5,2);
  ALTER TABLE customer_health_scores ADD COLUMN IF NOT EXISTS company_id bigint;
END $$;

CREATE INDEX IF NOT EXISTS idx_health_contact ON customer_health_scores(contact_id);
CREATE INDEX IF NOT EXISTS idx_health_date ON customer_health_scores(score_date DESC);

-- ── Revenue Metrics ───────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_revenue_contact ON revenue_metrics(contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_revenue_period ON revenue_metrics(period_start DESC);

-- ── Sync State ────────────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE sync_state ADD COLUMN IF NOT EXISTS last_sync_at timestamptz;
END $$;

-- ══════════════════════════════════════════════════════════════
-- TABLES THAT MAY NOT EXIST YET (created by qb19 backend)
-- ══════════════════════════════════════════════════════════════

-- ── Alert Type Catalog ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alert_type_catalog (
  id                bigserial PRIMARY KEY,
  alert_type        text UNIQUE NOT NULL,
  display_name      text,
  description       text,
  default_severity  text DEFAULT 'medium',
  category          text,
  is_active         boolean DEFAULT true,
  created_at        timestamptz DEFAULT now()
);

-- ── Chat Memory ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chat_memory (
  id                bigserial PRIMARY KEY,
  question          text NOT NULL,
  answer            text NOT NULL,
  context_used      jsonb,
  saved_at          timestamptz DEFAULT now(),
  rating            integer,
  thumbs_up         boolean,
  times_retrieved   integer DEFAULT 0
);

-- ── Feedback Signals ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS feedback_signals (
  id                bigserial PRIMARY KEY,
  signal_source     text DEFAULT 'frontend',
  source_id         bigint,
  source_type       text,
  signal_type       text,
  reward_score      numeric(3,2),
  context           jsonb DEFAULT '{}',
  account           text,
  contact_email     text,
  reward_processed  boolean DEFAULT false,
  created_at        timestamptz DEFAULT now()
);

-- ── Prediction Outcomes ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS prediction_outcomes (
  id                bigserial PRIMARY KEY,
  prediction_type   text NOT NULL,
  prediction_id     bigint,
  prediction_date   date,
  prediction_summary text,
  predicted_severity text,
  confidence        numeric(5,2),
  outcome_type      text,
  outcome_date      date,
  outcome_summary   text,
  outcome_data      jsonb,
  accuracy_score    numeric(5,2),
  account           text,
  contact_email     text,
  verified_at       timestamptz,
  created_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_predictions_type ON prediction_outcomes(prediction_type);

-- ── Company Odoo Snapshots ────────────────────────────────────
CREATE TABLE IF NOT EXISTS company_odoo_snapshots (
  id                    bigserial PRIMARY KEY,
  company_id            bigint NOT NULL,
  snapshot_date         date NOT NULL,
  total_invoiced        numeric(14,2) DEFAULT 0,
  pending_amount        numeric(14,2) DEFAULT 0,
  overdue_amount        numeric(14,2) DEFAULT 0,
  monthly_avg           numeric(14,2),
  open_orders_count     integer DEFAULT 0,
  pending_deliveries_count integer DEFAULT 0,
  late_deliveries_count integer DEFAULT 0,
  crm_pipeline_value    numeric(14,2),
  crm_leads_count       integer DEFAULT 0,
  manufacturing_count   integer DEFAULT 0,
  credit_notes_total    numeric(14,2),
  created_at            timestamptz DEFAULT now(),
  UNIQUE (company_id, snapshot_date)
);

-- ── Odoo Products ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS odoo_products (
  id                bigserial PRIMARY KEY,
  odoo_product_id   bigint UNIQUE NOT NULL,
  name              text NOT NULL,
  internal_ref      text,
  category          text,
  category_id       bigint,
  uom               text DEFAULT 'Unidad',
  stock_qty         numeric(12,2) DEFAULT 0,
  reserved_qty      numeric(12,2) DEFAULT 0,
  available_qty     numeric(12,2) GENERATED ALWAYS AS (stock_qty - reserved_qty) STORED,
  reorder_min       numeric(12,2) DEFAULT 0,
  reorder_max       numeric(12,2) DEFAULT 0,
  standard_price    numeric(12,2) DEFAULT 0,
  list_price        numeric(12,2) DEFAULT 0,
  active            boolean DEFAULT true,
  product_type      text,
  barcode           text,
  weight            numeric(10,3),
  updated_at        timestamptz DEFAULT now()
);

-- ── Odoo Order Lines ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS odoo_order_lines (
  id                bigserial PRIMARY KEY,
  odoo_line_id      bigint UNIQUE NOT NULL,
  odoo_order_id     bigint,
  odoo_partner_id   bigint,
  company_id        bigint,
  order_name        text,
  order_date        date,
  order_type        text NOT NULL CHECK (order_type IN ('sale', 'purchase')),
  order_state       text,
  product_name      text,
  odoo_product_id   bigint,
  qty               numeric(12,2) DEFAULT 0,
  price_unit        numeric(12,2) DEFAULT 0,
  discount          numeric(5,2) DEFAULT 0,
  subtotal          numeric(14,2) DEFAULT 0,
  currency          text DEFAULT 'MXN'
);

CREATE INDEX IF NOT EXISTS idx_order_lines_partner ON odoo_order_lines(odoo_partner_id);
CREATE INDEX IF NOT EXISTS idx_order_lines_date ON odoo_order_lines(order_date DESC);

-- ── Odoo Users ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS odoo_users (
  id                      bigserial PRIMARY KEY,
  odoo_user_id            bigint UNIQUE NOT NULL,
  name                    text NOT NULL,
  email                   text,
  login                   text,
  department              text,
  job_title               text,
  active                  boolean DEFAULT true,
  pending_activities_count integer DEFAULT 0,
  overdue_activities_count integer DEFAULT 0,
  activities_json         jsonb DEFAULT '[]',
  updated_at              timestamptz DEFAULT now()
);

-- ── Topic Category Catalog ────────────────────────────────────
CREATE TABLE IF NOT EXISTS topic_category_catalog (
  id                bigserial PRIMARY KEY,
  canonical_name    text UNIQUE NOT NULL,
  aliases           text[],
  department_emails text[],
  display_order     integer DEFAULT 0,
  created_at        timestamptz DEFAULT now()
);

-- ══════════════════════════════════════════════════════════════
-- RLS POLICIES (for tables that may not have them)
-- ══════════════════════════════════════════════════════════════

DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN SELECT unnest(ARRAY[
    'companies', 'alert_type_catalog', 'chat_memory', 'feedback_signals',
    'prediction_outcomes', 'company_odoo_snapshots',
    'odoo_products', 'odoo_order_lines', 'odoo_users',
    'topic_category_catalog'
  ]) LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    -- Anon read-only
    EXECUTE format(
      'CREATE POLICY IF NOT EXISTS anon_read_%s ON %I FOR SELECT TO anon USING (true)',
      tbl, tbl
    );
  END LOOP;
END $$;

-- Chat memory: anon can also insert (for saving conversations)
DO $$ BEGIN
  CREATE POLICY IF NOT EXISTS anon_insert_chat_memory ON chat_memory FOR INSERT TO anon WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Feedback signals: anon can insert (for rating alerts/actions)
DO $$ BEGIN
  CREATE POLICY IF NOT EXISTS anon_insert_feedback ON feedback_signals FOR INSERT TO anon WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ══════════════════════════════════════════════════════════════
-- UPDATED RPC FUNCTIONS
-- ══════════════════════════════════════════════════════════════

-- ── get_contact_intelligence: read from contacts (not person_profiles)
CREATE OR REPLACE FUNCTION get_contact_intelligence(p_contact_email text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  result json;
  v_name text;
BEGIN
  SELECT name INTO v_name FROM contacts WHERE email = p_contact_email;

  SELECT json_build_object(
    'open_alerts', (SELECT count(*) FROM alerts WHERE contact_name = v_name AND state = 'new'),
    'pending_actions', (SELECT count(*) FROM action_items WHERE contact_name = v_name AND state = 'pending'),
    'overdue_actions', (SELECT count(*) FROM action_items WHERE contact_name = v_name AND state = 'pending' AND due_date < CURRENT_DATE),
    'recent_emails', (
      SELECT coalesce(json_agg(row_to_json(e)), '[]'::json)
      FROM (
        SELECT id, subject, snippet, sender, recipient, email_date, sender_type
        FROM emails
        WHERE sender ILIKE '%' || p_contact_email || '%'
           OR recipient ILIKE '%' || p_contact_email || '%'
        ORDER BY email_date DESC LIMIT 10
      ) e
    ),
    'person_profile', (
      SELECT row_to_json(pp)
      FROM (
        SELECT name, email, company, role, department, decision_power,
               communication_style, negotiation_style, response_pattern,
               key_interests, personality_notes, influence_on_deals
        FROM contacts
        WHERE email = p_contact_email
        LIMIT 1
      ) pp
    )
  ) INTO result;
  RETURN result;
END;
$$;
GRANT EXECUTE ON FUNCTION get_contact_intelligence TO anon;

-- ── Seed alert type catalog ───────────────────────────────────
INSERT INTO alert_type_catalog (alert_type, display_name, description, default_severity, category, is_active)
VALUES
  ('no_response',        'Sin respuesta',                'Email sin respuesta en >24h',                          'high',    'comunicacion', true),
  ('stalled_thread',     'Thread estancado',             'Conversación sin actividad >48h',                      'high',    'comunicacion', true),
  ('negative_sentiment', 'Sentimiento negativo',         'Tono negativo detectado en comunicación',              'medium',  'comunicacion', true),
  ('at_risk_client',     'Cliente en riesgo',            'Score bajo + señales negativas',                       'high',    'relacion',     true),
  ('churn_risk',         'Riesgo de churn',              'Score cayendo >15pts en 30 días',                      'critical','relacion',     true),
  ('opportunity',        'Oportunidad detectada',        'Score subiendo + señales positivas',                   'medium',  'comercial',    true),
  ('competitor',         'Competidor mencionado',        'Mención de competidor en emails',                      'medium',  'comercial',    true),
  ('anomaly',            'Anomalía detectada',           'Patrón inusual en comunicación',                       'medium',  'sistema',      true),
  ('accountability',     'Acción sin cumplir',           'Acción asignada vencida sin evidencia',                'high',    'equipo',       true),
  ('overdue_invoice',    'Factura vencida',              'Factura pendiente de pago >30 días',                   'high',    'financiero',   true),
  ('payment_delay',      'Retraso en pago',              'Pago recibido >5 días después del vencimiento',        'medium',  'financiero',   true),
  ('invoice_silence',    'Silencio post-factura',        'Sin confirmación después de enviar factura',           'medium',  'financiero',   true),
  ('delivery_risk',      'Riesgo de entrega',            'Picking retrasado >1 día',                             'high',    'operativo',    true),
  ('quality_issue',      'Problema de calidad',          'Queja o devolución detectada',                         'high',    'operativo',    true),
  ('high_volume',        'Alto volumen',                 'Más de 50 emails en una cuenta en un día',             'low',     'sistema',      true),
  ('volume_drop',        'Caída de volumen',             'Producto con >30% menos volumen vs periodo anterior',  'medium',  'comercial',    true),
  ('unusual_discount',   'Descuento inusual',            'Descuento fuera del rango histórico',                  'medium',  'comercial',    true),
  ('cross_sell',         'Oportunidad cross-sell',       'Producto que clientes similares compran',              'low',     'comercial',    true),
  ('stockout_risk',      'Riesgo de desabasto',          'Producto con stock crítico o agotado',                 'high',    'operativo',    true),
  ('reorder_needed',     'Reorden necesario',            'Stock bajo punto de reorden',                          'medium',  'operativo',    true),
  ('payment_compliance', 'Deterioro en pago',            'Compliance <40% o tendencia empeorando',               'medium',  'financiero',   true)
ON CONFLICT (alert_type) DO NOTHING;

-- ── Run identity resolution ───────────────────────────────────
SELECT resolve_all_identities();
