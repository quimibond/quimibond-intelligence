import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * F5-LEARN — Parámetros aprendidos del histórico para el cash projection.
 *
 * En lugar de usar heurísticos asumidos (95/85/70/50/25 prob por aging,
 * 90d window de recurrencia, etc.), aquí backtesteamos contra los últimos
 * 12-18 meses de canonical_invoices y derivamos:
 *
 *   1. CALIBRACIÓN DE AGING — qué % de facturas en cada bucket realmente
 *      se cobran. Reemplaza las heurísticas hardcoded.
 *
 *   2. RECURRENCIA POR CONTRAPARTE — # meses activos en últimos 12 (vs
 *      ventana de 90d que es muy corta y clasifica a clientes
 *      estacionales como one-offs).
 *
 *   3. TREND FACTOR — ratio monthly_avg_recent (3m) / monthly_avg_prior
 *      (9m anteriores). Si cliente está creciendo, ajusta proyección.
 *
 *   4. DELAY PER COUNTERPARTY — mediana de payment_date - due_date sobre
 *      lookback amplio (12m vs 6m del RPC silver actual). Más estable
 *      cuando el cliente tiene poco volumen mensual.
 *
 * Refresh: cache 1h. Quimibond tiene 13,346 facturas pagadas con fechas
 * desde 2024 — suficiente data para calibración estable.
 */

export interface LearnedAgingCalibration {
  /** % de invoices que NUNCA cruzaron este aging y fueron pagadas. */
  paymentRateByBucket: {
    fresh: { rate: number; sampleSize: number };
    overdue_1_30: { rate: number; sampleSize: number };
    overdue_31_60: { rate: number; sampleSize: number };
    overdue_61_90: { rate: number; sampleSize: number };
    overdue_90_plus: { rate: number; sampleSize: number };
  };
  /**
   * Audit 2026-04-27 finding #9: rates por cliente (bronze company.id) con
   * shrinkage empírico Bayesiano hacia el global. Override del rate global
   * cuando un cliente tiene histórico suficiente.
   *
   * Shrinkage: adjusted = (n × customer + k × global) / (n + k)
   * con k=10 (pseudocount). Cliente con n=2 → casi 100% global; con n=50
   * → 83% personalizado, 17% global.
   *
   * Solo populated para AR (direction='issued'). AP no tiene aging-prob
   * (always 1.0) — no se beneficia.
   *
   * Plain object (no Map) porque unstable_cache puede serializar via JSON
   * y Maps no sobreviven el roundtrip. Keys son bronze_id stringified.
   */
  perCustomerByBronzeId: Record<
    string,
    {
      fresh: number;
      overdue_1_30: number;
      overdue_31_60: number;
      overdue_61_90: number;
      overdue_90_plus: number;
      totalSample: number;
    }
  >;
  asOfDate: string;
  totalSample: number;
}

export interface LearnedCounterpartyParams {
  /** bronze_id → params */
  byBronzeId: Map<
    number,
    {
      side: "customer" | "supplier";
      activeMonthsLast12: number;
      totalInvoiced12mMxn: number;
      monthlyAvgLast12mMxn: number;
      monthlyAvgRecent3mMxn: number;
      monthlyAvgPrior9mMxn: number;
      /** recent3m / prior9m. >1.1 = creciendo, <0.9 = decreciendo */
      trendFactor: number;
      medianDelayDays: number | null;
      paymentSampleSize: number;
    }
  >;
  asOfDate: string;
  totalCounterparties: number;
}

/**
 * Calibración de aging buckets desde history.
 *
 * Para cada factura issued >180d (ya tiene tiempo de mostrar outcome):
 *   - max_aging = MAX(0, COALESCE(payment_date, today) - due_date)
 *   - was_paid = payment_state_odoo = 'paid'
 * Por cada bucket (definido por el max_aging que alcanzó):
 *   rate = (paid / total)
 *
 * Si max_aging = 0 → bucket "fresh" (pagada antes o en due)
 * Si max_aging in [1, 30] → bucket "overdue_1_30"
 * etc.
 */
