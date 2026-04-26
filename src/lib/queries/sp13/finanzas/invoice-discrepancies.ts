import "server-only";
import { unstable_cache } from "next/cache";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * F-DISC — Discrepancias Odoo ↔ SAT en facturas con residual abierto.
 *
 * Surface invoices where Odoo and SAT (libro fiscal) disagree on:
 *   - presencia (solo en uno de los dos sistemas)
 *   - estado de pago (uno dice abierta, otro pagada)
 *   - monto residual
 *   - estado de cancelación
 *
 * Fuente: `canonical_invoices` (golden record cruzado).
 *
 * Cada categoría sugiere una acción operativa concreta:
 *   solo_odoo                — falta CFDI / proveedor no timbró
 *   solo_sat                 — capturar la factura en Odoo
 *   odoo_open_sat_paid       — registrar el pago en Odoo (complemento ya existe)
 *   odoo_paid_sat_open       — pedir complemento de pago al proveedor
 *   amount_mismatch          — corregir importe en uno de los dos sistemas
 *   canc_sat_open_odoo       — cancelar también en Odoo o disputar cancelación SAT
 *   canc_sat_paid_odoo       — crítico: pagamos algo que SAT canceló
 */
export type DiscrepancyKind =
  | "solo_odoo"
  | "solo_sat"
  | "odoo_open_sat_paid"
  | "odoo_paid_sat_open"
  | "amount_mismatch"
  | "canc_sat_open_odoo"
  | "canc_sat_paid_odoo";

export type InvoiceDirection = "issued" | "received";

export interface DiscrepancyInvoice {
  canonicalId: string;
  invoiceName: string | null;
  direction: InvoiceDirection;
  kind: DiscrepancyKind;
  partnerName: string | null;
  partnerCompanyId: number | null;
  amountResidualMxn: number;
  amountResidualOdoo: number | null;
  amountResidualSat: number | null;
  invoiceDate: string | null;
  dueDate: string | null;
  daysOpen: number | null;
  satUuid: string | null;
  odooInvoiceId: number | null;
  paymentStateOdoo: string | null;
  estadoSat: string | null;
}

export interface DiscrepancyCategory {
  kind: DiscrepancyKind;
  direction: InvoiceDirection;
  label: string;
  recommendedAction: string;
  severity: "critical" | "warning" | "info";
  count: number;
  totalMxn: number;
  topInvoices: DiscrepancyInvoice[];
}

export interface InvoiceDiscrepanciesSummary {
  totalCount: number;
  totalMxn: number;
  affectedApMxn: number;
  affectedArMxn: number;
  categories: DiscrepancyCategory[];
}

interface CanonicalRow {
  canonical_id: string;
  odoo_invoice_id: number | null;
  odoo_name: string | null;
  direction: string;
  has_odoo_record: boolean;
  has_sat_record: boolean;
  amount_residual_odoo: number | string | null;
  amount_residual_sat: number | string | null;
  amount_residual_mxn_resolved: number | string | null;
  payment_state_odoo: string | null;
  estado_sat: string | null;
  invoice_date_resolved: string | null;
  due_date_resolved: string | null;
  emisor_nombre: string | null;
  receptor_nombre: string | null;
  emisor_canonical_company_id: number | null;
  receptor_canonical_company_id: number | null;
  sat_uuid: string | null;
}

function classify(r: CanonicalRow): DiscrepancyKind | null {
  const oResid = r.amount_residual_odoo == null ? null : Number(r.amount_residual_odoo);
  const sResid = r.amount_residual_sat == null ? null : Number(r.amount_residual_sat);

  if (r.estado_sat === "cancelado") {
    if (r.payment_state_odoo === "paid") return "canc_sat_paid_odoo";
    if (oResid != null && oResid > 0) return "canc_sat_open_odoo";
    return null;
  }
  if (r.has_odoo_record && !r.has_sat_record) return "solo_odoo";
  if (!r.has_odoo_record && r.has_sat_record) return "solo_sat";
  if (oResid != null && sResid != null) {
    if (oResid > 0 && sResid === 0) return "odoo_open_sat_paid";
    if (oResid === 0 && sResid > 0) return "odoo_paid_sat_open";
    if (oResid > 0 && sResid > 0 && Math.abs(oResid - sResid) > 1)
      return "amount_mismatch";
  }
  return null;
}

const KIND_META: Record<
  DiscrepancyKind,
  { label: string; action: string; severity: "critical" | "warning" | "info" }
> = {
  solo_odoo: {
    label: "Solo en Odoo (sin CFDI SAT)",
    action: "Verificar si el proveedor timbró la factura. Pedir el CFDI o capturar como gasto interno.",
    severity: "warning",
  },
  solo_sat: {
    label: "Solo en SAT (sin Odoo)",
    action: "Capturar la factura en Odoo. SAT ya tiene el CFDI registrado.",
    severity: "warning",
  },
  odoo_open_sat_paid: {
    label: "Odoo abierta · SAT pagada (complemento existe)",
    action: "Registrar el pago en Odoo. SAT ya recibió/emitió el complemento de pago.",
    severity: "warning",
  },
  odoo_paid_sat_open: {
    label: "Odoo pagada · SAT abierta (sin complemento)",
    action: "Pedir/emitir el complemento de pago. SAT no tiene constancia del pago.",
    severity: "critical",
  },
  amount_mismatch: {
    label: "Monto residual difiere",
    action: "Reconciliar montos entre Odoo y SAT. Probable nota de crédito o pago parcial.",
    severity: "warning",
  },
  canc_sat_open_odoo: {
    label: "SAT canceló · Odoo aún abierta",
    action: "Cancelar también en Odoo o disputar la cancelación con el proveedor.",
    severity: "warning",
  },
  canc_sat_paid_odoo: {
    label: "SAT canceló · Odoo pagada",
    action: "CRÍTICO: pagamos una factura que SAT canceló. Recuperar el monto del proveedor.",
    severity: "critical",
  },
};

