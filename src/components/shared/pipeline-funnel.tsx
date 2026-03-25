"use client";

import { cn } from "@/lib/utils";

interface PipelineSummary {
  total_leads: number;
  total_opportunities: number;
  pipeline_value: number;
  weighted_value: number;
}

interface Lead {
  name: string;
  lead_type: string;
  stage: string | null;
  expected_revenue: number;
  probability: number;
  assigned_user: string | null;
  days_open: number;
}

function fmt(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

export function PipelineFunnel({
  summary,
  leads,
}: {
  summary: PipelineSummary | null;
  leads: Lead[];
}) {
  if (!summary || (summary.total_leads === 0 && summary.total_opportunities === 0)) {
    return (
      <div className="text-center text-sm text-muted-foreground py-8">
        Sin pipeline activo
      </div>
    );
  }

  // Group opportunities by stage
  const opps = leads.filter((l) => l.lead_type === "opportunity");
  const stageGroups = new Map<string, { count: number; value: number }>();
  for (const opp of opps) {
    const stage = opp.stage || "Sin etapa";
    const existing = stageGroups.get(stage) || { count: 0, value: 0 };
    stageGroups.set(stage, {
      count: existing.count + 1,
      value: existing.value + opp.expected_revenue,
    });
  }

  const stages = Array.from(stageGroups.entries()).sort(
    (a, b) => b[1].value - a[1].value
  );

  return (
    <div className="space-y-4">
      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <p className="text-xs text-muted-foreground">Leads</p>
          <p className="text-xl font-bold tabular-nums">
            {summary.total_leads}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Oportunidades</p>
          <p className="text-xl font-bold tabular-nums">
            {summary.total_opportunities}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Pipeline Total</p>
          <p className="text-xl font-bold tabular-nums text-blue-600 dark:text-blue-400">
            {fmt(summary.pipeline_value)}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Valor Ponderado</p>
          <p className="text-xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
            {fmt(summary.weighted_value)}
          </p>
        </div>
      </div>

      {/* Stage bars */}
      {stages.length > 0 && (
        <div className="space-y-2">
          {stages.map(([stage, data]) => {
            const pct =
              summary.pipeline_value > 0
                ? (data.value / summary.pipeline_value) * 100
                : 0;
            return (
              <div key={stage} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{stage}</span>
                  <span className="text-muted-foreground">
                    {data.count} opp &middot; {fmt(data.value)}
                  </span>
                </div>
                <div className="h-2.5 w-full rounded-full bg-muted">
                  <div
                    className={cn(
                      "h-2.5 rounded-full bg-blue-500 transition-all"
                    )}
                    style={{ width: `${Math.max(pct, 2)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
