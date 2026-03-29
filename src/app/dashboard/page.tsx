"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { cn, timeAgo, scoreToPercent } from "@/lib/utils";
import type { DirectorDashboard, DashboardKPI } from "@/lib/types";
import { AgingChart } from "@/components/shared/aging-chart";
import { PageHeader } from "@/components/shared/page-header";
import { SeverityBadge } from "@/components/shared/severity-badge";
import { RiskBadge } from "@/components/shared/risk-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import Link from "next/link";
import {
  Bell, CheckSquare, CreditCard, DollarSign, PackageX, Truck,
  TrendingUp, Users, Mail, AlertTriangle, ClipboardList, FileText,
  UserCheck, Brain, MessageSquare, BarChart3, Target, Shield,
  ArrowRight, Activity,
} from "lucide-react";

function formatCurrency(value: number | null): string {
  if (value == null) return "—";
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

// ── Types ──
interface GlobalAging {
  current: number;
  "1_30": number;
  "31_60": number;
  "61_90": number;
  "90_plus": number;
  total_outstanding: number;
}
interface LateDelivery {
  name: string;
  company_name: string | null;
  company_id: number | null;
  scheduled_date: string | null;
  picking_type: string | null;
  origin: string | null;
}
interface PipelineGlobal {
  total_opportunities: number;
  pipeline_value: number;
  weighted_value: number;
}

// ── Clickable KPI Card ──
function KPICard({
  title, value, subtitle, icon: Icon, href, variant = "default", className,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ElementType;
  href: string;
  variant?: "default" | "danger" | "warning" | "success" | "info";
  className?: string;
}) {
  const colors = {
    default: "hover:border-foreground/20",
    danger: "border-red-500/30 bg-red-500/5 hover:bg-red-500/10",
    warning: "border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10",
    success: "border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10",
    info: "border-blue-500/30 bg-blue-500/5 hover:bg-blue-500/10",
  };
  const iconColors = {
    default: "text-muted-foreground",
    danger: "text-red-500",
    warning: "text-amber-500",
    success: "text-emerald-500",
    info: "text-blue-500",
  };
  const valueColors = {
    default: "",
    danger: "text-red-600 dark:text-red-400",
    warning: "text-amber-600 dark:text-amber-400",
    success: "text-emerald-600 dark:text-emerald-400",
    info: "text-blue-600 dark:text-blue-400",
  };

  return (
    <Link href={href} className={cn("block group", className)}>
      <Card className={cn("transition-all cursor-pointer", colors[variant])}>
        <CardContent className="pt-4 pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Icon className={cn("h-4 w-4", iconColors[variant])} />
              <span>{title}</span>
            </div>
            <ArrowRight className="h-3 w-3 text-muted-foreground/0 group-hover:text-muted-foreground transition-all" />
          </div>
          <p className={cn("mt-1 text-2xl font-bold tabular-nums", valueColors[variant])}>
            {value}
          </p>
          {subtitle && (
            <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}

// ── Section Header ──
function SectionHeader({ title, icon: Icon, color }: { title: string; icon: React.ElementType; color: string }) {
  return (
    <div className="flex items-center gap-2 pt-2">
      <Icon className={cn("h-4 w-4", color)} />
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
      <div className="flex-1 border-b" />
    </div>
  );
}

// ── Main data fetch ──
async function fetchDashboard() {
  const today = new Date().toISOString().split("T")[0];

  const [
    alertsNewRes, alertsCritRes, actionsPendingRes, actionsOverdueRes,
    actionsCompletedRes, contactsRiskRes, totalContactsRes, totalEmailsRes,
    alertsResolvedRes, criticalAlertsRes, overdueActionsRes, contactsAtRiskRes,
    stockoutRes, complianceRes, threadsStalled, totalCompanies, totalThreads,
    entitiesRes, factsRes,
    totalValueAtRiskRes,
  ] = await Promise.all([
    supabase.from("alerts").select("id", { count: "exact", head: true }).eq("state", "new"),
    supabase.from("alerts").select("id", { count: "exact", head: true }).eq("state", "new").in("severity", ["critical", "high"]),
    supabase.from("action_items").select("id", { count: "exact", head: true }).eq("state", "pending"),
    supabase.from("action_items").select("id", { count: "exact", head: true }).eq("state", "pending").lt("due_date", today),
    supabase.from("action_items").select("id", { count: "exact", head: true }).eq("state", "completed"),
    supabase.from("contacts").select("id", { count: "exact", head: true }).in("risk_level", ["high", "critical"]),
    supabase.from("contacts").select("id", { count: "exact", head: true }).eq("contact_type", "external"),
    supabase.from("emails").select("id", { count: "exact", head: true }),
    supabase.from("alerts").select("id", { count: "exact", head: true }).eq("state", "resolved"),
    supabase.from("alerts").select("id, title, severity, contact_name, description, created_at, alert_type").eq("state", "new").in("severity", ["critical", "high"]).order("created_at", { ascending: false }).limit(5),
    supabase.from("action_items").select("id, description, contact_name, contact_company, assignee_email, assignee_name, due_date, priority, action_type").eq("state", "pending").lt("due_date", today).order("due_date", { ascending: true }).limit(5),
    supabase.from("contacts").select("id, name, risk_level, sentiment_score, relationship_score, open_alerts_count, pending_actions_count, company_id").in("risk_level", ["high", "critical"]).order("relationship_score", { ascending: true }).limit(5),
    supabase.from("alerts").select("id", { count: "exact", head: true }).eq("state", "new").eq("alert_type", "stockout_risk"),
    supabase.from("contacts").select("id", { count: "exact", head: true }).lt("payment_compliance_score", 50).not("payment_compliance_score", "is", null),
    supabase.from("threads").select("id", { count: "exact", head: true }).in("status", ["stalled", "needs_response"]),
    supabase.from("companies").select("id", { count: "exact", head: true }),
    supabase.from("threads").select("id", { count: "exact", head: true }),
    supabase.from("entities").select("id", { count: "exact", head: true }),
    supabase.from("facts").select("id", { count: "exact", head: true }),
    supabase.from("alerts").select("business_value_at_risk").eq("state", "new").not("business_value_at_risk", "is", null),
  ]);

  return {
    kpi: {
      open_alerts: alertsNewRes.count ?? 0,
      critical_alerts: alertsCritRes.count ?? 0,
      pending_actions: actionsPendingRes.count ?? 0,
      overdue_actions: actionsOverdueRes.count ?? 0,
      at_risk_contacts: contactsRiskRes.count ?? 0,
      total_contacts: totalContactsRes.count ?? 0,
      total_emails: totalEmailsRes.count ?? 0,
      completed_actions: actionsCompletedRes.count ?? 0,
      resolved_alerts: alertsResolvedRes.count ?? 0,
    },
    critical_alerts: criticalAlertsRes.data ?? [],
    overdue_actions: (overdueActionsRes.data ?? []).map((a) => ({
      ...a,
      days_overdue: a.due_date ? Math.max(0, Math.floor((Date.now() - new Date(a.due_date).getTime()) / 86400000)) : 0,
    })),
    contacts_at_risk: contactsAtRiskRes.data ?? [],
    stockoutCount: stockoutRes.count ?? 0,
    lowComplianceCount: complianceRes.count ?? 0,
    threadsStalled: threadsStalled.count ?? 0,
    totalCompanies: totalCompanies.count ?? 0,
    totalThreads: totalThreads.count ?? 0,
    totalEntities: entitiesRes.count ?? 0,
    totalFacts: factsRes.count ?? 0,
    totalValueAtRisk: (totalValueAtRiskRes.data ?? []).reduce(
      (sum: number, a: { business_value_at_risk: number | null }) => sum + (a.business_value_at_risk ?? 0), 0
    ),
  };
}

export default function DashboardPage() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [globalAging, setGlobalAging] = useState<GlobalAging | null>(null);
  const [lateDeliveryCount, setLateDeliveryCount] = useState(0);
  const [pipelineGlobal, setPipelineGlobal] = useState<PipelineGlobal | null>(null);
  const [latestBriefing, setLatestBriefing] = useState<{ briefing_date: string; summary_text: string | null; total_emails: number } | null>(null);
  const [accountability, setAccountability] = useState<{ name: string; email: string | null; pending: number; overdue: number; completed: number }[]>([]);

  useEffect(() => {
    async function load() {
      try {
        const result = await fetchDashboard();
        setData(result);
      } catch (err) {
        console.error("[dashboard] Failed to load:", err);
      }

      // Non-blocking: aging, deliveries, pipeline, briefing, accountability
      supabase
        .from("odoo_invoices")
        .select("amount_residual, days_overdue")
        .eq("move_type", "out_invoice")
        .in("payment_state", ["not_paid", "partial"])
        .then(({ data: invoices }) => {
          if (!invoices) return;
          const aging: GlobalAging = { current: 0, "1_30": 0, "31_60": 0, "61_90": 0, "90_plus": 0, total_outstanding: 0 };
          for (const inv of invoices) {
            const amt = Number(inv.amount_residual ?? 0);
            const days = Number(inv.days_overdue ?? 0);
            aging.total_outstanding += amt;
            if (days <= 0) aging.current += amt;
            else if (days <= 30) aging["1_30"] += amt;
            else if (days <= 60) aging["31_60"] += amt;
            else if (days <= 90) aging["61_90"] += amt;
            else aging["90_plus"] += amt;
          }
          setGlobalAging(aging);
        });

      supabase
        .from("odoo_deliveries")
        .select("id", { count: "exact", head: true })
        .eq("is_late", true)
        .not("state", "in", '("done","cancel")')
        .then(({ count }) => setLateDeliveryCount(count ?? 0));

      supabase
        .from("odoo_crm_leads")
        .select("lead_type, expected_revenue, probability")
        .eq("active", true)
        .then(({ data: leads }) => {
          if (!leads) return;
          const opps = leads.filter((l) => l.lead_type === "opportunity");
          setPipelineGlobal({
            total_opportunities: opps.length,
            pipeline_value: opps.reduce((s, l) => s + Number(l.expected_revenue ?? 0), 0),
            weighted_value: opps.reduce((s, l) => s + Number(l.expected_revenue ?? 0) * Number(l.probability ?? 0) / 100, 0),
          });
        });

      supabase
        .from("briefings")
        .select("briefing_date, summary_text, total_emails")
        .eq("scope", "daily")
        .order("briefing_date", { ascending: false })
        .limit(1)
        .single()
        .then(({ data: b }) => { if (b) setLatestBriefing(b); });

      supabase
        .from("action_items")
        .select("assignee_name, assignee_email, state, due_date")
        .not("assignee_email", "is", null)
        .then(({ data: items }) => {
          if (!items) return;
          const today = new Date().toISOString().split("T")[0];
          const map = new Map<string, { name: string; email: string | null; pending: number; overdue: number; completed: number }>();
          for (const item of items) {
            const key = item.assignee_email ?? "?";
            if (!map.has(key)) map.set(key, { name: item.assignee_name ?? key, email: item.assignee_email, pending: 0, overdue: 0, completed: 0 });
            const e = map.get(key)!;
            if (item.state === "completed") e.completed++;
            else if (item.state === "pending") {
              e.pending++;
              if (item.due_date && item.due_date < today) e.overdue++;
            }
          }
          setAccountability(Array.from(map.values()).sort((a, b) => b.overdue - a.overdue || b.pending - a.pending).slice(0, 8));
        });

      setLoading(false);
    }
    load();
  }, []);

  if (loading || !data) {
    return (
      <div className="space-y-6">
        <PageHeader title="Centro de Control" description="Balanced Scorecard — Quimibond Intelligence" />
        <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-[100px] w-full" />
          ))}
        </div>
      </div>
    );
  }

  const { kpi, critical_alerts, overdue_actions, contacts_at_risk } = data;
  const overdueAmt = globalAging ? globalAging["1_30"] + globalAging["31_60"] + globalAging["61_90"] + globalAging["90_plus"] : 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Centro de Control"
        description="Balanced Scorecard — Quimibond Intelligence"
      />

      {/* ══════════════════════════════════════════════════════════════ */}
      {/*  PERSPECTIVA 1: ALERTAS Y RIESGOS                           */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <SectionHeader title="Alertas y Riesgos" icon={Shield} color="text-red-500" />

      <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        <KPICard
          title="Alertas Criticas"
          value={kpi.critical_alerts}
          subtitle={`${kpi.open_alerts} abiertas total`}
          icon={Bell}
          href="/alerts?state=new&severity=critical"
          variant={kpi.critical_alerts > 0 ? "danger" : "default"}
        />
        <KPICard
          title="Contactos en Riesgo"
          value={kpi.at_risk_contacts}
          subtitle={`de ${kpi.total_contacts} externos`}
          icon={Users}
          href="/contacts?risk=high"
          variant={kpi.at_risk_contacts > 0 ? "danger" : "default"}
        />
        <KPICard
          title="Desabasto"
          value={data.stockoutCount}
          subtitle="alertas activas"
          icon={PackageX}
          href="/alerts?type=stockout_risk"
          variant={data.stockoutCount > 0 ? "warning" : "default"}
        />
        <KPICard
          title="Valor en Riesgo"
          value={data.totalValueAtRisk > 0 ? formatCurrency(data.totalValueAtRisk) : "—"}
          subtitle={`${kpi.open_alerts} alertas abiertas`}
          icon={DollarSign}
          href="/alerts?sort=value"
          variant={data.totalValueAtRisk > 100000 ? "danger" : data.totalValueAtRisk > 0 ? "warning" : "default"}
        />
        <KPICard
          title="Threads sin Respuesta"
          value={data.threadsStalled}
          subtitle="necesitan atencion"
          icon={MessageSquare}
          href="/threads?status=stalled"
          variant={data.threadsStalled > 0 ? "warning" : "default"}
        />
      </div>

      {/* Alert + Risk detail cards */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <Link href="/alerts" className="flex items-center justify-between group">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-red-500" />
                <CardTitle className="text-base">Alertas Recientes</CardTitle>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
            </Link>
          </CardHeader>
          <CardContent>
            {critical_alerts.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                {kpi.open_alerts === 0 ? "No hay alertas. Ejecuta el pipeline de analisis desde Sistema." : "Sin alertas criticas — todo en orden."}
              </p>
            ) : (
              <div className="space-y-2">
                {critical_alerts.map((alert: { id: number; title: string; severity: string; contact_name: string | null; created_at: string }) => (
                  <Link key={alert.id} href={`/alerts/${alert.id}`} className="flex items-center gap-3 rounded-lg border p-2.5 hover:bg-muted/50 transition-colors">
                    <SeverityBadge severity={alert.severity} />
                    <span className="text-sm font-medium truncate flex-1">{alert.title}</span>
                    <span className="text-xs text-muted-foreground shrink-0">{timeAgo(alert.created_at)}</span>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <Link href="/contacts?risk=high" className="flex items-center justify-between group">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-red-500" />
                <CardTitle className="text-base">Contactos en Riesgo</CardTitle>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
            </Link>
          </CardHeader>
          <CardContent>
            {contacts_at_risk.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                {kpi.total_contacts === 0 ? "No hay contactos. Sincroniza desde Sistema." : "Sin contactos en riesgo alto — ejecuta el scoring desde Sistema."}
              </p>
            ) : (
              <div className="space-y-2">
                {contacts_at_risk.map((c: { id: number; name: string; risk_level: string; relationship_score: number | null; company_id: number | null }) => (
                  <Link key={c.id} href={`/contacts/${c.id}`} className="flex items-center gap-3 rounded-lg border p-2.5 hover:bg-muted/50 transition-colors">
                    <RiskBadge level={c.risk_level} />
                    <span className="text-sm font-medium truncate flex-1">{c.name}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      <Progress value={scoreToPercent(c.relationship_score)} className="h-1.5 w-16" />
                      <span className="text-xs text-muted-foreground w-6 text-right">{c.relationship_score ?? 0}</span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/*  PERSPECTIVA 2: FINANZAS Y OPERACIONES                      */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <SectionHeader title="Finanzas y Operaciones" icon={DollarSign} color="text-amber-500" />

      <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        <KPICard
          title="Saldo Vencido"
          value={globalAging ? formatCurrency(overdueAmt) : "—"}
          subtitle={globalAging ? `${formatCurrency(globalAging.total_outstanding)} total` : "sin datos de facturacion"}
          icon={CreditCard}
          href="/analytics"
          variant={overdueAmt > 0 ? "danger" : "default"}
        />
        <KPICard
          title="Pipeline CRM"
          value={pipelineGlobal ? formatCurrency(pipelineGlobal.pipeline_value) : "—"}
          subtitle={pipelineGlobal ? `${pipelineGlobal.total_opportunities} oportunidades` : "sin datos de CRM"}
          icon={TrendingUp}
          href="/companies"
          variant="info"
        />
        <KPICard
          title="Entregas Atrasadas"
          value={lateDeliveryCount}
          subtitle="pendientes de envio"
          icon={Truck}
          href="/companies"
          variant={lateDeliveryCount > 0 ? "warning" : "default"}
        />
        <KPICard
          title="Compliance Bajo"
          value={data.lowComplianceCount}
          subtitle="contactos <50%"
          icon={Target}
          href="/contacts"
          variant={data.lowComplianceCount > 0 ? "warning" : "default"}
        />
      </div>

      {/* Aging chart */}
      {globalAging && (
        <Card>
          <CardHeader className="pb-3">
            <Link href="/analytics" className="flex items-center justify-between group">
              <div className="flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-amber-500" />
                <CardTitle className="text-base">Antiguedad de Saldos</CardTitle>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
            </Link>
          </CardHeader>
          <CardContent>
            <AgingChart data={globalAging} />
          </CardContent>
        </Card>
      )}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/*  PERSPECTIVA 3: EJECUCION Y ACCOUNTABILITY                  */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <SectionHeader title="Ejecucion y Accountability" icon={CheckSquare} color="text-purple-500" />

      <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        <KPICard
          title="Acciones Vencidas"
          value={kpi.overdue_actions}
          subtitle={`${kpi.pending_actions} pendientes`}
          icon={ClipboardList}
          href="/actions?state=pending"
          variant={kpi.overdue_actions > 0 ? "danger" : "default"}
        />
        <KPICard
          title="Completadas"
          value={kpi.completed_actions}
          subtitle="acciones cerradas"
          icon={CheckSquare}
          href="/actions?state=completed"
          variant="success"
        />
        <KPICard
          title="Alertas Resueltas"
          value={kpi.resolved_alerts}
          subtitle="alertas cerradas"
          icon={Bell}
          href="/alerts?state=resolved"
          variant="success"
        />
        <KPICard
          title="Emails Procesados"
          value={kpi.total_emails}
          subtitle={`${data.totalThreads} threads`}
          icon={Mail}
          href="/threads"
          variant="info"
        />
      </div>

      {/* Overdue + Accountability */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <Link href="/actions?state=pending" className="flex items-center justify-between group">
              <div className="flex items-center gap-2">
                <ClipboardList className="h-4 w-4 text-amber-500" />
                <CardTitle className="text-base">Acciones Vencidas</CardTitle>
                {overdue_actions.length > 0 && <Badge variant="critical">{overdue_actions.length}</Badge>}
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
            </Link>
          </CardHeader>
          <CardContent>
            {overdue_actions.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">Sin acciones vencidas</p>
            ) : (
              <div className="space-y-2">
                {overdue_actions.map((a: { id: number; description: string; assignee_name: string | null; assignee_email: string | null; days_overdue: number }) => (
                  <div key={a.id} className="flex items-center gap-3 rounded-lg border p-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{a.description}</p>
                      <p className="text-xs text-muted-foreground">{a.assignee_name ?? a.assignee_email ?? "Sin asignar"}</p>
                    </div>
                    <Badge variant="critical" className="shrink-0">{a.days_overdue}d</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <Link href="/actions" className="flex items-center justify-between group">
              <div className="flex items-center gap-2">
                <UserCheck className="h-4 w-4 text-purple-500" />
                <CardTitle className="text-base">Accountability</CardTitle>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
            </Link>
          </CardHeader>
          <CardContent>
            {accountability.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">Sin datos de responsabilidad</p>
            ) : (
              <div className="space-y-2">
                {accountability.map((a) => (
                  <div key={a.email} className="flex items-center gap-3 rounded-lg border p-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{a.name}</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {a.overdue > 0 && <Badge variant="critical" className="text-xs">{a.overdue} vencidas</Badge>}
                      {a.pending > 0 && <Badge variant="warning" className="text-xs">{a.pending} pend.</Badge>}
                      <Badge variant="success" className="text-xs">{a.completed}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/*  PERSPECTIVA 4: INTELIGENCIA Y CONOCIMIENTO                 */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <SectionHeader title="Inteligencia y Conocimiento" icon={Brain} color="text-blue-500" />

      <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        <KPICard
          title="Empresas"
          value={data.totalCompanies}
          subtitle="en el sistema"
          icon={BarChart3}
          href="/companies"
          variant="info"
        />
        <KPICard
          title="Knowledge Graph"
          value={data.totalEntities}
          subtitle={`${data.totalFacts} hechos`}
          icon={Brain}
          href="/knowledge"
          variant={data.totalEntities > 0 ? "info" : "default"}
        />
        <KPICard
          title="Chat IA"
          value="Preguntar"
          subtitle="Claude + RAG"
          icon={MessageSquare}
          href="/chat"
          variant="info"
        />
        <KPICard
          title="Sistema"
          value="Monitor"
          subtitle="pipelines y sync"
          icon={Activity}
          href="/system"
          variant="default"
        />
      </div>

      {/* Briefing */}
      {latestBriefing && (
        <Card>
          <CardHeader className="pb-3">
            <Link href="/briefings" className="flex items-center justify-between group">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-blue-500" />
                <CardTitle className="text-base">Ultimo Briefing — {latestBriefing.briefing_date}</CardTitle>
                <span className="text-xs text-muted-foreground">{latestBriefing.total_emails ?? 0} emails</span>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
            </Link>
          </CardHeader>
          <CardContent>
            <p className="text-sm line-clamp-4">
              {latestBriefing.summary_text
                ? latestBriefing.summary_text.slice(0, 500) + (latestBriefing.summary_text.length > 500 ? "..." : "")
                : "Sin resumen disponible."}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
