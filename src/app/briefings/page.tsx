"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { ChevronRight, Loader2 } from "lucide-react";

type DailySummary = {
  id: string;
  summary_date: string;
  total_emails: number;
  summary_text: string;
  key_events: Record<string, any>;
  account: string;
};

type Briefing = {
  id: string;
  briefing_type: string;
  period_start: string;
  period_end: string;
  summary: string;
  html_content: string;
  created_at: string;
};

export default function BriefingsPage() {
  const router = useRouter();
  const [summaries, setSummaries] = useState<DailySummary[]>([]);
  const [briefings, setBriefings] = useState<Record<string, Briefing>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);

      // Fetch daily summaries
      const { data: summariesData, error: summariesError } = await supabase
        .from("daily_summaries")
        .select("*")
        .order("summary_date", { ascending: false });

      if (summariesError) throw summariesError;
      setSummaries(summariesData as DailySummary[]);

      // Fetch briefings
      const { data: briefingsData } = await supabase
        .from("briefings")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(3);

      if (briefingsData) {
        const briefingsMap: Record<string, Briefing> = {};
        briefingsData.forEach((b: Briefing) => {
          briefingsMap[b.id] = b;
        });
        setBriefings(briefingsMap);
      }
    } catch (err) {
      console.error("Error fetching briefings data:", err);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("es-MX", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const truncateText = (text: string, maxLength: number = 200) => {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + "...";
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-foreground">Briefings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Resúmenes diarios y reportes de inteligencia comercial
        </p>
      </div>

      {/* Briefings List */}
      <div className="space-y-4">
        {loading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <Card key={i} className="h-24 bg-muted animate-pulse" />
            ))}
          </div>
        ) : summaries.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              No hay briefings disponibles
            </CardContent>
          </Card>
        ) : (
          summaries.map((summary) => {
            const hasBriefing = Object.keys(briefings).length > 0;
            const relatedBriefing = hasBriefing ? Object.values(briefings)[0] : null;

            return (
              <Card key={summary.id} className="hover:shadow-md transition-shadow">
                <CardContent className="pt-6">
                  <div className="space-y-3">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <h3 className="font-semibold text-foreground">
                            {formatDate(summary.summary_date)}
                          </h3>
                          <Badge variant="secondary" className="text-xs">
                            {summary.total_emails} emails
                          </Badge>
                        </div>
                        <p className="text-sm text-foreground leading-relaxed">
                          {truncateText(summary.summary_text)}
                        </p>
                      </div>
                    </div>

                    {summary.key_events && Object.keys(summary.key_events).length > 0 && (
                      <div className="pt-2 border-t border-border">
                        <p className="text-xs text-muted-foreground font-semibold mb-2">
                          Eventos Clave
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {Object.entries(summary.key_events).map(([key, value], idx) => (
                            <Badge key={idx} variant="outline" className="text-xs">
                              {String(value)}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {relatedBriefing && relatedBriefing.html_content && (
                      <div className="pt-2 border-t border-border">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => router.push(`/briefings/${relatedBriefing.id}`)}
                          className="w-full"
                        >
                          Ver briefing completo
                          <ChevronRight className="h-4 w-4 ml-2" />
                        </Button>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
