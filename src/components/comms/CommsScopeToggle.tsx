"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import type { CommsScope } from "@/lib/queries/comms/timeline";

const OPTIONS: Array<{ value: CommsScope; label: string }> = [
  { value: "external", label: "Externos" },
  { value: "internal", label: "Internos" },
  { value: "all", label: "Todos" },
];

export interface CommsScopeToggleProps {
  scope: CommsScope;
}

export function CommsScopeToggle({ scope }: CommsScopeToggleProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const setScope = (next: CommsScope) => {
    const sp = new URLSearchParams(searchParams.toString());
    if (next === "external") sp.delete("comms_scope");
    else sp.set("comms_scope", next);
    sp.delete("comms_page"); // reset paging on scope change
    const qs = sp.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  return (
    <div className="inline-flex rounded-md border" role="tablist" aria-label="Filtro de comunicaciones">
      {OPTIONS.map((opt) => (
        <Button
          key={opt.value}
          variant={scope === opt.value ? "default" : "ghost"}
          size="sm"
          role="tab"
          aria-selected={scope === opt.value}
          onClick={() => setScope(opt.value)}
          className="rounded-none first:rounded-l-md last:rounded-r-md"
        >
          {opt.label}
        </Button>
      ))}
    </div>
  );
}
