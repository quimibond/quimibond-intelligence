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
  Clock,
  DollarSign,
  Link2,
  Sparkles,
  Users,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  cn,
  formatDate,
  scoreToPercent,
  timeAgo,
} from "@/lib/utils";
import type {
  Entity,
  EntityRelationship,
  Contact,
  PersonProfile,
  Fact,
  Alert,
  ActionItem,
} from "@/lib/types";
import { EnrichButton } from "@/components/shared/enrich-button";
import { HealthRadar } from "@/components/shared/health-radar";
import { PageHeader } from "@/components/shared/page-header";
import { RevenueChart } from "@/components/shared/revenue-chart";
import { RiskBadge } from "@/components/shared/risk-badge";
import { SeverityBadge } from "@/components/shared/severity-badge";
import { StateBadge } from "@/components/shared/state-badge";
import { EmptyState } from "@/components/shared/empty-state";
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

// ── Helpers ──

function sentimentColor(score: number | null): string {
  if (score == null) return "text-muted-foreground";
  if (score >= 0.6) return "text-emerald-600 dark:text-emerald-400";
  if (score >= 0.3) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

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

// ── Relationship with resolved entity info ──

interface ResolvedRelationship extends EntityRelationship {
  related_entity: Entity | null;
}

// ── Component ──

export default function CompanyDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const entityId = params.id;

  const [loading, setLoading] = useState(true);
  const [entity, setEntity] = useState<Entity | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [profiles, setProfiles] = useState<Map<string, PersonProfile>>(new Map());
  const [facts, setFacts] = useState<Fact[]>([]);
  const [relationships, setRelationships] = useState<ResolvedRelationship[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [revenueData, setRevenueData] = useState<
    Array<{ period: string; invoiced: number; paid: number; overdue: number }>
  >([]);
  const [healthScores, setHealthScores] = useState<{
    communication: number;
    financial: number;
    sentiment: number;
    responsiveness: number;
    engagement: number;
  } | null>(null);

  useEffect(() => {
    async function fetchAll() {
      // 1. Fetch company entity
      const { data: entityData } = await supabase
        .from("entities")
        .select("*")
        .eq("id", entityId)
        .single();

      if (!entityData) {
        setLoading(false);
        return;
      }

      const company = entityData as Entity;
      setEntity(company);

      // 2. Parallel fetches
      const companyName = company.name;

      const [
        contactsRes,
        relRes,
        actionsRes,
      ] = await Promise.all([
        // Contacts at this company
        supabase
          .from("contacts")
          .select("*")
          .ilike("company", companyName)
          .order("name"),
        // Entity relationships
        supabase
          .from("entity_relationships")
          .select("*")
          .or(`entity_a_id.eq.${entityId},entity_b_id.eq.${entityId}`)
          .order("confidence", { ascending: false }),
        // Action items for this company
        supabase
          .from("action_items")
          .select("*")
          .ilike("contact_company", companyName)
          .order("created_at", { ascending: false }),
      ]);

      const contactsList = (contactsRes.data as Contact[] | null) ?? [];
      setContacts(contactsList);
      setActions((actionsRes.data as ActionItem[] | null) ?? []);

      // 3. Fetch person profiles for contacts
      const contactIds = contactsList.map((c) => c.id);
      if (contactIds.length > 0) {
        const { data: profileData } = await supabase
          .from("person_profiles")
          .select("*")
          .in("contact_id", contactIds);

        const profileMap = new Map<string, PersonProfile>();
        if (profileData) {
          for (const p of profileData as PersonProfile[]) {
            if (p.contact_id) profileMap.set(p.contact_id, p);
          }
        }
        setProfiles(profileMap);
      }

      // 4. Fetch facts for contacts of this company + entity mentions
      const factsSet = new Map<string, Fact>();

      if (contactIds.length > 0) {
        const { data: contactFacts } = await supabase
          .from("facts")
          .select("*")
          .in("contact_id", contactIds)
          .order("created_at", { ascending: false })
          .limit(50);

        if (contactFacts) {
          for (const f of contactFacts as Fact[]) {
            factsSet.set(f.id, f);
          }
        }
      }

      // Facts via entity_mentions
      const { data: mentions } = await supabase
        .from("entity_mentions")
        .select("email_id")
        .eq("entity_id", entityId);

      if (mentions && mentions.length > 0) {
        const emailIds = [...new Set(mentions.map((m: { email_id: number }) => m.email_id))];
        if (emailIds.length > 0) {
          const { data: mentionFacts } = await supabase
            .from("facts")
            .select("*")
            .in("email_id", emailIds)
            .order("created_at", { ascending: false })
            .limit(50);

          if (mentionFacts) {
            for (const f of mentionFacts as Fact[]) {
              factsSet.set(f.id, f);
            }
          }
        }
      }

      const allFacts = Array.from(factsSet.values()).sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
      setFacts(allFacts);

      // 5. Resolve relationships - fetch related entities
      const rawRels = (relRes.data as EntityRelationship[] | null) ?? [];
      if (rawRels.length > 0) {
        const relatedIds = rawRels.map((r) =>
          r.entity_a_id === entityId ? r.entity_b_id : r.entity_a_id
        );
        const uniqueIds = [...new Set(relatedIds)];

        const { data: relatedEntities } = await supabase
          .from("entities")
          .select("*")
          .in("id", uniqueIds);

        const entityMap = new Map<string, Entity>();
        if (relatedEntities) {
          for (const e of relatedEntities as Entity[]) {
            entityMap.set(e.id, e);
          }
        }

        const resolved: ResolvedRelationship[] = rawRels.map((r) => {
          const relatedId = r.entity_a_id === entityId ? r.entity_b_id : r.entity_a_id;
          return {
            ...r,
            related_entity: entityMap.get(relatedId) ?? null,
          };
        });
        setRelationships(resolved);
      }

      // 6. Fetch alerts for contacts at this company
      const contactNames = contactsList
        .map((c) => c.name)
        .filter((n): n is string => n != null);

      if (contactNames.length > 0) {
        const orFilter = contactNames
          .map((name) => `contact_name.ilike.%${name}%`)
          .join(",");
        const { data: alertData } = await supabase
          .from("alerts")
          .select("*")
          .or(orFilter)
          .order("created_at", { ascending: false });

        setAlerts((alertData as Alert[] | null) ?? []);
      }

      // 7. Fetch revenue data (gracefully handle missing table/rpc)
      try {
        const { data: rpcData, error: rpcError } = await supabase.rpc(
          "get_company_revenue",
          { p_company_name: companyName, p_months: 12 },
        );
        if (!rpcError && rpcData && Array.isArray(rpcData) && rpcData.length > 0) {
          setRevenueData(rpcData);
        } else {
          // Fallback: direct query
          const { data: metricsData } = await supabase
            .from("revenue_metrics")
            .select("*")
            .order("period_start", { ascending: true });

          if (metricsData && metricsData.length > 0) {
            const filtered = metricsData.filter(
              (r: Record<string, unknown>) =>
                typeof r.company_name === "string" &&
                r.company_name.toLowerCase() === companyName.toLowerCase(),
            );
            if (filtered.length > 0) {
              setRevenueData(
                filtered.map((r: Record<string, unknown>) => ({
                  period: String(r.period_start ?? r.period ?? ""),
                  invoiced: Number(r.invoiced ?? 0),
                  paid: Number(r.paid ?? 0),
                  overdue: Number(r.overdue ?? 0),
                })),
              );
            }
          }
        }
      } catch {
        // Table or RPC may not exist — ignore
      }

      // 8. Fetch health scores for contacts at this company
      if (contactIds.length > 0) {
        try {
          const { data: healthData } = await supabase
            .from("customer_health_scores")
            .select("communication_score, financial_score, sentiment_score, responsiveness_score, engagement_score")
            .in("contact_id", contactIds);

          if (healthData && healthData.length > 0) {
            const avg = (field: string) => {
              const vals = healthData
                .map((h: Record<string, unknown>) => Number(h[field]))
                .filter((v: number) => !isNaN(v) && v > 0);
              return vals.length > 0
                ? vals.reduce((a: number, b: number) => a + b, 0) / vals.length
                : 0;
            };
            setHealthScores({
              communication: avg("communication_score"),
              financial: avg("financial_score"),
              sentiment: avg("sentiment_score"),
              responsiveness: avg("responsiveness_score"),
              engagement: avg("engagement_score"),
            });
          }
        } catch {
          // Table may not exist — ignore
        }
      }

      setLoading(false);
    }
    fetchAll();
  }, [entityId]);

  // ── Loading state ──

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-10 w-72" />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
        <Skeleton className="h-10 w-96" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  // ── Not found ──

  if (!entity) {
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

  // ── Derived data ──

  const attributes = (entity.attributes ?? {}) as Record<string, string | string[] | number | boolean | null>;
  const industry = attributes.industry as string | undefined;
  const activeAlerts = alerts.filter((a) => a.state !== "resolved").length;

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
      <PageHeader title={entity.name}>
        {industry && <Badge variant="secondary">{industry}</Badge>}
        <EnrichButton
          type="company"
          id={entity.id}
          name={entity.name}
        />
      </PageHeader>

      {/* Key info bar */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Industria</p>
            <p className="mt-1 text-sm font-medium">
              {industry ?? "No especificada"}
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
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              Ultima actividad
            </div>
            <p className="mt-1 text-sm font-medium">
              {timeAgo(entity.last_seen)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Bell className="h-3.5 w-3.5" />
              Alertas activas
            </div>
            <p className="mt-1 text-2xl font-bold tabular-nums">
              {activeAlerts}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="resumen">
        <TabsList>
          <TabsTrigger value="resumen">Resumen</TabsTrigger>
          <TabsTrigger value="contactos">
            Contactos ({contacts.length})
          </TabsTrigger>
          <TabsTrigger value="inteligencia">
            Inteligencia ({facts.length})
          </TabsTrigger>
          <TabsTrigger value="alertas">
            Alertas ({alerts.length})
          </TabsTrigger>
          <TabsTrigger value="acciones">
            Acciones ({actions.length})
          </TabsTrigger>
          <TabsTrigger value="finanzas">
            <DollarSign className="mr-1 h-3.5 w-3.5" />
            Finanzas
          </TabsTrigger>
        </TabsList>

        {/* ── Resumen ── */}
        <TabsContent value="resumen" className="space-y-6">
          {/* Attributes */}
          <Card>
            <CardHeader>
              <CardTitle>Atributos</CardTitle>
            </CardHeader>
            <CardContent>
              {Object.keys(attributes).length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Sin atributos registrados.
                </p>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {Object.entries(attributes).map(([key, val]) => (
                    <div key={key}>
                      <p className="text-xs text-muted-foreground capitalize">
                        {key.replace(/_/g, " ")}
                      </p>
                      <p className="text-sm font-medium">
                        {String(typeof val === "string" ? val : JSON.stringify(val))}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Relationships */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Link2 className="h-4 w-4 text-muted-foreground" />
                <CardTitle>Relaciones</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              {relationships.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Sin relaciones registradas.
                </p>
              ) : (
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
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {(rel.confidence * 100).toFixed(0)}%
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Enrichment data */}
          {(attributes.description ||
            attributes.business_type ||
            attributes.risk_signals ||
            attributes.opportunity_signals ||
            attributes.strategic_notes) && (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-muted-foreground" />
                  <CardTitle>Datos Enriquecidos</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {attributes.description && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Descripcion</p>
                    <p className="mt-1 text-sm">{String(attributes.description)}</p>
                  </div>
                )}
                {attributes.business_type && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Tipo de negocio</p>
                    <p className="mt-1 text-sm">{String(attributes.business_type)}</p>
                  </div>
                )}
                {attributes.risk_signals && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Senales de riesgo</p>
                    {Array.isArray(attributes.risk_signals) ? (
                      <ul className="mt-1 list-inside list-disc space-y-0.5 text-sm text-red-600 dark:text-red-400">
                        {(attributes.risk_signals as string[]).map((s, i) => (
                          <li key={i}>{s}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1 text-sm text-red-600 dark:text-red-400">
                        {String(attributes.risk_signals)}
                      </p>
                    )}
                  </div>
                )}
                {attributes.opportunity_signals && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Senales de oportunidad</p>
                    {Array.isArray(attributes.opportunity_signals) ? (
                      <ul className="mt-1 list-inside list-disc space-y-0.5 text-sm text-emerald-600 dark:text-emerald-400">
                        {(attributes.opportunity_signals as string[]).map((s, i) => (
                          <li key={i}>{s}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1 text-sm text-emerald-600 dark:text-emerald-400">
                        {String(attributes.opportunity_signals)}
                      </p>
                    )}
                  </div>
                )}
                {attributes.strategic_notes && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Notas estrategicas</p>
                    <p className="mt-1 text-sm">{String(attributes.strategic_notes)}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Health Radar */}
          {healthScores && (
            <Card>
              <CardHeader>
                <CardTitle>Salud de la Relacion</CardTitle>
              </CardHeader>
              <CardContent>
                <HealthRadar
                  communication={healthScores.communication}
                  financial={healthScores.financial}
                  sentiment={healthScores.sentiment}
                  responsiveness={healthScores.responsiveness}
                  engagement={healthScores.engagement}
                />
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
                    <TableHead>Ultima interaccion</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {contacts.map((contact) => {
                    const profile = profiles.get(contact.id);
                    const role = profile?.role ?? contact.contact_type;

                    return (
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
                          {role ?? "---"}
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
                              value={scoreToPercent(contact.relationship_score)}
                              className="h-2 flex-1"
                            />
                            <span className="w-8 text-right text-xs text-muted-foreground tabular-nums">
                              {contact.relationship_score != null
                                ? Math.round(scoreToPercent(contact.relationship_score))
                                : 0}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                          {timeAgo(contact.last_interaction)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
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

        {/* ── Finanzas ── */}
        <TabsContent value="finanzas" className="space-y-6">
          {revenueData.length === 0 ? (
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
                      $
                      {revenueData
                        .reduce((sum, r) => sum + r.invoiced, 0)
                        .toLocaleString("es-MX", {
                          minimumFractionDigits: 0,
                          maximumFractionDigits: 0,
                        })}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <p className="text-xs text-muted-foreground">Total Pagado</p>
                    <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                      $
                      {revenueData
                        .reduce((sum, r) => sum + r.paid, 0)
                        .toLocaleString("es-MX", {
                          minimumFractionDigits: 0,
                          maximumFractionDigits: 0,
                        })}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <p className="text-xs text-muted-foreground">
                      Total Vencido
                    </p>
                    <p className="mt-1 text-2xl font-bold tabular-nums text-red-600 dark:text-red-400">
                      $
                      {revenueData
                        .reduce((sum, r) => sum + r.overdue, 0)
                        .toLocaleString("es-MX", {
                          minimumFractionDigits: 0,
                          maximumFractionDigits: 0,
                        })}
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
                  <RevenueChart data={revenueData} />
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
