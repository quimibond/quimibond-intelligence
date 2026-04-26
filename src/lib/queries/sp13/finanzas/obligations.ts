import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * F-OBL — Vista única de obligaciones totales.
 *
 * Consolida saldos acumulados de pasivos al cierre del último mes cerrado.
 * Source: RPC `get_obligations_summary` que suma SUM(balance) hasta el corte
 * (canonical_account_balances almacena movimientos por mes).
 *
 * Categorías y horizonte de pago:
 *   - tarjetas         (204.*)              — inmediato
 *   - sueldos          (210.*)              — inmediato (fondo de ahorro)
 *   - imss_infonavit   (211.*)              — 30d (día 17 mes siguiente)
 *   - isr_retenciones  (216.*)              — 30d (día 17 mes siguiente)
 *   - iva              (208.* + 209.*)      — 30d (día 17 mes siguiente)
 *   - ap_nacional      (201.01.*)           — 30-60d
 *   - ap_extranjero    (201.02.*)           — 30-60d
 *   - acreedores_diversos (205.*)           — 30-60d
 *   - arrendamiento    (205.02.0002/03 + 250.*) — mensual
 *   - prestamos_cp     (252.* current)      — meses
 *   - prestamos_lp     (252.* non_current)  — largo plazo
 */
export interface ObligationDetail {
  accountCode: string;
  accountName: string;
  outstandingMxn: number;
}

export interface ObligationCategory {
  category: string;
  categoryLabel: string;
  outstandingMxn: number;
  accountCount: number;
  paymentHorizon:
    | "inmediato"
    | "30d_sat"
    | "30_60d"
    | "mensual"
    | "meses"
    | "lp"
    | "intercompania";
  detail: ObligationDetail[];
}

export interface ObligationsSummary {
  asOfPeriod: string;
  totalMxn: number;
  totalOperativoMxn: number;
  totalInmediatoMxn: number;
  totalCortoPlazo30Mxn: number;
  totalCortoPlazo90Mxn: number;
  totalLargoPlazoMxn: number;
  totalIntercompaniaMxn: number;
  efectivoMxn: number;
  liquidityRatio: number | null;
  categories: ObligationCategory[];
}

interface RpcRow {
  category: string;
  category_label: string;
  outstanding_mxn: number | string;
  account_count: number;
  payment_horizon: string;
  detail:
    | Array<{
        account_code: string;
        account_name: string | null;
        outstanding_mxn: number | string;
      }>
    | null;
}

async function _getObligationsSummaryRaw(): Promise<ObligationsSummary> {
  const sb = getServiceClient();
  const today = new Date();
  const lastClosedMonth = new Date(today.getFullYear(), today.getMonth(), 0);
  const period = `${lastClosedMonth.getFullYear()}-${String(
    lastClosedMonth.getMonth() + 1
  ).padStart(2, "0")}`;

  const [oblRes, cashRes] = await Promise.all([
    sb.rpc("get_obligations_summary", { p_as_of_period: period }),
    sb
      .from("canonical_bank_balances")
      .select("classification, current_balance_mxn"),
  ]);

  const rows = (oblRes.data ?? []) as RpcRow[];

  const categories: ObligationCategory[] = rows.map((r) => ({
    category: r.category,
    categoryLabel: r.category_label,
    outstandingMxn: Math.round(Number(r.outstanding_mxn) || 0),
    accountCount: r.account_count,
    paymentHorizon: r.payment_horizon as ObligationCategory["paymentHorizon"],
    detail: (r.detail ?? []).map((d) => ({
      accountCode: d.account_code,
      accountName: d.account_name ?? "",
      outstandingMxn: Math.round(Number(d.outstanding_mxn) || 0),
    })),
  }));

  const totalMxn = categories.reduce((s, c) => s + c.outstandingMxn, 0);
  const sumByHorizon = (horizons: ObligationCategory["paymentHorizon"][]) =>
    categories
      .filter((c) => horizons.includes(c.paymentHorizon))
      .reduce((s, c) => s + c.outstandingMxn, 0);

  const totalInmediatoMxn = sumByHorizon(["inmediato"]);
  const totalCortoPlazo30Mxn = sumByHorizon(["inmediato", "30d_sat"]);
  const totalCortoPlazo90Mxn = sumByHorizon([
    "inmediato",
    "30d_sat",
    "30_60d",
    "mensual",
    "meses",
  ]);
  const totalLargoPlazoMxn = sumByHorizon(["lp"]);
  const totalIntercompaniaMxn = sumByHorizon(["intercompania"]);
  // Operativo = todo excepto intercompañía (préstamos accionista, etc.)
  const totalOperativoMxn = totalMxn - totalIntercompaniaMxn;

  type Bank = {
    classification: string | null;
    current_balance_mxn: number | null;
  };
  const banks = (cashRes.data ?? []) as Bank[];
  const efectivoMxn = banks
    .filter((b) => b.classification === "cash")
    .reduce((s, b) => s + (Number(b.current_balance_mxn) || 0), 0);

  const liquidityRatio =
    totalCortoPlazo30Mxn > 0 ? efectivoMxn / totalCortoPlazo30Mxn : null;

  return {
    asOfPeriod: period,
    totalMxn,
    totalOperativoMxn,
    totalInmediatoMxn,
    totalCortoPlazo30Mxn,
    totalCortoPlazo90Mxn,
    totalLargoPlazoMxn,
    totalIntercompaniaMxn,
    efectivoMxn: Math.round(efectivoMxn),
    liquidityRatio,
    categories,
  };
}

export const getObligationsSummary = unstable_cache(
  _getObligationsSummaryRaw,
  ["sp13-finanzas-obligations-v2"],
  { revalidate: 600, tags: ["finanzas"] }
);
