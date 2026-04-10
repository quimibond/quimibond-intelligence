"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { cn, timeAgo, formatCurrency } from "@/lib/utils";
import type { CompanyProfile } from "@/lib/types";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { LoadingGrid } from "@/components/shared/loading-grid";
import { BatchEnrichButton } from "@/components/shared/batch-enrich-button";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select-native";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Building2, Sparkles, ChevronDown, TrendingUp, TrendingDown, AlertTriangle,
} from "lucide-react";

const PAGE_SIZE = 60;

type SortField = "name" | "total_revenue" | "overdue_amount" | "revenue_90d" | "trend_pct";
type SortDirection = "asc" | "desc";

const TIER_CONFIG: Record<string, { label: string; variant: "info" | "success" | "warning" | "secondary" }> = {
  strategic: { label: "Strategic", variant: "info" },
  important: { label: "Important", variant: "success" },
  key_supplier: { label: "Proveedor clave", variant: "warning" },
  regular: { label: "Regular", variant: "secondary" },
  minor: { label: "Minor", variant: "secondary" },
};

function fmtCompact(v: number | null): string {
  if (v == null) return "—";
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `$${Math.round(v / 1_000)}K`;
  return `$${Math.round(v)}`;
}

export default function CompaniesPage() {
  const router = useRouter();
  const [companies, setCompanies] = useState<CompanyProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [tierFilter, setTierFilter] = useState("all");
  const [sortField, setSortField] = useState<SortField>("total_revenue");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function buildQuery(searchVal: string, type: string, tier: string, sf: SortField, sd: SortDirection) {
    let q = supabase.from("company_profile")
      .select("company_id, name, is_customer, is_supplier, industry, total_revenue, revenue_90d, revenue_prior_90d, trend_pct, pending_amount, overdue_amount, overdue_count, max_days_overdue, total_deliveries, late_deliveries, otd_rate, email_count, last_email_date, contact_count, risk_level, tier, revenue_share_pct, total_orders, last_order_date");

    if (searchVal.trim()) q = q.ilike("name", `%${searchVal.trim()}%`);
    if (type === "customer") q = q.eq("is_customer", true);
    if (type === "supplier") q = q.eq("is_supplier", true);
    if (tier !== "all") q = q.eq("tier", tier);

    q = q.order(sf, { ascending: sd === "asc", nullsFirst: false });
    return q;
  }

  const fetchCompanies = useCallback(async (searchVal: string, type: string, tier: string, sf: SortField, sd: SortDirection) => {
    setLoading(true);

    const countQuery = supabase.from("company_profile").select("company_id", { count: "exact", head: true });
    if (searchVal.trim()) countQuery.ilike("name", `%${searchVal.trim()}%`);
    if (type === "customer") countQuery.eq("is_customer", true);
    if (type === "supplier") countQuery.eq("is_supplier", true);
    if (tier !== "all") countQuery.eq("tier", tier);

    const [{ data }, { count }] = await Promise.all([
      buildQuery(searchVal, type, tier, sf, sd).range(0, PAGE_SIZE - 1),
      countQuery,
    ]);

    setCompanies((data ?? []) as CompanyProfile[]);
    setTotalCount(count);
    setHasMore((data ?? []).length === PAGE_SIZE);
    setLoading(false);
  }, []);

  useEffect(() => { fetchCompanies("", "all", "all", "total_revenue", "desc"); }, [fetchCompanies]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchCompanies(search, typeFilter, tierFilter, sortField, sortDir), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search, typeFilter, tierFilter, sortField, sortDir, fetchCompanies]);

  async function loadMore() {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const { data } = await buildQuery(search, typeFilter, tierFilter, sortField, sortDir)
      .range(companies.length, companies.length + PAGE_SIZE - 1);
    if (data) {
      setCompanies((prev) => [...prev, ...(data as CompanyProfile[])]);
      setHasMore(data.length === PAGE_SIZE);
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

  // Stats from current data
  const overdueTotal = companies.reduce((s, c) => s + (c.overdue_amount ?? 0), 0);
  const revenueTotal = companies.reduce((s, c) => s + (c.total_revenue ?? 0), 0);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black">Empresas</h1>
          <p className="text-xs text-muted-foreground">
            {totalCount ?? companies.length} empresas
            {overdueTotal > 0 && <> · <span className="text-danger font-medium">{fmtCompact(overdueTotal)} vencido</span></>}
          </p>
        </div>
        <div className="hidden md:block"><BatchEnrichButton type="companies" /></div>
      </div>

      {/* Filters */}
      <FilterBar search={search} onSearchChange={setSearch} searchPlaceholder="Buscar empresa...">
        <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="w-28 shrink-0" aria-label="Tipo">
          <option value="all">Todas</option>
          <option value="customer">Clientes</option>
          <option value="supplier">Proveedores</option>
        </Select>
        <Select value={tierFilter} onChange={(e) => setTierFilter(e.target.value)} className="w-32 shrink-0" aria-label="Tier">
          <option value="all">Todos los tiers</option>
          <option value="strategic">Strategic</option>
          <option value="important">Important</option>
          <option value="key_supplier">Proveedor clave</option>
          <option value="regular">Regular</option>
        </Select>
        <Select
          value={`${sortField}-${sortDir}`}
          onChange={(e) => {
            const [f, d] = e.target.value.split("-") as [SortField, SortDirection];
            setSortField(f); setSortDir(d);
          }}
          className="w-40 shrink-0 hidden md:block"
          aria-label="Ordenar"
        >
          <option value="total_revenue-desc">Mayor revenue</option>
          <option value="revenue_90d-desc">Mayor 90d</option>
          <option value="overdue_amount-desc">Mayor vencido</option>
          <option value="trend_pct-desc">Mejor tendencia</option>
          <option value="trend_pct-asc">Peor tendencia</option>
          <option value="name-asc">Nombre A-Z</option>
        </Select>
      </FilterBar>

      {/* Loading */}
      {loading && <LoadingGrid rows={8} />}

      {/* Empty */}
      {!loading && companies.length === 0 && (
        <EmptyState icon={Building2} title="Sin empresas"
          description={search ? "No se encontraron empresas con ese nombre." : "Aun no hay empresas en el sistema."} />
      )}

      {/* ══════════ MOBILE ══════════ */}
      {!loading && companies.length > 0 && (
        <div className="space-y-2 md:hidden">
          {companies.map((c) => {
            const hasOverdue = (c.overdue_amount ?? 0) > 0;
            const hasLate = (c.late_deliveries ?? 0) > 0;
            const tierCfg = TIER_CONFIG[c.tier ?? ""] ?? null;

            return (
              <Link key={c.company_id} href={`/companies/${c.company_id}`} className="block">
                <Card className={cn(
                  "active:bg-muted/50 transition-colors",
                  (hasOverdue || hasLate) && "border-l-4 border-l-danger/50"
                )}>
                <CardContent className="p-3.5">
                  {/* Row 1: Name + tier + risk */}
                  <div className="flex items-center gap-2 mb-1.5">
                    <p className="text-[15px] font-bold truncate flex-1">{c.name}</p>
                    {tierCfg && c.tier !== "minor" && c.tier !== "regular" && (
                      <Badge variant={tierCfg.variant} className="text-[10px] shrink-0">{tierCfg.label}</Badge>
                    )}
                    {c.risk_level && c.risk_level !== "low" && (
                      <Badge variant={c.risk_level === "critical" ? "critical" : "warning"} className="text-[10px] shrink-0">
                        {c.risk_level}
                      </Badge>
                    )}
                  </div>

                  {/* Row 2: Revenue stats */}
                  <div className="grid grid-cols-3 gap-2 text-center mb-2">
                    <div>
                      <p className="text-sm font-bold tabular-nums">{fmtCompact(c.total_revenue)}</p>
                      <p className="text-[10px] text-muted-foreground">total</p>
                    </div>
                    <div>
                      <p className="text-sm font-bold tabular-nums">{fmtCompact(c.revenue_90d)}</p>
                      <p className="text-[10px] text-muted-foreground">90d</p>
                    </div>
                    <div>
                      <p className={cn("text-sm font-bold tabular-nums",
                        (c.trend_pct ?? 0) > 0 ? "text-success" : (c.trend_pct ?? 0) < -5 ? "text-danger" : ""
                      )}>
                        {c.trend_pct != null ? `${c.trend_pct > 0 ? "+" : ""}${Math.round(c.trend_pct)}%` : "—"}
                      </p>
                      <p className="text-[10px] text-muted-foreground">tendencia</p>
                    </div>
                  </div>

                  {/* Row 3: Alerts line */}
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    {hasOverdue && (
                      <span className="text-danger font-medium">{fmtCompact(c.overdue_amount)} vencido</span>
                    )}
                    {hasLate && (
                      <span className="text-danger">{c.late_deliveries} entrega{(c.late_deliveries ?? 0) !== 1 ? "s" : ""} tarde</span>
                    )}
                    {c.otd_rate != null && (
                      <span>OTD {Math.round(c.otd_rate)}%</span>
                    )}
                    {c.contact_count != null && c.contact_count > 0 && (
                      <span>{c.contact_count} contactos</span>
                    )}
                    {!hasOverdue && !hasLate && <span>Sin alertas</span>}
                  </div>
                </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      {/* ══════════ DESKTOP ══════════ */}
      {!loading && companies.length > 0 && (
        <div className="hidden md:block">
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <button onClick={() => toggleSort("name")} className="flex items-center gap-1 hover:text-foreground transition-colors">
                      Empresa {sortField === "name" && <ChevronDown className={cn("h-3 w-3", sortDir === "asc" && "rotate-180")} />}
                    </button>
                  </TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead>
                    <button onClick={() => toggleSort("total_revenue")} className="flex items-center gap-1 hover:text-foreground transition-colors">
                      Revenue {sortField === "total_revenue" && <ChevronDown className={cn("h-3 w-3", sortDir === "asc" && "rotate-180")} />}
                    </button>
                  </TableHead>
                  <TableHead>
                    <button onClick={() => toggleSort("revenue_90d")} className="flex items-center gap-1 hover:text-foreground transition-colors">
                      90d {sortField === "revenue_90d" && <ChevronDown className={cn("h-3 w-3", sortDir === "asc" && "rotate-180")} />}
                    </button>
                  </TableHead>
                  <TableHead>
                    <button onClick={() => toggleSort("trend_pct")} className="flex items-center gap-1 hover:text-foreground transition-colors">
                      Trend {sortField === "trend_pct" && <ChevronDown className={cn("h-3 w-3", sortDir === "asc" && "rotate-180")} />}
                    </button>
                  </TableHead>
                  <TableHead>
                    <button onClick={() => toggleSort("overdue_amount")} className="flex items-center gap-1 hover:text-foreground transition-colors">
                      Vencido {sortField === "overdue_amount" && <ChevronDown className={cn("h-3 w-3", sortDir === "asc" && "rotate-180")} />}
                    </button>
                  </TableHead>
                  <TableHead>OTD</TableHead>
                  <TableHead>Riesgo</TableHead>
                  <TableHead className="text-right">Contactos</TableHead>
                  <TableHead>Email</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {companies.map((c) => {
                  const tierCfg = TIER_CONFIG[c.tier ?? ""] ?? null;
                  return (
                    <TableRow key={c.company_id} className="cursor-pointer hover:bg-muted/50"
                      onClick={() => router.push(`/companies/${c.company_id}`)}>
                      <TableCell>
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                            <Building2 className="h-4 w-4 text-primary" />
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium truncate max-w-[200px]">{c.name}</p>
                            <div className="flex gap-1">
                              {c.is_customer && <span className="text-[9px] text-success">Cliente</span>}
                              {c.is_supplier && <span className="text-[9px] text-info-foreground">Proveedor</span>}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {tierCfg && c.tier !== "minor" ? (
                          <Badge variant={tierCfg.variant} className="text-[10px]">{tierCfg.label}</Badge>
                        ) : <span className="text-muted-foreground text-xs">—</span>}
                      </TableCell>
                      <TableCell className="tabular-nums font-medium text-sm">
                        {fmtCompact(c.total_revenue)}
                      </TableCell>
                      <TableCell className="tabular-nums text-sm">
                        {fmtCompact(c.revenue_90d)}
                      </TableCell>
                      <TableCell>
                        {c.trend_pct != null ? (
                          <span className={cn("text-sm tabular-nums font-medium flex items-center gap-1",
                            c.trend_pct > 0 ? "text-success" : c.trend_pct < -5 ? "text-danger" : "text-muted-foreground"
                          )}>
                            {c.trend_pct > 0 ? <TrendingUp className="h-3 w-3" /> : c.trend_pct < -5 ? <TrendingDown className="h-3 w-3" /> : null}
                            {c.trend_pct > 0 ? "+" : ""}{Math.round(c.trend_pct)}%
                          </span>
                        ) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>
                        {(c.overdue_amount ?? 0) > 0 ? (
                          <div>
                            <span className="text-sm font-medium tabular-nums text-danger">{fmtCompact(c.overdue_amount)}</span>
                            {c.max_days_overdue != null && c.max_days_overdue > 30 && (
                              <p className="text-[10px] text-danger">{c.max_days_overdue}d max</p>
                            )}
                          </div>
                        ) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>
                        {c.otd_rate != null ? (
                          <div className="flex items-center gap-1.5">
                            <Progress value={c.otd_rate} className="h-1.5 w-10" />
                            <span className={cn("text-xs tabular-nums", c.otd_rate >= 90 ? "text-success" : c.otd_rate < 70 ? "text-danger" : "")}>
                              {Math.round(c.otd_rate)}%
                            </span>
                          </div>
                        ) : <span className="text-muted-foreground text-xs">—</span>}
                      </TableCell>
                      <TableCell>
                        {c.risk_level && c.risk_level !== "low" ? (
                          <Badge variant={c.risk_level === "critical" ? "critical" : "warning"} className="text-[10px]">
                            {c.risk_level}
                          </Badge>
                        ) : <span className="text-[10px] text-success">bajo</span>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground text-sm">
                        {c.contact_count ?? "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground whitespace-nowrap text-xs">
                        {c.last_email_date ? timeAgo(c.last_email_date) : "—"}
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
            {loadingMore ? "Cargando..." : "Cargar mas"}
          </Button>
        </div>
      )}
    </div>
  );
}
