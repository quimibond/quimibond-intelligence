"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Ban,
  Briefcase,
  CheckCircle2,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { timeAgo } from "@/lib/utils";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface DirectorHealth {
  agent_id: number;
  slug: string;
  name: string;
  domain: string;
  insights_30d: number;
  acted: number;
  dismissed: number;
  expired: number;
  open_insights: number;
  archived: number;
  acted_rate_pct: number | null;
  pct_grounded: number | null;
  avg_confidence: number;
  avg_impact_mxn: number;
  max_impact_mxn: number;
  total_lessons: number;
  active_lessons: number;
  last_run_at: string | null;
  cap_impact: number | null;
  cap_min_impact: number | null;
  cap_min_conf: number | null;
  cap_max_per_run: number | null;
  health_status: "good" | "warning" | "critical" | "silent" | "new";
}

interface Top3Insight {
  id: number;
  title: string;
  severity: string;
  category: string;
  confidence: number;
  business_impact_estimate: number | null;
  company_name: string | null;
  assignee_name: string | null;
  agent_slug: string;
  agent_name: string;
  hours_old: number;
  score: number;
}

export default function DirectorsHealthPage() {
  const [directors, setDirectors] = useState<DirectorHealth[]>([]);
  const [top3, setTop3] = useState<Top3Insight[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    const [dirRes, top3Res] = await Promise.all([
      supabase.from("director_health_30d").select("*"),
      supabase.rpc("top_actionable_insights", { p_limit: 3 }),
    ]);
    setDirectors((dirRes.data ?? []) as DirectorHealth[]);
    setTop3((top3Res.data ?? []) as Top3Insight[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const statusBadge = (status: DirectorHealth["health_status"]) => {
    switch (status) {
      case "good": return <Badge variant="success">bueno</Badge>;
      case "warning": return <Badge variant="warning">atencion</Badge>;
      case "critical": return <Badge variant="critical">critico</Badge>;
      case "silent": return <Badge variant="secondary">silencioso</Badge>;
      case "new": return <Badge variant="info">nuevo</Badge>;
      default: return <Badge variant="secondary">?</Badge>;
    }
  };

  const severityBadge = (severity: string) => {
    switch (severity) {
      case "critical": return <Badge variant="critical">critico</Badge>;
      case "high": return <Badge variant="warning">alto</Badge>;
      default: return <Badge variant="secondary">{severity}</Badge>;
    }
  };

  const fmtCurrency = (n: number) => {
    if (!n || n <= 0) return "—";
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
    return `$${n.toLocaleString()}`;
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
      </div>
    );
  }

  const critical = directors.filter(d => d.health_status === "critical").length;
  const warning = directors.filter(d => d.health_status === "warning").length;
  const good = directors.filter(d => d.health_status === "good").length;
  const silent = directors.filter(d => d.health_status === "silent").length;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <PageHeader
          title="Salud de directores"
          description="Performance de los 7 directores IA en los ultimos 30 dias"
        />
        <Button variant="ghost" size="sm" onClick={fetchData} className="gap-2">
          <RefreshCw className="h-4 w-4" />
          Refrescar
        </Button>
      </div>

      {/* ── Top 3 accionables hoy ────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-warning" />
            <CardTitle className="text-sm">Top 3 decisiones accionables hoy</CardTitle>
            <Badge variant="secondary" className="text-[10px] ml-auto">
              score = impacto·0.4 + confianza·0.3 + recencia·0.3
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {top3.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              Sin candidatos hoy. El briefing va a decir &ldquo;Sin decisiones urgentes&rdquo;.
            </p>
          ) : (
            <div className="space-y-3">
              {top3.map((t, idx) => (
                <Link
                  key={t.id}
                  href={`/inbox/insight/${t.id}`}
                  className="flex items-start gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-warning/20 text-warning-foreground text-sm font-bold">
                    {idx + 1}
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium">{t.title}</p>
                      <span className="text-xs text-muted-foreground whitespace-nowrap tabular-nums">
                        {t.score.toFixed(3)}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {severityBadge(t.severity)}
                      <Badge variant="secondary" className="text-[10px]">{t.category}</Badge>
                      <span className="flex items-center gap-1">
                        <Briefcase className="h-3 w-3" />
                        {t.agent_name}
                      </span>
                      {t.company_name && <span>| {t.company_name}</span>}
                      {t.assignee_name && <span>| {t.assignee_name}</span>}
                      {t.business_impact_estimate != null && t.business_impact_estimate > 0 && (
                        <span className="font-medium">
                          | {fmtCurrency(t.business_impact_estimate)}
                        </span>
                      )}
                      <span>| hace {t.hours_old.toFixed(1)}h</span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Salud de los directores ─────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <CardTitle className="text-sm flex items-center gap-2">
              Salud por director (ultimos 30 dias)
              {critical > 0 && (
                <Badge variant="critical" className="text-[10px] gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  {critical} critico{critical !== 1 ? "s" : ""}
                </Badge>
              )}
              {warning > 0 && (
                <Badge variant="warning" className="text-[10px]">{warning} atencion</Badge>
              )}
              {good > 0 && (
                <Badge variant="success" className="text-[10px] gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  {good} bueno{good !== 1 ? "s" : ""}
                </Badge>
              )}
              {silent > 0 && (
                <Badge variant="secondary" className="text-[10px] gap-1">
                  <Ban className="h-3 w-3" />
                  {silent} silencioso{silent !== 1 ? "s" : ""}
                </Badge>
              )}
            </CardTitle>
            <span className="text-[10px] text-muted-foreground">
              target acted_rate &ge; 20% | pct_grounded &ge; 80%
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Director</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Insights 30d</TableHead>
                  <TableHead className="text-right">Acted</TableHead>
                  <TableHead className="text-right">Expired</TableHead>
                  <TableHead className="text-right">Acted %</TableHead>
                  <TableHead className="text-right">Grounded %</TableHead>
                  <TableHead className="text-right">Avg impact</TableHead>
                  <TableHead className="text-right">Cap</TableHead>
                  <TableHead className="text-right">Lessons</TableHead>
                  <TableHead>Ultimo run</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {directors.map((d) => (
                  <TableRow key={d.agent_id}>
                    <TableCell className="font-medium">{d.name}</TableCell>
                    <TableCell>{statusBadge(d.health_status)}</TableCell>
                    <TableCell className="tabular-nums text-right">{d.insights_30d}</TableCell>
                    <TableCell className="tabular-nums text-right">{d.acted}</TableCell>
                    <TableCell className="tabular-nums text-right text-muted-foreground">{d.expired}</TableCell>
                    <TableCell className={`tabular-nums text-right font-medium ${
                      d.acted_rate_pct == null ? "text-muted-foreground" :
                      d.acted_rate_pct >= 20 ? "text-success-foreground" :
                      d.acted_rate_pct >= 10 ? "text-warning-foreground" :
                      "text-danger"
                    }`}>
                      {d.acted_rate_pct != null ? `${d.acted_rate_pct}%` : "—"}
                    </TableCell>
                    <TableCell className={`tabular-nums text-right ${
                      d.pct_grounded == null ? "text-muted-foreground" :
                      d.pct_grounded >= 80 ? "text-success-foreground" :
                      "text-warning-foreground"
                    }`}>
                      {d.pct_grounded != null ? `${d.pct_grounded}%` : "—"}
                    </TableCell>
                    <TableCell className="tabular-nums text-right">{fmtCurrency(d.avg_impact_mxn)}</TableCell>
                    <TableCell className="tabular-nums text-right text-muted-foreground text-xs">
                      {d.cap_impact ? fmtCurrency(d.cap_impact) : "—"}
                    </TableCell>
                    <TableCell className="tabular-nums text-right text-xs">
                      <span className={d.active_lessons > 0 ? "" : "text-muted-foreground"}>
                        {d.active_lessons}
                      </span>
                      <span className="text-muted-foreground">/{d.total_lessons}</span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {d.last_run_at ? timeAgo(d.last_run_at) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
