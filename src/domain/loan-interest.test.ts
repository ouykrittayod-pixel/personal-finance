import { describe, expect, it } from 'vitest'
import { baht, makeDebt, makeTx } from '@/test/factories'
import type { Debt, Transaction } from './entities'
import { dailyInterestSplit, daysInYear, hasDailyInterest } from './loan-interest'
import type { Satang } from './money'

const satang = (value: number) => Math.round(value * 100) as Satang

// A 3% reducing-balance loan paid 600 a month (figures from a real loan table).
const loan: Debt = makeDebt({
  id: 'sam',
  kind: 'personal_loan',
  openingBalanceSatang: satang(26_814.24),
  openingDate: '2026-02-25',
  startDate: '2026-02-25',
  interestMethod: 'reducing_balance',
  annualInterestRateBps: 300,
  installmentSatang: baht(600),
  principalAdjustments: [
    { id: 'accrued', date: '2026-02-25', amountSatang: satang(12_349.11), interestBearing: false, createdAt: 'x' },
    { id: 'fees', date: '2026-02-25', amountSatang: satang(1_245), interestBearing: false, createdAt: 'x' },
  ],
})

const pay = (date: string, principal: number, interest: number): Transaction =>
  makeTx({
    id: date,
    type: 'debt_payment',
    debtId: 'sam',
    accountId: 'bank',
    date,
    amountSatang: satang(principal + interest),
    principalSatang: satang(principal),
    interestSatang: satang(interest),
    feeSatang: 0 as Satang,
  })

// date, principal, interest — as printed in the table
const TABLE: [string, number, number][] = [
  ['2026-02-25', 600, 0],
  ['2026-03-31', 526.74, 73.26],
  ['2026-04-30', 536.66, 63.34],
  ['2026-05-29', 540.05, 59.95],
  ['2026-06-30', 535.27, 64.73],
  ['2026-07-31', 538.66, 61.34],
  ['2026-08-31', 540.03, 59.97],
  ['2026-09-30', 543.3, 56.7],
]

describe('dailyInterestSplit', () => {
  it('reproduces the loan table row by row (principal × rate × days ÷ days in year)', () => {
    const history: Transaction[] = []
    for (const [date, principal, interest] of TABLE) {
      const split = dailyInterestSplit(loan, history, { date, amountSatang: baht(600) })
      expect(split).toMatchObject({ principal: satang(principal), interest: satang(interest) })
      history.push(pay(date, principal, interest))
    }
  })

  it('charges interest on principal only — amounts owed without interest are left out', () => {
    const history = TABLE.map(([date, principal, interest]) => pay(date, principal, interest))
    const next = dailyInterestSplit(loan, history, { date: '2026-10-30', amountSatang: baht(600) })
    expect(next).toMatchObject({ base: satang(22_453.53), days: 30, daysInYear: 365, from: '2026-09-30' })
    expect(next?.interest).toBe(satang(55.36))
  })

  it('puts everything above the interest on principal when paying more', () => {
    const history = TABLE.map(([date, principal, interest]) => pay(date, principal, interest))
    const split = dailyInterestSplit(loan, history, { date: '2026-10-30', amountSatang: baht(2_000) })
    expect(split).toMatchObject({ interest: satang(55.36), principal: satang(1_944.64) })
  })

  it('leaves out the payment being edited', () => {
    const history = TABLE.map(([date, principal, interest]) => pay(date, principal, interest))
    const split = dailyInterestSplit(loan, history, { date: '2026-09-30', amountSatang: baht(600), excludeId: '2026-09-30' })
    expect(split).toMatchObject({ principal: satang(543.3), interest: satang(56.7) })
  })

  it('never charges more interest than the payment', () => {
    const split = dailyInterestSplit(loan, [pay('2026-02-25', 600, 0)], { date: '2027-02-25', amountSatang: baht(100) })
    expect(split).toMatchObject({ interest: baht(100), principal: 0 })
  })

  it('needs a reducing-balance loan with a known rate', () => {
    expect(hasDailyInterest(loan)).toBe(true)
    expect(dailyInterestSplit({ ...loan, interestMethod: 'unknown' }, [], { date: '2026-03-31', amountSatang: baht(600) })).toBeNull()
    expect(dailyInterestSplit({ ...loan, annualInterestRateBps: undefined }, [], { date: '2026-03-31', amountSatang: baht(600) })).toBeNull()
    expect(dailyInterestSplit({ ...loan, kind: 'credit_card' }, [], { date: '2026-03-31', amountSatang: baht(600) })).toBeNull()
    expect(dailyInterestSplit(loan, [], { date: '2026-02-01', amountSatang: baht(600) })).toBeNull()
  })

  it('uses 366 days in a leap year', () => {
    expect(daysInYear('2028-02-29')).toBe(366)
    expect(daysInYear('2026-10-30')).toBe(365)
    expect(daysInYear('2100-01-01')).toBe(365)
  })
})
