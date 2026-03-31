"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  ArrowLeft, Bell, Bot, Brain, Building2, Calendar, CheckCircle2,
  CheckSquare, ChevronRight, Clock, ExternalLink, Lightbulb, Loader2,
  Mail, MessageSquare, Plus, Shield, ThumbsUp, ThumbsDown,
  TrendingUp, User, XCircle, Zap,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn, formatCurrency, timeAgo } from "@/lib/utils";
import { SeverityBadge } from "@/components/shared/severity-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>;

export default function InboxDetailPage() {
  const params = useParams<{ type: string; id: string }>();
  const router = useRouter();
  const [item, setItem] = useState<R | null>(null);
  const [relatedEmails, setRelatedEmails] = useState<R[]>([]);
  const [relatedActions, setRelatedActions] = useState<R[]>([]);
  const [relatedFacts, setRelatedFacts] = useState<R[]>([]);
  const [company, setCompany] = useState<R | null>(null);
  const [contact, setContact] = useState<R | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);

  const itemType = params.type; // 'alert' | 'action' | 'insight'
  const itemId = parseInt(params.id);

  useEffect(() => {
    async function load() {
      let data: R | null = null;

      // Load main item
      if (itemType === "alert") {
        const { data: d } = await supabase.from("alerts").select("*").eq("id", itemId).single();
        data = d;
      } else if (itemType === "action") {
        const { data: d } = await supabase.from("action_items").select("*").eq("id", itemId).single();
        data = d;
      } else if (itemType === "insight") {
        const { data: d } = await supabase.from("agent_insights").select("*").eq("id", itemId).single();
        data = d;
      }

      if (!data) { setLoading(false); return; }
      setItem(data);

      // Load related data in parallel
      const promises: PromiseLike<void>[] = [];

      // Company
      const companyId = data.company_id;
      if (companyId) {
        promises.push(
          supabase.from("companies").select("id, name, lifetime_value, is_customer, is_supplier, risk_signals, opportunity_signals")
            .eq("id", companyId).single()
            .then(({ data: c }) => { if (c) setCompany(c); })
        );
      }

      // Contact
      const contactId = data.contact_id;
      if (contactId) {
        promises.push(
          supabase.from("contacts").select("id, name, email, role, company_id, current_health_score, risk_level, sentiment_score")
            .eq("id", contactId).single()
            .then(({ data: c }) => { if (c) setContact(c); })
        );
      }

      // Related emails (by contact or thread)
      if (data.thread_id) {
        promises.push(
          supabase.from("emails").select("id, sender, subject, email_date, snippet, sender_type")
            .eq("thread_id", data.thread_id).order("email_date", { ascending: false }).limit(5)
            .then(({ data: e }) => { if (e) setRelatedEmails(e); })
        );
      } else if (contactId) {
        promises.push(
          supabase.from("emails").select("id, sender, subject, email_date, snippet, sender_type")
            .eq("sender_contact_id", contactId).order("email_date", { ascending: false }).limit(5)
            .then(({ data: e }) => { if (e) setRelatedEmails(e); })
        );
      }

      // Related actions (for alerts)
      if (itemType === "alert") {
        promises.push(
          supabase.from("action_items").select("id, description, state, priority, assignee_name, due_date")
            .eq("alert_id", itemId).order("created_at", { ascending: false })
            .then(({ data: a }) => { if (a) setRelatedActions(a); })
        );
      }

      // Related facts (by contact entity)
      if (contactId) {
        promises.push(
          supabase.from("contacts").select("entity_id").eq("id", contactId).single()
            .then(async ({ data: c }) => {
              if (c?.entity_id) {
                const { data: f } = await supabase.from("facts")
                  .select("id, fact_type, fact_text, confidence, fact_date")
                  .eq("entity_id", c.entity_id).order("created_at", { ascending: false }).limit(5);
                if (f) setRelatedFacts(f);
              }
            })
        );
      }

      await Promise.all(promises);
      setLoading(false);
    }
    load();
  }, [itemType, itemId]);

  // ── Actions ──

  const handleAct = useCallback(async () => {
    if (!item) return;
    setActing(true);
    try {
      if (itemType === "alert") {
        // Create action from alert
        await supabase.from("action_items").insert({
          action_type: "follow_up",
          description: item.suggested_action ?? `Dar seguimiento: ${item.title}`,
          reason: item.title,
          priority: item.severity === "critical" ? "high" : item.severity === "high" ? "high" : "medium",
          contact_id: item.contact_id,
          contact_name: item.contact_name,
          company_id: item.company_id,
          thread_id: item.thread_id,
          alert_id: item.id,
          state: "pending",
          due_date: new Date(Date.now() + 2 * 86400000).toISOString().split("T")[0],
        });
        await supabase.from("alerts").update({ state: "acknowledged" }).eq("id", item.id);
        setItem({ ...item, state: "acknowledged" });
        toast.success("Accion creada y alerta reconocida");
      } else if (itemType === "action") {
        await supabase.from("action_items").update({ state: "completed", completed_at: new Date().toISOString() }).eq("id", item.id);
        setItem({ ...item, state: "completed" });
        toast.success("Accion completada");
      } else if (itemType === "insight") {
        await supabase.from("agent_insights").update({ state: "acted_on", was_useful: true }).eq("id", item.id);
        setItem({ ...item, state: "acted_on" });
        toast.success("Insight marcado como util");
      }
    } catch {
      toast.error("Error al procesar");
    } finally {
      setActing(false);
    }
  }, [item, itemType]);

  const handleDismiss = useCallback(async () => {
    if (!item) return;
    if (itemType === "alert") {
      await supabase.from("alerts").update({ state: "dismissed" }).eq("id", item.id);
    } else if (itemType === "action") {
      await supabase.from("action_items").update({ state: "dismissed" }).eq("id", item.id);
    } else if (itemType === "insight") {
      await supabase.from("agent_insights").update({ state: "dismissed", was_useful: false }).eq("id", item.id);
    }
    toast("Descartado");
    router.push("/inbox");
  }, [item, itemType, router]);

  // ── Loading ──

  if (loading) {
    return (
      <div className="space-y-4 max-w-2xl mx-auto">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-48" />
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
      </div>
    );
  }

  if (!item) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <XCircle className="h-12 w-12 text-muted-foreground mb-4" />
        <p className="text-lg font-medium">No encontrado</p>
        <Button variant="ghost" onClick={() => router.push("/inbox")} className="mt-4">
          <ArrowLeft className="h-4 w-4 mr-2" /> Volver al Inbox
        </Button>
      </div>
    );
  }

  // ── Derive display values ──

  const title = itemType === "alert" ? item.title : itemType === "action" ? item.description : item.title;
  const description = itemType === "alert" ? item.description : itemType === "action" ? item.reason : item.description;
  const severity = itemType === "insight" ? item.severity : (item.severity ?? "medium");
  const state = item.state;
  const isDone = ["resolved", "completed", "acted_on", "dismissed", "expired"].includes(state);

  const typeConfig = {
    alert: { label: "Alerta", icon: Bell, color: "text-red-500", bg: "bg-red-500/10" },
    action: { label: "Accion", icon: CheckSquare, color: "text-blue-500", bg: "bg-blue-500/10" },
    insight: { label: "Insight IA", icon: Bot, color: "text-purple-500", bg: "bg-purple-500/10" },
  }[itemType] ?? { label: "Item", icon: Zap, color: "text-muted-foreground", bg: "bg-muted" };

  const TypeIcon = typeConfig.icon;

  return (
    <div className="max-w-2xl mx-auto space-y-4 pb-24">
      {/* Back button */}
      <button
        onClick={() => router.push("/inbox")}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors py-2"
      >
        <ArrowLeft className="h-4 w-4" />
        Inbox
      </button>

      {/* Main card */}
      <Card className={cn(isDone && "opacity-60")}>
        <CardContent className="pt-5 space-y-4">
          {/* Type + severity + state */}
          <div className="flex items-center gap-2 flex-wrap">
            <Badge className={cn("gap-1", typeConfig.bg, typeConfig.color, "border-0")}>
              <TypeIcon className="h-3 w-3" />
              {typeConfig.label}
            </Badge>
            <SeverityBadge severity={severity} />
            <Badge variant={isDone ? "success" : "secondary"}>{state}</Badge>
            {item.business_value_at_risk > 0 && (
              <Badge variant="critical" className="gap-1">
                $ {formatCurrency(item.business_value_at_risk)}
              </Badge>
            )}
          </div>

          {/* Title */}
          <h1 className="text-xl font-bold leading-tight">{title}</h1>

          {/* Description */}
          {description && (
            <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
          )}

          {/* Insight-specific: confidence + recommendation */}
          {itemType === "insight" && (
            <>
              {item.confidence != null && (
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground">Confianza</span>
                  <Progress value={item.confidence * 100} className="h-2 flex-1 max-w-32" />
                  <span className="text-sm font-medium">{(item.confidence * 100).toFixed(0)}%</span>
                </div>
              )}
              {item.recommendation && (
                <div className="rounded-lg bg-purple-500/5 border border-purple-500/20 p-3">
                  <p className="text-xs font-medium text-purple-600 dark:text-purple-400 mb-1">Recomendacion IA</p>
                  <p className="text-sm">{item.recommendation}</p>
                </div>
              )}
            </>
          )}

          {/* Alert-specific: suggested action */}
          {itemType === "alert" && item.suggested_action && (
            <div className="rounded-lg bg-amber-500/5 border border-amber-500/20 p-3">
              <p className="text-xs font-medium text-amber-600 dark:text-amber-400 mb-1">Sugerencia IA</p>
              <p className="text-sm">{item.suggested_action}</p>
            </div>
          )}

          {/* Action-specific: assignee + due date */}
          {itemType === "action" && (
            <div className="flex flex-wrap gap-4 text-sm">
              {item.assignee_name && (
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4 text-muted-foreground" />
                  <span>{item.assignee_name}</span>
                </div>
              )}
              {item.due_date && (
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span className={cn(item.due_date < new Date().toISOString().split("T")[0] && "text-red-500 font-medium")}>
                    {item.due_date}
                    {item.due_date < new Date().toISOString().split("T")[0] && " (VENCIDA)"}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Meta */}
          <div className="flex items-center gap-4 text-xs text-muted-foreground pt-2 border-t">
            <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {timeAgo(item.created_at)}</span>
            {item.account && <span>{item.account}</span>}
          </div>
        </CardContent>
      </Card>

      {/* Contact card */}
      {contact && (
        <Link href={`/contacts/${contact.id}`}>
          <Card className="hover:border-primary/20 transition-colors">
            <CardContent className="py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold",
                    contact.risk_level === "high" || contact.risk_level === "critical"
                      ? "bg-red-500/15 text-red-600" : "bg-muted text-muted-foreground"
                  )}>
                    {contact.name?.charAt(0) ?? "?"}
                  </div>
                  <div>
                    <p className="font-medium text-sm">{contact.name ?? contact.email}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {contact.role && <span>{contact.role}</span>}
                      {contact.email && <span>{contact.email}</span>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {contact.current_health_score != null && (
                    <div className={cn(
                      "text-sm font-bold",
                      contact.current_health_score >= 60 ? "text-emerald-500" :
                      contact.current_health_score >= 40 ? "text-amber-500" : "text-red-500"
                    )}>
                      {contact.current_health_score}
                    </div>
                  )}
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>
      )}

      {/* Company card */}
      {company && (
        <Link href={`/companies/${company.id}`}>
          <Card className="hover:border-primary/20 transition-colors">
            <CardContent className="py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Building2 className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium text-sm">{company.name}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {company.is_customer && <span>Cliente</span>}
                      {company.is_supplier && <span>Proveedor</span>}
                      {company.lifetime_value > 0 && <span>{formatCurrency(company.lifetime_value)}</span>}
                    </div>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
        </Link>
      )}

      {/* Related emails */}
      {relatedEmails.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-sm">Emails Relacionados</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-1">
            {relatedEmails.map((email) => (
              <Link
                key={email.id}
                href={`/emails/${email.id}`}
                className="flex items-start gap-3 rounded-lg p-2 hover:bg-muted/50 transition-colors"
              >
                <Mail className={cn("h-3.5 w-3.5 mt-0.5 shrink-0", email.sender_type === "external" ? "text-blue-500" : "text-muted-foreground")} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{email.subject ?? "(sin asunto)"}</p>
                  <p className="text-xs text-muted-foreground truncate">{email.snippet}</p>
                </div>
                <span className="text-[10px] text-muted-foreground shrink-0">{timeAgo(email.email_date)}</span>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Related facts */}
      {relatedFacts.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Brain className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-sm">Hechos del Knowledge Graph</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {relatedFacts.map((fact) => (
              <div key={fact.id} className="flex items-start gap-2 text-sm">
                <Lightbulb className="h-3.5 w-3.5 mt-0.5 text-amber-500 shrink-0" />
                <div className="flex-1">
                  <p>{fact.fact_text}</p>
                  <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground">
                    <span>{fact.fact_type}</span>
                    <span>{(fact.confidence * 100).toFixed(0)}% confianza</span>
                    {fact.fact_date && <span>{fact.fact_date}</span>}
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Related actions (for alerts) */}
      {relatedActions.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <CheckSquare className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-sm">Acciones Vinculadas</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {relatedActions.map((action) => (
              <div key={action.id} className="flex items-center justify-between rounded-lg border p-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm truncate">{action.description}</p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {action.assignee_name && <span>{action.assignee_name}</span>}
                    {action.due_date && <span>{action.due_date}</span>}
                  </div>
                </div>
                <Badge variant={action.state === "completed" ? "success" : action.state === "pending" ? "warning" : "secondary"}>
                  {action.state}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Sticky bottom action bar */}
      {!isDone && (
        <div className="fixed bottom-0 left-0 right-0 z-50 bg-background/95 backdrop-blur border-t p-4 md:pl-[calc(theme(spacing.64)+1rem)]">
          <div className="max-w-2xl mx-auto flex gap-3">
            <Button
              variant="outline"
              className="flex-1 text-red-500 border-red-500/30 hover:bg-red-500/10"
              onClick={handleDismiss}
            >
              <XCircle className="h-4 w-4 mr-2" />
              Descartar
            </Button>
            <Button
              className="flex-1 bg-emerald-600 hover:bg-emerald-700"
              onClick={handleAct}
              disabled={acting}
            >
              {acting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : itemType === "alert" ? (
                <Plus className="h-4 w-4 mr-2" />
              ) : itemType === "action" ? (
                <CheckCircle2 className="h-4 w-4 mr-2" />
              ) : (
                <ThumbsUp className="h-4 w-4 mr-2" />
              )}
              {itemType === "alert" ? "Crear Accion" : itemType === "action" ? "Completar" : "Util"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
