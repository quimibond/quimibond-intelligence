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

## Categorization (llenado en Task 3)

| Object | Type | Kind | Frontend callers | DB deps | Decision | Gate |
|---|---|---|---|---|---|---|
_(populated in Tasks 1-3)_

---

## Drops ejecutados

_(populated in Tasks 4-8)_

---

## Después

_(populated in Task 9)_
