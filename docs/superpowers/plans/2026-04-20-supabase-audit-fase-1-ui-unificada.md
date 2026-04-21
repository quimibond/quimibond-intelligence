# Fase 1 — UI Unificada: Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminar el síntoma "no veo la realidad unificada" — hacer que todo consumer del frontend lea de la capa unificada (`invoices_unified`, `payments_unified`, `company_profile` extendido) en vez de raw Odoo/Syntage.

**Architecture:** (1) Extender `company_profile` MV con YTD + aging buckets + SAT compliance + last_activity; (2) implementar 4 triggers de auto-resolve para los issue_types eternos; (3) backfill Syntage del gap 18%; (4) migrar 6 archivos del frontend a unified layer; (5) eliminar feature flag `USE_UNIFIED_LAYER` + funciones legacy.

**Tech Stack:** PostgreSQL MVs + triggers (Supabase `tozqezmivpblmcubmnpi`), TypeScript/Next.js 14 frontend en `/Users/jj/quimibond-intelligence/quimibond-intelligence/`, supabase-js client, pnpm.

**Spec parent:** [2026-04-19-supabase-audit-02-ui-unificada.md](../specs/2026-04-19-supabase-audit-02-ui-unificada.md)

**Repos afectados:**
- `/Users/jj` (qb19) — branch `fase-1-ui-unificada`, migraciones SQL
- `/Users/jj/quimibond-intelligence/quimibond-intelligence/` (frontend) — branch `fase-1-ui-unificada`, cambios TS

**Supabase project_id:** `tozqezmivpblmcubmnpi`

---

## Estructura de archivos

### Crear en `/Users/jj/supabase/migrations/`
- `20260420100000_phase_1_company_profile_extension.sql` — añade ytd/aging/sat/last_activity a `company_profile`
- `20260420100100_phase_1_autoresolve_payment_missing_complemento.sql`
- `20260420100200_phase_1_autoresolve_complemento_missing_payment.sql`
- `20260420100300_phase_1_autoresolve_cancelled_but_posted.sql`
- `20260420100400_phase_1_autoresolve_amount_mismatch.sql`
- `20260420100500_phase_1_baseline_invariants.sql`
- `20260420100600_phase_1_final_invariants.sql`

### Scripts
- `scripts/syntage_backfill_gap.ts` o `.sh` — identificar meses faltantes y disparar extracciones

### Modificar en frontend
Los archivos exactos se localizan con `grep` en Task 0. Esperados (paths probables):
- `src/lib/queries/invoices.ts` — AR aging
- `src/lib/queries/finance.ts` — AR aging by company
- `src/lib/queries/sales.ts` — ventas
- `src/lib/queries/companies.ts` — perfil cliente
- `src/lib/queries/customer-360.ts` — vista 360
- `src/lib/queries/director-chat-context.ts` — contexto IA
- `.env.example` — quitar `USE_UNIFIED_LAYER`

### Notes
- `docs/superpowers/notes/2026-04-20-fase-1-company-profile-extension-design.md` — diseño concreto de columnas a añadir
- `docs/superpowers/notes/2026-04-20-fase-1-baseline.md` — baseline y delta final

---

## Task 0: Setup + baseline

**Files:**
- Create: `supabase/migrations/20260420100500_phase_1_baseline_invariants.sql`
- Create: `docs/superpowers/notes/2026-04-20-fase-1-baseline.md`

- [ ] **Step 0.1: Confirmar Fase 0 en producción**

```bash
cd /Users/jj
git fetch origin main
git log --oneline origin/main -3
```
Expected: incluye commit `9bb28c8 Merge fase-0-contencion`. Si NO está, abort.

- [ ] **Step 0.2: Crear rama `fase-1-ui-unificada` en qb19**

```bash
cd /Users/jj
git checkout main
git pull origin main
git checkout -b fase-1-ui-unificada
```

- [ ] **Step 0.3: Crear rama `fase-1-ui-unificada` en frontend**

```bash
cd /Users/jj/quimibond-intelligence/quimibond-intelligence
git checkout main
git pull origin main
git checkout -b fase-1-ui-unificada
```

- [ ] **Step 0.4: Localizar archivos objetivo en frontend**

```
Grep
  pattern: "supabase\\.from\\(['\"]odoo_(invoices|payments|account_payments|sale_orders|purchase_orders|deliveries)['\"]\\)"
  path: /Users/jj/quimibond-intelligence/quimibond-intelligence/src
  output_mode: files_with_matches
```
Esperado: 6+ archivos. Guardar lista con paths exactos.

```
Grep
  pattern: "USE_UNIFIED_LAYER"
  path: /Users/jj/quimibond-intelligence/quimibond-intelligence
  output_mode: content
  -n: true
```
Guardar las ocurrencias.

```
Grep
  pattern: "legacy(GetArAging|Get|Fetch)"
  path: /Users/jj/quimibond-intelligence/quimibond-intelligence/src
  output_mode: content
  -n: true
```

- [ ] **Step 0.5: Escribir migración baseline**

Crear `/Users/jj/supabase/migrations/20260420100500_phase_1_baseline_invariants.sql`:

```sql
-- Phase 1 baseline: métricas que esperamos mover con la fase.
INSERT INTO public.audit_runs (run_id, invariant_key, severity, source, model, details, run_at)
SELECT
  gen_random_uuid(),
  'phase_1_baseline',
  'ok',
  'supabase',
  'baseline',
  jsonb_build_object(
    'reconciliation_issues_open_total', (SELECT COUNT(*) FROM public.reconciliation_issues WHERE resolved_at IS NULL),
    'reconciliation_issues_open_payment_missing_complemento', (SELECT COUNT(*) FROM public.reconciliation_issues WHERE resolved_at IS NULL AND issue_type='payment_missing_complemento'),
    'reconciliation_issues_open_complemento_missing_payment', (SELECT COUNT(*) FROM public.reconciliation_issues WHERE resolved_at IS NULL AND issue_type='complemento_missing_payment'),
    'reconciliation_issues_open_cancelled_but_posted', (SELECT COUNT(*) FROM public.reconciliation_issues WHERE resolved_at IS NULL AND issue_type='cancelled_but_posted'),
    'reconciliation_issues_open_amount_mismatch', (SELECT COUNT(*) FROM public.reconciliation_issues WHERE resolved_at IS NULL AND issue_type='amount_mismatch'),
    'syntage_gap_cfdis', (SELECT COUNT(*) FROM public.odoo_invoices WHERE cfdi_uuid IS NOT NULL AND cfdi_uuid NOT IN (SELECT uuid FROM public.syntage_invoices)),
    'odoo_invoices_with_cfdi', (SELECT COUNT(*) FROM public.odoo_invoices WHERE cfdi_uuid IS NOT NULL),
    'syntage_match_pct_odoo_to_syntage', (
      SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE cfdi_uuid IN (SELECT uuid FROM public.syntage_invoices)) / NULLIF(COUNT(*) FILTER (WHERE cfdi_uuid IS NOT NULL), 0), 2)
      FROM public.odoo_invoices
    ),
    'company_profile_columns', (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='company_profile'),
    'company_profile_kind', (SELECT CASE WHEN relkind='m' THEN 'matview' WHEN relkind='v' THEN 'view' ELSE relkind::text END FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid WHERE n.nspname='public' AND c.relname='company_profile')
  ),
  now();
```

- [ ] **Step 0.6: Ejecutar baseline**

```
mcp__claude_ai_Supabase__execute_sql
  project_id: "tozqezmivpblmcubmnpi"
  query: <contenido del archivo>
```
Expected: `INSERT 0 1`.

- [ ] **Step 0.7: Leer baseline + escribir notes**

```
mcp__claude_ai_Supabase__execute_sql
  project_id: "tozqezmivpblmcubmnpi"
  query: "SELECT details FROM public.audit_runs WHERE invariant_key='phase_1_baseline' ORDER BY run_at DESC LIMIT 1;"
```

Crear `/Users/jj/docs/superpowers/notes/2026-04-20-fase-1-baseline.md` con el JSON + expectativas post-fase:

