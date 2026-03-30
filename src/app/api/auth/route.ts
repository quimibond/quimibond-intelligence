import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const authPassword = process.env.AUTH_PASSWORD;
  if (!authPassword) {
    return NextResponse.json({ error: "Auth not configured" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const password = body.password;

  if (password !== authPassword) {
    return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set("qb-auth", authPassword, {
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
  const authPassword = process.env.AUTH_PASSWORD;
  if (!authPassword) {
    return NextResponse.json({ error: "Auth not configured" }, { status: 404 });
  }

  const password = request.nextUrl.searchParams.get("password");
  if (password !== authPassword) {
    return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
  }

  const response = NextResponse.redirect(new URL("/inbox", request.url));
  response.cookies.set("qb-auth", authPassword, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  return response;
}
