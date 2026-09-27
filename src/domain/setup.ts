/**
 * First-run setup status — derived from what is in the database (counts only),
 * never stored. Informational: nothing is blocked by it and nothing is created.
 */

export interface SetupCounts {
  /** Open (not archived) accounts. */
  accounts: number
  creditCards: number
  expenseCategories: number
  incomeCategories: number
  /** Recurring income rules (not archived). */
  incomeRules: number
  incomeTransactions: number
  /** Debts being tracked (not archived or closed). */
  debts: number
  /** Recurring bills / debt payments (not archived). */
  recurringBills: number
  /** Budgets of the current month. */
  budgetsThisMonth: number
  transactions: number
}

export const SETUP_ITEMS = ['accounts', 'categories', 'income', 'debts', 'recurring', 'budget', 'firstEntry'] as const
export type SetupItemKey = (typeof SETUP_ITEMS)[number]

export interface SetupItem {
  key: SetupItemKey
  done: boolean
  /** Not everyone has debts, bills or a budget — optional items never count against "complete". */
  optional: boolean
  count: number
}

export interface SetupStatus {
  items: SetupItem[]
  /** Nothing set up yet: no accounts and no transactions. */
  isFirstRun: boolean
  /** Every required item (accounts, categories, a first entry) is done. */
  complete: boolean
  doneCount: number
}

export const EMPTY_SETUP_COUNTS: SetupCounts = {
  accounts: 0,
  creditCards: 0,
  expenseCategories: 0,
  incomeCategories: 0,
  incomeRules: 0,
  incomeTransactions: 0,
  debts: 0,
  recurringBills: 0,
  budgetsThisMonth: 0,
  transactions: 0,
}

export function getSetupStatus(c: SetupCounts): SetupStatus {
  const items: SetupItem[] = [
    { key: 'accounts', done: c.accounts > 0, optional: false, count: c.accounts },
    { key: 'categories', done: c.expenseCategories > 0, optional: false, count: c.expenseCategories + c.incomeCategories },
    { key: 'income', done: c.incomeRules > 0 || c.incomeTransactions > 0, optional: true, count: c.incomeRules },
    { key: 'debts', done: c.debts > 0, optional: true, count: c.debts },
    { key: 'recurring', done: c.recurringBills > 0, optional: true, count: c.recurringBills },
    { key: 'budget', done: c.budgetsThisMonth > 0, optional: true, count: c.budgetsThisMonth },
    { key: 'firstEntry', done: c.transactions > 0, optional: false, count: c.transactions },
  ]
  return {
    items,
    isFirstRun: c.accounts === 0 && c.transactions === 0,
    complete: items.every((item) => item.optional || item.done),
    doneCount: items.filter((item) => item.done).length,
  }
}
