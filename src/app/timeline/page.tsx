"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  Bell,
  CheckSquare,
  Clock,
  Lightbulb,
  Mail,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { timeAgo } from "@/lib/utils";
import type { Alert, ActionItem, Email, Fact } from "@/lib/types";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { SeverityBadge } from "@/components/shared/severity-badge";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

// ── Types ──

type TimelineItemType = "alert" | "action" | "email" | "fact" | "event";

interface TimelineItem {
  id: string;
  rawId: number;
  type: TimelineItemType;
  title: string;
  subtitle: string | null;
  metadata: string | null;
  created_at: string;
  severity?: string;
  priority?: string;
  confidence?: number;
}

type DateRange = "today" | "7d" | "30d";

// ── Config ──

const typeConfig: Record<
  TimelineItemType,
  { icon: React.ElementType; color: string; dotColor: string; label: string; badgeVariant: "info" | "warning" | "success" | "secondary" | "default" }
> = {
  alert: { icon: Bell, color: "text-red-500", dotColor: "bg-red-500", label: "Alerta", badgeVariant: "warning" },
  action: { icon: CheckSquare, color: "text-blue-500", dotColor: "bg-blue-500", label: "Accion", badgeVariant: "info" },
  email: { icon: Mail, color: "text-emerald-500", dotColor: "bg-emerald-500", label: "Email", badgeVariant: "success" },
  fact: { icon: Lightbulb, color: "text-amber-500", dotColor: "bg-amber-500", label: "Hecho", badgeVariant: "secondary" },
  event: { icon: Activity, color: "text-purple-500", dotColor: "bg-purple-500", label: "Evento", badgeVariant: "default" },
};

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

// ── Component ──

