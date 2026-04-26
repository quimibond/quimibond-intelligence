import "server-only";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * Pulls the actual underlying record (invoice / payment / sale order /
 * inventory move) that a `gold_ceo_inbox` issue points to via
 * canonical_entity_id.
 *
 * `canonical_entity_id` follows the convention `{source}:{id}` —
 *   "odoo:6561630"        → odoo_invoice_id 6561630 in canonical_invoices
 *   "uuid:9038bbcf-…"     → SAT-only invoice in canonical_invoices
 *   "odoo_so:15253"       → odoo_order_id in canonical_sale_orders
 *   "stock_move:1842055"  → odoo_move_id in stock_moves (raw)
 *
 * Returns a normalized `IssueEntityContext` that the detail page can render
 * regardless of the underlying entity type. When the entity can't be
 * resolved (id missing, deleted upstream), returns null and the UI falls
 * back to the generic description.
 */

export interface IssueEntityContext {
  kind: "invoice" | "payment" | "sale_order" | "inventory_move" | "other";
  /** Friendly identifier for display: "INV/2025/03/0185", "PV15199", etc. */
  displayName: string | null;
  /** Numeric/UUID id used to deep-link into the source page. */
  sourceRef: string;
  companyId: number | null;
  companyName: string | null;
  amountMxn: number | null;
  /** ISO date — issue date / order date / move date. */
  primaryDate: string | null;
  /** Pairs of "source field → value" to render as a comparison grid.
   *  Empty when there isn't a meaningful Odoo↔SAT compare. */
  facts: Array<{ label: string; value: string; tone?: "default" | "warning" | "success" | "danger" }>;
  /** Optional deep-links surfaced as buttons. */
  links: Array<{ label: string; href: string }>;
  /** True when the entity context contradicts the issue (e.g. invoice now
   *  has the SAT UUID the issue claimed was missing). The UI uses this to
   *  flag potential stale issues. */
  appearsResolved: boolean;
  resolutionHint: string | null;
}

