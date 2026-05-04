import { Suspense } from "react";
import { getInventoryReconciliation } from "@/lib/queries/sp13/finanzas/inventory-reconciliation";
import { getShrinkageSummary } from "@/lib/queries/sp13/finanzas/shrinkage-tracker";
import { ReconciliationKpis } from "./_components/reconciliation-kpis";
import { BookVsPhysicalTable } from "./_components/book-vs-physical-table";
import { ShrinkageTrend } from "./_components/shrinkage-trend";
import { ShrinkageTopSkus } from "./_components/shrinkage-top-skus";
import { ShrinkageRecent } from "./_components/shrinkage-recent";
import { TopInventoryByValue } from "./_components/top-inventory-by-value";
import { Skeleton } from "@/components/ui/skeleton";

export const revalidate = 600;
export const metadata = { title: "Conciliación de inventario" };

const SPANISH_MONTHS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function periodLabel(p: string): string {
  const [y, m] = p.split("-").map((s) => parseInt(s, 10));
  return `${SPANISH_MONTHS[m - 1]} ${y}`;
}

function defaultPeriod(): string {
  const t = new Date();
  const prev = new Date(t.getFullYear(), t.getMonth() - 1, 1);
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;
}

function startOfYear(period: string): string {
  const [y] = period.split("-");
  return `${y}-01`;
}

export default async function ConciliacionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const periodParam = Array.isArray(sp.period) ? sp.period[0] : sp.period;
  const period =
    periodParam && /^\d{4}-(0[1-9]|1[0-2])$/.test(periodParam)
      ? periodParam
      : defaultPeriod();
  const fromPeriod = startOfYear(period);

  return (
    <main className="mx-auto max-w-6xl px-6 py-8 space-y-8">
      <header>
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Auditoría de inventario · cierre {periodLabel(period)}
        </p>
        <h1 className="text-2xl font-bold mt-1">
          Conciliación book vs físico + tracker de shrinkage
        </h1>
        <p className="text-sm text-muted-foreground mt-2 max-w-3xl">
          Compara el inventario contable (cuentas 115.x) contra el inventario
          físico (Σ stock × avg_cost). El drift entre ambos es señal de
          discrepancias. Abajo, todo el shrinkage YTD por SKU desde 501.01.08
          DIFERENCIAS POR CONTEO.
        </p>
      </header>

      <Suspense fallback={<Skeleton className="h-32 w-full" />}>
        <ReconciliationBlock period={period} />
      </Suspense>

      <Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <ShrinkageBlock fromPeriod={fromPeriod} toPeriod={period} />
      </Suspense>
    </main>
  );
}

async function ReconciliationBlock({ period }: { period: string }) {
  const recon = await getInventoryReconciliation(period);
  return (
    <>
      <section>
        <h2 className="text-lg font-semibold mb-3">Reconciliación de saldos</h2>
        <ReconciliationKpis recon={recon} />
      </section>

      <section>
        <h3 className="text-base font-semibold mb-3">
          Por bucket — book vs físico
        </h3>
        <BookVsPhysicalTable recon={recon} />
      </section>

      <section>
        <h3 className="text-base font-semibold mb-3">
          Top 20 SKUs por valor de inventario físico
        </h3>
        <p className="text-xs text-muted-foreground mb-3">
          Donde está concentrado el dinero del almacén. Estos SKUs son los que
          más cuesta perder por shrinkage o errores de conteo.
        </p>
        <TopInventoryByValue rows={recon.topSkusByValue} />
      </section>
    </>
  );
}

async function ShrinkageBlock({
  fromPeriod,
  toPeriod,
}: {
  fromPeriod: string;
  toPeriod: string;
}) {
  const shrinkage = await getShrinkageSummary(fromPeriod, toPeriod);
  return (
    <>
      <section className="border-t pt-8">
        <h2 className="text-lg font-semibold mb-3">
          Shrinkage YTD ({periodLabel(fromPeriod)} – {periodLabel(toPeriod)})
        </h2>
        <ShrinkageTrend summary={shrinkage} />
      </section>

      <section>
        <h3 className="text-base font-semibold mb-3">
          Top SKUs por pérdida acumulada
        </h3>
        <ShrinkageTopSkus rows={shrinkage.topSkus} />
      </section>

      <section>
        <h3 className="text-base font-semibold mb-3">
          Eventos recientes (últimos 30)
        </h3>
        <ShrinkageRecent events={shrinkage.recentEvents} />
      </section>
    </>
  );
}
