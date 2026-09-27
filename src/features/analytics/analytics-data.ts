/**
 * Analytics page data: loader (repositories) and view model. All figures come
 * from domain/analytics, which only combines the existing reporting, budget,
 * debt and account functions.
 */
import {
  budgetsRepository,
  accountsRepository,
  categoriesRepository,
  debtsRepository,
  recurringObligationsRepository,
  scheduledPaymentsRepository,
  transactionsRepository,
} from '@/db/repositories'
import { getMonthlyAnalytics, type Change, type Insight, type MonthlyAnalytics } from '@/domain/analytics'
import type { Account, Budget, Category, Debt, ID, ISODate, RecurringObligation, ScheduledPayment, Transaction } from '@/domain/entities'
import type { Satang } from '@/domain/money'
import { cashFlow, spendingByCategory, UNCATEGORIZED, type CashFlowPoint } from '@/domain/reporting'
import { toCategorySlices, type CategorySlice } from '@/features/dashboard/category-slices'
import { addMonthsYM, formatYearMonth, monthBounds, monthsEnding } from '@/lib/dates'
import { formatPercentBps1, formatTHB } from '@/lib/formatting'
import { t } from '@/lib/i18n'

export const TREND_MONTHS = 6
/** Donut: top four categories + "อื่น ๆ" (the table lists every category). */
export const DONUT_SLICES = 5

export interface AnalyticsRawData {
  month: string
  /** Every transaction dated up to the month's end (balances need history; nothing after the month is read). */
  transactions: Transaction[]
  accounts: Account[]
  categories: Category[]
  debts: Debt[]
  budgets: Budget[]
  obligations: RecurringObligation[]
  /** Occurrences settled by this month's transactions (to name paid recurring bills). */
  payments: ScheduledPayment[]
}

export async function loadAnalyticsData(month: string): Promise<AnalyticsRawData> {
  const { start, end } = monthBounds(month)
  const [transactions, accounts, categories, debts, budgets, obligations] = await Promise.all([
    transactionsRepository.listBetween('0000-01-01', end),
    accountsRepository.listAll(),
    categoriesRepository.listAll(),
    debtsRepository.listAll(),
    budgetsRepository.listForMonth(month),
    recurringObligationsRepository.listAll(),
  ])
  const ids = [...new Set(transactions.filter((tx) => tx.scheduledPaymentId && tx.date >= start).map((tx) => tx.scheduledPaymentId!))]
  const payments = (await Promise.all(ids.map((id) => scheduledPaymentsRepository.get(id)))).filter((p): p is ScheduledPayment => p !== undefined)
  return {
    month,
    transactions,
    accounts,
    categories,
    debts,
    budgets,
    obligations,
    payments,
  }
}

export interface CategoryRow {
  key: string
  label: string
  icon?: string
  amount: Satang
  shareBps: number
  /** Drill-down into the existing ledger (none for "ไม่มีหมวดหมู่"). */
  categoryId?: ID
}

export interface AnalyticsModel extends MonthlyAnalytics {
  month: string
  previousMonth: string
  asOf: ISODate
  isFuture: boolean
  trend: CashFlowPoint[]
  donut: CategorySlice[]
  categoryRows: CategoryRow[]
  insightTexts: string[]
  names: { category: (id: ID) => string; obligation: (id: ID) => string }
  hasAnyData: boolean
}

