/**
 * Dashboard data: one loader (repositories → raw records) and one pure
 * builder (raw records → view model). All financial rules come from
 * domain/reporting; this file only selects, joins names and limits lists.
 */
import { toCategorySlices, type CategorySlice } from './category-slices'
import { describeTransaction } from '@/components/finance/describe-transaction'
import type {
  Account,
  Budget,
  Category,
  Debt,
  ID,
  ISODate,
  RecurringObligation,
  ScheduledPayment,
  Transaction,
  TransactionType,
} from '@/domain/entities'
import type { Satang } from '@/domain/money'
import {
  cashFlow,
  debtSummary,
  monthTotals,
  recentTransactions,
  spendingByCategory,
  upcomingPayments,
  type AvailableMoney,
  type CashFlowPoint,
  type MonthTotals,
  type UpcomingStatus,
} from '@/domain/reporting'
import {
  accountsRepository,
  attachmentsRepository,
  categoriesRepository,
  budgetsRepository,
  debtsRepository,
  recurringObligationsRepository,
  scheduledPaymentsRepository,
  transactionsRepository,
} from '@/db/repositories'
import { calculateAvailableMoney } from '@/domain/accounts'
import { getMonthlyBudgetSummary, type BudgetStatus } from '@/domain/budget'
import { daysOverdue, isIncomeObligation } from '@/domain/scheduling'
import { addDaysISO, monthBounds, monthsEnding, type YearMonth } from '@/lib/dates'
import { t } from '@/lib/i18n'

/** Days ahead that count as "due soon" (also extends the upcoming list past month end). */
export const DUE_SOON_DAYS = 7
export const RECENT_LIMIT = 6
export const UPCOMING_LIMIT = 5
export const CASH_FLOW_MONTHS = 6
/** Donut slices: up to 5, i.e. top 4 categories + "อื่น ๆ" when there are more. */
export const MAX_CATEGORY_SLICES = 5
export const TOP_DEBTS = 3

export interface DashboardPeriod {
  month: YearMonth
  today: ISODate
}

