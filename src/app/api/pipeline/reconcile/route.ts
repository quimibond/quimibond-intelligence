import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { validatePipelineAuth } from "@/lib/pipeline/auth";

export const maxDuration = 60;

/**
 * Reconcile pipeline — auto-closes actions/alerts when Odoo data confirms resolution.
 *
 * Checks:
 * 1. Payment actions → invoice paid in odoo_invoices
 * 2. Delivery actions → delivery done in odoo_deliveries
 * 3. Contact actions → new email received from contact
 * 4. CRM actions → lead stage changed
 */
export async function POST(request: NextRequest) {
  const authError = validatePipelineAuth(request);
  if (authError) return authError;

  try {
    const supabase = getServiceClient();
    const now = new Date().toISOString();
    let closed = 0;

    // ── 1. Payment actions: check if related invoices got paid ──────────

    const { data: paymentActions } = await supabase
      .from("action_items")
      .select("id, description, contact_name, company_id")
      .eq("state", "pending")
      .or("action_type.eq.follow_up_payment,description.ilike.%pago%,description.ilike.%factura%,description.ilike.%cobr%");

    if (paymentActions?.length) {
      // Get companies with recently paid invoices
      const { data: paidInvoices } = await supabase
        .from("odoo_invoices")
        .select("odoo_partner_id, name")
        .eq("payment_state", "paid")
        .not("odoo_partner_id", "is", null);

      if (paidInvoices?.length) {
        const paidPartnerIds = new Set(paidInvoices.map(i => i.odoo_partner_id));

        // Match actions to companies via contacts
        const { data: companyContacts } = await supabase
          .from("contacts")
          .select("company_id, odoo_partner_id")
          .not("odoo_partner_id", "is", null)
          .not("company_id", "is", null);

        const companyToPaidPartner = new Map<number, boolean>();
        for (const c of companyContacts ?? []) {
          if (paidPartnerIds.has(c.odoo_partner_id)) {
            companyToPaidPartner.set(c.company_id, true);
          }
        }

        for (const action of paymentActions) {
          if (action.company_id && companyToPaidPartner.has(action.company_id)) {
            await supabase.from("action_items").update({
              state: "completed",
              completed_at: now,
              reason: `Auto-cerrada: factura pagada detectada en Odoo`,
            }).eq("id", action.id);
            closed++;
          }
        }
      }
    }

    // ── 2. Delivery actions: check if deliveries completed ─────────────

    const { data: deliveryActions } = await supabase
      .from("action_items")
      .select("id, description, company_id")
      .eq("state", "pending")
      .or("description.ilike.%entrega%,description.ilike.%envio%,description.ilike.%despacho%,description.ilike.%delivery%");

    if (deliveryActions?.length) {
      const companyIds = [...new Set(deliveryActions.map(a => a.company_id).filter(Boolean))];

      if (companyIds.length) {
        // Check if all pending deliveries for these companies are now done
        const { data: pendingDeliveries } = await supabase
          .from("odoo_deliveries")
          .select("odoo_partner_id, state")
          .in("odoo_partner_id", companyIds)
          .not("state", "in", '("done","cancel")');

        const companiesWithPendingDeliveries = new Set(
          (pendingDeliveries ?? []).map(d => d.odoo_partner_id)
        );

        for (const action of deliveryActions) {
          if (action.company_id && !companiesWithPendingDeliveries.has(action.company_id)) {
            await supabase.from("action_items").update({
              state: "completed",
              completed_at: now,
              reason: `Auto-cerrada: entregas completadas en Odoo`,
            }).eq("id", action.id);
            closed++;
          }
        }
      }
    }

    // ── 3. Contact actions: check if contact responded ─────────────────

    const { data: contactActions } = await supabase
      .from("action_items")
      .select("id, contact_name, contact_id, created_at")
      .eq("state", "pending")
      .or("action_type.eq.follow_up,action_type.eq.email,action_type.eq.call,description.ilike.%contactar%,description.ilike.%seguimiento%");

    if (contactActions?.length) {
      const contactIds = [...new Set(contactActions.map(a => a.contact_id).filter(Boolean))];

      if (contactIds.length) {
        // Check for recent emails from these contacts
        const recentCutoff = new Date(Date.now() - 48 * 3600_000).toISOString();
        const { data: recentEmails } = await supabase
          .from("emails")
          .select("sender, email_date")
          .eq("sender_type", "external")
          .gte("email_date", recentCutoff);

        // Get contact emails
        const { data: contacts } = await supabase
          .from("contacts")
          .select("id, email")
          .in("id", contactIds);

        const contactEmailMap = new Map<number, string>();
        for (const c of contacts ?? []) {
          if (c.email) contactEmailMap.set(c.id, c.email.toLowerCase());
        }

        const respondedEmails = new Set(
          (recentEmails ?? []).map(e => {
            const match = String(e.sender ?? "").match(/<([^>]+)>/);
            return (match ? match[1] : String(e.sender ?? "")).toLowerCase();
          })
        );

        for (const action of contactActions) {
          if (!action.contact_id) continue;
          const contactEmail = contactEmailMap.get(action.contact_id);
          if (contactEmail && respondedEmails.has(contactEmail)) {
            // Only close if email came AFTER the action was created
            await supabase.from("action_items").update({
              state: "completed",
              completed_at: now,
              reason: `Auto-cerrada: contacto respondio por email`,
            }).eq("id", action.id);
            closed++;
          }
        }
      }
    }

    // ── 4. CRM actions: check if lead advanced ─────────────────────────

    const { data: crmActions } = await supabase
      .from("action_items")
      .select("id, company_id")
      .eq("state", "pending")
      .or("description.ilike.%lead%,description.ilike.%oportunidad%,description.ilike.%cotizacion%,description.ilike.%pipeline%");

    if (crmActions?.length) {
      const companyIds = [...new Set(crmActions.map(a => a.company_id).filter(Boolean))];

      if (companyIds.length) {
        const { data: wonLeads } = await supabase
          .from("odoo_crm_leads")
          .select("odoo_partner_id, stage")
          .in("odoo_partner_id", companyIds)
          .in("stage", ["Won", "Ganado", "Orden de Venta"]);

        const companiesWithWonLeads = new Set(
          (wonLeads ?? []).map(l => l.odoo_partner_id)
        );

        for (const action of crmActions) {
          if (action.company_id && companiesWithWonLeads.has(action.company_id)) {
            await supabase.from("action_items").update({
              state: "completed",
              completed_at: now,
              reason: `Auto-cerrada: lead avanzó a etapa ganada en CRM`,
            }).eq("id", action.id);
            closed++;
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      actions_closed: closed,
      message: closed > 0
        ? `${closed} acciones cerradas automaticamente`
        : "Sin acciones para cerrar",
    });
  } catch (err) {
    console.error("[reconcile] Error:", err);
    return NextResponse.json(
      { error: "Error en reconciliacion", detail: String(err) },
      { status: 500 }
    );
  }
}
