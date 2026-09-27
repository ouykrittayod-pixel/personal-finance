/**
 * Budgets: monthly spending plans. Pure.
 *
 * A budget stores only the PLAN (month, category, limit). What was actually
 * spent is always derived from transactions — never stored:
 *
 *   spent(month, category) = Σ amount of transactions where
 *     countsAsSpending(tx)            (type 'expense' only)
 *     && tx.categoryId === category   (the overall limit: any category)
 *     && tx.date is inside the month  (transaction date, not createdAt / due dates)
 *
 * So income, transfers, debt payments (including any interest inside them)
 * and adjustments never count; a credit-card purchase counts once (it is an
 * expense) and paying the card later (a debt payment) never counts again;
 * unpaid scheduled payments are not spending until paid as an expense.
 *
 * The overall monthly limit is a budget with the reserved category key
 * OVERALL_BUDGET, so the existing unique [month+categoryId] index keeps one
 * per month. It is independent of the category budgets (they need not add up).
 */
import type { Budget, Category, ID, ISODate, Transaction } from './entities'
import { add, ratioBps, subtract, sum, ZERO, type BasisPoints, type Satang } from './money'
import { countsAsSpending } from './transactions'

export const OVERALL_BUDGET = '__overall'
export const isOverallBudget = (budget: Pick<Budget, 'categoryId'>) => budget.categoryId === OVERALL_BUDGET

/** UI thresholds only (not financial truth): under 80% / 80–99.99% / ≥ 100%. */
export const NEAR_LIMIT_BPS = 8_000
export const OVER_LIMIT_BPS = 10_000

export type BudgetStatus = 'under_budget' | 'near_limit' | 'over_budget'

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/
export const isBudgetMonth = (month: string) => MONTH.test(month)

/** First and last day of a "YYYY-MM" month, as calendar dates (no time zones involved). */
export function getBudgetPeriod(month: string): { start: ISODate; end: ISODate } {
  const [year, m] = month.split('-').map(Number) as [number, number]
  // Day 0 of the next month = last day of this month (UTC arithmetic on a date only).
  const lastDay = new Date(Date.UTC(year, m, 0)).getUTCDate()
  return { start: `${month}-01`, end: `${month}-${String(lastDay).padStart(2, '0')}` }
}

const inMonth = (date: ISODate, month: string) => date.startsWith(`${month}-`)

/** Actual spending that counts against this budget. */
export function getBudgetSpent(budget: Pick<Budget, 'month' | 'categoryId'>, transactions: readonly Transaction[]): Satang {
  const overall = isOverallBudget(budget)
  return sum(
    transactions
      .filter((tx) => countsAsSpending(tx) && inMonth(tx.date, budget.month) && (overall || tx.categoryId === budget.categoryId))
      .map((tx) => tx.amountSatang),
  )
}

/** limit − spent (negative when over budget). */
export const getBudgetRemaining = (limit: Satang, spent: Satang): Satang => subtract(limit, spent)

/**
 * spent / limit in basis points (7,083 = 70.83%), rounded DOWN so a display
 * never overstates usage (99.999% never shows as 100%). Null when the limit is 0.
 */
export const getBudgetUsagePercent = (limit: Satang, spent: Satang): BasisPoints | null => (limit > 0 ? ratioBps(spent, limit, 'floor') : null)

/**
 * Status from exact integer comparisons (not the rounded percentage, which would
 * call ฿9,999.99 of ฿10,000 "100%" and over budget).
 */
export function getBudgetStatus(limit: Satang, spent: Satang): BudgetStatus {
  if (limit <= 0) return spent > 0 ? 'over_budget' : 'under_budget'
  if (spent * 10_000 >= limit * OVER_LIMIT_BPS) return 'over_budget'
  if (spent * 10_000 >= limit * NEAR_LIMIT_BPS) return 'near_limit'
  return 'under_budget'
}

export interface BudgetLine {
  budget: Budget
  limit: Satang
  spent: Satang
  /** limit − spent; negative when over. */
  remaining: Satang
  /** How much over the limit (0 when within). */
  overBy: Satang
  usageBps: BasisPoints | null
  status: BudgetStatus
}

export function getCategoryBudgetSummary(budget: Budget, transactions: readonly Transaction[]): BudgetLine {
  const spent = getBudgetSpent(budget, transactions)
  const remaining = getBudgetRemaining(budget.limitSatang, spent)
  return {
    budget,
    limit: budget.limitSatang,
    spent,
    remaining,
    overBy: remaining < 0 ? subtract(ZERO, remaining) : ZERO,
    usageBps: getBudgetUsagePercent(budget.limitSatang, spent),
    status: getBudgetStatus(budget.limitSatang, spent),
  }
}

