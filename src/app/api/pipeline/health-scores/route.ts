// SP5 Task 29: health_scores table retired (user-confirmed; no replacement).
import { NextResponse } from "next/server";
export async function GET() {
  return NextResponse.json({ error: "health_scores retired in SP5 Task 29" }, { status: 410 });
}
export async function POST() {
  return NextResponse.json({ error: "health_scores retired in SP5 Task 29" }, { status: 410 });
}
