import { AlertTriangle } from "lucide-react";
import {
  QuestionSection,
  DataTable,
  CompanyLink,
  Currency,
  type DataTableColumn,
} from "@/components/patterns";
import { Badge } from "@/components/ui/badge";
import type {
  DriftingCompany,
  DriftDirection,
} from "@/lib/queries/sp13/empresas";

interface DriftingSectionProps {
  rows: DriftingCompany[];
}

const DRIFT_WARN_MXN = 5_000;

const directionLabel: Record<DriftDirection, string> = {
  me_perjudica: "Me perjudica",
  me_favorece: "Me favorece",
  neutral: "Neutral",
};

const directionVariant: Record<
  DriftDirection,
  "danger" | "success" | "secondary"
> = {
  me_perjudica: "danger",
  me_favorece: "success",
  neutral: "secondary",
};

function formatAffectedMonth(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-MX", { year: "numeric", month: "short" });
}

function driftCell(amount: number) {
  if (amount <= 0)
    return <span className="text-muted-foreground tabular-nums">—</span>;
  const highlight = amount > DRIFT_WARN_MXN;
  return (
    <span
      className={
        highlight
          ? "inline-flex items-center gap-1.5 font-semibold text-danger tabular-nums"
          : "inline-flex items-center gap-1.5 tabular-nums"
      }
    >
      <Currency amount={amount} compact />
      {highlight && (
        <AlertTriangle
          className="size-3 text-danger"
          aria-label="Drift supera umbral de revisión"
        />
      )}
    </span>
  );
}

const columns: DataTableColumn<DriftingCompany>[] = [
  {
    key: "company",
    header: "Empresa",
    alwaysVisible: true,
    cell: (r) => (
      <div className="flex items-center gap-2">
        <CompanyLink
          companyId={r.canonical_company_id}
          name={r.display_name}
          truncate
        />
        {r.noise && (
          <Badge variant="secondary" className="h-4 text-[9px]">
            Noise
          </Badge>
        )}
      </div>
    ),
  },
  {
    key: "drift_ar",
    header: "Drift AR",
    align: "right",
    cell: (r) => driftCell(r.drift_ar_mxn),
  },
  {
    key: "drift_ap",
    header: "Drift AP",
    align: "right",
    cell: (r) => driftCell(r.drift_ap_mxn),
  },
  {
    key: "direction",
    header: "Dirección",
    align: "center",
    hideOnMobile: true,
    cell: (r) => {
      const dir =
        r.drift_ar_mxn >= r.drift_ap_mxn ? r.ar_direction : r.ap_direction;
      return (
        <Badge variant={directionVariant[dir]} className="h-5 text-[10px]">
          {directionLabel[dir]}
        </Badge>
      );
    },
  },
  {
    key: "last_affected",
    header: "Último mes afectado",
    hideOnMobile: true,
    align: "right",
    cell: (r) => (
      <span className="text-xs text-muted-foreground tabular-nums">
        {formatAffectedMonth(r.last_affected_month)}
      </span>
    ),
  },
];

/**
 * SP13 E6 — Drift AR/AP significativo SAT↔Odoo.
 *
 * Fuente: canonical_companies.drift_* + gold_company_odoo_sat_drift.
 * Ground truth: si esta vacio post migration sweep 2026-04-23, la query
 * esta mal (no que no haya drift).
 */
export function DriftingSection({ rows }: DriftingSectionProps) {
  return (
    <QuestionSection
      id="drift-ar-ap"
      question="¿Qué empresas tienen diferencias SAT↔Odoo?"
      subtext="Top 5 por drift total (AR + AP). Drift > $5k se marca para revisión."
    >
      <DataTable
        data={rows}
        columns={columns}
        rowKey={(r) => r.canonical_company_id}
        rowHref={(r) => `/empresas/${r.canonical_company_id}`}
        density="compact"
        emptyState={{
          icon: AlertTriangle,
          title: "Sin diferencias SAT↔Odoo",
          description:
            "Todas las empresas concilian. Si crees que falta data, revisa refresh_canonical_company_financials_hourly.",
        }}
      />
    </QuestionSection>
  );
}
