"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BookOpen, Calendar, Cpu } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { formatDate, timeAgo, truncate } from "@/lib/utils";
import type { Briefing } from "@/lib/types";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function BriefingsPage() {
  const [briefings, setBriefings] = useState<Briefing[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchBriefings() {
      const { data, error } = await supabase
        .from("briefings")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);

      if (!error && data) {
        setBriefings(data as Briefing[]);
      }
      setLoading(false);
    }
    fetchBriefings();
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-5 w-80" />
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-48 w-full rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Briefings"
        description="Reportes de inteligencia generados por IA"
      />

      {briefings.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="Sin briefings"
          description="Aun no se han generado reportes de inteligencia."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {briefings.map((briefing) => (
            <Link key={briefing.id} href={`/briefings/${briefing.id}`}>
              <Card className="h-full transition-colors hover:border-primary/30">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <Badge variant="info">{briefing.briefing_type}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {timeAgo(briefing.created_at)}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm leading-relaxed">
                    {truncate(briefing.summary, 200)}
                  </p>
                  {(briefing.period_start || briefing.period_end) && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Calendar className="h-3.5 w-3.5" />
                      {formatDate(briefing.period_start)} &mdash;{" "}
                      {formatDate(briefing.period_end)}
                    </div>
                  )}
                </CardContent>
                {briefing.model_used && (
                  <CardFooter className="pt-0">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Cpu className="h-3.5 w-3.5" />
                      {briefing.model_used}
                    </div>
                  </CardFooter>
                )}
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
