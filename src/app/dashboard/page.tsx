"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { cn, timeAgo, scoreToPercent, formatCurrency } from "@/lib/utils";
import type { GlobalAging, PipelineGlobal } from "@/lib/types";
import { AgingChart } from "@/components/shared/aging-chart";
import { getDomainConfig } from "@/lib/domains";
import { PageHeader } from "@/components/shared/page-header";
import { SeverityBadge } from "@/components/shared/severity-badge";
import { RiskBadge } from "@/components/shared/risk-badge";
import { LoadingGrid } from "@/components/shared/loading-grid";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  ArrowRight, Activity, Bot, Brain, CheckSquare, CreditCard,
  DollarSign, FileText, Loader2, Mail, MessageSquare,
  Play, Shield, Target, TrendingUp, Truck, Users, Zap,
} from "lucide-react";

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
    danger: "border-danger/30 bg-danger/5 hover:bg-danger/10",
    warning: "border-warning/30 bg-warning/5 hover:bg-warning/10",
    success: "border-success/30 bg-success/5 hover:bg-success/10",
    info: "border-info/30 bg-info/5 hover:bg-info/10",
  };
  const iconColors = {
    default: "text-muted-foreground",
    danger: "text-danger",
    warning: "text-warning",
    success: "text-success",
    info: "text-info",
  };
  const valueColors = {
    default: "",
    danger: "text-danger",
    warning: "text-warning",
    success: "text-success",
    info: "text-info",
  };

  return (
    <Link href={href} className={cn("block group", className)}>
      <Card className={cn("transition-all cursor-pointer h-full", colors[variant])}>
        <CardContent className="pt-3 pb-2 sm:pt-4 sm:pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 sm:gap-2 text-[11px] sm:text-xs text-muted-foreground min-w-0">
              <Icon className={cn("h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0", iconColors[variant])} />
              <span className="truncate">{title}</span>
            </div>
            <ArrowRight className="h-3 w-3 text-muted-foreground/0 group-hover:text-muted-foreground transition-all shrink-0" />
          </div>
          <p className={cn("mt-1 text-xl sm:text-2xl font-bold tabular-nums truncate", valueColors[variant])}>
            {value}
          </p>
          {subtitle && (
            <p className="text-[11px] sm:text-xs text-muted-foreground mt-0.5 truncate">{subtitle}</p>
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

// ── Agents Summary Widget ──
function AgentsSummary() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [agents, setAgents] = useState<any[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [insights, setInsights] = useState<any[]>([]);
  const [runningAll, setRunningAll] = useState(false);

  useEffect(() => {
    async function load() {
      const [agentsRes, insightsRes] = await Promise.all([
        supabase.rpc("get_agents_overview"),
        supabase.from("agent_insights").select("id, agent_id, title, severity, confidence, insight_type, created_at")
          .in("state", ["new", "seen"]).gte("confidence", 0.65).order("created_at", { ascending: false }).limit(3),
      ]);
      setAgents(agentsRes.data ?? []);
      setInsights(insightsRes.data ?? []);
    }
    load();
  }, []);

  // Domain config is now centralized in @/lib/domains

  async function runAll() {
    setRunningAll(true);
    try {
      await fetch("/api/agents/run", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ run_all: true }),
      });
      const [a, i] = await Promise.all([
        supabase.rpc("get_agents_overview"),
        supabase.from("agent_insights").select("id, agent_id, title, severity, confidence, insight_type, created_at")
          .in("state", ["new", "seen"]).gte("confidence", 0.65).order("created_at", { ascending: false }).limit(3),
      ]);
      setAgents(a.data ?? []);
      setInsights(i.data ?? []);
    } finally { setRunningAll(false); }
  }

  const totalNewInsights = agents.reduce((s: number, a: { new_insights: number }) => s + (a.new_insights ?? 0), 0);

  return (
    <div className="space-y-3">
      {/* Agent cards - horizontal scroll on mobile */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 overflow-x-auto pb-1 -mb-1 min-w-0">
          {agents.slice(0, 7).map((a) => {
            const dc = getDomainConfig(a.domain);
            const Icon = dc.icon;
            return (
              <Link key={a.slug} href="/agents" className="flex items-center gap-2 shrink-0 rounded-lg border px-2.5 py-1.5 sm:px-3 sm:py-2 hover:bg-muted/50 transition-colors">
                <Icon className={cn("h-3.5 w-3.5 sm:h-4 sm:w-4", dc.color)} />
                <div className="text-[11px] sm:text-xs">
                  <p className="font-medium">{a.name?.replace("Agente de ", "")}</p>
                  <p className="text-muted-foreground">
                    {a.new_insights > 0 ? <span className="text-success font-medium">{a.new_insights} nuevos</span> : a.last_run_at ? timeAgo(a.last_run_at) : "nunca"}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
        <Button size="sm" variant="outline" onClick={runAll} disabled={runningAll} className="shrink-0">
          {runningAll ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Play className="h-3.5 w-3.5 mr-1" />}
          <span className="hidden sm:inline">{runningAll ? "..." : "Ejecutar"}</span>
        </Button>
      </div>

      {/* Latest insights preview */}
      {insights.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <Link href="/inbox" className="flex items-center justify-between group">
              <div className="flex items-center gap-2">
                <Bot className="h-4 w-4 text-domain-relationships" />
                <CardTitle className="text-sm sm:text-base">Insights Recientes ({totalNewInsights} nuevos)</CardTitle>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
            </Link>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {insights.map((ins) => (
              <Link key={ins.id} href={`/inbox/insight/${ins.id}`} className="flex items-center gap-2 sm:gap-3 rounded-lg border p-2 sm:p-2.5 hover:bg-muted/50 transition-colors">
                <SeverityBadge severity={ins.severity} />
                <span className="text-sm font-medium truncate flex-1 min-w-0">{ins.title}</span>
                <span className="text-[10px] sm:text-xs text-muted-foreground shrink-0">{timeAgo(ins.created_at)}</span>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Main data fetch (optimized: fewer queries, focused on agent_insights) ──
async function fetchDashboard() {
  const [
    insightsNewRes, insightsCritRes,
    contactsRiskRes, totalContactsRes,
    totalCompanies, totalEmailsRes, totalThreads,
    entitiesRes, factsRes,
    threadsStalled,
    emailsProcessedRes,
    insightsActedRes,
  ] = await Promise.all([
    supabase.from("agent_insights").select("id", { count: "exact", head: true }).in("state", ["new", "seen"]).gte("confidence", 0.65),
    supabase.from("agent_insights").select("id, title, severity, assignee_name, created_at")
      .in("state", ["new", "seen"]).in("severity", ["critical", "high"]).gte("confidence", 0.65)
      .order("created_at", { ascending: false }).limit(5),
    supabase.from("contacts").select("id", { count: "exact", head: true }).in("risk_level", ["high", "critical"]),
    supabase.from("contacts").select("id", { count: "exact", head: true }).eq("contact_type", "external"),
    supabase.from("companies").select("id", { count: "exact", head: true }),
    supabase.from("emails").select("id", { count: "exact", head: true }),
    supabase.from("threads").select("id", { count: "exact", head: true }),
    supabase.from("entities").select("id", { count: "exact", head: true }),
    supabase.from("facts").select("id", { count: "exact", head: true }),
    supabase.from("threads").select("id", { count: "exact", head: true }).in("status", ["stalled", "needs_response"]),
    supabase.from("emails").select("id", { count: "exact", head: true }).eq("kg_processed", true),
    supabase.from("agent_insights").select("id", { count: "exact", head: true }).eq("state", "acted_on"),
  ]);

  return {
    insightsNew: insightsNewRes.count ?? 0,
    criticalInsights: insightsCritRes.data ?? [],
    atRiskContacts: contactsRiskRes.count ?? 0,
    totalContacts: totalContactsRes.count ?? 0,
    totalCompanies: totalCompanies.count ?? 0,
    totalEmails: totalEmailsRes.count ?? 0,
    totalThreads: totalThreads.count ?? 0,
    totalEntities: entitiesRes.count ?? 0,
    totalFacts: factsRes.count ?? 0,
    threadsStalled: threadsStalled.count ?? 0,
    emailsProcessed: emailsProcessedRes.count ?? 0,
    insightsActed: insightsActedRes.count ?? 0,
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
  const [contactsAtRisk, setContactsAtRisk] = useState<{ id: number; name: string; risk_level: string; relationship_score: number | null }[]>([]);

  useEffect(() => {
    async function load() {
      // Non-blocking secondary fetches
      fetchSecondaryData();

      try {
        const result = await fetchDashboard();
        setData(result);
      } catch (err) {
        console.error("[dashboard] Failed to load:", err);
      }
      setLoading(false);
    }

    function fetchSecondaryData() {
      // Aging
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

      // Late deliveries
      supabase
        .from("odoo_deliveries")
        .select("id", { count: "exact", head: true })
        .eq("is_late", true)
        .not("state", "in", '("done","cancel")')
        .then(({ count }) => setLateDeliveryCount(count ?? 0));

      // Pipeline
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

      // Latest briefing
      supabase
        .from("briefings")
        .select("briefing_date, summary_text, total_emails")
        .eq("scope", "daily")
        .order("briefing_date", { ascending: false })
        .limit(1)
        .single()
        .then(({ data: b }) => { if (b) setLatestBriefing(b); });

      // Contacts at risk
      supabase
        .from("contacts")
        .select("id, name, risk_level, relationship_score")
        .in("risk_level", ["high", "critical"])
        .order("relationship_score", { ascending: true })
        .limit(5)
        .then(({ data: c }) => { if (c) setContactsAtRisk(c); });
    }

    load();
  }, []);

  if (loading || !data) {
    return (
      <div className="space-y-6">
        <PageHeader title="Centro de Control" description="Vista ejecutiva — Quimibond Intelligence" />
        <LoadingGrid stats={4} rows={4} statHeight="h-[100px]" />
      </div>
    );
  }

  const overdueAmt = globalAging ? globalAging["1_30"] + globalAging["31_60"] + globalAging["61_90"] + globalAging["90_plus"] : 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Centro de Control"
        description="Vista ejecutiva — Quimibond Intelligence"
      />

      {/* ══════════════════════════════════════════════════════════════ */}
      {/*  PERSPECTIVA 1: INSIGHTS Y RIESGOS                          */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <SectionHeader title="Insights y Riesgos" icon={Shield} color="text-danger" />

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <KPICard
          title="Insights Pendientes"
          value={data.insightsNew}
          subtitle="de agentes de IA"
          icon={Bot}
          href="/inbox"
          variant={data.insightsNew > 0 ? "danger" : "default"}
        />
        <KPICard
          title="Contactos en Riesgo"
          value={data.atRiskContacts}
          subtitle={`de ${data.totalContacts} externos`}
          icon={Users}
          href="/contacts"
          variant={data.atRiskContacts > 0 ? "danger" : "default"}
        />
        <KPICard
          title="Threads sin Respuesta"
          value={data.threadsStalled}
          subtitle="necesitan atencion"
          icon={MessageSquare}
          href="/threads"
          variant={data.threadsStalled > 0 ? "warning" : "default"}
        />
        <KPICard
          title="Insights Actuados"
          value={data.insightsActed}
          subtitle="feedback al sistema"
          icon={CheckSquare}
          href="/inbox"
          variant="success"
        />
      </div>

      {/* Critical insights + Contacts at risk */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <Link href="/inbox" className="flex items-center justify-between group">
              <div className="flex items-center gap-2">
                <Bot className="h-4 w-4 text-danger" />
                <CardTitle className="text-sm sm:text-base">Insights Urgentes</CardTitle>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
            </Link>
          </CardHeader>
          <CardContent>
            {data.criticalInsights.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                {data.insightsNew === 0 ? "Sin insights pendientes" : "Sin insights criticos — todo en orden"}
              </p>
            ) : (
              <div className="space-y-1.5">
                {data.criticalInsights.map((ins: { id: number; title: string; severity: string; assignee_name: string | null; created_at: string }) => (
                  <Link key={ins.id} href={`/inbox/insight/${ins.id}`} className="flex items-center gap-2 sm:gap-3 rounded-lg border p-2 sm:p-2.5 hover:bg-muted/50 transition-colors">
                    <SeverityBadge severity={ins.severity} />
                    <span className="text-sm font-medium truncate flex-1 min-w-0">{ins.title}</span>
                    <span className="text-[10px] sm:text-xs text-muted-foreground shrink-0">{timeAgo(ins.created_at)}</span>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <Link href="/contacts" className="flex items-center justify-between group">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-danger" />
                <CardTitle className="text-sm sm:text-base">Contactos en Riesgo</CardTitle>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
            </Link>
          </CardHeader>
          <CardContent>
            {contactsAtRisk.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                {data.totalContacts === 0 ? "Sin contactos — sincroniza desde Sistema" : "Sin contactos en riesgo alto"}
              </p>
            ) : (
              <div className="space-y-1.5">
                {contactsAtRisk.map((c) => (
                  <Link key={c.id} href={`/contacts/${c.id}`} className="flex items-center gap-2 sm:gap-3 rounded-lg border p-2 sm:p-2.5 hover:bg-muted/50 transition-colors">
                    <RiskBadge level={c.risk_level} />
                    <span className="text-sm font-medium truncate flex-1 min-w-0">{c.name}</span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Progress value={scoreToPercent(c.relationship_score)} className="h-1.5 w-10 sm:w-16" />
                      <span className="text-xs text-muted-foreground w-5 text-right tabular-nums">{c.relationship_score ?? 0}</span>
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
      <SectionHeader title="Finanzas y Operaciones" icon={DollarSign} color="text-domain-finance" />

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <KPICard
          title="Saldo Vencido"
          value={globalAging ? formatCurrency(overdueAmt) : "—"}
          subtitle={globalAging ? `${formatCurrency(globalAging.total_outstanding)} total` : "cargando..."}
          icon={CreditCard}
          href="/companies"
          variant={overdueAmt > 0 ? "danger" : "default"}
        />
        <KPICard
          title="Pipeline CRM"
          value={pipelineGlobal ? formatCurrency(pipelineGlobal.pipeline_value) : "—"}
          subtitle={pipelineGlobal ? `${pipelineGlobal.total_opportunities} oportunidades` : "cargando..."}
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
          title="Empresas"
          value={data.totalCompanies}
          subtitle="en el sistema"
          icon={Target}
          href="/companies"
          variant="info"
        />
      </div>

      {/* Aging chart */}
      {globalAging && globalAging.total_outstanding > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-domain-finance" />
              <CardTitle className="text-sm sm:text-base">Antiguedad de Saldos</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <AgingChart data={globalAging} />
          </CardContent>
        </Card>
      )}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/*  PERSPECTIVA 3: INTELIGENCIA Y CONOCIMIENTO                 */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <SectionHeader title="Inteligencia y Conocimiento" icon={Brain} color="text-info" />

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <KPICard
          title="Emails Procesados"
          value={data.emailsProcessed ?? 0}
          subtitle={`de ${data.totalEmails} total · ${data.totalThreads} hilos`}
          icon={Mail}
          href="/emails"
          variant={data.emailsProcessed > 0 ? "info" : "warning"}
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
          value="Claude"
          subtitle="pregunta lo que sea"
          icon={MessageSquare}
          href="/chat"
          variant="default"
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
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="h-4 w-4 shrink-0 text-info" />
                <CardTitle className="text-sm sm:text-base truncate">Briefing — {latestBriefing.briefing_date}</CardTitle>
                <span className="text-xs text-muted-foreground shrink-0 hidden sm:inline">{latestBriefing.total_emails ?? 0} emails</span>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform shrink-0" />
            </Link>
          </CardHeader>
          <CardContent>
            <p className="text-sm line-clamp-3 sm:line-clamp-4">
              {latestBriefing.summary_text
                ? latestBriefing.summary_text.slice(0, 500) + (latestBriefing.summary_text.length > 500 ? "..." : "")
                : "Sin resumen disponible."}
            </p>
          </CardContent>
        </Card>
      )}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/*  PERSPECTIVA 4: AGENTES DE IA                                */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <SectionHeader title="Agentes de IA" icon={Bot} color="text-domain-relationships" />

      <AgentsSummary />
    </div>
  );
}
