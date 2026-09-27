import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { baht, makeAccount, makeCategory, makeDebt, makeObligation, makeTx } from '@/test/factories'
import { FinanceDatabase } from './dexie'
import { loadSetupCounts } from './setup-counts'

let database: FinanceDatabase
let n = 0
beforeEach(() => {
  database = new FinanceDatabase(`setup-counts-${++n}`)
})
afterEach(async () => {
  database.close()
  await database.delete()
})

describe('setup counts', () => {
  it('empty database: all zero', async () => {
    expect(Object.values(await loadSetupCounts(database, '2026-09')).every((v) => v === 0)).toBe(true)
  })

  it('counts open records only (archived / closed are not "set up")', async () => {
    await database.accounts.bulkAdd([
      makeAccount({ id: 'a' }),
      makeAccount({ id: 'c', kind: 'credit_card' }),
      makeAccount({ id: 'old', archivedAt: '2026-01-02T00:00:00.000Z' }),
    ])
    await database.categories.bulkAdd([
      makeCategory({ id: 'food' }),
      makeCategory({ id: 'sal', kind: 'income' }),
      makeCategory({ id: 'x', archivedAt: '2026-01-02T00:00:00.000Z' }),
    ])
    await database.recurringObligations.bulkAdd([
      makeObligation({ id: 'rent' }),
      makeObligation({ id: 'salary', kind: 'income' }),
      makeObligation({ id: 'gone', archivedAt: '2026-01-02T00:00:00.000Z' }),
    ])
    await database.debts.bulkAdd([makeDebt({ id: 'home' }), makeDebt({ id: 'done', status: 'closed' })])
    await database.budgets.bulkAdd([
      { id: 'b1', month: '2026-09', categoryId: 'food', limitSatang: baht(6_000), createdAt: 'c', updatedAt: 'u' },
      { id: 'b2', month: '2026-08', categoryId: 'food', limitSatang: baht(6_000), createdAt: 'c', updatedAt: 'u' },
    ])
    await database.transactions.bulkAdd([
      makeTx({ id: 't1', type: 'income', amountSatang: baht(1), accountId: 'a' }),
      makeTx({ id: 't2', type: 'expense', amountSatang: baht(1), accountId: 'a' }),
    ])
    expect(await loadSetupCounts(database, '2026-09')).toEqual({
      accounts: 2,
      creditCards: 1,
      expenseCategories: 1,
      incomeCategories: 1,
      incomeRules: 1,
      incomeTransactions: 1,
      debts: 1,
      recurringBills: 1,
      budgetsThisMonth: 1,
      transactions: 2,
    })
  })

  it('is lightweight: transactions and attachments are counted, never loaded', async () => {
    await database.transactions.bulkAdd(Array.from({ length: 50 }, (_, i) => makeTx({ id: `t${i}`, type: 'expense', amountSatang: baht(1), accountId: 'a' })))
    const txLoad = vi.spyOn(database.transactions, 'toArray')
    const blobLoad = vi.spyOn(database.attachmentBlobs, 'toArray')
    expect((await loadSetupCounts(database, '2026-09')).transactions).toBe(50)
    expect(txLoad).not.toHaveBeenCalled()
    expect(blobLoad).not.toHaveBeenCalled()
  })
})
