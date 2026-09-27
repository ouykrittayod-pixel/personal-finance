import { describe, expect, it } from 'vitest'
import { baht, makeAccount, makeDebt, makeTx } from '@/test/factories'
import {
  buildFinancialInsights,
  change,
  getCashPosition,
  getDebtAnalytics,
  getMonthComparison,
  getMonthlyAnalytics,
  getRecurringExpenseSummary,
} from './analytics'
import { getBudgetSpent, getMonthlyBudgetSummary } from './budget'
import type { Budget, Transaction } from './entities'
import { cashFlow, monthTotals, spendingByCategory, UNCATEGORIZED } from './reporting'

const kbank = makeAccount({
  id: 'kbank',
  name: 'KBank',
  kind: 'bank',
  openingBalanceSatang: baht(50_000),
  openingDate: '2026-08-01',
})
const cash = makeAccount({
  id: 'cash',
  name: 'Cash',
  kind: 'cash',
  openingBalanceSatang: baht(5_000),
  openingDate: '2026-08-01',
})
const card = makeAccount({
  id: 'card',
  name: 'บัตร',
  kind: 'credit_card',
  openingDate: '2026-08-01',
})
const invest = makeAccount({
  id: 'inv',
  name: 'ลงทุน',
  kind: 'investment',
  openingBalanceSatang: baht(100_000),
  openingDate: '2026-08-01',
})
const accounts = [kbank, cash, card, invest]
const home = makeDebt({
  id: 'home',
  name: 'สินเชื่อบ้าน',
  kind: 'mortgage',
  openingBalanceSatang: baht(1_200_000),
  openingDate: '2026-08-01',
})
const cc = makeDebt({
  id: 'cc',
  name: 'บัตร',
  kind: 'credit_card',
  linkedAccountId: 'card',
})

const exp = (id: string, amount: number, categoryId: string | undefined, date = '2026-09-10', extra: Partial<Transaction> = {}) =>
  makeTx({
    id,
    type: 'expense',
    amountSatang: baht(amount),
    accountId: 'kbank',
    ...(categoryId ? { categoryId } : {}),
    date,
    ...extra,
  })
const september: Transaction[] = [
  makeTx({
    id: 'wage',
    type: 'income',
    amountSatang: baht(27_500),
    accountId: 'kbank',
    categoryId: 'salary',
    date: '2026-09-30',
  }),
  exp('f1', 1_000, 'food'),
  exp('f2', 1_500, 'food', '2026-09-01'),
  exp('t1', 2_100, 'transport'),
  exp('s1', 2_350, 'shopping'),
  exp('s2', 1_200, 'shopping', '2026-09-15', { accountId: 'card' }), // card purchase
  exp('rent', 7_800, 'rent', '2026-09-06', { scheduledPaymentId: 'sp-rent' }), // paid recurring bill
  makeTx({
    id: 'cardpay',
    type: 'debt_payment',
    amountSatang: baht(3_000),
    accountId: 'kbank',
    toAccountId: 'card',
    debtId: 'cc',
    date: '2026-09-20',
  }),
  makeTx({
    id: 'loan',
    type: 'debt_payment',
    amountSatang: baht(7_800),
    accountId: 'kbank',
    debtId: 'home',
    principalSatang: baht(6_000),
    interestSatang: baht(1_700),
    feeSatang: baht(100),
    date: '2026-09-25',
  }),
  makeTx({
    id: 'move',
    type: 'transfer',
    amountSatang: baht(5_000),
    accountId: 'kbank',
    toAccountId: 'cash',
    date: '2026-09-05',
  }),
  makeTx({
    id: 'fix',
    type: 'adjustment',
    amountSatang: baht(-50),
    accountId: 'cash',
    date: '2026-09-11',
  }),
]
const august: Transaction[] = [
  makeTx({
    id: 'aug-wage',
    type: 'income',
    amountSatang: baht(25_000),
    accountId: 'kbank',
    categoryId: 'salary',
    date: '2026-08-25',
  }),
  exp('aug-food', 10_000, 'food', '2026-08-31'),
]
const october: Transaction[] = [exp('oct-food', 3_000, 'food', '2026-10-01')]
const all = [...august, ...september, ...october]
const budgets: Budget[] = [
  ['food', 6_000],
  ['transport', 3_000],
  ['shopping', 2_000],
  ['rent', 8_000],
].map(([categoryId, limit]) => ({
  id: `b-${categoryId}`,
  month: '2026-09',
  categoryId: categoryId as string,
  limitSatang: baht(limit as number),
  createdAt: 'c',
  updatedAt: 'u',
}))

