"use client";

import { CheckSquare } from "lucide-react";
import { formatDate } from "@/lib/utils";
import type { ActionItem } from "@/lib/types";
import { EmptyState } from "@/components/shared/empty-state";
import { StateBadge } from "@/components/shared/state-badge";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const priorityVariant: Record<string, "success" | "warning" | "critical" | "secondary"> = {
  low: "success",
  medium: "warning",
  high: "critical",
};

const priorityLabel: Record<string, string> = {
  low: "Baja",
  medium: "Media",
  high: "Alta",
};

interface TabAccionesProps {
  actions: ActionItem[];
}

export function TabAcciones({ actions }: TabAccionesProps) {
  if (actions.length === 0) {
    return (
      <EmptyState
        icon={CheckSquare}
        title="Sin acciones"
        description="No hay acciones pendientes para este contacto."
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Descripcion</TableHead>
            <TableHead>Prioridad</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead>Fecha limite</TableHead>
            <TableHead>Asignado a</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {actions.map((action) => (
            <TableRow key={action.id}>
              <TableCell className="max-w-xs text-sm">{action.description}</TableCell>
              <TableCell>
                <Badge variant={priorityVariant[action.priority] ?? "secondary"}>
                  {priorityLabel[action.priority] ?? action.priority}
                </Badge>
              </TableCell>
              <TableCell>
                <StateBadge state={action.state} />
              </TableCell>
              <TableCell className="text-muted-foreground whitespace-nowrap">
                {formatDate(action.due_date)}
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {action.assignee_email ?? "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
