-- ═══════════════════════════════════════════════════════════════
-- Data Quality Invariants System
-- ═══════════════════════════════════════════════════════════════
-- Aplicada en prod via MCP: `dq_invariants_system`.
--
-- Contexto: durante la sesión 2026-04-16/17 la migración M3
-- (payment_predictions DROP CASCADE) rompió silenciosamente 3 views
-- dependientes (cashflow_ar_predicted, cashflow_so_backlog,
-- projected_cash_flow_weekly). El rompimiento no fue detectado hasta
-- que el usuario vio /finanzas sin proyección. Esta infra previene
-- esa clase de regresión:
--
-- 1. `dq_invariants()` — evalúa 14 invariantes del sistema
-- 2. `dq_current_issues` — view con solo los NOT ok
-- 3. `dq_cron_integrity_check()` — cron-callable, loguea a pipeline_logs
--
-- Invariantes monitoreados:
--   CRITICAL: cash consistency across 2 sources
--             AR consistency across 3 sources
--             AP consistency across 2 sources
--             runway_net >= runway_cash_only (matemático)
--   HIGH:     invoice_lines coverage >= 95%
--             4 RPCs clave devuelven NOT NULL
--             payment_predictions matches cash_flow_aging
--   WARNING:  companies con names numéricos
--             customer_margin_analysis sin leasing ficticio
--             orphan insights cobranza/ventas/proveedores
--             sync freshness (<6h)
--   INFO:     OTD realistic (<95%)
--
-- Uso:
--   SQL:  SELECT * FROM dq_invariants();
--         SELECT * FROM dq_current_issues;
--   Cron: SELECT dq_cron_integrity_check();  -- hourly o daily
--   UI:   surface dq_current_issues en /system
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION dq_invariants()
RETURNS TABLE(
  check_name text,
  severity text,
  ok boolean,
  value text,
  expected text,
  message text
)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_cash_dashboard numeric;
  v_cash_cfo numeric;
  v_ar_cfo numeric;
  v_ar_aging numeric;
  v_ar_wcc numeric;
  v_ap_cfo numeric;
  v_ap_wcc numeric;
  v_runway_net numeric;
  v_runway_cash_only numeric;
  v_lines_coverage numeric;
  v_lines_total bigint;
  v_invoices_total bigint;
  v_pp_divergence bigint;
  v_companies_numeric bigint;
  v_orphan_insights bigint;
  v_cma_extreme bigint;
  v_otd_avg numeric;
  v_sync_stale bigint;
