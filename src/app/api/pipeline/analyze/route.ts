import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { buildOdooContext, loadPersonProfiles } from "@/lib/pipeline/odoo-context";
import { analyzeAccountFull, formatEmailsForClaude } from "@/lib/pipeline/claude-pipeline";

export const maxDuration = 300; // 5 min for full analysis

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY no configurado." }, { status: 503 });
    }

    const supabase = getServiceClient();
    const start = Date.now();

    // Fetch recent emails (last 36h to cover timezone gaps)
    const cutoff = new Date(Date.now() - 36 * 3600_000).toISOString();
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

    // Save summaries
    if (summaries.length) {
      await supabase.from("email_analyses").upsert(
        summaries.map(s => ({
          account: s.account,
          analysis_date: today,
          summary_json: s,
        })),
        { onConflict: "account,analysis_date" }
      );
    }

    // Save KG entities and facts
    for (const [account, kg] of Object.entries(kgByAccount)) {
      // Save entities
      for (const ent of (kg.entities as Record<string, unknown>[]) ?? []) {
        const canonical = String(ent.name ?? "").toLowerCase().trim();
        if (!canonical) continue;
        await supabase
          .from("entities")
          .upsert({
            entity_type: ent.type ?? "person",
            name: ent.name,
            canonical_name: canonical,
            email: ent.email ?? null,
          }, { onConflict: "entity_type,canonical_name" });
      }

      // Save facts (batch)
      const facts = ((kg.facts as Record<string, unknown>[]) ?? [])
        .filter(f => f.entity_name && f.text)
        .map(f => ({
          fact_type: f.type ?? "information",
          fact_text: f.text,
          fact_date: f.date ?? null,
          confidence: f.confidence ?? 0.5,
          source_account: account,
        }));
      if (facts.length) {
        await supabase.from("facts").insert(facts);
      }
    }

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
