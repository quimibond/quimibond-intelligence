"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { formatCurrency, timeAgo } from "@/lib/utils";
import { LoadingGrid } from "@/components/shared/loading-grid";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import {
  ArrowRight, DollarSign, Inbox, RefreshCw, Truck,
  TrendingUp, TrendingDown, FileText, Banknote,
  Mail, ShoppingCart, Package, ClipboardList,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell, Tooltip } from "recharts";

// ── Types ──

interface DashboardData {
  ventasHoy: number; pedidosHoy: number; ventasAyer: number;
  cobrosHoy: number; numCobrosHoy: number;
  cobranzaVencida: number; facturasVencidas: number;
  entregasCompletadasHoy: number; entregasPendientesHoy: number; entregasAtrasadas: number;
  emailsHoy: number; emailsAyer: number;
  insightsPendientes: number; insightsNuevos: number;
  ventasSemana: number; ventasSemanaPasada: number; vendidoMes: number; facturadoMes: number;
  comprasHoy: number; numComprasHoy: number;
  revenueByMonth: { month: string; revenue: number; clients: number }[];
  vendedoresMes: { name: string; orders: number; total: number }[];
  agingBuckets: { bucket: string; count: number; total: number; color: string }[];
  otdRate: number | null;
  actividadesVencidas: number;
  accionesPendientes: number; accionesCompletadasHoy: number;
  cashflow: { period: string; receivable: number; expected: number; probability: number }[];
  cashflowTotal: { receivable: number; expected: number; probability: number } | null;
  anomalyCount: number; cobrosEstaSemana: number;
  briefingSummary: string | null;
  lastUpdated: string;
}

// ── Helpers ──

function fmtCompact(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `$${Math.round(v / 1_000)}K`;
  return `$${Math.round(v)}`;
}

function deltaStr(curr: number, prev: number, label: string): string {
  if (prev === 0) return "";
  const pct = Math.round(((curr - prev) / Math.abs(prev)) * 100);
  return `${pct >= 0 ? "↑" : "↓"}${Math.abs(pct)}% vs ${label}`;
}

function greet(): string {
  const h = new Date().getHours();
  return h < 12 ? "Buenos días" : h < 19 ? "Buenas tardes" : "Buenas noches";
}

