import { Suspense } from "react";
import {
  AlertTriangle,
  Database,
  FileWarning,
  Users,
  TrendingDown,
} from "lucide-react";

import {
  PageLayout,
  PageHeader,
  KpiCard,
  StatGrid,
  DataTable,
  TableExportButton,
  EmptyState,
  type DataTableColumn,
} from "@/components/patterns";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

import {
  getOdooFixes,
  summarizeOdooFixes,
  INSIGHT_TYPE_LABEL,
  type OdooFixRow,
  type OdooFixSeverity,
} from "@/lib/queries/datos/odoo-fixes";

export const revalidate = 60;
export const metadata = { title: "Datos · Cosas a arreglar en Odoo" };

const severityVariant: Record<
  OdooFixSeverity,
  "danger" | "warning" | "info" | "secondary"
> = {
  critical: "danger",
  high: "danger",
  medium: "warning",
  low: "info",
};

const severityLabel: Record<OdooFixSeverity, string> = {
  critical: "Crítico",
  high: "Alto",
  medium: "Medio",
  low: "Bajo",
};

function formatMxn(value: number | null | undefined): string {
  if (value == null || value === 0) return "—";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${Math.round(value)}`;
}

function detailFromEvidence(row: OdooFixRow): string {
  const ev = row.evidence ?? {};
  if (row.insight_type === "odoo_sat_invoice_drift") {
    const count = ev.open_count;
    const inv = ev.invariant_key;
    return `${count ?? "?"} issues · ${inv ?? "—"}`;
  }
  if (row.insight_type === "odoo_duplicate_partner_rfc") {
    const rfc = ev.rfc;
    const dup = ev.dup_count;
    return `RFC ${rfc} × ${dup}`;
  }
  if (row.insight_type === "odoo_partner_no_canonical") {
    const pid = ev.odoo_partner_id;
    const pmts = ev.payment_count;
    return `partner #${pid} · ${pmts} pagos`;
  }
  if (row.insight_type === "odoo_foreign_tax_id_in_rfc") {
    const pid = ev.odoo_partner_id;
    const rfc = ev.invalid_rfc;
    return `partner #${pid} · ${rfc}`;
  }
  if (
    row.insight_type === "mdm_contacts_duplicates" ||
    row.insight_type === "mdm_products_duplicates"
  ) {
    const groups = ev.groups;
    const total = ev.total_rows;
    return `${groups ?? "?"} grupos · ${total ?? "?"} rows`;
  }
  return "";
}

const columns: DataTableColumn<OdooFixRow>[] = [
  {
    key: "severity",
    header: "Severidad",
    sortable: false,
    cell: (r) => (
      <Badge variant={severityVariant[r.severity] ?? "secondary"}>
        {severityLabel[r.severity] ?? r.severity}
      </Badge>
    ),
  },
  {
    key: "category",
    header: "Tipo",
    cell: (r) => (
      <Badge variant="secondary" className="text-[10px]">
        {INSIGHT_TYPE_LABEL[r.insight_type] ?? r.insight_type}
      </Badge>
    ),
    hideOnMobile: true,
  },
  {
    key: "title",
    header: "Problema",
    alwaysVisible: true,
    cell: (r) => (
      <div className="min-w-0">
        <div className="font-medium leading-tight">{r.title}</div>
        <div className="text-xs text-muted-foreground line-clamp-2">
          {r.description}
        </div>
      </div>
    ),
    className: "min-w-[280px]",
  },
  {
    key: "detail",
    header: "Detalle",
    cell: (r) => (
      <span className="text-xs text-muted-foreground tabular-nums">
        {detailFromEvidence(r)}
      </span>
    ),
    hideOnMobile: true,
  },
  {
    key: "impact",
    header: "Impacto MXN",
    align: "right",
    cell: (r) => (
      <span className="font-semibold tabular-nums">
        {formatMxn(r.business_impact_estimate)}
      </span>
    ),
  },
  {
    key: "recommendation",
    header: "Acción en Odoo",
    cell: (r) => (
      <span className="text-xs text-muted-foreground line-clamp-3">
        {r.recommendation}
      </span>
    ),
    className: "min-w-[300px]",
    hideOnMobile: true,
  },
];

export default async function DatosPage() {
  return (
    <PageLayout>
      <PageHeader
        title="Datos · Cosas a arreglar en Odoo"
        subtitle="Problemas detectados en res.partner + drift Odoo↔SAT. Cada fila es una acción concreta — click para ver desglose."
      />

      <Suspense
        fallback={
          <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 4 }}>
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[96px] rounded-xl" />
            ))}
          </StatGrid>
        }
      >
        <DatosKpis />
      </Suspense>

      <Suspense
        fallback={
          <Card>
            <CardContent className="p-6">
              <div className="space-y-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 rounded" />
                ))}
              </div>
            </CardContent>
          </Card>
        }
      >
        <DatosTable />
      </Suspense>
    </PageLayout>
  );
}

async function DatosKpis() {
  const rows = await getOdooFixes();
  const s = summarizeOdooFixes(rows);
  return (
    <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 4 }}>
      <KpiCard
        title="Total a arreglar"
        value={s.total}
        format="number"
        icon={Database}
      />
      <KpiCard
        title="Severity alta/crítica"
        value={s.bySeverity.critical + s.bySeverity.high}
        format="number"
        icon={AlertTriangle}
        tone={s.bySeverity.high + s.bySeverity.critical > 0 ? "danger" : "success"}
      />
      <KpiCard
        title="Drift Odoo↔SAT"
        value={s.byCategory.odoo_sat_invoice_drift}
        format="number"
        icon={FileWarning}
        subtitle="invariantes con issues"
      />
      <KpiCard
        title="Impacto total"
        value={Math.round(s.totalImpactMxn)}
        format="currency"
        icon={TrendingDown}
        tone={s.totalImpactMxn > 1_000_000 ? "warning" : "default"}
      />
    </StatGrid>
  );
}

async function DatosTable() {
  const rows = await getOdooFixes();

  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="p-12">
          <EmptyState
            icon={Users}
            title="Todo limpio"
            description="No hay problemas detectados en Odoo. Los crons corren diariamente — vuelve mañana."
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-table-export-root>
      <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
        <CardTitle className="text-base">
          {rows.length} problemas detectados
        </CardTitle>
        <TableExportButton filename="odoo-fixes" />
      </CardHeader>
      <CardContent>
        <DataTable
          data={rows}
          columns={columns}
          rowKey={(r) => r.id}
          rowHref={(r) => `/datos/${r.id}`}
          stickyHeader
          density="normal"
        />
      </CardContent>
    </Card>
  );
}
