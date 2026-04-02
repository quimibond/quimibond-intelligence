"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Users } from "lucide-react";

interface DepartmentStats {
  id: number;
  name: string;
  lead_name: string | null;
  pending: number;
  acted_on: number;
  total: number;
  resolution_rate: number;
}

interface TeamAccountabilityProps {
  departments: DepartmentStats[];
}

function rateColor(rate: number): string {
  if (rate >= 75) return "bg-success";
  if (rate >= 50) return "bg-warning";
  return "bg-danger";
}

function rateTextColor(rate: number): string {
  if (rate >= 75) return "text-success";
  if (rate >= 50) return "text-warning";
  return "text-danger";
}

export function TeamAccountability({ departments }: TeamAccountabilityProps) {
  if (departments.length === 0) {
    return (
      <div className="text-sm text-muted-foreground text-center py-6">
        Sin datos de departamentos disponibles.
      </div>
    );
  }

  return (
    <div className="grid gap-2 grid-cols-2 sm:gap-3 lg:grid-cols-3">
      {departments.map((dept) => (
        <Link key={dept.id} href="/departments">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full active:bg-muted">
            <CardContent className="p-2.5 sm:p-4">
              <div className="flex items-start justify-between gap-1">
                <div className="min-w-0">
                  <p className="text-xs sm:text-sm font-semibold truncate">{dept.name}</p>
                  {dept.lead_name && (
                    <p className="text-[10px] sm:text-[11px] text-muted-foreground truncate">
                      {dept.lead_name}
                    </p>
                  )}
                </div>
                <span
                  className={cn(
                    "text-base sm:text-lg font-bold tabular-nums shrink-0",
                    rateTextColor(dept.resolution_rate)
                  )}
                >
                  {dept.resolution_rate}%
                </span>
              </div>

              {/* Stats row */}
              <div className="flex items-center gap-2 mt-1.5 text-[10px] sm:text-xs text-muted-foreground">
                <span>
                  <span className="font-medium text-foreground">{dept.pending}</span> pend.
                </span>
                <span>
                  <span className="font-medium text-foreground">{dept.acted_on}</span> ok
                </span>
              </div>

              {/* Resolution bar */}
              <div className="mt-1.5 h-1 sm:h-1.5 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className={cn("h-full rounded-full transition-all", rateColor(dept.resolution_rate))}
                  style={{ width: `${dept.resolution_rate}%` }}
                />
              </div>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}
