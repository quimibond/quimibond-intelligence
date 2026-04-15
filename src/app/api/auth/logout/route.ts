import { NextResponse } from "next/server";

/**
 * Logout — clears the `qb-auth` cookie and redirects to /login.
 * Works via GET (link) or POST (form).
 */

function clearedResponse(redirectTo: URL | string) {
  const response =
    typeof redirectTo === "string"
      ? NextResponse.json({ success: true })
      : NextResponse.redirect(redirectTo);
  response.cookies.set("qb-auth", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  return clearedResponse(new URL("/login", url.origin));
}

export async function POST() {
  return clearedResponse("/login");
}
