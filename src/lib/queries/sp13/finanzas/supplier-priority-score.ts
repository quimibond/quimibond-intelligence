import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";
import {
  getLearnedCounterpartyParams,
  getLearnedHistoricalRecurrence,
} from "./learned-params";

/**
 * F-PRIORITY — Score de prioridad de pago a proveedores.
 *
 * Espejo del customer credit score, aplicado al lado de outflows.
 * Cuando el cash es escaso (siempre lo es en Quimibond por morosity
 * estructural), ¿a qué proveedor pagar primero? El score 0-100 ordena
 * por urgencia + criticidad operativa, no por cariño ni primer-en-llegar.
 *
 * Score más alto = pagar ANTES (más crítico/urgente).
 *
 * Componentes (100 pts):
 *
 * 1. PAST-DUE SEVERITY (35 pts) — riesgo de que corte servicio
 *    Si el AP a este proveedor está mayormente vencido, está al límite
 *    de su paciencia.
 *      0% vencido:  0 pts (no hay urgencia)
 *      <20%:       10 pts
 *      20-50%:     20 pts
 *      >50%:       35 pts (crítico, riesgo de cortar suministro)
 *
 * 2. OPERATIONAL VOLUME (25 pts) — qué tan grande es la cuenta
 *    log10(monthly_avg / 10000) × 8.33 cap [0, 25]
 *    $10k/mo=0, $100k=8, $1M=17, $10M=25
 *
 * 3. RECURRENCE / DEPENDENCY (20 pts) — qué tan dependiente eres
 *    Proveedor que abasteces todos los meses por años = no puedes perderlo.
 *    active_months_12 / 12 × 10 + years_active (cap 5) × 2
 *
 * 4. STRICT TERMS (15 pts) — si paga estricto, respetar
 *    Proveedores con apDelay histórico bajo (cobran a tiempo) deben
 *    cobrarse a tiempo o se enojan rápido. Los que aceptan delay alto
 *    son tus "amortiguadores" — los puedes estirar.
 *      apDelay 0d:  15 pts (estricto, pagar a tiempo)
 *      30d:          8 pts
 *      60+d:         3 pts (lax, estirable)
 *
 * 5. CRITICAL CATEGORY (5 pts) — SAT/IMSS/Leasing son non-negotiable
 *    Algunos proveedores tienen consecuencias legales si no pagas.
 *
 * Tiers de urgencia:
 *   80-100 (rojo, CRÍTICO):     pagar HOY o riesgo de paro/multa
 *   60-79  (naranja, ALTA):     pagar esta semana
 *   40-59  (amarillo, MEDIA):   pagar próximas 2 semanas
 *   20-39  (azul claro, BAJA):  fin de mes o estirar 1 mes
 *   0-19   (verde, ESTIRABLE):  puede esperar 30+ días sin riesgo
 *
 * Refresh: 1h.
 */

export type SupplierPriorityTier =
  | "critico"
  | "alta"
  | "media"
  | "baja"
  | "estirable";

export interface SupplierPriorityScore {
  bronzeId: number;
  supplierName: string;
  rfc: string | null;
  score: number; // 0-100
  tier: SupplierPriorityTier;
  tone: "destructive" | "danger" | "warning" | "info" | "success";
  // Componentes
  pastDueSeverityPts: number;
  volumePts: number;
  recurrencePts: number;
  strictTermsPts: number;
  criticalCategoryPts: number;
  // Métricas underlying
  apOpenMxn: number;
  apOverdueMxn: number;
  apOverduePct: number;
  monthlyAvgMxn: number;
  activeMonthsLast12: number;
  yearsActive: number;
  apDelayHistDays: number | null;
  isCriticalCategory: boolean;
  // Recomendación
  recommendedAction: string;
}

export interface SupplierPrioritySummary {
  rows: SupplierPriorityScore[];
  asOfDate: string;
  totalSuppliers: number;
  byTier: Record<SupplierPriorityTier, number>;
  totalApOpenMxn: number;
  totalApOverdueMxn: number;
  totalCriticoMxn: number; // AP open en tier crítico (a pagar HOY)
  totalAltaMxn: number; // AP open en tier alta (esta semana)
}

