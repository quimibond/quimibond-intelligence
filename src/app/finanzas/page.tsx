import { Suspense } from "react";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Banknote,
  Landmark,
  Scale,
} from "lucide-react";

import {
  KpiCard,
  StatGrid,
  PageHeader,
  DataTable,
  MobileCard,
  Currency,
  EmptyState,
  type DataTableColumn,
} from "@/components/shared/v2";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getBankBalances,
  getCashflowProjection,
  getFinanceKpis,
  type BankBalance,
  type CashflowPoint,
} from "@/lib/queries/finance";

export const dynamic = "force-dynamic";
export const metadata = { title: "Finanzas" };

export default function FinanzasPage() {
  return (
    <div className="space-y-4 pb-24 md:pb-6">
      <PageHeader
        title="Finanzas"
        subtitle="Caja, AR/AP y proyección de cashflow"
      />

      <Suspense
        fallback={
          <StatGrid columns={{ mobile: 2, tablet: 5, desktop: 5 }}>
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-[96px] rounded-xl" />
            ))}
          </StatGrid>
        }
      >
        <FinanceKpisSection />
      </Suspense>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Bancos</CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <Suspense fallback={<Skeleton className="h-[300px] rounded-xl" />}>
              <BanksTable />
            </Suspense>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Proyección de cashflow</CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <Suspense fallback={<Skeleton className="h-[300px] rounded-xl" />}>
              <CashflowTable />
            </Suspense>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

async function FinanceKpisSection() {
  const k = await getFinanceKpis();
  return (
    <StatGrid columns={{ mobile: 2, tablet: 5, desktop: 5 }}>
      <KpiCard
        title="Cash MXN"
        value={k.cashMxn}
        format="currency"
        compact
        icon={Banknote}
        tone="info"
      />
      <KpiCard
        title="Cash USD"
        value={k.cashUsdConverted}
        format="currency"
        compact
        icon={Landmark}
      />
      <KpiCard
        title="AR"
        value={k.arTotal}
        format="currency"
        compact
        icon={ArrowUpCircle}
        subtitle="por cobrar"
      />
      <KpiCard
        title="AP"
        value={k.apTotal}
        format="currency"
        compact
        icon={ArrowDownCircle}
        subtitle="por pagar"
      />
      <KpiCard
        title="Posición neta"
        value={k.netPosition}
        format="currency"
        compact
        icon={Scale}
        tone={k.netPosition >= 0 ? "success" : "danger"}
      />
    </StatGrid>
  );
}

const bankColumns: DataTableColumn<BankBalance>[] = [
  {
    key: "name",
    header: "Banco",
    cell: (r) => r.name ?? "—",
  },
  {
    key: "company",
    header: "Empresa",
    cell: (r) => r.company_name ?? "—",
    hideOnMobile: true,
  },
  {
    key: "currency",
    header: "Moneda",
    cell: (r) => (
      <span className="font-mono text-xs">{r.currency ?? "—"}</span>
    ),
  },
  {
    key: "balance",
    header: "Saldo",
    cell: (r) => <Currency amount={r.current_balance} />,
    align: "right",
  },
];

async function BanksTable() {
  const rows = await getBankBalances();
  if (!rows || rows.length === 0) {
    return (
      <EmptyState
        icon={Banknote}
        title="Sin cuentas bancarias"
        description="No hay saldos bancarios registrados."
        compact
      />
    );
  }
  return (
    <DataTable
      data={rows}
      columns={bankColumns}
      rowKey={(r, i) => `${r.name ?? "bank"}-${i}`}
      mobileCard={(r) => (
        <MobileCard
          title={r.name ?? "—"}
          subtitle={r.company_name ?? undefined}
          fields={[
            { label: "Moneda", value: r.currency ?? "—" },
            { label: "Saldo", value: <Currency amount={r.current_balance} /> },
          ]}
        />
      )}
    />
  );
}

const cfColumns: DataTableColumn<CashflowPoint>[] = [
  {
    key: "period",
    header: "Periodo",
    cell: (r) => r.period ?? "—",
  },
  {
    key: "type",
    header: "Tipo",
    cell: (r) =>
      r.flow_type === "inflow"
        ? "Entrada"
        : r.flow_type === "outflow"
          ? "Salida"
          : (r.flow_type ?? "—"),
  },
  {
    key: "gross",
    header: "Bruto",
    cell: (r) => <Currency amount={r.gross_amount} />,
    align: "right",
    hideOnMobile: true,
  },
  {
    key: "net",
    header: "Neto",
    cell: (r) => <Currency amount={r.net_amount} />,
    align: "right",
  },
  {
    key: "prob",
    header: "Prob",
    cell: (r) =>
      r.probability != null
        ? `${(Number(r.probability) * 100).toFixed(0)}%`
        : "—",
    hideOnMobile: true,
  },
];

async function CashflowTable() {
  const rows = await getCashflowProjection();
  if (!rows || rows.length === 0) {
    return (
      <EmptyState
        icon={Scale}
        title="Sin proyección"
        description="No hay datos de cashflow_projection."
        compact
      />
    );
  }
  return (
    <DataTable
      data={rows}
      columns={cfColumns}
      rowKey={(r, i) => `${r.period}-${r.flow_type}-${i}`}
      mobileCard={(r) => (
        <MobileCard
          title={r.period ?? "—"}
          subtitle={
            r.flow_type === "inflow"
              ? "Entrada"
              : r.flow_type === "outflow"
                ? "Salida"
                : (r.flow_type ?? "—")
          }
          fields={[
            { label: "Bruto", value: <Currency amount={r.gross_amount} /> },
            { label: "Neto", value: <Currency amount={r.net_amount} /> },
          ]}
        />
      )}
    />
  );
}
