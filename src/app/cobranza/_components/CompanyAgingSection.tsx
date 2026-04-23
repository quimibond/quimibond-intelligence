import { Inbox } from "lucide-react";
import Link from "next/link";

import {
  AgingBuckets,
  Currency,
  EmptyState,
} from "@/components/patterns";
import type { CompanyAgingRow } from "@/lib/queries/unified/invoices";

interface CompanyAgingSectionProps {
  rows: CompanyAgingRow[];
}

export function CompanyAgingSection({ rows }: CompanyAgingSectionProps) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title="Sin cartera abierta"
        description="No hay clientes con cartera por cobrar."
        compact
      />
    );
  }

  return (
    <ul className="space-y-3">
      {rows.map((r) => {
        const data = {
          current: r.current_amount,
          d1_30: r.overdue_1_30,
          d31_60: r.overdue_31_60,
          d61_90: r.overdue_61_90,
          d90_plus: r.overdue_90plus,
        };
        const label = r.company_name ?? "Sin nombre";
        return (
          <li key={r.company_id} className="rounded-lg border bg-card p-3">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <Link
                href={`/empresas/${r.company_id}`}
                className="font-medium hover:underline focus-visible:outline focus-visible:outline-2"
              >
                {label}
              </Link>
              <span className="text-xs tabular-nums text-muted-foreground">
                Total: <Currency amount={r.total_receivable} />
              </span>
            </div>
            <AgingBuckets
              data={data}
              ariaLabel={`Aging de ${label}`}
              showLegend={false}
            />
          </li>
        );
      })}
    </ul>
  );
}
