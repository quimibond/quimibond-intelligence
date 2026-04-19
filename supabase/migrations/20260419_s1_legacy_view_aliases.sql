-- S1.2 · Legacy view canonical aliases (L4 analytics_* convention)
-- Non-destructive: originals preserved for frontend migration.
-- Sunset target for originals: 2026-06-01 (30 days post-deploy).

CREATE OR REPLACE VIEW analytics_cash_flow_aging AS
  SELECT * FROM cash_flow_aging;
COMMENT ON VIEW analytics_cash_flow_aging IS
  'L4 · Aging de cartera por empresa (current / 1-30 / 31-60 / 61-90 / 91-120 / 90+ / 120+). Source: cash_flow_aging (legacy view, sunset 2026-06-01).';

CREATE OR REPLACE VIEW analytics_budget_vs_actual AS
  SELECT * FROM budget_vs_actual;
COMMENT ON VIEW analytics_budget_vs_actual IS
  'L4 · Presupuesto vs real por cuenta contable y periodo (desviacion, desviacion_pct, status). Source: budget_vs_actual (legacy view, sunset 2026-06-01).';
