"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Bell,
  Building2,
  CreditCard,
  DollarSign,
  Heart,
  Mail,
  Package,
  Sparkles,
  Truck,
  TrendingUp,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn, formatCurrency, timeAgo } from "@/lib/utils";
import type {
  Company,
  Contact,
  Fact,
  EntityRelationship,
  Entity,
  Alert,
  ActionItem,
  HealthScore,
  CompanyFinancials,
  CompanyLogistics,
  CompanyPipeline,
} from "@/lib/types";
import { EnrichButton } from "@/components/shared/enrich-button";
import { PageHeader } from "@/components/shared/page-header";
import { ScoreGauge } from "@/components/shared/score-gauge";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import {
  TabResumen,
  TabContactos,
  TabInteligencia,
  TabFinanzas,
  TabAlertas,
  TabAcciones,
  TabEmails,
  TabProductos,
  TabOperaciones,
  TabSalud,
} from "./components";
import type { ResolvedRelationship, RevenueRow } from "./components";

export default function CompanyDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const companyId = params.id;

  const [loading, setLoading] = useState(true);
  const [company, setCompany] = useState<Company | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [facts, setFacts] = useState<Fact[]>([]);
  const [relationships, setRelationships] = useState<ResolvedRelationship[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [revenueRows, setRevenueRows] = useState<RevenueRow[]>([]);
  const [healthScores, setHealthScores] = useState<HealthScore[]>([]);
  const [financials, setFinancials] = useState<CompanyFinancials | null>(null);
  const [logistics, setLogistics] = useState<CompanyLogistics | null>(null);
  const [pipeline, setPipeline] = useState<CompanyPipeline | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [odooSnapshots, setOdooSnapshots] = useState<any[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [recentEmails, setRecentEmails] = useState<any[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [companyProducts, setCompanyProducts] = useState<any[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [profile, setProfile] = useState<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [handler, setHandler] = useState<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [reorderPrediction, setReorderPrediction] = useState<any>(null);

  useEffect(() => {
    async function fetchAll() {
      // Try RPC first for full context
      const { data: rpcData, error: rpcError } = await supabase.rpc("get_company_full_context", { p_company_id: Number(companyId) });

      if (!rpcError && rpcData) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ctx = rpcData as any;
        const comp = (ctx.company ?? ctx) as Company;
        setCompany(comp);
        setContacts((ctx.contacts as Contact[] | null) ?? []);
        setFacts((ctx.facts as Fact[] | null) ?? []);
        setAlerts((ctx.alerts as Alert[] | null) ?? []);
        setActions((ctx.actions as ActionItem[] | null) ?? []);
        setHealthScores((ctx.health_scores as HealthScore[] | null) ?? []);
        setRevenueRows((ctx.revenue as RevenueRow[] | null) ?? []);
        setOdooSnapshots(ctx.snapshots ?? []);
        setRecentEmails(ctx.recent_emails ?? []);

        const cid = Number(companyId);
        fetchSecondaryData(cid, ctx, comp);
        setLoading(false);
        return;
      }

      // Fallback: fetch company directly
      const { data: companyData } = await supabase
        .from("companies")
        .select("*")
        .eq("id", companyId)
        .single();

      if (!companyData) {
        setLoading(false);
        return;
      }

      const comp = companyData as Company;
      setCompany(comp);

      const cid = Number(companyId);
      fetchSecondaryData(cid, null, comp);

      // Parallel fetches
      const [
        contactsRes, factsRes, alertsRes, actionsRes,
        revenueRes, healthRes, snapshotsRes, emailsRes,
      ] = await Promise.all([
        supabase.from("contacts").select("*").eq("company_id", comp.id).order("name"),
        comp.entity_id
          ? supabase.from("facts").select("*").eq("entity_id", comp.entity_id).order("created_at", { ascending: false }).limit(100)
          : Promise.resolve({ data: [], error: null }),
        supabase.from("alerts").select("*").eq("company_id", comp.id).order("created_at", { ascending: false }),
        supabase.from("action_items").select("*").eq("company_id", comp.id).order("created_at", { ascending: false }),
        supabase.from("revenue_metrics").select("*").eq("company_id", comp.id).order("period_start", { ascending: false }).limit(12),
        supabase.from("health_scores").select("*").eq("company_id", comp.id).order("score_date", { ascending: false }).limit(30),
        supabase.from("odoo_snapshots").select("*").eq("company_id", comp.id).order("snapshot_date", { ascending: false }).limit(12),
        supabase.from("emails").select("*").eq("company_id", comp.id).order("email_date", { ascending: false }).limit(20),
      ]);

      setContacts((contactsRes.data as Contact[] | null) ?? []);
      setFacts((factsRes.data as Fact[] | null) ?? []);
      setAlerts((alertsRes.data as Alert[] | null) ?? []);
      setActions((actionsRes.data as ActionItem[] | null) ?? []);
      setRevenueRows((revenueRes.data as RevenueRow[] | null) ?? []);
      setOdooSnapshots(snapshotsRes.data ?? []);
      setRecentEmails(emailsRes.data ?? []);
      setHealthScores((healthRes.data as HealthScore[] | null) ?? []);

      // Fetch relationships
      await fetchRelationships(comp.entity_id);
      setLoading(false);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function fetchSecondaryData(cid: number, ctx: any | null, comp: Company) {
      // Company profile (tier, risk, trend, revenue)
      supabase.from("company_profile").select("*").eq("company_id", cid).single().then(({ data }) => {
        if (data) setProfile(data);
      });
      // Company handler (who manages this account)
      supabase.from("company_handlers").select("*").eq("company_id", cid).single().then(({ data }) => {
        if (data) setHandler(data);
      });
      // Reorder prediction
      supabase.from("client_reorder_predictions").select("*").eq("company_id", cid).single().then(({ data }) => {
        if (data) setReorderPrediction(data);
      });

      // Products
      Promise.resolve(supabase.rpc("get_company_products", { p_company_id: cid })).then(({ data }) => {
        if (Array.isArray(data)) setCompanyProducts(data);
      }).catch(() => {});

      // Financials
      if (ctx?.financials) {
        setFinancials(ctx.financials as CompanyFinancials);
      } else {
        Promise.resolve(supabase.rpc("get_company_financials", { p_company_id: cid })).then(({ data }) => {
          if (data) setFinancials(data as CompanyFinancials);
        }).catch(() => {});
      }

      // Logistics
      if (ctx?.logistics) {
        setLogistics(ctx.logistics as CompanyLogistics);
      } else {
        Promise.resolve(supabase.rpc("get_company_logistics", { p_company_id: cid })).then(({ data }) => {
          if (data) setLogistics(data as CompanyLogistics);
        }).catch(() => {});
      }

      // Pipeline
      if (ctx?.pipeline) {
        setPipeline(ctx.pipeline as CompanyPipeline);
      } else {
        Promise.resolve(supabase.rpc("get_company_pipeline", { p_company_id: cid })).then(({ data }) => {
          if (data) setPipeline(data as CompanyPipeline);
        }).catch(() => {});
      }

      // Relationships
      fetchRelationships(comp.entity_id);
    }

    async function fetchRelationships(entityId: number | null | undefined) {
      if (!entityId) return;
      const { data: relData } = await supabase
        .from("entity_relationships")
        .select("*")
        .or(`entity_a_id.eq.${entityId},entity_b_id.eq.${entityId}`)
        .order("strength", { ascending: false });

      const rawRels = (relData as EntityRelationship[] | null) ?? [];
      if (rawRels.length === 0) return;

      const relatedIds = rawRels.map((r) =>
        r.entity_a_id === entityId ? r.entity_b_id : r.entity_a_id
      );
      const uniqueIds = [...new Set(relatedIds)];
      const { data: relatedEntities } = await supabase
        .from("entities")
        .select("*")
        .in("id", uniqueIds);

      const entityMap = new Map<number, Entity>();
      if (relatedEntities) {
        for (const e of relatedEntities as Entity[]) {
          entityMap.set(e.id, e);
        }
      }

      const resolved: ResolvedRelationship[] = rawRels.map((r) => {
        const relatedId = r.entity_a_id === entityId ? r.entity_b_id : r.entity_a_id;
        return { ...r, related_entity: entityMap.get(relatedId) ?? null };
      });
      setRelationships(resolved);
    }

    fetchAll();
  }, [companyId]);

  // ── Loading state ──
  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-10 w-72" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
        <Skeleton className="h-10 w-full max-w-2xl" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  // ── Not found ──
  if (!company) {
    return (
      <div>
        <Button variant="ghost" size="sm" onClick={() => router.push("/companies")} className="mb-4">
          <ArrowLeft className="mr-1 h-4 w-4" />
          Empresas
        </Button>
        <EmptyState
          icon={Building2}
          title="Empresa no encontrada"
          description="La empresa solicitada no existe o fue eliminada."
        />
      </div>
    );
  }

  // ── Derived ──
  const latestHealth = healthScores.length > 0 ? healthScores[0] : null;
  const aging = financials?.aging;
  const overdue = aging
    ? (aging["1_30"] ?? 0) + (aging["31_60"] ?? 0) + (aging["61_90"] ?? 0) + (aging["90_plus"] ?? 0)
    : null;

  return (
    <div className="space-y-6">
      {/* Breadcrumbs */}
      <Breadcrumbs items={[
        { label: "Dashboard", href: "/" },
        { label: "Empresas", href: "/companies" },
        { label: company.name },
      ]} />

      {/* Header */}
      <PageHeader title={company.name}>
        <div className="flex flex-wrap items-center gap-2">
          {company.is_customer && <Badge variant="success">Cliente</Badge>}
          {company.is_supplier && <Badge variant="info">Proveedor</Badge>}
          {profile?.tier && (
            <Badge className={cn(
              "text-[10px] font-semibold",
              profile.tier === "strategic" && "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
              profile.tier === "important" && "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
              profile.tier === "key_supplier" && "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
              profile.tier === "regular" && "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
            )}>{profile.tier}</Badge>
          )}
          {profile?.risk_level && profile.risk_level !== "low" && (
            <Badge variant="critical" className="text-[10px]">riesgo {profile.risk_level}</Badge>
          )}
          {company.industry && <Badge variant="secondary">{company.industry}</Badge>}
          {company.enriched_at && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground" title={`Enriquecido ${timeAgo(company.enriched_at)}`}>
              <Sparkles className="h-3 w-3 text-warning" />
              {timeAgo(company.enriched_at)}
            </span>
          )}
          <EnrichButton type="company" id={String(company.id)} name={company.name} />
        </div>
        {handler?.sales_handler_name && (
          <p className="text-xs text-muted-foreground mt-1">
            Vendedor: <strong>{handler.sales_handler_name}</strong>
            {handler.ops_handler_name && handler.ops_handler_name !== handler.sales_handler_name && (
              <> | Operaciones: <strong>{handler.ops_handler_name}</strong></>
            )}
          </p>
        )}
      </PageHeader>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <DollarSign className="h-3.5 w-3.5" />
              Lifetime Value
            </div>
            <p className="mt-1 text-lg font-bold tabular-nums text-success-foreground">
              {formatCurrency(company.lifetime_value)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 flex flex-col items-center">
            <ScoreGauge value={latestHealth?.overall_score ?? null} label="Salud" size="sm" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CreditCard className="h-3.5 w-3.5" />
              Saldo Vencido
            </div>
            <p className={cn(
              "mt-1 text-lg font-bold tabular-nums",
              overdue && overdue > 0 ? "text-danger-foreground" : "text-muted-foreground"
            )}>
              {overdue != null ? formatCurrency(overdue) : "—"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Bell className="h-3.5 w-3.5" />
              Alertas Abiertas
            </div>
            <p className="mt-1 text-2xl font-bold tabular-nums">
              {alerts.filter(a => a.state !== "resolved" && a.state !== "dismissed").length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 flex flex-col items-center">
            <ScoreGauge value={logistics?.delivery_performance?.on_time_rate ?? null} label="OTD Rate" size="sm" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <TrendingUp className="h-3.5 w-3.5" />
              Tendencia
            </div>
            <p className={cn(
              "mt-1 text-lg font-bold tabular-nums",
              profile?.trend_pct > 0 ? "text-success-foreground" : profile?.trend_pct < 0 ? "text-danger-foreground" : "text-muted-foreground"
            )}>
              {profile?.trend_pct != null ? `${profile.trend_pct > 0 ? "+" : ""}${Number(profile.trend_pct).toFixed(0)}%` : "—"}
            </p>
            {reorderPrediction && (
              <p className={cn(
                "text-[10px] mt-0.5",
                reorderPrediction.reorder_status === "on_track" ? "text-success" :
                reorderPrediction.reorder_status === "overdue" ? "text-warning" :
                "text-danger"
              )}>
                {reorderPrediction.reorder_status === "on_track" ? "Reorden al dia" :
                 reorderPrediction.reorder_status === "overdue" ? `Reorden vencido ${reorderPrediction.days_overdue_reorder}d` :
                 reorderPrediction.reorder_status === "lost" ? "Posible churn" :
                 `Riesgo: ${reorderPrediction.days_overdue_reorder}d sin comprar`}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="resumen">
        <TabsList className="flex-wrap h-auto gap-1 overflow-x-auto">
          <TabsTrigger value="resumen">Resumen</TabsTrigger>
          <TabsTrigger value="contactos">Contactos ({contacts.length})</TabsTrigger>
          <TabsTrigger value="inteligencia">Inteligencia ({facts.length})</TabsTrigger>
          <TabsTrigger value="finanzas">
            <DollarSign className="mr-1 h-3.5 w-3.5" />
            Finanzas
          </TabsTrigger>
          <TabsTrigger value="alertas">Alertas ({alerts.length})</TabsTrigger>
          <TabsTrigger value="acciones">Acciones ({actions.length})</TabsTrigger>
          <TabsTrigger value="emails">
            <Mail className="mr-1 h-3.5 w-3.5" />
            Emails ({recentEmails.length})
          </TabsTrigger>
          <TabsTrigger value="productos">
            <Package className="mr-1 h-3.5 w-3.5" />
            Productos
          </TabsTrigger>
          <TabsTrigger value="operaciones">
            <Truck className="mr-1 h-3.5 w-3.5" />
            Operaciones
          </TabsTrigger>
          <TabsTrigger value="salud">
            <Heart className="mr-1 h-3.5 w-3.5" />
            Salud
          </TabsTrigger>
        </TabsList>

        <TabsContent value="resumen" className="space-y-6">
          <TabResumen company={company} relationships={relationships} />
        </TabsContent>
        <TabsContent value="contactos">
          <TabContactos contacts={contacts} />
        </TabsContent>
        <TabsContent value="inteligencia">
          <TabInteligencia facts={facts} />
        </TabsContent>
        <TabsContent value="finanzas" className="space-y-6">
          <TabFinanzas financials={financials} revenueRows={revenueRows} odooSnapshots={odooSnapshots} />
        </TabsContent>
        <TabsContent value="alertas">
          <TabAlertas alerts={alerts} />
        </TabsContent>
        <TabsContent value="acciones">
          <TabAcciones actions={actions} />
        </TabsContent>
        <TabsContent value="emails">
          <TabEmails recentEmails={recentEmails} />
        </TabsContent>
        <TabsContent value="productos" className="space-y-6">
          <TabProductos companyProducts={companyProducts} />
        </TabsContent>
        <TabsContent value="operaciones" className="space-y-6">
          <TabOperaciones logistics={logistics} pipeline={pipeline} />
        </TabsContent>
        <TabsContent value="salud" className="space-y-6">
          <TabSalud healthScores={healthScores} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
