-- silver_inventory_adjustments — RPCs for inventory-adjustment dashboards
-- in /finanzas (lente contable) and /operaciones (lente físico).
--
-- Originally designed as VIEWs over odoo_account_entries_stock.lines_stock,
-- but execute_safe_ddl() doesn't allow CREATE VIEW (only CREATE FUNCTION is
-- in the allowlist). So the categorization logic lives inside the RPCs.
--
-- Data source: odoo_account_entries_stock (synced hourly via
-- _push_account_entries_stock). lines_stock is jsonb of {account_code,
-- product_id, product_ref, debit, credit, name, partner_id} per journal line.
--
-- Validation (Dec 2025): NET 501.01.02 = $10,544,206, matches
-- canonical_account_balances to the penny.

-- ──────────────────────────────────────────────────────────────────────────────
-- _silver_inventory_adjustments_lines — internal helper, line-level data
-- with categorization by journal cycle and account bucket.

CREATE OR REPLACE FUNCTION _silver_inventory_adjustments_lines(
    p_date_from date DEFAULT '2024-01-01',
    p_date_to   date DEFAULT current_date,
    p_account_codes text[] DEFAULT NULL  -- NULL = all
)
RETURNS TABLE (
    journal_move_id bigint,
    odoo_company_id integer,
    line_date date,
    period text,
    journal_entry_name text,
    journal_entry_ref text,
    journal_name text,
    journal_type text,
    move_type text,
    state text,
    stock_move_ids integer[],
    account_code text,
    odoo_product_id integer,
    product_ref text,
    odoo_partner_id integer,
    line_name text,
    debit numeric,
    credit numeric,
    net numeric,
    journal_category text,
    account_bucket text
)
LANGUAGE sql STABLE AS $$
    SELECT
        e.odoo_move_id::bigint,
        e.odoo_company_id::integer,
        e.date,
        to_char(e.date, 'YYYY-MM'),
        e.name,
        e.ref,
        e.journal_name,
        e.journal_type,
        e.move_type,
        e.state,
        e.stock_move_ids::integer[],
        (line ->> 'account_code'),
        ((line ->> 'product_id')::integer),
        (line ->> 'product_ref'),
        ((line ->> 'partner_id')::integer),
        (line ->> 'name'),
        COALESCE((line ->> 'debit')::numeric, 0),
        COALESCE((line ->> 'credit')::numeric, 0),
        COALESCE((line ->> 'debit')::numeric, 0)
            - COALESCE((line ->> 'credit')::numeric, 0),
        CASE
            WHEN e.journal_name = 'Valoración del inventario'      THEN 'inventory_valuation'
            WHEN e.journal_name = 'Depreciaciones y Amortizaciones' THEN 'depreciation'
            WHEN e.journal_name = 'NOMINAS'                         THEN 'payroll'
            WHEN e.journal_name = 'Facturas de proveedor'           THEN 'vendor_bill'
            WHEN e.journal_name ILIKE 'GSTVAR%'                     THEN 'gastos_varios'
            WHEN e.journal_name = 'Operaciones varias'              THEN 'manual_other'
            WHEN e.journal_name = 'CAPA DE VALORACIÓN'              THEN 'capa_manual'
            WHEN e.journal_name = 'IMPUESTOS'                       THEN 'taxes'
            WHEN e.move_type IN ('in_invoice', 'in_refund')         THEN 'vendor_bill'
            WHEN e.move_type IN ('out_invoice', 'out_refund')       THEN 'customer_invoice'
            ELSE 'other'
        END,
        CASE
            WHEN (line ->> 'account_code') = '501.01.01'             THEN 'cogs_501_01_01'
            WHEN (line ->> 'account_code') = '501.01.02'             THEN 'cost_primo_501_01_02'
            WHEN (line ->> 'account_code') LIKE '501.06%'            THEN 'mod_501_06'
            WHEN (line ->> 'account_code') LIKE '501%'               THEN 'cogs_501_other'
            WHEN (line ->> 'account_code') LIKE '504.08%'            THEN 'depreciation_504_08'
            WHEN (line ->> 'account_code') LIKE '504%'               THEN 'purchase_504'
            WHEN (line ->> 'account_code') LIKE '115%'               THEN 'inventory_115'
            ELSE 'other_account'
        END
    FROM odoo_account_entries_stock e
    CROSS JOIN LATERAL jsonb_array_elements(
        COALESCE(e.lines_stock, '[]'::jsonb)
    ) AS line
    WHERE e.state = 'posted'
      AND e.lines_stock IS NOT NULL
      AND jsonb_array_length(e.lines_stock) > 0
      AND e.date >= p_date_from
      AND e.date <  p_date_to + interval '1 day'
      AND (p_account_codes IS NULL OR (line ->> 'account_code') = ANY(p_account_codes))
