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

### Task 2
Completed 2026-04-20. See "Task 2 / Quimibond canonical_companies.id" section above. Migration: `20260423_sp3_02_canonical_companies_populate_odoo`. 2,197 rows inserted, 0 dropped (no canonical_name dupes). Quimibond canonical_companies.id=868. Retroactive metrics populated (invoices_count>0 for 881 companies, max_ltv=404k MXN).

---

## Task 2 / Quimibond canonical_company_id

### ### Task 2 / Quimibond canonical_companies.id

**CRITICAL for Tasks 19-20 downstream:**

```
canonical_companies.id = 868
canonical_name         = "productora de no tejidos quimibond"
display_name           = "PRODUCTORA DE NO TEJIDOS QUIMIBOND"
rfc                    = "PNT920218IW5"
is_internal            = true
```

### Task 2 log (2026-04-20)

**Dry-run preview:**
- companies total=2,197 | with_rfc=1,375 | with_odoo_id=2,197 | customers=1,653 | suppliers=603 | quimibond_present=1
- distinct canonical_names=2,197 (no duplicates — ON CONFLICT DO NOTHING drops 0 rows)
- canonical_invoices=88,462 | canonical_credit_notes=2,208

**Migration applied:** `20260423_sp3_02_canonical_companies_populate_odoo`

**Verification results:**

| Metric | Expected | Actual | Pass? |
|---|---|---|---|
| total rows | ~2,197 | 2,197 | YES |
| internal | 1 | 1 | YES |
| customers | 1,653 | 1,653 | YES |
| suppliers | 603 | 603 | YES |
| with_rfc | ~1,287 | 1,375 | YES (higher than plan estimate — plan said ~1287 but actual companies.rfc=1375) |
| with_odoo_id | 2,197 | 2,197 | YES |
| shadows_now | 0 | 0 | YES |

**Match method distribution:**

| match_method | conf | count |
|---|---|---|
| odoo_partner_id+rfc | 1.00 | 1,375 |
| odoo_partner_id | 0.99 | 822 |

Note: no rfc_exact-only or odoo_only rows because all companies.odoo_partner_id is populated (2,197/2,197).

**Metrics sanity:**

| Metric | Value |
|---|---|
| max_ltv | 404,322.80 MXN |
| with_ltv (lifetime_value_mxn > 0) | 7 |
| with_invoices (invoices_count > 0) | 881 |

Note on with_ltv=7: `lifetime_value_mxn` populated from `companies.lifetime_value` (base table, sparse). The retroactive UPDATE from `canonical_invoices` populated `invoices_count` for 881 companies — these have correct aggregated data. The `lifetime_value_mxn` field reflects what `companies` table had; the canonical aggregate path will keep it updated going forward.

**No duplicates dropped** — all 2,197 canonical_names were distinct.

---

## Gate Approvals (filled after each task)

| Task | Gate | Status | Date |
|---|---|---|---|
| Task 1 | canonical_companies DDL created, pg_trgm indexes OK | PASS | 2026-04-20 |
| Task 2 | canonical_companies populated (2,197 rows), Quimibond id=868 | PASS | 2026-04-20 |
| Task 3 | shadows=2,162, still_unmatched=0, blacklisted=8 | PASS | 2026-04-20 |
| Task 5 | canonical_products created | — | — |
| Task 8 | source_links created + backfill by RFC | — | — |
| Task 12 | RFC resolution: ci_unresolved_receptor reduced by ≥50% | — | — |
| Task 19 | canonical_* linked to entities | — | — |
| Task 20 | invariants pass post-SP3 | — | — |
| Task 21 | crons updated, silver_mdm_* jobs active | — | — |

---

## Commit History

| SHA | Message |
|---|---|
| fd62141 | Merge PR #45 silver-sp2-cat-a (branch base) |
| 810a7ae | chore(sp3): baseline + branch + notes skeleton |
| e89f066 | feat(sp3): canonical_companies DDL + indexes + trigram |
| 48eef01 | feat(sp3): populate canonical_companies from Odoo + aggregated metrics |
| (pending) | feat(sp3): shadow canonical_companies for SAT-only RFCs + blacklist aggregate |

---

## Task 3 — Shadow canonical_companies + Blacklist aggregate

### Pre-gate diagnostic (2026-04-20)

| Metric | Value |
|---|---|
| sat_rfcs_total | 3,357 |
| already_matched | 1,195 |
| need_shadow | 2,162 |

Note: `need_shadow=2162` is above the 500-2000 estimate in the plan. Still within reason — reflects the breadth of SAT counterparties Quimibond has transacted with.

### Migrations applied

1. `20260423_sp3_03_canonical_companies_shadows` — main INSERT (2,058 rows) + blacklist UPDATE
2. `20260423_sp3_03b_canonical_companies_shadows_fix104` — supplemental INSERT for 104 RFC-variant shadows skipped by `ON CONFLICT (canonical_name) DO NOTHING`

