import { NextRequest, NextResponse } from "next/server";

/**
 * Validates auth for pipeline endpoints.
 * Accepts either:
 * 1. Authorization: Bearer <CRON_SECRET> (for cron jobs / external callers)
 * 2. qb-auth cookie matching AUTH_PASSWORD (for UI calls from logged-in users)
 * Returns null if authorized, or a 401 NextResponse if not.
 */
export function validatePipelineAuth(request: NextRequest): NextResponse | null {
  const cronSecret = process.env.CRON_SECRET;
  const authPassword = process.env.AUTH_PASSWORD;

  // No secrets configured = open (dev mode)
  if (!cronSecret && !authPassword) return null;

  // Check Bearer token (cron jobs)
  const auth = request.headers.get("authorization");
  if (cronSecret && auth === `Bearer ${cronSecret}`) return null;

  // Check session cookie (UI calls)
  const cookie = request.cookies.get("qb-auth")?.value;
  if (authPassword && cookie === authPassword) return null;

  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
