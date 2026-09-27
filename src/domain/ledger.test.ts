import { describe, expect, it } from 'vitest'
import { baht, makeTx } from '@/test/factories'
import { compareNewestFirst, groupByDate, inRange, matchesSearch, matchesType, normalizeSearch, totalsInRange } from './ledger'

describe('compareNewestFirst', () => {
  it('orders by date, then entry time, newest first', () => {
    const txs = [
      makeTx({ id: 'a', type: 'expense', amountSatang: baht(1), accountId: 'x', date: '2026-09-24', createdAt: '2026-09-24T10:00:00Z' }),
      makeTx({ id: 'b', type: 'expense', amountSatang: baht(1), accountId: 'x', date: '2026-09-25', createdAt: '2026-09-25T08:00:00Z' }),
      makeTx({ id: 'c', type: 'expense', amountSatang: baht(1), accountId: 'x', date: '2026-09-25', createdAt: '2026-09-25T12:00:00Z' }),
    ]
    expect([...txs].sort(compareNewestFirst).map((t) => t.id)).toEqual(['c', 'b', 'a'])
  })
})

describe('filters', () => {
  it('ranges are inclusive calendar dates', () => {
    const range = { start: '2026-09-01', end: '2026-09-30' }
    expect(inRange('2026-09-01', range)).toBe(true)
    expect(inRange('2026-09-30', range)).toBe(true)
    expect(inRange('2026-10-01', range)).toBe(false)
  })

  it('type filter', () => {
    expect(matchesType('debt_payment', 'all')).toBe(true)
    expect(matchesType('debt_payment', 'expense')).toBe(false)
    expect(matchesType('transfer', 'transfer')).toBe(true)
  })

  it('search matches every term, ignoring case and spacing', () => {
    const text = normalizeSearch('ข้าวกลางวัน  อาหาร KBank')
    expect(matchesSearch(text, 'kbank')).toBe(true)
    expect(matchesSearch(text, '  อาหาร   ข้าว ')).toBe(true)
    expect(matchesSearch(text, 'อาหาร กาแฟ')).toBe(false)
    expect(matchesSearch(text, '')).toBe(true)
  })
})

describe('totalsInRange', () => {
  const range = { start: '2026-09-01', end: '2026-09-30' }
  const txs = [
    makeTx({ type: 'income', amountSatang: baht(27_500), accountId: 'bank', date: '2026-09-01' }),
    makeTx({ type: 'expense', amountSatang: baht(85), accountId: 'cash', date: '2026-09-25' }),
    makeTx({ type: 'expense', amountSatang: baht(2_500), accountId: 'card', date: '2026-09-10' }),
    makeTx({ type: 'debt_payment', amountSatang: baht(2_500), accountId: 'bank', toAccountId: 'card', debtId: 'cc', date: '2026-09-20' }),
    makeTx({ type: 'transfer', amountSatang: baht(1_000), accountId: 'bank', toAccountId: 'cash', date: '2026-09-21' }),
    makeTx({ type: 'adjustment', amountSatang: baht(-10), accountId: 'cash', date: '2026-09-22' }),
    makeTx({ type: 'expense', amountSatang: baht(999), accountId: 'cash', date: '2026-08-31' }),
  ]

  it('sums income, expenses and debt payments separately; transfers and adjustments in neither', () => {
    expect(totalsInRange(txs, range)).toEqual({
      income: baht(27_500),
      incomeCount: 1,
      expense: baht(2_585),
      expenseCount: 2,
      debtPayment: baht(2_500),
      debtPaymentCount: 1,
    })
  })
})

describe('groupByDate', () => {
  it('groups consecutive items of the same date', () => {
    const groups = groupByDate([
      { id: 1, date: '2026-09-25' },
      { id: 2, date: '2026-09-25' },
      { id: 3, date: '2026-09-24' },
    ])
    expect(groups.map((g) => [g.date, g.items.map((i) => i.id)])).toEqual([
      ['2026-09-25', [1, 2]],
      ['2026-09-24', [3]],
    ])
  })
})
