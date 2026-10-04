/**
 * Daily Expenses page data: the Transactions loader (one data set for the
 * whole app) and a pure view-model builder.
 *
 * Expense = `type === 'expense'` only — money already spent, including bills
 * paid from the plan (rent, electricity). Debt payments, transfers, income and
 * adjustments are never expenses: a card purchase is the expense; paying the
 * card later is a debt payment and adds nothing here.
 */
import { describeTransaction } from '@/components/finance/describe-transaction'
import type { Category, ISODate, Transaction } from '@/domain/entities'
import { compareNewestFirst, groupByDate, inRange, matchesSearch, normalizeSearch, type DateRange } from '@/domain/ledger'
import { add, ratioBps, tryParseBaht, ZERO, type Satang } from '@/domain/money'
import { addDays } from '@/domain/recurrence'
import { defaultFilters, loadLedgerData, resolveRange, type LedgerFilters, type LedgerRawData, type LedgerRow } from '@/features/transactions/ledger-data'
import { monthBounds, startOfWeekISO, yearMonthOf } from '@/lib/dates'
import { formatDate } from '@/lib/formatting'
import { t } from '@/lib/i18n'

export { loadLedgerData as loadExpenseBookData }

export const EXPENSE_PAGE_SIZE = 50
export const ALL = 'all'
/** Categories listed by name in the breakdown; the rest are summed into "อื่น ๆ". */
export const TOP_CATEGORIES = 5

export interface ExpenseFilters extends LedgerFilters {
  /** Expense category id, or 'all'. */
  categoryId: string
  /** Paying account id, or 'all'. */
  accountId: string
  /** Amount range as typed (baht); empty = no limit. */
  minAmount: string
  maxAmount: string
}

export function defaultExpenseFilters(today: ISODate): ExpenseFilters {
  return { ...defaultFilters(today), type: 'expense', categoryId: ALL, accountId: ALL, minAmount: '', maxAmount: '' }
}

export const isExpense = (tx: Pick<Transaction, 'type'>) => tx.type === 'expense'

export interface ExpenseSummary {
  today: Satang
  week: Satang
  month: Satang
}

/** Spent today / this week (from Monday) / this month — always all expenses, whatever the filters. */
export function expenseSummary(transactions: readonly Transaction[], today: ISODate): ExpenseSummary {
  const week: DateRange = { start: startOfWeekISO(today), end: today }
  const month = monthBounds(yearMonthOf(today))
  const summary = { today: ZERO, week: ZERO, month: ZERO }
  for (const tx of transactions) {
    if (!isExpense(tx)) continue
    if (tx.date === today) summary.today = add(summary.today, tx.amountSatang)
    if (inRange(tx.date, week)) summary.week = add(summary.week, tx.amountSatang)
    if (inRange(tx.date, month)) summary.month = add(summary.month, tx.amountSatang)
  }
  return summary
}

export interface ExpenseDay {
  date: ISODate
  /** "วันนี้", "เมื่อวาน", or the weekday and date. */
  label: string
  /** The date itself, shown under "วันนี้" / "เมื่อวาน". */
  dateLabel?: string
  /** Every matching expense of the day (also those not shown yet). */
  total: Satang
  count: number
  rows: LedgerRow[]
}

export interface CategoryShare {
  /** Category id; 'other' = the rest summed; 'none' = no category. */
  id: string
  label: string
  icon?: string
  amount: Satang
  /** Share of the matching total, in basis points (3860 = 38.60%). */
  shareBps: number
}

export interface ExpenseBookModel {
  range: DateRange
  rangeReversed: boolean
  summary: ExpenseSummary
  /** Total of everything matching the filters. */
  total: Satang
  categories: CategoryShare[]
  days: ExpenseDay[]
  matchCount: number
  shownCount: number
  emptyReason: 'no_data' | 'no_match' | null
  /** An amount bound that is not a number (ignored until fixed). */
  amountInvalid: boolean
  /** Some filter beyond the period is set (category, account, amount, search). */
  narrowed: boolean
  categoryOptions: { value: string; label: string }[]
  accountOptions: { value: string; label: string }[]
}

const pick = (value: string): string | undefined => (value === ALL ? undefined : value)
const parseBound = (text: string): Satang | null | undefined => (text.trim() === '' ? undefined : tryParseBaht(text))

function dayLabel(date: ISODate, today: ISODate): { label: string; dateLabel?: string } {
  if (date === today) return { label: t('expenses.day.today'), dateLabel: formatDate(date, 'long') }
  if (date === addDays(today, -1)) return { label: t('expenses.day.yesterday'), dateLabel: formatDate(date, 'long') }
  return { label: formatDate(date, 'long') }
}

