-- 20260427_counterparty_classification.sql
--
-- Adds counterparty_type + customer_lifecycle classification to
-- canonical_companies. Each lives in 3 columns: *_auto (rule-based,
-- populated by classify_counterparties() RPC), *_manual (CEO override
-- via UI/SQL, nullable), and effective (GENERATED column COALESCE
-- of manual > auto). Single source of truth, no fallback logic in
-- queries.
--
-- See conversation 2026-04-27 + framework proposal.
-- Ground truth seed:
--   - LEPEZO/LEASING LEPEZO    -> counterparty_type='financiera'
--   - BELSUEÑO                 -> customer_lifecycle='lost'
-- Rest auto-detected via classify_counterparties() — see preview.
--
-- Allowed enum values:
--   counterparty_type:
--     operativo (default — cliente real o proveedor real)
--     intercompania (Mizrahi/Quimibond family + is_internal)
--     financiera (banco/factoring/leasing/sofom — cash flow != producto)
--     gobierno_fiscal (SAT/IMSS/INFONAVIT — recurrente obligatorio)
--     utility (Telmex/CFE/Gas Natural — recurrente operativo)
--     one_off (transacción única histórica >$1M >12m)
--     blacklisted (SAT 69-B definitivo o presunto)
--   customer_lifecycle (solo aplica si is_customer):
--     active (default — facturó <90d)
--     at_risk (AR vencido >60d o credit score bajo)
--     dormant (90-180d sin actividad)
--     lost (>180d sin actividad o flag manual)
--     prospect (sin facturas aún)

ALTER TABLE canonical_companies
  ADD COLUMN IF NOT EXISTS counterparty_type_auto text NOT NULL DEFAULT 'operativo'
    CHECK (counterparty_type_auto IN (
      'operativo','intercompania','financiera','gobierno_fiscal','utility','one_off','blacklisted'
    ));

ALTER TABLE canonical_companies
  ADD COLUMN IF NOT EXISTS counterparty_type_manual text
    CHECK (counterparty_type_manual IS NULL OR counterparty_type_manual IN (
      'operativo','intercompania','financiera','gobierno_fiscal','utility','one_off','blacklisted'
    ));

ALTER TABLE canonical_companies
  ADD COLUMN IF NOT EXISTS counterparty_type text
    GENERATED ALWAYS AS (COALESCE(counterparty_type_manual, counterparty_type_auto)) STORED;

ALTER TABLE canonical_companies
  ADD COLUMN IF NOT EXISTS customer_lifecycle_auto text NOT NULL DEFAULT 'active'
    CHECK (customer_lifecycle_auto IN (
      'active','at_risk','dormant','lost','prospect'
    ));

ALTER TABLE canonical_companies
  ADD COLUMN IF NOT EXISTS customer_lifecycle_manual text
    CHECK (customer_lifecycle_manual IS NULL OR customer_lifecycle_manual IN (
      'active','at_risk','dormant','lost','prospect'
    ));

ALTER TABLE canonical_companies
  ADD COLUMN IF NOT EXISTS customer_lifecycle text
    GENERATED ALWAYS AS (COALESCE(customer_lifecycle_manual, customer_lifecycle_auto)) STORED;

ALTER TABLE canonical_companies
  ADD COLUMN IF NOT EXISTS classification_audit jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_canonical_companies_counterparty_type
  ON canonical_companies(counterparty_type);

CREATE INDEX IF NOT EXISTS idx_canonical_companies_customer_lifecycle
  ON canonical_companies(customer_lifecycle);
