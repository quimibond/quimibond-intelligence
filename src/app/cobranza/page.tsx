import { Suspense } from "react";
import {
  AlertTriangle,
  Calendar,
  FileText,
  Flame,
  TrendingDown,
  Users,
} from "lucide-react";

import {
  KpiCard,
  StatGrid,
  PageHeader,
  DataTable,
  MobileCard,
  CompanyLink,
  Currency,
  DateDisplay,
  EmptyState,
  type DataTableColumn,
} from "@/components/shared/v2";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getArAging,
  getCompanyAging,
  getOverdueInvoices,
  getPaymentPredictions,
  getPaymentRiskKpis,
  type CompanyAgingRow,
  type OverdueInvoice,
  type PaymentPredictionRow,
} from "@/lib/queries/invoices";
import { getCfoSnapshot } from "@/lib/queries/finance";
import {
  getCollectionEffectiveness,
  type CeiHealth,
  type CeiRow,
} from "@/lib/queries/analytics";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cobranza" };

export default function CobranzaPage() {
  return (
    <div className="space-y-5 pb-24 md:pb-6">
      <PageHeader
        title="Cobranza"
        subtitle="Cartera vencida, riesgo de pago y aging"
      />

      {/* Hero KPIs */}
      <Suspense
        fallback={
          <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 4 }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[96px] rounded-xl" />
            ))}
          </StatGrid>
        }
      >
        <CobranzaHeroKpis />
      </Suspense>

      {/* Collection Effectiveness Index */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Collection Effectiveness Index (CEI)
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            % del facturado cobrado por cohort mensual. Detecta degradación
            antes que llegue al aging bucket.
          </p>
        </CardHeader>
        <CardContent className="pb-4">
          <Suspense
            fallback={
              <div className="space-y-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 rounded-lg" />
                ))}
              </div>
            }
          >
            <CeiTimeline />
          </Suspense>
        </CardContent>
      </Card>

      {/* Aging buckets */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Aging buckets</CardTitle>
        </CardHeader>
        <CardContent className="pb-4">
          <Suspense
            fallback={
              <StatGrid columns={{ mobile: 2, tablet: 5, desktop: 5 }}>
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-[80px] rounded-xl" />
                ))}
              </StatGrid>
            }
          >
            <AgingBuckets />
          </Suspense>
        </CardContent>
      </Card>

      {/* Payment risk */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Clientes con patrón anormal de pago
          </CardTitle>
        </CardHeader>
        <CardContent className="pb-4">
          <Suspense
            fallback={
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 rounded-xl" />
                ))}
              </div>
            }
          >
            <PaymentRiskTable />
          </Suspense>
        </CardContent>
      </Card>

      {/* Companies with aging */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Clientes con cartera vencida
          </CardTitle>
        </CardHeader>
        <CardContent className="pb-4">
          <Suspense
            fallback={
              <div className="space-y-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 rounded-xl" />
                ))}
              </div>
            }
          >
            <CompanyAgingTable />
          </Suspense>
        </CardContent>
      </Card>

      {/* Overdue invoices */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Facturas vencidas</CardTitle>
        </CardHeader>
        <CardContent className="pb-4">
          <Suspense
            fallback={
              <div className="space-y-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 rounded-xl" />
                ))}
              </div>
            }
          >
            <OverdueTable />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Hero KPIs
// ──────────────────────────────────────────────────────────────────────────
async function CobranzaHeroKpis() {
  const [cfo, paymentRisk] = await Promise.all([
    getCfoSnapshot(),
    getPaymentRiskKpis(),
  ]);

  return (
    <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 4 }}>
      <KpiCard
        title="Cartera vencida"
        value={cfo?.carteraVencida ?? 0}
        format="currency"
        compact
        icon={AlertTriangle}
        subtitle={`${cfo?.clientesMorosos ?? 0} clientes morosos`}
        tone="danger"
      />
      <KpiCard
        title="Cuentas por cobrar"
        value={cfo?.cuentasPorCobrar ?? 0}
        format="currency"
        compact
        icon={FileText}
        subtitle="total AR"
      />
      <KpiCard
        title="Cobros 30d"
        value={cfo?.cobros30d ?? 0}
        format="currency"
        compact
        icon={Calendar}
        tone="success"
      />
      <KpiCard
        title="Riesgo crítico"
        value={paymentRisk.criticalPending}
        format="currency"
        compact
        icon={Flame}
        subtitle={`${paymentRisk.criticalCount} clientes`}
        tone={paymentRisk.criticalCount > 0 ? "danger" : "default"}
      />
    </StatGrid>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Collection Effectiveness Index timeline
