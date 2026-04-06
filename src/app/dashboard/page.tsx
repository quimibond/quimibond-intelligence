"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { formatCurrency, timeAgo } from "@/lib/utils";
import { LoadingGrid } from "@/components/shared/loading-grid";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ArrowRight, DollarSign, Inbox, RefreshCw, Truck,
  TrendingUp, TrendingDown, Minus, FileText, Banknote,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell, Tooltip } from "recharts";

interface CashflowBucket {
  period: string;
  receivable: number;
  expected: number;
  probability: number;
}

interface DashboardData {
  insightsPending: number;
  overdueAmount: number;
  otdRate: number | null;
  trends: { company_name: string; trend_signal: string; overdue_delta: number; late_delta: number }[];
  briefingSummary: string | null;
  cashflow: CashflowBucket[];
  cashflowTotal: { receivable: number; expected: number; probability: number } | null;
  anomalyCount: number;
  lastUpdated: string;
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [insightsRes, overdueRes, otdDoneRes, otdOntimeRes, trendsRes, briefingRes, cashflowRes, anomalyRes] = await Promise.all([
        // Pending insights count
        supabase.from("agent_insights").select("id", { count: "exact", head: true })
          .in("state", ["new", "seen"]).gte("confidence", 0.80),

        // Total overdue amount
        supabase.from("odoo_invoices").select("amount_residual")
          .eq("move_type", "out_invoice").in("payment_state", ["not_paid", "partial"])
          .gt("days_overdue", 0),

        // OTD: deliveries done
        supabase.from("odoo_deliveries").select("id", { count: "exact", head: true }).eq("state", "done"),

        // OTD: deliveries done on time
        supabase.from("odoo_deliveries").select("id", { count: "exact", head: true }).eq("state", "done").eq("is_late", false),

        // Weekly trends (what changed)
        supabase.from("weekly_trends")
          .select("company_name, trend_signal, overdue_delta, late_delta")
          .not("trend_signal", "is", null)
          .order("overdue_delta", { ascending: false })
          .limit(8),

        // Latest briefing
        supabase.from("briefings").select("summary_text")
          .eq("scope", "daily").order("created_at", { ascending: false }).limit(1),

        // Cashflow projection
        supabase.from("cashflow_projection")
          .select("flow_type, period, gross_amount, net_amount, probability")
          .order("sort_order"),

        // Anomaly count
        supabase.from("accounting_anomalies")
          .select("id", { count: "exact", head: true })
          .in("severity", ["critical", "high"]),
      ]);

      const overdueTotal = (overdueRes.data ?? []).reduce((s, i) => s + Number(i.amount_residual ?? 0), 0);
      const doneCount = otdDoneRes.count ?? 0;
      const ontimeCount = otdOntimeRes.count ?? 0;
      const otdRate = doneCount > 0 ? Math.round((ontimeCount / doneCount) * 100) : null;

      // Process cashflow
      const cfRows = (cashflowRes.data ?? []) as { flow_type: string; period: string; gross_amount: number; net_amount: number; probability: number }[];
      const receivableBuckets = cfRows.filter(r => r.flow_type === "receivable");
      const cfSummary = cfRows.find(r => r.flow_type === "summary");
      const cashflow: CashflowBucket[] = receivableBuckets.map(r => ({
        period: r.period.replace(" dias", "d"),
        receivable: Number(r.gross_amount ?? 0),
        expected: Number(r.net_amount ?? 0),
        probability: Number(r.probability ?? 0),
      }));

