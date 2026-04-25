import Link from "next/link";
import {
  AlertTriangleIcon,
  ArrowRightIcon,
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
  }
> = {
  critical: { badge: "destructive", label: "Crítico", accent: "border-l-destructive" },
  high:     { badge: "warning",     label: "Alto",    accent: "border-l-warning"     },
  medium:   { badge: "secondary",   label: "Medio",   accent: "border-l-border"      },
  low:      { badge: "info",        label: "Bajo",    accent: "border-l-border"      },
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

      <div className="space-y-2">
        {data.actions.map((action) => (
          <SalesActionCard key={action.id} action={action} />
        ))}
      </div>
    </div>
  );
}

function SalesActionCard({ action }: { action: SalesAction }) {
  const cfg = severityConfig[action.severity];
  return (
    <Card className={cn("gap-0 border-l-4 py-0", cfg.accent)}>
      <CardContent className="space-y-2 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={cfg.badge} className="text-[10px] uppercase">
                {cfg.label}
              </Badge>
              {action.impactMxn != null && action.impactMxn > 0 && (
                <span className="text-xs font-semibold tabular-nums text-foreground">
                  {formatCurrencyMXN(action.impactMxn, { compact: true })}
                </span>
              )}
              {action.companyId && action.companyName && (
                <Link
                  href={`/empresas/${action.companyId}`}
                  className="truncate text-xs font-medium text-primary hover:underline"
                >
                  {action.companyName}
                </Link>
              )}
            </div>
            <p className="mt-1.5 text-sm leading-snug">{action.title}</p>
            {action.recommendation && (
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {action.recommendation.length > 240
                  ? action.recommendation.slice(0, 237).trim() + "…"
                  : action.recommendation}
              </p>
            )}
          </div>
          <Link
            href={`/inbox/insight/${action.id}`}
            className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Ver detalle"
          >
            <ArrowRightIcon className="h-4 w-4" aria-hidden />
          </Link>
        </div>
        {action.assigneeName && (
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <UserIcon className="h-3 w-3" aria-hidden />
            <span>{action.assigneeName}</span>
          </div>
        )}
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
