import {
  BuildingIcon,
  LandmarkIcon,
  ListTreeIcon,
  CalendarDaysIcon,
  TrendingUpIcon,
  TrendingDownIcon,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatCurrencyMXN } from "@/lib/formatters";
import type {
  PartnerPaymentProfile,
  JournalFlowProfile,
  AccountPaymentProfile,
} from "@/lib/queries/finance";

interface CashflowProfilesProps {
  inboundPartners: PartnerPaymentProfile[];
  outboundPartners: PartnerPaymentProfile[];
  journals: JournalFlowProfile[];
  accounts: AccountPaymentProfile[];
}

const CATEGORY_LABELS: Record<string, { label: string; tone: "info" | "warning" | "danger" | "success" | "secondary" }> = {
  payroll_regular: { label: "Nómina regular", tone: "warning" },
  payroll_aguinaldo: { label: "Aguinaldo", tone: "warning" },
  tax_iva_collected: { label: "IVA trasladado", tone: "info" },
  tax_iva_paid: { label: "IVA acreditable", tone: "info" },
  tax_isr_withheld: { label: "ISR retenido", tone: "info" },
  tax_isr_corporate: { label: "ISR corporativo", tone: "danger" },
  tax_imss: { label: "IMSS", tone: "danger" },
  tax_infonavit: { label: "Infonavit", tone: "danger" },
  tax_payroll_state: { label: "ISN", tone: "warning" },
  tax_ptu: { label: "PTU", tone: "warning" },
  tax_withheld_other: { label: "Retenciones", tone: "secondary" },
  ar_customer: { label: "Cuentas x cobrar", tone: "success" },
  ap_supplier: { label: "Cuentas x pagar", tone: "warning" },
  cash_bank: { label: "Bancos", tone: "info" },
  credit_card: { label: "Tarjetas", tone: "danger" },
  revenue: { label: "Ingresos", tone: "success" },
  revenue_other: { label: "Otros ingresos", tone: "success" },
  cogs: { label: "Costo de ventas", tone: "warning" },
  opex_recurring: { label: "OpEx", tone: "warning" },
  depreciation: { label: "Depreciación", tone: "secondary" },
  capex: { label: "CapEx", tone: "info" },
  prepayment: { label: "Anticipos", tone: "secondary" },
  asset_other: { label: "Otros activos", tone: "secondary" },
  liability_other: { label: "Otros pasivos", tone: "secondary" },
  liability_long_term: { label: "Pasivo LP", tone: "secondary" },
  equity: { label: "Capital", tone: "secondary" },
  other: { label: "Sin clasificar", tone: "secondary" },
};

const FREQUENCY_LABELS: Record<AccountPaymentProfile["frequency"], string> = {
  monthly: "Mensual",
  irregular_monthly: "Irregular",
  occasional: "Ocasional",
  dormant: "Inactiva",
};

function toneToBadge(tone: string): "info" | "warning" | "destructive" | "default" | "secondary" {
  if (tone === "danger") return "destructive";
  if (tone === "success") return "default";
  if (tone === "warning") return "warning" as "warning";
  if (tone === "info") return "info" as "info";
  return "secondary";
}

function categoryLabel(key: string) {
  return CATEGORY_LABELS[key] ?? { label: key, tone: "secondary" as const };
}

function confidenceLabel(c: number) {
  if (c >= 0.85) return "Alta";
  if (c >= 0.6) return "Media";
  if (c >= 0.3) return "Baja";
  return "Muy baja";
}

function dayLabel(day: number | null) {
  if (day == null) return "—";
  if (day >= 28) return `día ${day} (fin)`;
  if (day <= 3) return `día ${day} (inicio)`;
  return `día ${day}`;
}

