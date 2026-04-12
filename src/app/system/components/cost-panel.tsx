"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { DollarSign, TrendingUp, Zap, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency } from "@/lib/utils";

interface CostRow {
  endpoint: string;
  model: string;
  calls: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost_usd: number;
  cost_24h: number;
  cost_7d: number;
  cost_30d: number;
  calls_24h: number;
  last_call: string | null;
}

const USD_TO_MXN = 17.5;

function fmtUSD(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}K`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(3)}`;
}

export function CostPanel() {
  const [rows, setRows] = useState<CostRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const { data, error } = await supabase
        .from("claude_cost_summary")
        .select("*")
        .order("cost_7d", { ascending: false, nullsFirst: false });
      if (error) throw error;
      setRows((data ?? []) as CostRow[]);
    } catch (err) {
      console.error("[cost-panel]", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-2">
        <div className="h-6 w-48 animate-pulse rounded bg-muted" />
        <div className="h-32 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }

  const total24h = rows.reduce((s, r) => s + (r.cost_24h || 0), 0);
  const total7d = rows.reduce((s, r) => s + (r.cost_7d || 0), 0);
  const total30d = rows.reduce((s, r) => s + (r.cost_30d || 0), 0);
  const calls24h = rows.reduce((s, r) => s + (r.calls_24h || 0), 0);
  const projectedMonthly = total7d * (30 / 7);

  const top5 = rows.filter(r => r.cost_7d > 0).slice(0, 5);

  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Costos Claude API
        </h3>
        <Button variant="ghost" size="icon" onClick={load} disabled={refreshing} className="h-7 w-7">
          <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
        </Button>
      </div>

      {/* KPI row */}
      <div className="grid gap-2 grid-cols-2 sm:grid-cols-4">
        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Hoy</p>
            </div>
            <p className="mt-1 text-xl font-bold tabular-nums">{fmtUSD(total24h)}</p>
            <p className="text-[10px] text-muted-foreground tabular-nums">
              {calls24h} calls · ~{formatCurrency(total24h * USD_TO_MXN)} MXN
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">7d</p>
            </div>
            <p className="mt-1 text-xl font-bold tabular-nums">{fmtUSD(total7d)}</p>
            <p className="text-[10px] text-muted-foreground tabular-nums">
              proyectado mes: {fmtUSD(projectedMonthly)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <Zap className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">30d</p>
            </div>
            <p className="mt-1 text-xl font-bold tabular-nums">{fmtUSD(total30d)}</p>
            <p className="text-[10px] text-muted-foreground tabular-nums">
              ~{formatCurrency(total30d * USD_TO_MXN)} MXN
            </p>
          </CardContent>
        </Card>

        <Card className={cn(total24h > 20 && "border-warning/40 bg-warning/5")}>
          <CardContent className="p-3">
            <div className="flex items-center gap-2">
              <div className={cn("h-2 w-2 rounded-full",
                total24h > 20 ? "bg-danger" : total24h > 10 ? "bg-warning" : "bg-success"
              )} />
              <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Status</p>
            </div>
            <p className="mt-1 text-xl font-bold">
              {total24h > 20 ? "Alto" : total24h > 10 ? "Normal" : "OK"}
            </p>
            <p className="text-[10px] text-muted-foreground">
              umbral diario: $20
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Top 5 endpoints */}
      {top5.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Top 5 endpoints (ultimos 7 dias)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 pt-0">
            {top5.map((row, i) => {
              const pct = total7d > 0 ? (row.cost_7d / total7d) * 100 : 0;
              return (
                <div key={`${row.endpoint}-${row.model}`} className="flex items-center justify-between text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="w-5 shrink-0 text-xs text-muted-foreground tabular-nums">
                        {i + 1}.
                      </span>
                      <span className="truncate font-medium">{row.endpoint}</span>
                      <span className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">
                        {row.model.includes("sonnet") ? "S4.6" : row.model.includes("haiku") ? "H4.5" : row.model}
                      </span>
                    </div>
                    <div className="ml-7 mt-0.5 h-1 overflow-hidden rounded bg-muted">
                      <div className="h-full bg-primary/60" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <div className="ml-3 shrink-0 text-right">
                    <p className="text-sm font-bold tabular-nums">{fmtUSD(row.cost_7d)}</p>
                    <p className="text-[10px] text-muted-foreground tabular-nums">{pct.toFixed(0)}%</p>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </section>
  );
}
