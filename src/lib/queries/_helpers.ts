import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * IDs de empresas marcadas como `relationship_type='self'` (la propia
 * Quimibond + variantes basura del knowledge graph). Hay que excluirlas
 * de TODA query de cobranza/cartera/CxC porque generan facturas
 * inter-company que no son negocio externo.
 *
 * Cacheado por proceso para evitar query extra por cada llamada.
 */
let _selfCompanyIdsCache: number[] | null = null;
export async function getSelfCompanyIds(): Promise<number[]> {
  if (_selfCompanyIdsCache) return _selfCompanyIdsCache;
  const sb = getServiceClient();
  const { data } = await sb
    .from("companies")
    .select("id")
    .eq("relationship_type", "self");
  _selfCompanyIdsCache = ((data ?? []) as Array<{ id: number }>).map((r) => r.id);
  return _selfCompanyIdsCache;
}

/** Formatea un array de IDs como `(1,2,3)` para el operador `not.in` de PostgREST. */
export function pgInList(ids: number[]): string {
  if (ids.length === 0) return "(0)";
  return `(${ids.join(",")})`;
}

/**
 * Si el `name` de una company es basura (vacio, null, solo digitos o de
 * 1-2 caracteres) lo descarta y devuelve null. Esto previene mostrar
 * cosas como "11", "0021", "—" en el inbox o tarjetas de empresa.
 *
 * Hay 193 companies asi en producccion (~9% del total) porque la sync
 * de Odoo importa partners sin nombre real. El fix de fondo va en el
 * addon qb19 — esto es la salvaguarda en el frontend.
 */
export function sanitizeCompanyName(name: string | null | undefined): string | null {
  if (name == null) return null;
  const trimmed = String(name).trim();
  if (trimmed.length < 3) return null;
  if (/^[0-9]+$/.test(trimmed)) return null;
  return trimmed;
}

/**
 * Supabase joined relation helper para tablas con FK declarada.
 * Dependiendo del tipo de join, la relación vendrá como objeto o array.
 * Aplica `sanitizeCompanyName` para no propagar nombres basura.
 */
export function joinedCompanyName(companies: unknown): string | null {
  if (!companies) return null;
  if (Array.isArray(companies)) {
    const first = companies[0] as { name?: string | null } | undefined;
    return sanitizeCompanyName(first?.name);
  }
  return sanitizeCompanyName((companies as { name?: string | null }).name);
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
    const clean = sanitizeCompanyName(row.name);
    if (clean) map.set(row.id, clean);
  }
  return map;
}
