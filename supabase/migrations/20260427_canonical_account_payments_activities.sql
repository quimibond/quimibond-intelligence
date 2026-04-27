-- Silver: canonical_account_payments + canonical_activities
--
-- Cierra Issue #4 del audit Supabase+Frontend 2026-04-27.
-- Promueve odoo_account_payments (17,874 rows) y odoo_activities (5,751 rows)
-- a silver con FK canonical_company_id resuelto. Permite a frontend
-- reemplazar las lecturas SP5-EXCEPTION en briefing/orchestrate.
--
-- Notas:
-- - canonical_account_payments es complementario de canonical_payments
--   (ya existente, 42k rows que combina Odoo proxy desde account.move +
--   SAT complementos). canonical_account_payments expone JOURNAL_NAME y
--   PAYMENT_METHOD que canonical_payments no tiene (necesario para
--   briefing recent-payments). El link `canonical_payment_canonical_id`
--   está reservado pero no poblado: canonical_payments.odoo_payment_id
--   referencia odoo_payments (proxy account.move), no odoo_account_payments
--   (account.payment real). El cross-link requiere matcher heurístico
--   por amount+date+partner — out of scope.
-- - canonical_activities sustituye odoo_activities como source para
--   prompts del agente de operaciones. assigned_canonical_contact_id
--   resuelto por display_name lowercase match.
-- - canonical_users NO se crea: canonical_employees (VIEW pre-existente
--   sobre canonical_contacts + odoo_employees + odoo_users) ya cubre el
--   caso para empleados internos.
--
-- Aplicado a producción 2026-04-27 vía execute_safe_ddl. Migration es
-- idempotente y replay-friendly.

BEGIN;

