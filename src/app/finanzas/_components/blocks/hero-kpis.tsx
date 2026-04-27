import { CalendarClock, CreditCard, Flame, Wallet } from "lucide-react";
import { StatGrid, KpiCard, DriftAlert } from "@/components/patterns";
import { formatCurrencyMXN } from "@/lib/formatters";
import {
  getCashKpis,
  getRunwayKpis,
  getDriftSummary,
} from "@/lib/queries/sp13/finanzas";
import type { HistoryRange } from "@/components/patterns/history-range";

/** F-DRIFT — banner alerta cuando hay drift sin reconciliar significativo. */
export async function DriftBanner({ range }: { range: HistoryRange }) {
  const drift = await getDriftSummary(range);
  if (drift.severity === "info") return null;
  return (
    <DriftAlert
      severity={drift.severity}
      title={drift.title}
      description={drift.description}
      action={{ label: "Ver detalle", href: "/sistema?tab=reconciliacion" }}
    />
  );
}

/** F1 + F2 Hero KPIs — efectivo, deuda, runway cash-only y con AR. */
export async function HeroKpis() {
  const [cash, runway] = await Promise.all([getCashKpis(), getRunwayKpis()]);

  return (
    <StatGrid columns={{ mobile: 2, tablet: 4, desktop: 4 }}>
      <KpiCard
        title="Efectivo total"
        value={cash.efectivoTotalMxn}
        format="currency"
        compact
        icon={Wallet}
        source="canonical"
        tone="default"
        subtitle={`${cash.cashAccountsCount} cuentas efectivo`}
        definition={{
          title: "Efectivo total",
          description: "Suma de saldos en cuentas clasificadas como efectivo.",
          formula: "SUM(current_balance_mxn WHERE classification='cash')",
          table: "canonical_bank_balances",
        }}
      />
      <KpiCard
        title="Deuda tarjetas"
        value={cash.deudaTarjetasMxn}
        format="currency"
        compact
        icon={CreditCard}
        source="canonical"
        tone={cash.deudaTarjetasMxn > 0 ? "danger" : "default"}
        subtitle={`${cash.debtAccountsCount} tarjeta${cash.debtAccountsCount === 1 ? "" : "s"}`}
        definition={{
          title: "Deuda tarjetas",
          description: "Saldo negativo acumulado en cuentas classification='debt'.",
          formula: "ABS(SUM(current_balance_mxn WHERE classification='debt'))",
          table: "canonical_bank_balances",
        }}
      />
      <KpiCard
        title="Runway cash-only"
        value={runway.runwayCashOnlyDays ?? 0}
        format="days"
        icon={Flame}
        source="canonical"
        tone={
          runway.runwayCashOnlyDays != null && runway.runwayCashOnlyDays < 30
            ? "danger"
            : runway.runwayCashOnlyDays != null && runway.runwayCashOnlyDays < 60
              ? "warning"
              : "success"
        }
        subtitle={`burn ${formatCurrencyMXN(runway.burnRateMonthly, { compact: true })}/mes`}
        definition={{
          title: "Runway (solo efectivo)",
          description: "Días de operación con el cash actual al ritmo de gasto de los últimos 90 días.",
          formula: "cash / (avg_monthly_expense / 30)",
          table: "canonical_bank_balances + gold_pl_statement",
        }}
      />
      <KpiCard
        title="Runway con AR"
        value={runway.runwayWithArDays ?? 0}
        format="days"
        icon={CalendarClock}
        source="canonical"
        tone="info"
        subtitle={`suponiendo cobranza de ${formatCurrencyMXN(runway.arOpenMxn, { compact: true })}`}
        definition={{
          title: "Runway con AR",
          description: "Días de operación suponiendo cobranza normal del AR abierto.",
          formula: "(cash + ar_open) / burn_daily",
          table: "canonical_bank_balances + canonical_invoices + gold_pl_statement",
        }}
      />
    </StatGrid>
  );
}
