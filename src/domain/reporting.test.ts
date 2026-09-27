import { describe, expect, it } from 'vitest'
import { baht, makeAccount, makeDebt, makeScheduled, makeTx } from '@/test/factories'
import type { Transaction } from './entities'
import { satang } from './money'
import {
  accountBalances,
  availableMoney,
  cashFlow,
  debtSummary,
  monthTotals,
  OTHER_CATEGORIES,
  recentTransactions,
  spendingByCategory,
  UNCATEGORIZED,
  upcomingPayments,
} from './reporting'

const bank = makeAccount({ id: 'bank', kind: 'bank', openingBalanceSatang: baht(10_000) })
const cash = makeAccount({ id: 'cash', kind: 'cash', openingBalanceSatang: baht(500) })
const card = makeAccount({ id: 'card', kind: 'credit_card' })
const accounts = [bank, cash, card]

describe('monthTotals', () => {
  it('sums income and expenses of the month only', () => {
    const txs = [
      makeTx({ type: 'income', amountSatang: baht(27_500), accountId: 'bank', date: '2026-09-01' }),
      makeTx({ type: 'income', amountSatang: baht(1_000), accountId: 'bank', date: '2026-08-31' }),
      makeTx({ type: 'expense', amountSatang: baht(85), accountId: 'cash', date: '2026-09-25' }),
      makeTx({ type: 'expense', amountSatang: satang(4550), accountId: 'cash', date: '2026-09-30' }),
      makeTx({ type: 'expense', amountSatang: baht(999), accountId: 'cash', date: '2026-10-01' }),
    ]
    const totals = monthTotals(txs, '2026-09')
    expect(totals.income).toBe(baht(27_500))
    expect(totals.incomeCount).toBe(1)
    expect(totals.expense).toBe(baht(85) + satang(4550))
    expect(totals.expenseCount).toBe(2)
  })

  it('ignores transfers and adjustments', () => {
    const txs = [
      makeTx({ type: 'transfer', amountSatang: baht(100), accountId: 'bank', toAccountId: 'cash' }),
      makeTx({ type: 'adjustment', amountSatang: baht(-20), accountId: 'cash' }),
    ]
    const totals = monthTotals(txs, '2026-09')
    expect(totals.income).toBe(0)
    expect(totals.expense).toBe(0)
  })

  it('does not count a credit-card payment as an expense', () => {
    const txs = [
      makeTx({ type: 'expense', amountSatang: baht(500), accountId: 'card', categoryId: 'food' }),
      makeTx({ type: 'debt_payment', amountSatang: baht(500), accountId: 'bank', toAccountId: 'card', debtId: 'cc' }),
    ]
    const totals = monthTotals(txs, '2026-09')
    expect(totals.expense).toBe(baht(500))
    expect(totals.expenseCount).toBe(1)
    expect(totals.debtPayment).toBe(baht(500))
  })
})

describe('accountBalances / availableMoney', () => {
  it('applies opening balances and transaction effects', () => {
    const txs = [
      makeTx({ type: 'income', amountSatang: baht(1_000), accountId: 'bank' }),
      makeTx({ type: 'expense', amountSatang: baht(200), accountId: 'cash' }),
      makeTx({ type: 'expense', amountSatang: baht(300), accountId: 'card' }),
      makeTx({ type: 'transfer', amountSatang: baht(100), accountId: 'bank', toAccountId: 'cash' }),
    ]
    const balances = accountBalances(accounts, txs)
    expect(balances.get('bank')).toBe(baht(10_900))
    expect(balances.get('cash')).toBe(baht(400))
    expect(balances.get('card')).toBe(baht(-300))
  })

  it('ignores transactions dated before an account was opened', () => {
    const late = makeAccount({ id: 'late', openingBalanceSatang: baht(50), openingDate: '2026-09-10' })
    const balances = accountBalances([late], [
      makeTx({ type: 'expense', amountSatang: baht(10), accountId: 'late', date: '2026-09-09' }),
      makeTx({ type: 'expense', amountSatang: baht(5), accountId: 'late', date: '2026-09-10' }),
    ])
    expect(balances.get('late')).toBe(baht(45))
  })

  it('counts only liquid, open asset accounts as available money', () => {
    const invest = makeAccount({ id: 'inv', kind: 'investment', openingBalanceSatang: baht(99_999) })
    const closed = makeAccount({ id: 'old', kind: 'bank', openingBalanceSatang: baht(7), archivedAt: '2026-02-01T00:00:00Z' })
    const all = [...accounts, invest, closed]
    const result = availableMoney(all, accountBalances(all, []))
    expect(result.total).toBe(baht(10_500))
    expect(result.accountCount).toBe(2)
  })

  it('is zero with no accounts', () => {
    expect(availableMoney([], new Map())).toEqual({ total: 0, accountCount: 0 })
  })
})