describe('monthly figures reuse the existing definitions', () => {
  it('income, expense (card purchase once) and debt payments (never expense); transfers and adjustments excluded', () => {
    const totals = monthTotals(all, '2026-09')
    expect(totals).toMatchObject({
      income: baht(27_500),
      expense: baht(15_950),
      debtPayment: baht(10_800),
    })
    expect(spendingByCategory(all, '2026-09').items.find((i) => i.key === 'shopping')?.amount).toBe(baht(3_550)) // 2,350 + 1,200 — the card payment adds nothing
  })

  it('month boundaries by transaction date: August / September / October never mix', () => {
    expect(monthTotals(all, '2026-08').expense).toBe(baht(10_000))
    expect(monthTotals(all, '2026-09').expense).toBe(baht(15_950))
    expect(monthTotals(all, '2026-10').expense).toBe(baht(3_000))
    expect(monthTotals([exp('edge', 1, 'food', '2026-09-30')], '2026-10').expense).toBe(0)
  })

  it('category spending: sorted by amount, uncategorized kept, shares sum to 100%', () => {
    const breakdown = spendingByCategory([...september, exp('u', 1_200, undefined)], '2026-09')
    expect(breakdown.items.map((i) => i.key)).toEqual(['rent', 'shopping', 'food', 'transport', UNCATEGORIZED])
    expect(breakdown.items.reduce((s, i) => s + i.shareBps, 0)).toBe(10_000)
  })

  it('six-month trend keeps income, expense, debt payment and transfer apart', () => {
    const trend = cashFlow(all, ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'])
    expect(trend).toHaveLength(6)
    expect(trend[5]).toEqual({
      month: '2026-09',
      income: baht(27_500),
      expense: baht(15_950),
      debtPayment: baht(10_800),
      transfer: baht(5_000),
    })
    expect(trend[0]).toEqual({
      month: '2026-04',
      income: 0,
      expense: 0,
      debtPayment: 0,
      transfer: 0,
    })
  })
})

describe('month comparison', () => {
  it('differences and percentages against the previous month', () => {
    const c = getMonthComparison(all, '2026-09', '2026-08')
    expect(c.income).toEqual({
      current: baht(27_500),
      previous: baht(25_000),
      diff: baht(2_500),
      changeBps: 1_000,
    })
    expect(c.expense).toEqual({
      current: baht(15_950),
      previous: baht(10_000),
      diff: baht(5_950),
      changeBps: 5_950,
    })
    expect(c.leftFromIncome.current).toBe(baht(11_550)) // debt payments are not subtracted
    expect(c.hasPrevious).toBe(true)
  })

  it('a previous month of 0 has no percentage (never infinite); decreases are negative', () => {
    expect(change(baht(500), baht(0))).toEqual({
      current: baht(500),
      previous: 0,
      diff: baht(500),
      changeBps: null,
    })
    expect(change(baht(8_000), baht(10_000)).changeBps).toBe(-2_000)
    expect(getMonthComparison(september, '2026-09', '2026-08').hasPrevious).toBe(false)
  })
})

describe('budget, debts, cash and recurring', () => {
  it('budget actuals are the Budget page function: 41.7% / 70% / 177.5% / 97.5% in basis points', () => {
    const summary = getMonthlyBudgetSummary(budgets, all, '2026-09')
    expect(summary.categories.map((l) => [l.budget.categoryId, l.spent, l.usageBps])).toEqual([
      ['rent', baht(7_800), 9_750],
      ['food', baht(2_500), 4_166],
      ['transport', baht(2_100), 7_000],
      ['shopping', baht(3_550), 17_750],
    ])
    expect(getBudgetSpent({ month: '2026-09', categoryId: 'shopping' }, all)).toBe(baht(3_550))
  })

  it('debts: balance as of the date, this month’s payments, explicit principal and interest/fees only', () => {
    const debts = getDebtAnalytics([home, cc], accounts, all, '2026-09', '2026-09-30')
    const mortgage = debts.lines.find((l) => l.debt.id === 'home')!
    expect(mortgage).toMatchObject({
      outstanding: baht(1_194_000),
      paid: baht(7_800),
      principal: baht(6_000),
      interest: baht(1_700),
      fees: baht(100),
      unallocated: 0,
    })
    expect(debts.lines.find((l) => l.debt.id === 'cc')).toMatchObject({
      outstanding: baht(1_200 - 3_000),
      paid: baht(3_000),
      principal: 0,
    })
    expect(debts).toMatchObject({
      paid: baht(10_800),
      principal: baht(6_000),
      interestAndFees: baht(1_800),
      totalOutstanding: baht(1_194_000),
    })
    const unsplit = getDebtAnalytics(
      [home],
      accounts,
      [
        makeTx({
          type: 'debt_payment',
          amountSatang: baht(9_000),
          accountId: 'kbank',
          debtId: 'home',
          date: '2026-09-05',
        }),
      ],
      '2026-09',
      '2026-09-30',
    )
    expect(unsplit).toMatchObject({ principal: 0, unallocated: baht(9_000) })
    expect(getDebtAnalytics([], accounts, all, '2026-09', '2026-09-30').lines).toEqual([])
  })

  it('cash position as of the month end (not today): transfers leave the total unchanged; cards and investments shown apart', () => {
    const position = getCashPosition(accounts, all, '2026-09-30', '2026-08-31')
    // KBank 50,000 + 25,000 − 10,000 (Aug) + 27,500 − 1,000 − 1,500 − 2,100 − 2,350 − 7,800 − 3,000 − 7,800 − 5,000 ; Cash 5,000 + 5,000 − 50
    expect(position.lines.find((l) => l.account.id === 'kbank')?.balance).toBe(baht(61_950))
    expect(position.lines.find((l) => l.account.id === 'cash')?.balance).toBe(baht(9_950))
    expect(position.available).toBe(baht(71_900))
    expect(position.previousAvailable).toBe(baht(70_000))
    expect(position.lines.find((l) => l.account.id === 'card')?.group).toBe('card')
    expect(position.lines.find((l) => l.account.id === 'inv')?.group).toBe('other')
    // October's spending is not in September's balances.
    expect(getCashPosition(accounts, all, '2026-10-31', '2026-09-30').available).toBe(baht(68_900))
    // Nothing to compare with (a month that has not started): no previous figure, no available_change insight.
    expect(getCashPosition(accounts, all, '2026-09-30', null).previousAvailable).toBeNull()
  })

  it('recurring: only paid occurrences count; others are the rest of the expenses', () => {
    const summary = getRecurringExpenseSummary(all, '2026-09', (id) => (id === 'sp-rent' ? 'rent-rule' : undefined))
    expect(summary).toEqual({
      items: [{ sourceId: 'rent-rule', amount: baht(7_800), count: 1 }],
      total: baht(7_800),
      other: baht(8_150),
    })
    expect(getRecurringExpenseSummary([], '2026-09', () => undefined)).toEqual({
      items: [],
      total: 0,
      other: 0,
    })
  })
})

describe('insights', () => {
  const analytics = (transactions: Transaction[], budgetList: Budget[] = budgets) =>
    getMonthlyAnalytics({
      transactions,
      accounts,
      debts: [home, cc],
      budgets: budgetList,
      month: '2026-09',
      previousMonth: '2026-08',
      asOf: '2026-09-30',
      previousAsOf: '2026-08-31',
      sourceOf: (id) => (id === 'sp-rent' ? 'rent-rule' : undefined),
    })

  it('are deterministic facts built only when the data supports them', () => {
    const result = analytics(all)
    expect(result.insights.map((i) => i.kind)).toEqual([
      'expense_change',
      'income_change',
      'top_category',
      'budget_total',
      'budget_used',
      'debt_paid',
      'recurring_share',
      'available_change',
    ])
    expect(result.insights).toContainEqual({
      kind: 'top_category',
      categoryId: 'rent',
      amount: baht(7_800),
      shareBps: 4_890,
    })
    expect(result.insights).toContainEqual({
      kind: 'budget_used',
      categoryId: 'shopping',
      usageBps: 17_750,
      overBy: baht(1_550),
    })
    expect(analytics(all)).toEqual(result)
  })

  it('no previous month → no comparison; one category → no "top category"; nothing → nothing', () => {
    const single = analytics([exp('only', 500, 'food')], [])
    expect(single.insights.map((i) => i.kind)).not.toContain('expense_change')
    expect(single.insights.map((i) => i.kind)).not.toContain('top_category')
    const empty = buildFinancialInsights({
      ...analytics([], []),
      debts: {
        lines: [],
        totalOutstanding: baht(0),
        paid: baht(0),
        principal: baht(0),
        interestAndFees: baht(0),
        unallocated: baht(0),
      },
      cash: { available: baht(0), previousAvailable: null, lines: [] },
    })
    expect(empty).toEqual([])
  })
})
