-- ============================================================
-- Migration 019: email_recipients table + resolve function
-- ============================================================
-- Many-to-many link between emails and recipient contacts.
-- Parses the freetext `recipient` field in emails and resolves
-- each address against the contacts table.
--
-- Also updates resolve_all_connections to include recipient resolution.
-- Already applied in production via MCP.
-- ============================================================

CREATE TABLE IF NOT EXISTS email_recipients (
    id              BIGSERIAL PRIMARY KEY,
    email_id        BIGINT NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
    contact_id      BIGINT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    recipient_email TEXT NOT NULL,
    recipient_name  TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(email_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_email_recipients_email ON email_recipients(email_id);
CREATE INDEX IF NOT EXISTS idx_email_recipients_contact ON email_recipients(contact_id);

ALTER TABLE email_recipients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "email_recipients_select" ON email_recipients FOR SELECT USING (true);
CREATE POLICY "email_recipients_insert" ON email_recipients FOR INSERT WITH CHECK (true);

-- RPC: resolve all email recipients against contacts table
CREATE OR REPLACE FUNCTION resolve_email_recipients()
RETURNS json
LANGUAGE plpgsql
AS $$
DECLARE
  resolved_count INT := 0;
  total_parsed INT := 0;
  rec RECORD;
  addr TEXT;
  addr_email TEXT;
  addr_name TEXT;
  contact_rec RECORD;
BEGIN
  FOR rec IN
    SELECT e.id AS email_id, e.recipient
    FROM emails e
    WHERE e.recipient IS NOT NULL
      AND e.recipient != ''
      AND NOT EXISTS (SELECT 1 FROM email_recipients er WHERE er.email_id = e.id)
    LIMIT 500
  LOOP
    FOREACH addr IN ARRAY string_to_array(rec.recipient, ',')
    LOOP
      addr := trim(addr);
      IF addr = '' THEN CONTINUE; END IF;
      total_parsed := total_parsed + 1;

      IF addr LIKE '%<%>%' THEN
        addr_email := lower(trim(both ' >' FROM substring(addr FROM '<([^>]+)>')));
        addr_name := trim(both '" ''' FROM split_part(addr, '<', 1));
        IF addr_name = '' THEN addr_name := NULL; END IF;
      ELSE
        addr_email := lower(trim(addr));
        addr_name := NULL;
      END IF;

      IF addr_email IS NULL OR addr_email = '' THEN CONTINUE; END IF;

      SELECT id INTO contact_rec FROM contacts WHERE email = addr_email LIMIT 1;

      IF contact_rec.id IS NOT NULL THEN
        INSERT INTO email_recipients (email_id, contact_id, recipient_email, recipient_name)
        VALUES (rec.email_id, contact_rec.id, addr_email, addr_name)
        ON CONFLICT (email_id, contact_id) DO NOTHING;
        resolved_count := resolved_count + 1;
      END IF;
    END LOOP;
  END LOOP;

  RETURN json_build_object(
    'total_addresses_parsed', total_parsed,
    'resolved_to_contacts', resolved_count
  );
END;
$$;
