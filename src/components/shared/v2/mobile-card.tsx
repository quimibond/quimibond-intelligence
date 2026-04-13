import Link from "next/link";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { ChevronRight } from "lucide-react";

interface MobileCardField {
  label?: string;
  value: React.ReactNode;
  className?: string;
}

interface MobileCardProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  fields?: MobileCardField[];
  href?: string;
  onClick?: () => void;
  badge?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}

/**
 * MobileCard — base card para rows de tabla en mobile.
 * Touch target de fila completa (56px+).
 */
export function MobileCard({
  title,
  subtitle,
  fields,
  href,
  onClick,
  badge,
  className,
  children,
}: MobileCardProps) {
  const clickable = !!(href || onClick);
  const inner = (
    <Card
      className={cn(
        "gap-2 px-3 py-3 shadow-none",
        clickable && "active:bg-accent/50",
        className
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{title}</div>
          {subtitle && (
            <div className="truncate text-xs text-muted-foreground">
              {subtitle}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {badge}
          {clickable && (
            <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
          )}
        </div>
      </div>
      {fields && fields.length > 0 && (
        <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          {fields.map((f, i) => (
            <div key={i} className={cn("flex flex-col", f.className)}>
              {f.label && (
                <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {f.label}
                </dt>
              )}
              <dd className="font-medium tabular-nums">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {children}
    </Card>
  );

  if (href) {
    return (
      <Link href={href} className="block min-h-[56px]">
        {inner}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="block w-full min-h-[56px] text-left"
      >
        {inner}
      </button>
    );
  }
  return inner;
}
