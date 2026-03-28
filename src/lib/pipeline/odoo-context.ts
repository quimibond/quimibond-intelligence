/**
 * Odoo Context Service — builds business context from Supabase tables.
 * Replaces OdooEnrichmentService by reading from synced Odoo tables
 * instead of querying Odoo ORM directly.
 */
import { SupabaseClient } from "@supabase/supabase-js";

interface PartnerContext {
  name: string;
  email: string;
  company_name: string;
  is_customer: boolean;
  is_supplier: boolean;
  recent_sales: { name: string; date: string; amount: number; state: string }[];
  pending_invoices: { name: string; date: string; amount: number; amount_residual: number; days_overdue: number }[];
  recent_payments: { name: string; date: string; amount: number; payment_type: string }[];
  pending_deliveries: { name: string; scheduled: string; state: string; is_late: boolean; origin: string }[];
  crm_leads: { name: string; stage: string; expected_revenue: number; probability: number }[];
  pending_activities: { type: string; summary: string; deadline: string; assigned_to: string; is_overdue: boolean }[];
  _summary: string;
}

export interface OdooContext {
  partners: Record<string, PartnerContext>;
  business_summary: Record<string, string>;
}

/**
 * Build full Odoo business context for all contacts from Supabase tables.
 * This replaces the Python OdooEnrichmentService.enrich() method.
 */