const tierFromScore = (score: number): SupplierPriorityTier => {
  if (score >= 80) return "critico";
  if (score >= 60) return "alta";
  if (score >= 40) return "media";
  if (score >= 20) return "baja";
  return "estirable";
};

const toneFromTier = (
  t: SupplierPriorityTier
): "destructive" | "danger" | "warning" | "info" | "success" => {
  switch (t) {
    case "critico":
      return "destructive";
    case "alta":
      return "danger";
    case "media":
      return "warning";
    case "baja":
      return "info";
    case "estirable":
      return "success";
  }
};

/**
 * Categorías "no-negociables" — multas/intereses si no pagas.
 * Match por sub-string del nombre para no depender de account codes.
 */
const isCriticalSupplierName = (name: string): boolean => {
  const lower = name.toLowerCase();
  if (lower.includes("seguro social")) return true; // IMSS
  if (lower.includes("imss")) return true;
  if (lower.includes("administracion tributaria")) return true; // SAT
  if (lower.includes("administración tributaria")) return true;
  if (lower.includes("infonavit")) return true;
  if (lower.includes("comision federal de electricidad")) return true; // CFE
  if (lower.includes("cfe")) return true;
  if (lower.includes("leasing") || lower.includes("arrendamiento")) return true;
  return false;
};

