import { Suspense } from "react";

import { PageLayout, PageHeader, KpiCard, StatGrid } from "@/components/patterns";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCurrencyMXN } from "@/lib/formatters";

import {
  getCloseSnapshot,
  CLOSE_WORKSTREAMS,
  type CloseSnapshot,
} from "@/lib/queries/sp13/finanzas/cierre-inventario";
import {
  getAllPendingActions,
  type OdooPendingAction,
} from "@/lib/queries/sp13/odoo-pending-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cierre de inventario — Quimibond" };

export default function CierreInventarioPage() {
  return (
    <PageLayout>
      <PageHeader
        title="Cierre de inventario limpio"
        subtitle="El número norte: contabilidad = físico × costo, al centavo. Auditoría 2026-07-02 → congelar → realinear → contar → revaluar → vigilar"
      />
      <Suspense fallback={<Skeleton className="h-[700px] w-full rounded-lg" />}>
        <Block />
      </Suspense>
    </PageLayout>
  );
}

async function Block() {
  const [snapshot, actions] = await Promise.all([
    getCloseSnapshot(),
    getAllPendingActions(),
  ]);
  const byKey = new Map(actions.map((a) => [a.actionKey, a]));
  return (
    <div className="space-y-8">
      <NorthStar snapshot={snapshot} />
      <BucketTable snapshot={snapshot} />
      <Workstreams byKey={byKey} />
      <Alarms snapshot={snapshot} />
    </div>
  );
}

function NorthStar({ snapshot }: { snapshot: CloseSnapshot }) {
  const done = snapshot.totalDriftAbs < 50_000;
  return (
    <StatGrid columns={{ mobile: 2, desktop: 4 }}>
      <KpiCard
        title="Drift total |GL − físico|"
        value={snapshot.totalDriftAbs}
        format="currency"
        compact
        tone={done ? "success" : "danger"}
        subtitle={done ? "CUADRADO ✓" : "Meta: $0.00"}
      />
      <KpiCard
        title="Inventario en contabilidad"
        value={snapshot.totalGl}
        format="currency"
        compact
        subtitle="GL 115.* acumulado"
      />
      <KpiCard
        title="Inventario físico (AVCO)"
        value={snapshot.totalFisico}
        format="currency"
        compact
        subtitle="Σ stock × avg_cost (Odoo)"
      />
      <KpiCard
        title="Alarmas activas"
        value={snapshot.alarms.length}
        format="number"
        tone={snapshot.alarms.length === 0 ? "success" : "warning"}
        subtitle="CAPA · 999998 · 501.01.02 · negativos"
      />
    </StatGrid>
  );
}

function BucketTable({ snapshot }: { snapshot: CloseSnapshot }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
        Cuadre por cuenta
      </h2>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="px-3 py-2">Bucket</th>
              <th className="px-3 py-2">Cuenta(s)</th>
              <th className="px-3 py-2 text-right">Contabilidad (GL)</th>
              <th className="px-3 py-2 text-right">Físico × costo</th>
              <th className="px-3 py-2 text-right">Drift</th>
              <th className="px-3 py-2 text-right">SKUs</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.buckets.map((b) => {
              const ok = Math.abs(b.driftMxn) < 50_000;
              return (
                <tr key={b.bucket} className="border-t">
                  <td className="px-3 py-2 font-medium">{b.bucket}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {b.cuentas}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatCurrencyMXN(b.glMxn)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatCurrencyMXN(b.fisicoMxn)}
                  </td>
                  <td
                    className={`px-3 py-2 text-right tabular-nums font-semibold ${
                      ok
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-red-600 dark:text-red-400"
                    }`}
                  >
                    {formatCurrencyMXN(b.driftMxn)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {b.skus || "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        El drift de WIP+Semiterminados incluye el CAPA estacionado ($13.5M) y
        el de 115.01.01 el hueco del switch de categorías — ambos caen con las
        fases 1-2 del plan. Detalle y evidencia: auditoría 2026-07-02.
      </p>
    </section>
  );
}

const STATUS_STYLE: Record<string, string> = {
  open: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  in_progress:
    "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  resolved:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  wont_fix: "bg-muted text-muted-foreground",
};
const STATUS_LABEL: Record<string, string> = {
  open: "Pendiente",
  in_progress: "En curso",
  resolved: "Hecho ✓",
  wont_fix: "Descartado",
};

function Workstreams({
  byKey,
}: {
  byKey: Map<string, OdooPendingAction>;
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
        Workstreams del cierre (en orden de ejecución)
      </h2>
      <div className="grid gap-2 md:grid-cols-2">
        {CLOSE_WORKSTREAMS.map((w) => {
          const a = byKey.get(w.actionKey);
          const status = a?.status ?? "open";
          return (
            <a
              key={w.actionKey}
              href={`/sistema/odoo-pendientes#${w.actionKey}`}
              className="flex items-center justify-between gap-3 rounded-lg border bg-card p-3 hover:bg-muted/40 transition-colors"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{w.paso}</div>
                <div className="text-xs text-muted-foreground">
                  {w.fase}
                  {a?.assignee ? ` · ${a.assignee}` : ""}
                  {a?.estimatedImpactMxn
                    ? ` · ${formatCurrencyMXN(a.estimatedImpactMxn, { compact: true })}`
                    : ""}
                </div>
              </div>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[status]}`}
              >
                {STATUS_LABEL[status]}
              </span>
            </a>
          );
        })}
      </div>
    </section>
  );
}

function Alarms({ snapshot }: { snapshot: CloseSnapshot }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
        Alarmas de reincidencia (últimos 30 días)
      </h2>
      {snapshot.alarms.length === 0 ? (
        <div className="rounded-lg border border-emerald-300/50 bg-emerald-50 dark:bg-emerald-950/30 p-4 text-sm text-emerald-700 dark:text-emerald-300">
          Sin reincidencias: nadie ha posteado en CAPA, movido 999998 ni
          tocado 501.01.02, y ninguna cuenta 115 está negativa. Las guardias
          corren cada hora.
        </div>
      ) : (
        <div className="space-y-2">
          {snapshot.alarms.map((a) => (
            <div
              key={a.alarma}
              className={`rounded-lg border p-3 text-sm ${
                a.severidad === "critical"
                  ? "border-red-300/60 bg-red-50 dark:bg-red-950/30"
                  : "border-amber-300/60 bg-amber-50 dark:bg-amber-950/30"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium">{a.alarma}</span>
                <span className="tabular-nums font-semibold">
                  {formatCurrencyMXN(a.valorMxn)}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{a.detalle}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
