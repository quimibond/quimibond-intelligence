import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon: React.ElementType;
  title: string;
  description?: string;
  compact?: boolean;
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, compact, className }: EmptyStateProps) {
  if (compact) {
    return (
      <div className={cn("flex flex-col items-center justify-center py-8 text-center", className)}>
        <Icon className="mb-2 h-6 w-6 text-muted-foreground" />
        <p className="text-sm font-medium">{title}</p>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col items-center justify-center py-16 text-center", className)}>
      <div className="mb-4 rounded-full bg-muted p-4">
        <Icon className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold">{title}</h3>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          {description}
        </p>
      )}
    </div>
  );
}
