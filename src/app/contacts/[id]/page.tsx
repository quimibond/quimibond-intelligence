"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Brain,
  Bell,
  CheckSquare,
  HeartPulse,
  Mail,
  MessageSquare,
  User,
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
  PersonProfile,
  Fact,
  Email,
  Alert,
  ActionItem,
  CommunicationPattern,
} from "@/lib/types";
import { PageHeader } from "@/components/shared/page-header";
import { RiskBadge } from "@/components/shared/risk-badge";
import { SeverityBadge } from "@/components/shared/severity-badge";
import { StateBadge } from "@/components/shared/state-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { HealthRadar } from "@/components/shared/health-radar";
import { HealthTrendChart } from "@/components/shared/health-trend-chart";
import { TrendBadge } from "@/components/shared/trend-badge";
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
  const [profile, setProfile] = useState<PersonProfile | null>(null);
  const [facts, setFacts] = useState<Fact[]>([]);
  const [emails, setEmails] = useState<Email[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [patterns, setPatterns] = useState<CommunicationPattern[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [healthScores, setHealthScores] = useState<any[]>([]);

  useEffect(() => {
    async function fetchAll() {
      const [
        contactRes,
        profileRes,
        factsRes,
        alertsRes,
        actionsRes,
        patternsRes,
      ] = await Promise.all([
        supabase.from("contacts").select("*").eq("id", contactId).single(),
        supabase
          .from("person_profiles")
          .select("*")
          .eq("contact_id", contactId)
          .limit(1),
        supabase
          .from("facts")
          .select("*")
          .eq("contact_id", contactId)
          .order("created_at", { ascending: false }),
        supabase
          .from("alerts")
          .select("*")
          .eq("contact_id", contactId)
          .order("created_at", { ascending: false }),
        supabase
          .from("action_items")
          .select("*")
          .eq("contact_id", contactId)
          .order("created_at", { ascending: false }),
        supabase
          .from("communication_patterns")
          .select("*")
          .eq("contact_id", contactId)
          .order("created_at", { ascending: false }),
      ]);

      const c = contactRes.data as Contact | null;
      setContact(c);
      setProfile(
        ((profileRes.data as PersonProfile[] | null) ?? [])[0] ?? null
      );
      setFacts((factsRes.data as Fact[] | null) ?? []);
      setAlerts((alertsRes.data as Alert[] | null) ?? []);
      setActions((actionsRes.data as ActionItem[] | null) ?? []);
      setPatterns((patternsRes.data as CommunicationPattern[] | null) ?? []);

      // Fetch health scores (table may not exist yet)
      try {
        const { data: healthData } = await supabase
          .from("customer_health_scores")
          .select("*")
          .eq("contact_id", contactId)
          .order("score_date", { ascending: false })
          .limit(30);
        setHealthScores(healthData ?? []);
      } catch {
        // Table may not exist — ignore
        setHealthScores([]);
      }

      // Emails need ilike on sender/recipient
      if (c?.email) {
        const emailPattern = `%${c.email}%`;
        const { data: emailData } = await supabase
          .from("emails")
          .select("*")
          .or(`sender.ilike.${emailPattern},recipient.ilike.${emailPattern}`)
          .order("email_date", { ascending: false })
          .limit(20);
        setEmails((emailData as Email[] | null) ?? []);
      }

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

  const role = profile?.role ?? contact.contact_type;

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
        <div>
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
            {role && (
              <>
                <span>·</span>
                <span>{role}</span>
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
              {contact.total_emails}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="perfil">
        <TabsList>
          <TabsTrigger value="perfil">Perfil</TabsTrigger>
          <TabsTrigger value="salud">Salud</TabsTrigger>
          <TabsTrigger value="comunicacion">Comunicacion</TabsTrigger>
          <TabsTrigger value="inteligencia">Inteligencia</TabsTrigger>
          <TabsTrigger value="alertas">Alertas</TabsTrigger>
          <TabsTrigger value="acciones">Acciones</TabsTrigger>
        </TabsList>

        {/* ── Perfil ── */}
        <TabsContent value="perfil">
          {profile ? (
            <Card>
              <CardContent className="space-y-5 pt-6">
                {profile.summary && (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-1">
                      Resumen
                    </p>
                    <p className="text-sm leading-relaxed">{profile.summary}</p>
                  </div>
                )}

                <div className="grid gap-4 sm:grid-cols-3">
                  {profile.department && (
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Departamento
                      </p>
                      <p className="text-sm font-medium">{profile.department}</p>
                    </div>
                  )}
                  {profile.decision_power && (
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Poder de decision
                      </p>
                      <p className="text-sm font-medium">
                        {profile.decision_power}
                      </p>
                    </div>
                  )}
                  {profile.communication_style && (
                    <div>
                      <p className="text-xs text-muted-foreground">
                        Estilo de comunicacion
                      </p>
                      <p className="text-sm font-medium">
                        {profile.communication_style}
                      </p>
                    </div>
                  )}
                </div>

                {profile.personality_traits.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-2">
                      Rasgos de personalidad
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {profile.personality_traits.map((t) => (
                        <Badge key={t} variant="secondary">
                          {t}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {profile.interests.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-2">
                      Intereses
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {profile.interests.map((i) => (
                        <Badge key={i} variant="outline">
                          {i}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {profile.decision_factors.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-2">
                      Factores de decision
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {profile.decision_factors.map((f) => (
                        <Badge key={f} variant="info">
                          {f}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
            <EmptyState
              icon={User}
              title="Sin perfil"
              description="Aun no se ha generado un perfil para este contacto."
            />
          )}
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
                  total: s.total_score as number,
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
                      {Math.round(latest.total_score ?? 0)}
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

        {/* ── Comunicacion ── */}
        <TabsContent value="comunicacion" className="space-y-6">
          {emails.length > 0 ? (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
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

          {patterns.length > 0 && (
            <div>
              <h3 className="mb-3 text-sm font-semibold">
                Patrones de comunicacion
              </h3>
              <div className="space-y-3">
                {patterns.map((p) => (
                  <Card key={p.id}>
                    <CardContent className="flex items-start justify-between gap-4 pt-4">
                      <div className="min-w-0 flex-1">
                        {p.pattern_type && (
                          <Badge variant="outline" className="mb-1">
                            {p.pattern_type}
                          </Badge>
                        )}
                        <p className="text-sm">{p.description ?? "—"}</p>
                        {p.frequency && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            Frecuencia: {p.frequency}
                          </p>
                        )}
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                        {(p.confidence * 100).toFixed(0)}% confianza
                      </span>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
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
                        {fact.fact_text}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {(fact.confidence * 100).toFixed(0)}%
                      </TableCell>
                      <TableCell className="text-muted-foreground whitespace-nowrap">
                        {formatDate(fact.created_at)}
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
