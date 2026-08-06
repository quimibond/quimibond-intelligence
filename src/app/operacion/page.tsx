/**
 * /operacion — la tercera vista del rediseño: ventas, entregas, inventario,
 * producción y comunicación con clientes, en una sola página.
 *
 * Mismos principios que /hoy y /dinero: composición delgada sobre las
 * queries ya validadas de /ventas, /operaciones y /productos (los números
 * cuadran exacto con esas páginas), señales determinísticas, y cada
 * sección linkea a la página de detalle correspondiente.
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
import {
  getSalesKpis,
  getTopSalespeople,
  getReorderRisk,
  type ReorderRiskRow,
} from "@/lib/queries/operational/sales";
import {
  getOperationsKpis,
  getLateDeliveries,
  getActiveManufacturing,
  type LateDeliveryRow,
  type ManufacturingRow,
} from "@/lib/queries/operational/operations";
import { getStockoutSummary, getStockoutQueue, type StockoutRow } from "@/lib/queries/analytics";
import {
  getSilentCustomers,
  getUnansweredThreads,
  type SilentCustomer,
  type UnansweredThread,
} from "@/lib/queries/sp13/comunicacion";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Operación — Quimibond Intelligence",
};

const SECTIONS = [
  { id: "resumen", label: "Resumen" },
  { id: "comunicacion", label: "Comunicación" },
  { id: "ventas", label: "Ventas" },
  { id: "entregas", label: "Entregas" },
  { id: "inventario", label: "Inventario" },
  { id: "produccion", label: "Producción" },
];

export default function OperacionPage() {
  return (
    <PageLayout>
      <PageHeader
        title="Operación"
        subtitle="Ventas, entregas, inventario, producción y comunicación — en un lugar"
      />
      <SectionNav items={SECTIONS} />

      <QuestionSection id="resumen" question="¿Cómo va la operación?">
        <Suspense fallback={<LoadingCard />}>
          <ResumenKpis />
        </Suspense>
      </QuestionSection>

      <QuestionSection
        id="comunicacion"
        question="¿A qué cliente le estamos quedando mal en comunicación?"
        subtext="Conversaciones reales sin respuesta nuestra y clientes activos que dejaron de escribir."
      >
        <Suspense fallback={<LoadingCard />}>
          <ComunicacionSection />
        </Suspense>
      </QuestionSection>

      <QuestionSection id="ventas" question="¿Quién está vendiendo y quién debería recomprar?">
        <Suspense fallback={<LoadingCard />}>
          <VentasSection />
        </Suspense>
      </QuestionSection>

      <QuestionSection id="entregas" question="¿Qué entregas están en riesgo?">
        <Suspense fallback={<LoadingCard />}>
          <EntregasSection />
        </Suspense>
      </QuestionSection>

      <QuestionSection id="inventario" question="¿Qué se está acabando?">
        <Suspense fallback={<LoadingCard />}>
          <InventarioSection />
        </Suspense>
      </QuestionSection>

      <QuestionSection id="produccion" question="¿Qué se está produciendo?">
        <Suspense fallback={<LoadingCard />}>
          <ProduccionSection />
        </Suspense>
      </QuestionSection>
    </PageLayout>
  );
}

async function ResumenKpis() {
  const [sales, ops, stockouts] = await Promise.all([
    getSalesKpis(),
    getOperationsKpis(),
    getStockoutSummary(),
  ]);

  const critical = stockouts
    .filter((s) => s.urgency === "STOCKOUT" || s.urgency === "CRITICAL")
    .reduce((acc, s) => acc + s.count, 0);
  const revenueAtRisk = stockouts
    .filter((s) => s.urgency === "STOCKOUT" || s.urgency === "CRITICAL")
    .reduce((acc, s) => acc + Number(s.revenue_at_risk ?? 0), 0);

  return (
    <StatGrid columns={{ mobile: 2, tablet: 3, desktop: 6 }}>
      <KpiCard
        title="Ventas del mes"
        value={sales.ingresosMes}
        format="currency"
        compact
        trend={sales.ingresosMomPct != null ? { value: sales.ingresosMomPct } : undefined}
        href="/ventas"
      />
      <KpiCard
        title="Pedidos del mes"
        value={sales.pedidosMes}
        format="number"
        subtitle={`Ticket prom: ${Math.round((sales.ticketPromedio ?? 0) / 1000)}k`}
        href="/ventas"
      />
      <KpiCard
        title="OTD (última semana)"
        value={sales == null ? null : ops.otdLatestPct}
        format="percent"
        subtitle={ops.otdAvg4w != null ? `Prom 4 sem: ${Math.round(ops.otdAvg4w)}%` : undefined}
        tone={ops.otdLatestPct != null && ops.otdLatestPct < 80 ? "danger" : "default"}
        href="/operaciones"
      />
      <KpiCard
        title="Entregas tarde"
        value={ops.lateOpen}
        format="number"
        tone={ops.lateOpen > 0 ? "warning" : "success"}
        href="/operaciones"
      />
      <KpiCard
        title="Stockouts críticos"
        value={critical}
        format="number"
        subtitle={revenueAtRisk > 0 ? `~${Math.round(revenueAtRisk / 1000)}k en riesgo/30d` : undefined}
        tone={critical > 0 ? "danger" : "success"}
        href="/compras/stockouts"
      />
      <KpiCard
        title="Manufactura activa"
        value={ops.mfgInProgress}
        format="number"
        subtitle={ops.avgLeadDays != null ? `Lead time: ${Math.round(ops.avgLeadDays)}d` : undefined}
        href="/operaciones"
      />
    </StatGrid>
  );
}

const unansweredColumns: DataTableColumn<UnansweredThread>[] = [
  {
    key: "companyName",
    header: "Cliente",
    cell: (r) => <span className="font-medium">{r.companyName}</span>,
  },
  {
    key: "subject",
    header: "Asunto",
    cell: (r) => <span className="text-muted-foreground line-clamp-1">{r.subject ?? "—"}</span>,
  },
  {
    key: "hoursWaiting",
    header: "Esperando",
    align: "right",
    cell: (r) => {
      const days = Math.floor(r.hoursWaiting / 24);
      const label = days >= 1 ? `${days}d` : `${Math.round(r.hoursWaiting)}h`;
      return (
        <span className={days >= 3 ? "text-destructive font-semibold" : "font-medium"}>{label}</span>
      );
    },
  },
  {
    key: "account",
    header: "Buzón",
    cell: (r) => <span className="text-muted-foreground text-xs">{r.account ?? "—"}</span>,
    hideOnMobile: true,
  },
];

const silentColumns: DataTableColumn<SilentCustomer>[] = [
  {
    key: "companyName",
    header: "Cliente",
    cell: (r) => <span className="font-medium">{r.companyName}</span>,
  },
  {
    key: "daysSilent",
    header: "Días callado",
    align: "right",
    cell: (r) => (
      <span className={r.daysSilent >= 45 ? "text-destructive font-semibold" : undefined}>
        {r.daysSilent}
      </span>
    ),
  },
  {
    key: "emails90d",
    header: "Emails (90d)",
    align: "right",
    cell: (r) => <span className="text-muted-foreground">{r.emails90d}</span>,
    hideOnMobile: true,
  },
  {
    key: "lifetimeValue",
    header: "Valor histórico",
    align: "right",
    cell: (r) => <Currency amount={r.lifetimeValue} compact />,
  },
];

async function ComunicacionSection() {
  const [unanswered, silent] = await Promise.all([getUnansweredThreads(), getSilentCustomers()]);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div>
        <h3 className="mb-2 text-sm font-semibold">
          Hilos sin respuesta nuestra (+24h)
          {unanswered.length > 0 && (
            <Badge variant="destructive" className="ml-2">
              {unanswered.length}
            </Badge>
          )}
        </h3>
        <DataTable
          data={unanswered}
          columns={unansweredColumns}
          rowKey={(r) => String(r.threadId)}
          rowHref={(r) => (r.companyId != null ? `/empresas/${r.companyId}` : "/threads")}
          emptyState={{ icon: CheckCircle2, title: "Todo respondido" }}
          density="compact"
        />
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold">Clientes activos que dejaron de escribir (+21d)</h3>
        <DataTable
          data={silent}
          columns={silentColumns}
          rowKey={(r) => String(r.companyId)}
          rowHref={(r) => `/empresas/${r.companyId}`}
          emptyState={{ icon: CheckCircle2, title: "Sin silencios inusuales" }}
          density="compact"
        />
      </div>
    </div>
  );
}

const reorderColumns: DataTableColumn<ReorderRiskRow>[] = [
  {
    key: "company_name",
    header: "Cliente",
    cell: (r) => <span className="font-medium">{r.company_name}</span>,
  },
  {
    key: "days_overdue_reorder",
    header: "Días vencido (vs ciclo)",
    align: "right",
    cell: (r) => <span>{r.days_overdue_reorder}</span>,
  },
  {
    key: "avg_order_value",
    header: "Orden típica",
    align: "right",
    cell: (r) => <Currency amount={r.avg_order_value ?? 0} compact />,
  },
  {
    key: "salesperson_name",
    header: "Vendedor",
    cell: (r) => <span className="text-muted-foreground">{r.salesperson_name ?? "—"}</span>,
    hideOnMobile: true,
  },
];

async function VentasSection() {
  const [salespeople, reorder] = await Promise.all([getTopSalespeople(), getReorderRisk(8)]);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-2 text-sm font-semibold">Vendedores este mes</h3>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {salespeople.slice(0, 8).map((s) => (
            <div key={s.name} className="rounded-lg border p-3">
              <p className="truncate text-sm font-medium">{s.name}</p>
              <p className="text-lg font-semibold">
                <Currency amount={s.total_amount} compact />
              </p>
              <p className="text-xs text-muted-foreground">{s.order_count} pedidos</p>
            </div>
          ))}
        </div>
      </div>
      <div>
        <h3 className="mb-2 text-sm font-semibold">Clientes que ya deberían haber recomprado</h3>
        <DataTable
          data={reorder}
          columns={reorderColumns}
          rowKey={(r) => String(r.company_id ?? r.company_name)}
          rowHref={(r) => (r.company_id != null ? `/empresas/${r.company_id}` : "/ventas")}
          emptyState={{ icon: CheckCircle2, title: "Sin recompras vencidas" }}
          density="compact"
        />
        <p className="mt-2 text-xs text-muted-foreground">
          Detalle completo con filtros en{" "}
          <a href="/ventas" className="underline">
            /ventas
          </a>
          .
        </p>
      </div>
    </div>
  );
}

const lateColumns: DataTableColumn<LateDeliveryRow>[] = [
  {
    key: "name",
    header: "Entrega",
    cell: (r) => <span className="font-medium">{r.name}</span>,
  },
  {
    key: "company_name",
    header: "Cliente",
    cell: (r) => <span className="text-muted-foreground">{r.company_name ?? "—"}</span>,
  },
  {
    key: "scheduled_date",
    header: "Prometida",
    cell: (r) => (r.scheduled_date ? formatRelative(r.scheduled_date) : "—"),
  },
  {
    key: "origin",
    header: "Origen",
    cell: (r) => <span className="text-muted-foreground text-xs">{r.origin ?? "—"}</span>,
    hideOnMobile: true,
  },
];

async function EntregasSection() {
  const late = await getLateDeliveries(10);

  return (
    <div>
      <DataTable
        data={late}
        columns={lateColumns}
        rowKey={(r) => String(r.id)}
        rowHref={(r) => (r.company_id != null ? `/empresas/${r.company_id}` : "/operaciones")}
        emptyState={{ icon: CheckCircle2, title: "Sin entregas atrasadas" }}
        density="compact"
      />
      <p className="mt-2 text-xs text-muted-foreground">
        Todas las entregas y el OTD semanal en{" "}
        <a href="/operaciones" className="underline">
          /operaciones
        </a>
        .
      </p>
    </div>
  );
}

const stockoutColumns: DataTableColumn<StockoutRow>[] = [
  {
    key: "product_ref",
    header: "Producto",
    cell: (r) => (
      <div>
        <p className="font-medium">{r.product_ref ?? "—"}</p>
        <p className="text-xs text-muted-foreground line-clamp-1">{r.product_name}</p>
      </div>
    ),
  },
  {
    key: "days_of_stock",
    header: "Días de stock",
    align: "right",
    cell: (r) => (
      <span className={Number(r.days_of_stock ?? 99) <= 7 ? "text-destructive font-semibold" : undefined}>
        {r.days_of_stock == null ? "0" : Math.round(Number(r.days_of_stock))}
      </span>
    ),
  },
  {
    key: "revenue_at_risk_30d_mxn",
    header: "Venta en riesgo 30d",
    align: "right",
    cell: (r) => <Currency amount={Number(r.revenue_at_risk_30d_mxn ?? 0)} compact />,
  },
  {
    key: "urgency",
    header: "Urgencia",
    cell: (r) => (
      <Badge variant={r.urgency === "STOCKOUT" ? "destructive" : "secondary"}>{r.urgency}</Badge>
    ),
    hideOnMobile: true,
  },
];

async function InventarioSection() {
  const stockouts = await getStockoutQueue(undefined, 10);

  return (
    <div>
      <DataTable
        data={stockouts}
        columns={stockoutColumns}
        rowKey={(r) => String(r.odoo_product_id)}
        rowHref={() => "/compras/stockouts"}
        emptyState={{ icon: CheckCircle2, title: "Sin faltantes urgentes" }}
        density="compact"
      />
      <p className="mt-2 text-xs text-muted-foreground">
        Cola completa de reabasto en{" "}
        <a href="/compras/stockouts" className="underline">
          /compras/stockouts
        </a>
        ; velocidad y dead stock en{" "}
        <a href="/productos" className="underline">
          /productos
        </a>
        .
      </p>
    </div>
  );
}

const mfgColumns: DataTableColumn<ManufacturingRow>[] = [
  {
    key: "name",
    header: "Orden",
    cell: (r) => <span className="font-medium">{r.name}</span>,
  },
  {
    key: "product_name",
    header: "Producto",
    cell: (r) => <span className="text-muted-foreground line-clamp-1">{r.product_name ?? "—"}</span>,
  },
  {
    key: "qty_planned",
    header: "Plan / Producido",
    align: "right",
    cell: (r) => (
      <span>
        {Math.round(Number(r.qty_produced ?? 0))} / {Math.round(Number(r.qty_planned ?? 0))}
      </span>
    ),
  },
  {
    key: "state",
    header: "Estado",
    cell: (r) => <Badge variant="secondary">{r.state}</Badge>,
    hideOnMobile: true,
  },
];

async function ProduccionSection() {
  const mfg = await getActiveManufacturing(10);

  return (
    <div>
      <DataTable
        data={mfg}
        columns={mfgColumns}
        rowKey={(r) => String(r.id)}
        rowHref={() => "/operaciones"}
        emptyState={{ icon: CheckCircle2, title: "Sin órdenes activas" }}
        density="compact"
      />
    </div>
  );
}
