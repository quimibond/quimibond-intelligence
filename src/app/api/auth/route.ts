import { NextRequest, NextResponse } from "next/server";
import { rateLimitResponse } from "@/lib/rate-limit";

/** Derive a deterministic token from the password (not the password itself) */
async function deriveToken(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(`qb-auth:${password}`);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function POST(request: NextRequest) {
  const limited = rateLimitResponse(request, { limit: 5, windowMinutes: 15 });
  if (limited) return limited;

  const authPassword = process.env.AUTH_PASSWORD;
  if (!authPassword) {
    return NextResponse.json({ error: "Auth not configured" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const password = body.password;

  if (password !== authPassword) {
    return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
  }

  const token = await deriveToken(authPassword);
  const response = NextResponse.json({ success: true });
  response.cookies.set("qb-auth", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  return response;
}

// Keep GET for backwards compatibility but redirect to POST
export async function GET(request: NextRequest) {
  const limited = rateLimitResponse(request, { limit: 5, windowMinutes: 15 });
  if (limited) return limited;

  const authPassword = process.env.AUTH_PASSWORD;
  if (!authPassword) {
    return NextResponse.json({ error: "Auth not configured" }, { status: 404 });
  }

  const password = request.nextUrl.searchParams.get("password");
  if (password !== authPassword) {
    return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
  }

  const token = await deriveToken(authPassword);
  const response = NextResponse.redirect(new URL("/inbox", request.url));
  response.cookies.set("qb-auth", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  return response;
}
