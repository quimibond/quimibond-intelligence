"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  ArrowLeft, ChevronLeft, ChevronRight,
  Mail, MessageSquare, ThumbsDown, ThumbsUp,
  Send, FileText, Building2, Users,
} from "lucide-react";
import type { AgentInsight, Company } from "@/lib/types";
import { supabase } from "@/lib/supabase";
import { cn, timeAgo } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import { Skeleton } from "@/components/ui/skeleton";
import { CompanyIntelCards } from "@/app/companies/[id]/components/company-intel-cards";
import { QuickActions } from "./components/quick-actions";
import { ShareWhatsApp } from "./components/share-whatsapp";
import { FollowUpBanner } from "./components/follow-up-banner";
import { AssigneeSelector } from "./components/assignee-selector";

/* ── severity helpers ── */
const SEV_DOTS: Record<string, string> = {
  critical: "bg-danger", high: "bg-warning", medium: "bg-warning/60",
};

export default function InsightDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  /* ── state ── */
  const [insight, setInsight] = useState<AgentInsight | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [crossSignals, setCrossSignals] = useState<{ director_name: string; title: string; severity: string }[]>([]);
  const [insightHistory, setInsightHistory] = useState<{ total_insights_30d: number; times_acted: number; times_dismissed: number; which_directors: string } | null>(null);
  const [relatedEmails, setRelatedEmails] = useState<{ id: number; subject: string | null; sender: string | null; email_date: string | null; snippet: string | null }[]>([]);
  const [companyContacts, setCompanyContacts] = useState<{ name: string | null; email: string; role: string | null }[]>([]);
  const [actionItems, setActionItems] = useState<{ id: number; description: string; assignee_name: string | null; assignee_email: string | null; priority: string; state: string; due_date: string | null }[]>([]);
  const [navIds, setNavIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [showActions, setShowActions] = useState(false);

  const insightId = parseInt(params.id);

  /* ── data loading ── */
  useEffect(() => {
    async function load() {
      setLoading(true);

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
        ins.company_id ? supabase.from("company_insight_history").select("total_insights_30d, times_acted, times_dismissed, which_directors").eq("company_id", ins.company_id).single() : Promise.resolve({ data: null }),
        Promise.resolve({ data: null }),
        supabase.from("action_items").select("id, description, assignee_name, assignee_email, priority, state, due_date").eq("alert_id", insightId).order("priority", { ascending: true }),
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
          const topKeyword = keywords[0];
          try {
            const { data } = await supabase.from("emails")
              .select("id, subject, sender, email_date, snippet")
              .eq("company_id", ins.company_id)
              .or(`subject.ilike.%${topKeyword}%,snippet.ilike.%${topKeyword}%`)
              .order("email_date", { ascending: false })
              .limit(5);
            emails = data ?? [];
          } catch {
            emails = [];
          }
        }

        if (emails.length === 0) {
          const { data } = await supabase.from("emails")
            .select("id, subject, sender, email_date, snippet")
            .eq("company_id", ins.company_id)
            .order("email_date", { ascending: false })
            .limit(3);
          emails = data ?? [];
        }

        setRelatedEmails(emails as typeof relatedEmails);

        const { data: contacts } = await supabase
          .from("contacts")
          .select("name, email, role")
          .eq("company_id", ins.company_id)
          .not("email", "is", null)
          .limit(5);
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
  const handleDismiss = useCallback(async () => {
    if (!insight) return;
    const { error } = await supabase.from("agent_insights").update({ state: "dismissed", was_useful: false }).eq("id", insight.id);
    if (error) { toast.error("Error: " + error.message); return; }
    toast("Descartado");
    if (nextId) router.push(`/inbox/insight/${nextId}`);
    else router.push("/inbox");
  }, [insight, router, nextId]);

  /* ── keyboard shortcuts ── */
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

  /* ── loading skeleton ── */
  if (loading) {
    return (
      <div className="mx-auto max-w-xl space-y-4 lg:max-w-5xl">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-5 w-20" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-6 w-3/4" />
          <Skeleton className="h-4 w-full" />
        </div>
        <Skeleton className="h-28 w-full rounded-xl" />
        <div className="flex gap-3">
          <Skeleton className="h-11 flex-1 rounded-lg" />
          <Skeleton className="h-11 flex-1 rounded-lg" />
        </div>
      </div>
    );
  }

  /* ── not found ── */
  if (!insight) {
    return (
      <div className="mx-auto max-w-xl py-20 text-center lg:max-w-5xl">
        <p className="mb-4 text-muted-foreground">Insight no encontrado</p>
        <Button variant="outline" onClick={() => router.push("/inbox")}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Volver al Inbox
        </Button>
      </div>
    );
  }

  /* ── computed ── */
  const isDone = ["acted_on", "dismissed", "expired"].includes(insight.state ?? "");
  const evidence = Array.isArray(insight.evidence) ? insight.evidence as { text?: string; fact?: string }[] : [];
  const sevDot = SEV_DOTS[insight.severity ?? "medium"] ?? "bg-gray-400";
  const sevLabel = insight.severity === "critical" ? "Crítico" : insight.severity === "high" ? "Alto" : "Medio";
  const sevVariant = insight.severity === "critical" ? "critical" as const : insight.severity === "high" ? "warning" as const : "secondary" as const;
  const hasContext = evidence.length > 0 || relatedEmails.length > 0 || !!insight.company_id || crossSignals.length > 0;

  /* ════════════════════════════════════════════════════════════════
     RENDER
     ════════════════════════════════════════════════════════════════ */
  return (
    <div className="mx-auto w-full max-w-xl lg:max-w-5xl">

      {/* Nav (full width) */}
      <nav className="mb-3 flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 gap-1.5 text-muted-foreground"
          onClick={() => router.push("/inbox")}
        >
          <ArrowLeft className="h-4 w-4" />
          Inbox
        </Button>

        {navIds.length > 1 && (
          <div className="flex items-center gap-1">
            <span className="mr-1 text-xs tabular-nums text-muted-foreground">
              {currentNavIndex + 1}/{navIds.length}
            </span>
            <Button size="icon" variant="ghost" className="h-8 w-8" disabled={!prevId}
              onClick={() => prevId && router.push(`/inbox/insight/${prevId}`)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" className="h-8 w-8" disabled={!nextId}
              onClick={() => nextId && router.push(`/inbox/insight/${nextId}`)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </nav>

      {/* Mobile: stacked | Desktop: side-by-side */}
      <div className="lg:grid lg:grid-cols-5 lg:gap-8">

      {/* ═══ PANTALLA 1 — Decisión rápida ═══ */}
      <section className="flex min-h-[calc(100dvh-10rem)] flex-col lg:col-span-3 lg:min-h-0">

        {/* ── Título + severity dot ── */}
        <div className="flex items-start gap-3">
          <span className={cn("mt-2 h-2.5 w-2.5 shrink-0 rounded-full", sevDot)} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg font-bold leading-tight lg:text-xl">{insight.title}</h1>
              <Badge variant={sevVariant} className="text-[10px]">{sevLabel}</Badge>
            </div>
            {insight.description && (
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground lg:text-base">
                {insight.description}
              </p>
            )}
          </div>
        </div>

        {/* ── Acciones compactas (1 línea por acción) ── */}
        <div className="mt-3 flex-1 space-y-2">
          {actionItems.length > 0 ? (
            <Card>
              <CardContent className="divide-y p-0">
                {actionItems.map((action) => (
                  <div
                    key={action.id}
                    className={cn(
                      "flex items-center gap-3 px-4 py-2.5",
                      action.state === "completed" && "opacity-50",
                    )}
                  >
                    <p className="min-w-0 flex-1 truncate text-sm">{action.description}</p>

                    {action.assignee_name && action.assignee_email ? (
                      <a
                        href={`mailto:${action.assignee_email}?subject=${encodeURIComponent(`Acción: ${action.description.slice(0, 60)}`)}&body=${encodeURIComponent(`Hola ${action.assignee_name.split(" ")[0]},\n\n${action.description}\n\nContexto: ${insight.title}\n\nSaludos`)}`}
                        className="inline-flex shrink-0 items-center gap-1 text-xs text-primary hover:underline"
                      >
                        <Send className="h-3 w-3" />
                        {action.assignee_name.split(" ")[0]}
                      </a>
                    ) : (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {action.assignee_name ?? "Sin asignar"}
                      </span>
                    )}

                    {action.state === "pending" && (
                      <button
                        onClick={async () => {
                          await supabase.from("action_items").update({ state: "completed", completed_at: new Date().toISOString() }).eq("id", action.id);
                          setActionItems(prev => prev.map(a => a.id === action.id ? { ...a, state: "completed" } : a));
                          toast.success("Acción completada");
                        }}
                        className="shrink-0 text-xs font-semibold text-primary hover:underline"
                      >
                        ✓ Hecho
                      </button>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : insight.recommendation ? (
            <Card className="border-primary/20 bg-primary/5">
              <CardContent className="px-4 py-3">
                <p className="text-sm leading-relaxed">{insight.recommendation}</p>
                {insight.assignee_name && (
                  <AssigneeSelector
                    insightId={insight.id}
                    currentName={insight.assignee_name}
                    currentEmail={insight.assignee_email ?? ""}
                    onChanged={(name, email, dept) => {
                      setInsight({ ...insight, assignee_name: name, assignee_email: email, assignee_department: dept });
                      toast.success(`Reasignado a ${name}`);
                    }}
                  />
                )}
              </CardContent>
            </Card>
          ) : null}
        </div>

        {/* ── Footer: botones + status + meta ── */}
        <div className="mt-auto space-y-3 pt-4">
          {/* Botones [Descartar] [Actuar] */}
          {!isDone && !showActions && (
            <div className="grid grid-cols-2 gap-3">
              <Button variant="outline" size="lg" className="h-12 w-full lg:h-11" onClick={handleDismiss}>
                <ThumbsDown className="mr-2 h-4 w-4" /> Descartar
              </Button>
              <Button size="lg" className="h-12 w-full lg:h-11" onClick={() => setShowActions(true)}>
                <ThumbsUp className="mr-2 h-4 w-4" /> Actuar
              </Button>
            </div>
          )}

          {/* Quick Actions Panel */}
          {!isDone && showActions && (
            <QuickActions
              insight={insight}
              company={company}
              companyContacts={companyContacts}
              onDone={async (followUpDays?: number) => {
                setActing(true);
                try {
                  await supabase.from("agent_insights").update({ state: "acted_on", was_useful: true }).eq("id", insight.id);
                  if (followUpDays) {
                    const followUpDate = new Date(Date.now() + followUpDays * 86400_000).toISOString().split("T")[0];
                    await supabase.from("insight_follow_ups").insert({
                      insight_id: insight.id,
                      company_id: insight.company_id,
                      follow_up_date: followUpDate,
                      status: "pending",
                    });
                  }
                  setInsight({ ...insight, state: "acted_on" });
                  toast.success("Marcado como útil");
                } finally { setActing(false); }
              }}
              onCancel={() => setShowActions(false)}
              acting={acting}
            />
          )}

          {/* Status banner */}
          {isDone && (
            <Card className={cn(
              insight.state === "acted_on"
                ? "border-success/30 bg-success/10"
                : "bg-muted",
            )}>
              <CardContent className="py-3 text-center text-sm font-medium">
                {insight.state === "acted_on" ? "Marcado como útil" : insight.state === "dismissed" ? "Descartado" : "Expirado"}
              </CardContent>
            </Card>
          )}

          {isDone && <ShareWhatsApp insight={insight} companyName={company?.name} />}

          <FollowUpBanner insightId={insight.id} state={insight.state ?? ""} />

          {/* Meta */}
          <p className="text-center text-[10px] text-muted-foreground/60">
            {timeAgo(insight.created_at)} · {((insight.confidence ?? 0) * 100).toFixed(0)}% confianza
          </p>
        </div>
      </section>

      {/* ═══ PANTALLA 2 — Contexto (scroll / sidebar on desktop) ═══ */}
      {hasContext ? (
        <section className="pb-4 lg:col-span-2">
          <Separator className="my-5 lg:hidden" />

          <Accordion type="multiple" defaultValue={["evidencia"]} className="w-full">

            {/* ── 1. Evidencia ── */}
            {evidence.length > 0 && (
              <AccordionItem value="evidencia">
                <AccordionTrigger className="gap-2">
                  <span className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    Evidencia
                    <Badge variant="secondary" className="text-[10px]">{evidence.length}</Badge>
                  </span>
                </AccordionTrigger>
                <AccordionContent>
                  <EvidenceList evidence={evidence} companyId={insight.company_id} />
                </AccordionContent>
              </AccordionItem>
            )}

            {/* ── 2. Emails relacionados ── */}
            {relatedEmails.length > 0 && (
              <AccordionItem value="emails">
                <AccordionTrigger className="gap-2">
                  <span className="flex items-center gap-2">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                    Emails relacionados
                    <Badge variant="secondary" className="text-[10px]">{relatedEmails.length}</Badge>
                  </span>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-1.5">
                    {relatedEmails.map((email) => {
                      const senderName = (email.sender ?? "").replace(/<[^>]+>/, "").trim() || "Desconocido";
                      const dateStr = email.email_date
                        ? new Date(email.email_date).toLocaleDateString("es-MX", { day: "numeric", month: "short" })
                        : "";
                      return (
                        <Link
                          key={email.id}
                          href={`/emails/${email.id}`}
                          className="flex items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50"
                        >
                          <Mail className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline justify-between gap-2">
                              <p className="truncate text-sm font-medium">{email.subject ?? "(sin asunto)"}</p>
                              <span className="shrink-0 text-[10px] text-muted-foreground">{dateStr}</span>
                            </div>
                            <p className="truncate text-xs text-muted-foreground">{senderName}</p>
                            {email.snippet && (
                              <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground/70">
                                {email.snippet.slice(0, 120)}
                              </p>
                            )}
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                </AccordionContent>
              </AccordionItem>
            )}

            {/* ── 3. Intel de empresa ── */}
            {insight.company_id && (
              <AccordionItem value="intel">
                <AccordionTrigger className="gap-2">
                  <span className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                    {company?.name ?? "Empresa"}
                  </span>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-3">
                    <CompanyIntelCards companyId={insight.company_id} companyName={company?.name ?? ""} />
                    {company && (
                      <Link
                        href={`/chat?q=${encodeURIComponent(`Como va ${company.name}?`)}`}
                        className="flex items-center gap-2 rounded-lg border p-3 text-sm transition-colors hover:bg-muted/50"
                      >
                        <MessageSquare className="h-4 w-4 text-primary" />
                        <span>Preguntar al Chat sobre {company.name}</span>
                      </Link>
                    )}
                  </div>
                </AccordionContent>
              </AccordionItem>
            )}

            {/* ── 4. Otros directores + historial ── */}
            {(crossSignals.length > 0 || (insightHistory && insightHistory.total_insights_30d > 1)) && (
              <AccordionItem value="directores">
                <AccordionTrigger className="gap-2">
                  <span className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    Otros directores e historial
                  </span>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-3">
                    {crossSignals.length > 0 && (
                      <div className="space-y-1.5">
                        {crossSignals.map((s, i) => (
                          <div key={i} className="rounded-lg border p-3 text-sm">
                            <span className="font-medium">{s.director_name}</span>
                            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{s.title}</p>
                          </div>
                        ))}
                      </div>
                    )}
                    {insightHistory && insightHistory.total_insights_30d > 1 && (
                      <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                        Empresa flaggeada{" "}
                        <span className="font-semibold text-foreground">
                          {insightHistory.total_insights_30d} veces
                        </span>{" "}
                        en 30 días
                        {insightHistory.times_acted > 0 && <> · CEO actuó {insightHistory.times_acted}x</>}
                        {insightHistory.times_dismissed > 0 && <> · descartó {insightHistory.times_dismissed}x</>}
                      </div>
                    )}
                  </div>
                </AccordionContent>
              </AccordionItem>
            )}
          </Accordion>
        </section>
      ) : null}

      </div>{/* /lg:grid */}
    </div>
  );
}

/* ── Evidence bullets (with highlighted links) ── */
function EvidenceList({ evidence, companyId }: {
  evidence: { text?: string; fact?: string }[];
  companyId: number | null;
}) {
  return (
    <ul className="space-y-1.5">
      {evidence.slice(0, 5).map((e, i) => {
        const text = String(e.text ?? e.fact ?? e);
        const highlighted = text
          .replace(/(\$[\d,.]+[KkMm]?\s*(?:MXN|USD|mxn|usd)?)/g, '<strong>$1</strong>')
          .replace(/((?:INV|FACTU)\/[\w\/\-]+)/g, companyId
            ? `<a href="/companies/${companyId}?tab=finanzas" class="text-primary underline">$1</a>`
            : '<code>$1</code>')
          .replace(/((?:OC|PO)\-?[\w\-]+)/g, companyId
            ? `<a href="/companies/${companyId}?tab=finanzas" class="text-primary underline">$1</a>`
            : '<code>$1</code>')
          .replace(/((?:PV|SO)[\w\/\-]+)/g, companyId
            ? `<a href="/companies/${companyId}?tab=finanzas" class="text-primary underline">$1</a>`
            : '<code>$1</code>')
          .replace(/((?:TL\/OUT|TL\/IN)\/[\w\/]+)/g, companyId
            ? `<a href="/companies/${companyId}?tab=operaciones" class="text-primary underline">$1</a>`
            : '<code>$1</code>')
          .replace(/((?:WM|WP|WN|ZN|XJ|HP|PET|K\d)\w{3,})/g,
            '<a href="/companies/' + (companyId ?? '') + '?tab=operaciones" class="text-primary underline">$1</a>')
          .replace(/(\d+\s*(?:dias?|days?|hrs?|horas?))/gi, '<em>$1</em>');

        return (
          <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
            <span className="mt-0.5 shrink-0 text-muted-foreground/50">•</span>
            <span
              dangerouslySetInnerHTML={{ __html: highlighted }}
              className="[&>a]:rounded [&>a]:bg-primary/10 [&>a]:px-1 [&>a]:py-0.5 [&>a]:text-xs [&>a]:font-medium [&>a]:no-underline [&>code]:rounded [&>code]:bg-primary/10 [&>code]:px-1 [&>code]:text-xs [&>code]:text-primary [&>em]:text-foreground [&>strong]:font-semibold [&>strong]:text-foreground"
            />
          </li>
        );
      })}
    </ul>
  );
}
