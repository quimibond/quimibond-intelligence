"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BookOpen, Calendar, Mail, AlertTriangle } from "lucide-react";
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
  const [summaries, setSummaries] = useState<Briefing[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchSummaries() {
      const { data, error } = await supabase
        .from("briefings")
        .select("*")
        .eq("scope", "daily")
        .order("briefing_date", { ascending: false })
        .limit(50);

      if (!error && data) {
        setSummaries(data as Briefing[]);
      }
      setLoading(false);
    }
    fetchSummaries();
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
        description="Resumenes diarios de inteligencia generados por IA"
      />

      {summaries.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="Sin briefings"
          description="Aun no se han generado resumenes diarios."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {summaries.map((summary) => (
            <Link key={summary.id} href={`/briefings/${summary.id}`}>
              <Card className="h-full transition-colors hover:border-primary/30">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      <CardTitle className="text-base">
                        {summary.briefing_date
                          ? formatDate(summary.briefing_date)
                          : "Sin fecha"}
                      </CardTitle>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {timeAgo(summary.created_at)}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {summary.summary_text && (
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {truncate(summary.summary_text, 200)}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Mail className="h-3.5 w-3.5" />
                      {summary.total_emails} emails
                    </div>
                    {summary.topics_identified != null && (
                      <Badge variant="secondary" className="text-xs">
                        {Array.isArray(summary.topics_identified) ? summary.topics_identified.length : String(summary.topics_identified)} temas
                      </Badge>
                    )}
                  </div>
                </CardContent>
                <CardFooter className="pt-0">
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    {summary.accounts_processed != null && (
                      <span>{summary.accounts_processed} cuentas leidas</span>
                    )}
                    {summary.accounts_failed != null &&
                      summary.accounts_failed > 0 && (
                        <span className="flex items-center gap-1 text-amber-500">
                          <AlertTriangle className="h-3 w-3" />
                          {summary.accounts_failed} fallidas
                        </span>
                      )}
                  </div>
                </CardFooter>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
