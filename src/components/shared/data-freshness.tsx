"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { timeAgo } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { Clock } from "lucide-react";

interface DataFreshnessProps {
  className?: string;
}

export function DataFreshness({ className }: DataFreshnessProps) {
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [freshness, setFreshness] = useState<"fresh" | "stale" | "old">("fresh");

  useEffect(() => {
    async function fetch() {
      const { data } = await supabase
        .from("pipeline_logs")
        .select("created_at")
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (data?.created_at) {
        setLastSync(data.created_at);
        const hoursAgo = (Date.now() - new Date(data.created_at).getTime()) / 3600000;
        setFreshness(hoursAgo < 2 ? "fresh" : hoursAgo < 6 ? "stale" : "old");
      }
    }
    fetch();
  }, []);

  if (!lastSync) return null;

  const colors = {
    fresh: "text-success",
    stale: "text-warning",
    old: "text-danger",
  };

  return (
    <span className={cn("inline-flex items-center gap-1 text-xs text-muted-foreground", className)}>
      <Clock className={cn("h-3 w-3", colors[freshness])} />
      Datos de {timeAgo(lastSync)}
    </span>
  );
}
