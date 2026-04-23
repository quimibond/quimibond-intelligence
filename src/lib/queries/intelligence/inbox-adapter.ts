import type { InboxRow } from "./inbox";
import type {
  InboxCardIssue,
  InboxCardSeverity,
  InboxActionCta,
} from "@/components/patterns";

/**
 * Adapt a gold_ceo_inbox row (flat assignee_* columns, nullable fields) to the
 * InboxCardIssue prop shape expected by the new <InboxCard> component.
 *
 * - assignee becomes { id, name, email } or null.
 * - severity coerces null → "low".
 * - action_cta coerces empty-string → null.
 * - priority_score / age_days / description / issue_type coerce null to safe defaults.
 */
export function adaptInboxRow(r: InboxRow): InboxCardIssue {
  const hasAssignee =
    typeof r.assignee_canonical_contact_id === "number" &&
    typeof r.assignee_name === "string" &&
    r.assignee_name.length > 0;

  const rawCta = typeof r.action_cta === "string" && r.action_cta.length > 0 ? r.action_cta : null;
  const action_cta = (rawCta as InboxActionCta | null);

  return {
    issue_id: r.issue_id ?? "",
    issue_type: r.issue_type ?? "",
    severity: (r.severity ?? "low") as InboxCardSeverity,
    priority_score: r.priority_score ?? 0,
    impact_mxn: r.impact_mxn ?? null,
    age_days: r.age_days ?? 0,
    description: r.description ?? "",
    canonical_entity_type: r.canonical_entity_type ?? "",
    canonical_entity_id: r.canonical_entity_id ?? "",
    action_cta,
    assignee: hasAssignee
      ? {
          id: r.assignee_canonical_contact_id as number,
          name: r.assignee_name as string,
          email: (r.assignee_email ?? "") as string,
        }
      : null,
    detected_at: r.detected_at ?? new Date().toISOString(),
  };
}
