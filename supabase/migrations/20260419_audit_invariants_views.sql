-- 20260419_audit_invariants_views.sql
-- Audit invariant views for sync-audit Fase 1.
-- Spec: docs/superpowers/specs/2026-04-19-sync-audit-design.md
--
-- NOTE: Original plan assumed Odoo-side column names. Production Supabase
-- schema differs. Changes recorded here (see audit_invariants.md):
--   * odoo_invoice_lines FK is `odoo_move_id` (not invoice_id), joined to
--     odoo_invoices.odoo_invoice_id (not id).
--   * odoo_invoice_lines has no `currency_code` / `exchange_rate` columns
--     (only `currency` text).  Invariant D (fx_sanity) cannot be expressed
--     and is stubbed.  Invariant C (fx_present) only checks that
--     `price_subtotal_mxn` is not NULL for non-MXN lines.
--   * odoo_order_lines uses `subtotal` / `subtotal_mxn` / `order_date` /
--     `odoo_order_id` / `odoo_product_id`.
--   * Orders parent-link uses `ol.odoo_order_id = so.odoo_order_id`
--     (Odoo-id match), same for purchase.
--   * odoo_account_balances has no `odoo_company_id` and its `period` is
--     text ("YYYY-MM"). Company derived via join to odoo_chart_of_accounts
--     on `odoo_account_id`. Chart uses `code` (not `account_code`).
--   * odoo_deliveries uses `odoo_partner_id`; contacts has `odoo_partner_id`.

-- ============================================================
-- AUXILIARY BUCKET VIEWS (used by Odoo-side audit_* methods)
-- ============================================================

-- Bug fix: previous GROUP BY included `il.invoice_date` (daily) alongside
-- the YYYY-MM bucket_key, producing one row per day instead of one per
-- (month, move_type, company). The Odoo audit dict-keyed by bucket_key
-- silently collapsed them to whichever row came last → appeared as if
-- Supabase had only ~17% of the real line count.
CREATE OR REPLACE VIEW v_audit_invoice_lines_buckets AS
SELECT
  to_char(il.invoice_date, 'YYYY-MM') || '|' || il.move_type || '|'
    || COALESCE(il.odoo_company_id::text, '0') AS bucket_key,
  MIN(il.invoice_date) AS date_from,
  MAX(il.invoice_date) AS date_to,
  il.move_type,
  il.odoo_company_id,
  COUNT(*) AS count,
  SUM(
    CASE WHEN il.move_type IN ('out_refund','in_refund') THEN -1 ELSE 1 END
    * COALESCE(il.price_subtotal_mxn, il.price_subtotal)
  ) AS sum_subtotal_mxn,
  SUM(
    CASE WHEN il.move_type IN ('out_refund','in_refund') THEN -1 ELSE 1 END
    * il.quantity
  ) AS sum_qty
FROM odoo_invoice_lines il
JOIN odoo_invoices i ON il.odoo_move_id = i.odoo_invoice_id
WHERE i.state = 'posted'
  AND il.invoice_date IS NOT NULL
GROUP BY to_char(il.invoice_date,'YYYY-MM'), il.move_type,
         il.odoo_company_id;

COMMENT ON VIEW v_audit_invoice_lines_buckets IS
  'Usado por quimibond.sync.audit.audit_invoice_lines';

CREATE OR REPLACE VIEW v_audit_order_lines_buckets AS
SELECT
  to_char(order_date, 'YYYY-MM') || '|' || order_type || '|'
    || COALESCE(odoo_company_id::text, '0') AS bucket_key,
  order_type,
  odoo_company_id,
  COUNT(*) AS count,
  SUM(COALESCE(subtotal_mxn, subtotal)) AS sum_subtotal_mxn,
  SUM(qty) AS sum_qty
FROM odoo_order_lines
WHERE order_date IS NOT NULL
GROUP BY to_char(order_date,'YYYY-MM'), order_type, odoo_company_id;

COMMENT ON VIEW v_audit_order_lines_buckets IS
  'Usado por quimibond.sync.audit.audit_order_lines';

CREATE OR REPLACE VIEW v_audit_deliveries_buckets AS
SELECT
  to_char(date_done::date, 'YYYY-MM') || '|' || state || '|'
    || COALESCE(odoo_company_id::text, '0') AS bucket_key,
  COUNT(*) AS count