async function _getSupplierPriorityScoresRaw(): Promise<SupplierPrioritySummary> {
  const sb = getServiceClient();
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);

  const [counterparty, historical] = await Promise.all([
    getLearnedCounterpartyParams(),
    getLearnedHistoricalRecurrence(),
  ]);

  // AP exposure por bronze id (current open + overdue + nombre proveedor)
  type ApRow = {
    emisor_canonical_company_id: number | null;
    amount_residual_mxn_resolved: number | null;
    fiscal_days_to_due_date: number | null;
    emisor_nombre: string | null;
  };
  const PAGE = 1000;
  const apRows: ApRow[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await sb
      .from("canonical_invoices")
      .select(
        "emisor_canonical_company_id, amount_residual_mxn_resolved, fiscal_days_to_due_date, emisor_nombre"
      )
      .eq("direction", "received")
      .eq("is_quimibond_relevant", true)
      .or("estado_sat.is.null,estado_sat.neq.cancelado")
      .gt("amount_residual_mxn_resolved", 0)
      .range(offset, offset + PAGE - 1);
    if (error) break;
    const rows = (data ?? []) as ApRow[];
    apRows.push(...rows);
    if (rows.length < PAGE) break;
    offset += PAGE;
  }

  type ApAgg = { open: number; overdue: number; name: string };
  const apByCanonical = new Map<number, ApAgg>();
  for (const r of apRows) {
    const cid = r.emisor_canonical_company_id;
    if (cid == null) continue;
    const acc = apByCanonical.get(cid) ?? { open: 0, overdue: 0, name: "" };
    const amt = Number(r.amount_residual_mxn_resolved) || 0;
    acc.open += amt;
    if ((r.fiscal_days_to_due_date ?? 1) <= 0) acc.overdue += amt;
    if (!acc.name && r.emisor_nombre) acc.name = r.emisor_nombre;
    apByCanonical.set(cid, acc);
  }

  // Resolver canonical → bronze + nombre + flag related_party para suppliers
  // conocidos en learnedCounterparty. Pull de companies.name como fallback
  // cuando el supplier no tiene AP abierto (el nombre no estaba en apRows).
  // Pull canonical_companies.is_related_party para excluir intercompañía
  // (el filtro estaba en projection.ts pero no lo aplicaba aquí — bug).
  const supplierBronzeIds = [...counterparty.byBronzeId.keys()].filter(
    (id) => counterparty.byBronzeId.get(id)?.side === "supplier"
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

  if (supplierBronzeIds.length > 0) {
    const chunkSize = 200;
    for (let i = 0; i < supplierBronzeIds.length; i += chunkSize) {
      const chunk = supplierBronzeIds.slice(i, i + chunkSize);
      const { data } = await sb
        .from("companies")
        .select("id, odoo_partner_id, name")
        .in("id", chunk);
      type Row = {
        id: number | null;
        odoo_partner_id: number | null;
        name: string | null;
      };
      // Capture name as fallback
      for (const b of (data ?? []) as Row[]) {
        if (b.id != null && b.name) bronzeNames.set(b.id, b.name);
      }
      const partnerIds = (data ?? [])
        .map((r) => (r as Row).odoo_partner_id)
        .filter((p): p is number => p != null);
      if (partnerIds.length > 0) {
        for (let j = 0; j < partnerIds.length; j += chunkSize) {
          const pchunk = partnerIds.slice(j, j + chunkSize);
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
              if (
                b.id != null &&
                b.odoo_partner_id === c.odoo_partner_id
              ) {
                bronzeToCanonical.set(b.id, c.id);
                break;
              }
            }
          }
        }
      }
    }
  }

  // Counterparty classification map: canonicalId → { type, lifecycle }.
  // Migration 20260427_counterparty_classification.sql.
  const classByCanonical = new Map<
    number,
    { counterpartyType: string; lifecycle: string }
  >();
  const allCanonicalIds = Array.from(bronzeToCanonical.values());
  if (allCanonicalIds.length > 0) {
    const ccChunkSize = 200;
    for (let i = 0; i < allCanonicalIds.length; i += ccChunkSize) {
      const chunk = allCanonicalIds.slice(i, i + ccChunkSize);
      const { data: classData } = await sb
        .from("canonical_companies")
        .select("id, counterparty_type, customer_lifecycle")
        .in("id", chunk)
        .or("counterparty_type.neq.operativo,customer_lifecycle.neq.active");
      for (const c of (classData ?? []) as Array<{
        id: number | null;
        counterparty_type: string | null;
        customer_lifecycle: string | null;
      }>) {
        if (c.id == null) continue;
        classByCanonical.set(c.id, {
          counterpartyType: c.counterparty_type ?? "operativo",
          lifecycle: c.customer_lifecycle ?? "active",
        });
      }
    }
  }

  // Suppliers que SOLO aparecen en AP (no en learned via canonical_invoices
  // del último año) — los procesamos también con datos limitados.
  // Para v1 nos enfocamos en los que SÍ tienen learned data.
  const scores: SupplierPriorityScore[] = [];
  for (const bronzeId of supplierBronzeIds) {
    if (relatedPartyBronzeIds.has(bronzeId)) continue; // intercompañía fuera
    const cp = counterparty.byBronzeId.get(bronzeId);
    if (!cp) continue;
    // Filter por lifecycle: skip lost (proveedor que ya no usamos —
    // si tiene AP abierto seguirá en obligations.ts pero no necesita
    // priority scoring para flujo nuevo).
    const canonicalIdForClass = bronzeToCanonical.get(bronzeId);
    const cls = canonicalIdForClass != null
      ? classByCanonical.get(canonicalIdForClass)
      : null;
    if (cls?.lifecycle === "lost") continue;
    const sat = historical.byBronzeId.get(bronzeId);
    const canonicalId = bronzeToCanonical.get(bronzeId);
    const ap = canonicalId != null ? apByCanonical.get(canonicalId) : null;
    const monthlyAvg = cp.monthlyAvgLast12mMxn;
    if (monthlyAvg < 1_000 && (ap?.open ?? 0) < 5_000) continue; // ruido

    // 1. Past-due severity (35 pts)
    const apOpen = ap?.open ?? 0;
    const apOverdue = ap?.overdue ?? 0;
    const overduePct = apOpen > 0 ? apOverdue / apOpen : 0;
    let pastDuePts = 0;
    if (overduePct === 0) pastDuePts = 0;
    else if (overduePct < 0.2) pastDuePts = 10;
    else if (overduePct < 0.5) pastDuePts = 20;
    else pastDuePts = 35;

    // 2. Volume (25 pts)
    const volumePts =
      monthlyAvg <= 0
        ? 0
        : Math.max(
            0,
            Math.min(25, Math.log10(monthlyAvg / 10_000) * 8.33)
          );

    // 3. Recurrence/dependency (20 pts)
    const recurrencePts =
      Math.min(10, (cp.activeMonthsLast12 / 12) * 10) +
      Math.min(10, ((sat?.yearsActive ?? 0) / 5) * 10);

    // 4. Strict terms (15 pts)
    let strictPts = 8; // default neutral
    if (cp.medianDelayDays != null && cp.paymentSampleSize >= 3) {
      const d = cp.medianDelayDays;
      if (d <= 5) strictPts = 15;
      else if (d <= 30) strictPts = 8;
      else if (d <= 60) strictPts = 5;
      else strictPts = 3;
    }

    // 5. Critical category (5 pts)
    // Nombre con fallback en cascada: AP nombre > Bronze companies.name > #id
    const name = ap?.name || bronzeNames.get(bronzeId) || `#${bronzeId}`;
    // Crítico si nombre matchea SAT/IMSS/CFE/Leasing (heurística histórica),
    // O counterparty_type es financiera/gobierno_fiscal/utility
    // (clasificación explícita post-2026-04-27). Las financieras NO
    // negociables — defaultear genera intereses + cierre de línea de
    // crédito.
    const isCriticalByType =
      cls?.counterpartyType === "financiera" ||
      cls?.counterpartyType === "gobierno_fiscal" ||
      cls?.counterpartyType === "utility";
    const isCritical = isCriticalSupplierName(name) || isCriticalByType;
    const criticalPts = isCritical ? 5 : 0;

    let score = Math.round(
      pastDuePts + volumePts + recurrencePts + strictPts + criticalPts
    );
    score = Math.max(0, Math.min(100, score));
    const tier = tierFromScore(score);
    const tone = toneFromTier(tier);

    let action = "";
    if (tier === "critico") {
      if (isCritical) action = "Pagar HOY — categoría no negociable.";
      else if (overduePct > 0.5) action = "Pagar HOY — riesgo de cortar suministro.";
      else action = "Pagar HOY — alto impacto operativo.";
    } else if (tier === "alta") {
      action = "Pagar esta semana — proveedor importante con presión.";
    } else if (tier === "media") {
      action = "Pagar próximas 2 semanas.";
    } else if (tier === "baja") {
      action = "Pagar fin de mes o estirar 30 días si conviene.";
    } else {
      action = "Estirable — puede esperar 30+ días sin riesgo.";
    }

    scores.push({
      bronzeId,
      supplierName: name,
      rfc: sat?.rfc ?? null,
      score,
      tier,
      tone,
      pastDueSeverityPts: pastDuePts,
      volumePts: Math.round(volumePts * 10) / 10,
      recurrencePts: Math.round(recurrencePts * 10) / 10,
      strictTermsPts: strictPts,
      criticalCategoryPts: criticalPts,
      apOpenMxn: Math.round(apOpen),
      apOverdueMxn: Math.round(apOverdue),
      apOverduePct: Math.round(overduePct * 1000) / 10,
      monthlyAvgMxn: Math.round(monthlyAvg),
      activeMonthsLast12: cp.activeMonthsLast12,
      yearsActive: sat?.yearsActive ?? 0,
      apDelayHistDays: cp.medianDelayDays,
      isCriticalCategory: isCritical,
      recommendedAction: action,
    });
  }

  scores.sort((a, b) => b.score - a.score); // más crítico primero

  const byTier: Record<SupplierPriorityTier, number> = {
    critico: 0,
    alta: 0,
    media: 0,
    baja: 0,
    estirable: 0,
  };
  let totalCritico = 0;
  let totalAlta = 0;
  let totalApOpen = 0;
  let totalApOverdue = 0;
  for (const s of scores) {
    byTier[s.tier]++;
    totalApOpen += s.apOpenMxn;
    totalApOverdue += s.apOverdueMxn;
    if (s.tier === "critico") totalCritico += s.apOpenMxn;
    if (s.tier === "alta") totalAlta += s.apOpenMxn;
  }

  return {
    rows: scores,
    asOfDate: todayIso,
    totalSuppliers: scores.length,
    byTier,
    totalApOpenMxn: totalApOpen,
    totalApOverdueMxn: totalApOverdue,
    totalCriticoMxn: totalCritico,
    totalAltaMxn: totalAlta,
  };
}

export const getSupplierPriorityScores = unstable_cache(
  _getSupplierPriorityScoresRaw,
  ["sp13-finanzas-supplier-priority-v2-name-and-related"],
  { revalidate: 3600, tags: ["finanzas"] }
);
