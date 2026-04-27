import Link from "next/link";
import { formatCurrencyMXN } from "@/lib/formatters";
import {
  StatGrid,
  KpiCard,
  QuestionSection,
} from "@/components/patterns";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getCustomerLtv,
  type CustomerLtvRow,
} from "@/lib/queries/sp13/finanzas";

/**
 * F-LTV — Customer Lifetime Value proyectado a 5 años (NPV).
 * Combina credit score (retention), trend (growth), monthly_avg, WACC.
 */
export async function CustomerLtvBlock() {
  const data = await getCustomerLtv();
  if (data.totalCustomers === 0) return null;
  const fmt = (n: number) => formatCurrencyMXN(n, { compact: true });
  const fmtFull = (n: number) => formatCurrencyMXN(n);
  const top = data.rows.slice(0, 25);

  const catLabel: Record<string, string> = {
    estrella: "Estrella",
    valioso: "Valioso",
    mantener: "Mantener",
    bajo_valor: "Bajo valor",
    evitar: "Evitar",
  };
  const catTone: Record<
    string,
    "success" | "info" | "warning" | "danger" | "default"
  > = {
    estrella: "success",
    valioso: "info",
    mantener: "default",
    bajo_valor: "warning",
    evitar: "danger",
  };

  const byCat = data.rows.reduce(
    (acc, r) => {
      acc[r.ltvCategory] = (acc[r.ltvCategory] ?? 0) + 1;
      return acc;
    },
    { estrella: 0, valioso: 0, mantener: 0, bajo_valor: 0, evitar: 0 } as Record<string, number>
  );

  return (
    <QuestionSection
      id="customer-ltv"
      question="¿Qué clientes vale la pena cultivar?"
      subtext={`Customer Lifetime Value proyectado a ${data.assumptions.horizonYears}
        años en valor presente neto. Combina monthly_avg, trend, retention
        (del credit score), margin neto ${data.assumptions.grossMarginPct}%
        y descuenta a WACC ${data.assumptions.waccPct}%. Portafolio total:
        ${fmt(data.portfolioLtvMxn)} (top 25%: ${fmt(data.topQuartileLtvMxn)},
        ${Math.round((data.topQuartileLtvMxn / data.portfolioLtvMxn) * 100)}%
        del valor — Pareto).`}
      collapsible
      defaultOpen={false}
    >
      <StatGrid columns={{ mobile: 2, tablet: 5, desktop: 5 }}>
        <KpiCard title="Estrella (>$5M)" value={byCat.estrella ?? 0} format="number" tone="success" subtitle="KAM dedicado" />
        <KpiCard title="Valioso ($1-5M)" value={byCat.valioso ?? 0} format="number" tone="info" subtitle="Atención reps" />
        <KpiCard title="Mantener ($200K-1M)" value={byCat.mantener ?? 0} format="number" tone="default" subtitle="Operación normal" />
        <KpiCard title="Bajo valor (<$200K)" value={byCat.bajo_valor ?? 0} format="number" tone="warning" subtitle="No invertir extra" />
        <KpiCard title="Evitar (LTV/AR <0.5)" value={byCat.evitar ?? 0} format="number" tone="danger" subtitle="Cobranza dura" />
      </StatGrid>

      <div className="overflow-hidden rounded-md border bg-card">
        <div className="border-b bg-muted/30 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:px-4">
          Top 25 clientes ordenados por LTV (NPV 5y)
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[180px]">Cliente</TableHead>
                <TableHead className="text-right">LTV (NPV)</TableHead>
                <TableHead className="text-right">vs Revenue rank</TableHead>
                <TableHead className="text-right">Annual</TableHead>
                <TableHead className="text-right">Retention</TableHead>
                <TableHead className="text-right">Growth</TableHead>
                <TableHead className="text-right">LTV/AR</TableHead>
                <TableHead className="min-w-[200px]">Categoría / acción</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {top.map((r: CustomerLtvRow) => {
                const tone = catTone[r.ltvCategory] ?? "default";
                const ltvClass =
                  tone === "success" ? "text-success"
                  : tone === "info" ? "text-info"
                  : tone === "warning" ? "text-warning"
                  : tone === "danger" ? "text-destructive"
                  : "";
                const rankDeltaTone =
                  r.rankDelta > 5 ? "text-success"
                  : r.rankDelta < -5 ? "text-warning"
                  : "text-muted-foreground";
                return (
                  <TableRow key={r.bronzeId}>
                    <TableCell className="font-medium">
                      <Link href={`/empresas/${r.bronzeId}`} className="hover:underline">
                        {r.customerName}
                      </Link>
                    </TableCell>
                    <TableCell
                      className={`text-right font-semibold tabular-nums ${ltvClass}`}
                      title={`Sin descontar: ${fmtFull(r.ltv5yMxn)} · NPV: ${fmtFull(r.ltvDiscountedMxn)}`}
                    >
                      {fmt(r.ltvDiscountedMxn)}
                    </TableCell>
                    <TableCell
                      className={`text-right text-xs tabular-nums ${rankDeltaTone}`}
                      title={`Rank LTV: #${r.rankByLtv} · Rank Revenue: #${r.rankByRevenue}`}
                    >
                      #{r.rankByLtv} vs #{r.rankByRevenue}
                      {r.rankDelta > 0 && <span className="ml-1">↑{r.rankDelta}</span>}
                      {r.rankDelta < 0 && <span className="ml-1">↓{-r.rankDelta}</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(r.annualRevenueMxn)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {(r.retentionProb * 100).toFixed(0)}%
                    </TableCell>
                    <TableCell className={`text-right tabular-nums ${r.growthCapped > 1.05 ? "text-success" : r.growthCapped < 0.95 ? "text-destructive" : ""}`}>
                      {(r.growthCapped * 100 - 100).toFixed(0) === "0"
                        ? "—"
                        : `${r.growthCapped > 1 ? "+" : ""}${((r.growthCapped - 1) * 100).toFixed(0)}%`}
                    </TableCell>
                    <TableCell className={`text-right tabular-nums ${r.ltvVsArRatio > 0 && r.ltvVsArRatio < 1 ? "text-destructive" : ""}`}>
                      {r.ltvVsArRatio === -1 ? "—" : r.ltvVsArRatio > 100 ? "100+×" : `${r.ltvVsArRatio.toFixed(1)}×`}
                    </TableCell>
                    <TableCell className="text-[11px] text-muted-foreground">
                      <span className={`font-medium ${ltvClass}`}>{catLabel[r.ltvCategory]}</span>{" "}
                      · {r.recommendation}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="rounded-md border border-info/30 bg-info/5 px-3 py-2 text-xs text-muted-foreground">
        <span className="font-semibold text-info">Cómo se calcula</span>{" "}
        LTV = Σ(annual_rev × growth^t × margin × retention^t) / (1 + WACC)^t
        para t=1..{data.assumptions.horizonYears} años. Retention =
        credit_score/100 (capada [0.5, 0.95]). Growth = trend_factor
        (capado [0.8, 1.2]). WACC {data.assumptions.waccPct}% (costo capital
        SMB MX típico). Margin {data.assumptions.grossMarginPct}% (gross
        textil). LTV/AR &lt; 1× = cliente debe más de lo que vale a futuro
        (mal riesgo). Rank LTV ↑ vs Revenue rank = cliente infravalorado
        (mejor de lo que parece por revenue actual).
      </div>
    </QuestionSection>
  );
}
