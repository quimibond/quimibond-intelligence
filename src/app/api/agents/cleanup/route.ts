/**
 * Cleanup Agent — Silent data hygiene that makes other agents smarter.
 *
 * Unlike other agents, this one does NOT generate insights for the CEO.
 * It runs on cron and executes concrete data fixes:
 *
 * 1. Enriches companies (industry, business_type) using Claude
 * 2. Links orphan emails to contacts/companies
 * 3. Deduplicates active insights
 * 4. Refreshes the company_profile materialized view
 * 5. Fills missing contact names from Odoo data
 *
 * Runs every 30 minutes via /api/agents/cleanup
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getServiceClient } from "@/lib/supabase-server";
import { callClaudeJSON, logTokenUsage } from "@/lib/claude";
import { validatePipelineAuth } from "@/lib/pipeline/auth";

export const maxDuration = 120;

export async function GET(request: NextRequest) {
  return POST(request);
}

export async function POST(request: NextRequest) {
  const authError = validatePipelineAuth(request);
  if (authError) return authError;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 503 });  const supabase = getServiceClient();

  const results = {
    companies_enriched: 0,
    emails_linked: 0,
    insights_deduped: 0,
    contacts_filled: 0,
    profile_refreshed: false,
    errors: [] as string[],
  };

  try {
    // ── 1. Enrich companies without industry (batch of 5 per run) ──────
    try {
      const { data: unenriched } = await supabase
        .from("companies")
        .select("id, name, canonical_name, is_customer, is_supplier, key_products")
        .is("industry", null)
        .not("name", "is", null)
        .order("lifetime_value", { ascending: false, nullsFirst: false })
        .limit(5);

      if (unenriched?.length) {
        // Get product context for each company
        for (const company of unenriched) {
          const { data: orders } = await supabase
            .from("odoo_order_lines")
            .select("product_name, order_type, subtotal")
            .eq("company_id", company.id)
            .order("subtotal", { ascending: false })
            .limit(10);

          const productContext = orders?.length
            ? orders.map((o: { product_name: string; order_type: string; subtotal: number }) =>
                `${o.order_type === "sale" ? "Les vendemos" : "Nos venden"}: ${o.product_name} ($${o.subtotal})`
              ).join("\n")
            : "Sin ordenes registradas";

          try {
            const { result } = await callClaudeJSON<{
              industry: string;
              business_type: string;
              description: string;
            }>(
              apiKey,
              {
                model: "claude-haiku-4-5-20251001",
                max_tokens: 256,
                temperature: 0,
                system: `Clasifica esta empresa mexicana. Responde JSON: { "industry": "textil|automotriz|retail|uniformes|quimico|empaque|alimentos|construccion|energia|servicios|otro", "business_type": "manufacturer|distributor|retailer|service_provider|raw_material_supplier", "description": "1 oracion describiendo que hace la empresa" }`,
                messages: [{
                  role: "user",
                  content: `Empresa: ${company.name}\nEs cliente: ${company.is_customer}\nEs proveedor: ${company.is_supplier}\nProductos:\n${productContext}`,
                }],
              },
              "cleanup-enrich"
            );

            if (result.industry) {
              await supabase.from("companies").update({
                industry: result.industry,
                business_type: result.business_type || null,
                description: result.description || null,
                enriched_at: new Date().toISOString(),
                enrichment_source: "cleanup-agent",
              }).eq("id", company.id);
              results.companies_enriched++;
            }
          } catch (err) {
            results.errors.push(`Enrich ${company.name}: ${String(err).slice(0, 100)}`);
          }
        }
      }
    } catch (err) {
      results.errors.push(`Enrich phase: ${String(err).slice(0, 100)}`);
    }

    // ── 2. Link orphan emails to contacts by sender address ────────────
    try {
      const { data: orphanEmails } = await supabase
        .from("emails")
        .select("id, sender")
        .is("sender_contact_id", null)
        .not("sender", "is", null)
        .limit(50);

      if (orphanEmails?.length) {
        // Extract email addresses and batch-lookup contacts
        const emailAddresses = new Set<string>();
        for (const email of orphanEmails) {
          const match = String(email.sender).match(/<([^>]+)>/) || [null, email.sender];
          const addr = (match[1] || "").toLowerCase().trim();
          if (addr && addr.includes("@")) emailAddresses.add(addr);
        }

        if (emailAddresses.size > 0) {
          const { data: contacts } = await supabase
            .from("contacts")
            .select("id, email, company_id")
            .in("email", [...emailAddresses]);

          const contactMap = new Map<string, { id: string; company_id: string | null }>();
          for (const ct of contacts ?? []) {
            if (ct.email) contactMap.set(String(ct.email).toLowerCase(), { id: ct.id, company_id: ct.company_id });
          }

          for (const email of orphanEmails) {
            const match = String(email.sender).match(/<([^>]+)>/) || [null, email.sender];
            const addr = (match[1] || "").toLowerCase().trim();
            const contact = contactMap.get(addr);
            if (contact) {
              await supabase.from("emails").update({
                sender_contact_id: contact.id,
                company_id: contact.company_id,
              }).eq("id", email.id);
              results.emails_linked++;
            }
          }
        }
      }
    } catch (err) {
      results.errors.push(`Email link: ${String(err).slice(0, 100)}`);
    }

    // ── 3. Deduplicate active insights ─────────────────────────────────
    try {
      const { data: activeInsights } = await supabase
        .from("agent_insights")
        .select("id, agent_id, title, category, created_at")
        .in("state", ["new", "seen"])
        .order("created_at", { ascending: false })
        .limit(200);

      if (activeInsights?.length) {
        const seen = new Map<string, number>();
        const dupeIds: number[] = [];

        for (const insight of activeInsights) {
          const key = `${insight.agent_id}:${normalizeTitle(insight.title)}`;
          if (seen.has(key)) {
            dupeIds.push(insight.id);
          } else {
            seen.set(key, insight.id);
          }
        }

        if (dupeIds.length) {
          await supabase.from("agent_insights")
            .update({ state: "expired", user_feedback: "Cleanup: insight duplicado" })
            .in("id", dupeIds);
          results.insights_deduped = dupeIds.length;
        }
      }
    } catch (err) {
      results.errors.push(`Dedup: ${String(err).slice(0, 100)}`);
    }

    // ── 4. Fill missing contact names from company data ────────────────
    try {
      const { data: nameless } = await supabase
        .from("contacts")
        .select("id, email, company_id")
        .is("name", null)
        .not("email", "is", null)
        .limit(20);

      if (nameless?.length) {
        for (const contact of nameless) {
          // Try to extract name from email prefix
          const prefix = String(contact.email).split("@")[0] || "";
          const parts = prefix.split(/[._-]/);
          if (parts.length >= 2 && parts[0].length > 1 && parts[1].length > 1) {
            const name = parts
              .map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
              .join(" ");
            await supabase.from("contacts")
              .update({ name })
              .eq("id", contact.id);
            results.contacts_filled++;
          }
        }
      }
    } catch (err) {
      results.errors.push(`Contact names: ${String(err).slice(0, 100)}`);
    }

    // ── 5. Refresh materialized views ───────────────────────────────────
    try {
      await supabase.rpc("refresh_company_profile");
      results.profile_refreshed = true;
    } catch {
      // ignore if view doesn't exist yet
    }
    try {
      await supabase.rpc("refresh_company_handlers");
    } catch {
      // ignore if view doesn't exist yet
    }
    try {
      await supabase.rpc("refresh_product_intelligence");
    } catch {
      // ignore if views don't exist yet
    }
    try {
      await supabase.rpc("refresh_reorder_predictions");
    } catch {
      // ignore if view doesn't exist yet
    }
    try {
      await supabase.rpc("refresh_company_narrative");
    } catch {
      /* may not exist */
    }
    try {
      await supabase.rpc("refresh_purchase_intelligence");
    } catch {
      /* may not exist */
    }
    try {
      await supabase.rpc("refresh_accounting_anomalies");
    } catch {
      /* may not exist */
    }
    try {
      await supabase.rpc("refresh_cashflow_projection");
    } catch {
      /* may not exist */
    }

    // ── 6. Call RPCs for additional cleanup ─────────────────────────────
    try { await supabase.rpc("resolve_all_company_links"); } catch { /* may not exist */ }
    try { await supabase.rpc("link_orphan_insights"); } catch { /* may not exist */ }

    // ── Log results ────────────────────────────────────────────────────
    const totalActions = results.companies_enriched + results.emails_linked +
      results.insights_deduped + results.contacts_filled;

    if (totalActions > 0 || results.errors.length > 0) {
      await supabase.from("pipeline_logs").insert({
        level: results.errors.length > 0 ? "warning" : "info",
        phase: "cleanup_agent",
        message: `Cleanup: ${results.companies_enriched} enriched, ${results.emails_linked} emails linked, ${results.insights_deduped} deduped, ${results.contacts_filled} names filled`,
        details: results,
      });
    }

    return NextResponse.json({ success: true, ...results });
  } catch (err) {
    console.error("[cleanup] Error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

function normalizeTitle(title: string): string {
  return (title || "")
    .toLowerCase()
    .replace(/\$[\d,.]+[km]?/g, "$X")
    .replace(/[\d,.]+%/g, "N%")
    .replace(/\d+/g, "N")
    .replace(/\s+/g, " ")
    .trim();
}