export interface MonthlyBudgetSummary {
  month: string
  /** The overall monthly limit, if one is set. */
  overall: BudgetLine | null
  /** Category budgets of the month, largest limit first. */
  categories: BudgetLine[]
  /** Sum over category budgets only (limits and their spending) — not the overall limit. */
  categoryTotals: { limit: Satang; spent: Satang; remaining: Satang; usageBps: BasisPoints | null; status: BudgetStatus }
  /** All expense spending in the month (what an overall limit is measured against). */
  totalSpent: Satang
  /** Expense spending in categories without a budget this month. */
  unbudgetedSpent: Satang
}

export function getMonthlyBudgetSummary(budgets: readonly Budget[], transactions: readonly Transaction[], month: string): MonthlyBudgetSummary {
  const ofMonth = budgets.filter((b) => b.month === month)
  const overallBudget = ofMonth.find(isOverallBudget)
  const categories = ofMonth
    .filter((b) => !isOverallBudget(b))
    .map((b) => getCategoryBudgetSummary(b, transactions))
    .sort((a, b) => b.limit - a.limit || a.budget.categoryId.localeCompare(b.budget.categoryId))
  const limit = sum(categories.map((c) => c.limit))
  const spent = sum(categories.map((c) => c.spent))
  const budgeted = new Set(categories.map((c) => c.budget.categoryId))
  let totalSpent = ZERO
  let unbudgetedSpent = ZERO
  for (const tx of transactions) {
    if (!countsAsSpending(tx) || !inMonth(tx.date, month)) continue
    totalSpent = add(totalSpent, tx.amountSatang)
    if (!tx.categoryId || !budgeted.has(tx.categoryId)) unbudgetedSpent = add(unbudgetedSpent, tx.amountSatang)
  }
  return {
    month,
    overall: overallBudget ? getCategoryBudgetSummary(overallBudget, transactions) : null,
    categories,
    categoryTotals: { limit, spent, remaining: getBudgetRemaining(limit, spent), usageBps: getBudgetUsagePercent(limit, spent), status: getBudgetStatus(limit, spent) },
    totalSpent,
    unbudgetedSpent,
  }
}

// ---------------------------------------------------------------------------
// Creating and editing budgets
// ---------------------------------------------------------------------------

export interface BudgetDraft {
  month: string
  /** An expense category id, or OVERALL_BUDGET for the monthly spending limit. */
  categoryId: ID | undefined
  limitSatang: Satang | null
  note?: string
}

export type BudgetIssue =
  | 'month_invalid'
  | 'category_required'
  | 'category_not_expense'
  | 'category_archived'
  | 'amount_required'
  | 'amount_invalid'
  | 'duplicate'

export interface BudgetContext {
  categories: ReadonlyMap<ID, Pick<Category, 'kind' | 'archivedAt'>>
  /** Existing budgets (for the one-per-month-and-category rule). */
  budgets: readonly Pick<Budget, 'id' | 'month' | 'categoryId'>[]
}

/**
 * Validate and build the budget to store (create or edit). Only a plan is
 * stored — never spent / remaining / percentage. An archived category may keep
 * an existing budget but cannot be chosen for a new one.
 */
export function buildBudget(draft: BudgetDraft, context: BudgetContext, meta: { id: ID; now: string; existing?: Budget }): { ok: true; budget: Budget } | { ok: false; issues: BudgetIssue[] } {
  const issues: BudgetIssue[] = []
  const { existing } = meta
  const id = existing?.id ?? meta.id
  if (!isBudgetMonth(draft.month)) issues.push('month_invalid')

  if (!draft.categoryId) issues.push('category_required')
  else if (draft.categoryId !== OVERALL_BUDGET) {
    const category = context.categories.get(draft.categoryId)
    if (!category || category.kind !== 'expense') issues.push('category_not_expense')
    else if (category.archivedAt && existing?.categoryId !== draft.categoryId) issues.push('category_archived')
  }

  if (draft.limitSatang === null) issues.push('amount_required')
  else if (!Number.isSafeInteger(draft.limitSatang) || draft.limitSatang <= 0) issues.push('amount_invalid')

  if (draft.categoryId && context.budgets.some((b) => b.id !== id && b.month === draft.month && b.categoryId === draft.categoryId)) issues.push('duplicate')
  if (issues.length > 0) return { ok: false, issues }

  const budget: Budget = {
    ...(existing ?? {}),
    id,
    month: draft.month,
    categoryId: draft.categoryId!,
    limitSatang: draft.limitSatang!,
    note: draft.note?.trim() || undefined,
    createdAt: existing?.createdAt ?? meta.now,
    updatedAt: meta.now,
  }
  if (budget.note === undefined) delete budget.note
  return { ok: true, budget }
}
