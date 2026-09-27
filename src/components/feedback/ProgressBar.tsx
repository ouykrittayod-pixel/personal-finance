import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

export type ProgressTone = 'primary' | 'income' | 'expense' | 'debt' | 'warning' | 'info'

const TONE_CLASS: Record<ProgressTone, string> = {
  primary: 'bg-primary',
  income: 'bg-income',
  expense: 'bg-expense',
  debt: 'bg-debt',
  warning: 'bg-warning',
  info: 'bg-info',
}

export interface ProgressBarProps {
  /** Percentage (0–100+). Values above 100 render as full; the caller decides tone (e.g. over budget). */
  value: number
  /** Accessible name, e.g. "งบอาหาร". */
  label: string
  tone?: ProgressTone
  /** Show "{value}%" to the right of the bar. */
  showValue?: boolean
  /** Human description for screen readers, e.g. "ใช้ไป ฿3,200 จาก ฿5,000". */
  valueText?: string
  size?: 'sm' | 'md'
  className?: string
}

/** Linear progress for budgets and debt payoff. Animates width changes only. */
export function ProgressBar({
  value,
  label,
  tone = 'primary',
  showValue = false,
  valueText,
  size = 'md',
  className,
}: ProgressBarProps) {
  const safe = Number.isFinite(value) ? Math.max(0, value) : 0
  const width = Math.min(100, safe)
  const rounded = Math.round(safe)

  return (
    <div className={cn('flex items-center gap-3', className)}>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(rounded, 100)}
        aria-valuetext={valueText ?? t('progress.value', { percent: rounded })}
        className={cn('relative flex-1 overflow-hidden rounded-full bg-muted', size === 'sm' ? 'h-1.5' : 'h-2.5')}
      >
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-(--duration-slow) ease-standard',
            TONE_CLASS[tone],
          )}
          style={{ width: `${width}%` }}
        />
      </div>
      {showValue && (
        <span className="tabular-nums-money w-12 text-right text-xs font-medium text-muted-foreground" aria-hidden="true">
          {t('progress.value', { percent: rounded })}
        </span>
      )}
    </div>
  )
}
