"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/utils";
import { getDomainConfig } from "@/lib/domains";
import { INSIGHT_CATEGORY_LABELS, INSIGHT_CATEGORY_COLORS } from "@/lib/constants";
import { SeverityBadge } from "@/components/shared/severity-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowRight, Bot } from "lucide-react";
import type { AgentInsight, AIAgent } from "@/lib/types";

interface UrgentInsightsProps {
  insights: AgentInsight[];
  agents: AIAgent[];
  totalPending: number;
}

export function UrgentInsights({ insights, agents, totalPending }: UrgentInsightsProps) {
  const agentMap = new Map(agents.map((a) => [a.id, a]));

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <Link href="/inbox" className="flex items-center justify-between group">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-danger" />
            <CardTitle className="text-sm sm:text-base">Insights Urgentes</CardTitle>
          </div>
          <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
        </Link>
      </CardHeader>
      <CardContent>
        {insights.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            {totalPending === 0
              ? "Sin insights pendientes"
              : "Sin insights criticos"}
          </p>
        ) : (
          <div className="space-y-2">
            {insights.map((ins) => {
              const agent = agentMap.get(ins.agent_id);
              const dc = agent ? getDomainConfig(agent.domain) : null;
              const AgentIcon = dc?.icon ?? Bot;

              return (
                <Link
                  key={ins.id}
                  href={`/inbox/insight/${ins.id}`}
                  className="flex items-start gap-3 rounded-xl border p-3 hover:bg-muted/50 transition-colors active:bg-muted"
                >
                  <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", dc?.bg ?? "bg-muted")}>
                    <AgentIcon className={cn("h-4 w-4", dc?.color ?? "text-muted-foreground")} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="text-sm font-semibold line-clamp-2 leading-snug">
                      {ins.title}
                    </span>
                    <div className="flex items-center gap-1.5 mt-1">
                      <SeverityBadge severity={ins.severity ?? "medium"} />
                      {ins.category && (
                        <span className={cn(
                          "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium",
                          INSIGHT_CATEGORY_COLORS[ins.category] ?? "text-gray-600 bg-gray-50"
                        )}>
                          {INSIGHT_CATEGORY_LABELS[ins.category] ?? ins.category}
                        </span>
                      )}
                      <span className="text-[11px] text-muted-foreground ml-auto">
                        {timeAgo(ins.created_at)}
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
