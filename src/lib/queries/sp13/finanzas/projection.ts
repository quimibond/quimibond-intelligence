import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * F5 — Cash projection día-a-día para los próximos N días.
 *
 * Algoritmo:
 *  - Saldo inicial = sum(canonical_bank_balances.classification=cash).
 *  - Entradas: residual de canonical_invoices.direction=issued con due_date ∈ [today, today+N].
 *  - Salidas: residual de canonical_invoices.direction=received con due_date ∈ [today, today+N].
 *  - Iterate day-by-day, acumulando el saldo.
 *
 * Markers: toda entrada/salida con residual > 50k se emite como marker.
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
}

export interface CashProjection {
  horizonDays: number;
  openingBalance: number;
  minBalance: number;
  minBalanceDate: string;
  closingBalance: number;
  totalInflow: number;
  totalOutflow: number;
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

  const [cashRes, arRes, apRes] = await Promise.all([
    sb
      .from("canonical_bank_balances")
      .select("classification, current_balance_mxn"),
    sb
      .from("canonical_invoices")
      .select(
        "canonical_id, receptor_canonical_company_id, amount_residual_mxn_resolved, amount_residual_mxn_odoo, due_date_resolved, due_date_odoo, odoo_name"
      )
      .eq("direction", "issued")
      .neq("estado_sat", "cancelado")
      .eq("state_odoo", "posted")
      .in("payment_state_odoo", ["not_paid", "partial"])
      .or("amount_residual_mxn_resolved.gt.0,amount_residual_mxn_odoo.gt.0")
      .gte("due_date_odoo", todayIso)
      .lte("due_date_odoo", endIso),
    sb
      .from("canonical_invoices")
      .select(
        "canonical_id, emisor_canonical_company_id, amount_residual_mxn_resolved, amount_residual_mxn_odoo, due_date_resolved, due_date_odoo, odoo_name"
      )
      .eq("direction", "received")
      .neq("estado_sat", "cancelado")
      .eq("state_odoo", "posted")
      .in("payment_state_odoo", ["not_paid", "partial"])
      .or("amount_residual_mxn_resolved.gt.0,amount_residual_mxn_odoo.gt.0")
      .gte("due_date_odoo", todayIso)
      .lte("due_date_odoo", endIso),
  ]);

  type Bank = { classification: string | null; current_balance_mxn: number | null };
  const banks = (cashRes.data ?? []) as Bank[];
  const opening = banks
    .filter((b) => b.classification === "cash")
    .reduce((s, b) => s + (Number(b.current_balance_mxn) || 0), 0);

  type InvoiceMovement = {
    canonical_id: string;
    receptor_canonical_company_id?: number | null;
    emisor_canonical_company_id?: number | null;
    amount_residual_mxn_resolved: number | null;
    amount_residual_mxn_odoo: number | null;
    due_date_resolved: string | null;
    due_date_odoo: string | null;
    odoo_name: string | null;
  };
  const arRows = (arRes.data ?? []) as InvoiceMovement[];
  const apRows = (apRes.data ?? []) as InvoiceMovement[];

  const inflowByDay = new Map<string, number>();
  const outflowByDay = new Map<string, number>();
  const markers: CashProjectionMarker[] = [];
  const MARKER_THRESHOLD = 50000;

  for (const r of arRows) {
    const due = r.due_date_odoo ?? r.due_date_resolved;
    if (!due) continue;
    const amt = Number(r.amount_residual_mxn_resolved ?? r.amount_residual_mxn_odoo) || 0;
    if (amt <= 0) continue;
    inflowByDay.set(due, (inflowByDay.get(due) ?? 0) + amt);
    if (amt >= MARKER_THRESHOLD) {
      markers.push({
        date: due,
        kind: "inflow",
        amount: amt,
        label: r.odoo_name ?? r.canonical_id,
        companyId: r.receptor_canonical_company_id ?? null,
      });
    }
  }
  for (const r of apRows) {
    const due = r.due_date_odoo ?? r.due_date_resolved;
    if (!due) continue;
    const amt = Number(r.amount_residual_mxn_resolved ?? r.amount_residual_mxn_odoo) || 0;
    if (amt <= 0) continue;
    outflowByDay.set(due, (outflowByDay.get(due) ?? 0) + amt);
    if (amt >= MARKER_THRESHOLD) {
      markers.push({
        date: due,
        kind: "outflow",
        amount: amt,
        label: r.odoo_name ?? r.canonical_id,
        companyId: r.emisor_canonical_company_id ?? null,
      });
    }
  }

  const points: CashProjectionPoint[] = [];
  let running = opening;
  let minBal = opening;
  let minDate = todayIso;
  let totalIn = 0;
  let totalOut = 0;

  for (let i = 0; i <= horizonDays; i++) {
    const d = new Date(today.getTime() + i * 86400000);
    const iso = toIso(d);
    const inflow = inflowByDay.get(iso) ?? 0;
    const outflow = outflowByDay.get(iso) ?? 0;
    running += inflow - outflow;
    totalIn += inflow;
    totalOut += outflow;
    if (running < minBal) {
      minBal = running;
      minDate = iso;
    }
    points.push({ date: iso, balance: Math.round(running), inflow, outflow });
  }

  // Sort markers by date so the UI can render them in order
  markers.sort((a, b) => a.date.localeCompare(b.date));

  return {
    horizonDays,
    openingBalance: Math.round(opening),
    closingBalance: points.at(-1)?.balance ?? Math.round(opening),
    minBalance: Math.round(minBal),
    minBalanceDate: minDate,
    totalInflow: Math.round(totalIn),
    totalOutflow: Math.round(totalOut),
    // Floor configurable; 500k MXN es el buffer mínimo para nómina/urgencias.
    safetyFloor: 500000,
    points,
    markers: markers.slice(0, 40),
  };
}

export const getCashProjection = unstable_cache(
  _getCashProjectionRaw,
  ["sp13-finanzas-cash-projection"],
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