FROM odoo_deliveries
WHERE date_done IS NOT NULL AND state IN ('done','cancel')
GROUP BY to_char(date_done::date,'YYYY-MM'), state, odoo_company_id;

COMMENT ON VIEW v_audit_deliveries_buckets IS
  'Usado por quimibond.sync.audit.audit_deliveries';

CREATE OR REPLACE VIEW v_audit_manufacturing_buckets AS
SELECT
  to_char(date_start::date, 'YYYY-MM') || '|' || state || '|'
    || COALESCE(odoo_company_id::text, '0') AS bucket_key,
  COUNT(*) AS count,
  SUM(qty_produced) AS sum_qty
FROM odoo_manufacturing
WHERE date_start IS NOT NULL
GROUP BY to_char(date_start::date,'YYYY-MM'), state, odoo_company_id;

COMMENT ON VIEW v_audit_manufacturing_buckets IS
  'Usado por quimibond.sync.audit.audit_manufacturing';

-- Account balances: `period` is text (YYYY-MM); company derived via coa join.
CREATE OR REPLACE VIEW v_audit_account_balances_buckets AS
WITH classified AS (
  SELECT
    ab.*,
    coa.odoo_company_id AS coa_company_id,
    -- SAT MX chart uses codes like 115.01.01; 1150* never matches.
    CASE
      WHEN coa.code LIKE '115%'
        THEN 'account_balances.inventory_accounts_balance'
      WHEN coa.code LIKE '5%'
        THEN 'account_balances.cogs_accounts_balance'
      WHEN coa.code LIKE '4%'
        THEN 'account_balances.revenue_accounts_balance'
      ELSE NULL
    END AS invariant_key
  FROM odoo_account_balances ab
  JOIN odoo_chart_of_accounts coa
    ON coa.odoo_account_id = ab.odoo_account_id
)
SELECT
  invariant_key,
  period || '|' || COALESCE(coa_company_id::text, '0') AS bucket_key,
  period,
  coa_company_id AS odoo_company_id,
  SUM(balance) AS balance
FROM classified
WHERE invariant_key IS NOT NULL
GROUP BY invariant_key, period, coa_company_id;

COMMENT ON VIEW v_audit_account_balances_buckets IS
  'Usado por quimibond.sync.audit.audit_account_balances';

-- ============================================================
-- INTERNAL INVARIANT VIEWS (A-O; D stubbed — schema lacks exchange_rate)
-- ============================================================

-- A. reversal_sign (v3): refund lines where SIGN(quantity) != SIGN(price_subtotal).
-- Odoo convention: refund lines store POSITIVE qty and subtotal; sign is
-- implied by move_type and applied at aggregation time (see
-- v_audit_invoice_lines_buckets). A refund line with qty=+5 but
-- subtotal=-250 means price_unit was captured as negative, which after
-- the move_type sign flip sums as POSITIVE, inflating net revenue/CMV.
-- This is a data-entry bug in Odoo (not a sync bug) — forced to 'warn'
-- severity in run_internal_audits.
CREATE OR REPLACE VIEW v_audit_invoice_lines_reversal_sign AS
SELECT il.id AS line_id, il.odoo_move_id, il.move_type,
       il.quantity, il.price_subtotal
FROM odoo_invoice_lines il
JOIN odoo_invoices i ON il.odoo_move_id = i.odoo_invoice_id
WHERE i.move_type IN ('out_refund','in_refund')
  AND il.quantity IS NOT NULL
  AND il.price_subtotal IS NOT NULL
  AND il.quantity <> 0
  AND il.price_subtotal <> 0
  AND SIGN(il.quantity) <> SIGN(il.price_subtotal);

COMMENT ON VIEW v_audit_invoice_lines_reversal_sign IS
  'Invariant A: refund lines where SIGN(qty) != SIGN(price_subtotal). '
  'Data-entry issue in Odoo (negative price_unit on refund lines), not sync bug.';

-- B. price_recompute (v2): drift threshold raised to $1. Sub-$1
-- drifts are inherent rounding noise: push stored price_unit at 2
-- decimals while Odoo computes price_subtotal at 6-decimal precision.
-- Only drifts >= $1 flag real precision loss, which came from lines
-- with massive quantities (qty=4.1M x 0.0335). Push was fixed to use
-- 6-decimal precision (sync_push.py, 2026-04-20).
CREATE OR REPLACE VIEW v_audit_invoice_lines_price_recompute AS
SELECT il.id AS line_id, il.odoo_move_id,
       il.price_unit, il.quantity, il.discount, il.price_subtotal,
       ABS(il.price_unit * il.quantity * (1 - COALESCE(il.discount,0)/100.0)
           - il.price_subtotal) AS drift
