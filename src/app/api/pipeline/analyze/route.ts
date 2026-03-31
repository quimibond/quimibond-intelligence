/**
 * Pipeline Analyze v3 — DATA EXTRACTION ONLY.
 *
 * This pipeline DOES NOT create alerts or actions.
 * It only extracts intelligence data from emails:
 * - Knowledge Graph entities + facts
 * - Person profiles (role, communication style)
 * - Email summaries for agent consumption
 *
 * The AI Agents are responsible for:
 * - Evaluating extracted data + Odoo data + history
 * - Generating curated insights with confidence scores
 * - Only high-confidence insights reach the CEO's inbox
 *
 * Architecture: Pipeline → Raw Data → Agents → Curated Insights → CEO
 */
import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { getServiceClient } from "@/lib/supabase-server";
import { buildOdooContext, loadPersonProfiles } from "@/lib/pipeline/odoo-context";
import { analyzeAccountFull, formatEmailsForClaude } from "@/lib/pipeline/claude-pipeline";
import { validatePipelineAuth } from "@/lib/pipeline/auth";

export const maxDuration = 300;

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
    const cutoff = new Date(Date.now() - 14 * 24 * 3600_000).toISOString();
    console.log(`[analyze] Looking for unprocessed emails since ${cutoff}`);

    const { data: unprocessedEmails, error: queryError } = await supabase
      .from("emails")
      .select("id, account, sender, recipient, subject, body, snippet, email_date, sender_type")
      .eq("kg_processed", false)
      .gte("email_date", cutoff)
      .order("email_date", { ascending: false })
      .limit(300);

    if (queryError) {
      console.error("[analyze] Query error:", queryError.message);
      return NextResponse.json({ error: "Query failed", detail: queryError.message }, { status: 500 });
    }

    console.log(`[analyze] Found ${unprocessedEmails?.length ?? 0} unprocessed emails`);

    if (!unprocessedEmails?.length) {
      return NextResponse.json({ success: true, message: "Sin emails pendientes", emails: 0, all_processed: true });
    }

    // ── Step 2: Pick ONE account ─────────────────────────────────────────
    const accountCounts = new Map<string, number>();
    for (const e of unprocessedEmails) {
      const acct = e.account ?? "unknown";
      accountCounts.set(acct, (accountCounts.get(acct) ?? 0) + 1);
    }
    const sortedAccounts = [...accountCounts.entries()].sort((a, b) => b[1] - a[1]);
    const targetAccount = sortedAccounts[0][0];

    const accountEmails = unprocessedEmails
      .filter(e => (e.account ?? "unknown") === targetAccount)
      .slice(0, 50);

    if (accountEmails.length < 2) {
      if (accountEmails.length === 1) {
        await supabase.from("emails").update({ kg_processed: true }).eq("id", accountEmails[0].id);
      }
      return NextResponse.json({ success: true, message: `${targetAccount}: solo ${accountEmails.length} email(s)`, emails: accountEmails.length });
    }

    console.log(`[analyze] Processing ${targetAccount}: ${accountEmails.length} emails`);

    // ── Step 3: Build context ────────────────────────────────────────────
    let odooCtx, personProfiles;
    try {
      const senderEmails = [...new Set(
        accountEmails
          .filter(e => e.sender_type === "external")
          .map(e => extractEmail(e.sender ?? ""))
          .filter(e => e.includes("@"))
      )];
      console.log(`[analyze] Building context for ${senderEmails.length} senders`);

      [odooCtx, personProfiles] = await Promise.all([
        buildOdooContext(supabase, senderEmails),
        loadPersonProfiles(supabase, senderEmails),
      ]);
      console.log(`[analyze] Context built OK`);
    } catch (ctxErr) {
      console.error(`[analyze] Context build failed:`, ctxErr);
      await markProcessed(supabase, accountEmails.map(e => e.id));
      return NextResponse.json({ error: "Context build failed", detail: String(ctxErr) }, { status: 500 });
    }

    // ── Step 4: Call Claude ──────────────────────────────────────────────
    console.log(`[analyze] Calling Claude for ${targetAccount}`);
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
    const dept = "Otro"; // department not stored on emails table

    let fullResult;
    try {
      fullResult = await analyzeAccountFull(apiKey, dept, targetAccount, emailText, extCount, intCount);
      console.log(`[analyze] Claude responded OK`);
    } catch (claudeErr) {
      console.error(`[analyze] Claude failed:`, claudeErr);
      await markProcessed(supabase, accountEmails.map(e => e.id));
      return NextResponse.json({ error: "Claude failed", detail: String(claudeErr) }, { status: 500 });
    }

    // ── Step 5: Extract and save DATA ONLY (no alerts, no actions) ───────
    const kg = fullResult.knowledge_graph ?? { entities: [], facts: [], relationships: [], person_profiles: [] };

    // 5a. Save entities
    let entitiesSaved = 0;
    const entityMap: Record<string, number> = {};
    for (const ent of (kg.entities ?? [])) {
      const canonical = String(ent.name ?? "").toLowerCase().trim();
      if (!canonical) continue;
      const { data } = await supabase
        .from("entities")
        .upsert({ entity_type: ent.type ?? "person", name: ent.name, canonical_name: canonical, email: ent.email ?? null },
          { onConflict: "entity_type,canonical_name" })
        .select("id");
      if (data?.[0]?.id) { entityMap[String(ent.name)] = data[0].id; entitiesSaved++; }
    }

    // 5b. Save facts
    let factsSaved = 0;
    const facts: Record<string, unknown>[] = [];
    for (const f of (kg.facts ?? [])) {
      if (!f.entity_name || !f.text) continue;
      let entityId = entityMap[String(f.entity_name)];
      if (!entityId) {
        const { data } = await supabase.from("entities").select("id")
          .eq("canonical_name", String(f.entity_name).toLowerCase().trim()).limit(1);
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

    // 5c. Save relationships
    let relationshipsSaved = 0;
    for (const rel of (kg.relationships ?? [])) {
      if (!rel.entity_a || !rel.entity_b) continue;
      const aId = entityMap[String(rel.entity_a)];
      const bId = entityMap[String(rel.entity_b)];
      if (aId && bId) {
        await supabase.from("entity_relationships").upsert({
          entity_a_id: aId, entity_b_id: bId,
          relationship_type: rel.type ?? "mentioned_with",
          context: rel.context ?? null,
        }, { onConflict: "entity_a_id,entity_b_id,relationship_type" });
        relationshipsSaved++;
      }
    }

    // 5d. Update person profiles
    let profilesUpdated = 0;
    for (const p of (kg.person_profiles ?? [])) {
      const email = String(p.email ?? "").toLowerCase();
      if (!email) continue;
      const updates: Record<string, unknown> = {};
      if (p.role) updates.role = p.role;
      if (p.decision_power) updates.decision_power = p.decision_power;
      if (p.communication_style) updates.communication_style = p.communication_style;
      if (p.personality_notes) updates.personality_notes = p.personality_notes;
      if (Object.keys(updates).length) {
        await supabase.from("contacts").update(updates).eq("email", email);
        profilesUpdated++;
      }
    }

    // 5e. Save account summary for agent consumption
    const summary = fullResult.summary ?? {};
    await supabase.from("pipeline_logs").insert({
      level: "info",
      phase: "account_analysis",
      message: `${targetAccount}: ${accountEmails.length} emails analyzed`,
      details: {
        account: targetAccount,
        emails: accountEmails.length,
        summary_text: summary.summary_text ?? null,
        sentiment: summary.overall_sentiment ?? null,
        sentiment_score: summary.sentiment_score ?? null,
        topics: summary.topics_detected ?? [],
        risks_raw: summary.risks_detected ?? [],
        waiting_response: summary.waiting_response ?? [],
        external_contacts: summary.external_contacts ?? [],
        entities: entitiesSaved,
        facts: factsSaved,
        relationships: relationshipsSaved,
        profiles: profilesUpdated,
        elapsed_s: Math.round((Date.now() - start) / 1000),
      },
    });

    // ── Step 6: Mark emails as processed ─────────────────────────────────
    await markProcessed(supabase, accountEmails.map(e => e.id));

    const elapsed = Math.round((Date.now() - start) / 1000);
    console.log(`[analyze] Done: ${targetAccount} — ${entitiesSaved} entities, ${factsSaved} facts, ${profilesUpdated} profiles in ${elapsed}s`);

    return NextResponse.json({
      success: true,
      account: targetAccount,
      emails: accountEmails.length,
      data_extracted: { entities: entitiesSaved, facts: factsSaved, relationships: relationshipsSaved, profiles: profilesUpdated },
      elapsed_s: elapsed,
      remaining_accounts: sortedAccounts.length - 1,
    });
  } catch (err) {
    const errMsg = err instanceof Error ? `${err.message}\n${err.stack}` : String(err);
    console.error("[analyze] FATAL:", errMsg);
    // Write error to DB so we can see it
    try {
      const supabase = getServiceClient();
      await supabase.from("pipeline_logs").insert({
        level: "error", phase: "analyze_error",
        message: errMsg.slice(0, 500),
        details: { full_error: errMsg, timestamp: new Date().toISOString() },
      });
    } catch { /* ignore logging errors */ }
    return NextResponse.json({ error: "Error en analisis.", detail: errMsg.slice(0, 300) }, { status: 500 });
  }
}

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
