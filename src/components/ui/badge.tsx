import { cn } from "@/lib/utils";
import { type VariantProps, cva } from "class-variance-authority";
import { HTMLAttributes } from "react";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors",
  {
    variants: {
      variant: {
        default:
          "bg-[var(--primary)] text-[var(--primary-foreground)]",
        secondary:
          "bg-[var(--secondary)] text-[var(--secondary-foreground)]",
        destructive:
          "bg-[var(--severity-critical-muted)] text-[var(--severity-critical)] border border-[color-mix(in_srgb,var(--severity-critical)_30%,transparent)]",
        warning:
          "bg-[var(--warning-muted)] text-[var(--warning)] border border-[color-mix(in_srgb,var(--warning)_30%,transparent)]",
        success:
          "bg-[var(--success-muted)] text-[var(--success)] border border-[color-mix(in_srgb,var(--success)_30%,transparent)]",
        info:
          "bg-[var(--info-muted)] text-[var(--info)] border border-[color-mix(in_srgb,var(--info)_30%,transparent)]",
        outline:
          "border border-[var(--border)] text-[var(--foreground)]",
        // Severity-specific
        critical:
          "bg-[var(--severity-critical-muted)] text-[var(--severity-critical)] border border-[color-mix(in_srgb,var(--severity-critical)_30%,transparent)]",
        high:
          "bg-[var(--severity-high-muted)] text-[var(--severity-high)] border border-[color-mix(in_srgb,var(--severity-high)_30%,transparent)]",
        medium:
          "bg-[var(--severity-medium-muted)] text-[var(--severity-medium)] border border-[color-mix(in_srgb,var(--severity-medium)_30%,transparent)]",
        low:
          "bg-[var(--severity-low-muted)] text-[var(--severity-low)] border border-[color-mix(in_srgb,var(--severity-low)_30%,transparent)]",
        // Quest rarity
        epic:
          "bg-[var(--quest-epic-muted)] text-[var(--quest-epic)] border border-[color-mix(in_srgb,var(--quest-epic)_30%,transparent)]",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}
