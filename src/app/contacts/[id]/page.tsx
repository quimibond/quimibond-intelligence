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

  const riskDot = contact.risk_level === "high" || contact.risk_level === "critical" ? "bg-red-500" : contact.risk_level === "medium" ? "bg-orange-400" : "bg-emerald-500";

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <button onClick={() => router.push("/contacts")} className="text-xs text-muted-foreground hover:text-foreground mb-1 flex items-center gap-1">
          ← Contactos
        </button>
        <h1 className="text-xl font-black">{contact.name ?? "Sin nombre"}</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          {contact.role ?? contact.department ?? ""}
          {contact.email && <> · {contact.email}</>}
          {contact.company_id && (
            <> · <Link href={`/companies/${contact.company_id}`} className="text-primary">Ver empresa</Link></>
          )}
        </p>
      </div>

      {/* 3 inline stats */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-muted/50 p-2.5">
          <div className={cn("h-2 w-2 rounded-full mx-auto mb-1", riskDot)} />
          <p className="text-[10px] text-muted-foreground">riesgo {contact.risk_level ?? "—"}</p>
        </div>
        <div className="rounded-xl bg-muted/50 p-2.5">
          <p className="text-lg font-black tabular-nums">{contact.current_health_score ?? "—"}</p>
          <p className="text-[10px] text-muted-foreground">health</p>
        </div>
        <div className="rounded-xl bg-muted/50 p-2.5">
          <p className="text-lg font-black tabular-nums">{totalEmails}</p>
          <p className="text-[10px] text-muted-foreground">emails</p>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="perfil">
        <div className="overflow-x-auto -mx-4 px-4 md:mx-0 md:px-0">
          <TabsList className="inline-flex w-auto min-w-full md:min-w-0 gap-0.5 h-9">
            <TabsTrigger value="perfil" className="text-xs px-3">Perfil</TabsTrigger>
            <TabsTrigger value="comercial" className="text-xs px-3">Comercial</TabsTrigger>
            <TabsTrigger value="inteligencia" className="text-xs px-3">Inteligencia</TabsTrigger>
            <TabsTrigger value="emails" className="text-xs px-3">Emails</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="perfil" className="space-y-6">
          <TabPerfil contact={contact} personProfile={personProfile} />
          <TabSalud healthScores={healthScores} />
        </TabsContent>
        <TabsContent value="comercial" className="space-y-6">
          <TabComercial contact={contact} />
        </TabsContent>
        <TabsContent value="inteligencia">
          <TabInteligencia facts={facts} />
        </TabsContent>
        <TabsContent value="emails" className="space-y-6">
          <TabEmails emails={emails} contactComms={contactComms} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
