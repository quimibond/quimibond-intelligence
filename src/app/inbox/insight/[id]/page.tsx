"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  ArrowLeft, Bot, Brain, Building2, Calendar, CheckCircle2,
  ChevronRight, Clock, DollarSign, ExternalLink, Lightbulb,
  Loader2, Mail, MessageSquare, Shield, ThumbsDown, ThumbsUp,
  TrendingUp, Truck, User, UserCheck, Users, XCircle, Zap,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn, formatCurrency, timeAgo } from "@/lib/utils";
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

export default function InsightDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [insight, setInsight] = useState<R | null>(null);
  const [agent, setAgent] = useState<R | null>(null);
  const [company, setCompany] = useState<R | null>(null);
  const [contact, setContact] = useState<R | null>(null);
  const [relatedEmails, setRelatedEmails] = useState<R[]>([]);
  const [relatedFacts, setRelatedFacts] = useState<R[]>([]);
  const [analysisContext, setAnalysisContext] = useState<R | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);

  const insightId = parseInt(params.id);

  useEffect(() => {
    async function load() {
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
        await supabase.from("agent_insights").update({ state: "seen" }).eq("id", insightId);
      }

      // Load related data in parallel
      const [agentRes, companyRes, contactRes] = await Promise.all([
        supabase.from("ai_agents").select("*").eq("id", ins.agent_id).single(),
        ins.company_id
          ? supabase.from("companies").select("id, name, canonical_name, lifetime_value, is_customer, is_supplier, total_pending, delivery_otd_rate").eq("id", ins.company_id).single()
          : Promise.resolve({ data: null }),
        ins.contact_id
          ? supabase.from("contacts").select("id, name, email, role, current_health_score, risk_level, sentiment_score, last_activity, company_id").eq("id", ins.contact_id).single()
          : Promise.resolve({ data: null }),
      ]);

      if (agentRes.data) setAgent(agentRes.data);
      const companyData = companyRes.data;
      if (companyData) setCompany(companyData);
      const contactData = contactRes.data;
      if (contactData) setContact(contactData);

      // ── TRACEABILITY: Find related emails ──
      // Strategy 1: Search by company name or contact info
      const searchTerms: string[] = [];
      if (companyData) searchTerms.push(companyData.name ?? companyData.canonical_name);
      if (contactData) searchTerms.push(contactData.name ?? contactData.email);

      // Also extract potential company names from the title
      const titleWords = ins.title.split(/\s+/).filter((w: string) => w.length > 4 && w[0] === w[0].toUpperCase());
      searchTerms.push(...titleWords.slice(0, 2));

      let emailsFound = false;

      if (searchTerms.length > 0) {
        const searchQuery = searchTerms[0];
        const { data: emails } = await supabase
          .from("emails")
          .select("id, sender, recipient, subject, email_date, snippet, sender_type")
          .or(`subject.ilike.%${searchQuery}%,body.ilike.%${searchQuery}%,sender.ilike.%${searchQuery}%`)
          .order("email_date", { ascending: false })
          .limit(5);
        if (emails?.length) {
          setRelatedEmails(emails);
          emailsFound = true;
        }
      }

      // Strategy 2: by company_id
      if (!emailsFound && ins.company_id) {
        const { data: emails } = await supabase
          .from("emails")
          .select("id, sender, recipient, subject, email_date, snippet, sender_type")
          .eq("company_id", ins.company_id)
          .order("email_date", { ascending: false })
          .limit(5);
        if (emails?.length) setRelatedEmails(emails);
      }

      // Load analysis context and facts in parallel
      const [analysisRes, factsRes] = await Promise.all([
        supabase
          .from("pipeline_logs")
          .select("details, created_at")
          .eq("phase", "account_analysis")
          .order("created_at", { ascending: false })
          .limit(20),
        ins.company_id
          ? supabase.from("companies").select("entity_id").eq("id", ins.company_id).single()
          : Promise.resolve({ data: null }),
      ]);

      if (analysisRes.data?.length) {
        const insightDate = new Date(ins.created_at);
        const relevant = analysisRes.data.find(log => {
          const logDate = new Date(log.created_at);
          const hoursDiff = Math.abs(insightDate.getTime() - logDate.getTime()) / 3600000;
          return hoursDiff < 24;
        });
        if (relevant) setAnalysisContext(relevant.details as R);
      }

      if (factsRes.data?.entity_id) {
        const { data: facts } = await supabase
          .from("facts")
          .select("id, fact_type, fact_text, confidence, fact_date")
          .eq("entity_id", factsRes.data.entity_id)
          .order("created_at", { ascending: false })
          .limit(5);
        if (facts?.length) setRelatedFacts(facts);
      }

      setLoading(false);
    }
    load();
  }, [insightId]);

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
    router.push("/inbox");
  }, [insight, router]);

  // ── Keyboard shortcuts ──
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "Escape") router.push("/inbox");
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [router]);

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto space-y-4 p-4 md:p-0">
        <Skeleton className="h-5 w-16" />
        <Card>
          <CardContent className="pt-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Skeleton className="h-5 w-5 rounded-full" />
                <Skeleton className="h-4 w-32" />
              </div>
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
            <Skeleton className="h-7 w-3/4" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-2 w-40" />
            <Skeleton className="h-20 w-full rounded-lg" />
          </CardContent>
        </Card>
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
        <p className="text-sm text-muted-foreground mt-1">Puede que haya expirado o sido resuelto automaticamente</p>
        <Button variant="ghost" onClick={() => router.push("/inbox")} className="mt-4">
          <ArrowLeft className="h-4 w-4 mr-2" /> Volver al Inbox
        </Button>
      </div>
    );
  }

  const isDone = ["acted_on", "dismissed", "expired"].includes(insight.state);
  const AgentIcon = DOMAIN_ICONS[agent?.domain ?? ""] ?? Bot;

  return (
    <div className="max-w-2xl mx-auto space-y-4 p-4 md:p-0 pb-24">
      {/* Back */}
      <button onClick={() => router.push("/inbox")} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground py-2 group">
        <ArrowLeft className="h-4 w-4 group-hover:-translate-x-0.5 transition-transform" /> Inbox
      </button>

      {/* ── Main insight card ── */}
      <Card className={cn(isDone && "opacity-60")}>
        <CardContent className="pt-5 space-y-4">
          {/* Agent header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AgentIcon className={cn("h-5 w-5", DOMAIN_COLORS[agent?.domain ?? ""])} />
              <span className="text-sm font-medium">{agent?.name ?? "Agente"}</span>
            </div>
            <div className="flex items-center gap-2">
              {isDone && (
                <Badge variant="success" className="gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  {insight.state === "acted_on" ? "Actuado" : insight.state === "dismissed" ? "Descartado" : "Expirado"}
                </Badge>
              )}
              {!isDone && <Badge variant="secondary">Pendiente</Badge>}
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
          <h1 className="text-xl font-bold leading-tight">{insight.title}</h1>

          {/* Description */}
          <p className="text-sm text-muted-foreground leading-relaxed">{insight.description}</p>

          {/* Confidence */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">Confianza</span>
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
            <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/20 p-4">
              <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 mb-1 flex items-center gap-1">
                <Lightbulb className="h-3.5 w-3.5" /> Accion recomendada
              </p>
              <p className="text-sm font-medium">{insight.recommendation}</p>
            </div>
          )}

          {/* Assignee */}
          {insight.assignee_name && (
            <div className="flex items-center gap-2 rounded-lg bg-muted/50 p-3">
              <UserCheck className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-xs text-muted-foreground">Responsable asignado</p>
                <p className="text-sm font-medium">
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
            <div className="space-y-1">
              <p className="text-xs font-semibold text-muted-foreground">Evidencia:</p>
              <ul className="space-y-1">
                {(insight.evidence as string[]).map((e, i) => (
                  <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                    <span className="text-muted-foreground/50 mt-1">•</span>
                    <span>{typeof e === "string" ? e : JSON.stringify(e)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Meta */}
          <div className="flex items-center gap-4 text-xs text-muted-foreground pt-2 border-t">
            <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{timeAgo(insight.created_at)}</span>
            {insight.category && <span>Categoria: {insight.category}</span>}
          </div>
        </CardContent>
      </Card>

      {/* ── Company card ── */}
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
                      {company.lifetime_value > 0 && <span>{formatCurrency(company.lifetime_value)} lifetime</span>}
                      {company.total_pending > 0 && <span className="text-red-500">{formatCurrency(company.total_pending)} pendiente</span>}
                    </div>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
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
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold",
                    contact.risk_level === "high" || contact.risk_level === "critical" ? "bg-red-500/15 text-red-600" : "bg-muted text-muted-foreground"
                  )}>
                    {contact.name?.charAt(0) ?? "?"}
                  </div>
                  <div>
                    <p className="font-medium text-sm">{contact.name ?? contact.email}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {contact.role && <span>{contact.role}</span>}
                      {contact.current_health_score != null && (
                        <span className={cn(
                          "font-medium",
                          contact.current_health_score >= 60 ? "text-emerald-500" : contact.current_health_score >= 40 ? "text-amber-500" : "text-red-500"
                        )}>
                          Score: {contact.current_health_score}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
        </Link>
      )}

      {/* ── Analysis context ── */}
      {analysisContext && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Brain className="h-4 w-4 text-purple-500" />
              <CardTitle className="text-sm">Contexto del Analisis</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {analysisContext.summary_text && (
              <p className="text-muted-foreground">{analysisContext.summary_text}</p>
            )}
            {analysisContext.sentiment && (
              <p className="text-xs">Sentimiento: <span className="font-medium">{analysisContext.sentiment}</span></p>
            )}
            {analysisContext.topics?.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {(analysisContext.topics as R[]).map((t: R, i: number) => (
                  <Badge key={i} variant="outline" className="text-[10px]">{t.topic ?? t}</Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Related emails (TRACEABILITY) ── */}
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
                className="flex items-start gap-3 rounded-lg p-2.5 hover:bg-muted/50 transition-colors"
              >
                <Mail className={cn("h-4 w-4 mt-0.5 shrink-0", email.sender_type === "external" ? "text-blue-500" : "text-muted-foreground")} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{email.subject ?? "(sin asunto)"}</p>
                  <p className="text-xs text-muted-foreground">
                    {email.sender_type === "external" ? "De" : "Para"}: {email.sender?.replace(/<[^>]+>/, "").trim()}
                  </p>
                  {email.snippet && <p className="text-xs text-muted-foreground truncate mt-0.5">{email.snippet}</p>}
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[10px] text-muted-foreground">{timeAgo(email.email_date)}</p>
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ── Knowledge Graph facts ── */}
      {relatedFacts.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-amber-500" />
              <CardTitle className="text-sm">Hechos del Knowledge Graph</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {relatedFacts.map((fact) => (
              <div key={fact.id} className="flex items-start gap-2 text-sm">
                <span className="text-muted-foreground/50 mt-1">•</span>
                <div>
                  <p>{fact.fact_text}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {fact.fact_type} · {(fact.confidence * 100).toFixed(0)}% confianza
                    {fact.fact_date && ` · ${fact.fact_date}`}
                  </p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ── Sticky action bar ── */}
      {!isDone && (
        <div className="fixed bottom-0 left-0 right-0 z-50 bg-background/95 backdrop-blur border-t p-4">
          <div className="max-w-2xl mx-auto flex gap-3">
            <Button
              variant="outline"
              className="flex-1 text-red-500 border-red-500/30 hover:bg-red-500/10"
              onClick={handleDismiss}
            >
              <ThumbsDown className="h-4 w-4 mr-2" />
              No util
            </Button>
            <Button
              className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={handleAct}
              disabled={acting}
            >
              {acting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ThumbsUp className="h-4 w-4 mr-2" />}
              Util — Actuar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
