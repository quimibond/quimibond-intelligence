"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle, ChevronRight, Loader2, Search, TrendingDown,
  TrendingUp, Users, UserX,
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
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

const PAGE_SIZE = 50;

function healthColor(score: number | null): string {
  if (score == null) return "text-muted-foreground";
  if (score > 60) return "text-success-foreground";
  if (score >= 40) return "text-warning-foreground";
  return "text-danger-foreground";
}

function healthBgColor(score: number | null): string {
  if (score == null) return "bg-muted";
  if (score > 60) return "bg-success";
  if (score >= 40) return "bg-warning";
  return "bg-danger";
}

function HealthBar({ score }: { score: number | null }) {
  const val = score ?? 0;
  const barBg = score == null ? "bg-muted" : score > 60 ? "bg-success/20" : score >= 40 ? "bg-warning/20" : "bg-danger/20";
  return (
    <div className="flex items-center gap-1.5">
      <div className={cn("h-1.5 w-12 rounded-full overflow-hidden", barBg)}>
        <div className={cn("h-full rounded-full", healthBgColor(score))} style={{ width: `${Math.min(100, Math.max(0, val))}%` }} />
      </div>
      <span className={cn("text-xs tabular-nums font-medium", healthColor(score))}>
        {score != null ? score : "—"}
      </span>
    </div>
  );
}

function sentimentLabel(score: number | null): string {
  if (score == null) return "—";
  if (score >= 0.6) return "Positivo";
  if (score >= 0.3) return "Neutro";
  return "Negativo";
}

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

