"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlertTriangleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ListChecksIcon,
  ScaleIcon,
  TargetIcon,
  TrendingUpIcon,
  UserIcon,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatCurrencyMXN } from "@/lib/formatters";
import type {
  SalesRecommendations as SalesRecommendationsData,
  SalesAction,
  SalesActionSeverity,
} from "@/lib/queries/operational/sales-intelligence";

const severityConfig: Record<
  SalesActionSeverity,
  {
    badge: "destructive" | "warning" | "secondary" | "info";
    label: string;
    accent: string;
    chip: string;
  }
> = {
  critical: {
    badge: "destructive",
    label: "Crítico",
    accent: "border-l-destructive",
    chip: "bg-destructive/10 text-destructive",
  },
  high: {
    badge: "warning",
    label: "Alto",
    accent: "border-l-warning",
    chip: "bg-warning/10 text-warning",
  },
  medium: {
    badge: "secondary",
    label: "Medio",
    accent: "border-l-border",
    chip: "bg-muted text-muted-foreground",
  },
  low: {
    badge: "info",
    label: "Bajo",
    accent: "border-l-border",
    chip: "bg-muted text-muted-foreground",
  },
};

export function SalesRecommendations({
  data,
}: {
  data: SalesRecommendationsData;
}) {
  if (data.actions.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Sin recomendaciones del director comercial. El agente corre cada
        15 min y prioriza por impacto.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryStat
          icon={AlertTriangleIcon}
          label="Acciones críticas"
          value={data.criticalCount}
          tone={data.criticalCount > 0 ? "destructive" : "default"}
        />
        <SummaryStat
          icon={TargetIcon}
          label="Acciones altas"
          value={data.highCount}
          tone={data.highCount > 0 ? "warning" : "default"}
        />
        <SummaryStat
          icon={TrendingUpIcon}
          label="Impacto agregado"
          value={formatCurrencyMXN(data.totalImpactMxn, { compact: true })}
          hint={`${data.total} acciones abiertas`}
        />
      </div>

      <div className="space-y-3">
        {data.actions.map((action) => (
          <SalesActionCard key={action.id} action={action} />
        ))}
      </div>
    </div>
  );
}

function SalesActionCard({ action }: { action: SalesAction }) {
  const cfg = severityConfig[action.severity];
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const hasDescription =
    !!action.description && action.description.trim().length > 0;
  const hasEvidence = action.evidence.length > 0;
  const hasSteps = action.nextSteps.length > 0;

  return (
    <Card className={cn("gap-0 border-l-4 py-0", cfg.accent)}>
      <CardContent className="space-y-3 px-4 py-4">
        {/* Header line: severity + impact + confidence */}
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={cfg.badge} className="text-[10px] uppercase">
            {cfg.label}
          </Badge>
          {action.impactMxn != null && action.impactMxn > 0 && (
            <span
              className="inline-flex items-center gap-1 text-xs font-semibold tabular-nums text-foreground"
              title="Impacto estimado por el agente"
            >
              <ScaleIcon className="size-3" aria-hidden />
              {formatCurrencyMXN(action.impactMxn, { compact: true })}
            </span>
          )}
          {action.confidence != null && (
            <span
              className="text-[10px] uppercase tracking-wide text-muted-foreground"
              title="Confianza del agente IA en este insight"
            >
              {Math.round(action.confidence * 100)}% confianza
            </span>
          )}
          {action.companyId && action.companyName && (
            <Link
              href={`/empresas/${action.companyId}`}
              className="ml-auto truncate text-xs font-medium text-primary hover:underline"
            >
              {action.companyName} →
            </Link>
          )}
        </div>

        {/* Title */}
        <h3 className="text-sm font-semibold leading-snug">{action.title}</h3>

        {/* Description — el "por qué" */}
        {hasDescription && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            {action.description}
          </p>
        )}

        {/* Next steps — parseado del recommendation */}
        {hasSteps && (
          <div className="space-y-2 rounded-md border border-border/60 bg-muted/30 p-3">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              <ListChecksIcon className="size-3" aria-hidden />
              {action.nextSteps.length === 1
                ? "Próximo paso"
                : `Próximos pasos (${action.nextSteps.length})`}
            </div>
            <ol className="space-y-2">
              {action.nextSteps.map((step, i) => (
                <li key={i} className="flex gap-2 text-xs leading-relaxed">
                  <span
                    className={cn(
                      "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold",
                      cfg.chip
                    )}
                  >
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    {step.owner && (
                      <span className="mr-1 font-semibold text-foreground">
                        {step.owner}:
                      </span>
                    )}
                    <span className="text-foreground/90">{step.text}</span>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* Evidence (collapsible) */}
        {hasEvidence && (
          <div>
            <button
              type="button"
              onClick={() => setEvidenceOpen((v) => !v)}
              className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
              aria-expanded={evidenceOpen}
            >
              {evidenceOpen ? (
                <ChevronDownIcon className="size-3" aria-hidden />
              ) : (
                <ChevronRightIcon className="size-3" aria-hidden />
              )}
              Evidencia ({action.evidence.length})
            </button>
            {evidenceOpen && (
              <ul className="mt-2 space-y-1 pl-4 text-[11px] leading-relaxed text-muted-foreground">
                {action.evidence.map((e, i) => (
                  <li key={i} className="list-disc">
                    {e}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Footer: routing + agent + link */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/40 pt-2 text-[10px] text-muted-foreground">
          {action.routedTo && (
            <span className="inline-flex items-center gap-1">
              <UserIcon className="size-3" aria-hidden />
              Routeado a {action.routedTo}
            </span>
          )}
          {action.agentName && <span>· {action.agentName}</span>}
          <Link
            href={`/inbox/insight/${action.id}`}
            className="ml-auto font-medium text-primary hover:underline"
          >
            Ver detalle →
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

function SummaryStat({
  icon: Icon,
  label,
  value,
  hint,
  tone = "default",
}: {
  icon: typeof AlertTriangleIcon;
  label: string;
  value: string | number;
  hint?: string;
  tone?: "default" | "destructive" | "warning";
}) {
  const toneRing: Record<string, string> = {
    default: "border-border",
    destructive: "border-destructive/40",
    warning: "border-warning/40",
  };
  const toneText: Record<string, string> = {
    default: "text-foreground",
    destructive: "text-destructive",
    warning: "text-warning",
  };
  return (
    <Card className={cn("gap-0 py-0", toneRing[tone])}>
      <CardHeader className="px-3 pb-1 pt-3">
        <CardTitle className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          <Icon className="h-3 w-3" aria-hidden />
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-3">
        <p className={cn("text-xl font-bold tabular-nums", toneText[tone])}>
          {value}
        </p>
        {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}
