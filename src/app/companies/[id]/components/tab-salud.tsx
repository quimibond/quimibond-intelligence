"use client";

import { Heart } from "lucide-react";
import type { HealthScore } from "@/lib/types";
import { EmptyState } from "@/components/shared/empty-state";
import { HealthRadar } from "@/components/shared/health-radar";
import { HealthTrendChart } from "@/components/shared/health-trend-chart";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface TabSaludProps {
  healthScores: HealthScore[];
}

export function TabSalud({ healthScores }: TabSaludProps) {
  const latestHealth = healthScores.length > 0 ? healthScores[0] : null;

  const healthTrendData = [...healthScores]
    .sort(
      (a, b) =>
        new Date(a.score_date).getTime() - new Date(b.score_date).getTime()
    )
    .map((h) => ({
      date: h.score_date,
      overall_score: Number(h.overall_score ?? 0),
      communication: Number(h.communication_score ?? 0),
      financial: Number(h.financial_score ?? 0),
      sentiment: Number(h.sentiment_score ?? 0),
      responsiveness: Number(h.responsiveness_score ?? 0),
      engagement: Number(h.engagement_score ?? 0),
    }));

  if (!latestHealth) {
    return (
      <EmptyState
        icon={Heart}
        title="Sin datos de salud"
        description="No hay scores de salud disponibles para esta empresa."
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Latest health overview */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Comunicacion</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">
              {latestHealth.communication_score?.toFixed(0) ?? "—"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Financiero</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">
              {latestHealth.financial_score?.toFixed(0) ?? "—"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Sentimiento</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">
              {latestHealth.sentiment_score?.toFixed(0) ?? "—"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Responsividad</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">
              {latestHealth.responsiveness_score?.toFixed(0) ?? "—"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Engagement</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">
              {latestHealth.engagement_score?.toFixed(0) ?? "—"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Radar */}
      <Card>
        <CardHeader>
          <CardTitle>Radar de Salud</CardTitle>
        </CardHeader>
        <CardContent>
          <HealthRadar
            communication={Number(latestHealth.communication_score ?? 0)}
            financial={Number(latestHealth.financial_score ?? 0)}
            sentiment={Number(latestHealth.sentiment_score ?? 0)}
            responsiveness={Number(latestHealth.responsiveness_score ?? 0)}
            engagement={Number(latestHealth.engagement_score ?? 0)}
            payment={latestHealth.payment_compliance_score != null ? Number(latestHealth.payment_compliance_score) : undefined}
          />
        </CardContent>
      </Card>

      {/* Health trend */}
      {healthTrendData.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Tendencia de Salud</CardTitle>
          </CardHeader>
          <CardContent>
            <HealthTrendChart data={healthTrendData} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
