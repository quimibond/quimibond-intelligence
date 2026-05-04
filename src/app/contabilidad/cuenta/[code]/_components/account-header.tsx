import { formatCurrencyMXN } from "@/lib/formatters";
import type { AccountExpenseDetail } from "@/lib/queries/sp13/finanzas/account-expense-detail";

const SPANISH_MONTHS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function periodLabel(p: string): string {
  const [y, m] = p.split("-").map((s) => parseInt(s, 10));
  return `${SPANISH_MONTHS[m - 1]} ${y}`;
}

export function AccountHeader({ detail }: { detail: AccountExpenseDetail }) {
  const change = detail.changeVsAvgPct;
  const isHigh = change != null && change > 30;
  const isLow = change != null && change < -30;

  return (
    <header className="border-b pb-5">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        Cuenta GL · {detail.accountType ?? "—"}
      </p>
      <h1 className="text-2xl font-bold mt-1">
        <span className="font-mono text-lg">{detail.accountCode}</span>{" "}
        <span>{detail.accountName ?? ""}</span>
      </h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">
        <Kpi
          label={
            detail.fromPeriod === detail.toPeriod
              ? periodLabel(detail.fromPeriod)
              : `${periodLabel(detail.fromPeriod)} – ${periodLabel(detail.toPeriod)}`
          }
          value={formatCurrencyMXN(detail.totalMxn, { compact: true })}
        />
        <Kpi
          label="Promedio últimos 3m cerrados"
          value={formatCurrencyMXN(detail.avgRecent3mMxn, { compact: true })}
        />
        <Kpi
          label="vs run rate 3m"
          value={
            change == null
              ? "—"
              : `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`
          }
          tone={isHigh ? "warning" : isLow ? "info" : "neutral"}
          sub={
            isHigh
              ? "⚠ atípicamente alto"
              : isLow
                ? "atípicamente bajo"
                : undefined
          }
        />
        <Kpi
          label="Proveedores únicos"
          value={String(detail.vendors.length)}
          sub={
            detail.vendors.length > 0 && detail.vendors[0]
              ? `top: ${detail.vendors[0].vendorName.slice(0, 25)}`
              : undefined
          }
        />
      </div>
    </header>
  );
}

function Kpi({
  label,
  value,
  tone,
  sub,
}: {
  label: string;
  value: string;
  tone?: "warning" | "info" | "neutral";
  sub?: string;
}) {
  const valueColor =
    tone === "warning"
      ? "text-amber-700"
      : tone === "info"
        ? "text-blue-700"
        : "";
  return (
    <div className="rounded border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${valueColor}`}>
        {value}
      </div>
      {sub ? (
        <div className="text-xs text-muted-foreground mt-0.5 capitalize truncate">
          {sub}
        </div>
      ) : null}
    </div>
  );
}