/** Upcoming payments are due by the end of the selected month, or within DUE_SOON_DAYS, whichever is later. */
export function upcomingWindow({ month, today }: DashboardPeriod) {
  const monthEnd = monthBounds(month).end
  const dueSoonUntil = addDaysISO(today, DUE_SOON_DAYS)
  return { until: monthEnd > dueSoonUntil ? monthEnd : dueSoonUntil, dueSoonUntil }
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

export interface DashboardRawData {
  accounts: Account[]
  categories: Category[]
  transactions: Transaction[]
  debts: Debt[]
  obligations: RecurringObligation[]
  pendingPayments: ScheduledPayment[]
  transactionIdsWithAttachments: Set<ID>
  /** Budget plans (spending still comes from transactions). */
  budgets?: Budget[]
}

export async function loadDashboardData(period: DashboardPeriod): Promise<DashboardRawData> {
  const { until } = upcomingWindow(period)
  const [accounts, categories, transactions, debts, obligations, pendingPayments, budgets] = await Promise.all([
    accountsRepository.listAll(),
    categoriesRepository.listAll(),
    transactionsRepository.listAll(),
    debtsRepository.listAll(),
    recurringObligationsRepository.listAll(),
    scheduledPaymentsRepository.listPendingDueBy(until),
    budgetsRepository.listForMonth(period.month),
  ])
  const recentIds = recentTransactions(transactions, RECENT_LIMIT).map((tx) => tx.id)
  const transactionIdsWithAttachments = await attachmentsRepository.transactionIdsWithAttachments(recentIds)
  return { accounts, categories, transactions, debts, obligations, pendingPayments, transactionIdsWithAttachments, budgets }
}

// ---------------------------------------------------------------------------
// View model
// ---------------------------------------------------------------------------

export type { CategorySlice }

export interface RecentRow {
  id: ID
  type: TransactionType
  title: string
  amount: Satang
  date: ISODate
  categoryLabel?: string
  categoryIcon?: string
  accountLabel?: string
  toAccountLabel?: string
  hasAttachment: boolean
}

export interface UpcomingRow {
  id: ID
  name: string
  sourceType: ScheduledPayment['sourceType']
  sourceId: ID
  dueDate: ISODate
  amount: Satang
  status: UpcomingStatus
  /** Days past due (0 unless overdue). */
  overdueDays: number
}

export interface DebtRow {
  id: ID
  name: string
  /** Null = unknown (never shown as zero). */
  outstanding: Satang | null
}

export interface DashboardModel {
  month: YearMonth
  isCurrentMonth: boolean
  /** True when nothing at all has been recorded yet. */
  isEmpty: boolean
  available: AvailableMoney
  /** Set for a past month: the available money shown is as of this date. */
  availableAsOf?: ISODate
  totals: MonthTotals
  upcoming: { total: Satang; count: number; overdueCount: number; items: UpcomingRow[] }
  spending: { total: Satang; slices: CategorySlice[] }
  cashFlow: CashFlowPoint[]
  recent: RecentRow[]
  /** The month's budget headline (overall limit, else the sum of category budgets); null without budgets. */
  budget: { scope: 'overall' | 'categories'; limit: Satang; spent: Satang; usageBps: number | null; status: BudgetStatus } | null
  debt: {
    /** Set when a past month is shown: balances are as of that month's end, not today. */
    asOf?: ISODate
    totalOutstanding: Satang
    activeCount: number
    top: DebtRow[]
    progress: { original: Satang; paid: Satang; paidBps: number } | null
  }
}

/** Same numbers as #/budget (shared domain function), reduced to a headline. */
function budgetHeadline(budgets: readonly Budget[], transactions: readonly Transaction[], month: YearMonth): DashboardModel['budget'] {
  const summary = getMonthlyBudgetSummary(budgets, transactions, month)
  if (summary.overall) return { scope: 'overall', limit: summary.overall.limit, spent: summary.overall.spent, usageBps: summary.overall.usageBps, status: summary.overall.status }
  if (summary.categories.length === 0) return null
  const totals = summary.categoryTotals
  return { scope: 'categories', limit: totals.limit, spent: totals.spent, usageBps: totals.usageBps, status: totals.status }
}

export function buildDashboardModel(raw: DashboardRawData, period: DashboardPeriod): DashboardModel {
  const { month, today } = period
  const categories = new Map(raw.categories.map((c) => [c.id, c]))
  const accountNames = new Map(raw.accounts.map((a) => [a.id, a.name]))

  // Spending by category → coloured slices (at most five, so colours never repeat).
  const breakdown = spendingByCategory(raw.transactions, month, MAX_CATEGORY_SLICES)
  const slices = toCategorySlices(breakdown, categories)

  // Upcoming payments with their source names.
  const window = upcomingWindow(period)
  // Payments to make only: expected income (salary…) is not an obligation to pay.
  const incomeRules = new Set(raw.obligations.filter(isIncomeObligation).map((o) => o.id))
  const outgoing = raw.pendingPayments.filter((p) => !(p.sourceType === 'obligation' && incomeRules.has(p.sourceId)))
  const upcoming = upcomingPayments(outgoing, { today, ...window })
  const obligationNames = new Map(raw.obligations.map((o) => [o.id, o.name]))
  const debtNames = new Map(raw.debts.map((d) => [d.id, d.name]))
  const upcomingItems = upcoming.items.slice(0, UPCOMING_LIMIT).map(({ payment, status }): UpcomingRow => ({
    id: payment.id,
    name:
      (payment.sourceType === 'obligation' ? obligationNames : debtNames).get(payment.sourceId) ??
      t('dashboard.upcomingList.unknown'),
    sourceType: payment.sourceType,
    sourceId: payment.sourceId,
    dueDate: payment.dueDate,
    amount: payment.expectedAmountSatang,
    status,
    overdueDays: daysOverdue(payment, today),
  }))

  const recent = recentTransactions(raw.transactions, RECENT_LIMIT).map((tx): RecentRow => {
    const category = tx.categoryId ? categories.get(tx.categoryId) : undefined
    return {
      id: tx.id,
      type: tx.type,
      title: describeTransaction(tx, {
        categoryName: category?.name,
        debtName: tx.debtId ? debtNames.get(tx.debtId) : undefined,
        toAccountName: tx.toAccountId ? accountNames.get(tx.toAccountId) : undefined,
      }),
      amount: tx.amountSatang,
      date: tx.date,
      categoryLabel: category?.name,
      categoryIcon: category?.icon,
      accountLabel: accountNames.get(tx.accountId),
      toAccountLabel: tx.toAccountId ? accountNames.get(tx.toAccountId) : undefined,
      hasAttachment: raw.transactionIdsWithAttachments.has(tx.id),
    }
  })

  // A past month shows that month's closing balance; the current/future months show today's.
  const monthEnd = monthBounds(month).end
  const debtAsOf = monthEnd < today ? monthEnd : today
  const debts = debtSummary(raw.debts, raw.transactions, raw.accounts, debtAsOf)

  return {
    month,
    isCurrentMonth: month === today.slice(0, 7),
    isEmpty:
      raw.accounts.length === 0 && raw.transactions.length === 0 && raw.debts.length === 0 && raw.pendingPayments.length === 0,
    // Past months: as of that month-end (same as-of date as the debt card); accounts opened later are left out.
    available: calculateAvailableMoney(raw.accounts, raw.transactions, debtAsOf),
    ...(debtAsOf < today ? { availableAsOf: debtAsOf } : {}),
    totals: monthTotals(raw.transactions, month),
    upcoming: { total: upcoming.total, count: upcoming.items.length, overdueCount: upcoming.overdueCount, items: upcomingItems },
    spending: { total: breakdown.total, slices },
    cashFlow: cashFlow(raw.transactions, monthsEnding(month, CASH_FLOW_MONTHS)),
    recent,
    budget: budgetHeadline(raw.budgets ?? [], raw.transactions, month),
    debt: {
      ...(debtAsOf < today ? { asOf: debtAsOf } : {}),
      totalOutstanding: debts.totalOutstanding,
      activeCount: debts.activeCount,
      top: debts.items.slice(0, TOP_DEBTS).map((i) => ({ id: i.debt.id, name: i.debt.name, outstanding: i.outstanding })),
      progress: debts.progress,
    },
  }
}
