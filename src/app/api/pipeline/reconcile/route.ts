/**
 * SP5-VERIFIED: action_items / insight_follow_ups / agent_insights / ai_agents / emails / contacts — retained (not in §12 drop list).
 * SP5-EXCEPTION (Bronze reads by design): odoo_invoices, odoo_deliveries, odoo_crm_leads
 *   Used to verify whether pending action_items have been resolved in Odoo Bronze.
 *   action_items.company_id is a Bronze companies.id FK — canonical tables use
 *   canonical_company_id namespace. Cannot directly substitute without migrating
 *   action_items schema. Mark for SP6.
 * SP5-EXCEPTION: company_narrative
 *   Used by insight_follow_ups resolution loop to read current metrics snapshot.
 *   company_narrative is in §12 drop list — but no canonical replacement exposes
 *   the same flattened per-company snapshot (overdue_amount, late_deliveries,
 *   days_since_last_order, complaints). TODO SP6: build gold_company_snapshot view.
 */
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
// Vercel Crons use GET
export async function GET(request: NextRequest) {
  return POST(request);
}

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
        .from("odoo_invoices") // SP5-EXCEPTION: Bronze validation — action_items use Bronze company_id FK namespace
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
          .from("odoo_deliveries") // SP5-EXCEPTION: Bronze validation — action_items use Bronze company_id FK namespace
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
          .from("odoo_crm_leads") // SP5-EXCEPTION: Bronze validation — action_items use Bronze company_id FK namespace
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

    // ── 5. FOLLOW-UP RESOLUTION: check if CEO-acted insights actually improved ──

    let followUpsResolved = 0;
    const { data: pendingFollowUps } = await supabase
      .from("insight_follow_ups")
      .select("id, company_id, category, original_title, snapshot_at_action, follow_up_date")
      .eq("status", "pending")
      .lte("follow_up_date", new Date().toISOString().split("T")[0]);

    if (pendingFollowUps?.length) {
      for (const fu of pendingFollowUps) {
        if (!fu.company_id || !fu.snapshot_at_action) {
          // No company to track, expire it
          await supabase.from("insight_follow_ups").update({
            status: "expired", resolved_at: now, resolution_note: "Sin empresa para verificar"
          }).eq("id", fu.id);
          followUpsResolved++;
          continue;
        }

        // Get current company metrics from narrative
        const { data: current } = await supabase
          .from("company_narrative") // SP5-EXCEPTION: §12 banned MV — follow-up snapshot read; no canonical equivalent yet. TODO SP6: replace with gold_company_snapshot
          .select("overdue_amount, revenue_90d, late_deliveries, complaints, days_since_last_order")
          .eq("company_id", fu.company_id)
          .limit(1)
          .single();

        if (!current) {
          await supabase.from("insight_follow_ups").update({
            status: "expired", resolved_at: now, resolution_note: "Empresa no encontrada en narrativa"
          }).eq("id", fu.id);
          followUpsResolved++;
          continue;
        }

        const snap = fu.snapshot_at_action as Record<string, number>;
        let status: string;
        let note: string;

        // Compare current vs snapshot based on category
        if (fu.category === "cobranza") {
          const before = snap.overdue_amount ?? 0;
          const after = Number(current.overdue_amount ?? 0);
          if (after < before * 0.5) { status = "improved"; note = `Cartera bajó de $${Math.round(before)} a $${Math.round(after)}`; }
          else if (after > before * 1.2) { status = "worsened"; note = `Cartera SUBIO de $${Math.round(before)} a $${Math.round(after)}`; }
          else { status = "unchanged"; note = `Cartera sin cambio significativo ($${Math.round(after)})`; }
        } else if (fu.category === "ventas") {
          const beforeDays = snap.days_since_last_order ?? 999;
          const afterDays = Number(current.days_since_last_order ?? 999);
          if (afterDays < beforeDays) { status = "improved"; note = `Cliente volvió a comprar (${afterDays}d desde ultima orden)`; }
          else { status = "unchanged"; note = `Sin nueva orden (${afterDays}d sin comprar)`; }
        } else if (fu.category === "entregas") {
          const before = snap.late_deliveries ?? 0;
          const after = Number(current.late_deliveries ?? 0);
          if (after < before) { status = "improved"; note = `Entregas tarde bajaron de ${before} a ${after}`; }
          else if (after > before) { status = "worsened"; note = `Entregas tarde SUBIERON de ${before} a ${after}`; }
          else { status = "unchanged"; note = `Sin cambio (${after} tarde)`; }
        } else {
          // Generic comparison: check if overdue went down
          const before = snap.overdue_amount ?? 0;
          const after = Number(current.overdue_amount ?? 0);
          if (after < before * 0.7) { status = "improved"; note = "Metricas mejoraron"; }
          else if (after > before * 1.3) { status = "worsened"; note = "Metricas empeoraron"; }
          else { status = "unchanged"; note = "Sin cambio significativo"; }
        }

        await supabase.from("insight_follow_ups").update({
          status, resolved_at: now, resolution_note: note
        }).eq("id", fu.id);
        followUpsResolved++;

        // If worsened, create a new insight to re-escalate
        if (status === "worsened") {
          await supabase.from("agent_insights").insert({
            agent_id: (await supabase.from("ai_agents").select("id").eq("slug", "riesgo").limit(1).single()).data?.id,
            title: `RE-ESCALADA: ${fu.original_title} — situación empeoró después de acción`,
            description: note,
            category: fu.category ?? "riesgo",
            severity: "critical",
            confidence: 0.95,
            company_id: fu.company_id,
            state: "new",
          });
        }
      }
    }

    // ── Silver SP2 stale-issue sweep ───────────────────────────────────
    // Closes invoice.posted_without_uuid + invoice.missing_sat_timbrado
    // issues whose canonical invoice has acquired sat_uuid / has_sat_record
    // since the issue was raised. Patches a gap in run_reconciliation()
    // (posted_without_uuid lacks an auto-resolve block; missing_sat_timbrado
    // only checks has_sat_record but matcher sometimes sets sat_uuid first).
    let invoiceIssuesClosed = 0;
    try {
      const { data: sweep } = await supabase.rpc(
        "silver_close_stale_invoice_issues"
      );
      type SweepRow = { invariant_key: string; closed_count: number };
      for (const row of (sweep ?? []) as SweepRow[]) {
        invoiceIssuesClosed += Number(row.closed_count) || 0;
      }
    } catch (err) {
      console.warn("[reconcile] silver_close_stale_invoice_issues failed:", err);
    }

    return NextResponse.json({
      success: true,
      actions_closed: closed,
      follow_ups_resolved: followUpsResolved,
      invoice_issues_closed: invoiceIssuesClosed,
      message:
        closed > 0 || invoiceIssuesClosed > 0
          ? `${closed} acciones + ${invoiceIssuesClosed} alertas cerradas automáticamente`
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
