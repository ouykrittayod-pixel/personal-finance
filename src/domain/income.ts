/**
 * Income reporting. Pure. Income = transactions of type `income` only:
 * transfers, expenses, debt payments and adjustments are never income.
 * Periods are by transaction date (never createdAt).
 */
import type { ID, Transaction } from './entities'
import { add, multiplyRatio, ZERO, type Satang } from './money'
import { inRange, type DateRange } from './ledger'

export const isIncome = (tx: Pick<Transaction, 'type'>) => tx.type === 'income'

export interface IncomeFilter {
  categoryId?: ID
  accountId?: ID
}

const matches = (tx: Transaction, range: DateRange, filter: IncomeFilter) =>
  isIncome(tx) &&
  inRange(tx.date, range) &&
  (filter.categoryId === undefined || tx.categoryId === filter.categoryId) &&
  (filter.accountId === undefined || tx.accountId === filter.accountId)

/** Income transactions in a date range (optionally one category / one account). */
export function incomeIn(transactions: readonly Transaction[], range: DateRange, filter: IncomeFilter = {}): Transaction[] {
  return transactions.filter((tx) => matches(tx, range, filter))
}

export interface IncomeTotal {
  total: Satang
  count: number
  /** Mean per income transaction, rounded half-up to whole satang; null when there is none. */
  average: Satang | null
}

export function incomePeriodTotal(transactions: readonly Transaction[], range: DateRange, filter: IncomeFilter = {}): IncomeTotal {
  let total = ZERO
  let count = 0
  for (const tx of transactions) {
    if (!matches(tx, range, filter)) continue
    total = add(total, tx.amountSatang)
    count += 1
  }
  return { total, count, average: count === 0 ? null : multiplyRatio(total, 1, count) }
}

/** Totals keyed by a transaction field, largest first. Uncategorised income is keyed ''. */
function totalsBy(transactions: readonly Transaction[], range: DateRange, key: (tx: Transaction) => ID): { id: ID; total: Satang; count: number }[] {
  const byKey = new Map<ID, { id: ID; total: Satang; count: number }>()
  for (const tx of transactions) {
    if (!matches(tx, range, {})) continue
    const id = key(tx)
    const entry = byKey.get(id) ?? { id, total: ZERO, count: 0 }
    entry.total = add(entry.total, tx.amountSatang)
    entry.count += 1
    byKey.set(id, entry)
  }
  return [...byKey.values()].sort((a, b) => b.total - a.total || a.id.localeCompare(b.id))
}

export const incomeCategoryTotal = (transactions: readonly Transaction[], range: DateRange) => totalsBy(transactions, range, (tx) => tx.categoryId ?? '')
export const incomeAccountTotal = (transactions: readonly Transaction[], range: DateRange) => totalsBy(transactions, range, (tx) => tx.accountId)
