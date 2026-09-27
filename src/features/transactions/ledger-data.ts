/**
 * Transactions page data: loader (repositories → raw records) and a pure
 * builder (raw + filters → view model). Rules live in domain/ledger.
 */
import { describeTransaction } from '@/components/finance/describe-transaction'
import type { Account, Category, Debt, ID, ISODate, Transaction, TransactionType } from '@/domain/entities'
import {
  compareNewestFirst,
  groupByDate,
  inRange,
  matchesSearch,
  matchesType,
  normalizeSearch,
  totalsInRange,
  type DateRange,
  LEDGER_TYPE_FILTERS,
  type LedgerTypeFilter,
  type PeriodTotals,
} from '@/domain/ledger'
import type { Satang } from '@/domain/money'
import {
  accountsRepository,
  attachmentsRepository,
  categoriesRepository,
  debtsRepository,
  transactionsRepository,
} from '@/db/repositories'
import { formatDate } from '@/lib/formatting'
import { isYearMonth, monthBounds, startOfWeekISO, yearMonthOf } from '@/lib/dates'

/** Rows rendered per step; more are revealed with "แสดงเพิ่ม". */
export const PAGE_SIZE = 50

export type RangePreset = 'today' | 'week' | 'month' | 'custom'

export interface LedgerFilters {
  type: LedgerTypeFilter
  preset: RangePreset
  customStart: ISODate
  customEnd: ISODate
  /** Already debounced by the page. */
  search: string
  /** Only this category (set by a deep link, e.g. from a budget). */
  categoryId?: ID
}

export function defaultFilters(today: ISODate): LedgerFilters {
  const month = monthBounds(yearMonthOf(today))
  return { type: 'all', preset: 'month', customStart: month.start, customEnd: today, search: '' }
}

/**
 * Filters from a deep link: `?month=YYYY-MM&type=expense&category=<id>`
 * (e.g. a budget's "ดูรายการ"). Unknown or malformed values are ignored.
 */
export function filtersFromParams(params: URLSearchParams, today: ISODate): LedgerFilters {
  const filters = defaultFilters(today)
  const month = params.get('month')
  if (isYearMonth(month)) {
    const { start, end } = monthBounds(month)
    Object.assign(filters, { preset: 'custom', customStart: start, customEnd: end })
  }
  const type = params.get('type')
  if (type && (LEDGER_TYPE_FILTERS as readonly string[]).includes(type)) filters.type = type as LedgerTypeFilter
  const category = params.get('category')
  if (category) filters.categoryId = category
  return filters
}

/** The link that opens the ledger on one month's expenses in one category. */
export const ledgerLinkFor = (month: string, categoryId?: ID) =>
  `/transactions?month=${month}&type=expense${categoryId ? `&category=${encodeURIComponent(categoryId)}` : ''}`

/** The date range a preset means today. A reversed custom range is swapped (and flagged). */
export function resolveRange(filters: LedgerFilters, today: ISODate): { range: DateRange; reversed: boolean } {
  switch (filters.preset) {
    case 'today':
      return { range: { start: today, end: today }, reversed: false }
    case 'week': {
      const start = startOfWeekISO(today)
      return { range: { start, end: today }, reversed: false }
    }
    case 'month':
      return { range: monthBounds(yearMonthOf(today)), reversed: false }
    case 'custom': {
      const { customStart: start, customEnd: end } = filters
      return start <= end ? { range: { start, end }, reversed: false } : { range: { start: end, end: start }, reversed: true }
    }
  }
}

export interface LedgerRawData {
  transactions: Transaction[]
  accounts: Account[]
  categories: Category[]
  debts: Debt[]
  transactionIdsWithAttachments: Set<ID>
}

export async function loadLedgerData(): Promise<LedgerRawData> {
  const [transactions, accounts, categories, debts, transactionIdsWithAttachments] = await Promise.all([
    transactionsRepository.listAll(),
    accountsRepository.listAll(),
    categoriesRepository.listAll(),
    debtsRepository.listAll(),
    // Index keys only — no attachment blobs are read for the list.
    attachmentsRepository.allTransactionIdsWithAttachments(),
  ])
  return { transactions, accounts, categories, debts, transactionIdsWithAttachments }
}

export interface LedgerRow {
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

export interface LedgerGroup {
  date: ISODate
  label: string
  rows: LedgerRow[]
}

export type LedgerEmptyReason = 'no_data' | 'no_search' | 'no_period'

export interface LedgerModel {
  range: DateRange
  rangeReversed: boolean
  /** Period totals (independent of the type filter and search). */
  summary: PeriodTotals
  groups: LedgerGroup[]
  matchCount: number
  shownCount: number
  emptyReason: LedgerEmptyReason | null
  /** Name of the category filter, when one is set. */
  categoryName?: string
}

export function buildLedger(raw: LedgerRawData, filters: LedgerFilters, today: ISODate, limit: number): LedgerModel {
  const { range, reversed } = resolveRange(filters, today)
  const categories = new Map(raw.categories.map((c) => [c.id, c]))
  const accounts = new Map(raw.accounts.map((a) => [a.id, a.name]))
  const debts = new Map(raw.debts.map((d) => [d.id, d.name]))
  const query = normalizeSearch(filters.search)

  const matches: LedgerRow[] = []
  for (const tx of [...raw.transactions].sort(compareNewestFirst)) {
    if (!inRange(tx.date, range) || !matchesType(tx.type, filters.type)) continue
    if (filters.categoryId && tx.categoryId !== filters.categoryId) continue
    const category = tx.categoryId ? categories.get(tx.categoryId) : undefined
    const row: LedgerRow = {
      id: tx.id,
      type: tx.type,
      title: describeTransaction(tx, {
        categoryName: category?.name,
        debtName: tx.debtId ? debts.get(tx.debtId) : undefined,
        toAccountName: tx.toAccountId ? accounts.get(tx.toAccountId) : undefined,
      }),
      amount: tx.amountSatang,
      date: tx.date,
      categoryLabel: category?.name,
      categoryIcon: category?.icon,
      accountLabel: accounts.get(tx.accountId),
      toAccountLabel: tx.toAccountId ? accounts.get(tx.toAccountId) : undefined,
      hasAttachment: raw.transactionIdsWithAttachments.has(tx.id),
    }
    if (query) {
      // Searchable: what the user wrote, category and account names (not attachment contents).
      const text = normalizeSearch(
        [row.title, tx.description, tx.payee, tx.note, row.categoryLabel, row.accountLabel, row.toAccountLabel].filter(Boolean).join(' '),
      )
      if (!matchesSearch(text, query)) continue
    }
    matches.push(row)
  }

  const shown = matches.slice(0, limit)
  const emptyReason: LedgerEmptyReason | null =
    raw.transactions.length === 0 ? 'no_data' : matches.length > 0 ? null : query ? 'no_search' : 'no_period'

  return {
    range,
    rangeReversed: reversed,
    summary: totalsInRange(raw.transactions, range),
    groups: groupByDate(shown).map((group) => ({ date: group.date, label: formatDate(group.date, 'long'), rows: group.items })),
    matchCount: matches.length,
    shownCount: shown.length,
    emptyReason,
    ...(filters.categoryId ? { categoryName: categories.get(filters.categoryId)?.name } : {}),
  }
}
