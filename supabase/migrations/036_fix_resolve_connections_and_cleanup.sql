-- ============================================================================
-- Migration 036: Fix resolve_all_connections + cleanup
--
-- 1. Remove reference to deleted 'alerts' table
-- 2. Remove reference to deleted 'email_recipients' table
-- 3. Drop empty/deprecated tables: chat_memory, odoo_manufacturing
-- 4. Clean old insights and logs
-- ============================================================================

-- (Applied via Supabase MCP — see 036_fix_resolve_connections_and_cleanup
--  and 036b_fix_resolve_connections_recipients)

-- Results of resolve_all_connections() after fix:
-- emails_to_threads: 2821, emails_to_contacts: 961, emails_to_companies: 1790
-- threads_to_companies: 1242, threads_to_contacts: 2054
-- actions_to_contacts: 146, actions_to_companies: 18

-- Additional data fixes applied:
-- - Marked 10 stuck emails as kg_processed to stop $15/48h retry loop
-- - Cleaned meta-insights (system talking about itself)
-- - Expired stale 'seen' insights older than 3 days
-- - Deleted insights expired/dismissed >30 days old
-- - Deleted pipeline_logs >14 days old
