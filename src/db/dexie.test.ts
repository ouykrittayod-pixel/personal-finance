import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ScheduledPayment } from '@/domain/entities'
import { satang } from '@/domain/money'
import { FinanceDatabase } from './dexie'
import { createMetaRepository, META_KEYS } from './repositories'
import { LATEST_SCHEMA_VERSION, SCHEMA_VERSIONS } from './schema'

let database: FinanceDatabase

beforeEach(async () => {
  database = new FinanceDatabase(`test-${crypto.randomUUID()}`)
  await database.open()
})

afterEach(async () => {
  await database.delete()
})

const now = '2026-01-01T00:00:00.000Z'

function scheduled(overrides: Partial<ScheduledPayment> = {}): ScheduledPayment {
  return {
    id: crypto.randomUUID(),
    sourceType: 'obligation',
    sourceId: 'rent',
    dueDate: '2026-02-01',
    expectedAmountSatang: satang(100),
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

describe('schema', () => {
  it('has strictly increasing versions', () => {
    const versions = SCHEMA_VERSIONS.map((s) => s.version)
    expect(versions).toEqual([...versions].sort((a, b) => a - b))
    expect(new Set(versions).size).toBe(versions.length)
  })

  it('opens at the latest version with every table', () => {
    expect(database.verno).toBe(LATEST_SCHEMA_VERSION)
    expect(database.tables.map((t) => t.name).sort()).toEqual(
      [
        'accounts',
        'attachmentBlobs',
        'attachments',
        'budgets',
        'categories',
        'debts',
        'meta',
        'recurringObligations',
        'scheduledPayments',
        'transactions',
        'syncOutbox',
        'syncTombstones',
        'syncState',
        'syncSettings',
        'keyring',
      ].sort(),
    )
  })

  it('starts empty — no seeded financial data', async () => {
    const counts = await Promise.all(database.tables.map((t) => t.count()))
    expect(counts.every((c) => c === 0)).toBe(true)
  })

  it('prevents duplicate scheduled payments for the same source and due date', async () => {
    await database.scheduledPayments.add(scheduled())
    await expect(database.scheduledPayments.add(scheduled())).rejects.toThrow(Dexie.ConstraintError)
    await database.scheduledPayments.add(scheduled({ dueDate: '2026-03-01' }))
    expect(await database.scheduledPayments.count()).toBe(2)
  })

  it('queries transactions for a debt via the debtId index', async () => {
    await database.transactions.bulkAdd([
      {
        id: 't1',
        type: 'debt_payment',
        date: '2026-01-10',
        amountSatang: satang(5000),
        accountId: 'bank',
        debtId: 'loan',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 't2',
        type: 'expense',
        date: '2026-01-11',
        amountSatang: satang(100),
        accountId: 'bank',
        createdAt: now,
        updatedAt: now,
      },
    ])
    const history = await database.transactions.where('debtId').equals('loan').toArray()
    expect(history.map((t) => t.id)).toEqual(['t1'])
  })
})

describe('meta repository', () => {
  it('stores and reads values', async () => {
    const meta = createMetaRepository(database)
    expect(await meta.get(META_KEYS.lastBackupAt)).toBeUndefined()
    await meta.set(META_KEYS.lastBackupAt, now)
    expect(await meta.get<string>(META_KEYS.lastBackupAt)).toBe(now)
    await meta.remove(META_KEYS.lastBackupAt)
    expect(await meta.get(META_KEYS.lastBackupAt)).toBeUndefined()
  })
})
