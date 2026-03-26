-- Migration 016: Add assignee resolution for action items
-- Creates resolve_assignee_emails() RPC that matches action_items.assignee_name
-- to odoo_users.name and fills assignee_email using fuzzy matching.
-- Applied via Supabase MCP on 2026-03-26.

-- See full RPC source in Supabase dashboard.
