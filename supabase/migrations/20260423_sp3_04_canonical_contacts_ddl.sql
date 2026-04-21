BEGIN;

CREATE TABLE IF NOT EXISTS canonical_contacts (
  id bigserial PRIMARY KEY,
  primary_email text NOT NULL,
  display_name text NOT NULL,
  canonical_name text NOT NULL,
  odoo_partner_id integer,
  odoo_employee_id integer,
  odoo_user_id integer,
  primary_entity_kg_id bigint,
  contact_type text NOT NULL CHECK (contact_type IN ('internal_employee','internal_user','external_customer','external_supplier','external_unresolved')),
  is_customer boolean NOT NULL DEFAULT false,
  is_supplier boolean NOT NULL DEFAULT false,
  canonical_company_id bigint REFERENCES canonical_companies(id),
  role text,
  department text,
  manager_canonical_contact_id bigint REFERENCES canonical_contacts(id),
  language_preference text,
  communication_style text,
  response_pattern text,
  decision_power text,
  negotiation_style text,
  influence_on_deals text,
  personality_notes text,
  relationship_score numeric(4,3),
  sentiment_score numeric(4,3),
  current_health_score numeric(4,3),
  health_trend text,
  risk_level text,
  payment_compliance_score numeric(4,3),
  lifetime_value_mxn numeric(14,2) DEFAULT 0,
  delivery_otd_rate numeric(5,4),
  total_sent integer DEFAULT 0,
  total_received integer DEFAULT 0,
  avg_response_time_hours numeric(8,2),
  last_activity_at timestamptz,
  first_seen_at timestamptz,
  open_alerts_count integer DEFAULT 0,
  pending_actions_count integer DEFAULT 0,
  match_method text,
  match_confidence numeric(4,3),
  has_manual_override boolean DEFAULT false,
  has_shadow_flag boolean DEFAULT false,
  needs_review boolean DEFAULT false,
  review_reason text[] DEFAULT '{}',
  completeness_score numeric(4,3),
  last_matched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cct_primary_email ON canonical_contacts (LOWER(primary_email));
CREATE INDEX IF NOT EXISTS ix_cct_company ON canonical_contacts (canonical_company_id);
CREATE INDEX IF NOT EXISTS ix_cct_contact_type ON canonical_contacts (contact_type);
CREATE INDEX IF NOT EXISTS ix_cct_odoo_employee ON canonical_contacts (odoo_employee_id) WHERE odoo_employee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_cct_odoo_user ON canonical_contacts (odoo_user_id) WHERE odoo_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_cct_manual_override ON canonical_contacts (has_manual_override) WHERE has_manual_override = true;
CREATE INDEX IF NOT EXISTS ix_cct_needs_review ON canonical_contacts (needs_review) WHERE needs_review = true;
CREATE INDEX IF NOT EXISTS ix_cct_name_trgm ON canonical_contacts USING GIN (canonical_name gin_trgm_ops);

CREATE OR REPLACE FUNCTION trg_canonical_contacts_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_cct_updated_at ON canonical_contacts;
CREATE TRIGGER trg_cct_updated_at BEFORE UPDATE ON canonical_contacts
  FOR EACH ROW EXECUTE FUNCTION trg_canonical_contacts_updated_at();

COMMENT ON TABLE canonical_contacts IS 'Silver SP3 Pattern C. Golden contact record per real person. primary_email UNIQUE case-insensitive.';

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('create_table','canonical_contacts','SP3 Task 4: DDL','20260423_sp3_04_canonical_contacts_ddl.sql','silver-sp3',true);

COMMIT;
