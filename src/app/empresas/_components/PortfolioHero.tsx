import { Briefcase, Truck, Moon, ShieldAlert } from "lucide-react";
import { StatGrid, KpiCard } from "@/components/patterns";
import type { SP13PortfolioKpis } from "@/lib/queries/sp13/empresas";

interface PortfolioHeroProps {
  kpis: SP13PortfolioKpis;
}

/**
 * SP13 E1 Hero — distribucion del portafolio.
 *   Clientes activos / Proveedores activos / Dormidos / Blacklist
 */
export function PortfolioHero({ kpis }: PortfolioHeroProps) {
  return (
    <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 4 }}>
      <KpiCard
        title="Clientes activos"
        value={kpis.activeCustomers}
        format="number"
        icon={Briefcase}
        subtitle="con actividad últ. 12m"
      />
      <KpiCard
        title="Proveedores activos"
        value={kpis.activeSuppliers}
        format="number"
        icon={Truck}
        subtitle="con compras últ. 12m"
      />
      <KpiCard
        title="Dormidos"
        value={kpis.dormant}
        format="number"
        icon={Moon}
        subtitle="sin actividad 12m+"
      />
      <KpiCard
        title="Lista negra / riesgo"
        value={kpis.blacklist}
        format="number"
        icon={ShieldAlert}
        subtitle="69B presunto + definitivo"
        tone={kpis.blacklist > 0 ? "danger" : "default"}
      />
    </StatGrid>
  );
}
