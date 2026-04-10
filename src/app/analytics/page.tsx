"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  DollarSign,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Package,
  Users,
} from "lucide-react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
  Cell,
} from "recharts";
import { supabase } from "@/lib/supabase";
import type { Briefing } from "@/lib/types";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { ChartTooltip } from "./components/chart-tooltip";

// ── Chart colors ──
const CHART_COLORS = {
  revenue: "#3b82f6",
  clients: "#10b981",
  margin_good: "#10b981",
  margin_mid: "#f59e0b",
  margin_bad: "#ef4444",
  overdue: "#ef4444",
  sentiment: "#8b5cf6",
};

// ── Helpers ──

function fmtCompact(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `$${Math.round(v / 1_000)}K`;
  return `$${Math.round(v)}`;
}

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

function sentimentToNumber(sentiment: string | null): number | null {
  if (!sentiment) return null;
  const map: Record<string, number> = {
    very_negative: -2,
    negative: -1,
    neutral: 0,
    positive: 1,
    very_positive: 2,
  };
  return map[sentiment.toLowerCase()] ?? null;
}

// ── Types ──

interface RevenueRow {
  month: string;
  revenue: number | string;
  active_clients: number;
  mom_change_pct: number | string | null;
}

interface MarginRow {
  product_ref: string | null;
  company_name: string | null;
  avg_order_price: number | null;
  avg_invoice_price: number | null;
  price_delta_pct: number | null;
  gross_margin_pct: number | null;
  total_order_value: number | null;
}

interface WeeklyTrendRow {
  company_name: string;
  tier: string | null;
  overdue_now: number | null;
  overdue_delta: number | null;
  pending_delta: number | null;
  late_delta: number | null;
  trend_signal: string | null;
}

interface AnomalyRow {
  anomaly_type: string;
  severity: string;
  company_name: string | null;
  amount: number | null;
}

// ── Component ──

