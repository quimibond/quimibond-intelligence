"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { timeAgo } from "@/lib/utils";
import { Mail, Search, ChevronRight } from "lucide-react";
import Link from "next/link";

interface Email {
  id: number;
  subject: string;
  sender: string;
  recipient: string;
  snippet: string;
  email_date: string;
  sender_type: string;
  has_attachments: boolean;
  gmail_thread_id: string;
}

const PAGE_SIZE = 25;

export default function EmailsPage() {
  const [emails, setEmails] = useState<Email[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [senderType, setSenderType] = useState<string>("all");
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function fetchEmails() {
      setLoading(true);
      let query = supabase
        .from("emails")
        .select("id, subject, sender, recipient, snippet, email_date, sender_type, has_attachments, gmail_thread_id", { count: "exact" })
        .order("email_date", { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (senderType !== "all") {
        query = query.eq("sender_type", senderType);
      }

      if (search) {
        query = query.or(`subject.ilike.%${search}%,sender.ilike.%${search}%,snippet.ilike.%${search}%`);
      }

      const { data, count } = await query;
      if (!cancelled) {
        setEmails(data || []);
        setTotal(count ?? 0);
        setLoading(false);
      }
    }
    fetchEmails();
    return () => { cancelled = true; };
  }, [page, senderType, search]);

  function handleSearch(value: string) {
    setSearch(value);
    setPage(0);
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Emails</h1>
        <p className="text-sm text-[var(--muted-foreground)]">
          {total.toLocaleString()} emails procesados
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <input
            type="text"
            placeholder="Buscar por asunto, remitente o contenido..."
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] py-2.5 pl-10 pr-4 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
          />
        </div>

        <div className="flex gap-1">
          {["all", "internal", "external"].map((f) => (
            <button
              key={f}
              onClick={() => { setSenderType(f); setPage(0); }}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                senderType === f
                  ? "bg-[var(--primary)] text-white"
                  : "text-[var(--muted-foreground)] hover:bg-[var(--accent)]"
              }`}
            >
              {f === "all" ? "Todos" : f === "internal" ? "Internos" : "Externos"}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-pulse text-[var(--muted-foreground)]">Cargando emails...</div>
        </div>
      ) : emails.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Mail className="mb-3 h-10 w-10 text-[var(--muted-foreground)] opacity-50" />
            <p className="text-sm text-[var(--muted-foreground)]">No se encontraron emails.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="space-y-2">
            {emails.map((email) => (
              <Link key={email.id} href={`/emails/${email.id}`}>
                <Card className="transition-colors hover:border-[var(--primary)]/50 cursor-pointer">
                  <CardContent className="flex items-center gap-4 p-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge
                          variant={email.sender_type === "internal" ? "info" : "success"}
                          className="text-[10px]"
                        >
                          {email.sender_type === "internal" ? "Interno" : "Externo"}
                        </Badge>
                        <span className="text-xs text-[var(--muted-foreground)] truncate">
                          {email.sender}
                        </span>
                        {email.has_attachments && (
                          <span className="text-xs text-[var(--muted-foreground)]">📎</span>
                        )}
                      </div>
                      <p className="text-sm font-medium truncate">{email.subject || "(Sin asunto)"}</p>
                      <p className="mt-0.5 text-xs text-[var(--muted-foreground)] truncate">
                        {email.snippet}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-[var(--muted-foreground)]">
                        {email.email_date ? timeAgo(email.email_date) : ""}
                      </span>
                      <ChevronRight className="h-4 w-4 text-[var(--muted-foreground)]" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="rounded-md px-3 py-1.5 text-xs font-medium text-[var(--muted-foreground)] hover:bg-[var(--accent)] disabled:opacity-50"
              >
                Anterior
              </button>
              <span className="text-xs text-[var(--muted-foreground)]">
                Pagina {page + 1} de {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="rounded-md px-3 py-1.5 text-xs font-medium text-[var(--muted-foreground)] hover:bg-[var(--accent)] disabled:opacity-50"
              >
                Siguiente
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