export default function ContactsPage() {
  const router = useRouter();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [search, setSearch] = useState("");
  const [riskFilter, setRiskFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [globalStats, setGlobalStats] = useState<{ atRisk: number; avgHealth: number | null } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchContacts = useCallback(async (searchVal: string, risk: string, type: string) => {
    setLoading(true);

    const countQuery = supabase.from("contacts").select("id", { count: "exact", head: true });
    if (risk !== "all") countQuery.eq("risk_level", risk);
    if (type === "customer") countQuery.eq("is_customer", true);
    if (type === "supplier") countQuery.eq("is_supplier", true);
    if (searchVal.trim()) countQuery.or(`name.ilike.%${searchVal.trim()}%,email.ilike.%${searchVal.trim()}%`);

    const [{ data }, { count }, atRiskCount, healthRes] = await Promise.all([
      buildQuery(searchVal, risk, type).limit(PAGE_SIZE),
      countQuery,
      supabase.from("contacts").select("id", { count: "exact", head: true }).in("risk_level", ["high", "critical"]),
      supabase.from("contacts").select("current_health_score").not("current_health_score", "is", null),
    ]);

    // Compute avg health from ALL contacts (not just the page)
    const healthScores = (healthRes.data ?? []).map((c: { current_health_score: number }) => c.current_health_score);
    const avgHealth = healthScores.length > 0
      ? Math.round(healthScores.reduce((sum: number, s: number) => sum + s, 0) / healthScores.length)
      : null;
    setGlobalStats({ atRisk: atRiskCount.count ?? 0, avgHealth });

    setContacts(data ?? []);
    setTotalCount(count);
    setHasMore((data ?? []).length === PAGE_SIZE);
    setLoading(false);
  }, []);

  useEffect(() => { fetchContacts("", "all", "all"); }, [fetchContacts]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchContacts(search, riskFilter, typeFilter), 300);
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

  const stats = {
    total: totalCount ?? contacts.length,
    atRisk: globalStats?.atRisk ?? contacts.filter(c => c.risk_level === "high" || c.risk_level === "critical").length,
    avgHealth: globalStats?.avgHealth ?? null,
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Contactos" description="Directorio con inteligencia relacional" />

      {/* Quick stats */}
      {!loading && contacts.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg border bg-card p-3">
            <div className="flex items-center gap-1.5 text-[11px] sm:text-xs text-muted-foreground">
              <Users className="h-3.5 w-3.5" /> Total
            </div>
            <p className="text-xl sm:text-2xl font-bold tabular-nums mt-1">{stats.total}</p>
          </div>
          <div className="rounded-lg border bg-card p-3">
            <div className="flex items-center gap-1.5 text-[11px] sm:text-xs text-muted-foreground">
              <AlertTriangle className="h-3.5 w-3.5" /> En riesgo
            </div>
            <p className={cn("text-xl sm:text-2xl font-bold tabular-nums mt-1", stats.atRisk > 0 && "text-danger-foreground")}>
              {stats.atRisk}
            </p>
          </div>
          <div className="rounded-lg border bg-card p-3">
            <div className="flex items-center gap-1.5 text-[11px] sm:text-xs text-muted-foreground">
              <div className={cn("h-2.5 w-2.5 rounded-full", healthBgColor(stats.avgHealth))} /> Salud prom.
            </div>
            <p className={cn("text-xl sm:text-2xl font-bold tabular-nums mt-1", healthColor(stats.avgHealth))}>
              {stats.avgHealth ?? "—"}
            </p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 min-w-[200px] sm:max-w-sm">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Buscar por nombre o email..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="flex items-center gap-2">
          <Select value={riskFilter} onChange={(e) => setRiskFilter(e.target.value)} className="w-36 shrink-0">
            <option value="all">Riesgo: Todos</option>
            <option value="low">Bajo</option>
            <option value="medium">Medio</option>
            <option value="high">Alto</option>
            <option value="critical">Critico</option>
          </Select>
          <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="w-36 shrink-0">
            <option value="all">Tipo: Todos</option>
            <option value="customer">Clientes</option>
            <option value="supplier">Proveedores</option>
          </Select>
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14" />)}
        </div>
      ) : contacts.length === 0 ? (
        <EmptyState icon={Users} title="Sin contactos" description="No se encontraron contactos con los filtros actuales." />
      ) : (
        <>
          {/* ══════════════════════════════════════════════════════════════ */}
          {/* MOBILE: Compact cards                                        */}
          {/* ══════════════════════════════════════════════════════════════ */}
          <div className="space-y-2 md:hidden">
            {contacts.map((contact) => {
              const companyName = getCompanyName(contact);
              return (
                <Link key={contact.id} href={`/contacts/${contact.id}`} className="block">
                  <div className="rounded-lg border bg-card p-3 transition-colors active:bg-muted/50">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <Avatar className="h-9 w-9 shrink-0">
                          <AvatarFallback className="text-xs">{getInitials(contact.name)}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-medium truncate">{contact.name ?? "—"}</span>
                            {contact.health_trend === "up" || contact.health_trend === "improving"
                              ? <TrendingUp className="h-3 w-3 text-success shrink-0" />
                              : contact.health_trend === "down" || contact.health_trend === "declining"
                              ? <TrendingDown className="h-3 w-3 text-danger shrink-0" />
                              : null}
                          </div>
                          <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
                            {companyName && <span className="truncate">{companyName}</span>}
                            {contact.role && <span className="truncate">{contact.role}</span>}
                            {contact.current_health_score != null && (
                              <span className={cn("font-medium shrink-0", healthColor(contact.current_health_score))}>
                                {contact.current_health_score}
                              </span>
                            )}
                            {contact.last_activity && <span className="shrink-0">{timeAgo(contact.last_activity)}</span>}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <RiskBadge level={contact.risk_level} />
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>

          {/* ══════════════════════════════════════════════════════════════ */}
          {/* DESKTOP: Simplified table                                    */}
          {/* ══════════════════════════════════════════════════════════════ */}
          <div className="hidden md:block">
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Contacto</TableHead>
                    <TableHead>Empresa</TableHead>
                    <TableHead>Rol</TableHead>
                    <TableHead>Salud</TableHead>
                    <TableHead>Riesgo</TableHead>
                    <TableHead>Sentimiento</TableHead>
                    <TableHead className="text-right">Emails</TableHead>
                    <TableHead>Actividad</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {contacts.map((contact) => {
                    const companyName = getCompanyName(contact);
                    return (
                      <TableRow
                        key={contact.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => router.push(`/contacts/${contact.id}`)}
                      >
                        <TableCell>
                          <div className="flex items-center gap-2.5 min-w-0">
                            <Avatar className="h-8 w-8 shrink-0">
                              <AvatarFallback className="text-xs">{getInitials(contact.name)}</AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <p className="font-medium truncate">{contact.name ?? "—"}</p>
                              {contact.email && <p className="text-[10px] text-muted-foreground truncate">{contact.email}</p>}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {contact.company_id ? (
                            <span className="hover:text-foreground truncate block max-w-[160px]" onClick={(e) => { e.stopPropagation(); router.push(`/companies/${contact.company_id}`); }}>
                              {companyName ?? `#${contact.company_id}`}
                            </span>
                          ) : "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {contact.role ?? <span className="text-muted-foreground/50">—</span>}
                        </TableCell>
                        <TableCell>
                          <HealthBar score={contact.current_health_score} />
                        </TableCell>
                        <TableCell><RiskBadge level={contact.risk_level} /></TableCell>
                        <TableCell>
                          <span className={cn("text-sm font-medium", sentimentColor(contact.sentiment_score))}>
                            {sentimentLabel(contact.sentiment_score)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                          {(contact.total_sent ?? 0) + (contact.total_received ?? 0)}
                        </TableCell>
                        <TableCell className="text-muted-foreground whitespace-nowrap text-sm">
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

      {hasMore && contacts.length > 0 && !loading && (
        <div className="flex justify-center pt-2">
          <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
            {loadingMore && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {loadingMore ? "Cargando..." : "Cargar mas"}
          </Button>
        </div>
      )}
    </div>
  );
}
