"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Zap } from "lucide-react";
import { cn, timeAgo } from "@/lib/utils";
import type { AgentInsight } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select-native";
import { SeverityBadge } from "@/components/shared/severity-badge";
import { EmptyState } from "@/components/shared/empty-state";

// ── Helpers ──

const STATE_LABELS: Record<string, string> = {
  new: "Nuevo",
  seen: "Visto",
  acted_on: "Actuado",
  dismissed: "Descartado",
  expired: "Expirado",
};

function stateBadgeVariant(
  state: string
): "info" | "warning" | "success" | "secondary" | "outline" {
  switch (state) {
    case "new":
      return "info";
    case "seen":
      return "warning";
    case "acted_on":
      return "success";
    case "dismissed":
      return "secondary";
    case "expired":
      return "outline";
    default:
      return "secondary";
  }
}

// ── Component ──

interface Props {
  insights: AgentInsight[];
  agentDomain: string;
}

export function TabInsights({ insights, agentDomain }: Props) {
  const [stateFilter, setStateFilter] = useState("all");

  const filtered = useMemo(() => {
    if (stateFilter === "all") return insights;
    return insights.filter((i) => i.state === stateFilter);
  }, [insights, stateFilter]);

  return (
    <div className="space-y-3">
      {/* Filter */}
      <div className="flex items-center gap-2">
        <Select
          aria-label="Filtrar por estado"
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value)}
          className="w-[180px]"
        >
          <option value="all">Todos ({insights.length})</option>
          <option value="new">
            Nuevos ({insights.filter((i) => i.state === "new").length})
          </option>
          <option value="seen">
            Vistos ({insights.filter((i) => i.state === "seen").length})
          </option>
          <option value="acted_on">
            Actuados ({insights.filter((i) => i.state === "acted_on").length})
          </option>
          <option value="dismissed">
            Descartados (
            {insights.filter((i) => i.state === "dismissed").length})
          </option>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Zap}
          title="Sin insights"
          description={
            stateFilter !== "all"
              ? "No hay insights con el filtro seleccionado"
              : "Este agente no ha generado insights todavia"
          }
        />
      ) : (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              {filtered.length} insight{filtered.length !== 1 ? "s" : ""}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="px-4 py-2 text-left font-medium">
                      Severidad
                    </th>
                    <th className="px-4 py-2 text-left font-medium">Titulo</th>
                    <th className="px-4 py-2 text-left font-medium">
                      Empresa
                    </th>
                    <th className="px-4 py-2 text-left font-medium">Estado</th>
                    <th className="px-4 py-2 text-right font-medium">
                      Confianza
                    </th>
                    <th className="px-4 py-2 text-right font-medium">Fecha</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((insight) => (
                    <tr
                      key={insight.id}
                      className="border-b last:border-0 hover:bg-muted/50 transition-colors"
                    >
                      <td className="px-4 py-2.5">
                        <SeverityBadge severity={insight.severity ?? "low"} />
                      </td>
                      <td className="px-4 py-2.5 max-w-[300px]">
                        <Link
                          href={`/inbox/insight/${insight.id}`}
                          className="text-sm font-medium hover:underline truncate block"
                        >
                          {insight.title}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground text-xs">
                        {insight.assignee_name ?? "--"}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge variant={stateBadgeVariant(insight.state ?? "new")}>
                          {STATE_LABELS[insight.state ?? "new"] ??
                            insight.state}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {insight.confidence != null
                          ? `${Math.round(insight.confidence * 100)}%`
                          : "--"}
                      </td>
                      <td className="px-4 py-2.5 text-right text-xs text-muted-foreground">
                        {timeAgo(insight.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile list */}
            <div className="md:hidden divide-y">
              {filtered.map((insight) => (
                <Link
                  key={insight.id}
                  href={`/inbox/insight/${insight.id}`}
                  className="block p-3 space-y-1.5 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <SeverityBadge severity={insight.severity ?? "low"} />
                    <Badge variant={stateBadgeVariant(insight.state ?? "new")}>
                      {STATE_LABELS[insight.state ?? "new"] ?? insight.state}
                    </Badge>
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {timeAgo(insight.created_at)}
                    </span>
                  </div>
                  <p className="text-sm font-medium truncate">
                    {insight.title}
                  </p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {insight.assignee_name && (
                      <span>{insight.assignee_name}</span>
                    )}
                    {insight.confidence != null && (
                      <span className="tabular-nums">
                        {Math.round(insight.confidence * 100)}% confianza
                      </span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
