/**
 * Calendar-date helpers.
 *
 * Financial dates are stored as local "YYYY-MM-DD" strings (ISODate), not
 * timestamps, so a transaction on 1 Jan never shifts to 31 Dec because of a
 * time-zone conversion. Display uses the Gregorian calendar (see APP_LOCALE).
 */
import { addDays, addMonths, lastDayOfMonth } from 'date-fns'
import type { ISODate } from '@/domain/entities'
import { APP_LOCALE } from '@/lib/i18n'

// Parsing/formatting "YYYY-MM-DD" by hand keeps date-fns' large parse/format
// modules out of the bundle; only small arithmetic helpers are imported.
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

const pad = (value: number, length = 2) => String(value).padStart(length, '0')

/** Local midnight of the given calendar day, or null if the string is not a real date. */
function toLocalDate(value: string): Date | null {
  const match = ISO_DATE_PATTERN.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day)
  date.setFullYear(year) // years 0–99 would otherwise map to 1900–1999
  const valid = date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
  return valid ? date : null
}

export function isISODate(value: string): value is ISODate {
  return toLocalDate(value) !== null
}

/** Local calendar date of a Date object. */
export function toISODate(date: Date): ISODate {
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Parse "YYYY-MM-DD" as a local date at midnight. */
export function parseISODate(value: ISODate): Date {
  const date = toLocalDate(value)
  if (!date) throw new RangeError(`Invalid ISO date: "${value}"`)
  return date
}

export function todayISO(now: Date = new Date()): ISODate {
  return toISODate(now)
}

const dateFormatters = new Map<string, Intl.DateTimeFormat>()

export type DateStyle = 'short' | 'medium' | 'long' | 'full'

const pad2 = (n: number) => String(n).padStart(2, '0')

/** "25/09/2026": day/month/Gregorian year, always zero-padded. */
function ddmmyyyy(date: Date): string {
  return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()}`
}

/**
 * Every date in the app reads dd/mm/yyyy with the Gregorian year: "25/09/2026"
 * (never the Buddhist year, never a month name). 'full' adds the weekday:
 * "วันศุกร์ 25/09/2026". Months on their own use formatYearMonth.
 */
export function formatDate(value: ISODate | Date, style: DateStyle = 'medium', locale: string = APP_LOCALE): string {
  const date = typeof value === 'string' ? parseISODate(value) : value
  if (style !== 'full') return ddmmyyyy(date)
  const key = `${locale}|weekday`
  let formatter = dateFormatters.get(key)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, { weekday: 'long' })
    dateFormatters.set(key, formatter)
  }
  return `${formatter.format(date)} ${ddmmyyyy(date)}`
}

/**
 * First day of the week containing `value`. Weeks start on Monday by default
 * (ISO 8601); pass 0 for Sunday.
 */
export function startOfWeekISO(value: ISODate, weekStartsOn: 0 | 1 = 1): ISODate {
  const offset = (parseISODate(value).getDay() - weekStartsOn + 7) % 7
  return addDaysISO(value, -offset)
}

/** Shift a calendar date by whole days, e.g. addDaysISO('2026-03-01', -1) → '2026-02-28'. */
export function addDaysISO(value: ISODate, days: number): ISODate {
  return toISODate(addDays(parseISODate(value), days))
}

// ---------------------------------------------------------------------------
// Months ("YYYY-MM")
// ---------------------------------------------------------------------------

/** A calendar month, "YYYY-MM". The first 7 characters of an ISODate. */
export type YearMonth = string

const YEAR_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/

export function isYearMonth(value: string | null | undefined): value is YearMonth {
  return typeof value === 'string' && YEAR_MONTH_PATTERN.test(value)
}

export function yearMonthOf(date: ISODate): YearMonth {
  return date.slice(0, 7)
}

export function addMonthsYM(month: YearMonth, months: number): YearMonth {
  return yearMonthOf(toISODate(addMonths(parseISODate(`${month}-01`), months)))
}

/** First and last calendar day of a month. */
export function monthBounds(month: YearMonth): { start: ISODate; end: ISODate } {
  const first = parseISODate(`${month}-01`)
  return { start: toISODate(first), end: toISODate(lastDayOfMonth(first)) }
}

/** The `count` months ending with `month`, oldest first. */
export function monthsEnding(month: YearMonth, count: number): YearMonth[] {
  return Array.from({ length: count }, (_, index) => addMonthsYM(month, index - count + 1))
}

const monthFormatters = new Map<string, Intl.DateTimeFormat>()

/** "กันยายน 2026" (long) or "ก.ย." (short, no year) or "ก.ย. 2026" (shortYear), Gregorian. */
export function formatYearMonth(month: YearMonth, style: 'long' | 'short' | 'shortYear' = 'long', locale: string = APP_LOCALE): string {
  const key = `${locale}|${style}`
  let formatter = monthFormatters.get(key)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(
      locale,
      style === 'long'
        ? { month: 'long', year: 'numeric' }
        : style === 'short'
          ? { month: 'short' }
          : { month: 'short', year: 'numeric' },
    )
    monthFormatters.set(key, formatter)
  }
  return formatter.format(parseISODate(`${month}-01`))
}

/** A UTC timestamp shown in local time: "25/09/2026 12:15". */
export function formatDateTime(timestamp: string): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return timestamp
  return `${ddmmyyyy(date)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

const weekdayFormatter = new Intl.DateTimeFormat(APP_LOCALE, { weekday: 'long' })
const monthFormatter = new Intl.DateTimeFormat(APP_LOCALE, { month: 'long' })

/** "วันจันทร์" for 1 (0 = Sunday … 6 = Saturday). */
export function weekdayName(dayOfWeek: number): string {
  // 2026-01-04 is a Sunday.
  return weekdayFormatter.format(new Date(2026, 0, 4 + dayOfWeek))
}

/** "กันยายน" for 9. */
export function monthName(month: number): string {
  return monthFormatter.format(new Date(2026, month - 1, 1))
}
