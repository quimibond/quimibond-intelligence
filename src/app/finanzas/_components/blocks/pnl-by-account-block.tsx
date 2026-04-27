import { FileX, Inbox } from "lucide-react";
import {
  QuestionSection,
  Currency,
  EmptyState,
} from "@/components/patterns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrencyMXN } from "@/lib/formatters";
import { getPnlByAccount } from "@/lib/queries/sp13/finanzas";
import type { HistoryRange } from "@/components/patterns/history-range";

export async function PnlByAccountBlock({ range }: { range: HistoryRange }) {
  const data = await getPnlByAccount(range, 20);
  const incomeRows = data.rows.filter((r) => r.bucket === "income");
  const expenseRows = data.rows.filter((r) => r.bucket === "expense");

  return (
    <QuestionSection
      id="pnl-by-account"
      question="¿En qué cuentas se me va el dinero?"
      subtext={`Top 20 cuentas con movimiento · ${data.periodLabel} (${data.monthsCovered} mes${data.monthsCovered === 1 ? "" : "es"})`}
      collapsible
      defaultOpen={false}
    >
      {data.rows.length === 0 ? (
        <EmptyState
          icon={FileX}
          title="Sin movimiento contable en el período"
          description="Ajusta el rango o revisa la sincronización de cuentas."
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          <PnlAccountTable
            title="Top ingresos"
            rows={incomeRows}
            total={data.totalIncomeMxn}
            tone="success"
          />
          <PnlAccountTable
            title="Top gastos / costos"
            rows={expenseRows}
            total={data.totalExpenseMxn}
            tone="warning"
          />
        </div>
      )}
    </QuestionSection>
  );
}

function PnlAccountTable({
  title,
  rows,
  total,
  tone,
}: {
  title: string;
  rows: Array<{
    accountCode: string;
    accountName: string;
    accountType: string | null;
    balanceMxn: number;
  }>;
  total: number;
  tone: "success" | "warning";
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-sm">{title}</CardTitle>
        <span
          className={`text-xs font-semibold tabular-nums ${
            tone === "success" ? "text-success" : "text-warning"
          }`}
        >
          {formatCurrencyMXN(total, { compact: true })}
        </span>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        {rows.length === 0 ? (
          <div className="px-4 py-6">
            <EmptyState compact icon={Inbox} title="Sin movimiento" />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cuenta</TableHead>
                <TableHead className="text-right">Saldo MXN</TableHead>
                <TableHead className="text-right">% del total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const pct = total > 0 ? (r.balanceMxn / total) * 100 : 0;
                return (
                  <TableRow key={r.accountCode}>
                    <TableCell>
                      <div className="font-mono text-[11px] text-muted-foreground">
                        {r.accountCode}
                      </div>
                      <div className="text-sm">{r.accountName}</div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <Currency amount={r.balanceMxn} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {pct.toFixed(1)}%
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
