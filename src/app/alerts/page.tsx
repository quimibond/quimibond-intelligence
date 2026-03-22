"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
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

const severityToBadge: Record<string, "critical" | "high" | "medium" | "low"> = {
  critical: "critical",
  high: "high",
  medium: "medium",
  low: "low",
};

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [stateFilter, setStateFilter] = useState<string>("new");
  const [counts, setCounts] = useState({ new: 0, acknowledged: 0, resolved: 0, all: 0 });

  useEffect(() => {
    async function fetchAlerts() {
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

  const severityCounts = {
    critical: alerts.filter((a) => a.severity === "critical").length,
    high: alerts.filter((a) => a.severity === "high").length,
    medium: alerts.filter((a) => a.severity === "medium").length,
    low: alerts.filter((a) => a.severity === "low").length,
  };

  const stateFilters = [
    { key: "new", label: "Nuevas", count: counts.new },
    { key: "acknowledged", label: "Vistas", count: counts.acknowledged },
    { key: "resolved", label: "Resueltas", count: counts.resolved },
    { key: "all", label: "Todas", count: counts.all },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <Crosshair className="h-6 w-6 text-[var(--warning)]" />
            <h1 className="text-2xl font-black tracking-tight">Radar de Amenazas</h1>
          </div>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">
            Alertas de inteligencia sobre clientes y operaciones
          </p>
        </div>
        {counts.new > 0 && (
          <div className="flex items-center gap-2 text-xs text-[var(--destructive)]">
            <Flame className="h-4 w-4" />
            <span className="font-bold">{counts.new} sin revisar</span>
          </div>
        )}
      </div>

      {/* Severity Stats + Filters */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="hidden md:flex items-center gap-3 mr-auto">
          {severityCounts.critical > 0 && (
            <span className="flex items-center gap-1.5 text-xs font-bold text-[var(--severity-critical)]">
              <span className="severity-dot animate-pulse" data-severity="critical" />
              {severityCounts.critical} criticas
            </span>
          )}
          {severityCounts.high > 0 && (
            <span className="flex items-center gap-1.5 text-xs text-[var(--severity-high)]">
              <span className="severity-dot" data-severity="high" />
              {severityCounts.high} altas
            </span>
          )}
          {severityCounts.medium > 0 && (
            <span className="flex items-center gap-1.5 text-xs text-[var(--severity-medium)]">
              <span className="severity-dot" data-severity="medium" />
              {severityCounts.medium} medias
            </span>
          )}
          {severityCounts.low > 0 && (
            <span className="flex items-center gap-1.5 text-xs text-[var(--severity-low)]">
              <span className="severity-dot" data-severity="low" />
              {severityCounts.low} bajas
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {stateFilters.map((f) => (
            <button
              key={f.key}
              onClick={() => { setStateFilter(f.key); setLoading(true); }}
              className={cn(
                "px-3 py-2 rounded-lg text-xs font-medium transition-colors",
                stateFilter === f.key
                  ? "bg-[var(--secondary)] text-[var(--foreground)] border border-[var(--border)]"
                  : "text-[var(--muted-foreground)] hover:bg-[var(--accent)]",
              )}
            >
              {f.label}
              <span className="ml-1 tabular-nums">{f.count}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Alert List */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Activity className="h-6 w-6 text-[var(--warning)] animate-pulse" />
        </div>
      ) : alerts.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Shield className="h-12 w-12 mb-3 text-[var(--success)] opacity-40" />
            <p className="text-sm font-medium">Perimetro seguro</p>
            <p className="text-xs text-[var(--muted-foreground)] mt-1">No hay alertas en esta categoria</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {alerts.map((alert) => {
            const isNew = alert.state === "new" && !alert.is_read;
            const severityVar = `var(--severity-${alert.severity || "low"})`;
            const severityMutedVar = `var(--severity-${alert.severity || "low"}-muted)`;

            return (
              <Card
                key={alert.id}
                className={cn(
                  "transition-all",
                  isNew && "border-l-3",
                )}
                style={isNew ? {
                  borderLeftColor: severityVar,
                  backgroundColor: severityMutedVar,
                } : undefined}
              >
                <CardContent className="flex items-start gap-4 p-4">
                  {/* Severity icon */}
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                    style={{ backgroundColor: severityMutedVar }}
                  >
                    <AlertTriangle className="h-5 w-5" style={{ color: severityVar }} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <Badge variant={severityToBadge[alert.severity] || "low"}>
                        {alert.severity}
                      </Badge>
                      <Badge variant="outline">
                        {typeLabel[alert.alert_type] || alert.alert_type}
                      </Badge>
                      {alert.contact_name && (
                        <span className="text-xs text-[var(--muted-foreground)]">
                          {alert.contact_id ? (
                            <a href={`/contacts/${alert.contact_id}`} className="hover:text-[var(--primary)] transition-colors">
                              {alert.contact_name}
                            </a>
                          ) : alert.contact_name}
                        </span>
                      )}
                      {isNew && (
                        <span className="flex items-center gap-1 text-[10px] font-bold text-[var(--destructive)]">
                          <span className="w-1.5 h-1.5 rounded-full bg-[var(--destructive)] animate-pulse" />
                          NUEVA
                        </span>
                      )}
                    </div>

                    <p className="text-sm font-medium">{alert.title}</p>
                    {alert.description && (
                      <p className="mt-1 text-sm text-[var(--muted-foreground)] line-clamp-2">{alert.description}</p>
                    )}
                    <span className="text-[10px] text-[var(--muted-foreground)] mt-1 block">{timeAgo(alert.created_at)}</span>
                  </div>

                  <div className="flex shrink-0 gap-1">
                    {alert.state === "new" && (
                      <Button variant="ghost" size="icon" onClick={() => markRead(alert.id)} title="Marcar como vista" className="h-8 w-8">
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {alert.state !== "resolved" && (
                      <Button variant="ghost" size="icon" onClick={() => resolve(alert.id)} title="Resolver" className="h-8 w-8 hover:text-[var(--success)]">
                        <Check className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