BEGIN
  SELECT ((get_dashboard_kpis())->'cash'->>'total_mxn')::numeric INTO v_cash_dashboard;
  SELECT efectivo_total_mxn, cuentas_por_cobrar, cuentas_por_pagar INTO v_cash_cfo, v_ar_cfo, v_ap_cfo FROM cfo_dashboard LIMIT 1;
  SELECT SUM(total_receivable) INTO v_ar_aging FROM cash_flow_aging;
  SELECT ar_mxn, ap_mxn INTO v_ar_wcc, v_ap_wcc FROM working_capital_cycle LIMIT 1;
  SELECT runway_days_net, runway_days_cash_only INTO v_runway_net, v_runway_cash_only FROM financial_runway LIMIT 1;
  SELECT COUNT(*) INTO v_lines_total FROM odoo_invoice_lines;
  SELECT COUNT(*) INTO v_invoices_total FROM odoo_invoices WHERE move_type='out_invoice' AND state='posted';
  SELECT COUNT(DISTINCT move_name) * 100.0 / NULLIF(v_invoices_total, 0) INTO v_lines_coverage FROM odoo_invoice_lines WHERE move_type='out_invoice';
  SELECT COUNT(*) INTO v_pp_divergence FROM payment_predictions pp
    JOIN cash_flow_aging cfa USING (company_id)
    WHERE ABS(pp.total_pending - cfa.total_receivable) > 100;
  SELECT COUNT(*) INTO v_companies_numeric FROM companies WHERE name ~ '^[0-9]+$' OR LENGTH(TRIM(name)) < 3;
  SELECT COUNT(*) INTO v_orphan_insights FROM agent_insights WHERE state IN ('new','seen') AND company_id IS NULL AND contact_id IS NULL AND category IN ('cobranza','ventas','proveedores','entregas');
  SELECT COUNT(*) INTO v_cma_extreme FROM customer_margin_analysis WHERE margin_pct_12m > 95 AND revenue_12m > 100000;
  SELECT AVG(otd_pct) INTO v_otd_avg FROM (SELECT otd_pct FROM ops_delivery_health_weekly ORDER BY week_start DESC LIMIT 4) t;
  SELECT COUNT(*) INTO v_sync_stale FROM odoo_sync_freshness WHERE hours_ago > 6;

  check_name := 'cash_dashboard_matches_cfo'; severity := 'CRITICAL';
  value := v_cash_dashboard::text; expected := v_cash_cfo::text;
  ok := ABS(v_cash_dashboard - v_cash_cfo) < 1;
  message := CASE WHEN ok THEN 'dashboard.cash.total_mxn = cfo_dashboard.efectivo_total_mxn'
    ELSE 'Diff: ' || (v_cash_dashboard - v_cash_cfo)::text || ' MXN — RPC fuera de sync' END;
  RETURN NEXT;

  check_name := 'ar_total_sources_consistent'; severity := 'CRITICAL';
  value := v_ar_cfo::text; expected := v_ar_aging::text || ' / ' || v_ar_wcc::text;
  ok := ABS(v_ar_cfo - v_ar_aging) < 10 AND ABS(v_ar_cfo - v_ar_wcc) < 10;
  message := CASE WHEN ok THEN 'cfo = cash_flow_aging = working_capital_cycle'
    ELSE 'AR diverge entre fuentes' END;
  RETURN NEXT;

  check_name := 'ap_total_sources_consistent'; severity := 'CRITICAL';
  value := v_ap_cfo::text; expected := v_ap_wcc::text;
  ok := ABS(v_ap_cfo - v_ap_wcc) < 10;
  message := CASE WHEN ok THEN 'cfo.cuentas_por_pagar = working_capital_cycle.ap_mxn'
    ELSE 'AP diverge entre fuentes' END;
  RETURN NEXT;

  check_name := 'runway_net_gte_cash_only'; severity := 'CRITICAL';
  value := v_runway_net::text; expected := '>= ' || v_runway_cash_only::text;
  ok := v_runway_net >= v_runway_cash_only;
  message := CASE WHEN ok THEN 'runway_days_net >= runway_days_cash_only'
    ELSE 'Invariante violado' END;
  RETURN NEXT;

  check_name := 'invoice_lines_coverage'; severity := 'HIGH';
  value := ROUND(v_lines_coverage, 1)::text || '%'; expected := '>= 95%';
  ok := v_lines_coverage >= 95;
  message := CASE WHEN ok THEN 'H11 stable: ' || v_lines_total::text || ' lines, ' || v_invoices_total::text || ' invoices'
    ELSE 'Coverage cayó — qb19 sync check' END;
  RETURN NEXT;

  check_name := 'get_dashboard_kpis_returns_valid'; severity := 'HIGH';
  value := CASE WHEN get_dashboard_kpis() IS NOT NULL THEN 'NOT NULL' ELSE 'NULL' END;
  expected := 'NOT NULL'; ok := get_dashboard_kpis() IS NOT NULL;
  message := CASE WHEN ok THEN 'RPC responde' ELSE 'RPC NULL — chain de views rota' END;
  RETURN NEXT;

  check_name := 'get_projected_cash_flow_summary_returns_valid'; severity := 'HIGH';
  value := CASE WHEN get_projected_cash_flow_summary() IS NOT NULL THEN 'NOT NULL' ELSE 'NULL' END;
  expected := 'NOT NULL'; ok := get_projected_cash_flow_summary() IS NOT NULL;
  message := CASE WHEN ok THEN 'RPC responde' ELSE 'Proyección 13s rota' END;
  RETURN NEXT;

  check_name := 'get_cashflow_recommendations_returns_valid'; severity := 'HIGH';
  value := CASE WHEN get_cashflow_recommendations() IS NOT NULL THEN 'NOT NULL' ELSE 'NULL' END;
  expected := 'NOT NULL'; ok := get_cashflow_recommendations() IS NOT NULL;
  message := CASE WHEN ok THEN 'RPC responde' ELSE 'Recomendaciones rotas' END;
  RETURN NEXT;

  check_name := 'payment_predictions_matches_aging'; severity := 'HIGH';
  value := v_pp_divergence::text || ' companies divergent'; expected := '0-1';
  ok := v_pp_divergence <= 1;
  message := CASE WHEN ok THEN 'M3 filter OK' ELSE 'Divergencia' END;
  RETURN NEXT;

  check_name := 'companies_numeric_names'; severity := 'WARNING';
  value := v_companies_numeric::text; expected := '0';
  ok := v_companies_numeric = 0;
  message := CASE WHEN ok THEN 'Sin basura'
    ELSE v_companies_numeric::text || ' companies con name numérico — UI backstop funciona' END;
  RETURN NEXT;

  check_name := 'cma_extreme_margins'; severity := 'WARNING';
  value := v_cma_extreme::text; expected := '0'; ok := v_cma_extreme = 0;
  message := CASE WHEN ok THEN 'customer_margin_analysis sin leasing'
    ELSE v_cma_extreme::text || ' companies >95% margin — posible asset/leasing' END;
  RETURN NEXT;

  check_name := 'orphan_business_insights'; severity := 'WARNING';
  value := v_orphan_insights::text; expected := '0'; ok := v_orphan_insights = 0;
  message := CASE WHEN ok THEN 'Business insights tienen FK'
    ELSE v_orphan_insights::text || ' insights sin FK — auto-fix' END;
  RETURN NEXT;

  check_name := 'sync_freshness'; severity := 'WARNING';
  value := v_sync_stale::text || ' tablas >6h'; expected := '0';
  ok := v_sync_stale = 0;
  message := CASE WHEN ok THEN 'Todas fresh'
    ELSE v_sync_stale::text || ' tablas stale — check Odoo.sh cron' END;
  RETURN NEXT;

  check_name := 'otd_realistic'; severity := 'INFO';
  value := COALESCE(ROUND(v_otd_avg, 1)::text || '%', 'no data');
  expected := '< 95% (realistic)';
  ok := v_otd_avg IS NULL OR v_otd_avg < 95;
  message := CASE WHEN v_otd_avg IS NULL THEN 'Sin deliveries'
    WHEN v_otd_avg < 95 THEN 'H17 fix funcionando'
    ELSE 'OTD sospechoso ≥95% — check scheduled_date' END;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION dq_invariants() IS
  'Evalúa 14 invariantes del sistema. Para /system UI, cron, SQL manual.';

