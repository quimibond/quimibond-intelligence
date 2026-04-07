"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  ArrowLeft, ChevronLeft, ChevronRight, Loader2,
  Mail, MessageSquare, Share2, ThumbsDown, ThumbsUp,
  Send, Clock, Check, CalendarClock, UserCheck,
} from "lucide-react";
import type { AgentInsight, Company } from "@/lib/types";
import { supabase } from "@/lib/supabase";
import { cn, timeAgo } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CompanyIntelCards } from "@/app/companies/[id]/components/company-intel-cards";

const SEV_DOTS: Record<string, string> = {
  critical: "bg-danger", high: "bg-warning", medium: "bg-warning/60",
};

export default function InsightDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [insight, setInsight] = useState<AgentInsight | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [crossSignals, setCrossSignals] = useState<{ director_name: string; title: string; severity: string }[]>([]);
  const [insightHistory, setInsightHistory] = useState<{ total_insights_30d: number; times_acted: number; times_dismissed: number; which_directors: string } | null>(null);
  const [relatedEmails, setRelatedEmails] = useState<{ id: number; subject: string | null; sender: string | null; email_date: string | null; snippet: string | null }[]>([]);
  const [companyContacts, setCompanyContacts] = useState<{ name: string | null; email: string; role: string | null }[]>([]);
  const [navIds, setNavIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [showActions, setShowActions] = useState(false);

  const insightId = parseInt(params.id);

  useEffect(() => {
    async function load() {
      setLoading(true);

      const { data: ins } = await supabase
        .from("agent_insights").select("*").eq("id", insightId).single();
      if (!ins) { setLoading(false); return; }
      setInsight(ins as AgentInsight);

      // Mark as seen
      if (ins.state === "new") {
        supabase.from("agent_insights").update({ state: "seen" }).eq("id", insightId).then(() => {});
      }

      // Load all context in parallel
      const [navRes, companyRes, crossRes, historyRes, emailsRes] = await Promise.all([
        supabase.from("agent_insights").select("id").in("state", ["new", "seen"]).gte("confidence", 0.80).order("created_at", { ascending: false }).limit(50),
        ins.company_id ? supabase.from("companies").select("id, name, canonical_name").eq("id", ins.company_id).single() : Promise.resolve({ data: null }),
        ins.company_id ? supabase.from("cross_director_signals").select("director_name, title, severity").eq("company_id", ins.company_id).neq("title", ins.title).limit(5) : Promise.resolve({ data: null }),
        ins.company_id ? supabase.from("company_insight_history").select("total_insights_30d, times_acted, times_dismissed, which_directors").eq("company_id", ins.company_id).single() : Promise.resolve({ data: null }),
        Promise.resolve({ data: null }), // emails loaded separately below
      ]);

      if (navRes.data) setNavIds(navRes.data.map((n: { id: number }) => n.id));
      if (companyRes.data) setCompany(companyRes.data as Company);
      if (crossRes.data) setCrossSignals(crossRes.data as typeof crossSignals);
      if (historyRes.data) setInsightHistory(historyRes.data as typeof insightHistory);

      // Smart email search: find emails related to this insight
      if (ins.company_id) {
        const stopwords = new Set(["de","del","la","el","en","sin","por","con","para","los","las","un","una","que","no","se","su","al","es","y","o","a","e","mas","como","esta","esto"]);
        const keywords = (ins.title ?? "").split(/[\s—–\-:,.|()\/\$]+/)
          .map((w: string) => w.replace(/[^a-záéíóúñü0-9]/gi, "").toLowerCase())
          .filter((w: string) => w.length > 3 && !stopwords.has(w) && !/^\d+$/.test(w))
          .slice(0, 3);

        let emails: typeof relatedEmails = [];

        // Try keyword search: use textSearch on subject if we have good keywords
        if (keywords.length >= 1) {
          // Search each keyword individually, intersect results
          const topKeyword = keywords[0]; // most distinctive word (usually company name)
          try {
            const { data } = await supabase.from("emails")
              .select("id, subject, sender, email_date, snippet")
              .eq("company_id", ins.company_id)
              .or(`subject.ilike.%${topKeyword}%,snippet.ilike.%${topKeyword}%`)
              .order("email_date", { ascending: false })
              .limit(5);
            emails = data ?? [];
          } catch {
            // Fallback on any query error
            emails = [];
          }
        }

        // Fallback: most recent from company
        if (emails.length === 0) {
          const { data } = await supabase.from("emails")
            .select("id, subject, sender, email_date, snippet")
            .eq("company_id", ins.company_id)
            .order("email_date", { ascending: false })
            .limit(3);
          emails = data ?? [];
        }

        setRelatedEmails(emails as typeof relatedEmails);

        // Load company contacts for action panel
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

  // Navigation
  const currentNavIndex = navIds.indexOf(insightId);
  const prevId = currentNavIndex > 0 ? navIds[currentNavIndex - 1] : null;
  const nextId = currentNavIndex < navIds.length - 1 ? navIds[currentNavIndex + 1] : null;

  // Actions
  const handleAct = useCallback(async () => {
    if (!insight) return;
    setActing(true);
    try {
      const { error } = await supabase.from("agent_insights").update({ state: "acted_on", was_useful: true }).eq("id", insight.id);
      if (error) { toast.error("Error: " + error.message); return; }
      setInsight({ ...insight, state: "acted_on" });
      toast.success("Marcado como util");
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

  // Loading
  if (loading) {
    return (
      <div className="max-w-xl mx-auto space-y-4 pt-2">
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (!insight) {
    return (
      <div className="max-w-xl mx-auto text-center py-20">
        <p className="text-muted-foreground mb-4">Insight no encontrado</p>
        <Button variant="outline" onClick={() => router.push("/inbox")}>Volver al Inbox</Button>
      </div>
    );
  }

  const isDone = ["acted_on", "dismissed", "expired"].includes(insight.state ?? "");
  const evidence = Array.isArray(insight.evidence) ? insight.evidence as { text?: string; fact?: string }[] : [];
  const sevDot = SEV_DOTS[insight.severity ?? "medium"] ?? "bg-gray-400";

  return (
    <div className="max-w-xl mx-auto space-y-4 pb-24 md:pb-8">
      {/* ── Nav bar ── */}
      <div className="flex items-center justify-between">
        <button onClick={() => router.push("/inbox")} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Inbox
        </button>
        {navIds.length > 1 && (
          <div className="flex items-center gap-1">
            <span className="text-[11px] text-muted-foreground mr-1">{currentNavIndex + 1}/{navIds.length}</span>
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
      </div>

      {/* ── Title ── */}
      <div className="flex items-start gap-2.5">
        <div className={cn("h-2.5 w-2.5 rounded-full mt-2 shrink-0", sevDot)} />
        <h1 className="text-lg font-black leading-snug">{insight.title}</h1>
      </div>

      {/* ── Recommendation (the most important thing) ── */}
      {insight.recommendation && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-4">
            <p className="text-sm font-medium leading-relaxed">{insight.recommendation}</p>
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
      )}

      {/* ── Evidence bullets ── */}
      {evidence.length > 0 && (
        <div className="space-y-1 px-1">
          <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium">Evidencia</p>
          <ul className="space-y-1">
            {evidence.slice(0, 4).map((e, i) => (
              <li key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                <span className="text-muted-foreground/50 mt-0.5">•</span>
                {String(e.text ?? e.fact ?? e)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Description (if no recommendation) ── */}
      {!insight.recommendation && insight.description && (
        <p className="text-sm text-muted-foreground leading-relaxed">{insight.description}</p>
      )}

      {/* ── Actions ── */}
      {!isDone && !showActions && (
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1 h-11" onClick={handleDismiss}>
            <ThumbsDown className="h-4 w-4 mr-2" /> Descartar
          </Button>
          <Button className="flex-1 h-11" onClick={() => setShowActions(true)}>
            <ThumbsUp className="h-4 w-4 mr-2" /> Actuar
          </Button>
        </div>
      )}

      {/* ── Action Panel (appears after tapping Actuar) ── */}
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

      {isDone && (
        <div className={cn(
          "rounded-xl px-4 py-2.5 text-sm font-medium text-center",
          insight.state === "acted_on" ? "bg-success/10 text-success-foreground" : "bg-muted text-muted-foreground"
        )}>
          {insight.state === "acted_on" ? "Marcado como util" : insight.state === "dismissed" ? "Descartado" : "Expirado"}
        </div>
      )}

      {/* ── Share (always visible) ── */}
      {isDone && <ShareWhatsApp insight={insight} companyName={company?.name} />}

      {/* ── Follow-up banner ── */}
      <FollowUpBanner insightId={insight.id} state={insight.state ?? ""} />

      {/* ── Company Intel Cards (payment, reorder, risk) ── */}
      {insight.company_id && (
        <div className="space-y-2">
          <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium px-1">
            {company?.name ?? "Empresa"}
          </p>
          <CompanyIntelCards companyId={insight.company_id} companyName={company?.name ?? ""} />
        </div>
      )}

      {/* ── Related emails ── */}
      {relatedEmails.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium px-1">
            Emails recientes{company?.name ? ` — ${company.name}` : ""}
          </p>
          <div className="space-y-1.5">
            {relatedEmails.map((email) => {
              const senderName = (email.sender ?? "").replace(/<[^>]+>/, "").trim() || "Desconocido";
              const dateStr = email.email_date ? new Date(email.email_date).toLocaleDateString("es-MX", { day: "numeric", month: "short" }) : "";
              return (
                <Link
                  key={email.id}
                  href={`/emails/${email.id}`}
                  className="flex items-start gap-3 rounded-xl border p-3 hover:bg-muted/50 transition-colors"
                >
                  <Mail className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-sm font-medium truncate">{email.subject ?? "(sin asunto)"}</p>
                      <span className="text-[10px] text-muted-foreground shrink-0">{dateStr}</span>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{senderName}</p>
                    {email.snippet && (
                      <p className="text-xs text-muted-foreground/70 line-clamp-1 mt-0.5">{email.snippet.slice(0, 120)}</p>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Cross-director signals ── */}
      {crossSignals.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-medium px-1">Otros directores</p>
          <div className="space-y-1.5">
            {crossSignals.map((s, i) => (
              <div key={i} className="rounded-xl border p-3 text-sm">
                <span className="font-medium">{s.director_name}</span>
                <p className="text-muted-foreground text-xs mt-0.5 line-clamp-2">{s.title}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Insight history for this company ── */}
      {insightHistory && insightHistory.total_insights_30d > 1 && (
        <div className="rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">
          Empresa flaggeada <span className="font-semibold text-foreground">{insightHistory.total_insights_30d} veces</span> en 30 días
          {insightHistory.times_acted > 0 && <> · CEO actuó {insightHistory.times_acted}x</>}
          {insightHistory.times_dismissed > 0 && <> · descartó {insightHistory.times_dismissed}x</>}
        </div>
      )}

      {/* ── Ask AI ── */}
      {company && (
        <Link
          href={`/chat?q=${encodeURIComponent(`Como va ${company.name}?`)}`}
          className="flex items-center gap-2 rounded-xl border p-3 text-sm hover:bg-muted/50 transition-colors"
        >
          <MessageSquare className="h-4 w-4 text-primary" />
          <span>Preguntar al Chat sobre {company.name}</span>
        </Link>
      )}

      {/* ── Meta ── */}
      <p className="text-[10px] text-muted-foreground/50 text-center">
        {timeAgo(insight.created_at)} · {((insight.confidence ?? 0) * 100).toFixed(0)}% confianza
      </p>
    </div>
  );
}

// ── Assignee Selector ──
function AssigneeSelector({ insightId, currentName, currentEmail, onChanged }: {
  insightId: number;
  currentName: string;
  currentEmail: string;
  onChanged: (name: string, email: string, dept: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [users, setUsers] = useState<{ name: string; email: string; department: string | null }[]>([]);

  const loadUsers = useCallback(async () => {
    if (users.length > 0) { setOpen(!open); return; }
    const { data } = await supabase
      .from("odoo_users")
      .select("name, email, department")
      .not("email", "is", null)
      .order("name")
      .limit(50);
    setUsers((data ?? []) as typeof users);
    setOpen(true);
  }, [users, open]);

  const assign = useCallback(async (user: { name: string; email: string; department: string | null }) => {
    await supabase.from("agent_insights").update({
      assignee_name: user.name,
      assignee_email: user.email,
      assignee_department: user.department ?? "",
    }).eq("id", insightId);
    onChanged(user.name, user.email, user.department ?? "");
    setOpen(false);
  }, [insightId, onChanged]);

  return (
    <div className="mt-2">
      <button
        onClick={loadUsers}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
      >
        <UserCheck className="h-3 w-3" />
        <span>→ {currentName}</span>
        <span className="text-[10px] opacity-50">(cambiar)</span>
      </button>

      {open && (
        <div className="mt-2 max-h-48 overflow-y-auto rounded-xl border bg-background shadow-lg">
          {users.map((u) => (
            <button
              key={u.email}
              onClick={() => assign(u)}
              className={cn(
                "flex items-center justify-between w-full px-3 py-2 text-left text-sm hover:bg-muted/50 transition-colors",
                u.email === currentEmail && "bg-primary/10 font-medium"
              )}
            >
              <span className="truncate">{u.name}</span>
              <span className="text-[10px] text-muted-foreground shrink-0 ml-2">{u.department ?? ""}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Quick Actions Panel ──
function QuickActions({ insight, company, companyContacts, onDone, onCancel, acting }: {
  insight: AgentInsight;
  company: Company | null;
  companyContacts: { name: string | null; email: string; role: string | null }[];
  onDone: (followUpDays?: number) => void;
  onCancel: () => void;
  acting: boolean;
}) {
  const assigneeEmail = insight.assignee_email ?? "";
  const assigneeName = insight.assignee_name ?? "Responsable";
  const companyName = company?.name ?? "la empresa";
  const title = insight.title ?? "";
  const recommendation = insight.recommendation ?? "";
  const impact = insight.business_impact_estimate
    ? `$${Number(insight.business_impact_estimate).toLocaleString()} MXN`
    : "";

  // Build email to assignee (internal instruction)
  const assigneeSubject = `Acción requerida: ${title.slice(0, 80)}`;
  const assigneeBody = [
    `Hola ${assigneeName.split(" ")[0]},`,
    "",
    `Te comparto un tema que requiere acción inmediata:`,
    "",
    `📌 ${title}`,
    "",
    `Recomendación: ${recommendation.slice(0, 300)}`,
    impact ? `\nImpacto estimado: ${impact}` : "",
    "",
    "Por favor confirma que acciones vas a tomar y en qué plazo.",
    "",
    "Saludos",
  ].filter(Boolean).join("\n");

  // Build email to company contact (external)
  const mainContact = companyContacts[0];
  const contactSubject = `Seguimiento — ${companyName}`;
  const contactBody = [
    `Estimado${mainContact?.name ? ` ${mainContact.name.split(" ")[0]}` : ""},`,
    "",
    `Le escribo respecto a un tema pendiente con ${companyName}.`,
    "",
    recommendation.includes("pago") || recommendation.includes("cobr")
      ? `Nos gustaría confirmar el estatus de los pagos pendientes y acordar una fecha de regularización.`
      : recommendation.includes("entrega") || recommendation.includes("envío")
        ? `Queremos confirmar las fechas de entrega pendientes y asegurar que todo esté en orden.`
        : `Nos gustaría agendar una llamada para dar seguimiento a temas pendientes.`,
    "",
    "Quedo atento a su respuesta.",
    "",
    "Saludos cordiales",
  ].join("\n");

  return (
    <div className="space-y-2 rounded-2xl border-2 border-primary/20 bg-primary/5 p-4">
      <p className="text-xs font-semibold text-primary uppercase tracking-wider">¿Qué acción tomar?</p>

      {/* Email to assignee */}
      {assigneeEmail && (
        <a
          href={`mailto:${assigneeEmail}?subject=${encodeURIComponent(assigneeSubject)}&body=${encodeURIComponent(assigneeBody)}`}
          onClick={() => onDone(3)}
          className="flex items-center gap-3 rounded-xl border p-3 hover:bg-background transition-colors"
        >
          <Send className="h-4 w-4 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">Instruir a {assigneeName.split(" ")[0]}</p>
            <p className="text-xs text-muted-foreground truncate">Email con instrucciones + recordatorio 3 días</p>
          </div>
        </a>
      )}

      {/* Email to company contact */}
      {mainContact && (
        <a
          href={`mailto:${mainContact.email}?subject=${encodeURIComponent(contactSubject)}&body=${encodeURIComponent(contactBody)}`}
          onClick={() => onDone(5)}
          className="flex items-center gap-3 rounded-xl border p-3 hover:bg-background transition-colors"
        >
          <Mail className="h-4 w-4 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">Contactar a {companyName}</p>
            <p className="text-xs text-muted-foreground truncate">
              {mainContact.name ?? mainContact.email} + recordatorio 5 días
            </p>
          </div>
        </a>
      )}

      {/* WhatsApp share */}
      <ShareWhatsApp insight={insight} companyName={company?.name} />

      {/* Follow-up reminder only */}
      <button
        onClick={() => onDone(3)}
        className="flex items-center gap-3 w-full rounded-xl border p-3 hover:bg-background transition-colors text-left"
      >
        <CalendarClock className="h-4 w-4 text-muted-foreground shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">Recordatorio en 3 días</p>
          <p className="text-xs text-muted-foreground">El sistema verifica si se resolvió</p>
        </div>
      </button>

      {/* Just mark as done */}
      <button
        onClick={() => onDone()}
        disabled={acting}
        className="flex items-center gap-3 w-full rounded-xl border p-3 hover:bg-background transition-colors text-left"
      >
        {acting ? <Loader2 className="h-4 w-4 animate-spin shrink-0" /> : <Check className="h-4 w-4 text-muted-foreground shrink-0" />}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">Ya lo resolví</p>
          <p className="text-xs text-muted-foreground">Solo marcar como útil</p>
        </div>
      </button>

      {/* Cancel */}
      <button
        onClick={onCancel}
        className="w-full text-center text-xs text-muted-foreground py-1 hover:text-foreground transition-colors"
      >
        Cancelar
      </button>
    </div>
  );
}

// ── Share via WhatsApp ──
function ShareWhatsApp({ insight, companyName }: { insight: AgentInsight; companyName?: string | null }) {
  const handleShare = useCallback(() => {
    const sevIcon = insight.severity === "critical" ? "🔴" : insight.severity === "high" ? "🟠" : "🟡";
    const lines: string[] = [];
    lines.push(`${sevIcon} *${insight.title}*`);
    if (insight.recommendation) {
      lines.push("");
      lines.push(`→ ${insight.recommendation.slice(0, 200)}`);
    }
    if (insight.assignee_name) {
      lines.push("");
      lines.push(`📋 Responsable: ${insight.assignee_name}`);
    }
    if (insight.business_impact_estimate) {
      lines.push(`💰 Impacto: $${Number(insight.business_impact_estimate).toLocaleString()} MXN`);
    }
    const appUrl = typeof window !== "undefined" ? window.location.href : "";
    if (appUrl) lines.push("", `👉 ${appUrl}`);

    const text = encodeURIComponent(lines.join("\n"));
    window.open(`https://wa.me/?text=${text}`, "_blank");
  }, [insight, companyName]);

  return (
    <button
      onClick={handleShare}
      className="flex items-center justify-center gap-2 w-full rounded-xl border p-2.5 text-sm text-muted-foreground hover:bg-muted/50 transition-colors"
    >
      <Share2 className="h-4 w-4" />
      Compartir por WhatsApp
    </button>
  );
}

// ── Follow-up Banner ──
function FollowUpBanner({ insightId, state }: { insightId: number; state: string }) {
  const [followUp, setFollowUp] = useState<{
    status: string; follow_up_date: string; resolution_note: string | null;
  } | null>(null);

  useEffect(() => {
    if (state !== "acted_on") return;
    supabase.from("insight_follow_ups")
      .select("status, follow_up_date, resolution_note")
      .eq("insight_id", insightId).limit(1).single()
      .then(({ data }) => { if (data) setFollowUp(data); });
  }, [insightId, state]);

  if (!followUp) return null;

  const colors: Record<string, string> = {
    pending: "bg-info/10 text-info-foreground",
    improved: "bg-success/10 text-success-foreground",
    unchanged: "bg-warning/10 text-warning-foreground",
    worsened: "bg-danger/10 text-danger-foreground",
  };
  const labels: Record<string, string> = {
    pending: "Seguimiento programado",
    improved: "Mejoro",
    unchanged: "Sin cambio",
    worsened: "Empeoro",
  };

  return (
    <div className={cn("rounded-xl p-3 text-sm", colors[followUp.status] ?? "bg-muted")}>
      <div className="flex items-center justify-between">
        <span className="font-semibold">{labels[followUp.status] ?? followUp.status}</span>
        <span className="text-xs opacity-70">{followUp.follow_up_date}</span>
      </div>
      {followUp.resolution_note && <p className="text-xs mt-1 opacity-80">{followUp.resolution_note}</p>}
    </div>
  );
}
