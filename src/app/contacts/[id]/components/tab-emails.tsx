"use client";

import { Mail } from "lucide-react";
import { formatDateTime, timeAgo, truncate } from "@/lib/utils";
import type { Email, ContactCommunicationsRPC } from "@/lib/types";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const senderTypeBadgeVariant: Record<string, "info" | "warning" | "secondary"> = {
  inbound: "info",
  outbound: "warning",
};

const senderTypeLabel: Record<string, string> = {
  inbound: "Recibido",
  outbound: "Enviado",
};

interface TabEmailsProps {
  emails: Email[];
  contactComms: ContactCommunicationsRPC | null;
}

export function TabEmails({ emails, contactComms }: TabEmailsProps) {
  return (
    <div className="space-y-6">
      {emails.length > 0 ? (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Remitente</TableHead>
                <TableHead>Asunto</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Fragmento</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {emails.map((email) => (
                <TableRow key={email.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDateTime(email.email_date)}
                  </TableCell>
                  <TableCell className="text-sm">{email.sender ?? "—"}</TableCell>
                  <TableCell className="font-medium">{email.subject ?? "—"}</TableCell>
                  <TableCell>
                    {email.sender_type && (
                      <Badge variant={senderTypeBadgeVariant[email.sender_type] ?? "secondary"}>
                        {senderTypeLabel[email.sender_type] ?? email.sender_type}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="max-w-xs text-sm text-muted-foreground">
                    {truncate(email.snippet, 80)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState
          icon={Mail}
          title="Sin emails"
          description="No se encontraron correos asociados a este contacto."
        />
      )}

      {/* Threads from RPC */}
      {contactComms && Array.isArray(contactComms.threads) && contactComms.threads.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Hilos de Conversacion</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Asunto</TableHead>
                    <TableHead>Mensajes</TableHead>
                    <TableHead>Ultima Actividad</TableHead>
                    <TableHead>Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {contactComms.threads.map((thread: Record<string, unknown>, i: number) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium text-sm">{String(thread.subject ?? "—")}</TableCell>
                      <TableCell className="tabular-nums">{String(thread.message_count ?? "—")}</TableCell>
                      <TableCell className="text-muted-foreground">{timeAgo(thread.last_activity as string | null)}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{String(thread.status ?? "—")}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* KG relationships from RPC */}
      {contactComms && Array.isArray(contactComms.relationships) && contactComms.relationships.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Relaciones (Knowledge Graph)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {contactComms.relationships.map((rel: Record<string, unknown>, i: number) => (
                <Badge key={i} variant="outline" className="gap-1">
                  {String(rel.related_entity_name ?? rel.entity_name ?? "Entidad")} — {String(rel.relationship_type ?? "relacion")}
                  {rel.strength != null && ` (${(Number(rel.strength) * 100).toFixed(0)}%)`}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
