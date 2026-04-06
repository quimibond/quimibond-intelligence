"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { formatCurrency, timeAgo } from "@/lib/utils";
import type { AgentInsight, AIAgent, GlobalAging } from "@/lib/types";
import { AgingChart } from "@/components/shared/aging-chart";
import { PageHeader } from "@/components/shared/page-header";
import { LoadingGrid } from "@/components/shared/loading-grid";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Bot, DollarSign, FileText,
  RefreshCw, Truck,
} from "lucide-react";

import { KPICard } from "./components/kpi-card";
import { UrgentInsights } from "./components/urgent-insights";
import Link from "next/link";

// ── Types for dashboard state ──

interface ContactAtRisk {
  id: number;
  name: string;
  risk_level: string;
  relationship_score: number | null;
}

interface DepartmentStats {
  id: number;
  name: string;
  lead_name: string | null;
  pending: number;
  acted_on: number;
  total: number;
  resolution_rate: number;
}

interface AgentWithStats extends AIAgent {
  last_run_at: string | null;
  new_insights: number;
}

interface BriefingData {
  briefing_date: string;
  summary_text: string | null;
  total_emails: number;
}

interface DashboardData {
  // Section 1: Atencion Inmediata
  insightsPending: number;
  revenueAtRisk: number;
  overdueAmount: number;
  lateDeliveries: number;
  urgentInsights: AgentInsight[];
  contactsAtRisk: ContactAtRisk[];
  agents: AIAgent[];
  totalContacts: number;

  // Section 2: Salud del Negocio
  pipelineValue: number;
  otdRate: number | null;
  emailsProcessedPct: number;
  entitiesCount: number;
  factsCount: number;
  globalAging: GlobalAging | null;

  // Section 3: Equipo
  departments: DepartmentStats[];

  // Section 4: Agentes
  agentsWithStats: AgentWithStats[];
  briefing: BriefingData | null;

