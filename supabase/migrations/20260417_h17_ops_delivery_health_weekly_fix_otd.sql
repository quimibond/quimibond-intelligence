-- H17 — ops_delivery_health_weekly: OTD basado en fechas reales
-- Audit 2026-04-16. Aplicada en prod via MCP.
-- La matview usaba `is_late` como fuente de verdad, pero `is_late`
-- solo se setea en pickings non-done. Completed-late contaban como
-- on_time → OTD=100% constante.
-- Fix: on_time = (date_done <= scheduled_date).
-- Post-fix: OTD semanal real 38-82%, no 100%.

DROP MATERIALIZED VIEW IF EXISTS ops_delivery_health_weekly;

CREATE MATERIALIZED VIEW ops_delivery_health_weekly AS
WITH weeks AS (
  SELECT date_trunc('week'::text, date_done)::date AS week_start,
    count(*) AS total_completed,
    count(*) FILTER (
      WHERE scheduled_date IS NOT NULL
        AND date_done::date <= scheduled_date::date
    ) AS on_time,
    count(*) FILTER (
      WHERE scheduled_date IS NOT NULL
        AND date_done::date > scheduled_date::date
    ) AS late,
    count(*) FILTER (WHERE scheduled_date IS NULL) AS no_scheduled_date,
    avg(lead_time_days) FILTER (WHERE lead_time_days IS NOT NULL) AS avg_lead_days
  FROM odoo_deliveries
  WHERE state = 'done'::text
    AND date_done >= (CURRENT_DATE - '84 days'::interval)
  GROUP BY date_trunc('week'::text, date_done)::date
)
SELECT week_start,
  total_completed,
  on_time,
  late,
  CASE
    WHEN (on_time + late) > 0
      THEN round(100.0 * on_time::numeric / (on_time + late)::numeric, 1)
    ELSE NULL::numeric
  END AS otd_pct,
  round(avg_lead_days, 1) AS avg_lead_days,
  no_scheduled_date,
  now() AS computed_at
FROM weeks
ORDER BY week_start DESC;

CREATE UNIQUE INDEX idx_ops_delivery_health_weekly_pk ON ops_delivery_health_weekly (week_start);
