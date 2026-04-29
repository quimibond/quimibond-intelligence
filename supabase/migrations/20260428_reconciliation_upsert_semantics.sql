-- supabase/migrations/20260428_reconciliation_upsert_semantics.sql
--
-- P1-7 audit fix (2026-04-28): UPSERT semantics en run_reconciliation
--
-- ROOT CAUSE
-- ----------
-- run_reconciliation invariantes hacen INSERT con NOT EXISTS guard que solo
-- chequea `resolved_at IS NULL`. El flujo problemático:
--   1. Issue detectada → INSERT (open).
--   2. auto_resolve cierra → UPDATE resolved_at = now().
--   3. Próxima corrida: condición sigue cierta → INSERT NUEVO row (issue_id distinto).
-- Resultado: churn 22-98% en 5 invariantes, e.g. payment.complement_*
-- con 127k rows históricos para 12k abiertos hoy.
--
-- FIX
-- ---
-- BEFORE INSERT trigger sobre reconciliation_issues que detecta si existe row
-- previamente resuelto con misma (invariant_key, canonical_id). Si existe:
--   - Re-abre el row (resolved_at = NULL, resolution = NULL).
--   - Refresca detected_at + mutable fields (severity, impact_mxn, description).
--   - Incrementa metadata.reopen_count + setea metadata.last_reopen_at.
--   - Skip del INSERT original.
-- Si no existe row resuelto previo: proceed con INSERT normal.
--
-- Side effect: run_reconciliation v_new ahora cuenta solo INSERTs realmente
-- nuevos (no re-opens). Acceptable — el UI distingue open vs resolved.

BEGIN;

-- ============================================================
-- Index para lookup de re-open (resolved rows por invariant + canonical)
-- ============================================================

CREATE INDEX IF NOT EXISTS reconciliation_issues_reopen_lookup_idx
  ON public.reconciliation_issues (invariant_key, canonical_id, resolved_at DESC)
  WHERE resolved_at IS NOT NULL
    AND invariant_key IS NOT NULL
    AND canonical_id  IS NOT NULL;

-- ============================================================
-- Trigger function: re-open instead of duplicate-insert
-- ============================================================

CREATE OR REPLACE FUNCTION reconciliation_issues_reopen_trigger()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_existing_id   uuid;
  v_existing_meta jsonb;
BEGIN
  -- Skip legacy/NULL paths — trigger solo aplica cuando ambos están seteados
  IF NEW.invariant_key IS NULL OR NEW.canonical_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Buscar el row resuelto más reciente con misma (invariant_key, canonical_id)
  SELECT issue_id, metadata
    INTO v_existing_id, v_existing_meta
    FROM public.reconciliation_issues
   WHERE invariant_key = NEW.invariant_key
     AND canonical_id  = NEW.canonical_id
     AND resolved_at IS NOT NULL
   ORDER BY resolved_at DESC
   LIMIT 1;

  IF v_existing_id IS NULL THEN
    -- No hay row resuelto previo → INSERT normal
    RETURN NEW;
  END IF;

  -- Re-abrir el row existente
  UPDATE public.reconciliation_issues
     SET resolved_at = NULL,
         resolution  = NULL,
         detected_at = NEW.detected_at,
         severity    = NEW.severity,
         impact_mxn  = NEW.impact_mxn,
         description = NEW.description,
         metadata    = COALESCE(v_existing_meta, '{}'::jsonb)
                       || COALESCE(NEW.metadata, '{}'::jsonb)
                       || jsonb_build_object(
                            'reopen_count',
                              COALESCE((v_existing_meta->>'reopen_count')::int, 0) + 1,
                            'last_reopen_at', now()
                          )
   WHERE issue_id = v_existing_id;

  RETURN NULL;  -- Skip del INSERT original
END;
$$;

COMMENT ON FUNCTION reconciliation_issues_reopen_trigger() IS
  'P1-7 fix (2026-04-28): UPSERT semantics — re-open resolved issue con misma (invariant_key, canonical_id) en lugar de insertar row nuevo. Elimina churn (22-98%) en 5 invariantes.';

-- ============================================================
-- Trigger registration
-- ============================================================

DROP TRIGGER IF EXISTS reconciliation_issues_reopen_before_insert
  ON public.reconciliation_issues;

CREATE TRIGGER reconciliation_issues_reopen_before_insert
BEFORE INSERT ON public.reconciliation_issues
FOR EACH ROW
EXECUTE FUNCTION reconciliation_issues_reopen_trigger();

-- ============================================================
-- Audit
-- ============================================================

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES
  ('CREATE_FUNCTION', 'reconciliation_issues_reopen_trigger',
   'P1-7 audit fix: UPSERT semantics via BEFORE INSERT trigger en reconciliation_issues',
   'supabase/migrations/20260428_reconciliation_upsert_semantics.sql',
   'audit-2026-04-28-p1-7', true);

COMMIT;
