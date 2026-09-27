/**
 * Budget page data: loader and a pure view-model builder. All arithmetic is
 * domain/budget's; spending comes only from expense transactions.
 */
import type { StatusKind } from '@/components/finance/StatusBadge'
import { budgetsRepository, categoriesRepository, transactionsRepository } from '@/db/repositories'
import { getMonthlyBudgetSummary, isOverallBudget, OVERALL_BUDGET, type BudgetLine, type BudgetStatus } from '@/domain/budget'
import type { Budget, Category, ID, Transaction } from '@/domain/entities'
import type { BasisPoints, Satang } from '@/domain/money'
import { formatPercentBps1 } from '@/lib/formatting'
import { t } from '@/lib/i18n'

export interface BudgetRawData {
  budgets: Budget[]
  categories: Category[]
  transactions: Transaction[]
}

export async function loadBudgetData(): Promise<BudgetRawData> {
  const [budgets, categories, transactions] = await Promise.all([budgetsRepository.listAll(), categoriesRepository.listAll(), transactionsRepository.listAll()])
  return { budgets, categories, transactions }
}

/**
 * 4,166 bps → "41.7%", 7,083 → "70.8%" (one decimal, half-up). Usage below 100%
 * never displays as "100%" (99.96% shows "99.9%"), matching the status.
 */
export function formatUsage(bps: BasisPoints): string {
  return bps < 10_000 && bps >= 9_995 ? '99.9%' : formatPercentBps1(bps)
}

/** The same figure for screen readers: "70.8". */
export const usageNumber = (bps: BasisPoints) => formatUsage(bps).replace('%', '')

export const STATUS_BADGE: Record<BudgetStatus, StatusKind> = { under_budget: 'paid', near_limit: 'due_soon', over_budget: 'overdue' }
export const STATUS_TONE: Record<BudgetStatus, 'income' | 'warning' | 'expense'> = { under_budget: 'income', near_limit: 'warning', over_budget: 'expense' }

export interface BudgetRow extends BudgetLine {
  id: ID
  name: string
  icon?: string
  archivedCategory: boolean
  overall: boolean
}

export interface BudgetModel {
  month: string
  /** Headline: the overall limit when set, else the sum of category budgets (labelled differently). */
  headline: { scope: 'overall' | 'categories'; limit: Satang; spent: Satang; remaining: Satang; usageBps: BasisPoints | null; status: BudgetStatus } | null
  overall: BudgetRow | null
  rows: BudgetRow[]
  unbudgetedSpent: Satang
  /** Active expense categories without a budget this month (choices for a new one). */
  availableCategories: Category[]
  hasExpenseCategories: boolean
}

export function buildBudgetModel(raw: BudgetRawData, month: string): BudgetModel {
  const summary = getMonthlyBudgetSummary(raw.budgets, raw.transactions, month)
  const categories = new Map(raw.categories.map((c) => [c.id, c]))
  const toRow = (line: BudgetLine): BudgetRow => {
    const category = categories.get(line.budget.categoryId)
    return {
      ...line,
      id: line.budget.id,
      overall: isOverallBudget(line.budget),
      name: isOverallBudget(line.budget) ? t('budget.overall.name') : (category?.name ?? t('budget.uncategorized')),
      icon: category?.icon,
      archivedCategory: Boolean(category?.archivedAt),
    }
  }
  const budgeted = new Set(raw.budgets.filter((b) => b.month === month).map((b) => b.categoryId))
  const expense = raw.categories.filter((c) => c.kind === 'expense')
  const headline = summary.overall
    ? { scope: 'overall' as const, limit: summary.overall.limit, spent: summary.overall.spent, remaining: summary.overall.remaining, usageBps: summary.overall.usageBps, status: summary.overall.status }
    : summary.categories.length > 0
      ? { scope: 'categories' as const, ...summary.categoryTotals }
      : null
  return {
    month,
    headline,
    overall: summary.overall ? toRow(summary.overall) : null,
    rows: summary.categories.map(toRow),
    unbudgetedSpent: summary.unbudgetedSpent,
    availableCategories: expense.filter((c) => !c.archivedAt && !budgeted.has(c.id)).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    hasExpenseCategories: expense.some((c) => !c.archivedAt),
  }
}

/** Screen-reader sentence: name, limit, spent, left/over, percentage, status in words. */
export function describeBudgetRow(row: Pick<BudgetRow, 'name' | 'limit' | 'spent' | 'remaining' | 'overBy' | 'usageBps' | 'status'>, baht: (amount: Satang) => string): string {
  return t('budget.line.a11y', {
    name: row.name,
    limit: baht(row.limit),
    spent: baht(row.spent),
    rest: row.overBy > 0 ? t('budget.line.a11yOver', { amount: baht(row.overBy) }) : t('budget.line.a11yLeft', { amount: baht(row.remaining) }),
    percent: row.usageBps === null ? '0' : usageNumber(row.usageBps),
    status: t(`budget.status.${row.status}`),
  })
}

export { OVERALL_BUDGET }
