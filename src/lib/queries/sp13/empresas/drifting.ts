import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * SP13 E6 — Drift AR/AP significativo.
 *
 * Fuente principal: canonical_companies (drift_* columns, refrescadas cada
 * hora por refresh_canonical_company_financials_hourly).
 * Direccion AR: sign(drift_odoo_only_mxn - drift_sat_only_mxn)
 *   positivo = Odoo reporta mas que SAT → "me perjudica" (fiscal)
 *   negativo = SAT reporta mas que Odoo → "me favorece"
 *
 * "Ultimo mes afectado": max(invoice_date) de gold_company_odoo_sat_drift.
 * Se queria que existiera post canonical migration sweep 2026-04-23.
 * Si esta vacio, ground truth dice "query esta mal".
 *
 * Excluye Quimibond self (id=868) y empresas con category flags suprimidas
 * (is_foreign/is_bank/is_government/is_payroll_entity): esas se marcan como
 * `noise = true` para que la UI no las mezcle con drift accionable.
 */
export type DriftDirection = "me_perjudica" | "me_favorece" | "neutral";

export interface DriftingCompany {
  canonical_company_id: number;
  display_name: string;
  drift_ar_mxn: number;
  drift_ap_mxn: number;
  drift_total_mxn: number;
  needs_review: boolean;
  ar_direction: DriftDirection;
  ap_direction: DriftDirection;
  last_affected_month: string | null;
  noise: boolean;
}

const QUIMIBOND_SELF_ID = 868;

const DRIFT_COLUMNS = [
  "id",
  "display_name",
  "drift_odoo_only_mxn",
  "drift_sat_only_mxn",
  "drift_matched_abs_mxn",
  "drift_total_abs_mxn",
  "drift_needs_review",
  "drift_ap_odoo_only_mxn",
  "drift_ap_sat_only_mxn",
  "drift_ap_matched_abs_mxn",
  "drift_ap_total_abs_mxn",
  "drift_ap_needs_review",
  "is_foreign",
  "is_bank",
  "is_government",
  "is_payroll_entity",
].join(", ");

interface RawDriftCompanyRow {
  id: number;
  display_name: string;
  drift_odoo_only_mxn: number | null;
  drift_sat_only_mxn: number | null;
  drift_matched_abs_mxn: number | null;
  drift_total_abs_mxn: number | null;
  drift_needs_review: boolean | null;
  drift_ap_odoo_only_mxn: number | null;
  drift_ap_sat_only_mxn: number | null;
  drift_ap_matched_abs_mxn: number | null;
  drift_ap_total_abs_mxn: number | null;
  drift_ap_needs_review: boolean | null;
  is_foreign: boolean | null;
  is_bank: boolean | null;
  is_government: boolean | null;
  is_payroll_entity: boolean | null;
}

function direction(odooOnly: number, satOnly: number): DriftDirection {
  const net = odooOnly - satOnly;
  if (Math.abs(net) < 500) return "neutral";
  return net > 0 ? "me_perjudica" : "me_favorece";
}

async function _getDriftingCompaniesUncached(
  limit: number = 5,
): Promise<DriftingCompany[]> {
  const sb = getServiceClient();

  const { data, error } = await sb
    .from("canonical_companies")
    // drift_* / is_foreign|bank|gov|payroll not in generated types yet.
    .select(DRIFT_COLUMNS as unknown as "*")
    .or("drift_total_abs_mxn.gt.0,drift_ap_total_abs_mxn.gt.0")
    .neq("id", QUIMIBOND_SELF_ID)
    .order("drift_total_abs_mxn", { ascending: false, nullsFirst: false });
  if (error) throw error;

  const rows = (data ?? []) as unknown as RawDriftCompanyRow[];

  // Rank by drift_ar + drift_ap, then slice.
  const ranked = rows
    .map((r) => {
      const arTotal = Number(r.drift_total_abs_mxn) || 0;
      const apTotal = Number(r.drift_ap_total_abs_mxn) || 0;
      const isNoise =
        Boolean(r.is_foreign) ||
        Boolean(r.is_bank) ||
        Boolean(r.is_government) ||
        Boolean(r.is_payroll_entity);
      return {
        row: r,
        total: arTotal + apTotal,
        arTotal,
        apTotal,
        isNoise,
      };
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);

  if (ranked.length === 0) return [];

  // Fetch latest invoice_date per company from gold_company_odoo_sat_drift.
  // Single batched call ordered desc; we keep the first date per company.
  const ids = ranked.map((r) => r.row.id);
  const { data: affected } = await sb
    .from("gold_company_odoo_sat_drift")
    .select("canonical_company_id, invoice_date")
    .in("canonical_company_id", ids)
    .order("invoice_date", { ascending: false, nullsFirst: false });

  const lastByCompany = new Map<number, string>();
  for (const r of (affected ?? []) as Array<{
    canonical_company_id: number;
    invoice_date: string | null;
  }>) {
    if (r.invoice_date && !lastByCompany.has(r.canonical_company_id)) {
      lastByCompany.set(r.canonical_company_id, r.invoice_date);
    }
  }

  return ranked.map(({ row, arTotal, apTotal, isNoise }) => ({
    canonical_company_id: row.id,
    display_name: row.display_name ?? "—",
    drift_ar_mxn: arTotal,
    drift_ap_mxn: apTotal,
    drift_total_mxn: arTotal + apTotal,
    needs_review:
      Boolean(row.drift_needs_review) || Boolean(row.drift_ap_needs_review),
    ar_direction: direction(
      Number(row.drift_odoo_only_mxn) || 0,
      Number(row.drift_sat_only_mxn) || 0,
    ),
    ap_direction: direction(
      Number(row.drift_ap_odoo_only_mxn) || 0,
      Number(row.drift_ap_sat_only_mxn) || 0,
    ),
    last_affected_month: lastByCompany.get(row.id) ?? null,
    noise: isNoise,
  }));
}

export const getDriftingCompanies = unstable_cache(
  _getDriftingCompaniesUncached,
  ["sp13-empresas-drifting"],
  { revalidate: 300, tags: ["companies", "finance"] },
);
