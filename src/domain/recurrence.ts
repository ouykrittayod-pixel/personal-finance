/**
 * Recurrence rules for recurring obligations and debt installments, and the
 * one occurrence engine that expands them into due dates.
 *
 * Pure and deterministic: calendar dates in, calendar dates out. Date maths
 * uses UTC-based day numbers, so no time zone or DST can shift a date.
 *
 * Month-end rule: a day that does not exist in a month is clamped to that
 * month's last day (31 Jan → 28/29 Feb → 31 Mar). Yearly 29 Feb → 28 Feb in
 * non-leap years. Invalid dates are never produced.
 */
import type { ISODate } from './entities'

export type RecurrenceFrequency = 'weekly' | 'monthly' | 'yearly'
export const RECURRENCE_FREQUENCIES: readonly RecurrenceFrequency[] = ['weekly', 'monthly', 'yearly']

/** 0 = Sunday … 6 = Saturday (JavaScript convention). */
export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6

export interface RecurrenceRule {
  frequency: RecurrenceFrequency
  /** Every N periods (1 = every month). */
  interval: number
  /** First possible due date; also the default anchor for weekday / day of month. */
  startDate: ISODate
  /** Optional last possible due date (inclusive). */
  endDate?: ISODate
  /** monthly/yearly: day of month 1–31, clamped to the last day of shorter months. */
  dayOfMonth?: number
  /** yearly: month 1–12. */
  monthOfYear?: number
  /** weekly: weekday. Defaults to the start date's weekday. */
  dayOfWeek?: DayOfWeek
  /** Stop after this many occurrences (counted from the start date). */
  count?: number
}

// ---------------------------------------------------------------------------
// Calendar helpers (UTC day arithmetic on ISO dates)
// ---------------------------------------------------------------------------

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/
const MS_PER_DAY = 86_400_000

