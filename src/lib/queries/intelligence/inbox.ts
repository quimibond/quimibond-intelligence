import "server-only";
import { getServiceClient } from "@/lib/supabase-server";
import type { Database } from "@/lib/database.types";
import { computeDelta, type Comparison } from "@/lib/kpi";
import { parseCanonicalEntityId } from "./issue-entity-context";

export type InboxRow = Database["public"]["Views"]["gold_ceo_inbox"]["Row"];

/**
 * 2026-04-26: defensive stale-issue filter.
 *
 * Several silver invariants emit issues but never UPDATE/close them when
 * the underlying canonical entity later meets the resolved condition.
 * Audit found 22/22 `posted_without_uuid` and 20/25 `missing_sat_timbrado`
 * pointing to invoices that already have sat_uuid + has_sat_record=true.
 *
 * Until Silver SP6 fixes the invariant runtime, we filter these out at
 * read-time so the CEO never sees a critical alert that contradicts the
 * current data. The set of (invariant_key, resolved-condition) pairs
 * lives here — keep in sync with invariant-explainers.ts.
 */
const INVOICE_STALE_INVARIANTS = new Set([
  "invoice.posted_without_uuid",
  "invoice.missing_sat_timbrado",
]);

async function filterStaleInvoiceIssues(rows: InboxRow[]): Promise<InboxRow[]> {
  if (rows.length === 0) return rows;
  const idsToCheck = new Set<number>();
  for (const r of rows) {
    if (!r.invariant_key || !INVOICE_STALE_INVARIANTS.has(r.invariant_key)) continue;
    const ref = parseCanonicalEntityId(r.canonical_entity_id);
    if (ref?.source === "odoo") {
      const n = Number(ref.id);
      if (Number.isFinite(n)) idsToCheck.add(n);
    }
  }
  if (idsToCheck.size === 0) return rows;

  const sb = getServiceClient();
  const { data } = await sb
    .from("canonical_invoices")
    .select("odoo_invoice_id, sat_uuid, has_sat_record")
    .in("odoo_invoice_id", Array.from(idsToCheck));

  type Row = { odoo_invoice_id: number; sat_uuid: string | null; has_sat_record: boolean | null };
  const stale = new Set<number>();
  for (const row of (data ?? []) as Row[]) {
    if (row.sat_uuid != null || row.has_sat_record === true) {
      stale.add(row.odoo_invoice_id);
    }
  }

  return rows.filter((r) => {
    if (!r.invariant_key || !INVOICE_STALE_INVARIANTS.has(r.invariant_key)) return true;
    const ref = parseCanonicalEntityId(r.canonical_entity_id);
    if (ref?.source !== "odoo") return true;
    const n = Number(ref.id);
    return !stale.has(n);
  });
}

export interface ListInboxOptions {
  limit?: number;
  severity?: "critical" | "high" | "medium" | "low";
  canonicalEntityType?:
    | "invoice"
    | "payment"
    | "company"
    | "contact"
    | "product";
  assigneeCanonicalContactId?: number;
}

/**
 * List gold_ceo_inbox rows ordered by priority_score desc.
 * Backed by the SP4 gold view over reconciliation_issues.
 *
 * Stale-issue defensive filter (see filterStaleInvoiceIssues) is applied
 * after fetch. We over-fetch by 50% to keep the limit honest when the
 * filter removes rows.
 */
export async function listInbox(
  opts: ListInboxOptions = {}
): Promise<InboxRow[]> {
  const sb = getServiceClient();
  const limit = opts.limit ?? 50;
  const fetchLimit = Math.min(Math.ceil(limit * 1.5), 200);

  let q = sb
    .from("gold_ceo_inbox")
    .select("*")
    .order("priority_score", { ascending: false, nullsFirst: false });

  if (opts.severity) {
    q = q.eq("severity", opts.severity);
  }
  if (opts.canonicalEntityType) {
    q = q.eq("canonical_entity_type", opts.canonicalEntityType);
  }
  // assignee_canonical_contact_id confirmed on gold_ceo_inbox via pg_attribute
  if (typeof opts.assigneeCanonicalContactId === "number") {
    q = q.eq(
      "assignee_canonical_contact_id",
      opts.assigneeCanonicalContactId
    );
  }
  q = q.limit(fetchLimit);

  const { data, error } = await q;
  if (error) throw error;
  const rows = data ?? [];
  const filtered = await filterStaleInvoiceIssues(rows);
  return filtered.slice(0, limit);
}