$$;

COMMENT ON FUNCTION _silver_inventory_adjustments_lines IS
  'Internal: flattens odoo_account_entries_stock.lines_stock with journal '
  'and account-bucket categorization. Use the public RPCs below for UI.';

-- ──────────────────────────────────────────────────────────────────────────────
-- get_inventory_adjustments_monthly RPC — feeds /finanzas time series
-- Monthly net by account_bucket × journal_category.

CREATE OR REPLACE FUNCTION get_inventory_adjustments_monthly(
    p_date_from date DEFAULT '2024-01-01',
    p_date_to   date DEFAULT current_date,
    p_account_codes text[] DEFAULT NULL
)
RETURNS TABLE (
    period text,
    account_bucket text,
    journal_category text,
    debit numeric,
    credit numeric,
    net numeric,
    line_count bigint
)
LANGUAGE sql STABLE AS $$
    SELECT
        l.period,
        l.account_bucket,
        l.journal_category,
        SUM(l.debit)  AS debit,
        SUM(l.credit) AS credit,
        SUM(l.net)    AS net,
        COUNT(*)      AS line_count
    FROM _silver_inventory_adjustments_lines(p_date_from, p_date_to, p_account_codes) l
    GROUP BY l.period, l.account_bucket, l.journal_category
    ORDER BY l.period, l.account_bucket, l.journal_category
$$;

COMMENT ON FUNCTION get_inventory_adjustments_monthly IS
  'Monthly aggregates by account_bucket × journal_category. Pass '
  'p_account_codes=ARRAY[''501.01.02''] to focus on cost-primo audit.';

-- ──────────────────────────────────────────────────────────────────────────────
-- get_inventory_adjustments_physical_monthly RPC — feeds /operaciones
-- Joins stock_moves to subcategorize by reference (physical_count, scrap,
-- lot_transfer, manual_edit, manufacturing_*, etc.).

CREATE OR REPLACE FUNCTION get_inventory_adjustments_physical_monthly(
    p_date_from date DEFAULT '2024-01-01',
    p_date_to   date DEFAULT current_date,
    p_account_codes text[] DEFAULT NULL
)
RETURNS TABLE (
    period text,
    physical_subcategory text,
    account_bucket text,
    debit numeric,
    credit numeric,
    net numeric,
    line_count bigint,
    product_count bigint
)
LANGUAGE sql STABLE AS $$
    WITH lines AS (
        SELECT *
        FROM _silver_inventory_adjustments_lines(p_date_from, p_date_to, p_account_codes)
    ),
    enriched AS (
        SELECT
            l.*,
            sm.reference            AS stock_move_ref,
            sm.location_usage       AS stock_loc_from,
            sm.location_dest_usage  AS stock_loc_to
        FROM lines l
        LEFT JOIN LATERAL (
            SELECT *
            FROM odoo_stock_moves sm
            WHERE sm.odoo_move_id = ANY(l.stock_move_ids)
            ORDER BY sm.odoo_move_id ASC
            LIMIT 1
        ) sm ON true
    )
    SELECT
        e.period,
        CASE
            WHEN e.stock_move_ref IS NULL THEN
                CASE
                    WHEN e.journal_category = 'depreciation' THEN 'depreciation'
                    WHEN e.journal_category = 'payroll'      THEN 'payroll'
                    WHEN e.journal_category = 'vendor_bill'  THEN 'vendor_bill'
                    WHEN e.journal_category = 'manual_other' THEN 'manual_journal'
                    WHEN e.journal_category = 'capa_manual'  THEN 'capa_manual'
                    ELSE 'unlinked'
                END
            WHEN e.stock_move_ref ILIKE 'Physical Inventory%'                       THEN 'physical_count'
            WHEN e.stock_move_ref ILIKE 'Cantidad de producto actualizada%'         THEN 'manual_edit'
            WHEN e.stock_move_ref ILIKE 'Número de serie/lote trasladado%'          THEN 'lot_transfer'
            WHEN e.stock_move_ref LIKE 'SP/%'                                       THEN 'scrap'
            WHEN e.stock_move_ref LIKE 'TL/ENC/%' OR e.stock_move_ref LIKE 'TL/ENC//%' THEN 'reclassification'
            WHEN e.stock_move_ref LIKE 'TL/OP-%'                                    THEN 'manufacturing_op'
            WHEN e.stock_loc_to = 'production'                                      THEN 'manufacturing_consume'
            WHEN e.stock_loc_from = 'production'                                    THEN 'manufacturing_produce'
            WHEN e.stock_loc_from = 'supplier'                                      THEN 'purchase_in'
            WHEN e.stock_loc_to = 'customer'                                        THEN 'sale_out'
            WHEN e.stock_loc_to = 'inventory'                                       THEN 'inventory_loss'
            WHEN e.stock_loc_from = 'inventory'                                     THEN 'inventory_gain'
            ELSE 'other_stock_move'
        END AS physical_subcategory,
        e.account_bucket,
        SUM(e.debit)  AS debit,
        SUM(e.credit) AS credit,
        SUM(e.net)    AS net,
        COUNT(*)      AS line_count,
        COUNT(DISTINCT e.product_ref) FILTER (WHERE e.product_ref IS NOT NULL) AS product_count
    FROM enriched e
    GROUP BY e.period, physical_subcategory, e.account_bucket
    ORDER BY e.period, physical_subcategory, e.account_bucket
