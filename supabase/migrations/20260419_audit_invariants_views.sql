-- 20260419_audit_invariants_views.sql
-- SQL views for sync-audit Fase 1:
--   5 auxiliary bucket views (used by Odoo-side cross-check methods)
--   + 15 internal invariant views (A-O, checked SQL-side by run_internal_audits).
-- Spec: docs/superpowers/specs/2026-04-19-sync-audit-design.md
-- Plan: docs/superpowers/plans/2026-04-19-sync-audit-implementation.md
--       Tasks 1.2 Step 4, 1.3 Step 4, 1.4 Step 3, 1.5 Step 3, 1.6 Step 3,
--       2.1 Step 1, 2.2 Step 1, 2.3, 2.4.

-- ============================================================
-- AUXILIARY BUCKET VIEWS (used by Odoo-side audit_* methods)
-- ============================================================

-- Bucket aggregator for invoice_lines (used by audit_invoice_lines from Odoo)
-- Task 1.2 Step 4
CREATE OR REPLACE VIEW v_audit_invoice_lines_buckets AS
SELECT
  to_char(i.invoice_date, 'YYYY-MM') || '|' || i.move_type || '|'
    || i.odoo_company_id::text AS bucket_key,
  i.invoice_date AS date_from,
  i.invoice_date AS date_to,
  i.move_type,
  i.odoo_company_id,
  COUNT(*) AS count,
  SUM(
    CASE WHEN i.move_type IN ('out_refund','in_refund') THEN -1 ELSE 1 END
    * COALESCE(il.price_subtotal_mxn, il.price_subtotal)
  ) AS sum_subtotal_mxn,
  SUM(
    CASE WHEN i.move_type IN ('out_refund','in_refund') THEN -1 ELSE 1 END
    * il.quantity
  ) AS sum_qty
FROM odoo_invoice_lines il
JOIN odoo_invoices i ON il.invoice_id = i.id
WHERE i.state = 'posted'
  AND i.invoice_date IS NOT NULL
GROUP BY to_char(i.invoice_date,'YYYY-MM'), i.invoice_date, i.move_type,
         i.odoo_company_id;

COMMENT ON VIEW v_audit_invoice_lines_buckets IS
  'Usado por quimibond.sync.audit.audit_invoice_lines';

-- Bucket aggregator for order_lines (used by audit_order_lines from Odoo)
-- Task 1.3 Step 4
CREATE OR REPLACE VIEW v_audit_order_lines_buckets AS
SELECT
  to_char(date_order::date, 'YYYY-MM') || '|' || order_type || '|'
    || odoo_company_id::text AS bucket_key,
  order_type,
  odoo_company_id,
  COUNT(*) AS count,
  SUM(COALESCE(price_subtotal_mxn, price_subtotal)) AS sum_subtotal_mxn,
  SUM(qty) AS sum_qty
FROM odoo_order_lines
WHERE date_order IS NOT NULL
GROUP BY to_char(date_order::date,'YYYY-MM'), order_type, odoo_company_id;

COMMENT ON VIEW v_audit_order_lines_buckets IS
  'Usado por quimibond.sync.audit.audit_order_lines';

-- Bucket aggregator for deliveries (used by audit_deliveries from Odoo)
-- Task 1.4 Step 3
CREATE OR REPLACE VIEW v_audit_deliveries_buckets AS
SELECT
  to_char(date_done::date, 'YYYY-MM') || '|' || state || '|'
    || odoo_company_id::text AS bucket_key,
  COUNT(*) AS count
FROM odoo_deliveries
WHERE date_done IS NOT NULL AND state IN ('done','cancel')
GROUP BY to_char(date_done::date,'YYYY-MM'), state, odoo_company_id;

COMMENT ON VIEW v_audit_deliveries_buckets IS
  'Usado por quimibond.sync.audit.audit_deliveries';

-- Bucket aggregator for manufacturing (used by audit_manufacturing from Odoo)
-- Task 1.5 Step 3
CREATE OR REPLACE VIEW v_audit_manufacturing_buckets AS
SELECT
  to_char(date_start::date, 'YYYY-MM') || '|' || state || '|'
    || odoo_company_id::text AS bucket_key,
  COUNT(*) AS count,
  SUM(qty_produced) AS sum_qty
