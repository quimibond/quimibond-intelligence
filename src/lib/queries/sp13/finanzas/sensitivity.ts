import "server-only";
import type { CashProjection, CashFlowCategoryTotal } from "./projection";

/**
 * F-SENS — Sensitivity analysis + Monte Carlo sobre el cash projection.
 *
 * En lugar de re-correr toda la proyección N veces (lento), explotamos
 * la linealidad: el closing balance = opening + Σ(inflows) − Σ(outflows).
 * Cada componente del flujo escala ~linealmente con sus parámetros
 * (probabilidad de cobro, delay, probabilidad de recurrencia, etc.).
 *
 * SENSIBILIDAD (tornado):
 *   Para cada componente, computa el impacto en closing balance de un
 *   shock de ±10% en la probabilidad. El signo depende de si es inflow
 *   (positivo en closing) o outflow (negativo).
 *
 * MONTE CARLO:
 *   Sample N=500 escenarios. Cada uno aplica multiplicadores aleatorios
 *   N(1, 0.10) a cada componente independientemente. Computa la
 *   distribución del closing balance. Output: p10, p25, p50, p75, p90 +
 *   probabilidad de caer bajo el safety floor.
 *
 * Esto da al CEO bandas de confianza realistas en lugar de un valor
 * único que parece preciso pero ignora la incertidumbre de los inputs.
 */

export interface SensitivityRow {
  variable: string;
  label: string;
  description: string;
  /** Componente categoryTotals al que aplica el shock */
  componentMxn: number;
  /** Impacto en closing balance por shock +10% (signed). */
  impactPlus10Mxn: number;
  /** Impacto absoluto (para ordenar tornado) */
  absImpactMxn: number;
  /** Direction en el closing balance */
  direction: "positive" | "negative";
}

export interface MonteCarloResult {
  iterations: number;
  baselineClosingMxn: number;
  closingP10Mxn: number;
  closingP25Mxn: number;
  closingP50Mxn: number;
  closingP75Mxn: number;
  closingP90Mxn: number;
  /** % de escenarios donde closing < baseline_closing − safetyFloor */
  probBelowSafetyFloor: number;
  probNegativeClosing: number;
  worstCaseScenarioMxn: number;
  bestCaseScenarioMxn: number;
}

export interface SensitivitySnapshot {
  baselineClosingMxn: number;
  baselineMinMxn: number;
  safetyFloor: number;
  horizonDays: number;
  sensitivity: SensitivityRow[];
  monteCarlo: MonteCarloResult;
}

const INFLOW_CATEGORIES = new Set([
  "ar_cobranza",
  "ventas_confirmadas",
  "runrate_clientes",
  "ventas_proyectadas",
]);
const OUTFLOW_CATEGORIES_KNOWN = new Set([
  "ap_proveedores",
  "runrate_proveedores",
  "nomina",
  "renta",
  "servicios",
  "arrendamiento",
  "impuestos_sat",
]);

const labelFor = (category: string): { label: string; description: string } => {
  switch (category) {
    case "ar_cobranza":
      return {
        label: "Tasa cobro AR",
        description:
          "% de facturas emitidas que se cobran. Si bajamos 10%, este monto sale del closing.",
      };
    case "ventas_confirmadas":
      return {
        label: "Realización SO pipeline",
        description:
          "% de SOs confirmadas que se facturan + cobran. Riesgo de cancelación o retraso de entrega.",
      };
    case "runrate_clientes":
      return {
        label: "Demanda nueva clientes",
        description:
          "Run rate residual: nuevas órdenes en horizonte. Más volátil que SO confirmadas.",
      };
    case "ap_proveedores":
      return {
        label: "Pago AP a tiempo",
        description:
          "% de AP que se paga en horizonte. Si estiramos 10%, este monto se queda en cash.",
      };
    case "runrate_proveedores":
      return {
        label: "Compras nuevas proveedores",
        description:
          "Run rate de compras nuevas en horizonte. Si bajamos compras, sale menos cash.",
      };
    case "nomina":
      return {
        label: "Nómina (sueldos)",
        description:
          "Pagos a empleados. Componente crítico — difícil de variar sin afectar operación.",
      };
    case "renta":
    case "servicios":
    case "arrendamiento":
      return {
        label: `${category[0].toUpperCase()}${category.slice(1)} (recurrente)`,
        description: "Gasto recurrente operativo. Difícil de variar a corto plazo.",
      };
    case "impuestos_sat":
      return {
        label: "Impuestos SAT/IMSS",
        description:
          "Cuotas patronales + retenciones. Obligación legal — no se puede variar.",
      };
    default:
      return { label: category, description: "Componente del cashflow." };
  }
};

