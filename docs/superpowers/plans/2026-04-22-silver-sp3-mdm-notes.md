# Silver SP3 MDM — Implementation Notes

**Plan:** `2026-04-22-silver-sp3-mdm.md`
**Branch:** `silver-sp3-mdm` (from `fd62141`)
**Started:** 2026-04-22

---

## Task 0 — Baseline + Branch + Pre-check

### Step 1: Branch

```
git checkout -b silver-sp3-mdm  # from fd62141
git push -u origin silver-sp3-mdm
```

Branch pushed successfully at `fd62141`.

### Step 2: Asset Verification

| Check | Expected | Actual | Pass? |
|---|---|---|---|
| pg_trgm_installed | true | true | YES |
| cc_exists (canonical_companies) | false | false | YES (SP3 creates) |
| cct_exists (canonical_contacts) | false | false | YES (SP3 creates) |
| cp_exists (canonical_products) | false | false | YES (SP3 creates) |
| sl_exists (source_links) | false | false | YES (SP3 creates) |
| st_exists (syntage_taxpayers) | true | true | YES |
| sil_exists (syntage_invoice_line_items) | true | true | YES |
| entities_entity_type_col | true | true | YES |

**Decision gate: ALL PASS. Proceed.**

### Step 3: Baselines (captured 2026-04-22)

| Metric | Expected | Actual |
|---|---|---|
| canonical_invoices (ci) | 88443 | 88462 |
| ci_unresolved_receptor | ~61264 | 61264 |
| ci_unresolved_emisor | — | 61264 |
| canonical_payments (cp) | 43374 | 43377 |
| canonical_credit_notes (ccn) | 2207 | 2208 |
| canonical_tax_events (cte) | 398 | 398 |
| companies | 2197 | 2197 |
| companies_distinct_rfcs | — | 1287 |
| contacts | 2037 | 2037 |
| odoo_employees | — | 164 |
| odoo_users | — | 40 |
| odoo_products | — | 7222 |
| products_fiscal_map | — | 20 |
| entities | 9385 | 9394 |
| distinct_emisor_rfcs (syntage) | — | 1854 |
| distinct_receptor_rfcs (syntage) | — | 2012 |
| mdm_manual_overrides (mmo) | 20 | 20 |
| active_invariants | 16 | 16 |
| active_crons (silver_*) | 3 | 3 |

Notes on deltas vs expected:
- ci=88462 vs 88443: +19 invoices since plan was written (normal Odoo sync).
- cp=43377 vs 43374: +3 payments (normal).
- ccn=2208 vs 2207: +1 credit note (normal).
- entities=9394 vs 9385: +9 (normal).
- All critical values match or exceed expected within normal variance.

### Step 4: entities column schema

| column_name | data_type |
|---|---|
| id | bigint |
| entity_type | text |
| canonical_name | text |
| name | text |
| email | text |
| odoo_model | text |
| odoo_id | integer |
| attributes | jsonb |
| mention_count | integer |
| first_seen | timestamp with time zone |
| last_seen | timestamp with time zone |
| created_at | timestamp with time zone |
| updated_at | timestamp with time zone |

### syntage_taxpayers column schema

| column_name | data_type |
|---|---|
| rfc | text |
| person_type | text |
| name | text |
| registration_date | date |
| raw_payload | jsonb |
| created_at | timestamp with time zone |
| updated_at | timestamp with time zone |

Notes:
- `entities` has `entity_type` (text, no FK). SP3 will add `canonical_company_id`, `canonical_contact_id`, `canonical_product_id` FK columns.
- `syntage_taxpayers` keyed on `rfc`. Has `person_type` (fisica/moral) — useful for canonical_companies.entity_category.
- No `canonical_name` equivalent in syntage_taxpayers — use `name` directly.

### Step 5: entity_type distribution

| entity_type | count |
|---|---|
| person | 4075 |
| company | 3627 |
| product | 1661 |
| machine | 19 |
| raw_material | 11 |
| location | 1 |
| **TOTAL** | **9394** |

Notes:
- 3627 entity companies vs 2197 in companies table — entities includes non-Odoo parties (e.g. SAT-only counterparties).
- 4075 persons vs 2037 contacts — similar gap.
- machine/raw_material/location are minor categories, not targeted by SP3 MDM.

### Step 7: Baseline migration

Applied: `20260423_sp3_00_baseline` via `apply_migration`.
Registered in `audit_runs` with label `sp3-baseline-YYYYMMDD-HHmmss`.
Registered in `schema_changes`.

---

## Gate Approvals (filled after each task)

| Task | Gate | Status | Date |
|---|---|---|---|
| Task 2 | canonical_companies created, pg_trgm indexes OK | — | — |
| Task 3 | canonical_contacts created | — | — |
| Task 5 | canonical_products created | — | — |
| Task 8 | source_links created + backfill by RFC | — | — |
| Task 12 | RFC resolution: ci_unresolved_receptor reduced by ≥50% | — | — |
| Task 19 | canonical_* linked to entities | — | — |
| Task 20 | invariants pass post-SP3 | — | — |
| Task 21 | crons updated, silver_mdm_* jobs active | — | — |

---

## Concerns / Gotchas

- `ci_unresolved_emisor = 61264` same as receptor — means both emisor_company_id AND receptor_company_id are NULL for most SAT records. This is expected for historical records without Odoo counterparts.
- `entities.entity_type` is plain text with no constraint — SP3 should not add FK to canonical tables, just nullable columns.
- `syntage_taxpayers` has no `email` or `address` — RFC match is the primary key for linking.
- `companies_distinct_rfcs = 1287` vs `distinct_emisor_rfcs = 1854` — ~567 SAT emisores not yet in companies table. Primary opportunity for SP3 MDM canonical_companies population.
- `distinct_receptor_rfcs = 2012` — receptores even broader.

---

## Task logs

### Task 1
Completed 2026-04-20. DDL applied. 81 columns, 11 indexes (PK + uq_cc_canonical_name + 9 user-defined including gin_trgm), 2 generated cols (is_sat_counterparty, blacklist_action). Smoke test: 1 row inserted with rfc='XAXX010101000', is_sat_counterparty=true, blacklist_action=null — all correct. Rollback: DROP TABLE IF EXISTS canonical_companies CASCADE.

---

## Commit History

| SHA | Message |
|---|---|
| fd62141 | Merge PR #45 silver-sp2-cat-a (branch base) |
| (pending) | chore(sp3): baseline + branch + notes skeleton |
| (pending) | feat(sp3): canonical_companies DDL + indexes + trigram |
