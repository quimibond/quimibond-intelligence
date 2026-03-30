import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { getServiceClient } from "@/lib/supabase-server";
import { buildOdooContext, loadPersonProfiles } from "@/lib/pipeline/odoo-context";
import { analyzeAccountFull, formatEmailsForClaude } from "@/lib/pipeline/claude-pipeline";
import { validatePipelineAuth } from "@/lib/pipeline/auth";

export const maxDuration = 300; // 5 min for full analysis

export async function POST(request: NextRequest) {
  const authError = validatePipelineAuth(request);
  if (authError) return authError;

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY no configurado." }, { status: 503 });
    }

    const supabase = getServiceClient();
    const start = Date.now();

    // Fetch recent emails (last 7 days — wider window for initial runs)
    const cutoff = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
    const { data: recentEmails } = await supabase
      .from("emails")
      .select("*")
      .gte("email_date", cutoff)
      .order("email_date", { ascending: false })
      .limit(500);

    if (!recentEmails?.length) {
      return NextResponse.json({ success: true, message: "Sin emails recientes", emails: 0 });
    }

    // Group by account
    const byAccount = new Map<string, typeof recentEmails>();
    for (const e of recentEmails) {
      const acct = e.account ?? "unknown";
      if (!byAccount.has(acct)) byAccount.set(acct, []);
      byAccount.get(acct)!.push(e);
    }

    // Top 8 accounts by email count
    const sortedAccounts = [...byAccount.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 8)
      .filter(([, emails]) => emails.length >= 2);

    // Build Odoo context from Supabase
    const allSenderEmails = [...new Set(
      recentEmails
        .filter(e => e.sender_type === "external")
        .map(e => {
          const match = (e.sender ?? "").match(/<([^>]+)>/);
          return match ? match[1].toLowerCase() : (e.sender ?? "").toLowerCase();
        })
        .filter(e => e.includes("@"))
    )];

    const [odooCtx, personProfiles] = await Promise.all([
      buildOdooContext(supabase, allSenderEmails),
      loadPersonProfiles(supabase, allSenderEmails),
    ]);

    // Load team members for action item assignment
    const { data: teamMembers } = await supabase
      .from("odoo_users")
      .select("name, email, department, job_title");

    // Analyze accounts in parallel (max 3 concurrent)
    const today = new Date().toISOString().split("T")[0];
    const summaries: Record<string, unknown>[] = [];
    const kgByAccount: Record<string, Record<string, unknown>> = {};
    const pendingProfiles: { account: string; profiles: Record<string, unknown>[] }[] = [];
    let accountsOk = 0;
    let accountsFailed = 0;

    // Process in chunks of 3 for rate limiting
    const accountChunks = chunkArray(sortedAccounts, 3);

    for (const chunk of accountChunks) {
      const results = await Promise.allSettled(
        chunk.map(async ([account, emails]) => {
          const extCount = emails.filter(e => e.sender_type === "external").length;
          const intCount = emails.length - extCount;

          // Format emails with Odoo context
          const formatted = emails.map(e => ({
            from_email: extractEmail(e.sender ?? ""),
            to: e.recipient ?? "",
            subject: e.subject ?? "",
            date: e.email_date ?? "",
            sender_type: e.sender_type ?? "external",
            body: e.body ?? "",
            snippet: e.snippet ?? "",
          }));

          const emailText = formatEmailsForClaude(
            formatted, odooCtx, personProfiles
          );

          const dept = emails[0]?.department ?? "Otro";
          const fullResult = await analyzeAccountFull(
            apiKey, dept, account, emailText, extCount, intCount
          );

          return { account, dept, emailCount: emails.length, fullResult };
        })
      );

      for (const r of results) {
        if (r.status === "fulfilled") {
          const { account, dept, emailCount, fullResult } = r.value;
          const summary = fullResult.summary;
          summary.account = account;
          summary.department = dept;
          summary.total_emails = emailCount;
          summaries.push(summary);

          if (fullResult.knowledge_graph?.entities?.length) {
            kgByAccount[account] = fullResult.knowledge_graph;
          }

          // Collect person profiles for batch save
          const profiles = fullResult.knowledge_graph?.person_profiles ?? [];
          if (profiles.length) {
            pendingProfiles.push({ account, profiles });
          }

          accountsOk++;
        } else {
          accountsFailed++;
          console.error("[analyze] Account failed:", r.reason);
        }
      }
    }

    // Save KG entities and facts
    let totalEntitiesSaved = 0;
    let totalFactsSaved = 0;
    let totalFactsSkipped = 0;
    for (const [account, kg] of Object.entries(kgByAccount)) {
      const kgEntities = (kg.entities as Record<string, unknown>[]) ?? [];
      const kgFacts = (kg.facts as Record<string, unknown>[]) ?? [];
      console.log(`[analyze] KG for ${account}: ${kgEntities.length} entities, ${kgFacts.length} facts from Claude`);

      // Save entities and build name→id map for fact linking
      const entityMap: Record<string, number> = {};
      for (const ent of kgEntities) {
        const canonical = String(ent.name ?? "").toLowerCase().trim();
        if (!canonical) continue;
        const { data, error } = await supabase
          .from("entities")
          .upsert({
            entity_type: ent.type ?? "person",
            name: ent.name,
            canonical_name: canonical,
            email: ent.email ?? null,
          }, { onConflict: "entity_type,canonical_name" })
          .select("id");
        if (error) {
          console.error(`[analyze] Entity upsert error for "${ent.name}":`, error.message);
        }
        if (data?.[0]?.id) {
          entityMap[String(ent.name)] = data[0].id;
          totalEntitiesSaved++;
        }
      }

      // Save facts (batch) — resolve entity_name to entity_id
      const facts: Record<string, unknown>[] = [];
      for (const f of kgFacts) {
        if (!f.entity_name || !f.text) continue;
        let entityId = entityMap[String(f.entity_name)];
        if (!entityId) {
          // Fallback: lookup by canonical_name
          const { data } = await supabase
            .from("entities")
            .select("id")
            .eq("canonical_name", String(f.entity_name).toLowerCase().trim())
            .limit(1);
          if (data?.[0]?.id) entityId = data[0].id;
        }
        if (!entityId) {
          totalFactsSkipped++;
          console.log(`[analyze] Fact skipped — no entity for "${f.entity_name}"`);
          continue;
        }

        const raw = `${entityId}|${f.type ?? "information"}|${f.text}`;
        const factHash = hashMD5(raw);
        facts.push({
          entity_id: entityId,
          fact_type: f.type ?? "information",
          fact_text: f.text,
          fact_hash: factHash,
          fact_date: f.date ?? null,
          is_future: f.is_future ?? false,
          confidence: f.confidence ?? 0.5,
          source_type: "email",
          source_account: account,
        });
      }
      if (facts.length) {
        const { error } = await supabase.from("facts").upsert(facts, { onConflict: "fact_hash", ignoreDuplicates: true });
        if (error) {
          console.error(`[analyze] Facts upsert error for ${account}:`, error.message);
        } else {
          totalFactsSaved += facts.length;
          console.log(`[analyze] Saved ${facts.length} facts for ${account}`);
        }
      }
    }
    console.log(`[analyze] KG totals: ${totalEntitiesSaved} entities, ${totalFactsSaved} facts saved, ${totalFactsSkipped} facts skipped`);

    // Save person profiles (batch update contacts)
    for (const { profiles } of pendingProfiles) {
      for (const p of profiles) {
        const email = String(p.email ?? "").toLowerCase();
        if (!email) continue;
        await supabase
          .from("contacts")
          .update({
            role: p.role ?? undefined,
            decision_power: p.decision_power ?? undefined,
            communication_style: p.communication_style ?? undefined,
            personality_notes: p.personality_notes ?? undefined,
          })
          .eq("email", email);
      }
    }

    // Log pipeline run
    await supabase.from("pipeline_logs").insert({
      level: "info",
      phase: "emails_analyzed",
      message: `analyze: ${recentEmails.length} emails, ${summaries.length} summaries`,
      details: {
        emails: recentEmails.length,
        summaries: summaries.length,
        accounts_ok: accountsOk,
        accounts_failed: accountsFailed,
        elapsed_s: Math.round((Date.now() - start) / 1000),
      },
    });

    return NextResponse.json({
      success: true,
      emails: recentEmails.length,
      summaries: summaries.length,
      accounts_ok: accountsOk,
      accounts_failed: accountsFailed,
      kg: { entities: totalEntitiesSaved, facts: totalFactsSaved, facts_skipped: totalFactsSkipped },
      elapsed_s: Math.round((Date.now() - start) / 1000),
    });
  } catch (err) {
    console.error("[analyze] Error:", err);
    return NextResponse.json(
      { error: "Error en análisis.", detail: String(err) },
      { status: 500 }
    );
  }
}

function extractEmail(raw: string): string {
  const match = raw.match(/<([^>]+)>/);
  return (match ? match[1] : raw).trim().toLowerCase();
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

function hashMD5(input: string): string {
  return createHash("md5").update(input).digest("hex");
}
