"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  ArrowLeft, ArrowRight, Bot, Brain, Building2, Calendar,
  CheckCircle2, ChevronLeft, ChevronRight, Clock, DollarSign,
  FileText, Lightbulb, Loader2, Mail, MessageSquare, Package,
  Shield, ThumbsDown, ThumbsUp, Timer, TrendingUp, Truck,
  UserCheck, Users, XCircle, Zap,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn, formatCurrency, formatDate, timeAgo } from "@/lib/utils";
import { useSidebar } from "@/components/layout/sidebar-context";
import { SeverityBadge } from "@/components/shared/severity-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>;

const DOMAIN_ICONS: Record<string, React.ElementType> = {
  sales: TrendingUp, finance: DollarSign, operations: Truck,
  relationships: Users, risk: Shield, growth: Zap, meta: Brain,
};
const DOMAIN_COLORS: Record<string, string> = {
  sales: "text-emerald-500", finance: "text-amber-500", operations: "text-blue-500",
  relationships: "text-purple-500", risk: "text-red-500", growth: "text-cyan-500", meta: "text-indigo-500",
};
const DOMAIN_BG: Record<string, string> = {
  sales: "bg-emerald-500/10", finance: "bg-amber-500/10", operations: "bg-blue-500/10",
  relationships: "bg-purple-500/10", risk: "bg-red-500/10", growth: "bg-cyan-500/10", meta: "bg-indigo-500/10",
};