interface YMD {
  year: number
  month: number // 1–12
  day: number
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function parse(value: ISODate): YMD | null {
  const match = ISO.exec(value)
  if (!match) return null
  const ymd = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
  if (ymd.month < 1 || ymd.month > 12 || ymd.day < 1 || ymd.day > daysInMonth(ymd.year, ymd.month)) return null
  return ymd
}

function mustParse(value: ISODate): YMD {
  const ymd = parse(value)
  if (!ymd) throw new RangeError(`Invalid ISO date: "${value}"`)
  return ymd
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0')
const format = ({ year, month, day }: YMD): ISODate => `${pad(year, 4)}-${pad(month)}-${pad(day)}`
const toDayNumber = (value: ISODate) => {
  const { year, month, day } = mustParse(value)
  return Date.UTC(year, month - 1, day) / MS_PER_DAY
}
const fromDayNumber = (n: number): ISODate => {
  const date = new Date(n * MS_PER_DAY)
  return format({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() })
}

export function isValidDate(value: string): boolean {
  return parse(value) !== null
}

export function addDays(value: ISODate, days: number): ISODate {
  return fromDayNumber(toDayNumber(value) + days)
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: ISODate, to: ISODate): number {
  return toDayNumber(to) - toDayNumber(from)
}

/** Same day `months` later, clamped to the month's last day. */
export function addMonthsClamped(value: ISODate, months: number, day?: number): ISODate {
  const ymd = mustParse(value)
  const index = ymd.year * 12 + (ymd.month - 1) + months
  const year = Math.floor(index / 12)
  const month = (index % 12) + 1
  return format({ year, month, day: Math.min(day ?? ymd.day, daysInMonth(year, month)) })
}

export function weekdayOf(value: ISODate): DayOfWeek {
  return new Date(toDayNumber(value) * MS_PER_DAY).getUTCDay() as DayOfWeek
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type RecurrenceIssue =
  | 'frequency_invalid'
  | 'interval_invalid'
  | 'start_date_invalid'
  | 'end_date_invalid'
  | 'end_before_start'
  | 'day_of_month_invalid'
  | 'month_invalid'
  | 'day_of_week_invalid'
  | 'count_invalid'

/** Maximum interval per frequency (keeps rules sensible, e.g. every 1–12 months). */
export const MAX_INTERVAL: Record<RecurrenceFrequency, number> = { weekly: 52, monthly: 12, yearly: 10 }

export function validateRecurrence(rule: RecurrenceRule): RecurrenceIssue[] {
  const issues: RecurrenceIssue[] = []
  if (!RECURRENCE_FREQUENCIES.includes(rule.frequency)) issues.push('frequency_invalid')
  else if (!Number.isInteger(rule.interval) || rule.interval < 1 || rule.interval > MAX_INTERVAL[rule.frequency]) issues.push('interval_invalid')
  if (!isValidDate(rule.startDate)) issues.push('start_date_invalid')
  if (rule.endDate !== undefined) {
    if (!isValidDate(rule.endDate)) issues.push('end_date_invalid')
    else if (isValidDate(rule.startDate) && rule.endDate < rule.startDate) issues.push('end_before_start')
  }
  if (rule.dayOfMonth !== undefined && (!Number.isInteger(rule.dayOfMonth) || rule.dayOfMonth < 1 || rule.dayOfMonth > 31)) {
    issues.push('day_of_month_invalid')
  }
  if (rule.frequency === 'yearly' && rule.monthOfYear !== undefined) {
    if (!Number.isInteger(rule.monthOfYear) || rule.monthOfYear < 1 || rule.monthOfYear > 12) issues.push('month_invalid')
    // 29 Feb is allowed (clamped in other years); 30/31 Feb or 31 Apr are not.
    else if (rule.dayOfMonth !== undefined && rule.dayOfMonth > daysInMonth(2024, rule.monthOfYear)) issues.push('day_of_month_invalid')
  }
  if (rule.dayOfWeek !== undefined && (!Number.isInteger(rule.dayOfWeek) || rule.dayOfWeek < 0 || rule.dayOfWeek > 6)) {
    issues.push('day_of_week_invalid')
  }
  if (rule.count !== undefined && (!Number.isInteger(rule.count) || rule.count < 1)) issues.push('count_invalid')
  return issues
}

// ---------------------------------------------------------------------------
// Occurrence engine
// ---------------------------------------------------------------------------

/** Safety valve: never expand more than this many dates in one call. */
const MAX_OCCURRENCES = 1_000

/**
 * All due dates of `rule` within [from, to] (inclusive), oldest first.
 * Occurrences are counted from the start date, so `count` and `interval`
 * behave the same whatever window is requested.
 */
export function occurrencesBetween(rule: RecurrenceRule, from: ISODate, to: ISODate): ISODate[] {
  if (validateRecurrence(rule).length > 0 || to < from) return []
  const last = rule.endDate !== undefined && rule.endDate < to ? rule.endDate : to
  const start = mustParse(rule.startDate)
  const result: ISODate[] = []

  const emit = (date: ISODate, index: number): 'stop' | 'continue' => {
    if (rule.count !== undefined && index >= rule.count) return 'stop'
    if (date > last) return 'stop'
    if (date >= rule.startDate && date >= from) result.push(date)
    return result.length >= MAX_OCCURRENCES ? 'stop' : 'continue'
  }

  switch (rule.frequency) {
    case 'weekly': {
      const weekday = rule.dayOfWeek ?? weekdayOf(rule.startDate)
      const first = addDays(rule.startDate, (weekday - weekdayOf(rule.startDate) + 7) % 7)
      const step = 7 * rule.interval
      // Jump near the window instead of walking from the start (index kept exact for `count`).
      let index = from > first ? Math.max(0, Math.floor(daysBetween(first, from) / step)) : 0
      for (;; index += 1) if (emit(addDays(first, index * step), index) === 'stop') break
      break
    }
    case 'monthly': {
      const day = rule.dayOfMonth ?? start.day
      // Occurrence 0 is in the start month, or the next month if that month's day is before the start date.
      const offset = addMonthsClamped(format({ ...start, day: 1 }), 0, day) < rule.startDate ? 1 : 0
      let index = 0
      if (from > rule.startDate) {
        const fromYmd = mustParse(from)
        const monthsAhead = (fromYmd.year - start.year) * 12 + (fromYmd.month - start.month)
        index = Math.max(0, Math.floor((monthsAhead - offset) / rule.interval) - 1)
      }
      for (;; index += 1) {
        const date = addMonthsClamped(format({ ...start, day: 1 }), offset + index * rule.interval, day)
        if (emit(date, index) === 'stop') break
      }
      break
    }
    case 'yearly': {
      const month = rule.monthOfYear ?? start.month
      const day = rule.dayOfMonth ?? start.day
      const at = (year: number) => format({ year, month, day: Math.min(day, daysInMonth(year, month)) })
      const firstYear = at(start.year) < rule.startDate ? start.year + 1 : start.year
      let index = 0
      if (from > rule.startDate) index = Math.max(0, Math.floor((mustParse(from).year - firstYear) / rule.interval) - 1)
      for (;; index += 1) if (emit(at(firstYear + index * rule.interval), index) === 'stop') break
      break
    }
  }
  return result
}

/** The first due date on or after `date`, or null if the rule has ended. */
export function nextOccurrenceOnOrAfter(rule: RecurrenceRule, date: ISODate): ISODate | null {
  // Every supported rule repeats at least once in 10 years × interval; look a little further to be safe.
  const horizon = addMonthsClamped(date, 12 * MAX_INTERVAL.yearly + 12)
  return occurrencesBetween(rule, date, horizon).at(0) ?? null
}
