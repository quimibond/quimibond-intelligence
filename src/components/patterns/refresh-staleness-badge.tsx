"use client";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export interface RefreshStalenessBadgeProps {
  minutesSinceRefresh: number;
  invoicesRefreshedAt: string | null;
}

export function RefreshStalenessBadge({ minutesSinceRefresh, invoicesRefreshedAt }: RefreshStalenessBadgeProps) {
  const [refreshing, setRefreshing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const color = minutesSinceRefresh < 20
    ? "bg-muted text-muted-foreground"
    : minutesSinceRefresh < 60
    ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100"
    : "bg-rose-100 text-rose-900 dark:bg-rose-950 dark:text-rose-100";

  async function triggerRefresh() {
    setRefreshing(true);
    setMsg(null);
    try {
      const res = await fetch("/api/syntage/refresh-unified", { method: "POST" });
      setMsg(res.ok ? "Refresh iniciado · recarga en ~30s" : `Error ${res.status}`);
    } catch (e) {
      setMsg(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="flex items-center gap-2 text-xs">
      <Badge className={color} title={invoicesRefreshedAt ?? undefined}>
        Actualizado hace {minutesSinceRefresh}min
      </Badge>
      {minutesSinceRefresh >= 20 && (
        <Button size="sm" variant="outline" onClick={triggerRefresh} disabled={refreshing}>
          {refreshing ? "Refrescando..." : "Refresh ahora"}
        </Button>
      )}
      {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
    </div>
  );
}