describe('spendingByCategory', () => {
  const txs = [
    makeTx({ type: 'expense', amountSatang: baht(3_250), accountId: 'cash', categoryId: 'food' }),
    makeTx({ type: 'expense', amountSatang: baht(1_240), accountId: 'cash', categoryId: 'travel' }),
    makeTx({ type: 'expense', amountSatang: baht(1_850), accountId: 'cash', categoryId: 'shop' }),
    makeTx({ type: 'expense', amountSatang: baht(780), accountId: 'cash', categoryId: 'drink' }),
    makeTx({ type: 'expense', amountSatang: baht(600), accountId: 'cash' }),
    makeTx({ type: 'expense', amountSatang: baht(700), accountId: 'cash', categoryId: 'food', date: '2026-08-01' }),
    makeTx({ type: 'income', amountSatang: baht(5_000), accountId: 'bank', categoryId: 'salary' }),
    makeTx({ type: 'debt_payment', amountSatang: baht(2_500), accountId: 'bank', debtId: 'cc' }),
  ]

  it('groups the month’s expenses by category, largest first, with shares summing to 100%', () => {
    const result = spendingByCategory(txs, '2026-09')
    expect(result.total).toBe(baht(7_720))
    expect(result.items.map((i) => i.key)).toEqual(['food', 'shop', 'travel', 'drink', UNCATEGORIZED])
    expect(result.items[0]).toEqual({ key: 'food', amount: baht(3_250), shareBps: 4210 })
    expect(result.items.reduce((acc, i) => acc + i.shareBps, 0)).toBe(10_000)
  })

  it('merges the smallest groups into "other" beyond maxSlices', () => {
    const result = spendingByCategory(txs, '2026-09', 3)
    expect(result.items.map((i) => i.key)).toEqual(['food', 'shop', OTHER_CATEGORIES])
    expect(result.items[2]?.amount).toBe(baht(1_240 + 780 + 600))
    expect(result.total).toBe(baht(7_720))
  })

  it('is empty for a month without expenses', () => {
    expect(spendingByCategory(txs, '2026-07')).toEqual({ total: 0, items: [] })
  })
})

describe('cashFlow', () => {
  it('keeps income, expense, debt payments and transfers as separate series per month', () => {
    const txs = [
      makeTx({ type: 'income', amountSatang: baht(27_500), accountId: 'bank', date: '2026-08-25' }),
      makeTx({ type: 'expense', amountSatang: baht(300), accountId: 'card', date: '2026-08-02' }),
      makeTx({ type: 'debt_payment', amountSatang: baht(300), accountId: 'bank', toAccountId: 'card', debtId: 'cc', date: '2026-09-05' }),
      makeTx({ type: 'transfer', amountSatang: baht(50), accountId: 'bank', toAccountId: 'cash', date: '2026-09-06' }),
      makeTx({ type: 'expense', amountSatang: baht(1), accountId: 'cash', date: '2026-01-01' }),
    ]
    expect(cashFlow(txs, ['2026-08', '2026-09'])).toEqual([
      { month: '2026-08', income: baht(27_500), expense: baht(300), debtPayment: 0, transfer: 0 },
      { month: '2026-09', income: 0, expense: 0, debtPayment: baht(300), transfer: baht(50) },
    ])
  })
})

describe('upcomingPayments', () => {
  const options = { today: '2026-09-25', until: '2026-09-30', dueSoonUntil: '2026-10-02' }

  it('lists unpaid payments due by the period end, overdue first, and totals them', () => {
    const result = upcomingPayments(
      [
        makeScheduled({ id: 'a', sourceId: 'rent', dueDate: '2026-09-28', expectedAmountSatang: baht(7_700) }),
        makeScheduled({ id: 'b', sourceId: 'net', dueDate: '2026-09-20', expectedAmountSatang: baht(599) }),
        makeScheduled({ id: 'c', sourceId: 'car', dueDate: '2026-10-01', expectedAmountSatang: baht(9_000) }),
        makeScheduled({ id: 'd', sourceId: 'gym', dueDate: '2026-09-10', status: 'paid', expectedAmountSatang: baht(1) }),
        makeScheduled({ id: 'e', sourceId: 'tv', dueDate: '2026-09-12', status: 'skipped', expectedAmountSatang: baht(1) }),
      ],
      options,
    )
    expect(result.items.map((i) => [i.payment.id, i.status])).toEqual([
      ['b', 'overdue'],
      ['a', 'due_soon'],
    ])
    expect(result.total).toBe(baht(8_299))
    expect(result.overdueCount).toBe(1)
  })

  it('marks payments further out as pending', () => {
    const result = upcomingPayments([makeScheduled({ sourceId: 'x', dueDate: '2026-10-20' })], {
      ...options,
      until: '2026-10-31',
    })
    expect(result.items[0]?.status).toBe('pending')
  })

  it('is empty with no scheduled payments', () => {
    expect(upcomingPayments([], options)).toEqual({ items: [], total: 0, overdueCount: 0 })
  })
})

