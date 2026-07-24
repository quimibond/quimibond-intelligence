import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";
import {
  getProductCostCatalog,
  type ProductCostCatalog,
} from "./product-cost-catalog";

/**
 * Cotizador vivo — datos para la calculadora de precio por producto.
 *
 * Reúne, en vivo, las tres piezas que una hoja de cálculo NO puede armar sola:
 *  1. Catálogo de costos por producto (BOM recursiva ya explotada, sin captura
 *     manual de composición → sin error) — reusa getProductCostCatalog.
 *  2. Pool de gastos del mes y el VOLUMEN entre el que se divide
 *     (get_cost_factors_monthly): el fijo de fabricación y su denominador de kg.
 *     Con esto la UI puede dividir el pool entre más volumen (dilución).
 *  3. Tipo de cambio USD→MXN (canonical_fx_rates) para cotizar en dólares.
 *
 * La calculadora (contribución / margen neto / pisos / dilución) vive en el
 * cliente: la aritmética es simple una vez que estos insumos están resueltos.
 */

export interface CotizadorFactors {
  /** Mes del que salen el pool y el denominador (YYYY-MM). */
  mes: string;
  /** Pool FIJO de fabricación del mes (MOD + OH + arrendamiento + deprec.). */
  gastosFabMxn: number;
  /** Pool de operación del mes (6xx admin/ventas/corporativo). */
  gastosOpMxn: number;
  /** Denominador de fabricación: kg inspeccionados (lo producido vendible). */
  kgInspeccion: number;
  /** Denominador de operación: kg vendidos. */
  kgVendidos: number;
  /** Factor fabricación $/kg suavizado (pool ÷ kg, promedio móvil 12m). */
  factorFabKg: number | null;
  /** Operación como % de ventas (el modelo la reparte por venta, no por kg). */
  opPct: number | null;
}

export interface CotizadorData {
  catalog: ProductCostCatalog;
  factors: CotizadorFactors | null;
  /** MXN por 1 USD. */
  fxMxnPerUsd: number;
  fxDate: string | null;
}

function n(v: unknown): number {
  if (v == null) return 0;
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
}
function nOrNull(v: unknown): number | null {
  if (v == null) return null;
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : null;
}

async function _raw(): Promise<CotizadorData> {
  const sb = getServiceClient();

  const [catalog, factorsRes, fxRes] = await Promise.all([
    getProductCostCatalog(),
    sb.rpc("get_cost_factors_monthly", { p_months_back: 36 }),
    sb
      .from("canonical_fx_rates")
      .select("rate, rate_date")
      .eq("currency", "USD")
      .eq("recency_rank", 1)
      .maybeSingle(),
  ]);

  // Último mes con pool y denominador válidos (excluye cierre anual con saldos
  // negativos y meses sin producción de referencia).
  const factorRows = (factorsRes.data ?? []) as Record<string, unknown>[];
  const valid = factorRows
    .filter((f) => n(f.gastos_fabricacion_mxn) > 0 && n(f.kg_inspeccion) > 0)
    .sort((a, b) => (a.mes as string).localeCompare(b.mes as string));
  const last = valid[valid.length - 1];

  let factors: CotizadorFactors | null = null;
  if (last) {
    factors = {
      mes: last.mes as string,
      gastosFabMxn: n(last.gastos_fabricacion_mxn),
      gastosOpMxn: n(last.gastos_operacion_mxn),
      kgInspeccion: n(last.kg_inspeccion),
      kgVendidos: n(last.kg_vendidos),
      factorFabKg: nOrNull(last.factor_fab_kg_smooth),
      // op se reparte como % de ventas (op_unit = op_pct × precio) — se deriva
      // por producto en el cliente (opUnit/precioRef); aquí no hay % global.
      opPct: null,
    };
  }

  const fx = fxRes.data as { rate: number; rate_date: string } | null;

  return {
    catalog,
    factors,
    fxMxnPerUsd: fx?.rate ? Number(fx.rate) : 17.52,
    fxDate: fx?.rate_date ?? null,
  };
}

export const getCotizadorData = () =>
  unstable_cache(_raw, ["sp13-cotizador-v1"], {
    revalidate: 300,
    tags: ["sp13", "finanzas", "cost-centers"],
  })();
