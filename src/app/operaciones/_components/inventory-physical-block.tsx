import { Boxes, AlertTriangle, FileX, Inbox } from "lucide-react";
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
  getInventoryAdjustmentsPhysical,
  PHYSICAL_SUBCAT_LABEL,
  type InventoryAdjPhysicalMonthlyRow,
  type InventoryAdjTopProduct,
  type AdjPhysicalSubcategory,
} from "@/lib/queries/sp13/finanzas";
import type { HistoryRange } from "@/components/patterns/history-range";

const PERIOD_LABELS: Record<string, string> = {
  "01": "ene",
  "02": "feb",
  "03": "mar",
  "04": "abr",
  "05": "may",
  "06": "jun",
  "07": "jul",
  "08": "ago",
  "09": "sep",
  "10": "oct",
  "11": "nov",
  "12": "dic",
};

function formatPeriod(p: string) {
  const [y, m] = p.split("-");
  return `${PERIOD_LABELS[m] ?? m} ${y?.slice(2) ?? ""}`;
}

/**
 * Lente FÍSICA de los ajustes de inventario (vs lente contable en
 * /contabilidad). Las mismas líneas de odoo_account_entries_stock pero
 * categorizadas por reference del stock_move asociado:
 *
 *   physical_count       → conteo físico (Physical Inventory)
 *   manual_edit          → "Cantidad de producto actualizada (USER)"
 *   scrap                → SP/<n> pickings
 *   lot_transfer         → "Número de serie/lote trasladado"
 *   reclassification     → TL/ENC/* pickings entre warehouses
 *   manufacturing_*      → flujo MO (consume MP / FG recibido)
 *   unlinked             → asiento manual sin stock_move (alerta!)
 *
 * Default: últimos 12 meses, cuenta 501.01.02. La lente contable equivalente
 * vive en /contabilidad → Detalle → "Ajustes de inventario".
 */
export async function InventoryPhysicalBlock({
  range,
}: {
  range?: HistoryRange;
}) {
  const data = await getInventoryAdjustmentsPhysical(range ?? "ltm");

  const periods = [...new Set(data.monthly.map((r) => r.period))].sort();

  // Aggregate by physical_subcategory across the full period
  const bySubcat = (() => {
    const m = new Map<
      AdjPhysicalSubcategory,
      { net: number; lines: number; products: number }
    >();
    for (const r of data.monthly) {
      const cur = m.get(r.physicalSubcategory) ?? {
        net: 0,
        lines: 0,
        products: 0,
      };
      cur.net += r.net;
      cur.lines += r.lineCount;
      cur.products = Math.max(cur.products, r.productCount);
      m.set(r.physicalSubcategory, cur);
    }
    return [...m.entries()]
      .map(([k, v]) => ({ subcategory: k, ...v }))
      .sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  })();

  const totalNet = bySubcat.reduce((s, r) => s + r.net, 0);
  const unlinkedRow = bySubcat.find((r) => r.subcategory === "unlinked");
  const unlinkedNet = unlinkedRow?.net ?? 0;
  const unlinkedShare =
    Math.abs(totalNet) > 0 ? (unlinkedNet / totalNet) * 100 : 0;

  // Last month aggregates per subcategory
  const lastPeriod = periods.at(-1) ?? null;
  const lastMonthBySubcat = (() => {
    if (!lastPeriod) return [] as Array<{
      subcategory: AdjPhysicalSubcategory;
      net: number;
      lineCount: number;
    }>;
    const m = new Map<AdjPhysicalSubcategory, { net: number; lineCount: number }>();
    for (const r of data.monthly) {
      if (r.period !== lastPeriod) continue;
      const cur = m.get(r.physicalSubcategory) ?? { net: 0, lineCount: 0 };
      cur.net += r.net;
      cur.lineCount += r.lineCount;
      m.set(r.physicalSubcategory, cur);
    }
    return [...m.entries()]
      .map(([k, v]) => ({ subcategory: k, ...v }))
      .sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  })();

  const totalLines = bySubcat.reduce((s, r) => s + r.lines, 0);
  const scrapNet = bySubcat.find((r) => r.subcategory === "scrap")?.net ?? 0;
  const physicalCountNet =
    bySubcat.find((r) => r.subcategory === "physical_count")?.net ?? 0;

  return (
    <QuestionSection
      id="inventory-physical"
      question="¿De dónde vienen las mermas y ajustes de inventario?"
      subtext={`Últ. 12 meses · cuenta ${data.focusedAccountCodes.join(", ")} · vista física (lente contable en /contabilidad)`}
      collapsible
      defaultOpen={false}
    >
      <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 4 }}>
        <KpiCard
          title="Net del período"
          value={totalNet}
          format="currency"
          icon={Boxes}
          source="canonical"
          tone={totalNet > 5_000_000 ? "warning" : "info"}
          subtitle={`${totalLines.toLocaleString("es-MX")} líneas`}
        />
        <KpiCard
          title="Conteo físico"
          value={physicalCountNet}
          format="currency"
          icon={Boxes}
          source="canonical"
          tone="warning"
          subtitle="Shrinkage detectado en cuentas físicas"
        />
        <KpiCard
          title="Scrap"
          value={scrapNet}
          format="currency"
          icon={AlertTriangle}
          source="canonical"
          tone="warning"
          subtitle="Mermas SP/<n>"
        />
        <KpiCard
          title="Asientos manuales sin stock_move"
          value={unlinkedNet}
          format="currency"
          icon={AlertTriangle}
          source="canonical"
          tone={unlinkedNet > 1_000_000 ? "danger" : "info"}
          subtitle={
            unlinkedShare !== 0
              ? `${unlinkedShare.toFixed(1)}% del net — sin atribución a producto`
              : "Sin asientos no atribuidos"
          }
        />
      </StatGrid>

      {data.monthly.length === 0 ? (
        <EmptyState
          icon={FileX}
          title="Sin movimiento en el período"
          description="Sin ajustes de inventario en los últimos 12 meses para la cuenta seleccionada."
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          <SubcategoryBreakdownCard rows={bySubcat} totalNet={totalNet} />
          <LastMonthCard
            rows={lastMonthBySubcat}
            label={lastPeriod ? formatPeriod(lastPeriod) : "—"}
          />
        </div>
      )}

      <MonthlyTrendCard rows={data.monthly} periods={periods} />

      <TopProductsCard rows={data.topProducts} />
    </QuestionSection>
  );
}

