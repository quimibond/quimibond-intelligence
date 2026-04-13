import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase joined relation helper para tablas con FK declarada.
 * Dependiendo del tipo de join, la relación vendrá como objeto o array.
 */
export function joinedCompanyName(companies: unknown): string | null {
  if (!companies) return null;
  if (Array.isArray(companies)) {
    const first = companies[0] as { name?: string | null } | undefined;
    return first?.name ?? null;
  }
  return (companies as { name?: string | null }).name ?? null;
}

/**
 * Resuelve nombres de empresa para las tablas SIN FK declarada
 * (odoo_sale_orders, odoo_purchase_orders). Hace un segundo query batch
 * y devuelve un Map<id, name>.
 */
export async function resolveCompanyNames(
  sb: SupabaseClient,
  ids: Array<number | string | null | undefined>
): Promise<Map<number, string>> {
  const unique = Array.from(
    new Set(
      ids
        .filter((id): id is number | string => id != null)
        .map((id) => Number(id))
        .filter((id) => !Number.isNaN(id))
    )
  );
  if (unique.length === 0) return new Map();

  const { data } = await sb
    .from("companies")
    .select("id, name")
    .in("id", unique);

  const map = new Map<number, string>();
  for (const row of (data ?? []) as Array<{
    id: number;
    name: string | null;
  }>) {
    if (row.name) map.set(row.id, row.name);
  }
  return map;
}
