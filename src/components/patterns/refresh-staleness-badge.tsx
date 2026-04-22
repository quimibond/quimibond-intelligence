"use client";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "./status-badge";

export interface RefreshStalenessBadgeProps {
  minutesSinceRefresh: number;
  invoicesRefreshedAt: string | null;
}

/**
 * @deprecated SP6 — use `<StatusBadge kind="staleness" value={fresh ? "fresh" : "stale"} />` instead.
 * This wrapper is preserved for back-compat with out-of-scope pages during SP6 foundation.
 * The interactive refresh-button behaviour (triggerRefresh) is intentionally retained.
 */
export function RefreshStalenessBadge({ minutesSinceRefresh, invoicesRefreshedAt }: RefreshStalenessBadgeProps) {
  const [refreshing, setRefreshing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const freshOrStale: "fresh" | "stale" = minutesSinceRefresh < 20 ? "fresh" : "stale";

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
      <span title={invoicesRefreshedAt ?? undefined}>
        <StatusBadge kind="staleness" value={freshOrStale} density="regular" />
      </span>
      {minutesSinceRefresh >= 20 && (
        <Button size="sm" variant="outline" onClick={triggerRefresh} disabled={refreshing}>
          {refreshing ? "Refrescando..." : "Refresh ahora"}
        </Button>
      )}
      {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
    </div>
  );
}
