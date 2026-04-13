-- Fase 6 followup: synced_at/updated_at se quedaban stale porque el DEFAULT
-- NOW() de Postgres solo aplica en INSERT. Al hacer upsert con ON CONFLICT
-- sobre una fila existente, esas columnas no se tocaban. El bug es del addon
-- qb19 original (solo _push_activities setea synced_at explicito en el
-- payload). Fix universal: trigger BEFORE UPDATE que refresque synced_at /
-- updated_at en cada modificacion, asi el view odoo_sync_freshness y el
-- dashboard /system/sync reflejan la verdadera ultima sincronizacion.
--
-- Aplicado en vivo el 13-abr-2026 despues del deploy de qb19 1e47499. Este
-- archivo queda en el repo por history/rollback. No-op si ya se aplico.
--
-- Adicionalmente, se ejecuto un UPDATE no-op sobre odoo_invoices y
-- odoo_payments (SET synced_at = synced_at) para disparar los triggers y
-- calibrar sus timestamps one-shot. A partir de aqui, cada upsert del cron
-- refrescara synced_at automaticamente.

CREATE OR REPLACE FUNCTION touch_synced_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  NEW.synced_at := NOW();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

-- Tablas que usan synced_at
DROP TRIGGER IF EXISTS trg_touch_synced_at ON odoo_sale_orders;
CREATE TRIGGER trg_touch_synced_at BEFORE UPDATE ON odoo_sale_orders FOR EACH ROW EXECUTE FUNCTION touch_synced_at();

DROP TRIGGER IF EXISTS trg_touch_synced_at ON odoo_purchase_orders;
CREATE TRIGGER trg_touch_synced_at BEFORE UPDATE ON odoo_purchase_orders FOR EACH ROW EXECUTE FUNCTION touch_synced_at();

DROP TRIGGER IF EXISTS trg_touch_synced_at ON odoo_invoices;
CREATE TRIGGER trg_touch_synced_at BEFORE UPDATE ON odoo_invoices FOR EACH ROW EXECUTE FUNCTION touch_synced_at();

DROP TRIGGER IF EXISTS trg_touch_synced_at ON odoo_invoice_lines;
CREATE TRIGGER trg_touch_synced_at BEFORE UPDATE ON odoo_invoice_lines FOR EACH ROW EXECUTE FUNCTION touch_synced_at();

DROP TRIGGER IF EXISTS trg_touch_synced_at ON odoo_payments;
CREATE TRIGGER trg_touch_synced_at BEFORE UPDATE ON odoo_payments FOR EACH ROW EXECUTE FUNCTION touch_synced_at();

DROP TRIGGER IF EXISTS trg_touch_synced_at ON odoo_account_payments;
CREATE TRIGGER trg_touch_synced_at BEFORE UPDATE ON odoo_account_payments FOR EACH ROW EXECUTE FUNCTION touch_synced_at();

DROP TRIGGER IF EXISTS trg_touch_synced_at ON odoo_deliveries;
CREATE TRIGGER trg_touch_synced_at BEFORE UPDATE ON odoo_deliveries FOR EACH ROW EXECUTE FUNCTION touch_synced_at();

DROP TRIGGER IF EXISTS trg_touch_synced_at ON odoo_crm_leads;
CREATE TRIGGER trg_touch_synced_at BEFORE UPDATE ON odoo_crm_leads FOR EACH ROW EXECUTE FUNCTION touch_synced_at();

DROP TRIGGER IF EXISTS trg_touch_synced_at ON odoo_activities;
CREATE TRIGGER trg_touch_synced_at BEFORE UPDATE ON odoo_activities FOR EACH ROW EXECUTE FUNCTION touch_synced_at();

DROP TRIGGER IF EXISTS trg_touch_synced_at ON odoo_employees;
CREATE TRIGGER trg_touch_synced_at BEFORE UPDATE ON odoo_employees FOR EACH ROW EXECUTE FUNCTION touch_synced_at();

DROP TRIGGER IF EXISTS trg_touch_synced_at ON odoo_departments;
CREATE TRIGGER trg_touch_synced_at BEFORE UPDATE ON odoo_departments FOR EACH ROW EXECUTE FUNCTION touch_synced_at();

DROP TRIGGER IF EXISTS trg_touch_synced_at ON odoo_orderpoints;
CREATE TRIGGER trg_touch_synced_at BEFORE UPDATE ON odoo_orderpoints FOR EACH ROW EXECUTE FUNCTION touch_synced_at();

DROP TRIGGER IF EXISTS trg_touch_synced_at ON odoo_chart_of_accounts;
CREATE TRIGGER trg_touch_synced_at BEFORE UPDATE ON odoo_chart_of_accounts FOR EACH ROW EXECUTE FUNCTION touch_synced_at();

DROP TRIGGER IF EXISTS trg_touch_synced_at ON odoo_account_balances;
CREATE TRIGGER trg_touch_synced_at BEFORE UPDATE ON odoo_account_balances FOR EACH ROW EXECUTE FUNCTION touch_synced_at();

DROP TRIGGER IF EXISTS trg_touch_synced_at ON odoo_manufacturing;
CREATE TRIGGER trg_touch_synced_at BEFORE UPDATE ON odoo_manufacturing FOR EACH ROW EXECUTE FUNCTION touch_synced_at();

-- Tablas que usan updated_at en lugar de synced_at
DROP TRIGGER IF EXISTS trg_touch_updated_at ON odoo_products;
CREATE TRIGGER trg_touch_updated_at BEFORE UPDATE ON odoo_products FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS trg_touch_updated_at ON odoo_users;
CREATE TRIGGER trg_touch_updated_at BEFORE UPDATE ON odoo_users FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS trg_touch_updated_at ON odoo_bank_balances;
CREATE TRIGGER trg_touch_updated_at BEFORE UPDATE ON odoo_bank_balances FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
