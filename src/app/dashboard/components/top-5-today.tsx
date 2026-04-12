"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, RefreshCw, Target } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface InsightRow {
  id: number;
  title: string;
  description: string;
  severity: string;
  category: string;
  business_impact_estimate: number | null;
  assignee_name: string | null;
  company_name: string | null;
  recommendation: string | null;
  created_at: string;
}

interface DigestPayload {
  date: string;
  kpis: { new_insights: number; overdue_actions: number; pending_actions: number };
  top_5: InsightRow[];
}

function fmtMXN(n: number | null): string {
  if (!n) return "";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

export function Top5Today() {
  const [payload, setPayload] = useState<DigestPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/daily-digest", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setPayload(data);
      }
    } catch (err) {
      console.error("[top-5]", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 10 * 60 * 1000); // 10 min
    return () => clearInterval(interval);
  }, [load]);

  if (loading) {
    return <div className="h-64 animate-pulse rounded-xl bg-muted" />;
  }

  if (!payload || payload.top_5.length === 0) {
    return (
      <Card className="border-success/40 bg-success/5">
        <CardContent className="p-6 text-center">
          <Target className="mx-auto mb-2 h-8 w-8 text-success" />
          <p className="text-sm font-medium">No hay insights criticos hoy</p>
          <p className="text-xs text-muted-foreground">Todo esta bajo control</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-2 border-primary/30 bg-primary/5">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-primary/10 p-1.5">
              <Target className="h-4 w-4 text-primary" />
            </div>
            <CardTitle className="text-base">Top 5 hoy</CardTitle>
            <Badge variant="outline" className="text-[10px]">
              {payload.kpis.new_insights} nuevos
            </Badge>
          </div>
          <Button variant="ghost" size="icon" onClick={load} disabled={refreshing} className="h-7 w-7">
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        {payload.top_5.map((i, idx) => (
          <Link
            key={i.id}
            href={`/inbox/insight/${i.id}`}
            className="flex items-start gap-3 rounded-lg border bg-card p-3 transition-all hover:border-primary/40 hover:bg-muted/30"
          >
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary tabular-nums">
              {idx + 1}
            </div>
            <div className="min-w-0 flex-1">
              <div className="mb-1 flex items-center gap-2">
                <Badge
                  variant={i.severity === "critical" ? "critical" : "warning"}
                  className="text-[9px]"
                >
                  {i.severity}
                </Badge>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {i.category}
                </span>
                {i.business_impact_estimate && (
                  <span className="ml-auto text-xs font-bold text-success tabular-nums">
                    {fmtMXN(i.business_impact_estimate)}
                  </span>
                )}
              </div>
              <p className="line-clamp-1 text-sm font-medium">{i.title}</p>
              {i.company_name && (
                <p className="truncate text-[11px] text-muted-foreground">
                  {i.company_name}
                  {i.assignee_name && ` · ${i.assignee_name}`}
                </p>
              )}
            </div>
            <AlertTriangle className="mt-1 h-3.5 w-3.5 shrink-0 text-warning" />
          </Link>
        ))}
        <Link
          href="/inbox"
          className="mt-2 flex items-center justify-center gap-1 rounded-lg border border-dashed py-2 text-xs text-muted-foreground hover:text-foreground hover:border-primary/30"
        >
          Ver inbox completo
          <ArrowRight className="h-3 w-3" />
        </Link>
      </CardContent>
    </Card>
  );
}
