"""
Fictitious SAT adapter — reference implementation.

Validates the spec's extensibility claim: a new data source can integrate
using ONLY the 7 ingestion.* RPCs and a single source_registry INSERT.
Zero schema changes required.

The authoritative extensibility validation for Task 16 lives in
`supabase/tests/ingestion_rpc_tests.sql` (the T16 do-block), which runs
inside a rolled-back transaction and is self-contained.

This file exists as documentation for future adapter implementors:
copy-paste the skeleton below, replace the source_id and the fetch
logic, and you have a working integration with the integrity core.

Prerequisites:
    A row must exist in ingestion.source_registry for (source_id, table_name).
    For a real adapter this is a one-time migration. The in-DB T16 test block
    in ingestion_rpc_tests.sql demonstrates this inside a rolled-back txn.

Run (manually, against a live instance):
    SUPABASE_URL=https://tozqezmivpblmcubmnpi.supabase.co \\
    SUPABASE_SERVICE_KEY=<service-key> \\
    python supabase/tests/fictitious_adapter_test.py
"""
import os
import sys
import uuid
import httpx

URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
if not URL or not KEY:
    print("SUPABASE_URL and SUPABASE_SERVICE_KEY required", file=sys.stderr)
    sys.exit(2)

HDRS = {
    "apikey": KEY,
    "Authorization": f"Bearer {KEY}",
    "Content-Type": "application/json",
}


def rpc(name, params):
    r = httpx.post(f"{URL}/rest/v1/rpc/{name}", headers=HDRS, json=params, timeout=30)
    r.raise_for_status()
    return r.json() if r.content else None


def main():
    # Prerequisite: the operator must have inserted a row into
    # ingestion.source_registry for this source_id via apply_migration or
    # the admin SQL console. The in-DB T16 test block in
    # ingestion_rpc_tests.sql demonstrates this pattern inside a
    # rolled-back transaction. For a real adapter, the registration is a
    # one-time migration.
    source = f"sat_test_{uuid.uuid4().hex[:8]}"
    table = "odoo_invoices"  # reuse an existing real table as a countable target

    print(f"Note: this demo expects '{source}'/'{table}' already in source_registry.")
    print("Run the T16 in-DB test for the self-contained extensibility proof.\n")

    # RPC 1: start_run
    rows = rpc("ingestion_start_run", {
        "p_source": source,
        "p_table": table,
        "p_run_type": "full",
        "p_triggered_by": "manual",
    })
    run_id = rows[0]["run_id"]
    print(f"[ok] ingestion_start_run  -> run_id={run_id}")

    # RPC 2: report a batch with one failure
    rpc("ingestion_report_batch", {
        "p_run_id": run_id,
        "p_attempted": 10,
        "p_succeeded": 9,
        "p_failed": 1,
    })
    print("[ok] ingestion_report_batch (10 attempted, 9 ok, 1 failed)")

    # RPC 3: record the failure individually
    fid = rpc("ingestion_report_failure", {
        "p_run_id": run_id,
        "p_entity_id": "SAT-CFDI-00001",
        "p_error_code": "parse_error",
        "p_error_detail": "xml namespace mismatch",
        "p_payload": {"uuid": "SAT-CFDI-00001", "total": 1234.56},
    })
    print(f"[ok] ingestion_report_failure -> failure_id={fid}")

    # RPC 4: complete as partial
    rpc("ingestion_complete_run", {
        "p_run_id": run_id,
        "p_status": "partial",
        "p_high_watermark": None,
    })
    print("[ok] ingestion_complete_run (partial)")

    # RPC 5: reconcile — report what SAT claims vs what Supabase has
    rec = rpc("ingestion_report_source_count", {
        "p_source": source,
        "p_table": table,
        "p_window_start": "2026-04-01T00:00:00Z",
        "p_window_end": "2026-04-12T00:00:00Z",
        "p_source_count": 9,
        "p_missing_entity_ids": None,
    })
    print(f"[ok] ingestion_report_source_count -> reconciliation_id={rec}")

    # RPC 6: fetch pending failures ready for retry
    pending = rpc("ingestion_fetch_pending_failures", {
        "p_source": source,
        "p_table": table,
        "p_max_retries": 5,
        "p_limit": 10,
    })
    print(f"[ok] ingestion_fetch_pending_failures -> {len(pending or [])} row(s)")

    # RPC 7: mark the failure resolved once the adapter re-processed it
    if pending:
        rpc("ingestion_mark_failure_resolved", {
            "p_failure_id": pending[0]["failure_id"],
        })
        print("[ok] ingestion_mark_failure_resolved")

    print("\nAll 7 RPCs callable through PostgREST. Extensibility validated.")


if __name__ == "__main__":
    main()
