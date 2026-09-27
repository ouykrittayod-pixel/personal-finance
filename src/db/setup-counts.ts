import type { SetupCounts } from '@/domain/setup'
import type { FinanceDatabase } from './dexie'

/**
 * Setup status counts — lightweight: indexed counts for transactions, budgets
 * and categories; the small configuration tables (accounts, debts, rules) are
 * filtered in place. Never reads transaction history or attachments.
 */
export async function loadSetupCounts(database: FinanceDatabase, month: string): Promise<SetupCounts> {
  return database.transaction(
    'r',
    [database.accounts, database.categories, database.recurringObligations, database.debts, database.budgets, database.transactions],
    async () => {
      const open = <T extends { archivedAt?: string }>(row: T) => !row.archivedAt
      const [accounts, creditCards, expenseCategories, incomeCategories, rules, debts, budgetsThisMonth, incomeTransactions, transactions] = await Promise.all([
        database.accounts.filter(open).count(),
        database.accounts.where('kind').equals('credit_card').filter(open).count(),
        database.categories.where('kind').equals('expense').filter(open).count(),
        database.categories.where('kind').equals('income').filter(open).count(),
        database.recurringObligations.filter(open).toArray(),
        database.debts.filter((d) => !d.archivedAt && d.status !== 'closed').count(),
        database.budgets.where('month').equals(month).count(),
        database.transactions.where('type').equals('income').count(),
        database.transactions.count(),
      ])
      const incomeRules = rules.filter((r) => r.kind === 'income').length
      return {
        accounts,
        creditCards,
        expenseCategories,
        incomeCategories,
        incomeRules,
        incomeTransactions,
        debts,
        recurringBills: rules.length - incomeRules,
        budgetsThisMonth,
        transactions,
      }
    },
  )
}
