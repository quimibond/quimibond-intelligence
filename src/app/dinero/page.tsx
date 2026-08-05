/**
 * /dinero — una sola vista para todo el dinero: P&L, efectivo proyectado,
 * cobranza y obligaciones. Consolida lo esencial de /finanzas, /cobranza y
 * /contabilidad sin recalcular nada: cada sección reutiliza el módulo de
 * query validado de la página original, así los números cuadran exacto.
 */

import { Suspense } from "react";
import type { Metadata } from "next";
import { CheckCircle2 } from "lucide-react";

import {
  AgingBuckets,
  Currency,
  DataTable,
  type DataTableColumn,
  HistorySelector,
  KpiCard,
  LoadingCard,
  PageHeader,
  PageLayout,
  QuestionSection,
  SectionNav,
  StatGrid,
} from "@/components/patterns";
import { parseHistoryRange, type HistoryRange } from "@/components/patterns/history-range";
import { Badge } from "@/components/ui/badge";
import { getPnlKpis } from "@/lib/queries/sp13/finanzas";
import { getObligationsSummary } from "@/lib/queries/sp13/finanzas";
import {
  getActionList,
  getAgingBuckets,
  getArKpis,
  type ActionListItem,
} from "@/lib/queries/sp13/cobranza";
import { ProjectionBlock } from "@/app/finanzas/_components/blocks/projection-block";
import { parseProjectionHorizon } from "@/lib/queries/sp13/finanzas";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Dinero — Quimibond Intelligence",
};

const SECTIONS = [
  { id: "pl", label: "P&L" },
  { id: "projection", label: "Efectivo" },
  { id: "cobranza", label: "Cobranza" },
  { id: "obligaciones", label: "Obligaciones" },
];

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function DineroPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const period = parseHistoryRange(sp.period, "mtd");
  const horizon = parseProjectionHorizon(sp.proj_horizon, 30);

  return (
    <PageLayout>
      <PageHeader
        title="Dinero"
        subtitle="P&L, efectivo, cobranza y obligaciones — todo en un lugar"
        actions={<HistorySelector paramName="period" defaultRange="mtd" />}
      />
      <SectionNav items={SECTIONS} />

      <QuestionSection id="pl" question="¿Estamos ganando dinero?">
        <Suspense fallback={<LoadingCard />}>
          <PlKpis range={period} />
        </Suspense>
      </QuestionSection>

      <Suspense fallback={<LoadingCard />}>
        <ProjectionBlock horizon={horizon} />
      </Suspense>

      <QuestionSection
        id="cobranza"
        question="¿Quién nos debe y a quién hay que cobrarle ya?"
      >
        <Suspense fallback={<LoadingCard />}>
          <CobranzaResumen />
        </Suspense>
      </QuestionSection>

      <QuestionSection id="obligaciones" question="¿Qué debemos y cuándo?">
        <Suspense fallback={<LoadingCard />}>
          <ObligacionesResumen />
        </Suspense>
      </QuestionSection>
    </PageLayout>
  );
}

async function PlKpis({ range }: { range: HistoryRange }) {
  const pnl = await getPnlKpis(range);

  return (
    <div className="space-y-3">
      <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 4 }}>
        <KpiCard
          title="Ventas"
          value={pnl.ingresosPl}
          format="currency"
          compact
          subtitle={pnl.periodLabel}
          href="/finanzas"
        />
        <KpiCard
          title="Utilidad bruta"
          value={pnl.utilidadBruta}
          format="currency"
          compact
          tone={pnl.utilidadBruta >= 0 ? "default" : "danger"}
        />
        <KpiCard
          title="Gasto de operación"
          value={pnl.gastosOperativos}
          format="currency"
          compact
        />
        <KpiCard
          title="Utilidad neta"
          value={pnl.utilidadNeta}
          format="currency"
          compact
          tone={pnl.utilidadNeta >= 0 ? "success" : "danger"}
        />
      </StatGrid>
      <p className="text-xs text-muted-foreground">
        Mismos números que el P&L de{" "}
        <a href="/finanzas" className="underline">
          /finanzas
        </a>{" "}
        (fuente: balances contables de Odoo). Ahí está el desglose completo por cuenta.
      </p>
    </div>
  );
}

