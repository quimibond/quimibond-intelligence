"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { timeAgo, formatCurrency } from "@/lib/utils";
import type { Company } from "@/lib/types";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { BatchEnrichButton } from "@/components/shared/batch-enrich-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Building2,
  Search,
  MapPin,
  Sparkles,
  Users,
  AlertTriangle,
  Mail,
  DollarSign,
  ShieldAlert,
  TrendingUp,
  ChevronDown,
} from "lucide-react";

const PAGE_SIZE = 60;

type SortField = "name" | "lifetime_value" | "risk_signals";
type SortDirection = "asc" | "desc";

// Extra data fetched per company via separate queries
interface CompanyExtras {
  contactCount: number;
  openAlertCount: number;
  lastEmailAt: string | null;
}

function buildCompanyQuery(search: string, typeFilter: string, sortField: SortField, sortDir: SortDirection) {
  let q = supabase.from("companies").select("*");

  if (search.trim()) {
    q = q.ilike("name", `%${search.trim()}%`);
  }
  if (typeFilter === "customer") q = q.eq("is_customer", true);
  if (typeFilter === "supplier") q = q.eq("is_supplier", true);

  // Apply sorting
  if (sortField === "name") {
    q = q.order("name", { ascending: sortDir === "asc" });
  } else if (sortField === "lifetime_value") {
    q = q.order("lifetime_value", { ascending: sortDir === "asc", nullsFirst: false });
  } else if (sortField === "risk_signals") {
    // Sort by name as fallback since risk_signals is JSON; client-side sort applied after
    q = q.order("name", { ascending: true });
  }

  return q;
}

function getRiskSignalCount(company: Company): number {
  if (!company.risk_signals) return 0;
  if (Array.isArray(company.risk_signals)) return company.risk_signals.length;
  return 0;
}

