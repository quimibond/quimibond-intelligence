import { NextRequest, NextResponse } from "next/server";

/**
 * Validates auth for pipeline endpoints.
 * Accepts any of:
 * 1. Authorization: Bearer <CRON_SECRET> (for cron jobs / external callers)
 * 2. qb-auth cookie matching AUTH_PASSWORD (for UI calls with login enabled)
 * 3. Same-origin browser request when AUTH_PASSWORD is not set (open dashboard)
 * Returns null if authorized, or a 401 NextResponse if not.
 */
export function validatePipelineAuth(request: NextRequest): NextResponse | null {
  const cronSecret = process.env.CRON_SECRET;
  const authPassword = process.env.AUTH_PASSWORD;

  // No secrets configured = open (dev mode)
  if (!cronSecret && !authPassword) return null;

  // Check Bearer token (cron jobs, external callers)
  const auth = request.headers.get("authorization");
  if (cronSecret && auth === `Bearer ${cronSecret}`) return null;

  // Check session cookie (UI calls with AUTH_PASSWORD enabled)
  const cookie = request.cookies.get("qb-auth")?.value;
  if (authPassword && cookie === authPassword) return null;

  // If AUTH_PASSWORD is not set, dashboard is open — allow same-origin UI calls
  // Browsers set sec-fetch-site: same-origin for fetch() from the same domain
  if (!authPassword) {
    const fetchSite = request.headers.get("sec-fetch-site");
    if (fetchSite === "same-origin") return null;
  }

  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