FROM odoo_invoice_lines il
WHERE il.price_subtotal IS NOT NULL
  AND ABS(il.price_unit * il.quantity * (1 - COALESCE(il.discount,0)/100.0)
          - il.price_subtotal) >= 1.0;

COMMENT ON VIEW v_audit_invoice_lines_price_recompute IS
  'Invariant B: invoice lines where price_unit*qty*(1-discount) drifts $1+ from price_subtotal.';

-- C. fx_present (no exchange_rate column): flag non-MXN lines missing MXN amount
CREATE OR REPLACE VIEW v_audit_invoice_lines_fx_present AS
SELECT il.id AS line_id, il.odoo_move_id, il.currency,
       il.price_subtotal, il.price_subtotal_mxn
FROM odoo_invoice_lines il
WHERE il.currency IS NOT NULL
  AND il.currency <> 'MXN'
  AND il.price_subtotal_mxn IS NULL;

COMMENT ON VIEW v_audit_invoice_lines_fx_present IS
  'Invariant C: non-MXN invoice lines missing price_subtotal_mxn (exchange_rate unavailable in schema).';

-- D. fx_sanity — STUBBED: schema lacks exchange_rate column in odoo_invoice_lines.
-- Returns 0 rows so run_internal_audits always records severity=ok for this key
-- (kept for inventory stability; re-enable after schema adds exchange_rate).
CREATE OR REPLACE VIEW v_audit_invoice_lines_fx_sanity AS
SELECT NULL::bigint AS line_id WHERE false;

COMMENT ON VIEW v_audit_invoice_lines_fx_sanity IS
  'Invariant D (STUBBED): would check FX drift but odoo_invoice_lines lacks exchange_rate column. Always empty.';

-- E. orphan_product: order lines referencing non-existent products
CREATE OR REPLACE VIEW v_audit_order_lines_orphan_product AS
SELECT ol.id AS line_id, ol.odoo_order_id, ol.order_type, ol.odoo_product_id
FROM odoo_order_lines ol
LEFT JOIN odoo_products p ON ol.odoo_product_id = p.odoo_product_id
WHERE ol.odoo_product_id IS NOT NULL AND p.odoo_product_id IS NULL;

COMMENT ON VIEW v_audit_order_lines_orphan_product IS
  'Invariant E: order lines with odoo_product_id not in odoo_products.';

-- F-sale. orphan sale order
CREATE OR REPLACE VIEW v_audit_order_lines_orphan_sale AS
SELECT ol.id AS line_id, ol.odoo_order_id
FROM odoo_order_lines ol
LEFT JOIN odoo_sale_orders so ON ol.odoo_order_id = so.odoo_order_id
WHERE ol.order_type = 'sale' AND so.odoo_order_id IS NULL;

COMMENT ON VIEW v_audit_order_lines_orphan_sale IS
  'Invariant F (sale): sale order lines with odoo_order_id not in odoo_sale_orders.';

-- F-purchase. orphan purchase order
CREATE OR REPLACE VIEW v_audit_order_lines_orphan_purchase AS
SELECT ol.id AS line_id, ol.odoo_order_id
FROM odoo_order_lines ol
LEFT JOIN odoo_purchase_orders po ON ol.odoo_order_id = po.odoo_order_id
WHERE ol.order_type = 'purchase' AND po.odoo_order_id IS NULL;

COMMENT ON VIEW v_audit_order_lines_orphan_purchase IS
  'Invariant F (purchase): purchase order lines with odoo_order_id not in odoo_purchase_orders.';

-- G. null_standard_price (warn)
CREATE OR REPLACE VIEW v_audit_products_null_standard_price AS
SELECT id, internal_ref, name
FROM odoo_products
WHERE active = true
  AND (standard_price IS NULL OR standard_price = 0);

COMMENT ON VIEW v_audit_products_null_standard_price IS
  'Invariant G: active products with null or zero standard_price.';

-- H. null_uom (error)
CREATE OR REPLACE VIEW v_audit_products_null_uom AS
SELECT id, internal_ref, name
FROM odoo_products
WHERE active = true AND uom_id IS NULL;

COMMENT ON VIEW v_audit_products_null_uom IS
  'Invariant H: active products with null uom_id.';