FROM odoo_manufacturing
WHERE date_start IS NOT NULL
GROUP BY to_char(date_start::date,'YYYY-MM'), state, odoo_company_id;

COMMENT ON VIEW v_audit_manufacturing_buckets IS
  'Usado por quimibond.sync.audit.audit_manufacturing';

-- Bucket aggregator for account_balances (used by audit_account_balances from Odoo)
-- Task 1.6 Step 3
CREATE OR REPLACE VIEW v_audit_account_balances_buckets AS
WITH classified AS (
  SELECT
    ab.*,
    CASE
      WHEN coa.account_code LIKE '1150%'
        THEN 'account_balances.inventory_accounts_balance'
      WHEN coa.account_code LIKE '5%'
        THEN 'account_balances.cogs_accounts_balance'
      WHEN coa.account_code LIKE '4%'
        THEN 'account_balances.revenue_accounts_balance'
      ELSE NULL
    END AS invariant_key
  FROM odoo_account_balances ab
  JOIN odoo_chart_of_accounts coa
    ON coa.account_code = ab.account_code
   AND coa.odoo_company_id = ab.odoo_company_id
)
SELECT
  invariant_key,
  to_char(period_end::date, 'YYYY-MM') || '|' || odoo_company_id::text
    AS bucket_key,
  period_end::date AS period_end,
  odoo_company_id,
  SUM(balance) AS balance
FROM classified
WHERE invariant_key IS NOT NULL
GROUP BY invariant_key, to_char(period_end::date,'YYYY-MM'),
         period_end, odoo_company_id;

COMMENT ON VIEW v_audit_account_balances_buckets IS
  'Usado por quimibond.sync.audit.audit_account_balances';

-- ============================================================
-- INTERNAL INVARIANT VIEWS (A-O, checked by run_internal_audits)
-- ============================================================

-- A. reversal_sign: refunds with inconsistent sign
-- Task 2.1 Step 1
CREATE OR REPLACE VIEW v_audit_invoice_lines_reversal_sign AS
SELECT il.id AS line_id, il.invoice_id, i.move_type,
       il.quantity, il.price_subtotal
FROM odoo_invoice_lines il
JOIN odoo_invoices i ON il.invoice_id = i.id
WHERE i.move_type IN ('out_refund','in_refund')
  AND (
    (il.quantity > 0 AND il.price_subtotal > 0)  -- debería ser negativo
    OR SIGN(COALESCE(il.quantity,0)) <> SIGN(COALESCE(il.price_subtotal,0))
  );

COMMENT ON VIEW v_audit_invoice_lines_reversal_sign IS
  'Invariant A: refund lines with wrong sign. Spec: 2026-04-19-sync-audit-design.md';

-- B. price_recompute: broken price reconstruction
-- Task 2.1 Step 1
CREATE OR REPLACE VIEW v_audit_invoice_lines_price_recompute AS
SELECT il.id AS line_id, il.invoice_id,
       il.price_unit, il.quantity, il.discount, il.price_subtotal,
       ABS(il.price_unit * il.quantity * (1 - COALESCE(il.discount,0)/100.0)
           - il.price_subtotal) AS drift
FROM odoo_invoice_lines il
WHERE il.price_subtotal IS NOT NULL
  AND ABS(il.price_unit * il.quantity * (1 - COALESCE(il.discount,0)/100.0)
          - il.price_subtotal) > 0.01;

COMMENT ON VIEW v_audit_invoice_lines_price_recompute IS
  'Invariant B: invoice lines where price_unit * qty * (1-discount) != price_subtotal by >0.01.';

-- C. fx_present: non-MXN lines missing exchange rate or MXN amount
-- Task 2.1 Step 1
CREATE OR REPLACE VIEW v_audit_invoice_lines_fx_present AS
SELECT il.id AS line_id, il.invoice_id, il.currency_code,
       il.exchange_rate, il.price_subtotal_mxn
FROM odoo_invoice_lines il
WHERE il.currency_code IS NOT NULL
  AND il.currency_code <> 'MXN'
  AND (il.exchange_rate IS NULL OR il.exchange_rate <= 0
       OR il.price_subtotal_mxn IS NULL);

