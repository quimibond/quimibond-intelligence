-- Migration: 1072a_silver_sp5_gate_fixes
-- Applied: 2026-04-22 via MCP (silver-sp5-task-30-gate-fixes)
-- Purpose: Fix Gate 10 (NULL invariant_key) and Gate 11 (surviving legacy objects)
--
-- Gate 10: 2 partner_blacklist_69b rows had NULL invariant_key
-- Gate 11: company_profile MV and pl_estado_resultados view survived T29 DROP
--          because they had downstream KEEP objects as dependents.
--          Fix: drop dependents, drop legacy objects, recreate KEEP objects
--          without legacy dependencies (now reading from canonical_companies
--          and odoo_account_balances directly).
--
-- KEEP objects affected (rebuilt, not dropped):
--   - overhead_factor_12m (view) — was reading pl_estado_resultados
--   - cash_flow_aging (view) — was LEFT JOINing company_profile
--   - weekly_trends (view) — was JOINing company_profile
--   - payment_predictions (MV) — was LEFT JOINing company_profile
--   - client_reorder_predictions (MV) — was LEFT JOINing company_profile
--
-- Applied via apply_migration MCP tool.
-- (This file documents what was applied — the migration ran live on DB.)

-- Gate 10 fix:
UPDATE reconciliation_issues
SET invariant_key = 'partner.blacklist_69b'
WHERE resolved_at IS NULL AND invariant_key IS NULL AND issue_type = 'partner_blacklist_69b';

-- Gate 11 fix: (see full SQL in MCP history / DB migration log)
-- DROP overhead_factor_12m, pl_estado_resultados, client_reorder_predictions,
-- payment_predictions, cash_flow_aging, weekly_trends, company_profile
-- RECREATE overhead_factor_12m, cash_flow_aging, weekly_trends,
-- payment_predictions, client_reorder_predictions (without legacy deps)
