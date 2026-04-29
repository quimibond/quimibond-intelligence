-- 2026-04-28: Tighten inventory.accounting_without_move — extend journal exclusion list.
--
-- BACKGROUND
-- _sp11_run_extra block flags account.move entries with inventory or purchase
-- accounts that lack a matching stock.move. Existing exclusion list:
--   'CAPA DE VALORACIÓN', 'Depreciaciones y Amortizaciones', 'NOMINAS',
--   'IMPUESTOS', 'Cheques', 'Pago efectivo', 'REEMBOLSO', 'Tax',
--   'Operaciones varias'
--
-- ANALYSIS (2026-04-28)
-- 2,427 open issues by journal:
--   Valoración del inventario   1,776 (73%) → Manual valuation entries,
--                                              same nature as CAPA DE VALORACIÓN
--                                              (capitalized differently);
--                                              by design no stock.move.
--   GSTVAR                        264 (11%) → Expense accruals hitting
--                                              504.X accounts (costo ventas /
--                                              gastos variables) — NOT inventory
--                                              purchases; has_purchase_account
--                                              fires falsely.
--   Facturas de proveedores       351 (14%) → Real supplier invoices that
--                                              SHOULD match stock receipts.
--                                              Possibly real backlog or MV gap.
--   Facturas de cliente            46 ( 2%) → Customer invoices.
--   Efectivamente Pagado            1
--
-- DECISION
-- Same pattern: standalone helper with extended exclusion list + auto-resolve.
-- Adds 'Valoración del inventario' and 'GSTVAR' to exclusion list.
-- Real backlog (~398 issues) remains visible for reconciliation work.

CREATE OR REPLACE FUNCTION public._sp11_check_accounting_without_move()
RETURNS jsonb
LANGUAGE plpgsql
SET statement_timeout TO '5min'
AS $fn$
DECLARE
  v_inserted integer := 0;
  v_resolved integer := 0;
  v_exclude_journals text[] := ARRAY[
    -- Original SP11 list
    'CAPA DE VALORACIÓN', 'Depreciaciones y Amortizaciones', 'NOMINAS',
    'IMPUESTOS', 'Cheques', 'Pago efectivo', 'REEMBOLSO', 'Tax',
    'Operaciones varias',
    -- 2026-04-28 additions
    'Valoración del inventario',  -- variant casing of CAPA DE VALORACIÓN; manual valuation entries
    'GSTVAR'                      -- expense accruals (504.X accounts), not inventory
  ];
BEGIN
  WITH ins AS (
    INSERT INTO reconciliation_issues (
      issue_id, issue_type, canonical_entity_type, canonical_entity_id, canonical_id,
      impact_mxn, severity, detected_at, invariant_key, action_cta, description, metadata
    )
    SELECT gen_random_uuid(),
           'inventory.accounting_without_move',
           'account_entry',
           ae.odoo_move_id::text,
           ae.odoo_move_id::text,
           ABS(COALESCE(ae.amount_total, 0)),
           'medium', now(),
           'inventory.accounting_without_move',
           'review_accounting',
           format('account.move %s (%s %s) %s sin stock.move matcheable',
                  ae.odoo_move_id, COALESCE(ae.journal_name, '-'),
                  COALESCE(ae.move_type, '-'), ae.date::date),
           jsonb_build_object(
             'odoo_move_id', ae.odoo_move_id, 'name', ae.name,
             'journal_name', ae.journal_name, 'move_type', ae.move_type,
             'date', ae.date, 'amount_total', ae.amount_total,
             'inventory_account_codes', ae.inventory_account_codes,
             'purchase_account_codes',  ae.purchase_account_codes
           )
    FROM odoo_account_entries_stock ae
    WHERE (ae.has_inventory_account = true OR ae.has_purchase_account = true)
      AND ae.move_type IN ('in_invoice', 'out_invoice', 'entry')
      AND ae.date >= now() - interval '180 days'
      AND NOT (COALESCE(ae.journal_name,'') = ANY(v_exclude_journals))
      AND NOT EXISTS (SELECT 1 FROM mv_stock_move_account_matches m
                       WHERE m.account_move_id = ae.odoo_move_id)
      AND NOT EXISTS (
        SELECT 1 FROM reconciliation_issues ri
        WHERE ri.invariant_key='inventory.accounting_without_move'
          AND ri.canonical_id = ae.odoo_move_id::text
          AND ri.resolved_at IS NULL
      )
    RETURNING 1
  )
  SELECT count(*) INTO v_inserted FROM ins;

  WITH classify AS (
    SELECT ri.issue_id,
           CASE
             WHEN ae.odoo_move_id IS NULL                                          THEN 'auto_entry_deleted'
             WHEN COALESCE(ae.journal_name,'') = ANY(v_exclude_journals)           THEN 'auto_excluded_journal'
             WHEN ae.date < now() - interval '180 days'                            THEN 'auto_outside_180d_window'
             WHEN EXISTS (SELECT 1 FROM mv_stock_move_account_matches m
                           WHERE m.account_move_id = ae.odoo_move_id)              THEN 'auto_now_matched'
             WHEN ae.move_type NOT IN ('in_invoice', 'out_invoice', 'entry')       THEN 'auto_move_type_changed'
             WHEN NOT (ae.has_inventory_account OR ae.has_purchase_account)        THEN 'auto_account_codes_changed'
             ELSE NULL
           END AS resolution_class
    FROM reconciliation_issues ri
    LEFT JOIN odoo_account_entries_stock ae ON ae.odoo_move_id::text = ri.canonical_id
    WHERE ri.invariant_key = 'inventory.accounting_without_move'
      AND ri.resolved_at IS NULL
  ), upd AS (
    UPDATE reconciliation_issues ri
    SET resolved_at = now(),
        resolution  = c.resolution_class
    FROM classify c
    WHERE ri.issue_id = c.issue_id
      AND c.resolution_class IS NOT NULL
    RETURNING 1
  )
  SELECT count(*) INTO v_resolved FROM upd;

  RETURN jsonb_build_object('inserted', v_inserted, 'resolved', v_resolved);
END;
$fn$;

COMMENT ON FUNCTION public._sp11_check_accounting_without_move() IS
'inventory.accounting_without_move strict checker (2026-04-28). Replaces over-eager block in _sp11_run_extra by extending journal exclusion list with Valoración del inventario (1,776 issues, variant of CAPA DE VALORACIÓN) and GSTVAR (264 issues, expense accruals not inventory). Daily pg_cron 7:10 UTC.';

UPDATE audit_tolerances
SET enabled = false,
    auto_resolve = true,
    notes = COALESCE(notes,'') ||
            ' [2026-04-28: disabled in _sp11_run_extra (incomplete journal exclusion list). Replaced by _sp11_check_accounting_without_move() pg_cron 7:10 UTC with extended exclusion list including Valoración del inventario + GSTVAR.]'
WHERE invariant_key = 'inventory.accounting_without_move';

SELECT cron.schedule(
  'inventory_accounting_without_move_strict_daily',
  '10 7 * * *',
  'SELECT _sp11_check_accounting_without_move()'
);

-- One-time drain
SELECT _sp11_check_accounting_without_move() AS one_time_result;
