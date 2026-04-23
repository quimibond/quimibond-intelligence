import { StatusBadge } from "./status-badge";
import { TrendSpark } from "./trend-spark";
import { cn } from "@/lib/utils";

type BlacklistLevel = "none" | "69b_presunto" | "69b_definitivo";

export interface CompanyKpiHeroCanonical {
  id: number;
  display_name: string;
  rfc: string | null;
  has_shadow_flag: boolean;
  blacklist_level: BlacklistLevel;
}

export interface CompanyKpiHero360 {
  canonical_company_id: number;
  lifetime_value_mxn: number;
  revenue_ytd_mxn: number;
  overdue_amount_mxn: number;
  open_company_issues_count: number;
  revenue_90d_mxn: number;
}

interface CompanyKpiHeroProps {
  canonical: CompanyKpiHeroCanonical;
  company360: CompanyKpiHero360;
  trend?: number[];
  className?: string;
}

function fmtMxn(n: number): string {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(n);
}

export function CompanyKpiHero({ canonical, company360, trend, className }: CompanyKpiHeroProps) {
  const kpis: Array<{ label: string; value: string; hint?: string }> = [
    {
      label: "LTV",
      value: fmtMxn(company360.lifetime_value_mxn),
      hint: "Lifetime sin IVA (convención Syntage)",
    },
    { label: "YTD", value: fmtMxn(company360.revenue_ytd_mxn), hint: "Revenue año en curso, sin IVA" },
    { label: "Vencida", value: fmtMxn(company360.overdue_amount_mxn) },
    { label: "Pendientes", value: String(company360.open_company_issues_count) },
  ];

  return (
    <section className={cn("rounded-lg border bg-card p-4 space-y-4", className)}>
      <header className="space-y-1.5">
        <h1 className="text-xl font-semibold leading-tight">{canonical.display_name}</h1>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {canonical.rfc && <span className="font-mono">{canonical.rfc}</span>}
          {canonical.blacklist_level !== "none" && (
            <StatusBadge kind="blacklist" value={canonical.blacklist_level} density="regular" />
          )}
          {canonical.has_shadow_flag && (
            <StatusBadge kind="shadow" value={true} density="regular" />
          )}
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {kpis.map((k) => (
          <figure
            key={k.label}
            className="rounded-md border bg-background p-3"
            title={k.hint}
          >
            <figcaption className="text-xs text-muted-foreground">{k.label}</figcaption>
            <div className="mt-1 text-lg font-semibold tabular-nums">{k.value}</div>
          </figure>
        ))}
      </div>

      {trend && trend.length > 1 && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Revenue 90d</span>
          <TrendSpark values={trend} ariaLabel={`Tendencia de ingresos 90 días (${trend.length} puntos)`} width={100} height={20} />
          <span className="ml-auto tabular-nums text-foreground">{fmtMxn(company360.revenue_90d_mxn)}</span>
        </div>
      )}
    </section>
  );
}
