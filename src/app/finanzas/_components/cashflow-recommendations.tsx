import { AlertTriangle, TrendingDown, TrendingUp, CreditCard, Flame, Receipt } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Currency } from "@/components/shared/v2";
import { formatCurrencyMXN } from "@/lib/formatters";
import type {
  CashflowRecommendations,
  CashflowRecommendationAction,
  CashflowTopCompany,
  RecommendationSeverity,
} from "@/lib/queries/finance";

const severityStyles: Record<RecommendationSeverity, { bg: string; border: string; text: string; label: string }> = {
  CRITICAL: { bg: "bg-danger/10", border: "border-danger", text: "text-danger", label: "CRÍTICO" },
  WARNING: { bg: "bg-warning/10", border: "border-warning", text: "text-warning", label: "ATENCIÓN" },
  HIGH: { bg: "bg-warning/10", border: "border-warning", text: "text-warning", label: "ALTO" },
  MEDIUM: { bg: "bg-muted/30", border: "border-muted-foreground/30", text: "text-foreground", label: "MEDIO" },
  LOW: { bg: "bg-muted/20", border: "border-muted-foreground/20", text: "text-muted-foreground", label: "BAJO" },
};

const categoryIcons: Record<string, typeof AlertTriangle> = {
  ap_stretch: CreditCard,
  ar_accelerate: TrendingUp,
  so_invoice: Receipt,
  runway: Flame,
  credit_line: TrendingDown,
};

export function CashflowRecommendations({ data }: { data: CashflowRecommendations }) {
  const { metrics, actions, topArToCollect, topApToNegotiate } = data;

  const hasCritical = actions.some((a) => a.severity === "CRITICAL");

  return (
    <div className="space-y-4">
      {/* Header: métricas ejecutivas */}
      <div className={`rounded-lg border-l-4 ${hasCritical ? "border-danger bg-danger/5" : "border-primary bg-primary/5"} px-4 py-3`}>
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 text-xs">
          <div>
            <p className="text-muted-foreground">Efectivo hoy</p>
            <span className="text-lg font-semibold">
              <Currency amount={metrics.effectiveCashMxn} compact />
            </span>
          </div>
          <div>
            <p className="text-muted-foreground">AP vencido</p>
            <span className="text-lg font-semibold text-danger">
              <Currency amount={metrics.apOverdueMxn} compact />
            </span>
          </div>
          <div>
            <p className="text-muted-foreground">Gap liquidez</p>
            <span className={`text-lg font-semibold ${metrics.liquidityGapMxn < 0 ? "text-danger" : "text-success"}`}>
              <Currency amount={metrics.liquidityGapMxn} compact colorBySign />
            </span>
          </div>
          <div>
            <p className="text-muted-foreground">Runway recurrente</p>
            <span className="text-lg font-semibold">
              {metrics.runwayWeeksRecurring != null ? `${metrics.runwayWeeksRecurring.toFixed(1)} sem` : "—"}
            </span>
          </div>
          <div>
            <p className="text-muted-foreground">Burn/semana</p>
            <span className="font-semibold">
              <Currency amount={metrics.burnRateWeeklyMxn} compact />
            </span>
          </div>
          {metrics.apOverdueCoverageRatio != null && (
            <div className="ml-auto">
              <p className="text-muted-foreground">Cobertura AP vencido</p>
              <span className={`font-semibold ${metrics.apOverdueCoverageRatio < 1 ? "text-danger" : "text-success"}`}>
                {(metrics.apOverdueCoverageRatio * 100).toFixed(0)}%
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Actions priorizadas */}
      <div className="space-y-2">
        {actions.map((a) => (
          <ActionCard key={a.priority} action={a} />
        ))}
      </div>

      {/* Top AR + AP side-by-side */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Top clientes con AR vencida</CardTitle>
            <p className="text-[11px] text-muted-foreground">
              Priorizado por monto. Probabilidad de cobro basada en días vencidos.
            </p>
          </CardHeader>
          <CardContent className="pb-3">
            <CompanyList items={topArToCollect} kind="ar" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Top proveedores con AP vencida</CardTitle>
            <p className="text-[11px] text-muted-foreground">
              Negociar extensión de plazos. Priorizado por monto.
            </p>
          </CardHeader>
          <CardContent className="pb-3">
            <CompanyList items={topApToNegotiate} kind="ap" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ActionCard({ action }: { action: CashflowRecommendationAction }) {
  const style = severityStyles[action.severity];
  const Icon = categoryIcons[action.category] || AlertTriangle;
  return (
    <div className={`rounded-lg border-l-4 ${style.border} ${style.bg} px-4 py-3`}>
      <div className="flex items-start gap-3">
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${style.text}`} aria-hidden />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className={`text-[10px] font-semibold uppercase tracking-wide ${style.text}`}>
              {style.label}
            </span>
            <h4 className="text-sm font-semibold">{action.title}</h4>
            {action.impactMxn > 0 && (
              <span className="ml-auto text-xs text-muted-foreground">
                Impacto: <Currency amount={action.impactMxn} compact />
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{action.rationale}</p>
          <p className="mt-2 text-xs">{action.action}</p>
        </div>
      </div>
    </div>
  );
}

function CompanyList({ items, kind }: { items: CashflowTopCompany[]; kind: "ar" | "ap" }) {
  if (!items.length) {
    return <p className="text-xs text-muted-foreground">Sin datos.</p>;
  }
  return (
    <ul className="space-y-1.5 text-xs">
      {items.slice(0, 10).map((c, i) => (
        <li key={c.companyId ?? i} className="flex items-baseline justify-between gap-2 border-b pb-1.5 last:border-0">
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{c.companyName || `#${c.companyId}`}</p>
            <p className="text-[10px] text-muted-foreground">
              {c.nInvoices} facturas · avg {c.avgDaysOverdue}d vencidas
              {kind === "ar" && c.collectionProbability14d != null && (
                <> · prob {(c.collectionProbability14d * 100).toFixed(0)}%</>
              )}
            </p>
          </div>
          <div className="text-right">
            <div className="tabular-nums font-semibold">
              {formatCurrencyMXN(c.totalOverdueMxn, { compact: true })}
            </div>
            {kind === "ar" && c.expectedCollection14dMxn != null && c.expectedCollection14dMxn > 0 && (
              <div className="text-[10px] text-success tabular-nums">
                +{formatCurrencyMXN(c.expectedCollection14dMxn, { compact: true })} est.
              </div>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