function getHealthIndicator(company: Company): { label: string; color: string; variant: "success" | "warning" | "critical" | "secondary" } {
  const riskCount = getRiskSignalCount(company);
  const trend = company.trend_pct;

  if (riskCount >= 3 || (trend != null && trend < -20)) {
    return { label: "Critico", color: "text-red-600 dark:text-red-400", variant: "critical" };
  }
  if (riskCount >= 1 || (trend != null && trend < -5)) {
    return { label: "Atencion", color: "text-amber-600 dark:text-amber-400", variant: "warning" };
  }
  return { label: "Sano", color: "text-emerald-600 dark:text-emerald-400", variant: "success" };
}

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDir, setSortDir] = useState<SortDirection>("asc");
  const [extras, setExtras] = useState<Record<number, CompanyExtras>>({});
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchCompanies = useCallback(async (searchVal: string, type: string, sf: SortField, sd: SortDirection) => {
    setLoading(true);
    const { data } = await buildCompanyQuery(searchVal, type, sf, sd).range(0, PAGE_SIZE - 1);
    let results = (data ?? []) as Company[];

    // Client-side sort for risk_signals
    if (sf === "risk_signals") {
      results = [...results].sort((a, b) => {
        const diff = getRiskSignalCount(a) - getRiskSignalCount(b);
        return sd === "asc" ? diff : -diff;
      });
    }

    setCompanies(results);
    setHasMore(results.length === PAGE_SIZE);
    setLoading(false);
  }, []);

  // Fetch extra info (contacts count, open alerts, last email) for loaded companies
  const fetchExtras = useCallback(async (companyIds: number[]) => {
    if (companyIds.length === 0) return;

    const [contactsRes, alertsRes, emailsRes] = await Promise.all([
      supabase
        .from("contacts")
        .select("company_id")
        .in("company_id", companyIds),
      supabase
        .from("alerts")
        .select("company_id")
        .in("company_id", companyIds)
        .in("state", ["new", "acknowledged"]),
      supabase
        .from("emails")
        .select("company_id, date")
        .in("company_id", companyIds)
        .order("date", { ascending: false }),
    ]);

    const newExtras: Record<number, CompanyExtras> = {};
    for (const id of companyIds) {
      newExtras[id] = { contactCount: 0, openAlertCount: 0, lastEmailAt: null };
    }

    // Count contacts per company
    if (contactsRes.data) {
      for (const row of contactsRes.data) {
        if (row.company_id && newExtras[row.company_id]) {
          newExtras[row.company_id].contactCount++;
        }
      }
    }

    // Count open alerts per company
    if (alertsRes.data) {
      for (const row of alertsRes.data) {
        if (row.company_id && newExtras[row.company_id]) {
          newExtras[row.company_id].openAlertCount++;
        }
      }
    }

    // Last email per company (take the first occurrence since sorted desc)
    if (emailsRes.data) {
      for (const row of emailsRes.data) {
        if (row.company_id && newExtras[row.company_id] && !newExtras[row.company_id].lastEmailAt) {
          newExtras[row.company_id].lastEmailAt = row.date;
        }
      }
    }

    setExtras((prev) => ({ ...prev, ...newExtras }));
  }, []);

  useEffect(() => { fetchCompanies("", "all", "name", "asc"); }, [fetchCompanies]);

  useEffect(() => {
    if (companies.length > 0) {
      fetchExtras(companies.map((c) => c.id));
    }
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

  // Quick stats computed from loaded companies
  const stats = useMemo(() => {
    const totalCustomers = companies.filter((c) => c.is_customer).length;
    const totalSuppliers = companies.filter((c) => c.is_supplier).length;
    const totalLtv = companies.reduce((sum, c) => sum + (c.lifetime_value ?? 0), 0);
    return {
      total: companies.length,
      customers: totalCustomers,
      suppliers: totalSuppliers,
      ltv: totalLtv,
    };
  }, [companies]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Empresas"
        description="Directorio de empresas e inteligencia comercial"
      >
        <BatchEnrichButton type="companies" />
      </PageHeader>

      {/* Quick Stats Bar */}
      {!loading && companies.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border bg-card p-3">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Building2 className="h-4 w-4" />
              <span className="text-xs font-medium">Total empresas</span>
            </div>
            <p className="mt-1 text-2xl font-bold tabular-nums">{stats.total}{hasMore ? "+" : ""}</p>
          </div>
          <div className="rounded-lg border bg-card p-3">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Users className="h-4 w-4" />
              <span className="text-xs font-medium">Clientes</span>
            </div>
            <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{stats.customers}</p>
          </div>
          <div className="rounded-lg border bg-card p-3">
            <div className="flex items-center gap-2 text-muted-foreground">
              <TrendingUp className="h-4 w-4" />
              <span className="text-xs font-medium">Proveedores</span>
            </div>
            <p className="mt-1 text-2xl font-bold tabular-nums text-blue-600 dark:text-blue-400">{stats.suppliers}</p>
          </div>
          <div className="rounded-lg border bg-card p-3">
            <div className="flex items-center gap-2 text-muted-foreground">
              <DollarSign className="h-4 w-4" />
              <span className="text-xs font-medium">Valor total</span>
            </div>
            <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{formatCurrency(stats.ltv)}</p>
          </div>
        </div>
      )}

      {/* Search + Filters + Sort */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar empresa..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Filter badges - horizontally scrollable on mobile */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
          <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="w-32 shrink-0">
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
            className="w-44 shrink-0"
          >
            <option value="name-asc">Nombre A-Z</option>
            <option value="name-desc">Nombre Z-A</option>
            <option value="lifetime_value-desc">Mayor valor</option>
            <option value="lifetime_value-asc">Menor valor</option>
            <option value="risk_signals-desc">Mayor riesgo</option>
            <option value="risk_signals-asc">Menor riesgo</option>
          </Select>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <>
          {/* Stats skeleton */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[76px] w-full" />
            ))}
          </div>
          {/* Cards skeleton for mobile, table skeleton for desktop */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-[180px] w-full" />
            ))}
          </div>
        </>
      )}

      {/* Empty state */}
      {!loading && companies.length === 0 && (
        <EmptyState
          icon={Building2}
          title="Sin empresas"
          description={
            search
              ? "No se encontraron empresas con ese nombre."
              : "Aun no hay empresas registradas en el sistema."
          }
        />
      )}

      {/* Mobile Card Layout */}
      {!loading && companies.length > 0 && (
        <div className="space-y-3 md:hidden">
          {companies.map((company) => {
            const health = getHealthIndicator(company);
            const riskCount = getRiskSignalCount(company);
            const ext = extras[company.id];
            return (
              <Link key={company.id} href={`/companies/${company.id}`}>
                <div className="rounded-lg border bg-card p-4 space-y-3 transition-colors hover:border-primary/30 active:bg-muted/50">
                  {/* Header: name + health */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                        <Building2 className="h-5 w-5 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold leading-tight truncate">{company.name}</p>
                        {(company.city || company.country) && (
                          <p className="text-xs text-muted-foreground truncate mt-0.5">
                            {[company.city, company.country].filter(Boolean).join(", ")}
                          </p>
                        )}
                      </div>
                    </div>
                    <Badge variant={health.variant} className="shrink-0">{health.label}</Badge>
                  </div>

                  {/* Badges row */}
                  <div className="flex flex-wrap gap-1.5">
                    {company.is_customer && <Badge variant="success">Cliente</Badge>}
                    {company.is_supplier && <Badge variant="info">Proveedor</Badge>}
                    {company.industry && <Badge variant="secondary">{company.industry}</Badge>}
                  </div>

                  {/* Key metrics row */}
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    {company.lifetime_value != null && company.lifetime_value > 0 && (
                      <span className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                        {formatCurrency(company.lifetime_value)}
                      </span>
                    )}
                    {riskCount > 0 && (
                      <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                        <ShieldAlert className="h-3 w-3" />
                        {riskCount} riesgo{riskCount !== 1 ? "s" : ""}
                      </span>
                    )}
                  </div>

                  {/* Extra info row */}
                  <div className="flex items-center gap-3 text-xs text-muted-foreground border-t pt-2">
                    {ext && (
                      <>
                        <span className="flex items-center gap-1">
                          <Users className="h-3 w-3" />
                          {ext.contactCount}
                        </span>
                        {ext.openAlertCount > 0 && (
                          <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                            <AlertTriangle className="h-3 w-3" />
                            {ext.openAlertCount}
                          </span>
                        )}
                        {ext.lastEmailAt && (
                          <span className="flex items-center gap-1">
                            <Mail className="h-3 w-3" />
                            {timeAgo(ext.lastEmailAt)}
                          </span>
                        )}
                      </>
                    )}
                    {company.enriched_at && (
                      <span className="flex items-center gap-1 ml-auto" title={`Enriquecido ${timeAgo(company.enriched_at)}`}>
                        <Sparkles className="h-3 w-3 text-amber-500" />
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {/* Desktop Table Layout */}
      {!loading && companies.length > 0 && (
        <div className="hidden md:block">
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10" />
                  <TableHead>
                    <button
                      onClick={() => toggleSort("name")}
                      className="flex items-center gap-1 hover:text-foreground transition-colors"
                    >
                      Nombre
                      {sortField === "name" && <ChevronDown className={`h-3 w-3 transition-transform ${sortDir === "asc" ? "rotate-180" : ""}`} />}
                    </button>
                  </TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Industria</TableHead>
                  <TableHead>
                    <button
                      onClick={() => toggleSort("lifetime_value")}
                      className="flex items-center gap-1 hover:text-foreground transition-colors"
                    >
                      Valor
                      {sortField === "lifetime_value" && <ChevronDown className={`h-3 w-3 transition-transform ${sortDir === "asc" ? "rotate-180" : ""}`} />}
                    </button>
                  </TableHead>
                  <TableHead>
                    <button
                      onClick={() => toggleSort("risk_signals")}
                      className="flex items-center gap-1 hover:text-foreground transition-colors"
                    >
                      Riesgos
                      {sortField === "risk_signals" && <ChevronDown className={`h-3 w-3 transition-transform ${sortDir === "asc" ? "rotate-180" : ""}`} />}
                    </button>
                  </TableHead>
                  <TableHead>Salud</TableHead>
                  <TableHead className="text-center">Contactos</TableHead>
                  <TableHead className="text-center">Alertas</TableHead>
                  <TableHead>Ultimo email</TableHead>
                  <TableHead>Ubicacion</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {companies.map((company) => {
                  const health = getHealthIndicator(company);
                  const riskCount = getRiskSignalCount(company);
                  const ext = extras[company.id];
                  return (
                    <TableRow key={company.id} className="cursor-pointer hover:bg-muted/50">
                      <TableCell>
                        <Link href={`/companies/${company.id}`} className="contents">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                            <Building2 className="h-4 w-4 text-primary" />
                          </div>
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Link href={`/companies/${company.id}`} className="font-medium hover:underline">
                          {company.name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {company.is_customer && <Badge variant="success">Cliente</Badge>}
                          {company.is_supplier && <Badge variant="info">Proveedor</Badge>}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {company.industry ?? "—"}
                      </TableCell>
                      <TableCell>
                        {company.lifetime_value != null && company.lifetime_value > 0 ? (
                          <span className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                            {formatCurrency(company.lifetime_value)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {riskCount > 0 ? (
                          <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400 text-sm tabular-nums">
                            <ShieldAlert className="h-3.5 w-3.5" />
                            {riskCount}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={health.variant}>{health.label}</Badge>
                      </TableCell>
                      <TableCell className="text-center tabular-nums text-muted-foreground">
                        {ext ? ext.contactCount : "—"}
                      </TableCell>
                      <TableCell className="text-center">
                        {ext && ext.openAlertCount > 0 ? (
                          <span className="flex items-center justify-center gap-1 text-amber-600 dark:text-amber-400 tabular-nums">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            {ext.openAlertCount}
                          </span>
                        ) : (
                          <span className="text-muted-foreground tabular-nums">{ext ? "0" : "—"}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground whitespace-nowrap">
                        {ext?.lastEmailAt ? timeAgo(ext.lastEmailAt) : "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {(company.city || company.country) ? (
                          <div className="flex items-center gap-1">
                            <MapPin className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate max-w-[120px]">
                              {[company.city, company.country].filter(Boolean).join(", ")}
                            </span>
                          </div>
                        ) : "—"}
                        {company.enriched_at && (
                          <span className="inline-flex ml-1.5" title={`Enriquecido ${timeAgo(company.enriched_at)}`}>
                            <Sparkles className="h-3 w-3 text-amber-500" />
                          </span>
                        )}
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
      {hasMore && companies.length > 0 && (
        <div className="flex justify-center pt-4">
          <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? "Cargando..." : "Cargar mas empresas"}
          </Button>
        </div>
      )}
    </div>
  );
}
