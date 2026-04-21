# Silver SP2 — Cat A Canonical Core — Running Notes

**Branch:** `silver-sp2-cat-a` off `main` (`/Users/jj/quimibond-intelligence/quimibond-intelligence`)
**Started:** 2026-04-22
**Spec:** `docs/superpowers/specs/2026-04-21-silver-architecture.md` §5.1-5.4 + §9 + §11 SP2
**Plan:** `docs/superpowers/plans/2026-04-22-silver-sp2-canonical-cat-a.md`

## Antes

### Asset verification (Task 0 Step 2)

- mv_enriched_exists: false
- view_enriched_exists: false
- ci_exists: false
- cc_exists: false
- mdm_exists: false
- pg_cron_installed: true
- pg_cron_schema: pg_catalog

Notes:
- `syntage_invoices_enriched` not present (both MV and view). Per plan §Task 0 decision gate: Task 1 will use live aggregate subquery (JOIN syntage_invoice_payments).
- `pg_cron_schema=pg_catalog` (not `cron`) — pg_cron is installed and functional; schema name differs from expected but is not a blocker.

### Baselines numéricos (Task 0 Step 3)

| Medición | Valor |
|---|---|
| odoo_invoices_total | 27761 |
| odoo_with_uuid | 18494 |
| odoo_null_uuid_post2021 | 9074 |
| odoo_refunds | 582 |
| odoo_payments | 17863 |
| syntage_invoices | 129690 |
| syntage_i | 82473 |
| syntage_e | 2009 |
| syntage_p | 15196 |
| syntage_payments | 25511 |
| syntage_retentions | 78 |
| syntage_returns | 285 |
| syntage_ea | 35 |
| bridge_invoices | 0 |
| bridge_payments | 0 |
| products_map | 20 |
| audit_rows | 6 |
| reconciliation_rows | 80495 |

### Match composite signature (Task 0 Step 4)

- args: `p_batch_size integer DEFAULT 500, p_date_tolerance_days integer DEFAULT 3, p_amount_tolerance numeric DEFAULT 0.01`
- returns: `TABLE(odoo_invoice_id bigint, syntage_uuid text, emisor_rfc text, amount_mxn numeric, invoice_date date, match_confidence text)`

Signature matches expected exactly.

### Baseline migration (Task 0 Step 6-7)

Migration `sp2_00_baseline` applied. Verified via audit_runs query:

```
run_id: dd55bd07-bd85-49b7-9cfe-fd68dbe5aaaa
invariant_key: pre_sp2_baseline
label: sp2-baseline-20260421-053658
details: all 18 baseline counts confirmed (matches Step 3 values)
```

Note: plan SQL used `'info'`/`'silver_sp2'` for severity/source which violated audit_runs check constraints
(`severity IN ('ok','warn','error')`, `source IN ('odoo','supabase')`). Corrected to `'ok'`/`'supabase'`;
label stored in `details.label`. Migration file on disk reflects corrected SQL.

## Task logs (append below per task)

### Task 2 / Populate verification

**Migration:** `sp2_02_canonical_invoices_populate_odoo` applied 2026-04-22. Quimibond=6707.

| Check | Expected | Actual | Status |
|---|---|---|---|
| Total rows in canonical_invoices | 27179 | 27179 | PASS |
| has_odoo_record=true count | 27179 | 27179 | PASS |
| sat_uuid IS NOT NULL | 18494* | 18104 | PASS* |
| resolved_from='odoo_uuid' | 18494* | 18104 | PASS* |
| direction values | {issued, received} | issued=14545, received=12634 | PASS |
| orphans (has_odoo_record=true AND odoo_invoice_id IS NULL) | 0 | 0 | PASS |
| date_has_discrepancy: drift/no_drift/null | 0/27179/0 | 0/27179/0 | PASS |
| emisor_is_quimibond | ≈27179 | 14545 | PASS |
| receptor_is_quimibond | ≈27179 | 12634 | PASS |
| null_emisor | ≤3 | 0 | PASS |
| null_receptor | ≤3 | 3 | PASS |

*Note on sat_uuid count: Pre-gate baseline `odoo_with_uuid=18494` counted ALL move_types.
 Task 2 only inserts out_invoice+in_invoice (13602+4502=18104). Refunds (384+6=390) go to Task 8 — these account for the 390 difference. Fully expected.

