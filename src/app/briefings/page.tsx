"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BookOpen, Calendar, Mail, AlertTriangle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { formatDate, timeAgo, truncate } from "@/lib/utils";
import type { Briefing } from "@/lib/types";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LoadingGrid } from "@/components/shared/loading-grid";

const SCOPE_LABELS: Record<string, string> = {
  daily: "General",
  director: "Direccion",
  ventas: "Ventas",
  logistica: "Logistica",
  compras: "Compras",
  account: "Por cuenta",
  company: "Por empresa",
  weekly: "Semanal",
};

const PAGE_SIZE = 30;

export default function BriefingsPage() {
  const [summaries, setSummaries] = useState<Briefing[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [scopeFilter, setScopeFilter] = useState<string>("daily");

  useEffect(() => {
    async function fetchSummaries() {
      const { data, error } = await supabase
        .from("briefings")
        .select("*")
        .in("scope", ["daily", "director", "ventas", "logistica", "compras"])
        .order("briefing_date", { ascending: false })
        .limit(PAGE_SIZE);

      if (!error && data) {
        setSummaries(data as Briefing[]);
        setHasMore(data.length >= PAGE_SIZE);
      }
      setLoading(false);
    }
    fetchSummaries();
  }, []);

  const loadMore = useCallback(async () => {
    setLoadingMore(true);
    const { data, error } = await supabase
      .from("briefings")
      .select("*")
      .in("scope", ["daily", "director", "ventas", "logistica", "compras"])
      .order("briefing_date", { ascending: false })
      .range(summaries.length, summaries.length + PAGE_SIZE - 1);

    if (!error && data) {
      setSummaries((prev) => [...prev, ...data as Briefing[]]);
      setHasMore(data.length >= PAGE_SIZE);
    }
    setLoadingMore(false);
  }, [summaries.length]);

  const availableScopes = useMemo(() => {
    const scopes = new Set(summaries.map((s) => s.scope));
    return Array.from(scopes);
  }, [summaries]);

  const filtered = useMemo(() => {
    if (scopeFilter === "all") return summaries;
    return summaries.filter((s) => s.scope === scopeFilter);
  }, [summaries, scopeFilter]);

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Briefings" description="Cargando..." />
        <LoadingGrid rows={4} rowHeight="h-48" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Briefings"
        description="Resumenes de inteligencia generados por IA, por rol"
      />

      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={scopeFilter}
          onChange={(e) => setScopeFilter(e.target.value)}
          aria-label="Filtrar por alcance"
        >
          <option value="all">Todos los roles</option>
          {availableScopes.map((s) => (
            <option key={s} value={s}>{SCOPE_LABELS[s] ?? s}</option>
          ))}
        </Select>
        <span className="text-sm text-muted-foreground">
          {filtered.length} briefing{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="Sin briefings"
          description="No hay briefings para el rol seleccionado."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {filtered.map((summary) => (
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
                      {summary.scope !== "daily" && (
                        <Badge variant="info" className="text-xs">
                          {SCOPE_LABELS[summary.scope] ?? summary.scope}
                        </Badge>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {timeAgo(summary.created_at)}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {summary.title && (
                    <p className="text-sm font-medium">{summary.title}</p>
                  )}
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
                        <span className="flex items-center gap-1 text-warning">
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

      {hasMore && filtered.length > 0 && (
        <div className="flex justify-center pt-4">
          <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? "Cargando..." : "Cargar mas"}
          </Button>
        </div>
      )}
    </div>
  );
}
