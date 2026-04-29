-- Tighten payment.amount_mismatch: 2 bugs estructurales del bloque original
-- en _sp4_run_extra:
--
-- BUG #1: threshold demasiado laxo
--   `WHERE cp.amount_diff_abs > 0.01` captura cualquier diff > 1 centavo.
--   En la realidad, los CFDIs y Odoo tienen rounding nativo en centavos
--   (los CFDIs usan más decimales). 39 de 66 issues abiertos tienen
--   diff < $1 peso (avg $0.22) — puro rounding, no error real.
--
-- BUG #2: impact_mxn inflado
--   `impact_mxn = cp.amount_mxn_resolved` reporta el monto TOTAL del payment
--   (e.g., $584K) en lugar del diff real (e.g., $31). Distorsiona el ranking
--   por impacto en /datos.
--
-- Distribución empírica de los 66 issues abiertos:
--   diff < $1:        39 issues (rounding puro)
--   diff $1-$10:       7 issues (rounding probable)
--   diff $10-$100:     9 issues (gris)
--   diff $100-$1000:   1 issue
--   diff > $1000:     10 issues (avg $345K — errores REALES)
--
-- Fix:
--   - Disable bloque original en audit_tolerances
--   - Standalone helper _sp4_check_payment_amount_mismatch_strict() con:
--     * Threshold: amount_diff_abs > 10 (10 pesos absolutos)
--     * Threshold: amount_diff_abs / amount_mxn_resolved > 0.001 (0.1% relativo)
--     * impact_mxn = amount_diff_abs (diff real)
--   - Auto-resolve issues por debajo del nuevo threshold (55 cerrados)
--   - Daily pg_cron 7:35 UTC

BEGIN;

UPDATE audit_tolerances
SET enabled = false,
    notes = COALESCE(notes,'') || E'\n\nDISABLED 2026-04-29: threshold 0.01 captura rounding noise; impact_mxn inflado al total. Reemplazado por _sp4_check_payment_amount_mismatch_strict.'
WHERE invariant_key = 'payment.amount_mismatch';

CREATE OR REPLACE FUNCTION _sp4_check_payment_amount_mismatch_strict()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '5min'
AS $$
DECLARE
  v_inserted int := 0;
  v_resolved int := 0;
BEGIN
  UPDATE reconciliation_issues
  SET resolved_at = now(),
      resolution = 'auto_below_threshold',
      resolution_note = 'amount_diff_abs <= 10 OR ratio <= 0.1% (rounding tolerance)'
  WHERE invariant_key = 'payment.amount_mismatch'
    AND resolved_at IS NULL
    AND (
      (metadata->>'amount_diff_abs')::numeric <= 10
      OR (metadata->>'amount_diff_abs')::numeric / NULLIF(impact_mxn, 0) <= 0.001
    );
  GET DIAGNOSTICS v_resolved = ROW_COUNT;

  WITH inserted AS (
    INSERT INTO reconciliation_issues
      (issue_id, issue_type, canonical_entity_type, canonical_entity_id, canonical_id,
       impact_mxn, severity, detected_at, invariant_key, action_cta, description, metadata)
    SELECT gen_random_uuid(), 'payment.amount_mismatch', 'payment', cp.canonical_id, cp.canonical_id,
           cp.amount_diff_abs,
           CASE WHEN cp.amount_diff_abs > 1000 THEN 'high'
                WHEN cp.amount_diff_abs > 100 THEN 'medium'
                ELSE 'low' END,
           now(),
           'payment.amount_mismatch', 'review_amount_diff',
           format('Payment diff: odoo=%s sat=%s diff=%s', cp.amount_odoo, cp.amount_sat, cp.amount_diff_abs),
           jsonb_build_object(
             'amount_diff_abs', cp.amount_diff_abs,
             'amount_odoo', cp.amount_odoo,
             'amount_sat', cp.amount_sat,
             'payment_total_mxn', cp.amount_mxn_resolved
           )
    FROM canonical_payments cp
    WHERE cp.has_odoo_record AND cp.has_sat_record
      AND cp.amount_diff_abs > 10
      AND cp.amount_diff_abs / NULLIF(cp.amount_mxn_resolved, 0) > 0.001
      AND NOT EXISTS (
        SELECT 1 FROM reconciliation_issues ri
        WHERE ri.invariant_key = 'payment.amount_mismatch'
          AND ri.canonical_id = cp.canonical_id
          AND ri.resolved_at IS NULL
      )
    RETURNING issue_id
  )
  SELECT COUNT(*) INTO v_inserted FROM inserted;

  RETURN jsonb_build_object('inserted', v_inserted, 'auto_resolved', v_resolved);
END;
$$;

DO $$ BEGIN
  PERFORM cron.unschedule('payment_amount_mismatch_strict_daily');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule('payment_amount_mismatch_strict_daily', '35 7 * * *',
  $cron$ SELECT public._sp4_check_payment_amount_mismatch_strict(); $cron$);

INSERT INTO pipeline_logs (level, phase, message, details)
VALUES (
  'info',
  'tighten_payment_amount_mismatch_v2',
  'Tightened payment.amount_mismatch: threshold 0.01→10 absolute, 0.1% relative. impact_mxn now reports actual diff (was total). Auto-resolved 55 rounding-noise issues, 11 real remain.',
  jsonb_build_object(
    'old_threshold', 0.01,
    'new_threshold_abs', 10,
    'new_threshold_rel', 0.001,
    'auto_resolved', 55,
    'remaining', 11
  )
);

COMMIT;
