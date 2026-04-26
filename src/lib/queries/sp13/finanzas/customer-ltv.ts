import "server-only";
import { unstable_cache } from "next/cache";
import { getCustomerCreditScores } from "./customer-credit-score";
import {
  getLearnedCounterpartyParams,
  getLearnedHistoricalRecurrence,
} from "./learned-params";

/**
 * F-LTV — Customer Lifetime Value proyectado a 5 años.
 *
 * Combina TODA la inteligencia del sistema (credit score + canonical 12m
 * + SAT 60m + trend + WACC) en un solo número: ¿cuánto vale este cliente
 * para Quimibond en valor presente neto a 5 años?
 *
 * Modelo:
 *   LTV = Σ(annual_revenue_t × margin × retention_t) / (1 + WACC)^t
 *   para t = 1..5 años
 *
 *   annual_revenue_t = monthly_avg × 12 × growth_factor^(t-1)
 *   retention_t = retention_prob^t  (cliente puede irse cualquier año)
 *   retention_prob = derivada del credit_score / 100, capada [0.5, 0.95]
 *   growth_factor = trend (recent3m/prior9m), cap [0.8, 1.2]
 *   margin = margin neto Quimibond (configurable, default 20% — gross
 *            margin típico textil mexicano)
 *   WACC = 15% (costo de capital SMB Mexicano típico)
 *
 * Uso CEO:
 *   - Identificar clientes con LTV alto vs revenue actual (pueden diferir)
 *   - Top clientes para "cultivar" (descuentos, atención, reps)
 *   - Clientes con LTV bajo + AR abierto alto = mal riesgo (rechazar más)
 *   - Valor total del portafolio = suma de LTVs (proxy del valor empresa)
 *
 * Refresh: 1h.
 */

export interface CustomerLtvRow {
  bronzeId: number;
  customerName: string;
  rfc: string | null;
  // Inputs
  monthlyAvgMxn: number;
  annualRevenueMxn: number;
  trendFactor: number;
  growthCapped: number;
  creditScore: number;
  retentionProb: number; // anual
  yearsActive: number;
  // Output
  ltv5yMxn: number;
  ltvDiscountedMxn: number; // NPV
  // Comparativos
  rankByLtv: number;
  rankByRevenue: number;
  rankDelta: number; // si LTV rank << revenue rank, customer infravalorado
  // Risk signals
  arOpenMxn: number;
  ltvVsArRatio: number; // LTV/AR — < 1 = mal riesgo (debe más de lo que vale)
  // Recommendation
  ltvCategory: "estrella" | "valioso" | "mantener" | "bajo_valor" | "evitar";
  recommendation: string;
}

export interface CustomerLtvSummary {
  rows: CustomerLtvRow[];
  asOfDate: string;
  totalCustomers: number;
  portfolioLtvMxn: number; // suma de todos los LTVs
  topQuartileLtvMxn: number; // suma del top 25% (Pareto)
  assumptions: {
    horizonYears: number;
    waccPct: number;
    grossMarginPct: number;
  };
}

// Asumptions (configurable; podríamos exponer settings en futuro)
const HORIZON_YEARS = 5;
const WACC = 0.15;
const GROSS_MARGIN = 0.2;

const ltvCategoryFor = (
  ltv: number,
  arRatio: number
): CustomerLtvRow["ltvCategory"] => {
  if (ltv >= 5_000_000) return "estrella";
  if (ltv >= 1_000_000) return "valioso";
  if (arRatio < 0.5) return "evitar"; // debe más que su valor
  if (ltv >= 200_000) return "mantener";
  return "bajo_valor";
};

const recommendationFor = (
  cat: CustomerLtvRow["ltvCategory"]
): string => {
  switch (cat) {
    case "estrella":
      return "Cliente clave — KAM dedicado, descuento volumen, prioridad operativa.";
    case "valioso":
      return "Importante — atención reps, mantener relación a largo plazo.";
    case "mantener":
      return "Cliente estándar — operación normal, monitorear retención.";
    case "bajo_valor":
      return "Bajo valor — no invertir recursos extras de venta/atención.";
    case "evitar":
      return "Mal riesgo — debe más de lo que vale. Evaluar cobranza dura o cerrar relación.";
  }
};

