import type { SourceKind, KpiResult } from "@/lib/kpi";
import type { Json } from "@/lib/database.types";

/**
 * SP13.6 — clasifica cada issue de gold_ceo_inbox según la fuente (SAT /
 * Odoo / Canonical) y su dominio de negocio. El mapa se deriva del
 * invariant_key que produce el motor de reconciliación de SP2.
 *
 * - "sat"       — el hecho sólo existe en SAT (CFDI huérfano, complemento
 *                 sin pago, etc.).
 * - "odoo"      — el hecho sólo existe en Odoo (posted sin UUID, stock move
 *                 sin asiento, etc.).
 * - "canonical" — divergencia cross-source: SAT y Odoo tienen el mismo
 *                 invoice/payment con valores distintos.
 * - "pl"        — no se emite desde el inbox hoy (queda reservado).
 */

const SOURCE_BY_INVARIANT: Record<string, SourceKind> = {
  // Divergencias cross-source (SAT ↔ Odoo): canonical
  "invoice.amount_mismatch":              "canonical",
  "invoice.amount_diff_post_fx":          "canonical",
  "invoice.date_drift":                   "canonical",
  "invoice.state_mismatch_posted_cancelled": "canonical",
  "invoice.state_mismatch_cancel_vigente":   "canonical",

  // Sólo SAT
  "invoice.ar_sat_only_drift":            "sat",
  "invoice.pending_operationalization":   "sat",
  "invoice.credit_note_orphan":           "sat",
  "payment.complement_without_payment":   "sat",

  // Sólo Odoo
  "invoice.posted_without_uuid":          "odoo",
  "invoice.missing_sat_timbrado":         "odoo",
  "payment.registered_without_complement":"odoo",
  "inventory.move_without_accounting":    "odoo",
  "sale_chain.delivered_not_invoiced":    "odoo",
};

/** Default conservador: el dato vive en el layer canonical. */
export function resolveSource(invariantKey: string | null): SourceKind {
  if (!invariantKey) return "canonical";
  return SOURCE_BY_INVARIANT[invariantKey] ?? "canonical";
}

export type InboxDomain =
  | "cobranza"
  | "facturacion"
  | "ventas"
  | "inventario"
  | "operaciones"
  | "otros";

const DOMAIN_LABELS: Record<InboxDomain, string> = {
  cobranza: "Cobranza",
  facturacion: "Facturación",
  ventas: "Ventas",
  inventario: "Inventario",
  operaciones: "Operaciones",
  otros: "Otros",
};

/**
 * Mapea invariant_key → dominio operativo que el CEO reconoce. Se usa
 * como facet en FilterBar y como badge en InboxCard.
 */
export function resolveDomain(invariantKey: string | null): InboxDomain {
  if (!invariantKey) return "otros";
  if (invariantKey.startsWith("payment.")) return "cobranza";
  if (invariantKey.startsWith("invoice.")) return "facturacion";
  if (invariantKey.startsWith("sale_chain.")) return "ventas";
  if (invariantKey.startsWith("inventory.")) return "inventario";
  return "operaciones";
}

export function domainLabel(d: InboxDomain): string {
  return DOMAIN_LABELS[d];
}

/**
 * Deriva un breakdown dual-source (SAT vs Odoo) desde el metadata JSONB de
 * reconciliation_issues. Sólo aplica a invariants que traen ambos lados;
 * para los "only" devuelve null (no hay drift que mostrar).
 *
 * Ejemplos de metadata que contemplamos:
 *   invoice.amount_diff_post_fx → { amount_mxn_sat, amount_mxn_odoo }
 *   invoice.amount_mismatch     → { diff_mxn }  (no trae ambos, null)
 *   invoice.date_drift          → { invoice_date, fecha_timbrado } (strings)
 */
export function resolveDrift(
  invariantKey: string | null,
  metadata: Json | null
): KpiResult["sources"] | null {
  if (!invariantKey) return null;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const m = metadata as Record<string, unknown>;

  const sat = numeric(m.amount_mxn_sat);
  const odoo = numeric(m.amount_mxn_odoo);
  if (sat != null && odoo != null) {
    const diff = odoo - sat;
    const diffPct = sat === 0 ? 0 : (diff / sat) * 100;
    return [
      { source: "sat", value: sat, diffFromPrimary: 0, diffPct: 0 },
      { source: "odoo", value: odoo, diffFromPrimary: diff, diffPct },
    ];
  }
  return null;
}

function numeric(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
