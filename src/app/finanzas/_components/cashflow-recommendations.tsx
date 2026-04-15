import {
  AlertTriangleIcon,
  TrendingDownIcon,
  TrendingUpIcon,
  CreditCardIcon,
  FlameIcon,
  ReceiptIcon,
  ArrowRightIcon,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatCurrencyMXN } from "@/lib/formatters";
import type {
  CashflowRecommendations as CashflowRecommendationsData,
  CashflowRecommendationAction,
  CashflowTopCompany,
  RecommendationSeverity,
} from "@/lib/queries/finance";

/* -------------------------------------------------------------------------- */
/*  Variants                                                                  */
/* -------------------------------------------------------------------------- */

const severityConfig: Record<
  RecommendationSeverity,
  {
    badge: "destructive" | "warning" | "secondary" | "info";
    label: string;
    accent: string;
  }
> = {
  CRITICAL: { badge: "destructive", label: "Crítico", accent: "border-l-destructive" },
  HIGH: { badge: "warning", label: "Alto", accent: "border-l-warning" },
  WARNING: { badge: "warning", label: "Atención", accent: "border-l-warning" },
  MEDIUM: { badge: "secondary", label: "Medio", accent: "border-l-border" },
  LOW: { badge: "info", label: "Bajo", accent: "border-l-border" },
};

const categoryIcons: Record<string, typeof AlertTriangleIcon> = {
  ap_stretch: CreditCardIcon,
  ar_accelerate: TrendingUpIcon,
  so_invoice: ReceiptIcon,
  runway: FlameIcon,
  credit_line: TrendingDownIcon,
};

/* -------------------------------------------------------------------------- */
/*  Main component                                                            */
/* -------------------------------------------------------------------------- */

export function CashflowRecommendations({
  data,
}: {
  data: CashflowRecommendationsData;
}) {
  const { metrics, actions, topArToCollect, topApToNegotiate } = data;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-6">
        <MetricsOverview metrics={metrics} />

        <section className="space-y-3">
          <SectionHeading title="Acciones priorizadas" count={actions.length} />
          <div className="space-y-2">
            {actions.map((action) => (
              <ActionCard key={action.priority} action={action} />
            ))}
          </div>
        </section>

        <Separator />

        <section className="space-y-3">
          <SectionHeading
            title="Clientes y proveedores"
            description="Top prioridades de cobranza y negociación"
          />
          <div className="grid gap-4 lg:grid-cols-2">
            <CompaniesCard
              title="Cobrar a clientes vencidos"
              description="Priorizado por monto. Probabilidad según edad del vencimiento."
              companies={topArToCollect}
              kind="ar"
            />
            <CompaniesCard
              title="Negociar con proveedores vencidos"
              description="Plazos a renegociar. Priorizado por monto pendiente."
              companies={topApToNegotiate}
              kind="ap"
            />
          </div>
        </section>
      </div>
    </TooltipProvider>
  );
}

/* -------------------------------------------------------------------------- */
/*  Metrics overview                                                          */
/* -------------------------------------------------------------------------- */

function MetricsOverview({
  metrics,
}: {
  metrics: CashflowRecommendationsData["metrics"];
}) {
  const gapIsNegative = metrics.liquidityGapMxn < 0;
  const coverage = metrics.apOverdueCoverageRatio ?? 0;
  const coveragePct = Math.min(coverage * 100, 100);
  const runway = metrics.runwayWeeksRecurring ?? 0;

  const runwayTone =
    runway < 2 ? "destructive" : runway < 4 ? "warning" : runway < 8 ? "info" : "success";

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <MetricCard
        label="Efectivo disponible"
        value={formatCurrencyMXN(metrics.effectiveCashMxn, { compact: true })}
        hint={`Burn/semana ${formatCurrencyMXN(metrics.burnRateWeeklyMxn, { compact: true })}`}
      />
      <MetricCard
        label="AP vencido"
        value={formatCurrencyMXN(metrics.apOverdueMxn, { compact: true })}
        hint={`${(coverage * 100).toFixed(0)}% cubierto por cash`}
        tone={gapIsNegative ? "destructive" : "default"}
      >
        <Progress
          value={coveragePct}
          className={cn(
            "mt-2 h-1.5",
            coverage < 0.5 && "[&>div]:bg-destructive",
            coverage >= 0.5 && coverage < 1 && "[&>div]:bg-warning",
          )}
        />
      </MetricCard>
      <MetricCard
        label="Gap de liquidez"
        value={formatCurrencyMXN(metrics.liquidityGapMxn, { compact: true })}
        hint={gapIsNegative ? "Cash no alcanza para AP vencido" : "Cash cubre AP vencido"}
        tone={gapIsNegative ? "destructive" : "success"}
      />
      <MetricCard
        label="Runway recurrente"
        value={`${runway.toFixed(1)} sem`}
        hint={`Solo nómina + opex + IVA`}
        tone={runwayTone}
      />
    </div>
  );
}