async function _getCustomerLtvRaw(): Promise<CustomerLtvSummary> {
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);

  const [credit, counterparty, historical] = await Promise.all([
    getCustomerCreditScores(),
    getLearnedCounterpartyParams(),
    getLearnedHistoricalRecurrence(),
  ]);

  // Compute LTV per customer with credit score
  type Computed = Omit<CustomerLtvRow, "rankByLtv" | "rankByRevenue" | "rankDelta">;
  const computed: Computed[] = [];

  for (const c of credit.rows) {
    const cp = counterparty.byBronzeId.get(c.bronzeId);
    const sat = historical.byBronzeId.get(c.bronzeId);
    if (!cp) continue;

    const monthlyAvg = c.monthlyAvgMxn;
    if (monthlyAvg < 5_000) continue;

    const annualRev = monthlyAvg * 12;
    // Growth: cap conservadoramente
    const trendFactor = c.trendFactor;
    const growth = Math.max(0.8, Math.min(1.2, trendFactor));
    // Retention: del credit score, capada [0.5, 0.95]
    const retentionProb = Math.max(0.5, Math.min(0.95, c.score / 100));

    // NPV de cash flows operativos
    let ltvDiscounted = 0;
    let ltvUndiscounted = 0;
    for (let t = 1; t <= HORIZON_YEARS; t++) {
      const revT = annualRev * Math.pow(growth, t - 1);
      const grossT = revT * GROSS_MARGIN;
      const retainedT = grossT * Math.pow(retentionProb, t);
      const discounted = retainedT / Math.pow(1 + WACC, t);
      ltvDiscounted += discounted;
      ltvUndiscounted += retainedT;
    }

    const arRatio = c.arOpenMxn > 0 ? ltvDiscounted / c.arOpenMxn : Infinity;
    const ltvCategory = ltvCategoryFor(ltvDiscounted, arRatio);

    computed.push({
      bronzeId: c.bronzeId,
      customerName: c.customerName,
      rfc: c.rfc,
      monthlyAvgMxn: monthlyAvg,
      annualRevenueMxn: Math.round(annualRev),
      trendFactor: c.trendFactor,
      growthCapped: growth,
      creditScore: c.score,
      retentionProb,
      yearsActive: sat?.yearsActive ?? 0,
      ltv5yMxn: Math.round(ltvUndiscounted),
      ltvDiscountedMxn: Math.round(ltvDiscounted),
      arOpenMxn: c.arOpenMxn,
      ltvVsArRatio:
        arRatio === Infinity ? -1 : Math.round(arRatio * 10) / 10,
      ltvCategory,
      recommendation: recommendationFor(ltvCategory),
    });
  }

  // Rankings
  const byLtv = [...computed].sort(
    (a, b) => b.ltvDiscountedMxn - a.ltvDiscountedMxn
  );
  const byRevenue = [...computed].sort(
    (a, b) => b.annualRevenueMxn - a.annualRevenueMxn
  );

  const ltvRanks = new Map<number, number>();
  byLtv.forEach((r, i) => ltvRanks.set(r.bronzeId, i + 1));
  const revRanks = new Map<number, number>();
  byRevenue.forEach((r, i) => revRanks.set(r.bronzeId, i + 1));

  const rows: CustomerLtvRow[] = byLtv.map((r) => ({
    ...r,
    rankByLtv: ltvRanks.get(r.bronzeId) ?? 0,
    rankByRevenue: revRanks.get(r.bronzeId) ?? 0,
    rankDelta:
      (revRanks.get(r.bronzeId) ?? 0) - (ltvRanks.get(r.bronzeId) ?? 0),
  }));

  const portfolioLtv = rows.reduce((s, r) => s + r.ltvDiscountedMxn, 0);
  const topQuartileCount = Math.max(1, Math.floor(rows.length * 0.25));
  const topQuartileLtv = rows
    .slice(0, topQuartileCount)
    .reduce((s, r) => s + r.ltvDiscountedMxn, 0);

  return {
    rows,
    asOfDate: todayIso,
    totalCustomers: rows.length,
    portfolioLtvMxn: Math.round(portfolioLtv),
    topQuartileLtvMxn: Math.round(topQuartileLtv),
    assumptions: {
      horizonYears: HORIZON_YEARS,
      waccPct: WACC * 100,
      grossMarginPct: GROSS_MARGIN * 100,
    },
  };
}

export const getCustomerLtv = unstable_cache(
  _getCustomerLtvRaw,
  ["sp13-finanzas-customer-ltv-v1"],
  { revalidate: 3600, tags: ["finanzas"] }
);
