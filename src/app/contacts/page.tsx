"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Bell,
  Loader2,
  Search,
  TrendingDown,
  TrendingUp,
  Users,
  UserX,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn, getInitials, timeAgo, sentimentColor } from "@/lib/utils";
import type { Contact } from "@/lib/types";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { RiskBadge } from "@/components/shared/risk-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const PAGE_SIZE = 50;

// ── Health score helpers ──

function healthColor(score: number | null): string {
  if (score == null) return "text-muted-foreground";
  if (score > 60) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 40) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

function healthBgColor(score: number | null): string {
  if (score == null) return "bg-muted";
  if (score > 60) return "bg-emerald-500";
  if (score >= 40) return "bg-amber-500";
  return "bg-red-500";
}

function healthBarBgColor(score: number | null): string {
  if (score == null) return "bg-muted";
  if (score > 60) return "bg-emerald-500/20";
  if (score >= 40) return "bg-amber-500/20";
  return "bg-red-500/20";
}

function sentimentEmoji(score: number | null): string {
  if (score == null) return "---";
  if (score >= 0.6) return "\u{1F60A}";
  if (score >= 0.3) return "\u{1F610}";
  return "\u{1F61F}";
}

function trendIcon(trend: string | null) {
  if (trend === "up" || trend === "improving")
    return <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />;
  if (trend === "down" || trend === "declining")
    return <TrendingDown className="h-3.5 w-3.5 text-red-500" />;
  return null;
}

// ── Health score bar (inline mini progress) ──

function HealthBar({ score }: { score: number | null }) {
  const val = score ?? 0;
  return (
    <div className="flex items-center gap-2">
      <div
        className={cn("h-2.5 w-2.5 rounded-full shrink-0", healthBgColor(score))}
        title={score != null ? `${score}` : "Sin dato"}
      />
      <div className={cn("h-1.5 w-16 rounded-full overflow-hidden", healthBarBgColor(score))}>
        <div
          className={cn("h-full rounded-full transition-all", healthBgColor(score))}
          style={{ width: `${Math.min(100, Math.max(0, val))}%` }}
        />
      </div>
      <span className={cn("text-xs tabular-nums font-medium", healthColor(score))}>
        {score != null ? score : "—"}
      </span>
    </div>
  );
}

// ── Health dot (compact for mobile) ──

function HealthDot({ score }: { score: number | null }) {
  return (
    <div
      className={cn("h-2.5 w-2.5 rounded-full shrink-0", healthBgColor(score))}
      title={score != null ? `Salud: ${score}` : "Sin dato de salud"}
    />
  );
}

// ── Quick stats bar ──

function QuickStats({ contacts }: { contacts: Contact[] }) {
  const stats = useMemo(() => {
    const total = contacts.length;
    const atRisk = contacts.filter(
      (c) => c.risk_level === "high" || c.risk_level === "medium"
    ).length;
    const withHealth = contacts.filter((c) => c.current_health_score != null);
    const avgHealth =
      withHealth.length > 0
        ? Math.round(
            withHealth.reduce((sum, c) => sum + (c.current_health_score ?? 0), 0) /
              withHealth.length
          )
        : null;
    const noRole = contacts.filter((c) => !c.role).length;
    return { total, atRisk, avgHealth, noRole };
  }, [contacts]);

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 pb-4">
      <div className="rounded-lg border bg-card p-3 space-y-1">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Users className="h-3.5 w-3.5" />
          Total
        </div>
        <p className="text-xl font-bold tabular-nums">{stats.total}</p>
      </div>
      <div className="rounded-lg border bg-card p-3 space-y-1">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <AlertTriangle className="h-3.5 w-3.5" />
          En riesgo
        </div>
        <p className={cn("text-xl font-bold tabular-nums", stats.atRisk > 0 && "text-red-600 dark:text-red-400")}>
          {stats.atRisk}
        </p>
      </div>
      <div className="rounded-lg border bg-card p-3 space-y-1">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <HealthDot score={stats.avgHealth} />
          Salud prom.
        </div>
        <p className={cn("text-xl font-bold tabular-nums", healthColor(stats.avgHealth))}>
          {stats.avgHealth ?? "—"}
        </p>
      </div>
      <div className="rounded-lg border bg-card p-3 space-y-1">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <UserX className="h-3.5 w-3.5" />
          Sin rol
        </div>
        <p className="text-xl font-bold tabular-nums text-muted-foreground">
          {stats.noRole}
        </p>
      </div>
    </div>
  );
}

