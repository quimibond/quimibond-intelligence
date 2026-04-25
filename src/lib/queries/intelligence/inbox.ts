import "server-only";
import { getServiceClient } from "@/lib/supabase-server";
import type { Database } from "@/lib/database.types";
import { computeDelta, type Comparison } from "@/lib/kpi";

export type InboxRow = Database["public"]["Views"]["gold_ceo_inbox"]["Row"];

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
 */
export async function listInbox(
  opts: ListInboxOptions = {}
): Promise<InboxRow[]> {
  const sb = getServiceClient();
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
  q = q.limit(opts.limit ?? 50);

  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
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

  const avgThisWeek = avgHours(avgThisWeekRes.data ?? []);
  const avgPrevWeek = avgHours(avgPrevWeekRes.data ?? []);

  return {
    open: openNow.count ?? 0,
    critical: criticalNow.count ?? 0,
    closedThisWeek: closedThisWeek.count ?? 0,
    avgResponseHours: avgThisWeek,
    openDelta: computeDelta({
      current: openNow.count ?? 0,
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