// ──────────────────────────────────────────────────────────────────────────
const ceiHealthVariant: Record<
  CeiHealth,
  "success" | "info" | "warning" | "critical" | "secondary"
> = {
  healthy: "success",
  watch: "info",
  at_risk: "warning",
  degraded: "critical",
  too_recent: "secondary",
};

const ceiHealthLabel: Record<CeiHealth, string> = {
  healthy: "Saludable",
  watch: "Vigilar",
  at_risk: "En riesgo",
  degraded: "Degradado",
  too_recent: "Reciente",
};

function ceiBarColor(health: CeiHealth): string {
  if (health === "degraded") return "bg-danger";
  if (health === "at_risk") return "bg-warning";
  if (health === "watch") return "bg-info";
  if (health === "healthy") return "bg-success";
  return "bg-muted-foreground/40";
}

function formatCohortMonth(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("es-MX", { month: "short", year: "2-digit" });
}

async function CeiTimeline() {
  const rows = await getCollectionEffectiveness(12);
  // Excluir cohorts demasiado recientes (no son comparables)
  const useful = rows.filter((r) => r.cohort_age_months >= 2).slice(0, 8);

  if (useful.length === 0) {
    return (
      <EmptyState
        icon={TrendingDown}
        title="Sin datos de cohort"
        description="No hay suficientes meses cerrados para calcular CEI."
        compact
      />
    );
  }

  return (
    <div className="space-y-2">
      {useful.map((r: CeiRow) => {
        const pct = Math.min(100, Math.max(0, r.cei_pct));
        const delta = r.cei_delta_vs_prev;
        return (
          <div
            key={r.cohort_month}
            className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2"
          >
            {/* Mes */}
            <div className="w-14 shrink-0 font-mono text-xs uppercase tabular-nums text-muted-foreground">
              {formatCohortMonth(r.cohort_month)}
            </div>

            {/* Barra de CEI */}
            <div className="relative flex-1">
              <div className="h-6 w-full overflow-hidden rounded-md bg-muted/40">
                <div
                  className={`h-full ${ceiBarColor(r.health_status)} transition-all`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="absolute inset-0 flex items-center px-2">
                <span className="text-xs font-bold tabular-nums text-foreground mix-blend-difference text-white">
                  {r.cei_pct.toFixed(1)}%
                </span>
              </div>
            </div>

            {/* Delta */}
            <div className="hidden w-16 shrink-0 text-right text-[11px] tabular-nums sm:block">
              {delta != null ? (
                <span
                  className={
                    delta < -5
                      ? "font-semibold text-danger"
                      : delta > 5
                        ? "font-semibold text-success"
                        : "text-muted-foreground"
                  }
                >
                  {delta > 0 ? "+" : ""}
                  {delta.toFixed(1)}pp
                </span>
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </div>

            {/* Health badge */}
            <Badge
              variant={ceiHealthVariant[r.health_status]}
              className="shrink-0 text-[10px] uppercase"
            >
              {ceiHealthLabel[r.health_status]}
            </Badge>

            {/* Outstanding (desktop only) */}
            <div className="hidden w-24 shrink-0 text-right md:block">
              <Currency amount={r.outstanding_mxn} compact />
              <div className="text-[9px] uppercase text-muted-foreground">
                pendiente
              </div>
            </div>
          </div>
        );
      })}

      <p className="pt-2 text-[10px] text-muted-foreground">
        Cohorts con &lt; 2 meses se omiten porque aún están en periodo normal
        de cobranza. Health: ≥95% saludable, 85-95% vigilar, 70-85% en riesgo,
        &lt;70% degradado.
      </p>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Aging buckets
// ──────────────────────────────────────────────────────────────────────────
async function AgingBuckets() {
  const buckets = await getArAging();
  const iconMap: Record<string, typeof Calendar> = {
    "1-30": Calendar,
    "31-60": Calendar,
    "61-90": AlertTriangle,
    "91-120": AlertTriangle,
    "120+": TrendingDown,
  };
  const toneMap: Record<string, "info" | "warning" | "danger"> = {
    "1-30": "info",
    "31-60": "warning",
    "61-90": "warning",
    "91-120": "danger",
    "120+": "danger",
  };
  return (
    <StatGrid columns={{ mobile: 2, tablet: 5, desktop: 5 }}>
      {buckets.map((b) => (
        <KpiCard
          key={b.bucket}
          title={`${b.bucket} días`}
          value={b.amount_mxn}
          format="currency"
          compact
          icon={iconMap[b.bucket] ?? Calendar}
          subtitle={`${b.count} facturas`}
          tone={toneMap[b.bucket] ?? "info"}
          size="sm"
        />
      ))}
    </StatGrid>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Payment risk
// ──────────────────────────────────────────────────────────────────────────
function riskShortLabel(raw: string): string {
  const upper = raw.toUpperCase();
  if (upper.startsWith("CRITICO")) return "Crítico";
  if (upper.startsWith("ALTO")) return "Alto";
  if (upper.startsWith("MEDIO")) return "Medio";
  return raw;
}
function riskVariant(raw: string): "critical" | "warning" | "info" {
  const upper = raw.toUpperCase();
  if (upper.startsWith("CRITICO")) return "critical";
  if (upper.startsWith("ALTO")) return "warning";
  return "info";
}
function trendLabel(raw: string | null): string {
  if (!raw) return "—";
  const map: Record<string, string> = {
    estable: "Estable",
    mejorando: "Mejorando",
    empeorando: "Empeorando",
  };
  return map[raw] ?? raw;
}

const paymentColumns: DataTableColumn<PaymentPredictionRow>[] = [
  {
    key: "company",
    header: "Cliente",
    cell: (r) => (
      <CompanyLink
        companyId={r.company_id}
        name={r.company_name ? capitalize(r.company_name) : null}
        truncate
      />
    ),
  },
  {
    key: "risk",
    header: "Riesgo",
    cell: (r) => (
      <Badge variant={riskVariant(r.payment_risk)}>
        {riskShortLabel(r.payment_risk)}
      </Badge>
    ),
  },
  {
    key: "trend",
    header: "Tendencia",
    cell: (r) => (
      <span className="text-xs">{trendLabel(r.payment_trend)}</span>
    ),
    hideOnMobile: true,
  },
  {
    key: "avg_days",
    header: "Días promedio",
    cell: (r) =>
      r.avg_days_to_pay != null ? Math.round(r.avg_days_to_pay) : "—",
    align: "right",
    hideOnMobile: true,
  },
  {
    key: "max_overdue",
    header: "Máx vencido",
    cell: (r) =>
      r.max_days_overdue != null ? (
        <span className="font-semibold tabular-nums text-danger">
          {r.max_days_overdue}d
        </span>
      ) : (
        "—"
      ),
    align: "right",
  },
  {
    key: "pending",
    header: "Pendiente",
    cell: (r) => (
      <span className="font-bold">
        <Currency amount={r.total_pending} compact />
      </span>
    ),
    align: "right",
  },
];

function capitalize(s: string): string {
  return s
    .toLowerCase()
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

async function PaymentRiskTable() {
  const rows = await getPaymentPredictions(20);
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Flame}
        title="Sin clientes en riesgo"
        description="Todos los clientes pagan dentro de su patrón normal."
        compact
      />
    );
  }
  return (
    <DataTable
      data={rows}
      columns={paymentColumns}
      rowKey={(r) => String(r.company_id)}
      mobileCard={(r) => (
        <MobileCard
          title={
            <CompanyLink
              companyId={r.company_id}
              name={r.company_name ? capitalize(r.company_name) : null}
              truncate
            />
          }
          subtitle={trendLabel(r.payment_trend)}
          badge={
            <Badge variant={riskVariant(r.payment_risk)}>
              {riskShortLabel(r.payment_risk)}
            </Badge>
          }
          fields={[
            {
              label: "Pendiente",
              value: <Currency amount={r.total_pending} compact />,
            },
            {
              label: "Máx vencido",
              value:
                r.max_days_overdue != null
                  ? `${r.max_days_overdue}d`
                  : "—",
              className: "text-danger",
            },
            {
              label: "Días promedio",
              value:
                r.avg_days_to_pay != null
                  ? Math.round(r.avg_days_to_pay)
                  : "—",
            },
            {
              label: "# facturas",
              value: r.pending_count,
            },
          ]}
        />
      )}
    />
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Company aging
// ──────────────────────────────────────────────────────────────────────────
const companyColumns: DataTableColumn<CompanyAgingRow>[] = [
  {
    key: "company",
    header: "Cliente",
    cell: (r) => (
      <CompanyLink
        companyId={r.company_id}
        name={r.company_name}
        tier={(r.tier as "A" | "B" | "C") ?? undefined}
        truncate
      />
    ),
  },
  {
    key: "1_30",
    header: "1-30",
    cell: (r) => <Currency amount={r.overdue_1_30} compact />,
    align: "right",
    hideOnMobile: true,
  },
  {
    key: "31_60",
    header: "31-60",
    cell: (r) => <Currency amount={r.overdue_31_60} compact />,
    align: "right",
    hideOnMobile: true,
  },
  {
    key: "61_90",
    header: "61-90",
    cell: (r) => <Currency amount={r.overdue_61_90} compact />,
    align: "right",
    hideOnMobile: true,
  },
  {
    key: "90plus",
    header: "90+",
    cell: (r) => (
      <span className="font-semibold text-danger tabular-nums">
        <Currency amount={r.overdue_90plus} compact />
      </span>
    ),
    align: "right",
  },
  {
    key: "total",
    header: "Total",
    cell: (r) => (
      <span className="font-bold tabular-nums">
        <Currency amount={r.total_receivable} compact />
      </span>
    ),
    align: "right",
  },
];

async function CompanyAgingTable() {
  const rows = await getCompanyAging(50);
  const overdueOnly = rows.filter(
    (r) =>
      r.overdue_1_30 +
        r.overdue_31_60 +
        r.overdue_61_90 +
        r.overdue_90plus >
      0
  );
  return (
    <DataTable
      data={overdueOnly}
      columns={companyColumns}
      rowKey={(r) => String(r.company_id)}
      mobileCard={(r) => (
        <MobileCard
          title={
            <CompanyLink
              companyId={r.company_id}
              name={r.company_name}
              tier={(r.tier as "A" | "B" | "C") ?? undefined}
              truncate
            />
          }
          badge={
            <span className="rounded bg-danger/15 px-2 py-0.5 text-[11px] font-bold text-danger-foreground">
              <Currency amount={r.total_receivable} compact />
            </span>
          }
          fields={[
            {
              label: "1-30",
              value: <Currency amount={r.overdue_1_30} compact />,
            },
            {
              label: "31-60",
              value: <Currency amount={r.overdue_31_60} compact />,
            },
            {
              label: "61-90",
              value: <Currency amount={r.overdue_61_90} compact />,
            },
            {
              label: "90+",
              value: <Currency amount={r.overdue_90plus} compact />,
              className: "text-danger",
            },
          ]}
        />
      )}
      emptyState={{
        icon: Users,
        title: "Sin clientes con cartera vencida",
        description: "Todos los clientes están al corriente.",
      }}
    />
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Overdue invoices
// ──────────────────────────────────────────────────────────────────────────
const invoiceColumns: DataTableColumn<OverdueInvoice>[] = [
  {
    key: "name",
    header: "Factura",
    cell: (r) => <span className="font-mono text-xs">{r.name ?? "—"}</span>,
  },
  {
    key: "company",
    header: "Cliente",
    cell: (r) =>
      r.company_id ? (
        <CompanyLink
          companyId={r.company_id}
          name={r.company_name}
          truncate
        />
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    key: "residual",
    header: "Saldo",
    cell: (r) => <Currency amount={r.amount_residual_mxn} />,
    align: "right",
  },
  {
    key: "days",
    header: "Días",
    cell: (r) => (
      <span className="font-semibold text-danger tabular-nums">
        {r.days_overdue ?? 0}
      </span>
    ),
    align: "right",
  },
  {
    key: "salesperson",
    header: "Vendedor",
    cell: (r) => r.salesperson_name ?? "—",
    hideOnMobile: true,
  },
  {
    key: "due",
    header: "Vence",
    cell: (r) => <DateDisplay date={r.due_date} />,
    hideOnMobile: true,
  },
];

function bucketFromDays(days: number | null): string {
  const d = Number(days) || 0;
  if (d <= 0) return "current";
  if (d <= 30) return "1-30";
  if (d <= 60) return "31-60";
  if (d <= 90) return "61-90";
  if (d <= 120) return "91-120";
  return "120+";
}

async function OverdueTable() {
  const rows = await getOverdueInvoices(50);
  return (
    <DataTable
      data={rows}
      columns={invoiceColumns}
      rowKey={(r) => String(r.id)}
      mobileCard={(r) => (
        <MobileCard
          title={
            r.company_id ? (
              <CompanyLink
                companyId={r.company_id}
                name={r.company_name}
                truncate
              />
            ) : (
              (r.company_name ?? "—")
            )
          }
          subtitle={r.name ?? undefined}
          badge={
            <span className="rounded bg-danger/15 px-2 py-0.5 text-[11px] font-semibold text-danger-foreground">
              {r.days_overdue ?? 0}d
            </span>
          }
          fields={[
            {
              label: "Saldo",
              value: <Currency amount={r.amount_residual_mxn} />,
            },
            { label: "Vence", value: <DateDisplay date={r.due_date} /> },
            {
              label: "Bucket",
              value: bucketFromDays(r.days_overdue),
            },
            {
              label: "Vendedor",
              value: r.salesperson_name ?? "—",
              className: "col-span-2",
            },
          ]}
        />
      )}
      emptyState={{
        icon: FileText,
        title: "Sin cartera vencida",
        description: "Todas las facturas están al corriente.",
      }}
    />
  );
}
