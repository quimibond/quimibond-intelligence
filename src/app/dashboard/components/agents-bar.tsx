"use client";

import { useState } from "react";
import Link from "next/link";
import { cn, timeAgo, truncate } from "@/lib/utils";
import { getDomainConfig } from "@/lib/domains";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowRight, FileText, Loader2, Play } from "lucide-react";
import type { AIAgent } from "@/lib/types";

interface AgentWithStats extends AIAgent {
  last_run_at: string | null;
  new_insights: number;
}

interface BriefingData {
  briefing_date: string;
  summary_text: string | null;
  total_emails: number;
}

interface AgentsBarProps {
  agents: AgentWithStats[];
  briefing: BriefingData | null;
}

export function AgentsBar({ agents, briefing }: AgentsBarProps) {
  const [running, setRunning] = useState(false);

  async function handleOrchestrate() {
    setRunning(true);
    try {
      await fetch("/api/agents/orchestrate", { method: "POST" });
    } catch (err) {
      console.error("[agents-bar] orchestrate failed:", err);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* Agent cards row + run button */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2 overflow-x-auto pb-1 -mb-1 min-w-0 flex-1">
          {agents.map((a) => {
            const dc = getDomainConfig(a.domain);
            const Icon = dc.icon;
            return (
              <Link
                key={a.slug}
                href="/agents"
                className="flex items-center gap-2 shrink-0 rounded-lg border px-2.5 py-1.5 sm:px-3 sm:py-2 hover:bg-muted/50 transition-colors"
              >
                <Icon className={cn("h-3.5 w-3.5 sm:h-4 sm:w-4", dc.color)} />
                <div className="text-[11px] sm:text-xs">
                  <p className="font-medium whitespace-nowrap">
                    {a.name?.replace("Agente de ", "").replace("Agente ", "")}
                  </p>
                  <p className="text-muted-foreground whitespace-nowrap">
                    {a.new_insights > 0 ? (
                      <span className="text-success font-medium">
                        {a.new_insights} nuevos
                      </span>
                    ) : a.last_run_at ? (
                      timeAgo(a.last_run_at)
                    ) : (
                      "nunca"
                    )}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={handleOrchestrate}
          disabled={running}
          className="shrink-0"
        >
          {running ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
          ) : (
            <Play className="h-3.5 w-3.5 mr-1" />
          )}
          <span className="hidden sm:inline">
            {running ? "Ejecutando..." : "Ejecutar Siguiente"}
          </span>
        </Button>
      </div>

      {/* Daily briefing */}
      {briefing && (
        <Card>
          <CardHeader className="pb-3">
            <Link href="/briefings" className="flex items-center justify-between group">
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="h-4 w-4 shrink-0 text-info" />
                <CardTitle className="text-sm sm:text-base truncate">
                  Briefing del Dia — {briefing.briefing_date}
                </CardTitle>
                <span className="text-xs text-muted-foreground shrink-0 hidden sm:inline">
                  {briefing.total_emails ?? 0} emails
                </span>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform shrink-0" />
            </Link>
          </CardHeader>
          <CardContent>
            <p className="text-sm line-clamp-3 sm:line-clamp-4">
              {briefing.summary_text
                ? truncate(briefing.summary_text, 300)
                : "Sin resumen disponible."}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