export default function TimelinePage() {
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [dateRange, setDateRange] = useState<DateRange>("7d");

  useEffect(() => {
    async function fetchAll() {
      setLoading(true);
      const threshold = getDateThreshold(dateRange);

      const [alertsRes, actionsRes, emailsRes, factsRes, eventsRes] =
        await Promise.all([
          supabase
            .from("alerts")
            .select("id, title, severity, contact_name, account, alert_type, created_at")
            .gte("created_at", threshold)
            .order("created_at", { ascending: false })
            .limit(50),
          supabase
            .from("action_items")
            .select("id, description, priority, contact_name, contact_company, action_type, created_at")
            .gte("created_at", threshold)
            .order("created_at", { ascending: false })
            .limit(50),
          supabase
            .from("emails")
            .select("id, subject, sender, account, sender_type, created_at")
            .gte("created_at", threshold)
            .order("created_at", { ascending: false })
            .limit(50),
          supabase
            .from("facts")
            .select("id, fact_text, fact_type, confidence, source_account, created_at")
            .gte("created_at", threshold)
            .order("created_at", { ascending: false })
            .limit(30),
          supabase
            .from("pipeline_logs")
            .select("id, phase, level, message, details, created_at")
            .gte("created_at", threshold)
            .order("created_at", { ascending: false })
            .limit(30),
        ]);

      const merged: TimelineItem[] = [];

      for (const a of (alertsRes.data ?? []) as Alert[]) {
        merged.push({
          id: `alert-${a.id}`,
          rawId: a.id,
          type: "alert",
          title: a.title,
          subtitle: a.contact_name,
          metadata: a.account ?? a.alert_type,
          created_at: a.created_at,
          severity: a.severity,
        });
      }

      for (const a of (actionsRes.data ?? []) as ActionItem[]) {
        merged.push({
          id: `action-${a.id}`,
          rawId: a.id,
          type: "action",
          title: a.description,
          subtitle: a.contact_name,
          metadata: a.contact_company,
          created_at: a.created_at,
          priority: a.priority,
        });
      }

      for (const e of (emailsRes.data ?? []) as Email[]) {
        merged.push({
          id: `email-${e.id}`,
          rawId: e.id,
          type: "email",
          title: e.subject ?? "(sin asunto)",
          subtitle: e.sender,
          metadata: e.account,
          created_at: e.created_at,
        });
      }

      for (const f of (factsRes.data ?? []) as Fact[]) {
        merged.push({
          id: `fact-${f.id}`,
          rawId: f.id,
          type: "fact",
          title: f.fact_text,
          subtitle: f.fact_type,
          metadata: f.source_account,
          created_at: f.created_at,
          confidence: f.confidence,
        });
      }

      type LogRow = {
        id: string;
        phase: string | null;
        level: string;
        message: string | null;
        details: Record<string, unknown> | null;
        created_at: string;
      };

      for (const ev of (eventsRes.data ?? []) as unknown as LogRow[]) {
        const summary = summarizePayload(ev.details);
        merged.push({
          id: `event-${ev.id}`,
          rawId: ev.id as unknown as number,
          type: "event",
          title: ev.phase ?? ev.level,
          subtitle: ev.message ?? summary,
          metadata: ev.level !== "info" ? ev.level : null,
          created_at: ev.created_at,
        });
      }

      merged.sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

      setItems(merged);
      setLoading(false);
    }

    fetchAll();
  }, [dateRange]);

  const filtered = useMemo(() => {
    if (typeFilter === "all") return items;
    return items.filter((i) => i.type === typeFilter);
  }, [items, typeFilter]);

  // ── Loading ──

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-5 w-80" />
        <div className="flex gap-3">
          <Skeleton className="h-9 w-40" />
          <Skeleton className="h-9 w-40" />
        </div>
        <div className="space-y-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex gap-4">
              <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Render ──

  return (
    <div className="space-y-6">
      <PageHeader
        title="Timeline"
        description="Actividad del sistema en tiempo real"
      />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
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
        >
          <option value="today">Hoy</option>
          <option value="7d">Ultimos 7 dias</option>
          <option value="30d">Ultimos 30 dias</option>
        </Select>

        <span className="text-xs text-muted-foreground">
          {filtered.length} eventos
        </span>
      </div>

      {/* Timeline */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={Clock}
          title="Sin actividad"
          description="No hay eventos en el periodo seleccionado."
        />
      ) : (
        <div className="relative ml-2 border-l-2 border-border pl-4 sm:ml-4 sm:pl-6">
          {filtered.map((item) => {
            const cfg = typeConfig[item.type];
            const Icon = cfg.icon;

            return (
              <div key={item.id} className="relative pb-8 last:pb-0">
                {/* Dot on the timeline */}
                <div className="absolute -left-[calc(1.5rem+5px)] flex h-4 w-4 items-center justify-center rounded-full border-2 border-background bg-muted">
                  <div className={`h-2 w-2 rounded-full ${cfg.dotColor}`} />
                </div>

                {/* Content card */}
                {(() => {
                  const linkMap: Record<string, string> = {
                    alert: `/alerts/${item.rawId}`,
                    email: `/emails/${item.rawId}`,
                    action: `/actions`,
                    fact: `/knowledge`,
                  };
                  const href = linkMap[item.type];
                  const Wrapper = href ? Link : "div";
                  const wrapperProps = href ? { href } : {};
                  return (
                    // @ts-expect-error dynamic component
                    <Wrapper {...wrapperProps} className="block rounded-lg border bg-card p-4 shadow-sm transition-colors hover:bg-accent/50">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${cfg.color}`} />
                      <div className="min-w-0 space-y-1">
                        <p className="text-sm font-medium leading-snug">
                          {item.title}
                        </p>
                        {item.subtitle && (
                          <p className="text-xs text-muted-foreground truncate">
                            {item.subtitle}
                          </p>
                        )}
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={cfg.badgeVariant} className="text-[10px]">
                            {cfg.label}
                          </Badge>
                          {item.severity && (
                            <SeverityBadge severity={item.severity} />
                          )}
                          {item.priority && (
                            <Badge variant="outline" className="text-[10px]">
                              {item.priority}
                            </Badge>
                          )}
                          {item.confidence != null && (
                            <Badge variant="outline" className="text-[10px]">
                              {Math.round(item.confidence * 100)}%
                            </Badge>
                          )}
                          {item.metadata && (
                            <span className="text-[10px] text-muted-foreground">
                              {item.metadata}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <span className="shrink-0 text-[11px] text-muted-foreground whitespace-nowrap">
                      {timeAgo(item.created_at)}
                    </span>
                  </div>
                    </Wrapper>
                  );
                })()}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
