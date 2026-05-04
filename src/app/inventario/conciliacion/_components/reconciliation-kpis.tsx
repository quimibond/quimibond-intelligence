import { formatCurrencyMXN } from "@/lib/formatters";
import type { InventoryReconciliation } from "@/lib/queries/sp13/finanzas/inventory-reconciliation";

export function ReconciliationKpis({
  recon,
}: {
  recon: InventoryReconciliation;
}) {
  const driftAlert = Math.abs(recon.drift) > 1_000_000;
  const driftColor =
    Math.abs(recon.drift) < 500_000
      ? "text-emerald-700"
      : driftAlert
        ? "text-red-700"
        : "text-amber-700";

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <Kpi
        label="Book inventory"
        value={formatCurrencyMXN(recon.bookTotal, { compact: true })}
        sub={`Σ saldos 115.x al cierre de ${recon.asOfPeriod}`}
      />
      <Kpi
        label="Físico (qty × avg_cost)"
        value={formatCurrencyMXN(recon.physicalTotal, { compact: true })}
        sub={`${recon.skusWithStock} SKUs con stock > 0`}
      />
      <Kpi
        label="Drift (físico − book)"
        value={
          (recon.drift >= 0 ? "+" : "") +
          formatCurrencyMXN(recon.drift, { compact: true })
        }
        sub={
          recon.driftPct == null
            ? ""
            : `${recon.driftPct >= 0 ? "+" : ""}${recon.driftPct.toFixed(1)}% vs book`
        }
        valueColor={driftColor}
      />
      <Kpi
        label="SKUs sin avg_cost"
        value={String(recon.skusWithStockNoCost)}
        sub={
          recon.skusWithStockNoCost > 0
            ? "⚠ no contribuyen al físico calculado"
            : "todos los SKUs con stock tienen costo"
        }
        valueColor={
          recon.skusWithStockNoCost > 0 ? "text-amber-700" : "text-emerald-700"
        }
      />
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  valueColor,
}: {
  label: string;
  value: string;
  sub: string;
  valueColor?: string;
}) {
  return (
    <div className="rounded border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={`text-lg font-semibold tabular-nums ${valueColor ?? ""}`}
      >
        {value}
      </div>
      <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>
    </div>
  );
}
