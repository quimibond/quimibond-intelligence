import { NextRequest, NextResponse } from "next/server";

/**
 * Validates CRON_SECRET for pipeline endpoints.
 * Returns null if authorized, or a 401 NextResponse if not.
 */
export function validatePipelineAuth(request: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return null; // No secret configured = open (dev mode)

  const auth = request.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return null;

  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
