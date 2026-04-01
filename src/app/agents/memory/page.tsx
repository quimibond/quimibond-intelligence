"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Brain, Clock, Hash, Sparkles, Star } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { cn, timeAgo } from "@/lib/utils";
import { getDomainConfig } from "@/lib/domains";
import type { AgentMemory } from "@/lib/types";
import { PageHeader } from "@/components/shared/page-header";
import { FilterBar } from "@/components/shared/filter-bar";
import { EmptyState } from "@/components/shared/empty-state";
import { LoadingGrid } from "@/components/shared/loading-grid";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select-native";

// ── Types ──

interface MemoryWithAgent extends AgentMemory {
  ai_agents: {
    name: string;
    domain: string;
    slug: string;
  } | null;
}

interface AgentInfo {
  slug: string;
  name: string;
  domain: string;
}

// ── Helpers ──

function importanceBadgeVariant(importance: number | null): "critical" | "warning" | "info" | "secondary" {
  if (importance == null) return "secondary";
  if (importance >= 8) return "critical";
  if (importance >= 5) return "warning";
  if (importance >= 3) return "info";
  return "secondary";
}

function memoryTypeBadgeVariant(type: string): "default" | "success" | "info" | "outline" {
  switch (type) {
    case "learning":
      return "success";
    case "preference":
      return "info";
    case "pattern":
      return "default";
    default:
      return "outline";
  }
}

// ── Component ──

export default function AgentMemoryPage() {
  const [memories, setMemories] = useState<MemoryWithAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [agentFilter, setAgentFilter] = useState("all");

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("agent_memory")
      .select("*, ai_agents(name, domain, slug)")
      .order("created_at", { ascending: false })
      .limit(500);
    setMemories((data as MemoryWithAgent[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Derive unique agents for the filter dropdown
  const agents = useMemo(() => {
    const map = new Map<string, AgentInfo>();
    for (const m of memories) {
      if (m.ai_agents && !map.has(m.ai_agents.slug)) {
        map.set(m.ai_agents.slug, {
          slug: m.ai_agents.slug,
          name: m.ai_agents.name,
          domain: m.ai_agents.domain,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [memories]);

  // Filter memories
  const filtered = useMemo(() => {
    let result = memories;
    if (agentFilter !== "all") {
      result = result.filter((m) => m.ai_agents?.slug === agentFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (m) =>
          m.content.toLowerCase().includes(q) ||
          m.memory_type.toLowerCase().includes(q) ||
          (m.context_type?.toLowerCase().includes(q) ?? false)
      );
    }
    return result;
  }, [memories, agentFilter, search]);

  // Group by agent
  const grouped = useMemo(() => {
    const map = new Map<string, { agent: AgentInfo; memories: MemoryWithAgent[] }>();
    for (const m of filtered) {
      const key = m.ai_agents?.slug ?? "unknown";
      if (!map.has(key)) {
        map.set(key, {
          agent: m.ai_agents
            ? { slug: m.ai_agents.slug, name: m.ai_agents.name, domain: m.ai_agents.domain }
            : { slug: "unknown", name: "Desconocido", domain: "" },
          memories: [],
        });
      }
      map.get(key)!.memories.push(m);
    }
    return Array.from(map.values()).sort((a, b) => b.memories.length - a.memories.length);
  }, [filtered]);

  // Stats
  const stats = useMemo(() => {
    const total = memories.length;
    const used = memories.filter((m) => m.times_used > 0).length;
    const importances = memories
      .map((m) => m.importance)
      .filter((v): v is number => v != null);
    const avgImportance =
      importances.length > 0
        ? importances.reduce((s, v) => s + v, 0) / importances.length
        : 0;
    return { total, used, avgImportance };
  }, [memories]);

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Memorias de Agentes"
          description="Memorias persistentes que los agentes usan para mejorar"
        />
        <LoadingGrid rows={4} rowHeight="h-[200px]" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Memorias de Agentes"
        description={`${stats.total} memorias de ${agents.length} agentes`}
      />

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-2xl font-bold tabular-nums">{stats.total}</p>
            <p className="text-xs text-muted-foreground">Total memorias</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-2xl font-bold tabular-nums">{stats.used}</p>
            <p className="text-xs text-muted-foreground">Utilizadas</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-2xl font-bold tabular-nums">
              {stats.avgImportance.toFixed(1)}
            </p>
            <p className="text-xs text-muted-foreground">Importancia prom.</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <FilterBar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Buscar en memorias..."
      >
        <Select
          aria-label="Filtrar por agente"
          value={agentFilter}
          onChange={(e) => setAgentFilter(e.target.value)}
          className="w-[180px]"
        >
          <option value="all">Todos los agentes</option>
          {agents.map((a) => (
            <option key={a.slug} value={a.slug}>
              {a.name}
            </option>
          ))}
        </Select>
      </FilterBar>

      {/* Empty state */}
      {grouped.length === 0 && (
        <EmptyState
          icon={Brain}
          title="Sin memorias"
          description={
            search || agentFilter !== "all"
              ? "No se encontraron memorias con los filtros actuales"
              : "Los agentes aun no han generado memorias"
          }
        />
      )}

      {/* Grouped memories by agent */}
      <div className="space-y-4">
        {grouped.map(({ agent, memories: agentMemories }) => {
          const dc = getDomainConfig(agent.domain);
          const Icon = dc.icon;

          return (
            <Card key={agent.slug}>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2.5">
                  <div
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                      dc.bg
                    )}
                  >
                    <Icon className={cn("h-4 w-4", dc.color)} />
                  </div>
                  <div className="min-w-0">
                    <CardTitle className="text-sm">{agent.name}</CardTitle>
                    <p className="text-[10px] text-muted-foreground">
                      {agentMemories.length} memoria{agentMemories.length !== 1 ? "s" : ""}
                    </p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-2 pt-0">
                {agentMemories.map((mem) => (
                  <div
                    key={mem.id}
                    className="rounded-lg border p-3 space-y-2"
                  >
                    {/* Content */}
                    <p className="text-sm leading-relaxed">{mem.content}</p>

                    {/* Badges row */}
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant={memoryTypeBadgeVariant(mem.memory_type)}>
                        {mem.memory_type}
                      </Badge>
                      {mem.importance != null && (
                        <Badge variant={importanceBadgeVariant(mem.importance)}>
                          <Star className="h-3 w-3 mr-0.5" />
                          {mem.importance}
                        </Badge>
                      )}
                      {mem.context_type && (
                        <Badge variant="outline">{mem.context_type}</Badge>
                      )}
                    </div>

                    {/* Meta row */}
                    <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Hash className="h-3 w-3" />
                        {mem.times_used} uso{mem.times_used !== 1 ? "s" : ""}
                      </span>
                      {mem.last_used_at && (
                        <span className="flex items-center gap-1">
                          <Sparkles className="h-3 w-3" />
                          Usado {timeAgo(mem.last_used_at)}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        Creada {timeAgo(mem.created_at)}
                      </span>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
