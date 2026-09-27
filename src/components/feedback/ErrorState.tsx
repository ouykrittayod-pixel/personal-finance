import { AlertCircle, RotateCw } from 'lucide-react'
import { SecondaryButton } from '@/components/actions/buttons'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

export interface ErrorStateProps {
  title?: string
  description?: string
  /** Technical detail (error message) shown small for troubleshooting. */
  detail?: string
  onRetry?: () => void
  className?: string
}

/** Recoverable error inside a page region. Reassures that local data is safe. */
export function ErrorState({
  title = t('state.error.title'),
  description = t('state.error.hint'),
  detail,
  onRetry,
  className,
}: ErrorStateProps) {
  return (
    <div role="alert" className={cn('flex flex-col items-start gap-3 rounded-lg border border-expense/30 bg-expense-muted p-card', className)}>
      <div className="flex items-start gap-inline">
        <AlertCircle className="mt-0.5 size-5 shrink-0 text-expense" aria-hidden="true" />
        <div className="flex flex-col gap-1">
          <p className="font-medium text-foreground">{title}</p>
          <p className="text-sm text-muted-foreground">{description}</p>
          {detail && <pre className="mt-1 overflow-x-auto text-xs whitespace-pre-wrap text-muted-foreground">{detail}</pre>}
        </div>
      </div>
      {onRetry && (
        <SecondaryButton onClick={onRetry}>
          <RotateCw aria-hidden="true" />
          {t('common.retry')}
        </SecondaryButton>
      )}
    </div>
  )
}
