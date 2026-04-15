import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Badge variants — 5 semánticas + 3 neutrales.
 *
 * Uso recomendado:
 * - `success`  — estado OK, positivo, saludable
 * - `warning`  — atención, mejora necesaria
 * - `danger`   — crítico, acción urgente (alias: `critical` para back-compat)
 * - `info`     — informativo, neutral positivo
 * - `secondary`— metadata, chips pasivos
 * - `outline`  — texto sobre fondo transparente con borde
 * - `default`  — CTA principal (primary color)
 * - `destructive` — botón rojo fuerte (rara vez; preferir `danger`)
 */
const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground shadow-sm hover:bg-primary/80",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive:
          "border-transparent bg-destructive text-white shadow-sm hover:bg-destructive/80",
        outline: "text-foreground",
        success:
          "border-transparent bg-success/15 text-success-foreground",
        warning:
          "border-transparent bg-warning/15 text-warning-foreground",
        info:
          "border-transparent bg-info/15 text-info-foreground",
        danger:
          "border-transparent bg-danger/15 text-danger-foreground",
        /** @deprecated usar `danger` */
        critical:
          "border-transparent bg-danger/15 text-danger-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
