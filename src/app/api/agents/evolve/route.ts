/**
 * Schema Evolution Agent — Self-improving database.
 *
 * Analyzes data quality issues and generates safe SQL to fix them.
 * Uses Claude to reason about what schema changes would help,
 * then executes them through execute_safe_ddl() which only allows:
 *   - CREATE TABLE IF NOT EXISTS
 *   - ALTER TABLE ADD COLUMN IF NOT EXISTS
 *   - CREATE INDEX
 *   - CREATE OR REPLACE FUNCTION
 *   - CREATE TRIGGER
 *   - INSERT / UPDATE WHERE
 *
 * NEVER: DROP, TRUNCATE, DELETE without WHERE, ALTER TYPE
 *
 * All changes logged in schema_changes table for full audit trail.
 * Runs after auto-fix, so it addresses structural issues that auto-fix can't.
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getServiceClient } from "@/lib/supabase-server";
import { callClaudeJSON, logTokenUsage } from "@/lib/claude";

export const maxDuration = 120;

export async function GET() {
  return POST();
}

export async function POST() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "ANTHROPIC_API_KEY not set" }, { status: 503 });  const supabase = getServiceClient();

  try {
    // ── 1. Gather current schema state ──────────────────────────────────

    // Get recent auto-fix results (what couldn't be fixed)
    const { data: recentFixes } = await supabase
      .from("pipeline_logs")
      .select("message, details")
      .eq("phase", "auto_fix")
      .order("created_at", { ascending: false })
      .limit(3);

    // Get data quality insights from the data_quality agent
    const { data: dataInsights } = await supabase
      .from("agent_insights")
      .select("title, description, recommendation")
      .eq("category", "data_quality")
      .in("state", ["new", "acted_on"])
      .order("created_at", { ascending: false })
      .limit(5);

    // Get current data quality metrics
    const checks = await Promise.all([
      supabase.from("emails").select("id", { count: "exact", head: true }).is("sender_contact_id", null),
      supabase.from("emails").select("id", { count: "exact", head: true }).is("company_id", null),
      supabase.from("emails").select("id", { count: "exact", head: true }),
      supabase.from("contacts").select("id", { count: "exact", head: true }).is("name", null),
      supabase.from("contacts").select("id", { count: "exact", head: true }),
      supabase.from("companies").select("id", { count: "exact", head: true }).is("entity_id", null),
      supabase.from("companies").select("id", { count: "exact", head: true }),
    ]);

    const metrics = {
      emails_no_contact: checks[0].count ?? 0,
      emails_no_company: checks[1].count ?? 0,
      emails_total: checks[2].count ?? 0,
      contacts_no_name: checks[3].count ?? 0,
      contacts_total: checks[4].count ?? 0,
      companies_no_entity: checks[5].count ?? 0,
      companies_total: checks[6].count ?? 0,
    };

    // Get recent schema changes to avoid repeating
    const { data: recentChanges } = await supabase
      .from("schema_changes")
      .select("description, success, created_at")
      .order("created_at", { ascending: false })
      .limit(10);

    // If no significant issues, skip
    const issueScore = metrics.emails_no_contact + metrics.contacts_no_name + metrics.companies_no_entity;
    if (issueScore < 10 && !dataInsights?.length) {
      return NextResponse.json({ success: true, message: "No significant issues to address", changes: 0 });
    }

    // ── 2. Ask Claude for solutions ─────────────────────────────────────

    const { result, usage } = await callClaudeJSON<{ changes: { description: string; sql: string; change_type: string }[] }>(
      apiKey,
      {
        model: "claude-sonnet-4-6",
        max_tokens: 2048,
        temperature: 0.1,
        system: `Eres un DBA experto para una plataforma de inteligencia comercial en Supabase (PostgreSQL + pgvector).

Tu trabajo es generar SQL SEGURO para mejorar la calidad de datos y el schema.

REGLAS ESTRICTAS:
- SOLO puedes usar: CREATE TABLE IF NOT EXISTS, ALTER TABLE ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS, CREATE OR REPLACE FUNCTION, CREATE TRIGGER, INSERT INTO, UPDATE ... WHERE
- NUNCA uses: DROP, TRUNCATE, DELETE sin WHERE, ALTER COLUMN TYPE
- Cada cambio debe ser idempotente (IF NOT EXISTS, OR REPLACE)
- No generes cambios que ya se hicieron (revisa cambios recientes)
- Prioriza: triggers automaticos > indexes > columnas nuevas > funciones
- Maximo 3 cambios por corrida

Responde con JSON: {"changes": [{"description": "...", "sql": "...", "change_type": "create_index|add_column|create_trigger|create_rpc|create_table"}]}
Si no hay cambios necesarios, responde: {"changes": []}`,
        messages: [{
          role: "user",
          content: `## Metricas actuales
${JSON.stringify(metrics, null, 2)}

## Problemas detectados por auto-fix
${JSON.stringify(recentFixes?.map(f => f.message) ?? [])}

## Insights del agente de datos
${JSON.stringify(dataInsights?.map(i => ({ title: i.title, recommendation: i.recommendation })) ?? [])}

## Cambios recientes (no repetir)
${JSON.stringify(recentChanges?.map(c => ({ description: c.description, success: c.success })) ?? [])}

Genera SQL seguro para mejorar la calidad de datos. Maximo 3 cambios.`,
        }],
      },
      "agent-evolve"
    );

    if (usage) {
      logTokenUsage("agent-evolve", "claude-sonnet-4-6", usage.input_tokens, usage.output_tokens);
    }

    const changes = result.changes ?? [];
    if (!changes.length) {
      return NextResponse.json({ success: true, message: "No changes needed", changes: 0 });
    }

    // ── 3. Execute safe changes ─────────────────────────────────────────

    const results: { description: string; success: boolean; error?: string }[] = [];

    for (const change of changes.slice(0, 3)) { // Max 3 per run
      const { data: execResult } = await supabase.rpc("execute_safe_ddl", {
        p_sql: change.sql,
        p_description: change.description,
        p_change_type: change.change_type ?? "auto",
      });

      const r = execResult as { success: boolean; error?: string } | null;
      results.push({
        description: change.description,
        success: r?.success ?? false,
        error: r?.error,
      });
    }

    const successCount = results.filter(r => r.success).length;

    // Log
    await supabase.from("pipeline_logs").insert({
      level: successCount > 0 ? "info" : "warning",
      phase: "schema_evolution",
      message: `Evolution: ${successCount}/${results.length} changes applied`,
      details: { results },
    });

    return NextResponse.json({
      success: true,
      changes_attempted: results.length,
      changes_applied: successCount,
      results,
    });
  } catch (err) {
    console.error("[evolve] Error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
