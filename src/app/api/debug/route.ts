import { NextRequest, NextResponse } from "next/server";
import { validatePipelineAuth } from "@/lib/pipeline/auth";

export async function GET(_request: NextRequest) {
  // Temporarily open for diagnostics — will be removed after debugging

  const vars = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_KEY",
    "SUPABASE_SECRET_KEY",
    "POSTGRES_HOST",
    "ANTHROPIC_API_KEY",
    "GOOGLE_SERVICE_ACCOUNT_JSON",
    "GMAIL_ACCOUNTS_JSON",
    "VOYAGE_API_KEY",
    "CRON_SECRET",
    "AUTH_PASSWORD",
  ];

  const status: Record<string, string> = {};
  for (const v of vars) {
    const val = process.env[v];
    if (!val) {
      status[v] = "MISSING";
    } else if (v === "GMAIL_ACCOUNTS_JSON") {
      try {
        const parsed = JSON.parse(val);
        if (Array.isArray(parsed)) {
          status[v] = `OK array (${parsed.length} accounts, first: ${JSON.stringify(parsed[0])})`;
        } else if (typeof parsed === "object") {
          const keys = Object.keys(parsed).slice(0, 5);
          status[v] = `OBJECT not array (keys: ${keys.join(", ")}). Sample: ${JSON.stringify(parsed).substring(0, 200)}`;
        } else {
          status[v] = `unexpected type: ${typeof parsed}`;
        }
      } catch {
        status[v] = `INVALID JSON (${val.substring(0, 80)}...)`;
      }
    } else if (v === "GOOGLE_SERVICE_ACCOUNT_JSON") {
      try {
        const parsed = JSON.parse(val);
        status[v] = `OK (${parsed.client_email ?? "no client_email"})`;
      } catch {
        status[v] = `INVALID JSON (${val.substring(0, 30)}...)`;
      }
    } else {
      status[v] = `OK (${val.substring(0, 8)}...)`;
    }
  }

  return NextResponse.json({ env: status });
}
