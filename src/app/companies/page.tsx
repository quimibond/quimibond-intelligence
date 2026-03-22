"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, formatCurrency } from "@/lib/utils";
import {
  Search,
  ChevronRight,
  Building2,
  TrendingUp,
  TrendingDown,
  Minus,
  DollarSign,
  Users,
  AlertCircle,
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

function getTrendIcon(trend: number | null) {
  if (trend != null && trend > 0) return <TrendingUp className="w-4 h-4 text-[var(--success)]" />;
  if (trend != null && trend < 0) return <TrendingDown className="w-4 h-4 text-[var(--severity-critical)]" />;
  return <Minus className="w-4 h-4 text-[var(--muted-foreground)]" />;
}

function StatCard({
  label,
  value,
  isLoading,
  icon: Icon,
  variant = "default",
}: {
  label: string;
  value: string | number;
  isLoading: boolean;
  icon?: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  variant?: "default" | "critical" | "success" | "warning";
}) {
  const colorMap = {
    default: "text-[var(--muted-foreground)]",
    critical: "text-[var(--severity-critical)]",
    success: "text-[var(--success)]",
    warning: "text-[var(--warning)]",
  };

  return (
    <Card className="game-card opacity-0 animate-in fade-in slide-in-from-bottom-4">
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <p className="text-sm font-medium text-[var(--muted-foreground)]">
              {label}
            </p>
            {isLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <p className={cn("text-3xl font-bold", variant !== "default" && colorMap[variant])}>
                {value}
              </p>
            )}
          </div>
          {Icon && <Icon className={cn("h-8 w-8", colorMap[variant])} />}
        </div>
      </CardContent>
    </Card>
  );
}

