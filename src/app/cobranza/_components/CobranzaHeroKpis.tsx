import { AlertTriangle, Calendar, FileText, Flame } from "lucide-react";

import { KpiCard, StatGrid } from "@/components/patterns";
import { getPaymentRiskKpis } from "@/lib/queries/unified/invoices";
import { getCfoSnapshot } from "@/lib/queries/analytics/finance";

export async function CobranzaHeroKpis() {
  const [cfo, paymentRisk] = await Promise.all([
    getCfoSnapshot(),
    getPaymentRiskKpis(),
  ]);

  return (
    <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 4 }}>
      <KpiCard
        title="Cartera vencida"
        value={cfo?.carteraVencida ?? 0}
        format="currency"
        compact
        icon={AlertTriangle}
        subtitle={`${cfo?.clientesMorosos ?? 0} clientes morosos`}
        tone="danger"
      />
      <KpiCard
        title="Cuentas por cobrar"
        value={cfo?.cuentasPorCobrar ?? 0}
        format="currency"
        compact
        icon={FileText}
        subtitle="total AR"
      />
      <KpiCard
        title="Cobros 30d"
        value={cfo?.cobros30d ?? 0}
        format="currency"
        compact
        icon={Calendar}
        tone="success"
      />
      <KpiCard
        title="Riesgo crítico"
        value={paymentRisk.criticalPending}
        format="currency"
        compact
        icon={Flame}
        subtitle={`${paymentRisk.criticalCount} clientes`}
        tone={paymentRisk.criticalCount > 0 ? "danger" : "default"}
      />
    </StatGrid>
  );
}