```markdown
# Fase 1 — Baseline (2026-04-20)

<JSON>

## Archivos frontend a migrar (Step 0.4)
- <lista>

## Ocurrencias USE_UNIFIED_LAYER (Step 0.4)
- <lista>

## Expectativas post-fase
- reconciliation_issues_open_payment_missing_complemento: 5552 → <10% baseline
- reconciliation_issues_open_complemento_missing_payment: 933 → <10%
- reconciliation_issues_open_cancelled_but_posted: 97 → 0
- reconciliation_issues_open_amount_mismatch: 19 → 0
- syntage_gap_cfdis: 3482 → <5% baseline
- company_profile columnas: <n> → <n+6>
- 0 supabase.from("odoo_invoices"|"odoo_payments"|"odoo_account_payments") fuera de /admin/debug
```

- [ ] **Step 0.8: Commit**

```bash
cd /Users/jj
git add supabase/migrations/20260420100500_phase_1_baseline_invariants.sql docs/superpowers/notes/2026-04-20-fase-1-baseline.md
git commit -m "chore(supabase): phase 1 baseline invariants captured"
```

---

## Task 1: Extender `company_profile` MV/view

**Files:**
- Create: `supabase/migrations/20260420100000_phase_1_company_profile_extension.sql`
- Create: `docs/superpowers/notes/2026-04-20-fase-1-company-profile-extension-design.md`

- [ ] **Step 1.1: Decidir estrategia según tipo actual**

Del baseline (Step 0.7, campo `company_profile_kind`):
- Si `view` → convertir a MV en esta task (para perf)
- Si `matview` → DROP + CREATE con nueva definition

En ambos casos: `DROP MATERIALIZED VIEW IF EXISTS ... CASCADE` puede romper dependientes. Verifica:
```sql
SELECT * FROM public.dependents_of('public.company_profile');
```
Si hay dependientes, listarlos y decidir si se recrean (spec permite tocarlos).

- [ ] **Step 1.2: Escribir la migración**

Crear `/Users/jj/supabase/migrations/20260420100000_phase_1_company_profile_extension.sql`:

```sql
-- Phase 1: extend company_profile to be one-stop para el frontend.
-- Añade: sale_orders_ytd, purchase_orders_ytd, ar_aging_buckets (jsonb),
-- sat_compliance_score, last_activity_at. La MV actual ya tiene revenue_90d,
-- otd_rate, overdue_count/30d/60d — los preservamos.
--
-- Si company_profile es una VIEW, la convertimos a MATERIALIZED VIEW para perf.

BEGIN;

DROP MATERIALIZED VIEW IF EXISTS public.company_profile CASCADE;
DROP VIEW IF EXISTS public.company_profile CASCADE;

CREATE MATERIALIZED VIEW public.company_profile AS
WITH sale_stats AS (
  SELECT so.company_id,
    sum(COALESCE(so.amount_untaxed_mxn, so.amount_untaxed)) AS total_revenue,
    count(*) AS total_orders,
    max(so.date_order) AS last_order_date,
    sum(CASE WHEN so.date_order >= date_trunc('year', now()) THEN COALESCE(so.amount_untaxed_mxn, so.amount_untaxed) ELSE 0 END) AS revenue_ytd,
    count(*) FILTER (WHERE so.date_order >= date_trunc('year', now())) AS orders_ytd,
    sum(CASE WHEN so.date_order >= (now() - interval '90 days') THEN COALESCE(so.amount_untaxed_mxn, so.amount_untaxed) ELSE 0 END) AS revenue_90d,
    sum(CASE WHEN so.date_order >= (now() - interval '180 days') AND so.date_order < (now() - interval '90 days') THEN COALESCE(so.amount_untaxed_mxn, so.amount_untaxed) ELSE 0 END) AS revenue_prior_90d
  FROM public.odoo_sale_orders so
  WHERE so.state = ANY (ARRAY['sale','done'])
  GROUP BY so.company_id
),
purchase_stats AS (
  SELECT po.company_id,
    sum(COALESCE(po.amount_total_mxn, po.amount_total)) AS total_purchases,
    sum(CASE WHEN po.date_order >= date_trunc('year', now()) THEN COALESCE(po.amount_total_mxn, po.amount_total) ELSE 0 END) AS purchases_ytd,
    count(*) FILTER (WHERE po.date_order >= date_trunc('year', now())) AS purchase_orders_ytd,
    max(po.date_order) AS last_purchase_date
  FROM public.odoo_purchase_orders po
  WHERE po.state = ANY (ARRAY['purchase','done'])
  GROUP BY po.company_id
),
invoice_stats AS (
  SELECT oi.company_id,
    count(*) AS total_invoices,
    sum(COALESCE(oi.amount_residual_mxn, oi.amount_residual)) AS total_pending,
    sum(CASE WHEN oi.days_overdue > 0 THEN COALESCE(oi.amount_residual_mxn, oi.amount_residual) ELSE 0 END) AS overdue_amount,
    count(*) FILTER (WHERE oi.days_overdue > 0) AS overdue_count,
    count(*) FILTER (WHERE oi.days_overdue > 30) AS overdue_30d_count,
    count(*) FILTER (WHERE oi.days_overdue > 60) AS overdue_60d_count,
    max(oi.days_overdue) AS max_days_overdue,
    -- Phase 1: AR aging buckets as jsonb
    jsonb_build_object(
      'bucket_0_30', COALESCE(sum(CASE WHEN oi.days_overdue BETWEEN 0 AND 30 AND oi.amount_residual > 0 THEN COALESCE(oi.amount_residual_mxn, oi.amount_residual) ELSE 0 END), 0),
      'bucket_31_60', COALESCE(sum(CASE WHEN oi.days_overdue BETWEEN 31 AND 60 THEN COALESCE(oi.amount_residual_mxn, oi.amount_residual) ELSE 0 END), 0),
      'bucket_61_90', COALESCE(sum(CASE WHEN oi.days_overdue BETWEEN 61 AND 90 THEN COALESCE(oi.amount_residual_mxn, oi.amount_residual) ELSE 0 END), 0),
      'bucket_90_plus', COALESCE(sum(CASE WHEN oi.days_overdue > 90 THEN COALESCE(oi.amount_residual_mxn, oi.amount_residual) ELSE 0 END), 0)
    ) AS ar_aging_buckets,
    max(oi.invoice_date) AS last_invoice_date
  FROM public.odoo_invoices oi
  WHERE oi.move_type = 'out_invoice' AND oi.state = 'posted'
  GROUP BY oi.company_id
),
delivery_stats AS (
  SELECT od.company_id,
    count(*) AS total_deliveries,
    count(*) FILTER (WHERE od.is_late) AS late_deliveries,
    round(count(*) FILTER (WHERE NOT od.is_late)::numeric / NULLIF(count(*), 0) * 100, 1) AS otd_rate,
    -- Phase 1: OTD 90d
    round(count(*) FILTER (WHERE NOT od.is_late AND od.scheduled_date >= (now() - interval '90 days'))::numeric /
      NULLIF(count(*) FILTER (WHERE od.scheduled_date >= (now() - interval '90 days')), 0) * 100, 1) AS otd_rate_90d,
    max(od.scheduled_date) AS last_delivery_date
  FROM public.odoo_deliveries od
  GROUP BY od.company_id
),
sat_stats AS (
  -- Phase 1: SAT compliance score per company.
  -- Score = 100 - penalty; penalty = (open issues / total invoices) * 100, capped at 100.
  SELECT
    oi.company_id,
    count(DISTINCT oi.id) FILTER (WHERE oi.cfdi_uuid IS NOT NULL) AS invoices_with_cfdi,
    count(DISTINCT oi.id) FILTER (WHERE oi.cfdi_uuid IS NOT NULL AND oi.cfdi_uuid IN (SELECT uuid FROM public.syntage_invoices)) AS invoices_with_syntage_match,
    (
      SELECT count(*) FROM public.reconciliation_issues ri
      WHERE ri.resolved_at IS NULL AND ri.company_id = oi.company_id
    ) AS open_issues,
    GREATEST(0, 100 - LEAST(100,
      (SELECT count(*) FROM public.reconciliation_issues ri
       WHERE ri.resolved_at IS NULL AND ri.company_id = oi.company_id)::numeric * 100 /
      NULLIF(count(DISTINCT oi.id) FILTER (WHERE oi.cfdi_uuid IS NOT NULL), 0)
    )) AS sat_compliance_score
  FROM public.odoo_invoices oi
  GROUP BY oi.company_id
),
email_stats AS (
  SELECT ct.company_id,
    count(DISTINCT e.id) AS email_count,
    max(e.email_date) AS last_email_date
  FROM public.contacts ct
  JOIN public.emails e ON e.sender_contact_id = ct.id
  WHERE ct.company_id IS NOT NULL
  GROUP BY ct.company_id
),
contact_stats AS (
  SELECT contacts.company_id, count(*) AS contact_count
  FROM public.contacts WHERE contacts.company_id IS NOT NULL
  GROUP BY contacts.company_id
),
total_revenue_all AS (
  SELECT sum(COALESCE(amount_untaxed_mxn, amount_untaxed)) AS grand_total
  FROM public.odoo_sale_orders WHERE state = ANY (ARRAY['sale','done'])
)
SELECT
  c.id AS company_id,
  c.name, c.canonical_name, c.is_customer, c.is_supplier, c.industry, c.credit_limit,
  COALESCE(s.total_revenue, 0) AS total_revenue,
  COALESCE(s.total_orders, 0) AS total_orders,
  s.last_order_date,
  COALESCE(s.revenue_90d, 0) AS revenue_90d,
  COALESCE(s.revenue_prior_90d, 0) AS revenue_prior_90d,
  -- Phase 1 additions:
  COALESCE(s.revenue_ytd, 0) AS revenue_ytd,
  COALESCE(s.orders_ytd, 0) AS sale_orders_ytd,
  COALESCE(p.purchases_ytd, 0) AS purchases_ytd,
  COALESCE(p.purchase_orders_ytd, 0) AS purchase_orders_ytd,
  COALESCE(i.ar_aging_buckets, '{"bucket_0_30":0,"bucket_31_60":0,"bucket_61_90":0,"bucket_90_plus":0}'::jsonb) AS ar_aging_buckets,
  COALESCE(sat.sat_compliance_score, 100) AS sat_compliance_score,
  COALESCE(sat.invoices_with_cfdi, 0) AS invoices_with_cfdi,
  COALESCE(sat.invoices_with_syntage_match, 0) AS invoices_with_syntage_match,
  COALESCE(sat.open_issues, 0) AS sat_open_issues,
  GREATEST(s.last_order_date, p.last_purchase_date, i.last_invoice_date, d.last_delivery_date, em.last_email_date) AS last_activity_at,
  -- Preserva campos originales:
  CASE WHEN COALESCE(s.revenue_prior_90d, 0) > 0
    THEN round((COALESCE(s.revenue_90d, 0) - s.revenue_prior_90d) / s.revenue_prior_90d * 100, 1)
    ELSE NULL END AS trend_pct,
  COALESCE(p.total_purchases, 0) AS total_purchases,
  p.last_purchase_date,
  CASE WHEN COALESCE(s.total_revenue, 0) > 0
    THEN round(s.total_revenue / NULLIF((SELECT grand_total FROM total_revenue_all), 0) * 100, 2)
    ELSE 0 END AS revenue_share_pct,
  COALESCE(i.total_pending, 0) AS pending_amount,
  COALESCE(i.overdue_amount, 0) AS overdue_amount,
  COALESCE(i.overdue_count, 0) AS overdue_count,
  COALESCE(i.overdue_30d_count, 0) AS overdue_30d_count,
  COALESCE(i.max_days_overdue, 0) AS max_days_overdue,
  COALESCE(d.total_deliveries, 0) AS total_deliveries,
  COALESCE(d.late_deliveries, 0) AS late_deliveries,
  d.otd_rate,
  d.otd_rate_90d,
  COALESCE(em.email_count, 0) AS email_count,
  em.last_email_date,
  COALESCE(cs.contact_count, 0) AS contact_count,
  CASE
    WHEN COALESCE(i.overdue_60d_count, 0) > 0 AND COALESCE(i.overdue_amount, 0) > 500000 THEN 'critical'
    WHEN COALESCE(i.overdue_30d_count, 0) > 0 AND COALESCE(i.overdue_amount, 0) > 100000 THEN 'high'
    WHEN COALESCE(i.overdue_count, 0) > 0 THEN 'medium'
    WHEN COALESCE(s.revenue_90d, 0) = 0 AND COALESCE(s.total_revenue, 0) > 100000 THEN 'medium'
    ELSE 'low'
  END AS risk_level,
  CASE
    WHEN COALESCE(s.total_revenue, 0) > 2000000 THEN 'strategic'
    WHEN COALESCE(s.total_revenue, 0) > 500000 THEN 'important'
    WHEN COALESCE(s.total_revenue, 0) > 100000 THEN 'regular'
    WHEN COALESCE(p.total_purchases, 0) > 500000 THEN 'key_supplier'
    ELSE 'minor'
  END AS tier
FROM public.companies c
LEFT JOIN sale_stats s ON s.company_id = c.id
LEFT JOIN purchase_stats p ON p.company_id = c.id
LEFT JOIN invoice_stats i ON i.company_id = c.id
LEFT JOIN delivery_stats d ON d.company_id = c.id
LEFT JOIN sat_stats sat ON sat.company_id = c.id
LEFT JOIN email_stats em ON em.company_id = c.id
LEFT JOIN contact_stats cs ON cs.company_id = c.id
WHERE COALESCE(c.relationship_type, '') <> 'self';

CREATE UNIQUE INDEX IF NOT EXISTS company_profile_company_id_pk
  ON public.company_profile (company_id);
CREATE INDEX IF NOT EXISTS company_profile_tier_idx
  ON public.company_profile (tier);
CREATE INDEX IF NOT EXISTS company_profile_risk_idx
  ON public.company_profile (risk_level);

-- Asegurar que refresh_all_matviews la incluye (leer body en Step 1.3 y parchar si no).

INSERT INTO public.schema_changes (ddl, success, error, applied_at)
VALUES (
  'Phase 1: extend company_profile with ytd, ar_aging_buckets, sat_compliance_score, last_activity_at',
  true, NULL, now()
);

COMMIT;

REFRESH MATERIALIZED VIEW public.company_profile;
ANALYZE public.company_profile;
```