/**
 * Fetch a single gold_ceo_inbox row by issue_id (UUID), plus evidence arrays
 * from email_signals, ai_extracted_facts, manual_notes, and attachments.
 * Evidence is correlated on canonical_entity_type + canonical_entity_id.
 */
export async function fetchInboxItem(issue_id: string) {
  const sb = getServiceClient();
  const { data: row, error } = await sb
    .from("gold_ceo_inbox")
    .select("*")
    .eq("issue_id", issue_id)
    .maybeSingle();

  if (error) throw error;
  if (!row) return null;

  const entityType = row.canonical_entity_type;
  const entityId = row.canonical_entity_id;

  if (!entityType || !entityId) {
    return {
      ...row,
      email_signals: [],
      ai_extracted_facts: [],
      manual_notes: [],
      attachments: [],
    };
  }

  const [
    { data: signals },
    { data: facts },
    { data: notes },
    { data: atts },
  ] = await Promise.all([
    sb
      .from("email_signals")
      .select("*")
      .eq("canonical_entity_type", entityType)
      .eq("canonical_entity_id", entityId)
      .limit(25),
    sb
      .from("ai_extracted_facts")
      .select("*")
      .eq("canonical_entity_type", entityType)
      .eq("canonical_entity_id", entityId)
      .limit(25),
    sb
      .from("manual_notes")
      .select("*")
      .eq("canonical_entity_type", entityType)
      .eq("canonical_entity_id", entityId)
      .order("created_at", { ascending: false })
      .limit(25),
    sb
      .from("attachments")
      .select("*")
      .eq("canonical_entity_type", entityType)
      .eq("canonical_entity_id", entityId)
      .limit(25),
  ]);

  return {
    ...row,
    email_signals: signals ?? [],
    ai_extracted_facts: facts ?? [],
    manual_notes: notes ?? [],
    attachments: atts ?? [],
  };
}

export interface InboxKpis {
  open: number;
  critical: number;
  closedThisWeek: number;
  avgResponseHours: number | null;
  openDelta: Comparison | null;
  avgResponseDelta: Comparison | null;
  asOfDate: string;
}

/**
 * SP13.6 — KPIs de contexto para la franja superior del /inbox.
 *
 *   open               — total no resuelto ahora
 *   critical           — subset de open con severity=critical
 *   closedThisWeek     — resolved_at >= hoy-7d
 *   avgResponseHours   — avg(resolved_at - detected_at) en issues cerrados
 *                        la última semana
 *
 * Cada métrica trae Comparison vs la semana previa para alimentar
 * ComparisonCell / KpiCard.comparison.
 */
export async function getInboxKpis(): Promise<InboxKpis> {
  const sb = getServiceClient();
  const now = new Date();
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const oneWeekAgo = new Date(now.getTime() - weekMs).toISOString();
  const twoWeeksAgo = new Date(now.getTime() - 2 * weekMs).toISOString();

  const [
    openNow,
    openWeekAgo,
    criticalNow,
    staleAdjustNow,
    staleAdjustCritical,
    closedThisWeek,
    closedPrevWeek,
    avgThisWeekRes,
    avgPrevWeekRes,
  ] = await Promise.all([
    sb
      .from("reconciliation_issues")
      .select("issue_id", { count: "exact", head: true })
      .is("resolved_at", null),
    sb
      .from("reconciliation_issues")
      .select("issue_id", { count: "exact", head: true })
      .lte("detected_at", oneWeekAgo)
      .or(`resolved_at.is.null,resolved_at.gte.${oneWeekAgo}`),
    sb
      .from("reconciliation_issues")
      .select("issue_id", { count: "exact", head: true })
      .is("resolved_at", null)
      .eq("severity", "critical"),
    // Count of stale-but-still-open invoice issues we'll subtract from
    // openNow / criticalNow so the KPI agrees with what listInbox renders.
    countStaleInvoiceIssues(sb, { onlyCritical: false }),
    countStaleInvoiceIssues(sb, { onlyCritical: true }),
    sb
      .from("reconciliation_issues")
      .select("issue_id", { count: "exact", head: true })
      .gte("resolved_at", oneWeekAgo),
    sb
      .from("reconciliation_issues")
      .select("issue_id", { count: "exact", head: true })
      .gte("resolved_at", twoWeeksAgo)
      .lt("resolved_at", oneWeekAgo),
    sb
      .from("reconciliation_issues")
      .select("detected_at, resolved_at")
      .gte("resolved_at", oneWeekAgo)
      .not("resolved_at", "is", null)
      .limit(1000),
    sb
      .from("reconciliation_issues")
      .select("detected_at, resolved_at")
      .gte("resolved_at", twoWeeksAgo)
      .lt("resolved_at", oneWeekAgo)
      .not("resolved_at", "is", null)
      .limit(1000),
  ]);

  const openAdjusted = Math.max(0, (openNow.count ?? 0) - staleAdjustNow);
  const criticalAdjusted = Math.max(0, (criticalNow.count ?? 0) - staleAdjustCritical);
  const avgThisWeek = avgHours(avgThisWeekRes.data ?? []);
  const avgPrevWeek = avgHours(avgPrevWeekRes.data ?? []);

  return {
    open: openAdjusted,
    critical: criticalAdjusted,
    closedThisWeek: closedThisWeek.count ?? 0,
    avgResponseHours: avgThisWeek,
    openDelta: computeDelta({
      current: openAdjusted,
      prior: openWeekAgo.count ?? 0,
      label: "vs sem. pasada",
    }),
    avgResponseDelta:
      avgThisWeek == null || avgPrevWeek == null
        ? null
        : computeDelta({
            current: avgThisWeek,
            prior: avgPrevWeek,
            label: "vs sem. pasada",
          }),
    // Parallel with closedPrevWeek to surface the computed window without
    // adding a second Comparison to the public shape yet.
    asOfDate:
      closedPrevWeek.count != null
        ? now.toISOString().slice(0, 10)
        : now.toISOString().slice(0, 10),
  };
}

