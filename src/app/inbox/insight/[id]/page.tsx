"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  ArrowLeft, ChevronLeft, ChevronRight,
  Mail, MessageSquare, ThumbsDown, ThumbsUp,
  Send, FileText, Building2, Users,
  CalendarClock, Check, Loader2, X,
} from "lucide-react";
import type { AgentInsight, Company } from "@/lib/types";
import { supabase } from "@/lib/supabase";
import { cn, timeAgo, formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { ShareWhatsApp } from "./components/share-whatsapp";
import { FollowUpBanner } from "./components/follow-up-banner";
import { AssigneeSelector } from "./components/assignee-selector";

/* ── severity config ── */
const SEV: Record<string, { dot: string; label: string; variant: "critical" | "warning" | "secondary" }> = {
  critical: { dot: "bg-danger", label: "Critico", variant: "critical" },
  high: { dot: "bg-warning", label: "Alto", variant: "warning" },
  medium: { dot: "bg-warning/60", label: "Medio", variant: "secondary" },
  low: { dot: "bg-muted-foreground", label: "Bajo", variant: "secondary" },
};

export default function InsightDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const insightId = parseInt(params.id);

  /* ── state ── */
  const [insight, setInsight] = useState<AgentInsight | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [crossSignals, setCrossSignals] = useState<{ director_name: string; title: string; severity: string }[]>([]);
  const [insightHistory, setInsightHistory] = useState<{ total_insights_30d: number; times_acted: number; times_dismissed: number } | null>(null);
  const [relatedEmails, setRelatedEmails] = useState<{ id: number; subject: string | null; sender: string | null; email_date: string | null; snippet: string | null }[]>([]);
  const [companyContacts, setCompanyContacts] = useState<{ name: string | null; email: string; role: string | null }[]>([]);
  const [actionItems, setActionItems] = useState<{ id: number; description: string; assignee_name: string | null; assignee_email: string | null; priority: string; state: string; due_date: string | null }[]>([]);
  const [navIds, setNavIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [showActions, setShowActions] = useState(false);

  /* ── data loading ── */
  useEffect(() => {
    async function load() {
      setLoading(true);
      setShowActions(false);

      const { data: ins } = await supabase
        .from("agent_insights").select("*").eq("id", insightId).single();
      if (!ins) { setLoading(false); return; }
      setInsight(ins as AgentInsight);

      if (ins.state === "new") {
        supabase.from("agent_insights").update({ state: "seen" }).eq("id", insightId).then(() => {});
      }

      const [navRes, companyRes, crossRes, historyRes, , actionsRes] = await Promise.all([
        supabase.from("agent_insights").select("id").in("state", ["new", "seen"]).gte("confidence", 0.80).order("created_at", { ascending: false }).limit(50),
        ins.company_id ? supabase.from("companies").select("id, name, canonical_name").eq("id", ins.company_id).single() : Promise.resolve({ data: null }),
        ins.company_id ? supabase.from("cross_director_signals").select("director_name, title, severity").eq("company_id", ins.company_id).neq("title", ins.title).limit(5) : Promise.resolve({ data: null }),
        ins.company_id ? supabase.from("company_insight_history").select("total_insights_30d, times_acted, times_dismissed").eq("company_id", ins.company_id).single() : Promise.resolve({ data: null }),
        Promise.resolve({ data: null }),
        ins.company_id
          ? supabase.from("action_items").select("id, description, assignee_name, assignee_email, priority, state, due_date").eq("company_id", ins.company_id).in("state", ["pending", "in_progress"]).order("priority", { ascending: true }).limit(10)
          : Promise.resolve({ data: [] }),
      ]);

      if (navRes.data) setNavIds(navRes.data.map((n: { id: number }) => n.id));
      if (companyRes.data) setCompany(companyRes.data as Company);
      if (crossRes.data) setCrossSignals(crossRes.data as typeof crossSignals);
      if (historyRes.data) setInsightHistory(historyRes.data as typeof insightHistory);
      if (actionsRes.data) setActionItems(actionsRes.data as typeof actionItems);

      if (ins.company_id) {
        const stopwords = new Set(["de","del","la","el","en","sin","por","con","para","los","las","un","una","que","no","se","su","al","es","y","o","a","e","mas","como","esta","esto"]);
        const keywords = (ins.title ?? "").split(/[\s—–\-:,.|()\/\$]+/)
          .map((w: string) => w.replace(/[^a-záéíóúñü0-9]/gi, "").toLowerCase())
          .filter((w: string) => w.length > 3 && !stopwords.has(w) && !/^\d+$/.test(w))
          .slice(0, 3);

        let emails: typeof relatedEmails = [];
        if (keywords.length >= 1) {
          try {
            const { data } = await supabase.from("emails")
              .select("id, subject, sender, email_date, snippet")
              .eq("company_id", ins.company_id)
              .or(`subject.ilike.%${keywords[0]}%,snippet.ilike.%${keywords[0]}%`)
              .order("email_date", { ascending: false }).limit(5);
            emails = data ?? [];
          } catch { emails = []; }
        }
        if (emails.length === 0) {
          const { data } = await supabase.from("emails")
            .select("id, subject, sender, email_date, snippet")
            .eq("company_id", ins.company_id)
            .order("email_date", { ascending: false }).limit(3);
          emails = data ?? [];
        }
        setRelatedEmails(emails as typeof relatedEmails);

        const { data: contacts } = await supabase.from("contacts")
          .select("name, email, role")
          .eq("company_id", ins.company_id)
          .not("email", "is", null).limit(5);
        if (contacts) setCompanyContacts(contacts as typeof companyContacts);
      }

      setLoading(false);
    }
    load();
  }, [insightId]);

  /* ── navigation ── */
  const currentNavIndex = navIds.indexOf(insightId);
  const prevId = currentNavIndex > 0 ? navIds[currentNavIndex - 1] : null;
  const nextId = currentNavIndex < navIds.length - 1 ? navIds[currentNavIndex + 1] : null;

  /* ── actions ── */
  const markDone = useCallback(async (followUpDays?: number) => {
    if (!insight) return;
    setActing(true);
    try {
      await supabase.from("agent_insights").update({ state: "acted_on", was_useful: true }).eq("id", insight.id);
      if (followUpDays) {
        const followUpDate = new Date(Date.now() + followUpDays * 86400_000).toISOString().split("T")[0];
        await supabase.from("insight_follow_ups").insert({
          insight_id: insight.id, company_id: insight.company_id,
          follow_up_date: followUpDate, status: "pending",
        });
      }
      setInsight({ ...insight, state: "acted_on" });
      toast.success("Marcado como util");
      setShowActions(false);
    } finally { setActing(false); }
  }, [insight]);

  const handleDismiss = useCallback(async () => {
    if (!insight) return;
    const { error } = await supabase.from("agent_insights").update({ state: "dismissed", was_useful: false }).eq("id", insight.id);
    if (error) { toast.error("Error: " + error.message); return; }
    toast("Descartado");
    if (nextId) router.push(`/inbox/insight/${nextId}`);
    else router.push("/inbox");
  }, [insight, router, nextId]);

  /* ── keyboard ── */
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

  /* ── loading ── */
  if (loading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Skeleton className="h-5 w-16" />
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-32 w-full rounded-xl" />
      </div>
    );
  }

  if (!insight) {
    return (
      <div className="mx-auto max-w-3xl py-20 text-center">
        <p className="mb-4 text-muted-foreground">Insight no encontrado</p>
        <Button variant="outline" onClick={() => router.push("/inbox")}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Volver al Inbox
        </Button>
      </div>
    );
  }

  const isDone = ["acted_on", "dismissed", "expired"].includes(insight.state ?? "");
  const evidence = Array.isArray(insight.evidence) ? insight.evidence as { text?: string; fact?: string }[] : [];
  const sev = SEV[insight.severity ?? "medium"] ?? SEV.medium;
  const assigneeName = insight.assignee_name ?? "Sin asignar";
  const assigneeEmail = insight.assignee_email ?? "";
  const companyName = company?.name ?? "la empresa";
  const recommendation = insight.recommendation ?? "";
  const impact = insight.business_impact_estimate ? formatCurrency(insight.business_impact_estimate) : null;

  // Email templates
  const assigneeSubject = `Accion requerida: ${(insight.title ?? "").slice(0, 80)}`;
  const assigneeBody = `Hola ${assigneeName.split(" ")[0]},\n\nTe comparto un tema que requiere accion:\n\n${insight.title}\n\nRecomendacion: ${recommendation.slice(0, 300)}${impact ? `\n\nImpacto estimado: ${impact}` : ""}\n\nPor favor confirma que acciones vas a tomar.\n\nSaludos`;
  const mainContact = companyContacts[0];

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 pb-6">

      {/* ── Top nav ── */}
      <nav className="flex items-center justify-between">
        <Button variant="ghost" size="sm" className="-ml-2 gap-1.5 text-muted-foreground" onClick={() => router.push("/inbox")}>
          <ArrowLeft className="h-4 w-4" /> Inbox
        </Button>
        {navIds.length > 1 && (
          <div className="flex items-center gap-1">
            <span className="mr-1 text-xs tabular-nums text-muted-foreground">{currentNavIndex + 1}/{navIds.length}</span>
            <Button size="icon" variant="ghost" className="h-8 w-8" disabled={!prevId} onClick={() => prevId && router.push(`/inbox/insight/${prevId}`)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" className="h-8 w-8" disabled={!nextId} onClick={() => nextId && router.push(`/inbox/insight/${nextId}`)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </nav>

      {/* ── 1. Title + Severity + Meta ── */}
      <div>
        <div className="flex items-start gap-3">
          <span className={cn("mt-2 h-3 w-3 shrink-0 rounded-full", sev.dot)} />
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold leading-tight">{insight.title}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant={sev.variant}>{sev.label}</Badge>
              {insight.category && <Badge variant="secondary">{insight.category}</Badge>}
              {company && (
                <Link href={`/companies/${company.id}`} className="flex items-center gap-1 text-primary hover:underline">
                  <Building2 className="h-3 w-3" /> {company.name}
                </Link>
              )}
              <span>{timeAgo(insight.created_at)}</span>
              <span>{((insight.confidence ?? 0) * 100).toFixed(0)}% confianza</span>
            </div>
          </div>
        </div>
        {insight.description && (
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{insight.description}</p>
        )}
      </div>

      {/* ── 2. Recommendation ── */}
      {recommendation && (
        <Card className="border-primary/20">
          <CardContent className="p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-primary mb-2">Recomendacion</p>
            <p className="text-sm leading-relaxed">{recommendation}</p>
            {impact && (
              <p className="mt-2 text-sm font-semibold">Impacto estimado: {impact}</p>
            )}
            <div className="mt-3 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Responsable: {assigneeName}</span>
              {insight.assignee_name && (
                <AssigneeSelector
                  insightId={insight.id}
                  currentName={insight.assignee_name}
                  currentEmail={assigneeEmail}
                  onChanged={(name, email, dept) => {
                    setInsight({ ...insight, assignee_name: name, assignee_email: email, assignee_department: dept });
                    toast.success(`Reasignado a ${name}`);
                  }}
                />
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── 3. Action buttons OR quick actions ── */}
      {!isDone && !showActions && (
        <div className="grid grid-cols-2 gap-3">
          <Button variant="outline" size="lg" className="h-12" onClick={handleDismiss}>
            <ThumbsDown className="mr-2 h-4 w-4" /> Descartar
          </Button>
          <Button size="lg" className="h-12" onClick={() => setShowActions(true)}>
            <ThumbsUp className="mr-2 h-4 w-4" /> Actuar
          </Button>
        </div>
      )}

      {!isDone && showActions && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-semibold uppercase tracking-wider text-primary">Acciones</p>
              <button onClick={() => setShowActions(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>

            {assigneeEmail && (
              <a
                href={`mailto:${assigneeEmail}?subject=${encodeURIComponent(assigneeSubject)}&body=${encodeURIComponent(assigneeBody)}`}
                className="flex items-center gap-3 rounded-lg border bg-card p-3 transition-colors hover:bg-muted/50"
              >
                <Send className="h-4 w-4 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">Instruir a {assigneeName.split(" ")[0]}</p>
                  <p className="text-xs text-muted-foreground">Abre email con instrucciones pre-llenadas</p>
                </div>
              </a>
            )}

            {mainContact && (
              <a
                href={`mailto:${mainContact.email}?subject=${encodeURIComponent(`Seguimiento — ${companyName}`)}&body=${encodeURIComponent(`Estimado${mainContact.name ? ` ${mainContact.name.split(" ")[0]}` : ""},\n\nLe escribo respecto a un tema pendiente con ${companyName}.\n\nQuedo atento a su respuesta.\n\nSaludos cordiales`)}`}
                className="flex items-center gap-3 rounded-lg border bg-card p-3 transition-colors hover:bg-muted/50"
              >
                <Mail className="h-4 w-4 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">Contactar a {companyName}</p>
                  <p className="text-xs text-muted-foreground">{mainContact.name ?? mainContact.email}</p>
                </div>
              </a>
            )}

            <ShareWhatsApp insight={insight} companyName={company?.name} />

            <Separator />

            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => markDone(3)} disabled={acting}
                className="flex items-center gap-2 rounded-lg border bg-card p-3 text-left transition-colors hover:bg-muted/50">
                <CalendarClock className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Recordatorio 3d</p>
                  <p className="text-[10px] text-muted-foreground">Marca como util + follow-up</p>
                </div>
              </button>
              <button onClick={() => markDone()} disabled={acting}
                className="flex items-center gap-2 rounded-lg border bg-card p-3 text-left transition-colors hover:bg-muted/50">
                {acting ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : <Check className="h-4 w-4 shrink-0 text-success" />}
                <div>
                  <p className="text-sm font-medium">Ya lo resolvi</p>
                  <p className="text-[10px] text-muted-foreground">Marcar como util</p>
                </div>
              </button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Done banner */}
      {isDone && (
        <Card className={cn(
          insight.state === "acted_on" ? "border-success/30 bg-success/10" : "bg-muted",
        )}>
          <CardContent className="py-3 text-center text-sm font-medium">
            {insight.state === "acted_on" ? "Marcado como util" : insight.state === "dismissed" ? "Descartado" : "Expirado"}
          </CardContent>
        </Card>
      )}

      {isDone && <ShareWhatsApp insight={insight} companyName={company?.name} />}
      <FollowUpBanner insightId={insight.id} state={insight.state ?? ""} />

      {/* ── 4. Action items for this company ── */}
      {actionItems.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Acciones pendientes de {companyName}</CardTitle>
          </CardHeader>
          <CardContent className="divide-y p-0">
            {actionItems.map((action) => (
              <div key={action.id} className={cn("flex items-center gap-3 px-4 py-2.5", action.state === "completed" && "opacity-50")}>
                <p className="min-w-0 flex-1 truncate text-sm">{action.description}</p>
                {action.due_date && (
                  <span className={cn("shrink-0 text-[10px] tabular-nums",
                    new Date(action.due_date) < new Date() ? "text-danger font-semibold" : "text-muted-foreground"
                  )}>
                    {new Date(action.due_date).toLocaleDateString("es-MX", { day: "numeric", month: "short" })}
                  </span>
                )}
                {action.assignee_name && action.assignee_email ? (
                  <a href={`mailto:${action.assignee_email}?subject=${encodeURIComponent(`Accion: ${action.description.slice(0, 60)}`)}`}
                    className="inline-flex shrink-0 items-center gap-1 text-xs text-primary hover:underline">
                    <Send className="h-3 w-3" /> {action.assignee_name.split(" ")[0]}
                  </a>
                ) : (
                  <span className="shrink-0 text-xs text-muted-foreground">{action.assignee_name ?? "Sin asignar"}</span>
                )}
                {action.state === "pending" && (
                  <button onClick={async () => {
                    await supabase.from("action_items").update({ state: "completed", completed_at: new Date().toISOString() }).eq("id", action.id);
                    setActionItems(prev => prev.map(a => a.id === action.id ? { ...a, state: "completed" } : a));
                    toast.success("Accion completada");
                  }} className="shrink-0 text-xs font-semibold text-primary hover:underline">
                    ✓
                  </button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ── 5. Evidence ── */}
      {evidence.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              Evidencia
              <Badge variant="secondary" className="text-[10px]">{evidence.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5">
              {evidence.map((e, i) => {
                const text = String(e.text ?? e.fact ?? e);
                return (
                  <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <span className="mt-0.5 shrink-0 text-muted-foreground/50">•</span>
                    <span>{text}</span>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* ── 6. Related emails ── */}
      {relatedEmails.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Mail className="h-4 w-4 text-muted-foreground" />
              Emails relacionados
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {relatedEmails.map((email) => (
              <Link key={email.id} href={`/emails/${email.id}`}
                className="flex items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50">
                <Mail className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate text-sm font-medium">{email.subject ?? "(sin asunto)"}</p>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {email.email_date ? new Date(email.email_date).toLocaleDateString("es-MX", { day: "numeric", month: "short" }) : ""}
                    </span>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {(email.sender ?? "").replace(/<[^>]+>/, "").trim() || "Desconocido"}
                  </p>
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ── 7. Cross-director signals + history ── */}
      {(crossSignals.length > 0 || (insightHistory && insightHistory.total_insights_30d > 1)) && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              Otros directores
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {crossSignals.map((s, i) => (
              <div key={i} className="rounded-lg border p-3 text-sm">
                <span className="font-medium">{s.director_name}</span>
                <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{s.title}</p>
              </div>
            ))}
            {insightHistory && insightHistory.total_insights_30d > 1 && (
              <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                Empresa flaggeada <span className="font-semibold text-foreground">{insightHistory.total_insights_30d} veces</span> en 30 dias
                {insightHistory.times_acted > 0 && <> · CEO actuo {insightHistory.times_acted}x</>}
                {insightHistory.times_dismissed > 0 && <> · descarto {insightHistory.times_dismissed}x</>}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── 8. Company link ── */}
      {company && (
        <div className="flex gap-2">
          <Link href={`/companies/${company.id}`}
            className="flex-1 flex items-center gap-2 rounded-lg border p-3 text-sm transition-colors hover:bg-muted/50">
            <Building2 className="h-4 w-4 text-primary" />
            Ver perfil completo de {company.name}
          </Link>
          <Link href={`/chat?q=${encodeURIComponent(`Como va ${company.name}?`)}`}
            className="flex items-center gap-2 rounded-lg border p-3 text-sm transition-colors hover:bg-muted/50">
            <MessageSquare className="h-4 w-4 text-primary" />
            Chat
          </Link>
        </div>
      )}
    </div>
  );
}
