"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/utils";
import {
  AlertTriangle,
  Check,
  Eye,
  Shield,
  Crosshair,
  Activity,
  Flame,
} from "lucide-react";

interface Alert {
  id: string;
  alert_type: string;
  severity: string;
  title: string;
  description: string;
  contact_name: string;
  contact_id: string;
  created_at: string;
  state: string;
  is_read: boolean;
}

const typeLabel: Record<string, string> = {
  no_response: "Sin respuesta",
  stalled_thread: "Thread estancado",
  sentiment: "Sentimiento",
  negative_sentiment: "Sentimiento negativo",
  competitor: "Competidor",
  churn_risk: "Riesgo de fuga",
  invoice_silence: "Factura + silencio",
  high_volume: "Alto volumen",
  accountability: "Cumplimiento",
  opportunity: "Oportunidad",
  risk: "Riesgo",
  communication_gap: "Comunicacion",
};

const typeIcon: Record<string, string> = {
  no_response: "clock",
  stalled_thread: "pause",
  competitor: "swords",
  churn_risk: "trending-down",
  invoice_silence: "dollar",
  negative_sentiment: "frown",
};

function getSeverityConfig(severity: string) {
  switch (severity) {
    case "critical":
      return { color: "text-red-400", bg: "bg-red-500/10", border: "border-l-red-500", glow: "alert-pulse-critical", label: "CRITICO" };
    case "high":
      return { color: "text-amber-400", bg: "bg-amber-500/10", border: "border-l-amber-500", glow: "alert-pulse-high", label: "ALTO" };
    case "medium":
      return { color: "text-cyan-400", bg: "bg-cyan-500/10", border: "border-l-cyan-400", glow: "alert-pulse-medium", label: "MEDIO" };
    default:
      return { color: "text-gray-400", bg: "", border: "border-l-gray-500", glow: "", label: "BAJO" };
  }
}

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [stateFilter, setStateFilter] = useState<string>("new");
  const [counts, setCounts] = useState({ new: 0, acknowledged: 0, resolved: 0, all: 0 });

  useEffect(() => {
    async function fetchAlerts() {
      // Fetch alerts
      let query = supabase
        .from("alerts")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);

      if (stateFilter !== "all") {
        query = query.eq("state", stateFilter);
      }

      const { data } = await query;
      setAlerts(data || []);
      setLoading(false);
    }

    async function fetchCounts() {
      const [newRes, ackRes, resRes, allRes] = await Promise.all([
        supabase.from("alerts").select("id", { count: "exact", head: true }).eq("state", "new"),
        supabase.from("alerts").select("id", { count: "exact", head: true }).eq("state", "acknowledged"),
        supabase.from("alerts").select("id", { count: "exact", head: true }).eq("state", "resolved"),
        supabase.from("alerts").select("id", { count: "exact", head: true }),
      ]);
      setCounts({
        new: newRes.count ?? 0,
        acknowledged: ackRes.count ?? 0,
        resolved: resRes.count ?? 0,
        all: allRes.count ?? 0,
      });
    }

    fetchAlerts();
    fetchCounts();
  }, [stateFilter]);

  async function markRead(id: string) {
    await supabase.from("alerts").update({ is_read: true, state: "acknowledged" }).eq("id", id);
    setAlerts((prev) =>
      prev.map((a) => (a.id === id ? { ...a, is_read: true, state: "acknowledged" } : a))
    );
    setCounts((c) => ({ ...c, new: Math.max(0, c.new - 1), acknowledged: c.acknowledged + 1 }));
  }

  async function resolve(id: string) {
    await supabase.from("alerts").update({ state: "resolved" }).eq("id", id);
    setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, state: "resolved" } : a)));
    setCounts((c) => {
      const wasNew = alerts.find((a) => a.id === id)?.state === "new";
      return {
        ...c,
        new: wasNew ? Math.max(0, c.new - 1) : c.new,
        acknowledged: wasNew ? c.acknowledged : Math.max(0, c.acknowledged - 1),
        resolved: c.resolved + 1,
      };
    });
  }

  // Severity distribution
  const criticalCount = alerts.filter((a) => a.severity === "critical").length;
  const highCount = alerts.filter((a) => a.severity === "high").length;
  const mediumCount = alerts.filter((a) => a.severity === "medium").length;
  const lowCount = alerts.filter((a) => a.severity === "low").length;

  const stateFilters = [
    { key: "new", label: "Nuevas", count: counts.new, color: "text-red-400" },
    { key: "acknowledged", label: "Vistas", count: counts.acknowledged, color: "text-amber-400" },
    { key: "resolved", label: "Resueltas", count: counts.resolved, color: "text-emerald-400" },
    { key: "all", label: "Todas", count: counts.all, color: "text-[var(--muted-foreground)]" },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <Crosshair className="h-6 w-6 text-amber-400" />
            <h1 className="text-2xl font-black tracking-tight">Radar de Amenazas</h1>
          </div>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">
            Alertas de inteligencia sobre clientes y operaciones
          </p>
        </div>
        {counts.new > 0 && (
          <div className="flex items-center gap-2 text-xs text-red-400">
            <Flame className="h-4 w-4" />
            <span className="font-bold">{counts.new} sin revisar</span>
          </div>
        )}
      </div>

      {/* Severity Distribution + Filters */}
      <div className="flex items-center gap-4 flex-wrap">
        {/* Severity mini stats */}
        <div className="hidden md:flex items-center gap-3 mr-auto">
          {criticalCount > 0 && (
            <span className="flex items-center gap-1 text-xs text-red-400 font-bold">
              <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
              {criticalCount} criticas
            </span>
          )}
          {highCount > 0 && (
            <span className="flex items-center gap-1 text-xs text-amber-400">
              <span className="w-2 h-2 rounded-full bg-amber-400" />
              {highCount} altas
            </span>
          )}
          {mediumCount > 0 && (
            <span className="flex items-center gap-1 text-xs text-cyan-400">
              <span className="w-2 h-2 rounded-full bg-cyan-400" />
              {mediumCount} medias
            </span>
          )}
          {lowCount > 0 && (
            <span className="flex items-center gap-1 text-xs text-gray-400">
              <span className="w-2 h-2 rounded-full bg-gray-400" />
              {lowCount} bajas
            </span>
          )}
        </div>

        {/* State filters */}
        <div className="flex items-center gap-1">
          {stateFilters.map((f) => (
            <button
              key={f.key}
              onClick={() => { setStateFilter(f.key); setLoading(true); }}
              className={cn(
                "px-3 py-2 rounded-lg text-xs font-medium transition-colors",
                stateFilter === f.key
                  ? "bg-[var(--secondary)] text-[var(--foreground)] border border-[var(--border)]"
                  : "text-[var(--muted-foreground)] hover:bg-[var(--secondary)]/50",
              )}
            >
              {f.label}
              <span className={cn("ml-1 tabular-nums", f.color)}>{f.count}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Alert List */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Activity className="h-6 w-6 text-amber-400 animate-pulse" />
        </div>
      ) : alerts.length === 0 ? (
        <div className="game-card rounded-lg bg-[var(--card)] p-12 text-center">
          <Shield className="h-12 w-12 mx-auto mb-3 text-emerald-400 opacity-40" />
          <p className="text-sm font-medium">Perimetro seguro</p>
          <p className="text-xs text-[var(--muted-foreground)] mt-1">No hay alertas en esta categoria</p>
        </div>
      ) : (
        <div className="space-y-2">
          {alerts.map((alert) => {
            const config = getSeverityConfig(alert.severity);
            const isNew = alert.state === "new" && !alert.is_read;

            return (
              <div
                key={alert.id}
                className={cn(
                  "game-card rounded-lg bg-[var(--card)] p-4 border-l-3 transition-all",
                  config.border,
                  isNew && config.glow,
                  isNew && config.bg,
                )}
              >
                <div className="flex items-start gap-4">
                  {/* Severity indicator */}
                  <div className={cn(
                    "w-10 h-10 rounded-lg flex items-center justify-center shrink-0",
                    config.bg,
                  )}>
                    <AlertTriangle className={cn("h-5 w-5", config.color)} />
                  </div>

                  <div className="flex-1 min-w-0">
                    {/* Badges */}
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className={cn("text-[10px] font-bold uppercase tracking-wider", config.color)}>
                        {config.label}
                      </span>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        {typeLabel[alert.alert_type] || alert.alert_type}
                      </Badge>
                      {alert.contact_name && (
                        <span className="text-xs text-[var(--muted-foreground)]">
                          {alert.contact_id ? (
                            <a href={`/contacts/${alert.contact_id}`} className="hover:text-[var(--primary)] transition-colors">
                              {alert.contact_name}
                            </a>
                          ) : (
                            alert.contact_name
                          )}
                        </span>
                      )}
                      {isNew && (
                        <span className="flex items-center gap-1 text-[10px] font-bold text-red-400">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                          NUEVA
                        </span>
                      )}
                    </div>

                    {/* Content */}
                    <p className="text-sm font-medium">{alert.title}</p>
                    {alert.description && (
                      <p className="mt-1 text-sm text-[var(--muted-foreground)] line-clamp-2">{alert.description}</p>
                    )}
                    <span className="text-[10px] text-[var(--muted-foreground)] mt-1 block">{timeAgo(alert.created_at)}</span>
                  </div>

                  {/* Actions */}
                  <div className="flex shrink-0 gap-1">
                    {alert.state === "new" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => markRead(alert.id)}
                        title="Marcar como vista"
                        className="h-8 w-8"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {alert.state !== "resolved" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => resolve(alert.id)}
                        title="Resolver"
                        className="h-8 w-8 hover:text-emerald-400"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
