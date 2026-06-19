import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * Catálogo de costos por producto (TODOS los vendibles, vendidos o no).
 * Lee la tabla materializada product_cost_catalog (refresh
 * refresh_product_cost_catalog). Para el explorador/buscador de costos.
 */

export interface MpBucket {
  bucket: string;
  costUnitMxn: number;
}

export interface PoolComponent {
  component: string;
  share: number;
}

export interface ProductCostRow {
  odooProductId: number | null;
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
  /** Desglose de la materia prima por componente de receta (BOM). */
  mpBuckets: MpBucket[];
}

export interface ProductCostCatalog {
  rows: ProductCostRow[];
  period: string | null;
  refreshedAt: string | null;
  /** Composición del pool de fabricación (% por componente GL). */
  fabComposition: PoolComponent[];
  /** Composición del pool de operación (% por componente GL). */
  opComposition: PoolComponent[];
}

async function _raw(): Promise<ProductCostCatalog> {
  const sb = getServiceClient();
  const cols =
    "odoo_product_id,internal_ref,name,familia,uom,kg_per_unit,mp_unit_mxn,energia_unit_mxn,costo_variable_unit_mxn,fab_absorbido_unit_mxn,costo_prod_absorbido_unit_mxn,precio_ref_mxn,precio_fuente,op_unit_mxn,costo_total_absorbido_unit_mxn,contribucion_unit_mxn,cm_pct,margen_absorbido_pct,mp_source,period,refreshed_at";

  // PostgREST devuelve máx 1000 filas por request → paginar (el catálogo tiene ~2,900).
  const PAGE = 1000;
  const raw: Record<string, unknown>[] = [];
  for (let from = 0; from < 20000; from += PAGE) {
    const { data, error } = await sb
      .from("product_cost_catalog")
      .select(cols)
      .order("internal_ref", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;
    raw.push(...(data as Record<string, unknown>[]));
    if (data.length < PAGE) break;
  }

  // Desglose de MP por receta (product_mp_breakdown), indexado por producto.
  const mpByProduct = new Map<number, MpBucket[]>();
  for (let from = 0; from < 40000; from += PAGE) {
    const { data, error } = await sb
      .from("product_mp_breakdown")
      .select("odoo_product_id,bucket,cost_unit_mxn")
      .range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;
    for (const d of data as Record<string, unknown>[]) {
      const pid = Number(d.odoo_product_id);
      const arr = mpByProduct.get(pid) ?? [];
      arr.push({ bucket: String(d.bucket), costUnitMxn: Number(d.cost_unit_mxn) });
      mpByProduct.set(pid, arr);
    }
    if (data.length < PAGE) break;
  }

  // Composición de los pools de fabricación y operación (% por componente GL).
  const period = (raw[0]?.period as string) ?? null;
  const fabComposition: PoolComponent[] = [];
  const opComposition: PoolComponent[] = [];
  if (period) {
    const { data: comp } = await sb.rpc("get_cost_pool_composition", {
      p_period: period,
    });
    for (const c of (comp as Record<string, unknown>[] | null) ?? []) {
      const entry = { component: String(c.component), share: Number(c.share) };
      (c.layer === "op" ? opComposition : fabComposition).push(entry);
    }
  }

  const num = (v: unknown) => (v == null ? null : Number(v));
  const rows: ProductCostRow[] = raw.map((r) => ({
    odooProductId: r.odoo_product_id == null ? null : Number(r.odoo_product_id),
    mpBuckets:
      r.odoo_product_id == null
        ? []
        : (mpByProduct.get(Number(r.odoo_product_id)) ?? []).sort(
            (a, b) => b.costUnitMxn - a.costUnitMxn,
          ),
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
    period,
    refreshedAt: (raw[0]?.refreshed_at as string) ?? null,
    fabComposition,
    opComposition,
  };
}

export const getProductCostCatalog = () =>
  unstable_cache(_raw, ["sp13-product-cost-catalog-v7-desglose"], {
    revalidate: 300,
    tags: ["sp13", "finanzas", "cost-centers"],
  })();
