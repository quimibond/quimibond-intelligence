# Silver SP1 — Audit + Prune Notes

**Plan:** docs/superpowers/plans/2026-04-21-silver-sp1-audit-prune.md
**Spec:** docs/superpowers/specs/2026-04-21-silver-architecture.md §11 SP1 + §12 drop list
**Supabase project:** tozqezmivpblmcubmnpi
**Branch:** silver-sp1-audit-prune

---

## Antes (baseline)

### Counts (Query 1)

| Objeto | Count |
|---|---|
| Views (public) | 77 |
| Materialized Views (public) | 39 |
| Tables (public) | 77 |
| Functions (public) | 312 |

### Named candidates existence per §12 (Query 2)

| Check | Count | Notas |
|---|---|---|
| named_views_present (§12.1) | 2 | `analytics_customer_360`, `analytics_supplier_360` presentes |
| named_mvs_candidates (§12.2) | 6 | MVs con sufijo `%predictions`, `%cohorts`, `%handlers`, `%narrative`, `%insight_history` |
| named_tables_candidates (§12.3) | 9 de 11 | `director_analysis_actions` y `document_extractions` ya no existen (dropeadas en fase anterior) |

### Row counts para tablas candidatas a drop (Query 3)

| Tabla | Filas | Decisión provisional |
|---|---|---|
| action_items | 4,312 | evaluar en Task 3 |
| agent_tickets | 1,958 | candidata drop §12.3 |
| briefings | 48 | evaluar en Task 3 |
| cashflow_journal_classification | 10 | candidata drop §12.3 |
| director_analysis_runs | 35 | candidata drop §12.3 |
| health_scores | 52,152 | candidata drop §12.3 — datos vivos, archivar antes |
| notification_queue | 815 | candidata drop §12.3 |
| pipeline_logs | 33,371 | evaluar en Task 3 — audit trail activo |
| syntage_webhook_events | 83,334 | candidata drop §12.3 — webhook events históricos |
| director_analysis_actions | — | ya no existe (dropeada antes de SP1) |
| document_extractions | — | ya no existe (dropeada antes de SP1) |

### Baseline audit_runs entry

Migration `sp1_00_baseline` aplicada: `success=true`

---

## Fase A — Audit evidence (Tasks 1 + 2, 2026-04-21)

### Frontend caller audit (Task 1)

Sources searched: `src/`, `app/`, `vercel.json`. Excluded: `__tests__/`, `*.md` files, `.next/`, `node_modules/`.

**Views (§12.1 — 16 candidates):**

| Object | Frontend callers (file:line) |
|---|---|
| `analytics_customer_360` | src/lib/queries/analytics/customer-360.ts:50 (`.from("analytics_customer_360")`), src/app/empresas/[id]/_components/PanoramaTab.tsx:167 (comment referencing it) |
| `analytics_supplier_360` | (none) |
| `unified_invoices` | (none — not directly queried; `invoices_unified` MV is the live source) |
| `unified_payment_allocations` | (none directly) |
| `invoice_bridge` | (none in src/app — used in DB via reconcile_invoice_manually RPC) |
| `orders_unified` | (none) |
| `order_fulfillment_bridge` | (none) |
| `person_unified` | (none) |
| `cash_position` | src/lib/queries/analytics/finance.ts:194 (`.from("cash_position")`), src/lib/queries/analytics/finance.ts:178 (comment) |
| `working_capital` | src/lib/queries/analytics/finance.ts:154 (`.from("working_capital")`), src/lib/agents/director-chat-context.ts:237, src/lib/agents/financiero-context.ts:120 |
| `working_capital_cycle` | src/lib/queries/analytics/finance.ts:313 (`.from("working_capital_cycle")`), src/app/finanzas/page.tsx:835 |
| `cashflow_current_cash` | (none in frontend — only in `get_projected_cash_flow` / `get_projected_cash_flow_summary` DB fns) |
| `cashflow_liquidity_metrics` | src/app/finanzas/_components/cashflow-recommendations.tsx:132 (comment), implicit via `get_cashflow_recommendations` RPC |
| `monthly_revenue_trend` | (none — deferred SP4 per spec) |
| `balance_sheet` | (none) |
| `pl_estado_resultados` | src/lib/queries/analytics/finance.ts:245, src/lib/queries/analytics/dashboard.ts:105, src/lib/agents/director-chat-context.ts:236, src/lib/agents/financiero-context.ts:119, src/app/finanzas/page.tsx:638+653, src/app/page.tsx:385, src/lib/queries/operational/sales.ts:60+226 |
| `revenue_concentration` | src/lib/queries/analytics/index.ts:236 (`.from("revenue_concentration")`) |
| `cash_flow_aging` | src/lib/queries/unified/invoices.ts:87 (comment + query context), src/lib/queries/_shared/companies.ts:13 (comment) |

**MVs — drop or re-evaluate set (§12.2):**

