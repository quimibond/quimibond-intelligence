import { formatCurrencyMXN } from "@/lib/formatters";
import type { MonthlyReport } from "@/lib/queries/sp13/finanzas/monthly-report";

export function CashHealthSection({ report }: { report: MonthlyReport }) {
  const { cashOpening, arOpen, apOpen, fxNetMxn, arrendamientoFinancieroMxn } =
    report;
  const netWorkingCapital = cashOpening + arOpen - apOpen;

  return (
    <div className="grid md:grid-cols-3 gap-3 text-sm">
      <KpiBox
        label="Cash en bancos"
        value={cashOpening}
        sub="cuentas operativas (clasificación cash)"
      />
      <KpiBox
        label="AR abierto"
        value={arOpen}
        sub="cobranza pendiente al cierre"
        positive
      />
      <KpiBox
        label="AP abierto"
        value={apOpen}
        sub="por pagar a proveedores"
        negative
      />
      <KpiBox
        label="Capital trabajo neto"
        value={netWorkingCapital}
        sub="Cash + AR − AP"
        positive
      />
      <KpiBox
        label="FX neto del mes"
        value={fxNetMxn}
        sub="impacto en utilidad por tipo de cambio"
        signed
      />
      <KpiBox
        label="Arrendamiento Lepezo"
        value={arrendamientoFinancieroMxn}
        sub="costo recurrente del leasing financiero"
        signed
      />
    </div>
  );
}

function KpiBox({
  label,
  value,
  sub,
  positive,
  negative,
  signed,
}: {
  label: string;
  value: number;
  sub: string;
  positive?: boolean;
  negative?: boolean;
  signed?: boolean;
}) {
  let valueColor = "";
  if (signed) {
    valueColor = value >= 0 ? "text-emerald-700" : "text-red-700";
  } else if (positive) {
    valueColor = "text-foreground";
  } else if (negative) {
    valueColor = "text-foreground";
  }
  return (
    <div className="rounded border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${valueColor}`}>
        {signed && value >= 0 ? "+" : ""}
        {formatCurrencyMXN(value, { compact: true })}
      </div>
      <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>
    </div>
  );
}
