"use client";

import { useState } from "react";
import { Loader2, ThumbsDown, ThumbsUp } from "lucide-react";
import type { AgentInsight, CompanyProfile } from "@/lib/types";
import { cn, timeAgo, formatCurrency } from "@/lib/utils";
import { getDomainConfig } from "@/lib/domains";
import { SeverityBadge } from "@/components/shared/severity-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// ── Types ──

interface InboxDesktopProps {
  insights: AgentInsight[];
  agents: Record<number, { slug: string; name: string; domain: string }>;
  companyProfiles: Map<number, CompanyProfile>;
  seenIds: Set<number>;
  acting: number | null;
  onAct: (id: number) => void;
  onDismiss: (id: number) => void;
  onDetail: (id: number) => void;
}

interface CompanyGroup {
  company: CompanyProfile | null;
  companyName: string;
  insights: AgentInsight[];
  maxSeverity: string;
  totalImpact: number;
}

// ── Helpers ──

function computeTier(insight: AgentInsight): string {
  const ev = insight.evidence as { priority_tier?: string }[] | null;
  const evTier = ev?.[0]?.priority_tier ?? "fyi";
  if (evTier !== "fyi") return evTier;
  // Fallback: map severity to tier
  if (insight.severity === "critical") return "urgent";
  if (insight.severity === "high") return "important";
  return "fyi";
}

const TIER_BADGE_COLORS: Record<string, string> = {
  strategic: "bg-domain-relationships/15 text-domain-relationships",
  important: "bg-info/15 text-info-foreground",
  key_supplier: "bg-warning/15 text-warning-foreground",
  regular: "bg-secondary text-secondary-foreground",
};

const RISK_COLORS: Record<string, string> = {
  critical: "text-danger",
  high: "text-danger",
  medium: "text-warning",
  low: "text-muted-foreground",
};

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0, high: 1, medium: 2, low: 3, info: 4,
};

// ── Component ──

export function InboxDesktop({
  insights,
  agents,
  companyProfiles,
  seenIds,
  acting,
  onAct,
  onDismiss,
  onDetail,
}: InboxDesktopProps) {
  const [viewMode, setViewMode] = useState<"company" | "list">("company");

  return (
    <>
      {/* View toggle */}
      <div className="flex items-center gap-1 mb-3 px-0">
        <button
          onClick={() => setViewMode("company")}
          className={cn(
            "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            viewMode === "company"
              ? "bg-foreground text-background"
              : "bg-muted text-muted-foreground hover:bg-muted/80",
          )}
        >
          Por empresa
        </button>
        <button
          onClick={() => setViewMode("list")}
          className={cn(
            "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            viewMode === "list"
              ? "bg-foreground text-background"
              : "bg-muted text-muted-foreground hover:bg-muted/80",
          )}
        >
          Lista
        </button>
      </div>

      {/* Company grouped view */}
      {viewMode === "company" && <CompanyGroupedView
        insights={insights}
        agents={agents}
        companyProfiles={companyProfiles}
        seenIds={seenIds}
        acting={acting}
        onAct={onAct}
        onDismiss={onDismiss}
        onDetail={onDetail}
      />}

      {/* Table / list view */}
      {viewMode === "list" && <ListView
        insights={insights}
        agents={agents}
        seenIds={seenIds}
        acting={acting}
        onAct={onAct}
        onDismiss={onDismiss}
        onDetail={onDetail}
      />}
    </>
  );
}

// ── Company Grouped View ──

