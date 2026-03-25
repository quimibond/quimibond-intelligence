"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Brain,
  Bell,
  CheckCircle2,
  CheckSquare,
  CreditCard,
  HeartPulse,
  Mail,
  Package,
  PackageX,
  ShoppingCart,
  TrendingDown,
  TrendingUp,
  User,
  XCircle,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  cn,
  formatDate,
  formatDateTime,
  getInitials,
  scoreToPercent,
  timeAgo,
  truncate,
} from "@/lib/utils";
import type {
  Contact,
  Fact,
  Email,
  Alert,
  ActionItem,
} from "@/lib/types";
import { PageHeader } from "@/components/shared/page-header";
import { RiskBadge } from "@/components/shared/risk-badge";
import { SeverityBadge } from "@/components/shared/severity-badge";
import { StateBadge } from "@/components/shared/state-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { HealthRadar } from "@/components/shared/health-radar";
import { HealthTrendChart } from "@/components/shared/health-trend-chart";
import { ProfileCard } from "@/components/shared/profile-card";
import { TrendBadge } from "@/components/shared/trend-badge";

import { FeedbackButtons } from "@/components/shared/feedback-buttons";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
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

function formatCurrency(value: number | null): string {
  if (value == null) return "—";
  return "$" + value.toLocaleString("es-MX", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function sentimentColor(score: number | null): string {
  if (score == null) return "text-muted-foreground";
  if (score >= 0.6) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 0.3) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

const senderTypeBadgeVariant: Record<string, "info" | "warning" | "secondary"> = {
  inbound: "info",
  outbound: "warning",
};

const senderTypeLabel: Record<string, string> = {
  inbound: "Recibido",
  outbound: "Enviado",
};

const priorityVariant: Record<string, "success" | "warning" | "critical" | "secondary"> = {
  low: "success",
  medium: "warning",
  high: "critical",
};

const priorityLabel: Record<string, string> = {
  low: "Baja",
  medium: "Media",
  high: "Alta",
};

export default function ContactDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const contactId = params.id;

  const [loading, setLoading] = useState(true);
  const [contact, setContact] = useState<Contact | null>(null);
  const [facts, setFacts] = useState<Fact[]>([]);
  const [emails, setEmails] = useState<Email[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [actions, setActions] = useState<ActionItem[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [healthScores, setHealthScores] = useState<any[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [personProfile, setPersonProfile] = useState<any>(null);
  const [intelKpis, setIntelKpis] = useState<{ open_alerts: number; pending_actions: number; overdue_actions: number } | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [contactComms, setContactComms] = useState<any>(null);

  useEffect(() => {
    async function fetchAll() {
      // First fetch contact to get entity_id
      const contactRes = await supabase
        .from("contacts")
        .select("*")
        .eq("id", contactId)
        .single();

      const c = contactRes.data as Contact | null;
      setContact(c);

      if (!c) {
        setLoading(false);
        return;
      }

      // Fetch intelligence KPIs via RPC (non-blocking)
      if (c.email) {
        Promise.resolve(
          supabase.rpc("get_contact_intelligence", { p_contact_email: c.email })
        ).then(({ data: intel }) => {
          if (intel) {
            setIntelKpis({
              open_alerts: intel.open_alerts ?? 0,
              pending_actions: intel.pending_actions ?? 0,
              overdue_actions: intel.overdue_actions ?? 0,
            });
            if (intel.person_profile) {
              setPersonProfile(intel.person_profile);
            }
          }
        }).catch(() => { /* RPC may not exist */ });
      }

      // Fetch contact communications via RPC (non-blocking)
      if (c.email) {
        Promise.resolve(supabase.rpc("get_contact_communications", { p_contact_email: c.email })).then(({ data: commsData }) => {
          if (commsData) {
            setContactComms(commsData);
            // If RPC returns emails, use them (more complete than direct query)
            if (Array.isArray(commsData.emails_sent) || Array.isArray(commsData.emails_received)) {
              const allEmails = [
                ...(commsData.emails_sent ?? []),
                ...(commsData.emails_received ?? []),
              ].sort((a: Record<string, unknown>, b: Record<string, unknown>) =>
                new Date(b.email_date as string ?? 0).getTime() - new Date(a.email_date as string ?? 0).getTime()
              );
              if (allEmails.length > 0) {
                setEmails(allEmails as Email[]);
              }
            }
            // Update facts if provided
            if (Array.isArray(commsData.facts) && commsData.facts.length > 0) {
              setFacts(commsData.facts as Fact[]);
            }
          }
        }).catch(() => { /* RPC may not exist */ });
      }

      // Now fetch related data in parallel
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const promises: PromiseLike<any>[] = [];

      // Facts: use entity_id (NOT contact_id)
      if (c.entity_id) {
        promises.push(
          supabase
            .from("facts")
            .select("*")
            .eq("entity_id", c.entity_id)
            .order("created_at", { ascending: false })
            .then(({ data }) => {
              setFacts((data as Fact[] | null) ?? []);
            })
        );
      }

      // Alerts by contact_id
      promises.push(
        supabase
          .from("alerts")
          .select("*")
          .eq("contact_id", contactId)
          .order("created_at", { ascending: false })
          .then(({ data }) => {
            setAlerts((data as Alert[] | null) ?? []);
          })
      );

      // Actions by contact_id
      promises.push(
        supabase
          .from("action_items")
          .select("*")
          .eq("contact_id", contactId)
          .order("created_at", { ascending: false })
          .then(({ data }) => {
            setActions((data as ActionItem[] | null) ?? []);
          })
      );

      // Health scores: use overall_score (NOT total_score)
      promises.push(
        Promise.resolve(
          supabase
            .from("customer_health_scores")
            .select("*")
            .eq("contact_id", contactId)
            .order("score_date", { ascending: false })
            .limit(30)
        ).then(({ data }) => {
          setHealthScores(data ?? []);
        }).catch(() => {
          setHealthScores([]);
        })
      );

      // Emails: prefer contact_id if available, else ILIKE on sender/recipient
      if (c.email) {
        const emailPattern = `%${c.email}%`;
        promises.push(
          supabase
            .from("emails")
            .select("*")
            .or(
              `sender.ilike.${emailPattern},recipient.ilike.${emailPattern}`
            )
            .order("email_date", { ascending: false })
            .limit(20)
            .then(({ data }) => {
              setEmails((data as Email[] | null) ?? []);
            })
        );

        // Person profile (personality traits, decision factors)
        promises.push(
          supabase
            .from("person_profiles")
            .select("*")
            .eq("email", c.email)
            .order("updated_at", { ascending: false, nullsFirst: false })
            .limit(1)
            .then(({ data }) => {
              if (data && data.length > 0) setPersonProfile(data[0]);
            })
        );
      }

      await Promise.all(promises);
      setLoading(false);
    }
    fetchAll();
  }, [contactId]);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="flex items-center gap-4">
          <Skeleton className="h-16 w-16 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-64" />
            <Skeleton className="h-4 w-48" />
          </div>
        </div>
        <div className="grid grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (!contact) {
    return (
      <div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/contacts")}
          className="mb-4"
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          Contactos
        </Button>
        <EmptyState
          icon={User}
          title="Contacto no encontrado"
          description="El contacto solicitado no existe o fue eliminado."
        />
      </div>
    );
  }

  const totalEmails = (contact.total_sent ?? 0) + (contact.total_received ?? 0);

  return (
    <div className="space-y-6">
      {/* Back */}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => router.push("/contacts")}
      >
        <ArrowLeft className="mr-1 h-4 w-4" />
        Contactos
      </Button>

      {/* Header */}
      <div className="flex items-center gap-4">
        <Avatar className="h-16 w-16">
          <AvatarFallback className="text-lg">
            {getInitials(contact.name)}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">
            {contact.name ?? "Sin nombre"}
          </h1>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            {contact.email && <span>{contact.email}</span>}
            {contact.company && (
              <>
                <span>·</span>
                <span>{contact.company}</span>
              </>
            )}
            {contact.role && (
              <>
                <span>·</span>
                <span>{contact.role}</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Riesgo</p>
            <div className="mt-1">
              <RiskBadge level={contact.risk_level} />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Sentimiento</p>
            <p
              className={cn(
                "mt-1 text-2xl font-bold tabular-nums",
                sentimentColor(contact.sentiment_score)
              )}
            >
              {contact.sentiment_score != null
                ? contact.sentiment_score.toFixed(2)
                : "—"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Relacion</p>
            <div className="mt-2 flex items-center gap-2">
              <Progress
                value={scoreToPercent(contact.relationship_score)}
                className="flex-1"
              />
              <span className="text-sm font-medium tabular-nums">
                {contact.relationship_score != null
                  ? `${Math.round(scoreToPercent(contact.relationship_score))}%`
                  : "—"}
              </span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Total emails</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">
              {totalEmails}
            </p>
            <p className="text-xs text-muted-foreground">
              {contact.total_sent ?? 0} env / {contact.total_received ?? 0} rec
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Intelligence KPIs from RPC */}
      {intelKpis && (intelKpis.open_alerts > 0 || intelKpis.pending_actions > 0) && (
        <div className="flex flex-wrap items-center gap-3">
          {intelKpis.open_alerts > 0 && (
            <Badge variant="warning" className="gap-1.5 px-3 py-1">
              <Bell className="h-3.5 w-3.5" />
              {intelKpis.open_alerts} alerta{intelKpis.open_alerts !== 1 ? "s" : ""} abierta{intelKpis.open_alerts !== 1 ? "s" : ""}
            </Badge>
          )}
          {intelKpis.pending_actions > 0 && (
            <Badge variant="info" className="gap-1.5 px-3 py-1">
              <CheckSquare className="h-3.5 w-3.5" />
              {intelKpis.pending_actions} accion{intelKpis.pending_actions !== 1 ? "es" : ""} pendiente{intelKpis.pending_actions !== 1 ? "s" : ""}
            </Badge>
          )}
          {intelKpis.overdue_actions > 0 && (
            <Badge variant="critical" className="gap-1.5 px-3 py-1">
              {intelKpis.overdue_actions} vencida{intelKpis.overdue_actions !== 1 ? "s" : ""}
            </Badge>
          )}
        </div>
      )}

      {/* Tabs */}
      <Tabs defaultValue="perfil">
        <TabsList>
          <TabsTrigger value="perfil">Perfil</TabsTrigger>
          <TabsTrigger value="comercial">
            <ShoppingCart className="mr-1 h-3.5 w-3.5" />
            Comercial
          </TabsTrigger>
          <TabsTrigger value="salud">Salud</TabsTrigger>
          <TabsTrigger value="emails">Emails</TabsTrigger>
          <TabsTrigger value="inteligencia">Inteligencia</TabsTrigger>
          <TabsTrigger value="alertas">Alertas</TabsTrigger>
          <TabsTrigger value="acciones">Acciones</TabsTrigger>
        </TabsList>

        {/* ── Perfil (from contact record) ── */}
        <TabsContent value="perfil" className="space-y-6">
          <ProfileCard contact={contact} />

          {/* Person Profile (from person_profiles table) */}
          {personProfile && (
            <Card>
              <CardHeader><CardTitle className="text-sm">Perfil de Personalidad</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                {Array.isArray(personProfile.personality_traits) && personProfile.personality_traits.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1.5">Rasgos de personalidad</p>
                    <div className="flex flex-wrap gap-1.5">
                      {personProfile.personality_traits.map((t: string, i: number) => (
                        <Badge key={i} variant="outline">{t}</Badge>
                      ))}
                    </div>
                  </div>
                )}
                {Array.isArray(personProfile.decision_factors) && personProfile.decision_factors.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1.5">Factores de decision</p>
                    <div className="flex flex-wrap gap-1.5">
                      {personProfile.decision_factors.map((f: string, i: number) => (
                        <Badge key={i} variant="info">{f}</Badge>
                      ))}
                    </div>
                  </div>
                )}
                {Array.isArray(personProfile.interests) && personProfile.interests.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1.5">Intereses</p>
                    <div className="flex flex-wrap gap-1.5">
                      {personProfile.interests.map((i: string, idx: number) => (
                        <Badge key={idx} variant="secondary">{i}</Badge>
                      ))}
                    </div>
                  </div>
                )}
                {personProfile.summary && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Resumen</p>
                    <p className="text-sm">{personProfile.summary}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Additional info not covered by ProfileCard */}
          <Card>
            <CardContent className="space-y-4 pt-6">
              <div className="grid gap-4 sm:grid-cols-3">
                {contact.department && (
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Departamento
                    </p>
                    <p className="text-sm font-medium">{contact.department}</p>
                  </div>
                )}
                {contact.avg_response_time_hours != null && (
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Tiempo respuesta promedio
                    </p>
                    <p className="text-sm font-medium">
                      {contact.avg_response_time_hours.toFixed(1)}h
                    </p>
                  </div>
                )}
                {contact.last_activity && (
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Ultima actividad
                    </p>
                    <p className="text-sm font-medium">
                      {timeAgo(contact.last_activity)}
                    </p>
                  </div>
                )}
              </div>

              {/* Flags */}
              <div className="flex flex-wrap gap-2">
                {contact.is_customer && (
                  <Badge variant="success">Cliente</Badge>
                )}
                {contact.is_supplier && (
                  <Badge variant="info">Proveedor</Badge>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Comercial (purchase patterns, inventory, payment) ── */}
        <TabsContent value="comercial" className="space-y-6">
          {(() => {
            const ctx = contact.odoo_context ?? {};
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const pp = ctx.purchase_patterns as any;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const inv = ctx.inventory_intelligence as any;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const pay = ctx.payment_behavior as any;

            const hasData = pp || inv || pay;

            if (!hasData) {
              return (
                <EmptyState
                  icon={ShoppingCart}
                  title="Sin datos comerciales"
                  description="No hay datos de compras, inventario o pagos disponibles para este contacto."
                />
              );
            }

            return (
              <>
                {/* ── Purchase Patterns ── */}
                {pp && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-sm">
                        <ShoppingCart className="h-4 w-4" />
                        Patrones de Compra
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {/* Top products table */}
                      {Array.isArray(pp.top_products) && pp.top_products.length > 0 && (
                        <div className="rounded-md border">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Producto</TableHead>
                                <TableHead className="text-right">Ordenes</TableHead>
                                <TableHead className="text-right">Revenue 12m</TableHead>
                                <TableHead className="text-right">Freq (dias)</TableHead>
                                <TableHead className="text-right">Tendencia</TableHead>
                                <TableHead className="text-right">Stock</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {pp.top_products.map((p: Record<string, unknown>, i: number) => {
                                const trend = Number(p.volume_trend_pct ?? 0);
                                return (
                                  <TableRow key={i}>
                                    <TableCell className="font-medium text-sm">{String(p.name ?? p.product_name ?? "—")}</TableCell>
                                    <TableCell className="text-right tabular-nums">{String(p.orders ?? p.order_count ?? "—")}</TableCell>
                                    <TableCell className="text-right tabular-nums">{formatCurrency(Number(p.revenue_12m ?? p.total_revenue ?? 0))}</TableCell>
                                    <TableCell className="text-right tabular-nums">{p.avg_days_between_orders ? `${Math.round(Number(p.avg_days_between_orders))}d` : "—"}</TableCell>
                                    <TableCell className="text-right">
                                      <Badge variant={trend > 0 ? "success" : trend < -30 ? "critical" : trend < 0 ? "warning" : "secondary"}>
                                        {trend > 0 ? "+" : ""}{trend.toFixed(0)}%
                                      </Badge>
                                    </TableCell>
                                    <TableCell className="text-right tabular-nums">{p.current_stock != null ? String(p.current_stock) : "—"}</TableCell>
                                  </TableRow>
                                );
                              })}
                            </TableBody>
                          </Table>
                        </div>
                      )}

                      {/* Volume drops */}
                      {Array.isArray(pp.volume_drops) && pp.volume_drops.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                            <TrendingDown className="h-3.5 w-3.5 text-red-500" />
                            Caidas de Volumen
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {pp.volume_drops.map((d: Record<string, unknown>, i: number) => (
                              <Badge key={i} variant="critical" className="gap-1">
                                {String(d.product_name ?? d.name ?? "Producto")}
                                {d.drop_pct != null && ` (${Number(d.drop_pct).toFixed(0)}%)`}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Cross-sell opportunities */}
                      {Array.isArray(pp.cross_sell) && pp.cross_sell.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                            <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />
                            Oportunidades Cross-sell
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {pp.cross_sell.map((cs: Record<string, unknown>, i: number) => (
                              <Badge key={i} variant="success" className="gap-1">
                                {String(cs.product_name ?? cs.name ?? "Producto")}
                                {cs.adoption_rate != null && ` (${Math.round(Number(cs.adoption_rate) * 100)}% adopcion)`}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Discount anomalies */}
                      {Array.isArray(pp.discount_anomalies) && pp.discount_anomalies.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs font-medium text-muted-foreground">Descuentos Inusuales</p>
                          <div className="flex flex-wrap gap-2">
                            {pp.discount_anomalies.map((da: Record<string, unknown>, i: number) => (
                              <Badge key={i} variant="warning">
                                {String(da.product_name ?? da.name ?? "Producto")}: {String(da.discount_applied ?? da.discount ?? "?")}%
                                {da.avg_discount != null && ` (prom ${Number(da.avg_discount).toFixed(1)}%)`}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* ── Inventory Intelligence ── */}
                {inv && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-sm">
                        <Package className="h-4 w-4" />
                        Inteligencia de Inventario
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {/* Can fulfill + next order estimate */}
                      <div className="flex flex-wrap items-center gap-4">
                        {inv.can_fulfill_next_order != null && (
                          <div className="flex items-center gap-1.5">
                            {inv.can_fulfill_next_order ? (
                              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                            ) : (
                              <XCircle className="h-4 w-4 text-red-500" />
                            )}
                            <span className="text-sm">
                              {inv.can_fulfill_next_order ? "Puede cumplir proximo pedido" : "No puede cumplir proximo pedido"}
                            </span>
                          </div>
                        )}
                        {inv.estimated_next_order_days != null && (
                          <Badge variant="info">
                            Proximo pedido en ~{Math.round(Number(inv.estimated_next_order_days))} dias
                          </Badge>
                        )}
                      </div>

                      {/* Products table */}
                      {Array.isArray(inv.products) && inv.products.length > 0 && (
                        <div className="rounded-md border">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Producto</TableHead>
                                <TableHead className="text-right">Stock</TableHead>
                                <TableHead className="text-right">Dias Inventario</TableHead>
                                <TableHead>Estado</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {inv.products.map((p: Record<string, unknown>, i: number) => {
                                const status = String(p.status ?? "unknown");
                                const statusVariant: Record<string, "success" | "warning" | "critical" | "secondary"> = {
                                  healthy: "success",
                                  low: "warning",
                                  critical: "critical",
                                  stockout: "critical",
                                };
                                const statusIcon: Record<string, typeof Package> = {
                                  stockout: PackageX,
                                };
                                const Icon = statusIcon[status];
                                return (
                                  <TableRow key={i}>
                                    <TableCell className="font-medium text-sm">{String(p.name ?? p.product_name ?? "—")}</TableCell>
                                    <TableCell className="text-right tabular-nums">{p.qty_available != null ? String(p.qty_available) : "—"}</TableCell>
                                    <TableCell className="text-right tabular-nums">{p.days_of_inventory != null ? `${Math.round(Number(p.days_of_inventory))}d` : "—"}</TableCell>
                                    <TableCell>
                                      <Badge variant={statusVariant[status] ?? "secondary"} className="gap-1">
                                        {Icon && <Icon className="h-3 w-3" />}
                                        {status}
                                      </Badge>
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                            </TableBody>
                          </Table>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* ── Payment Behavior ── */}
                {pay && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-sm">
                        <CreditCard className="h-4 w-4" />
                        Comportamiento de Pago
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {/* KPI cards */}
                      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                        {pay.compliance_score != null && (
                          <div>
                            <p className="text-xs text-muted-foreground">Compliance</p>
                            <div className="mt-1 flex items-center gap-2">
                              <Progress value={Number(pay.compliance_score)} className="flex-1" />
                              <span className="text-sm font-bold tabular-nums">{Math.round(Number(pay.compliance_score))}%</span>
                            </div>
                          </div>
                        )}
                        {pay.avg_days_late != null && (
                          <div>
                            <p className="text-xs text-muted-foreground">Prom. dias tarde</p>
                            <p className={cn(
                              "mt-1 text-2xl font-bold tabular-nums",
                              Number(pay.avg_days_late) > 15 ? "text-red-600 dark:text-red-400" :
                              Number(pay.avg_days_late) > 5 ? "text-amber-600 dark:text-amber-400" :
                              "text-emerald-600 dark:text-emerald-400"
                            )}>
                              {Math.round(Number(pay.avg_days_late))}d
                            </p>
                          </div>
                        )}
                        {pay.trend && (
                          <div>
                            <p className="text-xs text-muted-foreground">Tendencia</p>
                            <p className="mt-1 text-lg font-bold">
                              {pay.trend === "improving" ? "↑ Mejorando" :
                               pay.trend === "declining" ? "↓ Declinando" : "→ Estable"}
                            </p>
                          </div>
                        )}
                        {pay.payment_term && (
                          <div>
                            <p className="text-xs text-muted-foreground">Termino de pago</p>
                            <p className="mt-1 text-sm font-medium">
                              {String(pay.payment_term.name ?? pay.payment_term)}
                              {pay.payment_term.days != null && ` (${pay.payment_term.days}d)`}
                            </p>
                          </div>
                        )}
                      </div>

                      {/* Recent invoices table */}
                      {Array.isArray(pay.recent_invoices) && pay.recent_invoices.length > 0 && (
                        <div className="rounded-md border">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Factura</TableHead>
                                <TableHead>Vencimiento</TableHead>
                                <TableHead>Pago</TableHead>
                                <TableHead className="text-right">Dias Dif.</TableHead>
                                <TableHead>Estado</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {pay.recent_invoices.slice(0, 10).map((inv: Record<string, unknown>, i: number) => {
                                const daysDiff = Number(inv.days_diff ?? inv.days_late ?? 0);
                                const status = String(inv.status ?? inv.payment_state ?? "—");
                                return (
                                  <TableRow key={i}>
                                    <TableCell className="font-medium text-sm">{String(inv.name ?? inv.number ?? `#${i + 1}`)}</TableCell>
                                    <TableCell className="text-muted-foreground text-sm">{String(inv.due_date ?? inv.date_due ?? "—")}</TableCell>
                                    <TableCell className="text-muted-foreground text-sm">{String(inv.payment_date ?? "—")}</TableCell>
                                    <TableCell className={cn(
                                      "text-right tabular-nums",
                                      daysDiff > 15 ? "text-red-600 dark:text-red-400 font-medium" :
                                      daysDiff > 0 ? "text-amber-600 dark:text-amber-400" : ""
                                    )}>
                                      {daysDiff > 0 ? `+${daysDiff}` : daysDiff}
                                    </TableCell>
                                    <TableCell>
                                      <Badge variant={
                                        status === "paid" ? "success" :
                                        status === "overdue" ? "critical" :
                                        status === "partial" ? "warning" : "secondary"
                                      }>
                                        {status === "paid" ? "Pagada" :
                                         status === "overdue" ? "Vencida" :
                                         status === "partial" ? "Parcial" :
                                         status === "not_paid" ? "Pendiente" : status}
                                      </Badge>
                                    </TableCell>
                                  </TableRow>
                                );
                              })}
                            </TableBody>
                          </Table>
                        </div>
                      )}

                      {/* Worst offenders */}
                      {Array.isArray(pay.worst_offenders) && pay.worst_offenders.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs font-medium text-muted-foreground">Facturas mas retrasadas</p>
                          <div className="flex flex-wrap gap-2">
                            {pay.worst_offenders.map((wo: Record<string, unknown>, i: number) => (
                              <Badge key={i} variant="critical">
                                {String(wo.name ?? wo.number ?? `#${i + 1}`)} — {String(wo.days_late ?? wo.days_diff ?? "?")}d tarde
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}
              </>
            );
          })()}
        </TabsContent>

        {/* ── Salud ── */}
        <TabsContent value="salud" className="space-y-6">
          {healthScores.length > 0 ? (
            (() => {
              const latest = healthScores[0];
              const trendData = [...healthScores]
                .reverse()
                .map((s: Record<string, unknown>) => ({
                  date: s.score_date as string,
                  overall_score: s.overall_score as number,
                  communication: s.communication_score as number | undefined,
                  financial: s.financial_score as number | undefined,
                  sentiment: s.sentiment_score as number | undefined,
                  responsiveness: s.responsiveness_score as number | undefined,
                  engagement: s.engagement_score as number | undefined,
                }));
              const riskSignals: string[] =
                Array.isArray(latest.risk_signals) ? latest.risk_signals : [];
              const opportunitySignals: string[] =
                Array.isArray(latest.opportunity_signals)
                  ? latest.opportunity_signals
                  : [];

              return (
                <>
                  {/* Score + Trend */}
                  <div className="flex items-center gap-4">
                    <div className="text-5xl font-bold tabular-nums">
                      {Math.round(latest.overall_score ?? 0)}
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm text-muted-foreground">
                        Health Score
                      </p>
                      {latest.trend && <TrendBadge trend={latest.trend} />}
                    </div>
                  </div>

                  <div className="grid gap-6 md:grid-cols-2">
                    {/* Radar */}
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-sm">Dimensiones</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <HealthRadar
                          communication={latest.communication_score ?? 0}
                          financial={latest.financial_score ?? 0}
                          sentiment={latest.sentiment_score ?? 0}
                          responsiveness={latest.responsiveness_score ?? 0}
                          engagement={latest.engagement_score ?? 0}
                          payment={latest.payment_compliance_score ?? undefined}
                        />
                      </CardContent>
                    </Card>

                    {/* Trend chart */}
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-sm">
                          Tendencia (30 dias)
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <HealthTrendChart data={trendData} />
                      </CardContent>
                    </Card>
                  </div>

                  {/* Signals */}
                  {(riskSignals.length > 0 ||
                    opportunitySignals.length > 0) && (
                    <div className="grid gap-6 md:grid-cols-2">
                      {riskSignals.length > 0 && (
                        <Card>
                          <CardHeader>
                            <CardTitle className="text-sm">
                              Senales de riesgo
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="flex flex-wrap gap-1.5">
                            {riskSignals.map((s: string) => (
                              <Badge key={s} variant="critical">
                                {s}
                              </Badge>
                            ))}
                          </CardContent>
                        </Card>
                      )}
                      {opportunitySignals.length > 0 && (
                        <Card>
                          <CardHeader>
                            <CardTitle className="text-sm">
                              Oportunidades
                            </CardTitle>
                          </CardHeader>
                          <CardContent className="flex flex-wrap gap-1.5">
                            {opportunitySignals.map((s: string) => (
                              <Badge key={s} variant="success">
                                {s}
                              </Badge>
                            ))}
                          </CardContent>
                        </Card>
                      )}
                    </div>
                  )}
                </>
              );
            })()
          ) : (
            <EmptyState
              icon={HeartPulse}
              title="Sin datos de salud"
              description="No hay datos de salud disponibles para este contacto."
            />
          )}
        </TabsContent>

        {/* ── Emails ── */}
        <TabsContent value="emails" className="space-y-6">
          {emails.length > 0 ? (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Remitente</TableHead>
                    <TableHead>Asunto</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Fragmento</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {emails.map((email) => (
                    <TableRow key={email.id}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDateTime(email.email_date)}
                      </TableCell>
                      <TableCell className="text-sm">
                        {email.sender ?? "—"}
                      </TableCell>
                      <TableCell className="font-medium">
                        {email.subject ?? "—"}
                      </TableCell>
                      <TableCell>
                        {email.sender_type && (
                          <Badge
                            variant={
                              senderTypeBadgeVariant[email.sender_type] ??
                              "secondary"
                            }
                          >
                            {senderTypeLabel[email.sender_type] ??
                              email.sender_type}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="max-w-xs text-sm text-muted-foreground">
                        {truncate(email.snippet, 80)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <EmptyState
              icon={Mail}
              title="Sin emails"
              description="No se encontraron correos asociados a este contacto."
            />
          )}

          {/* Threads from RPC */}
          {contactComms && Array.isArray(contactComms.threads) && contactComms.threads.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Hilos de Conversacion</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Asunto</TableHead>
                        <TableHead>Mensajes</TableHead>
                        <TableHead>Ultima Actividad</TableHead>
                        <TableHead>Estado</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {contactComms.threads.map((thread: Record<string, unknown>, i: number) => (
                        <TableRow key={i}>
                          <TableCell className="font-medium text-sm">{String(thread.subject ?? "—")}</TableCell>
                          <TableCell className="tabular-nums">{String(thread.message_count ?? "—")}</TableCell>
                          <TableCell className="text-muted-foreground">{timeAgo(thread.last_activity as string | null)}</TableCell>
                          <TableCell>
                            <Badge variant="secondary">{String(thread.status ?? "—")}</Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* KG relationships from RPC */}
          {contactComms && Array.isArray(contactComms.relationships) && contactComms.relationships.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Relaciones (Knowledge Graph)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {contactComms.relationships.map((rel: Record<string, unknown>, i: number) => (
                    <Badge key={i} variant="outline" className="gap-1">
                      {String(rel.related_entity_name ?? rel.entity_name ?? "Entidad")} — {String(rel.relationship_type ?? "relacion")}
                      {rel.strength != null && ` (${(Number(rel.strength) * 100).toFixed(0)}%)`}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Inteligencia ── */}
        <TabsContent value="inteligencia">
          {facts.length > 0 ? (
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
                        <span>{fact.fact_text}</span>
                        <div className="flex gap-1 mt-1">
                          {fact.verified && <Badge variant="success" className="text-[10px]">Verificado</Badge>}
                          {fact.is_future && <Badge variant="info" className="text-[10px]">Futuro</Badge>}
                          {fact.expired && <Badge variant="critical" className="text-[10px]">Expirado</Badge>}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {(fact.confidence * 100).toFixed(0)}%
                      </TableCell>
                      <TableCell className="text-muted-foreground whitespace-nowrap">
                        {formatDate(fact.fact_date ?? fact.created_at)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <EmptyState
              icon={Brain}
              title="Sin hechos"
              description="No se han extraido hechos para este contacto."
            />
          )}
        </TabsContent>

        {/* ── Alertas ── */}
        <TabsContent value="alertas">
          {alerts.length > 0 ? (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Severidad</TableHead>
                    <TableHead>Titulo</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Fecha</TableHead>
                    <TableHead className="w-[80px]">Feedback</TableHead>
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
                      <TableCell>
                        <StateBadge state={alert.state} />
                      </TableCell>
                      <TableCell className="text-muted-foreground whitespace-nowrap">
                        {formatDate(alert.created_at)}
                      </TableCell>
                      <TableCell>
                        <FeedbackButtons table="alerts" id={alert.id} currentFeedback={null} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <EmptyState
              icon={Bell}
              title="Sin alertas"
              description="No hay alertas asociadas a este contacto."
            />
          )}
        </TabsContent>

        {/* ── Acciones ── */}
        <TabsContent value="acciones">
          {actions.length > 0 ? (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Descripcion</TableHead>
                    <TableHead>Prioridad</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Fecha limite</TableHead>
                    <TableHead>Asignado a</TableHead>
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
                      <TableCell className="text-muted-foreground whitespace-nowrap">
                        {formatDate(action.due_date)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {action.assignee_email ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <EmptyState
              icon={CheckSquare}
              title="Sin acciones"
              description="No hay acciones pendientes para este contacto."
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
