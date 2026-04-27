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
  getCustomerCreditScores,
  type CustomerCreditScore,
} from "@/lib/queries/sp13/finanzas";

/**
 * F-CREDIT — Score de riesgo crediticio por cliente.
 * 5 KPIs por tier + tabla top 25 con score, AR open, recomendación.
 */
export async function CustomerCreditScoresBlock() {
  const data = await getCustomerCreditScores();
  if (data.totalCustomers === 0) return null;
  const fmt = (n: number) => formatCurrencyMXN(n, { compact: true });
  const fmtFull = (n: number) => formatCurrencyMXN(n);
  const top = data.rows.slice(0, 25);

  const tierLabel: Record<string, string> = {
    excelente: "Excelente",
    bueno: "Bueno",
    regular: "Regular",
    riesgo: "Riesgo",
    rechazo: "Rechazo",
  };

  return (
    <QuestionSection
      id="credit-score"
      question="¿A qué cliente le presto y cuánto?"
      subtext={`Score de riesgo crediticio (0-100) calculado del histórico
        de pago, recurrencia, volumen, AR vencido y blacklist SAT. Sugiere
        un límite de crédito por cliente. ${data.totalCustomers} clientes
        evaluados. Verde = extender · Rojo = solo prepago.`}
      collapsible
      defaultOpen={false}
    >
      <StatGrid columns={{ mobile: 2, tablet: 5, desktop: 5 }}>
        <KpiCard title="Excelente (80+)" value={data.byTier.excelente} format="number" tone="success" subtitle="Crédito amplio (2× monthly)" />
        <KpiCard title="Bueno (60-79)" value={data.byTier.bueno} format="number" tone="info" subtitle="Crédito normal (1.5×)" />
        <KpiCard title="Regular (40-59)" value={data.byTier.regular} format="number" tone="warning" subtitle="Crédito conservador (1×)" />
        <KpiCard title="Riesgo (20-39)" value={data.byTier.riesgo} format="number" tone="danger" subtitle="Reducir exposición (0.5×)" />
        <KpiCard title="Rechazo (<20)" value={data.byTier.rechazo} format="number" tone="danger" subtitle="Solo prepago" />
      </StatGrid>

      <div className="overflow-hidden rounded-md border bg-card">
        <div className="border-b bg-muted/30 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:px-4">
          Top 25 clientes (por monthly avg)
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[180px]">Cliente</TableHead>
                <TableHead className="text-right">Score</TableHead>
                <TableHead className="text-right">Monthly</TableHead>
                <TableHead className="text-right">Delay mediano</TableHead>
                <TableHead className="text-right">AR abierto</TableHead>
                <TableHead className="text-right">% vencido</TableHead>
                <TableHead className="text-right">Límite sugerido</TableHead>
                <TableHead className="text-right">Disponible</TableHead>
                <TableHead className="min-w-[200px]">Recomendación</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {top.map((r: CustomerCreditScore) => {
                const tone = r.tone;
                const scoreClass =
                  tone === "success" ? "text-success"
                  : tone === "info" ? "text-info"
                  : tone === "warning" ? "text-warning"
                  : tone === "danger" ? "text-destructive"
                  : "text-destructive";
                return (
                  <TableRow key={r.bronzeId}>
                    <TableCell className="font-medium">
                      <Link href={`/empresas/${r.bronzeId}`} className="hover:underline">
                        {r.customerName}
                      </Link>
                      {r.blacklistStatus && (
                        <span className="ml-1 text-[10px] text-destructive">⚠ {r.blacklistStatus}</span>
                      )}
                    </TableCell>
                    <TableCell
                      className={`text-right font-semibold tabular-nums ${scoreClass}`}
                      title={`Componentes: pago ${r.paymentBehaviorPts}/40, recurrencia ${r.recurrencePts}/25, volumen ${r.volumePts}/15, AR ${r.arStatusPts}/15, trend ${r.trendPts}/5`}
                    >
                      {r.score}
                      <span className="ml-1 text-[10px] font-normal text-muted-foreground">{tierLabel[r.tier]}</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmt(r.monthlyAvgMxn)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.medianDelayDays != null ? `${r.medianDelayDays}d` : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.arOpenMxn > 0 ? fmt(r.arOpenMxn) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.arOverduePct > 0 ? `${r.arOverduePct.toFixed(0)}%` : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums" title={fmtFull(r.recommendedCreditLimitMxn)}>
                      {r.recommendedCreditLimitMxn > 0 ? fmt(r.recommendedCreditLimitMxn) : "$0"}
                    </TableCell>
                    <TableCell className={`text-right tabular-nums ${r.availableCreditMxn > 0 ? "text-success" : "text-destructive"}`}>
                      {r.availableCreditMxn > 0 ? fmt(r.availableCreditMxn) : "0"}
                    </TableCell>
                    <TableCell className="text-[11px] text-muted-foreground">{r.reason}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="rounded-md border border-info/30 bg-info/5 px-3 py-2 text-xs text-muted-foreground">
        <span className="font-semibold text-info">Cómo se calcula</span>{" "}
        Score 0-100 combinando: pago histórico (40 pts, mediana de delay
        12m), recurrencia + antigüedad (25 pts, canonical 12m + SAT 60m),
        volumen mensual (15 pts log10), AR vencido actual (15 pts), trend
        (5 pts recent3m/prior9m). Blacklist SAT &apos;definitive&apos; o
        &apos;presumed&apos; → score 0 automático. Límite recomendado =
        monthly_avg × multiplicador del tier (2× excelente → 0.5× riesgo).
        Disponible = límite − AR ya extendido.
      </div>
    </QuestionSection>
  );
}
