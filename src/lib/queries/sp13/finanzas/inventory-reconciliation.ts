import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";
import { paginateAll } from "@/lib/queries/_shared/paginate";

/**
 * Conciliación inventario: contable (115.x) vs físico (canonical_products).
 *
 * El drift entre estos dos números es señal de:
 *   - WIP físico contado como finished (sin distinción)
 *   - avg_cost_mxn desactualizado o sobrevaluado en algunos SKUs
 *   - Discrepancias de conteo no registradas
 *   - Asientos contables sin movimiento físico (o viceversa)
 *
 * El P&L limpio asume que avg_cost_mxn es correcto. Si físico >> contable
 * por mucho, los costos calculados podrían estar inflados.
 */

export interface InventoryBucket {
  accountCode: string;        // e.g. "115.02.01"
  label: string;              // e.g. "Materia prima"
  bookValue: number;          // saldo acumulado al fin del período
}

export interface InventoryReconciliation {
  asOfPeriod: string;         // "YYYY-MM"
  bookTotal: number;          // suma de todas las 115.x al cierre del período
  physicalTotal: number;      // Σ stock_qty × avg_cost_mxn
  drift: number;              // physical − book
  driftPct: number | null;    // drift / book * 100
  buckets: InventoryBucket[];
  skusWithStock: number;
  skusWithStockNoCost: number;  // potencial drift por costo faltante
  topSkusByValue: SkuValueRow[];
}

export interface SkuValueRow {
  internalRef: string | null;
  name: string | null;
  stockQty: number;
  avgCostMxn: number;
  totalValueMxn: number;
}

const BUCKET_LABELS: Record<string, string> = {
  "115.01.01": "Inventory (genérico)",
  "115.02.01": "Materia prima y materiales",
  "115.03.01": "Producción en proceso (WIP)",
  "115.04.01": "Productos terminados",
  "115.04.02": "Productos terminados (alt)",
};

async function _getInventoryReconciliationRaw(
  asOfPeriod: string
): Promise<InventoryReconciliation> {
  const sb = getServiceClient();

  // 1. Book inventory: cumulative balance of 115.x accounts up to period
  const bookRes = await sb
    .from("canonical_account_balances")
    .select("account_code, account_name, balance")
    .like("account_code", "115.%")
    .eq("deprecated", false)
    .lte("period", asOfPeriod);

  type BookRow = {
    account_code: string | null;
    account_name: string | null;
    balance: number | null;
  };
  const byAccount = new Map<string, { name: string; total: number }>();
  for (const r of (bookRes.data ?? []) as BookRow[]) {
    const code = r.account_code ?? "";
    if (!code) continue;
    const cur = byAccount.get(code) ?? { name: r.account_name ?? code, total: 0 };
    cur.total += Number(r.balance) || 0;
    byAccount.set(code, cur);
  }
  const buckets: InventoryBucket[] = [];
  for (const [code, info] of byAccount) {
    if (Math.abs(info.total) < 1) continue;
    buckets.push({
      accountCode: code,
      label: BUCKET_LABELS[code] ?? info.name,
      bookValue: Math.round(info.total * 100) / 100,
    });
  }
  buckets.sort((a, b) => b.bookValue - a.bookValue);
  const bookTotal = buckets.reduce((s, b) => s + b.bookValue, 0);

  // 2. Physical inventory: current state of canonical_products
  type CpRow = {
    internal_ref: string | null;
    canonical_name: string | null;
    stock_qty: number | null;
    avg_cost_mxn: number | null;
  };
  const cpRows = await paginateAll<CpRow>(({ from, to }) =>
    sb
      .from("canonical_products")
      .select("internal_ref, canonical_name, stock_qty, avg_cost_mxn")
      .gt("stock_qty", 0)
      .order("stock_qty", { ascending: false })
      .range(from, to)
  );

  let physicalTotal = 0;
  let skusWithStock = 0;
  let skusWithStockNoCost = 0;
  const ranked: SkuValueRow[] = [];
  for (const cp of cpRows) {
    const qty = Number(cp.stock_qty) || 0;
    const cost = Number(cp.avg_cost_mxn) || 0;
    if (qty <= 0) continue;
    skusWithStock += 1;
    if (cost <= 0) skusWithStockNoCost += 1;
    const value = qty * cost;
    physicalTotal += value;
    if (value >= 50000) {
      ranked.push({
        internalRef: cp.internal_ref,
        name: cp.canonical_name,
        stockQty: qty,
        avgCostMxn: cost,
        totalValueMxn: value,
      });
    }
  }
  ranked.sort((a, b) => b.totalValueMxn - a.totalValueMxn);
  const topSkusByValue = ranked.slice(0, 20);

  const drift = physicalTotal - bookTotal;
  const driftPct = bookTotal !== 0 ? (drift / bookTotal) * 100 : null;

  return {
    asOfPeriod,
    bookTotal: Math.round(bookTotal * 100) / 100,
    physicalTotal: Math.round(physicalTotal * 100) / 100,
    drift: Math.round(drift * 100) / 100,
    driftPct: driftPct == null ? null : Math.round(driftPct * 10) / 10,
    buckets,
    skusWithStock,
    skusWithStockNoCost,
    topSkusByValue,
  };
}

export const getInventoryReconciliation = (asOfPeriod: string) =>
  unstable_cache(
    () => _getInventoryReconciliationRaw(asOfPeriod),
    ["sp13-finanzas-inventory-reconciliation-v1", asOfPeriod],
    { revalidate: 600, tags: ["finanzas"] }
  )();
