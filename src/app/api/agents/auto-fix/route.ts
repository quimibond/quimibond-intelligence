/**
 * Data Auto-Fix — Self-healing data quality agent.
 *
 * Runs automatically. Fixes safe, non-destructive data issues:
 * - Links emails to contacts/companies
 * - Links invoices/orders to companies
 * - Resolves entity_ids on contacts/companies
 * - Fills contact names from Odoo data
 * - Deduplicates
 * - Recalculates broken links
 *
 * NEVER deletes data. NEVER modifies schema. NEVER touches code.
 * Only fills in missing links and connections.
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getServiceClient } from "@/lib/supabase-server";

export const maxDuration = 120;

export async function GET() {
  return POST();
}

export async function POST() {  const supabase = getServiceClient();

  const fixes: { action: string; count: number }[] = [];

  try {
    // ── 1. Link emails to contacts (by sender email) ────────────────────
    const { data: orphanEmails } = await supabase
      .from("emails")
      .select("id, sender")
      .is("sender_contact_id", null)
      .not("sender", "is", null)
      .limit(200);

    if (orphanEmails?.length) {
      // Extract all unique sender emails first (batch lookup, avoids N+1)
      const emailAddresses = new Set<string>();
      const emailToSender = new Map<string, string>();
      for (const email of orphanEmails) {
        const match = (email.sender ?? "").match(/<([^>]+)>/);
        const senderEmail = (match ? match[1] : email.sender ?? "").trim().toLowerCase();
        if (!senderEmail || !senderEmail.includes("@") || senderEmail.indexOf("@") === 0) continue;
        emailAddresses.add(senderEmail);
        emailToSender.set(String(email.id), senderEmail);
      }

      // Batch lookup contacts
      const contactMap = new Map<string, { id: string; company_id: string | null }>();
      if (emailAddresses.size > 0) {
        const { data: contacts } = await supabase
          .from("contacts")
          .select("id, email, company_id")
          .in("email", [...emailAddresses]);
        for (const c of contacts ?? []) {
          if (c.email) contactMap.set(c.email.toLowerCase(), { id: c.id, company_id: c.company_id });
        }
      }

      let linked = 0;
      for (const email of orphanEmails) {
        const senderEmail = emailToSender.get(String(email.id));
        if (!senderEmail) continue;
        const contact = contactMap.get(senderEmail);
        if (contact) {
          const updates: Record<string, unknown> = { sender_contact_id: contact.id };
          if (contact.company_id) {
            updates.company_id = contact.company_id;
          }
          await supabase.from("emails").update(updates).eq("id", email.id);
          linked++;
        }
      }
      if (linked > 0) fixes.push({ action: "emails_linked_to_contacts", count: linked });
    }

    // ── 2. Link emails to companies (via contact) ───────────────────────
    const { count: emailsNoCompany } = await supabase
      .from("emails")
      .select("id", { count: "exact", head: true })
      .is("company_id", null)
      .not("sender_contact_id", "is", null);

    if (emailsNoCompany && emailsNoCompany > 0) {
      const { data: fixable } = await supabase
        .from("emails")
        .select("id, sender_contact_id")
        .is("company_id", null)
        .not("sender_contact_id", "is", null)
        .limit(200);

      if (fixable?.length) {
        // Batch load all contact company_ids
        const contactIds = [...new Set(fixable.map(e => e.sender_contact_id).filter(Boolean))];
        const { data: contactsWithCompany } = await supabase
          .from("contacts")
          .select("id, company_id")
          .in("id", contactIds)
          .not("company_id", "is", null);

        const contactCompanyMap = new Map<string, string>();
        for (const c of contactsWithCompany ?? []) {
          contactCompanyMap.set(String(c.id), String(c.company_id));
        }

        let linked = 0;
        // Batch update emails by company_id groups
        const updatesByCompany = new Map<string, string[]>();
        for (const email of fixable) {
          const companyId = contactCompanyMap.get(String(email.sender_contact_id));
          if (companyId) {
            if (!updatesByCompany.has(companyId)) updatesByCompany.set(companyId, []);
            updatesByCompany.get(companyId)!.push(String(email.id));
          }
        }

        for (const [companyId, emailIds] of updatesByCompany) {
          const { error } = await supabase
            .from("emails")
            .update({ company_id: companyId })
            .in("id", emailIds);
          if (!error) linked += emailIds.length;
        }
        if (linked > 0) fixes.push({ action: "emails_linked_to_companies", count: linked });
      }
    }

    // ── 3. Link invoices to companies ───────────────────────────────────
    try {
      const { data: result } = await supabase.rpc("resolve_all_company_links");
      const r = result?.[0] ?? result ?? {};
      const total = (r.invoices_fixed ?? 0) + (r.orders_fixed ?? 0) + (r.deliveries_fixed ?? 0);
      if (total > 0) {
        fixes.push({ action: "invoices_linked", count: r.invoices_fixed ?? 0 });
        fixes.push({ action: "orders_linked", count: r.orders_fixed ?? 0 });
        fixes.push({ action: "deliveries_linked", count: r.deliveries_fixed ?? 0 });
      }
    } catch { /* RPC may not exist */ }

    // ── 4. Resolve entity_ids on companies ──────────────────────────────
    const { data: companiesNoEntity } = await supabase
      .from("companies")
      .select("id, canonical_name, odoo_partner_id")
      .is("entity_id", null)
      .limit(100);

    if (companiesNoEntity?.length) {
      // Batch load all company entities by odoo_id and canonical_name
      const odooIds = companiesNoEntity.map(c => c.odoo_partner_id).filter(Boolean);
      const names = companiesNoEntity.map(c => c.canonical_name?.toLowerCase().trim()).filter(Boolean);

      const [{ data: entsByOdoo }, { data: entsByName }] = await Promise.all([
        odooIds.length > 0
          ? supabase.from("entities").select("id, odoo_id").eq("entity_type", "company").in("odoo_id", odooIds)
          : Promise.resolve({ data: [] }),
        names.length > 0
          ? supabase.from("entities").select("id, canonical_name").eq("entity_type", "company").in("canonical_name", names)
          : Promise.resolve({ data: [] }),
      ]);

      const odooMap = new Map<number, number>();
      for (const e of entsByOdoo ?? []) odooMap.set(e.odoo_id, e.id);
      const nameMap = new Map<string, number>();
      for (const e of entsByName ?? []) nameMap.set(e.canonical_name, e.id);

      let linked = 0;
      for (const co of companiesNoEntity) {
        const entityId = (co.odoo_partner_id && odooMap.get(co.odoo_partner_id))
          || (co.canonical_name && nameMap.get(co.canonical_name.toLowerCase().trim()))
          || null;
        if (entityId) {
          await supabase.from("companies").update({ entity_id: entityId }).eq("id", co.id);
          linked++;
        }
      }
      if (linked > 0) fixes.push({ action: "companies_linked_to_entities", count: linked });
    }

    // ── 5. Resolve entity_ids on contacts ───────────────────────────────
    const { data: contactsNoEntity } = await supabase
      .from("contacts")
      .select("id, email")
      .is("entity_id", null)
      .not("email", "is", null)
      .limit(100);

    if (contactsNoEntity?.length) {
      const emails = contactsNoEntity.map(c => c.email).filter(Boolean);
      const { data: personEntities } = await supabase
        .from("entities")
        .select("id, email")
        .eq("entity_type", "person")
        .in("email", emails);

      const emailMap = new Map<string, number>();
      for (const e of personEntities ?? []) {
        if (e.email) emailMap.set(e.email, e.id);
      }

      let linked = 0;
      for (const c of contactsNoEntity) {
        const entityId = c.email ? emailMap.get(c.email) : undefined;
        if (entityId) {
          await supabase.from("contacts").update({ entity_id: entityId }).eq("id", c.id);
          linked++;
        }
      }
      if (linked > 0) fixes.push({ action: "contacts_linked_to_entities", count: linked });
    }

    // ── 6. Fill contact names from companies (contacts with NULL name) ──
    const { data: noNameContacts } = await supabase
      .from("contacts")
      .select("id, company_id")
      .is("name", null)
      .not("company_id", "is", null)
      .limit(100);

    if (noNameContacts?.length) {
      let filled = 0;
      for (const c of noNameContacts) {
        const { data: co } = await supabase
          .from("companies")
          .select("name")
          .eq("id", c.company_id)
          .single();
        if (co?.name) {
          await supabase.from("contacts").update({ name: co.name }).eq("id", c.id);
          filled++;
        }
      }
      if (filled > 0) fixes.push({ action: "contacts_names_filled", count: filled });
    }

    // ── 7. Deduplicate ──────────────────────────────────────────────────
    try {
      const { data: dedupeResult } = await supabase.rpc("deduplicate_all");
      const d = dedupeResult?.[0] ?? dedupeResult ?? {};
      if ((d.companies_merged ?? 0) > 0) fixes.push({ action: "companies_deduped", count: d.companies_merged });
      if ((d.entities_merged ?? 0) > 0) fixes.push({ action: "entities_deduped", count: d.entities_merged });
    } catch { /* RPC may not exist */ }

    // ── 8. Link orphan insights ─────────────────────────────────────────
    try {
      const { data: linkResult } = await supabase.rpc("link_orphan_insights");
      const linked = typeof linkResult === "number" ? linkResult : 0;
      if (linked > 0) fixes.push({ action: "insights_linked_to_companies", count: linked });
    } catch { /* RPC may not exist */ }

    // ── 9. Act on data_quality agent insights ─────────────────────────
    // Read what the data agent detected, resolve what we can, mark as acted_on
    const { data: dataInsights } = await supabase
      .from("agent_insights")
      .select("id, title, recommendation, severity")
      .eq("category", "data_quality")
      .in("state", ["new", "seen"])
      .order("severity", { ascending: true }) // critical first
      .limit(10);

    let insightsResolved = 0;
    if (dataInsights?.length) {
      for (const insight of dataInsights) {
        const title = (insight.title ?? "").toLowerCase();
        let resolved = false;

        // Check if the issue this insight reported has improved
        if (title.includes("email") && title.includes("contacto")) {
          // "emails sin contacto" — check current count
          const { count } = await supabase.from("emails").select("id", { count: "exact", head: true }).is("sender_contact_id", null);
          const { count: total } = await supabase.from("emails").select("id", { count: "exact", head: true });
          // If <30% orphaned, consider resolved
          if (count && total && count / total < 0.3) resolved = true;
        } else if (title.includes("factura") && title.includes("empresa")) {
          const { count } = await supabase.from("odoo_invoices").select("id", { count: "exact", head: true }).is("company_id", null);
          if (count !== null && count < 50) resolved = true;
        } else if (title.includes("orden") && title.includes("empresa")) {
          const { count } = await supabase.from("odoo_order_lines").select("id", { count: "exact", head: true }).is("company_id", null);
          if (count !== null && count < 100) resolved = true;
        } else if (title.includes("entity") || title.includes("entity_id")) {
          const { count } = await supabase.from("companies").select("id", { count: "exact", head: true }).is("entity_id", null);
          const { count: total } = await supabase.from("companies").select("id", { count: "exact", head: true });
          if (count && total && count / total < 0.15) resolved = true;
        } else if (title.includes("nombre") && title.includes("contacto")) {
          const { count } = await supabase.from("contacts").select("id", { count: "exact", head: true }).is("name", null);
          if (count !== null && count < 50) resolved = true;
        } else if (title.includes("procesar") || title.includes("procesado")) {
          const { count } = await supabase.from("emails").select("id", { count: "exact", head: true }).eq("kg_processed", false);
          const { count: total } = await supabase.from("emails").select("id", { count: "exact", head: true });
          if (count && total && count / total < 0.3) resolved = true;
        }

        if (resolved) {
          await supabase.from("agent_insights").update({
            state: "expired",
            user_feedback: "Auto-resuelto por auto-fix: los datos mejoraron suficiente",
          }).eq("id", insight.id);
          insightsResolved++;
        }
      }
      if (insightsResolved > 0) fixes.push({ action: "data_insights_resolved", count: insightsResolved });
    }

    // ── Log results ─────────────────────────────────────────────────────
    const totalFixes = fixes.reduce((s, f) => s + f.count, 0);

    if (totalFixes > 0) {
      await supabase.from("pipeline_logs").insert({
        level: "info",
        phase: "auto_fix",
        message: `Auto-fix: ${totalFixes} corrections across ${fixes.length} categories`,
        details: { fixes, total: totalFixes },
      });
    }

    return NextResponse.json({
      success: true,
      total_fixes: totalFixes,
      fixes,
    });
  } catch (err) {
    console.error("[auto-fix] Error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