COMMENT ON VIEW v_audit_invoice_lines_fx_present IS
  'Invariant C: non-MXN invoice lines missing exchange_rate or price_subtotal_mxn.';

-- D. fx_sanity: price_subtotal * exchange_rate ≈ price_subtotal_mxn
-- Task 2.1 Step 1
CREATE OR REPLACE VIEW v_audit_invoice_lines_fx_sanity AS
SELECT il.id AS line_id, il.invoice_id, il.currency_code,
       il.price_subtotal, il.exchange_rate, il.price_subtotal_mxn,
       ABS(il.price_subtotal * il.exchange_rate - il.price_subtotal_mxn) AS drift
FROM odoo_invoice_lines il
WHERE il.currency_code IS NOT NULL
  AND il.currency_code <> 'MXN'
  AND il.exchange_rate IS NOT NULL AND il.exchange_rate > 0
  AND il.price_subtotal_mxn IS NOT NULL
  AND ABS(il.price_subtotal * il.exchange_rate - il.price_subtotal_mxn)
      > 0.01 * GREATEST(ABS(il.price_subtotal_mxn), 1);

COMMENT ON VIEW v_audit_invoice_lines_fx_sanity IS
  'Invariant D: FX conversion drift > 1% between price_subtotal*rate and price_subtotal_mxn.';

-- E. orphan_product: order lines referencing non-existent products
-- Task 2.2 Step 1
CREATE OR REPLACE VIEW v_audit_order_lines_orphan_product AS
SELECT ol.id AS line_id, ol.order_id, ol.order_type, ol.product_id
FROM odoo_order_lines ol
LEFT JOIN odoo_products p ON ol.product_id = p.id
WHERE ol.product_id IS NOT NULL AND p.id IS NULL;

COMMENT ON VIEW v_audit_order_lines_orphan_product IS
  'Invariant E: order lines with product_id not in odoo_products.';

-- F-sale. orphan_order (sale): sale order lines referencing non-existent sale orders
-- Task 2.2 Step 1
CREATE OR REPLACE VIEW v_audit_order_lines_orphan_sale AS
SELECT ol.id AS line_id, ol.order_id
FROM odoo_order_lines ol
LEFT JOIN odoo_sale_orders so ON ol.order_id = so.id
WHERE ol.order_type = 'sale' AND so.id IS NULL;

COMMENT ON VIEW v_audit_order_lines_orphan_sale IS
  'Invariant F (sale): sale order lines with order_id not in odoo_sale_orders.';

-- F-purchase. orphan_order (purchase): purchase order lines referencing non-existent purchase orders
-- Task 2.2 Step 1
CREATE OR REPLACE VIEW v_audit_order_lines_orphan_purchase AS
SELECT ol.id AS line_id, ol.order_id
FROM odoo_order_lines ol
LEFT JOIN odoo_purchase_orders po ON ol.order_id = po.id
WHERE ol.order_type = 'purchase' AND po.id IS NULL;

COMMENT ON VIEW v_audit_order_lines_orphan_purchase IS
  'Invariant F (purchase): purchase order lines with order_id not in odoo_purchase_orders.';

-- G. null_standard_price (warn): active products with NULL or zero standard_price
-- Task 2.3
CREATE OR REPLACE VIEW v_audit_products_null_standard_price AS
SELECT id, internal_ref, name
FROM odoo_products
WHERE active = true
  AND (standard_price IS NULL OR standard_price = 0);

COMMENT ON VIEW v_audit_products_null_standard_price IS
  'Invariant G: active products with null or zero standard_price.';

-- H. null_uom (error): active products with NULL uom_id
-- Task 2.3
CREATE OR REPLACE VIEW v_audit_products_null_uom AS
SELECT id, internal_ref, name
FROM odoo_products
WHERE active = true AND uom_id IS NULL;

COMMENT ON VIEW v_audit_products_null_uom IS
  'Invariant H: active products with null uom_id.';

-- I. duplicate_default_code: active products sharing the same internal_ref
-- Task 2.3
CREATE OR REPLACE VIEW v_audit_products_duplicate_default_code AS
SELECT internal_ref, COUNT(*) AS dupes, array_agg(id) AS product_ids
FROM odoo_products
WHERE active = true AND internal_ref IS NOT NULL AND internal_ref <> ''
GROUP BY internal_ref
HAVING COUNT(*) > 1;

