import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * Catálogo de costos por producto (TODOS los vendibles, vendidos o no).
 * Lee la tabla materializada product_cost_catalog (refresh
 * refresh_product_cost_catalog). Para el explorador/buscador de costos.
 */

export interface ProductCostRow {
  internalRef: string | null;
  name: string | null;
  familia: string | null;
  uom: string | null;
  kgPerUnit: number | null;
  mpUnitMxn: number | null;
  energiaUnitMxn: number | null;
  costoVariableUnitMxn: number | null;
  fabAbsorbidoUnitMxn: number | null;
  costoProdAbsorbidoUnitMxn: number | null;
  precioRefMxn: number | null;
  precioFuente: string | null;
  opUnitMxn: number | null;
  costoTotalAbsorbidoUnitMxn: number | null;
  contribucionUnitMxn: number | null;
  cmPct: number | null;
  margenAbsorbidoPct: number | null;
  mpSource: string | null;
}

export interface ProductCostCatalog {
  rows: ProductCostRow[];
  period: string | null;
  refreshedAt: string | null;
}

async function _raw(): Promise<ProductCostCatalog> {
  const sb = getServiceClient();
  const { data } = await sb
    .from("product_cost_catalog")
    .select(
      "internal_ref,name,familia,uom,kg_per_unit,mp_unit_mxn,energia_unit_mxn,costo_variable_unit_mxn,fab_absorbido_unit_mxn,costo_prod_absorbido_unit_mxn,precio_ref_mxn,precio_fuente,op_unit_mxn,costo_total_absorbido_unit_mxn,contribucion_unit_mxn,cm_pct,margen_absorbido_pct,mp_source,period,refreshed_at",
    )
    .order("internal_ref", { ascending: true });

  const raw = (data ?? []) as Record<string, unknown>[];
  const num = (v: unknown) => (v == null ? null : Number(v));
  const rows: ProductCostRow[] = raw.map((r) => ({
    internalRef: (r.internal_ref as string) ?? null,
    name: (r.name as string) ?? null,
    familia: (r.familia as string) ?? null,
    uom: (r.uom as string) ?? null,
    kgPerUnit: num(r.kg_per_unit),
    mpUnitMxn: num(r.mp_unit_mxn),
    energiaUnitMxn: num(r.energia_unit_mxn),
    costoVariableUnitMxn: num(r.costo_variable_unit_mxn),
    fabAbsorbidoUnitMxn: num(r.fab_absorbido_unit_mxn),
    costoProdAbsorbidoUnitMxn: num(r.costo_prod_absorbido_unit_mxn),
    precioRefMxn: num(r.precio_ref_mxn),
    precioFuente: (r.precio_fuente as string) ?? null,
    opUnitMxn: num(r.op_unit_mxn),
    costoTotalAbsorbidoUnitMxn: num(r.costo_total_absorbido_unit_mxn),
    contribucionUnitMxn: num(r.contribucion_unit_mxn),
    cmPct: num(r.cm_pct),
    margenAbsorbidoPct: num(r.margen_absorbido_pct),
    mpSource: (r.mp_source as string) ?? null,
  }));

  return {
    rows,
    period: (raw[0]?.period as string) ?? null,
    refreshedAt: (raw[0]?.refreshed_at as string) ?? null,
  };
}

export const getProductCostCatalog = () =>
  unstable_cache(_raw, ["sp13-product-cost-catalog-v1"], {
    revalidate: 300,
    tags: ["sp13", "finanzas", "cost-centers"],
  })();
