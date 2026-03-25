"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Bell,
  Brain,
  Building2,
  CheckSquare,
  CreditCard,
  DollarSign,
  Heart,
  Mail,
  MapPin,
  Package,
  Sparkles,
  Truck,
  TrendingDown,
  TrendingUp,
  Users,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn, formatDate, formatDateTime, scoreToPercent, timeAgo, truncate } from "@/lib/utils";
import type {
  Company,
  Contact,
  Fact,
  EntityRelationship,
  Entity,
  Alert,
  ActionItem,
  HealthScore,
} from "@/lib/types";
import { EnrichButton } from "@/components/shared/enrich-button";
import { HealthRadar } from "@/components/shared/health-radar";
import { HealthTrendChart } from "@/components/shared/health-trend-chart";
import { PageHeader } from "@/components/shared/page-header";
import { RevenueChart } from "@/components/shared/revenue-chart";
import { RiskBadge } from "@/components/shared/risk-badge";
import { SeverityBadge } from "@/components/shared/severity-badge";
import { StateBadge } from "@/components/shared/state-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// ── Helpers ──

function formatCurrency(value: number | null): string {
  if (value == null) return "—";
  return (
    "$" +
    value.toLocaleString("es-MX", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })
  );
}

function sentimentColor(score: number | null): string {
  if (score == null) return "text-muted-foreground";
  if (score >= 0.6) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 0.3) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

const priorityVariant: Record<
  string,
  "success" | "warning" | "critical" | "secondary"
> = {
  low: "success",
  medium: "warning",
  high: "critical",
};

const priorityLabel: Record<string, string> = {
  low: "Baja",
  medium: "Media",
  high: "Alta",
};

// ── Resolved relationship with entity name ──

interface ResolvedRelationship extends EntityRelationship {
  related_entity: Entity | null;
}

// ── Revenue row from revenue_metrics table ──

interface RevenueRow {
  id: number;
  company_id: number;
  total_invoiced: number | null;
  pending_amount: number | null;
  overdue_amount: number | null;
  num_orders: number | null;
  avg_order_value: number | null;
  period_start: string;
  period_type: string | null;
}

// ── Component ──

