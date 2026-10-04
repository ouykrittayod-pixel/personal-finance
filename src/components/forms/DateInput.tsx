import { CalendarDays } from 'lucide-react'
import { useId } from 'react'
import { Label } from '@/components/ui/label'
import type { ISODate } from '@/domain/entities'
import { addDaysISO, formatDate, isISODate, todayISO } from '@/lib/dates'
import { t } from '@/lib/i18n'
import { cn } from '@/lib/utils'

export interface DateInputProps {
  value: ISODate
  onValueChange: (value: ISODate) => void
  label?: string
  hideLabel?: boolean
  /** Show "วันนี้ / เมื่อวาน" shortcuts (most entries are for one of these days). */
  shortcuts?: boolean
  /** More one-tap dates after today / yesterday (e.g. a bill's due date). */
  extraShortcuts?: readonly { label: string; date: ISODate }[]
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
 *
 * The field always reads dd/mm/yyyy (Gregorian), whatever the phone's region:
 * the formatted date is drawn underneath and the native input sits on top,
 * transparent, so a tap still opens the phone's own picker.
 */
export function DateInput({
  value,
  onValueChange,
  label = t('form.date'),
  hideLabel = false,
  shortcuts = true,
  extraShortcuts = [],
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
    ...extraShortcuts.filter((item) => item.date !== today && item.date !== yesterday),
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
        <div
          className={cn(
            'relative flex min-h-touch min-w-40 flex-1 items-center gap-2 rounded-md border border-input bg-transparent px-2.5 text-base md:min-h-9 md:text-sm sm:flex-none',
            'focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50',
          )}
        >
          <span aria-hidden="true" className="tabular-nums">
            {isISODate(value) ? formatDate(value) : 'dd/mm/yyyy'}
          </span>
          <CalendarDays aria-hidden="true" className="ml-auto size-4 text-muted-foreground" />
          <input
            id={inputId}
            type="date"
            value={value}
            min={min}
            max={max}
            onChange={(event) => {
              if (event.target.value) onValueChange(event.target.value)
            }}
            onClick={(event) => {
              // Desktop browsers open the picker only from their own icon; open it from anywhere on the field.
              try {
                event.currentTarget.showPicker?.()
              } catch {
                // Not allowed here (e.g. already open): the native behaviour still works.
              }
            }}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
          />
        </div>
      </div>
    </div>
  )
}
