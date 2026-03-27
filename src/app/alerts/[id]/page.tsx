"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeft, Bell, Brain, Building2, CheckSquare, Clock, Lightbulb, Mail, MessagesSquare, TrendingUp, User } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { formatDate, formatDateTime, timeAgo } from "@/lib/utils";
import type { Alert } from "@/lib/types";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { EntityLink } from "@/components/shared/entity-link";
import { SeverityBadge } from "@/components/shared/severity-badge";
import { StateBadge } from "@/components/shared/state-badge";
import { FeedbackButtons } from "@/components/shared/feedback-buttons";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

interface AlertContext {
  alert: AnyRecord;
  thread_emails: AnyRecord[];
  related_actions: AnyRecord[];
  contact_facts: AnyRecord[];
}

export default function AlertDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [alert, setAlert] = useState<Alert | null>(null);
  const [threadEmails, setThreadEmails] = useState<AnyRecord[]>([]);
  const [relatedActions, setRelatedActions] = useState<AnyRecord[]>([]);
  const [contactFacts, setContactFacts] = useState<AnyRecord[]>([]);
  const [catalogName, setCatalogName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      // Use RPC for rich context in one call
      const { data: ctx, error } = await supabase.rpc("get_alert_with_context", {
        p_alert_id: parseInt(params.id),
      });

      if (error || !ctx) {
        // Fallback to direct query
        const { data: alertData } = await supabase
          .from("alerts").select("*").eq("id", params.id).single();
        if (alertData) setAlert(alertData as Alert);
        setLoading(false);
        return;
      }

      const context = ctx as AlertContext;
      setAlert(context.alert as unknown as Alert);
      setThreadEmails(context.thread_emails ?? []);
      setRelatedActions(context.related_actions ?? []);
      setContactFacts(context.contact_facts ?? []);

      // Alert type display names (hardcoded — table removed)
      const typeNames: Record<string, string> = {
        no_response: "Sin respuesta", stalled_thread: "Hilo estancado",
        overdue_invoice: "Factura vencida", at_risk_client: "Cliente en riesgo",
        volume_drop: "Caida de volumen", stockout_risk: "Riesgo de desabasto",
        payment_compliance: "Compliance de pago", churn_risk: "Riesgo de churn",
        cross_sell: "Cross-sell", opportunity: "Oportunidad",
      };
      setCatalogName(typeNames[context.alert.alert_type] ?? null);

      setLoading(false);
    }
    fetchData();
  }, [params.id]);

  async function updateState(state: "acknowledged" | "resolved") {
    if (!alert) return;
    const updates: Record<string, unknown> = { state };
    if (state === "resolved") updates.resolved_at = new Date().toISOString();
    const { error } = await supabase.from("alerts").update(updates).eq("id", alert.id);
    if (error) {
      toast.error("Error al actualizar alerta");
      return;
    }
    setAlert({ ...alert, state, ...(state === "resolved" ? { resolved_at: new Date().toISOString() } : {}) });
    toast.success("Alerta actualizada");
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (!alert) {
    return (
      <div>
        <Button variant="ghost" size="sm" onClick={() => router.push("/alerts")} className="mb-4">
          <ArrowLeft className="mr-1 h-4 w-4" /> Alertas
        </Button>
        <EmptyState icon={Bell} title="Alerta no encontrada" description="La alerta solicitada no existe." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumbs with connected entities */}
      <Breadcrumbs items={[
        { label: "Dashboard", href: "/" },
        { label: "Alertas", href: "/alerts" },
        { label: alert.title.slice(0, 50) },
      ]} />

      {/* Header */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <SeverityBadge severity={alert.severity} />
          <StateBadge state={alert.state} />
          <Badge variant="secondary">{catalogName ?? alert.alert_type}</Badge>
          {alert.contact_name && alert.contact_id && (
            <EntityLink type="contact" id={alert.contact_id} label={alert.contact_name} />
          )}
          {alert.company_id && (
            <EntityLink type="company" id={alert.company_id} label="Ver empresa" />
          )}
        </div>
        <h1 className="text-2xl font-bold">{alert.title}</h1>
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" />
            {formatDateTime(alert.created_at)} ({timeAgo(alert.created_at)})
          </span>
          {alert.account && <span>Cuenta: {alert.account}</span>}
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {/* Main content */}
        <div className="lg:col-span-2 space-y-6">
          {alert.description && (
            <Card>
              <CardHeader><CardTitle className="text-sm">Descripcion</CardTitle></CardHeader>
              <CardContent>
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{alert.description}</p>
              </CardContent>
            </Card>
          )}

          {/* Business impact & suggested action */}
          {(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const a = alert as any;
            if (!a.business_impact && !a.suggested_action) return null;
            return (
              <div className="grid gap-4 sm:grid-cols-2">
                {a.business_impact && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-1.5">
                        <TrendingUp className="h-3.5 w-3.5 text-amber-500" />
                        Impacto de Negocio
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm">{String(a.business_impact)}</p>
                    </CardContent>
                  </Card>
                )}
                {a.suggested_action && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-1.5">
                        <Lightbulb className="h-3.5 w-3.5 text-blue-500" />
                        Accion Sugerida
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm">{String(a.suggested_action)}</p>
                    </CardContent>
                  </Card>
                )}
              </div>
            );
          })()}

          {/* Thread emails (from RPC context) */}
          {threadEmails.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5" />
                  Emails del Hilo ({threadEmails.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {threadEmails.map((email) => (
                  <Link key={email.id} href={`/emails/${email.id}`} className="block rounded-lg border p-3 hover:bg-muted/50 transition-colors">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium">{email.subject ?? "(sin asunto)"}</p>
                      <span className="text-xs text-muted-foreground">{timeAgo(email.email_date)}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {email.sender} → {email.recipient}
                    </p>
                    {email.snippet && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{email.snippet}</p>
                    )}
                  </Link>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Related actions (from RPC context) */}
          {relatedActions.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-1.5">
                  <CheckSquare className="h-3.5 w-3.5" />
                  Acciones Relacionadas ({relatedActions.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {relatedActions.map((action) => (
                  <div key={action.id} className="flex items-start justify-between gap-3 rounded-lg border p-3">
                    <div className="space-y-1">
                      <p className="text-sm font-medium">{action.description}</p>
                      <div className="flex items-center gap-2">
                        <StateBadge state={action.state ?? action.status} />
                        {action.priority && <Badge variant="outline" className="text-[10px]">{action.priority}</Badge>}
                      </div>
                    </div>
                    {action.due_date && (
                      <span className="text-xs text-muted-foreground shrink-0">{formatDate(action.due_date)}</span>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Contact facts (from RPC context) */}
          {contactFacts.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-1.5">
                  <Brain className="h-3.5 w-3.5" />
                  Hechos del Contacto ({contactFacts.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {contactFacts.slice(0, 8).map((fact) => (
                  <div key={fact.id} className="flex items-start justify-between gap-3 text-sm">
                    <div className="space-y-0.5">
                      <p>{fact.fact_text}</p>
                      {fact.fact_type && <Badge variant="outline" className="text-[10px]">{fact.fact_type}</Badge>}
                    </div>
                    {fact.confidence != null && (
                      <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                        {Math.round(fact.confidence * 100)}%
                      </span>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Actions */}
          <div className="flex items-center gap-3">
            {alert.state === "new" && (
              <Button variant="outline" onClick={() => updateState("acknowledged")}>
                Reconocer
              </Button>
            )}
            {alert.state !== "resolved" && (
              <Button variant="outline" onClick={() => updateState("resolved")}>
                Resolver
              </Button>
            )}
            <FeedbackButtons table="alerts" id={alert.id} />
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {alert.contact_name && (
            <Card>
              <CardContent className="pt-4 space-y-2">
                <p className="text-xs text-muted-foreground">Contacto</p>
                {alert.contact_id ? (
                  <Link href={`/contacts/${alert.contact_id}`} className="flex items-center gap-2 text-sm font-medium text-primary hover:underline">
                    <User className="h-4 w-4" /> {alert.contact_name}
                  </Link>
                ) : (
                  <p className="text-sm font-medium">{alert.contact_name}</p>
                )}
              </CardContent>
            </Card>
          )}

          {alert.company_id && (
            <Card>
              <CardContent className="pt-4 space-y-2">
                <p className="text-xs text-muted-foreground">Empresa</p>
                <Link href={`/companies/${alert.company_id}`} className="flex items-center gap-2 text-sm font-medium text-primary hover:underline">
                  <Building2 className="h-4 w-4" /> Ver empresa
                </Link>
              </CardContent>
            </Card>
          )}

          {(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const threadId = (alert as any).related_thread_id;
            if (!threadId) return null;
            return (
              <Card>
                <CardContent className="pt-4 space-y-2">
                  <p className="text-xs text-muted-foreground">Hilo Relacionado</p>
                  <Link href={`/threads/${threadId}`} className="flex items-center gap-2 text-sm font-medium text-primary hover:underline">
                    <MessagesSquare className="h-4 w-4" /> Ver hilo
                  </Link>
                </CardContent>
              </Card>
            );
          })()}

          {alert.prediction_confidence != null && (
            <Card>
              <CardContent className="pt-4 space-y-2">
                <p className="text-xs text-muted-foreground">Confianza de prediccion</p>
                <p className="text-2xl font-bold">{Math.round(alert.prediction_confidence * 100)}%</p>
              </CardContent>
            </Card>
          )}

          {alert.resolved_at && (
            <Card>
              <CardContent className="pt-4 space-y-2">
                <p className="text-xs text-muted-foreground">Resuelta</p>
                <p className="text-sm">{formatDateTime(alert.resolved_at)}</p>
                {alert.resolution_notes && (
                  <p className="text-xs text-muted-foreground">{alert.resolution_notes}</p>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