  // Meta
  lastUpdated: string;
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    try {
      const [
        // Section 1 queries
        pendingCountRes,
        revenueRiskRes,
        overdueInvoicesRes,
        lateDeliveriesRes,
        urgentInsightsRes,
        contactsRiskRes,
        totalContactsRes,
        agentsListRes,

        // Section 2 queries
        crmLeadsRes,
        deliveriesDoneRes,
        deliveriesDoneOntimeRes,
        emailsTotalRes,
        emailsProcessedRes,
        entitiesRes,
        factsRes,

        // Section 3 queries
        departmentsRes,
        deptInsightsRes,

        // Section 4 queries
        agentsOverviewRes,
        briefingRes,
      ] = await Promise.all([
        // S1: Pending insights count
        supabase
          .from("agent_insights")
          .select("id", { count: "exact", head: true })
          .in("state", ["new", "seen"])
          .gte("confidence", 0.80),

        // S1: Revenue at risk (SUM business_impact_estimate for critical/high)
        supabase
          .from("agent_insights")
          .select("business_impact_estimate")
          .in("state", ["new", "seen"])
          .in("severity", ["critical", "high"])
          .gte("confidence", 0.80),

        // S1: Overdue invoices
        supabase
          .from("odoo_invoices")
          .select("amount_residual, days_overdue")
          .eq("move_type", "out_invoice")
          .in("payment_state", ["not_paid", "partial"]),

        // S1: Late deliveries
        supabase
          .from("odoo_deliveries")
          .select("id", { count: "exact", head: true })
          .eq("is_late", true)
          .not("state", "in", '("done","cancel")'),

        // S1: Top 5 urgent insights (full rows for AgentInsight type)
        supabase
          .from("agent_insights")
          .select("*")
          .in("state", ["new", "seen"])
          .in("severity", ["critical", "high"])
          .gte("confidence", 0.80)
          .order("created_at", { ascending: false })
          .limit(5),

        // S1: Contacts at risk
        supabase
          .from("contacts")
          .select("id, name, risk_level, relationship_score")
          .in("risk_level", ["high", "critical"])
          .order("relationship_score", { ascending: true })
          .limit(5),

        // S1: Total contacts
        supabase
          .from("contacts")
          .select("id", { count: "exact", head: true })
          .eq("contact_type", "external"),

        // S1: Agents list (for mapping agent_id to domain icon)
        supabase.from("ai_agents").select("*"),

        // S2: CRM pipeline
        supabase
          .from("odoo_crm_leads")
          .select("expected_revenue")
          .eq("active", true)
          .eq("lead_type", "opportunity"),

        // S2: Deliveries done (for OTD)
        supabase
          .from("odoo_deliveries")
          .select("id", { count: "exact", head: true })
          .eq("state", "done"),

        // S2: Deliveries done + on-time
        supabase
          .from("odoo_deliveries")
          .select("id", { count: "exact", head: true })
          .eq("state", "done")
          .eq("is_late", false),

        // S2: Total emails
        supabase
          .from("emails")
          .select("id", { count: "exact", head: true }),

        // S2: Processed emails
        supabase
          .from("emails")
          .select("id", { count: "exact", head: true })
          .eq("kg_processed", true),

        // S2: Entities count
        supabase
          .from("entities")
          .select("id", { count: "exact", head: true }),

        // S2: Facts count
        supabase
          .from("facts")
          .select("id", { count: "exact", head: true }),

        // S3: Departments
        supabase
          .from("departments")
          .select("id, name, lead_name")
          .eq("is_active", true),

        // S3: All insight states for department aggregation
        supabase
          .from("agent_insights")
          .select("assignee_department, state")
          .gte("confidence", 0.80),

        // S4: Agents overview (RPC with last_run_at and counts)
        supabase.rpc("get_agents_overview"),

        // S4: Latest briefing
        supabase
          .from("briefings")
          .select("briefing_date, summary_text, total_emails")
          .eq("scope", "daily")
          .order("briefing_date", { ascending: false })
          .limit(1)
          .single(),
      ]);

      // ── Process Section 1 ──
      const revenueAtRisk = (revenueRiskRes.data ?? []).reduce(
        (sum: number, r: { business_impact_estimate: number | null }) =>
          sum + Number(r.business_impact_estimate ?? 0),
        0
      );

      // Compute aging from invoices
      const invoices = overdueInvoicesRes.data ?? [];
      const aging: GlobalAging = {
        current: 0,
        "1_30": 0,
        "31_60": 0,
        "61_90": 0,
        "90_plus": 0,
        total_outstanding: 0,
      };
      let overdueAmount = 0;
      for (const inv of invoices) {
        const amt = Number(inv.amount_residual ?? 0);
        const days = Number(inv.days_overdue ?? 0);
        aging.total_outstanding += amt;
        if (days <= 0) {
          aging.current += amt;
        } else {
          overdueAmount += amt;
          if (days <= 30) aging["1_30"] += amt;
          else if (days <= 60) aging["31_60"] += amt;
          else if (days <= 90) aging["61_90"] += amt;
          else aging["90_plus"] += amt;
        }
      }

      // ── Process Section 2 ──
      const pipelineValue = (crmLeadsRes.data ?? []).reduce(
        (sum: number, l: { expected_revenue: number }) =>
          sum + Number(l.expected_revenue ?? 0),
        0
      );

      const doneTotal = deliveriesDoneRes.count ?? 0;
      const doneOntime = deliveriesDoneOntimeRes.count ?? 0;
      const otdRate = doneTotal > 0 ? Math.round((doneOntime / doneTotal) * 100) : null;

      const totalEmails = emailsTotalRes.count ?? 0;
      const processedEmails = emailsProcessedRes.count ?? 0;
      const emailsProcessedPct =
        totalEmails > 0 ? Math.round((processedEmails / totalEmails) * 100) : 0;

      // ── Process Section 3 ──
      const deptList = departmentsRes.data ?? [];
      const insightRows = deptInsightsRes.data ?? [];

      // Aggregate insights by department
      const deptAgg = new Map<
        string,
        { pending: number; acted_on: number; total: number }
      >();
      for (const row of insightRows) {
        const dept = row.assignee_department as string | null;
        if (!dept) continue;
        const existing = deptAgg.get(dept) ?? { pending: 0, acted_on: 0, total: 0 };
        existing.total++;
        if (row.state === "new" || row.state === "seen") existing.pending++;
        if (row.state === "acted_on") existing.acted_on++;
        deptAgg.set(dept, existing);
      }

      const departments: DepartmentStats[] = deptList.map(
        (d: { id: number; name: string; lead_name: string | null }) => {
          const stats = deptAgg.get(d.name) ?? { pending: 0, acted_on: 0, total: 0 };
          return {
            id: d.id,
            name: d.name,
            lead_name: d.lead_name,
            pending: stats.pending,
            acted_on: stats.acted_on,
            total: stats.total,
            resolution_rate:
              stats.total > 0
                ? Math.round((stats.acted_on / stats.total) * 100)
                : 0,
          };
        }
      );

      // ── Process Section 4 ──
      const agentsOverview = (agentsOverviewRes.data ?? []) as AgentWithStats[];

      setData({
        insightsPending: pendingCountRes.count ?? 0,
        revenueAtRisk,
        overdueAmount,
        lateDeliveries: lateDeliveriesRes.count ?? 0,
        urgentInsights: (urgentInsightsRes.data ?? []) as AgentInsight[],
        contactsAtRisk: (contactsRiskRes.data ?? []) as ContactAtRisk[],
        agents: (agentsListRes.data ?? []) as AIAgent[],
        totalContacts: totalContactsRes.count ?? 0,

        pipelineValue,
        otdRate,
        emailsProcessedPct,
        entitiesCount: entitiesRes.count ?? 0,
        factsCount: factsRes.count ?? 0,
        globalAging: aging.total_outstanding > 0 ? aging : null,

        departments,

        agentsWithStats: agentsOverview,
        briefing: briefingRes.data as BriefingData | null,

        lastUpdated: new Date().toISOString(),
      });
    } catch (err) {
      console.error("[dashboard] Failed to load:", err);
      setError(String(err));
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  function handleRefresh() {
    setRefreshing(true);
    loadDashboard();
  }

  if (loading || (!data && !error)) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Centro de Control"
          description="Inteligencia ejecutiva — Quimibond"
        />
        <LoadingGrid stats={4} rows={4} statHeight="h-[100px]" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Centro de Control"
          description="Inteligencia ejecutiva — Quimibond"
        />
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-6 text-center">
          <p className="text-sm text-destructive">Error al cargar el dashboard</p>
          <p className="text-xs text-muted-foreground mt-1">{error}</p>
          <button onClick={handleRefresh} className="mt-3 text-xs underline">Reintentar</button>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Centro de Control"
          description="Inteligencia ejecutiva — Quimibond"
        />
        <LoadingGrid stats={4} rows={4} statHeight="h-[100px]" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-black">Dashboard</h1>
          <p className="text-xs text-muted-foreground">{timeAgo(data.lastUpdated)}</p>
        </div>
        <Button
          size="icon"
          variant="ghost"
          onClick={handleRefresh}
          disabled={refreshing}
          className="h-9 w-9"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* ═══════ KPIs — 4 cards, always 2 columns ═══════ */}
      <div className="grid gap-2 grid-cols-2">
        <KPICard
          title="Insights"
          value={data.insightsPending}
          subtitle="pendientes"
          icon={Bot}
          href="/inbox"
          variant={data.insightsPending > 0 ? "danger" : "default"}
        />
        <KPICard
          title="Cartera Vencida"
          value={formatCurrency(data.overdueAmount)}
          subtitle="facturas vencidas"
          icon={DollarSign}
          href="/companies"
          variant={data.overdueAmount > 0 ? "danger" : "default"}
        />
        <KPICard
          title="Entregas Tarde"
          value={data.lateDeliveries}
          subtitle="pendientes"
          icon={Truck}
          href="/companies"
          variant={data.lateDeliveries > 0 ? "warning" : "default"}
        />
        <KPICard
          title="OTD"
          value={data.otdRate !== null ? `${data.otdRate}%` : "--"}
          subtitle="on-time delivery"
          icon={Truck}
          href="/companies"
          variant={data.otdRate === null ? "default" : data.otdRate >= 90 ? "success" : "warning"}
        />
      </div>

      {/* ═══════ Urgent Insights (full width) ═══════ */}
      <UrgentInsights
        insights={data.urgentInsights}
        agents={data.agents}
        totalPending={data.insightsPending}
      />

      {/* ═══════ Aging chart (desktop only — too wide for mobile) ═══════ */}
      {data.globalAging && (
        <div className="hidden md:block">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-domain-finance" />
                <CardTitle className="text-sm sm:text-base">Antiguedad de Saldos</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <AgingChart data={data.globalAging} />
            </CardContent>
          </Card>
        </div>
      )}

      {/* ═══════ Briefing (if available) ═══════ */}
      {data.briefing && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-domain-meta" />
                <CardTitle className="text-sm">Briefing</CardTitle>
              </div>
              <Link href="/briefings" className="text-xs text-primary font-medium">Ver todos</Link>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground leading-relaxed line-clamp-4 md:line-clamp-none">
              {data.briefing.summary_text ?? "Sin briefing disponible"}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
