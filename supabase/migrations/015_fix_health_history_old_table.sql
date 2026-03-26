-- Migration 015: Fix get_contact_health_history referencing old table name
-- Both overloads referenced 'customer_health_scores' (renamed to 'health_scores' in 006).
-- Calling these RPCs would fail with "relation does not exist".
-- Also added payment_compliance_score to output.
-- Applied via Supabase MCP on 2026-03-26.

-- See full RPC sources in Supabase dashboard.
