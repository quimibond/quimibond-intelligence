import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { agent_slug, run_all } = body as { agent_slug?: string; run_all?: boolean };

    if (run_all) {
      // Use orchestrator for run_all
      const origin = request.nextUrl.origin;
      const res = await fetch(`${origin}/api/agents/orchestrate`, { method: "POST" });
      const data = await res.json();
      return NextResponse.json(data);
    }

    if (!agent_slug) {
      return NextResponse.json({ error: "agent_slug required" }, { status: 400 });
    }

    // For single agent, also use orchestrator's runSingleAgent logic
    // Import dynamically to avoid circular deps
    const { runAgent } = await import("@/lib/agents/base-agent");
    const result = await runAgent(agent_slug, "manual");
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[api/agents/run]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
