import { describe, expect, it } from 'vitest'
import { baht, makeCategory, makeTx } from '@/test/factories'
import {
  buildBudget,
  getBudgetPeriod,
  getBudgetRemaining,
  getBudgetSpent,
  getBudgetStatus,
  getBudgetUsagePercent,
  getCategoryBudgetSummary,
  getMonthlyBudgetSummary,
  OVERALL_BUDGET,
  type BudgetContext,
  type BudgetDraft,
} from './budget'
import type { Budget, ID } from './entities'
import { satang } from './money'

const budget = (overrides: Partial<Budget> = {}): Budget => ({ id: 'b-food', month: '2026-09', categoryId: 'food', limitSatang: baht(6_000), createdAt: 'c', updatedAt: 'u', ...overrides })
const expense = (amount: number, overrides = {}) => makeTx({ type: 'expense', amountSatang: baht(amount), accountId: 'cash', categoryId: 'food', date: '2026-09-10', ...overrides })

describe('what counts as spending', () => {
  const september = [
    expense(1_000),
    expense(1_500, { accountId: 'kbank', date: '2026-09-30' }),
    expense(500, { accountId: 'card', date: '2026-09-01' }), // credit-card purchase = expense
    makeTx({ type: 'income', amountSatang: baht(27_500), accountId: 'kbank', categoryId: 'food', date: '2026-09-25' }),
    makeTx({ type: 'transfer', amountSatang: baht(5_000), accountId: 'kbank', toAccountId: 'cash', date: '2026-09-11' }),
    makeTx({ type: 'debt_payment', amountSatang: baht(7_800), accountId: 'kbank', debtId: 'home', principalSatang: baht(5_000), interestSatang: baht(2_800), feeSatang: baht(0), date: '2026-09-05' }),
    makeTx({ type: 'debt_payment', amountSatang: baht(500), accountId: 'kbank', toAccountId: 'card', debtId: 'cc', date: '2026-09-20' }), // paying the card
    makeTx({ type: 'adjustment', amountSatang: baht(-300), accountId: 'cash', date: '2026-09-12' }),
    expense(9_999, { date: '2026-08-31' }),
    expense(8_888, { date: '2026-10-01' }),
  ]

  it('only expense transactions of the category and month — across all accounts', () => {
    expect(getBudgetSpent(budget(), september)).toBe(baht(3_000))
  })

  it('income, transfers, debt payments (incl. their interest), card payments and adjustments never count', () => {
    const noise = september.filter((tx) => tx.type !== 'expense')
    expect(getBudgetSpent(budget(), noise)).toBe(0)
    expect(getBudgetSpent(budget({ categoryId: OVERALL_BUDGET }), noise)).toBe(0)
  })

  it('a card purchase counts once; paying the card does not add it again', () => {
    const txs = [
      expense(1_200, { categoryId: 'shopping', accountId: 'card' }),
      makeTx({ type: 'debt_payment', amountSatang: baht(1_200), accountId: 'kbank', toAccountId: 'card', debtId: 'cc', date: '2026-09-15' }),
    ]
    expect(getBudgetSpent(budget({ categoryId: 'shopping', limitSatang: baht(2_000) }), txs)).toBe(baht(1_200))
  })

  it('uses the transaction date: month boundaries are exact and months never mix', () => {
    expect(getBudgetPeriod('2026-09')).toEqual({ start: '2026-09-01', end: '2026-09-30' })
    expect(getBudgetPeriod('2026-02')).toEqual({ start: '2026-02-01', end: '2026-02-28' })
    expect(getBudgetPeriod('2028-02')).toEqual({ start: '2028-02-01', end: '2028-02-29' })
    expect(getBudgetSpent(budget({ month: '2026-08', limitSatang: baht(5_000) }), september)).toBe(baht(9_999))
    expect(getBudgetSpent(budget({ month: '2026-10' }), september)).toBe(baht(8_888))
    expect(getBudgetSpent(budget({ month: '2026-11' }), september)).toBe(0) // a future month with no spending yet
  })

  it('the overall limit measures every expense of the month (any category)', () => {
    const txs = [...september, expense(700, { categoryId: 'travel' })]
    expect(getBudgetSpent(budget({ categoryId: OVERALL_BUDGET, limitSatang: baht(25_000) }), txs)).toBe(baht(3_700))
  })
})

describe('remaining, usage and status', () => {
  it('remaining, over-budget amount and percentage (integer basis points)', () => {
    expect(getBudgetRemaining(baht(6_000), baht(4_250))).toBe(baht(1_750))
    expect(getBudgetUsagePercent(baht(6_000), baht(4_250))).toBe(7_083)
    const over = getCategoryBudgetSummary(budget(), [expense(6_500)])
    expect(over).toMatchObject({ spent: baht(6_500), remaining: baht(-500), overBy: baht(500), usageBps: 10_833, status: 'over_budget' })
    expect(getCategoryBudgetSummary(budget(), [])).toMatchObject({ spent: 0, remaining: baht(6_000), overBy: 0, usageBps: 0, status: 'under_budget' })
  })

  it('usage is rounded down so it is never overstated', () => {
    expect(getBudgetUsagePercent(baht(10_000), baht(9_999.99))).toBe(9_999)
    expect(getBudgetUsagePercent(baht(2_000), baht(2_350))).toBe(11_750)
  })

  it('a zero limit never divides by zero', () => {
    expect(getBudgetUsagePercent(satang(0), baht(10))).toBeNull()
    expect(getBudgetStatus(satang(0), satang(0))).toBe('under_budget')
    expect(getBudgetStatus(satang(0), baht(1))).toBe('over_budget')
  })

  it.each([
    [0, 'under_budget'],
    [7_999, 'under_budget'],
    [8_000, 'near_limit'],
    [9_999.99, 'near_limit'],
    [10_000, 'over_budget'],
    [12_000, 'over_budget'],
  ] as const)('spent ฿%d of ฿10,000 → %s', (spent, status) => {
    expect(getBudgetStatus(baht(10_000), baht(spent))).toBe(status)
  })
})

