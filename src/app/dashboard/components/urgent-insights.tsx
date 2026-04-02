"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/utils";
import { getDomainConfig } from "@/lib/domains";
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
      <CardHeader className="pb-3">
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
          <p className="text-sm text-muted-foreground py-4 text-center">
            {totalPending === 0
              ? "Sin insights pendientes"
              : "Sin insights criticos — todo en orden"}
          </p>
        ) : (
          <div className="space-y-1.5">
            {insights.map((ins) => {
              const agent = agentMap.get(ins.agent_id);
              const dc = agent ? getDomainConfig(agent.domain) : null;
              const AgentIcon = dc?.icon ?? Bot;

              return (
                <Link
                  key={ins.id}
                  href={`/inbox/insight/${ins.id}`}
                  className="flex items-center gap-2 rounded-lg border p-2 hover:bg-muted/50 transition-colors active:bg-muted"
                >
                  <AgentIcon
                    className={cn(
                      "h-3.5 w-3.5 shrink-0 hidden sm:block",
                      dc?.color ?? "text-muted-foreground"
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <span className="text-xs sm:text-sm font-medium line-clamp-1">
                      {ins.title}
                    </span>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <SeverityBadge severity={ins.severity ?? "info"} />
                      <span className="text-[10px] text-muted-foreground">
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