/**
 * Count stale invoice issues so KPI counts match what listInbox renders.
 *
 * "Stale" = open issue whose underlying canonical_invoice already meets
 * the resolved condition (e.g. has sat_uuid for a posted_without_uuid
 * issue). See INVOICE_STALE_INVARIANTS for the full set.
 *
 * Uses the same join-in-memory strategy as filterStaleInvoiceIssues so
 * the two paths can never disagree.
 */
async function countStaleInvoiceIssues(
  sb: ReturnType<typeof getServiceClient>,
  opts: { onlyCritical: boolean }
): Promise<number> {
  let q = sb
    .from("reconciliation_issues")
    .select("issue_id, invariant_key, canonical_entity_id")
    .is("resolved_at", null)
    .in("invariant_key", Array.from(INVOICE_STALE_INVARIANTS));
  if (opts.onlyCritical) q = q.eq("severity", "critical");
  const { data } = await q.limit(2000);
  type Raw = { issue_id: string; invariant_key: string | null; canonical_entity_id: string | null };
  const rows = (data ?? []) as Raw[];
  const ids = new Set<number>();
  for (const r of rows) {
    const ref = parseCanonicalEntityId(r.canonical_entity_id);
    if (ref?.source === "odoo") {
      const n = Number(ref.id);
      if (Number.isFinite(n)) ids.add(n);
    }
  }
  if (ids.size === 0) return 0;
  const { data: invs } = await sb
    .from("canonical_invoices")
    .select("odoo_invoice_id, sat_uuid, has_sat_record")
    .in("odoo_invoice_id", Array.from(ids));
  type Inv = { odoo_invoice_id: number; sat_uuid: string | null; has_sat_record: boolean | null };
  const stale = new Set<number>();
  for (const inv of (invs ?? []) as Inv[]) {
    if (inv.sat_uuid != null || inv.has_sat_record === true) {
      stale.add(inv.odoo_invoice_id);
    }
  }
  let count = 0;
  for (const r of rows) {
    const ref = parseCanonicalEntityId(r.canonical_entity_id);
    if (ref?.source === "odoo") {
      const n = Number(ref.id);
      if (stale.has(n)) count++;
    }
  }
  return count;
}

function avgHours(
  rows: Array<{ detected_at: string | null; resolved_at: string | null }>
): number | null {
  if (rows.length === 0) return null;
  let total = 0;
  let count = 0;
  for (const r of rows) {
    if (!r.detected_at || !r.resolved_at) continue;
    const d = Date.parse(r.detected_at);
    const x = Date.parse(r.resolved_at);
    if (!Number.isFinite(d) || !Number.isFinite(x) || x < d) continue;
    total += (x - d) / (1000 * 60 * 60);
    count += 1;
  }
  if (count === 0) return null;
  return total / count;
}
