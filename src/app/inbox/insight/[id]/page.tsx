"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  ArrowLeft, ChevronLeft, ChevronRight, Loader2,
  MessageSquare, ThumbsDown, ThumbsUp,
} from "lucide-react";
import type { AgentInsight, Company } from "@/lib/types";
import { supabase } from "@/lib/supabase";
import { cn, timeAgo } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CompanyIntelCards } from "@/app/companies/[id]/components/company-intel-cards";

const SEV_DOTS: Record<string, string> = {
  critical: "bg-red-500", high: "bg-orange-400", medium: "bg-yellow-400",
};

export default function InsightDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [insight, setInsight] = useState<AgentInsight | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [crossSignals, setCrossSignals] = useState<{ director_name: string; title: string; severity: string }[]>([]);
  const [insightHistory, setInsightHistory] = useState<{ total_insights_30d: number; times_acted: number; times_dismissed: number; which_directors: string } | null>(null);
  const [navIds, setNavIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);

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
      const [navRes, companyRes, crossRes, historyRes] = await Promise.all([
        supabase.from("agent_insights").select("id").in("state", ["new", "seen"]).gte("confidence", 0.80).order("created_at", { ascending: false }).limit(50),
        ins.company_id ? supabase.from("companies").select("id, name, canonical_name").eq("id", ins.company_id).single() : Promise.resolve({ data: null }),
        ins.company_id ? supabase.from("cross_director_signals").select("director_name, title, severity").eq("company_id", ins.company_id).neq("title", ins.title).limit(5) : Promise.resolve({ data: null }),
        ins.company_id ? supabase.from("company_insight_history").select("total_insights_30d, times_acted, times_dismissed, which_directors").eq("company_id", ins.company_id).single() : Promise.resolve({ data: null }),
      ]);

      if (navRes.data) setNavIds(navRes.data.map((n: { id: number }) => n.id));
      if (companyRes.data) setCompany(companyRes.data as Company);
      if (crossRes.data) setCrossSignals(crossRes.data as typeof crossSignals);
      if (historyRes.data) setInsightHistory(historyRes.data as typeof insightHistory);

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
              <p className="text-xs text-muted-foreground mt-2">→ {insight.assignee_name}</p>
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

      {/* ── Actions (inline, not fixed bar) ── */}
      {!isDone && (
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1 h-11" onClick={handleDismiss}>
            <ThumbsDown className="h-4 w-4 mr-2" /> Descartar
          </Button>
          <Button className="flex-1 h-11" onClick={handleAct} disabled={acting}>
            {acting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ThumbsUp className="h-4 w-4 mr-2" />}
            Util
          </Button>
        </div>
      )}

      {isDone && (
        <div className={cn(
          "rounded-xl px-4 py-2.5 text-sm font-medium text-center",
          insight.state === "acted_on" ? "bg-emerald-50 text-emerald-700" : "bg-muted text-muted-foreground"
        )}>
          {insight.state === "acted_on" ? "Marcado como util" : insight.state === "dismissed" ? "Descartado" : "Expirado"}
        </div>
      )}

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
    pending: "bg-blue-50 text-blue-800",
    improved: "bg-emerald-50 text-emerald-800",
    unchanged: "bg-yellow-50 text-yellow-800",
    worsened: "bg-red-50 text-red-800",
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
