import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface LoadingCardProps {
  className?: string;
}

export function LoadingCard({ className }: LoadingCardProps) {
  return (
    <div
      data-testid="loading-card"
      className={cn("rounded-lg border border-border bg-card p-6 space-y-3", className)}
    >
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-3 w-1/4" />
    </div>
  );
}

interface LoadingTableProps {
  rows?: number;
  columns?: number;
}

export function LoadingTable({ rows = 5, columns = 4 }: LoadingTableProps) {
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="border-b border-border bg-muted/30 p-3 flex gap-4">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} className="h-3 flex-1" />
        ))}
      </div>
      <div className="divide-y divide-border">
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            data-testid="loading-table-row"
            className="p-3 flex gap-4"
          >
            {Array.from({ length: columns }).map((_, j) => (
              <Skeleton key={j} className="h-4 flex-1" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

interface LoadingListProps {
  items?: number;
}

export function LoadingList({ items = 4 }: LoadingListProps) {
  return (
    <div className="space-y-2">
      {Array.from({ length: items }).map((_, i) => (
        <div
          key={i}
          data-testid="loading-list-item"
          className="flex items-center gap-3 rounded border border-border p-3"
        >
          <Skeleton className="h-10 w-10 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        </div>
      ))}
    </div>
  );
}
