import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  sourceLabel,
  sourceShortLabel,
  sourceColorClass,
  type SourceKind,
} from "@/lib/kpi";

export interface SourceBadgeProps {
  source: SourceKind;
  className?: string;
}

/**
 * Small pill showing the data source of a KPI value. Hover shows the long
 * label. Use next to every number so users know where it came from.
 */
export function SourceBadge({ source, className }: SourceBadgeProps) {
  return (
    <Badge
      variant="outline"
      title={sourceLabel(source)}
      className={cn(
        "h-4 gap-0 px-1.5 text-[9px] font-semibold tracking-wide",
        sourceColorClass(source),
        className
      )}
    >
      {sourceShortLabel(source)}
    </Badge>
  );
}
