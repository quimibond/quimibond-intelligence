"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Building2,
  Eye,
  Lightbulb,
  ShieldAlert,
  Swords,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { timeAgo } from "@/lib/utils";
import type { Alert, Fact } from "@/lib/types";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { SeverityBadge } from "@/components/shared/severity-badge";
import { StateBadge } from "@/components/shared/state-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
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

  useEffect(() => {
    async function fetchData() {
      const [alertsRes, factsRes] = await Promise.all([
        supabase
          .from("alerts")
          .select("*")
          .eq("alert_type", "competitor")
          .order("created_at", { ascending: false })
          .limit(PAGE_SIZE),
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
    }

    fetchData();
  }, []);

  const loadMore = useCallback(async () => {
    setLoadingMore(true);
    const { data } = await supabase
      .from("alerts")
      .select("*")
      .eq("alert_type", "competitor")
      .order("created_at", { ascending: false })
      .range(alerts.length, alerts.length + PAGE_SIZE - 1);
    const rows = (data ?? []) as Alert[];
    setAlerts((prev) => [...prev, ...rows]);
    setHasMore(rows.length >= PAGE_SIZE);
    setLoadingMore(false);
  }, [alerts.length]);

  // ── Computed ──

  const stats = useMemo(() => {
    const total = alerts.length;
    const active = alerts.filter((a) => a.state !== "resolved").length;
    const resolved = alerts.filter((a) => a.state === "resolved").length;
    return { total, active, resolved };
  }, [alerts]);

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

  // ── Loading ──

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-5 w-96" />
        <div className="grid gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-[120px]" />
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[180px]" />
          ))}
        </div>
      </div>
    );
  }

  // ── Render ──

  return (
    <div className="space-y-6">
      <PageHeader
        title="Competidores"
        description="Inteligencia competitiva extraida de comunicaciones"
      />

      {/* KPI Row */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          title="Total Menciones"
          value={stats.total}
          icon={Swords}
          description="Alertas de tipo competidor"
        />
        <StatCard
          title="Alertas Activas"
          value={stats.active}
          icon={ShieldAlert}
          description="Pendientes de resolucion"
        />
        <StatCard
          title="Resueltas"
          value={stats.resolved}
          icon={Eye}
          description="Alertas ya gestionadas"
        />
      </div>

      {/* Grouped competitor alerts */}
      {alerts.length === 0 ? (
        <EmptyState
          icon={Swords}
          title="Sin menciones de competidores"
          description="No se han detectado alertas de tipo competidor en las comunicaciones."
        />
      ) : (
        <>
          <div>
            <h2 className="text-lg font-semibold">
              Menciones por contacto
            </h2>
            <p className="text-sm text-muted-foreground">
              Agrupadas por contacto que menciono al competidor
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
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

          {hasMore && alerts.length > 0 && (
            <div className="flex justify-center pt-4">
              <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? "Cargando..." : "Cargar mas"}
              </Button>
            </div>
          )}
        </>
      )}

      {/* Competitor-related facts */}
      {facts.length > 0 && (
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
                  <div className="mt-auto flex items-center gap-2 pt-2">
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
