import { FileSearch } from "lucide-react";

import {
  CompanyLink,
  Currency,
  DateDisplay,
  EmptyState,
} from "@/components/patterns";
import {
  getOverdueInvoicesPage,
  getOverdueSalespeopleOptions,
} from "@/lib/queries/unified/invoices";

import { OverdueFilterBar, type OverdueFilterParams } from "./OverdueFilterBar";

export interface OverdueSectionParams extends OverdueFilterParams {
  page: number;
  limit: number;
}

interface OverdueSectionProps {
  params: OverdueSectionParams;
}

export async function OverdueSection({ params }: OverdueSectionProps) {
  // URL aging value passes straight through to helper bucket — Task 1 added
  // "90+" support to the dispatcher, so no client-side translation is needed.
  const bucket = params.aging ? [params.aging] : undefined;

  const [page, salespeopleOptions] = await Promise.all([
    getOverdueInvoicesPage({
      page: params.page,
      size: params.limit,
      q: params.q,
      bucket,
      salesperson: params.salesperson ? [params.salesperson] : undefined,
      sortDir: "desc",
      facets: {},
    }),
    getOverdueSalespeopleOptions(),
  ]);

  return (
    <div className="space-y-3">
      <OverdueFilterBar params={params} salespeopleOptions={salespeopleOptions} />

      {page.rows.length === 0 ? (
        <EmptyState
          icon={FileSearch}
          title="Sin facturas vencidas"
          description="Ninguna factura coincide con los filtros."
          compact
        />
      ) : (
        <ul className="space-y-2">
          {page.rows.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-start gap-x-4 gap-y-1 rounded-lg border bg-card p-3"
            >
              <div className="min-w-0 flex-1">
                <div className="font-medium tabular-nums">{r.name ?? "—"}</div>
                <div className="text-xs text-muted-foreground">
                  {r.company_id != null ? (
                    <CompanyLink companyId={r.company_id} name={r.company_name ?? ""} />
                  ) : (
                    r.company_name ?? "—"
                  )}
                </div>
              </div>
              <div className="text-right">
                <div className="font-semibold tabular-nums">
                  <Currency amount={r.amount_residual_mxn} />
                </div>
                <div className="text-xs text-muted-foreground">
                  Vence <DateDisplay date={r.due_date} /> ·{" "}
                  {r.days_overdue ?? 0}d vencida
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">
        Mostrando {page.rows.length} de {page.total}
      </p>
    </div>
  );
}