// ── Main Component ──

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const now = new Date();
      const todayStr = now.toISOString().split("T")[0];
      const tomorrowStr = new Date(now.getTime() + 86400_000).toISOString().split("T")[0];
      const yesterdayStr = new Date(now.getTime() - 86400_000).toISOString().split("T")[0];
      const dow = now.getDay();
      const mon = new Date(now); mon.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1));
      const thisWeekStr = mon.toISOString().split("T")[0];
      const lastWeekStr = new Date(mon.getTime() - 7 * 86400_000).toISOString().split("T")[0];
      const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
      const rangeStr = new Date(now.getTime() - 45 * 86400_000).toISOString().split("T")[0];

      async function sq<T>(p: PromiseLike<{ data: T | null }>): Promise<T | null> {
        try { return (await p).data; } catch { return null; }
      }
      async function sc(p: PromiseLike<{ count: number | null }>): Promise<number> {
        try { return (await p).count ?? 0; } catch { return 0; }
      }

      const [
        salesR, paymentsR, overdueR, deliveriesR,
        emailsTodayR, emailsYesterdayR, insightsR,
        purchasesR, activitiesR, actionsPendR, actionsCompR,
        revenueR, invoicedR, cashflowR, anomalyR, briefingR,
      ] = await Promise.all([
        sq(supabase.from("odoo_sale_orders").select("date_order, amount_untaxed, salesperson_name").gte("date_order", rangeStr).in("state", ["sale", "done"]).limit(1000)),
        sq(supabase.from("odoo_account_payments").select("date, amount").gte("date", monthStr).eq("payment_type", "inbound").limit(1000)),
        sq(supabase.from("odoo_invoices").select("amount_residual, days_overdue").eq("move_type", "out_invoice").in("payment_state", ["not_paid", "partial"]).gt("days_overdue", 0)),
        sq(supabase.from("odoo_deliveries").select("state, date_done, scheduled_date, is_late").limit(1000)),
        sc(supabase.from("emails").select("id", { count: "exact", head: true }).gte("email_date", todayStr).lt("email_date", tomorrowStr)),
        sc(supabase.from("emails").select("id", { count: "exact", head: true }).gte("email_date", yesterdayStr).lt("email_date", todayStr)),
        sq(supabase.from("agent_insights").select("state").in("state", ["new", "seen"]).gte("confidence", 0.80)),
        sq(supabase.from("odoo_purchase_orders").select("amount_untaxed").gte("date_order", todayStr).lt("date_order", tomorrowStr).in("state", ["purchase", "done"])),
        sc(supabase.from("odoo_activities").select("id", { count: "exact", head: true }).eq("is_overdue", true)),
        sc(supabase.from("action_items").select("id", { count: "exact", head: true }).eq("state", "pending")),
        sc(supabase.from("action_items").select("id", { count: "exact", head: true }).eq("state", "completed").gte("completed_at", todayStr)),
        sq(supabase.from("monthly_revenue_trend").select("month, revenue, active_clients, mom_change_pct").order("month", { ascending: false }).limit(7)),
        sq(supabase.from("odoo_invoices").select("amount_total").eq("move_type", "out_invoice").eq("state", "posted").gte("invoice_date", monthStr)),
        sq(supabase.from("cashflow_projection").select("flow_type, period, gross_amount, net_amount, probability").order("sort_order")),
        sc(supabase.from("accounting_anomalies").select("id", { count: "exact", head: true }).in("severity", ["critical", "high"])),
        sq(supabase.from("briefings").select("summary_text").eq("scope", "daily").order("created_at", { ascending: false }).limit(1)),
      ]);

      // Process sales
      const sales = (salesR ?? []) as { date_order: string; amount_untaxed: number; salesperson_name: string | null }[];
      const sToday = sales.filter(r => r.date_order >= todayStr && r.date_order < tomorrowStr);
      const ventasHoy = sToday.reduce((s, r) => s + Number(r.amount_untaxed ?? 0), 0);
      const ventasAyer = sales.filter(r => r.date_order >= yesterdayStr && r.date_order < todayStr).reduce((s, r) => s + Number(r.amount_untaxed ?? 0), 0);
      const ventasSemana = sales.filter(r => r.date_order >= thisWeekStr).reduce((s, r) => s + Number(r.amount_untaxed ?? 0), 0);
      const ventasSemanaPasada = sales.filter(r => r.date_order >= lastWeekStr && r.date_order < thisWeekStr).reduce((s, r) => s + Number(r.amount_untaxed ?? 0), 0);
      const salesMonth = sales.filter(r => r.date_order >= monthStr);
      const vendidoMes = salesMonth.reduce((s, r) => s + Number(r.amount_untaxed ?? 0), 0);

      // Vendedores
      const vMap = new Map<string, { orders: number; total: number }>();
      for (const r of salesMonth) {
        const n = r.salesperson_name ?? "Sin asignar";
        const p = vMap.get(n) ?? { orders: 0, total: 0 };
        vMap.set(n, { orders: p.orders + 1, total: p.total + Number(r.amount_untaxed ?? 0) });
      }
      const vendedoresMes = [...vMap.entries()].map(([name, s]) => ({ name, ...s })).sort((a, b) => b.total - a.total).slice(0, 5);

      // Payments
      const payments = (paymentsR ?? []) as { date: string; amount: number }[];
      const pToday = payments.filter(r => r.date >= todayStr && r.date < tomorrowStr);
      const cobrosHoy = pToday.reduce((s, r) => s + Number(r.amount ?? 0), 0);
      const cobrosEstaSemana = payments.filter(r => r.date >= thisWeekStr).reduce((s, r) => s + Number(r.amount ?? 0), 0);

      // Overdue + aging
      const overdue = (overdueR ?? []) as { amount_residual: number; days_overdue: number }[];
      const cobranzaVencida = overdue.reduce((s, r) => s + Number(r.amount_residual ?? 0), 0);
      const bDefs = [
        { label: "1-15d", min: 1, max: 15, color: "bg-yellow-400" },
        { label: "16-30d", min: 16, max: 30, color: "bg-amber-500" },
        { label: "31-60d", min: 31, max: 60, color: "bg-orange-500" },
        { label: "61-90d", min: 61, max: 90, color: "bg-red-400" },
        { label: "90d+", min: 91, max: 99999, color: "bg-red-600" },
      ];
      const agingBuckets = bDefs.map(b => {
        const rows = overdue.filter(r => r.days_overdue >= b.min && r.days_overdue <= b.max);
        return { bucket: b.label, count: rows.length, total: rows.reduce((s, r) => s + Number(r.amount_residual ?? 0), 0), color: b.color };
      }).filter(b => b.count > 0);

      // Deliveries
      const dels = (deliveriesR ?? []) as { state: string; date_done: string | null; scheduled_date: string | null; is_late: boolean }[];
      const entregasCompletadasHoy = dels.filter(r => r.state === "done" && r.date_done && r.date_done >= todayStr && r.date_done < tomorrowStr).length;
      const entregasPendientesHoy = dels.filter(r => !["done", "cancel"].includes(r.state) && r.scheduled_date && r.scheduled_date >= todayStr && r.scheduled_date < tomorrowStr).length;
      const entregasAtrasadas = dels.filter(r => r.is_late && !["done", "cancel"].includes(r.state)).length;
      const done = dels.filter(r => r.state === "done");
      const ontime = done.filter(r => !r.is_late);
      const otdRate = done.length > 0 ? Math.round((ontime.length / done.length) * 100) : null;

      // Insights
      const ins = (insightsR ?? []) as { state: string }[];

      // Purchases
      const purch = (purchasesR ?? []) as { amount_untaxed: number }[];
      const comprasHoy = purch.reduce((s, r) => s + Number(r.amount_untaxed ?? 0), 0);

      // Revenue chart
      const revRaw = ((revenueR ?? []) as { month: string; revenue: string; active_clients: number }[]).reverse();
      const revenueByMonth = revRaw.map(r => ({
        month: new Date(r.month).toLocaleDateString("es-MX", { month: "short" }),
        revenue: Number(r.revenue ?? 0),
        clients: r.active_clients ?? 0,
      }));

      // Invoiced this month
      const invRows = (invoicedR ?? []) as { amount_total: number }[];
      const facturadoMes = invRows.reduce((s, r) => s + Number(r.amount_total ?? 0), 0);

      // Cashflow
      const cfRows = ((cashflowR ?? []) as { flow_type: string; period: string; gross_amount: number; net_amount: number; probability: number }[]);
      const cfSummary = cfRows.find(r => r.flow_type === "summary");
      const cashflow = cfRows.filter(r => r.flow_type === "receivable").map(r => ({
        period: r.period.replace(" dias", "d"), receivable: Number(r.gross_amount ?? 0),
        expected: Number(r.net_amount ?? 0), probability: Number(r.probability ?? 0),
      }));

      setData({
        ventasHoy, pedidosHoy: sToday.length, ventasAyer,
        cobrosHoy, numCobrosHoy: pToday.length,
        cobranzaVencida, facturasVencidas: overdue.length,
        entregasCompletadasHoy, entregasPendientesHoy, entregasAtrasadas,
        emailsHoy: emailsTodayR, emailsAyer: emailsYesterdayR,
        insightsPendientes: ins.length, insightsNuevos: ins.filter(r => r.state === "new").length,
        ventasSemana, ventasSemanaPasada, vendidoMes, facturadoMes,
        comprasHoy, numComprasHoy: purch.length,
        revenueByMonth, vendedoresMes, agingBuckets,
        otdRate, actividadesVencidas: activitiesR,
        accionesPendientes: actionsPendR, accionesCompletadasHoy: actionsCompR,
        cashflow, cashflowTotal: cfSummary ? { receivable: Number(cfSummary.gross_amount ?? 0), expected: Number(cfSummary.net_amount ?? 0), probability: Number(cfSummary.probability ?? 0) } : null,
        anomalyCount: anomalyR, cobrosEstaSemana,
        briefingSummary: (briefingR as { summary_text: string }[] | null)?.[0]?.summary_text ?? null,
        lastUpdated: new Date().toISOString(),
      });
    } catch (err) { setError(String(err)); }
    setLoading(false); setRefreshing(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  function handleRefresh() { setRefreshing(true); load(); }

  if (loading) return (
    <div className="space-y-4">
      <div className="h-7 w-40 bg-muted rounded animate-pulse" />
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {[1, 2, 3, 4, 5, 6].map(i => <div key={i} className="h-24 bg-muted rounded-xl animate-pulse" />)}
      </div>
      <LoadingGrid rows={4} rowHeight="h-14" />
    </div>
  );

  if (error && !data) return (
    <div className="text-center py-20">
      <p className="text-sm text-destructive mb-2">Error al cargar</p>
      <Button variant="outline" size="sm" onClick={handleRefresh}>Reintentar</Button>
    </div>
  );

  if (!data) return null;
  const d = data;

  return (
    <div className="space-y-6">
      {/* ════ Header ════ */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black">{greet()}</h1>
          <p className="text-xs text-muted-foreground">{timeAgo(d.lastUpdated)}</p>
        </div>
        <Button size="icon" variant="ghost" onClick={handleRefresh} disabled={refreshing} className="h-9 w-9">
          <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
        </Button>
      </div>

      {/* ════ 6 KPI Tiles ════ */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2">
        <KPITile icon={ShoppingCart} label="Ventas hoy" value={fmtCompact(d.ventasHoy)}
          sub={`${d.pedidosHoy} pedidos${d.ventasAyer > 0 ? ` · ${deltaStr(d.ventasHoy, d.ventasAyer, "ayer")}` : ""}`}
          variant={d.ventasHoy >= d.ventasAyer ? "success" : "warning"} href="/companies" />
        <KPITile icon={Banknote} label="Cobros hoy" value={fmtCompact(d.cobrosHoy)}
          sub={`${d.numCobrosHoy} pagos`}
          variant="success" href="/companies" />
        <KPITile icon={DollarSign} label="Vencido" value={fmtCompact(d.cobranzaVencida)}
          sub={`${d.facturasVencidas} facturas`}
          variant="danger" href="/companies" />
        <KPITile icon={Truck} label="Entregas hoy" value={`${d.entregasCompletadasHoy} ✓`}
          sub={d.entregasAtrasadas > 0 ? `${d.entregasAtrasadas} atrasadas` : `${d.entregasPendientesHoy} pendientes`}
          variant={d.entregasAtrasadas > 0 ? "warning" : "success"} href="/companies" />
        <KPITile icon={Mail} label="Emails hoy" value={String(d.emailsHoy)}
          sub={d.emailsAyer > 0 ? deltaStr(d.emailsHoy, d.emailsAyer, "ayer") : ""}
          variant="default" href="/emails" />
        <KPITile icon={Inbox} label="Insights" value={String(d.insightsPendientes)}
          sub={d.insightsNuevos > 0 ? `${d.insightsNuevos} nuevos` : "al día"}
          variant={d.insightsNuevos > 0 ? "primary" : "success"} href="/inbox" />
      </div>

      <Separator />

      {/* ════ Ventas ════ */}
      <section className="space-y-3">
        <SectionTitle icon={TrendingUp} title="Ventas" color="text-success" />
        <div className="grid gap-3 md:grid-cols-5">
          {/* Revenue chart */}
          {d.revenueByMonth.length > 0 && (
            <Card className="md:col-span-3">
              <CardHeader className="pb-1">
                <CardTitle className="text-sm">Ingresos mensuales</CardTitle>
              </CardHeader>
              <CardContent className="pt-2">
                <div className="h-36">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={d.revenueByMonth} barGap={2}>
                      <XAxis dataKey="month" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                      <YAxis hide />
                      <Tooltip formatter={(v) => formatCurrency(Number(v))} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                      <Bar dataKey="revenue" name="Ingreso" radius={[4, 4, 0, 0]} maxBarSize={44}>
                        {d.revenueByMonth.map((_, i) => (
                          <Cell key={i} fill={i === d.revenueByMonth.length - 1 ? "hsl(var(--primary))" : "hsl(var(--muted-foreground) / 0.25)"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}
          {/* Stats + vendedores */}
          <div className="md:col-span-2 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <MiniStat label="Semana" value={fmtCompact(d.ventasSemana)}
                sub={d.ventasSemanaPasada > 0 ? deltaStr(d.ventasSemana, d.ventasSemanaPasada, "ant.") : ""} />
              <MiniStat label="Vendido mes" value={fmtCompact(d.vendidoMes)} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <MiniStat label="Facturado mes" value={fmtCompact(d.facturadoMes)} />
              <MiniStat label="Cobros semana" value={fmtCompact(d.cobrosEstaSemana)} variant="text-success" />
            </div>
            {d.vendedoresMes.length > 0 && (
              <Card>
                <CardContent className="p-3">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium mb-2">Top vendedores</p>
                  <div className="space-y-1.5">
                    {d.vendedoresMes.map((v, i) => (
                      <div key={i} className="flex items-center justify-between text-sm">
                        <span className="truncate flex-1 min-w-0">{v.name.split(" ").slice(0, 2).join(" ")}</span>
                        <span className="text-xs text-muted-foreground shrink-0 ml-2">{v.orders}p</span>
                        <span className="text-xs font-semibold tabular-nums shrink-0 ml-2 w-16 text-right">{fmtCompact(v.total)}</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </section>

      <Separator />

      {/* ════ Cobranza ════ */}
      <section className="space-y-3">
        <SectionTitle icon={DollarSign} title="Cobranza" color="text-danger" />
        <Card>
          <CardContent className="p-4">
            <div className="flex items-baseline justify-between mb-3">
              <p className="text-sm font-semibold">Cartera vencida</p>
              <div className="text-right">
                <span className="text-lg font-black text-danger tabular-nums">{fmtCompact(d.cobranzaVencida)}</span>
                <span className="text-xs text-muted-foreground ml-1.5">{d.facturasVencidas} fact.</span>
              </div>
            </div>
            {/* Aging stacked bar */}
            {d.agingBuckets.length > 0 && (
              <>
                <div className="flex h-3 rounded-full overflow-hidden gap-0.5 bg-muted">
                  {d.agingBuckets.map(b => (
                    <div key={b.bucket} className={cn("rounded-sm", b.color)} style={{ flex: b.total }} title={`${b.bucket}: ${fmtCompact(b.total)}`} />
                  ))}
                </div>
                <div className="grid grid-cols-5 gap-1 mt-3">
                  {d.agingBuckets.map(b => (
                    <div key={b.bucket} className="text-center">
                      <div className={cn("h-2 w-2 rounded-full mx-auto mb-1", b.color)} />
                      <p className="text-[10px] font-medium">{b.bucket}</p>
                      <p className="text-[10px] text-muted-foreground tabular-nums">{fmtCompact(b.total)}</p>
                      <p className="text-[9px] text-muted-foreground">{b.count} fact.</p>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </section>

      <Separator />

      {/* ════ Operaciones ════ */}
      <section className="space-y-3">
        <SectionTitle icon={Package} title="Operaciones" color="text-info" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Card>
            <CardContent className="p-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">OTD</p>
              <p className={cn("text-xl font-black tabular-nums", d.otdRate !== null && d.otdRate >= 90 ? "text-success" : "text-warning")}>{d.otdRate !== null ? `${d.otdRate}%` : "—"}</p>
              <Progress value={d.otdRate ?? 0} className="h-1.5 mt-1" />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Atrasadas</p>
              <p className={cn("text-xl font-black tabular-nums", d.entregasAtrasadas > 0 ? "text-danger" : "")}>{d.entregasAtrasadas}</p>
              <p className="text-[10px] text-muted-foreground">entregas</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Compras hoy</p>
              <p className="text-xl font-black tabular-nums">{fmtCompact(d.comprasHoy)}</p>
              <p className="text-[10px] text-muted-foreground">{d.numComprasHoy} OC</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Acciones</p>
              <p className="text-xl font-black tabular-nums">{d.accionesPendientes}</p>
              <p className="text-[10px] text-muted-foreground">pend. · {d.accionesCompletadasHoy} hoy ✓</p>
            </CardContent>
          </Card>
        </div>
      </section>

      <Separator />

      {/* ════ Cashflow ════ */}
      {d.cashflow.length > 0 && (
        <section className="space-y-3">
          <SectionTitle icon={Banknote} title="Flujo de efectivo" color="text-warning" />
          <Card>
            <CardHeader className="pb-1">
              <div className="flex items-center justify-between">
                {d.cashflowTotal && (
                  <p className="text-xs text-muted-foreground">
                    Por cobrar: {formatCurrency(d.cashflowTotal.receivable)} → esperado: {formatCurrency(d.cashflowTotal.expected)} ({d.cashflowTotal.probability}%)
                  </p>
                )}
                {d.anomalyCount > 0 && (
                  <Badge variant="critical" className="text-[10px]">{d.anomalyCount} anomalías</Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="pt-2">
              <div className="h-32">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={d.cashflow} barGap={2}>
                    <XAxis dataKey="period" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis hide />
                    <Tooltip formatter={(v) => formatCurrency(Number(v))} labelFormatter={(l) => `Período: ${l}`} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                    <Bar dataKey="receivable" name="Por cobrar" radius={[4, 4, 0, 0]} maxBarSize={40}>
                      {d.cashflow.map((_, i) => <Cell key={i} fill="hsl(var(--muted-foreground) / 0.2)" />)}
                    </Bar>
                    <Bar dataKey="expected" name="Esperado" radius={[4, 4, 0, 0]} maxBarSize={40}>
                      {d.cashflow.map((e, i) => <Cell key={i} fill={e.probability >= 85 ? "hsl(var(--success))" : "hsl(var(--warning))"} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </section>
      )}

      {/* ════ Briefing ════ */}
      {d.briefingSummary && (
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
            <p className="text-sm text-muted-foreground leading-relaxed line-clamp-4">{d.briefingSummary}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Sub-components ──

function KPITile({ icon: Icon, label, value, sub, variant = "default", href }: {
  icon: React.ElementType; label: string; value: string; sub?: string;
  variant?: "default" | "danger" | "warning" | "success" | "primary" | "info"; href: string;
}) {
  const vc: Record<string, string> = {
    default: "", danger: "text-danger", warning: "text-warning",
    success: "text-success", primary: "text-primary", info: "text-info",
  };
  return (
    <Link href={href}>
      <Card className="h-full hover:bg-muted/50 transition-colors">
        <CardContent className="p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <Icon className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium truncate">{label}</span>
          </div>
          <p className={cn("text-xl font-black tabular-nums truncate leading-none", vc[variant])}>{value}</p>
          {sub && <p className="text-[10px] text-muted-foreground mt-1 truncate">{sub}</p>}
        </CardContent>
      </Card>
    </Link>
  );
}

function SectionTitle({ icon: Icon, title, color }: { icon: React.ElementType; title: string; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className={cn("h-4 w-4", color)} />
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
      <div className="flex-1 border-b" />
    </div>
  );
}

function MiniStat({ label, value, sub, variant }: {
  label: string; value: string; sub?: string; variant?: string;
}) {
  return (
    <Card>
      <CardContent className="p-3">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">{label}</p>
        <p className={cn("text-lg font-bold tabular-nums", variant)}>{value}</p>
        {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}
