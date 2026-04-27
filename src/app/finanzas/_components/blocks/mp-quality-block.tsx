import { AlertTriangle, Scale } from "lucide-react";
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
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { formatCurrencyMXN } from "@/lib/formatters";
import {
  getMpLeavesInventory,
  getTopProductsWithComposition,
  type MpLeafRow,
  type TopProductWithComposition,
} from "@/lib/queries/sp13/finanzas";
import type { HistoryRange } from "@/components/patterns/history-range";

/* ── F-MP-Q: Calidad de costo primo y composición por producto ──────── */
export async function MpQualityBlock({ range }: { range: HistoryRange }) {
  const [mp, top] = await Promise.all([
    getMpLeavesInventory(),
    getTopProductsWithComposition(range, 20),
  ]);

  const flagTone = (flag: string): "success" | "warning" | "danger" | "info" => {
    if (flag === "ok") return "success";
    if (flag === "sin_avg_cost" || flag === "desvio_25pct_vs_ultima") return "danger";
    if (flag === "compra_vieja_6m" || flag === "sin_compra_historica") return "warning";
    return "info";
  };

  const pctOk =
    mp.totalLeaves > 0
      ? Math.round(((mp.flagCounts["ok"] ?? 0) / mp.totalLeaves) * 100)
      : 0;
  const pctSinCosto =
    mp.totalLeaves > 0
      ? Math.round(((mp.flagCounts["sin_avg_cost"] ?? 0) / mp.totalLeaves) * 100)
      : 0;

  // Sort MP leaves by priority: flagged first, then by use frequency
  const priorityFlags = new Set([
    "sin_avg_cost",
    "desvio_25pct_vs_ultima",
    "compra_vieja_6m",
    "sin_compra_historica",
  ]);
  const mpSorted = [...mp.rows].sort((a, b) => {
    const aFlagged = priorityFlags.has(a.flag) ? 0 : 1;
    const bFlagged = priorityFlags.has(b.flag) ? 0 : 1;
    if (aFlagged !== bFlagged) return aFlagged - bFlagged;
    return b.timesUsedInBoms - a.timesUsedInBoms;
  });

  return (
    <QuestionSection
      id="mp-quality"
      question="¿Los costos de mi materia prima están correctos?"
      subtext={`${mp.totalLeaves} MP únicas · ${pctOk}% OK · ${pctSinCosto}% sin avg_cost · top ${top.rows.length} productos vendidos con desglose · ${top.periodLabel}`}
      collapsible
      defaultOpen={false}
    >
      <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 4 }}>
        <KpiCard
          title="MP con avg_cost OK"
          value={mp.flagCounts["ok"] ?? 0}
          format="number"
          icon={Scale}
          source="canonical"
          tone="success"
          subtitle={`${pctOk}% de ${mp.totalLeaves} · compra reciente + costo consistente`}
        />
        <KpiCard
          title="MP sin avg_cost"
          value={mp.flagCounts["sin_avg_cost"] ?? 0}
          format="number"
          icon={AlertTriangle}
          source="canonical"
          tone={pctSinCosto > 20 ? "danger" : "warning"}
          subtitle={`${pctSinCosto}% — cero contribución en BOM recursiva`}
        />
        <KpiCard
          title="MP con compra vieja >6m"
          value={mp.flagCounts["compra_vieja_6m"] ?? 0}
          format="number"
          icon={AlertTriangle}
          source="canonical"
          tone="warning"
          subtitle="avg_cost puede estar desactualizado"
        />
        <KpiCard
          title="MP sin compra histórica"
          value={mp.flagCounts["sin_compra_historica"] ?? 0}
          format="number"
          icon={AlertTriangle}
          source="canonical"
          tone="warning"
          subtitle="nunca comprada vía PO (insumo indirecto o gap de sync)"
        />
      </StatGrid>

      <Accordion
        type="multiple"
        defaultValue={["top-products"]}
        className="rounded-lg border bg-card"
      >
        <AccordionItem value="top-products">
          <AccordionTrigger className="px-4">
            <span className="flex items-center gap-2 text-sm font-medium">
              Top {top.rows.length} productos vendidos — desglose de costo primo
              <Badge variant="outline" className="text-[11px]">
                click para expandir cada producto
              </Badge>
            </span>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4">
            <TopProductsCompositionTable rows={top.rows} />
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="mp-inventory">
          <AccordionTrigger className="px-4">
            <span className="flex items-center gap-2 text-sm font-medium">
              Inventario de MP — {mp.totalLeaves} hojas
              {(mp.flagCounts["sin_avg_cost"] ?? 0) > 0 && (
                <Badge
                  variant="outline"
                  className="border-destructive/40 bg-destructive/10 text-destructive"
                >
                  {mp.flagCounts["sin_avg_cost"]} sin avg_cost
                </Badge>
              )}
            </span>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4">
            <MpInventoryTable rows={mpSorted} flagTone={flagTone} />
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </QuestionSection>
  );
}

