"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Bell,
  CheckSquare,
  ShoppingCart,
  User,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  cn,
  getInitials,
  scoreToPercent,
  sentimentColor,
} from "@/lib/utils";
import type {
  Contact,
  Fact,
  Email,
  Alert,
  ActionItem,
} from "@/lib/types";
import { Breadcrumbs } from "@/components/shared/breadcrumbs";
import { RiskBadge } from "@/components/shared/risk-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { EnrichButton } from "@/components/shared/enrich-button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import {
  TabPerfil,
  TabComercial,
  TabSalud,
  TabEmails,
  TabInteligencia,
  TabAlertas,
  TabAcciones,
} from "./components";

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
        Promise.resolve(supabase.rpc("get_contact_intelligence", { p_contact_email: c.email }))
          .then(({ data: intel }) => {
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
          }).catch(() => {});
      }

      // Fetch contact communications via RPC (non-blocking)
      if (c.email) {
        Promise.resolve(supabase.rpc("get_contact_communications", { p_contact_email: c.email }))
          .then(({ data: commsData }) => {
            if (commsData) {
              setContactComms(commsData);
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
              if (Array.isArray(commsData.facts) && commsData.facts.length > 0) {
                setFacts(commsData.facts as Fact[]);
              }
            }
          }).catch(() => {});
      }

      // Parallel fetches
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const promises: PromiseLike<any>[] = [];

      if (c.entity_id) {
        promises.push(
          supabase.from("facts").select("*").eq("entity_id", c.entity_id)
            .order("created_at", { ascending: false })
            .then(({ data }) => setFacts((data as Fact[] | null) ?? []))
        );
      }

      promises.push(
        supabase.from("alerts").select("*").eq("contact_id", contactId)
          .order("created_at", { ascending: false })
          .then(({ data }) => setAlerts((data as Alert[] | null) ?? []))
      );

      promises.push(
        supabase.from("action_items").select("*").eq("contact_id", contactId)
          .order("created_at", { ascending: false })
          .then(({ data }) => setActions((data as ActionItem[] | null) ?? []))
      );

      promises.push(
        Promise.resolve(
          supabase.from("health_scores").select("*").eq("contact_id", contactId)
            .order("score_date", { ascending: false }).limit(30)
        ).then(({ data }) => setHealthScores(data ?? []))
          .catch(() => setHealthScores([]))
      );

      if (c.email) {
        const emailPattern = `%${c.email}%`;
        promises.push(
          supabase.from("emails").select("*")
            .or(`sender.ilike.${emailPattern},recipient.ilike.${emailPattern}`)
            .order("email_date", { ascending: false }).limit(20)
            .then(({ data }) => setEmails((data as Email[] | null) ?? []))
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
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
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
        <Button variant="ghost" size="sm" onClick={() => router.push("/contacts")} className="mb-4">
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
      <Breadcrumbs items={[
        { label: "Dashboard", href: "/" },
        ...(contact.company_id
          ? [{ label: "Empresas", href: "/companies" },
             { label: "Empresa", href: `/companies/${contact.company_id}` }]
          : [{ label: "Contactos", href: "/contacts" }]),
        { label: contact.name ?? contact.email },
      ]} />

      {/* Header */}
      <div className="flex items-center gap-4">
        <Avatar className="h-16 w-16">
          <AvatarFallback className="text-lg">{getInitials(contact.name)}</AvatarFallback>
        </Avatar>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">{contact.name ?? "Sin nombre"}</h1>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            {contact.email && <span>{contact.email}</span>}
            {contact.company_id && (
              <>
                <span>·</span>
                <Link href={`/companies/${contact.company_id}`} className="text-primary hover:underline">Ver empresa</Link>
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
        <EnrichButton type="contact" id={contactId} name={contact.name ?? "contacto"} />
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Riesgo</p>
            <div className="mt-1"><RiskBadge level={contact.risk_level} /></div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Sentimiento</p>
            <p className={cn("mt-1 text-2xl font-bold tabular-nums", sentimentColor(contact.sentiment_score))}>
              {contact.sentiment_score != null ? contact.sentiment_score.toFixed(2) : "—"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Relacion</p>
            <div className="mt-2 flex items-center gap-2">
              <Progress value={scoreToPercent(contact.relationship_score)} className="flex-1" />
              <span className="text-sm font-medium tabular-nums">
                {contact.relationship_score != null ? `${Math.round(scoreToPercent(contact.relationship_score))}%` : "—"}
              </span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Total emails</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{totalEmails}</p>
            <p className="text-xs text-muted-foreground">{contact.total_sent ?? 0} env / {contact.total_received ?? 0} rec</p>
          </CardContent>
        </Card>
      </div>

      {/* Intelligence KPIs */}
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
        <TabsList className="flex-wrap h-auto gap-1 overflow-x-auto">
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

        <TabsContent value="perfil" className="space-y-6">
          <TabPerfil contact={contact} personProfile={personProfile} />
        </TabsContent>
        <TabsContent value="comercial" className="space-y-6">
          <TabComercial contact={contact} />
        </TabsContent>
        <TabsContent value="salud" className="space-y-6">
          <TabSalud healthScores={healthScores} />
        </TabsContent>
        <TabsContent value="emails" className="space-y-6">
          <TabEmails emails={emails} contactComms={contactComms} />
        </TabsContent>
        <TabsContent value="inteligencia">
          <TabInteligencia facts={facts} />
        </TabsContent>
        <TabsContent value="alertas">
          <TabAlertas alerts={alerts} />
        </TabsContent>
        <TabsContent value="acciones">
          <TabAcciones actions={actions} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