- [ ] **Step 1.3: Confirmar que `refresh_all_matviews()` incluye `company_profile`**

```sql
SELECT pg_get_functiondef(oid) FROM pg_proc
WHERE proname='refresh_all_matviews' AND pronamespace='public'::regnamespace;
```

Grep por `company_profile`. Si NO aparece, crear migración adicional:

`/Users/jj/supabase/migrations/20260420100001_phase_1_include_company_profile_in_refresh.sql`:

```sql
CREATE OR REPLACE FUNCTION public.refresh_all_matviews()
RETURNS <return_type> LANGUAGE <lang> <modifiers> AS $function$
BEGIN
  <body_original_exacto>
  -- Phase 1 addition:
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.company_profile;
END;
$function$;
```

(Preservar body exacto tomado del paso previo.)

- [ ] **Step 1.4: Ejecutar migraciones**

```
mcp__claude_ai_Supabase__execute_sql
  project_id: "tozqezmivpblmcubmnpi"
  query: <contenido de 20260420100000>
```
Después (si aplica): 20260420100001.

- [ ] **Step 1.5: Validar el schema**

```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema='public' AND table_name='company_profile'
ORDER BY ordinal_position;
```
Verifica que incluye las nuevas: `revenue_ytd, sale_orders_ytd, purchases_ytd, purchase_orders_ytd, ar_aging_buckets, sat_compliance_score, invoices_with_cfdi, invoices_with_syntage_match, sat_open_issues, otd_rate_90d, last_activity_at`.

Spot-check con un cliente grande:
```sql
SELECT name, sale_orders_ytd, revenue_ytd, ar_aging_buckets, sat_compliance_score, last_activity_at
FROM public.company_profile
WHERE total_revenue > 1000000 ORDER BY total_revenue DESC LIMIT 5;
```
Valores razonables (no NULL, no negativos).

- [ ] **Step 1.6: Commit**

```bash
cd /Users/jj
git add supabase/migrations/20260420100000_phase_1_company_profile_extension.sql
# y 20260420100001 si aplica
git commit -m "feat(supabase): extend company_profile con YTD + ar_aging_buckets + SAT compliance + last_activity_at

Convertir en MV con unique index sobre company_id (permite REFRESH CONCURRENTLY).
Añadir campos para que frontend migre de queries raw a one-stop:
- revenue_ytd, sale_orders_ytd, purchases_ytd, purchase_orders_ytd
- ar_aging_buckets (jsonb 0-30/31-60/61-90/90+)
- sat_compliance_score (0-100 basado en open reconciliation_issues vs total CFDIs)
- last_activity_at (max de invoice/payment/delivery/email/order)

Spec: docs/superpowers/specs/2026-04-19-supabase-audit-02-ui-unificada.md §3.1"
```

