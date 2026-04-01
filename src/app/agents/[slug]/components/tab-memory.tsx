"use client";

import { Brain, Clock, Hash, Star, Sparkles } from "lucide-react";
import { timeAgo } from "@/lib/utils";
import type { AgentMemory } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";

// ── Helpers ──

function memoryTypeBadgeVariant(
  type: string
): "default" | "success" | "info" | "outline" {
  switch (type) {
    case "learning":
      return "success";
    case "preference":
      return "info";
    case "pattern":
      return "default";
    default:
      return "outline";
  }
}

function importanceBadgeVariant(
  importance: number | null
): "critical" | "warning" | "info" | "secondary" {
  if (importance == null) return "secondary";
  if (importance >= 8) return "critical";
  if (importance >= 5) return "warning";
  if (importance >= 3) return "info";
  return "secondary";
}

// ── Component ──

interface Props {
  memories: AgentMemory[];
}

export function TabMemory({ memories }: Props) {
  if (memories.length === 0) {
    return (
      <EmptyState
        icon={Brain}
        title="Sin memorias"
        description="Este agente no ha generado memorias todavia"
      />
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">
          {memories.length} memoria{memories.length !== 1 ? "s" : ""}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        {memories.map((mem) => (
          <div key={mem.id} className="rounded-lg border p-3 space-y-2">
            {/* Content */}
            <p className="text-sm leading-relaxed">{mem.content}</p>

            {/* Badges row */}
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant={memoryTypeBadgeVariant(mem.memory_type)}>
                {mem.memory_type}
              </Badge>
              {mem.importance != null && (
                <Badge variant={importanceBadgeVariant(mem.importance)}>
                  <Star className="h-3 w-3 mr-0.5" />
                  {mem.importance}
                </Badge>
              )}
              {mem.context_type && (
                <Badge variant="outline">{mem.context_type}</Badge>
              )}
            </div>

            {/* Meta row */}
            <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <Hash className="h-3 w-3" />
                {mem.times_used} uso{mem.times_used !== 1 ? "s" : ""}
              </span>
              {mem.last_used_at && (
                <span className="flex items-center gap-1">
                  <Sparkles className="h-3 w-3" />
                  Usado {timeAgo(mem.last_used_at)}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Creada {timeAgo(mem.created_at)}
              </span>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
