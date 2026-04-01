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
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {departments.map((dept) => (
        <Link key={dept.id} href="/departments">
          <Card className="hover:bg-muted/50 transition-colors cursor-pointer h-full">
            <CardContent className="pt-3 pb-3 sm:pt-4 sm:pb-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <p className="text-sm font-semibold truncate">{dept.name}</p>
                  </div>
                  {dept.lead_name && (
                    <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                      {dept.lead_name}
                    </p>
                  )}
                </div>
                <span
                  className={cn(
                    "text-lg font-bold tabular-nums shrink-0",
                    rateTextColor(dept.resolution_rate)
                  )}
                >
                  {dept.resolution_rate}%
                </span>
              </div>

              {/* Stats row */}
              <div className="flex items-center gap-3 mt-2 text-[11px] sm:text-xs text-muted-foreground">
                <span>
                  <span className="font-medium text-foreground">{dept.pending}</span> pendientes
                </span>
                <span>
                  <span className="font-medium text-foreground">{dept.acted_on}</span> actuados
                </span>
              </div>

              {/* Resolution bar */}
              <div className="mt-2 h-1.5 w-full rounded-full bg-muted overflow-hidden">
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