const SHOCK_PCT = 0.1; // ±10%

function sampleNormal(mean: number, std: number): number {
  // Box-Muller
  let u = 0,
    v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return mean + z * std;
}

function percentile(arr: number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor((sorted.length - 1) * p);
  return sorted[idx] ?? 0;
}

export function computeSensitivity(
  proj: CashProjection,
  iterations = 500
): SensitivitySnapshot {
  const cats = proj.categoryTotals;
  const baseline = proj.closingBalance;
  const baselineMin = proj.minBalance;
  const horizonDays = proj.horizonDays;
  const safetyFloor = proj.safetyFloor;

  // Sensibilidad: por cada componente, impacto del shock +10%
  const sensitivity: SensitivityRow[] = [];
  for (const c of cats) {
    const isInflow = INFLOW_CATEGORIES.has(c.category);
    const isOutflow = OUTFLOW_CATEGORIES_KNOWN.has(c.category);
    if (!isInflow && !isOutflow) continue; // skip unknown (e.g. intercompañía)
    const sign = isInflow ? 1 : -1;
    const impact = sign * c.amountMxn * SHOCK_PCT;
    const meta = labelFor(c.category);
    sensitivity.push({
      variable: c.category,
      label: meta.label,
      description: meta.description,
      componentMxn: c.amountMxn,
      impactPlus10Mxn: impact,
      absImpactMxn: Math.abs(impact),
      direction: isInflow ? "positive" : "negative",
    });
  }
  sensitivity.sort((a, b) => b.absImpactMxn - a.absImpactMxn);

  // Monte Carlo: cada iteración aplica multiplicadores N(1, 0.10) a cada
  // componente. Δclosing = Σ(component × (multiplier - 1)) × sign.
  const closings: number[] = [];
  for (let i = 0; i < iterations; i++) {
    let delta = 0;
    for (const c of cats) {
      const isInflow = INFLOW_CATEGORIES.has(c.category);
      const isOutflow = OUTFLOW_CATEGORIES_KNOWN.has(c.category);
      if (!isInflow && !isOutflow) continue;
      const sign = isInflow ? 1 : -1;
      // Std mayor para componentes más volátiles (run rate vs nómina)
      let std = 0.1;
      if (c.category === "runrate_clientes" || c.category === "runrate_proveedores")
        std = 0.15; // run rate es más incierto
      if (
        c.category === "nomina" ||
        c.category === "renta" ||
        c.category === "impuestos_sat"
      )
        std = 0.05; // recurrentes operativos son más estables
      const multiplier = Math.max(0.3, Math.min(2.0, sampleNormal(1, std)));
      delta += sign * c.amountMxn * (multiplier - 1);
    }
    closings.push(baseline + delta);
  }

  const sortedClosings = [...closings].sort((a, b) => a - b);
  const baselineMinusFloor = baseline - safetyFloor;
  const belowFloor = closings.filter((c) => c < safetyFloor).length;
  const negative = closings.filter((c) => c < 0).length;

  const monteCarlo: MonteCarloResult = {
    iterations,
    baselineClosingMxn: Math.round(baseline),
    closingP10Mxn: Math.round(percentile(closings, 0.1)),
    closingP25Mxn: Math.round(percentile(closings, 0.25)),
    closingP50Mxn: Math.round(percentile(closings, 0.5)),
    closingP75Mxn: Math.round(percentile(closings, 0.75)),
    closingP90Mxn: Math.round(percentile(closings, 0.9)),
    probBelowSafetyFloor: Math.round((belowFloor / iterations) * 1000) / 10,
    probNegativeClosing: Math.round((negative / iterations) * 1000) / 10,
    worstCaseScenarioMxn: Math.round(sortedClosings[0]),
    bestCaseScenarioMxn: Math.round(sortedClosings[sortedClosings.length - 1]),
  };
  void baselineMinusFloor;

  return {
    baselineClosingMxn: Math.round(baseline),
    baselineMinMxn: Math.round(baselineMin),
    safetyFloor,
    horizonDays,
    sensitivity,
    monteCarlo,
  };
}

// Re-export the type for consumers
export type { CashFlowCategoryTotal };
