"use client";

import { Tag } from "lucide-react";
import type { Topic } from "@/lib/types";
import { EmptyState } from "@/components/shared/empty-state";
import { LoadingGrid } from "@/components/shared/loading-grid";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

interface TabTopicsProps {
  topics: Topic[];
  loading: boolean;
}

export function TabTopics({ topics, loading }: TabTopicsProps) {
  if (loading) return <LoadingGrid rows={6} />;

  if (topics.length === 0) {
    return (
      <EmptyState
        icon={Tag}
        title="Sin temas"
        description="No se han identificado temas aun."
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 pt-4 sm:grid-cols-2 lg:grid-cols-3">
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
  );
}
