"use client";

import Link from "next/link";
import { Inbox } from "lucide-react";
import { InboxCard, type InboxCardIssue } from "@/components/patterns/inbox-card";
import { SwipeStack } from "@/components/patterns/swipe-stack";
import { EmptyState } from "@/components/patterns/empty-state";

export interface InboxListClientProps {
  items: InboxCardIssue[];
  hasFilters: boolean;
}

export function InboxListClient({ items, hasFilters }: InboxListClientProps) {
  if (items.length === 0) {
    if (hasFilters) {
      return (
        <EmptyState
          icon={Inbox}
          title="Sin resultados"
          description="Ajusta los filtros o limpia la búsqueda para ver más alertas."
        />
      );
    }
    return (
      <EmptyState
        icon={Inbox}
        title="Sin alertas pendientes"
        description="Todo está al día. Revisa /cobranza para detalle de cartera."
      />
    );
  }

  return (
    <SwipeStack ariaLabel="Alertas priorizadas" snap={false}>
      {items.map((issue) => (
        <Link
          key={issue.issue_id}
          href={`/inbox/insight/${issue.issue_id}`}
          className="block focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 rounded-lg"
        >
          <InboxCard issue={issue} />
        </Link>
      ))}
    </SwipeStack>
  );
}