-- I. duplicate_default_code
CREATE OR REPLACE VIEW v_audit_products_duplicate_default_code AS
SELECT internal_ref, COUNT(*) AS dupes, array_agg(id) AS product_ids
FROM odoo_products
WHERE active = true AND internal_ref IS NOT NULL AND internal_ref <> ''
GROUP BY internal_ref
HAVING COUNT(*) > 1;

COMMENT ON VIEW v_audit_products_duplicate_default_code IS
  'Invariant I: active products with duplicate internal_ref (default_code).';

-- J. trial_balance_zero_per_period
-- balances.period is text; group by period + coa.odoo_company_id
CREATE OR REPLACE VIEW v_audit_account_balances_trial_balance AS
SELECT coa.odoo_company_id,
       ab.period,
       SUM(ab.balance) AS total
FROM odoo_account_balances ab
JOIN odoo_chart_of_accounts coa
  ON coa.odoo_account_id = ab.odoo_account_id
GROUP BY coa.odoo_company_id, ab.period
HAVING ABS(SUM(ab.balance)) > 1.0;

COMMENT ON VIEW v_audit_account_balances_trial_balance IS
  'Invariant J: periods where trial balance is not zero (tolerance 1.0 MXN).';

-- K. orphan_account (balances whose odoo_account_id has no chart match)
CREATE OR REPLACE VIEW v_audit_account_balances_orphan_account AS
SELECT ab.odoo_account_id, ab.account_code, COUNT(*) AS orphan_rows
FROM odoo_account_balances ab
LEFT JOIN odoo_chart_of_accounts coa
  ON coa.odoo_account_id = ab.odoo_account_id
WHERE coa.odoo_account_id IS NULL
GROUP BY ab.odoo_account_id, ab.account_code;

COMMENT ON VIEW v_audit_account_balances_orphan_account IS
  'Invariant K: account_balances rows whose odoo_account_id is not in odoo_chart_of_accounts.';

-- L. company_leak_invoice_lines
CREATE OR REPLACE VIEW v_audit_company_leak_invoice_lines AS
SELECT il.id AS line_id, il.odoo_company_id AS line_company,
       i.odoo_company_id AS header_company
FROM odoo_invoice_lines il
JOIN odoo_invoices i ON il.odoo_move_id = i.odoo_invoice_id
WHERE il.odoo_company_id IS DISTINCT FROM i.odoo_company_id;

COMMENT ON VIEW v_audit_company_leak_invoice_lines IS
  'Invariant L: invoice lines with odoo_company_id != their parent invoice odoo_company_id.';

-- M. company_leak_order_lines
CREATE OR REPLACE VIEW v_audit_company_leak_order_lines AS
SELECT ol.id AS line_id, ol.order_type,
       ol.odoo_company_id AS line_company,
       COALESCE(so.odoo_company_id, po.odoo_company_id) AS header_company
FROM odoo_order_lines ol
LEFT JOIN odoo_sale_orders so
  ON ol.order_type = 'sale' AND ol.odoo_order_id = so.odoo_order_id
LEFT JOIN odoo_purchase_orders po
  ON ol.order_type = 'purchase' AND ol.odoo_order_id = po.odoo_order_id
WHERE ol.odoo_company_id IS DISTINCT FROM
      COALESCE(so.odoo_company_id, po.odoo_company_id);

COMMENT ON VIEW v_audit_company_leak_order_lines IS
  'Invariant M: order lines with odoo_company_id != their parent order odoo_company_id.';

-- N. orphan_partner in deliveries (via odoo_partner_id in contacts)
CREATE OR REPLACE VIEW v_audit_deliveries_orphan_partner AS
SELECT d.id AS delivery_id, d.odoo_partner_id
FROM odoo_deliveries d
LEFT JOIN contacts c ON c.odoo_partner_id = d.odoo_partner_id
WHERE d.odoo_partner_id IS NOT NULL AND c.odoo_partner_id IS NULL;

COMMENT ON VIEW v_audit_deliveries_orphan_partner IS
  'Invariant N: deliveries with odoo_partner_id not found in contacts.';

-- O. done_without_date
CREATE OR REPLACE VIEW v_audit_deliveries_done_without_date AS
SELECT id, state, date_done
FROM odoo_deliveries
WHERE state = 'done' AND date_done IS NULL;

COMMENT ON VIEW v_audit_deliveries_done_without_date IS
  'Invariant O: deliveries with state=done but date_done IS NULL.';
