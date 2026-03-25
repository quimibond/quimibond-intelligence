"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, BookOpen, Calendar, Mail, AlertTriangle } from "lucide-react";
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
  const [summary, setSummary] = useState<Briefing | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchSummary() {
      const { data, error } = await supabase
        .from("briefings")
        .select("*")
        .eq("id", params.id)
        .single();

      if (!error && data) {
        setSummary(data as Briefing);
      }
      setLoading(false);
    }
    fetchSummary();
  }, [params.id]);

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (!summary) {
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
            El resumen diario solicitado no existe o fue eliminado.
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
            <div className="flex items-center gap-1.5 text-sm">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              {summary.briefing_date
                ? formatDate(summary.briefing_date)
                : "Sin fecha"}
            </div>
            <Badge variant="info">Resumen Diario</Badge>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Mail className="h-3.5 w-3.5" />
              {summary.total_emails} emails procesados
            </span>
            {summary.accounts_processed != null && (
              <span>{summary.accounts_processed} cuentas leidas</span>
            )}
            {summary.accounts_failed != null &&
              summary.accounts_failed > 0 && (
                <span className="flex items-center gap-1 text-amber-500">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {summary.accounts_failed} cuentas fallidas
                </span>
              )}
            {summary.topics_identified != null && (
              <span>{Array.isArray(summary.topics_identified) ? summary.topics_identified.length : String(summary.topics_identified)} temas identificados</span>
            )}
            <span>{timeAgo(summary.created_at)}</span>
          </div>
        </CardHeader>

        <Separator />

        <CardContent className="pt-6">
          {summary.summary_html ? (
            <div
              className="prose prose-sm dark:prose-invert max-w-none"
              dangerouslySetInnerHTML={{ __html: summary.summary_html }}
            />
          ) : summary.summary_text ? (
            <p className="whitespace-pre-wrap text-sm leading-relaxed">
              {summary.summary_text}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Este resumen no tiene contenido.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
