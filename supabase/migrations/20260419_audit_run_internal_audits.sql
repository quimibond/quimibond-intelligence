-- 20260419_audit_run_internal_audits.sql
-- PL/pgSQL orchestrator for SQL-side internal audit invariants (Fase 1).
-- Spec: docs/superpowers/specs/2026-04-19-sync-audit-design.md
-- Plan: docs/superpowers/plans/2026-04-19-sync-audit-implementation.md Task 2.5 Step 1

-- ============================================================
-- Helper: register one invariant result row in audit_runs
-- ============================================================
CREATE OR REPLACE FUNCTION _audit_register_invariant(
  p_run_id    uuid,
  p_date_from date,
  p_date_to   date,
  p_key       text,
  p_model     text,
  p_count     bigint,
  p_severity  text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_sev text;
  v_tol RECORD;
BEGIN
  SELECT abs_tolerance, pct_tolerance INTO v_tol
    FROM audit_tolerances WHERE invariant_key = p_key;
  IF p_severity IS NOT NULL THEN
    v_sev := p_severity;
  ELSIF p_count = 0 THEN
    v_sev := 'ok';
  ELSIF p_count <= COALESCE(v_tol.abs_tolerance, 0.01) * 10 THEN
    v_sev := 'warn';
  ELSE
    v_sev := 'error';
  END IF;
  INSERT INTO audit_runs (run_id, source, model, invariant_key,
                          bucket_key, odoo_value, supabase_value, diff,
                          severity, date_from, date_to, details)
  VALUES (p_run_id, 'supabase', p_model, p_key, NULL, NULL, p_count, p_count,
          v_sev, p_date_from, p_date_to,
          jsonb_build_object('violations', p_count))
  ON CONFLICT (run_id, source, model, invariant_key, COALESCE(bucket_key, ''))
  DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION _audit_register_invariant(uuid, date, date, text, text, bigint, text)
  TO service_role;

-- ============================================================
-- Orchestrator: run all 15 internal invariants and return summary
-- ============================================================
CREATE OR REPLACE FUNCTION run_internal_audits(
  p_date_from date,
  p_date_to   date,
  p_run_id    uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count   bigint;
  v_summary jsonb;
BEGIN
  -- Invariant A: reversal_sign
  SELECT COUNT(*) INTO v_count FROM v_audit_invoice_lines_reversal_sign;
  PERFORM _audit_register_invariant(p_run_id, p_date_from, p_date_to,
    'invoice_lines.reversal_sign', 'invoice_lines', v_count);

  -- Invariant B: price_recompute
  SELECT COUNT(*) INTO v_count FROM v_audit_invoice_lines_price_recompute;
  PERFORM _audit_register_invariant(p_run_id, p_date_from, p_date_to,
    'invoice_lines.price_recompute', 'invoice_lines', v_count);

  -- Invariant C: fx_present
  SELECT COUNT(*) INTO v_count FROM v_audit_invoice_lines_fx_present;
  PERFORM _audit_register_invariant(p_run_id, p_date_from, p_date_to,
    'invoice_lines.fx_present', 'invoice_lines', v_count);

  -- Invariant D: fx_sanity
  SELECT COUNT(*) INTO v_count FROM v_audit_invoice_lines_fx_sanity;
  PERFORM _audit_register_invariant(p_run_id, p_date_from, p_date_to,
    'invoice_lines.fx_sanity', 'invoice_lines', v_count);

  -- Invariant E: orphan_product
  SELECT COUNT(*) INTO v_count FROM v_audit_order_lines_orphan_product;
  PERFORM _audit_register_invariant(p_run_id, p_date_from, p_date_to,
    'order_lines.orphan_product', 'order_lines', v_count);

  -- Invariant F (sale): orphan_order_sale
  SELECT COUNT(*) INTO v_count FROM v_audit_order_lines_orphan_sale;
  PERFORM _audit_register_invariant(p_run_id, p_date_from, p_date_to,
    'order_lines.orphan_order_sale', 'order_lines', v_count);

  -- Invariant F (purchase): orphan_order_purchase
  SELECT COUNT(*) INTO v_count FROM v_audit_order_lines_orphan_purchase;
  PERFORM _audit_register_invariant(p_run_id, p_date_from, p_date_to,
    'order_lines.orphan_order_purchase', 'order_lines', v_count);

  -- Invariant G: null_standard_price_active (forced warn)
  SELECT COUNT(*) INTO v_count FROM v_audit_products_null_standard_price;
  PERFORM _audit_register_invariant(p_run_id, p_date_from, p_date_to,
    'products.null_standard_price_active', 'products', v_count, 'warn');

  -- Invariant H: null_uom
  SELECT COUNT(*) INTO v_count FROM v_audit_products_null_uom;
  PERFORM _audit_register_invariant(p_run_id, p_date_from, p_date_to,
    'products.null_uom', 'products', v_count);

  -- Invariant I: duplicate_default_code
  SELECT COUNT(*) INTO v_count FROM v_audit_products_duplicate_default_code;
  PERFORM _audit_register_invariant(p_run_id, p_date_from, p_date_to,
    'products.duplicate_default_code', 'products', v_count);

  -- Invariant J: trial_balance_zero_per_period
  SELECT COUNT(*) INTO v_count FROM v_audit_account_balances_trial_balance;
  PERFORM _audit_register_invariant(p_run_id, p_date_from, p_date_to,
    'account_balances.trial_balance_zero_per_period',
    'account_balances', v_count);

  -- Invariant K: orphan_account
  SELECT COUNT(*) INTO v_count FROM v_audit_account_balances_orphan_account;
  PERFORM _audit_register_invariant(p_run_id, p_date_from, p_date_to,
    'account_balances.orphan_account', 'account_balances', v_count);

  -- Invariant L: company_leak_invoice_lines
  SELECT COUNT(*) INTO v_count FROM v_audit_company_leak_invoice_lines;
  PERFORM _audit_register_invariant(p_run_id, p_date_from, p_date_to,
    'invoice_lines.company_leak', 'invoice_lines', v_count);

  -- Invariant M: company_leak_order_lines
  SELECT COUNT(*) INTO v_count FROM v_audit_company_leak_order_lines;
  PERFORM _audit_register_invariant(p_run_id, p_date_from, p_date_to,
    'order_lines.company_leak', 'order_lines', v_count);

  -- Invariant N: deliveries_orphan_partner
  SELECT COUNT(*) INTO v_count FROM v_audit_deliveries_orphan_partner;
  PERFORM _audit_register_invariant(p_run_id, p_date_from, p_date_to,
    'deliveries.orphan_partner', 'deliveries', v_count);

  -- Invariant O: deliveries_done_without_date
  SELECT COUNT(*) INTO v_count FROM v_audit_deliveries_done_without_date;
  PERFORM _audit_register_invariant(p_run_id, p_date_from, p_date_to,
    'deliveries.done_without_date', 'deliveries', v_count);

  -- Build summary of all rows written in this run_id from supabase source
  SELECT jsonb_build_object(
    'ok',    COUNT(*) FILTER (WHERE severity = 'ok'),
    'warn',  COUNT(*) FILTER (WHERE severity = 'warn'),
    'error', COUNT(*) FILTER (WHERE severity = 'error')
  ) INTO v_summary
  FROM audit_runs
  WHERE run_id = p_run_id AND source = 'supabase';

  RETURN v_summary;
END;
$$;

GRANT EXECUTE ON FUNCTION run_internal_audits(date, date, uuid) TO service_role;

COMMENT ON FUNCTION run_internal_audits IS
  'Ejecuta 15 invariantes SQL internos (A-O) y escribe filas a audit_runs con run_id provisto. '
  'Spec: docs/superpowers/specs/2026-04-19-sync-audit-design.md';
