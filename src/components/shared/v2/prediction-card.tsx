import { Target, TrendingDown, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
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
 * PredictionCard — muestra una predicción con base histórica y confianza.
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

  return (
    <Card className={cn("gap-1 py-3", className)}>
      <div className="flex items-start gap-3 px-4">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10">
          <Target className="h-4 w-4 text-primary" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {label}
            </div>
            {cfg && <Badge variant={cfg.variant}>{cfg.label}</Badge>}
          </div>
          <div className="mt-0.5 text-base font-bold">{predicted}</div>
          {basedOn && (
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              {basedOn}
            </div>
          )}
          {confidencePct != null && (
            <div className="mt-1 flex items-center gap-1">
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    "h-full transition-all",
                    confidencePct >= 70
                      ? "bg-success"
                      : confidencePct >= 40
                        ? "bg-warning"
                        : "bg-danger"
                  )}
                  style={{ width: `${confidencePct}%` }}
                />
              </div>
              <span className="text-[10px] tabular-nums text-muted-foreground">
                {confidencePct}%
              </span>
            </div>
          )}
        </div>
      </div>
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
        {delta !== 0 && <Icon className="h-3 w-3" aria-hidden />}
      </span>
    </div>
  );
}