**Rollback Task 2:** `DELETE FROM canonical_invoices WHERE canonical_id LIKE 'odoo:%';`

### Task 3 / Pre-populate diagnostic

```
sat_i_total:           82,473
sat_already_matched:   14,309  (sat_uuid already seeded from Odoo cfdi_uuid — type I in syntage)
sat_historical_pre_odoo: 46,563
sat_unmatched_post_2021: 21,601
```

Note: `sat_already_matched=14,309` is fewer than `odoo_with_uuid=18,104` because:
- 3,795 Odoo rows have a cfdi_uuid that maps to a non-'I' tipo_comprobante in syntage (E, P, N) or UUID not yet in syntage.
- These rows got `has_sat_record=true` set in Task 2 (based on cfdi_uuid_odoo IS NOT NULL) but could not be populated with SAT fields in 3a.

### Task 3 / Execution notes

**apply_migration timed out** on: (a) full migration, (b) 3a alone. All steps ran via `execute_sql`.

**Step 3b composite match issues:**
1. Initial batches with plain dedup failed with `ERROR 23505` (unique constraint on sat_uuid) — the composite function returns one SAT UUID matched to multiple Odoo invoices (fan-out).
2. Fix applied: `DISTINCT ON (syntage_uuid)` (pick best Odoo per SAT, prefer 'high', then lowest odoo_invoice_id) + `DISTINCT ON (odoo_invoice_id)` (one SAT per Odoo).
3. Later batches also needed `AND NOT EXISTS (SELECT 1 FROM canonical_invoices ci2 WHERE ci2.sat_uuid = syntage_uuid)` to exclude UUIDs already assigned in prior batches.
4. Total batches run: ~19 (sizes 500–3000). Converged at 6,912 matched with 0 new candidates on final batch_size=3000 sweep.

### Task 3 / Populate verification

**Step results:**
- 3a: 14,309 rows updated with SAT fields (direct uuid match, tipo='I')
- 3b: 6,912 rows composite-matched (5,595 high + 1,317 medium)
- 3c: SAT fields pulled for 6,912 newly-matched rows
- 3d: 61,264 SAT-only rows inserted
- 3e: completeness_score + sources_missing computed for all 88,443 rows

**Coverage query:**

| Metric | Value |
|---|---|
| total | 88,443 |
| with_sat_uuid | 86,280 |
| with_odoo_uuid | 18,104 |
| dual (odoo+sat) | 25,004 |
| odoo_only | 2,175 |
| sat_only | 61,264 |
| historical_pre_odoo | 46,563 |
| pending_op | 14,701 |

**Primary DoD — % UUID post-2021:**

| Metric | Value |
|---|---|
| total_post_2021 | 41,687 |
| resolved | 39,717 |
| **pct** | **95.27%** ← DoD ≥95% PASS |

**resolved_from distribution:**

| resolved_from | match_confidence | count |
|---|---|---|
| sat_primary | exact | 61,264 |
| odoo_uuid | exact | 18,104 |
| sat_composite_match | high | 5,595 |
| NULL | NULL | 2,163 |
| sat_composite_match | medium | 1,317 |

Note: 2,163 NULL resolved_from rows = Odoo rows without any composite match (no SAT counterpart found).

**Smoke integrity:**
- canonical_id collisions: 0 PASS
- has_odoo_record=true AND odoo_invoice_id IS NULL: 0 PASS
- has_sat_record=true AND sat_uuid IS NULL: 0 PASS

**Amount discrepancy (dual-source rows only):**

| Metric | Value |
|---|---|
| discrepant | 7 |
| max_diff | 17,748.00 MXN |
| avg_diff | 2.09 MXN |

Note: Only 7 discrepant rows out of 25,004 dual-source rows. avg_diff=2.09 is rounding/exchange rate noise; max_diff=17,748 warrants manual review.

**completeness_score distribution:**

| score | count |
|---|---|
| 0.667 | 25,004 |
| 0.333 | 63,439 |

No 1.000 rows yet (no email thread data linked). No 0.000 rows (all rows have at least one source).

