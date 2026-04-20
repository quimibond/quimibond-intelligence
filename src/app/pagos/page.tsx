import { Suspense } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  PageLayout,
  PageHeader,
  SectionNav,
  DataTableToolbar,
} from "@/components/patterns";
import { YearSelector } from "@/components/patterns/year-selector";
import { DataSourceBadge } from "@/components/ui/DataSourceBadge";
import { parseYearParam, type YearValue } from "@/lib/queries/_shared/year-filter";

import { AgingCxCCard } from "./_components/aging-cxc-card";
import { AgingCxPCard } from "./_components/aging-cxp-card";
import { PagosTable } from "./_components/pagos-table";
import { ComplementosMissingTable } from "./_components/complementos-missing-table";

export const revalidate = 60;
export const metadata = { title: "Pagos" };

type SearchParams = Record<string, string | string[] | undefined>;

const PATHNAME = "/pagos";

export default async function PagosPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const year = parseYearParam(sp.year as string | undefined);

  return (
    <PageLayout>
      <PageHeader
        title="Pagos"
        subtitle="Aging CxC/CxP, complementos SAT faltantes y pagos recibidos/enviados"
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <YearSelector />
            <DataSourceBadge
              source="unified"
              coverage="Odoo + SAT complementos"
              refresh="15min"
            />
          </div>
        }
      />

      <SectionNav
        items={[
          { id: "aging", label: "Aging" },
          { id: "complementos", label: "Complementos SAT" },
          { id: "recibidos", label: "Recibidos" },
          { id: "enviados", label: "Enviados" },
        ]}
      />

      {/* Aging CxC + CxP */}
      <section id="aging" className="scroll-mt-24">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Suspense
            fallback={<Skeleton className="h-[200px] rounded-xl" />}
          >
            <AgingCxCCard />
          </Suspense>
          <Suspense
            fallback={<Skeleton className="h-[200px] rounded-xl" />}
          >
            <AgingCxPCard />
          </Suspense>
        </div>
      </section>

      {/* Complementos SAT faltantes */}
      <section id="complementos" className="scroll-mt-24">
        <Card data-table-export-root>
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle className="text-base">Complementos SAT faltantes</CardTitle>
              <p className="text-xs text-muted-foreground">
                Pagos recibidos sin complemento de pago SAT registrado. Afectan la conciliación fiscal.
              </p>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 pb-4">
            <DataTableToolbar
              paramPrefix="comp_"
              searchPlaceholder="Buscar por UUID o descripción…"
              facets={[
                {
                  key: "severity",
                  label: "Severidad",
                  options: [
                    { value: "critical", label: "Crítico" },
                    { value: "high", label: "Alto" },
                    { value: "medium", label: "Medio" },
                  ],
                },
              ]}
            />
            <Suspense
              fallback={
                <div className="space-y-2">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 rounded-lg" />
                  ))}
                </div>
              }
            >
              <ComplementosMissingTableWrapper year={year} searchParams={sp} />
            </Suspense>
          </CardContent>
        </Card>
      </section>

      {/* Pagos recibidos y enviados */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recibidos */}
        <section id="recibidos" className="scroll-mt-24">
          <Card data-table-export-root>
            <CardHeader>
              <CardTitle className="text-base">Pagos recibidos</CardTitle>
              <p className="text-xs text-muted-foreground">
                Complementos SAT de clientes — direction: received
              </p>
            </CardHeader>
            <CardContent className="space-y-3 pb-4">
              <DataTableToolbar
                paramPrefix="rec_"
                searchPlaceholder="Buscar por referencia…"
                dateRange={{ label: "Fecha pago" }}
                facets={[
                  {
                    key: "match_status",
                    label: "Match",
                    options: [
                      { value: "match_uuid", label: "UUID" },
                      { value: "match_composite", label: "Compuesto" },
                      { value: "odoo_only", label: "Solo Odoo" },
                    ],
                  },
                ]}
              />
              <Suspense
                fallback={
                  <div className="space-y-2">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Skeleton key={i} className="h-12 rounded-lg" />
                    ))}
                  </div>
                }
              >
                <PagosTableWrapper
                  direction="received"
                  year={year}
                  searchParams={sp}
                  paramPrefix="rec_"
                  title=""
                />
              </Suspense>
            </CardContent>
          </Card>
        </section>

        {/* Enviados */}
        <section id="enviados" className="scroll-mt-24">
          <Card data-table-export-root>
            <CardHeader>
              <CardTitle className="text-base">Pagos enviados</CardTitle>
              <p className="text-xs text-muted-foreground">
                Pagos a proveedores — direction: issued
              </p>
            </CardHeader>
            <CardContent className="space-y-3 pb-4">
              <DataTableToolbar
                paramPrefix="sen_"
                searchPlaceholder="Buscar por referencia…"
                dateRange={{ label: "Fecha pago" }}
                facets={[
                  {
                    key: "match_status",
                    label: "Match",
                    options: [
                      { value: "match_uuid", label: "UUID" },
                      { value: "match_composite", label: "Compuesto" },
                      { value: "odoo_only", label: "Solo Odoo" },
                    ],
                  },
                ]}
              />
              <Suspense
                fallback={
                  <div className="space-y-2">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Skeleton key={i} className="h-12 rounded-lg" />
                    ))}
                  </div>
                }
              >
                <PagosTableWrapper
                  direction="issued"
                  year={year}
                  searchParams={sp}
                  paramPrefix="sen_"
                  title=""
                />
              </Suspense>
            </CardContent>
          </Card>
        </section>
      </div>
    </PageLayout>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Async sub-components (para que Suspense funcione correctamente)
// ──────────────────────────────────────────────────────────────────────────

async function ComplementosMissingTableWrapper({
  year,
  searchParams,
}: {
  year: YearValue;
  searchParams: SearchParams;
}) {
  return (
    <ComplementosMissingTable
      year={year}
      searchParams={searchParams}
      pathname={PATHNAME}
    />
  );
}

async function PagosTableWrapper({
  direction,
  year,
  searchParams,
  paramPrefix,
  title,
}: {
  direction: "received" | "issued";
  year: YearValue;
  searchParams: SearchParams;
  paramPrefix: string;
  title: string;
}) {
  return (
    <PagosTable
      direction={direction}
      year={year}
      searchParams={searchParams}
      paramPrefix={paramPrefix}
      title={title}
      pathname={PATHNAME}
    />
  );
}
