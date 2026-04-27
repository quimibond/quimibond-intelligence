import { TrendingDown, AlertTriangle, FileX, Inbox } from "lucide-react";
import {
  QuestionSection,
  StatGrid,
  KpiCard,
  Currency,
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
import { Badge } from "@/components/ui/badge";
import { formatCurrencyMXN } from "@/lib/formatters";
import {
  getInventoryAdjustments,
  JOURNAL_CATEGORY_LABEL,
  PHYSICAL_SUBCAT_LABEL,
  type InventoryAdjMonthlyRow,
  type InventoryAdjTopProduct,
  type AdjJournalCategory,
} from "@/lib/queries/sp13/finanzas";
import type { HistoryRange } from "@/components/patterns/history-range";
import { formatPeriod } from "../utils";

/**
 * F-INV-ADJ — Ajustes de inventario (501.01.02 COSTO PRIMO).
 *
 * Cuadre validado al peso vs canonical_account_balances. Lente contable:
 * monthly time series por journal_category + tabla top SKUs del período
 * con su physical_subcategory dominante.
 *
 * Causa raíz documentada: el residual del año (501.01.02) absorbe
 * shrinkage físico, waste de máquina, variancia de manufactura. Concentra
 * fuertemente en Dec por conteo físico anual ($6.4M en Dec 2025).
 */
export async function InventoryAdjustmentsBlock({
  range,
}: {
  range: HistoryRange;
}) {
  const data = await getInventoryAdjustments(range);

  const periods = [...new Set(data.monthly.map((r) => r.period))].sort();
  const lastMonthNet = (() => {
    if (periods.length === 0) return 0;
    const last = periods[periods.length - 1];
    return data.monthly
      .filter((r) => r.period === last)
      .reduce((s, r) => s + r.net, 0);
  })();
  const lastMonthLabel = periods.length > 0 ? formatPeriod(periods[periods.length - 1]) : "—";

  // Net by journal_category for the focused account (typically 501.01.02)
  const byCategory = (() => {
    const m = new Map<AdjJournalCategory, { net: number; count: number }>();
    for (const r of data.monthly) {
      const cur = m.get(r.journalCategory) ?? { net: 0, count: 0 };
      cur.net += r.net;
      cur.count += r.lineCount;
      m.set(r.journalCategory, cur);
    }
    return [...m.entries()]
      .map(([k, v]) => ({ category: k, ...v }))
      .sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  })();

  const topJournalCat = byCategory[0]?.category ?? null;

  return (
    <QuestionSection
      id="inventory-adjustments"
      question="¿Qué ajustes contables están moviendo mi P&L?"
      subtext={
        `Cuenta ${data.focusedAccountCodes.join(", ")} · ${data.periodLabel} · ` +
        `cuadre al peso vs balances`
      }
      collapsible
      defaultOpen={false}
    >
      <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 4 }}>
        <KpiCard
          title="Net del período"
          value={data.focusedNetMxn}
          format="currency"
          icon={TrendingDown}
          source="canonical"
          tone={data.focusedNetMxn > 1_000_000 ? "warning" : "info"}
          subtitle={`Dr − Cr en ${data.focusedAccountCodes.join(", ")}`}
        />
        <KpiCard
          title="Último mes"
          value={lastMonthNet}
          format="currency"
          icon={TrendingDown}
          source="canonical"
          tone={Math.abs(lastMonthNet) > 5_000_000 ? "danger" : "info"}
          subtitle={lastMonthLabel}
        />
        <KpiCard
          title="Actividad bruta"
          value={data.focusedGrossMxn}
          format="currency"
          icon={AlertTriangle}
          source="canonical"
          tone="info"
          subtitle="Dr + Cr (totales abs)"
        />
        <KpiCard
          title="Categoría dominante"
          value={
            byCategory[0]
              ? Math.round((byCategory[0].net / (data.focusedNetMxn || 1)) * 100)
              : 0
          }
          format="number"
          icon={AlertTriangle}
          source="canonical"
          tone="info"
          subtitle={
            topJournalCat
              ? `${JOURNAL_CATEGORY_LABEL[topJournalCat]} · % del net`
              : "—"
          }
        />
      </StatGrid>

      {data.monthly.length === 0 ? (
        <EmptyState
          icon={FileX}
          title="Sin movimiento en el período"
          description="Ajusta el rango o revisa la sincronización de odoo_account_entries_stock."
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          <MonthlyByCategoryCard rows={data.monthly} periods={periods} />
          <CategoryBreakdownCard rows={byCategory} totalNet={data.focusedNetMxn} />
        </div>
      )}

      <TopProductsCard rows={data.topProducts} />
    </QuestionSection>
  );
}

/* ── Monthly stacked by journal_category ────────────────────────────────── */

