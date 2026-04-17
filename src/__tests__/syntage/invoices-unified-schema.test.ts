import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;

const describeIntegration = URL && KEY ? describe : describe.skip;

// Canon shape. If you add/remove columns from invoices_unified, update this.
const INVOICES_UNIFIED_COLUMNS: Record<string, string> = {
  canonical_id: "text",
  uuid_sat: "text",
  odoo_invoice_id: "bigint",
  match_status: "text",
  match_quality: "text",
  direction: "text",
  estado_sat: "text",
  fecha_cancelacion: "timestamp with time zone",
  fecha_timbrado: "timestamp with time zone",
  tipo_comprobante: "text",
  metodo_pago: "text",
  forma_pago: "text",
  uso_cfdi: "text",
  emisor_rfc: "text",
  emisor_nombre: "text",
  receptor_rfc: "text",
  receptor_nombre: "text",
  emisor_blacklist_status: "text",
  receptor_blacklist_status: "text",
  total_fiscal: "numeric",
  subtotal_fiscal: "numeric",
  descuento_fiscal: "numeric",
  impuestos_trasladados: "numeric",
  impuestos_retenidos: "numeric",
  moneda_fiscal: "text",
  tipo_cambio_fiscal: "numeric",
  total_mxn_fiscal: "numeric",
  odoo_company_id: "integer",
  company_id: "bigint",
  partner_name: "text",
  odoo_partner_id: "integer",
  odoo_ref: "text",
  odoo_external_ref: "text",
  odoo_move_type: "text",
  odoo_state: "text",
  payment_state: "text",
  odoo_amount_total: "numeric",
  amount_residual: "numeric",
  invoice_date: "date",
  due_date: "date",
  days_overdue: "integer",
  odoo_currency: "text",
  fiscal_operational_consistency: "text",
  amount_diff: "numeric",
  email_id_origen: "bigint",
  refreshed_at: "timestamp with time zone",
};

function sb() {
  if (!URL || !KEY) throw new Error("env missing");
  return createClient(URL, KEY, { auth: { persistSession: false } });
}

describeIntegration("invoices_unified schema regression", () => {
  it("matches the expected column set + types", async () => {
    const supabase = sb();
    const { data, error } = await supabase.rpc("exec_sql", {
      query: `SELECT column_name, data_type
              FROM information_schema.columns
              WHERE table_name = 'invoices_unified' AND table_schema = 'public'
              ORDER BY column_name`,
    }).single();

    // Fallback: if exec_sql RPC doesn't exist, use a direct select-all from view
    // and introspect the returned row.
    if (error?.message?.includes("function") || !data) {
      const { data: sampleRow, error: sampleErr } = await supabase
        .from("invoices_unified")
        .select("*")
        .limit(1);
      expect(sampleErr).toBeNull();
      if (sampleRow && sampleRow.length > 0) {
        const actualCols = new Set(Object.keys(sampleRow[0]));
        const expectedCols = new Set(Object.keys(INVOICES_UNIFIED_COLUMNS));
        const missing = [...expectedCols].filter((c) => !actualCols.has(c));
        const extra   = [...actualCols].filter((c) => !expectedCols.has(c));
        expect({ missing, extra }).toEqual({ missing: [], extra: [] });
      }
    } else {
      const rows = data as unknown as { column_name: string; data_type: string }[];
      for (const row of rows) {
        expect(INVOICES_UNIFIED_COLUMNS[row.column_name]).toBe(row.data_type);
      }
      const actualCols = new Set(rows.map((r) => r.column_name));
      const expectedCols = new Set(Object.keys(INVOICES_UNIFIED_COLUMNS));
      const missing = [...expectedCols].filter((c) => !actualCols.has(c));
      const extra   = [...actualCols].filter((c) => !expectedCols.has(c));
      expect({ missing, extra }).toEqual({ missing: [], extra: [] });
    }
  });
});
