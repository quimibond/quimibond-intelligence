"use client";

import Link from "next/link";
import {
  ArrowUpCircle,
  CheckCircle2,
  PauseCircle,
  XCircle,
} from "lucide-react";
import { formatDate, timeAgo } from "@/lib/utils";
import type { ActionItem } from "@/lib/types";
import { StateBadge } from "@/components/shared/state-badge";
import { FeedbackButtons } from "@/components/shared/feedback-buttons";
import { AssigneeSelect } from "@/components/shared/assignee-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";

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

const priorityDotColor: Record<string, string> = {
  high: "bg-danger",
  medium: "bg-warning",
  low: "bg-muted-foreground/40",
};

function isOverdue(item: ActionItem): boolean {
  if (item.state !== "pending" || !item.due_date) return false;
  return new Date(item.due_date) < new Date();
}

interface ActionDesktopRowProps {
  action: ActionItem;
  selected: boolean;
  onToggleSelect: (id: number) => void;
  onComplete: (id: number) => void;
  onDismiss: (id: number) => void;
  onUpdateState: (id: number, state: string) => void;
  onReassign: (id: number, email: string | null, name: string | null) => void;
}

export function ActionDesktopRow({
  action,
  selected,
  onToggleSelect,
  onComplete,
  onDismiss,
  onUpdateState,
  onReassign,
}: ActionDesktopRowProps) {
  const overdue = isOverdue(action);

  return (
    <TableRow className="group transition-colors hover:bg-muted/50">
      <TableCell>
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(action.id)}
          className="h-4 w-4 rounded border-input"
        />
      </TableCell>
      <TableCell className="max-w-[300px]">
        <p className="font-medium">{action.description}</p>
        {typeof (action as unknown as Record<string, unknown>).reason === "string" && (
          <p className="text-xs text-muted-foreground mt-0.5">
            {(action as unknown as Record<string, unknown>).reason as string}
          </p>
        )}
      </TableCell>
      <TableCell>
        {action.contact_id ? (
          <Link href={`/contacts/${action.contact_id}`} className="text-primary hover:underline">
            {action.contact_name ?? "—"}
          </Link>
        ) : (action.contact_name ?? "—")}
      </TableCell>
      <TableCell>
        {action.company_id ? (
          <Link href={`/companies/${action.company_id}`} className="text-primary hover:underline">
            {action.contact_company ?? "—"}
          </Link>
        ) : (action.contact_company ?? "—")}
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${priorityDotColor[action.priority] ?? "bg-muted-foreground/40"}`} />
          <Badge variant={priorityVariantMap[action.priority] ?? "secondary"}>
            {priorityLabelMap[action.priority] ?? action.priority}
          </Badge>
        </div>
      </TableCell>
      <TableCell>
        <StateBadge state={action.state} />
      </TableCell>
      <TableCell>
        <AssigneeSelect
          value={action.assignee_email}
          onChange={(email, name) => onReassign(action.id, email, name)}
          className="h-8 text-xs w-[140px]"
        />
      </TableCell>
      <TableCell>
        {action.due_date ? (
          <span
            className={
              overdue
                ? "font-medium text-danger-foreground"
                : "text-muted-foreground"
            }
          >
            {formatDate(action.due_date)}
            {overdue && " (vencida)"}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="text-muted-foreground">
        {timeAgo(action.created_at)}
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {(action.state === "pending" || action.state === "in_progress") && (
            <>
              <Button size="sm" variant="ghost" title="Completar" className="h-8 w-8 p-0" onClick={() => onComplete(action.id)}>
                <CheckCircle2 className="h-4 w-4" />
              </Button>
              <Button size="sm" variant="ghost" title="Bloqueada" className="h-8 w-8 p-0" onClick={() => onUpdateState(action.id, "blocked")}>
                <PauseCircle className="h-4 w-4" />
              </Button>
              <Button size="sm" variant="ghost" title="Escalar" className="h-8 w-8 p-0" onClick={() => onUpdateState(action.id, "escalated")}>
                <ArrowUpCircle className="h-4 w-4" />
              </Button>
              <Button size="sm" variant="ghost" title="Descartar" className="h-8 w-8 p-0" onClick={() => onDismiss(action.id)}>
                <XCircle className="h-4 w-4" />
              </Button>
            </>
          )}
          {(action.state === "blocked" || action.state === "escalated") && (
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onUpdateState(action.id, "pending")}>
              Reactivar
            </Button>
          )}
        </div>
        {action.state !== "pending" && action.state !== "in_progress" && action.state !== "blocked" && action.state !== "escalated" && (
          <FeedbackButtons table="action_items" id={action.id} currentFeedback={null} />
        )}
      </TableCell>
    </TableRow>
  );
}
