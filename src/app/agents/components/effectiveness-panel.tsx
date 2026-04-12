"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { TrendingUp, TrendingDown, Activity, DollarSign, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn, formatCurrency, formatCurrencyCompact, formatPercentage } from "@/lib/utils";

interface EffectivenessRow {
  agent_id: number;
  slug: string;
  name: string;
  domain: string;
  is_active: boolean;
  total_insights: number;
  insights_7d: number;
  state_acted: number;
  state_dismissed: number;
  state_expired: number;
  acted_rate_pct: number | null;
  dismiss_rate_pct: number | null;
  expire_rate_pct: number | null;
  avg_confidence: number | null;
  avg_impact_mxn: number | null;
  impact_delivered_mxn: number | null;
  impact_expired_mxn: number | null;
  runs_24h: number;
  last_run_at: string | null;
}

const fmtK = (n: number | null) => formatCurrencyCompact(n);

export function EffectivenessPanel() {
  const [rows, setRows] = useState<EffectivenessRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const { data, error } = await supabase
        .from("agent_effectiveness")
        .select("*")
        .order("acted_rate_pct", { ascending: false, nullsFirst: false });
      if (error) throw error;
      setRows((data ?? []) as EffectivenessRow[]);
    } catch (err) {
      console.error("[effectiveness]", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return <div className="h-40 animate-pulse rounded-xl bg-muted" />;
  }

  // Totals
  const totalDelivered = rows.reduce((s, r) => s + (r.impact_delivered_mxn || 0), 0);
  const totalExpired = rows.reduce((s, r) => s + (r.impact_expired_mxn || 0), 0);
  const totalInsights = rows.reduce((s, r) => s + r.total_insights, 0);
  const totalActed = rows.reduce((s, r) => s + r.state_acted, 0);
  const overallActedPct = totalInsights > 0 ? (totalActed / totalInsights) * 100 : 0;

  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between">
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Efectividad de Agentes
          </h3>
          <p className="text-[11px] text-muted-foreground">
            Mide que tan util es cada agente por su acted rate
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={load} disabled={refreshing} className="h-7 w-7">
          <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
        </Button>
      </div>

      {/* Global KPIs */}
      <div className="grid gap-2 grid-cols-2 sm:grid-cols-4">
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <Activity className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Total insights</p>
            </div>
            <p className="mt-1 text-xl font-bold tabular-nums">{totalInsights}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-3.5 w-3.5 text-success" />
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Acted rate</p>
            </div>
            <p className="mt-1 text-xl font-bold tabular-nums">{formatPercentage(overallActedPct, { decimals: 1 })}</p>
            <p className="text-[10px] text-muted-foreground tabular-nums">{totalActed} de {totalInsights}</p>
          </CardContent>
        </Card>

        <Card className="border-success/40">
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <DollarSign className="h-3.5 w-3.5 text-success" />
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Entregado</p>
            </div>
            <p className="mt-1 text-xl font-bold tabular-nums text-success">{fmtK(totalDelivered)}</p>
            <p className="text-[10px] text-muted-foreground">Impacto ACTED MXN</p>
          </CardContent>
        </Card>

        <Card className="border-warning/40">
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <TrendingDown className="h-3.5 w-3.5 text-warning" />
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Expirado</p>
            </div>
            <p className="mt-1 text-xl font-bold tabular-nums text-warning">{fmtK(totalExpired)}</p>
            <p className="text-[10px] text-muted-foreground">Impacto perdido MXN</p>
          </CardContent>
        </Card>
      </div>

      {/* Per-agent table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Agentes por efectividad</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="space-y-2">
            {rows.map((row) => {
              const actedRate = row.acted_rate_pct ?? 0;
              const healthColor = actedRate >= 20 ? "text-success bg-success/10"
                : actedRate >= 10 ? "text-warning bg-warning/10"
                : "text-danger bg-danger/10";
              const healthLabel = actedRate >= 20 ? "Util"
                : actedRate >= 10 ? "Marginal"
                : "Bajo";

              return (
                <div key={row.agent_id} className="flex items-center gap-3 rounded-lg border p-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{row.name}</span>
                      <Badge className={cn("text-[10px]", healthColor)} variant="outline">
                        {healthLabel}
                      </Badge>
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-[11px] text-muted-foreground tabular-nums">
                      <span>{row.total_insights} insights</span>
                      <span className="text-success">{row.state_acted} acted</span>
                      <span className="text-warning">{row.state_dismissed} dismissed</span>
                      <span>{row.state_expired} expired</span>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={cn("text-lg font-bold tabular-nums",
                      actedRate >= 20 ? "text-success" : actedRate >= 10 ? "text-warning" : "text-danger"
                    )}>
                      {formatPercentage(actedRate)}
                    </p>
                    <p className="text-[10px] text-muted-foreground tabular-nums">
                      {fmtK(row.impact_delivered_mxn)} entregado
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
