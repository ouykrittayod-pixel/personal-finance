import { ChevronLeft, ChevronRight } from 'lucide-react'
import { IconButton, SecondaryButton } from '@/components/actions/buttons'
import { addMonthsYM, formatYearMonth, type YearMonth } from '@/lib/dates'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

export interface MonthSelectorProps {
  value: YearMonth
  onChange: (month: YearMonth) => void
  /** The real current month; enables the "เดือนนี้" shortcut when another month is shown. */
  currentMonth?: YearMonth
  className?: string
}

/** Previous / next month stepper with the month name announced politely on change. */
export function MonthSelector({ value, onChange, currentMonth, className }: MonthSelectorProps) {
  return (
    <div className={cn('flex items-center gap-1', className)}>
      {currentMonth && currentMonth !== value && (
        <SecondaryButton className="mr-1" onClick={() => onChange(currentMonth)}>
          {t('month.current')}
        </SecondaryButton>
      )}
      <div className="flex items-center rounded-md border">
        <IconButton label={t('month.previous')} icon={<ChevronLeft />} onClick={() => onChange(addMonthsYM(value, -1))} />
        <p aria-live="polite" className="min-w-32 text-center text-sm font-medium">
          <span className="sr-only">{t('month.selected')} </span>
          {formatYearMonth(value)}
        </p>
        <IconButton label={t('month.next')} icon={<ChevronRight />} onClick={() => onChange(addMonthsYM(value, 1))} />
      </div>
    </div>
  )
}
