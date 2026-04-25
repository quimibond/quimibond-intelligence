import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * SP13 E1 Hero — distribución de compras.
 *
 * KPIs:
 *   spendYtd        = SUM(canonical_purchase_orders.amount_total_mxn) YTD
 *   spendYtdPrev    = SUM same window prior year (for comparison)
 *   activeSuppliers = distinct counterparty in last 12m (canonical_payments)
 *   openPos         = COUNT canonical_purchase_orders state IN (draft,sent,to approve,purchase)
 *   singleSourceCount = TODO SP6 — placeholder until gold_supplier_concentration MV
 *
 * Period awareness: defaults to YTD; `range` lets the hero respect
 * /compras?range=mtd|ltm|ytd|3y|5y|all (HistorySelector).
 */
import type { HistoryRange } from "@/components/patterns/history-selector";

export interface SP13ProcurementKpis {
  spend: number;
  spendPrev: number;
  trendPct: number;
  activeSuppliers: number;
  openPos: number;
  singleSourceSpend: number;
}

function rangeToBoundsIso(range: HistoryRange): { from: string; to: string; prevFrom: string; prevTo: string } {
  const now = new Date();
  let from: Date;
  const to = now;

  switch (range) {
    case "mtd":
      from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      break;
    case "ltm":
      from = new Date(now);
      from.setUTCFullYear(from.getUTCFullYear() - 1);
      break;
    case "3y":
      from = new Date(now);
      from.setUTCFullYear(from.getUTCFullYear() - 3);
      break;
    case "5y":
      from = new Date(now);
      from.setUTCFullYear(from.getUTCFullYear() - 5);
      break;
    case "all":
      from = new Date(Date.UTC(2000, 0, 1));
      break;
    case "ytd":
    default:
      from = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  }

  const span = to.getTime() - from.getTime();
  const prevTo = new Date(from);
  const prevFrom = new Date(from.getTime() - span);

  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    prevFrom: prevFrom.toISOString().slice(0, 10),
    prevTo: prevTo.toISOString().slice(0, 10),
  };
}

const ACTIVE_PO_STATES = ["draft", "sent", "to approve", "purchase"];

async function _getProcurementKpisRaw(range: HistoryRange = "ytd"): Promise<SP13ProcurementKpis> {
  const sb = getServiceClient();
  const bounds = rangeToBoundsIso(range);

  // Active suppliers = distinct counterparty in last 12m. Always 12m
  // regardless of range (it's "still active suppliers", not period spend).
  const last12mFrom = new Date();
  last12mFrom.setUTCFullYear(last12mFrom.getUTCFullYear() - 1);
  const last12mIso = last12mFrom.toISOString().slice(0, 10);

  const [spendRes, prevRes, openPosRes, supplierIdsRes, singleSourceRes] = await Promise.all([
    sb
      .from("canonical_purchase_orders")
      .select("amount_total_mxn")
      .gte("date_order", bounds.from)
      .lt("date_order", bounds.to)
      .neq("state", "cancel"),
    sb
      .from("canonical_purchase_orders")
      .select("amount_total_mxn")
      .gte("date_order", bounds.prevFrom)
      .lt("date_order", bounds.prevTo)
      .neq("state", "cancel"),
    sb
      .from("canonical_purchase_orders")
      .select("canonical_id", { head: true, count: "exact" })
      .in("state", ACTIVE_PO_STATES),
    sb
      .from("canonical_payments")
      .select("counterparty_canonical_company_id")
      .eq("direction", "sent")
      .gte("payment_date_resolved", last12mIso)
      .not("counterparty_canonical_company_id", "is", null)
      .limit(20000),
    // TODO SP6: replace with gold_supplier_concentration once shipped.
    // For now, derive single-source spend from canonical_order_lines client-side
    // is too expensive on every render — surface 0 and let the dedicated
    // section's own helper compute it (cached separately).
    Promise.resolve({ data: [] as unknown[] }),
  ]);

  const sum = (rows: Array<{ amount_total_mxn: number | null }>) =>
    rows.reduce((acc, r) => acc + (Number(r.amount_total_mxn) || 0), 0);

  const spend = sum((spendRes.data ?? []) as Array<{ amount_total_mxn: number | null }>);
  const spendPrev = sum((prevRes.data ?? []) as Array<{ amount_total_mxn: number | null }>);

  const supplierIds = new Set<number>();
  for (const r of (supplierIdsRes.data ?? []) as Array<{ counterparty_canonical_company_id: number | null }>) {
    if (r.counterparty_canonical_company_id != null) {
      supplierIds.add(r.counterparty_canonical_company_id);
    }
  }

  const trendPct = spendPrev > 0 ? ((spend - spendPrev) / spendPrev) * 100 : 0;

  // Suppress noise: singleSourceSpend lives in its own cached helper.
  void singleSourceRes;

  return {
    spend,
    spendPrev,
    trendPct,
    activeSuppliers: supplierIds.size,
    openPos: openPosRes.count ?? 0,
    singleSourceSpend: 0,
  };
}

export const getProcurementKpis = unstable_cache(
  _getProcurementKpisRaw,
  ["sp13-compras-portfolio-kpis"],
  { revalidate: 300, tags: ["compras", "purchase_orders"] },
);
