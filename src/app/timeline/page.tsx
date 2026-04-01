"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Bell,
  CheckSquare,
  Clock,
  Lightbulb,
  Mail,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { Alert, ActionItem, Email, Fact } from "@/lib/types";
import { PageHeader } from "@/components/shared/page-header";
import { FilterBar } from "@/components/shared/filter-bar";
import { LoadingGrid } from "@/components/shared/loading-grid";
import { MiniStatCard } from "@/components/shared/mini-stat-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select-native";
import { TimelineCard } from "./components/timeline-card";
import type { TimelineItem, DateRange } from "./components/types";

// ── Helpers ──

function getDateThreshold(range: DateRange): string {
  const now = new Date();
  if (range === "today") {
    now.setHours(0, 0, 0, 0);
  } else if (range === "7d") {
    now.setDate(now.getDate() - 7);
  } else {
    now.setDate(now.getDate() - 30);
  }
  return now.toISOString();
}

function summarizePayload(payload: Record<string, unknown> | null): string {
  if (!payload) return "";
  const keys = ["summary", "description", "message", "detail", "title"];
  for (const k of keys) {
    if (typeof payload[k] === "string") return payload[k] as string;
  }
  return "";
}

type LogRow = {
  id: string;
  phase: string | null;
  level: string;
  message: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
};

function mapAlerts(data: Alert[]): TimelineItem[] {
  return data.map((a) => ({
    id: `alert-${a.id}`,
    rawId: a.id,
    type: "alert" as const,
    title: a.title,
    subtitle: a.contact_name,
    metadata: a.account ?? a.alert_type,
    created_at: a.created_at,
    severity: a.severity,
  }));
}

function mapActions(data: ActionItem[]): TimelineItem[] {
  return data.map((a) => ({
    id: `action-${a.id}`,
    rawId: a.id,
    type: "action" as const,
    title: a.description,
    subtitle: a.contact_name,
    metadata: a.contact_company,
    created_at: a.created_at,
    priority: a.priority,
  }));
}

function mapEmails(data: Email[]): TimelineItem[] {
  return data.map((e) => ({
    id: `email-${e.id}`,
    rawId: e.id,
    type: "email" as const,
    title: e.subject ?? "(sin asunto)",
    subtitle: e.sender,
    metadata: e.account,
    created_at: e.email_date ?? e.created_at,
  }));
}

function mapFacts(data: Fact[]): TimelineItem[] {
  return data.map((f) => ({
    id: `fact-${f.id}`,
    rawId: f.id,
    type: "fact" as const,
    title: f.fact_text,
    subtitle: f.fact_type,
    metadata: f.source_account,
    created_at: f.created_at,
    confidence: f.confidence,
  }));
}

function mapEvents(data: LogRow[]): TimelineItem[] {
  return data.map((ev) => {
    const summary = summarizePayload(ev.details);
    return {
      id: `event-${ev.id}`,
      rawId: ev.id as unknown as number,
      type: "event" as const,
      title: ev.phase ?? ev.level,
      subtitle: ev.message ?? summary,
      metadata: ev.level !== "info" ? ev.level : null,
      created_at: ev.created_at,
    };
  });
}

function mergeAndSort(
  alertsData: Alert[],
  actionsData: ActionItem[],
  emailsData: Email[],
  factsData: Fact[],
  eventsData: LogRow[]
): TimelineItem[] {
  const merged = [
    ...mapAlerts(alertsData),
    ...mapActions(actionsData),
    ...mapEmails(emailsData),
    ...mapFacts(factsData),
    ...mapEvents(eventsData),
  ];
  merged.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
  return merged;
}

// ── Component ──

const PAGE_SIZE = 30;

