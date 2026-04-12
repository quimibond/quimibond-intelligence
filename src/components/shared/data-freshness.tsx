"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { timeAgo } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { Clock, Loader2 } from "lucide-react";

interface DataFreshnessProps {
  className?: string;
}

export function DataFreshness({ className }: DataFreshnessProps) {
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [freshness, setFreshness] = useState<"fresh" | "stale" | "old">("fresh");
  const [running, setRunning] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const [logRes, runRes] = await Promise.all([
        supabase
          .from("pipeline_logs")
          .select("created_at")
          .order("created_at", { ascending: false })
          .limit(1)
          .single(),
        supabase
          .from("agent_runs")
          .select("id")
          .eq("status", "running")
          .limit(1),
      ]);

      if (cancelled) return;

      if (logRes.data?.created_at) {
        setLastSync(logRes.data.created_at);
        const hoursAgo = (Date.now() - new Date(logRes.data.created_at).getTime()) / 3600000;
        setFreshness(hoursAgo < 2 ? "fresh" : hoursAgo < 6 ? "stale" : "old");
      }

      setRunning((runRes.data?.length ?? 0) > 0);
    }

    load();
    const interval = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (!lastSync) return null;

  const colors = {
    fresh: "text-success",
    stale: "text-warning",
    old: "text-danger",
  };

  return (
    <span className={cn("inline-flex items-center gap-2 text-xs text-muted-foreground", className)}>
      <span className="inline-flex items-center gap-1">
        <Clock className={cn("h-3 w-3", colors[freshness])} />
        Datos de {timeAgo(lastSync)}
      </span>
      {running && (
        <span className="inline-flex items-center gap-1 text-primary" aria-live="polite">
          <Loader2 className="h-3 w-3 animate-spin" />
          Agente ejecutándose
        </span>
      )}
    </span>
  );
}
