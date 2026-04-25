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
import type { PurchaseOrderState } from "@/lib/queries/sp13/compras";

export interface ComprasFilterBarParams {
  q: string;
  state: PurchaseOrderState;
  buyer: string | "all";
  sort: string;
  page: number;
  limit: number;
  range?: string;
}

interface Props {
  params: ComprasFilterBarParams;
  buyerOptions: string[];
}

const STATE_OPTIONS: Array<{ value: PurchaseOrderState; label: string }> = [
  { value: "all", label: "Todas" },
  { value: "draft", label: "Borrador" },
  { value: "sent", label: "Enviada" },
  { value: "to approve", label: "Por aprobar" },
  { value: "purchase", label: "Confirmada" },
  { value: "done", label: "Cerrada" },
  { value: "cancel", label: "Cancelada" },
];

export function ComprasFilterBar({ params, buyerOptions }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [qLocal, setQLocal] = React.useState(params.q);
  const qTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const push = React.useCallback(
    (next: Partial<ComprasFilterBarParams>) => {
      const merged = { ...params, ...next };
      const qs = toSearchString(
        {
          q: merged.q || undefined,
          state: merged.state,
          buyer: merged.buyer,
          sort: merged.sort,
          page: merged.page,
          limit: merged.limit,
          range: merged.range,
        },
        {
          dropEqual: {
            state: "all",
            buyer: "all",
            sort: "-date",
            page: 1,
            limit: 25,
            range: "ytd",
          },
        },
      );
      router.push(`${pathname}${qs}`);
    },
    [params, pathname, router],
  );

  const setState = (v: PurchaseOrderState) => push({ state: v, page: 1 });
  const setBuyer = (v: string) =>
    push({ buyer: v as ComprasFilterBarParams["buyer"], page: 1 });

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setQLocal(v);
    if (qTimer.current) clearTimeout(qTimer.current);
    qTimer.current = setTimeout(() => push({ q: v.trim(), page: 1 }), 300);
  };

  const anyFilter =
    params.q.length > 0 || params.state !== "all" || params.buyer !== "all";

  const clearAll = () => {
    setQLocal("");
    push({ q: "", state: "all", buyer: "all", page: 1 });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
        <div className="flex items-center gap-1 flex-wrap">
          <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Estado
          </span>
          {STATE_OPTIONS.map((opt) => {
            const active = params.state === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                aria-pressed={active}
                onClick={() => setState(opt.value)}
                className={cn(
                  "min-h-[32px] rounded-full border px-3 text-xs font-medium transition-colors",
                  active
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background border-border text-muted-foreground hover:bg-muted",
                )}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Comprador
          </span>
          <Select value={params.buyer} onValueChange={setBuyer}>
            <SelectTrigger className="h-9 w-44" aria-label="Comprador">
              <SelectValue placeholder="Todos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {buyerOptions.map((b) => (
                <SelectItem key={b} value={b}>
                  {b}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {anyFilter && (
          <Button variant="ghost" size="sm" onClick={clearAll} className="h-9">
            <X className="mr-1 h-3 w-3" /> Limpiar
          </Button>
        )}
      </div>
      <Input
        type="search"
        value={qLocal}
        onChange={handleSearch}
        placeholder="Buscar por número de OC…"
        className="h-10 w-full"
        aria-label="Buscar por número de OC"
      />
    </div>
  );
}