### Why 104 rows needed a fix

The main INSERT uses `LOWER(COALESCE(nombre, rfc))` as `canonical_name`. 104 SAT RFCs share a display name with an already-inserted shadow (RFC typo variants — same person/company, different RFC). Examples:
- `PARB510616P90` vs `PARB510615B90` → both map to "beatriz maria del carmen patiño rodriguez"
- `CTE8404129SA` vs `CTE84041295A` → both map to "cobian textil, s.a. de c.v."
- `DOML6611181FS`, `DOML661118IF3`, `DOML661118OF5`, `DOML6611121FS` → 4 RFC variants of "luis dominguez martinez"

Fix: use `LOWER(nombre || ' [' || rfc || ']')` as `canonical_name` for the 104, preserving original `display_name`. These are tagged with `review_reason = ARRAY['sat_only_shadow','rfc_variant_name_conflict']` so MDM review can decide if they are truly distinct entities or should be merged.

### Verification results (post-fix)

| Metric | Expected | Actual | Pass? |
|---|---|---|---|
| total canonical_companies | 2197 + 2162 = 4359 | 4,359 | YES |
| shadows | 2,162 | 2,162 | YES |
| still_unmatched | 0 | 0 | YES |
| blacklisted (presumed + definitive) | variable | 8 | YES |

### Coverage verification

| Metric | Value |
|---|---|
| distinct_receptors in canonical_invoices | 1,540 |
| distinct_emisors in canonical_invoices | 1,842 |
| cc_with_rfc (canonical_companies) | 3,433 |
| still_unmatched | 0 |

### Blacklist distribution

| Level | Count |
|---|---|
| definitive | 5 |
| presumed | 3 |

Total blacklisted companies: 8

### Blacklisted shadows (top 6, ordered by last_flagged_at DESC)

| canonical_name | rfc | level | cfdis_flagged | last_flagged |
|---|---|---|---|---|
| oublier sa de cv | OUB141001CN9 | presumed | 40 | 2021-10-15 |
| distribuidora y comercializadora ableon | DCA1703073A3 | definitive | 2 | 2018-09-28 |
| operaciones internacionales napnet | OIN140605828 | definitive | 1 | 2016-09-20 |
| maxumus distribuidor, s.a. de c.v. | MDI1311214D0 | definitive | 18 | 2015-02-26 |
| producciones sasa, s.a. de c.v. | PSA080624R16 | definitive | 16 | 2014-09-23 |
| manufacturas aken, s.a. de c.v. | MAK101125861 | definitive | 1 | 2014-03-27 |

Note: all blacklisted shadows are historical (last_flagged 2014-2021). Most active blacklist flag is "oublier sa de cv" (OUB141001CN9, presumed, 40 CFDIs, last 2021). This company appears on SAT's EFO presumed list and should trigger a compliance review.

### Rollback plan

```sql
DELETE FROM canonical_companies WHERE has_shadow_flag = true;
```

---

## Task 4 — canonical_contacts DDL

**Completed:** 2026-04-20
**Migration:** `20260423_sp3_04_canonical_contacts_ddl`

### Verification results

| Metric | Expected | Actual | Pass? |
|---|---|---|---|
| column_count | ~42 | 47 | YES (47 incl. id, created_at, updated_at, review_reason, etc.) |
| index_count (PK + user) | 9 | 9 | YES |
| trigram index (gin_trgm_ops) | 1 | 1 (ix_cct_name_trgm) | YES |
| unique email (case-insensitive) | enforced | enforced | YES |
| self-referential FK (manager) | present | present | YES |
| FK to canonical_companies | present | present | YES |
| updated_at trigger | active | active | YES |

### Index list

| Index | Type | Notes |
|---|---|---|
| canonical_contacts_pkey | btree UNIQUE | PK on id |
| uq_cct_primary_email | btree UNIQUE | LOWER(primary_email) — case-insensitive |
| ix_cct_company | btree | canonical_company_id |
| ix_cct_contact_type | btree | contact_type |
| ix_cct_odoo_employee | btree partial | odoo_employee_id WHERE NOT NULL |
| ix_cct_odoo_user | btree partial | odoo_user_id WHERE NOT NULL |
| ix_cct_manual_override | btree partial | has_manual_override WHERE true |
| ix_cct_needs_review | btree partial | needs_review WHERE true |
| ix_cct_name_trgm | GIN | canonical_name gin_trgm_ops |

### Smoke test

Inserted row with `primary_email='SMOKE@example.com'` — success. Second insert with `primary_email='smoke@example.com'` raised `unique_violation` as expected (case-insensitive UNIQUE enforced via `LOWER(primary_email)` index). Row cleaned up. **PASS.**

