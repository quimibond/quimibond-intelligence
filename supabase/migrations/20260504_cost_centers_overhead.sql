-- Cost centers (departamentos) Quimibond + asignación overhead
--
-- Auditoría 2026-05-04 PM reveló que para hacer full absorption costing
-- correcto necesitamos:
--   1) clasificar gastos a departamentos (cost centers)
--   2) saber qué dpto absorbe legítimamente vía workcenter (solo TEJIDO desde
--      mayo 2026; los demás procesos están en variable costing implícito hasta
--      que configuren sus workcenters)
--   3) calcular burden rate por dpto (no global)
--
-- Tablas:
--   cost_center_config — maestro de departamentos
--   overhead_account_assignment — cuenta GL → dpto (con allocation_pct)
--   rent_lot_assignment — split de renta por lote/uso (Quimibond opera 2 lotes)
--
-- RPCs:
--   get_nomina_by_cost_center(period) — parsea ref del journal NOMINAS
--   get_overhead_by_cost_center(period) — renta + utilities + indirectos
--   get_production_by_cost_center(period) — qty producida por proceso

-- ─── Tabla maestra de centros de costo ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cost_center_config (
  id bigserial PRIMARY KEY,
  code text UNIQUE NOT NULL,
  name text NOT NULL,
  nature text NOT NULL CHECK (nature IN ('fabril_directo','fabril_indirecto','admin')),
  output_uom text,                              -- kg | mts | m2 — para burden rate
  has_workcenter boolean DEFAULT false,
  workcenter_go_live_date date,                 -- desde cuándo absorbe MOD/OH legítimo
  indirect_alloc_method text DEFAULT 'pct_nomina_directa',
  nomina_ref_pattern text,                      -- regex/ILIKE para parsear journal NOMINAS
  notes text,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_cost_center_active ON public.cost_center_config(active) WHERE active=true;

-- ─── Asignación cuentas overhead → centros de costo ─────────────────────
CREATE TABLE IF NOT EXISTS public.overhead_account_assignment (
  id bigserial PRIMARY KEY,
  account_code text NOT NULL,
  cost_center_code text NOT NULL REFERENCES public.cost_center_config(code),
  allocation_pct numeric(5,2) NOT NULL CHECK (allocation_pct >= 0 AND allocation_pct <= 100),
  notes text,
  effective_from date NOT NULL DEFAULT '2026-01-01',
  effective_to date,
  created_at timestamptz DEFAULT now(),
  UNIQUE (account_code, cost_center_code, effective_from)
);
CREATE INDEX IF NOT EXISTS ix_oaa_account ON public.overhead_account_assignment(account_code);
CREATE INDEX IF NOT EXISTS ix_oaa_center ON public.overhead_account_assignment(cost_center_code);

-- ─── Renta por lote ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.rent_lot_assignment (
  id bigserial PRIMARY KEY,
  lot_code text NOT NULL,
  use_description text NOT NULL,
  monthly_amount_mxn numeric(14,2) NOT NULL,
  cost_center_code text NOT NULL REFERENCES public.cost_center_config(code),
  allocation_pct numeric(5,2) NOT NULL DEFAULT 100,
  effective_from date NOT NULL DEFAULT '2026-01-01',
  effective_to date,
  notes text,
  created_at timestamptz DEFAULT now()
);

-- ─── Seed cost centers Quimibond ────────────────────────────────────────
INSERT INTO public.cost_center_config (code, name, nature, output_uom, has_workcenter, workcenter_go_live_date, indirect_alloc_method, nomina_ref_pattern, notes)
VALUES
  ('TEJIDO', 'Tejido Circular', 'fabril_directo', 'kg', true, '2026-05-01', 'pct_qty_producida', '%TEJIDO%', '40 máquinas circulares con rate $74.57/hr. Workcenters go-live mayo 2026 (antes: variable costing implícito).'),
  ('ACABADO', 'Acabado', 'fabril_directo', 'mts', false, NULL, 'pct_qty_producida', '%ACABADO%', 'Sin workcenter aún. Pendiente go-live.'),
  ('TINTORERIA', 'Tintorería / Teñido', 'fabril_directo', 'kg', false, NULL, 'pct_qty_producida', '%TINTOR%', 'Sin workcenter aún. Pendiente go-live.'),
  ('ENTRETELAS', 'Entretelas (carda+espolvoreo+perfoquim+etc)', 'fabril_directo', 'mts', false, NULL, 'pct_qty_producida', '%ENTRETELA%', 'Cubre carda, espolvoreo, perfoquim, impregnación, termofijado, tramado, industrial, puntos. Sin workcenter.'),
  ('INSPECCION_EMPAQUE', 'Inspección y Empaque', 'fabril_indirecto', NULL, false, NULL, 'pct_nomina_directa', '%INSPECC%|%EMPAQUE%', 'Indirecto fabril.'),
  ('MANTENIMIENTO', 'Mantenimiento', 'fabril_indirecto', NULL, false, NULL, 'pct_nomina_directa', '%MTTO%|%MANTEN%', 'Mayor parte va a tejido (40 máquinas).'),
  ('ALMACEN', 'Almacén', 'fabril_indirecto', NULL, false, NULL, 'pct_nomina_directa', '%ALMACEN%', NULL),
  ('CALIDAD', 'Calidad', 'fabril_indirecto', NULL, false, NULL, 'pct_nomina_directa', '%CALIDAD%', NULL),
  ('LIMPIEZA', 'Limpieza', 'fabril_indirecto', NULL, false, NULL, 'pct_nomina_directa', '%LIMPIEZA%', NULL),
  ('ADMINISTRACION', 'Administración', 'admin', NULL, false, NULL, 'manual', '%ADMIN%', 'NO va a costo de producción.'),
  ('DISENO', 'Diseño', 'admin', NULL, false, NULL, 'manual', '%DISEÑO%|%DISEN%', 'NO va a costo de producción.'),
  ('RH_COMPRAS', 'RH y Compras', 'admin', NULL, false, NULL, 'manual', NULL, 'Renta oficinas Lote 10. Admin.')
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name, nature = EXCLUDED.nature, output_uom = EXCLUDED.output_uom,
  has_workcenter = EXCLUDED.has_workcenter, workcenter_go_live_date = EXCLUDED.workcenter_go_live_date,
  indirect_alloc_method = EXCLUDED.indirect_alloc_method,
  nomina_ref_pattern = EXCLUDED.nomina_ref_pattern, notes = EXCLUDED.notes, updated_at = now();

-- ─── Seed renta por lote (datos del CEO 2026-05-04) ──────────────────────
INSERT INTO public.rent_lot_assignment
(lot_code, use_description, monthly_amount_mxn, cost_center_code, allocation_pct, notes)
VALUES
  ('Lote 9', 'planta tintorería y acabado', 356934.67, 'TINTORERIA', 50.00, 'Split 50/50 con ACABADO — pendiente confirmar split real por m²'),
  ('Lote 9', 'planta tintorería y acabado', 356934.67, 'ACABADO', 50.00, 'Split 50/50 con TINTORERIA — pendiente confirmar split real por m²'),
  ('Lote 10', 'planta entretelas', 352062.20, 'ENTRETELAS', 100.00, NULL),
  ('Lote 9,10', 'oficinas Tejido', 284269.42, 'TEJIDO', 100.00, NULL),
  ('Lote 10', 'oficinas RH y Compras', 219509.21, 'RH_COMPRAS', 100.00, 'Admin — fuera de costo de producción')
ON CONFLICT DO NOTHING;

-- ─── Seed asignación overhead directo (input CEO + razonable) ────────────
INSERT INTO public.overhead_account_assignment (account_code, cost_center_code, allocation_pct, notes)
VALUES
  ('504.01.0002', 'TEJIDO', 100.00, 'Energéticos / luz mayormente tejido (40 máquinas circulares)'),
  ('504.01.0003', 'ACABADO', 100.00, 'Gas → proceso de acabado (calderas)'),
  ('504.01.0013', 'TINTORERIA', 100.00, 'Agua oficinas — toda el agua va aquí (puede haber agua proceso en otra cuenta)'),
  ('504.01.0007', 'TEJIDO', 100.00, 'Agujados = repuestos máquinas circulares'),
  ('504.01.0035', 'ADMINISTRACION', 100.00, 'Gastos importación — capitalizable a producto vía Landed Cost (pendiente)')
ON CONFLICT DO NOTHING;

-- ─── RPC: nómina por cost center ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_nomina_by_cost_center(p_period text)
RETURNS TABLE(
  cost_center_code text,
  cost_center_name text,
  nature text,
  num_asientos bigint,
  total_nomina_mxn numeric
)
LANGUAGE sql STABLE AS $$
WITH nom_entries AS (
  SELECT e.amount_total,
    CASE
      WHEN e.ref ILIKE '%TEJIDO%' THEN 'TEJIDO'
      WHEN e.ref ILIKE '%ACABADO%' THEN 'ACABADO'
      WHEN e.ref ILIKE '%TINTOR%' THEN 'TINTORERIA'
      WHEN e.ref ILIKE '%INSPECC%' OR e.ref ILIKE '%EMPAQUE%' THEN 'INSPECCION_EMPAQUE'
      WHEN e.ref ILIKE '%MTTO%' OR e.ref ILIKE '%MANTEN%' THEN 'MANTENIMIENTO'
      WHEN e.ref ILIKE '%ENTRETELA%' THEN 'ENTRETELAS'
      WHEN e.ref ILIKE '%ALMACEN%' THEN 'ALMACEN'
      WHEN e.ref ILIKE '%CALIDAD%' THEN 'CALIDAD'
      WHEN e.ref ILIKE '%LIMPIEZA%' THEN 'LIMPIEZA'
      WHEN e.ref ILIKE '%ADMIN%' THEN 'ADMINISTRACION'
      WHEN e.ref ILIKE '%DISEÑO%' OR e.ref ILIKE '%DISEN%' THEN 'DISENO'
      ELSE 'OTRO'
    END AS cc_code
  FROM public.odoo_account_entries_stock e
  WHERE e.journal_name = 'NOMINAS'
    AND e.date >= (p_period || '-01')::date
    AND e.date < (date_trunc('month', (p_period || '-01')::date) + interval '1 month')::date
)
SELECT
  COALESCE(cc.code, 'OTRO') AS cost_center_code,
  COALESCE(cc.name, 'Sin clasificar') AS cost_center_name,
  COALESCE(cc.nature, 'fabril_indirecto') AS nature,
  COUNT(*)::bigint AS num_asientos,
  SUM(n.amount_total)::numeric AS total_nomina_mxn
FROM nom_entries n
LEFT JOIN public.cost_center_config cc ON cc.code = n.cc_code
GROUP BY cc.code, cc.name, cc.nature
ORDER BY SUM(n.amount_total) DESC;
$$;

-- ─── RPC: overhead por cost center ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_overhead_by_cost_center(p_period text)
RETURNS TABLE(
  cost_center_code text,
  cost_center_name text,
  nature text,
  rent_mxn numeric,
  utilities_mxn numeric,
  other_overhead_mxn numeric,
  total_overhead_mxn numeric
)
LANGUAGE sql STABLE AS $$
WITH rent_per_dept AS (
  SELECT
    rla.cost_center_code,
    SUM(rla.monthly_amount_mxn * rla.allocation_pct / 100) /
      NULLIF((SELECT SUM(monthly_amount_mxn * allocation_pct / 100) FROM public.rent_lot_assignment WHERE effective_to IS NULL), 0)
      * COALESCE((SELECT SUM(balance) FROM public.canonical_account_balances
        WHERE account_code = '504.01.0008' AND period = p_period AND deprecated = false), 0)
      AS rent_actual
  FROM public.rent_lot_assignment rla
  WHERE rla.effective_to IS NULL OR rla.effective_to >= (p_period || '-01')::date
  GROUP BY rla.cost_center_code
),
direct_accounts AS (
  SELECT
    oaa.cost_center_code,
    SUM(cab.balance * oaa.allocation_pct / 100)::numeric AS amount
  FROM public.overhead_account_assignment oaa
  JOIN public.canonical_account_balances cab
    ON cab.account_code = oaa.account_code
    AND cab.period = p_period
    AND cab.deprecated = false
  WHERE (oaa.effective_to IS NULL OR oaa.effective_to >= (p_period || '-01')::date)
    AND oaa.account_code != '504.01.0008'
  GROUP BY oaa.cost_center_code
),
unassigned_504 AS (
  SELECT SUM(cab.balance) AS total_unassigned
  FROM public.canonical_account_balances cab
  WHERE cab.period = p_period
    AND cab.deprecated = false
    AND (cab.account_code LIKE '504%' AND cab.account_code != '504.01.0008')
    AND NOT EXISTS (
      SELECT 1 FROM public.overhead_account_assignment oaa
      WHERE oaa.account_code = cab.account_code
        AND (oaa.effective_to IS NULL OR oaa.effective_to >= (p_period || '-01')::date)
    )
)
SELECT
  cc.code, cc.name, cc.nature,
  COALESCE(rpd.rent_actual, 0)::numeric AS rent_mxn,
  COALESCE(da.amount, 0)::numeric AS utilities_mxn,
  CASE WHEN cc.nature = 'fabril_directo' THEN
    (SELECT total_unassigned FROM unassigned_504) * COALESCE(da.amount, 0) /
    NULLIF((SELECT SUM(amount) FROM direct_accounts), 0)
  ELSE 0 END AS other_overhead_mxn,
  (COALESCE(rpd.rent_actual, 0) + COALESCE(da.amount, 0) +
   CASE WHEN cc.nature = 'fabril_directo' THEN
    (SELECT total_unassigned FROM unassigned_504) * COALESCE(da.amount, 0) /
    NULLIF((SELECT SUM(amount) FROM direct_accounts), 0)
   ELSE 0 END
  )::numeric AS total_overhead_mxn
FROM public.cost_center_config cc
LEFT JOIN rent_per_dept rpd ON rpd.cost_center_code = cc.code
LEFT JOIN direct_accounts da ON da.cost_center_code = cc.code
WHERE cc.active = true
ORDER BY total_overhead_mxn DESC NULLS LAST;
$$;

-- ─── RPC: production por cost center ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_production_by_cost_center(p_period text)
RETURNS TABLE(
  cost_center_code text,
  cost_center_name text,
  qty_produced numeric,
  output_uom text,
  num_moves bigint,
  value_produced_mxn numeric
)
LANGUAGE sql STABLE AS $$
SELECT
  cc.code AS cost_center_code,
  cc.name AS cost_center_name,
  SUM(csm.quantity)::numeric AS qty_produced,
  cc.output_uom,
  COUNT(*)::bigint AS num_moves,
  SUM(csm.value)::numeric AS value_produced_mxn
FROM public.canonical_stock_moves csm
JOIN public.odoo_products op ON op.odoo_product_id = csm.odoo_product_id
JOIN public.cost_center_config cc ON
  (cc.code = 'TEJIDO' AND op.category ILIKE '%Tac-%Tejido Circular%')
  OR (cc.code = 'ACABADO' AND op.category ILIKE '%Tac-%Acabado%')
  OR (cc.code = 'TINTORERIA' AND op.category ILIKE '%Tac-%Teñido%')
  OR (cc.code = 'ENTRETELAS' AND op.category ILIKE '%Entretelas%' AND op.category NOT ILIKE '%Importación%')
WHERE csm.move_category = 'produccion_pt'
  AND csm.state = 'done'
  AND csm.date >= (p_period || '-01')::date
  AND csm.date < (date_trunc('month', (p_period || '-01')::date) + interval '1 month')::date
GROUP BY cc.code, cc.name, cc.output_uom
ORDER BY cc.code;
$$;
