import { Suspense } from "react";
import { ShieldCheck, AlertTriangle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { DataSourceBadge } from "@/components/ui/DataSourceBadge";
import {
  DateDisplay,
  Currency,
  QuestionSection,
  StatGrid,
  KpiCard,
  EmptyState,
} from "@/components/patterns";
import { CompanyReconciliationTab } from "@/components/domain/system/CompanyReconciliationTab";
import { FiscalCompanyProfileCard } from "@/components/domain/fiscal/FiscalCompanyProfileCard";
import {
  fetchCompanyFiscalSnapshot,
  type CompanyFiscalSnapshot,
} from "@/lib/queries/_shared/companies";

interface Props {
  companyId: number;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

// ──────────────────────────────────────────────────────────────────────────
// Fiscal hero — reads canonical_companies + canonical_invoices directly.
// Replaces the legacy FiscalSummary360Section that referenced fiscal_*
// columns which never landed on gold_company_360 (silent empty render).
// ──────────────────────────────────────────────────────────────────────────
async function FiscalHero({ companyId }: { companyId: number }) {
  const snap = await fetchCompanyFiscalSnapshot(companyId);
  if (!snap) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="Sin datos fiscales"
        description="No hay facturas SAT ni Odoo registradas para esta empresa."
      />
    );
  }

  return <FiscalHeroView snap={snap} />;
}

function FiscalHeroView({ snap }: { snap: CompanyFiscalSnapshot }) {
  const issuesTone =
    snap.satIssuesOpen > 0 ? ("danger" as const) : ("default" as const);
  const cancellationTone =
    snap.cancellationRate >= 0.05
      ? ("warning" as const)
      : snap.cancellationRate >= 0.1
        ? ("danger" as const)
        : ("default" as const);
  const complianceTone =
    snap.satComplianceScore == null
      ? ("default" as const)
      : snap.satComplianceScore >= 0.95
        ? ("success" as const)
        : snap.satComplianceScore >= 0.8
          ? ("warning" as const)
          : ("danger" as const);

  return (
    <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 4 }}>
      <KpiCard
        title="Issues fiscales abiertos"
        value={snap.satIssuesOpen}
        format="number"
        icon={AlertTriangle}
        subtitle={
          snap.satIssuesOpen === 0 ? "Sin issues abiertos" : "Requieren revisión"
        }
        tone={issuesTone}
      />
      <KpiCard
        title="Tasa de cancelación"
        value={snap.cancellationRate * 100}
        format="percent"
        subtitle={`${snap.cancelledCount.toLocaleString("es-MX")} de ${snap.totalIssued.toLocaleString("es-MX")} facturas`}
        tone={cancellationTone}
      />
      <KpiCard
        title="Revenue lifetime SAT"
        value={snap.totalInvoicedSatMxn}
        format="currency"
        compact
        subtitle="Timbrado acumulado"
      />
      <KpiCard
        title="Score cumplimiento"
        value={
          snap.satComplianceScore != null
            ? snap.satComplianceScore * 100
            : null
        }
        format="percent"
        icon={ShieldCheck}
        subtitle={
          snap.satMatchRate > 0
            ? `Match SAT↔Odoo ${pct(snap.satMatchRate)}`
            : "Sin match SAT registrado"
        }
        tone={complianceTone}
      />
    </StatGrid>
  );
}

async function FiscalTimeline({ companyId }: { companyId: number }) {
  const snap = await fetchCompanyFiscalSnapshot(companyId);
  if (!snap) return null;

  const rows: Array<{ label: string; value: React.ReactNode }> = [
    {
      label: "Primer CFDI",
      value: snap.firstInvoiceDate ? (
        <DateDisplay date={snap.firstInvoiceDate} />
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
    },
    {
      label: "Último CFDI",
      value: snap.lastInvoiceDate ? (
        <DateDisplay date={snap.lastInvoiceDate} relative />
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
    },
    {
      label: "Notas de crédito acumuladas",
      value: <Currency amount={snap.totalCreditNotesMxn} compact />,
    },
    {
      label: "Facturas totales registradas",
      value: (
        <span className="tabular-nums">
          {snap.invoicesCount.toLocaleString("es-MX")}
        </span>
      ),
    },
  ];

  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {rows.map((r, i) => (
        <li key={i} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
          <span className="text-muted-foreground">{r.label}</span>
          <span className="font-medium">{r.value}</span>
        </li>
      ))}
    </ul>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Fiscal tab — main export
// ──────────────────────────────────────────────────────────────────────────
export function FiscalTab({ companyId }: Props) {
  return (
    <div className="space-y-6">
      <QuestionSection
        id="fiscal-snapshot"
        question="¿Cómo está su perfil fiscal?"
        subtext="Issues abiertos, tasa de cancelación, revenue SAT lifetime y score de cumplimiento."
        actions={<DataSourceBadge source="unified" />}
      >
        <Suspense fallback={<Skeleton className="h-32 rounded-xl" />}>
          <FiscalHero companyId={companyId} />
        </Suspense>
      </QuestionSection>

      <QuestionSection
        id="fiscal-timeline"
        question="¿Desde cuándo está timbrando con nosotros?"
        subtext="Primer y último CFDI, notas de crédito, total de facturas."
      >
        <Suspense fallback={<Skeleton className="h-40 rounded-xl" />}>
          <FiscalTimeline companyId={companyId} />
        </Suspense>
      </QuestionSection>

      <QuestionSection
        id="fiscal-reconciliation"
        question="¿Hay discrepancias SAT↔Odoo en sus facturas?"
        subtext="Reconciliación factura por factura: faltantes, divergencias de monto, fechas inconsistentes."
        actions={<DataSourceBadge source="unified" />}
      >
        <Suspense fallback={<Skeleton className="h-64 rounded-xl" />}>
          <CompanyReconciliationTab companyId={companyId} />
        </Suspense>
      </QuestionSection>

      <QuestionSection
        id="fiscal-profile"
        question="¿Qué dice su perfil SAT?"
        subtext="Régimen fiscal, domicilio, opinión de cumplimiento, lista negra."
        actions={<DataSourceBadge source="syntage" />}
      >
        <Suspense fallback={<Skeleton className="h-64 rounded-xl" />}>
          <FiscalCompanyProfileCard companyId={companyId} />
        </Suspense>
      </QuestionSection>
    </div>
  );
}
