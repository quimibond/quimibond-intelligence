"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Clock,
  AlertTriangle,
  MessageSquare,
  Search,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn, timeAgo, truncate } from "@/lib/utils";
import type { Thread, Email } from "@/lib/types";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatCard } from "@/components/shared/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select-native";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type StatusFilter = "all" | "stalled" | "active" | "cold";

function formatHoursWithout(hours: number | null): string {
  if (hours == null) return "\u2014";
  if (hours < 1) return "<1h";
  if (hours < 24) return `${Math.floor(hours)}h`;
  if (hours < 168) {
    const d = Math.floor(hours / 24);
    const h = Math.floor(hours % 24);
    return h > 0 ? `${d}d ${h}h` : `${d}d`;
  }
  const w = Math.floor(hours / 168);
  return `${w} sem`;
}

function urgencyBadgeVariant(
  hours: number | null
): "success" | "warning" | "critical" {
  if (hours == null || hours < 12) return "success";
  if (hours <= 48) return "warning";
  return "critical";
}

function urgencyLabel(hours: number | null): string {
  if (hours == null || hours < 12) return "OK";
  if (hours <= 48) return "Atenci\u00f3n";
  return "Urgente";
}

function rowBgClass(hours: number | null): string {
  if (hours != null && hours > 72) return "bg-danger/5";
  if (hours != null && hours > 24) return "bg-warning/5";
  return "";
}

function senderTypeVariant(
  type: string | null
): "info" | "warning" | "secondary" {
  if (type === "inbound") return "info";
  if (type === "outbound") return "warning";
  return "secondary";
}