async function _getLearnedAgingCalibrationRaw(): Promise<LearnedAgingCalibration> {
  const sb = getServiceClient();
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const lookbackStart = new Date(today.getTime() - 540 * 86400000)
    .toISOString()
    .slice(0, 10);

  // Pull 18m de issued invoices con fechas; solo necesitamos las que
  // tienen due_date para calcular aging. Incluimos receptor canonical_id
  // para per-customer aggregation (audit #9).
  const PAGE = 1000;
  type Row = {
    receptor_canonical_company_id: number | null;
    invoice_date: string | null;
    due_date_resolved: string | null;
    payment_date_odoo: string | null;
    payment_state_odoo: string | null;
    estado_sat: string | null;
    amount_total_mxn_resolved: number | null;
  };
  const all: Row[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await sb
      .from("canonical_invoices")
      .select(
        "receptor_canonical_company_id, invoice_date, due_date_resolved, payment_date_odoo, payment_state_odoo, estado_sat, amount_total_mxn_resolved"
      )
      .eq("direction", "issued")
      .eq("is_quimibond_relevant", true)
      .or("estado_sat.is.null,estado_sat.neq.cancelado")
      .gte("invoice_date", lookbackStart)
      .lt("invoice_date", new Date(today.getTime() - 180 * 86400000).toISOString().slice(0, 10))
      .not("due_date_resolved", "is", null)
      .gt("amount_total_mxn_resolved", 0)
      .range(offset, offset + PAGE - 1);
    if (error) break;
    const rows = (data ?? []) as Row[];
    all.push(...rows);
    if (rows.length < PAGE) break;
    offset += PAGE;
  }

  type BucketName =
    | "fresh"
    | "overdue_1_30"
    | "overdue_31_60"
    | "overdue_61_90"
    | "overdue_90_plus";
  const emptyBuckets = (): Record<BucketName, { paid: number; total: number }> => ({
    fresh: { paid: 0, total: 0 },
    overdue_1_30: { paid: 0, total: 0 },
    overdue_31_60: { paid: 0, total: 0 },
    overdue_61_90: { paid: 0, total: 0 },
    overdue_90_plus: { paid: 0, total: 0 },
  });

  const globalBuckets = emptyBuckets();
  const byCanonical = new Map<number, ReturnType<typeof emptyBuckets>>();

  for (const r of all) {
    if (!r.due_date_resolved) continue;
    const dueMs = new Date(r.due_date_resolved).getTime();
    const observedMs = r.payment_date_odoo
      ? new Date(r.payment_date_odoo).getTime()
      : today.getTime();
    const maxAging = Math.max(
      0,
      Math.floor((observedMs - dueMs) / 86400000)
    );
    const wasPaid = r.payment_state_odoo === "paid";

    let bucket: BucketName;
    if (maxAging === 0) bucket = "fresh";
    else if (maxAging <= 30) bucket = "overdue_1_30";
    else if (maxAging <= 60) bucket = "overdue_31_60";
    else if (maxAging <= 90) bucket = "overdue_61_90";
    else bucket = "overdue_90_plus";

    globalBuckets[bucket].total++;
    if (wasPaid) globalBuckets[bucket].paid++;

    const cid = r.receptor_canonical_company_id;
    if (cid != null) {
      let cust = byCanonical.get(cid);
      if (!cust) {
        cust = emptyBuckets();
        byCanonical.set(cid, cust);
      }
      cust[bucket].total++;
      if (wasPaid) cust[bucket].paid++;
    }
  }

  const rate = (b: { paid: number; total: number }) =>
    b.total === 0 ? 0 : b.paid / b.total;

  const globalRates = {
    fresh: rate(globalBuckets.fresh),
    overdue_1_30: rate(globalBuckets.overdue_1_30),
    overdue_31_60: rate(globalBuckets.overdue_31_60),
    overdue_61_90: rate(globalBuckets.overdue_61_90),
    overdue_90_plus: rate(globalBuckets.overdue_90_plus),
  };

  // Resolver canonical_id → bronze company.id para que projection.ts pueda
  // cruzar con r.company_id de cashflow_projection. Mismo patrón que
  // _getLearnedCounterpartyParamsRaw.
  const canonicalIds = [...byCanonical.keys()];
  const canonicalToBronze = new Map<number, number>();
  if (canonicalIds.length > 0) {
    const chunkSize = 200;
    for (let i = 0; i < canonicalIds.length; i += chunkSize) {
      const chunk = canonicalIds.slice(i, i + chunkSize);
      const { data } = await sb
        .from("canonical_companies")
        .select("id, odoo_partner_id")
        .in("id", chunk)
        .not("odoo_partner_id", "is", null);
      const partnerIds: number[] = [];
      const ccByPartner = new Map<number, number>();
      for (const c of (data ?? []) as Array<{
        id: number | null;
        odoo_partner_id: number | null;
      }>) {
        if (c.id != null && c.odoo_partner_id != null) {
          partnerIds.push(c.odoo_partner_id);
          ccByPartner.set(c.odoo_partner_id, c.id);
        }
      }
      if (partnerIds.length > 0) {
        for (let j = 0; j < partnerIds.length; j += chunkSize) {
          const pchunk = partnerIds.slice(j, j + chunkSize);
          const { data: bronze } = await sb
            .from("companies")
            .select("id, odoo_partner_id")
            .in("odoo_partner_id", pchunk);
          for (const b of (bronze ?? []) as Array<{
            id: number | null;
            odoo_partner_id: number | null;
          }>) {
            if (b.id != null && b.odoo_partner_id != null) {
              const ccid = ccByPartner.get(b.odoo_partner_id);
              if (ccid != null) canonicalToBronze.set(ccid, b.id);
            }
          }
        }
      }
    }
  }

  // Shrinkage: clientes con poco sample se acercan al global. k=10 es
  // razonable — n=10 → 50/50, n=50 → 83% cliente, n=2 → 83% global.
  const PSEUDOCOUNT_K = 10;
  const shrinkRate = (
    customer: { paid: number; total: number },
    global: number
  ) =>
    (customer.paid + PSEUDOCOUNT_K * global) /
    (customer.total + PSEUDOCOUNT_K);

  const perCustomerByBronzeId: Record<
    string,
    {
      fresh: number;
      overdue_1_30: number;
      overdue_31_60: number;
      overdue_61_90: number;
      overdue_90_plus: number;
      totalSample: number;
    }
  > = {};
  for (const [cid, custBuckets] of byCanonical) {
    const bronzeId = canonicalToBronze.get(cid);
    if (bronzeId == null) continue;
    const totalSample =
      custBuckets.fresh.total +
      custBuckets.overdue_1_30.total +
      custBuckets.overdue_31_60.total +
      custBuckets.overdue_61_90.total +
      custBuckets.overdue_90_plus.total;
    // Solo populated cuando hay algo de evidencia; vacío si el cliente
    // tiene 0 facturas con outcome (lo deja en el global).
    if (totalSample === 0) continue;
    perCustomerByBronzeId[String(bronzeId)] = {
      fresh: shrinkRate(custBuckets.fresh, globalRates.fresh),
      overdue_1_30: shrinkRate(custBuckets.overdue_1_30, globalRates.overdue_1_30),
      overdue_31_60: shrinkRate(custBuckets.overdue_31_60, globalRates.overdue_31_60),
      overdue_61_90: shrinkRate(custBuckets.overdue_61_90, globalRates.overdue_61_90),
      overdue_90_plus: shrinkRate(custBuckets.overdue_90_plus, globalRates.overdue_90_plus),
      totalSample,
    };
  }

  return {
    paymentRateByBucket: {
      fresh: { rate: globalRates.fresh, sampleSize: globalBuckets.fresh.total },
      overdue_1_30: {
        rate: globalRates.overdue_1_30,
        sampleSize: globalBuckets.overdue_1_30.total,
      },
      overdue_31_60: {
        rate: globalRates.overdue_31_60,
        sampleSize: globalBuckets.overdue_31_60.total,
      },
      overdue_61_90: {
        rate: globalRates.overdue_61_90,
        sampleSize: globalBuckets.overdue_61_90.total,
      },
      overdue_90_plus: {
        rate: globalRates.overdue_90_plus,
        sampleSize: globalBuckets.overdue_90_plus.total,
      },
    },
    perCustomerByBronzeId,
    asOfDate: todayIso,
    totalSample: all.length,
  };
}

