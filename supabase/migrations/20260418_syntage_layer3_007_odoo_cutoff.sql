-- Fase 3 Layer 3 · 007 Odoo era cutoff (2021-01-01)
-- Quimibond empezó a usar Odoo en 2021. CFDIs pre-2021 en Syntage son
-- históricos fiscales del SAT que NUNCA tuvieron correspondencia en el ERP.
--
-- Impact en issue detection:
-- - sat_only_cfdi_issued (critical): 20,784 falsos positivos pre-2021 vs 9,985 reales
-- - sat_only_cfdi_received (medium): 9,620 falsos positivos pre-2021 vs 10,929 reales
--
-- Los otros 6 issue types no necesitan filtro: dependen de match UUID con Odoo
-- (cancelled_but_posted, amount_mismatch, posted_but_sat_uncertified, partner_blacklist_69b,
-- payment_missing_complemento, complemento_missing_payment). Si hay UUID match, ambos lados existen.

-- Constante lógica (no se guarda en tabla — vive solo aquí porque es fact histórico inmutable)
-- ODOO_ERA_START = '2021-01-01'

-- ============================================================================
-- 1. Bulk-resolve issues históricos pre-2021 ya abiertos
-- ============================================================================

WITH resolved AS (
  UPDATE public.reconciliation_issues ri
  SET resolved_at = now(),
      resolution = 'historical_pre_odoo',
      metadata = metadata || jsonb_build_object(
        'resolved_reason', 'Quimibond empezó a usar Odoo en 2021; CFDI pre-2021 no aplica'
      )
  FROM public.syntage_invoices s
  WHERE ri.resolved_at IS NULL
    AND ri.issue_type IN ('sat_only_cfdi_issued','sat_only_cfdi_received')
    AND ri.uuid_sat = s.uuid
    AND s.fecha_emision < '2021-01-01'
  RETURNING 1
)
SELECT count(*) AS historical_resolved FROM resolved;

-- ============================================================================
-- 2. Re-create refresh_invoices_unified with the pre-Odoo filter
-- ============================================================================

CREATE OR REPLACE FUNCTION public.refresh_invoices_unified()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '60s'
SET lock_timeout = '30s'
AS $$
DECLARE
  t_start    timestamptz := clock_timestamp();
  v_opened   integer := 0;
  v_resolved integer := 0;
  v_tmp      integer;
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.invoices_unified;

  -- ============================================================================
  -- AUTO-RESOLVE
  -- ============================================================================

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
  -- INSERT nuevos issues (con Odoo era cutoff para sat_only_*)
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

  -- posted_but_sat_uncertified · low · filtrado ≤30d
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

  -- sat_only_cfdi_received · medium · FILTRADO Odoo era (2021+)
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
      AND iu.fecha_timbrado >= '2021-01-01'  -- Quimibond empezó Odoo 2021-01
    ON CONFLICT (issue_type, canonical_id) WHERE resolved_at IS NULL DO NOTHING
    RETURNING 1
  ) SELECT count(*) INTO v_tmp FROM ins;
  v_opened := v_opened + v_tmp;

  -- sat_only_cfdi_issued · critical · FILTRADO Odoo era (2021+)
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
      AND iu.fecha_timbrado >= '2021-01-01'  -- Quimibond empezó Odoo 2021-01
    ON CONFLICT (issue_type, canonical_id) WHERE resolved_at IS NULL DO NOTHING
    RETURNING 1
  ) SELECT count(*) INTO v_tmp FROM ins;
  v_opened := v_opened + v_tmp;

  -- amount_mismatch · medium
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

  -- partner_blacklist_69b · medium · 1 por company
  WITH ins AS (
    INSERT INTO public.reconciliation_issues
      (issue_type, canonical_id, uuid_sat, odoo_invoice_id, odoo_company_id, company_id,
       description, severity, metadata)
    SELECT DISTINCT ON (iu.company_id, iu.odoo_company_id)
      'partner_blacklist_69b',
      'company:' || iu.company_id::text,
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

  -- Stale marker
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

COMMENT ON FUNCTION public.refresh_invoices_unified() IS 'Fase 3 · REFRESH CONCURRENTLY invoices_unified + repoblación de reconciliation_issues. sat_only_* filtrado a fecha_timbrado >= 2021-01-01 (Odoo era). Otros 6 tipos no requieren filtro (dependen de match UUID).';