---

## Task 2: Auto-resolve `payment_missing_complemento`

**Files:**
- Create: `supabase/migrations/20260420100100_phase_1_autoresolve_payment_missing_complemento.sql`

- [ ] **Step 2.1: Entender cuándo cerrar**

Regla (del spec): cierra cuando llega un `syntage_invoice_payments` cuyo `doctos_relacionados` jsonb contiene un `uuid_docto` que referencia un `odoo_invoices.cfdi_uuid` con un `reconciliation_issues` abierto de tipo `payment_missing_complemento` para ese invoice.

- [ ] **Step 2.2: Verificar schema de `syntage_invoice_payments.doctos_relacionados`**

```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema='public' AND table_name='syntage_invoice_payments' ORDER BY ordinal_position;

SELECT doctos_relacionados FROM public.syntage_invoice_payments
WHERE doctos_relacionados IS NOT NULL AND jsonb_array_length(doctos_relacionados) > 0
LIMIT 2;
```
Confirmar estructura: `[{uuid_docto, parcialidad, imp_pagado, imp_saldo_insoluto}, ...]`.

- [ ] **Step 2.3: Escribir migración con función + trigger**

Crear `/Users/jj/supabase/migrations/20260420100100_phase_1_autoresolve_payment_missing_complemento.sql`:

```sql
-- Phase 1: auto-resolve payment_missing_complemento via trigger en
-- syntage_invoice_payments.

CREATE OR REPLACE FUNCTION public.resolve_payment_missing_complemento_for_syntage_payment(
  p_payment_id bigint
) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  v_resolved integer := 0;
  v_docto_uuids text[];
BEGIN
  -- Extrae uuids de los doctos relacionados del payment
  SELECT array_agg(DISTINCT el->>'uuid_docto')
  INTO v_docto_uuids
  FROM public.syntage_invoice_payments sip,
       LATERAL jsonb_array_elements(COALESCE(sip.doctos_relacionados, '[]'::jsonb)) el
  WHERE sip.id = p_payment_id
    AND el->>'uuid_docto' IS NOT NULL;

  IF v_docto_uuids IS NULL OR cardinality(v_docto_uuids) = 0 THEN
    RETURN 0;
  END IF;

  -- Resuelve los issues abiertos cuyo invoice asociado tiene uno de esos uuids
  WITH r AS (
    UPDATE public.reconciliation_issues ri
    SET resolved_at = now(),
        resolution = format('auto_syntage_complemento_received (payment_id=%s)', p_payment_id)
    WHERE ri.resolved_at IS NULL
      AND ri.issue_type = 'payment_missing_complemento'
      AND EXISTS (
        SELECT 1 FROM public.odoo_invoices oi
        WHERE oi.id = ri.odoo_invoice_id
          AND oi.cfdi_uuid = ANY (v_docto_uuids)
      )
    RETURNING 1
  )
  SELECT count(*) INTO v_resolved FROM r;

  RETURN v_resolved;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_autoresolve_payment_missing_complemento()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.resolve_payment_missing_complemento_for_syntage_payment(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_autoresolve_payment_missing_complemento_insert
  ON public.syntage_invoice_payments;

CREATE TRIGGER trg_autoresolve_payment_missing_complemento_insert
AFTER INSERT ON public.syntage_invoice_payments
FOR EACH ROW EXECUTE FUNCTION public.trg_autoresolve_payment_missing_complemento();

DROP TRIGGER IF EXISTS trg_autoresolve_payment_missing_complemento_update
  ON public.syntage_invoice_payments;

CREATE TRIGGER trg_autoresolve_payment_missing_complemento_update
AFTER UPDATE OF doctos_relacionados ON public.syntage_invoice_payments
FOR EACH ROW EXECUTE FUNCTION public.trg_autoresolve_payment_missing_complemento();

-- Backfill: resolver los issues que ya deberían estar cerrados
-- según los payments existentes.
DO $$
DECLARE
  p record;
  total int := 0;
  this_run int;
BEGIN
  FOR p IN SELECT id FROM public.syntage_invoice_payments
           WHERE doctos_relacionados IS NOT NULL
             AND jsonb_array_length(doctos_relacionados) > 0
  LOOP
    SELECT public.resolve_payment_missing_complemento_for_syntage_payment(p.id) INTO this_run;
    total := total + COALESCE(this_run, 0);
  END LOOP;

  INSERT INTO public.audit_runs (run_id, invariant_key, severity, source, model, details, run_at)
  VALUES (
    gen_random_uuid(),
    'phase_1_autoresolve_payment_missing_complemento_backfill',
    'ok',
    'supabase',
    'migration',
    jsonb_build_object('resolved_count', total, 'migration', '20260420100100'),
    now()
  );
END $$;
```

