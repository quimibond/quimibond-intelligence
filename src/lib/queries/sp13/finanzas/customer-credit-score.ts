import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";
import {
  getLearnedCounterpartyParams,
  getLearnedHistoricalRecurrence,
} from "./learned-params";

/**
 * F-CREDIT — Score de riesgo crediticio por cliente.
 *
 * Combina los signals que ya tiene el modelo para dar un score 0-100 y
 * un límite de crédito recomendado por contraparte. Reusa la
 * infraestructura de aprendizaje (canonical 12m + SAT 60m) — no genera
 * cómputo nuevo, solo combina y ajusta.
 *
 * El score guía decisiones operativas:
 *   80-100 (verde):  Cliente confiable. Crédito amplio (hasta 2× monthly).
 *   60-79 (verde claro): Cliente bueno. Crédito normal (1.5× monthly).
 *   40-59 (amarillo): Cliente regular. Crédito conservador (1× monthly).
 *   20-39 (naranja): Cliente con problemas. Crédito reducido (0.5×).
 *   0-19  (rojo):    Solo prepago / contado. NO extender crédito.
 *
 * Componentes del score (100 pts):
 *   PAYMENT BEHAVIOR (40 pts):
 *     median_delay 0d → 40 pts; 30d → 25; 60d → 10; 90+d → 0 (lineal)
 *   RECURRENCE/LOYALTY (25 pts):
 *     active_months_last_12 × 12.5 / 12 (max 12.5)
 *     years_active capped 5y × 2.5 (max 12.5)
 *   VOLUME/SCALE (15 pts):
 *     log10(monthly_avg / 10000) × 5, capped [0, 15]
 *     ($10k/mo = 0pts, $100k/mo = 5pts, $1M/mo = 10pts, $10M/mo = 15pts)
 *   AR CURRENT STATUS (15 pts):
 *     0% AR vencido: 15; <20%: 10; 20-50%: 5; >50%: 0
 *   TREND (5 pts):
 *     growing (trend > 1.1): 5; stable [0.9, 1.1]: 3; declining: 0
 *
 * Penalizaciones:
 *   Blacklist SAT 'definitive' o 'presumed': score = 0 (rechazo total)
 *   Years inactive >1 (sin facturar último año): cap score 30
 *
 * Refresh: cache 1h, igual que otros learned params.
 */

export type CreditTier =
  | "excelente"
  | "bueno"
  | "regular"
  | "riesgo"
  | "rechazo";

export interface CustomerCreditScore {
  bronzeId: number;
  customerName: string;
  rfc: string | null;
  score: number; // 0-100
  tier: CreditTier;
  tone: "success" | "info" | "warning" | "danger" | "destructive";
  // Componentes (transparencia)
  paymentBehaviorPts: number;
  recurrencePts: number;
  volumePts: number;
  arStatusPts: number;
  trendPts: number;
  // Métricas underlying
  medianDelayDays: number | null;
  activeMonthsLast12: number;
  yearsActive: number;
  monthlyAvgMxn: number;
  arOpenMxn: number;
  arOverdueMxn: number;
  arOverduePct: number;
  trendFactor: number;
  blacklistStatus: string | null;
  // Decisión recomendada
  recommendedCreditLimitMxn: number;
  currentExposureMxn: number;
  availableCreditMxn: number;
  reason: string;
}

export interface CustomerCreditScoreSummary {
  rows: CustomerCreditScore[];
  asOfDate: string;
  totalCustomers: number;
  byTier: Record<CreditTier, number>;
}

const tierFromScore = (score: number): CreditTier => {
  if (score >= 80) return "excelente";
  if (score >= 60) return "bueno";
  if (score >= 40) return "regular";
  if (score >= 20) return "riesgo";
  return "rechazo";
};
const toneFromTier = (
  t: CreditTier
): "success" | "info" | "warning" | "danger" | "destructive" => {
  switch (t) {
    case "excelente":
      return "success";
    case "bueno":
      return "info";
    case "regular":
      return "warning";
    case "riesgo":
      return "danger";
    case "rechazo":
      return "destructive";
  }
};

const limitMultiplierFromScore = (score: number): number => {
  if (score >= 80) return 2.0;
  if (score >= 60) return 1.5;
  if (score >= 40) return 1.0;
  if (score >= 20) return 0.5;
  return 0;
};

