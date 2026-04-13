import { cn } from "@/lib/utils";

interface StatGridProps {
  children: React.ReactNode;
  columns?: {
    mobile?: 1 | 2;
    tablet?: 2 | 3 | 4 | 5;
    desktop?: 2 | 3 | 4 | 5 | 6;
  };
  className?: string;
}

const mobileClass = {
  1: "grid-cols-1",
  2: "grid-cols-2",
} as const;

const tabletClass = {
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3",
  4: "sm:grid-cols-4",
  5: "sm:grid-cols-5",
} as const;

const desktopClass = {
  2: "lg:grid-cols-2",
  3: "lg:grid-cols-3",
  4: "lg:grid-cols-4",
  5: "lg:grid-cols-5",
  6: "lg:grid-cols-6",
} as const;

/**
 * StatGrid — grid responsive para KpiCards.
 * Mobile-first: default 2 cols en mobile para compacidad.
 */
export function StatGrid({
  children,
  columns = { mobile: 2, tablet: 3, desktop: 4 },
  className,
}: StatGridProps) {
  return (
    <div
      className={cn(
        "grid gap-2 sm:gap-3",
        mobileClass[columns.mobile ?? 2],
        tabletClass[columns.tablet ?? 3],
        desktopClass[columns.desktop ?? 4],
        className
      )}
    >
      {children}
    </div>
  );
}