const accionesColumns: DataTableColumn<ActionListItem>[] = [
  {
    key: "companyName",
    header: "Cliente",
    cell: (r) => <span className="font-medium">{r.companyName ?? "—"}</span>,
  },
  {
    key: "invoiceName",
    header: "Factura",
    cell: (r) => <span className="text-muted-foreground">{r.invoiceName ?? "—"}</span>,
    hideOnMobile: true,
  },
  {
    key: "amountOverdueMxn",
    header: "Vencido",
    align: "right",
    cell: (r) => <Currency amount={r.amountOverdueMxn} compact />,
  },
  {
    key: "daysOverdue",
    header: "Días",
    align: "right",
    cell: (r) => (
      <span className={r.daysOverdue > 60 ? "text-destructive font-semibold" : undefined}>
        {r.daysOverdue}
      </span>
    ),
  },
  {
    key: "risk",
    header: "Riesgo",
    hideOnMobile: true,
    cell: (r) =>
      r.risk ? (
        <Badge variant={r.risk === "critical" ? "destructive" : "secondary"}>{r.risk}</Badge>
      ) : (
        "—"
      ),
  },
];

async function CobranzaResumen() {
  const [ar, aging, acciones] = await Promise.all([
    getArKpis(),
    getAgingBuckets(),
    getActionList(10),
  ]);

  return (
    <div className="space-y-4">
      <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 4 }}>
        <KpiCard title="CxC total" value={ar.totalMxn} format="currency" compact subtitle={`${ar.totalCount} facturas`} />
        <KpiCard
          title="Vencido"
          value={ar.overdueMxn}
          format="currency"
          compact
          subtitle={`${ar.overdueCount} facturas`}
          tone={ar.overdueMxn > 0 ? "warning" : "success"}
        />
        <KpiCard
          title="Vencido +90 días"
          value={ar.overdue90plusMxn}
          format="currency"
          compact
          tone={ar.overdue90plusMxn > 0 ? "danger" : "success"}
        />
        <KpiCard title="DSO" value={ar.dsoDays} format="days" />
      </StatGrid>

      <AgingBuckets data={aging.totals} ariaLabel="Antigüedad de cartera" />

      <div>
        <h3 className="mb-2 text-sm font-semibold">Acciones de cobranza (por prioridad)</h3>
        <DataTable
          data={acciones}
          columns={accionesColumns}
          rowKey={(r) => r.invoiceId}
          rowHref={(r) => (r.companyId != null ? `/empresas/${r.companyId}` : "/cobranza")}
          emptyState={{ icon: CheckCircle2, title: "Sin facturas vencidas" }}
          density="compact"
        />
        <p className="mt-2 text-xs text-muted-foreground">
          Lista completa y detalle por cliente en{" "}
          <a href="/cobranza" className="underline">
            /cobranza
          </a>
          .
        </p>
      </div>
    </div>
  );
}

async function ObligacionesResumen() {
  const ob = await getObligationsSummary();

  return (
    <div className="space-y-3">
      <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 5 }}>
        <KpiCard
          title="Operativo (sin intercompañía)"
          value={ob.totalOperativoMxn}
          format="currency"
          compact
        />
        <KpiCard title="Inmediato" value={ob.totalInmediatoMxn} format="currency" compact tone="warning" />
        <KpiCard title="30 días" value={ob.totalCortoPlazo30Mxn} format="currency" compact />
        <KpiCard title="90 días" value={ob.totalCortoPlazo90Mxn} format="currency" compact />
        <KpiCard
          title="Cobertura con efectivo"
          value={ob.liquidityRatio != null ? ob.liquidityRatio * 100 : null}
          format="percent"
          subtitle="Efectivo ÷ obligaciones inmediatas"
          tone={ob.liquidityRatio != null && ob.liquidityRatio < 1 ? "danger" : "success"}
        />
      </StatGrid>
      <p className="text-xs text-muted-foreground">
        Intercompañía (<Currency amount={ob.totalIntercompaniaMxn} compact />) se muestra aparte —
        no compite con las obligaciones operativas.
      </p>
    </div>
  );
}
