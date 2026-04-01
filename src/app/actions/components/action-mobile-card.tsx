"use client";

import Link from "next/link";
import { CheckCircle2, XCircle } from "lucide-react";
import { timeAgo, formatDate } from "@/lib/utils";
import type { ActionItem } from "@/lib/types";
import { StateBadge } from "@/components/shared/state-badge";
import { FeedbackButtons } from "@/components/shared/feedback-buttons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const priorityVariantMap: Record<string, "critical" | "warning" | "info" | "secondary"> = {
  low: "secondary",
  medium: "warning",
  high: "critical",
};

const priorityLabelMap: Record<string, string> = {
  low: "Baja",
  medium: "Media",
  high: "Alta",
};

const priorityBarColor: Record<string, string> = {
  high: "bg-danger",
  medium: "bg-warning",
  low: "bg-muted-foreground/40",
};

function isOverdue(item: ActionItem): boolean {
  if (item.state !== "pending" || !item.due_date) return false;
  return new Date(item.due_date) < new Date();
}

interface ActionMobileCardProps {
  action: ActionItem;
  selected: boolean;
  onToggleSelect: (id: number) => void;
  onComplete: (id: number) => void;
  onDismiss: (id: number) => void;
  onUpdateState: (id: number, state: string) => void;
}

export function ActionMobileCard({
  action,
  selected,
  onToggleSelect,
  onComplete,
  onDismiss,
  onUpdateState,
}: ActionMobileCardProps) {
  const overdue = isOverdue(action);
  const reason = (action as unknown as Record<string, unknown>).reason;

  return (
    <div className="relative overflow-hidden rounded-lg border bg-card">
      {/* Priority color bar on left */}
      <div className={`absolute left-0 top-0 bottom-0 w-1 ${priorityBarColor[action.priority] ?? "bg-muted-foreground/40"}`} />
      <div className="p-4 pl-5 space-y-3">
        <div className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelect(action.id)}
            className="mt-0.5 h-5 w-5 shrink-0 rounded border-input"
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{action.description}</p>
            {typeof reason === "string" && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {reason}
              </p>
            )}
            <div className="mt-1 text-xs text-muted-foreground">
              {action.contact_id ? (
                <Link href={`/contacts/${action.contact_id}`} className="text-primary hover:underline">
                  {action.contact_name ?? "—"}
                </Link>
              ) : (action.contact_name ?? "—")}
              {" · "}
              {action.company_id ? (
                <Link href={`/companies/${action.company_id}`} className="text-primary hover:underline">
                  {action.contact_company ?? "—"}
                </Link>
              ) : (action.contact_company ?? "—")}
              {" · "}
              {timeAgo(action.created_at)}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={priorityVariantMap[action.priority] ?? "secondary"}>
            {priorityLabelMap[action.priority] ?? action.priority}
          </Badge>
          <StateBadge state={action.state} />
          {overdue && action.due_date && (
            <Badge variant="critical">Vencida {formatDate(action.due_date)}</Badge>
          )}
          {!overdue && action.due_date && (
            <span className="text-xs text-muted-foreground">
              Vence {formatDate(action.due_date)}
            </span>
          )}
          {(action.assignee_name || action.assignee_email) && (
            <span className="text-xs text-muted-foreground">{action.assignee_name ?? action.assignee_email}</span>
          )}
        </div>
        {/* Inline quick actions - always visible with proper touch targets */}
        <div className="flex items-center gap-1 pt-1">
          {(action.state === "pending" || action.state === "in_progress") && (
            <>
              <Button
                size="sm"
                variant="ghost"
                title="Completar"
                className="h-10 min-w-[44px] gap-1.5 text-xs"
                onClick={() => onComplete(action.id)}
              >
                <CheckCircle2 className="h-4 w-4" />
                Completar
              </Button>
              <Button
                size="sm"
                variant="ghost"
                title="Descartar"
                className="h-10 min-w-[44px] gap-1.5 text-xs"
                onClick={() => onDismiss(action.id)}
              >
                <XCircle className="h-4 w-4" />
                Descartar
              </Button>
            </>
          )}
          {(action.state === "blocked" || action.state === "escalated") && (
            <Button size="sm" variant="outline" className="h-10 text-xs" onClick={() => onUpdateState(action.id, "pending")}>
              Reactivar
            </Button>
          )}
          <div className="ml-auto">
            <FeedbackButtons
              table="action_items"
              id={action.id}
              currentFeedback={null}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
