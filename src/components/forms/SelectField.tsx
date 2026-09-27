import { ChevronDown } from 'lucide-react'
import { useId } from 'react'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

export interface SelectOption {
  value: string
  label: string
}

export interface SelectFieldProps {
  label: string
  value: string
  options: readonly SelectOption[]
  onValueChange: (value: string) => void
  hint?: string
  error?: string
  disabled?: boolean
  className?: string
}

/**
 * Native select: the phone's own picker, full keyboard support, no extra
 * dependency. Styled like Input (44px on phones).
 */
export function SelectField({ label, value, options, onValueChange, hint, error, disabled, className }: SelectFieldProps) {
  const id = useId()
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <select
          id={id}
          value={value}
          disabled={disabled}
          onChange={(event) => onValueChange(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            'h-touch w-full appearance-none rounded-md border border-input bg-background pr-9 pl-2.5 text-base outline-none md:h-9 md:text-sm',
            'focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50',
            error && 'border-destructive',
          )}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      </div>
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="text-xs text-muted-foreground">
            {hint}
          </p>
        )
      )}
    </div>
  )
}
