import { ArrowDownCircle, ArrowUpCircle, Receipt, Scale } from "lucide-react";
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
import { getCashConversionCycle } from "@/lib/queries/sp13/finanzas";

/**
 * F-CCC — Cash Conversion Cycle (DSO + DIO − DPO).
 * Mide eficiencia de capital de trabajo. Bajo = cash regresa rápido.
 * Trend 12m muestra si CCC está mejorando o empeorando.
 */
export async function CashConversionCycleBlock() {
  const ccc = await getCashConversionCycle();
  const fmt = (n: number) => formatCurrencyMXN(n, { compact: true });
  const fmtFull = (n: number) => formatCurrencyMXN(n);

  const cccTone =
    ccc.ccc <= ccc.benchmark.ccc ? "success"
    : ccc.ccc <= ccc.benchmark.ccc * 1.3 ? "warning"
    : "danger";
  const dsoTone =
    ccc.dso <= ccc.benchmark.dso ? "success"
    : ccc.dso <= ccc.benchmark.dso * 1.3 ? "warning"
    : "danger";
  const dioTone =
    ccc.dio <= ccc.benchmark.dio ? "success"
    : ccc.dio <= ccc.benchmark.dio * 1.3 ? "warning"
    : "danger";
  const dpoTone =
    ccc.dpo >= ccc.benchmark.dpo ? "success"
    : ccc.dpo >= ccc.benchmark.dpo * 0.7 ? "warning"
    : "danger";

  const recentTrend = ccc.monthlyTrend.slice(-3);
  const trendDelta =
    recentTrend.length >= 2
      ? recentTrend[recentTrend.length - 1].ccc - recentTrend[0].ccc
      : 0;

  return (
    <QuestionSection
      id="ccc"
      question="¿Qué tan rápido regresa mi cash a la operación?"
      subtext={`Cash Conversion Cycle = DSO + DIO − DPO. Mide cuántos
        días pasan entre comprar materia prima y cobrar al cliente.
        Bajo = cash regresa rápido. Alto = capital atorado. Benchmark
        textil mexicano típico: ~105 días. Recálculo cada hora.`}
      collapsible
      defaultOpen={false}
    >
      <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 4 }}>
        <KpiCard
          title="CCC actual"
          value={ccc.ccc}
          format="number"
          tone={cccTone}
          subtitle={`${ccc.ccc > 0 ? "+" : ""}${ccc.ccc} días · benchmark ${ccc.benchmark.ccc}d`}
          icon={Scale}
        />
        <KpiCard
          title="DSO (días cobranza)"
          value={ccc.dso}
          format="number"
          tone={dsoTone}
          subtitle={`AR ${fmt(ccc.arOpenMxn)} / revenue diario · benchmark ${ccc.benchmark.dso}d`}
          icon={ArrowDownCircle}
        />
        <KpiCard
          title="DIO (días inventario)"
          value={ccc.dio}
          format="number"
          tone={dioTone}
          subtitle={`Inv ${fmt(ccc.inventoryMxn)} / cogs diario · benchmark ${ccc.benchmark.dio}d`}
          icon={Receipt}
        />
        <KpiCard
          title="DPO (días pago prov)"
          value={ccc.dpo}
          format="number"
          tone={dpoTone}
          subtitle={`AP ${fmt(ccc.apOpenMxn)} / compras diario · benchmark ${ccc.benchmark.dpo}d`}
          icon={ArrowUpCircle}
        />
      </StatGrid>

      <div className="rounded-md border bg-card">
        <div className="border-b bg-muted/30 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:px-4">
          Capital de trabajo atorado en operación
        </div>
        <div className="px-3 py-3 sm:px-4">
          <div className="text-xl font-semibold tabular-nums text-foreground">
            {fmtFull(ccc.workingCapitalTiedMxn)}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            CCC ({ccc.ccc}d) × revenue diario ({fmt(ccc.revenue12mMxn / 365)}/d){" "}
            = cash promedio atorado en el ciclo operativo. Si bajaras CCC en
            10 días, liberarías {fmt((10 * ccc.revenue12mMxn) / 365)} de cash.
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-md border bg-card">
        <div className="border-b bg-muted/30 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground sm:px-4">
          Trend últimos 12 meses{" "}
          {trendDelta !== 0 && (
            <span className={`ml-2 font-normal normal-case tracking-normal ${trendDelta < 0 ? "text-success" : "text-destructive"}`}>
              {trendDelta < 0 ? "↓" : "↑"} {Math.abs(trendDelta).toFixed(0)}d
              CCC últimos 3 meses
            </span>
          )}
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mes</TableHead>
                <TableHead className="text-right">DSO</TableHead>
                <TableHead className="text-right">DIO</TableHead>
                <TableHead className="text-right">DPO</TableHead>
                <TableHead className="text-right">CCC</TableHead>
                <TableHead className="text-right">AR</TableHead>
                <TableHead className="text-right">Inventario</TableHead>
                <TableHead className="text-right">AP</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ccc.monthlyTrend.map((m) => (
                <TableRow key={m.period}>
                  <TableCell className="font-medium">{m.period}</TableCell>
                  <TableCell className="text-right tabular-nums">{m.dso.toFixed(0)}d</TableCell>
                  <TableCell className="text-right tabular-nums">{m.dio.toFixed(0)}d</TableCell>
                  <TableCell className="text-right tabular-nums">{m.dpo.toFixed(0)}d</TableCell>
                  <TableCell className="text-right tabular-nums font-medium">{m.ccc.toFixed(0)}d</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{fmt(m.arMxn)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{fmt(m.inventoryMxn)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{fmt(m.apMxn)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <div className="rounded-md border border-info/30 bg-info/5 px-3 py-2 text-xs text-muted-foreground">
        <div className="font-semibold text-info mb-1">Cómo leer cada componente</div>
        <div className="grid gap-1 leading-snug sm:grid-cols-2">
          <div>
            <span className="font-medium text-foreground">DSO alto:</span> cobras
            tarde. Acción: cobranza dura, factoring, descuento por pronto pago,
            ajustar términos a clientes específicos. (ver score crediticio)
          </div>
          <div>
            <span className="font-medium text-foreground">DIO alto:</span> inventario
            parado. Acción: mejor planning de producción, JIT en MP, vender SKUs
            lentos, reducir compras a recurrentes que ya tienes en bodega.
          </div>
          <div>
            <span className="font-medium text-foreground">DPO bajo:</span> pagas
            muy rápido a proveedores. Acción: negociar términos 30→45→60d,
            estirar pagos hasta el límite contractual sin dañar relación.
          </div>
          <div>
            <span className="font-medium text-foreground">CCC negativo:</span>{" "}
            (raro) cobras antes de pagar — modelo de negocio rentable como Amazon.
            Quimibond opera con CCC positivo (capital atorado).
          </div>
        </div>
      </div>
    </QuestionSection>
  );
}
