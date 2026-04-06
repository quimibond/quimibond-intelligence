"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { cn, timeAgo, formatCurrency } from "@/lib/utils";
import type { Company } from "@/lib/types";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { MiniStatCard } from "@/components/shared/mini-stat-card";
import { FilterBar } from "@/components/shared/filter-bar";
import { LoadingGrid } from "@/components/shared/loading-grid";
import { BatchEnrichButton } from "@/components/shared/batch-enrich-button";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select-native";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Building2, Sparkles, Users, DollarSign,
  TrendingUp, ChevronDown, ChevronRight,
} from "lucide-react";

const PAGE_SIZE = 60;

type SortField = "name" | "lifetime_value" | "total_pending";
type SortDirection = "asc" | "desc";

interface CompanyExtras {
  contactCount: number;
  insightCount: number;
  lastEmailAt: string | null;
}

function buildCompanyQuery(search: string, typeFilter: string, sortField: SortField, sortDir: SortDirection) {
  let q = supabase.from("companies").select("*");

  if (search.trim()) {
    q = q.ilike("name", `%${search.trim()}%`);
  }
  if (typeFilter === "customer") q = q.eq("is_customer", true);
  if (typeFilter === "supplier") q = q.eq("is_supplier", true);

  q = q.order(sortField, { ascending: sortDir === "asc", nullsFirst: false });
  return q;
}

function getHealthIndicator(company: Company): { label: string; variant: "success" | "warning" | "critical" | "secondary" } {
  const riskCount = Array.isArray(company.risk_signals) ? company.risk_signals.length : 0;
  const trend = company.trend_pct;
  const pending = company.total_pending ?? 0;

  if (riskCount >= 3 || (trend != null && trend < -20) || pending > 500000) {
    return { label: "Critico", variant: "critical" };
  }
  if (riskCount >= 1 || (trend != null && trend < -5) || pending > 100000) {
    return { label: "Atencion", variant: "warning" };
  }
  return { label: "Sano", variant: "success" };
}

