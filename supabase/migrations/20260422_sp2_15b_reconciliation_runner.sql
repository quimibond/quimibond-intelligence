BEGIN;

-- Expand issue_type CHECK constraint to include new invariant-derived types
-- Existing: cancelled_but_posted, posted_but_sat_uncertified, sat_only_cfdi_received,
--           sat_only_cfdi_issued, amount_mismatch, partner_blacklist_69b,
--           payment_missing_complemento, complemento_missing_payment
-- New additions for SP2 invariants:
--   state_mismatch, date_drift, pending_op, missing_sat,
--   posted_no_uuid, credit_orphan, no_complement, no_odoo_payment

ALTER TABLE reconciliation_issues
  DROP CONSTRAINT reconciliation_issues_issue_type_check;

ALTER TABLE reconciliation_issues
  ADD CONSTRAINT reconciliation_issues_issue_type_check
  CHECK (issue_type = ANY (ARRAY[
    'cancelled_but_posted',
    'posted_but_sat_uncertified',
    'sat_only_cfdi_received',
    'sat_only_cfdi_issued',
    'amount_mismatch',
    'partner_blacklist_69b',
    'payment_missing_complemento',
    'complemento_missing_payment',
    'state_mismatch',
    'date_drift',
    'pending_op',
    'missing_sat',
    'posted_no_uuid',
    'credit_orphan',
    'no_complement',
    'no_odoo_payment'
  ]));

-- ─────────────────────────────────────────────────────────────────────────────
-- run_reconciliation(p_key text DEFAULT NULL)
--   Iterates enabled audit_tolerances rows and inserts / auto-resolves
--   reconciliation_issues for each invariant.
--   Returns: invariant_key, new_issues, auto_resolved per row.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION run_reconciliation(p_key text DEFAULT NULL)
RETURNS TABLE(
  invariant_key text,
  new_issues    integer,
  auto_resolved integer
) AS $$
DECLARE
  r          record;
  v_new      integer;
  v_resolved integer;
