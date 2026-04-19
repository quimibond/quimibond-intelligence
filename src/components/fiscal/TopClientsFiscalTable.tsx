import { type TopClientFiscalRow } from "@/lib/queries/fiscal-historical";
import { formatCurrencyMXN } from "@/lib/formatters";

function YoYBadge({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-muted-foreground">—</span>;
  const isPos = pct >= 0;
  return (
    <span
      className={`tabular-nums font-semibold ${
        isPos ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
      }`}
    >
      {isPos ? "+" : ""}
      {pct.toFixed(1)}%
    </span>
  );
}

interface Props {
  rows: TopClientFiscalRow[];
}

/**
 * Top clients fiscal lifetime table — reusable on /system and /companies/[id].
 * Pure client-data-driven component (caller fetches rows).
 */
export function TopClientsFiscalTable({ rows }: Props) {
  if (!rows.length) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        Sin datos en syntage_top_clients_fiscal_lifetime.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-3 py-2 text-left">Cliente</th>
            <th className="px-3 py-2 text-right">Lifetime</th>
            <th className="px-3 py-2 text-right">12m</th>
            <th className="hidden px-3 py-2 text-right sm:table-cell">YoY</th>
            <th className="hidden px-3 py-2 text-right md:table-cell">Canc. %</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.rfc ?? i} className="border-t hover:bg-muted/20">
              <td className="px-3 py-2">
                <div className="font-medium leading-tight">{r.name ?? "—"}</div>
                {r.rfc && (
                  <div className="text-[10px] font-mono text-muted-foreground">{r.rfc}</div>
                )}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatCurrencyMXN(r.lifetime_revenue_mxn, { compact: true })}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatCurrencyMXN(r.revenue_12m_mxn, { compact: true })}
              </td>
              <td className="hidden px-3 py-2 text-right sm:table-cell">
                <YoYBadge pct={r.yoy_pct ?? null} />
              </td>
              <td className="hidden px-3 py-2 text-right tabular-nums md:table-cell text-muted-foreground">
                {r.cancellation_rate_pct != null
                  ? `${r.cancellation_rate_pct.toFixed(1)}%`
                  : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
