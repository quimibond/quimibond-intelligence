import { formatCurrencyMXN } from "@/lib/formatters";
import type { AccountExpenseDetail } from "@/lib/queries/sp13/finanzas/account-expense-detail";

const SPANISH_MONTHS_SHORT = [
  "Ene", "Feb", "Mar", "Abr", "May", "Jun",
  "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
];

function shortMonth(period: string): string {
  const [y, m] = period.split("-").map((s) => parseInt(s, 10));
  return `${SPANISH_MONTHS_SHORT[m - 1]} '${String(y).slice(2)}`;
}

export function AccountTrend({ detail }: { detail: AccountExpenseDetail }) {
  const max = Math.max(
    ...detail.trend12m.map((t) => Math.abs(t.balanceMxn)),
    1
  );
  const isCurrentPeriod = (period: string) =>
    period >= detail.fromPeriod && period <= detail.toPeriod;
  return (
    <div className="rounded border bg-card p-4">
      <ul className="space-y-1.5">
        {detail.trend12m.map((t) => {
          const pct = (Math.abs(t.balanceMxn) / max) * 100;
          const current = isCurrentPeriod(t.period);
          return (
            <li
              key={t.period}
              className={`flex items-baseline gap-3 ${current ? "font-semibold" : ""}`}
            >
              <span
                className={`text-xs w-16 shrink-0 ${current ? "text-foreground" : "text-muted-foreground"}`}
              >
                {shortMonth(t.period)}
              </span>
              <div className="flex-1 h-5 bg-muted/30 rounded relative overflow-hidden">
                <div
                  className={`absolute inset-y-0 left-0 ${
                    current ? "bg-primary/80" : "bg-blue-400/60"
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="tabular-nums text-sm w-32 text-right shrink-0">
                {formatCurrencyMXN(t.balanceMxn, { compact: true })}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