$$;

COMMENT ON FUNCTION get_inventory_adjustments_physical_monthly IS
  'Monthly aggregates joined with stock_moves to expose physical_subcategory '
  '(physical_count, scrap, lot_transfer, manual_edit, manufacturing_*, etc.). '
  'Slower than the contable variant due to LATERAL join.';

-- ──────────────────────────────────────────────────────────────────────────────
-- get_inventory_adjustments_top_products RPC — top SKUs by net Dr in a period

CREATE OR REPLACE FUNCTION get_inventory_adjustments_top_products(
    p_date_from date,
    p_date_to date,
    p_account_codes text[] DEFAULT ARRAY['501.01.02'],
    p_limit int DEFAULT 20
)
RETURNS TABLE (
    product_ref text,
    odoo_product_id integer,
    physical_subcategory_top text,
    debit numeric,
    credit numeric,
    net numeric,
    line_count bigint
)
LANGUAGE sql STABLE AS $$
    WITH lines AS (
        SELECT *
        FROM _silver_inventory_adjustments_lines(p_date_from, p_date_to, p_account_codes)
        WHERE product_ref IS NOT NULL
    ),
    enriched AS (
        SELECT
            l.product_ref,
            l.odoo_product_id,
            l.debit, l.credit, l.net,
            CASE
                WHEN sm.reference ILIKE 'Physical Inventory%'                    THEN 'physical_count'
                WHEN sm.reference ILIKE 'Cantidad de producto actualizada%'      THEN 'manual_edit'
                WHEN sm.reference ILIKE 'Número de serie/lote trasladado%'       THEN 'lot_transfer'
                WHEN sm.reference LIKE 'SP/%'                                    THEN 'scrap'
                WHEN sm.reference LIKE 'TL/ENC/%' OR sm.reference LIKE 'TL/ENC//%' THEN 'reclassification'
                WHEN sm.reference LIKE 'TL/OP-%'                                 THEN 'manufacturing_op'
                WHEN sm.location_dest_usage = 'production'                       THEN 'manufacturing_consume'
                WHEN sm.location_usage = 'production'                            THEN 'manufacturing_produce'
                ELSE 'other'
            END AS physical_subcategory
        FROM lines l
        LEFT JOIN LATERAL (
            SELECT *
            FROM odoo_stock_moves sm
            WHERE sm.odoo_move_id = ANY(l.stock_move_ids)
            ORDER BY sm.odoo_move_id ASC
            LIMIT 1
        ) sm ON true
    ),
    by_subcat AS (
        SELECT product_ref, odoo_product_id, physical_subcategory,
               SUM(debit) AS debit, SUM(credit) AS credit, SUM(net) AS net,
               COUNT(*) AS line_count
        FROM enriched
        GROUP BY product_ref, odoo_product_id, physical_subcategory
    ),
    top_subcat AS (
        SELECT DISTINCT ON (product_ref)
               product_ref, physical_subcategory AS top_subcat
        FROM by_subcat
        ORDER BY product_ref, net DESC
    ),
    rolled AS (
        SELECT b.product_ref, b.odoo_product_id,
               SUM(b.debit) AS debit, SUM(b.credit) AS credit,
               SUM(b.net) AS net, SUM(b.line_count) AS line_count
        FROM by_subcat b
        GROUP BY b.product_ref, b.odoo_product_id
    )
    SELECT r.product_ref, r.odoo_product_id, t.top_subcat,
           r.debit, r.credit, r.net, r.line_count
    FROM rolled r
    LEFT JOIN top_subcat t USING (product_ref)
    ORDER BY r.net DESC
    LIMIT p_limit
$$;

COMMENT ON FUNCTION get_inventory_adjustments_top_products IS
  'Top N products by net debit on the given accounts in a period. Defaults to '
  '501.01.02 (cost primo). Includes the most-impacting physical_subcategory '
  'per product.';
