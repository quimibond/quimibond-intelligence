-- canonical_companies (Pattern C, MDM golden record) — Silver SP3 §5.5
BEGIN;

CREATE TABLE IF NOT EXISTS canonical_companies (
  id bigserial PRIMARY KEY,
  canonical_name text NOT NULL,
  display_name text NOT NULL,

  -- Source ids
  rfc text,
  odoo_partner_id integer,
  primary_entity_kg_id bigint,
  primary_email_domain text,

  -- Role
  is_customer boolean NOT NULL DEFAULT false,
  is_supplier boolean NOT NULL DEFAULT false,
  is_internal boolean NOT NULL DEFAULT false,
  is_sat_counterparty boolean GENERATED ALWAYS AS (
    primary_entity_kg_id IS NOT NULL OR rfc IS NOT NULL
  ) STORED,

  -- Fiscal
  regimen_fiscal text,
  person_type text,
  opinion_cumplimiento text,
  blacklist_level text NOT NULL DEFAULT 'none',
  blacklist_first_flagged_at timestamptz,
  blacklist_last_flagged_at timestamptz,
  blacklist_cfdis_flagged_count integer DEFAULT 0,
  blacklist_action text GENERATED ALWAYS AS (
    CASE blacklist_level
      WHEN 'definitive' THEN 'block'
      WHEN 'presumed'   THEN 'warning'
      ELSE NULL
    END
  ) STORED,

  -- Address
  country text,
  state text,
  city text,
  zip text,
  street text,
  domicilio_fiscal jsonb,

  -- Commercial
  industry text,
  business_type text,
  credit_limit numeric(14,2),
  payment_term text,
  supplier_payment_term text,

  -- Enrichment
  description text,
  strategic_notes text,
  relationship_type text,
  relationship_summary text,
  key_products jsonb,
  risk_signals jsonb,
  opportunity_signals jsonb,
  enriched_at timestamptz,
  enrichment_source text,

  -- Aggregated metrics
  lifetime_value_mxn numeric(14,2) DEFAULT 0,
  total_invoiced_odoo_mxn numeric(14,2) DEFAULT 0,
  total_invoiced_sat_mxn numeric(14,2) DEFAULT 0,
  revenue_ytd_mxn numeric(14,2) DEFAULT 0,
  revenue_90d_mxn numeric(14,2) DEFAULT 0,
  revenue_prior_90d_mxn numeric(14,2) DEFAULT 0,
  trend_pct numeric(8,4),
  total_credit_notes_mxn numeric(14,2) DEFAULT 0,
  invoices_count integer DEFAULT 0,
  last_invoice_date date,

  -- AR / AP
  total_receivable_mxn numeric(14,2) DEFAULT 0,
  total_payable_mxn numeric(14,2) DEFAULT 0,
  total_pending_mxn numeric(14,2) DEFAULT 0,
  ar_aging_buckets jsonb,
  overdue_amount_mxn numeric(14,2) DEFAULT 0,
  overdue_count integer DEFAULT 0,
  max_days_overdue integer,

  -- Operational
  total_deliveries_count integer DEFAULT 0,
  late_deliveries_count integer DEFAULT 0,
  otd_rate numeric(5,4),
  otd_rate_90d numeric(5,4),

  -- Email/communication
  email_count integer DEFAULT 0,
  last_email_at timestamptz,
  contact_count integer DEFAULT 0,

  -- Compliance
  sat_compliance_score numeric(5,4),
  invoices_with_cfdi integer DEFAULT 0,
  invoices_with_syntage_match integer DEFAULT 0,
  sat_open_issues_count integer DEFAULT 0,

  -- Risk tier
  risk_level text,
  tier text,
  revenue_share_pct numeric(5,4),

  -- MDM meta
  match_method text,
  match_confidence numeric(4,3),
  has_manual_override boolean DEFAULT false,
  has_shadow_flag boolean DEFAULT false,
  shadow_reason text,
  needs_review boolean DEFAULT false,
  review_reason text[] DEFAULT '{}',
  completeness_score numeric(4,3),
  last_matched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cc_canonical_name ON canonical_companies (canonical_name);
CREATE INDEX IF NOT EXISTS ix_cc_rfc ON canonical_companies (rfc) WHERE rfc IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_cc_odoo_partner ON canonical_companies (odoo_partner_id) WHERE odoo_partner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_cc_email_domain ON canonical_companies (primary_email_domain) WHERE primary_email_domain IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_cc_is_customer ON canonical_companies (is_customer) WHERE is_customer = true;
CREATE INDEX IF NOT EXISTS ix_cc_is_supplier ON canonical_companies (is_supplier) WHERE is_supplier = true;
CREATE INDEX IF NOT EXISTS ix_cc_blacklist ON canonical_companies (blacklist_level) WHERE blacklist_level <> 'none';
CREATE INDEX IF NOT EXISTS ix_cc_shadow ON canonical_companies (has_shadow_flag) WHERE has_shadow_flag = true;
CREATE INDEX IF NOT EXISTS ix_cc_needs_review ON canonical_companies (needs_review) WHERE needs_review = true;
CREATE INDEX IF NOT EXISTS ix_cc_name_trgm ON canonical_companies USING GIN (canonical_name gin_trgm_ops);

CREATE OR REPLACE FUNCTION trg_canonical_companies_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_canonical_companies_updated_at ON canonical_companies;
CREATE TRIGGER trg_canonical_companies_updated_at
  BEFORE UPDATE ON canonical_companies FOR EACH ROW
  EXECUTE FUNCTION trg_canonical_companies_updated_at();

COMMENT ON TABLE canonical_companies IS 'Silver SP3 Pattern C. MDM golden record per real company. Aggregated metrics populated retroactively in Task 2; SP4 engine maintains them ongoing.';

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('create_table','canonical_companies','SP3 Task 1: DDL + indexes + updated_at trigger','20260423_sp3_01_canonical_companies_ddl.sql','silver-sp3',true);

COMMIT;
