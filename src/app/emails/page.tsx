"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Mail, Paperclip, Search } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { formatDateTime, truncate } from "@/lib/utils";
import type { Email } from "@/lib/types";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
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
  external: "info",
  internal: "warning",
};

const senderTypeLabel: Record<string, string> = {
  external: "Recibido",
  internal: "Enviado",
};

const PAGE_SIZE = 50;

export default function EmailsPage() {
  const router = useRouter();
  const [emails, setEmails] = useState<Email[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [search, setSearch] = useState("");
  const [senderTypeFilter, setSenderTypeFilter] = useState("all");
  const [accounts, setAccounts] = useState<string[]>([]);
  const [accountFilter, setAccountFilter] = useState("all");

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function buildEmailQuery(searchVal: string, account: string, senderType: string) {
    let q = supabase
      .from("emails")
      .select("*")
      .order("email_date", { ascending: false });
    if (account !== "all") q = q.eq("account", account);
    if (senderType !== "all") q = q.eq("sender_type", senderType);
    if (searchVal.trim()) {
      const pattern = `%${searchVal.trim()}%`;
      q = q.or(`subject.ilike.${pattern},sender.ilike.${pattern},recipient.ilike.${pattern}`);
    }
    return q;
  }

  useEffect(() => {
    async function fetchEmails() {
      const { data } = await buildEmailQuery(search, accountFilter, senderTypeFilter).limit(PAGE_SIZE);
      const rows = (data as Email[] | null) ?? [];
      setEmails(rows);
      setHasMore(rows.length === PAGE_SIZE);

      // Get unique accounts for filter (only once)
      if (accounts.length === 0) {
        const { data: accts } = await supabase
          .from("emails")
          .select("account")
          .not("account", "is", null)
          .limit(500);
        const unique = [...new Set((accts ?? []).map((a: { account: string }) => a.account).filter(Boolean))].sort();
        setAccounts(unique as string[]);
      }
      setLoading(false);
    }
    fetchEmails();
  }, [accountFilter, senderTypeFilter]);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      const { data } = await buildEmailQuery(search, accountFilter, senderTypeFilter).limit(PAGE_SIZE);
      setEmails((data ?? []) as Email[]);
      setHasMore((data ?? []).length === PAGE_SIZE);
      setLoading(false);
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search]);

  async function loadMore() {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const { data } = await buildEmailQuery(search, accountFilter, senderTypeFilter)
      .range(emails.length, emails.length + PAGE_SIZE - 1);
    if (data) {
      setEmails((prev) => [...prev, ...(data as Email[])]);
      setHasMore(data.length === PAGE_SIZE);
    }
    setLoadingMore(false);
  }

  return (
    <div>
      <PageHeader
        title="Emails"
        description="Correos sincronizados e inteligencia extraida"
      />

      <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-3 pb-4">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por remitente o asunto..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)} className="w-full sm:w-auto">
          <option value="all">Todas las cuentas</option>
          {accounts.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </Select>
        <Select value={senderTypeFilter} onChange={(e) => setSenderTypeFilter(e.target.value)} className="w-full sm:w-auto">
          <option value="all">Todos los tipos</option>
          <option value="internal">Enviados</option>
          <option value="external">Recibidos</option>
        </Select>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : emails.length === 0 ? (
        <EmptyState
          icon={Mail}
          title="Sin emails"
          description="No se encontraron correos con los filtros actuales."
        />
      ) : (
        <>
        {/* Mobile card layout */}
        <div className="space-y-3 md:hidden">
          {emails.map((email) => (
            <div key={email.id} className="rounded-lg border bg-card p-4 space-y-2">
              <Link href={`/emails/${email.id}`} className="block">
                <p className="text-sm font-medium line-clamp-1">{email.subject || "—"}</p>
                <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="truncate">{email.sender || "—"}</span>
                  <span>→</span>
                  <span className="truncate">{truncate(email.recipient, 30) || "—"}</span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">{formatDateTime(email.email_date)}</span>
                  {email.sender_type && (
                    <Badge variant={senderTypeBadgeVariant[email.sender_type] ?? "secondary"}>
                      {senderTypeLabel[email.sender_type] ?? email.sender_type}
                    </Badge>
                  )}
                  {email.has_attachments && <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />}
                  {email.thread_id && (
                    <Link href={`/threads/${email.thread_id}`} className="text-xs text-primary hover:underline">
                      Ver hilo
                    </Link>
                  )}
                </div>
              </Link>
            </div>
          ))}
        </div>

        {/* Desktop table layout */}
        <div className="hidden md:block">
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
                {emails.map((email) => (
                  <TableRow
                    key={email.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => router.push(`/emails/${email.id}`)}
                  >
                    <TableCell className="whitespace-nowrap text-muted-foreground text-sm">
                      {formatDateTime(email.email_date)}
                    </TableCell>
                    <TableCell className="text-sm">
                      {truncate(email.sender, 40) || "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {truncate(email.recipient, 40) || "—"}
                    </TableCell>
                    <TableCell className="font-medium">
                      {truncate(email.subject, 60) || "—"}
                    </TableCell>
                    <TableCell>
                      {email.sender_type && (
                        <Badge variant={senderTypeBadgeVariant[email.sender_type] ?? "secondary"}>
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
        </div>
        </>
      )}

      {hasMore && emails.length > 0 && (
        <div className="flex justify-center pt-4">
          <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
            {loadingMore && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {loadingMore ? "Cargando..." : "Cargar mas"}
          </Button>
        </div>
      )}
    </div>
  );
}
