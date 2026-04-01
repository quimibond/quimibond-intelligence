import { Skeleton } from "@/components/ui/skeleton";

interface LoadingGridProps {
  /** Number of stat cards to show (top row) */
  stats?: number;
  /** Number of list items to show */
  rows?: number;
  /** Height of each stat card */
  statHeight?: string;
  /** Height of each row */
  rowHeight?: string;
  /** Grid columns for stats: "2" | "3" | "4" */
  statCols?: "2" | "3" | "4";
}

const statColsMap = {
  "2": "grid-cols-2",
  "3": "grid-cols-3",
  "4": "grid-cols-2 lg:grid-cols-4",
};

export function LoadingGrid({
  stats = 0,
  rows = 6,
  statHeight = "h-[76px]",
  rowHeight = "h-14",
  statCols = "4",
}: LoadingGridProps) {
  return (
    <div className="space-y-3">
      {stats > 0 && (
        <div className={`grid gap-3 ${statColsMap[statCols]}`}>
          {Array.from({ length: stats }).map((_, i) => (
            <Skeleton key={`stat-${i}`} className={statHeight} />
          ))}
        </div>
      )}
      {/* Mobile cards */}
      <div className="space-y-2 md:hidden">
        {Array.from({ length: Math.min(rows, 4) }).map((_, i) => (
          <Skeleton key={`m-${i}`} className="h-[72px]" />
        ))}
      </div>
      {/* Desktop rows */}
      <div className="hidden md:block space-y-1">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={`d-${i}`} className={rowHeight} />
        ))}
      </div>
    </div>
  );
}
