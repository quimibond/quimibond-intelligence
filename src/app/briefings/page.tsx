"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { timeAgo } from "@/lib/utils";
import { FileText } from "lucide-react";
import Link from "next/link";

interface Briefing {
  id: string;
  briefing_type: string;
  period_start: string;
  period_end: string;
  summary: string;
  html_content: string;
  created_at: string;
  account_email: string;
}

const typeLabel: Record<string, string> = {
  daily: "Diario",
  weekly: "Semanal",
  account: "Cuenta",
  strategic: "Estrategico",
};

export default function BriefingsPage() {
  const [briefings, setBriefings] = useState<Briefing[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");

  useEffect(() => {
    async function fetch() {
      let query = supabase
        .from("briefings")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);

      if (filter !== "all") {
        query = query.eq("briefing_type", filter);
      }

      const { data } = await query;
      setBriefings(data || []);
      setLoading(false);
    }
    fetch();
  }, [filter]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Briefings</h1>
          <p className="text-sm text-[var(--muted-foreground)]">Resumenes de inteligencia generados automaticamente</p>
        </div>
        <div className="flex gap-1">
          {["all", "daily", "weekly", "account", "strategic"].map((f) => (
            <button
              key={f}
              onClick={() => { setFilter(f); setLoading(true); }}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                filter === f
                  ? "bg-[var(--primary)] text-white"
                  : "text-[var(--muted-foreground)] hover:bg-[var(--accent)]"
              }`}
            >
              {f === "all" ? "Todos" : typeLabel[f] || f}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-pulse text-[var(--muted-foreground)]">Cargando briefings...</div>
        </div>
      ) : briefings.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FileText className="mb-3 h-10 w-10 text-[var(--muted-foreground)] opacity-50" />
            <p className="text-sm text-[var(--muted-foreground)]">No hay briefings disponibles.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {briefings.map((briefing) => (
            <Link key={briefing.id} href={`/briefings/${briefing.id}`}>
              <Card className="transition-colors hover:border-[var(--primary)]/50 cursor-pointer">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <div className="flex items-center gap-3">
                    <Badge variant="info">{typeLabel[briefing.briefing_type] || briefing.briefing_type}</Badge>
                    {briefing.account_email && (
                      <span className="text-xs text-[var(--muted-foreground)]">{briefing.account_email}</span>
                    )}
                  </div>
                  <span className="text-xs text-[var(--muted-foreground)]">{timeAgo(briefing.created_at)}</span>
                </CardHeader>
                <CardContent>
                  <p className="text-sm line-clamp-2">
                    {briefing.summary || "Sin resumen disponible"}
                  </p>
                  {briefing.period_start && briefing.period_end && (
                    <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                      Periodo: {new Date(briefing.period_start).toLocaleDateString("es-MX")} -{" "}
                      {new Date(briefing.period_end).toLocaleDateString("es-MX")}
                    </p>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
