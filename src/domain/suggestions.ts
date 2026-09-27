/**
 * Suggestions for fast entry, derived only from the user's own saved data.
 * Nothing here creates records.
 */
import type { Account, Category, ID, ISODate, Transaction } from './entities'
import type { Satang } from './money'

export interface FrequentExpense {
  description: string
  categoryId: ID
  amountSatang: Satang
  accountId: ID
  /** Times this exact (description, category, amount) was recorded in the window. */
  count: number
  lastDate: ISODate
}

export interface FrequentExpenseOptions {
  /** Only consider expenses on or after this date. */
  since: ISODate
  /** Minimum repetitions to count as "frequent". */
  minCount?: number
  limit?: number
}

const normalize = (text: string) => text.trim().replace(/\s+/g, ' ').toLocaleLowerCase('th')

/**
 * Repeated expenses: same description, category and amount recorded at least
 * `minCount` times since `since`. Most frequent first, then most recent.
 * Expenses without a description are not suggested (nothing to recognise them by).
 */
export function frequentExpenses(
  transactions: readonly Transaction[],
  { since, minCount = 2, limit = 6 }: FrequentExpenseOptions,
): FrequentExpense[] {
  const groups = new Map<string, FrequentExpense>()
  for (const tx of transactions) {
    if (tx.type !== 'expense' || tx.date < since || !tx.categoryId) continue
    const description = tx.description?.trim()
    if (!description) continue
    const key = `${normalize(description)}|${tx.categoryId}|${tx.amountSatang}`
    const existing = groups.get(key)
    if (!existing) {
      groups.set(key, {
        description,
        categoryId: tx.categoryId,
        amountSatang: tx.amountSatang,
        accountId: tx.accountId,
        count: 1,
        lastDate: tx.date,
      })
    } else {
      existing.count += 1
      if (tx.date >= existing.lastDate) {
        existing.lastDate = tx.date
        existing.accountId = tx.accountId
        existing.description = description
      }
    }
  }
  return [...groups.values()]
    .filter((g) => g.count >= minCount)
    .sort((a, b) => b.count - a.count || b.lastDate.localeCompare(a.lastDate) || a.description.localeCompare(b.description))
    .slice(0, limit)
}

/**
 * Expense categories for the picker: most used since `since` first, then the
 * user's own order. Archived categories are left out.
 */
export function orderExpenseCategories(
  categories: readonly Category[],
  transactions: readonly Transaction[],
  since: ISODate,
  kind: 'expense' | 'income' = 'expense',
): Category[] {
  const usage = new Map<ID, number>()
  for (const tx of transactions) {
    if (tx.type === kind && tx.categoryId && tx.date >= since) {
      usage.set(tx.categoryId, (usage.get(tx.categoryId) ?? 0) + 1)
    }
  }
  return categories
    .filter((c) => c.kind === kind && !c.archivedAt)
    .sort((a, b) => (usage.get(b.id) ?? 0) - (usage.get(a.id) ?? 0) || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
}

/**
 * The account to preselect for a new expense: the one used by the most recent
 * expense (if still open), otherwise the first open account. Undefined when
 * the user has no open accounts — never invented.
 */
export function defaultExpenseAccountId(
  accounts: readonly Account[],
  transactions: readonly Transaction[],
  type: 'expense' | 'income' = 'expense',
): ID | undefined {
  const open = accounts.filter((a) => !a.archivedAt).sort((a, b) => a.sortOrder - b.sortOrder)
  const openIds = new Set(open.map((a) => a.id))
  let latest: Transaction | undefined
  for (const tx of transactions) {
    if (tx.type !== type || !openIds.has(tx.accountId)) continue
    if (!latest || tx.date > latest.date || (tx.date === latest.date && tx.createdAt > latest.createdAt)) latest = tx
  }
  return latest?.accountId ?? open[0]?.id
}
