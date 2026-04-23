"use client";

import Link from "next/link";
import { Building2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/patterns/status-badge";
import { EmptyState } from "@/components/patterns/empty-state";
import { cn } from "@/lib/utils";

export interface CompanyListRow {
  canonical_company_id: number;
  display_name: string;
  rfc: string | null;
  is_customer: boolean | null;
  is_supplier: boolean | null;
  has_shadow_flag: boolean;
  blacklist_level: "none" | "69b_presunto" | "69b_definitivo";
  lifetime_value_mxn: number | null;
  revenue_ytd_mxn: number | null;
  overdue_amount_mxn: number | null;
  open_company_issues_count: number | null;
}

export interface CompanyListClientProps {
  items: CompanyListRow[];
  hasFilters: boolean;
  className?: string;
}

function fmtMxn(n: number | null | undefined): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(n);
}

export function CompanyListClient({ items, hasFilters, className }: CompanyListClientProps) {
  if (items.length === 0) {
    return hasFilters ? (
      <EmptyState
        icon={Building2}
        title="Sin resultados"
        description="Ajusta los filtros o limpia la búsqueda."
      />
    ) : (
      <EmptyState
        icon={Building2}
        title="Sin empresas"
        description="No hay empresas que mostrar en este momento."
      />
    );
  }

  return (
    <ul role="list" className={cn("flex flex-col gap-2", className)}>
      {items.map((r) => {
        const typeLabel = r.is_customer ? "Cliente" : r.is_supplier ? "Proveedor" : "—";
        return (
          <li key={r.canonical_company_id} role="listitem">
            <Link
              href={`/empresas/${r.canonical_company_id}`}
              className="block focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 rounded-lg"
            >
              <Card className="p-3 transition-shadow hover:shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold leading-snug">
                      {r.display_name}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {r.rfc && <span className="font-mono">{r.rfc}</span>}
                      <span>·</span>
                      <span>{typeLabel}</span>
                      {r.blacklist_level !== "none" && (
                        <StatusBadge kind="blacklist" value={r.blacklist_level} />
                      )}
                      {r.has_shadow_flag && <StatusBadge kind="shadow" value={true} />}
                    </div>
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <div className="opacity-60">LTV</div>
                    <div className="font-semibold tabular-nums">{fmtMxn(r.lifetime_value_mxn)}</div>
                  </div>
                  <div>
                    <div className="opacity-60">YTD</div>
                    <div className="font-semibold tabular-nums">{fmtMxn(r.revenue_ytd_mxn)}</div>
                  </div>
                  <div>
                    <div className="opacity-60">Vencida</div>
                    <div
                      className={cn(
                        "font-semibold tabular-nums",
                        (r.overdue_amount_mxn ?? 0) > 0 && "text-status-critical"
                      )}
                    >
                      {fmtMxn(r.overdue_amount_mxn)}
                    </div>
                  </div>
                </div>
              </Card>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
