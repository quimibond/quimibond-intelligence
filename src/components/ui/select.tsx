import * as React from 'react'
import { ChevronDown } from 'lucide-react'

import { cn } from '@/lib/utils'

export interface SelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, ...props }, ref) => (
    <div className="relative inline-flex w-full">
      <select
        ref={ref}
        className={cn(
          'flex h-10 w-full appearance-none rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm pr-8',
          className
        )}
        {...props}
      />
      <ChevronDown className="pointer-events-none absolute right-2.5 top-2.5 h-4 w-4 opacity-50" />
    </div>
  )
)
Select.displayName = 'Select'

export { Select }
