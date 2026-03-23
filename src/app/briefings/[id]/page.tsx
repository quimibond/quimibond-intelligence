"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, BookOpen, Calendar, Cpu } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { formatDate, timeAgo } from "@/lib/utils";
import type { Briefing } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";

export default function BriefingDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchBriefing() {
      const { data, error } = await supabase
        .from("briefings")
        .select("*")
        .eq("id", params.id)
        .single();

      if (!error && data) {
        setBriefing(data as Briefing);
      }
      setLoading(false);
    }
    fetchBriefing();
  }, [params.id]);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (!briefing) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" onClick={() => router.push("/briefings")}>
          <ArrowLeft className="h-4 w-4" />
          Volver a briefings
        </Button>
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <BookOpen className="mb-4 h-8 w-8 text-muted-foreground" />
          <h3 className="text-lg font-semibold">Briefing no encontrado</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            El briefing solicitado no existe o fue eliminado.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Button variant="ghost" onClick={() => router.push("/briefings")}>
        <ArrowLeft className="h-4 w-4" />
        Volver a briefings
      </Button>

      <Card>
        <CardHeader className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="info">{briefing.briefing_type}</Badge>
            {(briefing.period_start || briefing.period_end) && (
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Calendar className="h-4 w-4" />
                {formatDate(briefing.period_start)} &mdash;{" "}
                {formatDate(briefing.period_end)}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            {briefing.model_used && (
              <span className="flex items-center gap-1">
                <Cpu className="h-3.5 w-3.5" />
                {briefing.model_used}
              </span>
            )}
            <span>{timeAgo(briefing.created_at)}</span>
          </div>
        </CardHeader>

        <Separator />

        <CardContent className="pt-6">
          {briefing.html_content ? (
            <div
              className="prose prose-sm dark:prose-invert max-w-none"
              dangerouslySetInnerHTML={{ __html: briefing.html_content }}
            />
          ) : briefing.summary ? (
            <p className="whitespace-pre-wrap text-sm leading-relaxed">
              {briefing.summary}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Este briefing no tiene contenido.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
