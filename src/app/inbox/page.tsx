import { Suspense } from "react";
import { z } from "zod";
import {
  PageLayout,
  PageHeader,
  LoadingList,
} from "@/components/patterns";
import { parseSearchParams } from "@/lib/url-state";
import { listInbox } from "@/lib/queries/intelligence/inbox";
import { adaptInboxRow } from "@/lib/queries/intelligence/inbox-adapter";
import { InboxFilterBar } from "./_components/InboxFilterBar";
import { InboxListClient } from "./_components/InboxListClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata = { title: "Inbox" };

const searchSchema = z.object({
  severity: z.enum(["critical", "high", "medium", "low"]).optional().catch(undefined),
  entity: z
    .enum(["invoice", "payment", "company", "contact", "product"])
    .optional()
    .catch(undefined),
  assignee: z.coerce.number().int().optional().catch(undefined),
  q: z.string().trim().max(100).catch(""),
  limit: z.coerce.number().int().min(10).max(200).catch(50),
});

type Params = z.infer<typeof searchSchema>;

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const params = parseSearchParams(raw, searchSchema);

  // Eagerly fetch so that tests calling `await InboxPage(...)` get resolved JSX
  // (Suspense+async child components don't resolve in jsdom render).
  const content = await buildInboxContent(params);

  return (
    <PageLayout>
      <PageHeader
        title="Inbox"
        subtitle="Alertas fiscales y operativas priorizadas por el motor de reconciliación"
      />
      <Suspense fallback={<LoadingList />}>
        {content}
      </Suspense>
    </PageLayout>
  );
}

async function buildInboxContent(params: Params) {
  const rows = await listInbox({
    severity: params.severity,
    canonicalEntityType: params.entity,
    assigneeCanonicalContactId: params.assignee,
    limit: params.limit,
  });

  // Client-side q filter (TODO sp6-01.1: push down to DB when helper supports it)
  const q = params.q.toLowerCase();
  const filtered = q
    ? rows.filter((r) =>
        (r.description ?? "").toLowerCase().includes(q)
      )
    : rows;

  const counts = {
    critical: filtered.filter((r) => r.severity === "critical").length,
    high: filtered.filter((r) => r.severity === "high").length,
    medium: filtered.filter((r) => r.severity === "medium").length,
    low: filtered.filter((r) => r.severity === "low").length,
  };

  // De-dup assignees by id; preserve order of first-seen.
  const assigneeMap = new Map<number, { id: number; name: string }>();
  for (const r of filtered) {
    if (
      typeof r.assignee_canonical_contact_id === "number" &&
      typeof r.assignee_name === "string" &&
      !assigneeMap.has(r.assignee_canonical_contact_id)
    ) {
      assigneeMap.set(r.assignee_canonical_contact_id, {
        id: r.assignee_canonical_contact_id,
        name: r.assignee_name,
      });
    }
  }

  const items = filtered.map(adaptInboxRow);

  const hasFilters =
    params.severity !== undefined ||
    params.entity !== undefined ||
    params.assignee !== undefined ||
    (params.q?.length ?? 0) > 0;

  // Normalize optional → explicit-undefined so InboxFilterBar props satisfy
  // its required-but-possibly-undefined shape.
  const filterParams = {
    severity: params.severity as "critical" | "high" | "medium" | "low" | undefined,
    entity: params.entity as string | undefined,
    assignee: params.assignee as number | undefined,
    q: params.q,
    limit: params.limit,
  };

  return (
    <>
      <InboxFilterBar
        params={filterParams}
        counts={counts}
        assigneeOptions={Array.from(assigneeMap.values())}
      />
      <InboxListClient items={items} hasFilters={hasFilters} />
    </>
  );
}