      setData({
        insightsPending: insightsRes.count ?? 0,
        overdueAmount: overdueTotal,
        otdRate,
        trends: (trendsRes.data ?? []) as DashboardData["trends"],
        briefingSummary: briefingRes.data?.[0]?.summary_text ?? null,
        cashflow,
        cashflowTotal: cfSummary ? {
          receivable: Number(cfSummary.gross_amount ?? 0),
          expected: Number(cfSummary.net_amount ?? 0),
          probability: Number(cfSummary.probability ?? 0),
        } : null,
        anomalyCount: anomalyRes.count ?? 0,
        lastUpdated: new Date().toISOString(),
      });
    } catch (err) {
      setError(String(err));
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  function handleRefresh() { setRefreshing(true); load(); }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-7 w-32 bg-muted rounded animate-pulse" />
        <div className="grid grid-cols-3 gap-2">
          {[1, 2, 3].map(i => <div key={i} className="h-20 bg-muted rounded-2xl animate-pulse" />)}
        </div>
        <LoadingGrid rows={3} rowHeight="h-14" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="text-center py-20">
        <p className="text-sm text-destructive mb-2">Error al cargar</p>
        <Button variant="outline" size="sm" onClick={handleRefresh}>Reintentar</Button>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black">Quimibond</h1>
          <p className="text-xs text-muted-foreground">{timeAgo(data.lastUpdated)}</p>
        </div>
        <Button size="icon" variant="ghost" onClick={handleRefresh} disabled={refreshing} className="h-9 w-9">
          <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
        </Button>
      </div>

      {/* 3 KPIs */}
      <div className="grid grid-cols-3 gap-2">
        <KPIBig
          value={formatCurrency(data.overdueAmount)}
          label="vencido"
          icon={DollarSign}
          variant={data.overdueAmount > 0 ? "danger" : "default"}
          href="/companies"
        />
        <KPIBig
          value={data.otdRate !== null ? `${data.otdRate}%` : "—"}
          label="OTD"
          icon={Truck}
          variant={data.otdRate === null ? "default" : data.otdRate >= 90 ? "success" : "warning"}
          href="/companies"
        />
        <KPIBig
          value={String(data.insightsPending)}
          label="insights"
          icon={Inbox}
          variant={data.insightsPending > 0 ? "primary" : "default"}
          href="/inbox"
        />
      </div>

      {/* Cashflow Projection */}
      {data.cashflow.length > 0 && (
        <Card>
          <CardHeader className="pb-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Banknote className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-sm font-semibold">Flujo de efectivo</CardTitle>
              </div>
              {data.anomalyCount > 0 && (
                <span className="text-[10px] font-medium text-danger bg-danger/10 rounded-full px-2 py-0.5">
                  {data.anomalyCount} anomalías
                </span>
              )}
            </div>
            {data.cashflowTotal && (
              <p className="text-xs text-muted-foreground">
                Por cobrar: {formatCurrency(data.cashflowTotal.receivable)} → esperado: {formatCurrency(data.cashflowTotal.expected)} ({data.cashflowTotal.probability}%)
              </p>
            )}
          </CardHeader>
          <CardContent className="pt-2">
            <div className="h-32">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.cashflow} barGap={2}>
                  <XAxis dataKey="period" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis hide />
                  <Tooltip
                    formatter={(value) => formatCurrency(Number(value))}
                    labelFormatter={(label) => `Período: ${label}`}
                    contentStyle={{ fontSize: 12, borderRadius: 8 }}
                  />
                  <Bar dataKey="receivable" name="Por cobrar" radius={[4, 4, 0, 0]} maxBarSize={40}>
                    {data.cashflow.map((_, i) => (
                      <Cell key={i} fill="hsl(var(--muted-foreground) / 0.2)" />
                    ))}
                  </Bar>
                  <Bar dataKey="expected" name="Esperado" radius={[4, 4, 0, 0]} maxBarSize={40}>
                    {data.cashflow.map((entry, i) => (
                      <Cell key={i} fill={entry.probability >= 85 ? "hsl(var(--success))" : "hsl(var(--warning))"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Weekly Trends */}
      {data.trends.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Esta semana</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.trends.map((t, i) => {
              const isUp = t.overdue_delta > 0 || t.late_delta > 0;
              const isDown = t.overdue_delta < -10000;
              return (
                <div key={i} className="flex items-start gap-2.5 text-sm">
                  {isUp ? <TrendingUp className="h-4 w-4 text-danger mt-0.5 shrink-0" />
                    : isDown ? <TrendingDown className="h-4 w-4 text-success mt-0.5 shrink-0" />
                    : <Minus className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />}
                  <div className="min-w-0">
                    <p className="font-medium truncate">{t.company_name}</p>
                    <p className="text-xs text-muted-foreground">{t.trend_signal}</p>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Briefing */}
      {data.briefingSummary && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-sm font-semibold">Briefing</CardTitle>
              </div>
              <Link href="/briefings" className="text-xs text-primary font-medium flex items-center gap-0.5">
                Ver <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground leading-relaxed line-clamp-4">
              {data.briefingSummary}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── KPI Big Card ──
function KPIBig({ value, label, icon: Icon, variant = "default", href }: {
  value: string; label: string; icon: React.ElementType;
  variant?: "default" | "danger" | "warning" | "success" | "primary";
  href: string;
}) {
  const colors = {
    default: "",
    danger: "text-danger",
    warning: "text-warning",
    success: "text-success",
    primary: "text-primary",
  };

  return (
    <Link href={href}>
      <Card className="h-full hover:bg-muted/50 transition-colors">
        <CardContent className="p-3 text-center">
          <Icon className={cn("h-4 w-4 mx-auto mb-1 text-muted-foreground")} />
          <p className={cn("text-lg font-black tabular-nums truncate", colors[variant])}>{value}</p>
          <p className="text-[10px] text-muted-foreground">{label}</p>
        </CardContent>
      </Card>
    </Link>
  );
}
