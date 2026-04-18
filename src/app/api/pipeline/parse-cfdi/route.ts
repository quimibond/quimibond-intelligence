import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const MESSAGE = "Endpoint deprecated 2026-04-20. CFDIs now ingested via Syntage webhook. See /system → Syntage.";

export async function GET() {
  return NextResponse.json({ error: "Gone", message: MESSAGE }, { status: 410 });
}

export async function POST() {
  return NextResponse.json({ error: "Gone", message: MESSAGE }, { status: 410 });
}
