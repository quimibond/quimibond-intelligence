// src/lib/syntage/entity-resolver.ts
export interface EntityMapStore {
  lookup(taxpayerRfc: string): Promise<{ odooCompanyId: number } | null>;
}

/**
 * Resolves a Syntage taxpayer RFC to its Odoo company_id.
 * Returns null if the RFC is not in syntage_entity_map or is_active=false.
 * Case-insensitive.
 */
export async function resolveEntity(
  store: EntityMapStore,
  taxpayerRfc: string,
): Promise<{ odooCompanyId: number } | null> {
  if (!taxpayerRfc) return null;
  return store.lookup(taxpayerRfc.toUpperCase());
}

/**
 * Supabase-backed EntityMapStore implementation.
 */
export function supabaseEntityMapStore(
  supabase: import("@supabase/supabase-js").SupabaseClient,
): EntityMapStore {
  return {
    async lookup(rfc) {
      const { data, error } = await supabase
        .from("syntage_entity_map")
        .select("odoo_company_id")
        .ilike("taxpayer_rfc", rfc)
        .eq("is_active", true)
        .maybeSingle();

      if (error) throw error;
      if (!data) return null;
      return { odooCompanyId: data.odoo_company_id };
    },
  };
}
