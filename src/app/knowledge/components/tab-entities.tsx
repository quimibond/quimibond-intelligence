"use client";

import { useCallback, useMemo, useState } from "react";
import { Brain } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { timeAgo } from "@/lib/utils";
import type { Entity } from "@/lib/types";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterBar } from "@/components/shared/filter-bar";
import { LoadingGrid } from "@/components/shared/loading-grid";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select-native";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

// ── Entity type badge color mapping ──

const entityTypeBadgeVariant: Record<
  string,
  "default" | "secondary" | "info" | "success" | "warning" | "outline"
> = {
  persona: "info",
  empresa: "success",
  producto: "warning",
  lugar: "secondary",
};

function entityBadgeVariant(type: string) {
  return entityTypeBadgeVariant[type] ?? "outline";
}

function attributeSummary(attrs: Record<string, unknown>): string {
  const keys = Object.keys(attrs);
  if (keys.length === 0) return "\u2014";
  if (keys.length <= 3) return keys.join(", ");
  return `${keys.slice(0, 3).join(", ")} (+${keys.length - 3})`;
}

const ENTITIES_PAGE_SIZE = 50;

interface TabEntitiesProps {
  entities: Entity[];
  setEntities: React.Dispatch<React.SetStateAction<Entity[]>>;
  loading: boolean;
  entityTypes: string[];
  setEntityTypes: React.Dispatch<React.SetStateAction<string[]>>;
}

export function TabEntities({
  entities,
  setEntities,
  loading,
  entityTypes,
  setEntityTypes,
}: TabEntitiesProps) {
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(entities.length >= ENTITIES_PAGE_SIZE);
  const [typeFilter, setTypeFilter] = useState("all");
  const [search, setSearch] = useState("");

  const loadMoreEntities = useCallback(async () => {
    setLoadingMore(true);
    const { data } = await supabase
      .from("entities")
      .select("*")
      .order("last_seen", { ascending: false })
      .range(entities.length, entities.length + ENTITIES_PAGE_SIZE - 1);
    const rows = (data ?? []) as Entity[];
    setEntities((prev) => [...prev, ...rows]);
    setHasMore(rows.length >= ENTITIES_PAGE_SIZE);
    setEntityTypes((prev) => {
      const allTypes = new Set([...prev, ...rows.map((e) => e.entity_type)]);
      return Array.from(allTypes).sort();
    });
    setLoadingMore(false);
  }, [entities.length, setEntities, setEntityTypes]);

  const filteredEntities = useMemo(() => {
    const q = search.toLowerCase();
    return entities.filter((e) => {
      if (typeFilter !== "all" && e.entity_type !== typeFilter) return false;
      if (!q) return true;
      return (
        e.name.toLowerCase().includes(q) ||
        e.canonical_name?.toLowerCase().includes(q) ||
        e.email?.toLowerCase().includes(q)
      );
    });
  }, [entities, typeFilter, search]);

  if (loading) return <LoadingGrid rows={8} />;

  return (
    <div className="space-y-4 pt-4">
      <FilterBar search={search} onSearchChange={setSearch} searchPlaceholder="Buscar por nombre o email...">
        <Select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="w-full sm:w-40"
          aria-label="Filtrar por tipo de entidad"
        >
          <option value="all">Todas</option>
          {entityTypes.map((t) => (
            <option key={t} value={t}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </option>
          ))}
        </Select>
      </FilterBar>

      {filteredEntities.length === 0 ? (
        <EmptyState
          icon={Brain}
          title="Sin entidades"
          description="No se encontraron entidades con los filtros actuales."
        />
      ) : (
        <>
          {/* Mobile cards */}
          <div className="space-y-3 md:hidden">
            {filteredEntities.map((entity) => (
              <div key={entity.id} className="rounded-xl border bg-card text-card-foreground shadow-sm p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{entity.name}</p>
                    {entity.email && (
                      <p className="text-xs text-muted-foreground truncate">{entity.email}</p>
                    )}
                  </div>
                  <Badge variant={entityBadgeVariant(entity.entity_type)}>
                    {entity.entity_type}
                  </Badge>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{timeAgo(entity.last_seen)}</span>
                  {attributeSummary(entity.attributes) && (
                    <span className="truncate">{attributeSummary(entity.attributes)}</span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Ultima vez</TableHead>
                  <TableHead>Atributos</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredEntities.map((entity) => (
                  <TableRow key={entity.id}>
                    <TableCell className="font-medium">
                      {entity.name}
                      {entity.canonical_name &&
                        entity.canonical_name !== entity.name && (
                          <p className="text-xs text-muted-foreground">
                            {entity.canonical_name}
                          </p>
                        )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={entityBadgeVariant(entity.entity_type)}>
                        {entity.entity_type}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {entity.email ?? "\u2014"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {timeAgo(entity.last_seen)}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {attributeSummary(entity.attributes)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {hasMore && filteredEntities.length > 0 && (
            <div className="flex justify-center pt-4">
              <Button variant="outline" onClick={loadMoreEntities} disabled={loadingMore}>
                {loadingMore ? "Cargando..." : "Cargar mas"}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
