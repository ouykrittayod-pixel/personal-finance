import { describe, expect, it } from 'vitest'
import { baht, makeAccount, makeTx } from '@/test/factories'
import { incomeAccountTotal, incomeCategoryTotal, incomeIn, incomePeriodTotal } from './income'
import { accountBalances, cashFlow, monthTotals } from './reporting'

const september = { start: '2026-09-01', end: '2026-09-30' }
const txs = [
  makeTx({ id: 'salary', type: 'income', amountSatang: baht(27_500), accountId: 'kbank', categoryId: 'salary', date: '2026-09-25' }),
  makeTx({ id: 'free', type: 'income', amountSatang: baht(5_000), accountId: 'scb', categoryId: 'side', date: '2026-09-10' }),
  makeTx({ id: 'bonus', type: 'income', amountSatang: baht(10_000), accountId: 'kbank', categoryId: 'bonus', date: '2026-09-12' }),
  makeTx({ id: 'aug', type: 'income', amountSatang: baht(27_500), accountId: 'kbank', categoryId: 'salary', date: '2026-08-25' }),
  // Never income:
  makeTx({ id: 'move', type: 'transfer', amountSatang: baht(5_000), accountId: 'kbank', toAccountId: 'cash', date: '2026-09-26' }),
  makeTx({ id: 'food', type: 'expense', amountSatang: baht(300), accountId: 'cash', categoryId: 'food', date: '2026-09-26' }),
  makeTx({ id: 'loan', type: 'debt_payment', amountSatang: baht(9_000), accountId: 'kbank', debtId: 'car', date: '2026-09-05' }),
  makeTx({ id: 'fix', type: 'adjustment', amountSatang: baht(100), accountId: 'cash', date: '2026-09-06' }),
]

describe('incomePeriodTotal', () => {
  it('counts income transactions only — transfers, expenses, debt payments and adjustments are never income', () => {
    expect(incomePeriodTotal(txs, september)).toEqual({ total: baht(42_500), count: 3, average: 1_416_667 })
    expect(incomeIn(txs, september).map((tx) => tx.id).sort()).toEqual(['bonus', 'free', 'salary'])
  })

  it('uses the transaction date, so a past month never includes later income', () => {
    expect(incomePeriodTotal(txs, { start: '2026-08-01', end: '2026-08-31' })).toMatchObject({ total: baht(27_500), count: 1 })
  })

  it('filters by category and by account', () => {
    expect(incomePeriodTotal(txs, september, { categoryId: 'salary' }).total).toBe(baht(27_500))
    expect(incomePeriodTotal(txs, september, { accountId: 'kbank' }).total).toBe(baht(37_500))
    expect(incomePeriodTotal(txs, september, { accountId: 'kbank', categoryId: 'side' }).count).toBe(0)
  })

  it('has no average without income (not zero)', () => {
    expect(incomePeriodTotal([], september)).toEqual({ total: 0, count: 0, average: null })
  })

  it('rounds the average half-up to whole satang (฿27,500 over 3 = ฿9,166.67)', () => {
    const three = [20_000, 5_000, 2_500].map((amount, i) => makeTx({ id: `i${i}`, type: 'income', amountSatang: baht(amount), accountId: 'a', date: '2026-09-10' }))
    expect(incomePeriodTotal(three, september)).toEqual({ total: baht(27_500), count: 3, average: baht(9_166.67) })
  })
})

describe('income breakdowns', () => {
  it('totals by category and by account, largest first', () => {
    expect(incomeCategoryTotal(txs, september)).toEqual([
      { id: 'salary', total: baht(27_500), count: 1 },
      { id: 'bonus', total: baht(10_000), count: 1 },
      { id: 'side', total: baht(5_000), count: 1 },
    ])
    expect(incomeAccountTotal(txs, september)).toEqual([
      { id: 'kbank', total: baht(37_500), count: 2 },
      { id: 'scb', total: baht(5_000), count: 1 },
    ])
  })
})

describe('income across the existing reports', () => {
  it('raises only the receiving account; a transfer moves money without creating income', () => {
    const accounts = [makeAccount({ id: 'kbank', openingBalanceSatang: baht(0) }), makeAccount({ id: 'cash', kind: 'cash', openingBalanceSatang: baht(0) })]
    const salary = makeTx({ type: 'income', amountSatang: baht(27_500), accountId: 'kbank', date: '2026-09-25' })
    const move = makeTx({ type: 'transfer', amountSatang: baht(5_000), accountId: 'kbank', toAccountId: 'cash', date: '2026-09-26' })
    const balances = accountBalances(accounts, [salary, move])
    expect(balances.get('kbank')).toBe(baht(22_500))
    expect(balances.get('cash')).toBe(baht(5_000))
    expect(monthTotals([salary, move], '2026-09')).toMatchObject({ income: baht(27_500), expense: 0, debtPayment: 0 })
    expect(cashFlow([salary, move], ['2026-09'])).toEqual([{ month: '2026-09', income: baht(27_500), expense: 0, debtPayment: 0, transfer: baht(5_000) }])
  })
})
