import "server-only";
import { unstable_cache } from "next/cache";
import {
  getPriceAnomalies as legacyGetPriceAnomalies,
  type PriceAnomalyRow,
} from "@/lib/queries/operational/purchases";

/**
 * SP13 E5 — ¿Estoy pagando precios anormales? (top N anomalies).
 *
 * Surfaces overpaid + above-average + below-average price events ordered by
 * total spent (impact-weighted). Uses purchase_price_intelligence (KEEP view).
 */

export type { PriceAnomalyRow };

async function _getTopPriceAnomaliesRaw(
  limit: number = 5,
): Promise<PriceAnomalyRow[]> {
  return legacyGetPriceAnomalies(limit);
}

export const getTopPriceAnomalies = unstable_cache(
  _getTopPriceAnomaliesRaw,
  ["sp13-compras-price-anomalies"],
  { revalidate: 300, tags: ["compras", "price_anomalies"] },
);
