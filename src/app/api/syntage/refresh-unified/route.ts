// SP5 Task 29: invoices_unified MV retired; use canonical_invoices directly.
import { NextResponse } from "next/server";
export async function GET() {
  return NextResponse.json({ error: "invoices_unified retired in SP5 Task 29" }, { status: 410 });
}
export async function POST() {
  return NextResponse.json({ error: "invoices_unified retired in SP5 Task 29" }, { status: 410 });
}
