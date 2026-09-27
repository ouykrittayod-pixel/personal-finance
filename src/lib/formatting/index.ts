/**
 * App-level display formatting bound to the current locale.
 * Domain code should use domain/money directly; UI code imports from here.
 */
import { formatMoney, toDecimalString, type FormatMoneyOptions, type Satang } from '@/domain/money'
import { APP_LOCALE } from '@/lib/i18n'

export { formatDate, formatDateTime } from '@/lib/dates'

export function formatTHB(amount: Satang, options: Omit<FormatMoneyOptions, 'locale'> = {}): string {
  return formatMoney(amount, { ...options, locale: APP_LOCALE })
}

let compactFormatter: Intl.NumberFormat | undefined

/** Short axis/tick label, e.g. 2,500,000 satang → "฿25K" style per locale. Display only. */
export function formatCompactTHB(amount: Satang): string {
  compactFormatter ??= new Intl.NumberFormat(APP_LOCALE, { notation: 'compact', maximumFractionDigits: 1 })
  // Exact decimal string in, so no float conversion of the amount.
  return `฿${compactFormatter.format(toDecimalString(amount) as unknown as number)}`
}

/** Basis points → one-decimal percent, half-up: 4,167 → "41.7%", 7,000 → "70%". Integer maths only. */
export function formatPercentBps1(bps: number): string {
  const tenths = Math.floor((Math.abs(bps) + 5) / 10)
  const text = `${Math.floor(tenths / 10)}${tenths % 10 ? `.${tenths % 10}` : ''}%`
  return bps < 0 ? `-${text}` : text
}

/** Basis points → whole percent for scanning, e.g. 3860 → "39%". Integer maths only. */
export function formatPercentBps(bps: number): string {
  return `${Math.floor((bps + 50) / 100)}%`
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const

/** Human-readable file size, e.g. 1536 → "1.5 KB". (Not money — floats are fine here.) */
export function formatBytes(bytes: number): string {
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  const digits = unit === 0 || value >= 10 ? 0 : 1
  return `${new Intl.NumberFormat(APP_LOCALE, { maximumFractionDigits: digits }).format(value)} ${BYTE_UNITS[unit]}`
}
