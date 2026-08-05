/**
 * /hoy — la vista de aterrizaje del rediseño: qué pasó, qué necesita
 * decisión hoy, y si se puede confiar en los números.
 *
 * Principios (rediseño 2026-08-05):
 * - Cero IA especulativa: solo alertas determinísticas con umbral claro.
 * - Cero KPIs recalculados: cada número viene del módulo de query ya
 *   validado que usan las páginas existentes — nunca una segunda versión.
 * - La salud de los pipelines es una sección de primera clase: si un dato
 *   está viejo, se ve aquí, no enterrado en pipeline_logs.
 */

import { Suspense } from "react";
import type { Metadata } from "next";
import { CheckCircle2 } from "lucide-react";

import {
  Currency,
  DataTable,
  type DataTableColumn,
  KpiCard,
  LoadingCard,
  PageHeader,
  PageLayout,
  QuestionSection,
  SectionNav,
  StatGrid,
} from "@/components/patterns";
import { Badge } from "@/components/ui/badge";
import { formatRelative } from "@/lib/formatters";
import { getMonthToDate } from "@/lib/queries/sp13/home/month-to-date";
import { getCashKpis, getCashProjection, getRunwayKpis } from "@/lib/queries/sp13/finanzas";
import { getActionList, getArKpis, type ActionListItem } from "@/lib/queries/sp13/cobranza";
import {
  getDataHealth,
  getLateDeliveries,
  getReorderRisks,
  type ReorderRisk,
} from "@/lib/queries/sp13/hoy";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Hoy — Quimibond Intelligence",
};

const SECTIONS = [
  { id: "mes", label: "El mes" },
  { id: "decision", label: "Necesita decisión" },
  { id: "confianza", label: "Salud de datos" },
];

export default function HoyPage() {
  return (
    <PageLayout>
      <PageHeader
        title="Hoy"
        subtitle="Lo que necesitas saber y decidir — sin ruido"
      />
      <SectionNav items={SECTIONS} />

      <QuestionSection id="mes" question="¿Cómo va el mes?">
        <Suspense fallback={<LoadingCard />}>
          <MesKpis />
        </Suspense>
      </QuestionSection>

      <QuestionSection
        id="decision"
        question="¿Qué necesita tu decisión hoy?"
        subtext="Alertas determinísticas: si aparece aquí, cruzó un umbral concreto."
      >
        <Suspense fallback={<LoadingCard />}>
          <DecisionHoy />
        </Suspense>
      </QuestionSection>

      <QuestionSection
        id="confianza"
        question="¿Puedo confiar en estos números?"
        subtext="Frescura de cada pipeline. Verde = todo sincronizado."
      >
        <Suspense fallback={<LoadingCard />}>
          <SaludDatos />
        </Suspense>
      </QuestionSection>
    </PageLayout>
  );
}

async function MesKpis() {
  const [mtd, cash, runway, ar, projection] = await Promise.all([
    getMonthToDate(),
    getCashKpis(),
    getRunwayKpis(),
    getArKpis(),
    getCashProjection(30),
  ]);

  const minBelowFloor = projection.minBalance < projection.safetyFloor;

  return (
    <StatGrid columns={{ mobile: 2, tablet: 3, desktop: 6 }}>
      <KpiCard
        title="Ventas del mes"
        value={mtd.sales.mtd}
        format="currency"
        compact
        subtitle={`Proyección: ${Math.round(mtd.sales.projection / 1000)}k · día ${mtd.dayOfMonth}/${mtd.daysInMonth}`}
        trend={mtd.sales.deltaPct != null ? { value: mtd.sales.deltaPct } : undefined}
        href="/dinero#pl"
      />
      <KpiCard
        title="Cobrado del mes"
        value={mtd.collections.mtd}
        format="currency"
        compact
        trend={mtd.collections.deltaPct != null ? { value: mtd.collections.deltaPct } : undefined}
        href="/cobranza"
      />
      <KpiCard
        title="Efectivo hoy"
        value={cash.efectivoTotalMxn}
        format="currency"
        compact
        subtitle={`${cash.cashAccountsCount} cuentas`}
        href="/dinero#cash"
        asOfDate={cash.asOfDate ?? undefined}
      />
      <KpiCard
        title="CxC vencida"
        value={ar.overdueMxn}
        format="currency"
        compact
        subtitle={`${ar.overdueCount} facturas`}
        tone={ar.overdueMxn > 0 ? "warning" : "success"}
        href="/cobranza"
      />
      <KpiCard
        title="Mínimo de cash (30d)"
        value={projection.minBalance}
        format="currency"
        compact
        subtitle={projection.minBalanceDate ? `el ${projection.minBalanceDate}` : undefined}
        tone={minBelowFloor ? "danger" : "success"}
        href="/dinero#cash"
      />
      <KpiCard
        title="Runway (solo cash)"
        value={runway.runwayCashOnlyDays}
        format="days"
        subtitle={`Quema ~${Math.round(runway.burnRateMonthly / 1_000_000 * 10) / 10}M/mes`}
        tone={runway.runwayCashOnlyDays != null && runway.runwayCashOnlyDays < 45 ? "danger" : "default"}
        href="/dinero#obligaciones"
      />
    </StatGrid>
  );
}

