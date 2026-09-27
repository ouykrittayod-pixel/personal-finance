import { describe, expect, it } from 'vitest'
import {
  addDaysISO,
  addMonthsYM,
  formatDate,
  formatDateTime,
  formatYearMonth,
  isISODate,
  isYearMonth,
  monthBounds,
  monthsEnding,
  parseISODate,
  startOfWeekISO,
  toISODate,
} from '.'

describe('dates', () => {
  it('validates ISO dates', () => {
    expect(isISODate('2026-02-28')).toBe(true)
    expect(isISODate('2026-02-30')).toBe(false)
    expect(isISODate('2026-2-3')).toBe(false)
  })

  it('round-trips local dates without time-zone drift', () => {
    expect(toISODate(parseISODate('2026-01-01'))).toBe('2026-01-01')
    expect(toISODate(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31')
  })

  it('formats Thai dates with Gregorian years, not Buddhist Era', () => {
    const text = formatDate('2026-09-25', 'long')
    expect(text).toContain('2026')
    expect(text).not.toContain('2569')
    expect(text).toContain('กันยายน')
  })

  it('never shows the era marker', () => {
    expect(formatDate('2026-09-25', 'long')).toBe('25 กันยายน 2026')
    expect(formatDate('2026-09-25', 'medium')).toBe('25 ก.ย. 2026')
    expect(formatDate('2026-09-25', 'full')).not.toContain('ค.ศ.')
    expect(formatDateTime('2026-09-25T05:15:00.000Z')).toMatch(/^25 ก\.ย\. 2026 \d{2}:\d{2}$/)
  })
})

describe('addDaysISO', () => {
  it('crosses month and year boundaries', () => {
    expect(addDaysISO('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDaysISO('2028-03-01', -1)).toBe('2028-02-29')
    expect(addDaysISO('2026-12-31', 1)).toBe('2027-01-01')
  })
})

describe('year-month helpers', () => {
  it('validates and shifts months across years', () => {
    expect(isYearMonth('2026-09')).toBe(true)
    expect(isYearMonth('2026-13')).toBe(false)
    expect(isYearMonth(null)).toBe(false)
    expect(addMonthsYM('2026-01', -1)).toBe('2025-12')
    expect(addMonthsYM('2026-12', 1)).toBe('2027-01')
  })

  it('knows month bounds including leap years', () => {
    expect(monthBounds('2028-02')).toEqual({ start: '2028-02-01', end: '2028-02-29' })
    expect(monthBounds('2026-09')).toEqual({ start: '2026-09-01', end: '2026-09-30' })
  })

  it('lists the months ending with a month, oldest first', () => {
    expect(monthsEnding('2026-02', 3)).toEqual(['2025-12', '2026-01', '2026-02'])
  })

  it('formats months in Thai with Gregorian years', () => {
    expect(formatYearMonth('2026-09')).toBe('กันยายน 2026')
    expect(formatYearMonth('2026-09', 'short')).toBe('ก.ย.')
  })
})

describe('startOfWeekISO', () => {
  it('returns Monday of the same week (or Sunday when asked)', () => {
    expect(startOfWeekISO('2026-09-25')).toBe('2026-09-21') // Friday → Monday
    expect(startOfWeekISO('2026-09-21')).toBe('2026-09-21')
    expect(startOfWeekISO('2026-09-27')).toBe('2026-09-21') // Sunday belongs to the week that started Monday
    expect(startOfWeekISO('2026-09-25', 0)).toBe('2026-09-20')
    expect(startOfWeekISO('2026-01-01')).toBe('2025-12-29')
  })
})
