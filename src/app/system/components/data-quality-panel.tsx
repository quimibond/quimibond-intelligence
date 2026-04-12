"use client";

import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { AlertTriangle, CheckCircle2, RefreshCw, ShieldAlert, ShieldCheck, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ScorecardRow {
  category: string;
  metric: string;
  value: number;
  threshold: number;
  severity: "critical" | "high" | "medium";
  description: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  fk_integrity: "Integridad FK",
  duplicates: "Duplicados",
  freshness: "Frescura de datos",
  business_logic: "Logica de negocio",
  cost: "Costos API",
};

const SEVERITY_COLORS: Record<string, string> = {
  critical: "text-danger bg-danger/10 border-danger/20",
  high: "text-warning bg-warning/10 border-warning/20",
  medium: "text-muted-foreground bg-muted border-border",
};

export function DataQualityPanel() {
  const [rows, setRows] = useState<ScorecardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const { data, error } = await supabase
        .from("data_quality_scorecard")
        .select("*");
      if (error) throw error;
      setRows((data ?? []) as ScorecardRow[]);
      setLastUpdated(new Date());
    } catch (err) {
      console.error("[data-quality-panel]", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 5 * 60 * 1000); // 5 min
    return () => clearInterval(interval);
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-2">
        <div className="h-6 w-48 animate-pulse rounded bg-muted" />
        <div className="h-32 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }

  const failing = rows.filter(r => r.value > r.threshold);
  const passing = rows.filter(r => r.value <= r.threshold);
  const criticalCount = failing.filter(r => r.severity === "critical").length;
  const highCount = failing.filter(r => r.severity === "high").length;
  const mediumCount = failing.filter(r => r.severity === "medium").length;

  // Group failing by category
  const byCategory = failing.reduce((acc, row) => {
    (acc[row.category] ??= []).push(row);
    return acc;
  }, {} as Record<string, ScorecardRow[]>);

  // Overall health indicator
  const healthStatus = criticalCount > 0 ? "critical"
    : highCount > 0 ? "warning"
    : mediumCount > 0 ? "ok"
    : "excellent";

  const healthIcon = healthStatus === "critical" ? XCircle
    : healthStatus === "warning" ? ShieldAlert
    : healthStatus === "ok" ? ShieldCheck
    : CheckCircle2;
  const HealthIcon = healthIcon;

  const healthColor = healthStatus === "critical" ? "text-danger"
    : healthStatus === "warning" ? "text-warning"
    : "text-success";

  const healthLabel = healthStatus === "critical" ? "Critico"
    : healthStatus === "warning" ? "Advertencia"
    : healthStatus === "ok" ? "OK"
    : "Excelente";

  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between">
        <div>
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Calidad de Datos
          </h3>
          <p className="text-[11px] text-muted-foreground">
            {lastUpdated && `actualizado ${lastUpdated.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}`}
            {" · "}
            {passing.length}/{rows.length} checks OK
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={load} disabled={refreshing} className="h-7 w-7">
          <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
        </Button>
      </div>

      {/* Overall health card */}
      <Card className={cn("border-2",
        healthStatus === "critical" && "border-danger/40",
        healthStatus === "warning" && "border-warning/40",
        healthStatus === "ok" && "border-border",
        healthStatus === "excellent" && "border-success/40",
      )}>
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className={cn("rounded-lg p-2",
              healthStatus === "critical" && "bg-danger/10",
              healthStatus === "warning" && "bg-warning/10",
              healthStatus === "ok" && "bg-muted",
              healthStatus === "excellent" && "bg-success/10",
            )}>
              <HealthIcon className={cn("h-5 w-5", healthColor)} />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold">Estado general: {healthLabel}</p>
              <p className="text-xs text-muted-foreground">
                {failing.length === 0
                  ? "Todos los checks pasan dentro de umbrales"
                  : `${failing.length} checks con problemas: ${criticalCount} criticos, ${highCount} altos, ${mediumCount} medios`}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Failing checks grouped by category */}
      {failing.length > 0 && (
        <div className="space-y-3">
          {Object.entries(byCategory).map(([category, items]) => (
            <Card key={category}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <AlertTriangle className="h-3.5 w-3.5 text-warning" />
                  {CATEGORY_LABELS[category] ?? category}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 pt-0">
                {items.map((row) => (
                  <div key={row.metric} className={cn(
                    "flex items-start justify-between gap-3 rounded-lg border p-2.5 text-sm",
                    SEVERITY_COLORS[row.severity]
                  )}>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-medium tabular-nums">
                          {row.metric.replace(/_/g, " ")}
                        </p>
                        <Badge variant={row.severity === "critical" ? "critical" : row.severity === "high" ? "warning" : "outline"} className="text-[10px]">
                          {row.severity}
                        </Badge>
                      </div>
                      <p className="mt-0.5 text-xs opacity-90">{row.description}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-bold tabular-nums">{row.value.toLocaleString()}</p>
                      <p className="text-[10px] opacity-70">umbral {row.threshold}</p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {failing.length === 0 && (
        <Card>
          <CardContent className="p-4 text-center">
            <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-success" />
            <p className="text-sm font-medium">Todos los {rows.length} checks pasan</p>
            <p className="text-xs text-muted-foreground">
              El sistema esta operando dentro de umbrales saludables
            </p>
          </CardContent>
        </Card>
      )}
    </section>
  );
}