**Verificar que `reconciliation_issues` tiene columna `odoo_invoice_id`** — si no, usar `canonical_id` u otra llave. Step 2.2 ya debería haberlo mostrado (revisar el schema de `reconciliation_issues`:

```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema='public' AND table_name='reconciliation_issues' ORDER BY ordinal_position;
```

Si la columna no es `odoo_invoice_id`, ajusta el `AND ri.odoo_invoice_id` por el nombre real.

- [ ] **Step 2.4: Ejecutar la migración**

```
mcp__claude_ai_Supabase__execute_sql
  project_id: "tozqezmivpblmcubmnpi"
  query: <contenido>
```
Expected: completa. El backfill procesa todos los payments existentes.

- [ ] **Step 2.5: Validar**

```sql
SELECT
  (SELECT COUNT(*) FROM public.reconciliation_issues WHERE resolved_at IS NULL AND issue_type='payment_missing_complemento') AS still_open,
  (SELECT COUNT(*) FROM public.reconciliation_issues WHERE resolved_at IS NOT NULL AND resolution='auto_syntage_complemento_received') AS auto_resolved;
```
Expected: `still_open` < 5552 (baseline); `auto_resolved` > 0.

Spot-check un resuelto:
```sql
SELECT ri.id, ri.issue_type, ri.resolved_at, ri.resolution, ri.resolution_notes, oi.cfdi_uuid
FROM public.reconciliation_issues ri
JOIN public.odoo_invoices oi ON oi.id = ri.odoo_invoice_id
WHERE ri.resolution = 'auto_syntage_complemento_received'
LIMIT 3;
```
Verifica que cada uno corresponde a un `oi.cfdi_uuid` que aparece en algún `syntage_invoice_payments.doctos_relacionados`.

- [ ] **Step 2.6: Commit**

```bash
cd /Users/jj
git add supabase/migrations/20260420100100_phase_1_autoresolve_payment_missing_complemento.sql
git commit -m "feat(supabase): auto-resolve payment_missing_complemento via trigger en syntage_invoice_payments

Cuando llega un syntage_invoice_payments nuevo (o se actualiza doctos_relacionados),
cierra automáticamente issues open del tipo payment_missing_complemento cuyo invoice
aparece en el jsonb doctos_relacionados. Backfill procesa los existentes."
```

---

## Task 3: Auto-resolve `complemento_missing_payment`

**Files:**
- Create: `supabase/migrations/20260420100200_phase_1_autoresolve_complemento_missing_payment.sql`

- [ ] **Step 3.1: Entender la regla**

Regla: cierra cuando aparece un `odoo_payment_invoice_links` enlazando el invoice a un `odoo_account_payments` por un monto que cubre el complemento.

- [ ] **Step 3.2: Verificar schema de `odoo_payment_invoice_links` + `odoo_account_payments`**

```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema='public' AND table_name='odoo_payment_invoice_links' ORDER BY ordinal_position;
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema='public' AND table_name='odoo_account_payments' ORDER BY ordinal_position;
```
Busca columnas: `invoice_id`, `payment_id`, `amount` o `amount_paid`.

- [ ] **Step 3.3: Escribir migración**

`/Users/jj/supabase/migrations/20260420100200_phase_1_autoresolve_complemento_missing_payment.sql`:

```sql
-- Phase 1: auto-resolve complemento_missing_payment via trigger en
-- odoo_payment_invoice_links.

CREATE OR REPLACE FUNCTION public.resolve_complemento_missing_payment_for_link(
  p_invoice_id bigint
) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE v_resolved integer := 0;
BEGIN
  WITH r AS (
    UPDATE public.reconciliation_issues ri
    SET resolved_at = now(),
        resolution = format('auto_odoo_payment_linked (invoice_id=%s)', p_invoice_id)
    WHERE ri.resolved_at IS NULL
      AND ri.issue_type = 'complemento_missing_payment'
      AND ri.odoo_invoice_id = p_invoice_id
    RETURNING 1
  )
  SELECT count(*) INTO v_resolved FROM r;
  RETURN v_resolved;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_autoresolve_complemento_missing_payment()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.resolve_complemento_missing_payment_for_link(NEW.invoice_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_autoresolve_complemento_missing_payment_insert
  ON public.odoo_payment_invoice_links;

CREATE TRIGGER trg_autoresolve_complemento_missing_payment_insert
AFTER INSERT ON public.odoo_payment_invoice_links
FOR EACH ROW EXECUTE FUNCTION public.trg_autoresolve_complemento_missing_payment();

-- Backfill
DO $$
DECLARE v_count int;
BEGIN
  WITH r AS (
    UPDATE public.reconciliation_issues ri
    SET resolved_at = now(),
        resolution = 'auto_odoo_payment_linked (backfill phase_1)'
    WHERE ri.resolved_at IS NULL
      AND ri.issue_type = 'complemento_missing_payment'
      AND EXISTS (
        SELECT 1 FROM public.odoo_payment_invoice_links opl
        WHERE opl.invoice_id = ri.odoo_invoice_id
      )
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM r;

  INSERT INTO public.audit_runs (run_id, invariant_key, severity, source, model, details, run_at)
  VALUES (gen_random_uuid(), 'phase_1_autoresolve_complemento_missing_payment_backfill', 'ok', 'supabase', 'migration',
    jsonb_build_object('resolved_count', v_count), now());
END $$;
```

Ajustar nombres de columna si el schema real difiere (ej: `invoice_id` vs `move_id`).

- [ ] **Step 3.4: Ejecutar + validar**

```
mcp__claude_ai_Supabase__execute_sql <migración>
```
Validación:
```sql
SELECT
  (SELECT COUNT(*) FROM public.reconciliation_issues WHERE resolved_at IS NULL AND issue_type='complemento_missing_payment') AS still_open,
  (SELECT COUNT(*) FROM public.reconciliation_issues WHERE resolution='auto_odoo_payment_linked') AS auto_resolved;
```

- [ ] **Step 3.5: Commit**

```bash
git add supabase/migrations/20260420100200_phase_1_autoresolve_complemento_missing_payment.sql
git commit -m "feat(supabase): auto-resolve complemento_missing_payment via trigger en odoo_payment_invoice_links"
```

---

## Task 4: Auto-resolve `cancelled_but_posted`

**Files:**
- Create: `supabase/migrations/20260420100300_phase_1_autoresolve_cancelled_but_posted.sql`

- [ ] **Step 4.1: Regla**

Cierra cuando:
- `syntage_invoices.estatus` pasa a `vigente` (reversión SAT), O
- `odoo_invoices.state` pasa a `cancel` (cancelado en Odoo)

- [ ] **Step 4.2: Schemas**

```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='syntage_invoices' AND column_name ILIKE '%estatus%';
SELECT DISTINCT estatus FROM public.syntage_invoices LIMIT 10;
SELECT DISTINCT state FROM public.odoo_invoices LIMIT 10;
```

- [ ] **Step 4.3: Escribir migración**

`/Users/jj/supabase/migrations/20260420100300_phase_1_autoresolve_cancelled_but_posted.sql`:

```sql
-- Phase 1: auto-resolve cancelled_but_posted via triggers en syntage_invoices
-- y odoo_invoices.

CREATE OR REPLACE FUNCTION public.resolve_cancelled_but_posted(
  p_cfdi_uuid text, p_odoo_invoice_id bigint, p_reason text
) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE v_resolved integer := 0;
BEGIN
  WITH r AS (
    UPDATE public.reconciliation_issues ri
    SET resolved_at = now(),
        resolution = format('auto_cancellation_reconciled: %s', p_reason)
    WHERE ri.resolved_at IS NULL
      AND ri.issue_type = 'cancelled_but_posted'
      AND (
        (p_cfdi_uuid IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.odoo_invoices oi WHERE oi.id = ri.odoo_invoice_id AND oi.cfdi_uuid = p_cfdi_uuid
        ))
        OR (p_odoo_invoice_id IS NOT NULL AND ri.odoo_invoice_id = p_odoo_invoice_id)
      )
    RETURNING 1
  )
  SELECT count(*) INTO v_resolved FROM r;
  RETURN v_resolved;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_autoresolve_cancelled_syntage()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.estatus = 'vigente' AND COALESCE(OLD.estatus, '') <> 'vigente' THEN
    PERFORM public.resolve_cancelled_but_posted(NEW.uuid, NULL,
      format('syntage_invoices.estatus changed to vigente (was %s)', COALESCE(OLD.estatus, 'NULL')));
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_autoresolve_cancelled_odoo()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state = 'cancel' AND COALESCE(OLD.state, '') <> 'cancel' THEN
    PERFORM public.resolve_cancelled_but_posted(NEW.cfdi_uuid, NEW.id,
      format('odoo_invoices.state changed to cancel (was %s)', COALESCE(OLD.state, 'NULL')));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_autoresolve_cancelled_syntage_update ON public.syntage_invoices;
CREATE TRIGGER trg_autoresolve_cancelled_syntage_update
AFTER UPDATE OF estatus ON public.syntage_invoices
FOR EACH ROW EXECUTE FUNCTION public.trg_autoresolve_cancelled_syntage();

DROP TRIGGER IF EXISTS trg_autoresolve_cancelled_odoo_update ON public.odoo_invoices;
CREATE TRIGGER trg_autoresolve_cancelled_odoo_update
AFTER UPDATE OF state ON public.odoo_invoices
FOR EACH ROW EXECUTE FUNCTION public.trg_autoresolve_cancelled_odoo();

-- Backfill: resolver los 97 existentes si ya cumplen la condición
DO $$
DECLARE v_count int;
BEGIN
  WITH r AS (
    UPDATE public.reconciliation_issues ri
    SET resolved_at = now(),
        resolution = 'auto_cancellation_reconciled (backfill phase_1)'
    WHERE ri.resolved_at IS NULL
      AND ri.issue_type = 'cancelled_but_posted'
      AND (
        EXISTS (SELECT 1 FROM public.odoo_invoices oi WHERE oi.id = ri.odoo_invoice_id AND oi.state = 'cancel')
        OR EXISTS (SELECT 1 FROM public.odoo_invoices oi
                   JOIN public.syntage_invoices si ON si.uuid = oi.cfdi_uuid
                   WHERE oi.id = ri.odoo_invoice_id AND si.estatus = 'vigente')
      )
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM r;

  INSERT INTO public.audit_runs (run_id, invariant_key, severity, source, model, details, run_at)
  VALUES (gen_random_uuid(), 'phase_1_autoresolve_cancelled_but_posted_backfill', 'ok', 'supabase', 'migration',
    jsonb_build_object('resolved_count', v_count), now());
END $$;
```

- [ ] **Step 4.4: Ejecutar + validar**

```sql
SELECT COUNT(*) AS still_open FROM public.reconciliation_issues
WHERE resolved_at IS NULL AND issue_type='cancelled_but_posted';
```
Expected: baja de 97.

- [ ] **Step 4.5: Commit**

```bash
git add supabase/migrations/20260420100300_phase_1_autoresolve_cancelled_but_posted.sql
git commit -m "feat(supabase): auto-resolve cancelled_but_posted via triggers syntage+odoo"
```

---

## Task 5: Auto-resolve `amount_mismatch`

**Files:**
- Create: `supabase/migrations/20260420100400_phase_1_autoresolve_amount_mismatch.sql`

- [ ] **Step 5.1: Regla**

Cierra cuando los montos reconcilian (diferencia absoluta <$0.01).

- [ ] **Step 5.2: Determinar qué montos comparar**

```sql
-- Inspecciona un amount_mismatch para entender qué comparan
SELECT * FROM public.reconciliation_issues
WHERE issue_type = 'amount_mismatch' AND resolved_at IS NULL LIMIT 3;
```

Probablemente: `odoo_invoices.amount_total` vs `syntage_invoices.total` cuando `oi.cfdi_uuid = si.uuid`.

- [ ] **Step 5.3: Escribir migración**

`/Users/jj/supabase/migrations/20260420100400_phase_1_autoresolve_amount_mismatch.sql`:

```sql
-- Phase 1: auto-resolve amount_mismatch cuando los totales reconcilian.

CREATE OR REPLACE FUNCTION public.resolve_amount_mismatch_for_invoice(p_odoo_invoice_id bigint)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE v_resolved integer := 0;
BEGIN
  WITH r AS (
    UPDATE public.reconciliation_issues ri
    SET resolved_at = now(),
        resolution = 'auto_amount_reconciled (totals converge within $0.01)'
    WHERE ri.resolved_at IS NULL
      AND ri.issue_type = 'amount_mismatch'
      AND ri.odoo_invoice_id = p_odoo_invoice_id
      AND EXISTS (
        SELECT 1 FROM public.odoo_invoices oi
        JOIN public.syntage_invoices si ON si.uuid = oi.cfdi_uuid
        WHERE oi.id = p_odoo_invoice_id
          AND ABS(COALESCE(oi.amount_total, 0) - COALESCE(si.total, 0)) < 0.01
      )
    RETURNING 1
  )
  SELECT count(*) INTO v_resolved FROM r;
  RETURN v_resolved;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_autoresolve_amount_mismatch_odoo()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.amount_total IS DISTINCT FROM COALESCE(OLD.amount_total, -1) THEN
    PERFORM public.resolve_amount_mismatch_for_invoice(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_autoresolve_amount_mismatch_syntage()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_oi_id bigint;
BEGIN
  IF NEW.total IS DISTINCT FROM COALESCE(OLD.total, -1) THEN
    SELECT id INTO v_oi_id FROM public.odoo_invoices WHERE cfdi_uuid = NEW.uuid LIMIT 1;
    IF v_oi_id IS NOT NULL THEN
      PERFORM public.resolve_amount_mismatch_for_invoice(v_oi_id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_autoresolve_amount_mismatch_odoo_update ON public.odoo_invoices;
CREATE TRIGGER trg_autoresolve_amount_mismatch_odoo_update
AFTER UPDATE OF amount_total ON public.odoo_invoices
FOR EACH ROW EXECUTE FUNCTION public.trg_autoresolve_amount_mismatch_odoo();

DROP TRIGGER IF EXISTS trg_autoresolve_amount_mismatch_syntage_update ON public.syntage_invoices;
CREATE TRIGGER trg_autoresolve_amount_mismatch_syntage_update
AFTER UPDATE OF total ON public.syntage_invoices
FOR EACH ROW EXECUTE FUNCTION public.trg_autoresolve_amount_mismatch_syntage();

-- Backfill
DO $$
DECLARE v_count int;
BEGIN
  WITH r AS (
    UPDATE public.reconciliation_issues ri
    SET resolved_at = now(),
        resolution = 'auto_amount_reconciled (backfill phase_1)'
    WHERE ri.resolved_at IS NULL
      AND ri.issue_type = 'amount_mismatch'
      AND EXISTS (
        SELECT 1 FROM public.odoo_invoices oi
        JOIN public.syntage_invoices si ON si.uuid = oi.cfdi_uuid
        WHERE oi.id = ri.odoo_invoice_id
          AND ABS(COALESCE(oi.amount_total, 0) - COALESCE(si.total, 0)) < 0.01
      )
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM r;

  INSERT INTO public.audit_runs (run_id, invariant_key, severity, source, model, details, run_at)
  VALUES (gen_random_uuid(), 'phase_1_autoresolve_amount_mismatch_backfill', 'ok', 'supabase', 'migration',
    jsonb_build_object('resolved_count', v_count), now());
END $$;
```

- [ ] **Step 5.4: Ejecutar + validar**

```sql
SELECT COUNT(*) AS still_open FROM public.reconciliation_issues
WHERE resolved_at IS NULL AND issue_type='amount_mismatch';
```
Expected: posiblemente 0 (si los 19 tenían match exacto ya) o <19.

- [ ] **Step 5.5: Commit**

```bash
git add supabase/migrations/20260420100400_phase_1_autoresolve_amount_mismatch.sql
git commit -m "feat(supabase): auto-resolve amount_mismatch via triggers amount_total/total"
```

---

## Task 6: Syntage backfill del gap 18%

**Files:**
- Create: `scripts/syntage_backfill_gap.sh`
- Create: `docs/superpowers/notes/2026-04-20-syntage-backfill-gap.md`

- [ ] **Step 6.1: Identificar meses con gap**

```sql
SELECT date_trunc('month', invoice_date) AS month,
       COUNT(*) AS odoo_without_syntage
FROM public.odoo_invoices
WHERE cfdi_uuid IS NOT NULL
  AND cfdi_uuid NOT IN (SELECT uuid FROM public.syntage_invoices WHERE uuid IS NOT NULL)
GROUP BY 1 ORDER BY 1;
```
Guardar resultado.

- [ ] **Step 6.2: Verificar API de Syntage disponible**

Buscar:
```
Grep pattern: "syntage\\.ai|syntage.*api|api/syntage"
  path: /Users/jj/quimibond-intelligence/quimibond-intelligence/src
  output_mode: files_with_matches
```
Revisar el endpoint que dispara extractions (`/api/syntage/extract` o similar).

- [ ] **Step 6.3: Escribir script de backfill**

`/Users/jj/scripts/syntage_backfill_gap.sh` (ajustar según cómo Syntage acepte el rango):

```bash
#!/usr/bin/env bash
# Phase 1: backfill Syntage para meses con gap >5%.
# Uso: ./syntage_backfill_gap.sh
# Requiere: SUPABASE_SERVICE_ROLE_KEY, SYNTAGE_API_KEY en env.

set -euo pipefail

MONTHS=(<lista de YYYY-MM del Step 6.1>)
for m in "${MONTHS[@]}"; do
  echo "Triggering extraction for $m..."
  curl -s -X POST \
    -H "Authorization: Bearer $SYNTAGE_API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"month\":\"$m\",\"taxpayer_rfc\":\"<RFC_QUIMIBOND>\"}" \
    https://api.syntage.ai/v1/extractions
  sleep 2   # rate limit
done
```

**Nota:** si no hay API de Syntage externa, alternativa es disparar vía UI admin de la aplicación. Documentar en el notes file si el script no se puede automatizar.

- [ ] **Step 6.4: Ejecutar backfill (humano, no agente)**

Este step DEBE ser ejecutado por el usuario (requiere credenciales Syntage). El subagente documenta los meses y el comando, pero NO lo ejecuta. Reporte al user con los meses afectados.

- [ ] **Step 6.5: Monitorear `syntage_webhook_events`**

```sql
SELECT date_trunc('hour', received_at) AS hour, COUNT(*) AS events
FROM public.syntage_webhook_events
WHERE received_at > now() - interval '4 hours'
GROUP BY 1 ORDER BY 1 DESC LIMIT 10;
```

- [ ] **Step 6.6: Validar gap reducido**

Después de que Syntage termine:
```sql
SELECT COUNT(*) AS gap_remaining
FROM public.odoo_invoices
WHERE cfdi_uuid IS NOT NULL
  AND cfdi_uuid NOT IN (SELECT uuid FROM public.syntage_invoices);
```
Expected: <5% del universo Odoo con CFDI.

- [ ] **Step 6.7: Commit**

```bash
git add scripts/syntage_backfill_gap.sh docs/superpowers/notes/2026-04-20-syntage-backfill-gap.md
git commit -m "docs(syntage): backfill script + notes para gap 18% CFDIs Odoo sin Syntage"
```

**Out of scope del subagente:** ejecución real del backfill — requiere credenciales del user.

---

## Task 7: Migrar `invoices.ts` + `finance.ts` (AR aging)

**Files:**
- Modify: `<path>/src/lib/queries/invoices.ts` (o ruta equivalente de Step 0.4)
- Modify: `<path>/src/lib/queries/finance.ts`

- [ ] **Step 7.1: Leer ambos archivos**

```
Read /Users/jj/quimibond-intelligence/quimibond-intelligence/<path>/invoices.ts
Read /Users/jj/quimibond-intelligence/quimibond-intelligence/<path>/finance.ts
```

Identifica:
1. Función `legacyGetArAging()` o similar
2. Función `unifiedGetArAging()`
3. El switch basado en `process.env.USE_UNIFIED_LAYER`

- [ ] **Step 7.2: Eliminar legacy + switch, dejar solo unified**

Edit ambos archivos:
- Borrar funciones `legacy*`.
- Borrar el switch `if (process.env.USE_UNIFIED_LAYER === 'true')`.
- La función principal (ej: `getArAgingByCompany`) solo llama a la ruta unified.
- Ajustar imports (quitar `legacyGetArAging` importado).

Si el archivo lee raw `odoo_invoices` en alguna otra función: cambiar a `invoices_unified` o `ar_aging_detail` MV.

- [ ] **Step 7.3: Correr type-check y build**

```bash
cd /Users/jj/quimibond-intelligence/quimibond-intelligence
pnpm type-check 2>&1 | tail -20
pnpm build 2>&1 | tail -30
```
Expected: 0 errores.

- [ ] **Step 7.4: Spot-check local dev**

```bash
pnpm dev &
sleep 8
curl -s http://localhost:3000/api/dashboard/ar-aging 2>/dev/null | head -c 500
```
Expected: JSON con aging data (no error). Mata el dev server después.

- [ ] **Step 7.5: Commit**

```bash
cd /Users/jj/quimibond-intelligence/quimibond-intelligence
git add <paths>
git commit -m "refactor(queries): invoices+finance usan solo invoices_unified (quitar legacy*)

Eliminar USE_UNIFIED_LAYER switch + legacyGetArAging; dejar una sola
ruta via invoices_unified + ar_aging_detail MV."
```

---

## Task 8: Migrar `sales.ts`

**Files:**
- Modify: `<path>/sales.ts`

- [ ] **Step 8.1: Leer archivo**

```
Read /Users/jj/quimibond-intelligence/quimibond-intelligence/<path>/sales.ts
```

Identifica las 10 ubicaciones con `supabase.from("odoo_sale_orders")` y `odoo_purchase_orders`.

- [ ] **Step 8.2: Mapear queries raw → unified**

Para cada uso:
- Aggregates por empresa (total_revenue, revenue_90d, orders_ytd) → `company_profile`
- Lista de órdenes específicas → `invoices_unified WHERE company_id=X AND source='odoo'` (si la MV tiene ese filtro) o fallback a `odoo_sale_orders` SOLO para detalle granular (nota: idealmente migramos a `monthly_revenue_by_company` MV).
- Top customers por revenue → `company_profile ORDER BY revenue_ytd`

**Nota:** si hay queries que necesitan campos de `odoo_sale_orders` NO disponibles en unified (ej: `odoo_order_id`, `carrier_id`), puede requerir o (a) extender `invoices_unified` / `company_profile`, o (b) dejar esa query con un comment `// legitimate raw use: necesita campo X no en unified`. Documentar.

- [ ] **Step 8.3: Edit incremental**

Cada uso cambiar, type-check después de cada 2-3 cambios para catch errors rápidamente.

```bash
cd /Users/jj/quimibond-intelligence/quimibond-intelligence
pnpm type-check 2>&1 | tail -10
```

- [ ] **Step 8.4: Build + smoke test**

```bash
pnpm build 2>&1 | tail -20
pnpm dev & sleep 8
curl -s http://localhost:3000/api/sales/summary 2>/dev/null | head -c 500
# mata dev
```

- [ ] **Step 8.5: Commit**

```bash
git add <path>
git commit -m "refactor(queries): sales.ts usa company_profile + invoices_unified (quitar raw odoo_sale_orders/purchase_orders)"
```

---

## Task 9: Migrar `companies.ts`

**Files:**
- Modify: `<path>/companies.ts`

- [ ] **Step 9.1: Leer archivo — enfoque especial en líneas 443-800 (spec)**

```
Read <path>/companies.ts
```

Identifica queries a `odoo_sale_orders`, `odoo_invoices`, `odoo_deliveries`.

- [ ] **Step 9.2: Migrar a `company_profile` extendido**

Para cada uso:
- Stats de ventas/compras → `company_profile.*_ytd` + `total_revenue`
- Aging → `company_profile.ar_aging_buckets` + `overdue_*`
- OTD deliveries → `company_profile.otd_rate_90d`
- SAT compliance → `company_profile.sat_compliance_score`
- Detalle de invoices específicos (para página de empresa) → `invoices_unified WHERE company_id=X`

- [ ] **Step 9.3: Type-check + build + smoke**

Igual que Task 8.

- [ ] **Step 9.4: Commit**

```bash
git commit -m "refactor(queries): companies.ts usa company_profile extendido como one-stop"
```

---

## Task 10: Migrar `customer-360.ts`

**Files:**
- Modify: `<path>/customer-360.ts`

- [ ] **Step 10.1: Añadir cruces a unified**

Hoy solo lee `agent_insights`. Añadir:
- Facturas abiertas: `invoices_unified WHERE company_id=X AND days_overdue >= 0 ORDER BY invoice_date DESC LIMIT 20`
- Pagos recientes: `payments_unified WHERE company_id=X ORDER BY payment_date DESC LIMIT 20`
- Profile: `company_profile WHERE company_id=X` (aging, SAT, tier, risk)

- [ ] **Step 10.2: Type-check + build + smoke test**

```bash
pnpm build 2>&1 | tail -20
pnpm dev & sleep 8
curl -s "http://localhost:3000/api/customer/1/360" 2>/dev/null | head -c 800
```

- [ ] **Step 10.3: Commit**

```bash
git commit -m "refactor(queries): customer-360 incluye invoices+payments unified + company_profile"
```

---

## Task 11: Migrar `director-chat-context.ts`

**Files:**
- Modify: `<path>/director-chat-context.ts`

Este archivo alimenta el contexto para el chat con Claude — el más sensible.

- [ ] **Step 11.1: Leer + identificar las ~10 queries raw**

Busca líneas que hagan `.from("odoo_invoices")`, `.from("odoo_account_payments")`, `.from("odoo_purchase_orders")`.

- [ ] **Step 11.2: Reemplazar con unified**

- `odoo_invoices` → `invoices_unified` (mismo schema, con columnas SAT adicionales)
- `odoo_account_payments` → `payments_unified`
- `odoo_purchase_orders` → `company_profile.purchases_ytd` (si es aggregate), o mantener raw si es detalle específico **con comment** explicando la excepción.
- Mantener `reconciliation_issues` (es parte del layer unified conceptualmente).

- [ ] **Step 11.3: Type-check + build**

- [ ] **Step 11.4: Smoke test del chat (si accesible)**

```bash
pnpm dev & sleep 8
curl -s -X POST http://localhost:3000/api/directors/chat \
  -H "Content-Type: application/json" \
  -d '{"director":"cfo","message":"resumen ar aging","companyId":1}' \
  2>/dev/null | head -c 800
```
Expected: respuesta coherente, no error.

- [ ] **Step 11.5: Commit**

```bash
git commit -m "refactor(queries): director-chat-context usa unified layer + reconciliation_issues"
```

---

## Task 12: Eliminar `USE_UNIFIED_LAYER` + funciones legacy

**Files:**
- Modify: múltiples — grep de Step 0.4
- Modify: `.env.example`
- Modify: `README.md` si menciona el flag

- [ ] **Step 12.1: Grep final**

```
Grep pattern: "USE_UNIFIED_LAYER"
  path: /Users/jj/quimibond-intelligence/quimibond-intelligence
  output_mode: content
  -n: true
```
Expected: solo ocurrencias en `.env.example` y README (tras Tasks 7-11 debería estar limpio en código).

- [ ] **Step 12.2: Eliminar del env + docs**

Edit `.env.example` — quitar la línea `USE_UNIFIED_LAYER=...`.
Edit README.md si menciona el flag.

Eliminar cualquier función `legacy*` que aún exista:
```
Grep pattern: "legacyGetArAging|legacyGet|legacyFetch"
  path: src
  output_mode: files_with_matches
```
Para cada archivo: abrir, borrar función + imports, type-check.

- [ ] **Step 12.3: Type-check + build final**

```bash
pnpm type-check 2>&1 | tail -10
pnpm build 2>&1 | tail -20
```

- [ ] **Step 12.4: Commit**

```bash
git add .env.example README.md <archivos legacy borrados>
git commit -m "chore: remove USE_UNIFIED_LAYER feature flag and legacy* helpers

Todos los consumers migrados a unified (tasks 7-11)."
```

---

## Task 13: DoD + PR + baseline final

**Files:**
- Create: `supabase/migrations/20260420100600_phase_1_final_invariants.sql`
- Modify: `docs/superpowers/notes/2026-04-20-fase-1-baseline.md`

- [ ] **Step 13.1: Validación "0 raw fuera de admin/debug"**

```
Grep pattern: "supabase\\.from\\(['\"]odoo_(invoices|payments|account_payments)['\"]\\)"
  path: /Users/jj/quimibond-intelligence/quimibond-intelligence/src
  output_mode: content
  -n: true
```

Expected: 0 matches fuera de `src/lib/admin/**` o `src/lib/debug/**` o archivos específicamente anotados como excepción.

Si quedan — iterar tasks 7-11 o documentar la razón.

- [ ] **Step 13.2: phase_1_final invariants**

Crear `/Users/jj/supabase/migrations/20260420100600_phase_1_final_invariants.sql`:

```sql
INSERT INTO public.audit_runs (run_id, invariant_key, severity, source, model, details, run_at)
SELECT
  gen_random_uuid(),
  'phase_1_final',
  'ok',
  'supabase',
  'final',
  jsonb_build_object(
    'reconciliation_issues_open_total', (SELECT COUNT(*) FROM public.reconciliation_issues WHERE resolved_at IS NULL),
    'reconciliation_issues_open_payment_missing_complemento', (SELECT COUNT(*) FROM public.reconciliation_issues WHERE resolved_at IS NULL AND issue_type='payment_missing_complemento'),
    'reconciliation_issues_open_complemento_missing_payment', (SELECT COUNT(*) FROM public.reconciliation_issues WHERE resolved_at IS NULL AND issue_type='complemento_missing_payment'),
    'reconciliation_issues_open_cancelled_but_posted', (SELECT COUNT(*) FROM public.reconciliation_issues WHERE resolved_at IS NULL AND issue_type='cancelled_but_posted'),
    'reconciliation_issues_open_amount_mismatch', (SELECT COUNT(*) FROM public.reconciliation_issues WHERE resolved_at IS NULL AND issue_type='amount_mismatch'),
    'syntage_gap_cfdis', (SELECT COUNT(*) FROM public.odoo_invoices WHERE cfdi_uuid IS NOT NULL AND cfdi_uuid NOT IN (SELECT uuid FROM public.syntage_invoices)),
    'syntage_match_pct_odoo_to_syntage', (
      SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE cfdi_uuid IN (SELECT uuid FROM public.syntage_invoices)) / NULLIF(COUNT(*) FILTER (WHERE cfdi_uuid IS NOT NULL), 0), 2)
      FROM public.odoo_invoices
    ),
    'company_profile_columns', (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='company_profile'),
    'company_profile_kind', (SELECT CASE WHEN relkind='m' THEN 'matview' WHEN relkind='v' THEN 'view' ELSE relkind::text END FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid WHERE n.nspname='public' AND c.relname='company_profile')
  ),
  now();
```

Ejecutar.

- [ ] **Step 13.3: Actualizar notes + memory**

Append a `/Users/jj/docs/superpowers/notes/2026-04-20-fase-1-baseline.md`:

```markdown
## Final (2026-04-20/21)

<JSON>

## Delta baseline → final

| Métrica | Baseline | Final |
|---|---|---|
| payment_missing_complemento open | 5552 | <n> |
| complemento_missing_payment open | 933 | <n> |
| cancelled_but_posted open | 97 | <n> |
| amount_mismatch open | 19 | <n> |
| syntage_gap_cfdis | 3482 | <n> |
| syntage_match_pct | 82 | <n> |
| company_profile columns | <n> | <n+> |

**Fase 1 cerrada: 2026-04-XX**
```

Edit `/Users/jj/.claude/projects/-Users-jj/memory/project_supabase_audit_2026_04_19.md` añadiendo al bloque `**Estado ...:**`:

```markdown
- **Fase 1 COMPLETADA** 2026-04-XX. PR #<n> pendiente.
```

- [ ] **Step 13.4: Push ambas ramas**

```bash
cd /Users/jj
git push -u origin fase-1-ui-unificada

cd /Users/jj/quimibond-intelligence/quimibond-intelligence
git push -u origin fase-1-ui-unificada
```

- [ ] **Step 13.5: Abrir PRs**

```bash
cd /Users/jj
gh pr create --title "supabase: Fase 1 — UI Unificada" --body "$(cat <<'EOF'
## Summary

Fase 1 del audit Supabase: migrar consumers del frontend a unified layer + auto-resolve de 4 issue_types eternos + extender company_profile.

## DB changes (qb19 repo)
- `company_profile` extendido con YTD, ar_aging_buckets, sat_compliance_score, last_activity_at; convertido a MATERIALIZED VIEW con unique index.
- Auto-resolve triggers para 4 issue_types:
  - `payment_missing_complemento` — trigger en `syntage_invoice_payments`
  - `complemento_missing_payment` — trigger en `odoo_payment_invoice_links`
  - `cancelled_but_posted` — trigger en `syntage_invoices.estatus` y `odoo_invoices.state`
  - `amount_mismatch` — trigger en `amount_total`/`total`
- Backfill scripts corrieron para cerrar existing issues donde aplicaba.

## Frontend changes
Ver PR en quimibond-intelligence repo.

## Baseline → Final
<tabla del notes file>

Spec: docs/superpowers/specs/2026-04-19-supabase-audit-02-ui-unificada.md
Plan: docs/superpowers/plans/2026-04-20-supabase-audit-fase-1-ui-unificada.md

🤖 Generated with [claude-flow](https://github.com/ruvnet/claude-flow)
EOF
)"

cd /Users/jj/quimibond-intelligence/quimibond-intelligence
gh pr create --title "queries: Fase 1 — migrar consumers a unified layer" --body "$(cat <<'EOF'
## Summary

Migrar 5 archivos de queries del frontend de raw Odoo/Syntage a unified layer. Eliminar feature flag USE_UNIFIED_LAYER y helpers legacy*.

## Files
- `<lista de paths>`

## Verified
- `grep supabase.from("odoo_invoices"|"odoo_payments"|"odoo_account_payments")` en src/ fuera de admin/debug → 0 matches
- `pnpm type-check` passing
- `pnpm build` passing
- Smoke tests: /dashboard/ar, /customer/[id], /sales, director chat

## Backend dep
Requiere que el PR de qb19 se mergee primero (company_profile extendido + MVs + triggers).

🤖 Generated with [claude-flow](https://github.com/ruvnet/claude-flow)
EOF
)"
```

- [ ] **Step 13.6: Reportar al user**

Proporcionar al usuario:
- URLs de ambos PRs
- Pasos manuales pendientes:
  - Ejecutar el `scripts/syntage_backfill_gap.sh` (requiere SYNTAGE_API_KEY)
  - Mergear PRs en orden: qb19 primero, quimibond-intelligence después.

## DoD de la fase

1. `company_profile` MV con nuevas columnas: ✓
2. 4 `issue_types` con triggers de auto-resolve + backfill: ✓
3. Syntage gap documentado + script listo (ejecución manual pendiente del user)
4. 0 `supabase.from("odoo_*")` en `/app/**` y `/lib/**` fuera de admin/debug: ✓
5. `USE_UNIFIED_LAYER` eliminado + legacy* helpers borrados: ✓
6. Ambos PRs abiertos y listos para review: ✓

---

## Out of scope (para Fase 2+)

- Fix raíz del duplicado en `_push_invoices` del addon (Fase 2)
- Drop de tablas muertas (Fase 2)
- Consolidar funciones/triggers duplicados (Fase 2)
- RLS policies reales (Fase 3)
- Performance de MVs post-extensión (Fase 4 si hace falta)
