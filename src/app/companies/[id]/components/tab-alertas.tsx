"use client";

import Link from "next/link";
import { Bell } from "lucide-react";
import { formatDate, timeAgo } from "@/lib/utils";
import type { Alert } from "@/lib/types";
import { EmptyState } from "@/components/shared/empty-state";
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
        description="No hay alertas asociadas a esta empresa."
      />
    );
  }

  return (
    <>
      {/* Mobile cards */}
      <div className="space-y-3 md:hidden">
        {alerts.map((alert) => (
          <Link key={alert.id} href={`/alerts/${alert.id}`} className="block">
            <div className="rounded-xl border bg-card text-card-foreground shadow-sm p-3 space-y-2 hover:border-primary/30">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium line-clamp-2">{alert.title}</p>
                <SeverityBadge severity={alert.severity} />
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <StateBadge state={alert.state} />
                {alert.contact_name && <span>{alert.contact_name}</span>}
                <span>{timeAgo(alert.created_at)}</span>
              </div>
            </div>
          </Link>
        ))}
      </div>
      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Severidad</TableHead>
              <TableHead>Titulo</TableHead>
              <TableHead>Contacto</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Fecha</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {alerts.map((alert) => (
              <TableRow key={alert.id}>
                <TableCell>
                  <SeverityBadge severity={alert.severity} />
                </TableCell>
                <TableCell className="font-medium">
                  {alert.title}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {alert.contact_name ?? "---"}
                </TableCell>
                <TableCell>
                  <StateBadge state={alert.state} />
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {formatDate(alert.created_at)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
