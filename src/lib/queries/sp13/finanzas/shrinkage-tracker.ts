import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * Shrinkage tracker — pérdidas por diferencias de conteo físico.
 *
 * Fuente: `odoo_account_entries_stock` filtrando asientos con
 * `cogs_account_codes` que incluyan '501.01.08' (DIFERENCIAS POR CONTEO).
 * Cada asiento tiene `lines_stock` con la línea por producto: el cargo
 * a 501.01.08 = pérdida, el abono a 115.x = inventario que se quita.
 *
 * RPC `get_shrinkage_events(from_period, to_period)` hace el unnest del
 * jsonb server-side (mucho más rápido que pull-and-filter).
 */

export interface ShrinkageEvent {
  date: string;
  entryName: string;
  productId: number | null;
  productRef: string | null;
  productName: string | null;
  lossMxn: number;
  inventoryAccount: string | null;
}

export interface ShrinkageBySku {
  productId: number | null;
  productRef: string | null;
  productName: string | null;
  totalLossMxn: number;
  events: number;
  monthsAffected: number;
}

export interface ShrinkageByMonth {
  period: string;
  totalLossMxn: number;
  events: number;
  uniqueSkus: number;
}

export interface ShrinkageSummary {
  fromPeriod: string;
  toPeriod: string;
  totalLossMxn: number;
  totalEvents: number;
  uniqueSkus: number;
  byMonth: ShrinkageByMonth[];
  topSkus: ShrinkageBySku[];
  recentEvents: ShrinkageEvent[];
}

type RpcRow = {
  date: string;
  entry_name: string | null;
  product_id: number | null;
  product_ref: string | null;
  product_name: string | null;
  loss_mxn: number | string;
  inventory_account: string | null;
};

async function _getShrinkageSummaryRaw(
  fromPeriod: string,
  toPeriod: string
): Promise<ShrinkageSummary> {
  const sb = getServiceClient();
  const { data, error } = await sb.rpc("get_shrinkage_events", {
    p_from_period: fromPeriod,
    p_to_period: toPeriod,
  });
  if (error) throw error;

  const events: ShrinkageEvent[] = ((data ?? []) as RpcRow[]).map((r) => ({
    date: r.date,
    entryName: r.entry_name ?? "",
    productId: r.product_id,
    productRef: r.product_ref,
    productName: r.product_name,
    lossMxn: Math.round((Number(r.loss_mxn) || 0) * 100) / 100,
    inventoryAccount: r.inventory_account,
  }));

  // Aggregate by SKU
  const bySku = new Map<string, ShrinkageBySku & { _months: Set<string> }>();
  for (const e of events) {
    const key = e.productRef ?? `pid:${e.productId ?? "unknown"}`;
    const cur =
      bySku.get(key) ??
      ({
        productId: e.productId,
        productRef: e.productRef,
        productName: e.productName,
        totalLossMxn: 0,
        events: 0,
        monthsAffected: 0,
        _months: new Set<string>(),
      } as ShrinkageBySku & { _months: Set<string> });
    cur.totalLossMxn += e.lossMxn;
    cur.events += 1;
    cur._months.add(e.date.slice(0, 7));
    bySku.set(key, cur);
  }
  // topSkus: solo pérdidas netas reales (positive net loss).
  // Eventos negativos = corrección positiva (sobrante encontrado, ajuste).
  const topSkus: ShrinkageBySku[] = Array.from(bySku.values())
    .filter((s) => s.totalLossMxn > 0)
    .map((s) => ({
      productId: s.productId,
      productRef: s.productRef,
      productName: s.productName,
      totalLossMxn: Math.round(s.totalLossMxn * 100) / 100,
      events: s.events,
      monthsAffected: s._months.size,
    }))
    .sort((a, b) => b.totalLossMxn - a.totalLossMxn)
    .slice(0, 20);

  // Aggregate by month
  const byMonthMap = new Map<
    string,
    { totalLossMxn: number; events: number; skus: Set<string> }
  >();
  for (const e of events) {
    const period = e.date.slice(0, 7);
    const cur =
      byMonthMap.get(period) ??
      { totalLossMxn: 0, events: 0, skus: new Set<string>() };
    cur.totalLossMxn += e.lossMxn;
    cur.events += 1;
    cur.skus.add(e.productRef ?? `pid:${e.productId}`);
    byMonthMap.set(period, cur);
  }
  const byMonth: ShrinkageByMonth[] = Array.from(byMonthMap.entries())
    .map(([period, m]) => ({
      period,
      totalLossMxn: Math.round(m.totalLossMxn * 100) / 100,
      events: m.events,
      uniqueSkus: m.skus.size,
    }))
    .sort((a, b) => a.period.localeCompare(b.period));

  // totalLoss = NET (incluye corrections); totalEvents = solo eventos con net > 0
  const totalLossMxn = events.reduce((s, e) => s + e.lossMxn, 0);
  const realLossEvents = events.filter((e) => e.lossMxn > 0);
  // Recientes: priorizar pérdidas reales (excluir reversiones masivas)
  const recentEvents = [...realLossEvents]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 30);

  return {
    fromPeriod,
    toPeriod,
    totalLossMxn: Math.round(totalLossMxn * 100) / 100,
    totalEvents: realLossEvents.length,
    uniqueSkus: topSkus.length,
    byMonth,
    topSkus,
    recentEvents,
  };
}

export const getShrinkageSummary = (fromPeriod: string, toPeriod: string) =>
  unstable_cache(
    () => _getShrinkageSummaryRaw(fromPeriod, toPeriod),
    ["sp13-finanzas-shrinkage-v3-net", fromPeriod, toPeriod],
    { revalidate: 600, tags: ["finanzas"] }
  )();
