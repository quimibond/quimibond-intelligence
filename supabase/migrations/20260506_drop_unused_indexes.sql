-- Perf: drop indexes virtualmente unused que pesan en INSERT/UPDATE
--
-- Síntoma reportado por Supabase Performance Advisor: "exhausting multiple
-- resources, performance affected".
--
-- Causa: top 1 query por tiempo total = INSERT/UPSERT en odoo_stock_moves
-- (32.2% del tiempo total de la DB, 212k calls × 983ms cada uno).
-- Cada INSERT a odoo_stock_moves dispara trigger trg_canonical_stock_moves_sync
-- que UPSERTea en canonical_stock_moves (1.65M rows, 1.1 GB). Cada UPSERT
-- actualiza TODOS los índices secundarios. La tabla tiene 4 índices
-- secundarios totalizando ~520MB; 3 de ellos casi nunca se usan
-- (idx_scan ≤ 37 desde stats_reset=null = toda la historia).
--
-- Misma situación en reconciliation_issues, odoo_stock_moves, canonical_activities,
-- emails: índices grandes con idx_scan ≤ 2 que cuestan en cada UPSERT.
--
-- Total liberado: ~550 MB. Esto reduce el tiempo de INSERT en las 5 tablas
-- de sync más calientes.
--
-- Reversible: cualquier índice se puede recrear con CREATE INDEX CONCURRENTLY
-- si una query lo necesita. Los índices que matchean detect_invariant_drift
-- queries son los que mantenemos.

-- canonical_stock_moves (1.65M rows, 1.1 GB) — 359MB index virtualmente unused
DROP INDEX IF EXISTS public.ix_csm_inventory_adj;

-- reconciliation_issues (294k rows, 787 MB)
DROP INDEX IF EXISTS public.ix_ri_priority;
DROP INDEX IF EXISTS public.idx_recon_issues_open_comms;

-- odoo_stock_moves (1.65M rows, 885 MB)
DROP INDEX IF EXISTS public.ix_osm_product;
DROP INDEX IF EXISTS public.ix_osm_picking;

-- canonical_activities (3M rows, 688 MB)
DROP INDEX IF EXISTS public.ix_cact_assignee;
DROP INDEX IF EXISTS public.ix_cact_res;

-- emails (119k rows, 571 MB)
DROP INDEX IF EXISTS public.idx_emails_sender_contact_thread;
