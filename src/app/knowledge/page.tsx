"use client";

import { useEffect, useState } from "react";
import { Brain, Link2, Lightbulb, Tag } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { Entity, EntityRelationship, Fact, Topic } from "@/lib/types";
import { PageHeader } from "@/components/shared/page-header";
import { MiniStatCard } from "@/components/shared/mini-stat-card";
import { LoadingGrid } from "@/components/shared/loading-grid";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { TabEntities } from "./components/tab-entities";
import { TabRelationships, type RelationshipRow } from "./components/tab-relationships";
import { TabFacts } from "./components/tab-facts";
import { TabTopics } from "./components/tab-topics";

const ENTITIES_PAGE_SIZE = 50;

export default function KnowledgePage() {
  // ── State ──
  const [entities, setEntities] = useState<Entity[]>([]);
  const [entitiesLoading, setEntitiesLoading] = useState(true);
  const [entityTypes, setEntityTypes] = useState<string[]>([]);

  const [relationships, setRelationships] = useState<RelationshipRow[]>([]);
  const [relLoading, setRelLoading] = useState(true);

  const [facts, setFacts] = useState<Fact[]>([]);
  const [factsLoading, setFactsLoading] = useState(true);

  const [topics, setTopics] = useState<Topic[]>([]);
  const [topicsLoading, setTopicsLoading] = useState(true);

  // ── Fetch entities ──
  useEffect(() => {
    async function fetchEntities() {
      const { data } = await supabase
        .from("entities")
        .select("*")
        .order("last_seen", { ascending: false })
        .limit(ENTITIES_PAGE_SIZE);
      const rows = (data ?? []) as Entity[];
      setEntities(rows);
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

  // ── Derived stats ──
  const allLoaded = !entitiesLoading && !relLoading && !factsLoading && !topicsLoading;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Knowledge Graph"
        description="Entidades, relaciones y hechos extraidos"
      />

      {/* Quick Stats */}
      {allLoaded && (entities.length > 0 || facts.length > 0 || relationships.length > 0 || topics.length > 0) && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MiniStatCard icon={Brain} label="Entidades" value={entities.length} />
          <MiniStatCard icon={Lightbulb} label="Hechos" value={facts.length} />
          <MiniStatCard icon={Link2} label="Relaciones" value={relationships.length} />
          <MiniStatCard icon={Tag} label="Temas" value={topics.length} />
        </div>
      )}

      {!allLoaded && <LoadingGrid stats={4} rows={0} />}

      <Tabs defaultValue="entities">
        <TabsList>
          <TabsTrigger value="entities">Entidades</TabsTrigger>
          <TabsTrigger value="relationships">Relaciones</TabsTrigger>
          <TabsTrigger value="facts">Hechos</TabsTrigger>
          <TabsTrigger value="topics">Temas</TabsTrigger>
        </TabsList>

        <TabsContent value="entities">
          <TabEntities
            entities={entities}
            setEntities={setEntities}
            loading={entitiesLoading}
            entityTypes={entityTypes}
            setEntityTypes={setEntityTypes}
          />
        </TabsContent>

        <TabsContent value="relationships">
          <TabRelationships relationships={relationships} loading={relLoading} />
        </TabsContent>

        <TabsContent value="facts">
          <TabFacts facts={facts} loading={factsLoading} />
        </TabsContent>

        <TabsContent value="topics">
          <TabTopics topics={topics} loading={topicsLoading} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
