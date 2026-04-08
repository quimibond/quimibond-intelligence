"use client";

import Link from "next/link";
import { formatCurrency, timeAgo } from "@/lib/utils";
import { LoadingGrid } from "@/components/shared/loading-grid";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import {
  ArrowRight, DollarSign, Inbox, RefreshCw, Truck,
  TrendingUp, FileText, Banknote,
  Mail, ShoppingCart, Package,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell, Tooltip } from "recharts";

import { useDashboardData, fmtCompact, deltaStr } from "./hooks/use-dashboard-data";
import { KPICard } from "./components/kpi-card";
import { SectionHeader } from "./components/section-header";
import { MiniStat } from "./components/mini-stat";

function greet(): string {
  const h = new Date().getHours();
  return h < 12 ? "Buenos días" : h < 19 ? "Buenas tardes" : "Buenas noches";
}

export default function DashboardPage() {
  const { data, loading, error, refreshing, handleRefresh } = useDashboardData();

  if (loading) return (
    <div className="space-y-4">
      <div className="h-7 w-40 animate-pulse rounded bg-muted" />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {[1, 2, 3, 4, 5, 6].map(i => <div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />)}
      </div>
      <LoadingGrid rows={4} rowHeight="h-14" />
    </div>
  );

  if (error && !data) return (
    <div className="py-20 text-center">
      <p className="mb-2 text-sm text-destructive">Error al cargar</p>
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
          <h1 className="text-2xl font-bold lg:text-3xl">{greet()}</h1>
          <p className="text-xs text-muted-foreground">{timeAgo(d.lastUpdated)}</p>
        </div>
        <Button size="icon" variant="ghost" onClick={handleRefresh} disabled={refreshing} className="h-9 w-9">
          <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
        </Button>
      </div>

      {/* ════ 6 KPI Tiles ════ */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        <KPICard icon={ShoppingCart} title="Ventas hoy" value={fmtCompact(d.ventasHoy)}
          subtitle={`${d.pedidosHoy} pedidos${d.ventasAyer > 0 ? ` · ${deltaStr(d.ventasHoy, d.ventasAyer, "ayer")}` : ""}`}
          variant={d.ventasHoy >= d.ventasAyer ? "success" : "warning"} href="/companies" />
        <KPICard icon={Banknote} title="Cobros hoy" value={fmtCompact(d.cobrosHoy)}
          subtitle={`${d.numCobrosHoy} pagos`}
          variant="success" href="/companies" />
        <KPICard icon={DollarSign} title="Vencido" value={fmtCompact(d.cobranzaVencida)}
          subtitle={`${d.facturasVencidas} facturas`}
          variant="danger" href="/companies" />
        <KPICard icon={Truck} title="Entregas hoy" value={`${d.entregasCompletadasHoy} ✓`}
          subtitle={d.entregasAtrasadas > 0 ? `${d.entregasAtrasadas} atrasadas` : `${d.entregasPendientesHoy} pendientes`}
          variant={d.entregasAtrasadas > 0 ? "warning" : "success"} href="/companies" />
        <KPICard icon={Mail} title="Emails hoy" value={String(d.emailsHoy)}
          subtitle={d.emailsAyer > 0 ? deltaStr(d.emailsHoy, d.emailsAyer, "ayer") : ""}
          variant="default" href="/emails" />
        <KPICard icon={Inbox} title="Insights" value={String(d.insightsPendientes)}
          subtitle={d.insightsNuevos > 0 ? `${d.insightsNuevos} nuevos` : "al día"}
          variant={d.insightsNuevos > 0 ? "primary" : "success"} href="/inbox" />
      </div>

      <Separator />

      {/* ════ Ventas ════ */}
      <section className="space-y-3">
        <SectionHeader icon={TrendingUp} title="Ventas" color="text-success" />
        <div className="grid gap-3 md:grid-cols-5">
          {d.revenueByMonth.length > 0 && (
            <Card className="md:col-span-3">
              <CardHeader className="pb-1">
                <CardTitle className="text-sm">Ingresos mensuales</CardTitle>
              </CardHeader>
              <CardContent className="pt-2">
                <div className="h-36 lg:h-48">
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

          <div className="space-y-2 md:col-span-2">
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
                  <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Top vendedores
                  </p>
                  <div className="space-y-1.5">
                    {d.vendedoresMes.map((v, i) => (
                      <div key={i} className="flex items-center justify-between text-sm">
                        <span className="min-w-0 flex-1 truncate">{v.name.split(" ").slice(0, 2).join(" ")}</span>
                        <span className="ml-2 shrink-0 text-xs text-muted-foreground">{v.orders}p</span>
                        <span className="ml-2 w-16 shrink-0 text-right text-xs font-semibold tabular-nums">
                          {fmtCompact(v.total)}
                        </span>
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
        <SectionHeader icon={DollarSign} title="Cobranza" color="text-danger" />
        <Card>
          <CardContent className="p-4">
            <div className="mb-3 flex items-baseline justify-between">
              <p className="text-sm font-semibold">Cartera vencida</p>
              <div className="text-right">
                <span className="text-lg font-bold tabular-nums text-danger">{fmtCompact(d.cobranzaVencida)}</span>
                <span className="ml-1.5 text-xs text-muted-foreground">{d.facturasVencidas} fact.</span>
              </div>
            </div>
            {d.agingBuckets.length > 0 && (
              <>
                <div className="flex h-3 gap-0.5 overflow-hidden rounded-full bg-muted">
                  {d.agingBuckets.map(b => (
                    <div key={b.bucket} className={cn("rounded-sm", b.color)}
                      style={{ flex: b.total }} title={`${b.bucket}: ${fmtCompact(b.total)}`} />
                  ))}
                </div>
                <div className="mt-3 grid grid-cols-5 gap-1">
                  {d.agingBuckets.map(b => (
                    <div key={b.bucket} className="text-center">
                      <div className={cn("mx-auto mb-1 h-2 w-2 rounded-full", b.color)} />
                      <p className="text-[10px] font-medium">{b.bucket}</p>
                      <p className="text-[10px] tabular-nums text-muted-foreground">{fmtCompact(b.total)}</p>
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
        <SectionHeader icon={Package} title="Operaciones" color="text-info" />
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Card>
            <CardContent className="p-3">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">OTD</p>
              <p className={cn("text-xl font-bold tabular-nums", d.otdRate !== null && d.otdRate >= 90 ? "text-success" : "text-warning")}>
                {d.otdRate !== null ? `${d.otdRate}%` : "—"}
              </p>
              <Progress value={d.otdRate ?? 0} className="mt-1 h-1.5" />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Atrasadas</p>
              <p className={cn("text-xl font-bold tabular-nums", d.entregasAtrasadas > 0 && "text-danger")}>
                {d.entregasAtrasadas}
              </p>
              <p className="text-[10px] text-muted-foreground">entregas</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Compras hoy</p>
              <p className="text-xl font-bold tabular-nums">{fmtCompact(d.comprasHoy)}</p>
              <p className="text-[10px] text-muted-foreground">{d.numComprasHoy} OC</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3">
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Acciones</p>
              <p className="text-xl font-bold tabular-nums">{d.accionesPendientes}</p>
              <p className="text-[10px] text-muted-foreground">pend. · {d.accionesCompletadasHoy} hoy ✓</p>
            </CardContent>
          </Card>
        </div>
      </section>

      <Separator />

      {/* ════ Cashflow ════ */}
      {d.cashflow.length > 0 && (
        <section className="space-y-3">
          <SectionHeader icon={Banknote} title="Flujo de efectivo" color="text-warning" />
          <Card>
            <CardHeader className="pb-1">
              <div className="flex items-center justify-between">
                {d.cashflowTotal && (
                  <p className="text-xs text-muted-foreground">
                    Por cobrar: {formatCurrency(d.cashflowTotal.receivable)} → esperado:{" "}
                    {formatCurrency(d.cashflowTotal.expected)} ({d.cashflowTotal.probability}%)
                  </p>
                )}
                {d.anomalyCount > 0 && (
                  <Badge variant="critical" className="text-[10px]">{d.anomalyCount} anomalías</Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="pt-2">
              <div className="h-32 lg:h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={d.cashflow} barGap={2}>
                    <XAxis dataKey="period" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis hide />
                    <Tooltip formatter={(v) => formatCurrency(Number(v))}
                      labelFormatter={(l) => `Período: ${l}` }
                      contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                    <Bar dataKey="receivable" name="Por cobrar" radius={[4, 4, 0, 0]} maxBarSize={40}>
                      {d.cashflow.map((_, i) => <Cell key={i} fill="hsl(var(--muted-foreground) / 0.2)" />)}
                    </Bar>
                    <Bar dataKey="expected" name="Esperado" radius={[4, 4, 0, 0]} maxBarSize={40}>
                      {d.cashflow.map((e, i) => (
                        <Cell key={i} fill={e.probability >= 85 ? "hsl(var(--success))" : "hsl(var(--warning))"} />
                      ))}
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
              <Link href="/briefings" className="flex items-center gap-0.5 text-xs font-medium text-primary">
                Ver <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            <p className="line-clamp-4 text-sm leading-relaxed text-muted-foreground">
              {d.briefingSummary}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
