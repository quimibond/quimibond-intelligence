import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  badge?: { count: number; label?: string; variant?: "default" | "critical" | "warning" | "success" };
  className?: string;
  sticky?: boolean;
}

/**
 * PageHeader — header consistente de página.
 * En mobile: sticky opcional para mantener contexto al hacer scroll.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  badge,
  className,
  sticky,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        "flex flex-col gap-2 border-b border-border pb-3 sm:flex-row sm:items-end sm:justify-between sm:pb-4",
        sticky &&
          "sticky top-0 z-30 -mx-4 bg-background/95 px-4 backdrop-blur-md sm:static sm:mx-0 sm:bg-transparent sm:backdrop-blur-0",
        className
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h1 className="truncate text-xl font-bold sm:text-2xl lg:text-3xl">
            {title}
          </h1>
          {badge && (
            <Badge variant={badge.variant === "critical" ? "critical" : badge.variant === "warning" ? "warning" : badge.variant === "success" ? "success" : "secondary"}>
              {badge.count}
              {badge.label ? ` ${badge.label}` : ""}
            </Badge>
          )}
        </div>
        {subtitle && (
          <p className="mt-0.5 truncate text-xs text-muted-foreground sm:text-sm">
            {subtitle}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      )}
    </header>
  );
}
