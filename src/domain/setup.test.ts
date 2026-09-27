import { describe, expect, it } from 'vitest'
import { EMPTY_SETUP_COUNTS, getSetupStatus, type SetupCounts } from './setup'

const status = (counts: Partial<SetupCounts>) => getSetupStatus({ ...EMPTY_SETUP_COUNTS, ...counts })
const item = (counts: Partial<SetupCounts>, key: string) => status(counts).items.find((i) => i.key === key)!

describe('setup status (derived from counts)', () => {
  it('empty database: first run, nothing done, not complete', () => {
    const s = status({})
    expect(s).toMatchObject({ isFirstRun: true, complete: false, doneCount: 0 })
    expect(s.items.map((i) => i.key)).toEqual(['accounts', 'categories', 'income', 'debts', 'recurring', 'budget', 'firstEntry'])
  })

  it('accounts: done with at least one open account; first run ends', () => {
    expect(item({}, 'accounts')).toMatchObject({ done: false, optional: false })
    expect(item({ accounts: 3 }, 'accounts')).toMatchObject({ done: true, count: 3 })
    expect(status({ accounts: 1 }).isFirstRun).toBe(false)
  })

  it('income: done with a recurring income rule or any income transaction', () => {
    expect(item({}, 'income').done).toBe(false)
    expect(item({ incomeRules: 1 }, 'income')).toMatchObject({ done: true, count: 1, optional: true })
    expect(item({ incomeTransactions: 2 }, 'income').done).toBe(true)
  })

  it('debts, recurring rules and budget are optional', () => {
    expect(item({ debts: 2 }, 'debts')).toMatchObject({ done: true, count: 2, optional: true })
    expect(item({ recurringBills: 2 }, 'recurring')).toMatchObject({ done: true, count: 2, optional: true })
    expect(item({ budgetsThisMonth: 1 }, 'budget')).toMatchObject({ done: true, optional: true })
  })

  it('complete once accounts, expense categories and a first entry exist (optional items do not block)', () => {
    expect(status({ accounts: 1, expenseCategories: 9 }).complete).toBe(false)
    const s = status({ accounts: 1, expenseCategories: 9, incomeCategories: 7, transactions: 1 })
    expect(s.complete).toBe(true)
    expect(s.items.find((i) => i.key === 'categories')!.count).toBe(16)
    expect(s.doneCount).toBe(3)
  })
})
