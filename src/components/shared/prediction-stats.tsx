"use client";

import { useEffect, useState } from "react";
import { BarChart3 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface Stats {
  useful: number;
  falsePositive: number;
  notUseful: number;
}

export function PredictionStats() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchStats() {
      try {
        // Read feedback from feedback_signals table (real schema)
        const [usefulRes, fpRes, nuRes] = await Promise.all([
          supabase
            .from("feedback_signals")
            .select("id", { count: "exact", head: true })
            .eq("signal_type", "useful"),
          supabase
            .from("feedback_signals")
            .select("id", { count: "exact", head: true })
            .eq("signal_type", "false_positive"),
          supabase
            .from("feedback_signals")
            .select("id", { count: "exact", head: true })
            .eq("signal_type", "not_useful"),
        ]);

        setStats({
          useful: usefulRes.count ?? 0,
          falsePositive: fpRes.count ?? 0,
          notUseful: nuRes.count ?? 0,
        });
      } catch {
        // Table may not exist yet
      } finally {
        setLoading(false);
      }
    }
    fetchStats();
  }, []);

  const totalFeedback = stats
    ? stats.useful + stats.falsePositive + stats.notUseful
    : 0;

  const accuracy =
    totalFeedback > 0
      ? Math.round((stats!.useful / totalFeedback) * 100)
      : null;

  if (loading) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BarChart3 className="h-4 w-4" />
          Precision del Sistema
        </CardTitle>
      </CardHeader>
      <CardContent>
        {totalFeedback === 0 ? (
          <p className="text-sm text-muted-foreground">
            Sin datos de retroalimentacion todavia
          </p>
        ) : (
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Utiles</span>
              <span className="font-medium">{stats!.useful}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Falsos positivos</span>
              <span className="font-medium">{stats!.falsePositive}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">No utiles</span>
              <span className="font-medium">{stats!.notUseful}</span>
            </div>
            <div className="flex items-center justify-between border-t border-border pt-2">
              <span className="text-muted-foreground">Precision</span>
              <span className="font-medium">
                {accuracy !== null ? `${accuracy}%` : "—"}
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