COMMENT ON VIEW v_audit_products_duplicate_default_code IS
  'Invariant I: active products with duplicate internal_ref (default_code).';

-- J. trial_balance: periods where sum of balances != 0 (beyond 1.0 tolerance)
-- Task 2.4
CREATE OR REPLACE VIEW v_audit_account_balances_trial_balance AS
SELECT odoo_company_id,
       to_char(period_end::date, 'YYYY-MM') AS period,
       SUM(balance) AS total
FROM odoo_account_balances
GROUP BY odoo_company_id, to_char(period_end::date,'YYYY-MM')
HAVING ABS(SUM(balance)) > 1.0;

COMMENT ON VIEW v_audit_account_balances_trial_balance IS
  'Invariant J: periods where trial balance is not zero (tolerance 1.0 MXN).';

-- K. orphan_account: account_balances rows whose account_code is missing from chart_of_accounts
-- Task 2.4
CREATE OR REPLACE VIEW v_audit_account_balances_orphan_account AS
SELECT ab.odoo_company_id, ab.account_code, COUNT(*) AS orphan_rows
FROM odoo_account_balances ab
LEFT JOIN odoo_chart_of_accounts coa
  ON coa.account_code = ab.account_code
 AND coa.odoo_company_id = ab.odoo_company_id
WHERE coa.account_code IS NULL
GROUP BY ab.odoo_company_id, ab.account_code;

COMMENT ON VIEW v_audit_account_balances_orphan_account IS
  'Invariant K: account_balances rows whose account_code is not in odoo_chart_of_accounts.';

-- L. company_leak_invoice_lines: invoice lines whose company differs from their header invoice
-- Task 2.4
CREATE OR REPLACE VIEW v_audit_company_leak_invoice_lines AS
SELECT il.id AS line_id, il.odoo_company_id AS line_company,
       i.odoo_company_id AS header_company
FROM odoo_invoice_lines il
JOIN odoo_invoices i ON il.invoice_id = i.id
WHERE il.odoo_company_id IS DISTINCT FROM i.odoo_company_id;

COMMENT ON VIEW v_audit_company_leak_invoice_lines IS
  'Invariant L: invoice lines with odoo_company_id != their parent invoice odoo_company_id.';

-- M. company_leak_order_lines: order lines whose company differs from their header order
-- Task 2.4
CREATE OR REPLACE VIEW v_audit_company_leak_order_lines AS
SELECT ol.id AS line_id, ol.order_type,
       ol.odoo_company_id AS line_company,
       COALESCE(so.odoo_company_id, po.odoo_company_id) AS header_company
FROM odoo_order_lines ol
LEFT JOIN odoo_sale_orders so
  ON ol.order_type = 'sale' AND ol.order_id = so.id
LEFT JOIN odoo_purchase_orders po
  ON ol.order_type = 'purchase' AND ol.order_id = po.id
WHERE ol.odoo_company_id IS DISTINCT FROM
      COALESCE(so.odoo_company_id, po.odoo_company_id);

COMMENT ON VIEW v_audit_company_leak_order_lines IS
  'Invariant M: order lines with odoo_company_id != their parent order odoo_company_id.';

-- N. orphan_partner in deliveries: deliveries with partner_id not found in contacts
-- Task 2.4
CREATE OR REPLACE VIEW v_audit_deliveries_orphan_partner AS
SELECT d.id AS delivery_id, d.partner_id
FROM odoo_deliveries d
LEFT JOIN contacts c ON c.odoo_id = d.partner_id
WHERE d.partner_id IS NOT NULL AND c.odoo_id IS NULL;

COMMENT ON VIEW v_audit_deliveries_orphan_partner IS
  'Invariant N: deliveries with partner_id not found in contacts table.';

-- O. done_without_date: done deliveries missing date_done
-- Task 2.4
CREATE OR REPLACE VIEW v_audit_deliveries_done_without_date AS
SELECT id, state, date_done
FROM odoo_deliveries
WHERE state = 'done' AND date_done IS NULL;

COMMENT ON VIEW v_audit_deliveries_done_without_date IS
  'Invariant O: deliveries with state=done but date_done IS NULL.';