export function buildAnalyticsModel(raw: AnalyticsRawData, today: ISODate): AnalyticsModel {
  const { month } = raw
  const previousMonth = addMonthsYM(month, -1)
  const end = monthBounds(month).end
  // A past month is reported as of its last day; the current month as of today.
  const asOf = end < today ? end : today
  // A month that has not started has no "end of last month" to compare today's balances with.
  const isFuture = monthBounds(month).start > today
  const previousAsOf = isFuture ? null : monthBounds(previousMonth).end
  const categories = new Map(raw.categories.map((c) => [c.id, c]))
  const obligations = new Map(raw.obligations.map((o) => [o.id, o]))
  const paymentSource = new Map(raw.payments.filter((p) => p.sourceType === 'obligation').map((p) => [p.id, p.sourceId]))

  const analytics = getMonthlyAnalytics({
    transactions: raw.transactions,
    accounts: raw.accounts,
    debts: raw.debts,
    budgets: raw.budgets,
    month,
    previousMonth,
    asOf,
    previousAsOf,
    sourceOf: (id) => paymentSource.get(id),
  })
  const names = {
    category: (id: ID) => (id === UNCATEGORIZED ? t('dashboard.spending.uncategorized') : (categories.get(id)?.name ?? t('dashboard.spending.uncategorized'))),
    obligation: (id: ID) => obligations.get(id)?.name ?? '—',
  }
  const rows = toCategorySlices(analytics.categories, categories).map((slice): CategoryRow => ({
    key: slice.key,
    label: slice.label,
    icon: slice.icon,
    amount: slice.amount,
    shareBps: slice.shareBps,
    ...(slice.key !== UNCATEGORIZED ? { categoryId: slice.key } : {}),
  }))
  return {
    ...analytics,
    month,
    previousMonth,
    asOf,
    isFuture,
    trend: cashFlow(raw.transactions, monthsEnding(month, TREND_MONTHS)),
    donut: toCategorySlices(spendingByCategory(raw.transactions, month, DONUT_SLICES), categories),
    categoryRows: rows,
    insightTexts: analytics.insights.map((insight) => insightText(insight, names, previousMonth)),
    names,
    hasAnyData: raw.transactions.length > 0 || raw.accounts.length > 0 || raw.debts.length > 0 || raw.budgets.length > 0,
  }
}

const money = (amount: Satang) => formatTHB(amount, { trimZeroFraction: true })
const abs = (amount: Satang) => (amount < 0 ? (-amount as Satang) : amount)

/** "+฿2,500 (+10%)" / "−฿2,000 (−11.1%)" / "+฿500 (จาก ฿0)". */
export function changeText(c: Change): string {
  const sign = c.diff > 0 ? '+' : c.diff < 0 ? '−' : ''
  const amount = `${sign}${money(abs(c.diff))}`
  if (c.changeBps === null) return c.current === 0 ? amount : t('analytics.change.fromZero', { amount })
  return `${amount} (${c.changeBps > 0 ? '+' : c.changeBps < 0 ? '−' : ''}${formatPercentBps1(Math.abs(c.changeBps))})`
}

/** Deterministic sentences — facts and comparisons only. */
export function insightText(insight: Insight, names: AnalyticsModel['names'], previousMonth: string): string {
  const prev = formatYearMonth(previousMonth)
  switch (insight.kind) {
    case 'expense_change':
    case 'income_change': {
      const c = insight.change
      const label = t(insight.kind === 'expense_change' ? 'analytics.insight.expense' : 'analytics.insight.income')
      if (c.diff === 0)
        return t('analytics.insight.same', {
          label,
          amount: money(c.current),
          month: prev,
        })
      const direction = t(c.diff > 0 ? 'analytics.insight.up' : 'analytics.insight.down')
      const percent = c.changeBps === null ? t('analytics.insight.fromZero') : `(${formatPercentBps1(Math.abs(c.changeBps))})`
      return t('analytics.insight.change', {
        label,
        amount: money(c.current),
        direction,
        diff: money(abs(c.diff)),
        percent,
        month: prev,
      })
    }
    case 'top_category':
      return t('analytics.insight.topCategory', {
        name: names.category(insight.categoryId),
        amount: money(insight.amount),
        percent: formatPercentBps1(insight.shareBps),
      })
    case 'budget_total':
      return t(insight.scope === 'overall' ? 'analytics.insight.budgetOverall' : 'analytics.insight.budgetCategories', {
        percent: formatPercentBps1(insight.usageBps),
      })
    case 'budget_used':
      return t('analytics.insight.budgetOver', {
        name: names.category(insight.categoryId),
        percent: formatPercentBps1(insight.usageBps),
        amount: money(insight.overBy),
      })
    case 'debt_paid':
      return t('analytics.insight.debtPaid', {
        amount: money(insight.paid),
        principal: money(insight.principal),
        cost: money(insight.interestAndFees),
      })
    case 'recurring_share':
      return t('analytics.insight.recurring', {
        amount: money(insight.total),
        percent: formatPercentBps1(insight.shareBps),
      })
    case 'available_change':
      return t(insight.diff === 0 ? 'analytics.insight.availableSame' : 'analytics.insight.available', {
        amount: money(insight.available),
        diff: `${insight.diff > 0 ? '+' : '−'}${money(abs(insight.diff))}`,
        month: prev,
      })
  }
}
