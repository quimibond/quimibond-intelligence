"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,

  Building2,
  CreditCard,
  DollarSign,
  Heart,
  Mail,
  Package,
  Sparkles,
  Truck,
  TrendingUp,
  ShoppingCart,
  Receipt,
  Banknote,
  Factory,
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
  TabVentas,
  TabCompras,
  TabPagos,
  TabManufactura,
} from "./components";
import type { ResolvedRelationship, RevenueRow } from "./components";
import { CompanyIntelCards } from "./components/company-intel-cards";

export default function CompanyDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const companyId = params.id;

  const [loading, setLoading] = useState(true);
  const [company, setCompany] = useState<Company | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [facts, setFacts] = useState<Fact[]>([]);
  const [relationships, setRelationships] = useState<ResolvedRelationship[]>([]);

  const [actions, setActions] = useState<ActionItem[]>([]);
  const [companyAlerts, setCompanyAlerts] = useState<Alert[]>([]);
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
        contactsRes, factsRes, actionsRes,
        revenueRes, healthRes, snapshotsRes, emailsRes,
      ] = await Promise.all([
        supabase.from("contacts").select("*").eq("company_id", comp.id).order("name"),
        comp.entity_id
          ? supabase.from("facts").select("*").eq("entity_id", comp.entity_id).order("created_at", { ascending: false }).limit(100)
          : Promise.resolve({ data: [], error: null }),
        supabase.from("action_items").select("*").eq("company_id", comp.id).order("created_at", { ascending: false }),
        supabase.from("revenue_metrics").select("*").eq("company_id", comp.id).order("period_start", { ascending: false }).limit(12),
        supabase.from("health_scores").select("*").eq("company_id", comp.id).order("score_date", { ascending: false }).limit(30),
        supabase.from("odoo_snapshots").select("*").eq("company_id", comp.id).order("snapshot_date", { ascending: false }).limit(12),
        supabase.from("emails").select("*").eq("company_id", comp.id).order("email_date", { ascending: false }).limit(20),
      ]);

      setContacts((contactsRes.data as Contact[] | null) ?? []);
      setFacts((factsRes.data as Fact[] | null) ?? []);

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

      // Alerts (insights for this company)
      supabase.from("agent_insights").select("*").eq("company_id", cid)
        .in("state", ["new", "seen"]).gte("confidence", 0.80)
        .order("created_at", { ascending: false }).limit(50)
        .then(({ data }) => { if (data) setCompanyAlerts(data as Alert[]); });

      // Products
      Promise.resolve(supabase.rpc("get_company_products", { p_company_id: cid })).then(({ data }) => {
        if (Array.isArray(data)) setCompanyProducts(data);
      }).catch(err => console.error("[company detail]", err));

      // Financials
      if (ctx?.financials) {
        setFinancials(ctx.financials as CompanyFinancials);
      } else {
        Promise.resolve(supabase.rpc("get_company_financials", { p_company_id: cid })).then(({ data }) => {
          if (data) setFinancials(data as CompanyFinancials);
        }).catch(err => console.error("[company detail]", err));
      }

      // Logistics
      if (ctx?.logistics) {
        setLogistics(ctx.logistics as CompanyLogistics);
      } else {
        Promise.resolve(supabase.rpc("get_company_logistics", { p_company_id: cid })).then(({ data }) => {
          if (data) setLogistics(data as CompanyLogistics);
        }).catch(err => console.error("[company detail]", err));
      }

      // Pipeline
      if (ctx?.pipeline) {
        setPipeline(ctx.pipeline as CompanyPipeline);
      } else {
        Promise.resolve(supabase.rpc("get_company_pipeline", { p_company_id: cid })).then(({ data }) => {
          if (data) setPipeline(data as CompanyPipeline);
        }).catch(err => console.error("[company detail]", err));
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
    <div className="space-y-4">
      <Breadcrumbs items={[
        { label: "Empresas", href: "/companies" },
        { label: company.name },
      ]} />

      {/* Header */}
      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-xl font-black truncate">{company.name}</h1>
          {profile?.tier && (
            <Badge variant={profile.tier === "strategic" ? "info" : profile.tier === "important" ? "success" : "secondary"} className="text-[10px]">
              {profile.tier}
            </Badge>
          )}
          {profile?.risk_level && profile.risk_level !== "low" && (
            <Badge variant={profile.risk_level === "critical" ? "critical" : "warning"} className="text-[10px]">
              Riesgo: {profile.risk_level}
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          {company.industry ?? (company.is_customer ? "Cliente" : company.is_supplier ? "Proveedor" : "")}
          {handler?.sales_handler_name && <> · {handler.sales_handler_name}</>}
        </p>
      </div>

      {/* 4 inline stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
        <div className="rounded-xl bg-muted/50 p-2.5">
          <p className="text-lg font-black tabular-nums">{formatCurrency(company.lifetime_value)}</p>
          <p className="text-[10px] text-muted-foreground">revenue total</p>
        </div>
        <div className="rounded-xl bg-muted/50 p-2.5">
          <p className="text-lg font-black tabular-nums">{profile?.revenue_90d != null ? formatCurrency(profile.revenue_90d) : "—"}</p>
          <p className="text-[10px] text-muted-foreground">90 dias</p>
        </div>
        <div className="rounded-xl bg-muted/50 p-2.5">
          <p className={cn("text-lg font-black tabular-nums", overdue && overdue > 0 ? "text-danger" : "")}>
            {overdue != null ? formatCurrency(overdue) : "—"}
          </p>
          <p className="text-[10px] text-muted-foreground">vencido</p>
        </div>
        <div className="rounded-xl bg-muted/50 p-2.5">
          <p className={cn("text-lg font-black tabular-nums",
            profile?.trend_pct > 0 ? "text-success" : profile?.trend_pct < 0 ? "text-danger" : ""
          )}>
            {profile?.trend_pct != null ? `${profile.trend_pct > 0 ? "+" : ""}${Number(profile.trend_pct).toFixed(0)}%` : "—"}
          </p>
          <p className="text-[10px] text-muted-foreground">tendencia</p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="general">
        <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
          <TabsList className="inline-flex w-auto min-w-full md:min-w-0 gap-0.5 h-9">
            <TabsTrigger value="general" className="text-xs px-3">General</TabsTrigger>
            <TabsTrigger value="inteligencia" className="text-xs px-3">Inteligencia</TabsTrigger>
            <TabsTrigger value="finanzas" className="text-xs px-3">Finanzas</TabsTrigger>
            <TabsTrigger value="operaciones" className="text-xs px-3">Operaciones</TabsTrigger>
            <TabsTrigger value="salud" className="text-xs px-3">Salud</TabsTrigger>
            <TabsTrigger value="alertas" className="text-xs px-3">Alertas{companyAlerts.length > 0 ? ` (${companyAlerts.length})` : ""}</TabsTrigger>
            <TabsTrigger value="acciones" className="text-xs px-3">Acciones{actions.length > 0 ? ` (${actions.length})` : ""}</TabsTrigger>
            <TabsTrigger value="emails" className="text-xs px-3">Emails</TabsTrigger>
          </TabsList>
        </div>

        {/* General = Intel cards + contacts */}
        <TabsContent value="general" className="space-y-4">
          <CompanyIntelCards companyId={company.id} companyName={company.name} />
          <TabContactos contacts={contacts} />
        </TabsContent>
        <TabsContent value="inteligencia">
          <TabInteligencia facts={facts} companyId={company.id} />
        </TabsContent>
        <TabsContent value="finanzas" className="space-y-6">
          <TabFinanzas financials={financials} revenueRows={revenueRows} odooSnapshots={odooSnapshots} />
          <TabVentas companyId={company.id} />
          <TabCompras companyId={company.id} />
          <TabPagos companyId={company.id} />
        </TabsContent>
        <TabsContent value="operaciones" className="space-y-6">
          <TabOperaciones logistics={logistics} pipeline={pipeline} />
          <TabProductos companyProducts={companyProducts} />
          <TabManufactura companyId={company.id} />
        </TabsContent>
        <TabsContent value="salud" className="space-y-6">
          <TabSalud healthScores={healthScores} />
        </TabsContent>
        <TabsContent value="alertas">
          <TabAlertas alerts={companyAlerts} />
        </TabsContent>
        <TabsContent value="acciones">
          <TabAcciones actions={actions} />
        </TabsContent>
        <TabsContent value="emails">
          <TabEmails recentEmails={recentEmails} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