| Object | Frontend callers (file:line) |
|---|---|
| `invoices_unified` | src/lib/queries/unified/invoices.ts:47,152,245,339; src/lib/queries/unified/index.ts:86,103,125; src/lib/agents/financiero-context.ts:57; src/lib/queries/operational/sales.ts:182,435; src/lib/queries/analytics/finance.ts:89; src/lib/queries/operational/purchases.ts:63 — **heavily used** |
| `payments_unified` | src/lib/queries/operational/purchases.ts (via reconciliation); src/app/api/syntage/refresh-unified/route.ts:39; src/__tests__/* — **active** |
| `syntage_invoices_enriched` | (none in src/ directly) |
| `products_unified` | (none in src/ directly) |
| `product_price_history` | (none in src/ directly) |
| `company_profile` | src/lib/queries/_shared/companies.ts:169,351; src/lib/agents/director-chat-context.ts:161,171,411,457,454,497; src/lib/agents/financiero-context.ts:28; src/app/api/agents/orchestrate/route.ts:1369,1375,1454,1457,1500; src/app/api/pipeline/health-scores/route.ts:39; src/lib/queries/operational/sales.ts:553,647 — **core object** |
| `company_profile_sat` | src/lib/queries/_shared/companies.ts:74,210,363; src/lib/queries/operational/sales.ts:489,585,670; src/app/empresas/[id]/_components/PanoramaTab.tsx:85 — **active** |
| `monthly_revenue_by_company` | src/lib/queries/operational/sales.ts:65 (`.from("monthly_revenue_by_company")`) |
| `product_margin_analysis` | src/lib/queries/analytics/products.ts:37,456,542,691,774,978; src/app/api/agents/orchestrate/route.ts:1370,1473,1475; src/lib/agents/director-chat-context.ts:321; src/app/productos/page.tsx:955 — **heavily used** |
| `customer_margin_analysis` | src/lib/queries/operational/sales.ts:484,580,665; src/app/api/agents/orchestrate/route.ts:1487 — **active** |
| `customer_ltv_health` | src/lib/queries/_shared/companies.ts:70,206,358; src/lib/queries/analytics/dashboard.ts:82; src/app/api/agents/orchestrate/route.ts:1380 — **active** |
| `customer_product_matrix` | src/app/api/agents/orchestrate/route.ts:1371 — **used by agents** |
| `supplier_product_matrix` | src/app/api/agents/orchestrate/route.ts:1431,1432,1453; src/lib/agents/director-chat-context.ts:274,285; src/lib/queries/operational/purchases.ts:532 — **active** |
| `supplier_price_index` | src/lib/queries/analytics/index.ts:424; src/app/api/agents/orchestrate/route.ts:1443 — **active** |
| `supplier_concentration_herfindahl` | src/lib/queries/operational/purchases.ts:167,207,242; src/app/api/agents/orchestrate/route.ts:1462; src/lib/agents/director-chat-context.ts:254 — **active** |
| `partner_payment_profile` | src/lib/queries/analytics/finance.ts:801 (`.from('partner_payment_profile')`) — **active** |
| `account_payment_profile` | src/lib/queries/analytics/finance.ts:918 (`.from('account_payment_profile')`) — **active** |
| `portfolio_concentration` | src/lib/queries/_shared/companies.ts:66,202 (`.from("portfolio_concentration")`) — **active** |
| `rfm_segments` | src/lib/queries/analytics/index.ts:61,97,98; src/app/api/agents/orchestrate/route.ts:1383 — **active** |
| `customer_cohorts` | src/lib/queries/analytics/index.ts:534; src/app/ventas/page.tsx:1389 — **active** |
| `company_email_intelligence` | src/app/api/agents/orchestrate/route.ts:1102; src/app/api/pipeline/briefing/route.ts:110 — **active (agents)** |
| `company_handlers` | src/app/api/agents/cleanup/route.ts:226 (RPC call) — **active (agents)** |
| `company_insight_history` | src/app/api/pipeline/briefing/route.ts:93 — **active (briefing)** |
| `company_narrative` | src/app/api/agents/orchestrate/route.ts:1346,1451; src/lib/agents/director-chat-context.ts:401; src/lib/queries/_shared/companies.ts:353; src/app/api/chat/route.ts:96; src/app/api/pipeline/briefing/route.ts:74; src/app/api/pipeline/reconcile/route.ts:223 — **heavily used** |
| `cross_director_signals` | (none in src/ directly) |

**MVs — operational KEEP set (§12.2):**

| Object | Frontend callers (file:line) |
|---|---|
| `inventory_velocity` | src/lib/queries/analytics/products.ts:34,109,174,223,276,314 — **heavily used** |
| `dead_stock_analysis` | src/lib/queries/analytics/products.ts:36,375,408; src/lib/agents/director-chat-context.ts:327,379; src/app/api/agents/orchestrate/route.ts:1412,1474 — **active** |
| `cashflow_projection` | src/lib/agents/director-chat-context.ts:235 — **used by agents** |
| `accounting_anomalies` | src/lib/agents/director-chat-context.ts:427; src/lib/agents/financiero-context.ts:122; src/app/api/agents/orchestrate/route.ts:1458; src/app/api/chat/route.ts:147 — **active** |
| `ar_aging_detail` | (none in frontend directly — DB dep: `cash_flow_aging` view uses it) |
| `journal_flow_profile` | src/lib/queries/analytics/finance.ts:876 (`.from('journal_flow_profile')`) — **active** |
| `ops_delivery_health_weekly` | src/lib/queries/operational/operations.ts:35,106; src/app/api/agents/orchestrate/route.ts:1422; src/lib/agents/director-chat-context.ts:360; src/app/operaciones/page.tsx:320 — **active** |
| `purchase_price_intelligence` | src/lib/queries/operational/purchases.ts:312,356; src/app/api/agents/orchestrate/route.ts:1435,1477; src/lib/agents/director-chat-context.ts:263,331; src/app/compras/page.tsx:907 — **active** |
| `product_real_cost` | src/lib/queries/analytics/products.ts:879,895,919,974,1033; src/app/api/agents/orchestrate/route.ts:1485 — **active** |
| `product_seasonality` | (none in src/ directly — only in `refresh_product_intelligence` fn body) |
| `payment_predictions` | src/lib/queries/unified/invoices.ts:464,515,551; src/app/api/agents/orchestrate/route.ts:1452; src/lib/agents/director-chat-context.ts:230,406; src/lib/agents/financiero-context.ts:51; src/app/api/chat/route.ts:104; src/app/cobranza/page.tsx:202 — **heavily used** |
| `client_reorder_predictions` | src/lib/queries/operational/sales.ts:306,360; src/app/api/agents/orchestrate/route.ts:1368,1493; src/lib/agents/director-chat-context.ts:156; src/app/api/chat/route.ts:111 — **active** |
| `bom_duplicate_components` | src/lib/queries/analytics/products.ts:949 (`.from("bom_duplicate_components")`) — **active** |
| `stockout_queue` | src/lib/queries/analytics/index.ts:307,344,345 (`.from("stockout_queue")`) — **active (view, not MV)** |

**Tables (§12.3):**

| Object | Frontend callers (file:line) |
|---|---|
| `agent_tickets` | src/app/api/agents/orchestrate/route.ts:1121,370 (reads + inserts) — **ACTIVE write path** |
| `notification_queue` | src/lib/queries/_shared/system.ts:41,471 (reads status) — **read active, no worker** |
| `health_scores` | src/app/api/pipeline/health-scores/route.ts:82,227 (read+write), src/app/api/agents/orchestrate/route.ts:1376, src/app/api/system/health/route.ts:25 — **ACTIVE write path** |
| `unified_refresh_queue` | (none in src/ — only `trg_schedule_unified_refresh` trigger fn) |
| `reconciliation_summary_daily` | src/app/api/pipeline/briefing/route.ts:153,157 — **read-only** |
| `odoo_schema_catalog` | (none) |
| `odoo_uoms` | (none) |
| `odoo_snapshots` | (none in src/ — only DB fns: `get_company_full_context`, `take_daily_snapshot`) |
| `odoo_invoices_archive_pre_dedup` | (none) |
| `odoo_invoices_archive_dup_cfdi_uuid_2026_04_20` | (none) |
| `invoice_bridge_manual` | (none in src/ — 0 rows; reconcile UI uses RPC not direct) |
| `payment_bridge_manual` | (none in src/ — 0 rows) |
| `products_fiscal_map` | (none in src/ — 20 rows, seeded data) |

**Pages (§12.4):**

| Page | Status | Notes |
|---|---|---|
| `/briefings` | Active in nav | Has its own page in src/app/briefings |
| `/chat` | Active | |
| `/cobranza` | Active | Uses payment_predictions, invoices_unified |
| `/compras` | Active | Uses supplier matrices |
| `/contactos` | Active | |
| `/directores` | Active | |
| `/empresas` | Active | |
| `/equipo` | Active | |
| `/finanzas` | Active | Uses cash_position, working_capital, pl_estado_resultados |
| `/inbox` | Active | |
| `/login` | Active | |
| `/operaciones` | Active | |
| `/productos` | Active | |
| `/profile` | Active | |
| `/sistema` | Active | Shows syntage reconciliation panel |
| `/ventas` | Active | Uses customer_cohorts |
| `/emails` | **NOT in nav** (was standalone, merged to tabs) — no standalone page in src/app/ |
| `/dashboard` | **NOT in app/** — no folder found; root `/` is page.tsx |

**API routes / crons (§12.5):**

| Route | Vercel cron | Status |
|---|---|---|
| `/api/pipeline/health-scores` | `0 */6 * * *` | Active — writes health_scores |
| `/api/pipeline/briefing` | `30 6 * * *` | Active — reads reconciliation_summary_daily, company_narrative |
| `/api/pipeline/reconcile` | `0 7 * * *` | Active in cron — reads company_narrative |
| `/api/pipeline/embeddings` | `15 */4 * * *` | Active in cron — evaluate separately |
| `/api/pipeline/snapshot` | `30 5 * * *` | Active in cron |
| `/api/pipeline/refresh-views` | `30 */6 * * *` | Active — refreshes MVs |

---

### DB dependency audit (Task 2)

**pg_depend results — views (§12.1):**

| Candidate | DB dependents |
|---|---|
| `unified_invoices` | `public.invoice_bridge` (view) — unified_invoices is DEPENDENCY OF invoice_bridge |
| `cashflow_current_cash` | `public.cashflow_liquidity_metrics` (view) — dep chain |
| `pl_estado_resultados` | `public.overhead_factor_12m` (view) — dep |
| all others (16 views) | (none) |

**pg_depend results — MVs (§12.2):**

| Candidate | DB dependents (what DEPENDS ON this MV) |
|---|---|
| `company_profile` | `analytics_customer_360` (view), `cash_flow_aging` (view), `client_reorder_predictions` (MV), `company_narrative` (MV), `customer_ltv_health` (MV), `payment_predictions` (MV), `revenue_concentration` (view), `rfm_segments` (MV), `weekly_trends` (view) — **central node, 9 dependents** |
| `invoices_unified` | `payment_allocations_unified` (view), `payments_unified` (MV), `unified_invoices` (view) — **dep chain** |
| `payments_unified` | `payment_allocations_unified` (view) |
| `product_real_cost` | `customer_margin_analysis` (MV), `dead_stock_analysis` (MV), `inventory_velocity` (MV), `invoice_line_margins` (view), `overhead_factor_12m` (view), `product_margin_analysis` (MV), `real_sale_price` (MV), `working_capital_cycle` (view) — **central to cost chain, 8 dependents** |
| `company_narrative` | `analytics_customer_360` (view) |
| `customer_ltv_health` | `analytics_customer_360` (view) |
| `inventory_velocity` | `stockout_queue` (view) — KEEP |
| `customer_product_matrix` | `stockout_queue` (view) — KEEP |
| `ar_aging_detail` | `cash_flow_aging` (view) |
| `account_payment_profile` | `cashflow_opex_monthly`, `cashflow_payroll_monthly`, `cashflow_recurring_detail`, `cashflow_tax_monthly` (all views) |
| `partner_payment_profile` | `cashflow_ap_negotiate`, `cashflow_ap_predicted`, `cashflow_ar_acelerate`, `cashflow_po_backlog` (all views) |
| all others | (none or only within-candidate-set deps) |

**pg_depend results — tables (§12.3):**

| Candidate | DB dependents |
|---|---|
| `odoo_snapshots` | `snapshot_changes` (view) — dep |
| all others | (none) |

**Function body scan — notable hits:**

| Candidate | Functions referencing it |
|---|---|
| `agent_tickets` | `auto_expire_stale_tasks`, `on_new_email_for_critical_company` — triggers/fns active |
| `health_scores` | `cleanup_stale_data`, `company_evidence_pack`, `get_contact_health_history`, `get_contact_intelligence` |
| `notification_queue` | `cleanup_stale_data`, `generate_daily_digest`, `notify_urgent_insight`, `on_invoice_overdue_alert` |
| `unified_refresh_queue` | `trg_schedule_unified_refresh` (trigger fn) |
| `odoo_snapshots` | `get_company_full_context`, `take_daily_snapshot` |
| `reconciliation_summary_daily` | no fn body hit (written by pg_cron directly) |
| `invoice_bridge` | `reconcile_invoice_manually` |
| `invoices_unified` | `get_syntage_reconciliation_summary`, `refresh_invoices_unified`, `refresh_payments_unified`, `syntage_validation_coverage_by_month` |
| `company_profile` | `company_evidence_pack`, `refresh_company_profile` |
| `payment_predictions` | `company_evidence_pack`, `dq_invariants`, `get_dashboard_kpis`, `refresh_product_intelligence` |
| `accounting_anomalies` | `refresh_accounting_anomalies` |
| `cashflow_projection` | `company_evidence_pack`, `get_dashboard_kpis`, `refresh_cashflow_projection` |
| `product_real_cost` | `refresh_all_analytics_robust` |

**Cron jobs (pg_cron):**

| Job | Schedule | Relevant candidates |
|---|---|---|
| `refresh-all-matviews` | `15 */2 * * *` | Refreshes all MVs via `refresh_all_matviews()` |
| `refresh-syntage-unified` | `*/15 * * * *` | `invoices_unified`, `payments_unified` |
| `syntage-reconciliation-daily-snapshot` | `15 6 * * *` | Writes `reconciliation_summary_daily` |
| `audit_runs_retention_cleanup` | `30 3 * * *` | Deletes old `audit_runs` rows |
| `ingestion_sentinel` | `0 * * * *` | `ingestion.check_missing_reconciliations()` |

---

## Categorization (Tasks 1+2 evidence → decision)

**Rules applied:**
- `0 frontend + 0 DB deps + 0 cron` → `DROP`
- `has active frontend callers (live .from() queries)` → `KEEP` or `MIGRATE FIRST`
- `user pre-approved DROP` → `DROP` (flag if also has active callers → CONCERN)
- `DB deps only via refresh_all_matviews (weak)` → `RE-EVALUATE`
- `active source/sink for running pipeline` → `KEEP`
- `0 rows + 0 callers` → `DROP`

| Object | Kind | Frontend callers | DB deps | Fn refs | Cron | Decision |
|---|---|---|---|---|---|---|
| **VIEWS (§12.1)** | | | | | | |
| `analytics_customer_360` | view | customer-360.ts:50, PanoramaTab.tsx:167 | depends on: company_profile (MV), company_narrative (MV), customer_ltv_health (MV) | (none) | (none) | **KEEP** (active — SP5 migration to canonical_* when MVs rebuild) |
| `analytics_supplier_360` | view | (none) | (none) | (none) | (none) | **DROP** |
| `unified_invoices` | view | (none) | depended on by: invoice_bridge (view) | (none) | (none) | **RE-EVALUATE** — no frontend callers but invoice_bridge depends on it; both can drop together in Batch 1 |
| `unified_payment_allocations` | view | (none) | (none) | (none) | (none) | **DROP** |
| `invoice_bridge` | view | (none in live src/) | depends on: unified_invoices | `reconcile_invoice_manually` fn | (none) | **RE-EVALUATE** — DB fn reconcile_invoice_manually refs it; no direct frontend; drop if fn is updated |
| `orders_unified` | view | (none) | (none) | (none) | (none) | **DROP** |
| `order_fulfillment_bridge` | view | (none) | (none) | (none) | (none) | **DROP** |
| `person_unified` | view | (none) | (none) | (none) | (none) | **DROP** |
| `cash_position` | view | finance.ts:194 | (none) | `generate_daily_digest` | (none) | **KEEP** (active) |
| `working_capital` | view | finance.ts:154, director-chat-context.ts:237 | (none) | `dq_invariants` | (none) | **KEEP** (active) |
| `working_capital_cycle` | view | finance.ts:313, finanzas/page.tsx:835 | depends on: product_real_cost (MV) | `dq_invariants` | (none) | **KEEP** (active — dep on product_real_cost is upstream KEEP) |
| `cashflow_current_cash` | view | (none — only via RPC) | depended on by: cashflow_liquidity_metrics | `get_projected_cash_flow`, `get_projected_cash_flow_summary` | (none) | **KEEP** (active via RPC + dep chain to cashflow_liquidity_metrics) |
| `cashflow_liquidity_metrics` | view | finanzas/cashflow-recommendations.tsx (RPC-only) | depends on: cashflow_current_cash | `get_cashflow_recommendations` | (none) | **KEEP** (active via RPC) |
| `monthly_revenue_trend` | view | (none) | (none) | (none) | (none) | **RE-EVALUATE** (deferred SP4 per spec — 0 callers → safe to DROP in SP1, spec says defer; flag for user) |
| `balance_sheet` | view | (none) | (none) | (none) | (none) | **DROP** |
| `pl_estado_resultados` | view | finance.ts:245, dashboard.ts:105, director-chat-context.ts:236, finanzas/page.tsx:638, page.tsx:385, sales.ts:60+226 | depended on by: overhead_factor_12m | `get_dashboard_kpis` | (none) | **KEEP** (heavily used) |
| `revenue_concentration` | view | analytics/index.ts:236 | depends on: company_profile | (none) | (none) | **KEEP** (active — dep on company_profile is upstream KEEP) |
| `cash_flow_aging` | view | (comment ref + query context in invoices.ts:87) | depends on: ar_aging_detail (MV), company_profile (MV) | (none) | (none) | **KEEP** (active — referenced in cobranza/AR flow) |
| **MVs — drop/re-evaluate set (§12.2)** | | | | | | |
| `invoices_unified` | matview | finance.ts:89, invoices.ts:47+152+245+339, unified/index.ts:86+103+125, sales.ts:182+435, purchases.ts:63 | depended on by: payments_unified (MV), unified_invoices (view), payment_allocations_unified (view) | `refresh_invoices_unified`, `refresh_payments_unified`, `get_syntage_reconciliation_summary` | `refresh-syntage-unified` (*/15min) | **KEEP** (core fiscal Layer 3 — drop in SP5) |
| `payments_unified` | matview | refresh-unified/route.ts:39; test files | depends on: invoices_unified; depended on by: payment_allocations_unified | `refresh_payments_unified`, `get_syntage_reconciliation_summary` | `refresh-syntage-unified` (*/15min) | **KEEP** (core fiscal Layer 3 — drop in SP5) |
| `syntage_invoices_enriched` | matview | (none in src/) | (none) | (none) | `refresh-all-matviews` (weak) | **RE-EVALUATE** (0 frontend callers; only in refresh_all_matviews — likely dead weight; user confirm) |
| `products_unified` | matview | (none in src/) | (none) | (none) | `refresh-all-matviews` (weak) | **RE-EVALUATE** (0 callers — was interim step; probably DROP) |
| `product_price_history` | matview | (none in src/) | (none) | (none) | `refresh-all-matviews` (weak) | **RE-EVALUATE** (0 callers — spec says rebuild SP4; DROP now) |
| `company_profile` | matview | companies.ts:169+351, orchestrate:1369+1375+1454+1457+1500, health-scores:39, sales.ts:553+647 | depended on by: analytics_customer_360, cash_flow_aging, client_reorder_predictions, company_narrative, customer_ltv_health, payment_predictions, revenue_concentration, rfm_segments, weekly_trends | `company_evidence_pack`, `refresh_company_profile` | `refresh-all-matviews` | **KEEP** (central node — 9 DB deps + many frontend callers; drop in SP5) |
| `company_profile_sat` | matview | companies.ts:74+210+363, sales.ts:489+585+670, PanoramaTab.tsx:85 | (none) | (none) | `refresh-all-matviews` | **KEEP** (active) |
| `monthly_revenue_by_company` | matview | operational/sales.ts:65 | (none) | `refresh_product_intelligence` | `refresh-all-matviews` | **KEEP** (active — deferred SP4 consolidation with monthly_revenue_trend per spec) |
| `product_margin_analysis` | matview | products.ts:37+456+542+691+774+978, orchestrate:1370+1473+1475, director-chat-context.ts:321, productos/page.tsx:955 | depends on: product_real_cost | `refresh_product_intelligence`, `refresh_all_analytics_robust`, `dq_invariants` | `refresh-all-matviews` | **KEEP** (heavily used) |
| `customer_margin_analysis` | matview | sales.ts:484+580+665, orchestrate:1487 | depends on: product_real_cost | `refresh_product_intelligence`, `refresh_all_analytics_robust`, `dq_invariants` | `refresh-all-matviews` | **KEEP** (active) |
| `customer_ltv_health` | matview | companies.ts:70+206+358, dashboard.ts:82, orchestrate:1380 | depends on: company_profile; depended on by: analytics_customer_360 | `company_evidence_pack`, `get_dashboard_kpis`, `get_director_briefing` | `refresh-all-matviews` | **KEEP** (active) |
| `customer_product_matrix` | matview | orchestrate:1371 | depended on by: stockout_queue (view) | `refresh_product_intelligence` | `refresh-all-matviews` | **KEEP** (active — agents + stockout_queue dep) |
| `supplier_product_matrix` | matview | orchestrate:1431+1432+1453, director-chat-context.ts:274+285, purchases.ts:532 | (none) | `refresh_product_intelligence` | `refresh-all-matviews` | **KEEP** (active) |
| `supplier_price_index` | matview | analytics/index.ts:424, orchestrate:1443 | (none) | `refresh_supplier_price_index` | `refresh-all-matviews` | **KEEP** (active) |
| `supplier_concentration_herfindahl` | matview | purchases.ts:167+207+242, orchestrate:1462, director-chat-context.ts:254 | (none) | `get_director_briefing` | `refresh-all-matviews` | **KEEP** (active) |
| `partner_payment_profile` | matview | finance.ts:801 | depended on by: cashflow_ap_negotiate, cashflow_ap_predicted, cashflow_ar_acelerate, cashflow_po_backlog | `refresh_cashflow_profiles` | `refresh-all-matviews` | **KEEP** (active + cashflow dep chain) |
| `account_payment_profile` | matview | finance.ts:918 | depended on by: cashflow_opex_monthly, cashflow_payroll_monthly, cashflow_recurring_detail, cashflow_tax_monthly | `refresh_cashflow_profiles` | `refresh-all-matviews` | **KEEP** (active + cashflow dep chain) |
| `portfolio_concentration` | matview | companies.ts:66+202 | (none) | `get_director_briefing`, `refresh_product_intelligence` | `refresh-all-matviews` | **KEEP** (active) |
| `rfm_segments` | matview | analytics/index.ts:61+97+98, orchestrate:1383 | depends on: company_profile | `refresh_rfm_segments` | `refresh-all-matviews` | **KEEP** (active) |
| `customer_cohorts` | matview | analytics/index.ts:534, ventas/page.tsx:1389 | (none) | `refresh_product_intelligence` | `refresh-all-matviews` | **KEEP** (active) |
| `company_email_intelligence` | matview | orchestrate:1102, briefing:110 | (none) | `refresh_product_intelligence` | `refresh-all-matviews` | **KEEP** (active — agents) |
| `company_handlers` | matview | agents/cleanup/route.ts:226 (RPC) | (none) | `refresh_company_handlers`, `route_insight` | `refresh-all-matviews` | **KEEP** (active — insight routing) |
| `company_insight_history` | matview | briefing/route.ts:93 | (none) | `refresh_product_intelligence` | `refresh-all-matviews` | **KEEP** (active) |
| `company_narrative` | matview | orchestrate:1346+1451, director-chat-context.ts:401, companies.ts:353, chat:96, briefing:74, reconcile:223 | depends on: company_profile; depended on by: analytics_customer_360 | `refresh_company_narrative`, `create_follow_up_on_action`, `resolve_pending_follow_ups`, `verify_follow_ups` | `refresh-all-matviews` | **KEEP** (heavily used) |
| `cross_director_signals` | matview | (none in src/) | (none) | `refresh_product_intelligence` | `refresh-all-matviews` | **RE-EVALUATE** (0 frontend callers; only refresh fn — probably DROP) |
| **MVs — operational KEEP set (§12.2)** | | | | | | |
| `inventory_velocity` | matview | products.ts:34+109+174+223+276+314 | depended on by: stockout_queue | `refresh_product_intelligence`, `refresh_all_analytics_robust` | `refresh-all-matviews` | **KEEP** (heavily used) |
| `dead_stock_analysis` | matview | products.ts:36+375+408, orchestrate:1412+1474, director-chat-context.ts:327+379 | depends on: product_real_cost | `refresh_product_intelligence`, `refresh_all_analytics_robust` | `refresh-all-matviews` | **KEEP** (active) |
| `cashflow_projection` | matview | director-chat-context.ts:235 | (none) | `refresh_cashflow_projection`, `company_evidence_pack`, `get_dashboard_kpis` | `refresh-all-matviews` | **KEEP** (active — agents + dashboard KPIs) |
| `accounting_anomalies` | matview | orchestrate:1458, director-chat-context.ts:427, financiero-context.ts:122, chat:147 | (none) | `refresh_accounting_anomalies` | `refresh-all-matviews` | **KEEP** (active) |
| `ar_aging_detail` | matview | (none directly) | depended on by: cash_flow_aging (view) | `refresh_cashflow_projection` | `refresh-all-matviews` | **KEEP** (dep chain — cash_flow_aging is active) |
| `journal_flow_profile` | matview | finance.ts:876 | (none) | `refresh_cashflow_profiles` | `refresh-all-matviews` | **KEEP** (active) |
| `ops_delivery_health_weekly` | matview | operations.ts:35+106, orchestrate:1422, director-chat-context.ts:360, operaciones/page.tsx:320 | (none) | `dq_invariants` | `refresh-all-matviews` | **KEEP** (active) |
| `purchase_price_intelligence` | matview | purchases.ts:312+356, orchestrate:1435+1477, director-chat-context.ts:263+331, compras/page.tsx:907 | (none) | `refresh_purchase_intelligence` | `refresh-all-matviews` | **KEEP** (active) |
| `product_real_cost` | matview | products.ts:879+895+919+974+1033, orchestrate:1485 | depended on by: customer_margin_analysis, dead_stock_analysis, inventory_velocity, invoice_line_margins, overhead_factor_12m, product_margin_analysis, real_sale_price, working_capital_cycle — **8 dependents** | `refresh_all_analytics_robust` | `refresh-all-matviews` | **KEEP** (central cost node — 8 DB deps) |
| `product_seasonality` | matview | (none in src/) | (none) | `refresh_product_intelligence` | `refresh-all-matviews` | **RE-EVALUATE** (0 frontend callers — probably DROP; user confirm) |
| `payment_predictions` | matview | invoices.ts:464+515+551, orchestrate:1452, director-chat-context.ts:230+406, financiero-context.ts:51, chat:104, cobranza/page.tsx:202 | depends on: company_profile | `company_evidence_pack`, `dq_invariants`, `get_dashboard_kpis`, `refresh_product_intelligence` | `refresh-all-matviews` | **KEEP** (heavily used) |
| `client_reorder_predictions` | matview | sales.ts:306+360, orchestrate:1368+1493, director-chat-context.ts:156, chat:111 | depends on: company_profile | `refresh_reorder_predictions`, `company_evidence_pack`, `get_dashboard_kpis` | `refresh-all-matviews` | **KEEP** (active) |
| `bom_duplicate_components` | matview | products.ts:949 | (none) | `refresh_all_analytics_robust` | `refresh-all-matviews` | **KEEP** (active) |
| **Tables (§12.3)** | | | | | | |
| `agent_tickets` | table | orchestrate:1121,370 (read+write) | (none) | `auto_expire_stale_tasks`, `on_new_email_for_critical_company` | (none) | **CONCERN: user pre-approved DROP but active write path in orchestrate route. Must remove code first. → MIGRATE FIRST (deactivate orchestrate writes then DROP)** |
| `notification_queue` | table | system.ts:41,471 (read status) | (none) | `cleanup_stale_data`, `generate_daily_digest`, `notify_urgent_insight`, `on_invoice_overdue_alert` | (none) | **CONCERN: user pre-approved DROP but 4 DB fns reference it + frontend reads status. No worker consumes queue. → RE-EVALUATE (user confirm: remove fns first)** |
| `health_scores` | table | health-scores/route.ts:82+227 (read+write, cron every 6h), orchestrate:1376, system/health:25 | (none) | `cleanup_stale_data`, `company_evidence_pack`, `get_contact_health_history`, `get_contact_intelligence` | Vercel cron `/api/pipeline/health-scores` (*/6h) | **CONCERN: user pre-approved DROP but has ACTIVE cron write path (every 6h) + 4 DB fns + orchestrate reads. Must deactivate cron + update fns before DROP. → MIGRATE FIRST** |
| `unified_refresh_queue` | table | (none) | (none) | `trg_schedule_unified_refresh` (trigger) | (none) | **DROP** (0 rows, 0 frontend; trigger fn is vestigial) |
| `reconciliation_summary_daily` | table | briefing/route.ts:153+157 | (none) | pg_cron writes it directly | `syntage-reconciliation-daily-snapshot` (daily 6:15am) | **KEEP** (active briefing read + active cron write) |
| `odoo_schema_catalog` | table | (none) | (none) | (none) | (none) | **DROP** (3,820 rows, dead-pixel) |
| `odoo_uoms` | table | (none) | (none) | (none) | (none) | **DROP** (76 rows) |
| `odoo_snapshots` | table | (none in src/) | depended on by: snapshot_changes (view) | `get_company_full_context`, `take_daily_snapshot` | (none) | **RE-EVALUATE** (21,783 rows; snapshot_changes view depends on it + 2 fns; user confirm: is take_daily_snapshot still running?) |
| `odoo_invoices_archive_pre_dedup` | table | (none) | (none) | (none) | (none) | **DROP** (5,321 rows, archive) |
| `odoo_invoices_archive_dup_cfdi_uuid_2026_04_20` | table | (none) | (none) | (none) | (none) | **DROP** (5,321 rows, archive) |
| `invoice_bridge_manual` | table | (none in src/ directly) | (none) | (reconcile_invoice_manually uses, but 0 rows) | (none) | **MIGRATE FIRST** (SP2 pre-drop — 0 rows but RPC references it; skip in SP1) |
| `payment_bridge_manual` | table | (none in src/ directly) | (none) | (0 rows) | (none) | **MIGRATE FIRST** (SP2 pre-drop — 0 rows; skip in SP1) |
| `products_fiscal_map` | table | (none in src/) | (none) | (none) | (none) | **MIGRATE FIRST** (SP3 — 20 seeded rows; skip in SP1) |
| **Tables from audit-notes baseline (not in spec §12.3 main list)** | | | | | | |
| `action_items` | table | (none verified) | (none known) | (none known) | (none) | **RE-EVALUATE** (4,312 rows — verify if any API route writes/reads; not in spec drop list) |
| `briefings` | table | briefings page reads | (none) | `get_director_briefing` | Vercel cron `/api/pipeline/briefing` | **KEEP** (48 rows, active briefing pipeline) |
| `cashflow_journal_classification` | table | (none in spec §12.3) | (none verified) | (none known) | (none) | **RE-EVALUATE** (10 rows — not in spec §12.3 main list; verify before drop) |
| `director_analysis_runs` | table | (none) | (none) | (none verified) | (none) | **DROP** (35 rows, broken pipeline pre-SP1 memo) |
| `pipeline_logs` | table | system.ts reads it | (none) | (none) | (none) | **KEEP** (33,371 rows, active audit trail) |
| `syntage_webhook_events` | table | (none in src/ — webhook route writes) | (none) | (none) | (none) | **RE-EVALUATE** (83,334 rows — check if webhook route src/app/api/syntage/webhook/route.ts still writes; if yes KEEP) |
| **Pages + routes (§12.4-12.5)** | | | | | | |
| `/emails` (standalone page) | page | NOT in src/app/ (was merged to tabs) | n/a | n/a | n/a | **ALREADY DROPPED** (no standalone page folder found) |
| `/dashboard` (standalone) | page | NOT in src/app/ (root is page.tsx) | n/a | n/a | n/a | **ALREADY DROPPED** |
| `/api/pipeline/health-scores` | route | Active cron (*/6h) — writes health_scores | n/a | n/a | Vercel cron | **KEEP** (but if health_scores table is dropped → must deactivate together) |
| `/api/pipeline/reconcile` | route | Active cron (0 7 * * *) | n/a | n/a | Vercel cron | **RE-EVALUATE** (reads company_narrative + manages follow-ups; cron active; evaluate if superseded) |
| `/api/pipeline/embeddings` | route | Active cron (15 */4 * * *) | n/a | n/a | Vercel cron | **RE-EVALUATE** (evaluate if used) |
| `/api/pipeline/snapshot` | route | Active cron (30 5 * * *) | n/a | n/a | Vercel cron | **RE-EVALUATE** (check if it calls take_daily_snapshot → odoo_snapshots) |

---

## Summary: SP1 Drop Candidates (safe to proceed in Tasks 4-6)

### Confirmed DROP (0 callers, 0 active deps, or user pre-approved + safe):
**Views:** `analytics_supplier_360`, `unified_payment_allocations`, `orders_unified`, `order_fulfillment_bridge`, `person_unified`, `balance_sheet`

**MVs:** (none confirmed — all either have callers or need user confirmation for RE-EVALUATE set)

**Tables:** `unified_refresh_queue`, `odoo_schema_catalog`, `odoo_uoms`, `odoo_invoices_archive_pre_dedup`, `odoo_invoices_archive_dup_cfdi_uuid_2026_04_20`, `director_analysis_runs`

### RE-EVALUATE (needs user gate before drop):
`unified_invoices` + `invoice_bridge` (drop pair), `monthly_revenue_trend`, `syntage_invoices_enriched`, `products_unified`, `product_price_history`, `cross_director_signals`, `product_seasonality`, `odoo_snapshots`, `notification_queue`, `action_items`, `cashflow_journal_classification`, `syntage_webhook_events`, `/api/pipeline/reconcile`, `/api/pipeline/embeddings`

### KEEP (confirmed active):
All others per categorization table above.

### CONCERN — user pre-approved DROP but active code:
- `agent_tickets` — orchestrate route actively writes tickets (line 370) + reads (line 1121) → **must remove code first**
- `health_scores` — active cron every 6h, orchestrate reads, 4 DB fns → **must deactivate cron + update fns first**
- `notification_queue` — 4 DB fns write to it (triggers firing on events) → **must update fns first**

---

## Drops ejecutados

_(populated in Tasks 4-8)_

---

## Después

_(populated in Task 9)_
