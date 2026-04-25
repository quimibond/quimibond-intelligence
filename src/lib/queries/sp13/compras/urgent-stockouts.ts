import "server-only";
import { unstable_cache } from "next/cache";
import {
  getStockoutQueue,
  type StockoutRow,
  type StockoutUrgency,
} from "@/lib/queries/analytics";

/**
 * SP13 E3 — ¿Qué necesito reordenar urgente?
 *
 * Surfaces top N STOCKOUT + CRITICAL + URGENT items from the cola de
 * reposición. Ordered by priority_score desc (already returned that way
 * by getStockoutQueue).
 */

export type { StockoutRow, StockoutUrgency };

async function _getUrgentStockoutsRaw(limit: number = 5): Promise<StockoutRow[]> {
  // Pull top by priority_score; getStockoutQueue with no urgency filter
  // returns all bands ordered desc, so slice on top.
  const all = await getStockoutQueue(undefined, Math.max(limit * 4, 50));
  return all
    .filter((r) => ["STOCKOUT", "CRITICAL", "URGENT"].includes(r.urgency))
    .slice(0, limit);
}

export const getUrgentStockouts = unstable_cache(
  _getUrgentStockoutsRaw,
  ["sp13-compras-urgent-stockouts"],
  { revalidate: 300, tags: ["compras", "stockouts"] },
);