describe('getMonthlyBudgetSummary', () => {
  const budgets = [
    budget(),
    budget({ id: 'b-travel', categoryId: 'travel', limitSatang: baht(3_000) }),
    budget({ id: 'b-shop', categoryId: 'shopping', limitSatang: baht(2_000) }),
    budget({ id: 'b-all', categoryId: OVERALL_BUDGET, limitSatang: baht(25_000) }),
    budget({ id: 'b-aug', month: '2026-08', limitSatang: baht(5_000) }),
  ]
  const txs = [expense(1_000), expense(1_500), expense(2_100, { categoryId: 'travel' }), expense(2_350, { categoryId: 'shopping' }), expense(400, { categoryId: 'health' }), expense(2_000, { date: '2026-08-15' })]

  it('category lines (with zero-spend ones), category totals, overall and unbudgeted spending', () => {
    const summary = getMonthlyBudgetSummary(budgets, txs, '2026-09')
    expect(summary.categories.map((c) => [c.budget.categoryId, c.spent, c.remaining])).toEqual([
      ['food', baht(2_500), baht(3_500)],
      ['travel', baht(2_100), baht(900)],
      ['shopping', baht(2_350), baht(-350)],
    ])
    expect(summary.categoryTotals).toMatchObject({ limit: baht(11_000), spent: baht(6_950) })
    expect(summary.overall).toMatchObject({ limit: baht(25_000), spent: baht(7_350) })
    expect(summary.totalSpent).toBe(baht(7_350))
    expect(summary.unbudgetedSpent).toBe(baht(400))
    const august = getMonthlyBudgetSummary(budgets, txs, '2026-08')
    expect(august.categories.map((c) => [c.spent, c.limit])).toEqual([[baht(2_000), baht(5_000)]])
    expect(august.overall).toBeNull()
  })

  it('a budget with nothing spent is still listed', () => {
    const summary = getMonthlyBudgetSummary([budget({ categoryId: 'travel', limitSatang: baht(3_000) })], [], '2026-09')
    expect(summary.categories).toHaveLength(1)
    expect(summary.categories[0]).toMatchObject({ spent: 0, remaining: baht(3_000) })
  })
})

describe('buildBudget', () => {
  const context: BudgetContext = {
    categories: new Map<ID, ReturnType<typeof makeCategory>>([
      ['food', makeCategory({ id: 'food', kind: 'expense' })],
      ['salary', makeCategory({ id: 'salary', kind: 'income' })],
      ['old', makeCategory({ id: 'old', kind: 'expense', archivedAt: 'x' })],
    ]),
    budgets: [budget()],
  }
  const draft = (overrides: Partial<BudgetDraft> = {}): BudgetDraft => ({ month: '2026-10', categoryId: 'food', limitSatang: baht(7_000), ...overrides })

  it('stores the plan only — no spent / remaining / percentage fields', () => {
    const result = buildBudget(draft(), context, { id: 'new', now: 'now' })
    expect(result).toEqual({ ok: true, budget: { id: 'new', month: '2026-10', categoryId: 'food', limitSatang: baht(7_000), createdAt: 'now', updatedAt: 'now' } })
    expect(buildBudget(draft({ categoryId: OVERALL_BUDGET }), context, { id: 'o', now: 'now' }).ok).toBe(true)
  })

  it.each([
    [{ month: '2026-13' }, 'month_invalid'],
    [{ month: '' }, 'month_invalid'],
    [{ categoryId: undefined }, 'category_required'],
    [{ categoryId: 'salary' }, 'category_not_expense'],
    [{ categoryId: 'ghost' }, 'category_not_expense'],
    [{ categoryId: 'old' }, 'category_archived'],
    [{ limitSatang: null }, 'amount_required'],
    [{ limitSatang: satang(0) }, 'amount_invalid'],
    [{ limitSatang: baht(-1) }, 'amount_invalid'],
    [{ month: '2026-09' }, 'duplicate'],
  ] as const)('rejects %j with %s', (overrides, issue) => {
    const result = buildBudget(draft(overrides as Partial<BudgetDraft>), context, { id: 'new', now: 'now' })
    expect(!result.ok && result.issues).toContain(issue)
  })

  it('an edit keeps id/createdAt; changing only the amount is not a duplicate of itself; an archived category may keep its budget', () => {
    const edited = buildBudget(draft({ month: '2026-09', limitSatang: baht(7_000) }), context, { id: 'x', now: 'later', existing: budget() })
    expect(edited.ok && edited.budget).toMatchObject({ id: 'b-food', createdAt: 'c', updatedAt: 'later', limitSatang: baht(7_000) })
    const archived = budget({ id: 'b-old', categoryId: 'old' })
    expect(buildBudget(draft({ categoryId: 'old' }), context, { id: 'x', now: 'n', existing: archived }).ok).toBe(true)
  })
})