export default function AnalyticsPage() {
  const [summaries, setSummaries] = useState<Briefing[]>([]);
  const [revenueTrend, setRevenueTrend] = useState<RevenueRow[]>([]);
  const [margins, setMargins] = useState<MarginRow[]>([]);
  const [weeklyTrends, setWeeklyTrends] = useState<WeeklyTrendRow[]>([]);
  const [anomalies, setAnomalies] = useState<AnomalyRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      const [summariesRes, revenueRes, marginsRes, trendsRes, anomaliesRes] = await Promise.all([
        supabase
          .from("briefings")
          .select("*")
          .eq("scope", "account")
          .order("briefing_date", { ascending: false })
          .limit(60),
        supabase
          .from("monthly_revenue_trend")
          .select("month, revenue, active_clients, mom_change_pct")
          .order("month", { ascending: false })
          .limit(12),
        supabase
          .from("product_margin_analysis")
          .select("product_ref, company_name, avg_order_price, avg_invoice_price, price_delta_pct, gross_margin_pct, total_order_value")
          .not("gross_margin_pct", "is", null)
          .order("total_order_value", { ascending: false })
          .limit(20),
        supabase
          .from("weekly_trends")
          .select("company_name, tier, overdue_now, overdue_delta, pending_delta, late_delta, trend_signal")
          .not("trend_signal", "is", null)
          .neq("trend_signal", "estable")
          .order("overdue_delta", { ascending: false })
          .limit(20),
        supabase
          .from("accounting_anomalies")
          .select("anomaly_type, severity, company_name, amount")
          .in("severity", ["critical", "high"])
          .limit(20),
      ]);

      if (summariesRes.data) setSummaries(summariesRes.data as Briefing[]);
      if (revenueRes.data) setRevenueTrend(revenueRes.data as RevenueRow[]);
      if (marginsRes.data) setMargins(marginsRes.data as MarginRow[]);
      if (trendsRes.data) setWeeklyTrends(trendsRes.data as WeeklyTrendRow[]);
      if (anomaliesRes.data) setAnomalies(anomaliesRes.data as AnomalyRow[]);
      setLoading(false);
    }

    fetchData();
  }, []);

  // ── Revenue chart data ──

  const revenueChartData = useMemo(() => {
    return [...revenueTrend].reverse().map((r) => ({
      month: new Date(r.month).toLocaleDateString("es-MX", { month: "short", year: "2-digit" }),
      revenue: Number(r.revenue ?? 0),
      clients: r.active_clients ?? 0,
      mom: Number(r.mom_change_pct ?? 0),
    }));
  }, [revenueTrend]);

  // ── Margin chart data ──

  const marginChartData = useMemo(() => {
    return margins.slice(0, 12).map((m) => ({
      product: m.product_ref ?? "—",
      margin: Number(m.gross_margin_pct ?? 0),
      value: Number(m.total_order_value ?? 0),
    }));
  }, [margins]);

  // ── Sentiment data ──

  const sentimentData = useMemo(() => {
    const byDate = new Map<string, { total: number; count: number }>();
    for (const s of summaries) {
      const val = sentimentToNumber(s.overall_sentiment);
      if (val == null) continue;
      const date = s.briefing_date;
      const existing = byDate.get(date) ?? { total: 0, count: 0 };
      existing.total += val;
      existing.count += 1;
      byDate.set(date, existing);
    }
    return Array.from(byDate.entries())
      .map(([date, vals]) => ({
        date,
        label: formatShortDate(date),
        sentiment: vals.count > 0 ? vals.total / vals.count : 0,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [summaries]);

  // ── KPIs ──

  const kpis = useMemo(() => {
    const latestRevenue = revenueTrend.length > 0 ? Number(revenueTrend[0].revenue ?? 0) : 0;
    const prevRevenue = revenueTrend.length > 1 ? Number(revenueTrend[1].revenue ?? 0) : 0;
    const latestClients = revenueTrend.length > 0 ? revenueTrend[0].active_clients ?? 0 : 0;
    const totalRevenue12m = revenueTrend.reduce((s, r) => s + Number(r.revenue ?? 0), 0);
    const avgMargin = margins.length > 0
      ? margins.reduce((s, m) => s + Number(m.gross_margin_pct ?? 0), 0) / margins.length
      : 0;
    const criticalAnomalies = anomalies.filter((a) => a.severity === "critical").length;
    const worsening = weeklyTrends.filter((t) => (t.overdue_delta ?? 0) > 0).length;

    return {
      latestRevenue,
      prevRevenue,
      latestClients,
      totalRevenue12m,
      avgMargin,
      criticalAnomalies,
      worsening,
    };
  }, [revenueTrend, margins, anomalies, weeklyTrends]);

  // ── Loading ──

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-5 w-96" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[120px]" />
          ))}
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-[350px]" />
          <Skeleton className="h-[350px]" />
        </div>
        <Skeleton className="h-[300px]" />
      </div>
    );
  }

  const hasData = revenueTrend.length > 0 || summaries.length > 0 || margins.length > 0;

  if (!hasData) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Analitica"
          description="Revenue, margenes, tendencias y anomalias"
        />
        <EmptyState
          icon={BarChart3}
          title="Sin datos de analitica"
          description="No hay datos de revenue ni margenes disponibles. Verifica que las materialized views esten actualizadas."
        />
      </div>
    );
  }

  // ── Render ──

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analitica"
        description="Revenue, margenes, tendencias y anomalias"
      />

      {/* KPI Row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Revenue Ultimo Mes"
          value={fmtCompact(kpis.latestRevenue)}
          icon={DollarSign}
          trend={kpis.latestRevenue >= kpis.prevRevenue ? "up" : "down"}
          description={kpis.prevRevenue > 0 ? `${Math.round(((kpis.latestRevenue - kpis.prevRevenue) / kpis.prevRevenue) * 100)}% vs mes anterior` : undefined}
        />
        <StatCard
          title="Revenue 12m"
          value={fmtCompact(kpis.totalRevenue12m)}
          icon={TrendingUp}
          description={`${kpis.latestClients} clientes activos`}
        />
        <StatCard
          title="Margen Promedio"
          value={`${kpis.avgMargin.toFixed(1)}%`}
          icon={Package}
          trend={kpis.avgMargin >= 20 ? "up" : kpis.avgMargin >= 10 ? "neutral" : "down"}
          description={`Top ${margins.length} productos`}
        />
        <StatCard
          title="Anomalias"
          value={anomalies.length}
          icon={AlertTriangle}
          trend={kpis.criticalAnomalies > 0 ? "down" : "neutral"}
          description={kpis.criticalAnomalies > 0 ? `${kpis.criticalAnomalies} criticas` : "Sin criticas"}
        />
      </div>

      {/* Charts row 1: Revenue + Margins */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Revenue Trend */}
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 pb-4">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            <CardTitle>Revenue Mensual</CardTitle>
          </CardHeader>
          <CardContent>
            {revenueChartData.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Sin datos de revenue.</p>
            ) : (
              <ResponsiveContainer width="100%" height={250}>
                <AreaChart data={revenueChartData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} className="fill-muted-foreground" />
                  <YAxis tick={{ fontSize: 11 }} className="fill-muted-foreground" tickFormatter={(v) => `$${(v / 1_000_000).toFixed(1)}M`} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Area type="monotone" dataKey="revenue" name="Revenue" stroke={CHART_COLORS.revenue} fill={CHART_COLORS.revenue} fillOpacity={0.15} strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Product Margins */}
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 pb-4">
            <Package className="h-4 w-4 text-muted-foreground" />
            <CardTitle>Margen por Producto (Top 12)</CardTitle>
          </CardHeader>
          <CardContent>
            {marginChartData.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Sin datos de margen.</p>
            ) : (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={marginChartData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis type="number" tick={{ fontSize: 11 }} className="fill-muted-foreground" unit="%" />
                  <YAxis dataKey="product" type="category" tick={{ fontSize: 10 }} width={100} className="fill-muted-foreground" />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="margin" name="Margen %">
                    {marginChartData.map((entry, i) => (
                      <Cell
                        key={i}
                        fill={entry.margin >= 25 ? CHART_COLORS.margin_good : entry.margin >= 10 ? CHART_COLORS.margin_mid : CHART_COLORS.margin_bad}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Charts row 2: Sentiment + Anomalies */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Sentiment Trend */}
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 pb-4">
            <Users className="h-4 w-4 text-muted-foreground" />
            <CardTitle>Tendencia de Sentimiento</CardTitle>
          </CardHeader>
          <CardContent>
            {sentimentData.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Sin datos de sentimiento.</p>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={sentimentData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} className="fill-muted-foreground" />
                  <YAxis tick={{ fontSize: 11 }} className="fill-muted-foreground" domain={[-2, 2]} ticks={[-2, -1, 0, 1, 2]} />
                  <Tooltip content={<ChartTooltip />} />
                  <Area type="monotone" dataKey="sentiment" name="Sentimiento" stroke={CHART_COLORS.sentiment} fill={CHART_COLORS.sentiment} fillOpacity={0.15} strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Anomalies */}
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 pb-4">
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
            <CardTitle>Anomalias Contables</CardTitle>
          </CardHeader>
          <CardContent>
            {anomalies.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Sin anomalias detectadas.</p>
            ) : (
              <div className="space-y-2 max-h-[200px] overflow-y-auto">
                {anomalies.map((a, i) => (
                  <div key={i} className="flex items-center justify-between rounded-lg border p-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{a.company_name ?? "—"}</p>
                      <p className="text-xs text-muted-foreground">{a.anomaly_type.replace(/_/g, " ")}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {a.amount != null && (
                        <span className="text-xs font-mono tabular-nums">{fmtCompact(a.amount)}</span>
                      )}
                      <Badge variant={a.severity === "critical" ? "critical" : "warning"}>
                        {a.severity}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Weekly Trends Table */}
      <Card>
        <CardHeader className="flex flex-row items-center gap-2 pb-4">
          <BarChart3 className="h-4 w-4 text-muted-foreground" />
          <CardTitle>Tendencias Semanales</CardTitle>
        </CardHeader>
        <CardContent>
          {weeklyTrends.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Sin tendencias semanales.</p>
          ) : (
            <>
              {/* Mobile cards */}
              <div className="space-y-2 md:hidden">
                {weeklyTrends.map((row, i) => (
                  <div key={i} className="flex items-center justify-between rounded-lg border p-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{row.company_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {row.tier ?? "—"} · Vencido: {fmtCompact(row.overdue_now ?? 0)}
                      </p>
                    </div>
                    <Badge
                      variant={
                        row.trend_signal?.includes("mejora") ? "success"
                          : row.trend_signal?.includes("empeora") ? "critical"
                            : "secondary"
                      }
                      className="shrink-0"
                    >
                      {row.trend_signal ?? "—"}
                    </Badge>
                  </div>
                ))}
              </div>
              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Empresa</TableHead>
                      <TableHead>Tier</TableHead>
                      <TableHead className="text-right">Vencido</TableHead>
                      <TableHead className="text-right">Delta Vencido</TableHead>
                      <TableHead className="text-right">Delta Entregas</TableHead>
                      <TableHead>Signal</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {weeklyTrends.map((row, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-medium max-w-[200px] truncate">{row.company_name}</TableCell>
                        <TableCell>
                          {row.tier ? (
                            <Badge variant={row.tier === "strategic" ? "info" : row.tier === "important" ? "success" : "secondary"}>
                              {row.tier}
                            </Badge>
                          ) : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {fmtCompact(row.overdue_now ?? 0)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          <span className={(row.overdue_delta ?? 0) > 0 ? "text-danger" : (row.overdue_delta ?? 0) < 0 ? "text-success" : ""}>
                            {(row.overdue_delta ?? 0) > 0 ? "+" : ""}{fmtCompact(row.overdue_delta ?? 0)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          <span className={(row.late_delta ?? 0) > 0 ? "text-danger" : (row.late_delta ?? 0) < 0 ? "text-success" : ""}>
                            {(row.late_delta ?? 0) > 0 ? "+" : ""}{row.late_delta ?? 0}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              row.trend_signal?.includes("mejora") ? "success"
                                : row.trend_signal?.includes("empeora") ? "critical"
                                  : "secondary"
                            }
                          >
                            {row.trend_signal ?? "—"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Product Margin Detail Table */}
      <Card>
        <CardHeader className="flex flex-row items-center gap-2 pb-4">
          <DollarSign className="h-4 w-4 text-muted-foreground" />
          <CardTitle>Analisis de Margenes por Producto</CardTitle>
        </CardHeader>
        <CardContent>
          {margins.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Sin datos de margenes.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Producto</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead className="text-right">Precio Orden</TableHead>
                    <TableHead className="text-right">Precio Factura</TableHead>
                    <TableHead className="text-right">Delta %</TableHead>
                    <TableHead className="text-right">Margen %</TableHead>
                    <TableHead className="text-right">Valor Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {margins.map((m, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono text-xs">{m.product_ref ?? "—"}</TableCell>
                      <TableCell className="max-w-[180px] truncate">{m.company_name ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {m.avg_order_price != null ? `$${Number(m.avg_order_price).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {m.avg_invoice_price != null ? `$${Number(m.avg_invoice_price).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {m.price_delta_pct != null ? (
                          <span className={Number(m.price_delta_pct) > 5 ? "text-danger" : Number(m.price_delta_pct) < -5 ? "text-success" : ""}>
                            {Number(m.price_delta_pct) > 0 ? "+" : ""}{Number(m.price_delta_pct).toFixed(1)}%
                          </span>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {m.gross_margin_pct != null ? (
                          <Badge variant={Number(m.gross_margin_pct) >= 25 ? "success" : Number(m.gross_margin_pct) >= 10 ? "warning" : "critical"}>
                            {Number(m.gross_margin_pct).toFixed(1)}%
                          </Badge>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {m.total_order_value != null ? fmtCompact(Number(m.total_order_value)) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
