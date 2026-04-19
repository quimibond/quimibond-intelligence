import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: { label: string; href?: string; onClick?: () => void };
  className?: string;
  compact?: boolean;
}

/**
 * EmptyState — nunca mostrar contenedor vacío. Siempre este componente.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  compact,
}: EmptyStateProps) {
  return (
    <Card
      className={cn(
        "items-center justify-center text-center",
        compact ? "py-6" : "py-12",
        className
      )}
    >
      <div
        className={cn(
          "mb-3 flex items-center justify-center rounded-full bg-muted",
          compact ? "h-10 w-10" : "h-14 w-14"
        )}
      >
        <Icon
          className={cn("text-muted-foreground", compact ? "h-5 w-5" : "h-6 w-6")}
          aria-hidden
        />
      </div>
      <p className={cn("font-semibold", compact ? "text-sm" : "text-base")}>
        {title}
      </p>
      {description && (
        <p className="mt-1 max-w-xs text-xs text-muted-foreground sm:text-sm">
          {description}
        </p>
      )}
      {action && (
        <div className="mt-4">
          {action.href ? (
            <Button asChild size="sm">
              <Link href={action.href}>{action.label}</Link>
            </Button>
          ) : (
            <Button size="sm" onClick={action.onClick}>
              {action.label}
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
