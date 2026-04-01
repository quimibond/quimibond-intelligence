"use client";

import { Link2 } from "lucide-react";
import type { EntityRelationship } from "@/lib/types";
import { formatDate } from "@/lib/utils";
import { EmptyState } from "@/components/shared/empty-state";
import { LoadingGrid } from "@/components/shared/loading-grid";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

export interface RelationshipRow extends EntityRelationship {
  entity_a_name: string;
  entity_b_name: string;
}

interface TabRelationshipsProps {
  relationships: RelationshipRow[];
  loading: boolean;
}

export function TabRelationships({ relationships, loading }: TabRelationshipsProps) {
  if (loading) return <LoadingGrid rows={8} />;

  if (relationships.length === 0) {
    return (
      <EmptyState
        icon={Link2}
        title="Sin relaciones"
        description="No se han encontrado relaciones entre entidades."
      />
    );
  }

  return (
    <div className="pt-4">
      {/* Mobile cards */}
      <div className="space-y-3 md:hidden">
        {relationships.map((rel) => (
          <div key={rel.id} className="rounded-lg border bg-card p-3 space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <span className="font-medium truncate">{rel.entity_a_name}</span>
              <Badge variant="secondary" className="shrink-0">{rel.relationship_type}</Badge>
              <span className="font-medium truncate">{rel.entity_b_name}</span>
            </div>
            <div className="flex items-center gap-2">
              <Progress value={(rel.strength ?? 0) * 100} className="h-2 flex-1" />
              <span className="text-xs tabular-nums text-muted-foreground">
                {((rel.strength ?? 0) * 100).toFixed(0)}%
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Desktop table */}
      <div className="hidden md:block rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Entidad A</TableHead>
              <TableHead>Tipo relacion</TableHead>
              <TableHead>Entidad B</TableHead>
              <TableHead className="w-40">Fuerza</TableHead>
              <TableHead>Fecha</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {relationships.map((rel) => (
              <TableRow key={rel.id}>
                <TableCell className="font-medium">
                  {rel.entity_a_name}
                </TableCell>
                <TableCell>
                  <Badge variant="secondary">
                    {rel.relationship_type}
                  </Badge>
                </TableCell>
                <TableCell className="font-medium">
                  {rel.entity_b_name}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Progress
                      value={(rel.strength ?? 0) * 100}
                      className="h-2 flex-1"
                    />
                    <span className="text-xs tabular-nums text-muted-foreground w-10 text-right">
                      {((rel.strength ?? 0) * 100).toFixed(0)}%
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDate(rel.created_at)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
