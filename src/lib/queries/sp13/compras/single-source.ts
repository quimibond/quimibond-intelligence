import "server-only";
import { unstable_cache } from "next/cache";
import {
  getSingleSourceRisk as legacyGetSingleSourceRisk,
  getSingleSourceSummary as legacyGetSingleSourceSummary,
  type SingleSourceRow,
  type SingleSourceSummaryRow,
} from "@/lib/queries/operational/purchases";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * SP13 E4 — ¿Tengo dependencia de un solo proveedor? (top N risky SKUs).
 *
 * Wraps the legacy single_source helper and enriches each row with
 * supplier display_name + product display fields (legacy returns
 * canonical IDs but no labels). Limit defaults to 5 for the section card.
 */

export interface SingleSourceCriticalRow extends SingleSourceRow {
  top_supplier_display: string | null;
  product_display: string | null;
}

async function _getCriticalSingleSourceRaw(
  limit: number = 5,
): Promise<SingleSourceCriticalRow[]> {
  const rows = await legacyGetSingleSourceRisk(limit);
  if (rows.length === 0) return [];

  const sb = getServiceClient();

  const supplierIds = Array.from(
    new Set(
      rows
        .map((r) => r.top_supplier_company_id)
        .filter((id): id is number => id != null),
    ),
  );
  const productIds = Array.from(new Set(rows.map((r) => r.odoo_product_id)));

  const [suppliers, products] = await Promise.all([
    supplierIds.length > 0
      ? sb
          .from("canonical_companies")
          .select("id, display_name")
          .in("id", supplierIds)
      : Promise.resolve({ data: [] as Array<{ id: number; display_name: string | null }> }),
    productIds.length > 0
      ? sb
          .from("canonical_products")
          .select("odoo_product_id, internal_ref, display_name")
          .in("odoo_product_id", productIds)
      : Promise.resolve({
          data: [] as Array<{
            odoo_product_id: number;
            internal_ref: string | null;
            display_name: string | null;
          }>,
        }),
  ]);

  const supplierMap = new Map<number, string>();
  for (const s of (suppliers.data ?? []) as Array<{ id: number; display_name: string | null }>) {
    if (s.display_name) supplierMap.set(s.id, s.display_name);
  }
  const productMap = new Map<number, { ref: string | null; name: string | null }>();
  for (const p of (products.data ?? []) as Array<{
    odoo_product_id: number;
    internal_ref: string | null;
    display_name: string | null;
  }>) {
    productMap.set(p.odoo_product_id, { ref: p.internal_ref, name: p.display_name });
  }

  return rows.map((r) => {
    const product = productMap.get(r.odoo_product_id);
    const productDisplay = product?.ref ?? product?.name ?? null;
    return {
      ...r,
      top_supplier_display:
        r.top_supplier_company_id != null
          ? (supplierMap.get(r.top_supplier_company_id) ?? null)
          : null,
      product_display: productDisplay,
    };
  });
}

export const getCriticalSingleSource = unstable_cache(
  _getCriticalSingleSourceRaw,
  ["sp13-compras-single-source-critical"],
  { revalidate: 300, tags: ["compras", "canonical_order_lines"] },
);

async function _getSingleSourceSummaryRaw(): Promise<SingleSourceSummaryRow[]> {
  return legacyGetSingleSourceSummary();
}

export const getSingleSourceSummary = unstable_cache(
  _getSingleSourceSummaryRaw,
  ["sp13-compras-single-source-summary"],
  { revalidate: 300, tags: ["compras", "canonical_order_lines"] },
);

export type { SingleSourceSummaryRow };