// ── Build query helper ──

function buildQuery(search: string, riskFilter: string, typeFilter: string) {
  let q = supabase
    .from("contacts")
    .select("*, companies(name)")
    .order("name", { ascending: true });

  if (riskFilter !== "all") q = q.eq("risk_level", riskFilter);
  if (typeFilter === "customer") q = q.eq("is_customer", true);
  if (typeFilter === "supplier") q = q.eq("is_supplier", true);
  if (search.trim()) {
    const pattern = `%${search.trim()}%`;
    q = q.or(`name.ilike.${pattern},email.ilike.${pattern}`);
  }
  return q;
}

// ── Main page ──

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [search, setSearch] = useState("");
  const [riskFilter, setRiskFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchContacts = useCallback(async (searchVal: string, risk: string, type: string) => {
    setLoading(true);
    const { data } = await buildQuery(searchVal, risk, type).limit(PAGE_SIZE);
    setContacts(data ?? []);
    setHasMore((data ?? []).length === PAGE_SIZE);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchContacts("", "all", "all");
  }, [fetchContacts]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchContacts(search, riskFilter, typeFilter);
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search, riskFilter, typeFilter, fetchContacts]);

  async function loadMore() {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const { data } = await buildQuery(search, riskFilter, typeFilter)
      .range(contacts.length, contacts.length + PAGE_SIZE - 1);
    if (data) {
      setContacts((prev) => [...prev, ...(data as Contact[])]);
      setHasMore(data.length === PAGE_SIZE);
    }
    setLoadingMore(false);
  }

  function getCompanyName(contact: Contact): string | null {
    return ((contact as unknown as Record<string, unknown>).companies as { name: string } | null)?.name ?? null;
  }

  return (
    <div>
      <PageHeader
        title="Contactos"
        description="Directorio de contactos con inteligencia relacional"
      />

      {/* Quick stats */}
      {!loading && contacts.length > 0 && <QuickStats contacts={contacts} />}

      {/* Filters - horizontally scrollable on mobile */}
      <div className="flex items-center gap-3 pb-4 overflow-x-auto scrollbar-none -mx-4 px-4 sm:mx-0 sm:px-0 sm:overflow-visible">
        <div className="relative flex-1 min-w-[200px] sm:max-w-sm shrink-0">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar por nombre o email..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select
          value={riskFilter}
          onChange={(e) => setRiskFilter(e.target.value)}
          className="w-36 shrink-0"
        >
          <option value="all">Riesgo: Todos</option>
          <option value="low">Bajo</option>
          <option value="medium">Medio</option>
          <option value="high">Alto</option>
        </Select>
        <Select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="w-36 shrink-0"
        >
          <option value="all">Tipo: Todos</option>
          <option value="customer">Clientes</option>
          <option value="supplier">Proveedores</option>
        </Select>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : contacts.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Sin contactos"
          description="No se encontraron contactos con los filtros actuales."
        />
      ) : (
        <>
        {/* ─── Mobile card layout ─── */}
        <div className="space-y-3 md:hidden">
          {contacts.map((contact) => {
            const companyName = getCompanyName(contact);
            return (
              <Link
                key={contact.id}
                href={`/contacts/${contact.id}`}
                className="block rounded-lg border bg-card p-4 space-y-3 active:bg-muted/50 transition-colors"
              >
                {/* Top row: avatar + name + health dot */}
                <div className="flex items-start gap-3">
                  <Avatar className="h-10 w-10 shrink-0">
                    <AvatarFallback>{getInitials(contact.name)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">
                        {contact.name ?? "---"}
                      </span>
                      <HealthDot score={contact.current_health_score} />
                      {trendIcon(contact.health_trend)}
                    </div>
                    {companyName && (
                      <p className="text-xs text-muted-foreground truncate">{companyName}</p>
                    )}
                    {contact.role && (
                      <p className="text-xs text-muted-foreground truncate">{contact.role}</p>
                    )}
                  </div>
                  <div className="shrink-0">
                    <RiskBadge level={contact.risk_level} />
                  </div>
                </div>

                {/* Health score bar */}
                {contact.current_health_score != null && (
                  <div className="pl-[52px]">
                    <HealthBar score={contact.current_health_score} />
                  </div>
                )}

                {/* Inline metrics row */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pl-[52px] text-xs text-muted-foreground">
                  {/* Sentiment emoji */}
                  <span className="flex items-center gap-1">
                    <span>{sentimentEmoji(contact.sentiment_score)}</span>
                    <span className={cn("tabular-nums font-medium", sentimentColor(contact.sentiment_score))}>
                      {contact.sentiment_score != null ? contact.sentiment_score.toFixed(2) : "---"}
                    </span>
                  </span>

                  {/* Last activity */}
                  <span>{timeAgo(contact.last_activity)}</span>

                  {/* Open alerts */}
                  {(contact.open_alerts_count ?? 0) > 0 && (
                    <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                      <Bell className="h-3 w-3" />
                      {contact.open_alerts_count}
                    </span>
                  )}

                  {/* Emails count */}
                  <span>
                    {(contact.total_sent ?? 0) + (contact.total_received ?? 0)} emails
                  </span>
                </div>
              </Link>
            );
          })}
        </div>

        {/* ─── Desktop table layout ─── */}
        <div className="hidden md:block">
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead>Nombre</TableHead>
                <TableHead>Empresa</TableHead>
                <TableHead>Rol</TableHead>
                <TableHead>Salud</TableHead>
                <TableHead>Riesgo</TableHead>
                <TableHead className="text-center">Sent.</TableHead>
                <TableHead className="text-right">Alertas</TableHead>
                <TableHead className="text-right">Emails</TableHead>
                <TableHead>Ultima actividad</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contacts.map((contact) => {
                const companyName = getCompanyName(contact);
                return (
                  <TableRow key={contact.id} className="cursor-pointer hover:bg-muted/50">
                    <TableCell>
                      <Link href={`/contacts/${contact.id}`} className="contents">
                        <Avatar className="h-8 w-8">
                          <AvatarFallback className="text-xs">
                            {getInitials(contact.name)}
                          </AvatarFallback>
                        </Avatar>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/contacts/${contact.id}`}
                        className="font-medium hover:underline"
                      >
                        {contact.name ?? "---"}
                      </Link>
                      {contact.email && (
                        <p className="text-xs text-muted-foreground">
                          {contact.email}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {contact.company_id ? (
                        <Link href={`/companies/${contact.company_id}`} className="hover:underline hover:text-foreground">
                          {companyName ?? `Empresa #${contact.company_id}`}
                        </Link>
                      ) : "---"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {contact.role ?? <span className="italic text-muted-foreground/60">sin rol</span>}
                    </TableCell>
                    <TableCell>
                      <HealthBar score={contact.current_health_score} />
                      {contact.health_trend && (
                        <div className="flex items-center gap-1 mt-0.5">
                          {trendIcon(contact.health_trend)}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <RiskBadge level={contact.risk_level} />
                    </TableCell>
                    <TableCell className="text-center">
                      <span className="text-base" title={contact.sentiment_score != null ? `${contact.sentiment_score.toFixed(2)}` : "Sin dato"}>
                        {sentimentEmoji(contact.sentiment_score)}
                      </span>
                      <span
                        className={cn(
                          "block text-xs tabular-nums font-medium",
                          sentimentColor(contact.sentiment_score)
                        )}
                      >
                        {contact.sentiment_score != null
                          ? contact.sentiment_score.toFixed(2)
                          : "---"}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {(contact.open_alerts_count ?? 0) > 0 ? (
                        <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 font-medium">
                          <Bell className="h-3.5 w-3.5" />
                          {contact.open_alerts_count}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {(contact.total_sent ?? 0) + (contact.total_received ?? 0)}
                    </TableCell>
                    <TableCell className="text-muted-foreground whitespace-nowrap">
                      {timeAgo(contact.last_activity)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        </div>
        </>
      )}

      {hasMore && contacts.length > 0 && (
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
