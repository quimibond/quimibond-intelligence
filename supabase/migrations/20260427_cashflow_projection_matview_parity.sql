-- F-AUDIT-#1: SQL parity para matview cashflow_projection.
-- Indexes (idx_cashflow_projection_flow_date + _company) aplicados a
-- producción vía execute_safe_ddl on 2026-04-27. La matview en sí ya
-- existía en prod desde antes (creada por MCP); este file la captura
-- para CI/CD reproducible.
--
-- La matview se aplicó originalmente vía MCP (Supabase studio o CLI ad-hoc)
-- y nunca quedó archivo de migración en repo. Esto la hacía:
--   1. Imposible de re-bootstrapear desde cero (CI/CD reproducible).
--   2. Difícil de versionar / revisar cambios.
--   3. Source of confusion para audits (la lógica está en SQL pero no
--      visible al hacer grep/git blame).
--
-- Esta migración la captura fielmente — extraída de producción
-- (2026-04-27) vía pg_get_viewdef('public.cashflow_projection'::regclass).
-- Es idempotente: usa CREATE MATERIALIZED VIEW IF NOT EXISTS, así que
-- en producción es no-op.
--
-- Hallazgos del audit relevantes a esta matview:
--   #2 (NULL due_date queda fuera): la matview asume i.due_date NOT NULL.
--      Filas sin due_date no aparecen → no entran al horizonte.
--      Fix futuro: COALESCE(i.due_date, i.invoice_date + interval '30 days').
--   #9 (aging buckets fijos): los pivotes 95/85/70/50/25 están hardcoded.
--      Fix futuro: parametrizar por cliente/proveedor histórico.
--   #10 (in_payment): la matview YA filtra `payment_state IN
--      ('not_paid','partial')` — confirma que `in_payment` está excluido
--      a nivel SQL. El fix client-side de projection.ts es defensa redundante
--      pero barata (puede dejarse o removerse si se confía en la matview).
--
-- Source: odoo_invoices (Bronze). NO usa canonical_invoices, así que NO
-- toma en cuenta is_quimibond_relevant ni los flags de cancelación SAT.
-- Fix futuro estructural: re-platformar sobre canonical_invoices con FKs.
--
-- Refresh: actualmente NO hay pg_cron job (`SELECT * FROM cron.job WHERE
-- command ILIKE '%cashflow_projection%'` retorna 0 filas en 2026-04-27).
-- La matview se refresca on-demand o por cron externo no visible. TODO:
-- agregar cron explicito o mover a VIEW (824 rows / 144 kB — la diferencia
-- de performance vs view en cardinalidad tan baja es despreciable).

CREATE MATERIALIZED VIEW IF NOT EXISTS public.cashflow_projection AS
WITH receivable_detail AS (
  SELECT
    i.company_id,
    'receivable_detail'::text AS flow_type,
    i.due_date AS projected_date,
    COALESCE(i.amount_residual_mxn, i.amount_residual) AS amount_residual,
    COALESCE(i.amount_residual_mxn, i.amount_residual) *
      CASE
        WHEN i.days_overdue <= 0 THEN 0.95
        WHEN i.days_overdue >= 1 AND i.days_overdue <= 30 THEN 0.85
        WHEN i.days_overdue >= 31 AND i.days_overdue <= 60 THEN 0.70
        WHEN i.days_overdue >= 61 AND i.days_overdue <= 90 THEN 0.50
        WHEN i.days_overdue > 90 THEN 0.25
        ELSE 0.50
      END AS expected_amount,
    CASE
      WHEN i.days_overdue <= 0 THEN 0.95
      WHEN i.days_overdue >= 1 AND i.days_overdue <= 30 THEN 0.85
      WHEN i.days_overdue >= 31 AND i.days_overdue <= 60 THEN 0.70
      WHEN i.days_overdue >= 61 AND i.days_overdue <= 90 THEN 0.50
      WHEN i.days_overdue > 90 THEN 0.25
      ELSE 0.50
    END AS collection_probability,
    i.name AS invoice_name,
    i.days_overdue
  FROM odoo_invoices i
  WHERE i.move_type = 'out_invoice'::text
    AND i.state = 'posted'::text
    AND (i.payment_state = ANY (ARRAY['not_paid'::text, 'partial'::text]))
    AND i.amount_residual > 0::numeric
    AND i.company_id IS NOT NULL
),
receivable_by_month AS (
  SELECT
    rd.company_id,
    'receivable_by_month'::text AS flow_type,
    date_trunc('month'::text, rd.projected_date::timestamp with time zone)::date AS projected_date,
    sum(rd.amount_residual) AS amount_residual,
    sum(rd.expected_amount) AS expected_amount,
    avg(rd.collection_probability) AS collection_probability,
    NULL::text AS invoice_name,
    max(rd.days_overdue) AS days_overdue
  FROM receivable_detail rd
  GROUP BY rd.company_id, (date_trunc('month'::text, rd.projected_date::timestamp with time zone)::date)
),
payable_detail AS (
  SELECT
    i.company_id,
    'payable_detail'::text AS flow_type,
    i.due_date AS projected_date,
    COALESCE(i.amount_residual_mxn, i.amount_residual) AS amount_residual,
    COALESCE(i.amount_residual_mxn, i.amount_residual) AS expected_amount,
    1.0 AS collection_probability,
    i.name AS invoice_name,
    i.days_overdue
  FROM odoo_invoices i
  WHERE i.move_type = 'in_invoice'::text
    AND i.state = 'posted'::text
    AND (i.payment_state = ANY (ARRAY['not_paid'::text, 'partial'::text]))
    AND i.amount_residual > 0::numeric
    AND i.company_id IS NOT NULL
)
SELECT
  receivable_detail.company_id,
  receivable_detail.flow_type,
  receivable_detail.projected_date,
  receivable_detail.amount_residual,
  receivable_detail.expected_amount,
  receivable_detail.collection_probability,
  receivable_detail.invoice_name,
  receivable_detail.days_overdue
FROM receivable_detail
UNION ALL
SELECT
  receivable_by_month.company_id,
  receivable_by_month.flow_type,
  receivable_by_month.projected_date,
  receivable_by_month.amount_residual,
  receivable_by_month.expected_amount,
  receivable_by_month.collection_probability,
  receivable_by_month.invoice_name,
  receivable_by_month.days_overdue
FROM receivable_by_month
UNION ALL
SELECT
  payable_detail.company_id,
  payable_detail.flow_type,
  payable_detail.projected_date,
  payable_detail.amount_residual,
  payable_detail.expected_amount,
  payable_detail.collection_probability,
  payable_detail.invoice_name,
  payable_detail.days_overdue
FROM payable_detail;

-- Indexes de soporte (no existen en producción a 2026-04-27 — agregar).
-- Filtro principal en projection.ts: flow_type IN (...) AND projected_date <= endIso.
CREATE INDEX IF NOT EXISTS idx_cashflow_projection_flow_date
  ON public.cashflow_projection (flow_type, projected_date);

CREATE INDEX IF NOT EXISTS idx_cashflow_projection_company
  ON public.cashflow_projection (company_id);
