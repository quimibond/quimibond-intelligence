-- Fix get_dashboard_cash_kpi: previously had runway_days hardcoded to 0.
-- Now computes runway from same logic as getRunwayKpis() helper:
--   burn_monthly = avg(total_expense, positive) over last 3 closed months
--   burn_daily   = burn_monthly / 30
--   cash_only    = cash_mxn / burn_daily
--   with_ar      = (cash_mxn + ar_open_mxn) / burn_daily
--
-- Closed months only — current month excluded because partial expense skews
-- average down. Source: gold_pl_statement (canonical P&L) + gold_cashflow.
--
-- Applied via supabase MCP apply_migration on 2026-04-30 by Claude.
-- Post-fix verification (2026-04-30): cash_mxn $1.25M, burn $13.5M/mo,
-- runway_days_cash_only=3, runway_days(with AR)=66.
CREATE OR REPLACE FUNCTION public.get_dashboard_cash_kpi()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_cash_mxn numeric;
  v_cash_usd numeric;
  v_total_mxn numeric;
  v_ar_open numeric;
  v_burn_window_from text;
  v_burn_window_to text;
  v_burn_monthly numeric;
  v_burn_daily numeric;
  v_runway_with_ar numeric;
  v_runway_cash_only numeric;
BEGIN
  SELECT
    COALESCE(sum(current_balance_mxn) FILTER (WHERE classification = 'cash' AND upper(coalesce(currency,'MXN'))='MXN'), 0),
    COALESCE(sum(current_balance)     FILTER (WHERE classification = 'cash' AND upper(coalesce(currency,''))='USD'), 0),
    COALESCE(sum(current_balance_mxn) FILTER (WHERE classification = 'cash'), 0)
  INTO v_cash_mxn, v_cash_usd, v_total_mxn
  FROM canonical_bank_balances;

  SELECT COALESCE(total_receivable_mxn, 0) INTO v_ar_open FROM gold_cashflow LIMIT 1;
  v_ar_open := COALESCE(v_ar_open, 0);

  v_burn_window_from := to_char(date_trunc('month', current_date) - interval '3 months', 'YYYY-MM');
  v_burn_window_to   := to_char(date_trunc('month', current_date) - interval '1 month',  'YYYY-MM');

  SELECT COALESCE(AVG(GREATEST(total_expense, 0)), 0)
  INTO v_burn_monthly
  FROM gold_pl_statement
  WHERE period >= v_burn_window_from
    AND period <= v_burn_window_to;

  v_burn_daily := v_burn_monthly / 30.0;

  IF v_burn_daily > 0 THEN
    v_runway_cash_only := v_cash_mxn / v_burn_daily;
    v_runway_with_ar   := (v_cash_mxn + v_ar_open) / v_burn_daily;
  ELSE
    v_runway_cash_only := NULL;
    v_runway_with_ar   := NULL;
  END IF;

  RETURN jsonb_build_object(
    'cash_mxn',              v_cash_mxn,
    'cash_usd',              v_cash_usd,
    'total_mxn',             v_total_mxn,
    'ar_open_mxn',           v_ar_open,
    'burn_rate_monthly',     round(v_burn_monthly),
    'burn_rate_daily',       round(v_burn_daily),
    'burn_window_from',      v_burn_window_from,
    'burn_window_to',        v_burn_window_to,
    'runway_days_cash_only', CASE WHEN v_runway_cash_only IS NULL THEN NULL ELSE round(v_runway_cash_only)::int END,
    'runway_days',           CASE WHEN v_runway_with_ar   IS NULL THEN NULL ELSE round(v_runway_with_ar)::int END
  );
END;
$function$;