/* ── Subcategory aggregate (full period) ────────────────────────────────── */

function SubcategoryBreakdownCard({
  rows,
  totalNet,
}: {
  rows: Array<{
    subcategory: AdjPhysicalSubcategory;
    net: number;
    lines: number;
    products: number;
  }>;
  totalNet: number;
}) {
  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="text-sm font-medium">
          Por tipo de ajuste (período total)
        </div>
        <span className="text-xs font-semibold tabular-nums text-warning">
          {formatCurrencyMXN(totalNet, { compact: true })}
        </span>
      </div>
      {rows.length === 0 ? (
        <div className="px-4 py-6">
          <EmptyState compact icon={Inbox} title="Sin tipos" />
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tipo</TableHead>
              <TableHead className="text-right">Net</TableHead>
              <TableHead className="text-right">% del net</TableHead>
              <TableHead className="text-right">Líneas</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const pct =
                Math.abs(totalNet) > 0 ? (r.net / totalNet) * 100 : 0;
              const isAlert = r.subcategory === "unlinked";
              return (
                <TableRow key={r.subcategory}>
                  <TableCell className="text-sm">
                    <span className="flex items-center gap-2">
                      {PHYSICAL_SUBCAT_LABEL[r.subcategory] ?? r.subcategory}
                      {isAlert && (
                        <Badge
                          variant="outline"
                          className="border-destructive/40 bg-destructive/10 text-[10px] text-destructive"
                        >
                          alerta
                        </Badge>
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <Currency amount={r.net} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {pct.toFixed(1)}%
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {r.lines.toLocaleString("es-MX")}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

/* ── Latest month detail ────────────────────────────────────────────────── */

function LastMonthCard({
  rows,
  label,
}: {
  rows: Array<{
    subcategory: AdjPhysicalSubcategory;
    net: number;
    lineCount: number;
  }>;
  label: string;
}) {
  const total = rows.reduce((s, r) => s + r.net, 0);
  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="text-sm font-medium">Último mes · {label}</div>
        <span className="text-xs font-semibold tabular-nums text-warning">
          {formatCurrencyMXN(total, { compact: true })}
        </span>
      </div>
      {rows.length === 0 ? (
        <div className="px-4 py-6">
          <EmptyState compact icon={Inbox} title="Sin movimiento" />
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tipo</TableHead>
              <TableHead className="text-right">Net</TableHead>
              <TableHead className="text-right">Líneas</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.subcategory}>
                <TableCell className="text-sm">
                  {PHYSICAL_SUBCAT_LABEL[r.subcategory] ?? r.subcategory}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  <Currency amount={r.net} />
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {r.lineCount.toLocaleString("es-MX")}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

/* ── Monthly trend (stacked bar inline) ─────────────────────────────────── */

function MonthlyTrendCard({
  rows,
  periods,
}: {
  rows: InventoryAdjPhysicalMonthlyRow[];
  periods: string[];
}) {
  // Aggregate (period → net)
  const monthlyTotals = periods.map((p) => {
    let net = 0;
    for (const r of rows) {
      if (r.period === p) net += r.net;
    }
    return { period: p, net };
  });
  const maxAbs = Math.max(...monthlyTotals.map((m) => Math.abs(m.net)), 1);

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div className="text-sm font-medium">Tendencia mensual</div>
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
                        positive ? "bg-warning/40" : "bg-success/40"
                      }`}
                      style={{
                        width: `${widthPct}%`,
                        left: positive ? "0" : `${100 - widthPct}%`,
                      }}
                    />
                  </div>
                  <span
                    className={`text-right font-mono tabular-nums ${
                      positive ? "text-warning" : "text-success"
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

/* ── Top SKUs ───────────────────────────────────────────────────────────── */

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

  const getToneClass = (tone: "info" | "warning" | "danger" | "success") =>
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
          Top {rows.length} productos con merma del período
        </div>
        <span className="text-xs text-muted-foreground">ordenados por net Dr</span>
      </div>
      <div className="-mx-0 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Producto</TableHead>
              <TableHead>Tipo dominante</TableHead>
              <TableHead className="text-right">Net Dr</TableHead>
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
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {r.productRef ?? <span className="italic">sin_ref</span>}
                    </span>
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
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {r.lineCount.toLocaleString("es-MX")}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
