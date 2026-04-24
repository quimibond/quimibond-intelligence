import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * F5 — Cash projection día-a-día (probability-weighted).
 *
 * Sources:
 * - `canonical_bank_balances` → saldo inicial (classification='cash').
 * - `cashflow_projection` → pre-computed invoice-level projections with
 *   `collection_probability` derived from aging bucket (fresh 95%, 1-30d
 *   85%, 31-60d 70%, 61-90d 50%, 90+ 25%). We use `expected_amount`
 *   (residual × probability) for inflows and raw `amount_residual` for
 *   outflows (we owe the full thing).
 *
 * flow_type column values:
 *   - `receivable_detail` → AR rows per invoice (inflow)
 *   - `payable_detail`    → AP rows per invoice (outflow)
 *   - `receivable_by_month` → aggregated monthly totals (ignored here)
 *
 * IMPORTANT — past-due invoices:
 * `cashflow_projection.projected_date` = `i.due_date` (original due date).
 * Past-due invoices have projected_date < today. Rather than drop them
 * (losing the overdue AR from the projection), we clamp their date to
 * today. This models "we expect to collect the overdue balance going
 * forward, starting now" — the probability weighting already discounts
 * them (25% for 90+ days overdue) so we don't double-count optimism.
 *
 * Markers: cualquier flujo ≥ 50k MXN se emite como marker visible.
 */
export interface CashProjectionPoint {
  date: string;
  balance: number;
  inflow: number;
  outflow: number;
}

export interface CashProjectionMarker {
  date: string;
  kind: "inflow" | "outflow";
  amount: number;
  label: string;
  companyId: number | null;
  probability: number | null;
  atRisk: boolean;
}

export interface CashProjection {
  horizonDays: number;
  openingBalance: number;
  minBalance: number;
  minBalanceDate: string;
  closingBalance: number;
  totalInflow: number;
  totalOutflow: number;
  totalInflowNominal: number;
  avgCollectionProbability: number | null;
  overdueInflowCount: number;
  safetyFloor: number;
  points: CashProjectionPoint[];
  markers: CashProjectionMarker[];
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function _getCashProjectionRaw(horizonDays: number): Promise<CashProjection> {
  const sb = getServiceClient();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIso = toIso(today);
  const endDate = new Date(today.getTime() + horizonDays * 86400000);
  const endIso = toIso(endDate);

  const [cashRes, projRes] = await Promise.all([
    sb
      .from("canonical_bank_balances")
      .select("classification, current_balance_mxn"),
    // Include ALL past-due invoices + future invoices up to horizon. Past-due
    // dates get clamped to today below (we expect to collect them going
    // forward, already probability-weighted by aging bucket).
    sb
      .from("cashflow_projection")
      .select(
        "company_id, flow_type, projected_date, amount_residual, expected_amount, collection_probability, invoice_name, days_overdue"
      )
      .in("flow_type", ["receivable_detail", "payable_detail"])
      .lte("projected_date", endIso),
  ]);

  type Bank = { classification: string | null; current_balance_mxn: number | null };
  const banks = (cashRes.data ?? []) as Bank[];
  const opening = banks
    .filter((b) => b.classification === "cash")
    .reduce((s, b) => s + (Number(b.current_balance_mxn) || 0), 0);

  type ProjRow = {
    company_id: number | null;
    flow_type: string | null;
    projected_date: string | null;
    amount_residual: number | null;
    expected_amount: number | null;
    collection_probability: number | null;
    invoice_name: string | null;
    days_overdue: number | null;
  };
  const projRows = (projRes.data ?? []) as ProjRow[];

  const inflowByDay = new Map<string, number>();
  const outflowByDay = new Map<string, number>();
  const markers: CashProjectionMarker[] = [];
  const MARKER_THRESHOLD = 50000;

  let totalInflow = 0;
  let totalOutflow = 0;
  let totalInflowNominal = 0;
  let probSum = 0;
  let probCount = 0;
  let overdueInflowCount = 0;

  for (const r of projRows) {
    const origDate = r.projected_date;
    if (!origDate) continue;
    // Clamp past-due dates to today — we still expect to collect these,
    // starting from now. The expected_amount is already discounted by aging
    // bucket so we're not over-counting.
    const date = origDate < todayIso ? todayIso : origDate;
    const isInflow = r.flow_type === "receivable_detail";
    const nominal = Number(r.amount_residual) || 0;
    const expected = Number(r.expected_amount ?? r.amount_residual) || 0;
    if (expected <= 0) continue;

    if (isInflow) {
      inflowByDay.set(date, (inflowByDay.get(date) ?? 0) + expected);
      totalInflow += expected;
      totalInflowNominal += nominal;
      if (r.collection_probability != null) {
        probSum += Number(r.collection_probability);
        probCount++;
      }
      if ((r.days_overdue ?? 0) > 0) overdueInflowCount++;
    } else {
      // AP is paid in full (no probability weighting — you still owe it).
      // Past-due AP also clamps to today (we owe now, already late).
      outflowByDay.set(date, (outflowByDay.get(date) ?? 0) + nominal);
      totalOutflow += nominal;
    }

    const amtForMarker = isInflow ? expected : nominal;
    if (amtForMarker >= MARKER_THRESHOLD) {
      markers.push({
        date,
        kind: isInflow ? "inflow" : "outflow",
        amount: amtForMarker,
        label: r.invoice_name ?? "",
        companyId: r.company_id,
        probability:
          r.collection_probability == null
            ? null
            : Number(r.collection_probability),
        atRisk: isInflow && (r.days_overdue ?? 0) > 0,
      });
    }
  }

  const points: CashProjectionPoint[] = [];
  let running = opening;
  let minBal = opening;
  let minDate = todayIso;

  for (let i = 0; i <= horizonDays; i++) {
    const d = new Date(today.getTime() + i * 86400000);
    const iso = toIso(d);
    const inflow = inflowByDay.get(iso) ?? 0;
    const outflow = outflowByDay.get(iso) ?? 0;
    running += inflow - outflow;
    if (running < minBal) {
      minBal = running;
      minDate = iso;
    }
    points.push({ date: iso, balance: Math.round(running), inflow, outflow });
  }

  markers.sort((a, b) => a.date.localeCompare(b.date));

  return {
    horizonDays,
    openingBalance: Math.round(opening),
    closingBalance: points.at(-1)?.balance ?? Math.round(opening),
    minBalance: Math.round(minBal),
    minBalanceDate: minDate,
    totalInflow: Math.round(totalInflow),
    totalOutflow: Math.round(totalOutflow),
    totalInflowNominal: Math.round(totalInflowNominal),
    avgCollectionProbability:
      probCount > 0 ? Math.round((probSum / probCount) * 100) / 100 : null,
    overdueInflowCount,
    safetyFloor: 500000,
    points,
    markers: markers.slice(0, 40),
  };
}

export const getCashProjection = unstable_cache(
  _getCashProjectionRaw,
  ["sp13-finanzas-cash-projection-v2"],
  { revalidate: 60, tags: ["finanzas"] }
);

export type CashProjectionHorizon = 13 | 30 | 90;

export function parseProjectionHorizon(
  raw: string | string[] | undefined,
  fallback: CashProjectionHorizon = 13
): CashProjectionHorizon {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const n = v ? parseInt(v, 10) : NaN;
  if (n === 13 || n === 30 || n === 90) return n;
  return fallback;
}