export default function InsightDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { collapsed } = useSidebar();
  const [insight, setInsight] = useState<R | null>(null);
  const [agent, setAgent] = useState<R | null>(null);
  const [agentRun, setAgentRun] = useState<R | null>(null);
  const [company, setCompany] = useState<R | null>(null);
  const [contact, setContact] = useState<R | null>(null);
  const [relatedEmails, setRelatedEmails] = useState<R[]>([]);
  const [relatedFacts, setRelatedFacts] = useState<R[]>([]);
  const [relatedInsights, setRelatedInsights] = useState<R[]>([]);
  const [odooData, setOdooData] = useState<{ invoices: R[]; deliveries: R[]; orders: R[]; leads: R[] }>({ invoices: [], deliveries: [], orders: [], leads: [] });
  const [navIds, setNavIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);

  const insightId = parseInt(params.id);

  useEffect(() => {
    async function load() {
      setLoading(true);

      // Load insight
      const { data: ins } = await supabase
        .from("agent_insights")
        .select("*")
        .eq("id", insightId)
        .single();

      if (!ins) { setLoading(false); return; }
      setInsight(ins);

      // Mark as seen
      if (ins.state === "new") {
        supabase.from("agent_insights").update({ state: "seen" }).eq("id", insightId).then(() => {});
      }

      // Load nav IDs (all active insights for next/prev)
      const { data: navData } = await supabase
        .from("agent_insights")
        .select("id")
        .in("state", ["new", "seen"])
        .gte("confidence", 0.65)
        .order("created_at", { ascending: false })
        .limit(50);
      if (navData) setNavIds(navData.map(n => n.id));

      // Load agent + company + contact in parallel
      const [agentRes, companyRes, contactRes, runRes] = await Promise.all([
        supabase.from("ai_agents").select("id, slug, name, domain").eq("id", ins.agent_id).single(),
        ins.company_id
          ? supabase.from("companies").select("id, name, canonical_name, lifetime_value, is_customer, is_supplier, total_pending, delivery_otd_rate, entity_id").eq("id", ins.company_id).single()
          : Promise.resolve({ data: null }),
        ins.contact_id
          ? supabase.from("contacts").select("id, name, email, role, current_health_score, risk_level, sentiment_score, last_activity, company_id").eq("id", ins.contact_id).single()
          : Promise.resolve({ data: null }),
        ins.run_id
          ? supabase.from("agent_runs").select("id, started_at, completed_at, duration_seconds, insights_generated, status").eq("id", ins.run_id).single()
          : Promise.resolve({ data: null }),
      ]);

      const agentData = agentRes.data;
      if (agentData) setAgent(agentData);
      const companyData = companyRes.data;
      if (companyData) setCompany(companyData);
      const contactData = contactRes.data;
      if (contactData) setContact(contactData);
      if (runRes.data) setAgentRun(runRes.data);

      // ── Load contextual data in parallel ──
      const domain = agentData?.domain ?? "";
      const companyId = ins.company_id;

      // Build search terms for email traceability
      const searchTerms: string[] = [];
      if (companyData) searchTerms.push(companyData.name ?? companyData.canonical_name);
      if (contactData) searchTerms.push(contactData.name ?? contactData.email);

      // Helper to wrap Supabase PromiseLike into real Promise
      const wrap = <T,>(p: PromiseLike<T>): Promise<T> => Promise.resolve(p);

      const promises: Promise<void>[] = [];

      // Emails related to this insight
      if (searchTerms.length > 0) {
        promises.push(wrap(
          supabase
            .from("emails")
            .select("id, sender, recipient, subject, email_date, snippet, sender_type")
            .or(`subject.ilike.%${searchTerms[0]}%,sender.ilike.%${searchTerms[0]}%`)
            .order("email_date", { ascending: false })
            .limit(5)
        ).then(({ data }) => { if (data?.length) setRelatedEmails(data); }));
      } else if (companyId) {
        promises.push(wrap(
          supabase
            .from("emails")
            .select("id, sender, recipient, subject, email_date, snippet, sender_type")
            .eq("company_id", companyId)
            .order("email_date", { ascending: false })
            .limit(5)
        ).then(({ data }) => { if (data?.length) setRelatedEmails(data); }));
      }

      // Odoo data based on agent domain
      if (companyId) {
        if (domain === "finance" || domain === "risk") {
          promises.push(wrap(
            supabase
              .from("odoo_invoices")
              .select("name, move_type, amount_total, amount_residual, invoice_date, due_date, state, payment_state, days_overdue")
              .eq("company_id", companyId)
              .eq("move_type", "out_invoice")
              .order("invoice_date", { ascending: false })
              .limit(5)
          ).then(({ data }) => { if (data) setOdooData(prev => ({ ...prev, invoices: data })); }));
        }
        if (domain === "operations") {
          promises.push(wrap(
            supabase
              .from("odoo_deliveries")
              .select("name, origin, scheduled_date, date_done, state, is_late, lead_time_days")
              .eq("company_id", companyId)
              .order("scheduled_date", { ascending: false })
              .limit(5)
          ).then(({ data }) => { if (data) setOdooData(prev => ({ ...prev, deliveries: data })); }));
        }
        if (domain === "sales" || domain === "growth") {
          promises.push(wrap(
            supabase
              .from("odoo_order_lines")
              .select("order_name, product_name, qty, subtotal, order_date, order_state")
              .eq("company_id", companyId)
              .eq("order_type", "sale")
              .order("order_date", { ascending: false })
              .limit(5)
          ).then(({ data }) => { if (data) setOdooData(prev => ({ ...prev, orders: data })); }));
          promises.push(wrap(
            supabase
              .from("odoo_crm_leads")
              .select("name, stage, expected_revenue, probability, days_open")
              .eq("company_id", companyId)
              .eq("active", true)
              .limit(5)
          ).then(({ data }) => { if (data) setOdooData(prev => ({ ...prev, leads: data })); }));
        }

        // Related insights from same company
        promises.push(wrap(
          supabase
            .from("agent_insights")
            .select("id, title, severity, state, agent_id, created_at")
            .eq("company_id", companyId)
            .neq("id", insightId)
            .in("state", ["new", "seen", "acted_on"])
            .order("created_at", { ascending: false })
            .limit(4)
        ).then(({ data }) => { if (data) setRelatedInsights(data); }));
      }

      // Knowledge graph facts
      if (companyData?.entity_id) {
        promises.push(wrap(
          supabase
            .from("facts")
            .select("id, fact_type, fact_text, confidence, fact_date")
            .eq("entity_id", companyData.entity_id)
            .order("created_at", { ascending: false })
            .limit(5)
        ).then(({ data }) => { if (data) setRelatedFacts(data); }));
      }

      await Promise.all(promises);
      setLoading(false);
    }
    load();
  }, [insightId]);

  // ── Navigation ──
  const currentNavIndex = navIds.indexOf(insightId);
  const prevId = currentNavIndex > 0 ? navIds[currentNavIndex - 1] : null;
  const nextId = currentNavIndex < navIds.length - 1 ? navIds[currentNavIndex + 1] : null;

  // ── Actions ──
  const handleAct = useCallback(async () => {
    if (!insight) return;
    setActing(true);
    await supabase.from("agent_insights").update({ state: "acted_on", was_useful: true }).eq("id", insight.id);
    setInsight({ ...insight, state: "acted_on" });
    toast.success("Marcado como util — el sistema aprendera de esto");
    setActing(false);
  }, [insight]);

  const handleDismiss = useCallback(async () => {
    if (!insight) return;
    await supabase.from("agent_insights").update({ state: "dismissed", was_useful: false }).eq("id", insight.id);
    toast("Descartado — el sistema ajustara sus prioridades");
    if (nextId) router.push(`/inbox/insight/${nextId}`);
    else router.push("/inbox");
  }, [insight, router, nextId]);

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "Escape") router.push("/inbox");
      if (e.key === "ArrowLeft" && prevId) router.push(`/inbox/insight/${prevId}`);
      if (e.key === "ArrowRight" && nextId) router.push(`/inbox/insight/${nextId}`);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [router, prevId, nextId]);

  // ── Loading ──
  if (loading) {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-16" />
          <div className="flex gap-2"><Skeleton className="h-8 w-8 rounded" /><Skeleton className="h-8 w-8 rounded" /></div>
        </div>
        <Card><CardContent className="pt-5 space-y-4">
          <div className="flex items-center gap-2"><Skeleton className="h-8 w-8 rounded-full" /><Skeleton className="h-4 w-32" /></div>
          <Skeleton className="h-7 w-3/4" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-20 w-full rounded-lg" />
        </CardContent></Card>
        <Skeleton className="h-16 w-full rounded-lg" />
        <Skeleton className="h-32 w-full rounded-lg" />
      </div>
    );
  }

  if (!insight) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <XCircle className="h-12 w-12 text-muted-foreground mb-4" />
        <p className="text-lg font-medium">Insight no encontrado</p>
        <p className="text-sm text-muted-foreground mt-1">Puede que haya expirado o sido resuelto</p>
        <Button variant="ghost" onClick={() => router.push("/inbox")} className="mt-4">
          <ArrowLeft className="h-4 w-4 mr-2" /> Volver al Inbox
        </Button>
      </div>
    );
  }

  const isDone = ["acted_on", "dismissed", "expired"].includes(insight.state);
  const AgentIcon = DOMAIN_ICONS[agent?.domain ?? ""] ?? Bot;
  const hasOdooData = odooData.invoices.length > 0 || odooData.deliveries.length > 0 || odooData.orders.length > 0 || odooData.leads.length > 0;

  return (
    <div className="max-w-2xl mx-auto space-y-4 pb-28 md:pb-24">
      {/* ── Top bar: back + nav ── */}
      <div className="flex items-center justify-between">
        <button onClick={() => router.push("/inbox")} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground group">
          <ArrowLeft className="h-4 w-4 group-hover:-translate-x-0.5 transition-transform" />
          <span className="hidden sm:inline">Inbox</span>
        </button>

        {navIds.length > 1 && (
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-muted-foreground mr-2 hidden sm:inline">
              {currentNavIndex + 1}/{navIds.length}
            </span>
            <Button
              size="sm" variant="ghost"
              className="h-8 w-8 p-0"
              disabled={!prevId}
              onClick={() => prevId && router.push(`/inbox/insight/${prevId}`)}
              title="Anterior (←)"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              size="sm" variant="ghost"
              className="h-8 w-8 p-0"
              disabled={!nextId}
              onClick={() => nextId && router.push(`/inbox/insight/${nextId}`)}
              title="Siguiente (→)"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      {/* ── Main insight card ── */}
      <Card className={cn(isDone && "opacity-60")}>
        <CardContent className="pt-5 space-y-4">
          {/* Agent header */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full", DOMAIN_BG[agent?.domain ?? ""] ?? "bg-muted")}>
                <AgentIcon className={cn("h-4 w-4", DOMAIN_COLORS[agent?.domain ?? ""])} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{agent?.name ?? "Agente"}</p>
                {agentRun && (
                  <p className="text-[10px] text-muted-foreground">
                    Analizado {timeAgo(agentRun.completed_at ?? agentRun.started_at)}
                    {agentRun.duration_seconds && ` · ${agentRun.duration_seconds}s`}
                  </p>
                )}
              </div>
            </div>
            <div className="shrink-0">
              {isDone ? (
                <Badge variant="success" className="gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  {insight.state === "acted_on" ? "Actuado" : insight.state === "dismissed" ? "Descartado" : "Expirado"}
                </Badge>
              ) : (
                <Badge variant="secondary">Pendiente</Badge>
              )}
            </div>
          </div>

          {/* Badges */}
          <div className="flex items-center gap-2 flex-wrap">
            <SeverityBadge severity={insight.severity} />
            <Badge variant="outline" className="text-[10px]">{insight.insight_type}</Badge>
            {insight.business_impact_estimate > 0 && (
              <Badge variant="critical" className="gap-1 text-[10px]">
                <DollarSign className="h-3 w-3" />{formatCurrency(insight.business_impact_estimate)}
              </Badge>
            )}
          </div>

          {/* Title */}
          <h1 className="text-lg md:text-xl font-bold leading-tight">{insight.title}</h1>

          {/* Description */}
          <p className="text-sm text-muted-foreground leading-relaxed">{insight.description}</p>

          {/* Confidence */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground shrink-0">Confianza</span>
            <Progress value={insight.confidence * 100} className="h-2 flex-1 max-w-40" />
            <span className={cn(
              "text-sm font-bold tabular-nums",
              insight.confidence >= 0.85 ? "text-emerald-500" : insight.confidence >= 0.7 ? "text-amber-500" : "text-muted-foreground"
            )}>
              {(insight.confidence * 100).toFixed(0)}%
            </span>
          </div>

          {/* Recommendation */}
          {insight.recommendation && (
            <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/20 p-3 md:p-4">
              <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 mb-1 flex items-center gap-1">
                <Lightbulb className="h-3.5 w-3.5" /> Accion recomendada
              </p>
              <p className="text-sm font-medium">{insight.recommendation}</p>
            </div>
          )}

          {/* Assignee */}
          {insight.assignee_name && (
            <div className="flex items-center gap-3 rounded-lg bg-muted/50 p-3">
              <UserCheck className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <p className="text-[10px] text-muted-foreground leading-none mb-0.5">Responsable</p>
                <p className="text-sm font-medium truncate">
                  {insight.assignee_name}
                  {insight.assignee_department && (
                    <span className="text-muted-foreground font-normal"> · {insight.assignee_department}</span>
                  )}
                </p>
              </div>
            </div>
          )}

          {/* Evidence */}
          {insight.evidence?.length > 0 && !insight.evidence[0]?.priority_tier && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground">Evidencia:</p>
              <ul className="space-y-1">
                {(insight.evidence as string[]).map((e, i) => (
                  <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                    <span className="text-muted-foreground/50 mt-0.5 shrink-0">•</span>
                    <span className="break-words">{typeof e === "string" ? e : JSON.stringify(e)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Meta */}
          <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground pt-2 border-t">
            <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{timeAgo(insight.created_at)}</span>
            {insight.category && <span>{insight.category}</span>}
          </div>
        </CardContent>
      </Card>

      {/* ── Company card ── */}
      {company && (
        <Link href={`/companies/${company.id}`}>
          <Card className="hover:border-primary/20 transition-colors">
            <CardContent className="py-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  <Building2 className="h-5 w-5 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{company.name}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                      {company.is_customer && <span>Cliente</span>}
                      {company.is_supplier && <span>Proveedor</span>}
                      {company.lifetime_value > 0 && <span>{formatCurrency(company.lifetime_value)} lifetime</span>}
                      {company.total_pending > 0 && <span className="text-red-500">{formatCurrency(company.total_pending)} pendiente</span>}
                    </div>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </div>
            </CardContent>
          </Card>
        </Link>
      )}

      {/* ── Contact card ── */}
      {contact && (
        <Link href={`/contacts/${contact.id}`}>
          <Card className="hover:border-primary/20 transition-colors">
            <CardContent className="py-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold",
                    contact.risk_level === "high" || contact.risk_level === "critical" ? "bg-red-500/15 text-red-600" : "bg-muted text-muted-foreground"
                  )}>
                    {contact.name?.charAt(0) ?? "?"}
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{contact.name ?? contact.email}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {contact.role && <span className="truncate">{contact.role}</span>}
                      {contact.current_health_score != null && (
                        <span className={cn(
                          "font-medium shrink-0",
                          contact.current_health_score >= 60 ? "text-emerald-500" : contact.current_health_score >= 40 ? "text-amber-500" : "text-red-500"
                        )}>
                          Score: {contact.current_health_score}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </div>
            </CardContent>
          </Card>
        </Link>
      )}

      {/* ── Odoo data context ── */}
      {hasOdooData && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Package className="h-4 w-4 text-orange-500" />
              <CardTitle className="text-sm">Datos de Odoo</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Invoices */}
            {odooData.invoices.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1.5 flex items-center gap-1">
                  <DollarSign className="h-3 w-3" /> Facturas recientes
                </p>
                <div className="space-y-1">
                  {odooData.invoices.map((inv, i) => (
                    <div key={i} className="flex items-center justify-between text-sm rounded-md bg-muted/30 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <span className="font-medium">{inv.name}</span>
                        <span className="text-xs text-muted-foreground ml-2 hidden sm:inline">{formatDate(inv.invoice_date)}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        <span className="font-medium tabular-nums">{formatCurrency(inv.amount_total)}</span>
                        {inv.days_overdue > 0 ? (
                          <Badge variant="critical" className="text-[10px]">{inv.days_overdue}d vencida</Badge>
                        ) : inv.payment_state === "paid" ? (
                          <Badge variant="success" className="text-[10px]">Pagada</Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px]">{formatCurrency(inv.amount_residual)} pend.</Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Deliveries */}
            {odooData.deliveries.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1.5 flex items-center gap-1">
                  <Truck className="h-3 w-3" /> Entregas recientes
                </p>
                <div className="space-y-1">
                  {odooData.deliveries.map((del, i) => (
                    <div key={i} className="flex items-center justify-between text-sm rounded-md bg-muted/30 px-3 py-2">
                      <div className="min-w-0">
                        <span className="font-medium">{del.name}</span>
                        {del.origin && <span className="text-xs text-muted-foreground ml-1 hidden sm:inline">({del.origin})</span>}
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        <span className="text-xs text-muted-foreground">{formatDate(del.scheduled_date)}</span>
                        {del.is_late ? (
                          <Badge variant="critical" className="text-[10px]">Atrasada</Badge>
                        ) : del.state === "done" ? (
                          <Badge variant="success" className="text-[10px]">Entregada</Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px]">{del.state}</Badge>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Orders */}
            {odooData.orders.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1.5 flex items-center gap-1">
                  <FileText className="h-3 w-3" /> Ordenes recientes
                </p>
                <div className="space-y-1">
                  {odooData.orders.map((ord, i) => (
                    <div key={i} className="flex items-center justify-between text-sm rounded-md bg-muted/30 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <span className="font-medium">{ord.order_name}</span>
                        <span className="text-xs text-muted-foreground ml-1 block sm:inline sm:ml-2 truncate">{ord.product_name}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        <span className="font-medium tabular-nums">{formatCurrency(ord.subtotal)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* CRM Leads */}
            {odooData.leads.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1.5 flex items-center gap-1">
                  <TrendingUp className="h-3 w-3" /> Pipeline
                </p>
                <div className="space-y-1">
                  {odooData.leads.map((lead, i) => (
                    <div key={i} className="flex items-center justify-between text-sm rounded-md bg-muted/30 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <span className="font-medium truncate">{lead.name}</span>
                        {lead.stage && <Badge variant="outline" className="text-[10px] ml-2">{lead.stage}</Badge>}
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        {lead.expected_revenue > 0 && <span className="font-medium tabular-nums">{formatCurrency(lead.expected_revenue)}</span>}
                        <span className="text-xs text-muted-foreground">{lead.probability}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Related emails ── */}
      {relatedEmails.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-blue-500" />
              <CardTitle className="text-sm">Emails Relacionados</CardTitle>
              <Badge variant="outline" className="text-[10px] ml-auto">{relatedEmails.length}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-1">
            {relatedEmails.map((email) => (
              <Link
                key={email.id}
                href={`/emails/${email.id}`}
                className="flex items-start gap-3 rounded-lg p-2 md:p-2.5 hover:bg-muted/50 transition-colors"
              >
                <Mail className={cn("h-4 w-4 mt-0.5 shrink-0", email.sender_type === "external" ? "text-blue-500" : "text-muted-foreground")} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{email.subject ?? "(sin asunto)"}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {email.sender?.replace(/<[^>]+>/, "").trim()}
                  </p>
                </div>
                <span className="text-[10px] text-muted-foreground shrink-0">{timeAgo(email.email_date)}</span>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ── Knowledge graph facts ── */}
      {relatedFacts.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Brain className="h-4 w-4 text-purple-500" />
              <CardTitle className="text-sm">Knowledge Graph</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {relatedFacts.map((fact) => (
              <div key={fact.id} className="flex items-start gap-2 text-sm">
                <span className="text-muted-foreground/50 mt-0.5 shrink-0">•</span>
                <div className="min-w-0">
                  <p className="break-words">{fact.fact_text}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {fact.fact_type} · {(fact.confidence * 100).toFixed(0)}%
                    {fact.fact_date && ` · ${fact.fact_date}`}
                  </p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ── Related insights ── */}
      {relatedInsights.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-amber-500" />
              <CardTitle className="text-sm">Otros Insights de {company?.name ?? "esta empresa"}</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-1">
            {relatedInsights.map((ri) => (
              <Link
                key={ri.id}
                href={`/inbox/insight/${ri.id}`}
                className="flex items-center gap-3 rounded-lg p-2 md:p-2.5 hover:bg-muted/50 transition-colors"
              >
                <SeverityBadge severity={ri.severity} />
                <span className="text-sm truncate flex-1 min-w-0">{ri.title}</span>
                <span className="text-[10px] text-muted-foreground shrink-0">{timeAgo(ri.created_at)}</span>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ── Ask AI button ── */}
      {company && (
        <Link
          href={`/chat?q=${encodeURIComponent(`Dime más sobre ${company.name} en relación a: ${insight.title}`)}`}
          className="block"
        >
          <Card className="hover:border-primary/20 transition-colors border-dashed">
            <CardContent className="py-3">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
                  <MessageSquare className="h-4 w-4 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium">Preguntar a IA sobre esto</p>
                  <p className="text-xs text-muted-foreground truncate">Chat con Claude sobre {company.name}</p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 ml-auto" />
              </div>
            </CardContent>
          </Card>
        </Link>
      )}

      {/* ── Sticky action bar ── */}
      {!isDone && (
        <div className={cn(
          "fixed bottom-0 left-0 right-0 z-50 bg-background/95 backdrop-blur border-t p-3 md:p-4",
          collapsed ? "md:pl-20" : "md:pl-68"
        )}>
          <div className="max-w-2xl mx-auto flex gap-3">
            <Button
              variant="outline"
              className="flex-1 h-11 text-red-500 border-red-500/30 hover:bg-red-500/10"
              onClick={handleDismiss}
            >
              <ThumbsDown className="h-4 w-4 mr-2" />
              <span className="hidden sm:inline">No util</span>
              <span className="sm:hidden">No</span>
            </Button>
            <Button
              className="flex-1 h-11 bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={handleAct}
              disabled={acting}
            >
              {acting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ThumbsUp className="h-4 w-4 mr-2" />}
              <span className="hidden sm:inline">Util — Actuar</span>
              <span className="sm:hidden">Util</span>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
