"use client";

import { Bell } from "lucide-react";
import { formatDate } from "@/lib/utils";
import type { Alert } from "@/lib/types";
import { EmptyState } from "@/components/shared/empty-state";
import { FeedbackButtons } from "@/components/shared/feedback-buttons";
import { SeverityBadge } from "@/components/shared/severity-badge";
import { StateBadge } from "@/components/shared/state-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface TabAlertasProps {
  alerts: Alert[];
}

export function TabAlertas({ alerts }: TabAlertasProps) {
  if (alerts.length === 0) {
    return (
      <EmptyState
        icon={Bell}
        title="Sin alertas"
        description="No hay alertas asociadas a este contacto."
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Severidad</TableHead>
            <TableHead>Titulo</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead>Fecha</TableHead>
            <TableHead className="w-[80px]">Feedback</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {alerts.map((alert) => (
            <TableRow key={alert.id}>
              <TableCell>
                <SeverityBadge severity={alert.severity} />
              </TableCell>
              <TableCell className="font-medium">{alert.title}</TableCell>
              <TableCell>
                <StateBadge state={alert.state} />
              </TableCell>
              <TableCell className="text-muted-foreground whitespace-nowrap">
                {formatDate(alert.created_at)}
              </TableCell>
              <TableCell>
                <FeedbackButtons table="alerts" id={alert.id} currentFeedback={null} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