function senderTypeLabel(type: string | null): string {
  if (type === "inbound") return "externo";
  if (type === "outbound") return "interno";
  return type ?? "\u2014";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const PAGE_SIZE = 50;

export default function ThreadsPage() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [threadEmails, setThreadEmails] = useState<Record<number, Email[]>>({});
  const [loadingEmails, setLoadingEmails] = useState<number | null>(null);
  const [totalCounts, setTotalCounts] = useState({ total: 0, stalled24: 0, stalled72: 0 });

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function buildThreadQuery(searchVal: string) {
    let q = supabase
      .from("threads")
      .select("*")
      .order("hours_without_response", { ascending: false, nullsFirst: false })
      .limit(PAGE_SIZE);
    if (searchVal.trim()) {
      q = q.ilike("subject", `%${searchVal.trim()}%`);
    }
    return q;
  }

  // Fetch threads
  useEffect(() => {
    async function fetchThreads() {
      const [dataRes, totalRes, s24Res, s72Res] = await Promise.all([
        buildThreadQuery(""),
        supabase.from("threads").select("id", { count: "exact", head: true }),
        supabase.from("threads").select("id", { count: "exact", head: true }).gt("hours_without_response", 24),
        supabase.from("threads").select("id", { count: "exact", head: true }).gt("hours_without_response", 72),
      ]);
      const rows = (dataRes.data as Thread[] | null) ?? [];
      setThreads(rows);
      setHasMore(rows.length >= PAGE_SIZE);
      setTotalCounts({
        total: totalRes.count ?? 0,
        stalled24: s24Res.count ?? 0,
        stalled72: s72Res.count ?? 0,
      });
      setLoading(false);
    }
    fetchThreads();
  }, []);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      const { data } = await buildThreadQuery(search);
      const rows = (data as Thread[] | null) ?? [];
      setThreads(rows);
      setHasMore(rows.length >= PAGE_SIZE);
      setLoading(false);
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search]);

  // Load more
  const loadMore = useCallback(async () => {
    setLoadingMore(true);
    let q = supabase
      .from("threads")
      .select("*")
      .order("hours_without_response", { ascending: false, nullsFirst: false })
      .range(threads.length, threads.length + PAGE_SIZE - 1);
    if (search.trim()) {
      q = q.ilike("subject", `%${search.trim()}%`);
    }
    const { data } = await q;
    const rows = (data as Thread[] | null) ?? [];
    setThreads((prev) => [...prev, ...rows]);
    setHasMore(rows.length >= PAGE_SIZE);
    setLoadingMore(false);
  }, [threads.length, search]);

  // Fetch emails for a thread
  const fetchThreadEmails = useCallback(
    async (thread: Thread) => {
      if (!thread.gmail_thread_id) return;
      if (threadEmails[thread.id]) return;

      setLoadingEmails(thread.id);
      const { data } = await supabase
        .from("emails")
        .select("*")
        .eq("gmail_thread_id", thread.gmail_thread_id)
        .order("email_date", { ascending: true });
      setThreadEmails((prev) => ({
        ...prev,
        [thread.id]: (data as Email[] | null) ?? [],
      }));
      setLoadingEmails(null);
    },
    [threadEmails]
  );

  // Toggle row expansion
  const toggleRow = useCallback(
    (thread: Thread) => {
      if (expandedId === thread.id) {
        setExpandedId(null);
      } else {
        setExpandedId(thread.id);
        fetchThreadEmails(thread);
      }
    },
    [expandedId, fetchThreadEmails]
  );

  // Filter threads (status only — search is server-side)
  const filtered = useMemo(() => {
    if (statusFilter === "stalled") {
      return threads.filter(
        (t) => t.hours_without_response != null && t.hours_without_response > 24
      );
    } else if (statusFilter === "active") {
      return threads.filter(
        (t) =>
          t.hours_without_response == null || t.hours_without_response <= 24
      );
    } else if (statusFilter === "cold") {
      return threads.filter(
        (t) => t.hours_without_response != null && t.hours_without_response > 72
      );
    }
    return threads;
  }, [threads, statusFilter]);

  // Stats
  const totalCount = totalCounts.total;
  const stalled24 = totalCounts.stalled24;
  const stalled72 = totalCounts.stalled72;

  return (
    <div>
      <PageHeader
        title="Hilos de Conversaci\u00f3n"
        description="Inteligencia de comunicaci\u00f3n y detecci\u00f3n de hilos sin respuesta"
      />

      {/* Filter bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pb-4">
        <div className="flex gap-2 overflow-x-auto pb-1 sm:pb-0">
          {(["all", "stalled", "active", "cold"] as StatusFilter[]).map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              aria-pressed={statusFilter === s}
              aria-label={`Filtrar: ${s === "all" ? "todos" : s === "stalled" ? "sin respuesta 24h" : s === "active" ? "activos" : "sin respuesta 72h"}`}
              className={cn(
                "shrink-0 rounded-full px-3 py-1.5 text-xs font-medium border transition-colors",
                statusFilter === s ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted"
              )}
            >
              {s === "all" ? `Todos (${totalCounts.total})` :
               s === "stalled" ? `>24h (${totalCounts.stalled24})` :
               s === "active" ? "Activos" : `>72h (${totalCounts.stalled72})`}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-0 sm:max-w-sm">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por asunto..."
            aria-label="Buscar hilos"
            className="pl-9 h-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Stats row — compact on mobile */}
      <div className="grid grid-cols-3 gap-3 pb-4 sm:gap-4 sm:pb-6">
        <StatCard
          title="Total hilos"
          value={loading ? "\u2014" : totalCount}
          icon={MessageSquare}
        />
        <StatCard
          title="Sin respuesta >24h"
          value={loading ? "\u2014" : stalled24}
          icon={Clock}
          trend={stalled24 > 0 ? "down" : "neutral"}
        />
        <StatCard
          title="Sin respuesta >72h"
          value={loading ? "\u2014" : stalled72}
          icon={AlertTriangle}
          trend={stalled72 > 0 ? "down" : "neutral"}
        />
      </div>

      {/* Table */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 10 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={MessageSquare}
          title="Sin hilos"
          description="No se encontraron hilos de conversaci\u00f3n con los filtros actuales."
        />
      ) : (
        <>
          {/* Mobile card layout */}
          <div className="space-y-3 md:hidden">
            {filtered.map((thread) => {
              const hours = thread.hours_without_response;
              const participants = thread.participant_emails ?? [];
              const displayParticipants = participants.slice(0, 3);
              const extraCount = participants.length - displayParticipants.length;
              const type = thread.last_sender_type;
              const isExpanded = expandedId === thread.id;
              const emails = threadEmails[thread.id];
              const isLoadingRow = loadingEmails === thread.id;

              return (
                <div
                  key={thread.id}
                  className={cn(
                    "rounded-lg border bg-card p-4 space-y-2",
                    rowBgClass(hours)
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/threads/${thread.id}`}
                        className="text-sm font-medium hover:underline line-clamp-2"
                      >
                        {thread.subject || "\u2014"}
                      </Link>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {truncate(thread.last_sender, 30)} &middot;{" "}
                        {thread.message_count} msgs &middot;{" "}
                        {timeAgo(thread.created_at)}
                      </p>
                    </div>
                    <button
                      onClick={() => toggleRow(thread)}
                      className="shrink-0 p-1"
                      aria-expanded={isExpanded}
                      aria-label={`${isExpanded ? "Colapsar" : "Expandir"} emails del hilo`}
                    >
                      <ChevronDown
                        className={`h-4 w-4 transition-transform ${
                          isExpanded ? "rotate-180" : ""
                        }`}
                      />
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={urgencyBadgeVariant(hours)}>
                      {urgencyLabel(hours)}
                    </Badge>
                    <span className="text-xs tabular-nums font-medium">
                      {formatHoursWithout(hours)}
                    </span>
                    {type && (
                      <Badge
                        variant={senderTypeVariant(type)}
                        className="text-[10px]"
                      >
                        {senderTypeLabel(type)}
                      </Badge>
                    )}
                  </div>

                  {/* Participants */}
                  <div className="flex flex-wrap gap-1">
                    {displayParticipants.map((email) => (
                      <Badge
                        key={email}
                        variant="secondary"
                        className="truncate max-w-[140px] text-[10px]"
                      >
                        {email}
                      </Badge>
                    ))}
                    {extraCount > 0 && (
                      <Badge variant="outline" className="text-[10px]">
                        +{extraCount}
                      </Badge>
                    )}
                  </div>

                  {/* Expanded emails */}
                  {isExpanded && (
                    <div className="space-y-2 pt-2 border-t">
                      {isLoadingRow ? (
                        <div className="space-y-2">
                          {Array.from({ length: 3 }).map((_, i) => (
                            <Skeleton key={i} className="h-16 w-full" />
                          ))}
                        </div>
                      ) : !emails || emails.length === 0 ? (
                        <p className="py-4 text-center text-sm text-muted-foreground">
                          No se encontraron emails para este hilo.
                        </p>
                      ) : (
                        emails.map((email) => (
                          <div
                            key={email.id}
                            className={cn(
                              "rounded-lg border bg-background p-3",
                              email.sender_type === "outbound"
                                ? "border-info/30"
                                : "border-border"
                            )}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="text-sm font-medium truncate">
                                  {email.sender || "\u2014"}
                                </span>
                                {email.sender_type && (
                                  <Badge
                                    variant={senderTypeVariant(
                                      email.sender_type
                                    )}
                                    className="shrink-0 text-[10px]"
                                  >
                                    {senderTypeLabel(email.sender_type)}
                                  </Badge>
                                )}
                              </div>
                              <span className="shrink-0 text-xs text-muted-foreground">
                                {timeAgo(email.email_date)}
                              </span>
                            </div>
                            {email.snippet && (
                              <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
                                {truncate(email.snippet, 200)}
                              </p>
                            )}
                            <Link href={`/emails/${email.id}`} className="mt-1 inline-block text-xs text-primary hover:underline">
                              Ver email completo
                            </Link>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Desktop table layout */}
          <div className="hidden md:block">
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Asunto</TableHead>
                    <TableHead>Participantes</TableHead>
                    <TableHead className="text-center">Mensajes</TableHead>
                    <TableHead>\u00daltimo remitente</TableHead>
                    <TableHead>Sin respuesta</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Fecha</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((thread) => {
                    const isExpanded = expandedId === thread.id;
                    const emails = threadEmails[thread.id];
                    const isLoadingRow = loadingEmails === thread.id;

                    return (
                      <ThreadRow
                        key={thread.id}
                        thread={thread}
                        isExpanded={isExpanded}
                        emails={emails}
                        isLoadingEmails={isLoadingRow}
                        onToggle={() => toggleRow(thread)}
                      />
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>

          {hasMore && filtered.length > 0 && (
            <div className="flex justify-center pt-4">
              <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? "Cargando..." : "Cargar mas"}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Thread row + expansion
// ---------------------------------------------------------------------------

interface ThreadRowProps {
  thread: Thread;
  isExpanded: boolean;
  emails: Email[] | undefined;
  isLoadingEmails: boolean;
  onToggle: () => void;
}

const ThreadRow = React.memo(function ThreadRow({
  thread,
  isExpanded,
  emails,
  isLoadingEmails,
  onToggle,
}: ThreadRowProps) {
  const hours = thread.hours_without_response;
  const participants = thread.participant_emails ?? [];
  const displayParticipants = participants.slice(0, 3);
  const extraCount = participants.length - displayParticipants.length;

  return (
    <>
      <TableRow
        className={cn(
          "cursor-pointer transition-colors hover:bg-muted/50",
          rowBgClass(hours)
        )}
        onClick={onToggle}
        role="button"
        aria-expanded={isExpanded}
        aria-label={`${isExpanded ? "Colapsar" : "Expandir"} hilo: ${thread.subject}`}
      >
        {/* Chevron */}
        <TableCell className="w-8 px-2">
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </TableCell>

        {/* Asunto */}
        <TableCell className="max-w-[260px] font-medium">
          <Link href={`/threads/${thread.id}`} className="hover:underline">
            {truncate(thread.subject, 55) || "\u2014"}
          </Link>
        </TableCell>

        {/* Participantes */}
        <TableCell>
          <div className="flex flex-wrap gap-1">
            {displayParticipants.map((email) => (
              <Badge
                key={email}
                variant="secondary"
                className="max-w-[160px] truncate text-[10px] font-normal"
              >
                {email}
              </Badge>
            ))}
            {extraCount > 0 && (
              <Badge variant="outline" className="text-[10px] font-normal">
                +{extraCount}
              </Badge>
            )}
          </div>
        </TableCell>

        {/* Mensajes */}
        <TableCell className="text-center tabular-nums">
          {thread.message_count}
        </TableCell>

        {/* Ultimo remitente */}
        <TableCell>
          <div className="flex items-center gap-2">
            <Link href={`/contacts?q=${encodeURIComponent(thread.last_sender ?? "")}`} className="text-sm hover:underline">
              {truncate(thread.last_sender, 30) || "\u2014"}
            </Link>
            {thread.last_sender_type && (
              <Badge
                variant={senderTypeVariant(thread.last_sender_type)}
                className="text-[10px]"
              >
                {senderTypeLabel(thread.last_sender_type)}
              </Badge>
            )}
          </div>
        </TableCell>

        {/* Sin respuesta */}
        <TableCell className="whitespace-nowrap tabular-nums font-medium">
          {formatHoursWithout(hours)}
        </TableCell>

        {/* Estado */}
        <TableCell>
          <Badge variant={urgencyBadgeVariant(hours)}>
            {urgencyLabel(hours)}
          </Badge>
        </TableCell>

        {/* Fecha */}
        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
          {timeAgo(thread.created_at)}
        </TableCell>
      </TableRow>

      {/* Expanded: thread emails */}
      {isExpanded && (
        <TableRow>
          <TableCell colSpan={8} className="bg-muted/30 p-4">
            {isLoadingEmails ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            ) : !emails || emails.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No se encontraron emails para este hilo.
              </p>
            ) : (
              <div className="space-y-2">
                {emails.map((email) => (
                  <div
                    key={email.id}
                    className={cn(
                      "rounded-lg border bg-background p-3",
                      email.sender_type === "outbound"
                        ? "border-info/30"
                        : "border-border"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm font-medium truncate">
                          {email.sender || "\u2014"}
                        </span>
                        {email.sender_type && (
                          <Badge
                            variant={senderTypeVariant(email.sender_type)}
                            className="shrink-0 text-[10px]"
                          >
                            {senderTypeLabel(email.sender_type)}
                          </Badge>
                        )}
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {timeAgo(email.email_date)}
                      </span>
                    </div>
                    {email.snippet && (
                      <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
                        {truncate(email.snippet, 200)}
                      </p>
                    )}
                    <Link href={`/emails/${email.id}`} className="mt-1 inline-block text-xs text-primary hover:underline">
                      Ver email completo
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </TableCell>
        </TableRow>
      )}
    </>
  );
});
