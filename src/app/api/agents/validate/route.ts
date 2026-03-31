/**
 * Insight Validator — Auto-cleans stale insights.
 *
 * Runs before the inbox loads and on a cron. Checks each "new" insight
 * against CURRENT Odoo/Supabase data to see if the issue still exists.
 *
 * Examples:
 * - Insight says "$237K overdue" → check odoo_invoices → if paid, auto-resolve
 * - Insight says "no response from X" → check emails → if they responded, auto-resolve
 * - Insight says "delivery late" → check odoo_deliveries → if delivered, auto-resolve
 * - Insight says "CRM lead stale" → check odoo_crm_leads → if stage changed, auto-resolve
 * - Any insight >7 days old → auto-expire (data too stale to be useful)
 *
 * Each resolved insight gets a resolution note explaining WHY it was auto-closed.
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const maxDuration = 60;

export async function GET() {
  return POST();
}

export async function POST() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const supabase = createClient(url, key);

  try {
    let resolved = 0;
    let expired = 0;

    // ── 1. Get all active insights ──────────────────────────────────────
    const { data: activeInsights } = await supabase
      .from("agent_insights")
      .select("id, title, description, recommendation, severity, insight_type, category, company_id, contact_id, created_at")
      .in("state", ["new", "seen"])
      .order("created_at", { ascending: false })
      .limit(100);

    if (!activeInsights?.length) {
      return NextResponse.json({ success: true, resolved: 0, expired: 0, message: "No active insights to validate" });
    }

    // ── 2. Auto-expire old insights (>7 days) ──────────────────────────
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
    const old = activeInsights.filter(i => i.created_at < sevenDaysAgo);
    if (old.length) {
      await supabase
        .from("agent_insights")
        .update({
          state: "expired",
          was_useful: false,
          user_feedback: "Auto-expirado: datos de >7 dias ya no son confiables",
        })
        .in("id", old.map(i => i.id));
      expired += old.length;
    }

    // ── 3. Validate payment-related insights ────────────────────────────
    const paymentInsights = activeInsights.filter(i =>
      i.title?.toLowerCase().match(/pago|factura|cobr|vencid|cartera|residual|overdue/) ||
      i.category === "payment" || i.category === "collections"
    );

    if (paymentInsights.length) {
      // Get companies with recently paid invoices
      const companyIds = [...new Set(paymentInsights.map(i => i.company_id).filter(Boolean))];
      if (companyIds.length) {
        const { data: paidInvoices } = await supabase
          .from("odoo_invoices")
          .select("company_id")
          .in("company_id", companyIds)
          .eq("payment_state", "paid");

        const paidCompanies = new Set((paidInvoices ?? []).map(i => i.company_id));

        for (const insight of paymentInsights) {
          if (insight.company_id && paidCompanies.has(insight.company_id)) {
            await supabase.from("agent_insights").update({
              state: "expired",
              user_feedback: "Auto-resuelto: factura pagada detectada en Odoo",
            }).eq("id", insight.id);
            resolved++;
          }
        }
      }
    }

    // ── 4. Validate delivery-related insights ───────────────────────────
    const deliveryInsights = activeInsights.filter(i =>
      i.title?.toLowerCase().match(/entrega|delivery|envio|despacho|atrasa/) ||
      i.category === "delivery" || i.category === "logistics"
    );

    if (deliveryInsights.length) {
      const companyIds = [...new Set(deliveryInsights.map(i => i.company_id).filter(Boolean))];
      if (companyIds.length) {
        // Check if deliveries are now done
        const { data: pendingDeliveries } = await supabase
          .from("odoo_deliveries")
          .select("company_id")
          .in("company_id", companyIds)
          .eq("is_late", true)
          .not("state", "in", '("done","cancel")');

        const stillPendingCompanies = new Set((pendingDeliveries ?? []).map(d => d.company_id));

        for (const insight of deliveryInsights) {
          if (insight.company_id && !stillPendingCompanies.has(insight.company_id)) {
            await supabase.from("agent_insights").update({
              state: "expired",
              user_feedback: "Auto-resuelto: entregas completadas en Odoo",
            }).eq("id", insight.id);
            resolved++;
          }
        }
      }
    }

    // ── 5. Validate communication-related insights ──────────────────────
    const commInsights = activeInsights.filter(i =>
      i.title?.toLowerCase().match(/sin respuesta|no respond|comunicacion|silenci|contact/) ||
      i.category === "communication" || i.insight_type === "communication_gap"
    );

    if (commInsights.length) {
      const contactIds = [...new Set(commInsights.map(i => i.contact_id).filter(Boolean))];
      if (contactIds.length) {
        // Check if contacts have sent emails recently
        const twoDaysAgo = new Date(Date.now() - 48 * 3600_000).toISOString();
        const { data: recentEmails } = await supabase
          .from("emails")
          .select("sender_contact_id")
          .in("sender_contact_id", contactIds)
          .eq("sender_type", "external")
          .gte("email_date", twoDaysAgo);

        const respondedContacts = new Set((recentEmails ?? []).map(e => e.sender_contact_id));

        for (const insight of commInsights) {
          if (insight.contact_id && respondedContacts.has(insight.contact_id)) {
            await supabase.from("agent_insights").update({
              state: "expired",
              user_feedback: "Auto-resuelto: contacto respondio por email",
            }).eq("id", insight.id);
            resolved++;
          }
        }
      }
    }

    // ── 6. Validate CRM-related insights ────────────────────────────────
    const crmInsights = activeInsights.filter(i =>
      i.title?.toLowerCase().match(/crm|lead|oportunidad|pipeline|deal/) ||
      i.category === "crm" || i.category === "sales_pipeline"
    );

    if (crmInsights.length) {
      const companyIds = [...new Set(crmInsights.map(i => i.company_id).filter(Boolean))];
      if (companyIds.length) {
        const { data: wonLeads } = await supabase
          .from("odoo_crm_leads")
          .select("odoo_partner_id")
          .in("odoo_partner_id", companyIds)
          .in("stage", ["Won", "Ganado", "Orden de Venta"]);

        const wonCompanies = new Set((wonLeads ?? []).map(l => l.odoo_partner_id));

        for (const insight of crmInsights) {
          if (insight.company_id && wonCompanies.has(insight.company_id)) {
            await supabase.from("agent_insights").update({
              state: "expired",
              user_feedback: "Auto-resuelto: lead avanzo en CRM",
            }).eq("id", insight.id);
            resolved++;
          }
        }
      }
    }

    // ── 7. Link orphan insights to companies (fuzzy match) ────────────
    let linked = 0;
    try {
      const { data: linkResult } = await supabase.rpc("link_orphan_insights");
      linked = typeof linkResult === "number" ? linkResult : 0;
    } catch { /* RPC may not exist yet */ }

    // ── 8. Log results ──────────────────────────────────────────────────
    if (resolved > 0 || expired > 0) {
      await supabase.from("pipeline_logs").insert({
        level: "info",
        phase: "insight_validation",
        message: `Validated: ${resolved} auto-resolved, ${expired} auto-expired of ${activeInsights.length} active`,
        details: { resolved, expired, linked, total_active: activeInsights.length },
      });
    }

    return NextResponse.json({
      success: true,
      active_insights: activeInsights.length,
      resolved,
      expired,
      linked_to_companies: linked,
      still_valid: activeInsights.length - resolved - expired,
    });
  } catch (err) {
    console.error("[validate] Error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
