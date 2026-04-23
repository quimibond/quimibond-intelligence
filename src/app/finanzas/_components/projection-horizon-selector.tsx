"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  paramName: string;
  value: 13 | 30 | 90;
  className?: string;
}

const OPTIONS: Array<{ value: 13 | 30 | 90; label: string }> = [
  { value: 13, label: "13 días" },
  { value: 30, label: "30 días" },
  { value: 90, label: "90 días" },
];

export function ProjectionHorizonSelector({ paramName, value, className }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function apply(next: 13 | 30 | 90) {
    const p = new URLSearchParams(searchParams.toString());
    if (next === 13) p.delete(paramName);
    else p.set(paramName, String(next));
    const qs = p.toString();
    router.push(`${pathname}${qs ? "?" + qs : ""}`);
  }

  return (
    <div
      role="group"
      aria-label="Horizonte de proyección"
      className={cn(
        "inline-flex items-center rounded-md border border-border bg-muted/30 p-0.5",
        className
      )}
    >
      {OPTIONS.map((opt) => {
        const active = opt.value === value;
        return (
          <Button
            key={opt.value}
            type="button"
            variant={active ? "secondary" : "ghost"}
            size="sm"
            className={cn(
              "h-7 rounded px-2.5 text-xs",
              active ? "shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
            onClick={() => apply(opt.value)}
            aria-pressed={active}
          >
            {opt.label}
          </Button>
        );
      })}
    </div>
  );
}
