"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn, formatCurrency } from "@/lib/utils";
import {
  Search,
  ChevronRight,
  Building2,
  Activity,
  TrendingUp,
  TrendingDown,
  Minus,
} from "lucide-react";
import Link from "next/link";

interface Company {
  id: number;
  name: string;
  canonical_name: string;
  domain: string | null;
  is_customer: boolean;
  is_supplier: boolean;
  industry: string | null;
  lifetime_value: number;
  total_credit_notes: number;
  delivery_otd_rate: number | null;
  credit_limit: number;
  total_pending: number;
  monthly_avg: number;
  trend_pct: number | null;
  created_at: string;
  updated_at: string;
}

function getTypeLabel(c: Company): string {
  if (c.is_customer && c.is_supplier) return "both";
  if (c.is_customer) return "customer";
  if (c.is_supplier) return "supplier";
  return "other";
}

export default function CompaniesPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  useEffect(() => {
    async function fetchCompanies() {
      const { data } = await supabase
        .from("companies")
        .select("*")
        .order("lifetime_value", { ascending: false })
        .limit(200);
      setCompanies(data || []);
      setLoading(false);
    }
    fetchCompanies();
  }, []);

  const filtered = companies.filter((c) => {
    const matchesSearch =
      !search ||
      c.name?.toLowerCase().includes(search.toLowerCase()) ||
      c.domain?.toLowerCase().includes(search.toLowerCase()) ||
      c.industry?.toLowerCase().includes(search.toLowerCase());
    const type = getTypeLabel(c);
    const matchesType = typeFilter === "all" || type === typeFilter;
    return matchesSearch && matchesType;
  });

  const customers = companies.filter((c) => c.is_customer && !c.is_supplier).length;
  const suppliers = companies.filter((c) => c.is_supplier && !c.is_customer).length;
  const both = companies.filter((c) => c.is_customer && c.is_supplier).length;

  const typeFilters = [
    { key: "all", label: "Todos", count: companies.length },
    { key: "customer", label: "Clientes", count: customers },
    { key: "supplier", label: "Proveedores", count: suppliers },
    { key: "both", label: "Ambos", count: both },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <Building2 className="h-6 w-6 text-[var(--accent-cyan)]" />
            <h1 className="text-2xl font-black tracking-tight">Directorio de Empresas</h1>
          </div>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">
            {companies.length} empresas en el sistema
          </p>
        </div>
      </div>

      {/* Search + Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <input
            type="text"
            placeholder="Buscar por nombre, dominio o industria..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] py-2.5 pl-10 pr-4 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
          />
        </div>
        <div className="flex items-center gap-1">
          {typeFilters.map((f) => (
            <button
              key={f.key}
              onClick={() => setTypeFilter(f.key)}
              className={cn(
                "px-3 py-2 rounded-lg text-xs font-medium transition-colors",
                typeFilter === f.key
                  ? "bg-[var(--secondary)] text-[var(--foreground)] border border-[var(--border)]"
                  : "text-[var(--muted-foreground)] hover:bg-[var(--accent)]",
              )}
            >
              {f.label}
              <span className="ml-1 tabular-nums">{f.count}</span>
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Activity className="h-6 w-6 text-[var(--primary)] animate-pulse" />
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Building2 className="h-10 w-10 mb-3 text-[var(--muted-foreground)] opacity-30" />
            <p className="text-sm text-[var(--muted-foreground)]">
              {search ? "No se encontraron empresas." : "No hay empresas aun."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((company) => {
            const trend = company.trend_pct;
            const TrendIcon = trend != null && trend > 0 ? TrendingUp : trend != null && trend < 0 ? TrendingDown : Minus;
            const trendColor = trend != null && trend > 0 ? "var(--success)" : trend != null && trend < 0 ? "var(--destructive)" : "var(--muted-foreground)";

            return (
              <Link key={company.id} href={`/companies/${company.id}`}>
                <Card className="cursor-pointer transition-all hover:border-[var(--primary)]">
                  <CardContent className="flex items-center gap-4 p-4">
                    {/* Avatar */}
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold shrink-0 bg-[color-mix(in_srgb,var(--accent-cyan)_15%,transparent)] text-[var(--accent-cyan)]">
                      {company.name.charAt(0).toUpperCase()}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold truncate">{company.name}</span>
                        {company.industry && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 hidden sm:inline-flex">
                            {company.industry}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-[var(--muted-foreground)] mt-0.5">
                        {company.domain && <span className="truncate">{company.domain}</span>}
                        <div className="hidden md:flex items-center gap-1.5">
                          {company.is_customer && <Badge variant="success" className="text-[10px] px-1.5 py-0">Cliente</Badge>}
                          {company.is_supplier && <Badge variant="info" className="text-[10px] px-1.5 py-0">Proveedor</Badge>}
                        </div>
                      </div>
                    </div>

                    {/* Lifetime Value */}
                    <div className="hidden sm:flex items-center gap-2 shrink-0">
                      <span className="text-sm font-bold tabular-nums text-[var(--foreground)]">
                        {formatCurrency(Number(company.lifetime_value) || 0)}
                      </span>
                    </div>

                    {/* Trend */}
                    {trend != null && (
                      <div className="hidden md:flex items-center gap-1 shrink-0" style={{ color: trendColor }}>
                        <TrendIcon className="h-3.5 w-3.5" />
                        <span className="text-xs font-semibold tabular-nums">
                          {trend > 0 ? "+" : ""}{Number(trend).toFixed(0)}%
                        </span>
                      </div>
                    )}

                    <ChevronRight className="h-4 w-4 text-[var(--muted-foreground)] shrink-0" />
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
