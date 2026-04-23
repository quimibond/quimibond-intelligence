"use client";

import * as React from "react";
import { useRouter, usePathname } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toSearchString } from "@/lib/url-state";
import { cn } from "@/lib/utils";

type Severity = "critical" | "high" | "medium" | "low";

export interface InboxFilterBarProps {
  params: {
    severity: Severity | undefined;
    entity: string | undefined;
    assignee: number | undefined;
    q: string;
    limit: number;
  };
  counts: Record<Severity, number>;
  assigneeOptions: Array<{ id: number; name: string }>;
}

const SEVERITY_LABELS: Record<Severity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low"];

export function InboxFilterBar({ params, counts, assigneeOptions }: InboxFilterBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [qLocal, setQLocal] = React.useState(params.q);
  const qTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const push = React.useCallback(
    (nextParams: Partial<InboxFilterBarProps["params"]>) => {
      const merged = { ...params, ...nextParams };
      const qs = toSearchString(
        {
          severity: merged.severity,
          entity: merged.entity,
          assignee: merged.assignee,
          q: merged.q || undefined,
          limit: merged.limit,
        },
        { dropEqual: { limit: 50 } }
      );
      router.push(`${pathname}${qs}`);
    },
    [params, pathname, router]
  );

  const toggleSeverity = (s: Severity) => {
    push({ severity: params.severity === s ? undefined : s });
  };

  const setAssignee = (v: string) => {
    push({ assignee: v === "all" ? undefined : Number(v) });
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setQLocal(v);
    if (qTimer.current) clearTimeout(qTimer.current);
    qTimer.current = setTimeout(() => {
      push({ q: v.trim() });
    }, 300);
  };

  const anyFilter =
    params.severity !== undefined ||
    params.entity !== undefined ||
    params.assignee !== undefined ||
    (params.q?.length ?? 0) > 0;

  const clearAll = () => {
    setQLocal("");
    push({ severity: undefined, entity: undefined, assignee: undefined, q: "" });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {SEVERITY_ORDER.map((s) => {
          const active = params.severity === s;
          return (
            <button
              key={s}
              type="button"
              aria-pressed={active}
              aria-label={`Filtrar severidad ${SEVERITY_LABELS[s]}`}
              onClick={() => toggleSeverity(s)}
              className={cn(
                "min-h-[36px] rounded-full border px-3 text-xs font-medium transition-colors",
                active
                  ? "bg-status-critical/15 border-status-critical/40 text-foreground"
                  : "bg-background border-border text-muted-foreground hover:bg-muted"
              )}
            >
              {SEVERITY_LABELS[s]} ({counts[s] ?? 0})
            </button>
          );
        })}
        {anyFilter && (
          <Button variant="ghost" size="sm" onClick={clearAll} className="min-h-[36px]">
            <X className="mr-1 h-3 w-3" /> Limpiar
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={params.assignee !== undefined ? String(params.assignee) : "all"}
          onValueChange={setAssignee}
        >
          <SelectTrigger className="h-10 w-full sm:w-56" aria-label="Filtrar por asignado">
            <SelectValue placeholder="Asignado: Todos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Asignado: Todos</SelectItem>
            {assigneeOptions.map((a) => (
              <SelectItem key={a.id} value={String(a.id)}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="search"
          value={qLocal}
          onChange={handleSearchChange}
          placeholder="Buscar en descripción..."
          className="h-10 w-full sm:flex-1"
          aria-label="Buscar en descripción"
        />
      </div>
    </div>
  );
}
