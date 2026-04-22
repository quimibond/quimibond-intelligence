import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "./status-badge";
import { cn } from "@/lib/utils";

export type InboxCardSeverity = "critical" | "high" | "medium" | "low";
export type InboxActionCta = "operationalize" | "confirm_cancel" | "link_manual" | "resolve";

export interface InboxCardIssue {
  issue_id: string;
  issue_type: string;
  severity: InboxCardSeverity;
  priority_score: number;
  impact_mxn: number | null;
  age_days: number;
  description: string;
  canonical_entity_type: string;
  canonical_entity_id: string;
  action_cta: InboxActionCta | null;
  assignee: { id: number; name: string; email: string } | null;
  detected_at: string;
}

const CTA_LABELS: Record<InboxActionCta, string> = {
  operationalize: "Operacionalizar",
  confirm_cancel: "Confirmar cancelación",
  link_manual:    "Ligar manual",
  resolve:        "Resolver",
};

function fmtMxn(n: number | null): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(n);
}

interface InboxCardProps {
  issue: InboxCardIssue;
  onAction?: (action: InboxActionCta, issue: InboxCardIssue) => void;
  className?: string;
}

export function InboxCard({ issue, onAction, className }: InboxCardProps) {
  return (
    <Card role="article" aria-labelledby={`issue-${issue.issue_id}-desc`} className={cn("transition-shadow hover:shadow-sm", className)}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge kind="severity" value={issue.severity} density="regular" />
            <span className="text-xs text-muted-foreground" aria-label={`Prioridad ${issue.priority_score}`}>
              {Math.floor(issue.priority_score)}
            </span>
            <span className="text-xs text-muted-foreground" aria-label={`Hace ${issue.age_days} días`}>
              {issue.age_days}d
            </span>
          </div>
          {issue.impact_mxn != null && (
            <span className="text-sm font-semibold tabular-nums" aria-label={`Impacto ${fmtMxn(issue.impact_mxn)}`}>
              {fmtMxn(issue.impact_mxn)}
            </span>
          )}
        </div>

        <p id={`issue-${issue.issue_id}-desc`} className="text-sm leading-snug">
          {issue.description}
        </p>

        <div className="flex items-center justify-between gap-2 pt-1">
          {issue.assignee ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground min-w-0">
              <span
                aria-hidden="true"
                className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[10px] font-medium"
              >
                {issue.assignee.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="truncate">{issue.assignee.name}</span>
            </div>
          ) : <span />}

          {issue.action_cta && onAction && (
            <Button
              size="sm"
              className="min-h-[44px]"
              aria-label={CTA_LABELS[issue.action_cta]}
              onClick={() => onAction(issue.action_cta!, issue)}
            >
              {CTA_LABELS[issue.action_cta]}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
