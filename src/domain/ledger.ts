/**
 * Ledger: pure functions behind the Transactions page — ordering, date
 * ranges, type filters, search matching, grouping and period totals.
 * Same rules as reporting: debt payments are their own total (never
 * expenses); transfers and adjustments are in neither income nor expense.
 */
import type { ISODate, Transaction, TransactionType } from './entities'
import { add, ZERO, type Satang } from './money'

export const LEDGER_TYPE_FILTERS = ['all', 'expense', 'income', 'debt_payment', 'transfer'] as const
export type LedgerTypeFilter = (typeof LEDGER_TYPE_FILTERS)[number]

export interface DateRange {
  start: ISODate
  end: ISODate
}

/** Newest first: by date, then by entry time, then id for a stable order. */
export function compareNewestFirst(a: Transaction, b: Transaction): number {
  return b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)
}

/** Inclusive; ISO dates compare correctly as strings (no time zones involved). */
export function inRange(date: ISODate, range: DateRange): boolean {
  return date >= range.start && date <= range.end
}

export function matchesType(type: TransactionType, filter: LedgerTypeFilter): boolean {
  return filter === 'all' || type === filter
}

export interface PeriodTotals {
  income: Satang
  incomeCount: number
  expense: Satang
  expenseCount: number
  debtPayment: Satang
  debtPaymentCount: number
}

export function totalsInRange(transactions: readonly Transaction[], range: DateRange): PeriodTotals {
  const totals: PeriodTotals = { income: ZERO, incomeCount: 0, expense: ZERO, expenseCount: 0, debtPayment: ZERO, debtPaymentCount: 0 }
  for (const tx of transactions) {
    if (!inRange(tx.date, range)) continue
    if (tx.type === 'income') {
      totals.income = add(totals.income, tx.amountSatang)
      totals.incomeCount += 1
    } else if (tx.type === 'expense') {
      totals.expense = add(totals.expense, tx.amountSatang)
      totals.expenseCount += 1
    } else if (tx.type === 'debt_payment') {
      totals.debtPayment = add(totals.debtPayment, tx.amountSatang)
      totals.debtPaymentCount += 1
    }
  }
  return totals
}

/** Case- and spacing-insensitive form used for search (Thai-aware lower-casing). */
export function normalizeSearch(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLocaleLowerCase('th')
}

/** Every whitespace-separated term of the query must appear somewhere in the text. */
export function matchesSearch(normalizedText: string, query: string): boolean {
  const terms = normalizeSearch(query).split(' ').filter(Boolean)
  return terms.every((term) => normalizedText.includes(term))
}

export interface DateGroup<T> {
  date: ISODate
  items: T[]
}

/** Consecutive items sharing a date become one group (input should already be sorted). */
export function groupByDate<T extends { date: ISODate }>(items: readonly T[]): DateGroup<T>[] {
  const groups: DateGroup<T>[] = []
  for (const item of items) {
    const last = groups.at(-1)
    if (last && last.date === item.date) last.items.push(item)
    else groups.push({ date: item.date, items: [item] })
  }
  return groups
}
