-- Fase 3 Layer 3 · 004 refresh_invoices_unified + refresh_payments_unified
-- Ambas funciones ejecutan REFRESH CONCURRENTLY + repoblación de reconciliation_issues.

-- ============================================================================
-- refresh_invoices_unified()
-- ============================================================================

CREATE OR REPLACE FUNCTION public.refresh_invoices_unified()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  t_start    timestamptz := clock_timestamp();
  v_opened   integer := 0;
  v_resolved integer := 0;
  v_tmp      integer;
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.invoices_unified;

  -- ============================================================================
  -- AUTO-RESOLVE: cerrar issues que ya no aplican
  -- ============================================================================

  -- cancelled_but_posted → resuelto si Odoo ya no está posted o Syntage ya no cancelado
  WITH r AS (
    UPDATE public.reconciliation_issues ri
    SET resolved_at = now(), resolution = 'auto_odoo_updated'
    WHERE ri.resolved_at IS NULL
      AND ri.issue_type = 'cancelled_but_posted'
      AND NOT EXISTS (
        SELECT 1 FROM public.invoices_unified iu
        WHERE iu.canonical_id = ri.canonical_id
          AND iu.fiscal_operational_consistency = 'cancelled_but_posted'
      )
    RETURNING 1
  ) SELECT count(*) INTO v_tmp FROM r;
  v_resolved := v_resolved + v_tmp;

  -- posted_but_sat_uncertified → resuelto si Odoo ya tiene UUID o match composite apareció
  WITH r AS (
    UPDATE public.reconciliation_issues ri
    SET resolved_at = now(), resolution = 'auto_odoo_updated'
    WHERE ri.resolved_at IS NULL
      AND ri.issue_type = 'posted_but_sat_uncertified'
      AND NOT EXISTS (
        SELECT 1 FROM public.invoices_unified iu
        WHERE iu.canonical_id = ri.canonical_id
          AND iu.match_status = 'odoo_only'
          AND iu.odoo_state = 'posted'
          AND iu.uuid_sat IS NULL
      )
    RETURNING 1
  ) SELECT count(*) INTO v_tmp FROM r;
  v_resolved := v_resolved + v_tmp;

  -- sat_only_cfdi_received → resuelto si Odoo lo capturó
  WITH r AS (
    UPDATE public.reconciliation_issues ri
    SET resolved_at = now(), resolution = 'auto_odoo_updated'
    WHERE ri.resolved_at IS NULL
      AND ri.issue_type = 'sat_only_cfdi_received'
      AND NOT EXISTS (
        SELECT 1 FROM public.invoices_unified iu
        WHERE iu.canonical_id = ri.canonical_id
          AND iu.match_status = 'syntage_only'
          AND iu.direction = 'received'
      )
    RETURNING 1
  ) SELECT count(*) INTO v_tmp FROM r;
  v_resolved := v_resolved + v_tmp;

  -- sat_only_cfdi_issued → resuelto si Odoo lo capturó
  WITH r AS (
    UPDATE public.reconciliation_issues ri
    SET resolved_at = now(), resolution = 'auto_odoo_updated'
    WHERE ri.resolved_at IS NULL
      AND ri.issue_type = 'sat_only_cfdi_issued'
      AND NOT EXISTS (
        SELECT 1 FROM public.invoices_unified iu
        WHERE iu.canonical_id = ri.canonical_id
          AND iu.match_status = 'syntage_only'
          AND iu.direction = 'issued'
      )
    RETURNING 1
  ) SELECT count(*) INTO v_tmp FROM r;
  v_resolved := v_resolved + v_tmp;

  -- amount_mismatch → resuelto si ya matchea
  WITH r AS (
    UPDATE public.reconciliation_issues ri
    SET resolved_at = now(), resolution = 'auto_odoo_updated'
    WHERE ri.resolved_at IS NULL
      AND ri.issue_type = 'amount_mismatch'
      AND NOT EXISTS (
        SELECT 1 FROM public.invoices_unified iu
        WHERE iu.canonical_id = ri.canonical_id
          AND iu.fiscal_operational_consistency = 'amount_mismatch'
      )
    RETURNING 1
  ) SELECT count(*) INTO v_tmp FROM r;
  v_resolved := v_resolved + v_tmp;

  -- partner_blacklist_69b → resuelto si SAT removió el status
  WITH r AS (
    UPDATE public.reconciliation_issues ri
    SET resolved_at = now(), resolution = 'auto_syntage_updated'
    WHERE ri.resolved_at IS NULL
      AND ri.issue_type = 'partner_blacklist_69b'
      AND NOT EXISTS (
        SELECT 1 FROM public.invoices_unified iu
        WHERE iu.canonical_id = ri.canonical_id
          AND (iu.emisor_blacklist_status IN ('presumed','definitive')
            OR iu.receptor_blacklist_status IN ('presumed','definitive'))
      )
    RETURNING 1
  ) SELECT count(*) INTO v_tmp FROM r;
  v_resolved := v_resolved + v_tmp;

  -- ============================================================================
  -- INSERT: nuevos issues detectados
  -- ============================================================================

  -- cancelled_but_posted · severity high
  WITH ins AS (
    INSERT INTO public.reconciliation_issues
      (issue_type, canonical_id, uuid_sat, odoo_invoice_id, odoo_company_id, company_id,
       description, severity, metadata)
    SELECT
      'cancelled_but_posted',
      iu.canonical_id, iu.uuid_sat, iu.odoo_invoice_id, iu.odoo_company_id, iu.company_id,
      format('Syntage marca UUID %s como cancelado, Odoo sigue posted en %s', iu.uuid_sat, iu.odoo_ref),
      'high',
      jsonb_build_object(
        'counterparty_rfc', COALESCE(iu.emisor_rfc, iu.receptor_rfc),
        'detected_via', 'uuid',
        'fecha_cancelacion', iu.fecha_cancelacion
      )
    FROM public.invoices_unified iu
    WHERE iu.fiscal_operational_consistency = 'cancelled_but_posted'
    ON CONFLICT (issue_type, canonical_id) WHERE resolved_at IS NULL DO NOTHING
    RETURNING 1
  ) SELECT count(*) INTO v_tmp FROM ins;
  v_opened := v_opened + v_tmp;

  -- posted_but_sat_uncertified · severity low · FILTRADO a ≤30d
  WITH ins AS (
    INSERT INTO public.reconciliation_issues
      (issue_type, canonical_id, uuid_sat, odoo_invoice_id, odoo_company_id, company_id,
       description, severity, metadata)
    SELECT
      'posted_but_sat_uncertified',
      iu.canonical_id, NULL, iu.odoo_invoice_id, iu.odoo_company_id, iu.company_id,
      format('Odoo %s posted sin UUID SAT ni match composite', iu.odoo_ref),
      'low',
      jsonb_build_object(
        'counterparty_rfc', NULL,
        'detected_via', 'composite',
        'invoice_date', iu.invoice_date
      )
    FROM public.invoices_unified iu
    WHERE iu.match_status = 'odoo_only'
      AND iu.odoo_state = 'posted'
      AND iu.uuid_sat IS NULL
      AND iu.invoice_date > (now() - interval '30 days')::date
    ON CONFLICT (issue_type, canonical_id) WHERE resolved_at IS NULL DO NOTHING
    RETURNING 1
  ) SELECT count(*) INTO v_tmp FROM ins;
  v_opened := v_opened + v_tmp;

  -- sat_only_cfdi_received · severity medium
  WITH ins AS (
    INSERT INTO public.reconciliation_issues
      (issue_type, canonical_id, uuid_sat, odoo_invoice_id, odoo_company_id, company_id,
       description, severity, metadata)
    SELECT
      'sat_only_cfdi_received',
      iu.canonical_id, iu.uuid_sat, NULL, iu.odoo_company_id, NULL,
      format('CFDI recibido %s de %s no existe en Odoo (total fiscal $%s)',
             iu.uuid_sat, iu.emisor_nombre, iu.total_fiscal),
      'medium',
      jsonb_build_object(
        'counterparty_rfc', iu.emisor_rfc,
        'detected_via', 'uuid',
        'total_fiscal', iu.total_fiscal,
        'fecha_timbrado', iu.fecha_timbrado
      )
    FROM public.invoices_unified iu
    WHERE iu.match_status = 'syntage_only'
      AND iu.direction = 'received'
    ON CONFLICT (issue_type, canonical_id) WHERE resolved_at IS NULL DO NOTHING
    RETURNING 1
  ) SELECT count(*) INTO v_tmp FROM ins;
  v_opened := v_opened + v_tmp;

  -- sat_only_cfdi_issued · severity CRITICAL
  WITH ins AS (
    INSERT INTO public.reconciliation_issues
      (issue_type, canonical_id, uuid_sat, odoo_invoice_id, odoo_company_id, company_id,
       description, severity, metadata)
    SELECT
      'sat_only_cfdi_issued',
      iu.canonical_id, iu.uuid_sat, NULL, iu.odoo_company_id, NULL,
      format('CFDI emitido %s a %s no existe en Odoo (total fiscal $%s) — POSIBLE FRAUDE',
             iu.uuid_sat, iu.receptor_nombre, iu.total_fiscal),
      'critical',
      jsonb_build_object(
        'counterparty_rfc', iu.receptor_rfc,
        'detected_via', 'uuid',
        'total_fiscal', iu.total_fiscal,
        'fecha_timbrado', iu.fecha_timbrado
      )
    FROM public.invoices_unified iu
    WHERE iu.match_status = 'syntage_only'
      AND iu.direction = 'issued'
    ON CONFLICT (issue_type, canonical_id) WHERE resolved_at IS NULL DO NOTHING
    RETURNING 1
  ) SELECT count(*) INTO v_tmp FROM ins;
  v_opened := v_opened + v_tmp;

  -- amount_mismatch · severity medium
  WITH ins AS (
    INSERT INTO public.reconciliation_issues
      (issue_type, canonical_id, uuid_sat, odoo_invoice_id, odoo_company_id, company_id,
       description, severity, metadata)
    SELECT
      'amount_mismatch',
      iu.canonical_id, iu.uuid_sat, iu.odoo_invoice_id, iu.odoo_company_id, iu.company_id,
      format('UUID %s: total fiscal $%s vs Odoo $%s (diff $%s)',
             iu.uuid_sat, iu.total_fiscal, iu.odoo_amount_total, iu.amount_diff),
      'medium',
      jsonb_build_object(
        'counterparty_rfc', COALESCE(iu.emisor_rfc, iu.receptor_rfc),
        'detected_via', 'uuid',
        'amount_diff', iu.amount_diff,
        'severity_reason', CASE WHEN abs(iu.amount_diff) > 1000 THEN 'diff >$1000' ELSE 'diff minor' END
      )
    FROM public.invoices_unified iu
    WHERE iu.fiscal_operational_consistency = 'amount_mismatch'
    ON CONFLICT (issue_type, canonical_id) WHERE resolved_at IS NULL DO NOTHING
    RETURNING 1
  ) SELECT count(*) INTO v_tmp FROM ins;
  v_opened := v_opened + v_tmp;

  -- partner_blacklist_69b · severity medium · 1 issue por company_id
  WITH ins AS (
    INSERT INTO public.reconciliation_issues
      (issue_type, canonical_id, uuid_sat, odoo_invoice_id, odoo_company_id, company_id,
       description, severity, metadata)
    SELECT DISTINCT ON (iu.company_id, iu.odoo_company_id)
      'partner_blacklist_69b',
      'company:' || iu.company_id::text,  -- canonical_id sintético a nivel empresa
      NULL, NULL, iu.odoo_company_id, iu.company_id,
      format('Contraparte %s tiene status 69-B: %s',
             iu.partner_name,
             COALESCE(NULLIF(iu.emisor_blacklist_status, ''), iu.receptor_blacklist_status)),
      'medium',
      jsonb_build_object(
        'counterparty_rfc', COALESCE(iu.emisor_rfc, iu.receptor_rfc),
        'blacklist_status', COALESCE(NULLIF(iu.emisor_blacklist_status, ''), iu.receptor_blacklist_status),
        'detected_via', 'uuid'
      )
    FROM public.invoices_unified iu
    WHERE (iu.emisor_blacklist_status IN ('presumed','definitive')
        OR iu.receptor_blacklist_status IN ('presumed','definitive'))
      AND iu.company_id IS NOT NULL
    ON CONFLICT (issue_type, canonical_id) WHERE resolved_at IS NULL DO NOTHING
    RETURNING 1
  ) SELECT count(*) INTO v_tmp FROM ins;
  v_opened := v_opened + v_tmp;

  -- ============================================================================
  -- STALE: marcar issues sin resolución >7d como stale_7d (no son "nuevos")
  -- ============================================================================
  UPDATE public.reconciliation_issues
  SET resolution = 'stale_7d'
  WHERE resolved_at IS NULL
    AND detected_at < now() - interval '7 days'
    AND resolution IS NULL;

  RETURN jsonb_build_object(
    'refreshed_at', now(),
    'invoices_unified_rows', (SELECT count(*) FROM public.invoices_unified),
    'issues_opened', v_opened,
    'issues_resolved', v_resolved,
    'duration_ms', (extract(milliseconds FROM clock_timestamp() - t_start))::int
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_invoices_unified() TO service_role;

COMMENT ON FUNCTION public.refresh_invoices_unified() IS 'Fase 3 · REFRESH CONCURRENTLY invoices_unified + repoblación de reconciliation_issues (6 tipos: cancelled_but_posted, posted_but_sat_uncertified, sat_only_cfdi_received, sat_only_cfdi_issued, amount_mismatch, partner_blacklist_69b). Los 2 tipos de payments se manejan en refresh_payments_unified().';

-- ============================================================================
-- refresh_payments_unified()
-- ============================================================================

CREATE OR REPLACE FUNCTION public.refresh_payments_unified()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  t_start    timestamptz := clock_timestamp();
  v_opened   integer := 0;
  v_resolved integer := 0;
  v_tmp      integer;
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.payments_unified;

  -- AUTO-RESOLVE payment_missing_complemento
  WITH r AS (
    UPDATE public.reconciliation_issues ri
    SET resolved_at = now(), resolution = 'auto_syntage_updated'
    WHERE ri.resolved_at IS NULL
      AND ri.issue_type = 'payment_missing_complemento'
      AND EXISTS (
        -- Hay un Tipo P que ahora matchea esta factura
        SELECT 1 FROM public.payment_allocations_unified pa
        JOIN public.invoices_unified iu ON iu.canonical_id = ri.canonical_id
        WHERE pa.invoice_uuid_sat = iu.uuid_sat
      )
    RETURNING 1
  ) SELECT count(*) INTO v_tmp FROM r;
  v_resolved := v_resolved + v_tmp;

  -- AUTO-RESOLVE complemento_missing_payment
  WITH r AS (
    UPDATE public.reconciliation_issues ri
    SET resolved_at = now(), resolution = 'auto_odoo_updated'
    WHERE ri.resolved_at IS NULL
      AND ri.issue_type = 'complemento_missing_payment'
      AND NOT EXISTS (
        SELECT 1 FROM public.payments_unified pu
        WHERE pu.canonical_payment_id = ri.canonical_id
          AND pu.match_status = 'syntage_only'
      )
    RETURNING 1
  ) SELECT count(*) INTO v_tmp FROM r;
  v_resolved := v_resolved + v_tmp;

  -- INSERT payment_missing_complemento · severity high · FILTRADO: PPD + paid + ≥30d
  WITH candidates AS (
    SELECT iu.canonical_id, iu.uuid_sat, iu.odoo_invoice_id, iu.odoo_company_id, iu.company_id,
           iu.odoo_ref, iu.receptor_nombre, iu.emisor_nombre,
           iu.odoo_amount_total, iu.due_date, iu.invoice_date, iu.emisor_rfc, iu.receptor_rfc
    FROM public.invoices_unified iu
    WHERE iu.payment_state = 'paid'
      AND iu.metodo_pago = 'PPD'
      AND iu.invoice_date < (now() - interval '30 days')::date
      AND iu.uuid_sat IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.payment_allocations_unified pa
        WHERE pa.invoice_uuid_sat = iu.uuid_sat
      )
  ), ins AS (
    INSERT INTO public.reconciliation_issues
      (issue_type, canonical_id, uuid_sat, odoo_invoice_id, odoo_company_id, company_id,
       description, severity, metadata)
    SELECT
      'payment_missing_complemento',
      c.canonical_id, c.uuid_sat, c.odoo_invoice_id, c.odoo_company_id, c.company_id,
      format('Factura %s marcada paid (PPD) hace >30d, sin complemento Tipo P en SAT',
             c.odoo_ref),
      'high',
      jsonb_build_object(
        'counterparty_rfc', COALESCE(c.emisor_rfc, c.receptor_rfc),
        'detected_via', 'uuid',
        'days_overdue', (CURRENT_DATE - c.invoice_date),
        'amount_due', c.odoo_amount_total
      )
    FROM candidates c
    ON CONFLICT (issue_type, canonical_id) WHERE resolved_at IS NULL DO NOTHING
    RETURNING 1
  ) SELECT count(*) INTO v_tmp FROM ins;
  v_opened := v_opened + v_tmp;

  -- INSERT complemento_missing_payment · severity high
  WITH ins AS (
    INSERT INTO public.reconciliation_issues
      (issue_type, canonical_id, uuid_sat, odoo_invoice_id, odoo_payment_id, odoo_company_id, company_id,
       description, severity, metadata)
    SELECT
      'complemento_missing_payment',
      pu.canonical_payment_id, pu.uuid_complemento, NULL, NULL, pu.odoo_company_id, pu.company_id,
      format('Complemento Tipo P %s ($%s) no tiene pago matcheable en Odoo',
             pu.uuid_complemento, pu.monto),
      'high',
      jsonb_build_object(
        'counterparty_rfc', COALESCE(pu.rfc_emisor_cta_ord, pu.rfc_emisor_cta_ben),
        'detected_via', 'num_operacion',
        'amount', pu.monto,
        'fecha_pago', pu.fecha_pago
      )
    FROM public.payments_unified pu
    WHERE pu.match_status = 'syntage_only'
    ON CONFLICT (issue_type, canonical_id) WHERE resolved_at IS NULL DO NOTHING
    RETURNING 1
  ) SELECT count(*) INTO v_tmp FROM ins;
  v_opened := v_opened + v_tmp;

  RETURN jsonb_build_object(
    'refreshed_at', now(),
    'payments_unified_rows', (SELECT count(*) FROM public.payments_unified),
    'issues_opened', v_opened,
    'issues_resolved', v_resolved,
    'duration_ms', (extract(milliseconds FROM clock_timestamp() - t_start))::int
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_payments_unified() TO service_role;

COMMENT ON FUNCTION public.refresh_payments_unified() IS 'Fase 3 · REFRESH CONCURRENTLY payments_unified + populate 2 issue types: payment_missing_complemento, complemento_missing_payment.';
