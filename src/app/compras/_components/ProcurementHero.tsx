import { Banknote, FileBox, ShieldAlert, Users } from "lucide-react";
import { StatGrid, KpiCard } from "@/components/patterns";
import type { SP13ProcurementKpis } from "@/lib/queries/sp13/compras";

interface Props {
  kpis: SP13ProcurementKpis;
  rangeLabel: string;
}

/**
 * SP13 E1 Hero — distribución de compras.
 *   Spend (período) / Proveedores activos / OCs abiertas / Single-source
 */
export function ProcurementHero({ kpis, rangeLabel }: Props) {
  return (
    <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 4 }}>
      <KpiCard
        title="Compras"
        value={kpis.spend}
        format="currency"
        compact
        icon={Banknote}
        subtitle={rangeLabel}
        comparison={
          kpis.spendPrev > 0
            ? {
                label: "vs período previo",
                priorValue: kpis.spendPrev,
                delta: kpis.spend - kpis.spendPrev,
                deltaPct: kpis.trendPct,
                direction:
                  kpis.trendPct > 1 ? "up" : kpis.trendPct < -1 ? "down" : "flat",
              }
            : null
        }
      />
      <KpiCard
        title="Proveedores activos"
        value={kpis.activeSuppliers}
        format="number"
        icon={Users}
        subtitle="con pago últ. 12m"
      />
      <KpiCard
        title="OCs abiertas"
        value={kpis.openPos}
        format="number"
        icon={FileBox}
        subtitle="draft / sent / approved / purchase"
      />
      <KpiCard
        title="Riesgo proveedor único"
        value={kpis.singleSourceSpend}
        format="currency"
        compact
        icon={ShieldAlert}
        subtitle="Detalle abajo"
        tone={kpis.singleSourceSpend > 0 ? "warning" : "default"}
      />
    </StatGrid>
  );
}
