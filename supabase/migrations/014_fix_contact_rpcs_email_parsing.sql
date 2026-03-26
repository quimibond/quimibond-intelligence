-- Migration 014: Fix email parsing in contact RPCs + add extract_email() helper
-- get_contact_communications and get_contact_intelligence had the same
-- "Name <email>" bug as resolve_all_connections (fixes #10, #11).
-- Also fixes participant_emails matching in threads.
-- Applied via Supabase MCP on 2026-03-26.
--
-- New: extract_email(text) IMMUTABLE helper function for reuse across RPCs.
-- Test: get_contact_communications('info@quimibond.com') now returns 59 emails (was 0).

-- See full RPC sources in Supabase dashboard.