export const getLearnedAgingCalibration = unstable_cache(
  _getLearnedAgingCalibrationRaw,
  ["sp13-finanzas-learned-aging-v3-record"],
  { revalidate: 3600, tags: ["finanzas"] }
);

/**
 * Recurrencia por contraparte sobre últimos 12 meses + trend factor.
 *
 * Para cada bronze company (cliente y proveedor):
 *   - Pull invoices last 365d
 *   - Distinct months where they were active
 *   - Monthly avg = total / 12 (o total / # meses observados, según preferencia)
 *   - Trend = recent_3m / prior_9m (cap [0.5, 2.0] para evitar extremos)
 *   - Median delay (de paid invoices con due+payment dates)
 */
async function _getLearnedCounterpartyParamsRaw(): Promise<LearnedCounterpartyParams> {
  const sb = getServiceClient();
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const lookback365 = new Date(today.getTime() - 365 * 86400000)
    .toISOString()
    .slice(0, 10);
  const recent3mStart = new Date(today.getTime() - 90 * 86400000)
    .toISOString()
    .slice(0, 10);

  type Row = {
    receptor_canonical_company_id: number | null;
    emisor_canonical_company_id: number | null;
    direction: string;
    invoice_date: string | null;
    due_date_resolved: string | null;
    payment_date_odoo: string | null;
    amount_total_mxn_resolved: number | null;
  };

  const PAGE = 1000;
  const all: Row[] = [];
  for (const direction of ["issued", "received"]) {
    let offset = 0;
    while (true) {
      const { data, error } = await sb
        .from("canonical_invoices")
        .select(
          "receptor_canonical_company_id, emisor_canonical_company_id, direction, invoice_date, due_date_resolved, payment_date_odoo, amount_total_mxn_resolved"
        )
        .eq("direction", direction)
        .eq("is_quimibond_relevant", true)
        .or("estado_sat.is.null,estado_sat.neq.cancelado")
        .gte("invoice_date", lookback365)
        .gt("amount_total_mxn_resolved", 0)
        .range(offset, offset + PAGE - 1);
      if (error) break;
      const rows = (data ?? []) as Row[];
      all.push(...rows);
      if (rows.length < PAGE) break;
      offset += PAGE;
    }
  }

  type Aggregate = {
    side: "customer" | "supplier";
    canonicalId: number;
    months: Set<string>;
    total12m: number;
    totalRecent3m: number;
    totalPrior9m: number;
    delays: number[];
  };
  const byCanonical = new Map<number, Aggregate>();

  for (const r of all) {
    const cid =
      r.direction === "issued"
        ? r.receptor_canonical_company_id
        : r.emisor_canonical_company_id;
    if (cid == null) continue;
    if (!r.invoice_date) continue;
    const amt = Number(r.amount_total_mxn_resolved) || 0;
    if (amt <= 0) continue;
    const acc =
      byCanonical.get(cid) ??
      ({
        side: r.direction === "issued" ? "customer" : "supplier",
        canonicalId: cid,
        months: new Set<string>(),
        total12m: 0,
        totalRecent3m: 0,
        totalPrior9m: 0,
        delays: [],
      } as Aggregate);
    acc.months.add(r.invoice_date.slice(0, 7));
    acc.total12m += amt;
    if (r.invoice_date >= recent3mStart) acc.totalRecent3m += amt;
    else acc.totalPrior9m += amt;
    if (r.payment_date_odoo && r.due_date_resolved) {
      const delay = Math.max(
        0,
        Math.min(
          365,
          Math.floor(
            (new Date(r.payment_date_odoo).getTime() -
              new Date(r.due_date_resolved).getTime()) /
              86400000
          )
        )
      );
      acc.delays.push(delay);
    }
    byCanonical.set(cid, acc);
  }

  // Resolver canonical → bronze
  const canonicalIds = [...byCanonical.keys()];
  const canonicalToBronze = new Map<number, number>();
  if (canonicalIds.length > 0) {
    const chunkSize = 200;
    for (let i = 0; i < canonicalIds.length; i += chunkSize) {
      const chunk = canonicalIds.slice(i, i + chunkSize);
      const { data } = await sb
        .from("canonical_companies")
        .select("id, odoo_partner_id")
        .in("id", chunk)
        .not("odoo_partner_id", "is", null);
      const partnerIds: number[] = [];
      const ccByPartner = new Map<number, number>();
      for (const c of (data ?? []) as Array<{
        id: number | null;
        odoo_partner_id: number | null;
      }>) {
        if (c.id != null && c.odoo_partner_id != null) {
          partnerIds.push(c.odoo_partner_id);
          ccByPartner.set(c.odoo_partner_id, c.id);
        }
      }
      if (partnerIds.length > 0) {
        for (let j = 0; j < partnerIds.length; j += chunkSize) {
          const pchunk = partnerIds.slice(j, j + chunkSize);
          const { data: bronze } = await sb
            .from("companies")
            .select("id, odoo_partner_id")
            .in("odoo_partner_id", pchunk);
          for (const b of (bronze ?? []) as Array<{
            id: number | null;
            odoo_partner_id: number | null;
          }>) {
            if (b.id != null && b.odoo_partner_id != null) {
              const ccid = ccByPartner.get(b.odoo_partner_id);
              if (ccid != null) canonicalToBronze.set(ccid, b.id);
            }
          }
        }
      }
    }
  }

  const median = (arr: number[]): number | null => {
    if (arr.length === 0) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  };

  const byBronzeId = new Map<
    number,
    {
      side: "customer" | "supplier";
      activeMonthsLast12: number;
      totalInvoiced12mMxn: number;
      monthlyAvgLast12mMxn: number;
      monthlyAvgRecent3mMxn: number;
      monthlyAvgPrior9mMxn: number;
      trendFactor: number;
      medianDelayDays: number | null;
      paymentSampleSize: number;
    }
  >();

  for (const [canonicalId, agg] of byCanonical) {
    const bronzeId = canonicalToBronze.get(canonicalId);
    if (bronzeId == null) continue;
    const monthlyAvg12 = agg.total12m / 12;
    const monthlyAvgRecent = agg.totalRecent3m / 3;
    const monthlyAvgPrior = agg.totalPrior9m / 9;
    let trend = 1.0;
    if (monthlyAvgPrior > 0) {
      trend = Math.max(
        0.5,
        Math.min(2.0, monthlyAvgRecent / monthlyAvgPrior)
      );
    }
    byBronzeId.set(bronzeId, {
      side: agg.side,
      activeMonthsLast12: agg.months.size,
      totalInvoiced12mMxn: agg.total12m,
      monthlyAvgLast12mMxn: monthlyAvg12,
      monthlyAvgRecent3mMxn: monthlyAvgRecent,
      monthlyAvgPrior9mMxn: monthlyAvgPrior,
      trendFactor: trend,
      medianDelayDays: median(agg.delays),
      paymentSampleSize: agg.delays.length,
    });
  }

  return {
    byBronzeId,
    asOfDate: todayIso,
    totalCounterparties: byBronzeId.size,
  };
}

