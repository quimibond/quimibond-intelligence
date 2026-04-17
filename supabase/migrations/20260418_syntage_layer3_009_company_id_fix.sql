-- Fase 5 · 009 reconciliation_issues.company_id populate + backfill
-- Fix del bug Fase 3 donde sat_only_* dejaban company_id NULL.

-- 1. Backfill: populate company_id en issues ya abiertos donde rfc existe en companies
UPDATE public.reconciliation_issues ri
SET company_id = c.id
FROM public.syntage_invoices s, public.companies c
WHERE ri.company_id IS NULL
  AND ri.uuid_sat = s.uuid
  AND ri.issue_type IN ('sat_only_cfdi_issued','sat_only_cfdi_received')
  AND lower(c.rfc) = lower(CASE
    WHEN ri.issue_type='sat_only_cfdi_issued' THEN s.receptor_rfc
    ELSE s.emisor_rfc END);

-- 2. CREATE OR REPLACE refresh_invoices_unified con company_id lookup en INSERT de sat_only_*
-- (copia completa de la función existente con modificación de 2 INSERT blocks)

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

  -- AUTO-RESOLVE (6 tipos) — sin cambios
  WITH r AS (UPDATE public.reconciliation_issues ri SET resolved_at=now(), resolution='auto_odoo_updated'
    WHERE ri.resolved_at IS NULL AND ri.issue_type='cancelled_but_posted'
      AND NOT EXISTS (SELECT 1 FROM public.invoices_unified iu WHERE iu.canonical_id=ri.canonical_id AND iu.fiscal_operational_consistency='cancelled_but_posted')
    RETURNING 1) SELECT count(*) INTO v_tmp FROM r; v_resolved := v_resolved + v_tmp;

  WITH r AS (UPDATE public.reconciliation_issues ri SET resolved_at=now(), resolution='auto_odoo_updated'
    WHERE ri.resolved_at IS NULL AND ri.issue_type='posted_but_sat_uncertified'
      AND NOT EXISTS (SELECT 1 FROM public.invoices_unified iu WHERE iu.canonical_id=ri.canonical_id AND iu.match_status='odoo_only' AND iu.odoo_state='posted' AND iu.uuid_sat IS NULL)
    RETURNING 1) SELECT count(*) INTO v_tmp FROM r; v_resolved := v_resolved + v_tmp;

  WITH r AS (UPDATE public.reconciliation_issues ri SET resolved_at=now(), resolution='auto_odoo_updated'
    WHERE ri.resolved_at IS NULL AND ri.issue_type='sat_only_cfdi_received'
      AND NOT EXISTS (SELECT 1 FROM public.invoices_unified iu WHERE iu.canonical_id=ri.canonical_id AND iu.match_status='syntage_only' AND iu.direction='received')
    RETURNING 1) SELECT count(*) INTO v_tmp FROM r; v_resolved := v_resolved + v_tmp;

  WITH r AS (UPDATE public.reconciliation_issues ri SET resolved_at=now(), resolution='auto_odoo_updated'
    WHERE ri.resolved_at IS NULL AND ri.issue_type='sat_only_cfdi_issued'
      AND NOT EXISTS (SELECT 1 FROM public.invoices_unified iu WHERE iu.canonical_id=ri.canonical_id AND iu.match_status='syntage_only' AND iu.direction='issued')
    RETURNING 1) SELECT count(*) INTO v_tmp FROM r; v_resolved := v_resolved + v_tmp;

  WITH r AS (UPDATE public.reconciliation_issues ri SET resolved_at=now(), resolution='auto_odoo_updated'
    WHERE ri.resolved_at IS NULL AND ri.issue_type='amount_mismatch'
      AND NOT EXISTS (SELECT 1 FROM public.invoices_unified iu WHERE iu.canonical_id=ri.canonical_id AND iu.fiscal_operational_consistency='amount_mismatch')
    RETURNING 1) SELECT count(*) INTO v_tmp FROM r; v_resolved := v_resolved + v_tmp;

  WITH r AS (UPDATE public.reconciliation_issues ri SET resolved_at=now(), resolution='auto_syntage_updated'
    WHERE ri.resolved_at IS NULL AND ri.issue_type='partner_blacklist_69b'
      AND NOT EXISTS (SELECT 1 FROM public.invoices_unified iu WHERE iu.canonical_id=ri.canonical_id
        AND (iu.emisor_blacklist_status IN ('presumed','definitive') OR iu.receptor_blacklist_status IN ('presumed','definitive')))
    RETURNING 1) SELECT count(*) INTO v_tmp FROM r; v_resolved := v_resolved + v_tmp;

  -- INSERT: cancelled_but_posted, posted_but_sat_uncertified, amount_mismatch, partner_blacklist_69b — sin cambios
  WITH ins AS (INSERT INTO public.reconciliation_issues (issue_type, canonical_id, uuid_sat, odoo_invoice_id, odoo_company_id, company_id, description, severity, metadata)
    SELECT 'cancelled_but_posted', iu.canonical_id, iu.uuid_sat, iu.odoo_invoice_id, iu.odoo_company_id, iu.company_id,
      format('Syntage marca UUID %s como cancelado, Odoo sigue posted en %s', iu.uuid_sat, iu.odoo_ref), 'high',
      jsonb_build_object('counterparty_rfc', COALESCE(iu.emisor_rfc, iu.receptor_rfc), 'detected_via', 'uuid', 'fecha_cancelacion', iu.fecha_cancelacion)
    FROM public.invoices_unified iu WHERE iu.fiscal_operational_consistency = 'cancelled_but_posted'
    ON CONFLICT (issue_type, canonical_id) WHERE resolved_at IS NULL DO NOTHING RETURNING 1
  ) SELECT count(*) INTO v_tmp FROM ins; v_opened := v_opened + v_tmp;

  WITH ins AS (INSERT INTO public.reconciliation_issues (issue_type, canonical_id, uuid_sat, odoo_invoice_id, odoo_company_id, company_id, description, severity, metadata)
    SELECT 'posted_but_sat_uncertified', iu.canonical_id, NULL, iu.odoo_invoice_id, iu.odoo_company_id, iu.company_id,
      format('Odoo %s posted sin UUID SAT ni match composite', iu.odoo_ref), 'low',
      jsonb_build_object('counterparty_rfc', NULL, 'detected_via', 'composite', 'invoice_date', iu.invoice_date)
    FROM public.invoices_unified iu WHERE iu.match_status='odoo_only' AND iu.odoo_state='posted' AND iu.uuid_sat IS NULL
      AND iu.invoice_date > (now() - interval '30 days')::date
    ON CONFLICT (issue_type, canonical_id) WHERE resolved_at IS NULL DO NOTHING RETURNING 1
  ) SELECT count(*) INTO v_tmp FROM ins; v_opened := v_opened + v_tmp;

  -- sat_only_cfdi_received · FIX: populate company_id via emisor_rfc lookup
  WITH ins AS (INSERT INTO public.reconciliation_issues (issue_type, canonical_id, uuid_sat, odoo_invoice_id, odoo_company_id, company_id, description, severity, metadata)
    SELECT 'sat_only_cfdi_received', iu.canonical_id, iu.uuid_sat, NULL, iu.odoo_company_id,
      (SELECT id FROM public.companies WHERE lower(rfc)=lower(iu.emisor_rfc) LIMIT 1) AS company_id,  -- NUEVO
      format('CFDI recibido %s de %s no existe en Odoo (total fiscal $%s)', iu.uuid_sat, iu.emisor_nombre, iu.total_fiscal), 'medium',
      jsonb_build_object('counterparty_rfc', iu.emisor_rfc, 'detected_via', 'uuid', 'total_fiscal', iu.total_fiscal, 'fecha_timbrado', iu.fecha_timbrado)
    FROM public.invoices_unified iu
    WHERE iu.match_status='syntage_only' AND iu.direction='received'
      AND iu.fecha_timbrado >= '2021-01-01'
    ON CONFLICT (issue_type, canonical_id) WHERE resolved_at IS NULL DO NOTHING RETURNING 1
  ) SELECT count(*) INTO v_tmp FROM ins; v_opened := v_opened + v_tmp;

  -- sat_only_cfdi_issued · FIX: populate company_id via receptor_rfc lookup
  WITH ins AS (INSERT INTO public.reconciliation_issues (issue_type, canonical_id, uuid_sat, odoo_invoice_id, odoo_company_id, company_id, description, severity, metadata)
    SELECT 'sat_only_cfdi_issued', iu.canonical_id, iu.uuid_sat, NULL, iu.odoo_company_id,
      (SELECT id FROM public.companies WHERE lower(rfc)=lower(iu.receptor_rfc) LIMIT 1) AS company_id,  -- NUEVO
      format('CFDI emitido %s a %s no existe en Odoo (total fiscal $%s) — POSIBLE FRAUDE', iu.uuid_sat, iu.receptor_nombre, iu.total_fiscal), 'critical',
      jsonb_build_object('counterparty_rfc', iu.receptor_rfc, 'detected_via', 'uuid', 'total_fiscal', iu.total_fiscal, 'fecha_timbrado', iu.fecha_timbrado)
    FROM public.invoices_unified iu
    WHERE iu.match_status='syntage_only' AND iu.direction='issued'
      AND iu.fecha_timbrado >= '2021-01-01'
    ON CONFLICT (issue_type, canonical_id) WHERE resolved_at IS NULL DO NOTHING RETURNING 1
  ) SELECT count(*) INTO v_tmp FROM ins; v_opened := v_opened + v_tmp;

  WITH ins AS (INSERT INTO public.reconciliation_issues (issue_type, canonical_id, uuid_sat, odoo_invoice_id, odoo_company_id, company_id, description, severity, metadata)
    SELECT 'amount_mismatch', iu.canonical_id, iu.uuid_sat, iu.odoo_invoice_id, iu.odoo_company_id, iu.company_id,
      format('UUID %s: total fiscal $%s vs Odoo $%s (diff $%s)', iu.uuid_sat, iu.total_fiscal, iu.odoo_amount_total, iu.amount_diff), 'medium',
      jsonb_build_object('counterparty_rfc', COALESCE(iu.emisor_rfc, iu.receptor_rfc), 'detected_via', 'uuid', 'amount_diff', iu.amount_diff,
        'severity_reason', CASE WHEN abs(iu.amount_diff) > 1000 THEN 'diff >$1000' ELSE 'diff minor' END)
    FROM public.invoices_unified iu WHERE iu.fiscal_operational_consistency='amount_mismatch'
    ON CONFLICT (issue_type, canonical_id) WHERE resolved_at IS NULL DO NOTHING RETURNING 1
  ) SELECT count(*) INTO v_tmp FROM ins; v_opened := v_opened + v_tmp;

  WITH ins AS (INSERT INTO public.reconciliation_issues (issue_type, canonical_id, uuid_sat, odoo_invoice_id, odoo_company_id, company_id, description, severity, metadata)
    SELECT DISTINCT ON (iu.company_id, iu.odoo_company_id) 'partner_blacklist_69b', 'company:' || iu.company_id::text,
      NULL, NULL, iu.odoo_company_id, iu.company_id,
      format('Contraparte %s tiene status 69-B: %s', iu.partner_name, COALESCE(NULLIF(iu.emisor_blacklist_status, ''), iu.receptor_blacklist_status)), 'medium',
      jsonb_build_object('counterparty_rfc', COALESCE(iu.emisor_rfc, iu.receptor_rfc),
        'blacklist_status', COALESCE(NULLIF(iu.emisor_blacklist_status, ''), iu.receptor_blacklist_status), 'detected_via', 'uuid')
    FROM public.invoices_unified iu
    WHERE (iu.emisor_blacklist_status IN ('presumed','definitive') OR iu.receptor_blacklist_status IN ('presumed','definitive'))
      AND iu.company_id IS NOT NULL
    ON CONFLICT (issue_type, canonical_id) WHERE resolved_at IS NULL DO NOTHING RETURNING 1
  ) SELECT count(*) INTO v_tmp FROM ins; v_opened := v_opened + v_tmp;

  UPDATE public.reconciliation_issues SET resolution='stale_7d'
  WHERE resolved_at IS NULL AND detected_at < now() - interval '7 days' AND resolution IS NULL;

  RETURN jsonb_build_object(
    'refreshed_at', now(),
    'invoices_unified_rows', (SELECT count(*) FROM public.invoices_unified),
    'issues_opened', v_opened, 'issues_resolved', v_resolved,
    'duration_ms', (extract(milliseconds FROM clock_timestamp() - t_start))::int
  );
END;
$$;

COMMENT ON FUNCTION public.refresh_invoices_unified() IS 'Fase 3 · Fase 5 update: sat_only_* INSERTs populan company_id via companies.rfc lookup.';
