import { describe, expect, it } from 'vitest'
import {
  addMonthsClamped,
  daysBetween,
  nextOccurrenceOnOrAfter,
  occurrencesBetween,
  validateRecurrence,
  weekdayOf,
  type RecurrenceRule,
} from './recurrence'

const monthly = (overrides: Partial<RecurrenceRule> = {}): RecurrenceRule => ({ frequency: 'monthly', interval: 1, startDate: '2026-01-01', ...overrides })

describe('calendar helpers', () => {
  it('clamps to month end and never produces invalid dates', () => {
    expect(addMonthsClamped('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonthsClamped('2028-01-31', 1)).toBe('2028-02-29')
    expect(addMonthsClamped('2026-01-31', 3)).toBe('2026-04-30')
    expect(addMonthsClamped('2026-12-15', 1)).toBe('2027-01-15')
    expect(addMonthsClamped('2026-03-15', -3)).toBe('2025-12-15')
  })

  it('counts days and weekdays without time zones', () => {
    expect(daysBetween('2026-09-05', '2026-09-25')).toBe(20)
    expect(daysBetween('2026-03-01', '2026-02-28')).toBe(-1)
    expect(weekdayOf('2026-09-25')).toBe(5) // Friday
  })
})

describe('monthly', () => {
  it('repeats on the configured day', () => {
    expect(occurrencesBetween(monthly({ dayOfMonth: 6 }), '2026-09-01', '2026-12-31')).toEqual(['2026-09-06', '2026-10-06', '2026-11-06', '2026-12-06'])
  })

  it('uses the last day of shorter months for day 31, then returns to 31', () => {
    expect(occurrencesBetween(monthly({ dayOfMonth: 31 }), '2026-01-01', '2026-04-30')).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'])
    expect(occurrencesBetween(monthly({ dayOfMonth: 30, startDate: '2028-01-01' }), '2028-02-01', '2028-03-31')).toEqual(['2028-02-29', '2028-03-30'])
  })

  it('never falls before the start date; defaults to the start date’s day', () => {
    expect(occurrencesBetween(monthly({ startDate: '2026-09-10', dayOfMonth: 6 }), '2026-09-01', '2026-10-31')).toEqual(['2026-10-06'])
    expect(occurrencesBetween(monthly({ startDate: '2026-09-10' }), '2026-09-01', '2026-11-30')).toEqual(['2026-09-10', '2026-10-10', '2026-11-10'])
  })

  it('supports intervals, end dates and counts, whatever window is asked for', () => {
    const everyThree = monthly({ interval: 3, dayOfMonth: 15, startDate: '2026-01-15' })
    expect(occurrencesBetween(everyThree, '2026-01-01', '2026-12-31')).toEqual(['2026-01-15', '2026-04-15', '2026-07-15', '2026-10-15'])
    expect(occurrencesBetween(everyThree, '2026-06-01', '2026-12-31')).toEqual(['2026-07-15', '2026-10-15'])
    expect(occurrencesBetween(monthly({ dayOfMonth: 1, endDate: '2026-03-01' }), '2026-01-01', '2026-12-31')).toHaveLength(3)
    const three = monthly({ dayOfMonth: 5, count: 3 })
    expect(occurrencesBetween(three, '2026-01-01', '2026-12-31')).toEqual(['2026-01-05', '2026-02-05', '2026-03-05'])
    expect(occurrencesBetween(three, '2026-03-01', '2026-12-31')).toEqual(['2026-03-05'])
  })
})

describe('weekly', () => {
  it('repeats on the chosen weekday', () => {
    // 2026-09-25 is a Friday; Monday = 1.
    expect(occurrencesBetween({ frequency: 'weekly', interval: 1, startDate: '2026-09-25', dayOfWeek: 1 }, '2026-09-01', '2026-10-14')).toEqual([
      '2026-09-28',
      '2026-10-05',
      '2026-10-12',
    ])
  })

  it('defaults to the start weekday and supports every N weeks', () => {
    expect(occurrencesBetween({ frequency: 'weekly', interval: 2, startDate: '2026-09-25' }, '2026-10-01', '2026-11-30')).toEqual([
      '2026-10-09',
      '2026-10-23',
      '2026-11-06',
      '2026-11-20',
    ])
  })
})

describe('yearly', () => {
  it('repeats on month + day', () => {
    expect(occurrencesBetween({ frequency: 'yearly', interval: 1, startDate: '2026-01-01', monthOfYear: 3, dayOfMonth: 15 }, '2026-01-01', '2028-12-31')).toEqual([
      '2026-03-15',
      '2027-03-15',
      '2028-03-15',
    ])
  })

  it('maps 29 Feb to 28 Feb in non-leap years', () => {
    expect(occurrencesBetween({ frequency: 'yearly', interval: 1, startDate: '2028-02-29' }, '2028-01-01', '2030-12-31')).toEqual(['2028-02-29', '2029-02-28', '2030-02-28'])
  })

  it('starts next year if this year’s date has passed', () => {
    expect(occurrencesBetween({ frequency: 'yearly', interval: 1, startDate: '2026-09-25', monthOfYear: 1, dayOfMonth: 10 }, '2026-01-01', '2027-12-31')).toEqual(['2027-01-10'])
  })
})

describe('validation', () => {
  it.each([
    [{ frequency: 'daily' }, 'frequency_invalid'],
    [{ interval: 0 }, 'interval_invalid'],
    [{ interval: 13 }, 'interval_invalid'],
    [{ interval: 1.5 }, 'interval_invalid'],
    [{ startDate: '2026-02-30' }, 'start_date_invalid'],
    [{ endDate: '2025-12-31' }, 'end_before_start'],
    [{ endDate: 'x' }, 'end_date_invalid'],
    [{ dayOfMonth: 32 }, 'day_of_month_invalid'],
    [{ dayOfMonth: 0 }, 'day_of_month_invalid'],
    [{ frequency: 'yearly', monthOfYear: 2, dayOfMonth: 30 }, 'day_of_month_invalid'],
    [{ frequency: 'yearly', monthOfYear: 13 }, 'month_invalid'],
    [{ frequency: 'weekly', dayOfWeek: 7 }, 'day_of_week_invalid'],
    [{ count: 0 }, 'count_invalid'],
  ] as const)('%j → %s', (overrides, issue) => {
    expect(validateRecurrence(monthly(overrides as Partial<RecurrenceRule>))).toContain(issue)
  })

  it('accepts valid rules, including 29 Feb yearly', () => {
    expect(validateRecurrence(monthly({ dayOfMonth: 31 }))).toEqual([])
    expect(validateRecurrence({ frequency: 'yearly', interval: 1, startDate: '2026-01-01', monthOfYear: 2, dayOfMonth: 29 })).toEqual([])
  })

  it('invalid rules produce no occurrences', () => {
    expect(occurrencesBetween(monthly({ startDate: '2026-02-31' }), '2026-01-01', '2026-12-31')).toEqual([])
  })
})

describe('nextOccurrenceOnOrAfter', () => {
  it('finds the next due date, or null after the end', () => {
    expect(nextOccurrenceOnOrAfter(monthly({ dayOfMonth: 6 }), '2026-09-25')).toBe('2026-10-06')
    expect(nextOccurrenceOnOrAfter(monthly({ dayOfMonth: 6 }), '2026-10-06')).toBe('2026-10-06')
    expect(nextOccurrenceOnOrAfter(monthly({ dayOfMonth: 6, endDate: '2026-09-30' }), '2026-09-25')).toBeNull()
  })
})
