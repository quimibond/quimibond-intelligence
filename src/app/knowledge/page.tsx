"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Brain,
  Link2,
  Lightbulb,
  Tag,
  Search,
  Network,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { timeAgo, formatDate, truncate } from "@/lib/utils";
import type { Entity, EntityRelationship, Fact, Topic } from "@/lib/types";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent } from "@/components/ui/card";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
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

// ── Relationships with resolved entity names ──

interface RelationshipRow extends EntityRelationship {
  entity_a_name: string;
  entity_b_name: string;
}

export default function KnowledgePage() {
  // Entities
  const [entities, setEntities] = useState<Entity[]>([]);
  const [entitiesLoading, setEntitiesLoading] = useState(true);
  const [entityTypes, setEntityTypes] = useState<string[]>([]);
  const [typeFilter, setTypeFilter] = useState("all");
  const [entitySearch, setEntitySearch] = useState("");

  // Relationships
  const [relationships, setRelationships] = useState<RelationshipRow[]>([]);
  const [relLoading, setRelLoading] = useState(true);

  // Facts
  const [facts, setFacts] = useState<Fact[]>([]);
  const [factsLoading, setFactsLoading] = useState(true);

  // Topics
  const [topics, setTopics] = useState<Topic[]>([]);
  const [topicsLoading, setTopicsLoading] = useState(true);

  // ── Fetch entities ──
  useEffect(() => {
    async function fetchEntities() {
      const { data } = await supabase
        .from("entities")
        .select("*")
        .order("last_seen", { ascending: false })
        .limit(200);
      const rows = (data ?? []) as Entity[];
      setEntities(rows);

      // Extract distinct entity types
      const types = Array.from(new Set(rows.map((e) => e.entity_type))).sort();
      setEntityTypes(types);
      setEntitiesLoading(false);
    }
    fetchEntities();
  }, []);

  // ── Fetch relationships + resolve entity names ──
  useEffect(() => {
    async function fetchRelationships() {
      const { data: rels } = await supabase
        .from("entity_relationships")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);

      if (!rels || rels.length === 0) {
        setRelationships([]);
        setRelLoading(false);
        return;
      }

      // Collect unique entity ids
      const ids = new Set<number>();
      for (const r of rels as EntityRelationship[]) {
        ids.add(r.entity_a_id);
        ids.add(r.entity_b_id);
      }

      const { data: entityData } = await supabase
        .from("entities")
        .select("id, name")
        .in("id", Array.from(ids));

      const nameMap = new Map<number, string>();
      for (const e of (entityData ?? []) as { id: number; name: string }[]) {
        nameMap.set(e.id, e.name);
      }

      const resolved: RelationshipRow[] = (rels as EntityRelationship[]).map(
        (r) => ({
          ...r,
          entity_a_name: nameMap.get(r.entity_a_id) ?? String(r.entity_a_id),
          entity_b_name: nameMap.get(r.entity_b_id) ?? String(r.entity_b_id),
        })
      );

      setRelationships(resolved);
      setRelLoading(false);
    }
    fetchRelationships();
  }, []);

  // ── Fetch facts ──
  useEffect(() => {
    async function fetchFacts() {
      const { data } = await supabase
        .from("facts")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      setFacts((data ?? []) as Fact[]);
      setFactsLoading(false);
    }
    fetchFacts();
  }, []);

  // ── Fetch topics ──
  useEffect(() => {
    async function fetchTopics() {
      const { data } = await supabase
        .from("topics")
        .select("*")
        .order("topic", { ascending: true });
      setTopics((data ?? []) as Topic[]);
      setTopicsLoading(false);
    }
    fetchTopics();
  }, []);

  // ── Filtered entities ──
  const filteredEntities = useMemo(() => {
    const q = entitySearch.toLowerCase();
    return entities.filter((e) => {
      if (typeFilter !== "all" && e.entity_type !== typeFilter) return false;
      if (!q) return true;
      return (
        e.name.toLowerCase().includes(q) ||
        e.canonical_name?.toLowerCase().includes(q) ||
        e.email?.toLowerCase().includes(q)
      );
    });
  }, [entities, typeFilter, entitySearch]);

  // ── Helpers ──
  function attributeSummary(attrs: Record<string, unknown>): string {
    const keys = Object.keys(attrs);
    if (keys.length === 0) return "—";
    if (keys.length <= 3) return keys.join(", ");
    return `${keys.slice(0, 3).join(", ")} (+${keys.length - 3})`;
  }

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

  // ── Loading skeleton ──
  function TableSkeleton({ rows = 8 }: { rows?: number }) {
    return (
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Knowledge Graph"
        description="Entidades, relaciones y hechos extraidos"
      />

      <Tabs defaultValue="entities">
        <TabsList>
          <TabsTrigger value="entities">Entidades</TabsTrigger>
          <TabsTrigger value="relationships">Relaciones</TabsTrigger>
          <TabsTrigger value="facts">Hechos</TabsTrigger>
          <TabsTrigger value="topics">Temas</TabsTrigger>
        </TabsList>

        {/* ── Tab: Entidades ── */}
        <TabsContent value="entities">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 py-4">
            <div className="relative flex-1 sm:max-w-sm">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar por nombre o email..."
                className="pl-9"
                value={entitySearch}
                onChange={(e) => setEntitySearch(e.target.value)}
              />
            </div>
            <Select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="w-full sm:w-40"
            >
              <option value="all">Todas</option>
              {entityTypes.map((t) => (
                <option key={t} value={t}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </option>
              ))}
            </Select>
          </div>

          {entitiesLoading ? (
            <TableSkeleton />
          ) : filteredEntities.length === 0 ? (
            <EmptyState
              icon={Brain}
              title="Sin entidades"
              description="No se encontraron entidades con los filtros actuales."
            />
          ) : (
            <div className="overflow-x-auto rounded-md border">
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
                        {entity.email ?? "—"}
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
          )}
        </TabsContent>

        {/* ── Tab: Relaciones ── */}
        <TabsContent value="relationships">
          <div className="pt-4">
            {relLoading ? (
              <TableSkeleton />
            ) : relationships.length === 0 ? (
              <EmptyState
                icon={Link2}
                title="Sin relaciones"
                description="No se han encontrado relaciones entre entidades."
              />
            ) : (
              <div className="rounded-md border">
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
            )}
          </div>
        </TabsContent>

        {/* ── Tab: Hechos ── */}
        <TabsContent value="facts">
          <div className="pt-4">
            {factsLoading ? (
              <TableSkeleton />
            ) : facts.length === 0 ? (
              <EmptyState
                icon={Lightbulb}
                title="Sin hechos"
                description="No se han extraido hechos del sistema."
              />
            ) : (
              <div className="rounded-md border">
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
                            {fact.fact_type ?? "—"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {fact.entity_id ?? "—"}
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
                          {fact.fact_date ? formatDate(fact.fact_date) : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── Tab: Temas ── */}
        <TabsContent value="topics">
          <div className="pt-4">
            {topicsLoading ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {Array.from({ length: 12 }).map((_, i) => (
                  <Skeleton key={i} className="h-20 w-full rounded-lg" />
                ))}
              </div>
            ) : topics.length === 0 ? (
              <EmptyState
                icon={Tag}
                title="Sin temas"
                description="No se han identificado temas aun."
              />
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {topics.map((t) => (
                  <Card key={t.id} className="hover:bg-muted/50 transition-colors">
                    <CardContent className="flex flex-col items-start gap-2 p-4">
                      <span className="font-medium text-sm">{t.topic}</span>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {t.category && (
                          <Badge variant="secondary" className="text-xs">
                            {t.category}
                          </Badge>
                        )}
                        {t.status && (
                          <Badge variant="info" className="text-xs">
                            {t.status}
                          </Badge>
                        )}
                        {t.priority && (
                          <Badge variant="warning" className="text-xs">
                            {t.priority}
                          </Badge>
                        )}
                      </div>
                      {t.summary && (
                        <p className="text-xs text-muted-foreground line-clamp-2">
                          {t.summary}
                        </p>
                      )}
                      {t.times_seen != null && (
                        <span className="text-xs text-muted-foreground">
                          Visto {t.times_seen} {t.times_seen === 1 ? "vez" : "veces"}
                        </span>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
