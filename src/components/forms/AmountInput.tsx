import { useId, useState, type ComponentProps } from 'react'
import { formatMoney, tryParseBaht, type Satang } from '@/domain/money'
import { Label } from '@/components/ui/label'
import { APP_LOCALE, t } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { sanitizeAmountText } from './amount-text'

export type AmountTone = 'expense' | 'income' | 'debt' | 'neutral'

const TONE_CLASS: Record<AmountTone, string> = {
  expense: 'text-expense',
  income: 'text-income',
  debt: 'text-debt',
  neutral: 'text-foreground',
}

export interface AmountInputProps extends Omit<ComponentProps<'input'>, 'value' | 'onChange' | 'type' | 'size' | 'inputMode'> {
  /** Raw text as typed (controlled). */
  value: string
  /** Called with the cleaned text and its satang value (null when empty or invalid). */
  onValueChange: (text: string, amount: Satang | null) => void
  label?: string
  hideLabel?: boolean
  /** External validation message (e.g. from react-hook-form). */
  error?: string
  /** Colours the digits to confirm what kind of entry this is. */
  tone?: AmountTone
  size?: 'lg' | 'md'
}

/**
 * Large, fast money entry: numeric keypad on mobile (`inputMode="decimal"`),
 * ฿ prefix, 16px+ text (no iOS zoom), grouped digits after blur.
 * Parsing uses domain/money (integer satang) — no floating point.
 */
export function AmountInput({
  value,
  onValueChange,
  label = t('form.amount'),
  hideLabel = false,
  error,
  tone = 'neutral',
  size = 'lg',
  id,
  className,
  onBlur,
  onFocus,
  ...props
}: AmountInputProps) {
  const autoId = useId()
  const inputId = id ?? autoId
  const messageId = `${inputId}-message`
  const [touched, setTouched] = useState(false)

  const parsed = value.trim() === '' ? null : tryParseBaht(value)
  const invalidText = value.trim() !== '' && parsed === null
  const message = error ?? (touched && invalidText ? t('form.amountInvalid') : undefined)

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={inputId} className={cn(hideLabel && 'sr-only')}>
        {label}
      </Label>
      <div
        className={cn(
          'flex items-center gap-2 rounded-md border border-input bg-background px-3 transition-colors duration-(--duration-fast)',
          'focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/40',
          message && 'border-destructive focus-within:ring-destructive/20',
          size === 'lg' ? 'h-16' : 'h-touch md:h-10',
        )}
      >
        <span aria-hidden="true" className={cn('text-muted-foreground', size === 'lg' ? 'amount-lg' : 'text-base')}>
          ฿
        </span>
        <input
          id={inputId}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="next"
          placeholder="0"
          value={value}
          aria-invalid={message ? true : undefined}
          aria-describedby={message ? messageId : undefined}
          onChange={(event) => {
            const text = sanitizeAmountText(event.target.value)
            onValueChange(text, text === '' ? null : tryParseBaht(text))
          }}
          onFocus={(event) => {
            // Remove grouping so the caret moves predictably while editing.
            if (value.includes(',')) onValueChange(value.replace(/,/g, ''), parsed)
            onFocus?.(event)
          }}
          onBlur={(event) => {
            setTouched(true)
            if (parsed !== null) {
              onValueChange(formatMoney(parsed, { locale: APP_LOCALE, symbol: false, trimZeroFraction: true }), parsed)
            }
            onBlur?.(event)
          }}
          className={cn(
            // self-stretch: the whole box height is the tap target, not just the text line.
            'tabular-nums-money min-w-0 flex-1 self-stretch bg-transparent outline-none placeholder:text-muted-foreground/60',
            size === 'lg' ? 'amount-lg' : 'text-base',
            TONE_CLASS[tone],
          )}
          {...props}
        />
      </div>
      {message && (
        <p id={messageId} className="text-xs text-destructive">
          {message}
        </p>
      )}
    </div>
  )
}
