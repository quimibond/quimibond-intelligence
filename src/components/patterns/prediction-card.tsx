import { Target, TrendingDown, TrendingUp } from "lucide-react";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type PredictionStatus =
  | "on_track"
  | "at_risk"
  | "overdue"
  | "critical"
  | "lost";

interface PredictionCardProps {
  label: string;
  predicted: string;
  basedOn?: string;
  status?: PredictionStatus;
  confidence?: number; // 0-1
  className?: string;
}

const statusConfig: Record<
  PredictionStatus,
  { label: string; variant: "success" | "warning" | "critical" | "secondary" }
> = {
  on_track: { label: "En ciclo", variant: "success" },
  at_risk: { label: "En riesgo", variant: "warning" },
  overdue: { label: "Vencido", variant: "warning" },
  critical: { label: "Crítico", variant: "critical" },
  lost: { label: "Perdido", variant: "secondary" },
};

/**
 * PredictionCard — muestra una predicción con base histórica y barra de
 * confianza. Construido sobre Card de shadcn con CardHeader/CardContent
 * para preservar la jerarquia visual del design system.
 *
 * @example
 * <PredictionCard
 *   label="Próximo pedido esperado"
 *   predicted="16 abril 2026"
 *   basedOn="ciclo promedio 16 días, σ 21d"
 *   status="on_track"
 *   confidence={0.85}
 * />
 */
export function PredictionCard({
  label,
  predicted,
  basedOn,
  status,
  confidence,
  className,
}: PredictionCardProps) {
  const cfg = status ? statusConfig[status] : null;
  const confidencePct =
    confidence != null ? Math.round(confidence * 100) : null;

  const confidenceTone =
    confidencePct == null
      ? null
      : confidencePct >= 70
        ? "bg-success"
        : confidencePct >= 40
          ? "bg-warning"
          : "bg-danger";

  return (
    <Card className={cn("gap-0 py-0", className)}>
      <CardHeader className="flex-row items-start gap-3 px-4 pt-4 pb-2">
        <div
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
          aria-hidden
        >
          <Target className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {label}
            </span>
            {cfg && <Badge variant={cfg.variant}>{cfg.label}</Badge>}
          </div>
          <div className="mt-0.5 text-base font-bold leading-tight">
            {predicted}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-2 px-4 pb-4 pl-[60px]">
        {basedOn && (
          <p className="text-[11px] text-muted-foreground">{basedOn}</p>
        )}
        {confidencePct != null && (
          <div className="flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className={cn(
                  "h-full transition-all duration-500",
                  confidenceTone
                )}
                style={{ width: `${confidencePct}%` }}
              />
            </div>
            <span className="text-[10px] font-medium tabular-nums text-muted-foreground">
              {confidencePct}%
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * PredictionDelta — compara predicho vs real (útil para runway, reorder, etc).
 */
export function PredictionDelta({
  label,
  expected,
  actual,
  unit = "",
  goodDirection = "up",
}: {
  label: string;
  expected: number;
  actual: number;
  unit?: string;
  goodDirection?: "up" | "down";
}) {
  const delta = actual - expected;
  const isGood =
    delta === 0
      ? true
      : goodDirection === "up"
        ? delta > 0
        : delta < 0;
  const Icon = delta > 0 ? TrendingUp : TrendingDown;
  return (
    <div className="flex items-center gap-1.5 text-[11px]">
      <span className="text-muted-foreground">{label}:</span>
      <span className="tabular-nums">
        {expected}
        {unit}
      </span>
      <span className="text-muted-foreground">→</span>
      <span
        className={cn(
          "flex items-center gap-0.5 font-semibold tabular-nums",
          isGood ? "text-success" : "text-danger"
        )}
      >
        {actual}
        {unit}
        {delta !== 0 && <Icon className="size-3" aria-hidden />}
      </span>
    </div>
  );
}
