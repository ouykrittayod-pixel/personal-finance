import { toDecimalString, type Satang } from '@/domain/money'
import { cn } from '@/lib/utils'
import { formatSignedMoney, type FormatSignedOptions, type MoneySize, type MoneyTone } from './money-format'

/**
 * Presentation only: shows an amount with the right sign, colour and size.
 * It never calculates — callers pass the final amount.
 */

const TONE_CLASS: Record<MoneyTone, string> = {
  income: 'text-income',
  expense: 'text-expense',
  debt: 'text-debt',
  neutral: 'text-foreground',
  muted: 'text-muted-foreground',
}

const SIZE_CLASS: Record<MoneySize, string> = {
  xl: 'amount-xl',
  lg: 'amount-lg',
  md: 'amount-md',
  sm: 'amount-sm',
}

export interface MoneyDisplayProps extends FormatSignedOptions {
  amount: Satang
  size?: MoneySize
  className?: string
}

export function MoneyDisplay({
  amount,
  tone = 'neutral',
  sign = 'auto',
  size = 'md',
  alwaysShowDecimals = false,
  className,
}: MoneyDisplayProps) {
  return (
    <data
      value={toDecimalString(amount)}
      data-tone={tone}
      className={cn('tabular-nums-money whitespace-nowrap', SIZE_CLASS[size], TONE_CLASS[tone], className)}
    >
      {formatSignedMoney(amount, { tone, sign, alwaysShowDecimals })}
    </data>
  )
}