export const getLearnedCounterpartyParams = unstable_cache(
  _getLearnedCounterpartyParamsRaw,
  ["sp13-finanzas-learned-counterparty-v1"],
  { revalidate: 3600, tags: ["finanzas"] }
);

/**
 * F5-LEARN — Capa SAT (12+ años de historia).
 *
 * canonical_invoices solo tiene ~2 años de history. Pero syntage_invoices
 * (CFDIs SAT) tiene desde enero 2014 — 12+ años. Eso nos permite
 * clasificar contrapartes por:
 *   - Antigüedad (¿cliente long-term vs nuevo?)
 *   - Recurrencia multi-año (12 vs 60 meses activos)
 *   - Estacionalidad (¿siempre compra más en Q4?)
 *
 * Para mantener payload manejable, lookback 60 meses (5 años).
 * Podríamos ir hasta 120 (10 años) si performance lo permite.
 *
 * Este signal complementa learned-counterparty (12m precise) con la
 * profundidad histórica que canonical no tiene. Cliente con 1 mes en
 * canonical_invoices puede ser "long-term recurrent" en SAT (e.g.,
 * cliente estacional con 1 compra al año por 8 años).
 */
export interface LearnedHistoricalRecurrence {
  /** bronze_id → multi-year SAT signals */
  byBronzeId: Map<
    number,
    {
      side: "customer" | "supplier";
      rfc: string;
      activeMonthsLast60: number;
      activeMonthsLast24: number;
      firstSeenDate: string;
      lastSeenDate: string;
      yearsActive: number;
      annualAvgRevenueMxn: number;
      lifetimeRevenueMxn: number;
      /**
       * Seasonality multiplier per month (1-12). 1.0 = average month.
       * Calculado como avg(revenue_in_month_X) / avg(monthly_revenue).
       * Si Q4 promedia 1.4× mientras enero 0.6× → cliente estacional.
       */
      seasonalityByMonth: number[];
    }
  >;
  asOfDate: string;
  totalCounterparties: number;
  oldestRecord: string;
}

