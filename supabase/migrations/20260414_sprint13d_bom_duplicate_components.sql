-- Sprint 13d: detect duplicate components in BOMs at ANY level
--
-- After end-to-end validation of POLYCOTTON 140, found 244 finished
-- products whose recursive BOM cost is inflated because some sub-BOM
-- contains duplicated components.
--
-- Two kinds of duplicates we detect:
--
--   (A) intra_dupe: same odoo_product_id appears more than once on the
--       same canonical BOM (with same or different qty). Almost always
--       a data entry mistake.
--
--   (B) same_name_dupe: two distinct odoo_product_ids share the SAME
--       canonical name (case-insensitive, trim) and BOTH appear as
--       components of the same canonical BOM. Example: HILO POLIESTER
--       ALGODON 22/1 created twice as #8386 and #20163, both inserted
--       into the BOM. Almost always a manual error too.
--
-- Detection runs at every canonical BOM in the system and propagates
-- duplicate $ impact UP through the explosion tree using effective qty
-- per root unit, so a duplicate found on a deep sub-BOM gets correctly
-- scaled by how much of that sub-BOM the root product needs.

DROP MATERIALIZED VIEW IF EXISTS bom_duplicate_components CASCADE;

CREATE MATERIALIZED VIEW bom_duplicate_components AS
WITH RECURSIVE
canonical_boms AS (
  SELECT DISTINCT ON (b.odoo_product_id)
    b.odoo_product_id,
    b.odoo_bom_id,
    b.product_qty AS bom_yield
  FROM mrp_boms b
  WHERE b.active = true AND b.odoo_product_id IS NOT NULL
  ORDER BY b.odoo_product_id, b.odoo_bom_id DESC
),
intra_per_bom AS (
  SELECT
    cb.odoo_product_id AS bom_owner_product_id,
    cb.bom_yield,
    COUNT(*) AS dupe_components_count,
    SUM((cnt - 1) * avg_line_cost) AS overcounted_per_bom_unit
  FROM (
    SELECT
      cb.odoo_product_id,
      cb.bom_yield,
      bl.odoo_product_id AS comp_id,
      COUNT(*) AS cnt,
      AVG(bl.product_qty * COALESCE(p.standard_price, 0)) AS avg_line_cost
    FROM canonical_boms cb
    JOIN mrp_bom_lines bl ON bl.odoo_bom_id = cb.odoo_bom_id
    LEFT JOIN odoo_products p ON p.odoo_product_id = bl.odoo_product_id
    WHERE bl.odoo_product_id IS NOT NULL
    GROUP BY cb.odoo_product_id, cb.bom_yield, bl.odoo_product_id
    HAVING COUNT(*) > 1
  ) inner_intra
  JOIN canonical_boms cb ON cb.odoo_product_id = inner_intra.odoo_product_id
  GROUP BY cb.odoo_product_id, cb.bom_yield
),
same_name_per_bom AS (
  SELECT
    bom_owner_product_id,
    bom_yield,
    COUNT(*) AS dupe_groups_count,
    SUM(overcounted_per_bom_unit) AS overcounted_per_bom_unit
  FROM (
    SELECT
      cb.odoo_product_id AS bom_owner_product_id,
      cb.bom_yield,
      LOWER(TRIM(p.name)) AS norm_name,
      COUNT(DISTINCT bl.odoo_product_id) AS distinct_ids,
      (COUNT(DISTINCT bl.odoo_product_id) - 1)
        * (SUM(bl.product_qty * COALESCE(p.standard_price, 0)) / NULLIF(COUNT(*), 0))
        AS overcounted_per_bom_unit
    FROM canonical_boms cb
    JOIN mrp_bom_lines bl ON bl.odoo_bom_id = cb.odoo_bom_id
    LEFT JOIN odoo_products p ON p.odoo_product_id = bl.odoo_product_id
    WHERE bl.odoo_product_id IS NOT NULL
      AND p.name IS NOT NULL
      AND LENGTH(TRIM(p.name)) > 2
    GROUP BY cb.odoo_product_id, cb.bom_yield, LOWER(TRIM(p.name))
    HAVING COUNT(DISTINCT bl.odoo_product_id) > 1
  ) inner_same
  GROUP BY bom_owner_product_id, bom_yield
),
tree AS (
  SELECT
    cb.odoo_product_id AS root_product_id,
    cb.odoo_product_id AS sub_bom_owner,
    1.0::numeric AS qty_per_root_unit,
    1 AS depth,
    ARRAY[cb.odoo_product_id] AS path
  FROM canonical_boms cb
  UNION ALL
  SELECT
    t.root_product_id,
    bl.odoo_product_id AS sub_bom_owner,
    t.qty_per_root_unit
      * (bl.product_qty / NULLIF(cb.bom_yield, 0)),
    t.depth + 1,
    t.path || bl.odoo_product_id
  FROM tree t
  JOIN canonical_boms cb ON cb.odoo_product_id = t.sub_bom_owner
  JOIN mrp_bom_lines bl ON bl.odoo_bom_id = cb.odoo_bom_id
  JOIN canonical_boms cb_child ON cb_child.odoo_product_id = bl.odoo_product_id
  WHERE NOT (bl.odoo_product_id = ANY(t.path))
    AND t.depth < 15
),
root_intra AS (
  SELECT
    t.root_product_id,
    SUM(i.dupe_components_count) AS intra_dupe_components,
    SUM(i.overcounted_per_bom_unit * t.qty_per_root_unit) AS intra_overcounted_mxn
  FROM tree t
  JOIN intra_per_bom i ON i.bom_owner_product_id = t.sub_bom_owner
  GROUP BY t.root_product_id
),
root_same_name AS (
  SELECT
    t.root_product_id,
    SUM(s.dupe_groups_count) AS same_name_groups,
    SUM(s.overcounted_per_bom_unit * t.qty_per_root_unit) AS same_name_overcounted_mxn
  FROM tree t
  JOIN same_name_per_bom s ON s.bom_owner_product_id = t.sub_bom_owner
  GROUP BY t.root_product_id
)
SELECT
  COALESCE(ri.root_product_id, rs.root_product_id) AS odoo_product_id,
  p.name AS product_name,
  p.internal_ref AS product_ref,
  COALESCE(ri.intra_dupe_components, 0) AS intra_dupe_components,
  ROUND(COALESCE(ri.intra_overcounted_mxn, 0)::numeric, 4) AS intra_dupe_overcounted_mxn,
  COALESCE(rs.same_name_groups, 0) AS same_name_groups,
  ROUND(COALESCE(rs.same_name_overcounted_mxn, 0)::numeric, 4) AS same_name_overcounted_mxn,
  ROUND(
    (COALESCE(ri.intra_overcounted_mxn, 0)
     + COALESCE(rs.same_name_overcounted_mxn, 0))::numeric, 4
  ) AS total_overcounted_per_unit_mxn,
  NOW() AS computed_at
FROM root_intra ri
FULL OUTER JOIN root_same_name rs ON rs.root_product_id = ri.root_product_id
LEFT JOIN odoo_products p
  ON p.odoo_product_id = COALESCE(ri.root_product_id, rs.root_product_id);

CREATE UNIQUE INDEX idx_bom_dup_pk ON bom_duplicate_components(odoo_product_id);
CREATE INDEX idx_bom_dup_overcounted ON bom_duplicate_components(total_overcounted_per_unit_mxn);

COMMENT ON MATERIALIZED VIEW bom_duplicate_components IS
  'Sprint 13d: surfaces BOMs with duplicate components at ANY level in the recursive tree. (A) intra_dupe = same odoo_product_id repeated on the same canonical BOM. (B) same_name = different odoo_product_ids sharing the same name in the same BOM. overcounted_mxn is propagated via the explosion qty so it is per-unit-of-root-product.';
