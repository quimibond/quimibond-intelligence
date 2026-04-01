import { cn } from "@/lib/utils";

interface MiniStatCardProps {
  icon: React.ElementType;
  label: string;
  value: string | number;
  valueClassName?: string;
}

export function MiniStatCard({ icon: Icon, label, value, valueClassName }: MiniStatCardProps) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="text-[11px] sm:text-xs font-medium truncate">{label}</span>
      </div>
      <p className={cn("mt-1 text-xl sm:text-2xl font-bold tabular-nums", valueClassName)}>
        {value}
      </p>
    </div>
  );
}