export default function CompanyDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const companyId = params.id;

  const [loading, setLoading] = useState(true);
  const [company, setCompany] = useState<Company | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [facts, setFacts] = useState<Fact[]>([]);
  const [relationships, setRelationships] = useState<ResolvedRelationship[]>(
    []
  );
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [revenueRows, setRevenueRows] = useState<RevenueRow[]>([]);
  const [healthScores, setHealthScores] = useState<HealthScore[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [odooSnapshots, setOdooSnapshots] = useState<any[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [recentEmails, setRecentEmails] = useState<any[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [companyProducts, setCompanyProducts] = useState<any[]>([]);

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

        // Fetch products via separate RPC
        Promise.resolve(supabase.rpc("get_company_products", { p_company_id: Number(companyId) })).then(({ data: prodData }) => {
          if (Array.isArray(prodData)) setCompanyProducts(prodData);
        }).catch(() => {});

        // Still fetch relationships if entity_id is available
        if (comp.entity_id) {
          const entityId = comp.entity_id;
          const { data: relData } = await supabase
            .from("entity_relationships")
            .select("*")
            .or(`entity_a_id.eq.${entityId},entity_b_id.eq.${entityId}`)
            .order("strength", { ascending: false });

          const rawRels = (relData as EntityRelationship[] | null) ?? [];

          if (rawRels.length > 0) {
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
              const relatedId =
                r.entity_a_id === entityId ? r.entity_b_id : r.entity_a_id;
              return {
                ...r,
                related_entity: entityMap.get(relatedId) ?? null,
              };
            });
            setRelationships(resolved);
          }
        }

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

      // Fetch products via RPC (non-blocking)
      Promise.resolve(supabase.rpc("get_company_products", { p_company_id: Number(companyId) })).then(({ data: prodData }) => {
        if (Array.isArray(prodData)) setCompanyProducts(prodData);
      }).catch(() => {});

      // 2. Parallel fetches
      const [
        contactsRes,
        factsRes,
        alertsRes,
        actionsRes,
        revenueRes,
        healthRes,
        snapshotsRes,
        emailsRes,
      ] = await Promise.all([
        supabase
          .from("contacts")
          .select("*")
          .eq("company_id", comp.id)
          .order("name"),
        // facts don't have company_id — use company's entity_id
        comp.entity_id
          ? supabase
              .from("facts")
              .select("*")
              .eq("entity_id", comp.entity_id)
              .order("created_at", { ascending: false })
              .limit(100)
          : Promise.resolve({ data: [], error: null }),
        supabase
          .from("alerts")
          .select("*")
          .eq("company_id", comp.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("action_items")
          .select("*")
          .eq("company_id", comp.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("revenue_metrics")
          .select("*")
          .eq("company_id", comp.id)
          .order("period_start", { ascending: false })
          .limit(12),
        supabase
          .from("health_scores")
          .select("*")
          .eq("company_id", comp.id)
          .order("score_date", { ascending: false })
          .limit(30),
        supabase
          .from("odoo_snapshots")
          .select("*")
          .eq("company_id", comp.id)
          .order("snapshot_date", { ascending: false })
          .limit(12),
        supabase
          .from("emails")
          .select("*")
          .eq("company_id", comp.id)
          .order("email_date", { ascending: false })
          .limit(20),
      ]);

      setContacts((contactsRes.data as Contact[] | null) ?? []);
      setFacts((factsRes.data as Fact[] | null) ?? []);
      setAlerts((alertsRes.data as Alert[] | null) ?? []);
      setActions((actionsRes.data as ActionItem[] | null) ?? []);
      setRevenueRows((revenueRes.data as RevenueRow[] | null) ?? []);
      setOdooSnapshots(snapshotsRes.data ?? []);
      setRecentEmails(emailsRes.data ?? []);
      setHealthScores(
        (healthRes.data as HealthScore[] | null) ?? []
      );

      // 3. Fetch relationships via entity_id
      if (comp.entity_id) {
        const entityId = comp.entity_id;
        const { data: relData } = await supabase
          .from("entity_relationships")
          .select("*")
          .or(`entity_a_id.eq.${entityId},entity_b_id.eq.${entityId}`)
          .order("strength", { ascending: false });

        const rawRels = (relData as EntityRelationship[] | null) ?? [];

        if (rawRels.length > 0) {
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
            const relatedId =
              r.entity_a_id === entityId ? r.entity_b_id : r.entity_a_id;
            return {
              ...r,
              related_entity: entityMap.get(relatedId) ?? null,
            };
          });
          setRelationships(resolved);
        }
      }

      setLoading(false);
    }
    fetchAll();
  }, [companyId]);

  // ── Derived data ──

  const latestHealth =
    healthScores.length > 0 ? healthScores[0] : null;

  const revenueChartData = [...revenueRows]
    .sort(
      (a, b) =>
        new Date(a.period_start).getTime() -
        new Date(b.period_start).getTime()
    )
    .map((r) => {
      const invoiced = Number(r.total_invoiced ?? 0);
      const pending = Number(r.pending_amount ?? 0);
      const overdue = Number(r.overdue_amount ?? 0);
      return {
        period: r.period_start,
        invoiced,
        paid: Math.max(0, invoiced - pending - overdue),
        overdue,
      };
    });

  const totalInvoiced = revenueRows.reduce(
    (s, r) => s + Number(r.total_invoiced ?? 0),
    0
  );
  const totalCollected = revenueRows.reduce(
    (s, r) => s + Math.max(0, Number(r.total_invoiced ?? 0) - Number(r.pending_amount ?? 0) - Number(r.overdue_amount ?? 0)),
    0
  );
  const totalOverdue = revenueRows.reduce(
    (s, r) => s + Number(r.overdue_amount ?? 0),
    0
  );

  const healthTrendData = [...healthScores]
    .sort(
      (a, b) =>
        new Date(a.score_date).getTime() - new Date(b.score_date).getTime()
    )
    .map((h) => ({
      date: h.score_date,
      overall_score: Number(h.overall_score ?? 0),
      communication: Number(h.communication_score ?? 0),
      financial: Number(h.financial_score ?? 0),
      sentiment: Number(h.sentiment_score ?? 0),
      responsiveness: Number(h.responsiveness_score ?? 0),
      engagement: Number(h.engagement_score ?? 0),
    }));

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
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/companies")}
          className="mb-4"
        >
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

  // ── Render ──

  const riskSignals = Array.isArray(company.risk_signals)
    ? (company.risk_signals as string[])
    : [];
  const opportunitySignals = Array.isArray(company.opportunity_signals)
    ? (company.opportunity_signals as string[])
    : [];

  return (
    <div className="space-y-6">
      {/* Back */}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => router.push("/companies")}
      >
        <ArrowLeft className="mr-1 h-4 w-4" />
        Empresas
      </Button>

      {/* Header */}
      <PageHeader title={company.name}>
        <div className="flex flex-wrap items-center gap-2">
          {company.is_customer && <Badge variant="success">Cliente</Badge>}
          {company.is_supplier && <Badge variant="info">Proveedor</Badge>}
          {company.industry && (
            <Badge variant="secondary">{company.industry}</Badge>
          )}
          {company.enriched_at && (
            <span
              className="flex items-center gap-1 text-xs text-muted-foreground"
              title={`Enriquecido ${timeAgo(company.enriched_at)}`}
            >
              <Sparkles className="h-3 w-3 text-amber-500" />
              {timeAgo(company.enriched_at)}
            </span>
          )}
          <EnrichButton
            type="company"
            id={String(company.id)}
            name={company.name}
          />
        </div>
      </PageHeader>

      {/* Key info cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Industria</p>
            <p className="mt-1 text-sm font-medium">
              {company.industry ?? "No especificada"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Lifetime Value</p>
            <p className="mt-1 text-lg font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
              {formatCurrency(company.lifetime_value)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Promedio Mensual</p>
            <p className="mt-1 text-lg font-bold tabular-nums">
              {formatCurrency(company.monthly_avg)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Tendencia</p>
            <p
              className={cn(
                "mt-1 text-lg font-bold tabular-nums",
                company.trend_pct != null && company.trend_pct > 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : company.trend_pct != null && company.trend_pct < 0
                    ? "text-red-600 dark:text-red-400"
                    : "text-muted-foreground"
              )}
            >
              {company.trend_pct != null
                ? `${company.trend_pct > 0 ? "+" : ""}${company.trend_pct.toFixed(1)}%`
                : "—"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Users className="h-3.5 w-3.5" />
              Contactos
            </div>
            <p className="mt-1 text-2xl font-bold tabular-nums">
              {contacts.length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Ubicacion</p>
            <p className="mt-1 text-sm font-medium">
              {company.city || company.country ? (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5 shrink-0" />
                  {[company.city, company.country].filter(Boolean).join(", ")}
                </span>
              ) : (
                "—"
              )}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="resumen">
        <TabsList className="flex-wrap">
          <TabsTrigger value="resumen">Resumen</TabsTrigger>
          <TabsTrigger value="contactos">
            Contactos ({contacts.length})
          </TabsTrigger>
          <TabsTrigger value="inteligencia">
            Inteligencia ({facts.length})
          </TabsTrigger>
          <TabsTrigger value="finanzas">
            <DollarSign className="mr-1 h-3.5 w-3.5" />
            Finanzas
          </TabsTrigger>
          <TabsTrigger value="alertas">
            Alertas ({alerts.length})
          </TabsTrigger>
          <TabsTrigger value="acciones">
            Acciones ({actions.length})
          </TabsTrigger>
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

        {/* ── Resumen ── */}
        <TabsContent value="resumen" className="space-y-6">
          {/* Description & business type */}
          <Card>
            <CardHeader>
              <CardTitle>Informacion General</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {company.description && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground">
                    Descripcion
                  </p>
                  <p className="mt-1 text-sm">{company.description}</p>
                </div>
              )}
              {company.business_type && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground">
                    Tipo de negocio
                  </p>
                  <p className="mt-1 text-sm">{company.business_type}</p>
                </div>
              )}
              {company.relationship_summary && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground">
                    Resumen de relacion
                  </p>
                  <p className="mt-1 text-sm">
                    {company.relationship_summary}
                  </p>
                </div>
              )}
              {company.relationship_type && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground">
                    Tipo de relacion
                  </p>
                  <Badge variant="outline">{company.relationship_type}</Badge>
                </div>
              )}
              {company.strategic_notes && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground">
                    Notas estrategicas
                  </p>
                  <p className="mt-1 text-sm">{company.strategic_notes}</p>
                </div>
              )}
              {!company.description &&
                !company.business_type &&
                !company.relationship_summary &&
                !company.strategic_notes && (
                  <p className="text-sm text-muted-foreground">
                    Sin informacion general disponible. Usa el boton Enriquecer
                    para obtener datos.
                  </p>
                )}
            </CardContent>
          </Card>

          {/* Risk signals */}
          {riskSignals.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-red-600 dark:text-red-400">
                  Senales de Riesgo
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="list-inside list-disc space-y-1 text-sm text-red-600 dark:text-red-400">
                  {riskSignals.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Opportunity signals */}
          {opportunitySignals.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-emerald-600 dark:text-emerald-400">
                  Senales de Oportunidad
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="list-inside list-disc space-y-1 text-sm text-emerald-600 dark:text-emerald-400">
                  {opportunitySignals.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* ── odoo_context: Purchase patterns, Inventory at risk, Cross-sell ── */}
          {(() => {
            const ctx = company.odoo_context ?? {};
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const pp = ctx.purchase_patterns as any;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const invAtRisk = pp?.inventory_at_risk ?? ctx.inventory_at_risk;

            return (
              <>
                {/* Volume drops */}
                {Array.isArray(pp?.volume_drops) && pp.volume_drops.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
                        <TrendingDown className="h-4 w-4" />
                        Caidas de Volumen
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="flex flex-wrap gap-2">
                        {pp.volume_drops.map((d: Record<string, unknown>, i: number) => (
                          <Badge key={i} variant="critical" className="gap-1">
                            {String(d.product_name ?? d.name ?? "Producto")}
                            {d.drop_pct != null && ` (${Number(d.drop_pct).toFixed(0)}%)`}
                          </Badge>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Cross-sell */}
                {Array.isArray(pp?.cross_sell) && pp.cross_sell.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
                        <Sparkles className="h-4 w-4" />
                        Oportunidades Cross-sell
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="flex flex-wrap gap-2">
                        {pp.cross_sell.map((cs: Record<string, unknown>, i: number) => (
                          <Badge key={i} variant="success" className="gap-1">
                            {String(cs.product_name ?? cs.name ?? "Producto")}
                            {cs.adoption_rate != null && ` (${Math.round(Number(cs.adoption_rate) * 100)}%)`}
                          </Badge>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Discount anomalies */}
                {Array.isArray(pp?.discount_anomalies) && pp.discount_anomalies.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm text-amber-600 dark:text-amber-400">Descuentos Inusuales</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="flex flex-wrap gap-2">
                        {pp.discount_anomalies.map((da: Record<string, unknown>, i: number) => (
                          <Badge key={i} variant="warning">
                            {String(da.product_name ?? da.name ?? "Producto")}: {String(da.discount_applied ?? da.discount ?? "?")}%
                          </Badge>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Revenue 12m summary */}
                {pp?.total_revenue_12m != null && (
                  <Card>
                    <CardContent className="pt-4">
                      <p className="text-xs text-muted-foreground">Revenue Total 12m (desde compras)</p>
                      <p className="mt-1 text-2xl font-bold tabular-nums text-blue-600 dark:text-blue-400">
                        {formatCurrency(Number(pp.total_revenue_12m))}
                      </p>
                    </CardContent>
                  </Card>
                )}

                {/* Inventory at risk */}
                {Array.isArray(invAtRisk) && invAtRisk.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">Inventario en Riesgo</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="rounded-md border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Producto</TableHead>
                              <TableHead className="text-right">Stock</TableHead>
                              <TableHead className="text-right">Dias Inv.</TableHead>
                              <TableHead>Estado</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {invAtRisk.map((p: Record<string, unknown>, i: number) => {
                              const status = String(p.status ?? "—");
                              return (
                                <TableRow key={i}>
                                  <TableCell className="font-medium text-sm">{String(p.name ?? p.product_name ?? "—")}</TableCell>
                                  <TableCell className="text-right tabular-nums">{p.qty_available != null ? String(p.qty_available) : "—"}</TableCell>
                                  <TableCell className="text-right tabular-nums">{p.days_of_inventory != null ? `${Math.round(Number(p.days_of_inventory))}d` : "—"}</TableCell>
                                  <TableCell>
                                    <Badge variant={
                                      status === "stockout" ? "critical" :
                                      status === "critical" ? "critical" :
                                      status === "low" ? "warning" : "secondary"
                                    }>
                                      {status}
                                    </Badge>
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </>
            );
          })()}

          {/* Relationships */}
          {relationships.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Relaciones</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 sm:grid-cols-2">
                  {relationships.map((rel) => (
                    <div
                      key={rel.id}
                      className="flex items-center justify-between rounded-lg border p-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">
                          {rel.related_entity?.name ?? "Entidad desconocida"}
                        </p>
                        <div className="mt-1 flex items-center gap-2">
                          <Badge variant="outline">
                            {rel.relationship_type}
                          </Badge>
                          {rel.related_entity?.entity_type && (
                            <Badge variant="secondary">
                              {rel.related_entity.entity_type}
                            </Badge>
                          )}
                        </div>
                      </div>
                      {rel.strength != null && (
                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                          {(rel.strength * 100).toFixed(0)}%
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Contactos ── */}
        <TabsContent value="contactos">
          {contacts.length === 0 ? (
            <EmptyState
              icon={Users}
              title="Sin contactos"
              description="No se encontraron contactos asociados a esta empresa."
            />
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nombre</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Rol</TableHead>
                    <TableHead>Riesgo</TableHead>
                    <TableHead className="text-right">Sentimiento</TableHead>
                    <TableHead className="w-[140px]">Relacion</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {contacts.map((contact) => (
                    <TableRow key={contact.id}>
                      <TableCell>
                        <Link
                          href={`/contacts/${contact.id}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {contact.name ?? "Sin nombre"}
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {contact.email ?? "---"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {contact.role ?? contact.contact_type ?? "---"}
                      </TableCell>
                      <TableCell>
                        <RiskBadge level={contact.risk_level} />
                      </TableCell>
                      <TableCell className="text-right">
                        <span
                          className={cn(
                            "text-sm font-medium tabular-nums",
                            sentimentColor(contact.sentiment_score)
                          )}
                        >
                          {contact.sentiment_score != null
                            ? contact.sentiment_score.toFixed(2)
                            : "---"}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Progress
                            value={scoreToPercent(
                              contact.relationship_score
                            )}
                            className="h-2 flex-1"
                          />
                          <span className="w-8 text-right text-xs text-muted-foreground tabular-nums">
                            {contact.relationship_score != null
                              ? Math.round(
                                  scoreToPercent(contact.relationship_score)
                                )
                              : 0}
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {/* ── Inteligencia ── */}
        <TabsContent value="inteligencia">
          {facts.length === 0 ? (
            <EmptyState
              icon={Brain}
              title="Sin inteligencia"
              description="No se han extraido hechos relacionados con esta empresa."
            />
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Hecho</TableHead>
                    <TableHead className="text-right">Confianza</TableHead>
                    <TableHead>Fecha</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {facts.map((fact) => (
                    <TableRow key={fact.id}>
                      <TableCell>
                        {fact.fact_type && (
                          <Badge variant="outline">{fact.fact_type}</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {fact.fact_text}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {(fact.confidence * 100).toFixed(0)}%
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDate(fact.created_at)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {/* ── Finanzas ── */}
        <TabsContent value="finanzas" className="space-y-6">
          {revenueRows.length === 0 ? (
            <EmptyState
              icon={DollarSign}
              title="Sin datos financieros"
              description="No hay datos de revenue disponibles para esta empresa."
            />
          ) : (
            <>
              {/* Summary stats */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Card>
                  <CardContent className="pt-4">
                    <p className="text-xs text-muted-foreground">
                      Total Facturado
                    </p>
                    <p className="mt-1 text-2xl font-bold tabular-nums text-blue-600 dark:text-blue-400">
                      {formatCurrency(totalInvoiced)}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <p className="text-xs text-muted-foreground">
                      Total Cobrado
                    </p>
                    <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                      {formatCurrency(totalCollected)}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <p className="text-xs text-muted-foreground">
                      Total Vencido
                    </p>
                    <p className="mt-1 text-2xl font-bold tabular-nums text-red-600 dark:text-red-400">
                      {formatCurrency(totalOverdue)}
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* Chart */}
              <Card>
                <CardHeader>
                  <CardTitle>Revenue Mensual</CardTitle>
                </CardHeader>
                <CardContent>
                  <RevenueChart data={revenueChartData} />
                </CardContent>
              </Card>
            </>
          )}

          {/* Odoo Snapshots */}
          {odooSnapshots.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Metricas Odoo (Snapshots)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Fecha</TableHead>
                        <TableHead className="text-right">Facturado</TableHead>
                        <TableHead className="text-right">Pendiente</TableHead>
                        <TableHead className="text-right">Vencido</TableHead>
                        <TableHead className="text-right">Ordenes</TableHead>
                        <TableHead className="text-right">Pipeline CRM</TableHead>
                        <TableHead className="text-right">Manufactura</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {odooSnapshots.slice(0, 6).map((s: Record<string, unknown>) => (
                        <TableRow key={s.id as number}>
                          <TableCell className="text-muted-foreground whitespace-nowrap">
                            {s.snapshot_date as string}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCurrency(Number(s.total_invoiced ?? 0))}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCurrency(Number(s.pending_amount ?? 0))}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-red-600 dark:text-red-400">
                            {formatCurrency(Number(s.overdue_amount ?? 0))}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {(s.open_orders_count as number) ?? 0}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCurrency(Number(s.crm_pipeline_value ?? 0))}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {(s.manufacturing_count as number) ?? 0}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Alertas ── */}
        <TabsContent value="alertas">
          {alerts.length === 0 ? (
            <EmptyState
              icon={Bell}
              title="Sin alertas"
              description="No hay alertas asociadas a esta empresa."
            />
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Severidad</TableHead>
                    <TableHead>Titulo</TableHead>
                    <TableHead>Contacto</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Fecha</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {alerts.map((alert) => (
                    <TableRow key={alert.id}>
                      <TableCell>
                        <SeverityBadge severity={alert.severity} />
                      </TableCell>
                      <TableCell className="font-medium">
                        {alert.title}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {alert.contact_name ?? "---"}
                      </TableCell>
                      <TableCell>
                        <StateBadge state={alert.state} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDate(alert.created_at)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {/* ── Acciones ── */}
        <TabsContent value="acciones">
          {actions.length === 0 ? (
            <EmptyState
              icon={CheckSquare}
              title="Sin acciones"
              description="No hay acciones pendientes para esta empresa."
            />
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Descripcion</TableHead>
                    <TableHead>Prioridad</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Asignado a</TableHead>
                    <TableHead>Fecha limite</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {actions.map((action) => (
                    <TableRow key={action.id}>
                      <TableCell className="max-w-xs text-sm">
                        {action.description}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            priorityVariant[action.priority] ?? "secondary"
                          }
                        >
                          {priorityLabel[action.priority] ?? action.priority}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <StateBadge state={action.state} />
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {action.assignee_email ?? "Sin asignar"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDate(action.due_date)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {/* ── Salud ── */}
        <TabsContent value="salud" className="space-y-6">
          {!latestHealth ? (
            <EmptyState
              icon={Heart}
              title="Sin datos de salud"
              description="No hay scores de salud disponibles para esta empresa."
            />
          ) : (
            <>
              {/* Latest health overview */}
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
                <Card>
                  <CardContent className="pt-4">
                    <p className="text-xs text-muted-foreground">
                      Comunicacion
                    </p>
                    <p className="mt-1 text-2xl font-bold tabular-nums">
                      {latestHealth.communication_score?.toFixed(0) ?? "—"}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <p className="text-xs text-muted-foreground">Financiero</p>
                    <p className="mt-1 text-2xl font-bold tabular-nums">
                      {latestHealth.financial_score?.toFixed(0) ?? "—"}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <p className="text-xs text-muted-foreground">
                      Sentimiento
                    </p>
                    <p className="mt-1 text-2xl font-bold tabular-nums">
                      {latestHealth.sentiment_score?.toFixed(0) ?? "—"}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <p className="text-xs text-muted-foreground">
                      Responsividad
                    </p>
                    <p className="mt-1 text-2xl font-bold tabular-nums">
                      {latestHealth.responsiveness_score?.toFixed(0) ?? "—"}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <p className="text-xs text-muted-foreground">
                      Engagement
                    </p>
                    <p className="mt-1 text-2xl font-bold tabular-nums">
                      {latestHealth.engagement_score?.toFixed(0) ?? "—"}
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* Radar */}
              <Card>
                <CardHeader>
                  <CardTitle>Radar de Salud</CardTitle>
                </CardHeader>
                <CardContent>
                  <HealthRadar
                    communication={Number(
                      latestHealth.communication_score ?? 0
                    )}
                    financial={Number(latestHealth.financial_score ?? 0)}
                    sentiment={Number(latestHealth.sentiment_score ?? 0)}
                    responsiveness={Number(
                      latestHealth.responsiveness_score ?? 0
                    )}
                    engagement={Number(latestHealth.engagement_score ?? 0)}
                    payment={latestHealth.payment_compliance_score != null ? Number(latestHealth.payment_compliance_score) : undefined}
                  />
                </CardContent>
              </Card>

              {/* Health trend */}
              {healthTrendData.length > 1 && (
                <Card>
                  <CardHeader>
                    <CardTitle>Tendencia de Salud</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <HealthTrendChart data={healthTrendData} />
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>

        {/* ── Emails ── */}
        <TabsContent value="emails">
          {recentEmails.length === 0 ? (
            <EmptyState
              icon={Mail}
              title="Sin emails"
              description="No se encontraron correos asociados a esta empresa."
            />
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Remitente</TableHead>
                    <TableHead>Asunto</TableHead>
                    <TableHead>Fragmento</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentEmails.map((email: Record<string, unknown>) => (
                    <TableRow key={email.id as number}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDateTime(email.email_date as string | null)}
                      </TableCell>
                      <TableCell className="text-sm font-medium">
                        {String(email.sender ?? "—")}
                      </TableCell>
                      <TableCell className="text-sm">
                        {String(email.subject ?? "—")}
                      </TableCell>
                      <TableCell className="max-w-xs text-sm text-muted-foreground">
                        {truncate(email.snippet as string | null, 80)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {/* ── Productos ── */}
        <TabsContent value="productos" className="space-y-6">
          {companyProducts.length === 0 ? (
            <EmptyState
              icon={Package}
              title="Sin productos"
              description="No se encontraron productos asociados a esta empresa."
            />
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Producto</TableHead>
                    <TableHead className="text-right">Ordenes</TableHead>
                    <TableHead className="text-right">Qty Total</TableHead>
                    <TableHead className="text-right">Revenue Total</TableHead>
                    <TableHead className="text-right">Precio Prom.</TableHead>
                    <TableHead className="text-right">Stock</TableHead>
                    <TableHead className="text-right">Disponible</TableHead>
                    <TableHead>Tendencia Vol.</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {companyProducts.map((p: Record<string, unknown>, i: number) => {
                    const qty6m = Number(p.qty_6m ?? 0);
                    const qtyPrev6m = Number(p.qty_prev_6m ?? 0);
                    const trendPct = qtyPrev6m > 0
                      ? ((qty6m - qtyPrev6m) / qtyPrev6m) * 100
                      : qty6m > 0 ? 100 : 0;
                    return (
                      <TableRow key={i}>
                        <TableCell className="font-medium text-sm">
                          {String(p.product_name ?? p.name ?? "—")}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {String(p.order_count ?? p.orders ?? "—")}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {Number(p.total_qty ?? 0).toLocaleString("es-MX")}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(Number(p.total_revenue ?? 0))}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCurrency(Number(p.avg_price ?? 0))}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {p.stock_qty != null ? Number(p.stock_qty).toLocaleString("es-MX") : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {p.available_qty != null ? Number(p.available_qty).toLocaleString("es-MX") : "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant={trendPct > 10 ? "success" : trendPct < -20 ? "critical" : trendPct < 0 ? "warning" : "secondary"}>
                            {trendPct > 0 ? "+" : ""}{trendPct.toFixed(0)}%
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        {/* ── Operaciones Odoo ── */}
        <TabsContent value="operaciones" className="space-y-6">
          {(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const payBehavior = company.payment_behavior as any;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const agingData = company.aging as any;
            const pendingDeliveries = Array.isArray(company.pending_deliveries) ? company.pending_deliveries : [];
            const recentSales = Array.isArray(company.recent_sales) ? company.recent_sales : [];
            const pendingInvoices = Array.isArray(company.pending_invoices) ? company.pending_invoices : [];
            const recentPayments = Array.isArray(company.recent_payments) ? company.recent_payments : [];

            const hasData = payBehavior || agingData || pendingDeliveries.length > 0 || recentSales.length > 0 || pendingInvoices.length > 0 || recentPayments.length > 0;

            if (!hasData) {
              return (
                <EmptyState
                  icon={Truck}
                  title="Sin datos operativos"
                  description="No hay datos operativos de Odoo disponibles para esta empresa."
                />
              );
            }

            return (
              <>
                {/* Payment Behavior */}
                {payBehavior && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-sm">
                        <CreditCard className="h-4 w-4" />
                        Comportamiento de Pago
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                        {payBehavior.compliance_score != null && (
                          <div>
                            <p className="text-xs text-muted-foreground">Compliance</p>
                            <div className="mt-1 flex items-center gap-2">
                              <Progress value={Number(payBehavior.compliance_score)} className="flex-1" />
                              <span className="text-sm font-bold tabular-nums">{Math.round(Number(payBehavior.compliance_score))}%</span>
                            </div>
                          </div>
                        )}
                        {payBehavior.avg_days_late != null && (
                          <div>
                            <p className="text-xs text-muted-foreground">Prom. dias tarde</p>
                            <p className={cn(
                              "mt-1 text-2xl font-bold tabular-nums",
                              Number(payBehavior.avg_days_late) > 15 ? "text-red-600 dark:text-red-400" :
                              Number(payBehavior.avg_days_late) > 5 ? "text-amber-600 dark:text-amber-400" :
                              "text-emerald-600 dark:text-emerald-400"
                            )}>
                              {Math.round(Number(payBehavior.avg_days_late))}d
                            </p>
                          </div>
                        )}
                        {payBehavior.trend && (
                          <div>
                            <p className="text-xs text-muted-foreground">Tendencia</p>
                            <p className="mt-1 text-lg font-bold">
                              {payBehavior.trend === "improving" ? "Mejorando" :
                               payBehavior.trend === "declining" ? "Declinando" : "Estable"}
                            </p>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Aging */}
                {agingData && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">Antigüedad de Saldos (Aging)</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
                        <div>
                          <p className="text-xs text-muted-foreground">Corriente</p>
                          <p className="mt-1 text-lg font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                            {formatCurrency(Number(agingData.current ?? 0))}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">1-30 dias</p>
                          <p className="mt-1 text-lg font-bold tabular-nums text-amber-600 dark:text-amber-400">
                            {formatCurrency(Number(agingData["1_30"] ?? agingData.days_1_30 ?? 0))}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">31-60 dias</p>
                          <p className="mt-1 text-lg font-bold tabular-nums text-orange-600 dark:text-orange-400">
                            {formatCurrency(Number(agingData["31_60"] ?? agingData.days_31_60 ?? 0))}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">61-90 dias</p>
                          <p className="mt-1 text-lg font-bold tabular-nums text-red-500 dark:text-red-400">
                            {formatCurrency(Number(agingData["61_90"] ?? agingData.days_61_90 ?? 0))}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">90+ dias</p>
                          <p className="mt-1 text-lg font-bold tabular-nums text-red-700 dark:text-red-300">
                            {formatCurrency(Number(agingData["90_plus"] ?? agingData.days_90_plus ?? 0))}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Pending Deliveries */}
                {pendingDeliveries.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-sm">
                        <Truck className="h-4 w-4" />
                        Entregas Pendientes
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="rounded-md border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Referencia</TableHead>
                              <TableHead>Fecha programada</TableHead>
                              <TableHead>Estado</TableHead>
                              <TableHead>Productos</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {(pendingDeliveries as Record<string, unknown>[]).map((d, i) => (
                              <TableRow key={i}>
                                <TableCell className="font-medium text-sm">{String(d.name ?? d.reference ?? "—")}</TableCell>
                                <TableCell className="text-muted-foreground">{formatDate(d.scheduled_date as string | null ?? d.date as string | null)}</TableCell>
                                <TableCell>
                                  <Badge variant={d.state === "late" ? "critical" : "secondary"}>
                                    {String(d.state ?? "—")}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-sm text-muted-foreground">
                                  {String(d.products ?? d.product_names ?? "—")}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Recent Sales */}
                {recentSales.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">Ventas Recientes</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="rounded-md border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Orden</TableHead>
                              <TableHead>Fecha</TableHead>
                              <TableHead>Estado</TableHead>
                              <TableHead className="text-right">Total</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {(recentSales as Record<string, unknown>[]).slice(0, 10).map((s, i) => (
                              <TableRow key={i}>
                                <TableCell className="font-medium text-sm">{String(s.name ?? s.order_name ?? "—")}</TableCell>
                                <TableCell className="text-muted-foreground">{formatDate(s.date_order as string | null ?? s.order_date as string | null)}</TableCell>
                                <TableCell>
                                  <Badge variant="secondary">{String(s.state ?? s.order_state ?? "—")}</Badge>
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {formatCurrency(Number(s.amount_total ?? s.subtotal ?? 0))}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Pending Invoices */}
                {pendingInvoices.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">Facturas Pendientes</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="rounded-md border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Factura</TableHead>
                              <TableHead>Vencimiento</TableHead>
                              <TableHead>Estado</TableHead>
                              <TableHead className="text-right">Monto</TableHead>
                              <TableHead className="text-right">Residual</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {(pendingInvoices as Record<string, unknown>[]).slice(0, 10).map((inv, i) => (
                              <TableRow key={i}>
                                <TableCell className="font-medium text-sm">{String(inv.name ?? inv.number ?? "—")}</TableCell>
                                <TableCell className="text-muted-foreground">{formatDate(inv.invoice_date_due as string | null ?? inv.date_due as string | null)}</TableCell>
                                <TableCell>
                                  <Badge variant={
                                    String(inv.payment_state ?? "") === "not_paid" ? "warning" :
                                    String(inv.payment_state ?? "") === "paid" ? "success" : "secondary"
                                  }>
                                    {String(inv.payment_state ?? inv.state ?? "—")}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {formatCurrency(Number(inv.amount_total ?? 0))}
                                </TableCell>
                                <TableCell className="text-right tabular-nums text-red-600 dark:text-red-400">
                                  {formatCurrency(Number(inv.amount_residual ?? inv.residual ?? 0))}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Recent Payments */}
                {recentPayments.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">Pagos Recientes</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="rounded-md border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Referencia</TableHead>
                              <TableHead>Fecha</TableHead>
                              <TableHead className="text-right">Monto</TableHead>
                              <TableHead>Estado</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {(recentPayments as Record<string, unknown>[]).slice(0, 10).map((p, i) => (
                              <TableRow key={i}>
                                <TableCell className="font-medium text-sm">{String(p.name ?? p.ref ?? "—")}</TableCell>
                                <TableCell className="text-muted-foreground">{formatDate(p.date as string | null ?? p.payment_date as string | null)}</TableCell>
                                <TableCell className="text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                                  {formatCurrency(Number(p.amount ?? 0))}
                                </TableCell>
                                <TableCell>
                                  <Badge variant={String(p.state ?? "") === "posted" ? "success" : "secondary"}>
                                    {String(p.state ?? "—")}
                                  </Badge>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </>
            );
          })()}
        </TabsContent>
      </Tabs>
    </div>
  );
}
