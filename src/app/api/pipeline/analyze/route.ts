/**
 * Pipeline Analyze — Incremental email analysis with Claude.
 *
 * NEW ARCHITECTURE: Process ONE account per invocation.
 * - Finds the account with the most UNPROCESSED emails
 * - Analyzes only that account's emails (1 Claude call, ~30-40s)
 * - Writes KG entities, facts, alerts, actions, profiles IMMEDIATELY
 * - Marks those emails as kg_processed
 * - Returns in ~60s (well within 300s timeout)
 *
 * Vercel Cron calls this every 15 min. Over time, all accounts get processed.
 * Multiple manual triggers process accounts one by one.
 */
import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { getServiceClient } from "@/lib/supabase-server";
import { buildOdooContext, loadPersonProfiles } from "@/lib/pipeline/odoo-context";
import { analyzeAccountFull, formatEmailsForClaude } from "@/lib/pipeline/claude-pipeline";
import { validatePipelineAuth } from "@/lib/pipeline/auth";

export const maxDuration = 300;

// Vercel Crons use GET
export async function GET(request: NextRequest) {
  return POST(request);
}

export async function POST(request: NextRequest) {
  const authError = validatePipelineAuth(request);
  if (authError) return authError;

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.error("[analyze] ANTHROPIC_API_KEY not set");
      return NextResponse.json({ error: "ANTHROPIC_API_KEY no configurado." }, { status: 503 });
    }

    const supabase = getServiceClient();
    const start = Date.now();

    // ── Step 1: Find unprocessed emails ──────────────────────────────────
    const cutoff = new Date(Date.now() - 14 * 24 * 3600_000).toISOString(); // 14 days window
    console.log(`[analyze] Looking for unprocessed emails since ${cutoff}`);

    const { data: unprocessedEmails, error: queryError } = await supabase
      .from("emails")
      .select("id, account, sender, recipient, subject, body, snippet, email_date, sender_type, department")
      .eq("kg_processed", false)
      .gte("email_date", cutoff)
      .order("email_date", { ascending: false })
      .limit(300); // Fetch more to find best account, but only process one

    if (queryError) {
      console.error("[analyze] Query error:", queryError.message);
      return NextResponse.json({ error: "Query failed", detail: queryError.message }, { status: 500 });
    }

    console.log(`[analyze] Found ${unprocessedEmails?.length ?? 0} unprocessed emails`);

    if (!unprocessedEmails?.length) {
      return NextResponse.json({
        success: true,
        message: "Sin emails pendientes de analisis",
        emails: 0,
        all_processed: true,
      });
    }

    // ── Step 2: Pick the account with most unprocessed emails ─────────────
    const accountCounts = new Map<string, number>();
    for (const e of unprocessedEmails) {
      const acct = e.account ?? "unknown";
      accountCounts.set(acct, (accountCounts.get(acct) ?? 0) + 1);
    }

    // Sort by count, pick the top account
    const sortedAccounts = [...accountCounts.entries()].sort((a, b) => b[1] - a[1]);
    const targetAccount = sortedAccounts[0][0];

    // Get emails for this account only (max 50 per run)
    const accountEmails = unprocessedEmails
      .filter(e => (e.account ?? "unknown") === targetAccount)
      .slice(0, 50);

    if (accountEmails.length < 2) {
      // Mark single emails as processed (not enough for meaningful analysis)
      if (accountEmails.length === 1) {
        await supabase.from("emails").update({ kg_processed: true }).eq("id", accountEmails[0].id);
      }
      return NextResponse.json({
        success: true,
        message: `Cuenta ${targetAccount}: solo ${accountEmails.length} email(s), saltando`,
        emails: accountEmails.length,
        account: targetAccount,
        remaining_accounts: sortedAccounts.length - 1,
      });
    }

    console.log(`[analyze] Processing account ${targetAccount}: ${accountEmails.length} emails (${sortedAccounts.length} accounts pending)`);

    // ── Step 3: Build context ────────────────────────────────────────────
    const senderEmails = [...new Set(
      accountEmails
        .filter(e => e.sender_type === "external")
        .map(e => extractEmail(e.sender ?? ""))
        .filter(e => e.includes("@"))
    )];

    const [odooCtx, personProfiles, teamMembers] = await Promise.all([
      buildOdooContext(supabase, senderEmails),
      loadPersonProfiles(supabase, senderEmails),
      supabase.from("odoo_users").select("name, email, department, job_title"),
    ]);

    // ── Step 4: Call Claude (single call for this account) ───────────────
    const extCount = accountEmails.filter(e => e.sender_type === "external").length;
    const intCount = accountEmails.length - extCount;

    const formatted = accountEmails.map(e => ({
      from_email: extractEmail(e.sender ?? ""),
      to: e.recipient ?? "",
      subject: e.subject ?? "",
      date: e.email_date ?? "",
      sender_type: e.sender_type ?? "external",
      body: e.body ?? "",
      snippet: e.snippet ?? "",
    }));

    const emailText = formatEmailsForClaude(formatted, odooCtx, personProfiles);
    const dept = accountEmails[0]?.department ?? "Otro";

    let fullResult;
    try {
      fullResult = await analyzeAccountFull(apiKey, dept, targetAccount, emailText, extCount, intCount);
    } catch (claudeErr) {
      console.error(`[analyze] Claude failed for ${targetAccount}:`, claudeErr);
      // Mark emails as processed anyway to avoid infinite retry
      await markProcessed(supabase, accountEmails.map(e => e.id));
      return NextResponse.json({
        success: false,
        error: `Claude analysis failed for ${targetAccount}`,
        detail: String(claudeErr),
        emails_marked: accountEmails.length,
      }, { status: 500 });
    }

    // ── Step 5: Write results IMMEDIATELY ────────────────────────────────
    const summary = fullResult.summary ?? {};
    const kg = fullResult.knowledge_graph ?? { entities: [], facts: [], action_items: [], relationships: [], person_profiles: [] };

    // 5a. Save KG entities
    let entitiesSaved = 0;
    const entityMap: Record<string, number> = {};

    for (const ent of (kg.entities ?? [])) {
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
      if (!error && data?.[0]?.id) {
        entityMap[String(ent.name)] = data[0].id;
        entitiesSaved++;
      }
    }

    // 5b. Save facts
    let factsSaved = 0;
    const facts: Record<string, unknown>[] = [];
    for (const f of (kg.facts ?? [])) {
      if (!f.entity_name || !f.text) continue;
      let entityId = entityMap[String(f.entity_name)];
      if (!entityId) {
        const { data } = await supabase
          .from("entities")
          .select("id")
          .eq("canonical_name", String(f.entity_name).toLowerCase().trim())
          .limit(1);
        if (data?.[0]?.id) entityId = data[0].id;
      }
      if (!entityId) continue;

      facts.push({
        entity_id: entityId,
        fact_type: f.type ?? "information",
        fact_text: f.text,
        fact_hash: hashMD5(`${entityId}|${f.type ?? "information"}|${f.text}`),
        fact_date: f.date ?? null,
        is_future: f.is_future ?? false,
        confidence: f.confidence ?? 0.5,
        source_type: "email",
        source_account: targetAccount,
      });
    }
    if (facts.length) {
      const { error } = await supabase.from("facts").upsert(facts, { onConflict: "fact_hash", ignoreDuplicates: true });
      if (!error) factsSaved = facts.length;
    }

    // 5c. Generate alerts from risks
    let alertsGenerated = 0;
    const risks = (summary.risks_detected as { risk: string; severity: string }[]) ?? [];
    for (const risk of risks) {
      if (!risk.risk) continue;
      const { error } = await supabase.from("alerts").insert({
        alert_type: "risk_detected",
        severity: risk.severity ?? "medium",
        title: risk.risk.slice(0, 200),
        description: risk.risk,
        state: "new",
        account: targetAccount,
        suggested_action: `Revisar: ${risk.risk.slice(0, 100)}`,
      });
      if (!error) alertsGenerated++;
    }

    // 5d. Generate alerts from waiting_response
    const waiting = (summary.waiting_response as { contact: string; subject: string; hours_waiting: number }[]) ?? [];
    for (const w of waiting) {
      if (!w.contact || w.hours_waiting < 24) continue;
      const { error } = await supabase.from("alerts").insert({
        alert_type: "no_response",
        severity: w.hours_waiting > 72 ? "high" : w.hours_waiting > 48 ? "medium" : "low",
        title: `Sin respuesta de ${w.contact}: ${w.subject ?? ""}`.slice(0, 200),
        description: `${w.contact} no ha respondido en ${Math.round(w.hours_waiting)}h sobre: ${w.subject}`,
        state: "new",
        account: targetAccount,
        contact_name: w.contact,
        suggested_action: `Dar seguimiento a ${w.contact} sobre ${w.subject}`,
      });
      if (!error) alertsGenerated++;
    }

    // 5e. Generate action items
    let actionsGenerated = 0;
    const actionItems = (kg.action_items ?? summary.action_items ?? []) as Record<string, string>[];
    for (const item of actionItems) {
      if (!item.description) continue;
      let assigneeEmail: string | null = null;
      let assigneeName: string | null = null;
      if (item.assignee && teamMembers.data) {
        const match = teamMembers.data.find(
          m => m.name?.toLowerCase().includes(item.assignee.toLowerCase())
            || m.email?.toLowerCase().includes(item.assignee.toLowerCase())
        );
        if (match) { assigneeEmail = match.email; assigneeName = match.name; }
      }
      const { error } = await supabase.from("action_items").insert({
        action_type: item.type ?? "follow_up",
        description: item.description,
        reason: `Detectado en analisis de ${targetAccount}`,
        priority: item.priority ?? "medium",
        contact_name: item.related_to ?? null,
        assignee_email: assigneeEmail,
        assignee_name: assigneeName,
        due_date: item.due_date ?? null,
        state: "pending",
      });
      if (!error) actionsGenerated++;
    }

    // 5f. Update person profiles on contacts
    for (const p of (kg.person_profiles ?? [])) {
      const email = String(p.email ?? "").toLowerCase();
      if (!email) continue;
      await supabase.from("contacts").update({
        role: p.role ?? undefined,
        decision_power: p.decision_power ?? undefined,
        communication_style: p.communication_style ?? undefined,
        personality_notes: p.personality_notes ?? undefined,
      }).eq("email", email);
    }

    // ── Step 6: Mark emails as processed ─────────────────────────────────
    await markProcessed(supabase, accountEmails.map(e => e.id));

    // ── Step 7: Log ──────────────────────────────────────────────────────
    const elapsed = Math.round((Date.now() - start) / 1000);
    await supabase.from("pipeline_logs").insert({
      level: "info",
      phase: "emails_analyzed",
      message: `analyze: ${targetAccount} — ${accountEmails.length} emails`,
      details: {
        account: targetAccount,
        emails: accountEmails.length,
        entities: entitiesSaved,
        facts: factsSaved,
        alerts: alertsGenerated,
        actions: actionsGenerated,
        elapsed_s: elapsed,
        remaining_accounts: sortedAccounts.length - 1,
      },
    });

    console.log(`[analyze] Done: ${targetAccount} — ${accountEmails.length} emails, ${entitiesSaved} entities, ${factsSaved} facts, ${alertsGenerated} alerts, ${actionsGenerated} actions in ${elapsed}s`);

    return NextResponse.json({
      success: true,
      account: targetAccount,
      emails: accountEmails.length,
      entities: entitiesSaved,
      facts: factsSaved,
      alerts_generated: alertsGenerated,
      actions_generated: actionsGenerated,
      elapsed_s: elapsed,
      remaining_accounts: sortedAccounts.length - 1,
      remaining_emails: unprocessedEmails.length - accountEmails.length,
    });
  } catch (err) {
    console.error("[analyze] Error:", err);
    return NextResponse.json(
      { error: "Error en analisis.", detail: String(err) },
      { status: 500 }
    );
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

async function markProcessed(supabase: ReturnType<typeof getServiceClient>, ids: number[]) {
  for (let i = 0; i < ids.length; i += 100) {
    await supabase.from("emails").update({ kg_processed: true }).in("id", ids.slice(i, i + 100));
  }
}

function extractEmail(raw: string): string {
  const match = raw.match(/<([^>]+)>/);
  return (match ? match[1] : raw).trim().toLowerCase();
}

function hashMD5(input: string): string {
  return createHash("md5").update(input).digest("hex");
}
