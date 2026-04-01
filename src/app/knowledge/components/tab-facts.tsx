"use client";

import { Lightbulb } from "lucide-react";
import type { Fact } from "@/lib/types";
import { formatDate, truncate } from "@/lib/utils";
import { EmptyState } from "@/components/shared/empty-state";
import { LoadingGrid } from "@/components/shared/loading-grid";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

function factTypeBadgeVariant(
  type: string | null
): "default" | "secondary" | "info" | "success" | "warning" | "outline" {
  if (!type) return "outline";
  const map: Record<string, "info" | "success" | "warning" | "secondary"> = {
    preference: "info",
    relationship: "success",
    event: "warning",
    observation: "secondary",
  };
  return map[type] ?? "outline";
}

interface TabFactsProps {
  facts: Fact[];
  loading: boolean;
}

export function TabFacts({ facts, loading }: TabFactsProps) {
  if (loading) return <LoadingGrid rows={8} />;

  if (facts.length === 0) {
    return (
      <EmptyState
        icon={Lightbulb}
        title="Sin hechos"
        description="No se han extraido hechos del sistema."
      />
    );
  }

  return (
    <div className="pt-4">
      {/* Mobile cards */}
      <div className="space-y-3 md:hidden">
        {facts.map((fact) => (
          <div key={fact.id} className="rounded-lg border bg-card p-3 space-y-2">
            <p className="text-sm">{truncate(fact.fact_text, 150)}</p>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={factTypeBadgeVariant(fact.fact_type)}>
                {fact.fact_type ?? "\u2014"}
              </Badge>
              <span className="text-xs tabular-nums text-muted-foreground">
                {(fact.confidence * 100).toFixed(0)}%
              </span>
              {fact.verified && <Badge variant="success" className="text-[10px]">Verificado</Badge>}
              {fact.is_future && <Badge variant="info" className="text-[10px]">Futuro</Badge>}
              {fact.expired && <Badge variant="critical" className="text-[10px]">Expirado</Badge>}
              {fact.fact_date && (
                <span className="text-xs text-muted-foreground">{formatDate(fact.fact_date)}</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[300px]">Hecho</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Entity ID</TableHead>
              <TableHead className="w-32">Confianza</TableHead>
              <TableHead>Verificado</TableHead>
              <TableHead>Fecha</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {facts.map((fact) => (
              <TableRow key={fact.id}>
                <TableCell>
                  {truncate(fact.fact_text, 120)}
                </TableCell>
                <TableCell>
                  <Badge variant={factTypeBadgeVariant(fact.fact_type)}>
                    {fact.fact_type ?? "\u2014"}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {fact.entity_id ?? "\u2014"}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Progress
                      value={fact.confidence * 100}
                      className="h-2 flex-1"
                    />
                    <span className="text-xs tabular-nums text-muted-foreground w-10 text-right">
                      {(fact.confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    <Badge variant={fact.verified ? "success" : "outline"}>
                      {fact.verified ? "Verificado" : "No verificado"}
                    </Badge>
                    {fact.is_future && (
                      <Badge variant="info">Futuro</Badge>
                    )}
                    {fact.expired && (
                      <Badge variant="critical">Expirado</Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {fact.fact_date ? formatDate(fact.fact_date) : "\u2014"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
