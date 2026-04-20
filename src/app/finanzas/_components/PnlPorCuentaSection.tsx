import { Suspense } from "react";
import { Receipt } from "lucide-react";
import {
  EmptyState,
  Currency,
  LoadingTable,
} from "@/components/patterns";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataSourceBadge } from "@/components/ui/DataSourceBadge";
import { getPnlByAccount, getMostRecentPeriod } from "@/lib/queries/analytics/pnl";

// ──────────────────────────────────────────────────────────────────────────
// Inner async table (server component)
// ──────────────────────────────────────────────────────────────────────────
async function PnlByAccountTable() {
  const [rows, mostRecentPeriod] = await Promise.all([
    getPnlByAccount(),
    getMostRecentPeriod(),
  ]);

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Receipt}
        title="Sin balances del período"
        description="No hay datos aún para el período más reciente."
        compact
      />
    );
  }

  return (
    <div className="space-y-2">
      {mostRecentPeriod && (
        <p className="text-xs text-muted-foreground">
          Período: <span className="font-mono font-medium">{mostRecentPeriod}</span>
          {" · "}{rows.length} cuentas
        </p>
      )}
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24">Código</TableHead>
              <TableHead>Cuenta</TableHead>
              <TableHead className="hidden md:table-cell">Tipo</TableHead>
              <TableHead className="text-right">Debe</TableHead>
              <TableHead className="text-right">Haber</TableHead>
              <TableHead className="text-right">Neto</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={i}>
                <TableCell className="font-mono text-xs">{r.account_code ?? "—"}</TableCell>
                <TableCell className="text-sm">{r.account_name ?? "—"}</TableCell>
                <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                  {r.account_type ?? "—"}
                </TableCell>
                <TableCell className="text-right">
                  <Currency amount={r.debit} />
                </TableCell>
                <TableCell className="text-right">
                  <Currency amount={r.credit} />
                </TableCell>
                <TableCell
                  className={`text-right font-medium ${r.net < 0 ? "text-destructive" : ""}`}
                >
                  <Currency amount={r.net} colorBySign />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// PnlPorCuentaSection — exported section component
// ──────────────────────────────────────────────────────────────────────────
export function PnlPorCuentaSection() {
  return (
    <div id="pnl-cuenta" className="scroll-mt-24">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">P&amp;L por Cuenta</CardTitle>
            <p className="text-xs text-muted-foreground">
              Trial balance del período más reciente (odoo_account_balances).
            </p>
          </div>
          <DataSourceBadge source="odoo" refresh="1h" />
        </CardHeader>
        <CardContent className="pb-4">
          <Suspense fallback={<LoadingTable rows={10} columns={6} />}>
            <PnlByAccountTable />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}
