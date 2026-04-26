import "server-only";
import { unstable_cache } from "next/cache";
import {
  getTopSuppliers as legacyGetTopSuppliers,
  type TopSupplierRow,
} from "@/lib/queries/operational/purchases";

/**
 * SP13 E2 — ¿A quién le compro más? (top N suppliers, last 12m).
 *
 * Wraps legacy getTopSuppliers (canonical_order_lines aggregation) with
 * tighter SP13 cache tagging so /compras page-wide invalidation stays
 * coherent.
 */

export type { TopSupplierRow };

async function _getTopSuppliersRaw(limit: number = 5): Promise<TopSupplierRow[]> {
  return legacyGetTopSuppliers(limit);
}

export const getTopSuppliers = unstable_cache(
  _getTopSuppliersRaw,
  ["sp13-compras-top-suppliers"],
  { revalidate: 300, tags: ["compras", "canonical_order_lines"] },
);