### Gate approval

| Task | Gate | Status | Date |
|---|---|---|---|
| Task 4 | canonical_contacts DDL, 47 cols, 9 indexes, UNIQUE enforced | PASS | 2026-04-20 |
| Task 5 | canonical_contacts populated: 2,063 rows, 0 duplicates | PASS | 2026-04-20 |

---

## Task 5 — Populate canonical_contacts

### Pre-gate diagnostic

| Metric | Value |
|---|---|
| users_with_email | 40 |
| employees_with_email | 150 |
| contacts_with_email | 2,037 |
| distinct_emails_total | 2,063 |

### ON CONFLICT syntax

Used expression form `ON CONFLICT ((LOWER(primary_email)))` — applied without error. No fallback needed.

### Results

**contact_type breakdown:**

| contact_type | count |
|---|---|
| external_customer | 1,541 |
| external_supplier | 230 |
| internal_employee | 139 |
| external_unresolved | 113 |
| internal_user | 40 |
| **Total** | **2,063** |

**Summary counts:**

| Metric | Value |
|---|---|
| total | 2,063 |
| with_company | 1,808 |
| emp_and_user_merged | 11 |
| with_employee | 150 |
| with_user | 40 |

Notes:
- total = distinct_emails_total (2,063) — perfect dedup, no over-count
- 11 employees shared email with a user row (DO UPDATE merged employee data onto user row)
- 139 net-new `internal_employee` rows (150 employees − 11 merged)
- 1,808/1,884 external contacts resolved to a canonical_company (96%)

### Smoke test

```sql
SELECT LOWER(primary_email) AS lower_email, COUNT(*)
FROM canonical_contacts
GROUP BY LOWER(primary_email)
HAVING COUNT(*) > 1 LIMIT 5;
-- Result: 0 rows (PASS)
```

No duplicate emails. UNIQUE constraint fully enforced.

---

## SP3 Cierre (2026-04-23)

| DoD | Target | Actual | Status |
|---|---|---|---|
| canonical_companies total | ≥2,200 | 4,359 | PASS |
| canonical_companies shadows | ≥500 | 2,162 | PASS |
| canonical_contacts primary_email UNIQUE conflicts | 0 | 0 | PASS |
| canonical_products total | — | 6,004 | PASS |
| source_links active | >10,000 | 172,283 | PASS |
| canonical_invoices unresolved receptor (SAT) | 0 | 0 | PASS |
| canonical_invoices FKs validated | 3 | 3 | PASS |
| canonical_payments FK validated | 1 | 1 | PASS |
| canonical_credit_notes FKs validated | 2 | 2 | PASS |
| pg_cron silver_sp3_* | 1 | 1 | PASS |
| total cron jobs silver_* | 4 | 4 | PASS |

**Quimibond canonical_companies.id:** 868 (rfc=PNT920218IW5, is_internal=true)

**Branch commit history (silver-sp3-mdm):**
- 0f56c39 feat(sp3): pg_cron 2h matcher + Bronze auto-match triggers
- c278b42 feat(sp3): canonical_payments + canonical_credit_notes FK rename + backfill
- e106850 feat(sp3): canonical_invoices FK rename + backfill + matcher updates
- 08236ba feat(sp3): mdm_merge_companies + mdm_link_invoice + mdm_revoke_override
- b307376 feat(sp3): matcher_invoice_quick + matcher_all_pending
- 45a945f feat(sp3): matcher_contact + matcher_product
- 2ba6137 fix(sp3): matcher_company deterministic tie-break (prefer is_internal over shadow)
- 5742dbd feat(sp3): matcher_company + matcher_company_if_new_rfc
- 4476298 feat(sp3): extend mdm_manual_overrides per §6.4
- 0936e8a feat(sp3): source_links auto-insert triggers on canonical_*
- f0b9e0f feat(sp3): populate source_links retroactively (172k links)
- 22f96cd feat(sp3): source_links DDL
- 6a428c2 feat(sp3): canonical_employees view
- 436b6a7 feat(sp3): incremental trigger for canonical_products
- 03f0ee4 feat(sp3): populate canonical_products (+ fiscal_map + syntage aggregate)
- 04db277 feat(sp3): canonical_products DDL
- a2b4bba feat(sp3): incremental triggers for canonical_contacts
- 671151c feat(sp3): populate canonical_contacts from odoo_users+employees+contacts
- 1e071c3 feat(sp3): canonical_contacts DDL + trigram
- 928c900 feat(sp3): shadow canonical_companies for SAT-only RFCs + blacklist aggregate
- 48eef01 feat(sp3): populate canonical_companies from Odoo + aggregated metrics
- e89f066 feat(sp3): canonical_companies DDL + indexes + trigram
- 810a7ae chore(sp3): baseline + branch + notes skeleton
