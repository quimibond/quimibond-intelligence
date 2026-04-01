"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { timeAgo } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { Activity, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";

interface PipelineInfo {
  status: "success" | "running" | "error" | "unknown";
  lastRun: string | null;
  runType: string | null;
}

export function PipelineStatus({ collapsed }: { collapsed: boolean }) {
  const [info, setInfo] = useState<PipelineInfo>({ status: "unknown", lastRun: null, runType: null });

  useEffect(() => {
    async function fetch() {
      const { data } = await supabase
        .from("pipeline_runs")
        .select("status, started_at, run_type")
        .order("started_at", { ascending: false })
        .limit(1)
        .single();

      if (data) {
        setInfo({
          status: data.status === "running" ? "running" : data.status === "completed" ? "success" : data.status === "error" ? "error" : "unknown",
          lastRun: data.started_at,
          runType: data.run_type,
        });
      }
    }
    fetch();
    const interval = setInterval(fetch, 60_000); // refresh every minute
    return () => clearInterval(interval);
  }, []);

  const statusConfig = {
    success: { icon: CheckCircle2, color: "text-success", label: "OK" },
    running: { icon: Loader2, color: "text-info animate-spin", label: "Ejecutando" },
    error: { icon: AlertCircle, color: "text-danger", label: "Error" },
    unknown: { icon: Activity, color: "text-muted-foreground", label: "—" },
  };

  const cfg = statusConfig[info.status];
  const Icon = cfg.icon;

  return (
    <div
      className={cn(
        "flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground",
        collapsed && "md:justify-center md:px-0"
      )}
      title={
        collapsed
          ? `Pipeline: ${cfg.label}${info.lastRun ? ` (${timeAgo(info.lastRun)})` : ""}`
          : undefined
      }
    >
      <Icon className={cn("h-3.5 w-3.5 shrink-0", cfg.color)} />
      <div className={cn("min-w-0 flex-1", collapsed && "md:hidden")}>
        <span className="font-medium">{cfg.label}</span>
        {info.lastRun && (
          <span className="ml-1 text-muted-foreground/70">
            {timeAgo(info.lastRun)}
          </span>
        )}
      </div>
    </div>
  );
}
