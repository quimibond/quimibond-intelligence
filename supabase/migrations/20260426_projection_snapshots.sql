-- F-SNAPSHOTS: tabla para capturar predicciones del cash projection y
-- compararlas con la realidad cuando la semana objetivo ya transcurrió.
-- Cierra el loop de auto-aprendizaje: tenemos capacity de medir si el
-- modelo está mejorando o degradándose con el tiempo.
--
-- Cada captura snapshotea las próximas 13 semanas (horizon 90d) con:
--   - predicted_inflow_mxn: cobranza esperada en esa semana
--   - predicted_outflow_mxn: pagos esperados en esa semana
--   - predicted_net_mxn: neto
--   - category_breakdown: jsonb con desglose por categoría (AR, AP,
--     run rate, recurrentes, etc.) para análisis posterior
--
-- Refresh: 1× al día via Vercel cron + UPSERT idempotente para que
-- re-capturas en mismo día no dupliquen.
--
-- Comparación con actuals: canonical_payments en la semana objetivo
-- (direction=received → inflow real, direction=sent → outflow real).
-- MAPE = mean absolute % error. Drift = trend del MAPE en últimas N semanas.

CREATE TABLE IF NOT EXISTS public.projection_snapshots (
  id bigserial PRIMARY KEY,
  snapshot_date date NOT NULL,
  horizon_days int NOT NULL,
  week_start date NOT NULL,
  week_end date NOT NULL,
  predicted_inflow_mxn numeric NOT NULL,
  predicted_outflow_mxn numeric NOT NULL,
  predicted_net_mxn numeric NOT NULL,
  category_breakdown jsonb,
  computed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (snapshot_date, horizon_days, week_start)
);

CREATE INDEX IF NOT EXISTS idx_projection_snapshots_snapshot_date
  ON public.projection_snapshots(snapshot_date DESC);

CREATE INDEX IF NOT EXISTS idx_projection_snapshots_week_start
  ON public.projection_snapshots(week_start);
