"use client";

import { HeartPulse } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { HealthRadar } from "@/components/shared/health-radar";
import { HealthTrendChart } from "@/components/shared/health-trend-chart";
import { TrendBadge } from "@/components/shared/trend-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { HealthScore } from "@/lib/types";

interface TabSaludProps {
  healthScores: HealthScore[];
}

export function TabSalud({ healthScores }: TabSaludProps) {
  if (healthScores.length === 0) {
    return (
      <EmptyState
        icon={HeartPulse}
        title="Sin datos de salud"
        description="No hay datos de salud disponibles para este contacto."
      />
    );
  }

  const latest = healthScores[0];
  const trendData = [...healthScores]
    .reverse()
    .map((s) => ({
      date: s.score_date,
      overall_score: s.overall_score ?? 0,
      communication: s.communication_score ?? undefined,
      financial: s.financial_score ?? undefined,
      sentiment: s.sentiment_score ?? undefined,
      responsiveness: s.responsiveness_score ?? undefined,
      engagement: s.engagement_score ?? undefined,
    }));
  const riskSignals: string[] = Array.isArray(latest.risk_signals) ? latest.risk_signals : [];
  const opportunitySignals: string[] = Array.isArray(latest.opportunity_signals) ? latest.opportunity_signals : [];

  return (
    <div className="space-y-6">
      {/* Score + Trend */}
      <div className="flex items-center gap-4">
        <div className="text-5xl font-bold tabular-nums">
          {Math.round(latest.overall_score ?? 0)}
        </div>
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">Health Score</p>
          {latest.trend && <TrendBadge trend={latest.trend} />}
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Dimensiones</CardTitle>
          </CardHeader>
          <CardContent>
            <HealthRadar
              communication={latest.communication_score ?? 0}
              financial={latest.financial_score ?? 0}
              sentiment={latest.sentiment_score ?? 0}
              responsiveness={latest.responsiveness_score ?? 0}
              engagement={latest.engagement_score ?? 0}
              payment={latest.payment_compliance_score ?? undefined}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Tendencia (30 dias)</CardTitle>
          </CardHeader>
          <CardContent>
            <HealthTrendChart data={trendData} />
          </CardContent>
        </Card>
      </div>

      {(riskSignals.length > 0 || opportunitySignals.length > 0) && (
        <div className="grid gap-6 md:grid-cols-2">
          {riskSignals.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Senales de riesgo</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-1.5">
                {riskSignals.map((s: string) => (
                  <Badge key={s} variant="critical">{s}</Badge>
                ))}
              </CardContent>
            </Card>
          )}
          {opportunitySignals.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Oportunidades</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-1.5">
                {opportunitySignals.map((s: string) => (
                  <Badge key={s} variant="success">{s}</Badge>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
