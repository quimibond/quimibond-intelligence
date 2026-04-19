-- Fase 6 · 006: RPCs agregadas para context builder estratégico de Compliance.
-- Schema real: reconciliation_issues.resolved_at IS NULL para "open", no hay "status".
--              invoices_unified usa match_status/odoo_invoice_id/uuid_sat.
--              syntage_tax_returns usa ejercicio+periodo+monto_pagado+fecha_presentacion.

CREATE OR REPLACE FUNCTION public.syntage_open_issues_by_week()
RETURNS TABLE(week text, severity text, cnt int)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    to_char(date_trunc('week', detected_at), 'IYYY-"W"IW') AS week,
    severity::text,
    count(*)::int AS cnt
  FROM public.reconciliation_issues
  WHERE resolved_at IS NULL
    AND detected_at >= now() - interval '12 weeks'
  GROUP BY 1, 2
  ORDER BY 1 DESC, 2;
$$;

CREATE OR REPLACE FUNCTION public.syntage_top_unlinked_rfcs(p_limit int DEFAULT 10)
RETURNS TABLE(rfc text, cnt int, last_seen date)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  -- Extrae RFC desde metadata. Para sat_only_cfdi_received, metadata
  -- debería contener emisor_rfc; si no, fallback al description.
  SELECT
    COALESCE(metadata->>'emisor_rfc', metadata->>'rfc', '—unknown—') AS rfc,
    count(*)::int AS cnt,
    max(detected_at::date) AS last_seen
  FROM public.reconciliation_issues
  WHERE issue_type = 'sat_only_cfdi_received'
    AND company_id IS NULL
    AND resolved_at IS NULL
  GROUP BY 1
  ORDER BY cnt DESC
  LIMIT p_limit;
$$;

CREATE OR REPLACE FUNCTION public.syntage_validation_coverage_by_month(p_months int DEFAULT 6)
RETURNS TABLE(month text, posted int, validated int, ratio numeric)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    to_char(date_trunc('month', invoice_date), 'YYYY-MM') AS month,
    count(*) FILTER (WHERE odoo_invoice_id IS NOT NULL)::int AS posted,
    count(*) FILTER (WHERE odoo_invoice_id IS NOT NULL
                     AND uuid_sat IS NOT NULL
                     AND match_status IN ('match_uuid','match_composite'))::int AS validated,
    round(
      count(*) FILTER (WHERE odoo_invoice_id IS NOT NULL
                       AND uuid_sat IS NOT NULL
                       AND match_status IN ('match_uuid','match_composite'))::numeric
      / NULLIF(count(*) FILTER (WHERE odoo_invoice_id IS NOT NULL), 0)::numeric,
      3
    ) AS ratio
  FROM public.invoices_unified
  WHERE invoice_date IS NOT NULL
    AND invoice_date >= (now() - make_interval(months => p_months))::date
  GROUP BY 1
  ORDER BY 1 DESC;
$$;

CREATE OR REPLACE FUNCTION public.syntage_recent_resolutions(p_days int DEFAULT 30)
RETURNS TABLE(resolution text, cnt int)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    COALESCE(resolution, '—sin etiqueta—') AS resolution,
    count(*)::int AS cnt
  FROM public.reconciliation_issues
  WHERE resolved_at IS NOT NULL
    AND resolved_at >= now() - make_interval(days => p_days)
  GROUP BY 1
  ORDER BY cnt DESC;
$$;

CREATE OR REPLACE FUNCTION public.syntage_recent_tax_returns(p_months int DEFAULT 12)
RETURNS TABLE(period text, return_type text, tipo_declaracion text, impuesto text, monto_pagado numeric, fecha_presentacion timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    (ejercicio::text || '-' || COALESCE(periodo, '')) AS period,
    return_type::text,
    tipo_declaracion::text,
    impuesto::text,
    monto_pagado,
    fecha_presentacion
  FROM public.syntage_tax_returns
  WHERE fecha_presentacion IS NOT NULL
    AND fecha_presentacion >= now() - make_interval(months => p_months)
  ORDER BY fecha_presentacion DESC
  LIMIT 30;
$$;

GRANT EXECUTE ON FUNCTION public.syntage_open_issues_by_week()             TO service_role;
GRANT EXECUTE ON FUNCTION public.syntage_top_unlinked_rfcs(int)            TO service_role;
GRANT EXECUTE ON FUNCTION public.syntage_validation_coverage_by_month(int) TO service_role;
GRANT EXECUTE ON FUNCTION public.syntage_recent_resolutions(int)           TO service_role;
GRANT EXECUTE ON FUNCTION public.syntage_recent_tax_returns(int)           TO service_role;
