import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { add, satang } from '@/domain/money'
import { baht, makeAccount, makeCategory } from '@/test/factories'
import { FinanceDatabase } from '../dexie'
import { StorageError } from '../errors'
import { createCategoriesRepository } from './categories'
import { createTransactionsRepository, ExpenseValidationError } from './transactions'

let database: FinanceDatabase
let repo: ReturnType<typeof createTransactionsRepository>
let counter = 0
const meta = (id = 'tx-1') => ({ id, now: '2026-09-25T05:00:00.000Z', newId: () => `att-${++counter}` })
const draft = {
  amountSatang: satang(18550),
  categoryId: 'food',
  accountId: 'cash',
  date: '2026-09-25',
  description: 'ข้าวกลางวัน',
}

beforeEach(async () => {
  database = new FinanceDatabase(`repo-${crypto.randomUUID()}`)
  repo = createTransactionsRepository(database)
  await database.accounts.add(makeAccount({ id: 'cash', kind: 'cash' }))
  await database.categories.add(makeCategory({ id: 'food', name: 'อาหาร' }))
})

afterEach(async () => {
  vi.restoreAllMocks()
  await database.delete()
})

describe('createExpense', () => {
  it('stores an expense with integer satang', async () => {
    const result = await repo.createExpense(draft, [], meta())
    expect(result.status).toBe('created')
    const stored = await database.transactions.get('tx-1')
    expect(stored).toMatchObject({ type: 'expense', amountSatang: 18550, categoryId: 'food', accountId: 'cash', description: 'ข้าวกลางวัน' })
    expect(Number.isInteger(stored?.amountSatang)).toBe(true)
  })

  it('creates only the expense: no debt payment, obligation or scheduled payment', async () => {
    await repo.createExpense(draft, [], meta())
    expect(await database.transactions.count()).toBe(1)
    expect(await database.transactions.where('type').equals('debt_payment').count()).toBe(0)
    expect(await database.recurringObligations.count()).toBe(0)
    expect(await database.scheduledPayments.count()).toBe(0)
    expect(await database.debts.count()).toBe(0)
  })

  it('stores attachment metadata and blobs separately, linked to the transaction', async () => {
    const blob = new Blob([new Uint8Array(2048)], { type: 'image/jpeg' })
    await repo.createExpense(draft, [{ blob, fileName: 'receipt.jpg', mimeType: 'image/jpeg', width: 800, height: 600 }], meta())
    const [row] = await database.attachments.where('transactionId').equals('tx-1').toArray()
    expect(row).toMatchObject({ transactionId: 'tx-1', fileName: 'receipt.jpg', mimeType: 'image/jpeg', sizeBytes: 2048, width: 800, height: 600 })
    expect(row && (await database.attachmentBlobs.get(row.id))?.blob.size).toBe(2048)
  })

  it('is idempotent: saving the same draft id twice creates one record', async () => {
    const [first, second] = await Promise.all([repo.createExpense(draft, [], meta()), repo.createExpense(draft, [], meta())])
    expect([first.status, second.status].sort()).toEqual(['already_saved', 'created'])
    expect(await database.transactions.count()).toBe(1)
  })

  it('rejects invalid drafts through the domain rules and stores nothing', async () => {
    await expect(repo.createExpense({ ...draft, amountSatang: satang(0) }, [], meta())).rejects.toBeInstanceOf(ExpenseValidationError)
    await expect(repo.createExpense({ ...draft, categoryId: undefined }, [], meta())).rejects.toMatchObject({ issues: ['category_required'] })
    await expect(repo.createExpense({ ...draft, accountId: 'ghost' }, [], meta())).rejects.toMatchObject({ issues: ['unknown_account'] })
    expect(await database.transactions.count()).toBe(0)
  })

  it('rolls back the expense when an attachment cannot be stored', async () => {
    vi.spyOn(database.attachmentBlobs, 'bulkAdd').mockRejectedValue(new Error('disk'))
    const blob = new Blob(['x'], { type: 'image/png' })
    const error = await repo.createExpense(draft, [{ blob, fileName: 'a.png', mimeType: 'image/png' }], meta()).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(StorageError)
    expect((error as StorageError).kind).toBe('attachment')
    expect(await database.transactions.count()).toBe(0)
    expect(await database.attachments.count()).toBe(0)
  })

  it('maps storage quota errors', async () => {
    const quota = Object.assign(new Error('full'), { name: 'QuotaExceededError' })
    vi.spyOn(database.transactions, 'add').mockRejectedValue(quota)
    await expect(repo.createExpense(draft, [], meta())).rejects.toMatchObject({ kind: 'storage_full' })
  })
})

describe('categories.createStarterSet', () => {
  it('creates categories once, only when none exist', async () => {
    const empty = new FinanceDatabase(`cat-${crypto.randomUUID()}`)
    const categories = createCategoriesRepository(empty)
    const templates = [{ name: 'อาหาร', icon: '🍚' }, { name: 'เดินทาง' }]
    const m = { now: '2026-09-25T00:00:00Z', newId: () => crypto.randomUUID() }
    expect(await categories.createStarterSet('expense', templates, m)).toBe(2)
    expect(await categories.createStarterSet('expense', templates, m)).toBe(0)
    expect((await categories.listAll()).map((c) => c.name)).toEqual(['อาหาร', 'เดินทาง'])
    expect(await empty.transactions.count()).toBe(0)
    await empty.delete()
  })
})

describe('amounts', () => {
  it('never stores fractional satang even for values like 0.1 + 0.2', async () => {
    await repo.createExpense({ ...draft, amountSatang: add(baht(0), satang(30)) }, [], meta())
    expect((await database.transactions.get('tx-1'))?.amountSatang).toBe(30)
  })
})