function fmtMxn(n: number | null | undefined): string {
  if (n == null) return "—";
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(Number(n));
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/**
 * Splits `{source}:{id}` into source + id. Returns null when the format
 * doesn't match (some legacy issues store the bare id).
 */
export function parseCanonicalEntityId(
  raw: string | null
): { source: string; id: string } | null {
  if (!raw) return null;
  const idx = raw.indexOf(":");
  if (idx < 0) return null;
  return { source: raw.slice(0, idx), id: raw.slice(idx + 1) };
}

/** Main entry point — dispatches by entity type + invariant_key. */
export async function fetchIssueEntityContext(opts: {
  canonicalEntityType: string | null;
  canonicalEntityId: string | null;
  invariantKey: string | null;
}): Promise<IssueEntityContext | null> {
  const { canonicalEntityType, canonicalEntityId, invariantKey } = opts;
  const ref = parseCanonicalEntityId(canonicalEntityId);
  if (!ref) return null;

  if (canonicalEntityType === "invoice") {
    return fetchInvoiceContext(ref, invariantKey);
  }
  if (canonicalEntityType === "payment") {
    return fetchPaymentContext(ref);
  }
  // Sale orders and inventory moves not yet wired — return a minimal stub
  // so the UI at least shows the source ref.
  return {
    kind: "other",
    displayName: null,
    sourceRef: canonicalEntityId ?? "",
    companyId: null,
    companyName: null,
    amountMxn: null,
    primaryDate: null,
    facts: [],
    links: [],
    appearsResolved: false,
    resolutionHint: null,
  };
}

async function fetchInvoiceContext(
  ref: { source: string; id: string },
  invariantKey: string | null
): Promise<IssueEntityContext | null> {
  const sb = getServiceClient();

  // canonical_invoices keys: odoo_invoice_id (int) and sat_uuid (uuid).
  let q = sb
    .from("canonical_invoices")
    .select(
      "odoo_invoice_id, sat_uuid, odoo_name, direction, " +
        "emisor_canonical_company_id, receptor_canonical_company_id, " +
        "emisor_nombre, receptor_nombre, amount_total_mxn_resolved, " +
        "amount_total_mxn_odoo, amount_total_mxn_sat, " +
        "invoice_date_resolved, fecha_timbrado, due_date_resolved, " +
        "state_odoo, estado_sat, payment_state_odoo, " +
        "has_odoo_record, has_sat_record, completeness_score"
    )
    .limit(1);

  if (ref.source === "odoo") {
    const idNum = Number(ref.id);
    if (!Number.isFinite(idNum)) return null;
    q = q.eq("odoo_invoice_id", idNum);
  } else if (ref.source === "uuid" || ref.source === "sat") {
    q = q.eq("sat_uuid", ref.id);
  } else {
    return null;
  }

  const { data, error } = await q.maybeSingle();
  if (error || !data) return null;
  const r = data as unknown as {
    odoo_invoice_id: number | null;
    sat_uuid: string | null;
    odoo_name: string | null;
    direction: string | null;
    emisor_canonical_company_id: number | null;
    receptor_canonical_company_id: number | null;
    emisor_nombre: string | null;
    receptor_nombre: string | null;
    amount_total_mxn_resolved: number | null;
    amount_total_mxn_odoo: number | null;
    amount_total_mxn_sat: number | null;
    invoice_date_resolved: string | null;
    fecha_timbrado: string | null;
    due_date_resolved: string | null;
    state_odoo: string | null;
    estado_sat: string | null;
    payment_state_odoo: string | null;
    has_odoo_record: boolean | null;
    has_sat_record: boolean | null;
    completeness_score: number | null;
  };

  // The "counterparty" depends on direction. For issued invoices we care
  // about the receptor (the customer). For received we care about the
  // emisor (the supplier). Quimibond's id is internal so the canonical
  // contains both sides regardless.
  const isIssued = r.direction === "issued";
  const counterpartyId = isIssued
    ? r.receptor_canonical_company_id
    : r.emisor_canonical_company_id;
  const counterpartyName = isIssued ? r.receptor_nombre : r.emisor_nombre;

  const facts: IssueEntityContext["facts"] = [];
  if (r.amount_total_mxn_resolved != null) {
    facts.push({
      label: "Monto total (resuelto)",
      value: fmtMxn(r.amount_total_mxn_resolved),
    });
  }
  if (
    r.amount_total_mxn_odoo != null &&
    r.amount_total_mxn_sat != null &&
    Math.abs(r.amount_total_mxn_odoo - r.amount_total_mxn_sat) > 1
  ) {
    const diff = r.amount_total_mxn_odoo - r.amount_total_mxn_sat;
    facts.push({
      label: "Monto Odoo",
      value: fmtMxn(r.amount_total_mxn_odoo),
      tone: "warning",
    });
    facts.push({
      label: "Monto SAT",
      value: fmtMxn(r.amount_total_mxn_sat),
      tone: "warning",
    });
    facts.push({
      label: "Diferencia",
      value: fmtMxn(Math.abs(diff)) + (diff > 0 ? " (Odoo > SAT)" : " (SAT > Odoo)"),
      tone: "danger",
    });
  }
  if (r.invoice_date_resolved) {
    facts.push({ label: "Fecha factura", value: fmtDate(r.invoice_date_resolved) });
  }
  if (r.fecha_timbrado) {
    facts.push({ label: "Fecha timbrado SAT", value: fmtDate(r.fecha_timbrado) });
  }
  if (r.due_date_resolved) {
    facts.push({ label: "Vence", value: fmtDate(r.due_date_resolved) });
  }
  facts.push({
    label: "Estado Odoo",
    value: r.state_odoo ?? "—",
    tone:
      r.state_odoo === "posted"
        ? "success"
        : r.state_odoo === "cancel"
          ? "danger"
          : "default",
  });
  facts.push({
    label: "Estado SAT",
    value: r.estado_sat ?? "(sin CFDI)",
    tone:
      r.estado_sat === "vigente"
        ? "success"
        : r.estado_sat === "cancelado"
          ? "danger"
          : "default",
  });
  if (r.payment_state_odoo) {
    facts.push({
      label: "Estado pago",
      value: r.payment_state_odoo,
      tone:
        r.payment_state_odoo === "paid"
          ? "success"
          : r.payment_state_odoo === "not_paid"
            ? "warning"
            : "default",
    });
  }
  if (r.sat_uuid) {
    facts.push({ label: "UUID SAT", value: r.sat_uuid });
  }

  const links: IssueEntityContext["links"] = [];
  if (counterpartyId) {
    links.push({
      label: `Ver ${isIssued ? "cliente" : "proveedor"}: ${counterpartyName ?? "empresa"}`,
      href: `/empresas/${counterpartyId}`,
    });
  }

  // Detect stale issues. The most common pattern: posted_without_uuid
  // claims no UUID, but canonical now has one because the addon synced
  // after the issue was first detected.
  let appearsResolved = false;
  let resolutionHint: string | null = null;
  if (invariantKey === "invoice.posted_without_uuid" && r.sat_uuid) {
    appearsResolved = true;
    resolutionHint =
      "La factura YA tiene UUID timbrado en Supabase (" +
      r.sat_uuid.slice(0, 8) +
      "…). Probablemente este alert es stale — espera al próximo run del invariante (cada hora) para que se cierre solo, o ejecuta auto-validate manualmente.";
  } else if (
    invariantKey === "invoice.missing_sat_timbrado" &&
    r.has_sat_record
  ) {
    appearsResolved = true;
    resolutionHint =
      "La factura YA tiene record SAT correspondiente. Auto-validate la cerrará en su próxima pasada.";
  } else if (
    invariantKey === "invoice.state_mismatch_posted_cancelled" &&
    r.state_odoo === "cancel"
  ) {
    appearsResolved = true;
    resolutionHint =
      "Odoo ya marcó la factura como cancelled. El estado coincide con el SAT.";
  }

  return {
    kind: "invoice",
    displayName: r.odoo_name ?? (r.sat_uuid ? `CFDI ${r.sat_uuid.slice(0, 8)}…` : null),
    sourceRef: ref.source === "odoo" ? `odoo:${ref.id}` : `sat:${ref.id}`,
    companyId: counterpartyId,
    companyName: counterpartyName,
    amountMxn: r.amount_total_mxn_resolved ?? r.amount_total_mxn_odoo ?? r.amount_total_mxn_sat,
    primaryDate: r.invoice_date_resolved,
    facts,
    links,
    appearsResolved,
    resolutionHint,
  };
}

async function fetchPaymentContext(
  ref: { source: string; id: string }
): Promise<IssueEntityContext | null> {
  const sb = getServiceClient();

  let q = sb
    .from("canonical_payments")
    .select(
      "canonical_id, sat_uuid_complemento, odoo_payment_id, payment_date_odoo, fecha_pago_sat, " +
        "amount_mxn_resolved, amount_mxn_odoo, amount_mxn_sat, " +
        "counterparty_canonical_company_id, partner_name, " +
        "forma_pago_sat, payment_method_odoo, has_odoo_record, has_sat_record"
    )
    .limit(1);

  if (ref.source === "odoo") {
    const idNum = Number(ref.id);
    if (!Number.isFinite(idNum)) return null;
    q = q.eq("odoo_payment_id", idNum);
  } else if (ref.source === "uuid" || ref.source === "sat") {
    q = q.eq("sat_uuid_complemento", ref.id);
  } else if (ref.source === "canonical") {
    q = q.eq("canonical_id", ref.id);
  } else {
    return null;
  }

  const { data, error } = await q.maybeSingle();
  if (error || !data) return null;
  const r = data as unknown as {
    canonical_id: string | null;
    sat_uuid_complemento: string | null;
    odoo_payment_id: number | null;
    payment_date_odoo: string | null;
    fecha_pago_sat: string | null;
    amount_mxn_resolved: number | null;
    amount_mxn_odoo: number | null;
    amount_mxn_sat: number | null;
    counterparty_canonical_company_id: number | null;
    partner_name: string | null;
    forma_pago_sat: string | null;
    payment_method_odoo: string | null;
    has_odoo_record: boolean | null;
    has_sat_record: boolean | null;
  };

  const facts: IssueEntityContext["facts"] = [];
  facts.push({
    label: "Monto",
    value: fmtMxn(r.amount_mxn_resolved ?? r.amount_mxn_odoo ?? r.amount_mxn_sat),
  });
  if (r.payment_date_odoo) {
    facts.push({ label: "Fecha pago Odoo", value: fmtDate(r.payment_date_odoo) });
  }
  if (r.fecha_pago_sat) {
    facts.push({ label: "Fecha pago SAT", value: fmtDate(r.fecha_pago_sat) });
  }
  if (r.forma_pago_sat || r.payment_method_odoo) {
    facts.push({
      label: "Método",
      value: r.forma_pago_sat ?? r.payment_method_odoo ?? "—",
    });
  }
  facts.push({
    label: "En Odoo",
    value: r.has_odoo_record ? "Sí" : "No",
    tone: r.has_odoo_record ? "success" : "warning",
  });
  facts.push({
    label: "En SAT",
    value: r.has_sat_record ? "Sí" : "No",
    tone: r.has_sat_record ? "success" : "warning",
  });
  if (r.sat_uuid_complemento) {
    facts.push({ label: "UUID complemento", value: r.sat_uuid_complemento });
  }

  const links: IssueEntityContext["links"] = [];
  if (r.counterparty_canonical_company_id) {
    links.push({
      label: `Ver contraparte: ${r.partner_name ?? "empresa"}`,
      href: `/empresas/${r.counterparty_canonical_company_id}`,
    });
  }

  return {
    kind: "payment",
    displayName: r.odoo_payment_id
      ? `Pago Odoo #${r.odoo_payment_id}`
      : r.sat_uuid_complemento
        ? `Complemento ${r.sat_uuid_complemento.slice(0, 8)}…`
        : null,
    sourceRef: ref.source === "odoo" ? `odoo:${ref.id}` : `sat:${ref.id}`,
    companyId: r.counterparty_canonical_company_id,
    companyName: r.partner_name,
    amountMxn: r.amount_mxn_resolved ?? r.amount_mxn_odoo ?? r.amount_mxn_sat,
    primaryDate: r.payment_date_odoo ?? r.fecha_pago_sat,
    facts,
    links,
    appearsResolved: false,
    resolutionHint: null,
  };
}