async function _getLearnedHistoricalRecurrenceRaw(): Promise<LearnedHistoricalRecurrence> {
  const sb = getServiceClient();
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const lookback60mIso = new Date(today.getTime() - 60 * 30 * 86400000)
    .toISOString();

  type Row = {
    direction: string;
    emisor_rfc: string | null;
    receptor_rfc: string | null;
    fecha_emision: string | null;
    total_mxn: number | null;
  };

  const PAGE = 1000;
  const all: Row[] = [];
  for (const direction of ["issued", "received"]) {
    let offset = 0;
    while (true) {
      const { data, error } = await sb
        .from("syntage_invoices")
        .select("direction, emisor_rfc, receptor_rfc, fecha_emision, total_mxn")
        .eq("tipo_comprobante", "I")
        .eq("direction", direction)
        .neq("estado_sat", "cancelado")
        .gte("fecha_emision", lookback60mIso)
        .gt("total_mxn", 0)
        .range(offset, offset + PAGE - 1);
      if (error) break;
      const rows = (data ?? []) as Row[];
      all.push(...rows);
      if (rows.length < PAGE) break;
      offset += PAGE;
      if (offset > 80_000) break; // safety cap
    }
  }

  type AggRfc = {
    side: "customer" | "supplier";
    rfc: string;
    months: Set<string>;
    firstSeen: string;
    lastSeen: string;
    total: number;
    monthlyTotals: Map<number, number>; // month-of-year (1-12) → revenue
    monthlyCount: Map<number, number>; // count of (year, month) pairs per month-of-year
  };
  const byRfc = new Map<string, AggRfc>();

  for (const r of all) {
    if (!r.fecha_emision) continue;
    const rfc =
      r.direction === "issued" ? r.receptor_rfc : r.emisor_rfc;
    if (!rfc) continue;
    const ym = r.fecha_emision.slice(0, 7);
    const monthOfYear = parseInt(r.fecha_emision.slice(5, 7), 10);
    const amt = Number(r.total_mxn) || 0;
    const acc =
      byRfc.get(rfc) ??
      ({
        side: r.direction === "issued" ? "customer" : "supplier",
        rfc,
        months: new Set<string>(),
        firstSeen: r.fecha_emision.slice(0, 10),
        lastSeen: r.fecha_emision.slice(0, 10),
        total: 0,
        monthlyTotals: new Map<number, number>(),
        monthlyCount: new Map<number, number>(),
      } as AggRfc);
    acc.months.add(ym);
    if (r.fecha_emision.slice(0, 10) < acc.firstSeen)
      acc.firstSeen = r.fecha_emision.slice(0, 10);
    if (r.fecha_emision.slice(0, 10) > acc.lastSeen)
      acc.lastSeen = r.fecha_emision.slice(0, 10);
    acc.total += amt;
    acc.monthlyTotals.set(
      monthOfYear,
      (acc.monthlyTotals.get(monthOfYear) ?? 0) + amt
    );
    byRfc.set(rfc, acc);
  }
  // Compute # observations per month-of-year (for seasonality avg)
  for (const acc of byRfc.values()) {
    for (const ym of acc.months) {
      const moy = parseInt(ym.slice(5, 7), 10);
      acc.monthlyCount.set(moy, (acc.monthlyCount.get(moy) ?? 0) + 1);
    }
  }

  // Resolver RFC → bronze id vía companies.rfc directo
  const rfcs = [...byRfc.keys()];
  const rfcToBronze = new Map<string, number>();
  if (rfcs.length > 0) {
    const chunkSize = 200;
    for (let i = 0; i < rfcs.length; i += chunkSize) {
      const chunk = rfcs.slice(i, i + chunkSize);
      const { data } = await sb
        .from("companies")
        .select("id, rfc")
        .in("rfc", chunk);
      for (const r of (data ?? []) as Array<{
        id: number | null;
        rfc: string | null;
      }>) {
        if (r.id != null && r.rfc) {
          // Si hay duplicados en Bronze por RFC, conservar el primero (menor id)
          if (!rfcToBronze.has(r.rfc) || rfcToBronze.get(r.rfc)! > r.id) {
            rfcToBronze.set(r.rfc, r.id);
          }
        }
      }
    }
  }

  const oldestRecord = all.reduce<string>(
    (acc, r) => (r.fecha_emision && r.fecha_emision < acc ? r.fecha_emision : acc),
    "9999-12-31"
  );

  const byBronzeId = new Map<
    number,
    {
      side: "customer" | "supplier";
      rfc: string;
      activeMonthsLast60: number;
      activeMonthsLast24: number;
      firstSeenDate: string;
      lastSeenDate: string;
      yearsActive: number;
      annualAvgRevenueMxn: number;
      lifetimeRevenueMxn: number;
      seasonalityByMonth: number[];
    }
  >();

  const cutoff24mIso = new Date(today.getTime() - 24 * 30 * 86400000)
    .toISOString()
    .slice(0, 10);
  for (const [rfc, agg] of byRfc) {
    const bronzeId = rfcToBronze.get(rfc);
    if (bronzeId == null) continue;

    const monthsLast24 = [...agg.months].filter((m) => m >= cutoff24mIso.slice(0, 7));
    const yearsActive = Math.max(
      1,
      Math.ceil(
        (new Date(agg.lastSeen).getTime() -
          new Date(agg.firstSeen).getTime()) /
          (365 * 86400000)
      )
    );
    const annualAvg = agg.total / yearsActive;

    // Seasonality: avg revenue per month-of-year normalized.
    // multiplier[i] = (avg_per_year_per_month[i]) / overall_monthly_avg
    const overallMonthly = agg.total / Math.max(1, agg.months.size);
    const seasonality: number[] = Array(13).fill(1.0); // index 0 unused
    for (let m = 1; m <= 12; m++) {
      const totalMonth = agg.monthlyTotals.get(m) ?? 0;
      const ocurrences = agg.monthlyCount.get(m) ?? 0;
      if (ocurrences > 0 && overallMonthly > 0) {
        seasonality[m] = totalMonth / ocurrences / overallMonthly;
      }
    }

    byBronzeId.set(bronzeId, {
      side: agg.side,
      rfc,
      activeMonthsLast60: agg.months.size,
      activeMonthsLast24: monthsLast24.length,
      firstSeenDate: agg.firstSeen,
      lastSeenDate: agg.lastSeen,
      yearsActive,
      annualAvgRevenueMxn: annualAvg,
      lifetimeRevenueMxn: agg.total,
      seasonalityByMonth: seasonality,
    });
  }

  return {
    byBronzeId,
    asOfDate: todayIso,
    totalCounterparties: byBronzeId.size,
    oldestRecord: oldestRecord === "9999-12-31" ? todayIso : oldestRecord,
  };
}

