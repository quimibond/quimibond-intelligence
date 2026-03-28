/**
 * Pipeline Trigger — Orchestrates the full intelligence pipeline.
 * Replaces Odoo's 12 cron jobs with a single API endpoint.
 *
 * Usage:
 *   POST /api/pipeline/trigger
 *   Body: { "steps": ["sync-emails", "analyze", "embeddings", "briefing"] }
 *   Or: { "steps": ["all"] } to run everything
 *
 * Can be called by: Vercel Cron, GitHub Actions, manual trigger from UI.
 */
import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 300; // 5 min (Vercel hobby plan limit)

interface StepResult {
  step: string;
  success: boolean;
  elapsed_ms: number;
  data?: Record<string, unknown>;
  error?: string;
}

const VALID_STEPS = ["sync-emails", "analyze", "embeddings", "briefing"] as const;
type PipelineStep = typeof VALID_STEPS[number];

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    let steps: PipelineStep[] = body.steps ?? ["all"];

    if (steps.includes("all" as PipelineStep)) {
      steps = [...VALID_STEPS];
    }

    // Validate steps
    for (const step of steps) {
      if (!VALID_STEPS.includes(step)) {
        return NextResponse.json(
          { error: `Step inválido: ${step}. Válidos: ${VALID_STEPS.join(", ")}` },
          { status: 400 }
        );
      }
    }

    const origin = request.headers.get("origin") ?? request.nextUrl.origin;
    const results: StepResult[] = [];
    const pipelineStart = Date.now();

    // Execute steps sequentially (each depends on previous)
    for (const step of steps) {
      const stepStart = Date.now();
      try {
        const res = await fetch(`${origin}/api/pipeline/${step}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });

        const data = await res.json().catch(() => ({}));

        results.push({
          step,
          success: res.ok,
          elapsed_ms: Date.now() - stepStart,
          data: res.ok ? data : undefined,
          error: res.ok ? undefined : (data.error ?? `HTTP ${res.status}`),
        });

        if (!res.ok) {
          console.error(`[trigger] Step "${step}" failed:`, data);
          // Continue with next steps even if one fails
        }
      } catch (err) {
        results.push({
          step,
          success: false,
          elapsed_ms: Date.now() - stepStart,
          error: String(err),
        });
        console.error(`[trigger] Step "${step}" error:`, err);
      }
    }

    const allOk = results.every(r => r.success);

    return NextResponse.json({
      success: allOk,
      total_elapsed_ms: Date.now() - pipelineStart,
      steps: results,
    });
  } catch (err) {
    console.error("[trigger] Error:", err);
    return NextResponse.json(
      { error: "Error en pipeline trigger.", detail: String(err) },
      { status: 500 }
    );
  }
}
