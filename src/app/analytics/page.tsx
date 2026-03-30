"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  Clock,
  Mail,
  MessageSquare,
  TrendingUp,
} from "lucide-react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";
import { supabase } from "@/lib/supabase";
import { formatDate } from "@/lib/utils";
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

// ── Types ──

interface ResponseMetric {
  id: number;
  metric_date: string;
  account: string | null;
  emails_received: number;
  emails_sent: number;
  threads_started: number;
  threads_replied: number;
  threads_unanswered: number;
  avg_response_hours: number | null;
  fastest_response_hours: number | null;
  slowest_response_hours: number | null;
}

interface AccountSummary {
  id: number;
  summary_date: string;
  account: string | null;
  department: string | null;
  total_emails: number;
  external_emails: number;
  internal_emails: number;
  key_items: number | null;
  waiting_response: number | null;
  urgent_items: number | null;
  overall_sentiment: string | null;
  risks_detected: number | null;
}

// ── Chart colors that work in light and dark themes ──

const COLORS = {
  received: "#3b82f6", // blue-500
  sent: "#10b981", // emerald-500
  avgResponse: "#f59e0b", // amber-500
  started: "#6366f1", // indigo-500
  replied: "#10b981", // emerald-500
  unanswered: "#ef4444", // red-500
  sentiment: "#8b5cf6", // violet-500
};

// ── Helpers ──

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