BEGIN
  FOR r IN
    SELECT t.invariant_key,
           t.abs_tolerance,
           t.pct_tolerance,
           t.severity_default,
           t.entity,
           t.auto_resolve,
           t.enabled
    FROM   audit_tolerances t
    WHERE  t.enabled = true
      AND  (p_key IS NULL OR t.invariant_key = p_key)
      AND  (t.invariant_key LIKE 'invoice.%' OR t.invariant_key LIKE 'payment.%')
  LOOP
    v_new      := 0;
    v_resolved := 0;

    -- ── invoice.amount_mismatch ───────────────────────────────────────────
    IF r.invariant_key = 'invoice.amount_mismatch' THEN
      WITH upserts AS (
        INSERT INTO reconciliation_issues (
          issue_type, invariant_key, severity,
          canonical_entity_type, canonical_entity_id, canonical_id,
          impact_mxn, description, metadata, detected_at
        )
        SELECT
          'amount_mismatch',
          r.invariant_key,
          r.severity_default,
          'invoice',
          ci.canonical_id,
          ci.canonical_id,
          ci.amount_total_mxn_diff_abs,
          'Amount mismatch Odoo vs SAT > tolerance',
          jsonb_build_object('diff_mxn', ci.amount_total_mxn_diff_abs),
          now()
        FROM canonical_invoices ci
        WHERE ci.has_odoo_record
          AND ci.has_sat_record
          AND ci.amount_total_has_discrepancy
          AND ci.amount_total_mxn_diff_abs > r.abs_tolerance
          AND NOT EXISTS (
            SELECT 1 FROM reconciliation_issues ri
            WHERE  ri.invariant_key       = r.invariant_key
              AND  ri.canonical_entity_id = ci.canonical_id
              AND  ri.resolved_at IS NULL
          )
        RETURNING 1
      )
      SELECT COUNT(*) INTO v_new FROM upserts;

      IF r.auto_resolve THEN
        WITH closed AS (
          UPDATE reconciliation_issues ri
          SET    resolved_at = now(), resolution = 'auto'
          WHERE  ri.invariant_key = r.invariant_key
            AND  ri.resolved_at IS NULL
            AND  NOT EXISTS (
              SELECT 1 FROM canonical_invoices ci
              WHERE  ci.canonical_id = ri.canonical_entity_id
                AND  ci.amount_total_has_discrepancy
                AND  ci.amount_total_mxn_diff_abs > r.abs_tolerance
            )
          RETURNING 1
        )
        SELECT COUNT(*) INTO v_resolved FROM closed;
      END IF;

    -- ── invoice.state_mismatch_posted_cancelled ────────────────────────────
    ELSIF r.invariant_key = 'invoice.state_mismatch_posted_cancelled' THEN
      WITH upserts AS (
        INSERT INTO reconciliation_issues (
          issue_type, invariant_key, severity,
          canonical_entity_type, canonical_entity_id, canonical_id,
          impact_mxn, description, metadata, detected_at
        )
        SELECT
          'state_mismatch',
          r.invariant_key,
          r.severity_default,
          'invoice',
          ci.canonical_id,
          ci.canonical_id,
          COALESCE(ci.amount_total_mxn_resolved, ci.amount_total_mxn_odoo, ci.amount_total_mxn_sat, 0),
          'Odoo posted + SAT cancelado',
          jsonb_build_object('estado_sat', ci.estado_sat, 'state_odoo', ci.state_odoo),
          now()
        FROM canonical_invoices ci
        WHERE ci.state_odoo  = 'posted'
          AND ci.estado_sat  = 'cancelado'
          AND NOT EXISTS (
            SELECT 1 FROM reconciliation_issues ri
            WHERE  ri.invariant_key       = r.invariant_key
              AND  ri.canonical_entity_id = ci.canonical_id
              AND  ri.resolved_at IS NULL
          )
        RETURNING 1
      )
      SELECT COUNT(*) INTO v_new FROM upserts;

      IF r.auto_resolve THEN
        WITH closed AS (
          UPDATE reconciliation_issues ri
          SET    resolved_at = now(), resolution = 'auto'
          WHERE  ri.invariant_key = r.invariant_key
            AND  ri.resolved_at IS NULL
            AND  NOT EXISTS (
              SELECT 1 FROM canonical_invoices ci
              WHERE  ci.canonical_id = ri.canonical_entity_id
                AND  ci.state_odoo   = 'posted'
                AND  ci.estado_sat   = 'cancelado'
            )
          RETURNING 1
        )
        SELECT COUNT(*) INTO v_resolved FROM closed;
      END IF;

    -- ── invoice.state_mismatch_cancel_vigente ──────────────────────────────
    ELSIF r.invariant_key = 'invoice.state_mismatch_cancel_vigente' THEN
      WITH upserts AS (
        INSERT INTO reconciliation_issues (
          issue_type, invariant_key, severity,
          canonical_entity_type, canonical_entity_id, canonical_id,
          impact_mxn, description, metadata, detected_at
        )
        SELECT
          'state_mismatch',
          r.invariant_key,
          r.severity_default,
          'invoice',
          ci.canonical_id,
          ci.canonical_id,
          COALESCE(ci.amount_total_mxn_resolved, ci.amount_total_mxn_odoo, ci.amount_total_mxn_sat, 0),
          'Odoo cancel + SAT vigente — human escalation',
          jsonb_build_object('estado_sat', ci.estado_sat, 'state_odoo', ci.state_odoo),
          now()
        FROM canonical_invoices ci
        WHERE ci.state_odoo = 'cancel'
          AND ci.estado_sat = 'vigente'
          AND NOT EXISTS (
            SELECT 1 FROM reconciliation_issues ri
            WHERE  ri.invariant_key       = r.invariant_key
              AND  ri.canonical_entity_id = ci.canonical_id
              AND  ri.resolved_at IS NULL
          )
        RETURNING 1
      )
      SELECT COUNT(*) INTO v_new FROM upserts;
      -- No auto_resolve for critical escalation invariant

    -- ── invoice.date_drift ────────────────────────────────────────────────
    ELSIF r.invariant_key = 'invoice.date_drift' THEN
      WITH upserts AS (
        INSERT INTO reconciliation_issues (
          issue_type, invariant_key, severity,
          canonical_entity_type, canonical_entity_id, canonical_id,
          impact_mxn, description, metadata, detected_at
        )
        SELECT
          'date_drift',
          r.invariant_key,
          r.severity_default,
          'invoice',
          ci.canonical_id,
          ci.canonical_id,
          0,
          'Invoice date drift > tolerance',
          jsonb_build_object('invoice_date', ci.invoice_date, 'fecha_timbrado', ci.fecha_timbrado),
          now()
        FROM canonical_invoices ci
        WHERE ci.date_has_discrepancy = true
          AND NOT EXISTS (
            SELECT 1 FROM reconciliation_issues ri
            WHERE  ri.invariant_key       = r.invariant_key
              AND  ri.canonical_entity_id = ci.canonical_id
              AND  ri.resolved_at IS NULL
          )
        RETURNING 1
      )
      SELECT COUNT(*) INTO v_new FROM upserts;

    -- ── invoice.pending_operationalization ────────────────────────────────
    ELSIF r.invariant_key = 'invoice.pending_operationalization' THEN
      WITH upserts AS (
        INSERT INTO reconciliation_issues (
          issue_type, invariant_key, severity,
          canonical_entity_type, canonical_entity_id, canonical_id,
          impact_mxn, description, action_cta, detected_at
        )
        SELECT
          'pending_op',
          r.invariant_key,
          r.severity_default,
          'invoice',
          ci.canonical_id,
          ci.canonical_id,
          COALESCE(ci.amount_total_mxn_sat, ci.amount_total_mxn_odoo, 0),
          'CFDI SAT sin Odoo post-2021',
          'operationalize',
          now()
        FROM canonical_invoices ci
        WHERE ci.pending_operationalization = true
          AND NOT EXISTS (
            SELECT 1 FROM reconciliation_issues ri
            WHERE  ri.invariant_key       = r.invariant_key
              AND  ri.canonical_entity_id = ci.canonical_id
              AND  ri.resolved_at IS NULL
          )
        RETURNING 1
      )
      SELECT COUNT(*) INTO v_new FROM upserts;

      IF r.auto_resolve THEN
        WITH closed AS (
          UPDATE reconciliation_issues ri
          SET    resolved_at = now(), resolution = 'auto'
          WHERE  ri.invariant_key = r.invariant_key
            AND  ri.resolved_at IS NULL
            AND  EXISTS (
              SELECT 1 FROM canonical_invoices ci
              WHERE  ci.canonical_id   = ri.canonical_entity_id
                AND  ci.has_odoo_record = true
            )
          RETURNING 1
        )
        SELECT COUNT(*) INTO v_resolved FROM closed;
      END IF;

    -- ── invoice.missing_sat_timbrado ──────────────────────────────────────
    ELSIF r.invariant_key = 'invoice.missing_sat_timbrado' THEN
      WITH upserts AS (
        INSERT INTO reconciliation_issues (
          issue_type, invariant_key, severity,
          canonical_entity_type, canonical_entity_id, canonical_id,
          impact_mxn, description, detected_at
        )
        SELECT
          'missing_sat',
          r.invariant_key,
          r.severity_default,
          'invoice',
          ci.canonical_id,
          ci.canonical_id,
          COALESCE(ci.amount_total_mxn_odoo, 0),
          'Odoo posted >7d sin CFDI SAT',
          now()
        FROM canonical_invoices ci
        WHERE ci.state_odoo     = 'posted'
          AND ci.has_odoo_record = true
          AND ci.has_sat_record  = false
          AND ci.invoice_date IS NOT NULL
          AND ci.invoice_date < (current_date - r.abs_tolerance::integer)
          AND NOT EXISTS (
            SELECT 1 FROM reconciliation_issues ri
            WHERE  ri.invariant_key       = r.invariant_key
              AND  ri.canonical_entity_id = ci.canonical_id
              AND  ri.resolved_at IS NULL
          )
        RETURNING 1
      )
      SELECT COUNT(*) INTO v_new FROM upserts;

      IF r.auto_resolve THEN
        WITH closed AS (
          UPDATE reconciliation_issues ri
          SET    resolved_at = now(), resolution = 'auto'
          WHERE  ri.invariant_key = r.invariant_key
            AND  ri.resolved_at IS NULL
            AND  EXISTS (
              SELECT 1 FROM canonical_invoices ci
              WHERE  ci.canonical_id   = ri.canonical_entity_id
                AND  ci.has_sat_record  = true
            )
          RETURNING 1
        )
        SELECT COUNT(*) INTO v_resolved FROM closed;
      END IF;

    -- ── invoice.posted_without_uuid ───────────────────────────────────────
    ELSIF r.invariant_key = 'invoice.posted_without_uuid' THEN
      WITH upserts AS (
        INSERT INTO reconciliation_issues (
          issue_type, invariant_key, severity,
          canonical_entity_type, canonical_entity_id, canonical_id,
          impact_mxn, description, detected_at
        )
        SELECT
          'posted_no_uuid',
          r.invariant_key,
          r.severity_default,
          'invoice',
          ci.canonical_id,
          ci.canonical_id,
          COALESCE(ci.amount_total_mxn_odoo, 0),
          'Odoo posted sin cfdi_uuid (post-addon-fix)',
          now()
        FROM canonical_invoices ci
        WHERE ci.state_odoo      = 'posted'
          AND ci.has_odoo_record  = true
          AND ci.cfdi_uuid_odoo  IS NULL
          AND ci.invoice_date    >= '2021-01-01'
          AND NOT EXISTS (
            SELECT 1 FROM reconciliation_issues ri
            WHERE  ri.invariant_key       = r.invariant_key
              AND  ri.canonical_entity_id = ci.canonical_id
              AND  ri.resolved_at IS NULL
          )
        RETURNING 1
      )
      SELECT COUNT(*) INTO v_new FROM upserts;

    -- ── invoice.credit_note_orphan ────────────────────────────────────────
    ELSIF r.invariant_key = 'invoice.credit_note_orphan' THEN
      WITH upserts AS (
        INSERT INTO reconciliation_issues (
          issue_type, invariant_key, severity,
          canonical_entity_type, canonical_entity_id, canonical_id,
          impact_mxn, description, detected_at
        )
        SELECT
          'credit_orphan',
          r.invariant_key,
          r.severity_default,
          'credit_note',
          ccn.canonical_id,
          ccn.canonical_id,
          COALESCE(ccn.amount_total_mxn_resolved, ccn.amount_total_mxn_sat, 0),
          'Egreso SAT sin factura origen resuelta',
          now()
        FROM canonical_credit_notes ccn
        WHERE ccn.has_sat_record                = true
          AND ccn.fecha_timbrado               >= '2021-01-01'::timestamptz
          AND ccn.related_invoice_uuid         IS NOT NULL
          AND ccn.related_invoice_canonical_id IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM reconciliation_issues ri
            WHERE  ri.invariant_key       = r.invariant_key
              AND  ri.canonical_entity_id = ccn.canonical_id
              AND  ri.resolved_at IS NULL
          )
        RETURNING 1
      )
      SELECT COUNT(*) INTO v_new FROM upserts;

    -- ── payment.registered_without_complement ─────────────────────────────
    ELSIF r.invariant_key = 'payment.registered_without_complement' THEN
      WITH upserts AS (
        INSERT INTO reconciliation_issues (
          issue_type, invariant_key, severity,
          canonical_entity_type, canonical_entity_id, canonical_id,
          impact_mxn, description, detected_at
        )
        SELECT
          'no_complement',
          r.invariant_key,
          r.severity_default,
          'payment',
          cp.canonical_id,
          cp.canonical_id,
          COALESCE(cp.amount_mxn_resolved, 0),
          'Odoo paid PPD sin complemento >30d',
          now()
        FROM canonical_payments cp
        WHERE cp.registered_but_not_fiscally_confirmed = true
          AND cp.payment_date_odoo < (current_date - r.abs_tolerance::integer)
          AND NOT EXISTS (
            SELECT 1 FROM reconciliation_issues ri
            WHERE  ri.invariant_key       = r.invariant_key
              AND  ri.canonical_entity_id = cp.canonical_id
              AND  ri.resolved_at IS NULL
          )
        RETURNING 1
      )
      SELECT COUNT(*) INTO v_new FROM upserts;

      IF r.auto_resolve THEN
        WITH closed AS (
          UPDATE reconciliation_issues ri
          SET    resolved_at = now(), resolution = 'auto'
          WHERE  ri.invariant_key = r.invariant_key
            AND  ri.resolved_at IS NULL
            AND  EXISTS (
              SELECT 1 FROM canonical_payments cp
              WHERE  cp.canonical_id  = ri.canonical_entity_id
                AND  cp.has_sat_record = true
            )
          RETURNING 1
        )
        SELECT COUNT(*) INTO v_resolved FROM closed;
      END IF;

    -- ── payment.complement_without_payment ────────────────────────────────
    ELSIF r.invariant_key = 'payment.complement_without_payment' THEN
      WITH upserts AS (
        INSERT INTO reconciliation_issues (
          issue_type, invariant_key, severity,
          canonical_entity_type, canonical_entity_id, canonical_id,
          impact_mxn, description, detected_at
        )
        SELECT
          'no_odoo_payment',
          r.invariant_key,
          r.severity_default,
          'payment',
          cp.canonical_id,
          cp.canonical_id,
          COALESCE(cp.amount_mxn_resolved, 0),
          'Complemento SAT sin Odoo >30d',
          now()
        FROM canonical_payments cp
        WHERE cp.complement_without_payment = true
          AND cp.fecha_pago_sat < (now() - (r.abs_tolerance::integer || ' days')::interval)
          AND NOT EXISTS (
            SELECT 1 FROM reconciliation_issues ri
            WHERE  ri.invariant_key       = r.invariant_key
              AND  ri.canonical_entity_id = cp.canonical_id
              AND  ri.resolved_at IS NULL
          )
        RETURNING 1
      )
      SELECT COUNT(*) INTO v_new FROM upserts;

      IF r.auto_resolve THEN
        WITH closed AS (
          UPDATE reconciliation_issues ri
          SET    resolved_at = now(), resolution = 'auto'
          WHERE  ri.invariant_key = r.invariant_key
            AND  ri.resolved_at IS NULL
            AND  EXISTS (
              SELECT 1 FROM canonical_payments cp
              WHERE  cp.canonical_id   = ri.canonical_entity_id
                AND  cp.has_odoo_record = true
            )
          RETURNING 1
        )
        SELECT COUNT(*) INTO v_resolved FROM closed;
      END IF;
    END IF;

    invariant_key := r.invariant_key;
    new_issues    := v_new;
    auto_resolved := v_resolved;
    RETURN NEXT;
  END LOOP;
  RETURN;
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────────────────────────────────────
-- compute_priority_scores()
--   Updates priority_score on all open reconciliation_issues.
--   Formula: severity_weight * LOG(impact_mxn+1) * age_factor * cta_factor
--   Returns: count of rows updated.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION compute_priority_scores() RETURNS integer AS $$
DECLARE
  v_updated integer;
BEGIN
  WITH sw AS (
    SELECT 'critical' AS sev, 10::numeric AS w
    UNION ALL SELECT 'high',   5
    UNION ALL SELECT 'medium', 2
    UNION ALL SELECT 'low',    1
  )
  UPDATE reconciliation_issues ri
  SET    priority_score =
           sw.w
           * LOG(ABS(COALESCE(ri.impact_mxn, 0)) + 1)
           * LEAST(1.0 + (COALESCE(ri.age_days, 0) / 30.0), 3.0)
           * CASE WHEN ri.action_cta IS NOT NULL THEN 1.5 ELSE 1.0 END
  FROM   sw
  WHERE  sw.sev = ri.severity
    AND  ri.resolved_at IS NULL;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$ LANGUAGE plpgsql;

INSERT INTO schema_changes (change_type, table_name, description, sql_executed, triggered_by, success)
VALUES ('create_function', 'reconciliation_issues',
        'SP2 Task 15b: run_reconciliation + compute_priority_scores + expand issue_type constraint',
        '20260422_sp2_15b_reconciliation_runner.sql', 'silver-sp2', true);

COMMIT;
