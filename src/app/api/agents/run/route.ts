import { NextRequest, NextResponse } from "next/server";
import { runAgent, runAllAgents } from "@/lib/agents/base-agent";

export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { agent_slug, run_all } = body as { agent_slug?: string; run_all?: boolean };

    if (run_all) {
      const results = await runAllAgents("manual");
      return NextResponse.json({ ok: true, results });
    }

    if (!agent_slug) {
      return NextResponse.json({ error: "agent_slug required" }, { status: 400 });
    }

    const result = await runAgent(agent_slug, "manual");
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[api/agents/run]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