const cobranzaColumns: DataTableColumn<ActionListItem>[] = [
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

const reorderColumns: DataTableColumn<ReorderRisk>[] = [
  {
    key: "companyName",
    header: "Cliente",
    cell: (r) => <span className="font-medium">{r.companyName}</span>,
  },
  {
    key: "daysOverdueReorder",
    header: "Días sin recomprar (vs su ciclo)",
    align: "right",
    cell: (r) => <span>{r.daysOverdueReorder}</span>,
  },
  {
    key: "avgOrderValue",
    header: "Orden típica",
    align: "right",
    cell: (r) => <Currency amount={r.avgOrderValue} compact />,
    hideOnMobile: true,
  },
  {
    key: "salespersonName",
    header: "Vendedor",
    cell: (r) => <span className="text-muted-foreground">{r.salespersonName ?? "—"}</span>,
    hideOnMobile: true,
  },
];

async function DecisionHoy() {
  const [projection, acciones, entregas, recompras] = await Promise.all([
    getCashProjection(30),
    getActionList(5),
    getLateDeliveries(),
    getReorderRisks(),
  ]);

  const alerts: React.ReactNode[] = [];

  if (projection.minBalance < projection.safetyFloor) {
    alerts.push(
      <div
        key="cash-floor"
        className="rounded-lg border border-destructive/40 bg-destructive/5 p-4"
      >
        <p className="text-sm font-semibold text-destructive">
          El cash proyectado cae debajo del piso de seguridad
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Mínimo proyectado: <Currency amount={projection.minBalance} compact />{" "}
          {projection.minBalanceDate ? `el ${projection.minBalanceDate}` : ""} (piso:{" "}
          <Currency amount={projection.safetyFloor} compact />
          ). Revisa la proyección en la vista Dinero.
        </p>
      </div>,
    );
  }

  return (
    <div className="space-y-6">
      {alerts}

      <div>
        <h3 className="mb-2 text-sm font-semibold">
          Cobranza: las {acciones.length} facturas que más urge cobrar
        </h3>
        <DataTable
          data={acciones}
          columns={cobranzaColumns}
          rowKey={(r) => r.invoiceId}
          rowHref={(r) => (r.companyId != null ? `/empresas/${r.companyId}` : "/cobranza")}
          emptyState={{ icon: CheckCircle2, title: "Sin facturas vencidas críticas" }}
          density="compact"
        />
      </div>

      {entregas.count > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold">
            Entregas atrasadas: {entregas.count} pendientes
          </h3>
          <ul className="space-y-1 text-sm text-muted-foreground">
            {entregas.top.map((e) => (
              <li key={e.name}>
                <span className="font-medium text-foreground">{e.name}</span>
                {e.origin ? ` (${e.origin})` : ""} — {e.daysLate} días de retraso
              </li>
            ))}
          </ul>
        </div>
      )}

      {recompras.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold">
            Clientes que ya deberían haber recomprado
          </h3>
          <DataTable
            data={recompras}
            columns={reorderColumns}
            rowKey={(r) => String(r.companyId ?? r.companyName)}
            rowHref={(r) => (r.companyId != null ? `/empresas/${r.companyId}` : "/empresas")}
            density="compact"
          />
        </div>
      )}
    </div>
  );
}

async function SaludDatos() {
  const health = await getDataHealth();

  const odooOk = health.odooStale.length === 0;
  const gmailOk = health.emailAgeHours != null && health.emailAgeHours < 2;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <div className="rounded-lg border p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">Odoo</p>
          <Badge variant={odooOk ? "secondary" : "destructive"}>
            {odooOk ? "al día" : `${health.odooStale.length} tablas atrasadas`}
          </Badge>
        </div>
        {!odooOk && (
          <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
            {health.odooStale.slice(0, 4).map((t) => (
              <li key={t.table}>
                {t.table}: {t.hoursAgo != null ? `${Math.round(t.hoursAgo)}h sin sync` : t.status}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          {health.odooTablesTotal} tablas monitoreadas
        </p>
      </div>

      <div className="rounded-lg border p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">Gmail</p>
          <Badge variant={gmailOk ? "secondary" : "destructive"}>
            {health.emailAgeHours != null ? `último hace ${health.emailAgeHours}h` : "sin datos"}
          </Badge>
        </div>
        {health.lastEmailAt && (
          <p className="mt-2 text-xs text-muted-foreground">
            Último email: {formatRelative(health.lastEmailAt)}
          </p>
        )}
        {health.backfill && (
          <p className="mt-1 text-xs text-muted-foreground">
            Recuperando histórico: {health.backfill.emailsRecovered.toLocaleString("es-MX")} emails,
            faltan {health.backfill.pendingAccounts}/{health.backfill.totalAccounts} cuentas
          </p>
        )}
      </div>

      <div className="rounded-lg border p-4">
        <p className="text-sm font-semibold">¿Qué significa?</p>
        <p className="mt-2 text-xs text-muted-foreground">
          Cada número de esta página viene de la misma fuente que las vistas de detalle — si algo
          está atrasado aquí, los KPIs pueden estar viejos. Detalle completo en{" "}
          <a href="/sistema" className="underline">
            /sistema
          </a>
          .
        </p>
      </div>
    </div>
  );
}
