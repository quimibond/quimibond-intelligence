import { AlertTriangle, Flame, FileText, Clock } from "lucide-react";

import { KpiCard, StatGrid } from "@/components/patterns";
import { getArKpis } from "@/lib/queries/sp13/cobranza";

const OVERDUE_WARN_PCT = 20;

export async function ArHeroKpis() {
  const k = await getArKpis();
  const overduePct = k.totalMxn > 0 ? (k.overdueMxn / k.totalMxn) * 100 : 0;
  const overdueTone = overduePct > OVERDUE_WARN_PCT ? "warning" : "default";

  return (
    <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 4 }}>
      <KpiCard
        title="AR total"
        value={k.totalMxn}
        format="currency"
        compact
        icon={FileText}
        subtitle={`${k.totalCount} facturas abiertas`}
      />
      <KpiCard
        title="AR vencido"
        value={k.overdueMxn}
        format="currency"
        compact
        icon={AlertTriangle}
        subtitle={`${k.overdueCount} facturas · ${overduePct.toFixed(0)}% del total`}
        tone={overdueTone}
      />
      <KpiCard
        title="90+ días"
        value={k.overdue90plusMxn}
        format="currency"
        compact
        icon={Flame}
        subtitle={`${k.overdue90plusCount} facturas`}
        tone={k.overdue90plusMxn > 0 ? "danger" : "default"}
      />
      <KpiCard
        title="DSO"
        value={k.dsoDays ?? "—"}
        format="days"
        icon={Clock}
        subtitle="Días venta pendientes"
      />
    </StatGrid>
  );
}