export async function buildOdooContext(
  supabase: SupabaseClient,
  contactEmails: string[]
): Promise<OdooContext> {
  const ctx: OdooContext = { partners: {}, business_summary: {} };
  if (!contactEmails.length) return ctx;

  // Find contacts with their company info (odoo_partner_id links to Odoo tables)
  const { data: contacts } = await supabase
    .from("contacts")
    .select("email, name, company_id, odoo_partner_id, role, risk_level, is_customer, is_supplier")
    .in("email", contactEmails.map(e => e.toLowerCase()));

  if (!contacts?.length) return ctx;

  // Collect all odoo_partner_ids for batch queries
  const partnerIds = contacts
    .map(c => c.odoo_partner_id)
    .filter((id): id is number => id != null);

  // Batch load all Odoo data in parallel
  const [invoicesRes, paymentsRes, deliveriesRes, leadsRes, activitiesRes, orderLinesRes] =
    await Promise.all([
      partnerIds.length
        ? supabase
            .from("odoo_invoices")
            .select("*")
            .in("odoo_partner_id", partnerIds)
            .order("invoice_date", { ascending: false })
        : Promise.resolve({ data: [] }),

      partnerIds.length
        ? supabase
            .from("odoo_payments")
            .select("*")
            .in("odoo_partner_id", partnerIds)
            .order("payment_date", { ascending: false })
        : Promise.resolve({ data: [] }),

      partnerIds.length
        ? supabase
            .from("odoo_deliveries")
            .select("*")
            .in("odoo_partner_id", partnerIds)
            .order("scheduled_date", { ascending: false })
        : Promise.resolve({ data: [] }),

      partnerIds.length
        ? supabase
            .from("odoo_crm_leads")
            .select("*")
            .in("odoo_partner_id", partnerIds)
            .eq("active", true)
        : Promise.resolve({ data: [] }),

      partnerIds.length
        ? supabase
            .from("odoo_activities")
            .select("*")
            .in("odoo_partner_id", partnerIds)
        : Promise.resolve({ data: [] }),

      partnerIds.length
        ? supabase
            .from("odoo_order_lines")
            .select("*")
            .in("odoo_partner_id", partnerIds)
            .order("order_date", { ascending: false })
            .limit(500)
        : Promise.resolve({ data: [] }),
    ]);

  // Group data by odoo_partner_id
  const invoicesByPartner = groupBy(invoicesRes.data ?? [], "odoo_partner_id");
  const paymentsByPartner = groupBy(paymentsRes.data ?? [], "odoo_partner_id");
  const deliveriesByPartner = groupBy(deliveriesRes.data ?? [], "odoo_partner_id");
  const leadsByPartner = groupBy(leadsRes.data ?? [], "odoo_partner_id");
  const activitiesByPartner = groupBy(activitiesRes.data ?? [], "odoo_partner_id");
  const orderLinesByPartner = groupBy(orderLinesRes.data ?? [], "odoo_partner_id");

  const today = new Date().toISOString().split("T")[0];

  // Build context per contact
  for (const contact of contacts) {
    const pid = contact.odoo_partner_id;
    if (!pid) continue;

    const invoices = invoicesByPartner[pid] ?? [];
    const payments = paymentsByPartner[pid] ?? [];
    const deliveries = deliveriesByPartner[pid] ?? [];
    const leads = leadsByPartner[pid] ?? [];
    const activities = activitiesByPartner[pid] ?? [];
    const orderLines = orderLinesByPartner[pid] ?? [];

    // Pending invoices (not fully paid)
    const pendingInvoices = invoices
      .filter(i => i.payment_state && !["paid", "in_payment", "reversed"].includes(i.payment_state))
      .slice(0, 10)
      .map(i => ({
        name: i.name,
        date: i.invoice_date ?? "",
        amount: i.amount_total ?? 0,
        amount_residual: i.amount_residual ?? i.amount_total ?? 0,
        days_overdue: i.days_overdue ?? 0,
      }));

    // Recent sales from order lines (last 90 days, grouped by order)
    const recentOrderNames = new Set<string>();
    const recentSales = orderLines
      .filter(ol => ol.order_type === "sale" && ol.order_state in { sale: 1, done: 1 })
      .reduce((acc: { name: string; date: string; amount: number; state: string }[], ol) => {
        if (!recentOrderNames.has(ol.order_name)) {
          recentOrderNames.add(ol.order_name);
          acc.push({
            name: ol.order_name,
            date: ol.order_date ?? "",
            amount: ol.subtotal ?? 0,
            state: ol.order_state ?? "",
          });
        } else {
          const existing = acc.find(s => s.name === ol.order_name);
          if (existing) existing.amount += ol.subtotal ?? 0;
        }
        return acc;
      }, [] as { name: string; date: string; amount: number; state: string }[])
      .slice(0, 10);

    const recentPayments = payments.slice(0, 10).map(p => ({
      name: p.name,
      date: p.payment_date ?? "",
      amount: p.amount ?? 0,
      payment_type: p.payment_type ?? "inbound",
    }));

    const pendingDeliveries = deliveries
      .filter(d => !["done", "cancel"].includes(d.state ?? ""))
      .slice(0, 10)
      .map(d => ({
        name: d.name,
        scheduled: d.scheduled_date ?? "",
        state: d.state ?? "",
        is_late: d.is_late ?? false,
        origin: d.origin ?? "",
      }));

    const crmLeads = leads.slice(0, 5).map(l => ({
      name: l.name,
      stage: l.stage ?? "",
      expected_revenue: l.expected_revenue ?? 0,
      probability: l.probability ?? 0,
    }));

    const pendingActivities = activities.map(a => ({
      type: a.activity_type ?? "Tarea",
      summary: a.summary ?? "",
      deadline: a.date_deadline ?? "",
      assigned_to: a.assigned_to ?? "",
      is_overdue: a.is_overdue ?? (a.date_deadline ? a.date_deadline < today : false),
    }));

    // Build summary string (what Claude sees as [ODOO: ...])
    const summaryParts: string[] = [];

    if (recentSales.length) {
      const total = recentSales.reduce((s: number, o: { amount: number }) => s + o.amount, 0);
      summaryParts.push(`VENTAS: ${recentSales.length} pedidos ($${total.toLocaleString("en", { maximumFractionDigits: 0 })}) en 90d`);
    }

    if (pendingInvoices.length) {
      const totalPend = pendingInvoices.reduce((s, i) => s + i.amount_residual, 0);
      const overdue = pendingInvoices.filter(i => i.days_overdue > 0);
      if (overdue.length) {
        const maxOverdue = Math.max(...overdue.map(i => i.days_overdue));
        summaryParts.push(`FACTURAS: $${totalPend.toLocaleString("en", { maximumFractionDigits: 0 })} pendiente (${overdue.length} vencidas, máx ${maxOverdue}d)`);
      } else {
        summaryParts.push(`FACTURAS: $${totalPend.toLocaleString("en", { maximumFractionDigits: 0 })} pendiente (al corriente)`);
      }
    }

    if (recentPayments.length) {
      const inbound = recentPayments.filter(p => p.payment_type === "inbound");
      if (inbound.length) {
        const totalIn = inbound.reduce((s, p) => s + p.amount, 0);
        summaryParts.push(`COBROS: $${totalIn.toLocaleString("en", { maximumFractionDigits: 0 })} recibido (30d)`);
      }
    }

    if (pendingDeliveries.length) {
      const late = pendingDeliveries.filter(d => d.is_late);
      if (late.length) {
        summaryParts.push(`ENTREGAS: ${pendingDeliveries.length} pendientes (${late.length} RETRASADAS)`);
      } else {
        summaryParts.push(`ENTREGAS: ${pendingDeliveries.length} pendientes`);
      }
    }

    if (crmLeads.length) {
      const opps = crmLeads.filter(l => l.probability >= 10);
      if (opps.length) {
        const totalRev = opps.reduce((s, l) => s + l.expected_revenue, 0);
        summaryParts.push(`CRM: ${opps.length} oportunidades ($${totalRev.toLocaleString("en", { maximumFractionDigits: 0 })} esperado)`);
      }
    }

    const overdueActs = pendingActivities.filter(a => a.is_overdue);
    const pendingActs = pendingActivities.filter(a => !a.is_overdue);
    if (overdueActs.length || pendingActs.length) {
      const parts: string[] = [];
      if (overdueActs.length) parts.push(`${overdueActs.length} VENCIDAS`);
      if (pendingActs.length) parts.push(`${pendingActs.length} pendientes`);
      summaryParts.push(`ACTIVIDADES: ${parts.join(", ")}`);
    }

    const summary = summaryParts.join(" | ");
    const email = contact.email.toLowerCase();

    ctx.partners[email] = {
      name: contact.name ?? "",
      email,
      company_name: "", // resolved from company_id if needed
      is_customer: contact.is_customer ?? true,
      is_supplier: contact.is_supplier ?? false,
      recent_sales: recentSales,
      pending_invoices: pendingInvoices,
      recent_payments: recentPayments,
      pending_deliveries: pendingDeliveries,
      crm_leads: crmLeads,
      pending_activities: pendingActivities,
      _summary: summary,
    };
    ctx.business_summary[email] = summary;
  }

  return ctx;
}

/**
 * Load person profiles from contacts table for [PERSONA CONOCIDA:] tags.
 */
export async function loadPersonProfiles(
  supabase: SupabaseClient,
  emails: string[]
): Promise<Record<string, Record<string, unknown>>> {
  if (!emails.length) return {};

  const { data } = await supabase
    .from("contacts")
    .select("email, role, decision_power, communication_style, key_interests, personality_notes, negotiation_style")
    .in("email", emails.map(e => e.toLowerCase()))
    .not("role", "is", null);

  const profiles: Record<string, Record<string, unknown>> = {};
  for (const c of data ?? []) {
    if (c.email) profiles[c.email.toLowerCase()] = c;
  }
  return profiles;
}

function groupBy<T extends Record<string, unknown>>(arr: T[], key: string): Record<number, T[]> {
  const map: Record<number, T[]> = {};
  for (const item of arr) {
    const k = item[key] as number;
    if (k != null) {
      (map[k] ??= []).push(item);
    }
  }
  return map;
}
