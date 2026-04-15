import Link from "next/link";
import { ChevronRight, Home } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  badge?: {
    count: number;
    label?: string;
    variant?: "default" | "danger" | "warning" | "success" | "info";
  };
  /**
   * Breadcrumbs opcionales. Si se pasan, se renderizan sobre el título.
   * El primer item debería ser la raíz (ej. "Dashboard").
   */
  breadcrumbs?: BreadcrumbItem[];
  className?: string;
  sticky?: boolean;
}

/**
 * PageHeader — header consistente de página con breadcrumbs opcionales.
 * En mobile: sticky opcional para mantener contexto al hacer scroll.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  badge,
  breadcrumbs,
  className,
  sticky,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        "flex flex-col gap-2 border-b border-border pb-3 sm:pb-4",
        sticky &&
          "sticky top-0 z-30 -mx-4 bg-background/95 px-4 backdrop-blur-md sm:static sm:mx-0 sm:bg-transparent sm:backdrop-blur-0",
        className
      )}
    >
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav
          aria-label="Breadcrumb"
          className="flex items-center gap-1 text-xs text-muted-foreground"
        >
          {breadcrumbs.map((item, i) => {
            const isLast = i === breadcrumbs.length - 1;
            return (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && (
                  <ChevronRight
                    className="size-3 opacity-60"
                    aria-hidden="true"
                  />
                )}
                {item.href && !isLast ? (
                  <Link
                    href={item.href}
                    className="inline-flex items-center gap-1 rounded hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    {i === 0 && item.label === "Dashboard" && (
                      <Home className="size-3" aria-hidden="true" />
                    )}
                    {item.label}
                  </Link>
                ) : (
                  <span
                    className={cn(
                      isLast ? "text-foreground font-medium" : ""
                    )}
                    aria-current={isLast ? "page" : undefined}
                  >
                    {item.label}
                  </span>
                )}
              </span>
            );
          })}
        </nav>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-xl font-bold sm:text-2xl lg:text-3xl">
              {title}
            </h1>
            {badge && (
              <Badge
                variant={
                  badge.variant === "danger"
                    ? "danger"
                    : badge.variant === "warning"
                      ? "warning"
                      : badge.variant === "success"
                        ? "success"
                        : badge.variant === "info"
                          ? "info"
                          : "secondary"
                }
              >
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
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {actions}
          </div>
        )}
      </div>
    </header>
  );
}
