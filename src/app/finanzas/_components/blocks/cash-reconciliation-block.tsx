import { Scale, TrendingUp, Wallet } from "lucide-react";
import {
  StatGrid,
  KpiCard,
  QuestionSection,
} from "@/components/patterns";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { formatCurrencyMXN } from "@/lib/formatters";
import {
  getCashReconciliation,
  type CashCategoryRow,
} from "@/lib/queries/sp13/finanzas";
import type { HistoryRange } from "@/components/patterns/history-range";

/* ── F-WTM "¿Dónde está el dinero?" — cash reconciliation ──────────── */
export async function CashReconciliationBlock({ range }: { range: HistoryRange }) {
  const data = await getCashReconciliation(range);

  const fmt = (n: number) => formatCurrencyMXN(n, { compact: true });
  const fmtSigned = (n: number) => (n >= 0 ? "+" : "") + fmt(n);

  // Ordenar filas por magnitud absoluta del delta (más grande primero)
  const rowsByImpact = [...data.rows]
    .filter((r) => r.category !== "cash")
    .sort((a, b) => Math.abs(b.deltaMxn) - Math.abs(a.deltaMxn));

  // Clasificar como source (cash in) vs use (cash out) del período.
  // Sources (entradas de efectivo):
  //  - Net income (utilidad)
  //  - ΔPasivos positivos (AP sube = no pagaste = source)
  //  - ΔActivos negativos (AR baja = cobraste = source)
  //  - Δequity positivo (aportaciones)
  // Uses (salidas de efectivo):
  //  - ΔActivos positivos (Inv sube, AR sube, CAPEX)
  //  - ΔPasivos negativos (AP baja = pagaste)
  //  - Δequity negativo más allá del net income (retiros)
  type FlowLine = { label: string; amount: number; kind: "source" | "use"; emphasis?: boolean };
  const flows: FlowLine[] = [];

  // Utilidad neta como fuente principal
  flows.push({
    label: "Utilidad neta del período",
    amount: data.netIncomeMxn,
    kind: data.netIncomeMxn >= 0 ? "source" : "use",
    emphasis: true,
  });

  for (const row of rowsByImpact) {
    if (row.category === "equity") {
      // Equity handled separately: retiros = netIncome - Δequity
      if (Math.abs(data.equityWithdrawalsMxn) > 1000) {
        flows.push({
          label:
            data.equityWithdrawalsMxn > 0
              ? "Retiros de capital / dividendos"
              : "Aportaciones de capital",
          amount: Math.abs(data.equityWithdrawalsMxn),
          kind: data.equityWithdrawalsMxn > 0 ? "use" : "source",
          emphasis: Math.abs(data.equityWithdrawalsMxn) > 1_000_000,
        });
      }
      continue;
    }
    if (Math.abs(row.deltaMxn) < 1000) continue; // skip ruido <1k
    const isAsset = row.cashFlowDirection === "use";
    // Si activo sube (+delta) → cash se consumió (use)
    // Si activo baja (−delta) → cash entró (source)
    // Si pasivo sube (+delta) → no pagaste (source)
    // Si pasivo baja (−delta) → pagaste (use)
    const kind: "source" | "use" = isAsset
      ? row.deltaMxn > 0
        ? "use"
        : "source"
      : row.deltaMxn > 0
        ? "source"
        : "use";
    const prefix = isAsset
      ? row.deltaMxn > 0
        ? "Aumento en "
        : "Disminución en "
      : row.deltaMxn > 0
        ? "Aumento en "
        : "Pago de ";
    flows.push({
      label: `${prefix}${row.categoryLabel}`,
      amount: Math.abs(row.deltaMxn),
      kind,
      emphasis: Math.abs(row.deltaMxn) > 3_000_000,
    });
  }

  // Validación de reconciliación
  const sourcesTotal = flows.filter((f) => f.kind === "source").reduce((s, f) => s + f.amount, 0);
  const usesTotal = flows.filter((f) => f.kind === "use").reduce((s, f) => s + f.amount, 0);
  const residualMxn = sourcesTotal - usesTotal - data.deltaCashMxn;

  const cashDropTone: "success" | "warning" | "danger" =
    data.deltaCashMxn >= 0
      ? "success"
      : Math.abs(data.deltaCashMxn) < data.netIncomeMxn * 0.5
        ? "warning"
        : "danger";

  return (
    <QuestionSection
      id="cash-reconciliation"
      question="¿Dónde está el dinero?"
      subtext={`Saldos contables al cierre ${data.fromPeriod} y ${data.toPeriod}.
        El "cash al cierre" puede diferir del efectivo de hoy en el Hero por
        movimientos bancarios posteriores al corte mensual.`}
    >
      {/* Hero de 3 cards: cash inicial → utilidad → cash final */}
      <StatGrid columns={{ mobile: 1, tablet: 4, desktop: 4 }}>
        <KpiCard
          title="Saldo contable inicio"
          value={data.openingCashMxn}
          format="currency"
          compact
          icon={Wallet}
          source="canonical"
          tone="default"
          subtitle={`Cierre ${data.fromPeriod}`}
        />
        <KpiCard
          title="Utilidad del período"
          value={data.netIncomeMxn}
          format="currency"
          compact
          icon={TrendingUp}
          source="pl"
          tone={data.netIncomeMxn >= 0 ? "success" : "danger"}
          subtitle="Neta contable (incluye 7xx otros)"
        />
        <KpiCard
          title="Saldo contable cierre"
          value={data.closingCashMxn}
          format="currency"
          compact
          icon={Wallet}
          source="canonical"
          tone="default"
          subtitle={`Cierre ${data.toPeriod} · no es el efectivo de hoy`}
        />
        <KpiCard
          title="Δ Cash vs utilidad"
          value={data.deltaCashMxn - data.netIncomeMxn}
          format="currency"
          compact
          icon={Scale}
          source="pl"
          tone={cashDropTone}
          subtitle={
            data.deltaCashMxn - data.netIncomeMxn < 0
              ? `El cash bajó ${formatCurrencyMXN(data.netIncomeMxn - data.deltaCashMxn, { compact: true })} más que la utilidad`
              : "El cash superó la utilidad"
          }
        />
      </StatGrid>

      {/* Tabla de fuentes y usos */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Flujo de efectivo · fuentes vs usos
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Reconciliación: Utilidad +{" "}
            {formatCurrencyMXN(sourcesTotal - data.netIncomeMxn, { compact: true })}{" "}
            de fuentes − {fmt(usesTotal)} de usos = Δcash{" "}
            {fmtSigned(data.deltaCashMxn)}.
            {Math.abs(residualMxn) > 500_000 && (
              <span className="text-warning">
                {" "}Residual {fmtSigned(residualMxn)} — ajustes contables no
                reflejados directamente.
              </span>
            )}
          </p>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <div className="divide-y">
            {flows.map((f, i) => {
              const emphasisClass = f.emphasis ? "font-medium" : "";
              const amountClass =
                f.kind === "source" ? "text-success" : "text-destructive";
              return (
                <div
                  key={i}
                  className={`flex items-center justify-between gap-3 px-4 py-2 text-sm ${emphasisClass}`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-block h-2 w-2 shrink-0 rounded-full ${f.kind === "source" ? "bg-success" : "bg-destructive"}`}
                      aria-hidden
                    />
                    <span>{f.label}</span>
                    <Badge
                      variant="outline"
                      className={
                        f.kind === "source"
                          ? "border-success/40 bg-success/10 text-[10px] text-success"
                          : "border-destructive/40 bg-destructive/10 text-[10px] text-destructive"
                      }
                    >
                      {f.kind === "source" ? "+cash" : "−cash"}
                    </Badge>
                  </div>
                  <span className={`tabular-nums ${amountClass}`}>
                    {f.kind === "source" ? "+" : "−"}
                    {fmt(f.amount)}
                  </span>
                </div>
              );
            })}
            <div className="flex items-center justify-between gap-3 bg-muted/50 px-4 py-3 text-sm font-semibold">
              <span>= Δ Cash observado</span>
              <span
                className={`tabular-nums ${data.deltaCashMxn >= 0 ? "text-success" : "text-destructive"}`}
              >
                {fmtSigned(data.deltaCashMxn)}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabla detallada de balance sheet */}
      <Accordion
        type="multiple"
        defaultValue={[]}
        className="rounded-lg border bg-card"
      >
        <AccordionItem value="bs-detail">
          <AccordionTrigger className="px-4">
            <span className="text-sm font-medium">
              Detalle balance sheet · saldos al corte
            </span>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4">
            <CashReconciliationTable rows={data.rows} />
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {data.equityWithdrawalsMxn > 500_000 && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <div className="font-medium text-destructive">
            ⚠ Se retiró {fmt(data.equityWithdrawalsMxn)} de capital durante el
            período
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Utilidad del período: {fmt(data.netIncomeMxn)}. Δ Equity contable:{" "}
            {fmt(data.rows.find((r) => r.category === "equity")?.deltaMxn ?? 0)}.
            Si la utilidad fue {fmt(data.netIncomeMxn)} pero equity creció
            menos, la diferencia se fue como retiros/dividendos.
          </p>
        </div>
      )}
    </QuestionSection>
  );
}

function CashReconciliationTable({ rows }: { rows: CashCategoryRow[] }) {
  const fmt = (n: number) => formatCurrencyMXN(n, { compact: true });
  const fmtSigned = (n: number) => (n >= 0 ? "+" : "") + fmt(n);
  return (
    <div className="-mx-4 overflow-x-auto px-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Categoría</TableHead>
            <TableHead className="text-right">Saldo inicio</TableHead>
            <TableHead className="text-right">Saldo final</TableHead>
            <TableHead className="text-right">Δ del período</TableHead>
            <TableHead>Efecto cash</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const isAsset = r.cashFlowDirection === "use";
            const cashEffect =
              Math.abs(r.deltaMxn) < 1000
                ? "—"
                : isAsset
                  ? r.deltaMxn > 0
                    ? "consume cash"
                    : "libera cash"
                  : r.deltaMxn > 0
                    ? "libera cash"
                    : "consume cash";
            const tone = cashEffect === "libera cash" ? "success" : cashEffect === "consume cash" ? "destructive" : "muted-foreground";
            return (
              <TableRow key={r.category}>
                <TableCell className="font-medium">{r.categoryLabel}</TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums text-muted-foreground">
                  {fmt(r.openingMxn)}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">
                  {fmt(r.closingMxn)}
                </TableCell>
                <TableCell
                  className={`whitespace-nowrap text-right tabular-nums ${r.deltaMxn >= 0 ? "text-success" : "text-destructive"}`}
                >
                  {fmtSigned(r.deltaMxn)}
                </TableCell>
                <TableCell className="text-xs">
                  <span className={`text-${tone}`}>{cashEffect}</span>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