async function _getCustomerCreditScoresRaw(): Promise<CustomerCreditScoreSummary> {
  const sb = getServiceClient();
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);

  const [counterparty, historical] = await Promise.all([
    getLearnedCounterpartyParams(),
    getLearnedHistoricalRecurrence(),
  ]);

  // AR exposure y blacklist por bronze id (top customers).
  // amount_residual_mxn_resolved > 0 → AR abierto.
  type ArRow = {
    receptor_canonical_company_id: number | null;
    amount_residual_mxn_resolved: number | null;
    fiscal_days_to_due_date: number | null;
    receptor_blacklist_status: string | null;
    receptor_nombre: string | null;
  };
  const PAGE = 1000;
  const arRows: ArRow[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await sb
      .from("canonical_invoices")
      .select(
        "receptor_canonical_company_id, amount_residual_mxn_resolved, fiscal_days_to_due_date, receptor_blacklist_status, receptor_nombre"
      )
      .eq("direction", "issued")
      .eq("is_quimibond_relevant", true)
      .or("estado_sat.is.null,estado_sat.neq.cancelado")
      .gt("amount_residual_mxn_resolved", 0)
      .range(offset, offset + PAGE - 1);
    if (error) break;
    const rows = (data ?? []) as ArRow[];
    arRows.push(...rows);
    if (rows.length < PAGE) break;
    offset += PAGE;
  }

  // Aggregate AR per canonical (open + overdue) + capture blacklist y nombre
  type ArAgg = {
    open: number;
    overdue: number;
    blacklist: string | null;
    name: string;
  };
  const arByCanonical = new Map<number, ArAgg>();
  for (const r of arRows) {
    const cid = r.receptor_canonical_company_id;
    if (cid == null) continue;
    const acc =
      arByCanonical.get(cid) ?? { open: 0, overdue: 0, blacklist: null, name: "" };
    const amt = Number(r.amount_residual_mxn_resolved) || 0;
    acc.open += amt;
    if ((r.fiscal_days_to_due_date ?? 1) <= 0) {
      acc.overdue += amt;
    }
    if (
      r.receptor_blacklist_status &&
      r.receptor_blacklist_status !== "unlisted" &&
      acc.blacklist == null
    ) {
      acc.blacklist = r.receptor_blacklist_status;
    }
    if (!acc.name && r.receptor_nombre) acc.name = r.receptor_nombre;
    arByCanonical.set(cid, acc);
  }

  // Resolver canonical → bronze + capturar nombres + filtrar partes relacionadas.
  const bronzeIds = [...counterparty.byBronzeId.keys()].filter(
    (id) => counterparty.byBronzeId.get(id)?.side === "customer"
  );
  const bronzeToCanonical = new Map<number, number>();
  const bronzeNames = new Map<number, string>();
  const relatedPartyBronzeIds = new Set<number>();

  // Pull related party bronze IDs vía RFC (mismo patrón que projection.ts)
  const { data: relatedRfcData } = await sb
    .from("canonical_companies")
    .select("rfc")
    .eq("is_related_party", true)
    .not("rfc", "is", null);
  const relatedRfcs = ((relatedRfcData ?? []) as Array<{ rfc: string | null }>)
    .map((r) => r.rfc)
    .filter((r): r is string => !!r);
  if (relatedRfcs.length > 0) {
    const { data: bronzeRelData } = await sb
      .from("companies")
      .select("id")
      .in("rfc", relatedRfcs);
    for (const c of (bronzeRelData ?? []) as Array<{ id: number | null }>) {
      if (c.id != null) relatedPartyBronzeIds.add(c.id);
    }
  }

  if (bronzeIds.length > 0) {
    const chunkSize = 200;
    for (let i = 0; i < bronzeIds.length; i += chunkSize) {
      const chunk = bronzeIds.slice(i, i + chunkSize);
      const { data } = await sb
        .from("companies")
        .select("id, odoo_partner_id, name")
        .in("id", chunk);
      type Row = {
        id: number | null;
        odoo_partner_id: number | null;
        name: string | null;
      };
      // Capture nombre por bronze id (fallback cuando no hay AR abierto)
      for (const b of (data ?? []) as Row[]) {
        if (b.id != null && b.name) bronzeNames.set(b.id, b.name);
      }
      const partnerIds = (data ?? [])
        .map((r) => (r as Row).odoo_partner_id)
        .filter((p): p is number => p != null);
      const ccChunkSize = 200;
      for (let j = 0; j < partnerIds.length; j += ccChunkSize) {
        const pchunk = partnerIds.slice(j, j + ccChunkSize);
        const { data: ccData } = await sb
          .from("canonical_companies")
          .select("id, odoo_partner_id")
          .in("odoo_partner_id", pchunk);
        for (const c of (ccData ?? []) as Array<{
          id: number | null;
          odoo_partner_id: number | null;
        }>) {
          if (c.id == null || c.odoo_partner_id == null) continue;
          for (const b of (data ?? []) as Row[]) {
            if (b.id != null && b.odoo_partner_id === c.odoo_partner_id) {
              bronzeToCanonical.set(b.id, c.id);
              break;
            }
          }
        }
      }
    }
  }

  // Compute score per customer
  const scores: CustomerCreditScore[] = [];
  for (const bronzeId of bronzeIds) {
    if (relatedPartyBronzeIds.has(bronzeId)) continue; // intercompañía fuera
    const cp = counterparty.byBronzeId.get(bronzeId);
    if (!cp) continue;
    const sat = historical.byBronzeId.get(bronzeId);
    const canonicalId = bronzeToCanonical.get(bronzeId);
    const ar = canonicalId != null ? arByCanonical.get(canonicalId) : null;

    // Skip clients sin actividad significativa (filtro mínimo)
    const monthlyAvg = cp.monthlyAvgLast12mMxn;
    if (monthlyAvg < 5_000) continue; // <$5k/mes no merece análisis

    // 1. Payment behavior (40 pts)
    let paymentPts = 0;
    if (cp.medianDelayDays != null && cp.paymentSampleSize >= 3) {
      const d = cp.medianDelayDays;
      if (d <= 0) paymentPts = 40;
      else if (d >= 90) paymentPts = 0;
      else paymentPts = Math.round(40 * (1 - d / 90));
    } else {
      paymentPts = 20; // unknown — neutral
    }

    // 2. Recurrence/loyalty (25 pts)
    const recurrencePts =
      Math.min(12.5, (cp.activeMonthsLast12 / 12) * 12.5) +
      Math.min(12.5, ((sat?.yearsActive ?? 0) / 5) * 12.5);

    // 3. Volume (15 pts)
    const volumePts =
      monthlyAvg <= 0
        ? 0
        : Math.max(0, Math.min(15, Math.log10(monthlyAvg / 10_000) * 5));

    // 4. AR current status (15 pts)
    const arOpen = ar?.open ?? 0;
    const arOverdue = ar?.overdue ?? 0;
    const arOverduePct = arOpen > 0 ? arOverdue / arOpen : 0;
    let arStatusPts = 0;
    if (arOverduePct === 0) arStatusPts = 15;
    else if (arOverduePct < 0.2) arStatusPts = 10;
    else if (arOverduePct < 0.5) arStatusPts = 5;
    else arStatusPts = 0;

    // 5. Trend (5 pts)
    const trend = cp.trendFactor;
    const trendPts = trend > 1.1 ? 5 : trend > 0.9 ? 3 : 0;

    let score = Math.round(
      paymentPts + recurrencePts + volumePts + arStatusPts + trendPts
    );

    // Penalizaciones duras
    const blacklist = ar?.blacklist ?? null;
    let reason = "";
    if (
      blacklist === "definitive" ||
      blacklist === "presumed" ||
      blacklist === "presunto"
    ) {
      score = 0;
      reason = `Blacklist SAT '${blacklist}' — rechazo automático.`;
    } else if (
      cp.activeMonthsLast12 === 0 &&
      (sat?.yearsActive ?? 0) > 1
    ) {
      score = Math.min(30, score);
      reason = "Cliente inactivo último año (>1y). Crédito limitado.";
    }

    score = Math.max(0, Math.min(100, score));
    const tier = tierFromScore(score);
    const tone = toneFromTier(tier);

    // Crédito recomendado
    const baseLimit = monthlyAvg * limitMultiplierFromScore(score);
    const recommendedLimit = Math.round(baseLimit);
    const availableCredit = Math.max(0, recommendedLimit - arOpen);

    if (!reason) {
      if (score >= 80) reason = "Cliente confiable, paga en tiempo.";
      else if (score >= 60) reason = "Cliente bueno, comportamiento normal.";
      else if (score >= 40) reason = "Cliente regular, monitorear.";
      else if (score >= 20)
        reason = "Cliente con retrasos importantes — reducir exposición.";
      else reason = "Riesgo alto — solo prepago.";
    }

    scores.push({
      bronzeId,
      customerName: ar?.name || bronzeNames.get(bronzeId) || `#${bronzeId}`,
      rfc: sat?.rfc ?? null,
      score,
      tier,
      tone,
      paymentBehaviorPts: paymentPts,
      recurrencePts: Math.round(recurrencePts * 10) / 10,
      volumePts: Math.round(volumePts * 10) / 10,
      arStatusPts,
      trendPts,
      medianDelayDays: cp.medianDelayDays,
      activeMonthsLast12: cp.activeMonthsLast12,
      yearsActive: sat?.yearsActive ?? 0,
      monthlyAvgMxn: monthlyAvg,
      arOpenMxn: arOpen,
      arOverdueMxn: arOverdue,
      arOverduePct: Math.round(arOverduePct * 1000) / 10, // %
      trendFactor: cp.trendFactor,
      blacklistStatus: blacklist,
      recommendedCreditLimitMxn: recommendedLimit,
      currentExposureMxn: arOpen,
      availableCreditMxn: availableCredit,
      reason,
    });
  }

  scores.sort((a, b) => b.monthlyAvgMxn - a.monthlyAvgMxn);

  const byTier: Record<CreditTier, number> = {
    excelente: 0,
    bueno: 0,
    regular: 0,
    riesgo: 0,
    rechazo: 0,
  };
  for (const s of scores) byTier[s.tier]++;

  return {
    rows: scores,
    asOfDate: todayIso,
    totalCustomers: scores.length,
    byTier,
  };
}

export const getCustomerCreditScores = unstable_cache(
  _getCustomerCreditScoresRaw,
  ["sp13-finanzas-customer-credit-score-v2-name-and-related"],
  { revalidate: 3600, tags: ["finanzas"] }
);
