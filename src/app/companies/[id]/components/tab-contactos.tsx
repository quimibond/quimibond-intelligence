"use client";

import Link from "next/link";
import { Users } from "lucide-react";
import { cn, scoreToPercent } from "@/lib/utils";
import { sentimentColor } from "@/lib/utils";
import type { Contact } from "@/lib/types";
import { EmptyState } from "@/components/shared/empty-state";
import { RiskBadge } from "@/components/shared/risk-badge";
import { LinkCard } from "@/components/shared/link-card";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface TabContactosProps {
  contacts: Contact[];
}

export function TabContactos({ contacts }: TabContactosProps) {
  if (contacts.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="Sin contactos"
        description="No se encontraron contactos asociados a esta empresa."
      />
    );
  }

  return (
    <>
      {/* Mobile cards */}
      <div className="space-y-3 md:hidden">
        {contacts.map((contact) => (
          <LinkCard key={contact.id} href={`/contacts/${contact.id}`} className="p-3 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium truncate">{contact.name ?? "Sin nombre"}</p>
                <p className="text-xs text-muted-foreground truncate">{contact.email ?? "---"}</p>
              </div>
              <RiskBadge level={contact.risk_level} />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {contact.role && <span>{contact.role}</span>}
              <span className={cn("font-medium tabular-nums", sentimentColor(contact.sentiment_score))}>
                Sent: {contact.sentiment_score != null ? contact.sentiment_score.toFixed(2) : "---"}
              </span>
            </div>
          </LinkCard>
        ))}
      </div>
      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Rol</TableHead>
              <TableHead>Riesgo</TableHead>
              <TableHead className="text-right">Sentimiento</TableHead>
              <TableHead className="w-[140px]">Relacion</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {contacts.map((contact) => (
              <TableRow key={contact.id}>
                <TableCell>
                  <Link
                    href={`/contacts/${contact.id}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {contact.name ?? "Sin nombre"}
                  </Link>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {contact.email ?? "---"}
                </TableCell>
                <TableCell className="text-sm">
                  {contact.role ?? contact.contact_type ?? "---"}
                </TableCell>
                <TableCell>
                  <RiskBadge level={contact.risk_level} />
                </TableCell>
                <TableCell className="text-right">
                  <span
                    className={cn(
                      "text-sm font-medium tabular-nums",
                      sentimentColor(contact.sentiment_score)
                    )}
                  >
                    {contact.sentiment_score != null
                      ? contact.sentiment_score.toFixed(2)
                      : "---"}
                  </span>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Progress
                      value={scoreToPercent(contact.relationship_score)}
                      className="h-2 flex-1"
                    />
                    <span className="w-8 text-right text-xs text-muted-foreground tabular-nums">
                      {contact.relationship_score != null
                        ? Math.round(scoreToPercent(contact.relationship_score))
                        : 0}
                    </span>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
