import { NextRequest, NextResponse } from "next/server";

/**
 * Simple password-based auth middleware.
 * If AUTH_PASSWORD is set, all pages require a cookie `qb-auth` with a SHA-256 token.
 * If AUTH_PASSWORD is NOT set, the dashboard is open (no auth required).
 *
 * Login flow: POST /api/auth with password sets the cookie.
 * Logout: GET /api/auth/logout clears the cookie.
 */

/** Edge-compatible SHA-256 hash using Web Crypto API */
async function sha256(message: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function middleware(request: NextRequest) {
  const authPassword = process.env.AUTH_PASSWORD;

  // If no password configured, skip auth entirely
  if (!authPassword) return NextResponse.next();

  const { pathname } = request.nextUrl;

  // Allow auth endpoints and static assets
  if (
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname === "/login"
  ) {
    return NextResponse.next();
  }

  // Check auth cookie (accepts both legacy plaintext and new hashed token)
  const authCookie = request.cookies.get("qb-auth")?.value;
  if (authCookie === authPassword) {
    return NextResponse.next();
  }
  const expectedToken = await sha256(`qb-auth:${authPassword}`);
  if (authCookie === expectedToken) {
    return NextResponse.next();
  }

  // Redirect to login page
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("redirect", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    // Match all routes except static files and API routes (except auth)
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
