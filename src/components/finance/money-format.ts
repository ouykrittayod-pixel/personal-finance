import { abs, type Satang } from '@/domain/money'
import { formatTHB } from '@/lib/formatting'

export type MoneyTone = 'income' | 'expense' | 'debt' | 'neutral' | 'muted'
export type MoneySize = 'xl' | 'lg' | 'md' | 'sm'
/**
 * - `auto`: income → "+", expense → "−", otherwise "−" only when the amount is negative.
 * - `plus` / `minus`: force the sign (magnitude is shown).
 * - `none`: magnitude only, no sign.
 */
export type MoneySign = 'auto' | 'plus' | 'minus' | 'none'

/** Typographic minus sign: same width as "+", read as "minus" by screen readers. */
export const MINUS_SIGN = '−'

export interface FormatSignedOptions {
  tone?: MoneyTone
  sign?: MoneySign
  /** Show ".00" on whole-baht amounts. Default false: "฿27,500" but "฿85.50". */
  alwaysShowDecimals?: boolean
}

function resolveSign(amount: Satang, tone: MoneyTone, sign: MoneySign): '' | '+' | typeof MINUS_SIGN {
  switch (sign) {
    case 'plus':
      return '+'
    case 'minus':
      return MINUS_SIGN
    case 'none':
      return ''
    case 'auto':
      if (amount === 0) return ''
      if (tone === 'income') return '+'
      if (tone === 'expense') return MINUS_SIGN
      return amount < 0 ? MINUS_SIGN : ''
  }
}

/** The exact text MoneyDisplay renders, e.g. "+฿27,500", "−฿85", "฿2,581,670". */
export function formatSignedMoney(amount: Satang, options: FormatSignedOptions = {}): string {
  const { tone = 'neutral', sign = 'auto', alwaysShowDecimals = false } = options
  const prefix = resolveSign(amount, tone, sign)
  return `${prefix}${formatTHB(abs(amount), { trimZeroFraction: !alwaysShowDecimals })}`
}
