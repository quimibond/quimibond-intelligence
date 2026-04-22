import "server-only";
import { getServiceClient } from "@/lib/supabase-server";
import type { Database } from "@/lib/database.types";

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