export default function CompaniesPage() {
  const router = useRouter();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDir, setSortDir] = useState<SortDirection>("asc");
  const [extras, setExtras] = useState<Record<number, CompanyExtras>>({});
  const [profiles, setProfiles] = useState<Map<number, { tier: string; risk_level: string; overdue_amount: number; late_deliveries: number }>>(new Map());
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [globalStats, setGlobalStats] = useState<{ customers: number; suppliers: number; ltv: number } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchCompanies = useCallback(async (searchVal: string, type: string, sf: SortField, sd: SortDirection) => {
    setLoading(true);

    // Get total count and first page in parallel
    const countQuery = supabase.from("companies").select("id", { count: "exact", head: true });
    if (searchVal.trim()) countQuery.ilike("name", `%${searchVal.trim()}%`);
    if (type === "customer") countQuery.eq("is_customer", true);
    if (type === "supplier") countQuery.eq("is_supplier", true);

    const [{ data }, { count }, profilesRes] = await Promise.all([
      buildCompanyQuery(searchVal, type, sf, sd).range(0, PAGE_SIZE - 1),
      countQuery,
      supabase.from("company_profile")
        .select("company_id, tier, risk_level, overdue_amount, late_deliveries, revenue_90d")
        .order("total_revenue", { ascending: false })
        .limit(200),
    ]);

    setGlobalStats({ customers: 0, suppliers: 0, ltv: 0 });

    // Build profile map for mobile cards
    const profileMap = new Map<number, { tier: string; risk_level: string; overdue_amount: number; late_deliveries: number }>();
    for (const p of profilesRes.data ?? []) {
      profileMap.set(p.company_id, p as { tier: string; risk_level: string; overdue_amount: number; late_deliveries: number });
    }
    setProfiles(profileMap);

    const results = (data ?? []) as Company[];
    setCompanies(results);
    setTotalCount(count);
    setHasMore(results.length === PAGE_SIZE);
    setLoading(false);
  }, []);

  const fetchExtras = useCallback(async (companyIds: number[]) => {
    if (companyIds.length === 0) return;

    const [contactsRes, insightsRes, emailsRes] = await Promise.all([
      supabase.from("contacts").select("company_id").in("company_id", companyIds),
      supabase.from("agent_insights").select("company_id")
        .in("company_id", companyIds).in("state", ["new", "seen"]),
      supabase.from("emails").select("company_id, email_date")
        .in("company_id", companyIds).order("email_date", { ascending: false }),
    ]);

    const newExtras: Record<number, CompanyExtras> = {};
    for (const id of companyIds) {
      newExtras[id] = { contactCount: 0, insightCount: 0, lastEmailAt: null };
    }

    if (contactsRes.data) {
      for (const row of contactsRes.data) {
        if (row.company_id && newExtras[row.company_id]) newExtras[row.company_id].contactCount++;
      }
    }
    if (insightsRes.data) {
      for (const row of insightsRes.data) {
        if (row.company_id && newExtras[row.company_id]) newExtras[row.company_id].insightCount++;
      }
    }
    if (emailsRes.data) {
      for (const row of emailsRes.data) {
        if (row.company_id && newExtras[row.company_id] && !newExtras[row.company_id].lastEmailAt) {
          newExtras[row.company_id].lastEmailAt = row.email_date;
        }
      }
    }

    setExtras((prev) => ({ ...prev, ...newExtras }));
  }, []);

  useEffect(() => { fetchCompanies("", "all", "name", "asc"); }, [fetchCompanies]);

  useEffect(() => {
    if (companies.length > 0) fetchExtras(companies.map((c) => c.id));
  }, [companies, fetchExtras]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchCompanies(search, typeFilter, sortField, sortDir), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search, typeFilter, sortField, sortDir, fetchCompanies]);

  async function loadMore() {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const { data } = await buildCompanyQuery(search, typeFilter, sortField, sortDir)
      .range(companies.length, companies.length + PAGE_SIZE - 1);
    if (data) {
      const newCompanies = data as Company[];
      setCompanies((prev) => [...prev, ...newCompanies]);
      setHasMore(data.length === PAGE_SIZE);
      fetchExtras(newCompanies.map((c) => c.id));
    }
    setLoadingMore(false);
  }

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir(field === "name" ? "asc" : "desc");
    }
  }

  const stats = {
    total: totalCount ?? companies.length,
    customers: globalStats?.customers ?? companies.filter((c) => c.is_customer).length,
    suppliers: globalStats?.suppliers ?? companies.filter((c) => c.is_supplier).length,
    ltv: globalStats?.ltv ?? companies.reduce((sum, c) => sum + (c.lifetime_value ?? 0), 0),
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black">Empresas</h1>
          <p className="text-xs text-muted-foreground">{stats.total} empresas</p>
        </div>
        <div className="hidden md:block"><BatchEnrichButton type="companies" /></div>
      </div>

      {/* Search + Filters */}
      <FilterBar search={search} onSearchChange={setSearch} searchPlaceholder="Buscar...">
        <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="w-28 shrink-0" aria-label="Tipo">
          <option value="all">Todas</option>
          <option value="customer">Clientes</option>
          <option value="supplier">Proveedores</option>
        </Select>
        <Select
          value={`${sortField}-${sortDir}`}
          onChange={(e) => {
            const [f, d] = e.target.value.split("-") as [SortField, SortDirection];
            setSortField(f);
            setSortDir(d);
          }}
          className="w-36 shrink-0 hidden md:block"
          aria-label="Ordenar"
        >
          <option value="name-asc">Nombre A-Z</option>
          <option value="lifetime_value-desc">Mayor valor</option>
          <option value="total_pending-desc">Mayor pendiente</option>
        </Select>
      </FilterBar>

      {/* Loading */}
      {loading && <LoadingGrid stats={4} rows={6} />}

      {/* Empty state */}
      {!loading && companies.length === 0 && (
        <EmptyState
          icon={Building2}
          title="Sin empresas"
          description={search ? "No se encontraron empresas con ese nombre." : "Aun no hay empresas en el sistema."}
        />
      )}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* MOBILE: Card layout                                          */}
      {/* ══════════════════════════════════════════════════════════════ */}
      {!loading && companies.length > 0 && (
        <div className="space-y-2 md:hidden">
          {companies.map((company) => {
            const profile = profiles.get(company.id);
            const overdue = profile?.overdue_amount ?? 0;
            const lateDeliveries = profile?.late_deliveries ?? 0;
            const hasProblems = overdue > 0 || lateDeliveries > 0;

            // Build status line
            const statusParts: string[] = [];
            if (overdue > 0) statusParts.push(`${formatCurrency(overdue)} vencido`);
            if (lateDeliveries > 0) statusParts.push(`${lateDeliveries} entrega${lateDeliveries !== 1 ? "s" : ""} tarde`);
            const statusLine = statusParts.length > 0 ? statusParts.join(" · ") : "Sin alertas";

            const tierColors: Record<string, string> = {
              strategic: "text-domain-relationships bg-domain-relationships/10",
              important: "text-info-foreground bg-info/10",
              key_supplier: "text-warning-foreground bg-warning/10",
            };

            return (
              <Link key={company.id} href={`/companies/${company.id}`} className="block">
                <div className={cn(
                  "rounded-2xl border bg-card p-4 active:bg-muted/50 transition-colors",
                  hasProblems && "border-l-4 border-l-danger/50"
                )}>
                  {/* Row 1: Name + tier */}
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <p className="text-[15px] font-bold truncate">{company.name}</p>
                    {profile?.tier && profile.tier !== "minor" && profile.tier !== "regular" && (
                      <span className={cn("text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0", tierColors[profile.tier] ?? "bg-muted text-muted-foreground")}>
                        {profile.tier}
                      </span>
                    )}
                  </div>
                  {/* Row 2: Revenue */}
                  <p className="text-sm font-semibold tabular-nums">
                    {company.lifetime_value != null && company.lifetime_value > 0 ? formatCurrency(company.lifetime_value) : "—"}
                  </p>
                  {/* Row 3: Status */}
                  <p className={cn("text-xs mt-1", hasProblems ? "text-danger" : "text-muted-foreground")}>
                    {statusLine}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* DESKTOP: Table layout (simplified columns)                   */}
      {/* ══════════════════════════════════════════════════════════════ */}
      {!loading && companies.length > 0 && (
        <div className="hidden md:block">
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <button onClick={() => toggleSort("name")} className="flex items-center gap-1 hover:text-foreground transition-colors">
                      Empresa
                      {sortField === "name" && <ChevronDown className={cn("h-3 w-3 transition-transform", sortDir === "asc" && "rotate-180")} />}
                    </button>
                  </TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>
                    <button onClick={() => toggleSort("lifetime_value")} className="flex items-center gap-1 hover:text-foreground transition-colors">
                      Valor
                      {sortField === "lifetime_value" && <ChevronDown className={cn("h-3 w-3 transition-transform", sortDir === "asc" && "rotate-180")} />}
                    </button>
                  </TableHead>
                  <TableHead>
                    <button onClick={() => toggleSort("total_pending")} className="flex items-center gap-1 hover:text-foreground transition-colors">
                      Pendiente
                      {sortField === "total_pending" && <ChevronDown className={cn("h-3 w-3 transition-transform", sortDir === "asc" && "rotate-180")} />}
                    </button>
                  </TableHead>
                  <TableHead>Salud</TableHead>
                  <TableHead className="text-center">Contactos</TableHead>
                  <TableHead className="text-center">Insights</TableHead>
                  <TableHead>Ultimo email</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {companies.map((company) => {
                  const health = getHealthIndicator(company);
                  const ext = extras[company.id];
                  return (
                    <TableRow
                      key={company.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => router.push(`/companies/${company.id}`)}
                    >
                      <TableCell>
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                            <Building2 className="h-4 w-4 text-primary" />
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium truncate">{company.name}</p>
                            {company.city && <p className="text-[10px] text-muted-foreground truncate">{company.city}</p>}
                          </div>
                          {company.enriched_at && <Sparkles className="h-3 w-3 text-warning shrink-0" />}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {company.is_customer && <Badge variant="success" className="text-[10px]">Cliente</Badge>}
                          {company.is_supplier && <Badge variant="info" className="text-[10px]">Proveedor</Badge>}
                        </div>
                      </TableCell>
                      <TableCell>
                        {company.lifetime_value != null && company.lifetime_value > 0 ? (
                          <span className="font-semibold tabular-nums text-success-foreground text-sm">
                            {formatCurrency(company.lifetime_value)}
                          </span>
                        ) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>
                        {company.total_pending != null && company.total_pending > 0 ? (
                          <span className="font-semibold tabular-nums text-danger-foreground text-sm">
                            {formatCurrency(company.total_pending)}
                          </span>
                        ) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell><Badge variant={health.variant}>{health.label}</Badge></TableCell>
                      <TableCell className="text-center tabular-nums text-muted-foreground">{ext?.contactCount ?? "—"}</TableCell>
                      <TableCell className="text-center">
                        {ext && ext.insightCount > 0 ? (
                          <Badge variant="warning" className="text-[10px]">{ext.insightCount}</Badge>
                        ) : <span className="text-muted-foreground tabular-nums">{ext ? "0" : "—"}</span>}
                      </TableCell>
                      <TableCell className="text-muted-foreground whitespace-nowrap text-sm">
                        {ext?.lastEmailAt ? timeAgo(ext.lastEmailAt) : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Load more */}
      {hasMore && companies.length > 0 && !loading && (
        <div className="flex justify-center pt-2">
          <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? "Cargando..." : "Cargar mas empresas"}
          </Button>
        </div>
      )}
    </div>
  );
}