-- ============================================================================
-- 1. canonical_account_payments
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.canonical_account_payments (
  odoo_payment_id           integer PRIMARY KEY,
  canonical_company_id      bigint REFERENCES public.canonical_companies(id),
  canonical_payment_canonical_id text,  -- FK soft a canonical_payments.canonical_id (no poblado, ver header)
  odoo_partner_id           integer,
  bronze_company_id         bigint,
  name                      text,
  payment_type              text,
  partner_type              text,
  amount                    numeric,
  amount_signed             numeric,
  currency                  text,
  date                      date,
  ref                       text,
  journal_name              text,
  payment_method            text,
  state                     text,
  is_matched                boolean,
  is_reconciled             boolean,
  reconciled_invoices_count integer,
  odoo_company_id           integer,
  synced_from_bronze_at     timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_cap_company
  ON public.canonical_account_payments (canonical_company_id) WHERE canonical_company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_cap_date
  ON public.canonical_account_payments (date DESC) WHERE date IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_cap_partner
  ON public.canonical_account_payments (odoo_partner_id);
CREATE INDEX IF NOT EXISTS ix_cap_state
  ON public.canonical_account_payments (state) WHERE state='posted';
CREATE INDEX IF NOT EXISTS ix_cap_canonical_payment_text
  ON public.canonical_account_payments (canonical_payment_canonical_id) WHERE canonical_payment_canonical_id IS NOT NULL;

INSERT INTO public.canonical_account_payments (
  odoo_payment_id, canonical_company_id, canonical_payment_canonical_id,
  odoo_partner_id, bronze_company_id,
  name, payment_type, partner_type, amount, amount_signed, currency, date, ref,
  journal_name, payment_method, state, is_matched, is_reconciled, reconciled_invoices_count,
  odoo_company_id
)
SELECT
  oap.odoo_payment_id,
  cc.id,
  cp.canonical_id,
  oap.odoo_partner_id, oap.company_id,
  oap.name, oap.payment_type, oap.partner_type, oap.amount, oap.amount_signed,
  oap.currency, oap.date, oap.ref,
  oap.journal_name, oap.payment_method, oap.state, oap.is_matched, oap.is_reconciled,
  oap.reconciled_invoices_count, oap.odoo_company_id
FROM public.odoo_account_payments oap
LEFT JOIN public.canonical_companies cc ON cc.odoo_partner_id = oap.odoo_partner_id
LEFT JOIN public.canonical_payments cp ON cp.odoo_payment_id = oap.odoo_payment_id
ON CONFLICT (odoo_payment_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.trg_canonical_account_payments_from_bronze()
RETURNS trigger LANGUAGE plpgsql AS $func$
BEGIN
  INSERT INTO public.canonical_account_payments (
    odoo_payment_id, canonical_company_id, odoo_partner_id, bronze_company_id,
    name, payment_type, partner_type, amount, amount_signed, currency, date, ref,
    journal_name, payment_method, state, is_matched, is_reconciled, reconciled_invoices_count,
    odoo_company_id, updated_at
  )
  VALUES (
    NEW.odoo_payment_id,
    (SELECT id FROM public.canonical_companies WHERE odoo_partner_id = NEW.odoo_partner_id LIMIT 1),
    NEW.odoo_partner_id, NEW.company_id,
    NEW.name, NEW.payment_type, NEW.partner_type, NEW.amount, NEW.amount_signed,
    NEW.currency, NEW.date, NEW.ref,
    NEW.journal_name, NEW.payment_method, NEW.state, NEW.is_matched, NEW.is_reconciled,
    NEW.reconciled_invoices_count, NEW.odoo_company_id, now()
  )
  ON CONFLICT (odoo_payment_id) DO UPDATE SET
    canonical_company_id = EXCLUDED.canonical_company_id,
    odoo_partner_id = EXCLUDED.odoo_partner_id, bronze_company_id = EXCLUDED.bronze_company_id,
    name = EXCLUDED.name, payment_type = EXCLUDED.payment_type, partner_type = EXCLUDED.partner_type,
    amount = EXCLUDED.amount, amount_signed = EXCLUDED.amount_signed,
    currency = EXCLUDED.currency, date = EXCLUDED.date, ref = EXCLUDED.ref,
    journal_name = EXCLUDED.journal_name, payment_method = EXCLUDED.payment_method,
    state = EXCLUDED.state, is_matched = EXCLUDED.is_matched, is_reconciled = EXCLUDED.is_reconciled,
    reconciled_invoices_count = EXCLUDED.reconciled_invoices_count,
    odoo_company_id = EXCLUDED.odoo_company_id, updated_at = now();
  RETURN NEW;
END;
$func$;

CREATE TRIGGER trg_canonical_account_payments_sync
  AFTER INSERT OR UPDATE ON public.odoo_account_payments
  FOR EACH ROW EXECUTE FUNCTION public.trg_canonical_account_payments_from_bronze();

-- ============================================================================
-- 2. canonical_activities
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.canonical_activities (
  bronze_id                       bigint PRIMARY KEY,
  canonical_company_id            bigint REFERENCES public.canonical_companies(id),
  assigned_canonical_contact_id   bigint REFERENCES public.canonical_contacts(id),
  bronze_company_id               bigint,
  odoo_partner_id                 integer,
  activity_type                   text,
  summary                         text,
  res_model                       text,
  res_id                          integer,
  date_deadline                   date,
  assigned_to                     text,
  is_overdue                      boolean,
  synced_from_bronze_at           timestamptz NOT NULL DEFAULT now(),
  updated_at                      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_cact_company
  ON public.canonical_activities (canonical_company_id) WHERE canonical_company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_cact_assignee
  ON public.canonical_activities (assigned_canonical_contact_id) WHERE assigned_canonical_contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_cact_overdue_deadline
  ON public.canonical_activities (is_overdue, date_deadline) WHERE is_overdue=true;
CREATE INDEX IF NOT EXISTS ix_cact_res
  ON public.canonical_activities (res_model, res_id);

INSERT INTO public.canonical_activities (
  bronze_id, canonical_company_id, assigned_canonical_contact_id,
  bronze_company_id, odoo_partner_id,
  activity_type, summary, res_model, res_id, date_deadline, assigned_to, is_overdue
)
SELECT
  oa.id,
  cc.id,
  ccon.id,
  oa.company_id, oa.odoo_partner_id,
  oa.activity_type, oa.summary, oa.res_model, oa.res_id,
  oa.date_deadline, oa.assigned_to, oa.is_overdue
FROM public.odoo_activities oa
LEFT JOIN public.canonical_companies cc ON cc.odoo_partner_id = oa.odoo_partner_id
LEFT JOIN public.canonical_contacts ccon ON LOWER(ccon.display_name) = LOWER(oa.assigned_to)
ON CONFLICT (bronze_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.trg_canonical_activities_from_bronze()
RETURNS trigger LANGUAGE plpgsql AS $func$
BEGIN
  INSERT INTO public.canonical_activities (
    bronze_id, canonical_company_id, assigned_canonical_contact_id,
    bronze_company_id, odoo_partner_id,
    activity_type, summary, res_model, res_id, date_deadline, assigned_to, is_overdue, updated_at
  )
  VALUES (
    NEW.id,
    (SELECT id FROM public.canonical_companies WHERE odoo_partner_id = NEW.odoo_partner_id LIMIT 1),
    (SELECT id FROM public.canonical_contacts WHERE LOWER(display_name) = LOWER(NEW.assigned_to) LIMIT 1),
    NEW.company_id, NEW.odoo_partner_id,
    NEW.activity_type, NEW.summary, NEW.res_model, NEW.res_id,
    NEW.date_deadline, NEW.assigned_to, NEW.is_overdue, now()
  )
  ON CONFLICT (bronze_id) DO UPDATE SET
    canonical_company_id = EXCLUDED.canonical_company_id,
    assigned_canonical_contact_id = EXCLUDED.assigned_canonical_contact_id,
    bronze_company_id = EXCLUDED.bronze_company_id, odoo_partner_id = EXCLUDED.odoo_partner_id,
    activity_type = EXCLUDED.activity_type, summary = EXCLUDED.summary,
    res_model = EXCLUDED.res_model, res_id = EXCLUDED.res_id,
    date_deadline = EXCLUDED.date_deadline, assigned_to = EXCLUDED.assigned_to,
    is_overdue = EXCLUDED.is_overdue, updated_at = now();
  RETURN NEW;
END;
$func$;

CREATE TRIGGER trg_canonical_activities_sync
  AFTER INSERT OR UPDATE ON public.odoo_activities
  FOR EACH ROW EXECUTE FUNCTION public.trg_canonical_activities_from_bronze();

-- ============================================================================
-- 3. Audit trail
-- ============================================================================
INSERT INTO public.schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES
  ('create_table', 'canonical_account_payments',
    'Silver: 17,874 rows promovidos. FK canonical_companies. Expone journal_name + payment_method para briefing/chat.',
    '20260427_canonical_account_payments_activities.sql', 'audit-supabase-frontend', true),
  ('create_table', 'canonical_activities',
    'Silver: 5,751 rows promovidos. FK canonical_companies + canonical_contacts (assignee). Sustituye odoo_activities en orchestrate prompts.',
    '20260427_canonical_account_payments_activities.sql', 'audit-supabase-frontend', true);

COMMIT;
