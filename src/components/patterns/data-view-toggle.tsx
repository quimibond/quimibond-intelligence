import Link from "next/link";
import { BarChart3, Table2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type DataViewMode = "table" | "chart";

interface DataViewToggleProps {
  /** Current view — derive from URL searchParams. */
  view: DataViewMode;
  /** Generates href to switch to a given view (keeps other URL params). */
  viewHref: (next: DataViewMode) => string;
  className?: string;
}

/**
 * @deprecated SP6 — use <Chart /> with URL-driven view state.
 *
 * SSR-friendly segmented control: Tabla ⇄ Gráfica.
 *
 * Renders as two `<Link>` triggers styled like shadcn `TabsList`/`TabsTrigger`.
 * State lives in the URL so server components can read it and decide which
 * body to render.
 */
export function DataViewToggle({
  view,
  viewHref,
  className,
}: DataViewToggleProps) {
  return (
    <div
      role="tablist"
      aria-label="Cambiar vista"
      className={cn(
        "bg-muted text-muted-foreground inline-flex h-8 items-center justify-center rounded-md p-0.5",
        className
      )}
    >
      {(["table", "chart"] as const).map((v) => {
        const active = v === view;
        const Icon = v === "table" ? Table2 : BarChart3;
        const label = v === "table" ? "Tabla" : "Gráfica";
        return (
          <Link
            key={v}
            href={viewHref(v)}
            role="tab"
            aria-selected={active}
            scroll={false}
            className={cn(
              "inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
              active
                ? "bg-background text-foreground shadow-sm"
                : "hover:text-foreground"
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
            {label}
          </Link>
        );
      })}
    </div>
  );
}
