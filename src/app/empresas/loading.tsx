import { Skeleton } from "@/components/ui/skeleton";

/**
 * Skeleton matches the SP13 /empresas layout: PageHeader + StatGrid (4 KPIs)
 * + 3 QuestionSection blocks (Top LTV, Drifting, Companies list). Replaces
 * the legacy 3-col card grid skeleton that didn't match the new layout.
 */
export default function CompaniesLoading() {
  return (
    <div className="space-y-6">
      {/* PageHeader (title + subtitle + HistorySelector) */}
      <div className="flex flex-col gap-2 border-b border-border pb-3 sm:pb-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 flex-1 space-y-1">
            <Skeleton className="h-7 w-32" />
            <Skeleton className="h-4 w-72" />
          </div>
          <Skeleton className="h-7 w-32" />
        </div>
      </div>

      {/* E1 Hero — StatGrid 4 KPIs */}
      <div className="grid gap-2 sm:gap-3 grid-cols-2 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[112px] rounded-xl" />
        ))}
      </div>

      {/* QuestionSection × 3 (Top LTV, Drifting, Companies list) */}
      {Array.from({ length: 3 }).map((_, i) => (
        <section key={i} className="space-y-3">
          <div className="space-y-1">
            <Skeleton className="h-5 w-64" />
            <Skeleton className="h-3 w-48" />
          </div>
          <Skeleton className="h-48 rounded-xl" />
        </section>
      ))}
    </div>
  );
}
