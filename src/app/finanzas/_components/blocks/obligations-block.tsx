import { Building2, CalendarClock, FileX, Receipt, Scale } from "lucide-react";
import {
  StatGrid,
  KpiCard,
  QuestionSection,
  EmptyState,
} from "@/components/patterns";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrencyMXN } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import {
  getObligationsSummary,
  type ObligationCategory,
} from "@/lib/queries/sp13/finanzas";
import { formatPeriod } from "../utils";


export async function ObligationsBlock() {
  const ob = await getObligationsSummary();
  const fmt = (n: number) => formatCurrencyMXN(n, { compact: true });
  const fmtFull = (n: number) => formatCurrencyMXN(n);
  // Threshold $1k: el RPC mantiene categorías con remanentes < $1k (típico
  // del ISR retenido cuando el 99% se paga cada mes y deja pesos sueltos)
  // pero account_count y detail vienen vacíos. Mostrarlas confunde al CEO
  // ("hay 54 pesos pero ninguna cuenta"). Filtrar en el render evita tocar
  // la lógica fiscal del RPC.
  const cats = ob.categories.filter((c) => c.outstandingMxn >= 1000);

  const liqLabel =
    ob.liquidityRatio == null
      ? "—"
      : ob.liquidityRatio >= 1.5
        ? "saludable"
        : ob.liquidityRatio >= 1
          ? "ajustado"
          : "comprometido";
  const liqTone =
    ob.liquidityRatio == null
      ? "default"
      : ob.liquidityRatio >= 1.5
        ? "success"
        : ob.liquidityRatio >= 1
          ? "warning"
          : "danger";

  return (
    <QuestionSection
      id="obligations"
      question="¿Cuánto debo y cuándo lo tengo que pagar?"
      subtext={`Saldos al cierre de ${formatPeriod(ob.asOfPeriod)}.
        Operativo excluye intercompañía/préstamos accionistas.
        ≤30d incluye SAT/IMSS día 17. Liquidez = efectivo / obligaciones ≤30d.`}
    >
      <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 4 }}>
        <KpiCard
          title="Operativo (sin intercompañía)"
          value={ob.totalOperativoMxn}
          format="currency"
          compact
          icon={Scale}
          source="canonical"
          tone={ob.totalOperativoMxn > ob.efectivoMxn * 5 ? "danger" : "default"}
          subtitle={`vs ${fmt(ob.efectivoMxn)} en efectivo`}
        />
        <KpiCard
          title="Vencen en ≤30 días"
          value={ob.totalCortoPlazo30Mxn}
          format="currency"
          compact
          icon={CalendarClock}
          source="canonical"
          tone={liqTone as "success" | "warning" | "danger" | "default"}
          subtitle={`liquidez ${ob.liquidityRatio == null ? "—" : `${ob.liquidityRatio.toFixed(2)}× ${liqLabel}`}`}
        />
        <KpiCard
          title="Vencen 30-90 días"
          value={ob.totalCortoPlazo90Mxn - ob.totalCortoPlazo30Mxn}
          format="currency"
          compact
          icon={Receipt}
          source="canonical"
          tone="info"
          subtitle="AP, arrendamiento, préstamos CP"
        />
        <KpiCard
          title="Intercompañía"
          value={ob.totalIntercompaniaMxn}
          format="currency"
          compact
          icon={Building2}
          source="canonical"
          tone="default"
          subtitle="partes relacionadas · no urgente"
        />
      </StatGrid>

      {cats.length === 0 ? (
        <EmptyState
          icon={FileX}
          title="Sin obligaciones registradas"
          description="No hay saldos pendientes en cuentas de pasivo al corte."
        />
      ) : (
        <ObligationsTable
          rows={cats}
          totalMxn={ob.totalMxn}
          fmtFull={fmtFull}
        />
      )}
    </QuestionSection>
  );
}

function ObligationsTable({
  rows,
  totalMxn,
  fmtFull,
}: {
  rows: ObligationCategory[];
  totalMxn: number;
  fmtFull: (n: number) => string;
}) {
  const horizonLabel = (h: ObligationCategory["paymentHorizon"]) => {
    switch (h) {
      case "inmediato":
        return "Inmediato";
      case "30d_sat":
        return "≤30 días (SAT)";
      case "30_60d":
        return "30-60 días";
      case "mensual":
        return "Mensual";
      case "meses":
        return "Próximos meses";
      case "lp":
        return "Largo plazo";
      case "intercompania":
        return "Intercompañía";
    }
  };
  const horizonTone = (h: ObligationCategory["paymentHorizon"]) => {
    switch (h) {
      case "inmediato":
        return "bg-destructive/10 text-destructive border-destructive/30";
      case "30d_sat":
        return "bg-warning/10 text-warning border-warning/30";
      case "30_60d":
      case "mensual":
        return "bg-primary/10 text-primary border-primary/30";
      case "meses":
        return "bg-muted text-muted-foreground border-muted-foreground/20";
      case "lp":
        return "bg-muted/50 text-muted-foreground border-muted-foreground/10";
      case "intercompania":
        return "bg-muted/30 text-muted-foreground border-muted-foreground/10 italic";
    }
  };

  return (
    <div className="overflow-hidden rounded-md border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[55%]">Categoría</TableHead>
            <TableHead className="text-center">Vencimiento</TableHead>
            <TableHead className="text-right">Saldo</TableHead>
            <TableHead className="text-right w-[60px]">% del total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const pct = totalMxn > 0 ? (r.outstandingMxn / totalMxn) * 100 : 0;
            const hasDetail = r.detail.length > 1;
            return (
              <TableRow key={r.category}>
                <TableCell>
                  <div className="font-medium">{r.categoryLabel}</div>
                  <div
                    className="mt-1 h-1 overflow-hidden rounded-full bg-muted"
                    aria-hidden
                  >
                    <div
                      className="h-full rounded-full bg-warning/50"
                      style={{ width: `${Math.min(pct, 100)}%` }}
                    />
                  </div>
                  {hasDetail && (
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {r.detail.slice(0, 3).map((d, i) => (
                        <span key={d.accountCode}>
                          {i > 0 && " · "}
                          {d.accountName}
                          {": "}
                          <span className="tabular-nums">
                            {fmtFull(d.outstandingMxn)}
                          </span>
                        </span>
                      ))}
                      {r.detail.length > 3 &&
                        ` · +${r.detail.length - 3} más`}
                    </div>
                  )}
                  {!hasDetail && r.detail[0] && (
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {r.detail[0].accountCode} · {r.detail[0].accountName}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-center">
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium",
                      horizonTone(r.paymentHorizon)
                    )}
                  >
                    {horizonLabel(r.paymentHorizon)}
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {fmtFull(r.outstandingMxn)}
                </TableCell>
                <TableCell className="text-right text-xs text-muted-foreground tabular-nums">
                  {pct.toFixed(1)}%
                </TableCell>
              </TableRow>
            );
          })}
          <TableRow className="border-t-2 bg-muted/40 font-semibold">
            <TableCell>TOTAL OBLIGACIONES</TableCell>
            <TableCell />
            <TableCell className="text-right tabular-nums">
              {fmtFull(totalMxn)}
            </TableCell>
            <TableCell className="text-right text-xs tabular-nums">
              100%
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}
