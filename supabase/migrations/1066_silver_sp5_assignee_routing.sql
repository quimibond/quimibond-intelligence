-- Migration: 1066_silver_sp5_assignee_routing
-- Task 25: Seeds invariant_routing (namespace→department→canonical_contact_id)
-- and runs sp5_assign_issues() to populate assignee_canonical_contact_id on all open issues.
--
-- Namespace inventory (live DB, 2026-04-21):
--   payment             73,529 open
--   invoice             35,016 open
--   order                6,259 open
--   mfg                    963 open
--   delivery               276 open
--   tax                     57 open
--   orderpoint_untuned      19 open
--   line_price_mismatch      9 open
--   fx_rate                  1 open
--
-- Mapping adapted to LIVE canonical_contacts (contact_type LIKE 'internal_%'):
--   Cobranza lead:  Sandra Dávila        → canonical_contacts.id = 15
--   Ventas lead:    Guadalupe Guerrero   → canonical_contacts.id = 36
--   Produccion lead: Guadalupe Ramos     → canonical_contacts.id = 37
--   Logistica lead: Dario Manriquez      → canonical_contacts.id = 27
--   Almacen lead:   Gustavo Delgado      → canonical_contacts.id = 41
--   Compras lead:   Elena Delgado Ruiz   → canonical_contacts.id = 31
--   Finanzas/Admin: Irma Luna            → canonical_contacts.id = 42
--   Sistemas lead:  Mariano Dominguez    → canonical_contacts.id = 38
--
-- Note: canonical_contacts has NO department_name column; `department` text exists but is
-- mostly NULL for internal_user records. Routing uses hardcoded ids verified from live DB.

BEGIN;

-- 1. invariant_routing table
CREATE TABLE IF NOT EXISTS invariant_routing (
  invariant_namespace       text        PRIMARY KEY,
  department_name           text        NOT NULL,
  canonical_contact_id      bigint      REFERENCES canonical_contacts(id),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

-- 2. Seed rows — one per namespace found in reconciliation_issues
--    contact ids are hardcoded from live-DB verification (2026-04-21)
INSERT INTO invariant_routing (invariant_namespace, department_name, canonical_contact_id)
VALUES
  ('payment',             'Cobranza',    15),   -- Sandra Dávila
  ('invoice',             'Cobranza',    15),   -- Sandra Dávila
  ('order',               'Ventas',      36),   -- Guadalupe Guerrero García
  ('mfg',                 'Produccion',  37),   -- Guadalupe Ramos
  ('delivery',            'Logistica',   27),   -- Dario Manriquez
  ('tax',                 'Finanzas',    42),   -- Irma Luna (Contador General)
  ('orderpoint_untuned',  'Almacen',     41),   -- Gustavo Delgado
  ('line_price_mismatch', 'Ventas',      36),   -- Guadalupe Guerrero García
  ('fx_rate',             'Finanzas',    42)    -- Irma Luna
ON CONFLICT (invariant_namespace) DO UPDATE SET
  department_name      = EXCLUDED.department_name,
  canonical_contact_id = COALESCE(invariant_routing.canonical_contact_id, EXCLUDED.canonical_contact_id),
  updated_at           = now();

-- 3. Function: assign open unassigned issues via namespace routing
CREATE OR REPLACE FUNCTION sp5_assign_issues() RETURNS int
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  UPDATE reconciliation_issues r
  SET assignee_canonical_contact_id = ir.canonical_contact_id,
      assigned_at = COALESCE(r.assigned_at, now())
  FROM invariant_routing ir
  WHERE r.resolved_at IS NULL
    AND r.assignee_canonical_contact_id IS NULL
    AND r.invariant_key IS NOT NULL
    AND SPLIT_PART(r.invariant_key, '.', 1) = ir.invariant_namespace
    AND ir.canonical_contact_id IS NOT NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- 4. Run once to backfill all open issues
DO $$
DECLARE n int;
BEGIN
  SELECT sp5_assign_issues() INTO n;
  INSERT INTO audit_runs (run_id, run_at, source, model, invariant_key, bucket_key, severity, details)
  VALUES (
    gen_random_uuid(),
    now(),
    'supabase',
    'silver_sp5',
    'sp5.task25',
    'sp5_task25_routing',
    'ok',
    jsonb_build_object(
      'label',         'sp5_task25_assignee_routing',
      'rows_assigned', n
    )
  );
END $$;

-- 5. schema_changes log (idempotent)
INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
SELECT
  'CREATE_FUNCTION',
  'reconciliation_issues',
  'invariant_routing seed + sp5_assign_issues() populated assignee_canonical_contact_id on all open issues',
  'see migration 1066_silver_sp5_assignee_routing',
  'silver-sp5-task-25',
  true
WHERE NOT EXISTS (
  SELECT 1 FROM schema_changes WHERE triggered_by = 'silver-sp5-task-25'
);

COMMIT;
