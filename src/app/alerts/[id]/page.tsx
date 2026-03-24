"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Bell, Building2, Clock, Mail, User } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { formatDateTime, timeAgo } from "@/lib/utils";
import type { Alert, Email } from "@/lib/types";
import { SeverityBadge } from "@/components/shared/severity-badge";
import { StateBadge } from "@/components/shared/state-badge";
import { FeedbackButtons } from "@/components/shared/feedback-buttons";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

export default function AlertDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [alert, setAlert] = useState<Alert | null>(null);
  const [relatedEmails, setRelatedEmails] = useState<Email[]>([]);
  const [catalogName, setCatalogName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      const { data: alertData } = await supabase
        .from("alerts")
        .select("*")
        .eq("id", params.id)
        .single();

      if (!alertData) {
        setLoading(false);
        return;
      }

      const a = alertData as Alert;
      setAlert(a);

      // Fetch catalog display name
      const { data: catalog } = await supabase
        .from("alert_type_catalog")
        .select("display_name, description, category")
        .eq("alert_type", a.alert_type)
        .single();
      if (catalog) setCatalogName(catalog.display_name);

      // Fetch related emails if we have a contact
      if (a.contact_name) {
        const pattern = `%${a.contact_name.split(" ")[0]}%`;
        const { data: emails } = await supabase
          .from("emails")
          .select("id, subject, sender, recipient, snippet, email_date")
          .or(`sender.ilike.${pattern},recipient.ilike.${pattern}`)
          .order("email_date", { ascending: false })
          .limit(5);
        setRelatedEmails((emails as Email[] | null) ?? []);
      }

      setLoading(false);
    }
    fetchData();
  }, [params.id]);

  async function updateState(state: "acknowledged" | "resolved") {
    if (!alert) return;
    const updates: Record<string, unknown> = { state };
    if (state === "resolved") updates.resolved_at = new Date().toISOString();
    const { error } = await supabase.from("alerts").update(updates).eq("id", alert.id);
    if (!error) {
      setAlert({ ...alert, state, ...(state === "resolved" ? { resolved_at: new Date().toISOString() } : {}) });
    }
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
      <Button variant="ghost" size="sm" onClick={() => router.push("/alerts")}>
        <ArrowLeft className="mr-1 h-4 w-4" /> Alertas
      </Button>

      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <SeverityBadge severity={alert.severity} />
          <StateBadge state={alert.state} />
          <Badge variant="secondary">{catalogName ?? alert.alert_type}</Badge>
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

      <div className="grid gap-6 lg:grid-cols-3">
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

          {/* Related emails */}
          {relatedEmails.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-sm">Emails Relacionados</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {relatedEmails.map((email) => (
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
