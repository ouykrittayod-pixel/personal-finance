import { Loader2 } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

export interface LoadingStateProps {
  /** `spinner` for short waits; `list` / `cards` keep layout stable while data loads. */
  variant?: 'spinner' | 'list' | 'cards'
  /** Number of skeleton rows/cards. */
  count?: number
  label?: string
  className?: string
}

/** Announces loading politely to screen readers; skeletons are hidden from them. */
export function LoadingState({ variant = 'spinner', count = 3, label = t('state.loading'), className }: LoadingStateProps) {
  return (
    <div role="status" aria-live="polite" className={cn(variant === 'spinner' && 'flex justify-center py-10', className)}>
      <span className="sr-only">{label}</span>
      {variant === 'spinner' && (
        <span className="flex items-center gap-2 text-sm text-muted-foreground" aria-hidden="true">
          <Loader2 className="size-4 animate-spin" />
          {label}
        </span>
      )}
      {variant === 'list' && (
        <ul aria-hidden="true" className="divide-y divide-border">
          {Array.from({ length: count }, (_, index) => (
            <li key={index} className="flex items-center gap-3 px-card py-3">
              <Skeleton className="size-10 rounded-full" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-3.5 w-2/5" />
                <Skeleton className="h-3 w-1/4" />
              </div>
              <Skeleton className="h-4 w-16" />
            </li>
          ))}
        </ul>
      )}
      {variant === 'cards' && (
        <div aria-hidden="true" className="grid gap-stack sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: count }, (_, index) => (
            <div key={index} className="flex flex-col gap-3 rounded-lg border p-card">
              <Skeleton className="h-3.5 w-1/3" />
              <Skeleton className="h-7 w-1/2" />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
