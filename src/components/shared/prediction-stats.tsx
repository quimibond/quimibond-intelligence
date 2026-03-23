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
  alertUseful: number;
  alertFalsePositive: number;
  actionUseful: number;
  actionNotUseful: number;
}

export function PredictionStats() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchStats() {
      try {
        const [alertUsefulRes, alertFpRes, actionUsefulRes, actionNuRes] =
          await Promise.all([
            supabase
              .from("alerts")
              .select("id", { count: "exact", head: true })
              .eq("user_feedback", "useful"),
            supabase
              .from("alerts")
              .select("id", { count: "exact", head: true })
              .eq("user_feedback", "false_positive"),
            supabase
              .from("action_items")
              .select("id", { count: "exact", head: true })
              .eq("user_feedback", "useful"),
            supabase
              .from("action_items")
              .select("id", { count: "exact", head: true })
              .eq("user_feedback", "not_useful"),
          ]);

        setStats({
          alertUseful: alertUsefulRes.count ?? 0,
          alertFalsePositive: alertFpRes.count ?? 0,
          actionUseful: actionUsefulRes.count ?? 0,
          actionNotUseful: actionNuRes.count ?? 0,
        });
      } catch {
        // Columns may not exist yet — fail silently
      } finally {
        setLoading(false);
      }
    }
    fetchStats();
  }, []);

  const totalFeedback = stats
    ? stats.alertUseful +
      stats.alertFalsePositive +
      stats.actionUseful +
      stats.actionNotUseful
    : 0;

  const alertTotal = stats
    ? stats.alertUseful + stats.alertFalsePositive
    : 0;
  const alertAccuracy =
    alertTotal > 0 ? Math.round((stats!.alertUseful / alertTotal) * 100) : null;

  const actionTotal = stats
    ? stats.actionUseful + stats.actionNotUseful
    : 0;
  const actionAccuracy =
    actionTotal > 0
      ? Math.round((stats!.actionUseful / actionTotal) * 100)
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
              <span className="text-muted-foreground">Alertas</span>
              <span className="font-medium">
                {alertAccuracy !== null ? `${alertAccuracy}% util` : "—"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Acciones</span>
              <span className="font-medium">
                {actionAccuracy !== null ? `${actionAccuracy}% util` : "—"}
              </span>
            </div>
            <div className="flex items-center justify-between border-t border-border pt-2">
              <span className="text-muted-foreground">
                Total retroalimentacion
              </span>
              <span className="font-medium">{totalFeedback}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