CREATE OR REPLACE VIEW dq_current_issues AS
SELECT check_name, severity, value, expected, message
FROM dq_invariants()
WHERE NOT ok
ORDER BY
  CASE severity WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'WARNING' THEN 3 ELSE 4 END,
  check_name;

COMMENT ON VIEW dq_current_issues IS 'Solo invariantes NOT ok.';

CREATE OR REPLACE FUNCTION dq_cron_integrity_check()
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  issues_count int;
  critical_count int;
  high_count int;
  summary jsonb;
  issue record;
BEGIN
  SELECT COUNT(*) INTO issues_count FROM dq_current_issues;
  SELECT COUNT(*) INTO critical_count FROM dq_current_issues WHERE severity = 'CRITICAL';
  SELECT COUNT(*) INTO high_count FROM dq_current_issues WHERE severity = 'HIGH';

  FOR issue IN SELECT * FROM dq_current_issues LOOP
    INSERT INTO pipeline_logs (level, phase, message, details, created_at)
    VALUES (
      CASE issue.severity WHEN 'CRITICAL' THEN 'error' WHEN 'HIGH' THEN 'warn' ELSE 'info' END,
      'dq_integrity_check',
      issue.check_name || ': ' || issue.message,
      jsonb_build_object('severity', issue.severity, 'value', issue.value, 'expected', issue.expected, 'check_name', issue.check_name),
      NOW()
    );
  END LOOP;

  summary := jsonb_build_object('total_issues', issues_count, 'critical', critical_count, 'high', high_count, 'timestamp', NOW());
  INSERT INTO pipeline_logs (level, phase, message, details, created_at)
  VALUES (
    CASE WHEN critical_count > 0 THEN 'error' WHEN high_count > 0 THEN 'warn' ELSE 'info' END,
    'dq_integrity_check',
    'Integrity check: ' || issues_count::text || ' issues (' || critical_count::text || ' critical, ' || high_count::text || ' high)',
    summary, NOW()
  );

  RETURN summary;
END;
$$;

COMMENT ON FUNCTION dq_cron_integrity_check() IS 'Cron-callable integrity check. Loguea issues a pipeline_logs.';
