"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Building2,
  Eye,
  Lightbulb,
  ShieldAlert,
  Swords,
  ChevronRight,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { timeAgo } from "@/lib/utils";
import type { Alert, Fact } from "@/lib/types";
import { PageHeader } from "@/components/shared/page-header";
import { MiniStatCard } from "@/components/shared/mini-stat-card";
import { FilterBar } from "@/components/shared/filter-bar";
import { LoadingGrid } from "@/components/shared/loading-grid";
import { EmptyState } from "@/components/shared/empty-state";
import { SeverityBadge } from "@/components/shared/severity-badge";
import { StateBadge } from "@/components/shared/state-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select-native";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

// ── Types ──

interface CompetitorGroup {
  name: string;
  alerts: Alert[];
  latestDate: string;
}

// ── Component ──

const PAGE_SIZE = 50;

export default function CompetitorsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [facts, setFacts] = useState<Fact[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchData = useCallback(async (searchVal: string, state: string, severity: string) => {
    setLoading(true);

    let alertsQuery = supabase
      .from("alerts")
      .select("*")
      .eq("alert_type", "competitor")
      .order("created_at", { ascending: false });

    if (searchVal.trim()) {
      alertsQuery = alertsQuery.or(
        `title.ilike.%${searchVal.trim()}%,contact_name.ilike.%${searchVal.trim()}%`
      );
    }
    if (state === "active") alertsQuery = alertsQuery.neq("state", "resolved");
    if (state === "resolved") alertsQuery = alertsQuery.eq("state", "resolved");
    if (severity !== "all") alertsQuery = alertsQuery.eq("severity", severity);

    const [alertsRes, factsRes] = await Promise.all([
      alertsQuery.limit(PAGE_SIZE),
      supabase
        .from("facts")
        .select("*")
        .ilike("fact_type", "%competitor%")
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

    const rows = (alertsRes.data ?? []) as Alert[];
    setAlerts(rows);
    setHasMore(rows.length >= PAGE_SIZE);
    if (factsRes.data) setFacts(factsRes.data as Fact[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData("", "all", "all");
  }, [fetchData]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchData(search, stateFilter, severityFilter), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search, stateFilter, severityFilter, fetchData]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);

    let query = supabase
      .from("alerts")
      .select("*")
      .eq("alert_type", "competitor")
      .order("created_at", { ascending: false });

    if (search.trim()) {
      query = query.or(
        `title.ilike.%${search.trim()}%,contact_name.ilike.%${search.trim()}%`
      );
    }
    if (stateFilter === "active") query = query.neq("state", "resolved");
    if (stateFilter === "resolved") query = query.eq("state", "resolved");
    if (severityFilter !== "all") query = query.eq("severity", severityFilter);

    const { data } = await query.range(alerts.length, alerts.length + PAGE_SIZE - 1);
    const rows = (data ?? []) as Alert[];
    setAlerts((prev) => [...prev, ...rows]);
    setHasMore(rows.length >= PAGE_SIZE);
    setLoadingMore(false);
  }, [alerts.length, loadingMore, hasMore, search, stateFilter, severityFilter]);

  // ── Computed ──

  const stats = useMemo(() => {
    const total = alerts.length;
    const active = alerts.filter((a) => a.state !== "resolved").length;
    const resolved = alerts.filter((a) => a.state === "resolved").length;
    return { total, active, resolved, facts: facts.length };
  }, [alerts, facts]);

  const grouped = useMemo(() => {
    const map = new Map<string, Alert[]>();
    for (const a of alerts) {
      const key = a.contact_name ?? "Desconocido";
      const list = map.get(key) ?? [];
      list.push(a);
      map.set(key, list);
    }

    const groups: CompetitorGroup[] = [];
    for (const [name, list] of map.entries()) {
      groups.push({
        name,
        alerts: list,
        latestDate: list[0].created_at,
      });
    }

    groups.sort(
      (a, b) =>
        new Date(b.latestDate).getTime() - new Date(a.latestDate).getTime()
    );
    return groups;
  }, [alerts]);

  // ── Render ──

  return (
    <div className="space-y-5">
      <PageHeader
        title="Competidores"
        description="Inteligencia competitiva extraida de comunicaciones"
      />

      {/* Quick Stats */}
      {!loading && alerts.length > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MiniStatCard icon={Swords} label="Total Menciones" value={stats.total} />
          <MiniStatCard icon={ShieldAlert} label="Activas" value={stats.active} valueClassName="text-warning-foreground" />
          <MiniStatCard icon={Eye} label="Resueltas" value={stats.resolved} valueClassName="text-success-foreground" />
          <MiniStatCard icon={Lightbulb} label="Hechos" value={stats.facts} valueClassName="text-info-foreground" />
        </div>
      )}

      {/* Search + Filters */}
      <FilterBar search={search} onSearchChange={setSearch} searchPlaceholder="Buscar competidor o contacto...">
        <Select value={stateFilter} onChange={(e) => setStateFilter(e.target.value)} className="w-32 shrink-0" aria-label="Filtrar por estado">
          <option value="all">Todos</option>
          <option value="active">Activas</option>
          <option value="resolved">Resueltas</option>
        </Select>
        <Select value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)} className="w-32 shrink-0" aria-label="Filtrar por severidad">
          <option value="all">Severidad</option>
          <option value="low">Baja</option>
          <option value="medium">Media</option>
          <option value="high">Alta</option>
          <option value="critical">Critica</option>
        </Select>
      </FilterBar>

      {/* Loading */}
      {loading && <LoadingGrid stats={4} rows={4} statCols="4" />}

      {/* Empty state */}
      {!loading && alerts.length === 0 && (
        <EmptyState
          icon={Swords}
          title="Sin menciones de competidores"
          description={
            search || stateFilter !== "all" || severityFilter !== "all"
              ? "No se encontraron alertas con esos filtros."
              : "No se han detectado alertas de tipo competidor en las comunicaciones."
          }
        />
      )}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* MOBILE: Card layout                                          */}
      {/* ══════════════════════════════════════════════════════════════ */}
      {!loading && grouped.length > 0 && (
        <div className="space-y-3 md:hidden">
          {grouped.map((group) => (
            <Card key={group.name}>
              <CardContent className="p-3">
              <div className="flex items-center gap-2 mb-2">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <Building2 className="h-4 w-4 text-primary" />
                </div>
                <p className="text-sm font-semibold truncate flex-1">{group.name}</p>
                <Badge variant="secondary">{group.alerts.length}</Badge>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </div>
              <div className="space-y-2">
                {group.alerts.slice(0, 3).map((alert) => (
                  <div key={alert.id} className="rounded-md border p-2.5 space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium leading-snug line-clamp-2">{alert.title}</p>
                      <SeverityBadge severity={alert.severity} />
                    </div>
                    <div className="flex items-center gap-2">
                      <StateBadge state={alert.state} />
                      <span className="text-[11px] text-muted-foreground">{timeAgo(alert.created_at)}</span>
                    </div>
                  </div>
                ))}
                {group.alerts.length > 3 && (
                  <p className="text-center text-xs text-muted-foreground">
                    +{group.alerts.length - 3} alertas mas
                  </p>
                )}
              </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* DESKTOP: Card grid                                           */}
      {/* ══════════════════════════════════════════════════════════════ */}
      {!loading && grouped.length > 0 && (
        <>
          <div className="hidden md:block">
            <div className="mb-3">
              <h2 className="text-lg font-semibold">Menciones por contacto</h2>
              <p className="text-sm text-muted-foreground">
                Agrupadas por contacto que menciono al competidor
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {grouped.map((group) => (
                <Card key={group.name}>
                  <CardHeader className="flex flex-row items-center gap-2 pb-3">
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                    <CardTitle className="text-base">{group.name}</CardTitle>
                    <Badge variant="secondary" className="ml-auto">
                      {group.alerts.length}
                    </Badge>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {group.alerts.slice(0, 5).map((alert) => (
                      <div
                        key={alert.id}
                        className="space-y-1 rounded-lg border p-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium leading-snug">
                            {alert.title}
                          </p>
                          <SeverityBadge severity={alert.severity} />
                        </div>
                        {alert.description && (
                          <p className="text-xs text-muted-foreground line-clamp-2">
                            {alert.description}
                          </p>
                        )}
                        <div className="flex items-center gap-2 pt-1">
                          <StateBadge state={alert.state} />
                          <span className="text-[11px] text-muted-foreground">
                            {timeAgo(alert.created_at)}
                          </span>
                        </div>
                      </div>
                    ))}
                    {group.alerts.length > 5 && (
                      <p className="text-center text-xs text-muted-foreground">
                        +{group.alerts.length - 5} alertas mas
                      </p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Load more */}
      {hasMore && alerts.length > 0 && !loading && (
        <div className="flex justify-center pt-2">
          <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? "Cargando..." : "Cargar mas alertas"}
          </Button>
        </div>
      )}

      {/* Competitor-related facts */}
      {!loading && facts.length > 0 && (
        <>
          <Separator />

          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-warning" />
              Hechos de Competidores
            </h2>
            <p className="text-sm text-muted-foreground">
              Informacion extraida automaticamente del knowledge graph
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {facts.map((fact) => (
              <Card key={fact.id} className="flex flex-col">
                <CardContent className="flex flex-1 flex-col gap-2 pt-4">
                  <p className="text-sm leading-snug">{fact.fact_text}</p>
                  <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">
                    {fact.fact_type && (
                      <Badge variant="outline" className="text-[10px]">
                        {fact.fact_type}
                      </Badge>
                    )}
                    <Badge variant="secondary" className="text-[10px]">
                      {Math.round(fact.confidence * 100)}% confianza
                    </Badge>
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {timeAgo(fact.created_at)}
                    </span>
                  </div>
                  {fact.source_account && (
                    <p className="text-[10px] text-muted-foreground">
                      Fuente: {fact.source_account}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
