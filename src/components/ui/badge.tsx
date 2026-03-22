import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default:
          'border border-primary/20 bg-primary/10 text-primary hover:bg-primary/20',
        secondary:
          'border border-secondary/20 bg-secondary/10 text-secondary hover:bg-secondary/20',
        destructive:
          'border border-destructive/20 bg-destructive/10 text-destructive hover:bg-destructive/20',
        outline: 'border border-input text-foreground hover:bg-accent',
        critical:
          'border border-red-300 bg-red-50 text-red-900 dark:border-red-700 dark:bg-red-900/30 dark:text-red-100',
        high: 'border border-orange-300 bg-orange-50 text-orange-900 dark:border-orange-700 dark:bg-orange-900/30 dark:text-orange-100',
        medium:
          'border border-yellow-300 bg-yellow-50 text-yellow-900 dark:border-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-100',
        low: 'border border-blue-300 bg-blue-50 text-blue-900 dark:border-blue-700 dark:bg-blue-900/30 dark:text-blue-100',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
