/**
 * Audit 2026-04-27 finding #12: Monte Carlo UI dedicado.
 *
 * Página de "what-if" interactivo. Usa el baseline de getCashProjection
 * + Monte Carlo (sensitivity) para que el operador explore escenarios
 * ajustando multiplicadores por categoría:
 *   "Y si AR cae 20% y AP se acelera 10%?"
 *   "Y si run rate clientes baja 30% por 90d?"
 *
 * Modelo lineal (asume independencia entre categorías). Para feedback
 * loops complejos (ej. AP cancelado → SO cancelada), iterar manualmente.
 *
 * El motor (computeSensitivity con 500 iteraciones aleatorias) ya estaba
 * implementado y se renderea como banda P25/P75 en el chart de proyección.
 * Esta página complementa con escenarios MANUALES dirigidos por el usuario.
 */
import Link from "next/link";

import { PageLayout, PageHeader } from "@/components/patterns";
import {
  computeSensitivity,
  getCashProjection,
  parseProjectionHorizon,
} from "@/lib/queries/sp13/finanzas";

import { ScenarioBuilder } from "./_components/scenario-builder";

export const revalidate = 60;
export const metadata = { title: "Escenarios · Finanzas" };

type SearchParams = Record<string, string | string[] | undefined>;

export default async function ScenariosPage(props: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await props.searchParams;
  const horizon = parseProjectionHorizon(sp?.proj_horizon);

  const projection = await getCashProjection(horizon);
  const sens = computeSensitivity(projection, 500);

  return (
    <PageLayout>
      <PageHeader
        title="Escenarios de cash projection"
        subtitle={`Horizonte ${horizon}d · ajusta multiplicadores por categoría para explorar what-if`}
        breadcrumbs={[
          { label: "Finanzas", href: "/finanzas" },
          { label: "Escenarios" },
        ]}
        actions={
          <div className="flex items-center gap-2 text-xs">
            <Link
              href={`/finanzas/scenarios?proj_horizon=13`}
              className={`rounded px-2 py-1 ${horizon === 13 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
            >
              13d
            </Link>
            <Link
              href={`/finanzas/scenarios?proj_horizon=30`}
              className={`rounded px-2 py-1 ${horizon === 30 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
            >
              30d
            </Link>
            <Link
              href={`/finanzas/scenarios?proj_horizon=90`}
              className={`rounded px-2 py-1 ${horizon === 90 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
            >
              90d
            </Link>
          </div>
        }
      />

      <ScenarioBuilder projection={projection} monteCarlo={sens.monteCarlo} />
    </PageLayout>
  );
}
