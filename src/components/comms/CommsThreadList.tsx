"use client";

import { useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { CommsScopeToggle } from "./CommsScopeToggle";
import { CommsThreadCard } from "./CommsThreadCard";
import { CommsThreadDrawer } from "./CommsThreadDrawer";
import type { CommsScope, CommsThread } from "@/lib/queries/comms/timeline";

export interface CommsThreadListProps {
  threads: CommsThread[];
  total: number;
  hasMore: boolean;
  scope: CommsScope;
  page: number;
  pageSize: number;
}

export function CommsThreadList({
  threads,
  total,
  hasMore,
  scope,
  page,
}: CommsThreadListProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [activeThread, setActiveThread] = useState<CommsThread | null>(null);

  const goToPage = (next: number) => {
    const sp = new URLSearchParams(searchParams.toString());
    if (next <= 0) sp.delete("comms_page");
    else sp.set("comms_page", String(next));
    const qs = sp.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  return (
    <section className="space-y-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <CommsScopeToggle scope={scope} />
        <span className="text-xs text-muted-foreground">
          Mostrando {threads.length} de {total}
        </span>
      </header>

      <div className="space-y-2">
        {threads.map((t) => (
          <CommsThreadCard
            key={t.thread_id}
            thread={t}
            onSelect={() => setActiveThread(t)}
          />
        ))}
      </div>

      <footer className="flex justify-between gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page === 0}
          onClick={() => goToPage(page - 1)}
        >
          Anterior
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!hasMore}
          onClick={() => goToPage(page + 1)}
        >
          Siguiente
        </Button>
      </footer>

      <CommsThreadDrawer
        threadId={activeThread?.thread_id ?? null}
        gmailThreadId={activeThread?.gmail_thread_id ?? null}
        open={activeThread !== null}
        onOpenChange={(open) => {
          if (!open) setActiveThread(null);
        }}
      />
    </section>
  );
}
