import type { Account, Category, ID, ISODate } from '@/domain/entities'
import { defaultExpenseAccountId, frequentExpenses, orderExpenseCategories, type FrequentExpense } from '@/domain/suggestions'
import { accountsRepository, categoriesRepository, transactionsRepository } from '@/db/repositories'
import { accountClassOf } from '@/domain/transactions'
import { addDaysISO } from '@/lib/dates'

/** History window for "frequent" items and category ordering. */
export const SUGGESTION_WINDOW_DAYS = 90

export interface QuickExpenseData {
  categories: Category[]
  accounts: Account[]
  frequent: FrequentExpense[]
  defaultAccountId: ID | undefined
}

/** Everything the form needs, derived from the user's saved data only. */
export async function loadQuickExpenseData(today: ISODate, type: 'expense' | 'income' | 'transfer' = 'expense'): Promise<QuickExpenseData> {
  const [categories, accounts, transactions] = await Promise.all([
    categoriesRepository.listAll(),
    accountsRepository.listAll(),
    transactionsRepository.listAll(),
  ])
  const since = addDaysISO(today, -SUGGESTION_WINDOW_DAYS)
  // Transfers have no category; both sides are chosen from active asset accounts by the form.
  const orderedCategories = type === 'transfer' ? [] : orderExpenseCategories(categories, transactions, since, type)
  const categoryIds = new Set(orderedCategories.map((c) => c.id))
  const openAccounts = accounts.filter((a) => !a.archivedAt)
  const openAccountIds = new Set(openAccounts.map((a) => a.id))
  return {
    categories: orderedCategories,
    accounts: openAccounts,
    // Only suggest items whose category and account still exist (expense suggestions only).
    frequent: type !== 'expense' ? [] : frequentExpenses(transactions, { since }).filter((f) => categoryIds.has(f.categoryId)).map((f) => ({
      ...f,
      accountId: openAccountIds.has(f.accountId) ? f.accountId : '',
    })),
    // A transfer starts from an asset account (the last expense may have been on a credit card).
    defaultAccountId:
      type === 'transfer'
        ? defaultExpenseAccountId(openAccounts.filter((a) => accountClassOf(a.kind) === 'asset'), transactions)
        : defaultExpenseAccountId(openAccounts, transactions, type),
  }
}