function MetricCard({
  label,
  value,
  hint,
  tone = "default",
  children,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "success" | "warning" | "destructive" | "info";
  children?: React.ReactNode;
}) {
  const toneRing: Record<string, string> = {
    default: "border-border",
    success: "border-success/40",
    warning: "border-warning/40",
    destructive: "border-destructive/50",
    info: "border-info/40",
  };
  const toneText: Record<string, string> = {
    default: "text-foreground",
    success: "text-success",
    warning: "text-warning",
    destructive: "text-destructive",
    info: "text-info",
  };
  return (
    <Card className={cn("gap-1 py-4", toneRing[tone])}>
      <CardContent className="space-y-1 px-4 py-0">
        <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className={cn("text-2xl font-bold tabular-nums", toneText[tone])}>{value}</p>
        {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
        {children}
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/*  Section heading                                                           */
/* -------------------------------------------------------------------------- */

function SectionHeading({
  title,
  description,
  count,
}: {
  title: string;
  description?: string;
  count?: number;
}) {
  return (
    <div className="flex items-baseline justify-between">
      <div>
        <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      {count != null && (
        <Badge variant="secondary" className="text-[10px]">
          {count}
        </Badge>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Action card                                                               */
/* -------------------------------------------------------------------------- */

function ActionCard({ action }: { action: CashflowRecommendationAction }) {
  const cfg = severityConfig[action.severity];
  const Icon = categoryIcons[action.category] ?? AlertTriangleIcon;

  return (
    <Card className={cn("gap-0 border-l-4 py-0", cfg.accent)}>
      <CardContent className="space-y-2 px-4 py-3">
        <div className="flex items-start gap-3">
          <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={cfg.badge} className="h-5">
                {cfg.label}
              </Badge>
              <h4 className="text-sm font-semibold leading-tight">{action.title}</h4>
              {action.impactMxn > 0 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="outline" className="ml-auto h-5 font-mono">
                      {formatCurrencyMXN(action.impactMxn, { compact: true })}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    Impacto estimado en MXN
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{action.rationale}</p>
            <p className="flex items-start gap-1.5 text-xs">
              <ArrowRightIcon className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
              <span>{action.action}</span>
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/*  Top companies card                                                        */
/* -------------------------------------------------------------------------- */

function CompaniesCard({
  title,
  description,
  companies,
  kind,
}: {
  title: string;
  description: string;
  companies: CashflowTopCompany[];
  kind: "ar" | "ap";
}) {
  return (
    <Card className="gap-0 py-0">
      <CardHeader className="gap-1 px-4 pb-2 pt-4">
        <CardTitle className="text-sm">{title}</CardTitle>
        <CardDescription className="text-xs">{description}</CardDescription>
      </CardHeader>
      <CardContent className="px-0 pb-2">
        {companies.length === 0 ? (
          <p className="px-4 pb-3 text-xs text-muted-foreground">Sin datos.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="h-8 ps-4 text-[10px]">Empresa</TableHead>
                <TableHead className="h-8 text-center text-[10px]">Días</TableHead>
                <TableHead className="h-8 pe-4 text-right text-[10px]">Monto</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {companies.slice(0, 10).map((c, i) => (
                <CompanyRow key={c.companyId ?? i} company={c} kind={kind} />
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function CompanyRow({
  company,
  kind,
}: {
  company: CashflowTopCompany;
  kind: "ar" | "ap";
}) {
  const daysTone =
    company.avgDaysOverdue < 15
      ? "success"
      : company.avgDaysOverdue < 60
        ? "warning"
        : "danger";
  const daysBadge: "success" | "warning" | "destructive" =
    daysTone === "success" ? "success" : daysTone === "warning" ? "warning" : "destructive";

  return (
    <TableRow className="border-b-0">
      <TableCell className="py-1.5 ps-4">
        <p className="truncate text-xs font-medium capitalize">
          {company.companyName || `#${company.companyId}`}
        </p>
        <p className="text-[10px] text-muted-foreground">
          {company.nInvoices} {company.nInvoices === 1 ? "factura" : "facturas"}
          {kind === "ar" && company.collectionProbability14d != null && (
            <> · prob cobro {(company.collectionProbability14d * 100).toFixed(0)}%</>
          )}
        </p>
      </TableCell>
      <TableCell className="py-1.5 text-center">
        <Badge variant={daysBadge} className="h-5 font-mono text-[10px]">
          {company.avgDaysOverdue}d
        </Badge>
      </TableCell>
      <TableCell className="py-1.5 pe-4 text-right">
        <div className="text-xs font-semibold tabular-nums">
          {formatCurrencyMXN(company.totalOverdueMxn, { compact: true })}
        </div>
        {kind === "ar" &&
          company.expectedCollection14dMxn != null &&
          company.expectedCollection14dMxn > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-[10px] tabular-nums text-success">
                  +{formatCurrencyMXN(company.expectedCollection14dMxn, { compact: true })}
                </span>
              </TooltipTrigger>
              <TooltipContent side="left">Cobro esperado 14 días</TooltipContent>
            </Tooltip>
          )}
      </TableCell>
    </TableRow>
  );
}
