import { AlertTriangle, FileX, Receipt, Scale } from "lucide-react";
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
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { formatCurrencyMXN } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import {
  getInvoiceDiscrepancies,
  periodBoundsForRange,
  type DiscrepancyCategory,
  type DiscrepancyInvoice,
} from "@/lib/queries/sp13/finanzas";
import type { HistoryRange } from "@/components/patterns/history-range";

/* ── F-DISC Discrepancias Odoo ↔ SAT ─────────────────────────────────── */
export async function InvoiceDiscrepanciesBlock({ range }: { range: HistoryRange }) {
  const disc = await getInvoiceDiscrepancies(range);
  const periodLabel = periodBoundsForRange(range).label;
  const fmt = (n: number) => formatCurrencyMXN(n, { compact: true });

  if (disc.totalCount === 0) {
    return (
      <QuestionSection
        id="discrepancies"
        question="¿Hay diferencias entre Odoo y SAT?"
        subtext={`Cero discrepancias detectadas en ${periodLabel}. Las facturas en Odoo cuadran con los CFDI en SAT.`}
      >
        <EmptyState
          icon={Scale}
          title="Sin discrepancias"
          description="Odoo y SAT están sincronizados al 100%."
        />
      </QuestionSection>
    );
  }

  const apReceived = disc.categories.filter((c) => c.direction === "received");
  const arIssued = disc.categories.filter((c) => c.direction === "issued");
  const criticalCats = disc.categories.filter((c) => c.severity === "critical");

  return (
    <QuestionSection
      id="discrepancies"
      question="¿Hay diferencias entre Odoo y SAT?"
      subtext={`${disc.totalCount} facturas con desfase entre ERP y libro fiscal · ${periodLabel}.
        Lo más común: pagos registrados en SAT (vía complemento) que el equipo
        no marcó como pagados en Odoo.`}
      collapsible
      defaultOpen={false}
    >
      <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 4 }}>
        <KpiCard
          title="Facturas con desfase"
          value={disc.totalCount}
          format="number"
          icon={FileX}
          source="canonical"
          tone={disc.totalCount > 50 ? "warning" : "default"}
          subtitle={`${apReceived.reduce((s, c) => s + c.count, 0)} AP · ${arIssued.reduce((s, c) => s + c.count, 0)} AR`}
        />
        <KpiCard
          title="Monto AP afectado"
          value={disc.affectedApMxn}
          format="currency"
          compact
          icon={Receipt}
          source="canonical"
          tone="warning"
          subtitle="proveedores"
        />
        <KpiCard
          title="Monto AR afectado"
          value={disc.affectedArMxn}
          format="currency"
          compact
          icon={Receipt}
          source="canonical"
          tone="warning"
          subtitle="clientes"
        />
        <KpiCard
          title="Críticas"
          value={criticalCats.reduce((s, c) => s + c.count, 0)}
          format="number"
          icon={AlertTriangle}
          source="canonical"
          tone={criticalCats.length > 0 ? "danger" : "default"}
          subtitle={
            criticalCats.length > 0
              ? `${fmt(criticalCats.reduce((s, c) => s + c.totalMxn, 0))}`
              : "ninguna"
          }
        />
      </StatGrid>

      <Accordion type="multiple" className="space-y-2">
        {disc.categories.map((cat) => (
          <AccordionItem
            key={`${cat.kind}-${cat.direction}`}
            value={`${cat.kind}-${cat.direction}`}
            className="overflow-hidden rounded-md border bg-card"
          >
            <AccordionTrigger className="px-3 py-2 hover:no-underline sm:px-4">
              <div className="flex flex-1 items-center gap-3 text-left">
                <span
                  className={cn(
                    "inline-flex shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                    cat.direction === "received"
                      ? "bg-warning/10 text-warning border-warning/30"
                      : "bg-primary/10 text-primary border-primary/30"
                  )}
                >
                  {cat.direction === "received" ? "AP" : "AR"}
                </span>
                <span
                  className={cn(
                    "inline-flex shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
                    cat.severity === "critical"
                      ? "bg-destructive/10 text-destructive border-destructive/30"
                      : cat.severity === "warning"
                        ? "bg-warning/10 text-warning border-warning/30"
                        : "bg-muted text-muted-foreground border-muted-foreground/20"
                  )}
                >
                  {cat.severity === "critical"
                    ? "Crítica"
                    : cat.severity === "warning"
                      ? "Atención"
                      : "Info"}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{cat.label}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {cat.count} facturas
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-sm font-semibold tabular-nums">
                    {fmt(cat.totalMxn)}
                  </div>
                </div>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-3 pb-3 sm:px-4">
              <div className="mb-3 rounded-md border border-warning/20 bg-warning/5 px-3 py-2 text-xs">
                <span className="font-semibold">Acción: </span>
                {cat.recommendedAction}
              </div>
              <DiscrepancyInvoiceTable invoices={cat.topInvoices} kind={cat.kind} />
              {cat.count > cat.topInvoices.length && (
                <div className="mt-2 text-[11px] text-muted-foreground">
                  Mostrando top {cat.topInvoices.length} de {cat.count} facturas.
                </div>
              )}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </QuestionSection>
  );
}

function DiscrepancyInvoiceTable({
  invoices,
  kind,
}: {
  invoices: DiscrepancyInvoice[];
  kind: DiscrepancyCategory["kind"];
}) {
  const fmt = (n: number) => formatCurrencyMXN(n, { compact: true });
  const showResids = kind === "amount_mismatch" || kind === "odoo_open_sat_paid" || kind === "odoo_paid_sat_open";

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Factura</TableHead>
          <TableHead>Contraparte</TableHead>
          <TableHead className="text-right">Monto MXN</TableHead>
          {showResids && <TableHead className="text-right">Odoo</TableHead>}
          {showResids && <TableHead className="text-right">SAT</TableHead>}
          <TableHead className="text-right">Días</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {invoices.map((inv) => (
          <TableRow key={inv.canonicalId}>
            <TableCell className="font-mono text-xs">
              {inv.invoiceName ?? inv.canonicalId.slice(0, 24)}
            </TableCell>
            <TableCell className="max-w-[200px] truncate text-xs">
              {inv.partnerName ?? "—"}
            </TableCell>
            <TableCell className="text-right text-sm font-medium tabular-nums">
              {fmt(inv.amountResidualMxn)}
            </TableCell>
            {showResids && (
              <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                {inv.amountResidualOdoo == null
                  ? "—"
                  : inv.amountResidualOdoo.toFixed(0)}
              </TableCell>
            )}
            {showResids && (
              <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                {inv.amountResidualSat == null
                  ? "—"
                  : inv.amountResidualSat.toFixed(0)}
              </TableCell>
            )}
            <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
              {inv.daysOpen ?? "—"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
