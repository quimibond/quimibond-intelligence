import "server-only";
import {
  getPurchaseOrdersPage as legacyGetPurchaseOrdersPage,
  type RecentPurchaseOrder,
  type RecentPurchaseOrderPage,
} from "@/lib/queries/operational/purchases";

/**
 * SP13 E6 — Lista completa de órdenes de compra con FilterBar (estado,
 * comprador, búsqueda) y paginación server-side. Wraps legacy
 * getPurchaseOrdersPage so this module owns its own cache invalidation
 * surface.
 */

export type { RecentPurchaseOrder, RecentPurchaseOrderPage };

export type PurchaseOrderState =
  | "all"
  | "draft"
  | "sent"
  | "to approve"
  | "purchase"
  | "done"
  | "cancel";

export interface PurchaseOrdersListParams {
  search?: string;
  state?: PurchaseOrderState;
  buyer?: string;
  page?: number;
  limit?: number;
  sort?: "-date" | "-amount" | "name" | "state";
}

const DEFAULT_LIMIT = 25;

export async function getPurchaseOrdersList(
  params: PurchaseOrdersListParams = {},
): Promise<RecentPurchaseOrderPage & { page: number; limit: number }> {
  const page = Math.max(1, params.page ?? 1);
  const limit = Math.min(100, Math.max(5, params.limit ?? DEFAULT_LIMIT));

  const sortMap: Record<NonNullable<PurchaseOrdersListParams["sort"]>, { sort: string; sortDir: "asc" | "desc" }> = {
    "-date": { sort: "date", sortDir: "desc" },
    "-amount": { sort: "amount", sortDir: "desc" },
    name: { sort: "name", sortDir: "asc" },
    state: { sort: "state", sortDir: "asc" },
  };
  const s = params.sort ?? "-date";
  const { sort, sortDir } = sortMap[s];

  const result = await legacyGetPurchaseOrdersPage({
    page,
    size: limit,
    q: params.search,
    state:
      params.state && params.state !== "all" ? [params.state] : undefined,
    buyer: params.buyer ? [params.buyer] : undefined,
    sort,
    sortDir,
    facets: {},
  });

  return { ...result, page, limit };
}
