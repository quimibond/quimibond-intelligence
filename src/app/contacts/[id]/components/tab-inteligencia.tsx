"use client";

import { Brain } from "lucide-react";
import { formatDate } from "@/lib/utils";
import type { Fact } from "@/lib/types";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface TabInteligenciaProps {
  facts: Fact[];
}

export function TabInteligencia({ facts }: TabInteligenciaProps) {
  if (facts.length === 0) {
    return (
      <EmptyState
        icon={Brain}
        title="Sin hechos"
        description="No se han extraido hechos para este contacto."
      />
    );
  }

  return (
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
                {fact.fact_type && (
                  <Badge variant="outline">{fact.fact_type}</Badge>
                )}
              </TableCell>
              <TableCell className="text-sm">
                <span>{fact.fact_text}</span>
                <div className="flex gap-1 mt-1">
                  {fact.verified && <Badge variant="success" className="text-[10px]">Verificado</Badge>}
                  {fact.is_future && <Badge variant="info" className="text-[10px]">Futuro</Badge>}
                  {fact.expired && <Badge variant="critical" className="text-[10px]">Expirado</Badge>}
                </div>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {(fact.confidence * 100).toFixed(0)}%
              </TableCell>
              <TableCell className="text-muted-foreground whitespace-nowrap">
                {formatDate(fact.fact_date ?? fact.created_at)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
