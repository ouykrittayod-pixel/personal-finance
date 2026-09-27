import { useId } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ISODate } from '@/domain/entities'
import { addDaysISO, todayISO } from '@/lib/dates'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

export interface DateInputProps {
  value: ISODate
  onValueChange: (value: ISODate) => void
  label?: string
  hideLabel?: boolean
  /** Show "วันนี้ / เมื่อวาน" shortcuts (most entries are for one of these days). */
  shortcuts?: boolean
  min?: ISODate
  max?: ISODate
  /** Override "today" (tests, or a fixed reference date). */
  today?: ISODate
  id?: string
  className?: string
}

/**
 * Native date picker (best mobile keyboard/picker support, no extra dependency)
 * with one-tap shortcuts. Value is always an ISO "YYYY-MM-DD" calendar date.
 */
export function DateInput({
  value,
  onValueChange,
  label = t('form.date'),
  hideLabel = false,
  shortcuts = true,
  min,
  max,
  today = todayISO(),
  id,
  className,
}: DateInputProps) {
  const autoId = useId()
  const inputId = id ?? autoId
  const yesterday = addDaysISO(today, -1)
  const quick = [
    { label: t('form.today'), date: today },
    { label: t('form.yesterday'), date: yesterday },
  ]

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={inputId} className={cn(hideLabel && 'sr-only')}>
        {label}
      </Label>
      <div className="flex flex-wrap items-center gap-2">
        {shortcuts &&
          quick.map((item) => (
            <button
              key={item.date}
              type="button"
              aria-pressed={value === item.date}
              onClick={() => onValueChange(item.date)}
              className={cn(
                'focus-ring min-h-touch rounded-md border border-border px-3 text-sm transition-colors duration-(--duration-fast) md:min-h-9',
                'hover:bg-muted aria-pressed:border-primary aria-pressed:bg-primary/10 aria-pressed:font-medium aria-pressed:text-primary',
              )}
            >
              {item.label}
            </button>
          ))}
        <Input
          id={inputId}
          type="date"
          value={value}
          min={min}
          max={max}
          onChange={(event) => {
            if (event.target.value) onValueChange(event.target.value)
          }}
          className="w-auto min-w-40 flex-1 sm:flex-none"
        />
      </div>
    </div>
  )
}
