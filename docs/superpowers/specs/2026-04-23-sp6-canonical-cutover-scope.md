# SP6 Canonical Cutover — Scope

**Date:** 2026-04-23
**Status:** Scope / design only (no implementation)
**Audience:** backend + silver-layer engineers

## Goal

Retire the 40+ `SP5-EXCEPTION` reads in the Next.js app by closing the gaps in the
canonical/gold layer that forced them. After SP6 cutover, Bronze `odoo_*` tables
are consumed only by the sync addon, reconciliation/diagnostic tooling, and the
two intentionally-retained proxies (`contacts`, `companies`).

Non-goals: dropping Bronze tables (deferred), rewriting the sync addon, or
changing the ReasoningBank/insight schema.

## Inventory (file:line → target)

Grouped by what's blocking the swap.

### A — Canonical tables that don't exist yet (6)

| Missing canonical | Bronze currently read | Consumers |
|---|---|---|
| `canonical_users` | `odoo_users` | `api/agents/orchestrate/route.ts:585,1499` |
| `canonical_crm_leads` | `odoo_crm_leads` | `api/pipeline/reconcile:192`, `api/agents/validate:192`, `api/agents/orchestrate:1390`, `lib/pipeline/odoo-context:81`, `lib/agents/director-chat-context:161` |
| `canonical_activities` | `odoo_activities` | `api/agents/orchestrate:1498`, `lib/pipeline/odoo-context:89`, `lib/queries/_shared/companies:914`, `lib/agents/director-chat-context:495` |
| `canonical_deliveries` | `odoo_deliveries` | `api/pipeline/reconcile:103`, `api/agents/validate:128`, `lib/pipeline/odoo-context:73` |
| `canonical_orderpoints` | `odoo_orderpoints` | `lib/agents/director-chat-context:382` |
| `canonical_invoice_lines` | `odoo_invoice_lines` | `lib/queries/unified/invoice-detail:106` |

### B — Canonical table exists, missing FK / field (3)

| Canonical | Gap | Consumers |
|---|---|---|
| `canonical_invoices` | `company_id` (Bronze FK) | `api/pipeline/reconcile:54`, `api/agents/validate:95`, `api/agents/auto-fix:284`, `api/chat:233`, `api/syntage/health:139,148`, `lib/pipeline/odoo-context:57`, `lib/queries/fiscal/syntage-health:125,142` |
| `canonical_invoices` | `days_overdue` computed column | `api/chat:251` |
| `canonical_order_lines` | `company_id` (MV has no FK) | `api/agents/cleanup:63`, `api/agents/auto-fix:287`, `lib/pipeline/odoo-context:96` |
| `canonical_payments` | Journal FK (`journal_name`, `payment_method`) | `api/pipeline/briefing:118`, `lib/pipeline/odoo-context:65`, `lib/agents/financiero-context:51,66` |

### C — §12 banned MVs with no gold replacement (9)

These were dropped in SP5/SP8 but are still read by code that was marked for
SP6. Each needs a specific gold view rebuild before its read can be migrated.

| Banned MV | Proposed gold replacement | Consumers |
|---|---|---|
| `company_narrative` | `gold_company_360` extended with `risk_signal`, OTD, complaints | reconcile:236, briefing:74, chat:96, orchestrate:1363 |
| `company_email_intelligence` | `gold_email_signals` (aggregate email_signals + ai_extracted_facts) | briefing:110, orchestrate:1124 |
| `company_insight_history` | `gold_insight_convergence` (aggregate agent_insights) | briefing:93 |
| `rfm_segments` | `gold_rfm_segments` from canonical_sale_orders | orchestrate:1397 |
| `supplier_product_matrix` | `gold_supplier_product_matrix` from canonical_order_lines | orchestrate:1445,1446 |
| `supplier_price_index` | `gold_supplier_price_index` from canonical_order_lines + canonical_invoices | orchestrate:1453 |
| `supplier_concentration_herfindahl` | `gold_supplier_concentration` | orchestrate (riesgo_dir) |
| `product_margin_analysis` | `gold_product_margins` | orchestrate:1387 |
| `customer_margin_analysis` | `gold_customer_margins` | orchestrate (costos) |
| `customer_product_matrix` | `gold_customer_product_matrix` | orchestrate:1388 |

