"use client";

import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";

export function MiniStat({ label, value, sub, variant }: {
  label: string; value: string; sub?: string; variant?: string;
}) {
  return (
    <Card>
      <CardContent className="p-3">
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        <p className={cn("text-lg font-bold tabular-nums", variant)}>{value}</p>
        {sub && <p className="mt-0.5 text-[10px] text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}
