"use client";

import { useEffect, useState } from "react";
import { Brain, CheckCircle, XCircle, Clock, ThumbsUp } from "lucide-react";
import { cn, formatDate, timeAgo } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { INSIGHT_CATEGORY_LABELS, INSIGHT_CATEGORY_COLORS, SEVERITY_LABELS } from "@/lib/constants";
import type { Fact, AgentInsight } from "@/lib/types";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface TabInteligenciaProps {
  facts: Fact[];
  companyId: number;
}

const STATE_ICONS: Record<string, typeof CheckCircle> = {
  acted_on: ThumbsUp,
  dismissed: XCircle,
  expired: Clock,
  new: Clock,
  seen: Clock,
};

const STATE_COLORS: Record<string, string> = {
  acted_on: "text-success",
  dismissed: "text-muted-foreground",
  expired: "text-muted-foreground/50",
  new: "text-primary",
  seen: "text-primary",
};

export function TabInteligencia({ facts, companyId }: TabInteligenciaProps) {
  const [insights, setInsights] = useState<AgentInsight[]>([]);
  const [loadingInsights, setLoadingInsights] = useState(true);

  useEffect(() => {
    supabase
      .from("agent_insights")
      .select("id, title, severity, category, state, confidence, assignee_name, created_at, updated_at")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data }) => {
        setInsights((data ?? []) as AgentInsight[]);
        setLoadingInsights(false);
      });
  }, [companyId]);

  const activeInsights = insights.filter(i => ["new", "seen"].includes(i.state ?? ""));
  const historicalInsights = insights.filter(i => !["new", "seen"].includes(i.state ?? ""));

  return (
    <Tabs defaultValue="insights" className="space-y-4">
      <TabsList>
        <TabsTrigger value="insights">
          Insights ({insights.length})
        </TabsTrigger>
        <TabsTrigger value="facts">
          Hechos ({facts.length})
        </TabsTrigger>
      </TabsList>

      <TabsContent value="insights">
        {loadingInsights ? (
          <p className="text-sm text-muted-foreground py-8 text-center">Cargando historial...</p>
        ) : insights.length === 0 ? (
          <EmptyState
            icon={Brain}
            title="Sin historial de insights"
            description="Los agentes aun no han generado insights sobre esta empresa."
          />
        ) : (
          <div className="space-y-4">
            {/* Active insights */}
            {activeInsights.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold mb-2">Pendientes ({activeInsights.length})</h3>
                <div className="space-y-2">
                  {activeInsights.map(insight => (
                    <InsightRow key={insight.id} insight={insight} />
                  ))}
                </div>
              </div>
            )}

            {/* Historical insights */}
            {historicalInsights.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-muted-foreground mb-2">
                  Historial ({historicalInsights.length})
                </h3>
                <div className="space-y-2">
                  {historicalInsights.map(insight => (
                    <InsightRow key={insight.id} insight={insight} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </TabsContent>

      <TabsContent value="facts">
        {facts.length === 0 ? (
          <EmptyState
            icon={Brain}
            title="Sin hechos"
            description="No se han extraido hechos de emails relacionados con esta empresa."
          />
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Hecho</TableHead>
                  <TableHead className="text-right">Confianza</TableHead>
                  <TableHead>Fecha</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {facts.map((fact) => (
                  <TableRow key={fact.id}>
                    <TableCell>
                      {fact.fact_type && <Badge variant="outline">{fact.fact_type}</Badge>}
                    </TableCell>
                    <TableCell className="text-sm">{fact.fact_text}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {(fact.confidence * 100).toFixed(0)}%
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDate(fact.created_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </TabsContent>
    </Tabs>
  );
}

function InsightRow({ insight }: { insight: AgentInsight }) {
  const StateIcon = STATE_ICONS[insight.state ?? "new"] ?? Clock;
  const stateLabel = insight.state === "acted_on" ? "Actuado"
    : insight.state === "dismissed" ? "Descartado"
    : insight.state === "expired" ? "Expirado"
    : "Pendiente";

  return (
    <div className="flex items-start gap-3 rounded-lg border p-3 text-sm">
      <StateIcon className={cn("h-4 w-4 mt-0.5 shrink-0", STATE_COLORS[insight.state ?? "new"])} />
      <div className="min-w-0 flex-1">
        <p className={cn(
          "font-medium",
          ["expired", "dismissed"].includes(insight.state ?? "") && "text-muted-foreground line-through"
        )}>
          {insight.title}
        </p>
        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
          <Badge variant="outline" className="text-[10px]">
            {SEVERITY_LABELS[insight.severity ?? "medium"] ?? insight.severity}
          </Badge>
          {insight.category && (
            <span className={cn(
              "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium",
              INSIGHT_CATEGORY_COLORS[insight.category] ?? "text-muted-foreground bg-muted"
            )}>
              {INSIGHT_CATEGORY_LABELS[insight.category] ?? insight.category}
            </span>
          )}
          <span className="text-[10px] text-muted-foreground">
            {stateLabel} — {timeAgo(insight.updated_at ?? insight.created_at)}
          </span>
          {insight.assignee_name && (
            <span className="text-[10px] text-muted-foreground">
              → {insight.assignee_name}
            </span>
          )}
        </div>
      </div>
      <span className={cn(
        "text-xs tabular-nums font-medium shrink-0",
        (insight.confidence ?? 0) >= 0.85 ? "text-success" : "text-muted-foreground"
      )}>
        {((insight.confidence ?? 0) * 100).toFixed(0)}%
      </span>
    </div>
  );
}