async function _getInvoiceDiscrepanciesRaw(): Promise<InvoiceDiscrepanciesSummary> {
  const sb = getServiceClient();
  const today = new Date();
  const todayMs = today.setHours(0, 0, 0, 0);

  const PAGE = 1000;
  const allRows: CanonicalRow[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await sb
      .from("canonical_invoices")
      .select(
        "canonical_id,odoo_invoice_id,odoo_name,direction,has_odoo_record,has_sat_record,amount_residual_odoo,amount_residual_sat,amount_residual_mxn_resolved,payment_state_odoo,estado_sat,invoice_date_resolved,due_date_resolved,emisor_nombre,receptor_nombre,emisor_canonical_company_id,receptor_canonical_company_id,sat_uuid"
      )
      .eq("is_quimibond_relevant", true)
      .gt("amount_residual_mxn_resolved", 0)
      .range(from, from + PAGE - 1);
    if (error) break;
    const rows = (data ?? []) as CanonicalRow[];
    allRows.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }

  type Bucket = {
    kind: DiscrepancyKind;
    direction: InvoiceDirection;
    invoices: DiscrepancyInvoice[];
    totalMxn: number;
  };
  const bucketKey = (k: DiscrepancyKind, d: InvoiceDirection) => `${k}::${d}`;
  const buckets = new Map<string, Bucket>();

  for (const r of allRows) {
    const kind = classify(r);
    if (!kind) continue;
    const direction = r.direction as InvoiceDirection;
    if (direction !== "issued" && direction !== "received") continue;
    const amt = Number(r.amount_residual_mxn_resolved) || 0;
    const partnerName =
      direction === "received" ? r.emisor_nombre : r.receptor_nombre;
    const partnerCompanyId =
      direction === "received"
        ? r.emisor_canonical_company_id
        : r.receptor_canonical_company_id;

    let daysOpen: number | null = null;
    if (r.invoice_date_resolved) {
      const d = new Date(r.invoice_date_resolved);
      d.setHours(0, 0, 0, 0);
      daysOpen = Math.max(0, Math.round((todayMs - d.getTime()) / 86400000));
    }

    const inv: DiscrepancyInvoice = {
      canonicalId: r.canonical_id,
      invoiceName: r.odoo_name,
      direction,
      kind,
      partnerName,
      partnerCompanyId,
      amountResidualMxn: Math.round(amt),
      amountResidualOdoo:
        r.amount_residual_odoo == null ? null : Number(r.amount_residual_odoo),
      amountResidualSat:
        r.amount_residual_sat == null ? null : Number(r.amount_residual_sat),
      invoiceDate: r.invoice_date_resolved,
      dueDate: r.due_date_resolved,
      daysOpen,
      satUuid: r.sat_uuid,
      odooInvoiceId: r.odoo_invoice_id,
      paymentStateOdoo: r.payment_state_odoo,
      estadoSat: r.estado_sat,
    };

    const key = bucketKey(kind, direction);
    const bucket = buckets.get(key) ?? {
      kind,
      direction,
      invoices: [],
      totalMxn: 0,
    };
    bucket.invoices.push(inv);
    bucket.totalMxn += amt;
    buckets.set(key, bucket);
  }

  const categories: DiscrepancyCategory[] = Array.from(buckets.values())
    .map((b) => {
      const meta = KIND_META[b.kind];
      const sorted = b.invoices
        .sort((a, c) => c.amountResidualMxn - a.amountResidualMxn)
        .slice(0, 10);
      return {
        kind: b.kind,
        direction: b.direction,
        label: meta.label,
        recommendedAction: meta.action,
        severity: meta.severity,
        count: b.invoices.length,
        totalMxn: Math.round(b.totalMxn),
        topInvoices: sorted,
      };
    })
    .sort((a, b) => b.totalMxn - a.totalMxn);

  let affectedApMxn = 0;
  let affectedArMxn = 0;
  let totalCount = 0;
  let totalMxn = 0;
  for (const c of categories) {
    totalCount += c.count;
    totalMxn += c.totalMxn;
    if (c.direction === "received") affectedApMxn += c.totalMxn;
    else affectedArMxn += c.totalMxn;
  }

  return {
    totalCount,
    totalMxn,
    affectedApMxn,
    affectedArMxn,
    categories,
  };
}

export const getInvoiceDiscrepancies = unstable_cache(
  _getInvoiceDiscrepanciesRaw,
  ["sp13-finanzas-invoice-discrepancies-v1"],
  { revalidate: 600, tags: ["finanzas"] }
);
