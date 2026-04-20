import { Suspense } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { DataSourceBadge } from "@/components/ui/DataSourceBadge";
import { SeverityBadge } from "@/components/patterns/severity-badge";
import { DateDisplay, Currency } from "@/components/patterns";
import { CompanyReconciliationTab } from "@/components/domain/system/CompanyReconciliationTab";
import { FiscalCompanyProfileCard } from "@/components/domain/fiscal/FiscalCompanyProfileCard";
import { getCustomer360 } from "@/lib/queries/analytics/customer-360";

// Note: Card/CardContent/CardHeader/CardTitle used in FiscalSummary360Section

interface Props {
  companyId: number;
}

// ──────────────────────────────────────────────────────────────────────────
// Fiscal summary from customer_360
// ──────────────────────────────────────────────────────────────────────────
async function FiscalSummary360Section({ companyId }: { companyId: number }) {
  const c360 = await getCustomer360(companyId);
  if (!c360) return null;

  const hasAnyData =
    c360.fiscal_issues_open != null ||
    c360.cancellation_rate != null ||
    c360.first_cfdi != null ||
    c360.fiscal_lifetime_revenue_mxn != null;

  if (!hasAnyData) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">Estado fiscal SAT</CardTitle>
          <DataSourceBadge source="syntage" />
        </div>
      </CardHeader>
      <CardContent className="space-y-1.5 text-sm">
        {c360.fiscal_issues_open != null && (
          <div className="flex items-center justify-between py-1.5 border-b last:border-0">
            <span className="text-muted-foreground">Issues abiertos</span>
            <div className="flex items-center gap-2">
              {(c360.fiscal_issues_critical ?? 0) > 0 && (
                <SeverityBadge level="critical" />
              )}
              <span className="tabular-nums font-medium">
                {c360.fiscal_issues_open}
              </span>
            </div>
          </div>
        )}
        {c360.cancellation_rate != null && (
          <div className="flex items-center justify-between py-1.5 border-b last:border-0">
            <span className="text-muted-foreground">Tasa de cancelación</span>
            <span className="tabular-nums font-medium">
              {(c360.cancellation_rate * 100).toFixed(1)}%
            </span>
          </div>
        )}
        {c360.fiscal_lifetime_revenue_mxn != null && (
          <div className="flex items-center justify-between py-1.5 border-b last:border-0">
            <span className="text-muted-foreground">Revenue lifetime SAT</span>
            <Currency amount={c360.fiscal_lifetime_revenue_mxn} compact />
          </div>
        )}
        {c360.first_cfdi && (
          <div className="flex items-center justify-between py-1.5 border-b last:border-0">
            <span className="text-muted-foreground">Primer CFDI</span>
            <DateDisplay date={c360.first_cfdi} />
          </div>
        )}
        {c360.last_cfdi && (
          <div className="flex items-center justify-between py-1.5 last:border-0">
            <span className="text-muted-foreground">Último CFDI</span>
            <DateDisplay date={c360.last_cfdi} relative />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Fiscal tab — main export
// ──────────────────────────────────────────────────────────────────────────
export function FiscalTab({ companyId }: Props) {
  return (
    <div className="space-y-4">
      <Suspense fallback={<Skeleton className="h-32 rounded-xl" />}>
        <FiscalSummary360Section companyId={companyId} />
      </Suspense>

      <div className="space-y-1">
        <div className="flex items-center justify-end">
          <DataSourceBadge source="syntage" />
        </div>
        <Suspense fallback={<Skeleton className="h-64 rounded-xl" />}>
          <CompanyReconciliationTab companyId={companyId} />
        </Suspense>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-end">
          <DataSourceBadge source="syntage" />
        </div>
        <Suspense fallback={<Skeleton className="h-64 rounded-xl" />}>
          <FiscalCompanyProfileCard companyId={companyId} />
        </Suspense>
      </div>
    </div>
  );
}
