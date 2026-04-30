-- C3: Unify cash convention across the codebase.
--
-- Before this fix, get_dashboard_cash_kpi.cash_mxn returned only the MXN
-- bank balance ($1.25M), while gold_cashflow.current_cash_mxn returned the
-- TOTAL MXN-equivalent including USD reconverted ($2.20M). Different
-- numbers in different parts of the UI, both labeled "cash_mxn".
-- Resulting runway: RPC said 3d, helper said 5d.
--
-- New convention: cash_mxn = TOTAL MXN-equivalent (matches gold_cashflow).
-- For diagnostics we keep cash_mxn_native (MXN-only) and cash_usd as
-- separate fields. All consumers reading cash_mxn now get the same number.
--
-- Applied via supabase MCP apply_migration on 2026-04-30 by Claude.
CREATE OR REPLACE FUNCTION public.get_dashboard_cash_kpi()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_cash_mxn_native numeric;
  v_cash_usd_native numeric;
  v_cash_mxn_total numeric;
  v_ar_open numeric;
  v_burn_window_from text;
  v_burn_window_to text;
  v_burn_monthly numeric;
  v_burn_daily numeric;
  v_runway_with_ar numeric;
  v_runway_cash_only numeric;
BEGIN
  SELECT
    COALESCE(sum(current_balance)     FILTER (WHERE classification = 'cash' AND upper(coalesce(currency,'MXN'))='MXN'), 0),
    COALESCE(sum(current_balance)     FILTER (WHERE classification = 'cash' AND upper(coalesce(currency,''))='USD'), 0),
    COALESCE(sum(current_balance_mxn) FILTER (WHERE classification = 'cash'), 0)
  INTO v_cash_mxn_native, v_cash_usd_native, v_cash_mxn_total
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
    v_runway_cash_only := v_cash_mxn_total / v_burn_daily;
    v_runway_with_ar   := (v_cash_mxn_total + v_ar_open) / v_burn_daily;
  ELSE
    v_runway_cash_only := NULL;
    v_runway_with_ar   := NULL;
  END IF;

  RETURN jsonb_build_object(
    'cash_mxn',              v_cash_mxn_total,
    'cash_usd',              v_cash_usd_native,
    'total_mxn',             v_cash_mxn_total,
    'ar_open_mxn',           v_ar_open,
    'burn_rate_monthly',     round(v_burn_monthly),
    'burn_rate_daily',       round(v_burn_daily),
    'burn_window_from',      v_burn_window_from,
    'burn_window_to',        v_burn_window_to,
    'runway_days_cash_only', CASE WHEN v_runway_cash_only IS NULL THEN NULL ELSE round(v_runway_cash_only)::int END,
    'runway_days',           CASE WHEN v_runway_with_ar   IS NULL THEN NULL ELSE round(v_runway_with_ar)::int END,
    'cash_mxn_native',       v_cash_mxn_native
  );
END;
$function$;
