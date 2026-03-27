-- ============================================================
-- Migration 020: Communication network (edges + RPC)
-- ============================================================
-- Materializes email sender→recipient pairs as a graph for
-- network visualization. Includes refresh function and query RPC.
-- Already applied in production via MCP.
-- ============================================================

CREATE TABLE IF NOT EXISTS communication_edges (
    id              BIGSERIAL PRIMARY KEY,
    from_contact_id BIGINT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    to_contact_id   BIGINT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    from_company_id BIGINT REFERENCES companies(id),
    to_company_id   BIGINT REFERENCES companies(id),
    email_count     INT NOT NULL DEFAULT 0,
    first_email_at  TIMESTAMPTZ,
    last_email_at   TIMESTAMPTZ,
    is_bidirectional BOOLEAN DEFAULT false,
    is_internal     BOOLEAN DEFAULT false,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(from_contact_id, to_contact_id)
);

CREATE INDEX IF NOT EXISTS idx_comm_edges_from ON communication_edges(from_contact_id);
CREATE INDEX IF NOT EXISTS idx_comm_edges_to ON communication_edges(to_contact_id);
CREATE INDEX IF NOT EXISTS idx_comm_edges_companies ON communication_edges(from_company_id, to_company_id);

ALTER TABLE communication_edges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "comm_edges_select" ON communication_edges FOR SELECT USING (true);

-- refresh_communication_edges(): rebuilds the entire edges table from emails + email_recipients
-- get_communication_network(): returns nodes + edges + stats for visualization
-- See migration SQL in source for full function definitions.