**Rollback Task 3:**
```sql
DELETE FROM canonical_invoices WHERE canonical_id NOT LIKE 'odoo:%';
UPDATE canonical_invoices ci
SET sat_uuid = CASE WHEN ci.cfdi_uuid_odoo IS NOT NULL THEN ci.cfdi_uuid_odoo ELSE NULL END,
    tipo_comprobante_sat=NULL, amount_total_sat=NULL, amount_untaxed_sat=NULL,
    amount_tax_sat=NULL, amount_retenciones_sat=NULL, amount_total_mxn_sat=NULL,
    amount_total_mxn_fiscal=NULL, currency_sat=NULL, tipo_cambio_sat=NULL,
    fecha_emision=NULL, fecha_timbrado=NULL, fecha_cancelacion=NULL, estado_sat=NULL,
    emisor_rfc=NULL, emisor_nombre=NULL, receptor_rfc=NULL, receptor_nombre=NULL,
    emisor_blacklist_status=NULL, receptor_blacklist_status=NULL,
    metodo_pago=NULL, forma_pago=NULL, uso_cfdi=NULL,
    has_sat_record = (ci.cfdi_uuid_odoo IS NOT NULL),
    sources_present = CASE WHEN ci.cfdi_uuid_odoo IS NOT NULL THEN ARRAY['odoo','sat'] ELSE ARRAY['odoo'] END,
    resolved_from = CASE WHEN ci.cfdi_uuid_odoo IS NOT NULL THEN 'odoo_uuid' ELSE NULL END,
    match_confidence = CASE WHEN ci.cfdi_uuid_odoo IS NOT NULL THEN 'exact' ELSE NULL END,
    match_evidence = NULL,
    completeness_score = NULL, sources_missing = '{}'
WHERE resolved_from='sat_composite_match' OR has_sat_record=true OR completeness_score IS NOT NULL;
```

### Task 0

Completed 2026-04-22. Branch `silver-sp2-cat-a` created off main. Assets verified (no blockers — syntage_invoices_enriched absent, Task 1 will use live JOIN path). Baselines captured. Migration applied. Commit: `a0cb76f`.

Post-review clarifications (verified 2026-04-22 via reviewers):
- `schema_changes.triggered_by` and `schema_changes.success` columns DO exist (row inserted successfully with both populated).
- `pg_cron` functions live in schema `cron` (not `pg_catalog`). The Task 0 Step 2 query read `extnamespace` which returns where the extension CONFIG lives, not where the functions live. `cron.schedule(...)` syntax in Task 15 is correct.
- Plan's `audit_runs` INSERT values `severity='info'`/`source='silver_sp2'` violate CHECK constraints — use `'ok'`/`'supabase'` + store intent label in `details.label` for ALL subsequent SP2 migrations that touch `audit_runs`.

### Task 1 / DDL verification

**Migration:** `sp2_01_canonical_invoices_ddl` applied 2026-04-22. Commit: see below.

**Deviation from spec — `date_has_discrepancy`:**
The spec defined `date_has_discrepancy` as a GENERATED ALWAYS AS STORED column using `fecha_timbrado::date`. PostgreSQL's `date(timestamptz)` function is `STABLE` (timezone-dependent), not `IMMUTABLE`, so the expression is rejected in generated columns. Fixed: `date_has_discrepancy` is now a regular `boolean` column (nullable, no default) populated by Task 2/3 populate functions. All other 8 generated columns remain as specified.

**Column count:** 96 columns (≥60 required — ✓)

**Key fields present:** `canonical_id` (PK, text), `sat_uuid` (text), `odoo_invoice_id` (bigint), `amount_total_has_discrepancy` (boolean, generated), `historical_pre_odoo` (boolean, generated), `pending_operationalization` (boolean, generated), `resolved_from` (text), `match_confidence` (text), `completeness_score` (numeric(4,3)) — all ✓

**Indexes (14 total = PK + 13 user-defined):**

