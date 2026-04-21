# Fase 2.6 — Fiscal Goldmine + Balance Sheet + 69B Risk Surface: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extraer los 6 campos fiscales de alto valor escondidos en `syntage_invoices.raw_payload` (Item 1), crear el primer `balance_sheet` view de Quimibond (Item 2), exponer el riesgo 69B agregado por empresa + alertas (Item 3), y podar 4 views `analytics_*` que son wrappers idénticos de `syntage_*` (Item 4).

**Architecture:** Solo migrations SQL en `quimibond-intelligence` (frontend repo) en branch `fase-2-6-fiscal-goldmine`. Cada task = 1 commit. Las operaciones destructivas (DROP de los 4 wrappers) están detrás de un gate de OK explícito del usuario antes del merge. El addon qb19 **no se toca** en esta fase (solo lectura). Frontend `CLAUDE.md` se actualiza al final.

**Tech Stack:** PostgreSQL 15 (Supabase `tozqezmivpblmcubmnpi`), SQL puro.

**Spec:** `/Users/jj/docs/superpowers/specs/2026-04-21-supabase-audit-07-desaprovechado.md` (Items #1, #3, #4, #5 del Top-10).

---

## Pre-audit state (verificado 2026-04-20)

Queries ejecutadas contra Supabase producción confirman los hallazgos del spec 07:

| Item | Valor confirmado |
|---|---|
| `syntage_invoices` total | 129,690 rows (spec decía 129,673 — 17 rows llegaron entre audit y plan) |
| `raw_payload` | jsonb, poblado en 129,690/129,690 (100 %) |
| `raw_payload->>'fullyPaidAt'` no-null | 23,381 (18 %) — fecha SAT de cobro total |
| `raw_payload->>'paidAmount' > 0` | 23,564 (18 %) |
| `raw_payload->>'dueDate'` no-null | 29,267 (23 %) |
| `raw_payload->>'cancellationProcessStatus'` no-null | 2,740 (2 %) |
| Otros keys top-level confirmados | `paidAmount`, `dueAmount`, `dueDate`, `creditedAmount`, `paymentTerms` (jsonb), `paymentTermsRaw`, `fullyPaidAt`, `cancellationProcessStatus`, `lastPaymentDate`, `cancellationStatus`, `canceledAt`, `certifiedAt`, `exchangeRate`, `subtotalCreditedAmount` |
| Sample real verificado | uuid=`de6273b5…` → `fullyPaidAt='2026-03-27'`, `paidAmount=13,163,920.49`, `dueAmount=0` |
| `emisor_blacklist_status` enum | `null`, `presumed`, `definitive` |
| `receptor_blacklist_status` enum | `null`, `definitive` (no hay `presumed` en receptor) |
| Contadores 69B | 389 emisor-presumed + 3 emisor-definitive + 35 receptor-definitive + 0 receptor-presumed |
| RFCs distintos con flag 69B | 8 emisor + 5 receptor |
| `odoo_account_balances` columns | `id, odoo_account_id, account_code, account_name, account_type, period, debit, credit, balance, synced_at` |
| `odoo_chart_of_accounts` columns | `id, odoo_account_id, code, name, account_type, reconcile, deprecated, synced_at, odoo_company_id, active` |
| `account_type` enum (18 valores) | `asset_cash, asset_current, asset_fixed, asset_prepayments, asset_receivable, equity, equity_unaffected, expense, expense_depreciation, expense_direct_cost, expense_other, income, income_other, liability_credit_card, liability_current, liability_non_current, liability_payable, off_balance` |
| Períodos recientes balance | `2026-04, 2026-03, 2026-02, 2026-01, 2025-12` |
| `pl_estado_resultados` existente | ✓ (filtra por `period ~ '^20[12][0-9]-[01][0-9]$'`) |
| Wrappers `analytics_*` idénticos | 4 confirmados: `analytics_customer_cancellation_rates`, `analytics_customer_fiscal_lifetime`, `analytics_product_fiscal_line_analysis`, `analytics_supplier_fiscal_lifetime` |
| Originales syntage_ | `syntage_client_cancellation_rates`, `syntage_top_clients_fiscal_lifetime`, `syntage_product_line_analysis`, `syntage_top_suppliers_fiscal_lifetime` |
| `schema_changes` columns | `id, change_type, table_name, description, sql_executed, triggered_by, success, error_message, created_at` |
| `audit_runs` columns | `id, run_id, run_at, source, model, invariant_key, bucket_key, odoo_value, supabase_value, diff, severity, date_from, date_to, details` |
| `refresh_all_matviews()` | función modificable — incluye 33 MVs hoy; añadir `syntage_invoices_enriched` al final |
| `safe_refresh_mv` helper | **No existe** — usar `REFRESH MATERIALIZED VIEW CONCURRENTLY` directo |

**Supuestos cerrados sin necesidad de reconfirmar:**
- Capa unified (invoices_unified, payments_unified, company_profile*) está sana post-Fase 2.5.
- Fase 2.5 + 2.5.1 mergeadas a `main` en frontend + qb19.
- `companies` tiene `id, rfc, canonical_name, name` (verificado).

---

## File Structure

### Branch `fase-2-6-fiscal-goldmine` en `/Users/jj/quimibond-intelligence/quimibond-intelligence`

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `supabase/migrations/20260422_fase26_00_baseline.sql` | Create | Snapshot baseline en `audit_runs` |
| `supabase/migrations/20260422_fase26_01_syntage_invoices_enriched_mv.sql` | Create | `syntage_invoices_enriched` MV con los 6 campos extraídos |
| `supabase/migrations/20260422_fase26_02_syntage_enriched_refresh.sql` | Create | Añadir MV al body de `refresh_all_matviews()` |
| `supabase/migrations/20260422_fase26_03_balance_sheet_view.sql` | Create | `balance_sheet` view (assets/liabilities/equity por período) |
| `supabase/migrations/20260422_fase26_04_company_69b_status_view.sql` | Create | `company_69b_status` view (agregado por company_id) |
| `supabase/migrations/20260422_fase26_05_blacklist_alerts_table.sql` | Create | `blacklist_alerts` tabla append-only |
| `supabase/migrations/20260422_fase26_06_blacklist_alerts_trigger.sql` | Create | Trigger INSERT `syntage_invoices` → `blacklist_alerts` |
| `supabase/migrations/20260422_fase26_07_drop_analytics_wrappers.sql` | Create (gated) | DROP 4 wrappers `analytics_*` |
| `supabase/migrations/20260422_fase26_08_final.sql` | Create | Snapshot final + invariantes |
| `docs/superpowers/plans/2026-04-22-supabase-audit-fase-2-6-audit-notes.md` | Create | Evidence pre/post |
| `CLAUDE.md` (frontend) | Modify | Añadir nuevos objetos a `## Base de datos` |

---

## Pre-flight

### Task 0: Pre-flight audit + baseline snapshot

**Files:**
- Create: `quimibond-intelligence/quimibond-intelligence/docs/superpowers/plans/2026-04-22-supabase-audit-fase-2-6-audit-notes.md`
- Create: `quimibond-intelligence/quimibond-intelligence/supabase/migrations/20260422_fase26_00_baseline.sql`

- [ ] **Step 1: Crear branch**

```bash
cd /Users/jj/quimibond-intelligence/quimibond-intelligence
git checkout main
git pull origin main
git checkout -b fase-2-6-fiscal-goldmine
```

- [ ] **Step 2: Ejecutar queries de baseline en Supabase**

```sql
-- 1) Cobertura fiscal en raw_payload (meta)
SELECT
  (SELECT count(*) FROM syntage_invoices) AS total_cfdi,
  (SELECT count(*) FROM syntage_invoices WHERE raw_payload IS NOT NULL) AS with_payload,
  (SELECT count(*) FROM syntage_invoices WHERE raw_payload->>'fullyPaidAt' IS NOT NULL) AS with_fully_paid_at,
  (SELECT count(*) FROM syntage_invoices WHERE raw_payload->>'dueDate' IS NOT NULL) AS with_due_date,
  (SELECT count(*) FROM syntage_invoices WHERE (raw_payload->>'paidAmount')::numeric > 0) AS with_paid_gt_0,
  (SELECT count(*) FROM syntage_invoices WHERE raw_payload->>'cancellationProcessStatus' IS NOT NULL) AS with_cancellation_status;

-- 2) Balance de cuentas actual (meta)
SELECT
  (SELECT count(DISTINCT period) FROM odoo_account_balances) AS distinct_periods,
  (SELECT count(*) FROM odoo_account_balances) AS total_balance_rows,
  (SELECT count(DISTINCT account_type) FROM odoo_chart_of_accounts) AS distinct_types,
  (SELECT count(*) FROM odoo_chart_of_accounts) AS total_accounts;

-- 3) 69B distribution
SELECT
  emisor_blacklist_status, receptor_blacklist_status, count(*) AS n
FROM syntage_invoices
WHERE emisor_blacklist_status IS NOT NULL OR receptor_blacklist_status IS NOT NULL
GROUP BY 1,2 ORDER BY n DESC;

-- 4) Wrappers analytics_* (meta)
SELECT viewname, length(pg_get_viewdef(format('public.%I', viewname)::regclass)::text) AS def_len
FROM pg_views
WHERE schemaname='public'
  AND viewname IN (
    'analytics_customer_cancellation_rates',
    'analytics_customer_fiscal_lifetime',
    'analytics_product_fiscal_line_analysis',
    'analytics_supplier_fiscal_lifetime'
  )
ORDER BY viewname;

-- 5) Pre-existence check
SELECT
  (SELECT count(*) FROM pg_matviews WHERE schemaname='public' AND matviewname='syntage_invoices_enriched') AS mv_enriched_exists,
  (SELECT count(*) FROM pg_views WHERE schemaname='public' AND viewname='balance_sheet') AS view_balance_sheet_exists,
  (SELECT count(*) FROM pg_views WHERE schemaname='public' AND viewname='company_69b_status') AS view_69b_exists,
  (SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename='blacklist_alerts') AS table_alerts_exists;
```

Pegar outputs en `audit-notes.md` bajo `## Antes`.

- [ ] **Step 3: Escribir migration baseline**

`supabase/migrations/20260422_fase26_00_baseline.sql`:

```sql
-- Fase 2.6 baseline: snapshot antes de extraer raw_payload, crear balance_sheet y 69B surface
INSERT INTO public.audit_runs (run_id, invariant_key, severity, source, model, details, run_at)
SELECT
  gen_random_uuid(),
  'phase_2_6_baseline',
  'ok',
  'supabase',
  'baseline',
  jsonb_build_object(
    'mv_enriched_exists', (SELECT count(*) FROM pg_matviews WHERE schemaname='public' AND matviewname='syntage_invoices_enriched'),
    'view_balance_sheet_exists', (SELECT count(*) FROM pg_views WHERE schemaname='public' AND viewname='balance_sheet'),
    'view_69b_exists', (SELECT count(*) FROM pg_views WHERE schemaname='public' AND viewname='company_69b_status'),
    'table_alerts_exists', (SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename='blacklist_alerts'),
    'syntage_invoices_total', (SELECT count(*) FROM syntage_invoices),
    'syntage_with_fully_paid_at', (SELECT count(*) FROM syntage_invoices WHERE raw_payload->>'fullyPaidAt' IS NOT NULL),
    'syntage_with_due_date', (SELECT count(*) FROM syntage_invoices WHERE raw_payload->>'dueDate' IS NOT NULL),
    'syntage_emisor_presumed', (SELECT count(*) FROM syntage_invoices WHERE emisor_blacklist_status='presumed'),
    'syntage_emisor_definitive', (SELECT count(*) FROM syntage_invoices WHERE emisor_blacklist_status='definitive'),
    'syntage_receptor_definitive', (SELECT count(*) FROM syntage_invoices WHERE receptor_blacklist_status='definitive'),
    'analytics_wrappers_present', (SELECT count(*) FROM pg_views WHERE schemaname='public' AND viewname IN (
      'analytics_customer_cancellation_rates','analytics_customer_fiscal_lifetime',
      'analytics_product_fiscal_line_analysis','analytics_supplier_fiscal_lifetime'
    ))
  ),
  now();
```

Ejecutar vía `mcp__claude_ai_Supabase__execute_sql`. Expected: `INSERT 0 1`.

- [ ] **Step 4: Escribir `audit-notes.md` con `## Antes`**

Pegar los 5 outputs de Step 2 bajo `## Antes`.

- [ ] **Step 5: Commit**

```bash
cd /Users/jj/quimibond-intelligence/quimibond-intelligence
git add supabase/migrations/20260422_fase26_00_baseline.sql docs/superpowers/plans/2026-04-22-supabase-audit-fase-2-6-audit-notes.md
git commit -m "docs(audit): fase 2.6 fiscal goldmine pre-flight baseline"
```

---

## Fase A — Fiscal goldmine + Balance Sheet

### Task 1: `syntage_invoices_enriched` MV

**Files:**
- Create: `supabase/migrations/20260422_fase26_01_syntage_invoices_enriched_mv.sql`

- [ ] **Step 1: Validar extracción en una muestra**

```sql
-- Confirmar shapes de cast antes del DDL
SELECT
  uuid,
  (raw_payload->>'fullyPaidAt')::timestamptz    AS fiscal_fully_paid_at,
  (raw_payload->>'paidAmount')::numeric         AS fiscal_paid_amount,
  (raw_payload->>'dueAmount')::numeric          AS fiscal_due_amount,
  (raw_payload->>'dueDate')::timestamptz        AS fiscal_due_date,
  (raw_payload->>'creditedAmount')::numeric     AS fiscal_credited_amount,
  raw_payload->>'paymentTermsRaw'               AS fiscal_payment_terms_raw,
  raw_payload->>'cancellationProcessStatus'     AS fiscal_cancellation_process_status,
  (raw_payload->>'lastPaymentDate')::timestamptz AS fiscal_last_payment_date
FROM syntage_invoices
WHERE raw_payload->>'fullyPaidAt' IS NOT NULL
LIMIT 3;
```

Expected: retorna rows con timestamps válidos + numérios correctos. Si algún cast falla, añadir `NULLIF(x,'')` antes del cast.

- [ ] **Step 2: Migration**

`supabase/migrations/20260422_fase26_01_syntage_invoices_enriched_mv.sql`:

```sql
BEGIN;

-- Materialized view que expone los campos fiscales de alto valor hoy escondidos en raw_payload.
-- Diseño: MV (no columnas directas) para decoupling del webhook writer.
-- Superset de syntage_invoices: preserva todas las columnas nativas + añade fiscal_*.
CREATE MATERIALIZED VIEW IF NOT EXISTS public.syntage_invoices_enriched AS
SELECT
  si.syntage_id,
  si.uuid,
  si.taxpayer_rfc,
  si.odoo_company_id,
  si.direction,
  si.tipo_comprobante,
  si.serie,
  si.folio,
  si.fecha_emision,
  si.fecha_timbrado,
  si.emisor_rfc,
  si.emisor_nombre,
  si.receptor_rfc,
  si.receptor_nombre,
  si.subtotal,
  si.descuento,
  si.total,
  si.moneda,
  si.tipo_cambio,
  si.total_mxn,
  si.impuestos_trasladados,
  si.impuestos_retenidos,
  si.metodo_pago,
  si.forma_pago,
  si.uso_cfdi,
  si.estado_sat,
  si.fecha_cancelacion,
  si.emisor_blacklist_status,
  si.receptor_blacklist_status,
  si.xml_file_id,
  si.pdf_file_id,
  si.company_id,
  si.source_id,
  si.source_ref,
  si.synced_at,
  si.created_at,
  -- === FISCAL GOLDMINE (raw_payload extraction) ===
  NULLIF(si.raw_payload->>'fullyPaidAt','')::timestamptz        AS fiscal_fully_paid_at,
  NULLIF(si.raw_payload->>'paidAmount','')::numeric             AS fiscal_paid_amount,
  NULLIF(si.raw_payload->>'dueAmount','')::numeric              AS fiscal_due_amount,
  NULLIF(si.raw_payload->>'dueDate','')::timestamptz            AS fiscal_due_date,
  NULLIF(si.raw_payload->>'creditedAmount','')::numeric         AS fiscal_credited_amount,
  si.raw_payload->>'paymentTermsRaw'                            AS fiscal_payment_terms_raw,
  si.raw_payload->'paymentTerms'                                AS fiscal_payment_terms,
  si.raw_payload->>'cancellationProcessStatus'                  AS fiscal_cancellation_process_status,
  NULLIF(si.raw_payload->>'lastPaymentDate','')::timestamptz    AS fiscal_last_payment_date,
  NULLIF(si.raw_payload->>'subtotalCreditedAmount','')::numeric AS fiscal_subtotal_credited_amount,
  -- Derived
  CASE
    WHEN NULLIF(si.raw_payload->>'fullyPaidAt','')::timestamptz IS NULL THEN NULL
    ELSE (NULLIF(si.raw_payload->>'fullyPaidAt','')::timestamptz::date - si.fecha_timbrado::date)
  END AS fiscal_days_to_full_payment,
  CASE
    WHEN NULLIF(si.raw_payload->>'dueDate','')::timestamptz IS NULL THEN NULL
    ELSE (NULLIF(si.raw_payload->>'dueDate','')::timestamptz::date - si.fecha_timbrado::date)
  END AS fiscal_days_to_due_date
FROM public.syntage_invoices si;

-- Índices: uuid UNIQUE para CONCURRENTLY + los campos de aging (fiscal_due_date)
CREATE UNIQUE INDEX IF NOT EXISTS idx_sie_uuid ON public.syntage_invoices_enriched (uuid);
CREATE INDEX IF NOT EXISTS idx_sie_fiscal_due_date ON public.syntage_invoices_enriched (fiscal_due_date)
  WHERE fiscal_due_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sie_fiscal_fully_paid_at ON public.syntage_invoices_enriched (fiscal_fully_paid_at)
  WHERE fiscal_fully_paid_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sie_emisor_rfc ON public.syntage_invoices_enriched (emisor_rfc);
CREATE INDEX IF NOT EXISTS idx_sie_receptor_rfc ON public.syntage_invoices_enriched (receptor_rfc);
CREATE INDEX IF NOT EXISTS idx_sie_company_id ON public.syntage_invoices_enriched (company_id);

COMMENT ON MATERIALIZED VIEW public.syntage_invoices_enriched IS
  'Superset de syntage_invoices con 6+ campos fiscales extraídos de raw_payload: fullyPaidAt, paidAmount, dueAmount, dueDate, creditedAmount, paymentTerms(Raw), cancellationProcessStatus, lastPaymentDate. Refreshed en refresh_all_matviews().';

INSERT INTO public.schema_changes (change_type, table_name, description, sql_executed) VALUES
  ('create_matview', 'syntage_invoices_enriched',
   'Fase 2.6 — extracción de 6 campos fiscales de raw_payload (goldmine SAT-confirmed)',
   'CREATE MATERIALIZED VIEW public.syntage_invoices_enriched (uuid UNIQUE + 5 idx)');

COMMIT;
```

- [ ] **Step 3: Primer refresh + smoke test**

```sql
REFRESH MATERIALIZED VIEW public.syntage_invoices_enriched;

-- Row count debe igualar syntage_invoices
SELECT
  (SELECT count(*) FROM syntage_invoices) AS base_rows,
  (SELECT count(*) FROM syntage_invoices_enriched) AS mv_rows;
-- Expected: iguales (129,690)

-- Extracción sensata
SELECT
  count(*) FILTER (WHERE fiscal_fully_paid_at IS NOT NULL) AS with_fully_paid_at,
  count(*) FILTER (WHERE fiscal_paid_amount > 0)           AS with_paid_amount_gt_0,
  count(*) FILTER (WHERE fiscal_due_date IS NOT NULL)      AS with_due_date,
  count(*) FILTER (WHERE fiscal_cancellation_process_status IS NOT NULL) AS with_cancel_status
FROM syntage_invoices_enriched;
-- Expected aprox: 23,381 / 23,564 / 29,267 / 2,740 (baseline Task 0)

-- Aging distribution
SELECT
  CASE
    WHEN fiscal_days_to_full_payment IS NULL THEN 'unpaid_or_unknown'
    WHEN fiscal_days_to_full_payment <= 0 THEN '0_upfront'
    WHEN fiscal_days_to_full_payment <= 30 THEN '1_30'
    WHEN fiscal_days_to_full_payment <= 60 THEN '31_60'
    WHEN fiscal_days_to_full_payment <= 90 THEN '61_90'
    ELSE '91_plus'
  END AS bucket,
  count(*)
FROM syntage_invoices_enriched
WHERE direction='issued'
GROUP BY 1 ORDER BY 1;
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260422_fase26_01_syntage_invoices_enriched_mv.sql
git commit -m "feat(db): syntage_invoices_enriched MV with raw_payload fiscal fields"
```

---

### Task 2: Integrar `syntage_invoices_enriched` al `refresh_all_matviews()`

**Files:**
- Create: `supabase/migrations/20260422_fase26_02_syntage_enriched_refresh.sql`

- [ ] **Step 1: Leer definición actual de `refresh_all_matviews`**

```sql
SELECT pg_get_functiondef('public.refresh_all_matviews()'::regprocedure);
```

Expected: función que hace `REFRESH MATERIALIZED VIEW [CONCURRENTLY] public.<mv>;` por cada MV (33 hoy). Copiar el body exacto — añadir al final una línea más.

- [ ] **Step 2: Migration**

`supabase/migrations/20260422_fase26_02_syntage_enriched_refresh.sql`:

```sql
BEGIN;

-- NOTA: esta migration redefine la función refresh_all_matviews() para añadir
-- syntage_invoices_enriched al final. El body replica el estado actual (verificado
-- al ejecutar Task 2 Step 1) + una línea nueva. Si detectas que algún MV cambió
-- entre Task 2 Step 1 y el deploy, ABORTAR y actualizar el body.
CREATE OR REPLACE FUNCTION public.refresh_all_matviews()
RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.company_profile;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.company_profile_sat;
  REFRESH MATERIALIZED VIEW monthly_revenue_by_company;
  REFRESH MATERIALIZED VIEW portfolio_concentration;
  REFRESH MATERIALIZED VIEW ar_aging_detail;
  REFRESH MATERIALIZED VIEW accounting_anomalies;
  REFRESH MATERIALIZED VIEW customer_cohorts;
  REFRESH MATERIALIZED VIEW customer_margin_analysis;
  REFRESH MATERIALIZED VIEW customer_product_matrix;
  REFRESH MATERIALIZED VIEW supplier_product_matrix;
  REFRESH MATERIALIZED VIEW dead_stock_analysis;
  REFRESH MATERIALIZED VIEW inventory_velocity;
  REFRESH MATERIALIZED VIEW ops_delivery_health_weekly;
  REFRESH MATERIALIZED VIEW product_real_cost;
  REFRESH MATERIALIZED VIEW product_margin_analysis;
  REFRESH MATERIALIZED VIEW product_seasonality;
  REFRESH MATERIALIZED VIEW purchase_price_intelligence;
  REFRESH MATERIALIZED VIEW supplier_concentration_herfindahl;
  REFRESH MATERIALIZED VIEW company_email_intelligence;
  REFRESH MATERIALIZED VIEW company_handlers;
  REFRESH MATERIALIZED VIEW company_insight_history;
  REFRESH MATERIALIZED VIEW cross_director_signals;
  REFRESH MATERIALIZED VIEW cashflow_projection;
  REFRESH MATERIALIZED VIEW real_sale_price;
  REFRESH MATERIALIZED VIEW supplier_price_index;
  REFRESH MATERIALIZED VIEW company_narrative;
  REFRESH MATERIALIZED VIEW customer_ltv_health;
  REFRESH MATERIALIZED VIEW payment_predictions;
  REFRESH MATERIALIZED VIEW client_reorder_predictions;
  REFRESH MATERIALIZED VIEW rfm_segments;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.journal_flow_profile;
  REFRESH MATERIALIZED VIEW public.products_unified;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.product_price_history;
  -- Fase 2.6: nueva MV fiscal goldmine
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.syntage_invoices_enriched;
  RAISE NOTICE 'All 34 materialized views refreshed successfully';
END;
$function$;

INSERT INTO public.schema_changes (change_type, table_name, description, sql_executed) VALUES
  ('alter_function', 'refresh_all_matviews',
   'Fase 2.6 — añadido REFRESH CONCURRENTLY syntage_invoices_enriched al final',
   'CREATE OR REPLACE FUNCTION refresh_all_matviews() — body con 34 MVs');

COMMIT;
```

- [ ] **Step 3: Smoke test**

```sql
-- Invocación completa (cron de prod la llamará)
SELECT public.refresh_all_matviews();
-- Expected: NOTICE "All 34 materialized views refreshed successfully"

-- Confirmar que syntage_invoices_enriched sigue al mismo count
SELECT count(*) FROM syntage_invoices_enriched;
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260422_fase26_02_syntage_enriched_refresh.sql
git commit -m "feat(db): add syntage_invoices_enriched to refresh_all_matviews"
```

---

### Task 3: `balance_sheet` view

**Files:**
- Create: `supabase/migrations/20260422_fase26_03_balance_sheet_view.sql`

- [ ] **Step 1: Migration**

`supabase/migrations/20260422_fase26_03_balance_sheet_view.sql`:

```sql
BEGIN;

-- balance_sheet: análogo a pl_estado_resultados pero agrupando activo/pasivo/capital.
-- Filtro period ~ '^20[12][0-9]-[01][0-9]$' replicado para consistencia con P&L.
-- Clasificación de account_type confirmada por el spec 07:
--   Assets     = asset + asset_receivable + asset_cash + asset_current + asset_non_current
--                + asset_prepayments + asset_fixed
--   Liabilities= liability + liability_payable + liability_credit_card
--                + liability_current + liability_non_current
--   Equity     = equity + equity_unaffected
-- Nota: el enum real confirmado en Supabase NO incluye 'asset_non_current' ni 'liability'
-- genéricos, pero los añadimos al CASE para robustez (no rompen si aparecen vía Odoo update).
CREATE OR REPLACE VIEW public.balance_sheet AS
SELECT
  ab.period,
  -- ===== ASSETS (saldo natural deudor: balance > 0 incrementa activo) =====
  round(COALESCE(sum(ab.balance) FILTER (
    WHERE coa.account_type IN (
      'asset','asset_receivable','asset_cash','asset_current',
      'asset_non_current','asset_prepayments','asset_fixed'
    )
  ), 0), 2) AS activos_totales,
  round(COALESCE(sum(ab.balance) FILTER (
    WHERE coa.account_type IN ('asset_cash','asset_current','asset_receivable','asset_prepayments')
  ), 0), 2) AS activos_circulantes,
  round(COALESCE(sum(ab.balance) FILTER (
    WHERE coa.account_type IN ('asset_fixed','asset_non_current')
  ), 0), 2) AS activos_no_circulantes,
  round(COALESCE(sum(ab.balance) FILTER (WHERE coa.account_type = 'asset_cash'), 0), 2) AS activo_efectivo,
  round(COALESCE(sum(ab.balance) FILTER (WHERE coa.account_type = 'asset_receivable'), 0), 2) AS activo_cuentas_por_cobrar,
  round(COALESCE(sum(ab.balance) FILTER (WHERE coa.account_type = 'asset_prepayments'), 0), 2) AS activo_pagos_anticipados,
  round(COALESCE(sum(ab.balance) FILTER (WHERE coa.account_type = 'asset_fixed'), 0), 2) AS activo_fijo,
  -- ===== LIABILITIES (saldo natural acreedor: invertimos signo con abs()) =====
  round(COALESCE(abs(sum(ab.balance) FILTER (
    WHERE coa.account_type IN (
      'liability','liability_payable','liability_credit_card',
      'liability_current','liability_non_current'
    )
  )), 0), 2) AS pasivos_totales,
  round(COALESCE(abs(sum(ab.balance) FILTER (
    WHERE coa.account_type IN ('liability_payable','liability_credit_card','liability_current')
  )), 0), 2) AS pasivos_circulantes,
  round(COALESCE(abs(sum(ab.balance) FILTER (WHERE coa.account_type = 'liability_non_current')), 0), 2) AS pasivos_largo_plazo,
  round(COALESCE(abs(sum(ab.balance) FILTER (WHERE coa.account_type = 'liability_payable')), 0), 2) AS pasivo_cuentas_por_pagar,
  round(COALESCE(abs(sum(ab.balance) FILTER (WHERE coa.account_type = 'liability_credit_card')), 0), 2) AS pasivo_tarjetas_credito,
  -- ===== EQUITY =====
  round(COALESCE(abs(sum(ab.balance) FILTER (
    WHERE coa.account_type IN ('equity','equity_unaffected')
  )), 0), 2) AS capital_contable,
  -- ===== CHECK: Activos = Pasivos + Capital (tolerancia 0.01) =====
  round(
    COALESCE(sum(ab.balance) FILTER (
      WHERE coa.account_type IN (
        'asset','asset_receivable','asset_cash','asset_current',
        'asset_non_current','asset_prepayments','asset_fixed'
      )
    ), 0)
    - COALESCE(abs(sum(ab.balance) FILTER (
      WHERE coa.account_type IN (
        'liability','liability_payable','liability_credit_card',
        'liability_current','liability_non_current'
      )
    )), 0)
    - COALESCE(abs(sum(ab.balance) FILTER (
      WHERE coa.account_type IN ('equity','equity_unaffected')
    )), 0)
  , 2) AS balance_check_diff
FROM public.odoo_account_balances ab
LEFT JOIN public.odoo_chart_of_accounts coa ON coa.odoo_account_id = ab.odoo_account_id
WHERE ab.period ~ '^20[12][0-9]-[01][0-9]$'
  AND (coa.deprecated IS NULL OR coa.deprecated = false)
GROUP BY ab.period
ORDER BY ab.period;

COMMENT ON VIEW public.balance_sheet IS
  'Estado de Posición Financiera por período (YYYY-MM). Estructura A/L/E paralela a pl_estado_resultados. Filtra cuentas deprecated. balance_check_diff ≈ 0 indica cuadre correcto.';

INSERT INTO public.schema_changes (change_type, table_name, description, sql_executed) VALUES
  ('create_view', 'balance_sheet',
   'Fase 2.6 — primer balance sheet view (assets + liabilities + equity por período)',
   'CREATE OR REPLACE VIEW public.balance_sheet');

COMMIT;
```

- [ ] **Step 2: Smoke test**

```sql
-- Rows = distinct periods con ~'^20[12][0-9]-[01][0-9]$'
SELECT count(*) FROM balance_sheet;

-- Último período
SELECT * FROM balance_sheet ORDER BY period DESC LIMIT 3;

-- Cuadre: el balance_check_diff debe ser pequeño (≤ 5% del activo) en cada período.
-- Si algún período tiene un diff grande, es signo de:
--   (a) faltan types en el CASE (ver account_type real via odoo_chart_of_accounts)
--   (b) resultado del ejercicio no está en equity_unaffected
-- Reportar al usuario los períodos con |diff/activos_totales| > 0.05
SELECT period, activos_totales, pasivos_totales, capital_contable, balance_check_diff,
       round((balance_check_diff / NULLIF(activos_totales,0)) * 100, 2) AS diff_pct
FROM balance_sheet
WHERE activos_totales > 0
ORDER BY abs(balance_check_diff / NULLIF(activos_totales,0)) DESC NULLS LAST
LIMIT 10;
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260422_fase26_03_balance_sheet_view.sql
git commit -m "feat(db): balance_sheet view (assets/liabilities/equity por período)"
```

---

## Fase B — 69B blacklist surface

### Task 4: `company_69b_status` view

**Files:**
- Create: `supabase/migrations/20260422_fase26_04_company_69b_status_view.sql`

- [ ] **Step 1: Migration**

`supabase/migrations/20260422_fase26_04_company_69b_status_view.sql`:

```sql
BEGIN;

-- Aggregado 69B por company_id.
-- Dos perspectivas:
--   (a) partner_as_emisor: la company es EMISOR de facturas que Quimibond recibió (= proveedor)
--       → riesgo deducibilidad IVA si emisor está en 69B.
--   (b) partner_as_receptor: la company es RECEPTOR de facturas que Quimibond emitió (= cliente)
--       → riesgo al continuar operando con cliente 69B.
-- Nivel consolidado: 'definitive' > 'presumed' > 'none'.
-- Usamos lower(rfc) para match robusto contra inconsistencias de casing.
CREATE OR REPLACE VIEW public.company_69b_status AS
WITH emisor_flags AS (
  SELECT
    lower(s.emisor_rfc) AS rfc_lower,
    count(*)                                                              AS flagged_as_emisor_count,
    count(*) FILTER (WHERE s.emisor_blacklist_status = 'presumed')        AS emisor_presumed_count,
    count(*) FILTER (WHERE s.emisor_blacklist_status = 'definitive')      AS emisor_definitive_count,
    min(s.fecha_timbrado) FILTER (WHERE s.emisor_blacklist_status IS NOT NULL) AS emisor_first_flagged_at,
    max(s.fecha_timbrado) FILTER (WHERE s.emisor_blacklist_status IS NOT NULL) AS emisor_last_flagged_at,
    max(CASE
      WHEN s.emisor_blacklist_status = 'definitive' THEN 2
      WHEN s.emisor_blacklist_status = 'presumed'   THEN 1
      ELSE 0
    END) AS emisor_level_numeric
  FROM public.syntage_invoices s
  WHERE s.emisor_blacklist_status IS NOT NULL
  GROUP BY lower(s.emisor_rfc)
),
receptor_flags AS (
  SELECT
    lower(s.receptor_rfc) AS rfc_lower,
    count(*)                                                                AS flagged_as_receptor_count,
    count(*) FILTER (WHERE s.receptor_blacklist_status = 'presumed')        AS receptor_presumed_count,
    count(*) FILTER (WHERE s.receptor_blacklist_status = 'definitive')      AS receptor_definitive_count,
    min(s.fecha_timbrado) FILTER (WHERE s.receptor_blacklist_status IS NOT NULL) AS receptor_first_flagged_at,
    max(s.fecha_timbrado) FILTER (WHERE s.receptor_blacklist_status IS NOT NULL) AS receptor_last_flagged_at,
    max(CASE
      WHEN s.receptor_blacklist_status = 'definitive' THEN 2
      WHEN s.receptor_blacklist_status = 'presumed'   THEN 1
      ELSE 0
    END) AS receptor_level_numeric
  FROM public.syntage_invoices s
  WHERE s.receptor_blacklist_status IS NOT NULL
  GROUP BY lower(s.receptor_rfc)
),
unioned AS (
  SELECT rfc_lower, 'emisor'::text AS side,
         flagged_as_emisor_count AS flagged_count,
         emisor_presumed_count   AS presumed_count,
         emisor_definitive_count AS definitive_count,
         emisor_first_flagged_at AS first_flagged_at,
         emisor_last_flagged_at  AS last_flagged_at,
         emisor_level_numeric    AS level_numeric
  FROM emisor_flags
  UNION ALL
  SELECT rfc_lower, 'receptor'::text AS side,
         flagged_as_receptor_count,
         receptor_presumed_count,
         receptor_definitive_count,
         receptor_first_flagged_at,
         receptor_last_flagged_at,
         receptor_level_numeric
  FROM receptor_flags
)
SELECT
  c.id AS company_id,
  c.rfc,
  c.canonical_name,
  c.name,
  bool_or(u.side = 'emisor')   AS flagged_as_emisor,
  bool_or(u.side = 'receptor') AS flagged_as_receptor,
  COALESCE(sum(u.flagged_count) FILTER (WHERE u.side = 'emisor'), 0)   AS invoices_as_emisor_flagged,
  COALESCE(sum(u.flagged_count) FILTER (WHERE u.side = 'receptor'), 0) AS invoices_as_receptor_flagged,
  COALESCE(sum(u.presumed_count), 0)   AS total_presumed_invoices,
  COALESCE(sum(u.definitive_count), 0) AS total_definitive_invoices,
  min(u.first_flagged_at) AS first_flagged_at,
  max(u.last_flagged_at)  AS last_flagged_at,
  CASE max(u.level_numeric)
    WHEN 2 THEN 'definitive'
    WHEN 1 THEN 'presumed'
    ELSE 'none'
  END AS blacklist_level
FROM public.companies c
JOIN unioned u ON u.rfc_lower = lower(c.rfc)
WHERE c.rfc IS NOT NULL
GROUP BY c.id, c.rfc, c.canonical_name, c.name;

COMMENT ON VIEW public.company_69b_status IS
  'Estado 69B por company_id: nivel consolidado (none/presumed/definitive), counts por rol (emisor/receptor), fechas primera y última aparición en listas negras SAT.';

-- Nota: este view es ligero (solo rows flagged) — no requiere índice explícito.
-- Si escala >10k rows, convertir a MV e indexar en company_id.

INSERT INTO public.schema_changes (change_type, table_name, description, sql_executed) VALUES
  ('create_view', 'company_69b_status',
   'Fase 2.6 — agregado 69B por company_id (emisor + receptor, consolidated level)',
   'CREATE OR REPLACE VIEW public.company_69b_status');

COMMIT;
```

- [ ] **Step 2: Smoke test**

```sql
-- Rows esperados: ~8 emisor RFCs + ~5 receptor RFCs resueltos a companies (spec 07)
SELECT count(*) FROM company_69b_status;

-- Distribución por nivel
SELECT blacklist_level, count(*) FROM company_69b_status GROUP BY 1 ORDER BY 1;

-- Top 10
SELECT rfc, canonical_name, blacklist_level, invoices_as_emisor_flagged, invoices_as_receptor_flagged, first_flagged_at, last_flagged_at
FROM company_69b_status
ORDER BY CASE blacklist_level WHEN 'definitive' THEN 0 WHEN 'presumed' THEN 1 ELSE 2 END,
         (invoices_as_emisor_flagged + invoices_as_receptor_flagged) DESC
LIMIT 10;

-- Counts totales deben reconciliar con spec 07 baseline (389 presumed + 3+35 definitive)
SELECT
  sum(total_presumed_invoices)   AS total_presumed,
  sum(total_definitive_invoices) AS total_definitive
FROM company_69b_status;
-- Expected: presumed ≈ 389, definitive ≈ 38 (3 emisor + 35 receptor)
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260422_fase26_04_company_69b_status_view.sql
git commit -m "feat(db): company_69b_status view (aggregated blacklist per company)"
```

---

### Task 5: `blacklist_alerts` tabla append-only

**Files:**
- Create: `supabase/migrations/20260422_fase26_05_blacklist_alerts_table.sql`

- [ ] **Step 1: Migration**

`supabase/migrations/20260422_fase26_05_blacklist_alerts_table.sql`:

```sql
BEGIN;

-- Append-only log de alertas cuando llega un nuevo CFDI de un RFC ya identificado como 69B.
-- El trigger de Task 6 inserta una fila por cada INSERT en syntage_invoices cuyo
-- emisor o receptor tenga status 'presumed'/'definitive' al momento del insert.
CREATE TABLE IF NOT EXISTS public.blacklist_alerts (
  id bigserial PRIMARY KEY,
  alerted_at timestamptz NOT NULL DEFAULT now(),
  invoice_uuid text NOT NULL,
  invoice_direction text,                          -- 'issued' | 'received'
  side text NOT NULL CHECK (side IN ('emisor','receptor')),
  rfc text NOT NULL,
  blacklist_status text NOT NULL CHECK (blacklist_status IN ('presumed','definitive')),
  company_id bigint,                               -- resolved at trigger time (may be NULL)
  invoice_fecha_timbrado timestamptz,
  invoice_total_mxn numeric,
  acknowledged_at timestamptz,                     -- set por UI cuando el usuario la revisa (no usado todavía)
  acknowledged_by text,
  note text
);

CREATE INDEX IF NOT EXISTS idx_blacklist_alerts_alerted_at   ON public.blacklist_alerts (alerted_at DESC);
CREATE INDEX IF NOT EXISTS idx_blacklist_alerts_company_id   ON public.blacklist_alerts (company_id) WHERE company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_blacklist_alerts_rfc          ON public.blacklist_alerts (rfc);
CREATE INDEX IF NOT EXISTS idx_blacklist_alerts_unack        ON public.blacklist_alerts (alerted_at DESC) WHERE acknowledged_at IS NULL;

COMMENT ON TABLE public.blacklist_alerts IS
  'Append-only log: cada fila = nuevo CFDI que llega de RFC ya identificado como 69B. Poblada por trigger en syntage_invoices. UI puede marcar acknowledged_at.';

INSERT INTO public.schema_changes (change_type, table_name, description, sql_executed) VALUES
  ('create_table', 'blacklist_alerts',
   'Fase 2.6 — tabla append-only para alertas 69B en nuevos CFDIs',
   'CREATE TABLE public.blacklist_alerts (+4 idx)');

COMMIT;
```

- [ ] **Step 2: Smoke test**

```sql
-- Tabla existe y vacía
SELECT count(*) FROM blacklist_alerts;
-- Expected: 0

-- Constraints
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid='public.blacklist_alerts'::regclass;
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260422_fase26_05_blacklist_alerts_table.sql
git commit -m "feat(db): blacklist_alerts append-only table for 69B risk"
```

---

### Task 6: Trigger `blacklist_alerts` en `syntage_invoices` INSERT

**Files:**
- Create: `supabase/migrations/20260422_fase26_06_blacklist_alerts_trigger.sql`

- [ ] **Step 1: Migration**

`supabase/migrations/20260422_fase26_06_blacklist_alerts_trigger.sql`:

```sql
BEGIN;

-- Trigger que, al insertar un syntage_invoices, registra alertas si
-- emisor_blacklist_status o receptor_blacklist_status traen 'presumed'/'definitive'.
-- Diseño:
--   - AFTER INSERT para no bloquear el webhook.
--   - Un alert por cada lado flagged (hasta 2 filas por invoice).
--   - company_id se resuelve best-effort por match de rfc (nullable si no existe en companies).
--   - Idempotencia parcial: si el mismo (invoice_uuid, side) ya existe, no duplicar.
CREATE OR REPLACE FUNCTION public.trg_blacklist_alerts_on_syntage_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  -- Emisor en 69B
  IF NEW.emisor_blacklist_status IN ('presumed','definitive')
     AND NEW.emisor_rfc IS NOT NULL THEN
    INSERT INTO public.blacklist_alerts (
      invoice_uuid, invoice_direction, side, rfc, blacklist_status,
      company_id, invoice_fecha_timbrado, invoice_total_mxn
    )
    SELECT
      NEW.uuid, NEW.direction, 'emisor', NEW.emisor_rfc, NEW.emisor_blacklist_status,
      (SELECT c.id FROM public.companies c WHERE lower(c.rfc) = lower(NEW.emisor_rfc) LIMIT 1),
      NEW.fecha_timbrado, NEW.total_mxn
    WHERE NOT EXISTS (
      SELECT 1 FROM public.blacklist_alerts ba
      WHERE ba.invoice_uuid = NEW.uuid AND ba.side = 'emisor'
    );
  END IF;

  -- Receptor en 69B
  IF NEW.receptor_blacklist_status IN ('presumed','definitive')
     AND NEW.receptor_rfc IS NOT NULL THEN
    INSERT INTO public.blacklist_alerts (
      invoice_uuid, invoice_direction, side, rfc, blacklist_status,
      company_id, invoice_fecha_timbrado, invoice_total_mxn
    )
    SELECT
      NEW.uuid, NEW.direction, 'receptor', NEW.receptor_rfc, NEW.receptor_blacklist_status,
      (SELECT c.id FROM public.companies c WHERE lower(c.rfc) = lower(NEW.receptor_rfc) LIMIT 1),
      NEW.fecha_timbrado, NEW.total_mxn
    WHERE NOT EXISTS (
      SELECT 1 FROM public.blacklist_alerts ba
      WHERE ba.invoice_uuid = NEW.uuid AND ba.side = 'receptor'
    );
  END IF;

  RETURN NEW;
END $$;

COMMENT ON FUNCTION public.trg_blacklist_alerts_on_syntage_insert IS
  'Fase 2.6 — trigger AFTER INSERT en syntage_invoices que inserta en blacklist_alerts si emisor/receptor están en 69B.';

DROP TRIGGER IF EXISTS trg_blacklist_alerts_on_syntage_insert ON public.syntage_invoices;
CREATE TRIGGER trg_blacklist_alerts_on_syntage_insert
AFTER INSERT ON public.syntage_invoices
FOR EACH ROW EXECUTE FUNCTION public.trg_blacklist_alerts_on_syntage_insert();

INSERT INTO public.schema_changes (change_type, table_name, description, sql_executed) VALUES
  ('create_trigger', 'syntage_invoices',
   'Fase 2.6 — trigger AFTER INSERT que pobla blacklist_alerts',
   'CREATE TRIGGER trg_blacklist_alerts_on_syntage_insert');

COMMIT;
```

- [ ] **Step 2: Smoke test**

```sql
-- Baseline: count antes
SELECT count(*) AS before FROM blacklist_alerts;

-- Insertar CFDI sintético flagged (usa syntage_id ficticio negativo-safe)
INSERT INTO syntage_invoices (
  syntage_id, uuid, taxpayer_rfc, direction, tipo_comprobante,
  fecha_emision, fecha_timbrado, emisor_rfc, receptor_rfc,
  total, total_mxn, moneda, estado_sat, emisor_blacklist_status
) VALUES (
  'SMOKE_FASE26_ALERT_1', '00000000-0000-0000-0000-000000fase26',
  'PNT920218IW5', 'received', 'I',
  now(), now(), 'XAXX010101000', 'PNT920218IW5',
  100.00, 100.00, 'MXN', 'vigente', 'presumed'
);

-- Expected: 1 nuevo row en blacklist_alerts con side='emisor', status='presumed'
SELECT * FROM blacklist_alerts WHERE invoice_uuid = '00000000-0000-0000-0000-000000fase26';

-- Re-ejecutar el INSERT no debe duplicar (idempotencia parcial por (uuid, side))
-- Cleanup
DELETE FROM blacklist_alerts WHERE invoice_uuid = '00000000-0000-0000-0000-000000fase26';
DELETE FROM syntage_invoices WHERE uuid = '00000000-0000-0000-0000-000000fase26';
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260422_fase26_06_blacklist_alerts_trigger.sql
git commit -m "feat(db): trigger blacklist_alerts on new syntage_invoices INSERT"
```

---

## Fase C — Poda de wrappers analytics_* (gated)

### Task 7: DROP 4 analytics_* wrappers (pass-through de syntage_*)

**Files:**
- Create: `supabase/migrations/20260422_fase26_07_drop_analytics_wrappers.sql`

**Pre-condiciones:**
- Audit de consumers en frontend **obligatorio** antes del DROP.
- Confirmar con usuario el OK explícito para la operación destructiva.
- Los 4 wrappers confirmados (vía `pg_get_viewdef` en Task 0):

| Wrapper (a dropear) | Original (retenido) |
|---|---|
| `analytics_customer_cancellation_rates` | `syntage_client_cancellation_rates` |
| `analytics_customer_fiscal_lifetime` | `syntage_top_clients_fiscal_lifetime` |
| `analytics_product_fiscal_line_analysis` | `syntage_product_line_analysis` |
| `analytics_supplier_fiscal_lifetime` | `syntage_top_suppliers_fiscal_lifetime` |

- [ ] **Step 1: Audit consumers en frontend**

```bash
cd /Users/jj/quimibond-intelligence/quimibond-intelligence
rg -n "analytics_customer_cancellation_rates|analytics_customer_fiscal_lifetime|analytics_product_fiscal_line_analysis|analytics_supplier_fiscal_lifetime" src app lib queries 2>/dev/null || true
```

Guardar el output. Si hay hits, listar `archivo:línea`. Si no hay hits, anotar "no consumers" en `audit-notes.md`.

- [ ] **Step 2: Migrar consumers (si existen)**

Por cada caller encontrado, reemplazar:
- `analytics_customer_cancellation_rates` → `syntage_client_cancellation_rates`
- `analytics_customer_fiscal_lifetime` → `syntage_top_clients_fiscal_lifetime`
- `analytics_product_fiscal_line_analysis` → `syntage_product_line_analysis`
- `analytics_supplier_fiscal_lifetime` → `syntage_top_suppliers_fiscal_lifetime`

Commit separado (antes del DROP): `chore(frontend): migrate analytics_* consumers to syntage_* sources`.

- [ ] **Step 3: Pedir OK explícito al usuario**

Mensaje al usuario:
> "Task 7 dropea 4 views `analytics_*` que son wrappers idénticos de `syntage_*` (spec 07 §7.3). Frontend audit: <N hits encontrados / sin consumers>. Frontend migrado en commit `<hash>` (o n/a). ¿Aplico DROP?"

Esperar OK antes de continuar.

- [ ] **Step 4: Migration**

`supabase/migrations/20260422_fase26_07_drop_analytics_wrappers.sql`:

```sql
BEGIN;

DROP VIEW IF EXISTS public.analytics_customer_cancellation_rates;
DROP VIEW IF EXISTS public.analytics_customer_fiscal_lifetime;
DROP VIEW IF EXISTS public.analytics_product_fiscal_line_analysis;
DROP VIEW IF EXISTS public.analytics_supplier_fiscal_lifetime;

INSERT INTO public.schema_changes (change_type, table_name, description, sql_executed) VALUES
  ('drop_view', 'analytics_customer_cancellation_rates',
   'Fase 2.6 — thin wrapper de syntage_client_cancellation_rates (frontend migrado)',
   'DROP VIEW IF EXISTS public.analytics_customer_cancellation_rates'),
  ('drop_view', 'analytics_customer_fiscal_lifetime',
   'Fase 2.6 — thin wrapper de syntage_top_clients_fiscal_lifetime (frontend migrado)',
   'DROP VIEW IF EXISTS public.analytics_customer_fiscal_lifetime'),
  ('drop_view', 'analytics_product_fiscal_line_analysis',
   'Fase 2.6 — thin wrapper de syntage_product_line_analysis (frontend migrado)',
   'DROP VIEW IF EXISTS public.analytics_product_fiscal_line_analysis'),
  ('drop_view', 'analytics_supplier_fiscal_lifetime',
   'Fase 2.6 — thin wrapper de syntage_top_suppliers_fiscal_lifetime (frontend migrado)',
   'DROP VIEW IF EXISTS public.analytics_supplier_fiscal_lifetime');

COMMIT;
```

- [ ] **Step 5: Smoke test**

```sql
-- Confirmar que los 4 se fueron
SELECT viewname FROM pg_views
WHERE schemaname='public'
  AND viewname IN (
    'analytics_customer_cancellation_rates',
    'analytics_customer_fiscal_lifetime',
    'analytics_product_fiscal_line_analysis',
    'analytics_supplier_fiscal_lifetime'
  );
-- Expected: 0 rows

-- Confirmar que los originales siguen
SELECT viewname FROM pg_views
WHERE schemaname='public'
  AND viewname IN (
    'syntage_client_cancellation_rates',
    'syntage_top_clients_fiscal_lifetime',
    'syntage_product_line_analysis',
    'syntage_top_suppliers_fiscal_lifetime'
  );
-- Expected: 4 rows
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260422_fase26_07_drop_analytics_wrappers.sql
git commit -m "chore(db): drop 4 analytics_* thin wrappers (frontend migrated)"
```

---

## Fase D — Cierre

### Task 8: Post-audit snapshot + frontend CLAUDE.md + memoria

**Files:**
- Create: `supabase/migrations/20260422_fase26_08_final.sql`
- Modify: `quimibond-intelligence/quimibond-intelligence/CLAUDE.md`
- Modify: `quimibond-intelligence/quimibond-intelligence/docs/superpowers/plans/2026-04-22-supabase-audit-fase-2-6-audit-notes.md`
- Modify: `/Users/jj/.claude/projects/-Users-jj/memory/project_supabase_audit_2026_04_19.md`

- [ ] **Step 1: Migration final**

`supabase/migrations/20260422_fase26_08_final.sql`:

```sql
INSERT INTO public.audit_runs (run_id, invariant_key, severity, source, model, details, run_at)
SELECT
  gen_random_uuid(),
  'phase_2_6_final',
  'ok',
  'supabase',
  'final',
  jsonb_build_object(
    'mv_enriched_rows', (SELECT count(*) FROM syntage_invoices_enriched),
    'mv_enriched_with_fully_paid_at', (SELECT count(*) FROM syntage_invoices_enriched WHERE fiscal_fully_paid_at IS NOT NULL),
    'mv_enriched_with_due_date', (SELECT count(*) FROM syntage_invoices_enriched WHERE fiscal_due_date IS NOT NULL),
    'balance_sheet_periods', (SELECT count(*) FROM balance_sheet),
    'balance_sheet_last_period_diff', (SELECT balance_check_diff FROM balance_sheet ORDER BY period DESC LIMIT 1),
    'company_69b_companies', (SELECT count(*) FROM company_69b_status),
    'company_69b_definitive', (SELECT count(*) FROM company_69b_status WHERE blacklist_level='definitive'),
    'company_69b_presumed', (SELECT count(*) FROM company_69b_status WHERE blacklist_level='presumed'),
    'blacklist_alerts_rows', (SELECT count(*) FROM blacklist_alerts),
    'analytics_wrappers_remaining', (SELECT count(*) FROM pg_views WHERE schemaname='public' AND viewname IN (
      'analytics_customer_cancellation_rates','analytics_customer_fiscal_lifetime',
      'analytics_product_fiscal_line_analysis','analytics_supplier_fiscal_lifetime'
    ))
  ),
  now();
```

- [ ] **Step 2: Re-correr queries del Task 0 → `## Después`**

Ejecutar los 5 queries de Task 0 Step 2 nuevamente y pegar en `audit-notes.md` bajo `## Después`.

- [ ] **Step 3: Actualizar frontend CLAUDE.md**

Añadir sección en `## Base de datos (Supabase)`:

```markdown
### Fiscal goldmine + 69B surface (Fase 2.6)

| Objeto | Tipo | Propósito |
|---|---|---|
| `syntage_invoices_enriched` | MV | Superset de `syntage_invoices` con 6+ campos fiscales extraídos de `raw_payload` (fiscal_fully_paid_at, fiscal_paid_amount, fiscal_due_amount, fiscal_due_date, fiscal_credited_amount, fiscal_payment_terms_raw, fiscal_cancellation_process_status, fiscal_last_payment_date, fiscal_days_to_full_payment, fiscal_days_to_due_date). Refreshed en `refresh_all_matviews()`. |
| `balance_sheet` | view | Estado de Posición Financiera por período (activo, pasivo, capital) — paralelo a `pl_estado_resultados`. Incluye `balance_check_diff` para validar cuadre. |
| `company_69b_status` | view | Estado 69B agregado por `company_id`: `blacklist_level` (none/presumed/definitive), counts por rol (emisor/receptor), primera/última fecha flagged. |
| `blacklist_alerts` | table | Append-only log de alertas cuando llega nuevo CFDI de RFC ya en 69B. Trigger pobla al insertar en `syntage_invoices`. |
```

Y añadir nota al bloque de wrappers dropeados:

```markdown
### Dropeados en Fase 2.6
- `analytics_customer_cancellation_rates` → usar `syntage_client_cancellation_rates`
- `analytics_customer_fiscal_lifetime` → usar `syntage_top_clients_fiscal_lifetime`
- `analytics_product_fiscal_line_analysis` → usar `syntage_product_line_analysis`
- `analytics_supplier_fiscal_lifetime` → usar `syntage_top_suppliers_fiscal_lifetime`
```

- [ ] **Step 4: Actualizar memoria**

Append a `/Users/jj/.claude/projects/-Users-jj/memory/project_supabase_audit_2026_04_19.md`:

```md
## Fase 2.6 Fiscal Goldmine — cerrada 2026-04-XX
- syntage_invoices_enriched MV (raw_payload → fiscal_fully_paid_at + 5 campos). Añadida a refresh_all_matviews (34 MVs total).
- balance_sheet view (activo/pasivo/capital por período) con balance_check_diff.
- company_69b_status view + blacklist_alerts table + trigger en syntage_invoices INSERT.
- 4 wrappers analytics_* dropeados (fiscal_customer/supplier/product/cancellation — migrados a syntage_*).
- Commits: …
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260422_fase26_08_final.sql CLAUDE.md docs/superpowers/plans/2026-04-22-supabase-audit-fase-2-6-audit-notes.md
git commit -m "docs(audit): fase 2.6 fiscal goldmine post-flight + CLAUDE.md update"
```

- [ ] **Step 6: Reportar al usuario**

Mensaje al usuario:
> "Fase 2.6 completa. Cambios:
> - 1 MV fiscal (`syntage_invoices_enriched`) con 6+ campos extraídos de raw_payload + añadida a `refresh_all_matviews()`
> - 1 view balance sheet (`balance_sheet`) primer estado de posición financiera de Quimibond
> - 1 view 69B (`company_69b_status`) + 1 tabla append-only (`blacklist_alerts`) + 1 trigger
> - 4 views wrappers `analytics_*` dropeadas (frontend migrado)
>
> PR listo para merge:
> - Frontend: `fase-2-6-fiscal-goldmine` → `main` (8 commits + el de frontend consumer migration si aplicó)
>
> Deploy (usuario ejecuta):
> ```bash
> cd /Users/jj/quimibond-intelligence/quimibond-intelligence
> git checkout main && git merge fase-2-6-fiscal-goldmine && git push origin main
> # Vercel auto-deploy
> ```"

---

## Orden de ejecución recomendado

1. Task 0 (baseline)
2. Task 1 (syntage_invoices_enriched MV) — **deliverable fiscal, primero**
3. Task 2 (añadir MV a refresh_all_matviews)
4. Task 3 (balance_sheet view)
5. Task 4 (company_69b_status view)
6. Task 5 (blacklist_alerts tabla)
7. Task 6 (trigger blacklist_alerts)
8. → **Audit frontend consumers** (Task 7 Step 1)
9. → **Migrar frontend** (fuera del scope SQL, PR separado si hay hits)
10. Task 7 (DROP wrappers — gated)
11. Task 8 (post-audit + CLAUDE.md + memoria)

---

## DoD

- [ ] `syntage_invoices_enriched` MV existe y tiene row_count = syntage_invoices.count(*) (~129,690).
- [ ] `syntage_invoices_enriched.fiscal_fully_paid_at` no-null en ≥ 23,000 rows.
- [ ] `syntage_invoices_enriched.fiscal_due_date` no-null en ≥ 29,000 rows.
- [ ] `refresh_all_matviews()` incluye `REFRESH MATERIALIZED VIEW CONCURRENTLY public.syntage_invoices_enriched` y ejecuta sin error.
- [ ] `balance_sheet` view retorna ≥ 48 rows (4 años × 12 meses) con `activos_totales > 0` en los últimos 12 meses.
- [ ] `balance_sheet.balance_check_diff / activos_totales` ≤ 5 % en período actual (2026-04). Si no, reportar períodos desajustados al usuario.
- [ ] `company_69b_status` retorna `blacklist_level='definitive'` en ≥ 1 row.
- [ ] `company_69b_status` totales reconcilian: `sum(total_presumed_invoices)` ≈ 389 y `sum(total_definitive_invoices)` ≈ 38.
- [ ] `blacklist_alerts` tabla existe con 4 índices (alerted_at, company_id, rfc, unack).
- [ ] Trigger `trg_blacklist_alerts_on_syntage_insert` smoke test pasa (insert sintético → 1 alert → cleanup).
- [ ] 4 wrappers `analytics_*` dropeados (gated + frontend auditado/migrado).
- [ ] Los 4 originales `syntage_*` siguen vivos.
- [ ] `schema_changes` tiene entry por cada DDL (columnas correctas: `change_type, table_name, description, sql_executed`).
- [ ] `audit_runs` tiene `phase_2_6_baseline` y `phase_2_6_final`.
- [ ] `CLAUDE.md` frontend actualizado.
- [ ] Memoria `project_supabase_audit_2026_04_19.md` actualizada.

---

## Riesgos & mitigaciones

| Riesgo | Mitigación |
|---|---|
| `raw_payload->>'fullyPaidAt'` contiene strings vacíos que rompen cast a timestamptz | `NULLIF(..., '')::timestamptz` en cada cast (patrón aplicado en Task 1) |
| MV `syntage_invoices_enriched` crece a >200 MB y refresh CONCURRENTLY tarda | UNIQUE index en `uuid` permite CONCURRENTLY; si tarda >30s, evaluar particionado por año en Fase 4 Performance |
| `refresh_all_matviews()` CREATE OR REPLACE pierde MVs si alguien añadió otra en paralelo | Task 2 Step 1 obliga a leer body actual **antes** de redefinir; abortar si difiere del baseline capturado |
| `balance_sheet.balance_check_diff` no cuadra (A ≠ P + C) en algún período | View expone el diff; investigar account_types faltantes o resultado del ejercicio no mapeado a `equity_unaffected` antes de considerar DoD cumplido |
| `company_69b_status` deja fuera RFCs sin match en `companies` | Trigger `blacklist_alerts` permite `company_id NULL` — capturamos el RFC crudo incluso si companies no lo tiene |
| Trigger `blacklist_alerts` spammea al replay histórico de Syntage | Trigger es AFTER INSERT only (no UPDATE); backfill histórico no lo dispara. Si se quisiera cubrir histórico, hacer un INSERT ... SELECT one-shot separado en Fase 2.7 |
| `DROP VIEW analytics_*` rompe frontend prod | Gate de OK explícito + audit `rg` obligatorio + commit frontend migration ANTES del DROP |
| `syntage_invoices_enriched` queda stale hasta el próximo `refresh_all_matviews` | Cron existente lo corre periódicamente; si se necesita on-demand, `REFRESH MATERIALIZED VIEW CONCURRENTLY public.syntage_invoices_enriched` manual |

---

## Self-review

- [x] Task 0 captura baseline antes de crear objetos
- [x] Task 1 es el deliverable central (syntage_invoices_enriched MV con goldmine fiscal)
- [x] Task 2 garantiza refresh periódico vía cron
- [x] Task 3 entrega balance_sheet (análogo a pl_estado_resultados, estructura paralela)
- [x] Tasks 4–6 cubren 69B surface (view + tabla + trigger) en ese orden (dependencia: tabla antes del trigger)
- [x] Task 7 poda wrappers (gated — OK explícito + audit frontend)
- [x] Task 8 cierra con audit_runs + CLAUDE.md + memoria
- [x] `schema_changes` INSERTs usan columnas correctas: `(change_type, table_name, description, sql_executed)` — no `object_name/notes`
- [x] DROP statements con `IF EXISTS` para idempotencia
- [x] Migrations wrapeadas con `BEGIN; ... COMMIT;`
- [x] Destructivas (DROP) listadas upfront y gated por OK explícito
- [x] Smoke tests en cada task con expected values derivados del baseline del spec 07
- [x] Casts de raw_payload usan `NULLIF(x,'')` para tolerar strings vacíos
- [x] Pattern de integración a `refresh_all_matviews()` copia el cuerpo completo de la función (Fase 2.5 Task 7 pattern)
- [x] Referencias cruzadas al spec 07 (§4.2, §3.6, §4.1, §7.3)
- [x] DoD medible contra counts baseline
