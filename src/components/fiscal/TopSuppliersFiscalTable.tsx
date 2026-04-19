import { type TopSupplierFiscalRow } from "@/lib/queries/fiscal-historical";
import { formatCurrencyMXN } from "@/lib/formatters";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function YoYBadge({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-muted-foreground">—</span>;
  const isPos = pct >= 0;
  return (
    <span
      className={`tabular-nums font-semibold ${
        isPos ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
      }`}
    >
      {isPos ? "+" : ""}
      {pct.toFixed(1)}%
    </span>
  );
}

interface Props {
  rows: TopSupplierFiscalRow[];
}

/**
 * Top suppliers fiscal lifetime table — reusable on /system and /companies/[id].
 * Pure client-data-driven component (caller fetches rows).
 */
export function TopSuppliersFiscalTable({ rows }: Props) {
  if (!rows.length) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Sin datos en syntage_top_suppliers_fiscal_lifetime.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Proveedor</TableHead>
            <TableHead className="text-right">Lifetime</TableHead>
            <TableHead className="text-right">12m</TableHead>
            <TableHead className="hidden text-right sm:table-cell">YoY</TableHead>
            <TableHead className="hidden text-right md:table-cell">Retenciones</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={r.rfc ?? i}>
              <TableCell>
                <div className="font-medium leading-tight">{r.name ?? "—"}</div>
                {r.rfc && (
                  <div className="font-mono text-[10px] text-muted-foreground">{r.rfc}</div>
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatCurrencyMXN(r.lifetime_spend_mxn, { compact: true })}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatCurrencyMXN(r.spend_12m_mxn, { compact: true })}
              </TableCell>
              <TableCell className="hidden text-right sm:table-cell">
                <YoYBadge pct={r.yoy_pct ?? null} />
              </TableCell>
              <TableCell className="hidden text-right tabular-nums text-muted-foreground md:table-cell">
                {r.retenciones_lifetime_mxn != null
                  ? formatCurrencyMXN(r.retenciones_lifetime_mxn, { compact: true })
                  : "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
