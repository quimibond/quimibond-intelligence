"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { timeAgo } from "@/lib/utils";
import { ArrowLeft, Mail, AlertTriangle, CheckSquare, Brain } from "lucide-react";
import Link from "next/link";

interface Contact {
  id: string;
  name: string;
  email: string;
  company: string;
  risk_level: string;
  sentiment_score: number;
  last_interaction: string;
  total_emails: number;
  tags: string[];
  odoo_partner_id: number;
  phone: string;
  city: string;
  country: string;
}

interface PersonProfile {
  id: string;
  contact_id: string;
  personality_traits: string[];
  communication_style: string;
  interests: string[];
  decision_factors: string[];
  summary: string;
}

interface Alert {
  id: string;
  title: string;
  severity: string;
  state: string;
  created_at: string;
}

interface ActionItem {
  id: string;
  description: string;
  priority: string;
  state: string;
  due_date: string;
}

const riskVariant: Record<string, "destructive" | "warning" | "success"> = {
  high: "destructive",
  medium: "warning",
  low: "success",
};

export default function ContactDetailPage() {
  const params = useParams();
  const [contact, setContact] = useState<Contact | null>(null);
  const [profile, setProfile] = useState<PersonProfile | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetch() {
      const [contactRes, profileRes, alertsRes, actionsRes] = await Promise.all([
        supabase.from("contacts").select("*").eq("id", params.id).single(),
        supabase.from("person_profiles").select("*").eq("contact_id", params.id).single(),
        supabase.from("alerts").select("*").eq("contact_id", params.id).order("created_at", { ascending: false }).limit(10),
        supabase.from("action_items").select("*").eq("contact_id", params.id).order("created_at", { ascending: false }).limit(10),
      ]);

      setContact(contactRes.data);
      setProfile(profileRes.data);
      setAlerts(alertsRes.data || []);
      setActions(actionsRes.data || []);
      setLoading(false);
    }
    fetch();
  }, [params.id]);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-pulse text-[var(--muted-foreground)]">Cargando contacto...</div>
      </div>
    );
  }

  if (!contact) {
    return (
      <div className="text-center py-12">
        <p className="text-[var(--muted-foreground)]">Contacto no encontrado.</p>
        <Link href="/contacts">
          <Button variant="ghost" className="mt-4">Volver a contactos</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/contacts">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">{contact.name || contact.email}</h1>
          <p className="text-sm text-[var(--muted-foreground)]">{contact.company}</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-xs text-[var(--muted-foreground)]">Riesgo</p>
            <div className="mt-1">
              {contact.risk_level ? (
                <Badge variant={riskVariant[contact.risk_level] || "info"}>{contact.risk_level}</Badge>
              ) : (
                <span className="text-sm">—</span>
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-xs text-[var(--muted-foreground)]">Sentimiento</p>
            <p className={`mt-1 text-lg font-bold ${
              (contact.sentiment_score ?? 0) >= 0.5 ? "text-emerald-400" :
              (contact.sentiment_score ?? 0) <= -0.2 ? "text-red-400" : ""
            }`}>
              {contact.sentiment_score?.toFixed(2) ?? "—"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-xs text-[var(--muted-foreground)]">Emails</p>
            <p className="mt-1 text-lg font-bold">{contact.total_emails ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-xs text-[var(--muted-foreground)]">Ultima interaccion</p>
            <p className="mt-1 text-sm">
              {contact.last_interaction ? timeAgo(contact.last_interaction) : "—"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Contact Info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-4 w-4" /> Informacion
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
            <div>
              <dt className="text-[var(--muted-foreground)]">Email</dt>
              <dd>{contact.email || "—"}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted-foreground)]">Telefono</dt>
              <dd>{contact.phone || "—"}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted-foreground)]">Ciudad</dt>
              <dd>{contact.city || "—"}</dd>
            </div>
            <div>
              <dt className="text-[var(--muted-foreground)]">Pais</dt>
              <dd>{contact.country || "—"}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {/* Person Profile */}
      {profile && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Brain className="h-4 w-4" /> Perfil de Personalidad
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {profile.summary && <p className="text-sm">{profile.summary}</p>}
            {profile.communication_style && (
              <div>
                <p className="text-xs text-[var(--muted-foreground)]">Estilo de comunicacion</p>
                <p className="text-sm">{profile.communication_style}</p>
              </div>
            )}
            {profile.personality_traits?.length > 0 && (
              <div>
                <p className="text-xs text-[var(--muted-foreground)] mb-1">Rasgos</p>
                <div className="flex flex-wrap gap-1">
                  {profile.personality_traits.map((t, i) => (
                    <Badge key={i} variant="secondary">{t}</Badge>
                  ))}
                </div>
              </div>
            )}
            {profile.decision_factors?.length > 0 && (
              <div>
                <p className="text-xs text-[var(--muted-foreground)] mb-1">Factores de decision</p>
                <div className="flex flex-wrap gap-1">
                  {profile.decision_factors.map((f, i) => (
                    <Badge key={i} variant="outline">{f}</Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Alerts */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" /> Alertas
            </CardTitle>
          </CardHeader>
          <CardContent>
            {alerts.length > 0 ? (
              <div className="space-y-2">
                {alerts.map((a) => (
                  <div key={a.id} className="flex items-center justify-between rounded border border-[var(--border)] p-2">
                    <div className="flex items-center gap-2">
                      <Badge variant={a.severity === "high" || a.severity === "critical" ? "destructive" : "warning"} className="text-[10px]">
                        {a.severity}
                      </Badge>
                      <span className="text-sm truncate max-w-[200px]">{a.title}</span>
                    </div>
                    <span className="text-xs text-[var(--muted-foreground)]">{timeAgo(a.created_at)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-[var(--muted-foreground)]">Sin alertas.</p>
            )}
          </CardContent>
        </Card>

        {/* Actions */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckSquare className="h-4 w-4" /> Acciones
            </CardTitle>
          </CardHeader>
          <CardContent>
            {actions.length > 0 ? (
              <div className="space-y-2">
                {actions.map((a) => (
                  <div key={a.id} className="flex items-center justify-between rounded border border-[var(--border)] p-2">
                    <div className="flex items-center gap-2">
                      <Badge variant={a.state === "completed" ? "success" : a.state === "pending" ? "warning" : "info"} className="text-[10px]">
                        {a.state}
                      </Badge>
                      <span className="text-sm truncate max-w-[200px]">{a.description}</span>
                    </div>
                    {a.due_date && (
                      <span className="text-xs text-[var(--muted-foreground)]">
                        {new Date(a.due_date).toLocaleDateString("es-MX", { day: "numeric", month: "short" })}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-[var(--muted-foreground)]">Sin acciones.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
