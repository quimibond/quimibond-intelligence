import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";

export const maxDuration = 30;

/**
 * POST /api/sync — Trigger Odoo sync via sync_commands table.
 *
 * Body: { command: "force_push" | "sync_contacts" }
 *
 * The command is written to sync_commands with status=pending.
 * Odoo's pull cron (every 5min) picks it up and executes it.
 * Frontend can poll the command status to see when it completes.
 */
export async function POST(request: NextRequest) {
  try {
    const { command } = await request.json();

    if (!command || typeof command !== "string") {
      return NextResponse.json({ error: "command is required" }, { status: 400 });
    }

    const validCommands = ["force_push", "sync_contacts"];
    if (!validCommands.includes(command)) {
      return NextResponse.json(
        { error: `Invalid command. Valid: ${validCommands.join(", ")}` },
        { status: 400 }
      );
    }

    const supabase = getServiceClient();

    const { data, error } = await supabase
      .from("sync_commands")
      .insert({
        command,
        status: "pending",
        requested_by: "frontend",
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      command_id: data.id,
      message: `Comando "${command}" enviado. Odoo lo ejecutará en los próximos 5 minutos.`,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Error al enviar comando" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/sync?id=<command_id> — Check status of a sync command.
 * GET /api/sync — Get recent sync commands.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  const supabase = getServiceClient();

  if (id) {
    const { data, error } = await supabase
      .from("sync_commands")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      return NextResponse.json({ error: "Command not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true, command: data });
  }

  // List recent commands
  const { data, error } = await supabase
    .from("sync_commands")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, commands: data });
}
