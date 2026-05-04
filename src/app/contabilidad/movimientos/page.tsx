import { Suspense } from "react";
import {
  getCrossAccountMovements,
  ALL_BUCKET_LABELS,
} from "@/lib/queries/sp13/finanzas/cross-account-movements";
import { getCrossAccountNarrative } from "@/lib/queries/sp13/finanzas/cross-account-narrative";
import { MovementsHeader } from "./_components/movements-header";
import { MovementsNarrative } from "./_components/movements-narrative";
import { MovementsTable } from "./_components/movements-table";
import { Skeleton } from "@/components/ui/skeleton";

export const revalidate = 600;
export const metadata = { title: "Análisis cross-account" };

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function defaultPeriod(): string {
  const t = new Date();
  const prev = new Date(t.getFullYear(), t.getMonth() - 1, 1);
  return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}`;
}

export default async function MovimientosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const periodRaw = Array.isArray(sp.period) ? sp.period[0] : sp.period;
  const period =
    periodRaw && PERIOD_RE.test(periodRaw) ? periodRaw : defaultPeriod();

  const summary = await getCrossAccountMovements(period, 50000);

  const increases = summary.movements
    .filter((m) => m.deltaVsAvgAbs > 0)
    .sort((a, b) => b.deltaVsAvgAbs - a.deltaVsAvgAbs);
  const decreases = summary.movements
    .filter((m) => m.deltaVsAvgAbs < 0)
    .sort((a, b) => a.deltaVsAvgAbs - b.deltaVsAvgAbs);
  const anomalies = summary.movements.filter((m) => m.isAnomaly);

  return (
    <main className="mx-auto max-w-6xl px-6 py-8 space-y-8">
      <MovementsHeader summary={summary} />

      <Suspense fallback={<Skeleton className="h-32 w-full" />}>
        <NarrativeBlock summary={summary} />
      </Suspense>

      {anomalies.length > 0 ? (
        <section>
          <h2 className="text-lg font-semibold mb-3">
            🚨 Anomalías ({anomalies.length})
          </h2>
          <p className="text-sm text-muted-foreground mb-3">
            Cambio &gt;2× el promedio O cambio absoluto &gt;$500k. Estas son
            las primeras que deberías investigar.
          </p>
          <MovementsTable
            rows={anomalies.slice(0, 15)}
            period={period}
            buckets={ALL_BUCKET_LABELS}
          />
        </section>
      ) : null}

      <section>
        <h2 className="text-lg font-semibold mb-3">
          ⬆️ Cuentas que castigaron utilidad (top 15)
        </h2>
        <p className="text-sm text-muted-foreground mb-3">
          Más gasto o menos ingreso vs run rate 3m.
        </p>
        <MovementsTable
          rows={increases.slice(0, 15)}
          period={period}
          buckets={ALL_BUCKET_LABELS}
        />
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">
          ⬇️ Cuentas que ayudaron a utilidad (top 10)
        </h2>
        <p className="text-sm text-muted-foreground mb-3">
          Menos gasto o más ingreso vs run rate 3m.
        </p>
        <MovementsTable
          rows={decreases.slice(0, 10)}
          period={period}
          buckets={ALL_BUCKET_LABELS}
        />
      </section>
    </main>
  );
}

async function NarrativeBlock({
  summary,
}: {
  summary: Awaited<ReturnType<typeof getCrossAccountMovements>>;
}) {
  const narrative = await getCrossAccountNarrative(summary);
  if (!narrative) return null;
  return <MovementsNarrative narrative={narrative} />;
}