export function CashflowProfiles({
  inboundPartners,
  outboundPartners,
  journals,
  accounts,
}: CashflowProfilesProps) {
  const journalsByType = {
    inbound: journals.filter((j) => j.paymentType === "inbound"),
    outbound: journals.filter((j) => j.paymentType === "outbound"),
  };

  const accountsByCategory = accounts.reduce<Record<string, AccountPaymentProfile[]>>((acc, a) => {
    (acc[a.detectedCategory] ??= []).push(a);
    return acc;
  }, {});

  const categoryOrder = Object.keys(accountsByCategory).sort((a, b) => {
    const totalA = accountsByCategory[a].reduce((s, x) => s + Math.abs(x.avgMonthlyNet), 0);
    const totalB = accountsByCategory[b].reduce((s, x) => s + Math.abs(x.avgMonthlyNet), 0);
    return totalB - totalA;
  });

  return (
    <div className="flex flex-col gap-6">
      {/* Partner profiles */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2">
            <BuildingIcon className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Perfiles de partners</CardTitle>
          </div>
          <CardDescription>
            Comportamiento de pago real últimos 24 meses · Top por volumen con confianza ≥ 50%
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <PartnerTable
            title="Clientes que pagan"
            icon={<TrendingUpIcon className="h-4 w-4 text-emerald-500" />}
            rows={inboundPartners}
          />
          <PartnerTable
            title="Proveedores a los que pagamos"
            icon={<TrendingDownIcon className="h-4 w-4 text-rose-500" />}
            rows={outboundPartners}
          />
        </CardContent>
      </Card>

      {/* Journal profiles */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2">
            <LandmarkIcon className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Perfiles de bancos</CardTitle>
          </div>
          <CardDescription>
            Flujo mensual promedio por journal · últimos 12 meses
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 lg:grid-cols-2">
          <JournalTable
            title="Entradas"
            icon={<TrendingUpIcon className="h-4 w-4 text-emerald-500" />}
            rows={journalsByType.inbound}
          />
          <JournalTable
            title="Salidas"
            icon={<TrendingDownIcon className="h-4 w-4 text-rose-500" />}
            rows={journalsByType.outbound}
          />
        </CardContent>
      </Card>

      {/* Account profiles by category */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2">
            <ListTreeIcon className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Perfiles de cuentas contables</CardTitle>
          </div>
          <CardDescription>
            {accounts.length} cuentas perfiladas · {categoryOrder.length} categorías detectadas automáticamente
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {categoryOrder.map((cat) => {
            const rows = accountsByCategory[cat];
            const meta = categoryLabel(cat);
            const totalAvg = rows.reduce((s, a) => s + a.avgMonthlyNet, 0);
            return (
              <div key={cat} className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant={toneToBadge(meta.tone)}>{meta.label}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {rows.length} {rows.length === 1 ? "cuenta" : "cuentas"}
                    </span>
                  </div>
                  <span
                    className={cn(
                      "text-xs font-medium tabular-nums",
                      totalAvg < 0 ? "text-rose-500" : "text-emerald-500",
                    )}
                  >
                    {formatCurrencyMXN(totalAvg)} / mes promedio
                  </span>
                </div>
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Cuenta</TableHead>
                        <TableHead className="text-right">Prom./mes</TableHead>
                        <TableHead className="text-right">Mediana</TableHead>
                        <TableHead className="text-right">σ mensual</TableHead>
                        <TableHead className="text-center">Meses 12m</TableHead>
                        <TableHead className="text-center">Frecuencia</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.slice(0, 8).map((a) => (
                        <TableRow key={a.odooAccountId}>
                          <TableCell className="max-w-[260px] truncate text-sm">
                            {a.accountCode ? `${a.accountCode} · ` : ""}
                            {a.accountName}
                          </TableCell>
                          <TableCell
                            className={cn(
                              "text-right tabular-nums text-sm",
                              a.avgMonthlyNet < 0 ? "text-rose-500" : "text-emerald-500",
                            )}
                          >
                            {formatCurrencyMXN(a.avgMonthlyNet)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                            {formatCurrencyMXN(a.medianMonthlyNet)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                            {formatCurrencyMXN(a.stddevMonthlyNet)}
                          </TableCell>
                          <TableCell className="text-center text-xs text-muted-foreground">
                            {a.monthsInLast12m}/12
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge variant="secondary" className="text-[10px]">
                              {FREQUENCY_LABELS[a.frequency]}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                      {rows.length > 8 && (
                        <TableRow>
                          <TableCell
                            colSpan={6}
                            className="text-center text-xs text-muted-foreground"
                          >
                            + {rows.length - 8} cuentas adicionales
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

function PartnerTable({
  title,
  icon,
  rows,
}: {
  title: string;
  icon: React.ReactNode;
  rows: PartnerPaymentProfile[];
}) {
  if (!rows.length) {
    return (
      <div>
        <div className="mb-2 flex items-center gap-2 text-sm font-medium">
          {icon}
          <span>{title}</span>
        </div>
        <p className="text-xs text-muted-foreground">Sin perfiles con confianza suficiente.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
        {icon}
        <span>{title}</span>
        <span className="text-xs text-muted-foreground">({rows.length})</span>
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Partner</TableHead>
              <TableHead className="text-right">Total 24m</TableHead>
              <TableHead className="text-right">Mediana días</TableHead>
              <TableHead>Día típico</TableHead>
              <TableHead>Banco</TableHead>
              <TableHead className="text-right">Riesgo</TableHead>
              <TableHead className="text-center">Confianza</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((p) => (
              <TableRow key={`${p.odooPartnerId}-${p.paymentType}`}>
                <TableCell className="max-w-[220px] truncate text-sm">
                  {p.partnerName ?? <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="text-right tabular-nums text-sm">
                  {formatCurrencyMXN(p.totalPaidMxn)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-sm">
                  {p.medianDaysToPay != null ? (
                    <span className="inline-flex items-center gap-1">
                      {p.medianDaysToPay.toFixed(0)}d
                      {p.stddevDaysToPay != null && (
                        <span className="text-[10px] text-muted-foreground">
                          ±{p.stddevDaysToPay.toFixed(0)}
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-xs">
                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                    <CalendarDaysIcon className="h-3 w-3" />
                    {dayLabel(p.typicalDayOfMonth)}
                  </span>
                </TableCell>
                <TableCell className="max-w-[140px] truncate text-xs text-muted-foreground">
                  {p.preferredBankJournal ?? "—"}
                </TableCell>
                <TableCell className="text-right text-xs">
                  {p.writeoffRiskPct > 0 ? (
                    <span
                      className={cn(
                        "tabular-nums",
                        p.writeoffRiskPct >= 10 ? "text-rose-500" : "text-amber-500",
                      )}
                    >
                      {p.writeoffRiskPct.toFixed(1)}%
                    </span>
                  ) : (
                    <span className="text-muted-foreground">0%</span>
                  )}
                </TableCell>
                <TableCell className="min-w-[100px]">
                  <div className="flex items-center gap-2">
                    <Progress value={p.confidence * 100} className="h-1.5" />
                    <span className="text-[10px] text-muted-foreground">
                      {confidenceLabel(p.confidence)}
                    </span>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function JournalTable({
  title,
  icon,
  rows,
}: {
  title: string;
  icon: React.ReactNode;
  rows: JournalFlowProfile[];
}) {
  if (!rows.length) {
    return (
      <div>
        <div className="mb-2 flex items-center gap-2 text-sm font-medium">
          {icon}
          <span>{title}</span>
        </div>
        <p className="text-xs text-muted-foreground">Sin datos.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
        {icon}
        <span>{title}</span>
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Journal</TableHead>
              <TableHead className="text-right">Prom./mes</TableHead>
              <TableHead className="text-right">12m total</TableHead>
              <TableHead className="text-center">Meses act.</TableHead>
              <TableHead className="text-right">Volat.</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((j) => (
              <TableRow key={`${j.journalName}-${j.paymentType}`}>
                <TableCell className="max-w-[180px] truncate text-sm">{j.journalName}</TableCell>
                <TableCell className="text-right tabular-nums text-sm">
                  {formatCurrencyMXN(j.avgMonthlyAmount)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                  {formatCurrencyMXN(j.totalAmount12m)}
                </TableCell>
                <TableCell className="text-center text-xs text-muted-foreground">
                  {j.monthsActive}/13
                </TableCell>
                <TableCell className="text-right text-xs">
                  {j.volatilityCv != null ? (
                    <span
                      className={cn(
                        "tabular-nums",
                        j.volatilityCv > 1 ? "text-amber-500" : "text-muted-foreground",
                      )}
                    >
                      {j.volatilityCv.toFixed(2)}
                    </span>
                  ) : (
                    "—"
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
