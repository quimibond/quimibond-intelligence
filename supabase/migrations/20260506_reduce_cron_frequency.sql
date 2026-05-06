-- Perf: bajar frecuencia de crons que fallan masivamente
--
-- Causa identificada (cron.job_run_details, ventana 24h):
--   silver_sp2_reconcile_hourly:        24/24 fallidos (100%, ~52s cada uno)
--   sp12_refresh_mfg_cost_mvs_hourly:   15/24 fallidos (62%, ~400s cada uno)
--   sp11_refresh_matching_mvs_hourly:   17/24 fallidos (71%, ~127s cada uno)
--   refresh-canonical-companies-aggregations: 23/48 fallidos (48%, ~62s cada uno)
--   silver_sp2_reconcile_2h:            7/12 fallidos (58%)
--   comms_invariants_hourly:            8/24 fallidos (33%)
--
-- Cada falla consume CPU + locks antes de que se cancele por
-- statement_timeout. Como vuelven a ejecutar al siguiente schedule,
-- entran en loop infinito de saturación de recursos.
--
-- Resultado del Performance Advisor de Supabase: "exhausting multiple
-- resources, performance affected".
--
-- Fix: bajar frecuencia para dar margen entre runs y reducir contención.
-- La frecuencia se puede subir luego cuando los queries lentos estén
-- optimizados (mv_mo_actual_material_cost, mv_entry_lines_flat,
-- run_reconciliation, etc).

-- silver_sp2_reconcile_hourly (jobid 7): 100% falla. Pausar — ya cubre
-- silver_sp2_reconcile_2h (cada 2h) y silver_sp4_reconcile_daily.
SELECT cron.alter_job(
  job_id => (SELECT jobid FROM cron.job WHERE jobname='silver_sp2_reconcile_hourly'),
  schedule => '5 */4 * * *'  -- cada 4h en HH:05
);

-- sp12_refresh_mfg_cost_mvs (jobid 16): de hourly a cada 6h. Las MVs son
-- mv_bom_standard_cost (368kB) y mv_mo_actual_material_cost (880kB).
-- Tardan ~400s en refrescar — no hay razón de hacerlo cada hora.
SELECT cron.alter_job(
  job_id => (SELECT jobid FROM cron.job WHERE jobname='sp12_refresh_mfg_cost_mvs_hourly'),
  schedule => '20 */6 * * *'  -- cada 6h en HH:20
);

-- sp11_refresh_matching_mvs (jobid 15): de hourly a cada 4h. Refresca
-- mv_entry_lines_flat (73MB) + mv_stock_move_account_matches (43MB).
SELECT cron.alter_job(
  job_id => (SELECT jobid FROM cron.job WHERE jobname='sp11_refresh_matching_mvs_hourly'),
  schedule => '10 */4 * * *'  -- cada 4h en HH:10
);

-- refresh-canonical-companies-aggregations (jobid 13): de cada 30min a
-- cada hora. La función refresh_canonical_company_financials (jobid 14)
-- ya corre cada hora y cubre lo mismo en gran parte.
SELECT cron.alter_job(
  job_id => (SELECT jobid FROM cron.job WHERE jobname='refresh-canonical-companies-aggregations'),
  schedule => '50 * * * *'  -- cada hora en HH:50
);

-- silver_sp2_reconcile_2h (jobid 8): de cada 2h a cada 4h.
SELECT cron.alter_job(
  job_id => (SELECT jobid FROM cron.job WHERE jobname='silver_sp2_reconcile_2h'),
  schedule => '15 */4 * * *'
);

-- comms_invariants_hourly (jobid 33): de hourly a cada 4h.
SELECT cron.alter_job(
  job_id => (SELECT jobid FROM cron.job WHERE jobname='comms_invariants_hourly'),
  schedule => '25 */4 * * *'
);