### D — Tolerated (no cutover) (2)

| Bronze read | Why kept |
|---|---|
| `odoo_sync_freshness` in `lib/queries/_shared/system.ts:38,161` | `/sistema` page diagnostic — Bronze is authoritative for sync lag. |
| `syntage/health` reads both Bronze + canonical | Reconciliation tool by design cross-checks both sources. |

## Execution plan

Three logically independent workstreams; schedule determined by data-quality
requirements, not code complexity.

### Workstream 1 — Canonical FK / field additions (Category B)

Unblocks the largest consumer count for the smallest schema change.

1. `canonical_invoices.company_id` — Bronze `companies.id` FK, backfilled via
   `emisor_canonical_company_id` → `source_links` → `companies.odoo_partner_id`
   join. Maintain via Bronze trigger on invoice insert.
2. `canonical_invoices.days_overdue` — generated column:
   `(CURRENT_DATE - due_date_resolved)` when `payment_state_odoo IN ('not_paid','partial')`,
   NULL otherwise. Add with `IMMUTABLE` expression or keep it a computed view.
3. `canonical_order_lines` — drop MV, recreate as table with `company_id` FK
   hydrated by the same join pattern. Or add `company_id` column to the MV
   source and refresh.
4. `canonical_payments` — add `journal_name`, `payment_method`, `journal_type`
   columns sourced from `odoo_account_payments`. Populate via Bronze trigger.

Frontend: migrate the 10 B-category reads after migrations land. Pure search-
replace — no logic change. Estimated 2h once schema is in place.

### Workstream 2 — Gold view rebuilds (Category C)

Each gold view is an independent project; prioritize by reader weight:

- **Highest weight:** `gold_company_360` extension — used by 4 consumers across
  reconcile/briefing/chat/orchestrate. Needs `risk_signal` flag, OTD metric,
  complaint count, recent payment narrative.
- **Medium:** `gold_email_signals`, `gold_rfm_segments`, `gold_product_margins`.
- **Low:** supplier_* trio. Consumers are one agent each.

Frontend migration per view: 1–2 read sites each. Total ~15 sites.

### Workstream 3 — Net-new canonical tables (Category A)

Each canonical table is a Pattern A/B deliverable requiring source_links +
matcher + trigger wiring. Order by MDM criticality:

1. `canonical_users` — unlocks assignee routing; small (~20 rows); highest ROI.
2. `canonical_activities` — feeds risk/cobranza agents.
3. `canonical_crm_leads` — feeds comercial agent + chat context.
4. `canonical_deliveries` — feeds operaciones agent + reconciliation.
5. `canonical_orderpoints` — feeds director-chat inventory context only.
6. `canonical_invoice_lines` — feeds `/inbox/insight/[id]` drill-down.

Each is 4–8h of Supabase schema work + 1–2h frontend rewire.

## Sequencing recommendation

WS1 → WS3 (order above) → WS2. Rationale:

- WS1 is mechanical and unblocks the most-active API routes.
- WS3 order starts with smallest table (users) to prove the pattern.
- WS2 depends on canonical_order_lines from WS1 for supplier/margin gold views.

## Out of scope

- Rewriting Odoo addon sync paths (already canonical-aware).
- `contacts` / `companies` Bronze proxies — retained by 2026-04-22 decision.
- `odoo_sync_freshness` reads in `/sistema` — Bronze is authoritative.
- `syntage/health` cross-reads — diagnostic tool.

## Effort estimate

| Workstream | Supabase | Frontend | Notes |
|---|---|---|---|
| WS1 (B) | 1 day | 2 hours | 4 migrations, 10 reads |
| WS2 (C) | 3–5 days | ~8 hours | 9 gold views, ~15 reads |
| WS3 (A) | 5–8 days | ~8 hours | 6 canonical tables, ~15 reads |
| **Total** | **~2 weeks of silver work** | **~1 day of frontend** | |

Frontend cost is small; bottleneck is silver-layer design. Once a canonical
dependency lands, the frontend swap is mechanical.