/* Tabla top productos con composición (expandible por fila) ─────────── */
function TopProductsCompositionTable({
  rows,
}: {
  rows: TopProductWithComposition[];
}) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Sin productos vendidos en el período.
      </p>
    );
  }
  const fmt = (n: number) => formatCurrencyMXN(n, { compact: true });

  return (
    <div className="space-y-1">
      {rows.map((r, i) => {
        const marginTone =
          r.marginPct == null
            ? "text-muted-foreground"
            : r.marginPct < 0
              ? "text-destructive"
              : r.marginPct < 50
                ? "text-warning"
                : "text-success";
        const topLeaves = [...r.composition]
          .sort((a, b) => b.costContributionMxn - a.costContributionMxn)
          .slice(0, 20);
        const qtyFmt = r.qtySold.toLocaleString("es-MX", {
          maximumFractionDigits: 0,
        });
        return (
          <details
            key={r.productId}
            className="group rounded-md border bg-background"
          >
            <summary className="flex cursor-pointer flex-col gap-2 px-3 py-2 text-xs hover:bg-muted/30 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
              {/* Identity row — always visible */}
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span className="shrink-0 text-muted-foreground tabular-nums">
                  #{i + 1}
                </span>
                <span className="shrink-0 font-mono font-medium">
                  {r.productRef ?? "sin_ref"}
                </span>
                <span className="truncate text-muted-foreground">
                  {r.productName}
                </span>
              </div>
              {/* Metrics — grid on mobile, inline on desktop */}
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] tabular-nums sm:flex sm:shrink-0 sm:items-center sm:gap-4 sm:text-xs">
                <div className="flex items-baseline gap-1 sm:block">
                  <span className="text-muted-foreground sm:hidden">Qty</span>
                  <span className="text-muted-foreground">{qtyFmt}</span>
                </div>
                <div className="flex items-baseline gap-1 sm:block">
                  <span className="text-muted-foreground sm:hidden">
                    Ventas
                  </span>
                  <span className="font-medium">
                    {fmt(r.revenueInvoiceMxn)}
                  </span>
                </div>
                <div className="flex items-baseline gap-1 sm:block">
                  <span className="text-muted-foreground sm:hidden">COGS</span>
                  <span className="text-muted-foreground">
                    − {fmt(r.cogsRecursiveTotalMxn)}
                  </span>
                </div>
                <div className="flex items-baseline gap-1 sm:block">
                  <span className="text-muted-foreground sm:hidden">
                    Margen
                  </span>
                  <span className={`font-medium ${marginTone}`}>
                    {r.marginPct == null
                      ? "—"
                      : `${r.marginPct.toFixed(1)}%`}
                  </span>
                </div>
                {r.leavesWithoutCostInBom > 0 && (
                  <Badge
                    variant="outline"
                    className="col-span-2 w-fit border-warning/40 bg-warning/10 text-[10px] text-warning sm:col-span-1"
                  >
                    {r.leavesWithoutCostInBom} sin costo
                  </Badge>
                )}
              </div>
            </summary>
            <div className="border-t bg-muted/10 px-3 py-2 text-xs">
              <div className="mb-2 text-[11px] text-muted-foreground">
                Costo primo unitario ≈{" "}
                <span className="font-mono font-medium">
                  ${r.cogsRecursiveUnitMxn.toFixed(2)}
                </span>{" "}
                · {r.composition.length} hojas
              </div>
              <div className="-mx-3 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8">d</TableHead>
                      <TableHead>Hoja (MP)</TableHead>
                      <TableHead className="text-right">qty/u</TableHead>
                      <TableHead className="text-right">$/unidad</TableHead>
                      <TableHead className="text-right">Contrib.</TableHead>
                      <TableHead className="text-right">%</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {topLeaves.map((l) => (
                      <TableRow key={l.leafProductId}>
                        <TableCell className="text-[10px] text-muted-foreground">
                          {l.depth}
                        </TableCell>
                        <TableCell>
                          <div className="font-mono text-[11px]">
                            {l.leafRef ?? "sin_ref"}
                          </div>
                          {l.leafName && (
                            <div className="text-[11px] text-muted-foreground">
                              {l.leafName}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right tabular-nums">
                          {l.qtyPerUnit.toFixed(5)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right tabular-nums">
                          {l.avgCostMxn != null && l.avgCostMxn > 0 ? (
                            `$${l.avgCostMxn.toFixed(2)}`
                          ) : (
                            <span className="text-destructive">n/d</span>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right tabular-nums">
                          ${l.costContributionMxn.toFixed(2)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right tabular-nums text-muted-foreground">
                          {l.pctOfTotal.toFixed(1)}%
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </details>
        );
      })}
    </div>
  );
}

/* Tabla inventario de MP (hojas) ─────────────────────────────────────── */
function MpInventoryTable({
  rows,
  flagTone,
}: {
  rows: MpLeafRow[];
  flagTone: (f: string) => "success" | "warning" | "danger" | "info";
}) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">Sin datos de MP.</p>
    );
  }
  const getToneClass = (flag: string) => {
    const tone = flagTone(flag);
    return tone === "danger"
      ? "border-destructive/40 bg-destructive/10 text-destructive"
      : tone === "warning"
        ? "border-warning/40 bg-warning/10 text-warning"
        : tone === "success"
          ? "border-success/40 bg-success/10 text-success"
          : "border-muted/40 bg-muted/10 text-muted-foreground";
  };
  return (
    <>
      {/* Desktop: tabla horizontal con scroll */}
      <div className="-mx-4 hidden overflow-x-auto px-4 md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ref</TableHead>
              <TableHead>Nombre</TableHead>
              <TableHead>Categoría</TableHead>
              <TableHead className="text-right">UoM</TableHead>
              <TableHead className="text-right">avg_cost</TableHead>
              <TableHead className="text-right">Última compra</TableHead>
              <TableHead className="text-right">vs última</TableHead>
              <TableHead className="text-right">BOMs</TableHead>
              <TableHead>Flag</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.productId}>
                <TableCell className="whitespace-nowrap font-mono text-[11px]">
                  {r.productRef ?? (
                    <span className="italic text-muted-foreground">sin_ref</span>
                  )}
                </TableCell>
                <TableCell className="max-w-[240px] truncate text-xs text-muted-foreground">
                  {r.productName ?? ""}
                </TableCell>
                <TableCell className="max-w-[180px] truncate text-[11px] text-muted-foreground">
                  {r.category ?? ""}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right text-[11px] text-muted-foreground">
                  {r.uom ?? ""}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">
                  {r.avgCostMxn != null && r.avgCostMxn > 0
                    ? `$${r.avgCostMxn.toFixed(2)}`
                    : "—"}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums text-[11px]">
                  {r.lastPurchaseDate ? (
                    <>
                      <span>
                        {r.lastPurchasePrice != null
                          ? `$${r.lastPurchasePrice.toFixed(2)}`
                          : "—"}
                      </span>
                      <span className="ml-2 text-muted-foreground">
                        {r.daysSincePurchase != null
                          ? `hace ${r.daysSincePurchase}d`
                          : ""}
                      </span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell
                  className={`whitespace-nowrap text-right tabular-nums text-[11px] ${r.avgCostVsLastPct != null && Math.abs(r.avgCostVsLastPct) > 25 ? "text-destructive" : "text-muted-foreground"}`}
                >
                  {r.avgCostVsLastPct != null
                    ? `${r.avgCostVsLastPct > 0 ? "+" : ""}${r.avgCostVsLastPct.toFixed(1)}%`
                    : "—"}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums text-[11px] text-muted-foreground">
                  {r.timesUsedInBoms}
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={`text-[10px] ${getToneClass(r.flag)}`}
                  >
                    {r.flag.replace(/_/g, " ")}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile: cards por MP */}
      <div className="space-y-2 md:hidden">
        {rows.map((r) => (
          <div
            key={r.productId}
            className="rounded-md border bg-background p-3 text-xs"
          >
            <div className="mb-2 flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="font-mono text-sm font-medium">
                  {r.productRef ?? (
                    <span className="italic text-muted-foreground">sin_ref</span>
                  )}
                </div>
                {r.productName && (
                  <div className="truncate text-[11px] text-muted-foreground">
                    {r.productName}
                  </div>
                )}
                {r.category && (
                  <div className="truncate text-[10px] text-muted-foreground/70">
                    {r.category}
                  </div>
                )}
              </div>
              <Badge
                variant="outline"
                className={`shrink-0 text-[10px] ${getToneClass(r.flag)}`}
              >
                {r.flag.replace(/_/g, " ")}
              </Badge>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 tabular-nums">
              <span className="text-muted-foreground">avg_cost</span>
              <span className="text-right font-medium">
                {r.avgCostMxn != null && r.avgCostMxn > 0
                  ? `$${r.avgCostMxn.toFixed(2)} / ${r.uom ?? ""}`
                  : "—"}
              </span>
              <span className="text-muted-foreground">Última compra</span>
              <span className="text-right">
                {r.lastPurchaseDate ? (
                  <>
                    {r.lastPurchasePrice != null
                      ? `$${r.lastPurchasePrice.toFixed(2)}`
                      : "—"}
                    <span className="ml-1 text-[10px] text-muted-foreground">
                      {r.daysSincePurchase != null
                        ? `(${r.daysSincePurchase}d)`
                        : ""}
                    </span>
                  </>
                ) : (
                  <span className="text-muted-foreground">nunca</span>
                )}
              </span>
              {r.avgCostVsLastPct != null && (
                <>
                  <span className="text-muted-foreground">Desvío vs última</span>
                  <span
                    className={`text-right ${Math.abs(r.avgCostVsLastPct) > 25 ? "text-destructive" : "text-muted-foreground"}`}
                  >
                    {r.avgCostVsLastPct > 0 ? "+" : ""}
                    {r.avgCostVsLastPct.toFixed(1)}%
                  </span>
                </>
              )}
              <span className="text-muted-foreground">Uso en BOMs</span>
              <span className="text-right text-muted-foreground">
                {r.timesUsedInBoms}
              </span>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