describe('debtSummary', () => {
  const loanPayment = (overrides: Partial<Transaction> = {}) =>
    makeTx({ type: 'debt_payment', amountSatang: baht(10_000), principalSatang: baht(8_000), interestSatang: baht(2_000), feeSatang: baht(0), accountId: 'bank', debtId: 'loan', ...overrides })

  it('loans use explicitly allocated principal; linked cards use the card-account liability', () => {
    const loan = makeDebt({ id: 'loan', name: 'สินเชื่อบ้าน', openingBalanceSatang: baht(100_000) })
    const cc = makeDebt({ id: 'cc', name: 'บัตรเครดิต', kind: 'credit_card', linkedAccountId: 'card' })
    const closed = makeDebt({ id: 'old', status: 'paid_off', openingBalanceSatang: baht(5_000) })
    const txs = [
      loanPayment(),
      makeTx({ type: 'expense', amountSatang: baht(3_000), accountId: 'card' }),
      makeTx({ type: 'debt_payment', amountSatang: baht(1_000), accountId: 'bank', toAccountId: 'card', debtId: 'cc' }),
    ]
    const summary = debtSummary([loan, cc, closed], txs, accounts)
    expect(summary.activeCount).toBe(2)
    expect(summary.items.map((i) => [i.debt.id, i.outstanding])).toEqual([
      ['loan', baht(92_000)],
      ['cc', baht(2_000)],
    ])
    expect(summary.totalOutstanding).toBe(baht(94_000))
    expect(summary.progress).toEqual({ original: baht(100_000), paid: baht(8_000), paidBps: 800 })
  })

  it('an unallocated payment never reduces principal and is reported separately', () => {
    const loan = makeDebt({ id: 'loan', openingBalanceSatang: baht(100_000) })
    const summary = debtSummary([loan], [loanPayment({ principalSatang: undefined, interestSatang: undefined, feeSatang: undefined })], accounts)
    expect(summary.totalOutstanding).toBe(baht(100_000))
    expect(summary.unallocated).toBe(baht(10_000))
  })

  it('reports historical balances as of a date, not today’s', () => {
    const loan = makeDebt({ id: 'loan', openingBalanceSatang: baht(100_000), openingDate: '2026-01-01' })
    const txs = [loanPayment({ date: '2026-08-10' }), loanPayment({ date: '2026-09-10' })]
    expect(debtSummary([loan], txs, accounts, '2026-07-31').totalOutstanding).toBe(baht(100_000))
    expect(debtSummary([loan], txs, accounts, '2026-08-31').totalOutstanding).toBe(baht(92_000))
    expect(debtSummary([loan], txs, accounts).totalOutstanding).toBe(baht(84_000))
    // A loan tracked from a later date did not exist yet in that month.
    expect(debtSummary([makeDebt({ openingDate: '2026-10-01', openingBalanceSatang: baht(5) })], [], accounts, '2026-09-30').activeCount).toBe(0)
    // Likewise a card whose account was opened later.
    const lateCard = makeAccount({ id: 'late', kind: 'credit_card', openingDate: '2026-09-25' })
    const cc = makeDebt({ kind: 'credit_card', linkedAccountId: 'late' })
    expect(debtSummary([cc], [], [lateCard], '2026-08-31').activeCount).toBe(0)
    expect(debtSummary([cc], [], [lateCard], '2026-09-25').activeCount).toBe(1)
  })

  it('a card whose account is missing is unknown, not zero', () => {
    const summary = debtSummary([makeDebt({ id: 'cc', kind: 'credit_card', linkedAccountId: 'gone' })], [], accounts)
    expect(summary.items[0]?.outstanding).toBeNull()
    expect(summary.totalOutstanding).toBe(0)
  })

  it('is empty with no debts', () => {
    expect(debtSummary([], [], [])).toEqual({ totalOutstanding: 0, activeCount: 0, items: [], progress: null, unallocated: 0 })
  })
})

describe('recentTransactions', () => {
  it('orders by date then entry time, newest first', () => {
    const txs = [
      makeTx({ id: 'old', type: 'expense', amountSatang: baht(1), accountId: 'cash', date: '2026-09-01' }),
      makeTx({ id: 'am', type: 'expense', amountSatang: baht(1), accountId: 'cash', date: '2026-09-25', createdAt: '2026-09-25T01:00:00Z' }),
      makeTx({ id: 'pm', type: 'expense', amountSatang: baht(1), accountId: 'cash', date: '2026-09-25', createdAt: '2026-09-25T09:00:00Z' }),
    ]
    expect(recentTransactions(txs, 2).map((t) => t.id)).toEqual(['pm', 'am'])
  })
})
