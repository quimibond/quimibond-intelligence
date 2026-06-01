// SP5 Task 29: invoices_unified MV retired; use canonical_invoices directly.
import { type NextRequest, NextResponse } from "next/server";
export async function GET(_req: NextRequest) {
  return NextResponse.json({ error: "invoices_unified retired in SP5 Task 29" }, { status: 410 });
}
export async function POST(_req: NextRequest) {
  return NextResponse.json({ error: "invoices_unified retired in SP5 Task 29" }, { status: 410 });
}
