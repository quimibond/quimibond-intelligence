"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";

/* ── Types ── */

export interface DashboardData {
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

/* ── Helpers ── */

export function fmtCompact(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `$${Math.round(v / 1_000)}K`;
  return `$${Math.round(v)}`;
}

export function deltaStr(curr: number, prev: number, label: string): string {
  if (prev === 0) return "";
  const pct = Math.round(((curr - prev) / Math.abs(prev)) * 100);
  return `${pct >= 0 ? "↑" : "↓"}${Math.abs(pct)}% vs ${label}`;
}

/* ── Hook ── */

export function useDashboardData() {
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
        sq(supabase.from("odoo_payments").select("payment_date, amount").gte("payment_date", monthStr).eq("payment_type", "inbound").limit(1000)),
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
      const payments = (paymentsR ?? []) as { payment_date: string; amount: number }[];
      const pToday = payments.filter(r => r.payment_date >= todayStr && r.payment_date < tomorrowStr);
      const cobrosHoy = pToday.reduce((s, r) => s + Number(r.amount ?? 0), 0);
      const cobrosEstaSemana = payments.filter(r => r.payment_date >= thisWeekStr).reduce((s, r) => s + Number(r.amount ?? 0), 0);

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

  return { data, loading, error, refreshing, handleRefresh };
}