export const getLearnedHistoricalRecurrence = unstable_cache(
  _getLearnedHistoricalRecurrenceRaw,
  ["sp13-finanzas-learned-historical-v1"],
  { revalidate: 3600, tags: ["finanzas"] }
);

/**
 * Probabilidad por tier de recurrencia, aprendida del histórico 12m.
 *
 * Antes (heurístico):
 *   3+ meses en últimos 90d (3 de 3) → fuerte
 *   2 meses (2 de 3)                  → débil
 *   1 mes (1 de 3)                    → one-off
 *
 * Ahora (12m):
 *   ≥9 meses activos en 12 → muy fuerte (compras casi todos los meses)
 *   6-8 meses              → fuerte
 *   3-5 meses              → moderado
 *   2 meses                → débil (estacional o esporádico)
 *   1 mes                  → one-off (skip)
 *
 * Las probabilidades de proyección se ajustan por tier × calibración
 * empírica (rate paid del aging fresh).
 */
export function probabilityForRecurrence(
  activeMonthsLast12: number,
  side: "customer" | "supplier",
  freshPaymentRate: number
): number {
  // Base por tier (ratio de continuidad)
  let baseProb = 0;
  if (activeMonthsLast12 >= 9) baseProb = 0.9;
  else if (activeMonthsLast12 >= 6) baseProb = 0.75;
  else if (activeMonthsLast12 >= 3) baseProb = 0.55;
  else if (activeMonthsLast12 === 2) baseProb = 0.3;
  else return 0; // 1 mes = one-off

  // Multiplicar por la tasa empírica de cobro/pago "fresh" (calibración).
  // freshPaymentRate ≈ 0.95 si el modelo asumido era correcto; típicamente
  // <0.95 en Quimibond por morosidad estructural. Ajusta hacia abajo
  // si la realidad es peor que la heurística.
  const calibration = Math.max(0.5, Math.min(1.0, freshPaymentRate));
  const finalProb = baseProb * calibration;
  // Suppliers ligeramente mayor (compras más predecibles que ventas)
  return side === "supplier" ? Math.min(1.0, finalProb * 1.1) : finalProb;
}
