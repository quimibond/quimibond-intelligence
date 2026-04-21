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

## Gate approvals

| Gate | Approval date | User |
|---|---|---|
| Task 2 populate Odoo | | |
| Task 3 populate SAT + composite | | |
| Task 6 populate payments | | |
| Task 9 populate credit_notes | | |
| Task 12 populate tax_events | | |
| Task 13 Odoo tax match | | |
| Task 14 bridge migration + ALTER | | |
| Task 15 pg_cron enable | | |

## Rollbacks executed

(None yet)