export function buildExpenseBook(raw: LedgerRawData, filters: ExpenseFilters, today: ISODate, limit: number): ExpenseBookModel {
  const { range, reversed } = resolveRange(filters, today)
  const categories = new Map(raw.categories.map((c) => [c.id, c]))
  const accounts = new Map(raw.accounts.map((a) => [a.id, a]))
  const categoryId = pick(filters.categoryId)
  const accountId = pick(filters.accountId)
  const min = parseBound(filters.minAmount)
  const max = parseBound(filters.maxAmount)
  const query = normalizeSearch(filters.search)

  const matches: LedgerRow[] = []
  let total = ZERO
  const byCategory = new Map<string, Satang>()
  const dayTotals = new Map<ISODate, { total: Satang; count: number }>()
  for (const tx of [...raw.transactions].sort(compareNewestFirst)) {
    if (!isExpense(tx) || !inRange(tx.date, range)) continue
    if (categoryId !== undefined && tx.categoryId !== categoryId) continue
    if (accountId !== undefined && tx.accountId !== accountId) continue
    if (typeof min === 'number' && tx.amountSatang < min) continue
    if (typeof max === 'number' && tx.amountSatang > max) continue
    const category = tx.categoryId ? categories.get(tx.categoryId) : undefined
    const accountName = accounts.get(tx.accountId)?.name
    const title = describeTransaction(tx, { categoryName: category?.name })
    // Search: what the user wrote, category and account names, tags (never attachment contents).
    if (query && !matchesSearch(normalizeSearch([title, tx.description, tx.payee, tx.note, category?.name, accountName, ...(tx.tags ?? [])].filter(Boolean).join(' ')), query)) continue

    total = add(total, tx.amountSatang)
    const key = category ? category.id : 'none'
    byCategory.set(key, add(byCategory.get(key) ?? ZERO, tx.amountSatang))
    const day = dayTotals.get(tx.date) ?? { total: ZERO, count: 0 }
    dayTotals.set(tx.date, { total: add(day.total, tx.amountSatang), count: day.count + 1 })
    matches.push({
      id: tx.id,
      type: tx.type,
      title,
      amount: tx.amountSatang,
      date: tx.date,
      categoryLabel: category?.name,
      categoryIcon: category?.icon,
      accountLabel: accountName,
      hasAttachment: raw.transactionIdsWithAttachments.has(tx.id),
    })
  }

  const ranked = [...byCategory].sort((a, b) => b[1] - a[1])
  const shares: CategoryShare[] = ranked.slice(0, TOP_CATEGORIES).map(([id, amount]) => {
    const category = id === 'none' ? undefined : categories.get(id)
    return { id, label: category?.name ?? t('expenses.category.none'), icon: category?.icon, amount, shareBps: ratioBps(amount, total) }
  })
  const rest = ranked.slice(TOP_CATEGORIES).reduce((sum, [, amount]) => add(sum, amount), ZERO)
  if (rest > 0) shares.push({ id: 'other', label: t('expenses.category.other'), amount: rest, shareBps: ratioBps(rest, total) })

  const shown = matches.slice(0, limit)
  const anyExpense = raw.transactions.some(isExpense)

  // Filter choices: live expense categories and accounts, plus archived ones still used by expenses.
  const usedCategoryIds = new Set(raw.transactions.filter(isExpense).map((tx) => tx.categoryId))
  const expenseCategories = raw.categories
    .filter((c): c is Category => c.kind === 'expense' && (!c.archivedAt || usedCategoryIds.has(c.id)))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
  const usedAccountIds = new Set(raw.transactions.filter(isExpense).map((tx) => tx.accountId))
  const accountChoices = raw.accounts.filter((a) => !a.archivedAt || usedAccountIds.has(a.id))

  return {
    range,
    rangeReversed: reversed,
    summary: expenseSummary(raw.transactions, today),
    total,
    categories: shares,
    days: groupByDate(shown).map((group) => ({
      date: group.date,
      ...dayLabel(group.date, today),
      total: dayTotals.get(group.date)!.total,
      count: dayTotals.get(group.date)!.count,
      rows: group.items,
    })),
    matchCount: matches.length,
    shownCount: shown.length,
    emptyReason: !anyExpense ? 'no_data' : matches.length === 0 ? 'no_match' : null,
    amountInvalid: min === null || max === null,
    narrowed: categoryId !== undefined || accountId !== undefined || min !== undefined || max !== undefined || query !== '',
    categoryOptions: [{ value: ALL, label: t('expenses.filter.all') }, ...expenseCategories.map((c) => ({ value: c.id, label: `${c.icon ? `${c.icon} ` : ''}${c.name}` }))],
    accountOptions: [{ value: ALL, label: t('expenses.filter.all') }, ...accountChoices.map((a) => ({ value: a.id, label: a.name }))],
  }
}