function MonthlyByCategoryCard({
  rows,
  periods,
}: {
  rows: InventoryAdjMonthlyRow[];
  periods: string[];
}) {
  // Aggregate to (period, category) → net
  const byPeriod = new Map<string, Map<AdjJournalCategory, number>>();
  for (const r of rows) {
    if (!byPeriod.has(r.period)) byPeriod.set(r.period, new Map());
    const cat = byPeriod.get(r.period)!;
    cat.set(r.journalCategory, (cat.get(r.journalCategory) ?? 0) + r.net);
  }

  const monthlyTotals = periods.map((p) => {
    const cats = byPeriod.get(p) ?? new Map();
    let net = 0;
    for (const v of cats.values()) net += v;
    return { period: p, net, cats };
  });

  // Find max abs for bar scaling
  const maxAbs = Math.max(
    ...monthlyTotals.map((m) => Math.abs(m.net)),
    1
  );

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="text-sm font-medium">Mensual · net por mes</div>
        <span className="text-xs text-muted-foreground">
          {periods.length} mes{periods.length === 1 ? "" : "es"}
        </span>
      </div>
      <div className="px-4 py-3">
        {monthlyTotals.length === 0 ? (
          <EmptyState compact icon={Inbox} title="Sin movimiento" />
        ) : (
          <div className="space-y-1.5">
            {monthlyTotals.map((m) => {
              const widthPct = (Math.abs(m.net) / maxAbs) * 100;
              const positive = m.net >= 0;
              return (
                <div
                  key={m.period}
                  className="grid grid-cols-[64px_1fr_120px] items-center gap-2 text-xs"
                >
                  <span className="font-mono text-muted-foreground">
                    {formatPeriod(m.period)}
                  </span>
                  <div className="relative h-5 rounded-sm bg-muted/30">
                    <div
                      className={`absolute top-0 h-full rounded-sm ${
                        positive
                          ? "bg-warning/40"
                          : "bg-success/40"
                      }`}
                      style={{
                        width: `${widthPct}%`,
                        left: positive ? "0" : `${100 - widthPct}%`,
                      }}
                    />
                  </div>
                  <span
                    className={`text-right font-mono tabular-nums ${
                      positive
                        ? "text-warning"
                        : "text-success"
                    }`}
                  >
                    {formatCurrencyMXN(m.net, { compact: true })}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Category breakdown of the period ──────────────────────────────────── */

function CategoryBreakdownCard({
  rows,
  totalNet,
}: {
  rows: Array<{ category: AdjJournalCategory; net: number; count: number }>;
  totalNet: number;
}) {
  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="text-sm font-medium">
          Por ciclo contable (período total)
        </div>
        <span className="text-xs font-semibold tabular-nums text-warning">
          {formatCurrencyMXN(totalNet, { compact: true })}
        </span>
      </div>
      <div className="px-0">
        {rows.length === 0 ? (
          <div className="px-4 py-6">
            <EmptyState compact icon={Inbox} title="Sin categorías" />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ciclo</TableHead>
                <TableHead className="text-right">Net</TableHead>
                <TableHead className="text-right">% del net</TableHead>
                <TableHead className="text-right">Líneas</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const pct =
                  Math.abs(totalNet) > 0
                    ? (r.net / totalNet) * 100
                    : 0;
                return (
                  <TableRow key={r.category}>
                    <TableCell className="text-sm">
                      {JOURNAL_CATEGORY_LABEL[r.category] ?? r.category}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <Currency amount={r.net} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {pct.toFixed(1)}%
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {r.count.toLocaleString("es-MX")}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}

/* ── Top SKUs of the period ─────────────────────────────────────────────── */

function TopProductsCard({ rows }: { rows: InventoryAdjTopProduct[] }) {
  if (rows.length === 0) return null;

  const subcatTone = (
    sub: InventoryAdjTopProduct["topSubcategory"]
  ): "info" | "warning" | "danger" | "success" => {
    if (!sub) return "info";
    if (sub === "physical_count") return "warning";
    if (sub === "scrap" || sub === "manual_edit") return "danger";
    if (sub === "manufacturing_consume" || sub === "manufacturing_produce")
      return "info";
    if (sub === "purchase_in" || sub === "sale_out") return "success";
    return "info";
  };

  const getToneClass = (
    tone: "info" | "warning" | "danger" | "success"
  ) =>
    tone === "danger"
      ? "border-destructive/40 bg-destructive/10 text-destructive"
      : tone === "warning"
        ? "border-warning/40 bg-warning/10 text-warning"
        : tone === "success"
          ? "border-success/40 bg-success/10 text-success"
          : "border-muted/40 bg-muted/10 text-muted-foreground";

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="text-sm font-medium">
          Top {rows.length} productos del período
        </div>
        <span className="text-xs text-muted-foreground">
          ordenados por net Dr
        </span>
      </div>
      <div className="-mx-0 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Producto</TableHead>
              <TableHead>Subcategoría</TableHead>
              <TableHead className="text-right">Net Dr</TableHead>
              <TableHead className="text-right">Dr / Cr</TableHead>
              <TableHead className="text-right">Líneas</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => {
              const tone = subcatTone(r.topSubcategory);
              const subLabel = r.topSubcategory
                ? PHYSICAL_SUBCAT_LABEL[r.topSubcategory] ?? r.topSubcategory
                : "—";
              return (
                <TableRow
                  key={`${r.productRef ?? "null"}-${r.odooProductId ?? i}`}
                >
                  <TableCell>
                    <div className="font-mono text-[11px] text-muted-foreground">
                      {r.productRef ?? (
                        <span className="italic">sin_ref</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${getToneClass(tone)}`}
                    >
                      {subLabel}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <Currency amount={r.net} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-[11px] text-muted-foreground">
                    {formatCurrencyMXN(r.debit, { compact: true })}
                    {" / "}
                    {formatCurrencyMXN(r.credit, { compact: true })}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {r.lineCount.toLocaleString("es-MX")}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      {rows.length > 0 && (
        <div className="border-t bg-muted/20 px-4 py-2 text-[11px] text-muted-foreground">
          Subcategoría dominante por SKU. Vista física (scrap por máquina,
          conteos físicos por producto, edits manuales por usuario) en{" "}
          <span className="font-mono">/operaciones</span>.
        </div>
      )}
    </div>
  );
}