function CompanyGroupedView({
  insights,
  agents,
  companyProfiles,
  seenIds,
  acting,
  onAct,
  onDismiss,
  onDetail,
}: InboxDesktopProps) {
  // Group insights by company
  const groups = new Map<string, CompanyGroup>();

  for (const insight of insights) {
    const key = insight.company_id ? String(insight.company_id) : "_no_company";
    if (!groups.has(key)) {
      const profile = insight.company_id ? companyProfiles.get(insight.company_id) : null;
      groups.set(key, {
        company: profile ?? null,
        companyName: profile?.name ?? "Sin empresa asignada",
        insights: [],
        maxSeverity: "info",
        totalImpact: 0,
      });
    }
    const group = groups.get(key)!;
    group.insights.push(insight);
    if ((SEVERITY_ORDER[insight.severity ?? ""] ?? 5) < (SEVERITY_ORDER[group.maxSeverity] ?? 5)) {
      group.maxSeverity = insight.severity ?? "info";
    }
    if (insight.business_impact_estimate) group.totalImpact += insight.business_impact_estimate;
  }

  // Sort groups: by max severity, then by total revenue
  const sortedGroups = [...groups.values()].sort((a, b) => {
    const sevDiff = (SEVERITY_ORDER[a.maxSeverity] ?? 5) - (SEVERITY_ORDER[b.maxSeverity] ?? 5);
    if (sevDiff !== 0) return sevDiff;
    return (b.company?.total_revenue ?? 0) - (a.company?.total_revenue ?? 0);
  });

  return (
    <div className="space-y-3">
      {sortedGroups.map((group) => (
        <Card key={group.companyName} className="overflow-hidden">
          {/* Company header */}
          <div className="flex items-center justify-between px-4 py-2.5 bg-muted/30 border-b">
            <div className="flex items-center gap-3">
              <div className={cn(
                "w-1 h-8 rounded-full",
                group.maxSeverity === "critical" && "bg-danger",
                group.maxSeverity === "high" && "bg-warning",
                group.maxSeverity === "medium" && "bg-info",
                !["critical", "high", "medium"].includes(group.maxSeverity) && "bg-muted-foreground/30",
              )} />
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-sm">{group.companyName}</h3>
                  {group.company?.tier && (
                    <Badge className={cn(
                      "text-[10px] font-normal",
                      TIER_BADGE_COLORS[group.company.tier] ?? "bg-muted",
                    )}>
                      {group.company.tier}
                    </Badge>
                  )}
                  {group.company?.risk_level && group.company.risk_level !== "low" && (
                    <span className={cn("text-[10px] font-medium", RISK_COLORS[group.company.risk_level])}>
                      riesgo {group.company.risk_level}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                  {group.company?.total_revenue ? (
                    <span>Revenue: {formatCurrency(group.company.total_revenue)}</span>
                  ) : null}
                  {group.company?.overdue_amount ? (
                    <span className="text-danger">Vencido: {formatCurrency(group.company.overdue_amount)}</span>
                  ) : null}
                  {group.company?.trend_pct != null ? (
                    <span className={group.company.trend_pct >= 0 ? "text-success" : "text-danger"}>
                      {group.company.trend_pct >= 0 ? "+" : ""}{group.company.trend_pct.toFixed(0)}% tendencia
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="text-right">
              <span className="text-xs text-muted-foreground">
                {group.insights.length} insight{group.insights.length !== 1 ? "s" : ""}
              </span>
              {group.totalImpact > 0 && (
                <div className="text-xs font-semibold">{formatCurrency(group.totalImpact)}</div>
              )}
            </div>
          </div>

          {/* Insights list */}
          <div className="divide-y">
            {group.insights.map((insight) => {
              const agent = agents[insight.agent_id];
              const dc = getDomainConfig(agent?.domain ?? "");
              const Icon = dc.icon;
              const isSeen = seenIds.has(insight.id);
              return (
                <div
                  key={insight.id}
                  className={cn(
                    "flex items-center gap-3 px-4 py-2 cursor-pointer hover:bg-muted/30 group",
                    !isSeen && "bg-accent/30",
                  )}
                  onClick={() => onDetail(insight.id)}
                >
                  <div className={cn("flex h-7 w-7 items-center justify-center rounded-md shrink-0", dc.bg)}>
                    <Icon className={cn("h-3.5 w-3.5", dc.color)} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      {!isSeen && <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />}
                      <h4 className={cn("text-sm truncate", !isSeen ? "font-semibold" : "font-normal")}>
                        {insight.title}
                      </h4>
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <SeverityBadge severity={insight.severity ?? "info"} />
                      <span className="text-[10px] text-muted-foreground">
                        {agent?.name?.replace("Agente de ", "")}
                      </span>
                      {insight.assignee_name && (
                        <span className="text-[10px] text-muted-foreground">
                          {insight.assignee_name}
                        </span>
                      )}
                    </div>
                  </div>
                  <div
                    className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => onAct(insight.id)}
                      disabled={acting === insight.id}
                    >
                      {acting === insight.id
                        ? <Loader2 className="h-3 w-3 animate-spin" />
                        : <ThumbsUp className="h-3 w-3" />}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-muted-foreground"
                      onClick={() => onDismiss(insight.id)}
                    >
                      <ThumbsDown className="h-3 w-3" />
                    </Button>
                  </div>
                  <span className="text-[11px] text-muted-foreground whitespace-nowrap shrink-0">
                    {timeAgo(insight.created_at)}
                  </span>
                </div>
              );
            })}
          </div>
        </Card>
      ))}
    </div>
  );
}

// ── Table / List View ──

function ListView({
  insights,
  agents,
  seenIds,
  acting,
  onAct,
  onDismiss,
  onDetail,
}: Omit<InboxDesktopProps, "companyProfiles">) {
  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-[3px] p-0" />
            <TableHead className="pl-3">Insight</TableHead>
            <TableHead className="hidden lg:table-cell">Responsable</TableHead>
            <TableHead className="hidden lg:table-cell w-20 text-right">Impacto</TableHead>
            <TableHead className="w-16 text-right">Conf.</TableHead>
            <TableHead className="w-20 text-right">Tiempo</TableHead>
            <TableHead className="w-20" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {insights.map((insight) => {
            const agent = agents[insight.agent_id];
            const dc = getDomainConfig(agent?.domain ?? "");
            const Icon = dc.icon;
            const tier = computeTier(insight);
            const isSeen = seenIds.has(insight.id);

            return (
              <TableRow
                key={insight.id}
                className={cn("group cursor-pointer", !isSeen && "bg-accent/50")}
                onClick={() => onDetail(insight.id)}
              >
                {/* Tier indicator stripe */}
                <TableCell className="p-0 w-[3px]">
                  <div className={cn(
                    "w-[3px] h-full",
                    tier === "urgent" && "bg-danger",
                    tier === "important" && "bg-warning",
                  )} />
                </TableCell>

                {/* Main content: icon + title + meta */}
                <TableCell className="pl-3">
                  <div className="flex items-center gap-3">
                    <div className={cn("flex h-8 w-8 items-center justify-center rounded-md shrink-0", dc.bg)}>
                      <Icon className={cn("h-4 w-4", dc.color)} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        {!isSeen && <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />}
                        <h3 className={cn("text-sm truncate", !isSeen ? "font-semibold" : "font-normal")}>
                          {insight.title}
                        </h3>
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <SeverityBadge severity={insight.severity ?? "info"} />
                        <span className="text-[11px] text-muted-foreground">
                          {agent?.name?.replace("Agente de ", "")}
                        </span>
                      </div>
                    </div>
                  </div>
                </TableCell>

                {/* Assignee */}
                <TableCell className="hidden lg:table-cell">
                  {insight.assignee_name ? (
                    <span className="text-sm text-muted-foreground">{insight.assignee_name}</span>
                  ) : (
                    <span className="text-sm text-muted-foreground/40">&mdash;</span>
                  )}
                </TableCell>

                {/* Impact */}
                <TableCell className="hidden lg:table-cell text-right">
                  {insight.business_impact_estimate != null && insight.business_impact_estimate > 0 ? (
                    <span className="text-sm font-medium tabular-nums">
                      ${(insight.business_impact_estimate / 1000).toFixed(0)}K
                    </span>
                  ) : (
                    <span className="text-muted-foreground/40">&mdash;</span>
                  )}
                </TableCell>

                {/* Confidence */}
                <TableCell className="text-right">
                  <span className={cn(
                    "text-sm tabular-nums font-medium",
                    (insight.confidence ?? 0) >= 0.85
                      ? "text-success"
                      : (insight.confidence ?? 0) >= 0.7
                        ? "text-warning"
                        : "text-muted-foreground",
                  )}>
                    {((insight.confidence ?? 0) * 100).toFixed(0)}%
                  </span>
                </TableCell>

                {/* Time */}
                <TableCell className="text-right">
                  <span className="text-[13px] text-muted-foreground whitespace-nowrap">
                    {timeAgo(insight.created_at)}
                  </span>
                </TableCell>

                {/* Actions */}
                <TableCell>
                  <div
                    className="flex items-center justify-end gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => onAct(insight.id)}
                          disabled={acting === insight.id}
                        >
                          {acting === insight.id
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <ThumbsUp className="h-3.5 w-3.5" />}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">Util</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-muted-foreground"
                          onClick={() => onDismiss(insight.id)}
                        >
                          <ThumbsDown className="h-3.5 w-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">Descartar</TooltipContent>
                    </Tooltip>
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

export { computeTier };
export type { InboxDesktopProps };