// ── Custom Tooltip ──

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-background px-3 py-2 shadow-md">
      <p className="mb-1 text-xs font-medium text-muted-foreground">{label}</p>
      {payload.map((entry, i) => (
        <div key={i} className="flex items-center gap-2 text-xs">
          <div
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-muted-foreground">{entry.name}:</span>
          <span className="font-medium">
            {typeof entry.value === "number" ? entry.value.toFixed(1) : entry.value}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Component ──

export default function AnalyticsPage() {
  const [metrics, setMetrics] = useState<ResponseMetric[]>([]);
  const [summaries, setSummaries] = useState<AccountSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      const [metricsRes, summariesRes] = await Promise.all([
        supabase
          .from("communication_metrics")
          .select("*")
          .order("metric_date", { ascending: false })
          .limit(90),
        supabase
          .from("briefings")
          .select("*")
          .eq("scope", "account")
          .order("briefing_date", { ascending: false })
          .limit(60),
      ]);

      if (metricsRes.data) setMetrics(metricsRes.data as ResponseMetric[]);
      if (summariesRes.data) setSummaries(summariesRes.data as AccountSummary[]);
      setLoading(false);
    }

    fetchData();
  }, []);

  // ── Aggregated chart data ──

  const emailVolumeData = useMemo(() => {
    const byDate = new Map<string, { received: number; sent: number }>();
    for (const m of metrics) {
      const existing = byDate.get(m.metric_date) ?? { received: 0, sent: 0 };
      existing.received += m.emails_received;
      existing.sent += m.emails_sent;
      byDate.set(m.metric_date, existing);
    }
    return Array.from(byDate.entries())
      .map(([date, vals]) => ({ date, label: formatShortDate(date), ...vals }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [metrics]);

  const responseTimeData = useMemo(() => {
    const byDate = new Map<string, { total: number; count: number }>();
    for (const m of metrics) {
      if (m.avg_response_hours == null) continue;
      const existing = byDate.get(m.metric_date) ?? { total: 0, count: 0 };
      existing.total += m.avg_response_hours;
      existing.count += 1;
      byDate.set(m.metric_date, existing);
    }
    return Array.from(byDate.entries())
      .map(([date, vals]) => ({
        date,
        label: formatShortDate(date),
        avg_hours: vals.count > 0 ? vals.total / vals.count : 0,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [metrics]);

  const threadActivityData = useMemo(() => {
    const byDate = new Map<
      string,
      { started: number; replied: number; unanswered: number }
    >();
    for (const m of metrics) {
      const existing = byDate.get(m.metric_date) ?? {
        started: 0,
        replied: 0,
        unanswered: 0,
      };
      existing.started += m.threads_started;
      existing.replied += m.threads_replied;
      existing.unanswered += m.threads_unanswered;
      byDate.set(m.metric_date, existing);
    }
    return Array.from(byDate.entries())
      .map(([date, vals]) => ({ date, label: formatShortDate(date), ...vals }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [metrics]);

  const sentimentData = useMemo(() => {
    const byDate = new Map<string, { total: number; count: number }>();
    for (const s of summaries) {
      const val = sentimentToNumber(s.overall_sentiment);
      if (val == null) continue;
      const date = (s as unknown as Record<string, unknown>).briefing_date as string ?? (s as unknown as Record<string, unknown>).summary_date as string;
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

  // ── Per-account breakdown ──

  const accountBreakdown = useMemo(() => {
    const byAccount = new Map<
      string,
      {
        total_emails: number;
        response_hours_sum: number;
        response_count: number;
        sentiments: string[];
      }
    >();

    for (const m of metrics) {
      const acct = m.account ?? "Sin cuenta";
      const existing = byAccount.get(acct) ?? {
        total_emails: 0,
        response_hours_sum: 0,
        response_count: 0,
        sentiments: [],
      };
      existing.total_emails += m.emails_received + m.emails_sent;
      if (m.avg_response_hours != null) {
        existing.response_hours_sum += m.avg_response_hours;
        existing.response_count += 1;
      }
      byAccount.set(acct, existing);
    }

    // Merge sentiment from summaries
    for (const s of summaries) {
      const acct = s.account ?? "Sin cuenta";
      const existing = byAccount.get(acct);
      if (existing && s.overall_sentiment) {
        existing.sentiments.push(s.overall_sentiment);
      }
    }

    return Array.from(byAccount.entries())
      .map(([account, vals]) => ({
        account,
        total_emails: vals.total_emails,
        avg_response:
          vals.response_count > 0
            ? (vals.response_hours_sum / vals.response_count).toFixed(1)
            : "—",
        sentiment: vals.sentiments.length > 0
          ? vals.sentiments[0]
          : null,
      }))
      .sort((a, b) => b.total_emails - a.total_emails);
  }, [metrics, summaries]);

  // ── KPIs ──

  const kpis = useMemo(() => {
    const totalReceived = metrics.reduce((s, m) => s + m.emails_received, 0);
    const totalSent = metrics.reduce((s, m) => s + m.emails_sent, 0);
    const responseTimes = metrics
      .filter((m) => m.avg_response_hours != null)
      .map((m) => m.avg_response_hours!);
    const avgResponse =
      responseTimes.length > 0
        ? (responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length).toFixed(1)
        : "—";
    const totalUnanswered = metrics.reduce(
      (s, m) => s + m.threads_unanswered,
      0
    );
    return { totalReceived, totalSent, avgResponse, totalUnanswered };
  }, [metrics]);

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
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-[350px]" />
          <Skeleton className="h-[350px]" />
        </div>
        <Skeleton className="h-[300px]" />
      </div>
    );
  }

  const hasData = metrics.length > 0 || summaries.length > 0;

  if (!hasData) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Analitica"
          description="Metricas de comunicacion y rendimiento"
        />
        <EmptyState
          icon={BarChart3}
          title="Sin datos de analitica"
          description="No hay metricas de respuesta ni resumenes de cuenta disponibles."
        />
      </div>
    );
  }

  // ── Render ──

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analitica"
        description="Metricas de comunicacion y rendimiento"
      />

      {/* KPI Row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Emails Recibidos"
          value={kpis.totalReceived}
          icon={Mail}
          description="Total en el periodo"
        />
        <StatCard
          title="Emails Enviados"
          value={kpis.totalSent}
          icon={Mail}
          description="Total en el periodo"
        />
        <StatCard
          title="Respuesta Promedio"
          value={`${kpis.avgResponse}h`}
          icon={Clock}
          description="Horas promedio de respuesta"
        />
        <StatCard
          title="Sin Responder"
          value={kpis.totalUnanswered}
          icon={MessageSquare}
          description="Hilos sin respuesta"
        />
      </div>

      {/* Charts row 1 */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Email Volume */}
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 pb-4">
            <Mail className="h-4 w-4 text-muted-foreground" />
            <CardTitle>Volumen de Email</CardTitle>
          </CardHeader>
          <CardContent>
            {emailVolumeData.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Sin datos de volumen.
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={emailVolumeData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11 }}
                    className="fill-muted-foreground"
                  />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    className="fill-muted-foreground"
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend
                    wrapperStyle={{ fontSize: 12 }}
                  />
                  <Area
                    type="monotone"
                    dataKey="received"
                    name="Recibidos"
                    stroke={COLORS.received}
                    fill={COLORS.received}
                    fillOpacity={0.15}
                    strokeWidth={2}
                  />
                  <Area
                    type="monotone"
                    dataKey="sent"
                    name="Enviados"
                    stroke={COLORS.sent}
                    fill={COLORS.sent}
                    fillOpacity={0.15}
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Response Time */}
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 pb-4">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <CardTitle>Tiempo de Respuesta</CardTitle>
          </CardHeader>
          <CardContent>
            {responseTimeData.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Sin datos de tiempo de respuesta.
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={responseTimeData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11 }}
                    className="fill-muted-foreground"
                  />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    className="fill-muted-foreground"
                    unit="h"
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Line
                    type="monotone"
                    dataKey="avg_hours"
                    name="Promedio (horas)"
                    stroke={COLORS.avgResponse}
                    strokeWidth={2}
                    dot={{ r: 2 }}
                    activeDot={{ r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Charts row 2 */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Thread Activity */}
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 pb-4">
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
            <CardTitle>Actividad de Hilos</CardTitle>
          </CardHeader>
          <CardContent>
            {threadActivityData.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Sin datos de hilos.
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={threadActivityData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11 }}
                    className="fill-muted-foreground"
                  />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    className="fill-muted-foreground"
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar
                    dataKey="started"
                    name="Iniciados"
                    fill={COLORS.started}
                    stackId="threads"
                    radius={[0, 0, 0, 0]}
                  />
                  <Bar
                    dataKey="replied"
                    name="Respondidos"
                    fill={COLORS.replied}
                    stackId="threads"
                    radius={[0, 0, 0, 0]}
                  />
                  <Bar
                    dataKey="unanswered"
                    name="Sin respuesta"
                    fill={COLORS.unanswered}
                    stackId="threads"
                    radius={[2, 2, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Sentiment Trend */}
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 pb-4">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            <CardTitle>Tendencia de Sentimiento</CardTitle>
          </CardHeader>
          <CardContent>
            {sentimentData.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Sin datos de sentimiento.
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart data={sentimentData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11 }}
                    className="fill-muted-foreground"
                  />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    className="fill-muted-foreground"
                    domain={[-2, 2]}
                    ticks={[-2, -1, 0, 1, 2]}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="sentiment"
                    name="Sentimiento"
                    stroke={COLORS.sentiment}
                    fill={COLORS.sentiment}
                    fillOpacity={0.15}
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Account Breakdown Table */}
      <Card>
        <CardHeader className="flex flex-row items-center gap-2 pb-4">
          <BarChart3 className="h-4 w-4 text-muted-foreground" />
          <CardTitle>Desglose por Cuenta</CardTitle>
        </CardHeader>
        <CardContent>
          {accountBreakdown.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Sin datos de cuentas.
            </p>
          ) : (
            <>
              {/* Mobile cards */}
              <div className="space-y-2 md:hidden">
                {accountBreakdown.map((row) => (
                  <div key={row.account} className="flex items-center justify-between rounded-lg border p-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{row.account}</p>
                      <p className="text-xs text-muted-foreground">
                        {row.total_emails} emails · {row.avg_response === "—" ? "—" : `${row.avg_response}h`} resp.
                      </p>
                    </div>
                    {row.sentiment ? (
                      <Badge
                        variant={
                          row.sentiment.includes("positive") ? "success"
                            : row.sentiment.includes("negative") ? "warning"
                              : "secondary"
                        }
                        className="shrink-0"
                      >
                        {row.sentiment}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </div>
                ))}
              </div>
              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Cuenta</TableHead>
                    <TableHead className="text-right">Total Emails</TableHead>
                    <TableHead className="text-right">Respuesta Prom.</TableHead>
                    <TableHead>Sentimiento</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {accountBreakdown.map((row) => (
                    <TableRow key={row.account}>
                      <TableCell className="font-medium">{row.account}</TableCell>
                      <TableCell className="text-right">
                        {row.total_emails.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right">
                        {row.avg_response === "—" ? "—" : `${row.avg_response}h`}
                      </TableCell>
                      <TableCell>
                        {row.sentiment ? (
                          <Badge
                            variant={
                              row.sentiment.includes("positive")
                                ? "success"
                                : row.sentiment.includes("negative")
                                  ? "warning"
                                  : "secondary"
                            }
                          >
                            {row.sentiment}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
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
    </div>
  );
}
