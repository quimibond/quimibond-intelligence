import { NextResponse } from "next/server";

import { getCommsThreadMessages } from "@/lib/queries/comms/messages";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const { threadId } = await params;
  const id = Number(threadId);
  if (!Number.isFinite(id)) {
    return NextResponse.json([], { status: 200 });
  }
  const messages = await getCommsThreadMessages(id);
  return NextResponse.json(messages);
}