function CompanyRow({ company, index }: { company: Company; index: number }) {
  const initials = company.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const trend = company.trend_pct;
  const creditUtil = Number(company.credit_limit) > 0
    ? Math.round((Number(company.total_pending) / Number(company.credit_limit)) * 100)
    : null;

  return (
    <div
      className="group game-card opacity-0 animate-in fade-in slide-in-from-bottom-4"
      style={{ animationDelay: `${index * 30}ms`, animationFillMode: "forwards" }}
    >
      <Card className="hover:border-[var(--primary)] hover:shadow-md transition-all cursor-pointer">
        <CardContent className="p-6">
          <div className="space-y-4">
            {/* Top Row: Avatar, Name, Badges */}
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 text-white font-bold text-sm bg-[var(--primary)]">
                {initials}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-semibold text-[var(--foreground)] truncate">
                      {company.name}
                    </h3>
                    <p className="text-xs text-[var(--muted-foreground)] truncate">
                      {company.domain || company.canonical_name}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {company.is_customer && (
                      <Badge variant="success" className="shrink-0 text-xs font-medium">
                        Cliente
                      </Badge>
                    )}
                    {company.is_supplier && (
                      <Badge variant="info" className="shrink-0 text-xs font-medium">
                        Proveedor
                      </Badge>
                    )}
                  </div>
                </div>
                {company.industry && (
                  <p className="text-xs text-[var(--muted-foreground)]">
                    {company.industry}
                  </p>
                )}
              </div>
            </div>

            {/* Financial Summary Row */}
            <div className="grid grid-cols-3 gap-4 pt-3 border-t border-[var(--border)]">
              <div className="space-y-1">
                <p className="text-xs text-[var(--muted-foreground)]">Valor de Vida</p>
                <p className="text-sm font-bold tabular-nums text-[var(--foreground)]">
                  {formatCurrency(Number(company.lifetime_value) || 0)}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-[var(--muted-foreground)]">Promedio Mensual</p>
                <p className="text-sm font-bold tabular-nums text-[var(--foreground)]">
                  {formatCurrency(Number(company.monthly_avg) || 0)}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-[var(--muted-foreground)]">Tendencia</p>
                <div className="flex items-center gap-1.5">
                  {getTrendIcon(trend)}
                  {trend != null ? (
                    <span className={cn(
                      "text-sm font-bold tabular-nums",
                      trend > 0 ? "text-[var(--success)]" : trend < 0 ? "text-[var(--severity-critical)]" : "text-[var(--muted-foreground)]",
                    )}>
                      {trend > 0 ? "+" : ""}{Number(trend).toFixed(0)}%
                    </span>
                  ) : (
                    <span className="text-sm text-[var(--muted-foreground)]">—</span>
                  )}
                </div>
              </div>
            </div>

            {/* Bottom Info Row */}
            <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
              <span>
                Pendiente:{" "}
                <span className={cn(
                  "font-medium",
                  creditUtil != null && creditUtil > 80 ? "text-[var(--severity-critical)]" : "text-[var(--foreground)]",
                )}>
                  {formatCurrency(Number(company.total_pending) || 0)}
                </span>
                {creditUtil != null && (
                  <span className="ml-1">({creditUtil}% del límite)</span>
                )}
              </span>
              {company.delivery_otd_rate != null && (
                <span>
                  OTD:{" "}
                  <span className={cn(
                    "font-medium",
                    Number(company.delivery_otd_rate) >= 90 ? "text-[var(--success)]" :
                    Number(company.delivery_otd_rate) >= 70 ? "text-[var(--warning)]" :
                    "text-[var(--severity-critical)]",
                  )}>
                    {Number(company.delivery_otd_rate).toFixed(0)}%
                  </span>
                </span>
              )}
            </div>
          </div>

          <Link
            href={`/companies/${company.id}`}
            className="absolute inset-0 rounded-lg"
          />
        </CardContent>
      </Card>
    </div>
  );
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
  const bothCount = companies.filter((c) => c.is_customer && c.is_supplier).length;

  const totalLifetimeValue = companies.reduce((sum, c) => sum + (Number(c.lifetime_value) || 0), 0);
  const highCreditUtil = companies.filter((c) => {
    if (Number(c.credit_limit) <= 0) return false;
    return (Number(c.total_pending) / Number(c.credit_limit)) * 100 > 80;
  }).length;

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="space-y-2 opacity-0 animate-in fade-in slide-in-from-bottom-4">
        <div className="flex items-center gap-3">
          <Building2 className="w-8 h-8 text-[var(--primary)]" />
          <h1 className="text-3xl font-bold text-[var(--foreground)]">
            Directorio de Empresas
          </h1>
        </div>
        <p className="text-[var(--muted-foreground)]">
          Cartera de clientes y proveedores — visión financiera y operativa
        </p>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total de Empresas"
          value={companies.length}
          isLoading={loading}
          icon={Building2}
        />
        <StatCard
          label="Valor de Vida Total"
          value={formatCurrency(totalLifetimeValue)}
          isLoading={loading}
          icon={DollarSign}
          variant="success"
        />
        <StatCard
          label="Clientes Activos"
          value={customers + bothCount}
          isLoading={loading}
          icon={Users}
        />
        <StatCard
          label="Crédito Crítico (>80%)"
          value={highCreditUtil}
          isLoading={loading}
          icon={AlertCircle}
          variant={highCreditUtil > 0 ? "critical" : "success"}
        />
      </div>

      {/* Filter Bar */}
      <Card className="opacity-0 animate-in fade-in slide-in-from-bottom-4">
        <CardContent className="pt-6">
          <div className="space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--muted-foreground)]" />
              <Input
                placeholder="Buscar por nombre, dominio o industria..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10 bg-[var(--background)] border-[var(--border)] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="text-xs font-medium text-[var(--muted-foreground)] mb-2 block">
                  Tipo de Empresa
                </label>
                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-[var(--background)] border border-[var(--border)] rounded-md text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
                >
                  <option value="all">Todas ({companies.length})</option>
                  <option value="customer">Clientes ({customers})</option>
                  <option value="supplier">Proveedores ({suppliers})</option>
                  <option value="both">Ambos ({bothCount})</option>
                </select>
              </div>

              <div className="flex items-end md:col-span-2">
                <p className="text-sm text-[var(--muted-foreground)]">
                  Mostrando{" "}
                  <span className="font-bold text-[var(--foreground)]">
                    {filtered.length}
                  </span>{" "}
                  de{" "}
                  <span className="font-bold text-[var(--foreground)]">
                    {companies.length}
                  </span>{" "}
                  empresas
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Companies List */}
      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <div className="space-y-4">
                  <div className="flex items-start gap-4">
                    <Skeleton className="w-10 h-10 rounded-full" />
                    <div className="flex-1 space-y-3">
                      <Skeleton className="h-5 w-3/4" />
                      <Skeleton className="h-3 w-full" />
                      <div className="grid grid-cols-3 gap-4 pt-3">
                        <Skeleton className="h-8 w-full" />
                        <Skeleton className="h-8 w-full" />
                        <Skeleton className="h-8 w-full" />
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filtered.length > 0 ? (
        <div className="space-y-4">
          {filtered.map((company, index) => (
            <CompanyRow key={company.id} company={company} index={index} />
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <Building2 className="w-12 h-12 text-[var(--muted-foreground)] mx-auto mb-4 opacity-50" />
            <p className="text-[var(--muted-foreground)] font-medium">
              {search ? "No se encontraron empresas" : "No hay empresas registradas"}
            </p>
            <p className="text-xs text-[var(--muted-foreground)] mt-2">
              Intenta con diferentes criterios de búsqueda o filtros
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
