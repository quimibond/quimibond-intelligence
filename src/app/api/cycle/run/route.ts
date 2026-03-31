/**
 * Master Cycle Orchestrator — One endpoint to rule them all.
 *
 * Three cycle types:
 *
 * QUICK (every 30 min):
 *   1. Extract: analyze 1 email account
 *   2. Heal: auto-fix data links
 *   3. Validate: clean stale insights
 *
 * FULL (every 4 hours):
 *   1-3. Quick cycle first
 *   4. Think: run all AI agents → insights
 *   5. Learn: analyze feedback → memories
 *   6. Health: recalculate scores
 *
 * DAILY (6am):
 *   1-5. Full cycle first
 *   6. Evolve: schema improvements
 *   7. Brief: CEO morning briefing
 *
 * Usage:
 *   GET /api/cycle/run?type=quick  (default, for cron)
 *   GET /api/cycle/run?type=full
 *   GET /api/cycle/run?type=daily
 */
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 300;

type StepResult = { step: string; ok: boolean; data?: unknown; error?: string; ms: number };

async function runStep(origin: string, path: string, stepName: string): Promise<StepResult> {
  const start = Date.now();
  try {
    const res = await fetch(`${origin}${path}`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    return { step: stepName, ok: res.ok, data, ms: Date.now() - start };
  } catch (err) {
    return { step: stepName, ok: false, error: String(err), ms: Date.now() - start };
  }
}

export async function GET(request: NextRequest) {
  const cycleType = request.nextUrl.searchParams.get("type") ?? "quick";
  const origin = request.nextUrl.origin;
  const start = Date.now();
  const results: StepResult[] = [];

  // ── QUICK CYCLE (always runs) ─────────────────────────────────────
  // 1. Extract: process 1 email account
  results.push(await runStep(origin, "/api/pipeline/analyze", "extract"));

  // 2. Heal: auto-fix data
  results.push(await runStep(origin, "/api/agents/auto-fix", "heal"));

  // 3. Validate: clean stale insights
  results.push(await runStep(origin, "/api/agents/validate", "validate"));

  if (cycleType === "quick") {
    return NextResponse.json({
      cycle: "quick",
      steps: results.length,
      ok: results.filter(r => r.ok).length,
      failed: results.filter(r => !r.ok).length,
      elapsed_ms: Date.now() - start,
      results,
    });
  }

  // ── FULL CYCLE (adds intelligence) ────────────────────────────────
  // 4. Think: run all AI agents
  results.push(await runStep(origin, "/api/agents/orchestrate", "think"));

  // 5. Learn: feedback → memories
  results.push(await runStep(origin, "/api/agents/learn", "learn"));

  // 6. Health: recalculate scores
  results.push(await runStep(origin, "/api/pipeline/health-scores", "health"));

  if (cycleType === "full") {
    return NextResponse.json({
      cycle: "full",
      steps: results.length,
      ok: results.filter(r => r.ok).length,
      failed: results.filter(r => !r.ok).length,
      elapsed_ms: Date.now() - start,
      results,
    });
  }

  // ── DAILY CYCLE (adds evolution + briefing) ───────────────────────
  // 7. Evolve: schema improvements
  results.push(await runStep(origin, "/api/agents/evolve", "evolve"));

  // 8. Embeddings
  results.push(await runStep(origin, "/api/pipeline/embeddings", "embeddings"));

  // 9. Brief: CEO morning summary
  results.push(await runStep(origin, "/api/pipeline/briefing", "brief"));

  return NextResponse.json({
    cycle: "daily",
    steps: results.length,
    ok: results.filter(r => r.ok).length,
    failed: results.filter(r => !r.ok).length,
    elapsed_ms: Date.now() - start,
    results,
  });
}