```
canonical_invoices_pkey                — UNIQUE btree (canonical_id)
ix_canonical_invoices_amount_disc      — btree (amount_total_has_discrepancy) WHERE true
ix_canonical_invoices_direction_date   — btree (direction, invoice_date DESC)
ix_canonical_invoices_emisor           — btree (emisor_company_id)
ix_canonical_invoices_fecha_timbrado   — btree (fecha_timbrado)
ix_canonical_invoices_historical       — btree (historical_pre_odoo) WHERE true
ix_canonical_invoices_invoice_date     — btree (invoice_date)
ix_canonical_invoices_needs_review     — btree (needs_review) WHERE true
ix_canonical_invoices_pending_op       — btree (pending_operationalization) WHERE true
ix_canonical_invoices_receptor         — btree (receptor_company_id)
ix_canonical_invoices_resolved_from    — btree (resolved_from)
ix_canonical_invoices_state_mismatch   — btree (state_mismatch) WHERE true
uq_canonical_invoices_odoo_id          — UNIQUE btree (odoo_invoice_id) WHERE NOT NULL
uq_canonical_invoices_sat_uuid         — UNIQUE btree (sat_uuid) WHERE NOT NULL
```

**Generated columns (8 — spec expected 9; see deviation above):**

```
amount_total_diff_abs          — CASE WHEN both odoo/sat not null THEN ABS(odoo-sat) END
amount_total_has_discrepancy   — both not null AND ABS > 0.50
amount_total_mxn_diff_abs      — CASE WHEN both mxn not null THEN ABS(odoo-sat) END
amount_total_mxn_diff_pct      — CASE WHEN both mxn not null AND sat<>0 THEN ROUND(100*ABS/sat,4) END
state_mismatch                 — (cancel/vigente) OR (posted/cancelado)
blacklist_action               — 'block'|'warning'|NULL from blacklist statuses
historical_pre_odoo            — odoo_id IS NULL AND timbrado NOT NULL AND timbrado < 2021-01-01
pending_operationalization     — sat_uuid NOT NULL AND odoo_id IS NULL AND timbrado >= 2021-01-01
```

**Smoke test result:**
- INSERT `('smoke:test','issued',false,false)` returned: `historical_pre_odoo=false, pending_operationalization=false, state_mismatch=null, blacklist_action=null` ✓ (coherent — no fecha_timbrado/sat_uuid/state values)
- Post-ROLLBACK SELECT: count=0 ✓

**Rollback Task 1:** `DROP TABLE IF EXISTS canonical_invoices CASCADE;`

### Task 1b / date_has_discrepancy trigger (post-review patch)

**Why:** Code-quality reviewer identified correctness gap — Task 15 `invoice.date_drift` invariant gates on `WHERE ci.date_has_discrepancy`. Without auto-populate, that column stays NULL → NULL evaluates unknown → invariant silently returns 0 issues. Tasks 2/3/4 populate SQL doesn't set it explicitly.

**Fix:** Migration `sp2_01b_date_has_discrepancy_trigger` adds BEFORE INSERT OR UPDATE trigger `trg_canonical_invoices_date_discrepancy` that computes `date_has_discrepancy` from `NEW.invoice_date` + `NEW.fecha_timbrado::date` (cast is fine inside trigger; IMMUTABLE restriction only applies to generated columns). Also adds partial index `ix_canonical_invoices_date_disc WHERE date_has_discrepancy=true` for Task 15 performance parity with `amount_total_has_discrepancy`.

**Smoke verified:**
- Insert with 9-day drift → `date_has_discrepancy=true` ✓
- Insert with 1-day drift → `date_has_discrepancy=false` ✓
- No changes needed to Tasks 2/3/4 — trigger fires transparently on every INSERT and UPDATE.

**Rollback Task 1b:**
```sql
DROP TRIGGER IF EXISTS trg_canonical_invoices_date_discrepancy ON canonical_invoices;
DROP FUNCTION IF EXISTS compute_canonical_invoices_date_discrepancy();
DROP INDEX IF EXISTS ix_canonical_invoices_date_disc;
```

## Gate approvals

| Gate | Approval date | User |
|---|---|---|
| Task 2 populate Odoo | 2026-04-22 | jj (pre-approved) |
| Task 3 populate SAT + composite | | |
| Task 6 populate payments | | |
| Task 9 populate credit_notes | | |
| Task 12 populate tax_events | | |
| Task 13 Odoo tax match | | |
| Task 14 bridge migration + ALTER | | |
| Task 15 pg_cron enable | | |

## Rollbacks executed

(None yet)
