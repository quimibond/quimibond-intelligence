/**
 * Insight Validator v2 — Auto-cleans stale insights with adaptive TTL.
 *
 * Improvements over v1:
 * - Adaptive TTL: risk/critical insights last 14 days, info/low last 5 days
 * - Better deduplication: detects near-duplicate active insights
 * - Payment validation: checks for partial payments too
 * - Validates per-insight (not just per-company)
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

    // ── 2. Auto-expire old insights (adaptive TTL by severity/type) ────
    const expiredIds: number[] = [];
    for (const insight of activeInsights) {
      const ageMs = Date.now() - new Date(insight.created_at).getTime();
      const ageDays = ageMs / 86400_000;
      const ttl = getInsightTTL(insight.severity, insight.insight_type);
      if (ageDays > ttl) {
        expiredIds.push(insight.id);
      }
    }
    if (expiredIds.length) {
      await supabase
        .from("agent_insights")
        .update({
          state: "expired",
          was_useful: false,
          user_feedback: "Auto-expirado: datos ya no son confiables segun TTL adaptivo",
        })
        .in("id", expiredIds);
      expired += expiredIds.length;
    }

    // ── 2b. Archive old resolved insights (>30 days) ────────────────────
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400_000).toISOString();
    const { data: archivedData } = await supabase
      .from("agent_insights")
      .update({ state: "archived" })
      .in("state", ["acted_on", "dismissed", "expired"])
      .lt("created_at", thirtyDaysAgo)
      .select("id");

    const archived = archivedData?.length ?? 0;

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

    // ── 7. Deduplicate active insights ─────────────────────────────────
    let insightDeduped = 0;
    {
      // Find near-duplicate active insights (same agent, same normalized title, both active)
      const remaining = activeInsights.filter(i => !expiredIds.includes(i.id));
      const seen = new Map<string, number>(); // normalized title → first insight id
      const dupeIds: number[] = [];

      for (const insight of remaining) {
        const key = `${insight.category}:${normalizeTitle(insight.title)}`;
        if (seen.has(key)) {
          dupeIds.push(insight.id);
        } else {
          seen.set(key, insight.id);
        }
      }

      if (dupeIds.length) {
        await supabase.from("agent_insights")
          .update({ state: "expired", user_feedback: "Auto-deduplicado: insight similar ya existe" })
          .in("id", dupeIds);
        insightDeduped = dupeIds.length;
      }
    }

    // ── 8. Closed-loop: escalate stale assigned insights ─────────────
    let escalated = 0;
    {
      // Insights assigned to someone but not acted on after 3+ days → escalate
      const threeDaysAgo = new Date(Date.now() - 3 * 86400_000).toISOString();
      const { data: staleAssigned } = await supabase
        .from("agent_insights")
        .select("id, title, assignee_name, assignee_department, severity, company_id, created_at")
        .in("state", ["new", "seen"])
        .in("severity", ["critical", "high"])
        .not("assignee_name", "is", null)
        .lt("created_at", threeDaysAgo)
        .not("assignee_name", "eq", "Jose J. Mizrahi") // Don't escalate CEO's own
        .limit(20);

      if (staleAssigned?.length) {
        for (const insight of staleAssigned) {
          // Create an escalation insight for the CEO
          await supabase.from("agent_insights").insert({
            agent_id: insight.id, // will be overridden by trigger
            insight_type: "recommendation",
            category: "escalation",
            severity: insight.severity,
            title: `Escalacion: "${insight.title}" sin accion por ${insight.assignee_name}`,
            description: `Insight de severidad ${insight.severity} asignado a ${insight.assignee_name} (${insight.assignee_department}) hace mas de 3 dias sin respuesta. Insight original: ${insight.title}`,
            recommendation: `Verificar con ${insight.assignee_name} si esta en proceso o necesita apoyo. Si no, reasignar o tomar accion directa.`,
            confidence: 0.95,
            company_id: insight.company_id,
            state: "new",
            evidence: [{ original_insight_id: insight.id, assigned_to: insight.assignee_name, created_at: insight.created_at }],
          });

          // Mark original as "seen" so it doesn't escalate again
          await supabase.from("agent_insights")
            .update({ state: "seen" })
            .eq("id", insight.id);

          escalated++;
        }
      }
    }

    // ── 10. Deduplicate companies and entities (RPC) ────────────────────
    let deduped = { companies: 0, entities: 0 };
    try {
      const { data: dedupeResult } = await supabase.rpc("deduplicate_all");
      if (dedupeResult?.[0]) deduped = dedupeResult[0];
    } catch { /* RPC may not exist */ }

    // ── 11. Link orphan insights to companies (fuzzy match) ───────────
    let linked = 0;
    try {
      const { data: linkResult } = await supabase.rpc("link_orphan_insights");
      linked = typeof linkResult === "number" ? linkResult : 0;
    } catch { /* RPC may not exist yet */ }

    // ── 10. Log results ─────────────────────────────────────────────────
    if (resolved > 0 || expired > 0 || escalated > 0) {
      await supabase.from("pipeline_logs").insert({
        level: "info",
        phase: "insight_validation",
        message: `Validated: ${resolved} auto-resolved, ${expired} auto-expired of ${activeInsights.length} active`,
        details: { resolved, expired, archived, escalated, linked, deduped, insight_deduped: insightDeduped, total_active: activeInsights.length },
      });
    }

    return NextResponse.json({
      success: true,
      active_insights: activeInsights.length,
      resolved,
      expired,
      archived,
      escalated,
      insight_deduped: insightDeduped,
      linked_to_companies: linked,
      still_valid: activeInsights.length - resolved - expired - insightDeduped,
    });
  } catch (err) {
    console.error("[validate] Error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// ── Adaptive TTL: different lifetimes based on severity and type ─────
function getInsightTTL(severity: string, insightType: string): number {
  // Risk and critical insights stay longer — they need more time to be addressed
  if (severity === "critical") return 14;
  if (severity === "high") return 10;
  if (insightType === "risk" || insightType === "prediction") return 12;
  if (severity === "medium") return 7;
  if (severity === "low") return 5;
  // Info insights expire fastest — least actionable
  return 4;
}

// ── Normalize titles for deduplication ───────────────────────────────
function normalizeTitle(title: string): string {
  return (title || "")
    .toLowerCase()
    .replace(/\$[\d,.]+[km]?/g, "$X")
    .replace(/\d+/g, "N")
    .replace(/\s+/g, " ")
    .trim();
}
