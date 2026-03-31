import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { buildOdooContext, loadPersonProfiles } from "@/lib/pipeline/odoo-context";
import { analyzeAccountFull, formatEmailsForClaude } from "@/lib/pipeline/claude-pipeline";

export async function GET() {
  const steps: string[] = [];
  try {
    const supabase = getServiceClient();

    // Step 1: Query emails
    steps.push("1-query");
    const { data: unprocessedEmails, error } = await supabase
      .from("emails")
      .select("id, account, sender, recipient, subject, body, snippet, email_date, sender_type")
      .eq("kg_processed", false)
      .gte("email_date", new Date(Date.now() - 14 * 86400_000).toISOString())
      .order("email_date", { ascending: false })
      .limit(300);

    if (error) return NextResponse.json({ step: "1-query", error: error.message, steps });
    steps.push(`1-ok: ${unprocessedEmails?.length} emails`);

    // Step 2: Pick account
    steps.push("2-pick-account");
    const accountCounts = new Map<string, number>();
    for (const e of unprocessedEmails ?? []) {
      const acct = e.account ?? "unknown";
      accountCounts.set(acct, (accountCounts.get(acct) ?? 0) + 1);
    }
    const sortedAccounts = [...accountCounts.entries()].sort((a, b) => b[1] - a[1]);
    const targetAccount = sortedAccounts[0]?.[0];
    if (!targetAccount) return NextResponse.json({ step: "2-no-account", steps });

    const accountEmails = (unprocessedEmails ?? [])
      .filter(e => (e.account ?? "unknown") === targetAccount)
      .slice(0, 50);
    steps.push(`2-ok: ${targetAccount} (${accountEmails.length} emails)`);

    // Step 3: Extract sender emails
    steps.push("3-senders");
    const senderEmails = [...new Set(
      accountEmails
        .filter(e => e.sender_type === "external")
        .map(e => {
          const match = (e.sender ?? "").match(/<([^>]+)>/);
          return (match ? match[1] : (e.sender ?? "")).trim().toLowerCase();
        })
        .filter(e => e.includes("@"))
    )];
    steps.push(`3-ok: ${senderEmails.length} senders`);

    // Step 4: Build context
    steps.push("4-context");
    const [odooCtx, personProfiles] = await Promise.all([
      buildOdooContext(supabase, senderEmails),
      loadPersonProfiles(supabase, senderEmails),
    ]);
    steps.push("4-ok");

    // Step 5: Format emails
    steps.push("5-format");
    const formatted = accountEmails.map(e => ({
      from_email: ((e.sender ?? "").match(/<([^>]+)>/) ?? [, e.sender ?? ""])[1]?.trim().toLowerCase() ?? "",
      to: e.recipient ?? "",
      subject: e.subject ?? "",
      date: e.email_date ?? "",
      sender_type: e.sender_type ?? "external",
      body: e.body ?? "",
      snippet: e.snippet ?? "",
    }));
    const emailText = formatEmailsForClaude(formatted, odooCtx, personProfiles);
    steps.push(`5-ok: ${emailText.length} chars`);

    // Step 6: Call Claude
    steps.push("6-claude");
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ step: "6-no-key", steps });

    const extCount = accountEmails.filter(e => e.sender_type === "external").length;
    const intCount = accountEmails.length - extCount;
    const dept = "Otro";

    const fullResult = await analyzeAccountFull(apiKey, dept, targetAccount, emailText, extCount, intCount);
    steps.push("6-ok");

    // Step 7: Mark as processed
    steps.push("7-mark");
    const ids = accountEmails.map(e => e.id);
    for (let i = 0; i < ids.length; i += 100) {
      await supabase.from("emails").update({ kg_processed: true }).in("id", ids.slice(i, i + 100));
    }
    steps.push(`7-ok: marked ${ids.length}`);

    const kg = fullResult.knowledge_graph ?? {};
    return NextResponse.json({
      success: true,
      account: targetAccount,
      emails: accountEmails.length,
      entities: (kg.entities ?? []).length,
      facts: (kg.facts ?? []).length,
      steps,
    });
  } catch (err) {
    const msg = err instanceof Error ? `${err.message}\n${err.stack}` : String(err);
    return NextResponse.json({ error: msg, last_step: steps[steps.length - 1], steps }, { status: 500 });
  }
}
