"use client";

import { Mail } from "lucide-react";
import { formatDateTime, truncate } from "@/lib/utils";
import { EmptyState } from "@/components/shared/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface TabEmailsProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  recentEmails: any[];
}

export function TabEmails({ recentEmails }: TabEmailsProps) {
  if (recentEmails.length === 0) {
    return (
      <EmptyState
        icon={Mail}
        title="Sin emails"
        description="No se encontraron correos asociados a esta empresa."
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Fecha</TableHead>
            <TableHead>Remitente</TableHead>
            <TableHead>Asunto</TableHead>
            <TableHead>Fragmento</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {recentEmails.map((email: Record<string, unknown>) => (
            <TableRow key={email.id as number}>
              <TableCell className="whitespace-nowrap text-muted-foreground">
                {formatDateTime(email.email_date as string | null)}
              </TableCell>
              <TableCell className="text-sm font-medium">
                {String(email.sender ?? "—")}
              </TableCell>
              <TableCell className="text-sm">
                {String(email.subject ?? "—")}
              </TableCell>
              <TableCell className="max-w-xs text-sm text-muted-foreground">
                {truncate(email.snippet as string | null, 80)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
