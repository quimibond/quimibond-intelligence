import { Inbox } from "lucide-react";

import {
  CompanyLink,
  Currency,
  DataTable,
  type DataTableColumn,
} from "@/components/patterns";
import { Badge } from "@/components/ui/badge";
import { getArByCompany, type ArByCompanyRow } from "@/lib/queries/sp13/cobranza";

import { ArByCompanyFilterBar } from "./ArByCompanyFilterBar";

interface Props {
  page: number;
  size: number;
  bucket?: string; // from ?bucket= — sync'd with AgingBuckets
  risk?: "critical";
  q?: string;
}

const RISK_LABEL: Record<string, string> = {
  critical: "Crítico",
  abnormal: "Alto",
  watch: "Vigilar",
  normal: "Normal",
};

const RISK_VARIANT: Record<string, "destructive" | "secondary" | "outline" | "default"> = {
  critical: "destructive",
  abnormal: "destructive",
  watch: "secondary",
  normal: "outline",
};

export async function ArByCompanyTable({ page, size, bucket, risk, q }: Props) {
  const data = await getArByCompany({
    page,
    size,
    q,
    sort: "total",
    sortDir: "desc",
    facets: {},
    bucket: bucket ? [bucket] : undefined,
    risk: risk ? [risk] : undefined,
  });

  const cols: DataTableColumn<ArByCompanyRow>[] = [
    {
      key: "company",
      header: "Cliente",
      cell: (r) =>
        r.companyId ? (
          <CompanyLink companyId={r.companyId} name={r.companyName ?? ""} />
        ) : (
          <span>{r.companyName ?? "—"}</span>
        ),
      className: "max-w-[220px]",
    },
    {
      key: "total",
      header: "AR total",
      align: "right",
      sortable: true,
      cell: (r) => <Currency amount={r.totalReceivable} />,
      summary: (rows) => (
        <Currency amount={rows.reduce((s, r) => s + r.totalReceivable, 0)} />
      ),
    },
    {
      key: "overdue",
      header: "AR vencido",
      align: "right",
      sortable: true,
      cell: (r) => (
        <Currency amount={r.overdueTotal} className={r.overdueTotal > 0 ? "text-warning" : ""} />
      ),
      summary: (rows) => (
        <Currency amount={rows.reduce((s, r) => s + r.overdueTotal, 0)} />
      ),
    },
    {
      key: "oldest",
      header: "Días más viejo",
      align: "right",
      sortable: true,
      hideOnMobile: true,
      cell: (r) => (
        <span className="tabular-nums">
          {r.oldestDays != null ? `${r.oldestDays}d` : "—"}
        </span>
      ),
    },
    {
      key: "risk",
      header: "Riesgo IA",
      hideOnMobile: true,
      cell: (r) =>
        r.risk ? (
          <Badge variant={RISK_VARIANT[r.risk] ?? "outline"} className="uppercase text-[10px]">
            {RISK_LABEL[r.risk] ?? r.risk}
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      key: "salesperson",
      header: "Vendedor",
      hideOnMobile: true,
      cell: (r) => (
        <span className="text-xs text-muted-foreground">
          {r.salespersonName ?? "—"}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <ArByCompanyFilterBar bucket={bucket} risk={risk ?? null} />
      <DataTable
        data={data.rows}
        columns={cols}
        rowKey={(r) => r.companyId}
        rowHref={(r) => (r.companyId ? `/empresas/${r.companyId}` : null)}
        emptyState={{
          icon: Inbox,
          title: "Sin cartera por cobrar",
          description: "Ningún cliente coincide con los filtros.",
        }}
        summaryLabel="Totales"
      />
      <p className="text-xs text-muted-foreground">
        Mostrando {data.rows.length} de {data.total}
      </p>
    </div>
  );
}
