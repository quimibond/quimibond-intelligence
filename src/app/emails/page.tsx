"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Mail, Paperclip, Search } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { formatDateTime, truncate } from "@/lib/utils";
import type { Email } from "@/lib/types";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
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

export default function EmailsPage() {
  const [emails, setEmails] = useState<Email[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    async function fetchEmails() {
      const { data } = await supabase
        .from("emails")
        .select("*")
        .order("email_date", { ascending: false })
        .limit(100);
      setEmails((data as Email[] | null) ?? []);
      setLoading(false);
    }
    fetchEmails();
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return emails;
    return emails.filter(
      (e) =>
        e.sender?.toLowerCase().includes(q) ||
        e.recipient?.toLowerCase().includes(q) ||
        e.subject?.toLowerCase().includes(q) ||
        e.snippet?.toLowerCase().includes(q)
    );
  }, [emails, search]);

  return (
    <div>
      <PageHeader
        title="Emails"
        description="Correos sincronizados e inteligencia extraida"
      />

      <div className="flex items-center gap-3 pb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por remitente, destinatario o asunto..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Mail}
          title="Sin emails"
          description="No se encontraron correos con los filtros actuales."
        />
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fecha</TableHead>
                <TableHead>Remitente</TableHead>
                <TableHead>Destinatario</TableHead>
                <TableHead>Asunto</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((email) => (
                <TableRow key={email.id} className="cursor-pointer hover:bg-muted/50">
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    <Link href={`/emails/${email.id}`} className="contents">
                      {formatDateTime(email.email_date)}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/emails/${email.id}`}
                      className="text-sm hover:underline"
                    >
                      {truncate(email.sender, 40) || "—"}
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {truncate(email.recipient, 40) || "—"}
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/emails/${email.id}`}
                      className="font-medium hover:underline"
                    >
                      {truncate(email.subject, 60) || "—"}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {email.sender_type && (
                      <Badge
                        variant={
                          senderTypeBadgeVariant[email.sender_type] ?? "secondary"
                        }
                      >
                        {senderTypeLabel[email.sender_type] ?? email.sender_type}
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {email.has_attachments && (
                      <Paperclip className="h-4 w-4 text-muted-foreground" />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
