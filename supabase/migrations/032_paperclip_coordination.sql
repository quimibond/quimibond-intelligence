-- Migration 032: Paperclip-style agent coordination
-- Adds: agent tickets, event triggers, budget control

-- Agent tickets: cross-director communication
CREATE TABLE IF NOT EXISTS agent_tickets (
  id bigserial PRIMARY KEY,
  from_agent_id bigint REFERENCES ai_agents(id),
  to_agent_id bigint REFERENCES ai_agents(id),
  insight_id bigint REFERENCES agent_insights(id),
  ticket_type text CHECK (ticket_type IN ('delegate', 'enrich', 'verify', 'escalate')),
  message text,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'read', 'acted', 'dismissed')),
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tickets_to_agent ON agent_tickets(to_agent_id, status);
CREATE INDEX IF NOT EXISTS idx_tickets_insight ON agent_tickets(insight_id);
ALTER TABLE agent_tickets ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY anon_read_tickets ON agent_tickets FOR SELECT TO anon USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY anon_insert_tickets ON agent_tickets FOR INSERT TO anon WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Budget per agent
ALTER TABLE ai_agents ADD COLUMN IF NOT EXISTS monthly_budget_tokens int DEFAULT 500000;

-- Event trigger: invoice payment/CFDI changes
CREATE OR REPLACE FUNCTION on_invoice_paid()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.payment_state = 'paid' AND (OLD.payment_state IS NULL OR OLD.payment_state != 'paid')
     AND NEW.company_id IS NOT NULL THEN
    UPDATE agent_insights
    SET state = 'expired', user_feedback = 'Auto-resuelto: factura pagada (' || NEW.name || ')'
    WHERE company_id = NEW.company_id AND state IN ('new', 'seen') AND category = 'cobranza'
      AND title ILIKE '%' || (SELECT canonical_name FROM companies WHERE id = NEW.company_id LIMIT 1) || '%';
  END IF;
  IF NEW.cfdi_sat_state = 'cancelled' AND NEW.state = 'posted'
     AND (OLD.cfdi_sat_state IS NULL OR OLD.cfdi_sat_state != 'cancelled') THEN
    INSERT INTO agent_insights (agent_id, insight_type, category, severity, confidence, title, description,
      recommendation, company_id, state, evidence)
    SELECT (SELECT id FROM ai_agents WHERE slug = 'financiero' LIMIT 1),
      'anomaly', 'cobranza', 'critical', 1.0,
      format('CFDI CANCELADO: %s — $%s sigue activa', NEW.name, to_char(NEW.amount_total, 'FM999,999,999')),
      format('CFDI %s cancelado en SAT pero factura sigue publicada', NEW.cfdi_uuid),
      format('Cancelar factura %s en Odoo HOY', NEW.name),
      NEW.company_id, 'new',
      jsonb_build_array(jsonb_build_object('cfdi_uuid', NEW.cfdi_uuid, 'amount', NEW.amount_total));
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_invoice_events ON odoo_invoices;
CREATE TRIGGER trg_invoice_events AFTER UPDATE OF payment_state, cfdi_sat_state ON odoo_invoices
  FOR EACH ROW EXECUTE FUNCTION on_invoice_paid();

-- Event trigger: new email from company with critical insights
CREATE OR REPLACE FUNCTION on_new_email_for_critical_company()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_insight RECORD;
BEGIN
  IF NEW.company_id IS NULL OR NEW.sender_type != 'external' THEN RETURN NEW; END IF;
  FOR v_insight IN
    SELECT id, agent_id FROM agent_insights
    WHERE company_id = NEW.company_id AND state IN ('new', 'seen') AND severity IN ('critical', 'high')
    LIMIT 3
  LOOP
    INSERT INTO agent_tickets (from_agent_id, to_agent_id, insight_id, ticket_type, message)
    VALUES (
      (SELECT id FROM ai_agents WHERE slug = 'equipo' LIMIT 1),
      v_insight.agent_id, v_insight.id, 'enrich',
      format('Nuevo email de %s: "%s"', NEW.sender, NEW.subject)
    );
  END LOOP;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_email_critical_company ON emails;
CREATE TRIGGER trg_email_critical_company AFTER INSERT ON emails
  FOR EACH ROW EXECUTE FUNCTION on_new_email_for_critical_company();
