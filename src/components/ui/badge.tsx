import { cn } from "@/lib/utils";
import { type VariantProps, cva } from "class-variance-authority";
import { HTMLAttributes } from "react";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors",
  {
    variants: {
      variant: {
        default: "bg-[var(--primary)] text-white",
        secondary: "bg-[var(--secondary)] text-[var(--secondary-foreground)]",
        destructive: "bg-red-500/20 text-red-400 border border-red-500/30",
        warning: "bg-amber-500/20 text-amber-400 border border-amber-500/30",
        success: "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30",
        info: "bg-blue-500/20 text-blue-400 border border-blue-500/30",
        outline: "border border-[var(--border)] text-[var(--foreground)]",
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