export default function TimelinePage() {
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [dateRange, setDateRange] = useState<DateRange>("7d");
  const [page, setPage] = useState(0);

  useEffect(() => {
    async function fetchAll() {
      setLoading(true);
      setPage(0);
      const threshold = getDateThreshold(dateRange);

      const [alertsRes, actionsRes, emailsRes, factsRes, eventsRes] =
        await Promise.all([
          supabase
            .from("alerts")
            .select("id, title, severity, contact_name, account, alert_type, created_at")
            .gte("created_at", threshold)
            .order("created_at", { ascending: false })
            .limit(PAGE_SIZE),
          supabase
            .from("action_items")
            .select("id, description, priority, contact_name, contact_company, action_type, created_at")
            .gte("created_at", threshold)
            .order("created_at", { ascending: false })
            .limit(PAGE_SIZE),
          supabase
            .from("emails")
            .select("id, subject, sender, account, sender_type, email_date, created_at")
            .gte("email_date", threshold)
            .order("email_date", { ascending: false })
            .limit(PAGE_SIZE),
          supabase
            .from("facts")
            .select("id, fact_text, fact_type, confidence, source_account, created_at")
            .gte("created_at", threshold)
            .order("created_at", { ascending: false })
            .limit(PAGE_SIZE),
          supabase
            .from("pipeline_logs")
            .select("id, phase, level, message, details, created_at")
            .gte("created_at", threshold)
            .order("created_at", { ascending: false })
            .limit(PAGE_SIZE),
        ]);

      const merged = mergeAndSort(
        (alertsRes.data ?? []) as Alert[],
        (actionsRes.data ?? []) as ActionItem[],
        (emailsRes.data ?? []) as Email[],
        (factsRes.data ?? []) as Fact[],
        (eventsRes.data ?? []) as unknown as LogRow[]
      );

      const anySourceFull = [alertsRes, actionsRes, emailsRes, factsRes, eventsRes]
        .some((res) => (res.data ?? []).length >= PAGE_SIZE);

      setItems(merged);
      setHasMore(anySourceFull);
      setLoading(false);
    }

    fetchAll();
  }, [dateRange]);

  const loadMore = useCallback(async () => {
    setLoadingMore(true);
    const nextPage = page + 1;
    const offset = nextPage * PAGE_SIZE;
    const threshold = getDateThreshold(dateRange);

    const [alertsRes, actionsRes, emailsRes, factsRes, eventsRes] =
      await Promise.all([
        supabase
          .from("alerts")
          .select("id, title, severity, contact_name, account, alert_type, created_at")
          .gte("created_at", threshold)
          .order("created_at", { ascending: false })
          .range(offset, offset + PAGE_SIZE - 1),
        supabase
          .from("action_items")
          .select("id, description, priority, contact_name, contact_company, action_type, created_at")
          .gte("created_at", threshold)
          .order("created_at", { ascending: false })
          .range(offset, offset + PAGE_SIZE - 1),
        supabase
          .from("emails")
          .select("id, subject, sender, account, sender_type, email_date, created_at")
          .gte("email_date", threshold)
          .order("email_date", { ascending: false })
          .range(offset, offset + PAGE_SIZE - 1),
        supabase
          .from("facts")
          .select("id, fact_text, fact_type, confidence, source_account, created_at")
          .gte("created_at", threshold)
          .order("created_at", { ascending: false })
          .range(offset, offset + PAGE_SIZE - 1),
        supabase
          .from("pipeline_logs")
          .select("id, phase, level, message, details, created_at")
          .gte("created_at", threshold)
          .order("created_at", { ascending: false })
          .range(offset, offset + PAGE_SIZE - 1),
      ]);

    const merged = mergeAndSort(
      (alertsRes.data ?? []) as Alert[],
      (actionsRes.data ?? []) as ActionItem[],
      (emailsRes.data ?? []) as Email[],
      (factsRes.data ?? []) as Fact[],
      (eventsRes.data ?? []) as unknown as LogRow[]
    );

    const anySourceFull = [alertsRes, actionsRes, emailsRes, factsRes, eventsRes]
      .some((res) => (res.data ?? []).length >= PAGE_SIZE);

    setItems((prev) => [...prev, ...merged]);
    setHasMore(anySourceFull);
    setPage(nextPage);
    setLoadingMore(false);
  }, [page, dateRange]);

  const filtered = useMemo(() => {
    let result = items;
    if (typeFilter !== "all") {
      result = result.filter((i) => i.type === typeFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          i.subtitle?.toLowerCase().includes(q) ||
          i.metadata?.toLowerCase().includes(q)
      );
    }
    return result;
  }, [items, typeFilter, search]);

  // ── Stats ──

  const stats = useMemo(() => {
    const counts: Record<string, number> = { alert: 0, action: 0, email: 0, fact: 0, event: 0 };
    for (const item of items) {
      counts[item.type] = (counts[item.type] ?? 0) + 1;
    }
    return counts;
  }, [items]);

  // ── Render ──

  return (
    <div className="space-y-5">
      <PageHeader
        title="Timeline"
        description="Actividad del sistema en tiempo real"
      />

      {/* Quick Stats */}
      {!loading && items.length > 0 && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <MiniStatCard icon={Bell} label="Alertas" value={stats.alert} valueClassName="text-danger-foreground" />
          <MiniStatCard icon={CheckSquare} label="Acciones" value={stats.action} valueClassName="text-info-foreground" />
          <MiniStatCard icon={Mail} label="Emails" value={stats.email} valueClassName="text-success-foreground" />
          <MiniStatCard icon={Lightbulb} label="Hechos" value={stats.fact} valueClassName="text-warning-foreground" />
          <MiniStatCard icon={Activity} label="Eventos" value={stats.event} />
        </div>
      )}

      {/* Search + Filters */}
      <FilterBar search={search} onSearchChange={setSearch} searchPlaceholder="Buscar en timeline...">
        <Select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="w-32 shrink-0"
          aria-label="Filtrar por tipo"
        >
          <option value="all">Todos</option>
          <option value="alert">Alertas</option>
          <option value="action">Acciones</option>
          <option value="email">Emails</option>
          <option value="fact">Hechos</option>
          <option value="event">Eventos</option>
        </Select>

        <Select
          value={dateRange}
          onChange={(e) => setDateRange(e.target.value as DateRange)}
          className="w-40 shrink-0"
          aria-label="Rango de fechas"
        >
          <option value="today">Hoy</option>
          <option value="7d">Ultimos 7 dias</option>
          <option value="30d">Ultimos 30 dias</option>
        </Select>

        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {filtered.length} eventos
        </span>
      </FilterBar>

      {/* Loading */}
      {loading && <LoadingGrid stats={5} rows={8} statCols="4" />}

      {/* Empty state */}
      {!loading && filtered.length === 0 && (
        <EmptyState
          icon={Clock}
          title="Sin actividad"
          description={
            search
              ? "No se encontraron eventos con esa busqueda."
              : "No hay eventos en el periodo seleccionado."
          }
        />
      )}

      {/* Timeline */}
      {!loading && filtered.length > 0 && (
        <>
          <div className="relative ml-2 border-l-2 border-border pl-4 sm:ml-4 sm:pl-6">
            {filtered.map((item) => (
              <TimelineCard key={item.id} item={item} />
            ))}
          </div>

          {hasMore && (
            <div className="flex justify-center pt-4">
              <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? "Cargando..." : "Cargar mas"}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
