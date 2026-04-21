# Silver SP4 — Execution Notes

Running log of findings per task. Append one section per completed task.

## Task 1 — Pre-flight (completed 2026-04-24)

- Baseline `audit_runs` row inserted with `details->>'label' = 'pre_sp4_baseline'`.
- Branch cut from main @ 8f3c620 (post-SP3 merge).
- migrations dir verified writable.

### Verified baseline counts (from audit_runs row, run_at 2026-04-21 19:41:09 UTC)

| Metric | Value |
|---|---|
| canonical_invoices | 88,462 |
| canonical_invoices_with_mxn_resolved | 0 |
| reconciliation_issues_open | 103,401 |
| canonical_payments | 43,380 |
| canonical_companies | 4,359 |
| source_links | 172,285 |
| facts | 31,830 |

Matches plan expectations: invoices=88462 ✓, mxn_resolved=0 ✓, open_issues≈103400 ✓.
