import { z } from "zod";

import { getCommsTimeline, type CommsScope, type CommsEntityType } from "@/lib/queries/comms/timeline";
import { CommsEmptyState } from "./CommsEmptyState";
import { CommsThreadList } from "./CommsThreadList";

const scopeSchema = z
  .enum(["external", "internal", "all"])
  .catch("external") as z.ZodType<CommsScope>;
const pageSchema = z.coerce.number().int().min(0).catch(0);

export interface CommsTimelineProps {
  entityType: CommsEntityType;
  entityId: number;
  searchParams?: Record<string, string | string[] | undefined>;
}

const PAGE_SIZE = 25;

export async function CommsTimeline({
  entityType,
  entityId,
  searchParams,
}: CommsTimelineProps) {
  const scope = scopeSchema.parse(searchParams?.comms_scope ?? "external");
  const page = pageSchema.parse(searchParams?.comms_page ?? 0);

  const payload = await getCommsTimeline({
    entityType,
    entityId,
    scope,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  if (payload.total === 0) {
    return <CommsEmptyState entityType={entityType} />;
  }

  return (
    <CommsThreadList
      threads={payload.threads}
      total={payload.total}
      hasMore={payload.hasMore}
      scope={scope}
      page={page}
      pageSize={PAGE_SIZE}
    />
  );
}
