"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  ArrowLeft, ChevronLeft, ChevronRight, Loader2,
  MessageSquare, ThumbsDown, ThumbsUp, XCircle,
} from "lucide-react";
import type { AgentInsight, AIAgent, AgentRun, Company, Contact } from "@/lib/types";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { useSidebar } from "@/components/layout/sidebar-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { InsightCard } from "./components/insight-card";
import { InsightContext } from "./components/insight-context";

// Partial selects — only the columns we fetch
type AgentPartial = Pick<AIAgent, "id" | "slug" | "name" | "domain">;
type CompanyPartial = Pick<Company, "id" | "name" | "canonical_name" | "lifetime_value" | "is_customer" | "is_supplier" | "total_pending" | "delivery_otd_rate" | "entity_id">;
type ContactPartial = Pick<Contact, "id" | "name" | "email" | "role" | "current_health_score" | "risk_level" | "sentiment_score" | "last_activity" | "company_id">;
type RunPartial = Pick<AgentRun, "id" | "started_at" | "completed_at" | "duration_seconds" | "insights_generated" | "status">;

export default function InsightDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { collapsed } = useSidebar();

  const [insight, setInsight] = useState<AgentInsight | null>(null);
  const [agent, setAgent] = useState<AgentPartial | null>(null);
  const [agentRun, setAgentRun] = useState<RunPartial | null>(null);
  const [company, setCompany] = useState<CompanyPartial | null>(null);
  const [contact, setContact] = useState<ContactPartial | null>(null);
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
      setInsight(ins as AgentInsight);

      // Mark as seen
      if (ins.state === "new") {
        supabase.from("agent_insights").update({ state: "seen" }).eq("id", insightId).then(() => {});
      }

      // Load nav IDs (all active insights for next/prev)
      const { data: navData } = await supabase
        .from("agent_insights")
        .select("id")
        .in("state", ["new", "seen"])
        .gte("confidence", 0.80)
        .order("created_at", { ascending: false })
        .limit(50);
      if (navData) setNavIds(navData.map(n => n.id));

      // Load agent + company + contact + run in parallel
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

      if (agentRes.data) setAgent(agentRes.data as AgentPartial);
      if (companyRes.data) setCompany(companyRes.data as CompanyPartial);
      if (contactRes.data) setContact(contactRes.data as ContactPartial);
      if (runRes.data) setAgentRun(runRes.data as RunPartial);

      setLoading(false);
    }
    load();
  }, [insightId]);

  // ── Navigation ──
  const currentNavIndex = navIds.indexOf(insightId);
  const prevId = currentNavIndex > 0 ? navIds[currentNavIndex - 1] : null;
  const nextId = currentNavIndex < navIds.length - 1 ? navIds[currentNavIndex + 1] : null;

  // ── Actions with error handling ──
  const handleAct = useCallback(async () => {
    if (!insight) return;
    setActing(true);
    try {
      const { error } = await supabase
        .from("agent_insights")
        .update({ state: "acted_on", was_useful: true })
        .eq("id", insight.id);
      if (error) {
        toast.error("Error al marcar insight: " + error.message);
        return;
      }
      setInsight({ ...insight, state: "acted_on" });
      toast.success("Marcado como util — el sistema aprendera de esto");
    } finally {
      setActing(false);
    }
  }, [insight]);

  const handleDismiss = useCallback(async () => {
    if (!insight) return;
    try {
      const { error } = await supabase
        .from("agent_insights")
        .update({ state: "dismissed", was_useful: false })
        .eq("id", insight.id);
      if (error) {
        toast.error("Error al descartar insight: " + error.message);
        return;
      }
      toast("Descartado — el sistema ajustara sus prioridades");
      if (nextId) router.push(`/inbox/insight/${nextId}`);
      else router.push("/inbox");
    } catch {
      toast.error("Error de conexion al descartar insight");
    }
  }, [insight, router, nextId]);

  // ── Keyboard shortcuts ──
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

  // ── Loading skeleton ──
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

  // ── Not found ──
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

  const isDone = ["acted_on", "dismissed", "expired"].includes(insight.state ?? "");

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

      {/* ── Main insight card + company + contact ── */}
      <InsightCard
        insight={insight}
        agent={agent as AIAgent | null}
        agentRun={agentRun as AgentRun | null}
        company={company as Company | null}
        contact={contact as Contact | null}
      />

      {/* ── Follow-up banner (if CEO acted) ── */}
      <FollowUpBanner insightId={insight.id} state={insight.state ?? ""} />

      {/* ── Contextual data panel ── */}
      <InsightContext
        insight={insight}
        agent={agent as AIAgent | null}
        companyId={insight.company_id}
        companyName={company?.name ?? null}
        contactName={contact?.name ?? null}
        contactEmail={contact?.email ?? null}
        entityId={company?.entity_id ?? null}
      />

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
              className="flex-1 h-11 text-danger border-danger/30 hover:bg-danger/10"
              onClick={handleDismiss}
            >
              <ThumbsDown className="h-4 w-4 mr-2" />
              <span className="hidden sm:inline">No util</span>
              <span className="sm:hidden">No</span>
            </Button>
            <Button
              className="flex-1 h-11 bg-success hover:bg-success/90 text-white"
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

// ── Follow-up Banner ──
function FollowUpBanner({ insightId, state }: { insightId: number; state: string }) {
  const [followUp, setFollowUp] = useState<{
    status: string;
    follow_up_date: string;
    resolution_note: string | null;
    created_at: string;
  } | null>(null);

  useEffect(() => {
    if (state !== "acted_on") return;
    supabase
      .from("insight_follow_ups")
      .select("status, follow_up_date, resolution_note, created_at")
      .eq("insight_id", insightId)
      .limit(1)
      .single()
      .then(({ data }) => { if (data) setFollowUp(data); });
  }, [insightId, state]);

  if (!followUp) return null;

  const colors: Record<string, string> = {
    pending: "bg-blue-50 border-blue-200 text-blue-800",
    improved: "bg-green-50 border-green-200 text-green-800",
    unchanged: "bg-yellow-50 border-yellow-200 text-yellow-800",
    worsened: "bg-red-50 border-red-200 text-red-800",
  };
  const labels: Record<string, string> = {
    pending: "Seguimiento programado",
    improved: "Situacion mejoro",
    unchanged: "Sin cambio",
    worsened: "Situacion empeoro",
  };

  return (
    <div className={cn("rounded-xl border p-3 text-sm", colors[followUp.status] ?? "bg-muted")}>
      <div className="flex items-center justify-between">
        <span className="font-semibold">{labels[followUp.status] ?? followUp.status}</span>
        <span className="text-xs opacity-70">verificar: {followUp.follow_up_date}</span>
      </div>
      {followUp.resolution_note && (
        <p className="text-xs mt-1 opacity-80">{followUp.resolution_note}</p>
      )}
    </div>
  );
}
