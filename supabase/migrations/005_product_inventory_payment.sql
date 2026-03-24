-- ============================================================
-- Migration 005: Product Purchase, Inventory & Payment Intelligence
-- Supports qb19 v19.0.22.0.0 (Bloques 1-3)
-- ============================================================

-- ── 1. Alert type catalog: add new types ────────────────────
INSERT INTO alert_type_catalog (alert_type, display_name, description, default_severity, category, is_active)
VALUES
  ('volume_drop',          'Caída de volumen',              'Producto con >30% menos volumen vs periodo anterior', 'medium', 'comercial', true),
  ('unusual_discount',     'Descuento inusual',             'Descuento aplicado fuera del rango histórico',        'medium', 'comercial', true),
  ('cross_sell',           'Oportunidad cross-sell',        'Producto que clientes similares compran',             'low',    'comercial', true),
  ('stockout_risk',        'Riesgo de desabasto',           'Producto con stock crítico o agotado',                'high',   'operativo', true),
  ('reorder_needed',       'Reorden necesario',             'Stock bajo o debajo del punto de reorden',            'medium', 'operativo', true),
  ('payment_compliance',   'Deterioro en pago',             'Tendencia de pago empeorando o compliance <40%',      'medium', 'financiero', true)
ON CONFLICT (alert_type) DO NOTHING;

-- ── 2. Contacts: add payment_compliance_score column ────────
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS payment_compliance_score integer;

-- ── 3. Customer health scores: add payment_compliance ───────
ALTER TABLE customer_health_scores
  ADD COLUMN IF NOT EXISTS payment_compliance_score integer;

-- ── 4. Fix RLS: add anon read for company_odoo_snapshots ────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'company_odoo_snapshots' AND policyname = 'anon_read_company_odoo_snapshots'
  ) THEN
    CREATE POLICY anon_read_company_odoo_snapshots ON company_odoo_snapshots
      FOR SELECT TO anon USING (true);
  END IF;
END
$$;

-- ── 5. Fix RLS: add anon read + insert for chat_memory ──────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'chat_memory' AND policyname = 'anon_read_chat_memory'
  ) THEN
    CREATE POLICY anon_read_chat_memory ON chat_memory
      FOR SELECT TO anon USING (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'chat_memory' AND policyname = 'anon_insert_chat_memory'
  ) THEN
    CREATE POLICY anon_insert_chat_memory ON chat_memory
      FOR INSERT TO anon WITH CHECK (true);
  END IF;
END
$$;
