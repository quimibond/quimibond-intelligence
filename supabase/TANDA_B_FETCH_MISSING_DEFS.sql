-- ═══════════════════════════════════════════════════════════════
-- DISCOVERY SQL — Tanda B: defs faltantes
-- ═══════════════════════════════════════════════════════════════
-- Este NO es una migración. Ejecútalo en Supabase SQL Editor
-- (o vía tu RPC temporal) y pégame el output. Con esto construyo
-- las 4 migraciones restantes (H10, H15a, H17, M3, C3-full).
--
-- Necesito el body actual de cada objeto porque no está en git
-- (creados vía execute_safe_ddl u otro camino no-migracional).
-- ═══════════════════════════════════════════════════════════════

\echo '════════════════════════════════════════════'
\echo 'C3 — get_dashboard_kpis() RPC body'
\echo '════════════════════════════════════════════'
SELECT pg_get_functiondef(oid)
FROM pg_proc
WHERE proname = 'get_dashboard_kpis'
LIMIT 1;

\echo '════════════════════════════════════════════'
\echo 'H10 — cash_flow_aging view def'
\echo '════════════════════════════════════════════'
SELECT pg_get_viewdef('public.cash_flow_aging'::regclass, true);

\echo '════════════════════════════════════════════'
\echo 'H10 — ar_aging_detail matview def (dependency)'
\echo '════════════════════════════════════════════'
SELECT pg_get_viewdef('public.ar_aging_detail'::regclass, true);

\echo '════════════════════════════════════════════'
\echo 'H15a — monthly_revenue_by_company def'
\echo '════════════════════════════════════════════'
SELECT pg_get_viewdef('public.monthly_revenue_by_company'::regclass, true);

\echo '════════════════════════════════════════════'
\echo 'H17 — ops_delivery_health_weekly matview def'
\echo '════════════════════════════════════════════'
SELECT pg_get_viewdef('public.ops_delivery_health_weekly'::regclass, true);

\echo '════════════════════════════════════════════'
\echo 'M3 — payment_predictions matview def'
\echo '════════════════════════════════════════════'
SELECT pg_get_viewdef('public.payment_predictions'::regclass, true);

-- ─── Bonus: columnas y counts para sanity-check ──────────────
\echo '════════════════════════════════════════════'
\echo 'Sanity checks'
\echo '════════════════════════════════════════════'

SELECT 'cash_flow_aging' AS relname, COUNT(*) AS row_count FROM cash_flow_aging
UNION ALL SELECT 'monthly_revenue_by_company', COUNT(*) FROM monthly_revenue_by_company
UNION ALL SELECT 'ops_delivery_health_weekly', COUNT(*) FROM ops_delivery_health_weekly
UNION ALL SELECT 'payment_predictions', COUNT(*) FROM payment_predictions;

-- Columnas de cada tabla/view para validar shape
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN (
    'cash_flow_aging',
    'monthly_revenue_by_company',
    'ops_delivery_health_weekly',
    'payment_predictions'
  )
ORDER BY table_name, ordinal_position;
