import { useId, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface ChoiceOption {
  value: string
  label: string
  /** Emoji or Lucide icon element. */
  icon?: ReactNode
  /** Secondary line, e.g. an account balance. */
  description?: ReactNode
}

export interface ChoiceGroupProps {
  legend: string
  hideLegend?: boolean
  options: readonly ChoiceOption[]
  value: string | undefined
  onValueChange: (value: string) => void
  /** `grid`: tiles with icon above label. `scroll`: one horizontally scrollable row of chips. */
  layout: 'grid' | 'scroll'
  name?: string
  className?: string
}

/**
 * Single-choice picker built on native radio inputs: arrow keys, Tab and
 * screen-reader semantics work without custom keyboard code.
 */
export function ChoiceGroup({
  legend,
  hideLegend = false,
  options,
  value,
  onValueChange,
  layout,
  name,
  className,
}: ChoiceGroupProps) {
  const autoName = useId()
  const groupName = name ?? autoName

  return (
    <fieldset className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <legend className={cn('mb-1.5 text-sm font-medium', hideLegend && 'sr-only')}>{legend}</legend>
      <div
        className={cn(
          layout === 'grid'
            ? 'grid grid-cols-4 gap-2 sm:grid-cols-6'
            : '-mx-page-x flex snap-x gap-2 overflow-x-auto px-page-x pb-1 [scrollbar-width:none] md:mx-0 md:flex-wrap md:px-0',
        )}
      >
        {options.map((option) => (
          <label key={option.value} className={cn('relative', layout === 'scroll' && 'shrink-0 snap-start')}>
            <input
              type="radio"
              name={groupName}
              value={option.value}
              checked={value === option.value}
              onChange={() => onValueChange(option.value)}
              className="peer sr-only"
            />
            <span
              className={cn(
                'flex cursor-pointer select-none rounded-md border border-border bg-background text-sm transition-colors duration-(--duration-fast)',
                'hover:bg-muted peer-checked:border-primary peer-checked:bg-primary/10 peer-checked:font-medium peer-checked:text-primary',
                'peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background',
                layout === 'grid'
                  ? 'min-h-16 flex-col items-center justify-center gap-1 px-1 py-2 text-center text-xs'
                  : 'min-h-touch items-center gap-2 px-3 md:min-h-9',
              )}
            >
              {option.icon && (
                <span aria-hidden="true" className={cn('leading-none [&_svg]:size-5', layout === 'grid' && 'text-xl')}>
                  {option.icon}
                </span>
              )}
              <span className={cn('flex flex-col', layout === 'grid' && 'items-center')}>
                <span className={cn(layout === 'grid' ? 'line-clamp-2' : 'whitespace-nowrap')}>{option.label}</span>
                {option.description && (
                  <span className="text-xs font-normal text-muted-foreground">{option.description}</span>
                )}
              </span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}
