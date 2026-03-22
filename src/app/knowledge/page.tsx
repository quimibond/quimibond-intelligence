"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Search, Network, BookOpen, Link2, Users } from "lucide-react";

interface Entity {
  id: string;
  entity_type: string;
  name: string;
  canonical_name: string;
  email: string;
  attributes: Record<string, unknown>;
  last_seen: string;
}

interface Fact {
  id: string;
  fact_text: string;
  fact_type: string;
  confidence: number;
  source_type: string;
  email_id: number;
  created_at: string;
}

interface Relationship {
  id: string;
  relationship_type: string;
  confidence: number;
  entity_a: { name: string; entity_type: string } | null;
  entity_b: { name: string; entity_type: string } | null;
}

type Tab = "entities" | "facts" | "relationships";

export default function KnowledgePage() {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [facts, setFacts] = useState<Fact[]>([]);
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<Tab>("entities");

  useEffect(() => {
    async function fetchData() {
      const [entitiesRes, factsRes, relsRes] = await Promise.all([
        supabase
          .from("entities")
          .select("*")
          .order("last_seen", { ascending: false })
          .limit(200),
        supabase
          .from("facts")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(100),
        supabase
          .from("entity_relationships")
          .select("id, relationship_type, confidence, entity_a:entity_a_id(name, entity_type), entity_b:entity_b_id(name, entity_type)")
          .order("created_at", { ascending: false })
          .limit(100),
      ]);
      setEntities(entitiesRes.data || []);
      setFacts(factsRes.data || []);
      setRelationships((relsRes.data as unknown as Relationship[]) || []);
      setLoading(false);
    }
    fetchData();
  }, []);

  const filteredEntities = search
    ? entities.filter(
        (e) =>
          e.name?.toLowerCase().includes(search.toLowerCase()) ||
          e.canonical_name?.toLowerCase().includes(search.toLowerCase()) ||
          e.entity_type?.toLowerCase().includes(search.toLowerCase())
      )
    : entities;

  const filteredFacts = search
    ? facts.filter((f) => f.fact_text?.toLowerCase().includes(search.toLowerCase()))
    : facts;

  const filteredRels = search
    ? relationships.filter(
        (r) =>
          r.relationship_type?.toLowerCase().includes(search.toLowerCase()) ||
          r.entity_a?.name?.toLowerCase().includes(search.toLowerCase()) ||
          r.entity_b?.name?.toLowerCase().includes(search.toLowerCase())
      )
    : relationships;

  const tabs: { key: Tab; label: string; icon: typeof Network; count: number }[] = [
    { key: "entities", label: "Entidades", icon: Users, count: entities.length },
    { key: "facts", label: "Hechos", icon: BookOpen, count: facts.length },
    { key: "relationships", label: "Relaciones", icon: Link2, count: relationships.length },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Knowledge Graph</h1>
        <p className="text-sm text-[var(--muted-foreground)]">
          Entidades, hechos y relaciones extraidos del analisis de comunicaciones
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <input
            type="text"
            placeholder="Buscar..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] py-2.5 pl-10 pr-4 text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
          />
        </div>

        <div className="flex gap-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                tab === t.key
                  ? "bg-[var(--primary)] text-white"
                  : "text-[var(--muted-foreground)] hover:bg-[var(--accent)]"
              }`}
            >
              <t.icon className="h-3 w-3" /> {t.label} ({t.count})
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-pulse text-[var(--muted-foreground)]">Cargando conocimiento...</div>
        </div>
      ) : tab === "entities" ? (
        filteredEntities.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Network className="mb-3 h-10 w-10 text-[var(--muted-foreground)] opacity-50" />
              <p className="text-sm text-[var(--muted-foreground)]">No se encontraron entidades.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filteredEntities.map((entity) => (
              <Card key={entity.id}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-1">
                    <p className="text-sm font-medium">{entity.name}</p>
                    <Badge variant="outline" className="text-[10px]">{entity.entity_type}</Badge>
                  </div>
                  {entity.canonical_name && entity.canonical_name !== entity.name && (
                    <p className="text-xs text-[var(--muted-foreground)]">{entity.canonical_name}</p>
                  )}
                  {entity.email && (
                    <p className="text-xs text-[var(--muted-foreground)]">{entity.email}</p>
                  )}
                  {entity.last_seen && (
                    <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                      Visto: {new Date(entity.last_seen).toLocaleDateString("es-MX", { day: "numeric", month: "short" })}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )
      ) : tab === "facts" ? (
        filteredFacts.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <BookOpen className="mb-3 h-10 w-10 text-[var(--muted-foreground)] opacity-50" />
              <p className="text-sm text-[var(--muted-foreground)]">No se encontraron hechos.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {filteredFacts.map((fact) => (
              <Card key={fact.id}>
                <CardContent className="flex items-start gap-4 p-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm">{fact.fact_text}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      {fact.fact_type && <Badge variant="outline">{fact.fact_type}</Badge>}
                      <span className="text-xs text-[var(--muted-foreground)]">
                        Confianza: {(fact.confidence * 100).toFixed(0)}%
                      </span>
                      <Badge variant="secondary" className="text-[10px]">{fact.source_type}</Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )
      ) : filteredRels.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Link2 className="mb-3 h-10 w-10 text-[var(--muted-foreground)] opacity-50" />
            <p className="text-sm text-[var(--muted-foreground)]">No se encontraron relaciones.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filteredRels.map((rel) => (
            <Card key={rel.id}>
              <CardContent className="flex items-center gap-3 p-4 text-sm">
                <div className="flex items-center gap-1.5">
                  <Badge variant="info">{rel.entity_a?.entity_type}</Badge>
                  <span className="font-medium">{rel.entity_a?.name}</span>
                </div>
                <span className="text-[var(--muted-foreground)]">→</span>
                <Badge variant="outline">{rel.relationship_type}</Badge>
                <span className="text-[var(--muted-foreground)]">→</span>
                <div className="flex items-center gap-1.5">
                  <Badge variant="info">{rel.entity_b?.entity_type}</Badge>
                  <span className="font-medium">{rel.entity_b?.name}</span>
                </div>
                <span className="ml-auto text-xs text-[var(--muted-foreground)]">
                  {(rel.confidence * 100).toFixed(0)}%
                </span>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
