"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PartyPopper, RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { AgentInsight, CompanyProfile } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { InboxFilters } from "./components/inbox-filters";
import { InboxMobile } from "./components/inbox-mobile";
import { InboxDesktop } from "./components/inbox-desktop";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";

const PAGE_SIZE = 50;

function computeTier(insight: AgentInsight): string {
  const ev = insight.evidence as { priority_tier?: string }[] | null;
  const evTier = ev?.[0]?.priority_tier ?? "fyi";
  if (evTier !== "fyi") return evTier;
  if (insight.severity === "critical") return "urgent";
  if (insight.severity === "high") return "important";
  return "fyi";
}

export default function InboxPage() {
  const router = useRouter();
  const [insights, setInsights] = useState<AgentInsight[]>([]);
  const [agents, setAgents] = useState<Record<number, { slug: string; name: string; domain: string }>>({});
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<number | null>(null);
  const [freshness, setFreshness] = useState<{ lastSync: string | null; lastAnalyze: string | null; lastAgents: string | null }>({ lastSync: null, lastAnalyze: null, lastAgents: null });
  const [seenIds, setSeenIds] = useState<Set<number>>(new Set());
  const [filterMode, setFilterMode] = useState<"all" | "urgent" | "important" | "fyi">("all");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [allAssignees, setAllAssignees] = useState<string[]>([]);
  const [companyProfiles, setCompanyProfiles] = useState<Map<number, CompanyProfile>>(new Map());
  const [hasMore, setHasMore] = useState(true);

  // Load seen IDs from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem("qb-seen-insights");
      if (stored) setSeenIds(new Set(JSON.parse(stored)));
    } catch { /* ignore */ }
  }, []);

  const markSeen = useCallback((id: number) => {
    setSeenIds(prev => {
      const next = new Set(prev);
      next.add(id);
      const arr = Array.from(next);
      if (arr.length > 200) arr.splice(0, arr.length - 200);
      const trimmed = new Set(arr);
      try { localStorage.setItem("qb-seen-insights", JSON.stringify(Array.from(trimmed))); } catch { /* ignore */ }
      return trimmed;
    });
  }, []);

  const load = useCallback(async () => {
    const [insightsRes, agentsRes, freshnessRes, assigneesRes, profilesRes] = await Promise.all([
      supabase
        .from("agent_insights").select("id, agent_id, title, description, category, severity, confidence, state, assignee_name, assignee_department, company_id, contact_id, business_impact_estimate, evidence, created_at")
        .in("state", ["new", "seen"]).gte("confidence", 0.80)
        .order("created_at", { ascending: false }).range(0, PAGE_SIZE - 1),
      supabase.from("ai_agents").select("id, slug, name, domain"),
      Promise.all([
        supabase.from("odoo_users").select("updated_at").order("updated_at", { ascending: false }).limit(1),
        supabase.from("emails").select("created_at").order("created_at", { ascending: false }).limit(1),
        supabase.from("agent_runs").select("completed_at").eq("status", "completed").order("completed_at", { ascending: false }).limit(1),
      ]),
      supabase.from("agent_insights").select("assignee_name")
        .in("state", ["new", "seen"]).gte("confidence", 0.80).not("assignee_name", "is", null),
      supabase.from("company_profile")
        .select("company_id, name, total_revenue, revenue_90d, trend_pct, overdue_amount, tier, risk_level")
        .in("tier", ["strategic", "important", "key_supplier"])
        .order("total_revenue", { ascending: false })
        .limit(50),
    ]);

    const [odooFresh, emailFresh, agentFresh] = freshnessRes;
    setFreshness({
      lastSync: odooFresh.data?.[0]?.updated_at ?? null,
      lastAnalyze: emailFresh.data?.[0]?.created_at ?? null,
      lastAgents: agentFresh.data?.[0]?.completed_at ?? null,
    });

    const agentMap: Record<number, { slug: string; name: string; domain: string }> = {};
    for (const a of agentsRes.data ?? []) agentMap[a.id] = { slug: a.slug, name: a.name, domain: a.domain };
    setAgents(agentMap);

    const profileMap = new Map<number, CompanyProfile>();
    for (const p of profilesRes.data ?? []) profileMap.set(p.company_id, p as CompanyProfile);
    setCompanyProfiles(profileMap);

    const assigneeNames = Array.from(new Set(
      (assigneesRes.data ?? []).map((r: { assignee_name: string }) => r.assignee_name).filter(Boolean)
    )) as string[];
    setAllAssignees(assigneeNames.sort());

    const sorted = (insightsRes.data ?? []).sort((a, b) => {
      const tierOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
      return (tierOrder[a.severity ?? ""] ?? 5) - (tierOrder[b.severity ?? ""] ?? 5);
    });
    setInsights(sorted as AgentInsight[]);
    setHasMore((insightsRes.data ?? []).length === PAGE_SIZE);
    setLoading(false);
  }, []);

  const loadMore = useCallback(async () => {
    const offset = insights.length;
    const { data } = await supabase
      .from("agent_insights")
      .select("id, agent_id, title, description, category, severity, confidence, state, assignee_name, assignee_department, company_id, contact_id, business_impact_estimate, evidence, created_at")
      .in("state", ["new", "seen"])
      .gte("confidence", 0.80)
      .order("created_at", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    if (data?.length) {
      setInsights(prev => {
        const existingIds = new Set(prev.map(i => i.id));
        const newItems = (data as AgentInsight[]).filter(i => !existingIds.has(i.id));
        const merged = [...prev, ...newItems];
        return merged.sort((a, b) => {
          const tierOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
          return (tierOrder[a.severity ?? ""] ?? 5) - (tierOrder[b.severity ?? ""] ?? 5);
        });
      });
      setHasMore(data.length === PAGE_SIZE);
    } else {
      setHasMore(false);
    }
  }, [insights.length]);

  useEffect(() => { load(); }, [load]);

  // Real-time subscription
  useEffect(() => {
    const channel = supabase
      .channel("inbox-new-insights")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "agent_insights" }, (payload) => {
        const ni = payload.new as AgentInsight;
        if ((ni.confidence ?? 0) >= 0.80 && ["new", "seen"].includes(ni.state ?? "")) {
          setInsights(prev => prev.find(i => i.id === ni.id) ? prev : [ni, ...prev]);
          toast("Nuevo insight", { description: ni.title, duration: 5000 });
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  // Filter logic
  const filteredInsights = insights.filter(insight => {
    if (filterMode !== "all" && computeTier(insight) !== filterMode) return false;
    if (assigneeFilter !== "all" && insight.assignee_name !== assigneeFilter) return false;
    if (categoryFilter !== "all" && insight.category !== categoryFilter) return false;
    return true;
  });

  const tierCounts = { urgent: 0, important: 0, fyi: 0 };
  for (const insight of insights) {
    const tier = computeTier(insight);
    if (tier in tierCounts) tierCounts[tier as keyof typeof tierCounts]++;
  }

  // Actions
  const actOnInsight = useCallback(async (id: number) => {
    setActing(id);
    try {
      const { error } = await supabase.from("agent_insights").update({ state: "acted_on", was_useful: true }).eq("id", id);
      if (error) { toast.error("Error al marcar insight: " + error.message); return; }
      setInsights(prev => prev.filter(i => i.id !== id));
      toast.success("Marcado como util");
    } finally { setActing(null); }
  }, []);

  const dismissInsight = useCallback(async (id: number) => {
    const { error } = await supabase.from("agent_insights").update({ state: "dismissed", was_useful: false }).eq("id", id);
    if (error) { toast.error("Error al descartar insight: " + error.message); return; }
    setInsights(prev => prev.filter(i => i.id !== id));
    toast("Descartado");
  }, []);

  const goToDetail = useCallback((id: number) => {
    markSeen(id);
    router.push(`/inbox/insight/${id}`);
  }, [router, markSeen]);

  // Loading
  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div><Skeleton className="h-7 w-24 mb-2" /><Skeleton className="h-4 w-48" /></div>
          <Skeleton className="h-8 w-8 rounded-md" />
        </div>
        <div className="flex gap-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8 w-20 rounded-full" />)}
        </div>
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i}><CardContent className="py-3 px-4">
              <div className="flex items-center gap-4">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-5 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            </CardContent></Card>
          ))}
        </div>
      </div>
    );
  }

  // Empty
  if (insights.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-5">
        <div className="h-16 w-16 rounded-full bg-success/10 flex items-center justify-center">
          <PartyPopper className="h-8 w-8 text-success" />
        </div>
        <div className="text-center">
          <h2 className="text-xl font-black">Todo al dia</h2>
          <p className="text-sm text-muted-foreground mt-1">Sin insights pendientes</p>
        </div>
        <Button variant="outline" size="sm" onClick={load}>
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Actualizar
        </Button>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-4rem)]">
      <InboxFilters
        totalCount={insights.length}
        filteredCount={filteredInsights.length}
        tierCounts={tierCounts}
        filterMode={filterMode}
        setFilterMode={setFilterMode}
        assigneeFilter={assigneeFilter}
        setAssigneeFilter={setAssigneeFilter}
        allAssignees={allAssignees}
        categoryFilter={categoryFilter}
        setCategoryFilter={setCategoryFilter}
        freshness={freshness}
        onRefresh={load}
      />

      {/* Empty filtered state */}
      {filteredInsights.length === 0 && insights.length > 0 && (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <p className="text-sm text-muted-foreground">No hay insights con este filtro</p>
          <Button variant="ghost" size="sm" onClick={() => { setFilterMode("all"); setAssigneeFilter("all"); setCategoryFilter("all"); }}>
            Limpiar filtros
          </Button>
        </div>
      )}

      {/* Mobile */}
      {filteredInsights.length > 0 && (
        <div className="md:hidden">
          <InboxMobile
            insights={filteredInsights}
            agents={agents}
            seenIds={seenIds}
            acting={acting}
            onAct={actOnInsight}
            onDismiss={dismissInsight}
            onDetail={goToDetail}
            onMarkSeen={markSeen}
          />
        </div>
      )}

      {/* Desktop */}
      {filteredInsights.length > 0 && (
        <div className="hidden md:block">
          <InboxDesktop
            insights={filteredInsights}
            agents={agents}
            companyProfiles={companyProfiles}
            seenIds={seenIds}
            acting={acting}
            onAct={actOnInsight}
            onDismiss={dismissInsight}
            onDetail={goToDetail}
          />
        </div>
      )}

      {hasMore && insights.length > 0 && (
        <div className="flex justify-center py-6">
          <Button variant="outline" size="sm" onClick={loadMore}>
            Cargar mas insights
          </Button>
        </div>
      )}
    </div>
  );
}
