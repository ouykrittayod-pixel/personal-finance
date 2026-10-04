/**
 * Phase 18 — local sync foundation. Everything here is local: no network,
 * no cloud. Synthetic data only.
 */
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { accountBalances } from '@/domain/reporting'
import { auditIntegrity } from '@/domain/integrity'
import { occurrenceId, starterCategoryId } from '@/domain/identity'
import type { ScheduledPayment } from '@/domain/entities'
import { collapseOutbox, SYNC_TABLES, type OutboxEntry } from '@/domain/sync'
import { auditSyncConsistency } from '@/domain/sync-audit'
import { backupToBlob, createBackup, replaceDatabase } from '@/features/backup/create-backup'
import { readBackup } from '@/features/backup/read-backup'
import { STARTER_EXPENSE_CATEGORIES } from '@/features/expenses/quick-expense/starter-categories'
import { sha1Hex, uuidV5 } from '@/lib/ids/deterministic'
import { baht, makeAccount } from '@/test/factories'
import { REP_NOW, REP_TODAY, seedRepresentative } from '@/test/representative'
import { FinanceDatabase } from '../dexie'
import { loadIntegritySnapshot } from '../integrity-snapshot'
import {
  createCategoriesRepository,
  createRecurringObligationsRepository,
  createScheduledPaymentsRepository,
  createTransactionsRepository,
} from '../repositories'
import { DATA_SCHEMA_VERSION, LATEST_SCHEMA_VERSION, SCHEMA_VERSIONS } from '../schema'
import { auditLocalSync, ensureSyncFoundation, readSyncStatus, resetSyncMetadata, withDeterministicOccurrenceIds } from './foundation'

let n = 0
const opened: Dexie[] = []
const fresh = (name = `sync-${++n}`) => {
  const database = new FinanceDatabase(name)
  opened.push(database)
  return database
}
afterEach(async () => {
  for (const database of opened.splice(0)) {
    database.close()
    await Dexie.delete(database.name)
  }
})

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const outbox = (database: FinanceDatabase) => database.syncOutbox.toArray()
const entryFor = async (database: FinanceDatabase, table: string, id: string) => database.syncOutbox.get([table, id])
const BUSINESS = [
  'accounts',
  'categories',
  'transactions',
  'recurringObligations',
  'scheduledPayments',
  'debts',
  'budgets',
  'attachments',
  'attachmentBlobs',
  'meta',
] as const

/** All business tables, as stored. */
async function dump(database: Dexie) {
  const out: Record<string, unknown[]> = {}
  for (const table of BUSINESS) out[table] = await database.table(table).toArray()
  return out
}

/**
 * A database as Phases ≤ 17 left it: Dexie version 1, occurrence ids random.
 * Built from data seeded through the real repositories, then written raw.
 */
async function legacyV1(name: string, seed: (database: FinanceDatabase) => Promise<unknown>) {
  const source = fresh(`${name}-source`)
  await seed(source)
  const data = await dump(source)
  const renames = new Map((data.scheduledPayments as ScheduledPayment[]).map((p) => [p.id, crypto.randomUUID()]))
  data.scheduledPayments = (data.scheduledPayments as ScheduledPayment[]).map((p) => ({ ...p, id: renames.get(p.id)! }))
  data.transactions = (data.transactions as { scheduledPaymentId?: string }[]).map((tx) =>
    tx.scheduledPaymentId ? { ...tx, scheduledPaymentId: renames.get(tx.scheduledPaymentId)! } : tx,
  )
  const v1 = new Dexie(name)
  v1.version(1).stores(SCHEMA_VERSIONS[0]!.stores)
  await v1.open()
  await v1.transaction('rw', v1.tables, async () => {
    for (const table of BUSINESS) await v1.table(table).bulkAdd(data[table]!)
  })
  v1.close()
  return { data, renames }
}

describe('deterministic ids (UUID v5)', () => {
  it('SHA-1 matches the standard test vectors', () => {
    expect(sha1Hex('')).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709')
    expect(sha1Hex('abc')).toBe('a9993e364706816aba3e25717850c26c9cd0d89d')
    expect(sha1Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe('84983e441c3bd26ebaae4aa1f95129e5e54670f1')
    expect(sha1Hex('a'.repeat(1000))).toBe('291e9a6c66994949b57ba5e650361e98fc36b1ba')
  })

  it('UUID v5 matches the RFC 4122 example and is stable', () => {
    expect(uuidV5('www.example.com', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2')
    expect(occurrenceId('obligation', 'rent', '2026-10-06')).toBe(occurrenceId('obligation', 'rent', '2026-10-06'))
    expect(occurrenceId('obligation', 'rent', '2026-10-06')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('different natural keys give different ids (source type, source, date, Thai names)', () => {
    const ids = [
      occurrenceId('obligation', 'x', '2026-10-06'),
      occurrenceId('debt', 'x', '2026-10-06'),
      occurrenceId('obligation', 'y', '2026-10-06'),
      occurrenceId('obligation', 'x', '2026-10-07'),
      starterCategoryId('expense', 'อาหาร'),
      starterCategoryId('income', 'อาหาร'),
      starterCategoryId('expense', 'เดินทาง'),
    ]
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('schema v2 on a new database', () => {
  it('has the sync tables and a random device id with sync off', async () => {
    const database = fresh()
    await database.open()
    expect(database.verno).toBe(LATEST_SCHEMA_VERSION)
    expect(LATEST_SCHEMA_VERSION).toBe(4)
    expect(DATA_SCHEMA_VERSION).toBe(1)
    for (const table of SYNC_TABLES) expect(database.tables.map((t) => t.name)).toContain(table)
    await ensureSyncFoundation(database)
    const device = await database.syncSettings.get('device')
    expect(device?.deviceId).toMatch(UUID_V4)
    expect(device?.syncEnabled).toBe(false)
    expect(Object.keys(device!).sort()).toEqual(['createdAt', 'deviceId', 'key', 'syncEnabled'])
    expect(await database.syncState.get('state')).toMatchObject({ linked: false, status: 'disabled', cursor: null, lastSyncAt: null, epoch: 0 })
  })

  it('the device id is stable across reopen and ensure is idempotent', async () => {
    const database = fresh()
    await ensureSyncFoundation(database)
    const first = (await database.syncSettings.get('device'))!.deviceId
    database.close()
    const again = fresh(database.name)
    await ensureSyncFoundation(again)
    await ensureSyncFoundation(again)
    expect((await again.syncSettings.get('device'))!.deviceId).toBe(first)
    expect(await again.syncSettings.count()).toBe(1)
  })

  it('two databases get different device ids', async () => {
    const a = fresh()
    const b = fresh()
    await ensureSyncFoundation(a)
    await ensureSyncFoundation(b)
    expect((await a.syncSettings.get('device'))!.deviceId).not.toBe((await b.syncSettings.get('device'))!.deviceId)
  })
})

describe('v1 → v2 migration', () => {
  it('re-ids occurrences deterministically, keeps paid history linked, and changes nothing else', async () => {
    const name = `legacy-${++n}`
    const { data: before } = await legacyV1(name, seedRepresentative)
    const database = fresh(name)
    await database.open()
    const after = await dump(database)

    for (const table of BUSINESS) expect({ [table]: after[table]!.length }).toEqual({ [table]: before[table]!.length })
    // Only occurrence ids and the matching transaction links changed.
    for (const table of ['accounts', 'categories', 'recurringObligations', 'debts', 'budgets', 'attachments', 'meta'] as const)
      expect({ [table]: after[table] }).toEqual({ [table]: before[table] })
    const payments = after.scheduledPayments as ScheduledPayment[]
    for (const p of payments) expect(p.id).toBe(occurrenceId(p.sourceType, p.sourceId, p.dueDate))
    const paid = payments.filter((p) => p.status === 'paid')
    expect(paid.length).toBeGreaterThan(0)
    for (const p of paid) {
      const tx = (await database.transactions.get(p.transactionId!))!
      expect(tx.scheduledPaymentId).toBe(p.id)
    }
    // Same payments apart from the id.
    const strip = (rows: unknown[]) =>
      (rows as ScheduledPayment[]).map(({ id: _id, ...rest }) => rest).sort((a, b) => `${a.sourceId}${a.dueDate}`.localeCompare(`${b.sourceId}${b.dueDate}`))
    expect(strip(after.scheduledPayments!)).toEqual(strip(before.scheduledPayments!))
    // Money unchanged.
    const balances = (d: Record<string, unknown[]>) => [...accountBalances(d.accounts as never, d.transactions as never)].sort()
    expect(balances(after)).toEqual(balances(before))
    const total = (d: Record<string, unknown[]>) => (d.transactions as { amountSatang: number }[]).reduce((s, tx) => s + tx.amountSatang, 0)
    expect(total(after)).toBe(total(before))
    // Integrity and sync consistency.
    const report = auditIntegrity(await loadIntegritySnapshot(database))
    expect(report.ok).toBe(true)
    expect(await auditLocalSync(database)).toEqual([])
    // A migration is not a user change: nothing in the outbox, no tombstones.
    expect(await database.syncOutbox.count()).toBe(0)
    expect(await database.syncTombstones.count()).toBe(0)
    expect((await database.syncSettings.get('device'))?.deviceId).toMatch(UUID_V4)
  })

  it('migrates an empty v1 database', async () => {
    const name = `legacy-${++n}`
    await legacyV1(name, async () => {})
    const database = fresh(name)
    await database.open()
    expect(await database.scheduledPayments.count()).toBe(0)
    expect(await database.syncSettings.count()).toBe(1)
    expect(await database.syncOutbox.count()).toBe(0)
  })

  it('after migration, regenerating occurrences creates no duplicates', async () => {
    const name = `legacy-${++n}`
    await legacyV1(name, seedRepresentative)
    const database = fresh(name)
    const count = await database.scheduledPayments.count()
    expect(await createScheduledPaymentsRepository(database).generateMissing(REP_TODAY, { now: REP_NOW, newId: () => crypto.randomUUID() })).toBe(0)
    expect(await database.scheduledPayments.count()).toBe(count)
  })
})

describe('outbox tracking (same transaction as the write)', () => {
  let database: FinanceDatabase
  beforeEach(async () => {
    database = fresh()
    await ensureSyncFoundation(database)
  })

  it('a create leaves one create entry with no record content', async () => {
    await database.accounts.add(makeAccount({ id: 'a1', name: 'Secret bank', openingBalanceSatang: baht(123_456) }))
    const entries = await outbox(database)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ tableName: 'accounts', recordId: 'a1', op: 'create', baseRevision: 0, attempts: 0, payloadVersion: 1 })
    expect(entries[0]!.deviceId).toBe((await database.syncSettings.get('device'))!.deviceId)
    expect(JSON.stringify(entries)).not.toMatch(/Secret|123456|12345600/)
  })

  it('create + update stays one create; update + update stays one update', async () => {
    await database.accounts.add(makeAccount({ id: 'a1' }))
    await database.accounts.update('a1', { name: 'renamed' })
    await database.accounts.put({ ...(await database.accounts.get('a1'))!, name: 'again' })
    expect(await outbox(database)).toMatchObject([{ recordId: 'a1', op: 'create' }])
    await database.syncOutbox.clear() // as if sent
    await database.accounts.update('a1', { name: 'x' })
    await database.accounts.update('a1', { name: 'y' })
    expect(await outbox(database)).toMatchObject([{ recordId: 'a1', op: 'update' }])
  })

  it('create + delete of an unsent record leaves nothing (no tombstone)', async () => {
    await database.accounts.add(makeAccount({ id: 'a1' }))
    await database.accounts.delete('a1')
    expect(await database.syncOutbox.count()).toBe(0)
    expect(await database.syncTombstones.count()).toBe(0)
  })

  it('deleting a sent record leaves a delete entry and a tombstone; recreating it removes the tombstone', async () => {
    await database.accounts.add(makeAccount({ id: 'a1' }))
    await database.syncOutbox.clear()
    await database.accounts.delete('a1')
    expect(await entryFor(database, 'accounts', 'a1')).toMatchObject({ op: 'delete' })
    expect(await database.syncTombstones.get(['accounts', 'a1'])).toMatchObject({ tableName: 'accounts', recordId: 'a1', baseRevision: 0 })
    await database.accounts.add(makeAccount({ id: 'a1' }))
    expect(await entryFor(database, 'accounts', 'a1')).toMatchObject({ op: 'update' })
    expect(await database.syncTombstones.count()).toBe(0)
    expect(await auditLocalSync(database)).toEqual([])
  })

  it('a failed transaction leaves neither the record nor an outbox entry', async () => {
    await expect(
      database.transaction('rw', database.accounts, async () => {
        await database.accounts.add(makeAccount({ id: 'a1' }))
        throw new RangeError('abort on purpose')
      }),
    ).rejects.toThrow(RangeError)
    expect(await database.accounts.count()).toBe(0)
    expect(await database.syncOutbox.count()).toBe(0)
  })

  it('a unique-index failure rolls back the tracking too', async () => {
    const p = {
      sourceType: 'obligation' as const,
      sourceId: 'r',
      dueDate: '2026-10-01',
      expectedAmountSatang: baht(1),
      status: 'pending' as const,
      createdAt: REP_NOW,
      updatedAt: REP_NOW,
    }
    await database.scheduledPayments.add({ ...p, id: 'p1' })
    await database.syncOutbox.clear()
    await expect(database.scheduledPayments.add({ ...p, id: 'p2' })).rejects.toMatchObject({ name: 'ConstraintError' })
    expect(await database.syncOutbox.count()).toBe(0)
  })

  it('meta and attachment blobs are never tracked', async () => {
    await database.meta.put({ key: 'lastBackupAt', value: REP_NOW, updatedAt: REP_NOW })
    await database.attachmentBlobs.put({ id: 'b1', blob: new Blob(['x']) })
    await database.meta.delete('lastBackupAt')
    expect(await database.syncOutbox.count()).toBe(0)
    expect(await database.syncTombstones.count()).toBe(0)
  })

  it('bulk writes, clear() and collection deletes are tracked; seq is unique and increasing', async () => {
    await database.categories.bulkAdd(
      [1, 2, 3].map((i) => ({ id: `c${i}`, kind: 'expense' as const, name: `c${i}`, sortOrder: i, createdAt: REP_NOW, updatedAt: REP_NOW })),
    )
    await database.syncOutbox.clear()
    await database.categories.where('sortOrder').above(1).delete()
    await database.categories.clear()
    const entries = await outbox(database)
    expect(entries.map((e) => [e.recordId, e.op]).sort()).toEqual([
      ['c1', 'delete'],
      ['c2', 'delete'],
      ['c3', 'delete'],
    ])
    expect(await database.syncTombstones.count()).toBe(3)
    const seqs = entries.map((e) => e.seq)
    expect(new Set(seqs).size).toBe(seqs.length)
  })

  it('deleting a transaction tombstones it and its attachment metadata; blobs stay local', async () => {
    await seedRepresentative(database)
    await database.syncOutbox.clear()
    const attachment = (await database.attachments.toArray())[0]!
    await createTransactionsRepository(database).delete(attachment.transactionId!, { now: REP_NOW })
    expect((await outbox(database)).map((e) => [e.tableName, e.op]).sort()).toEqual([
      ['attachments', 'delete'],
      ['transactions', 'delete'],
    ])
    expect(await database.syncTombstones.count()).toBe(2)
    expect(await auditLocalSync(database)).toEqual([])
  })

  it('paying a scheduled payment records the transaction create and the occurrence update', async () => {
    await seedRepresentative(database)
    await database.syncOutbox.clear()
    const scheduled = createScheduledPaymentsRepository(database)
    const internet = (await scheduled.listForSource('obligation', 'net-rule')).find((p) => p.status === 'pending')!
    await scheduled.markPaid(internet.id, { type: 'expense', amountSatang: baht(899), accountId: 'kbank', categoryId: 'internet', date: REP_TODAY }, [], {
      transactionId: 'net-paid',
      now: REP_NOW,
      newId: () => crypto.randomUUID(),
    })
    expect((await outbox(database)).map((e) => [e.tableName, e.recordId, e.op]).sort()).toEqual([
      ['scheduledPayments', internet.id, 'update'],
      ['transactions', 'net-paid', 'create'],
    ])
  })

  it('pausing and resuming a rule recreates the same occurrence ids (delete + create → update)', async () => {
    await seedRepresentative(database)
    const obligations = createRecurringObligationsRepository(database)
    const ids = (await database.scheduledPayments.where('[sourceType+sourceId]').equals(['obligation', 'net-rule']).primaryKeys()).sort()
    await database.syncOutbox.clear()
    await obligations.pause('net-rule', { now: REP_NOW, today: REP_TODAY, newId: () => crypto.randomUUID() })
    await obligations.resume('net-rule', { now: REP_NOW, today: REP_TODAY, newId: () => crypto.randomUUID() })
    const after = (await database.scheduledPayments.where('[sourceType+sourceId]').equals(['obligation', 'net-rule']).primaryKeys()).sort()
    expect(after).toEqual(ids)
    expect(await auditLocalSync(database)).toEqual([])
  })
})

describe('collapse rules (pure)', () => {
  const ctx = (seq: number) => ({ tableName: 'accounts' as const, recordId: 'a', deviceId: 'd', now: REP_NOW, seq, newOpId: () => `op-${seq}` })
  const apply = (ops: ('create' | 'update' | 'delete')[], start?: OutboxEntry) => {
    let entry = start
    const graves: string[] = []
    ops.forEach((op, i) => {
      const r = collapseOutbox(entry, op, ctx(i + 1))
      entry = r.entry ?? undefined
      graves.push(r.tombstone)
    })
    return { entry, graves }
  }

  it.each([
    [['create'], 'create'],
    [['update'], 'update'],
    [['delete'], 'delete'],
    [['create', 'update', 'update'], 'create'],
    [['create', 'delete'], undefined],
    [['update', 'delete'], 'delete'],
    [['delete', 'create'], 'update'],
    [['update', 'update'], 'update'],
    [['create', 'update', 'delete'], undefined],
  ] as const)('%j → %s', (ops, expected) => {
    expect(apply([...ops]).entry?.op).toBe(expected)
  })

  it('keeps the opId and first createdAt of an unsent entry; the latest seq wins', () => {
    const { entry } = apply(['create', 'update', 'update'])
    expect(entry).toMatchObject({ opId: 'op-1', seq: 3, createdAt: REP_NOW })
  })

  it('an entry already sent is never dropped and gets a new opId', () => {
    const sent: OutboxEntry = { ...collapseOutbox(undefined, 'create', ctx(1)).entry!, attempts: 2 }
    const deleted = collapseOutbox(sent, 'delete', ctx(2))
    expect(deleted.entry).toMatchObject({ op: 'delete', opId: 'op-2', attempts: 0 })
    expect(deleted.tombstone).toBe('write')
    expect(collapseOutbox(sent, 'update', ctx(3)).entry).toMatchObject({ op: 'create', opId: 'op-3' })
  })
})

describe('backup stays format v1, without sync internals', () => {
  it('backups carry data schema 1 and no device id, outbox or tombstones', async () => {
    const database = fresh()
    await seedRepresentative(database)
    await ensureSyncFoundation(database)
    const backup = await createBackup(database, REP_NOW)
    expect(backup.formatVersion).toBe(1)
    expect(backup.schemaVersion).toBe(1)
    expect(Object.keys(backup.data).sort()).toEqual(
      ['accounts', 'attachmentBlobs', 'attachments', 'budgets', 'categories', 'debts', 'recurringObligations', 'scheduledPayments', 'transactions'].sort(),
    )
    const text = await backupToBlob(backup).text()
    const deviceId = (await database.syncSettings.get('device'))!.deviceId
    expect(text).not.toContain(deviceId)
    expect(text).not.toMatch(/syncOutbox|syncTombstones|syncState|syncSettings|deviceId|opId|token|secret/i)
  })

  it('an older backup (random occurrence ids) restores with deterministic ids and intact links', async () => {
    const name = `legacy-${++n}`
    const { data } = await legacyV1(name, seedRepresentative)
    // A Phase ≤ 17 backup, built from the legacy data.
    const source = fresh()
    await replaceDatabase(source, { records: data as never, blobs: data.attachmentBlobs as never })
    const target = fresh()
    await ensureSyncFoundation(target)
    await target.accounts.add(makeAccount({ id: 'old' }))
    const deviceId = (await target.syncSettings.get('device'))!.deviceId
    const legacyBackup = { ...(await createBackup(source, REP_NOW)), data: { ...(await createBackup(source, REP_NOW)).data } }
    legacyBackup.data.scheduledPayments = data.scheduledPayments as ScheduledPayment[]
    legacyBackup.data.transactions = data.transactions as never
    const prepared = readBackup(JSON.stringify(legacyBackup))
    await replaceDatabase(target, prepared)
    for (const p of await target.scheduledPayments.toArray()) expect(p.id).toBe(occurrenceId(p.sourceType, p.sourceId, p.dueDate))
    expect(auditIntegrity(await loadIntegritySnapshot(target)).ok).toBe(true)
    // Restore is not a user change: outbox and tombstones cleared, epoch moved on, device kept.
    expect(await target.syncOutbox.count()).toBe(0)
    expect(await target.syncTombstones.count()).toBe(0)
    expect(await readSyncStatus(target)).toMatchObject({ deviceId, epoch: 1 })
    expect(await auditLocalSync(target)).toEqual([])
  })

  it('backup → restore round trip is identical', async () => {
    const database = fresh()
    await seedRepresentative(database)
    const before = await dump(database)
    const backup = await createBackup(database, REP_NOW)
    const target = fresh()
    await replaceDatabase(target, readBackup(JSON.stringify(backup)))
    const after = await dump(target)
    for (const table of BUSINESS.filter((t) => t !== 'attachmentBlobs' && t !== 'meta')) expect({ [table]: after[table] }).toEqual({ [table]: before[table] })
  })

  it('withDeterministicOccurrenceIds leaves deterministic data untouched', () => {
    const records = { scheduledPayments: [], transactions: [] }
    expect(withDeterministicOccurrenceIds(records).renamed).toBe(0)
  })
})

describe('two devices (simulated, local only)', () => {
  /** Copies records as a future sync would (suppressing the receiver's own tracking is Phase 20's job; here the receiver's outbox is cleared). */
  async function deliver(from: FinanceDatabase, to: FinanceDatabase) {
    const entries = await from.syncOutbox.orderBy('seq').toArray()
    // Read at send time (the outbox holds no content), then apply in one transaction on the receiver.
    const payloads = await Promise.all(entries.map((e) => (e.op === 'delete' ? undefined : from.table(e.tableName).get(e.recordId))))
    await to.transaction('rw', to.tables, async () => {
      for (const [i, entry] of entries.entries()) {
        const table = to.table(entry.tableName)
        if (entry.op === 'delete') await table.delete(entry.recordId)
        else await table.put(payloads[i])
      }
    })
    await from.syncOutbox.clear()
    await to.syncOutbox.clear()
  }

  it('both devices generate the same occurrences for a shared rule: no duplicates after exchange', async () => {
    const a = fresh()
    const b = fresh()
    const meta = { now: REP_NOW, today: REP_TODAY, newId: () => crypto.randomUUID() }
    await a.accounts.add(makeAccount({ id: 'kbank' }))
    await a.categories.add({ id: 'rent', kind: 'expense', name: 'Rent', sortOrder: 0, createdAt: REP_NOW, updatedAt: REP_NOW })
    await createRecurringObligationsRepository(a).create(
      {
        name: 'Rent',
        amountSatang: baht(7_800),
        categoryId: 'rent',
        defaultAccountId: 'kbank',
        recurrence: { frequency: 'monthly', interval: 1, startDate: '2026-09-01', dayOfMonth: 6 },
      },
      { ...meta, id: 'rent-rule' },
    )
    // B receives only the rule and the account, then generates occurrences itself.
    const shared = [await a.accounts.get('kbank'), await a.categories.get('rent'), await a.recurringObligations.get('rent-rule')] as const
    await b.transaction('rw', b.accounts, b.categories, b.recurringObligations, async () => {
      await b.accounts.put(shared[0]!)
      await b.categories.put(shared[1]!)
      await b.recurringObligations.put(shared[2]!)
    })
    await createScheduledPaymentsRepository(b).generateMissing(REP_TODAY, meta)
    const idsA = (await a.scheduledPayments.toCollection().primaryKeys()).sort()
    const idsB = (await b.scheduledPayments.toCollection().primaryKeys()).sort()
    expect(idsA.length).toBeGreaterThan(0)
    expect(idsB).toEqual(idsA)
    await deliver(a, b)
    expect(await b.scheduledPayments.count()).toBe(idsA.length)
  })

  it('both devices create the starter categories: identical records, no duplicates', async () => {
    const a = fresh()
    const b = fresh()
    await createCategoriesRepository(a).createStarterSet('expense', STARTER_EXPENSE_CATEGORIES, { now: REP_NOW })
    await createCategoriesRepository(b).createStarterSet('expense', STARTER_EXPENSE_CATEGORIES, { now: REP_NOW })
    expect(await b.categories.toArray()).toEqual(await a.categories.toArray())
    await deliver(a, b)
    expect(await b.categories.count()).toBe(STARTER_EXPENSE_CATEGORIES.length)
  })

  it('outbox changes replayed on another device reproduce the same data and balances', async () => {
    const a = fresh()
    const b = fresh()
    await seedRepresentative(a)
    await createTransactionsRepository(a).delete('wage', { now: REP_NOW })
    await deliver(a, b)
    const da = await dump(a)
    const db2 = await dump(b)
    for (const table of ['accounts', 'categories', 'transactions', 'recurringObligations', 'scheduledPayments', 'debts', 'budgets', 'attachments'] as const)
      expect({ [table]: db2[table] }).toEqual({ [table]: da[table] })
    expect([...accountBalances(db2.accounts as never, db2.transactions as never)]).toEqual([...accountBalances(da.accounts as never, da.transactions as never)])
  })
})

describe('sync consistency audit and dev reset', () => {
  it('reports inconsistencies by table / id / code only', () => {
    const records = {
      accounts: [{ id: 'live' }],
      categories: [],
      transactions: [],
      recurringObligations: [],
      scheduledPayments: [],
      debts: [],
      budgets: [],
      attachments: [],
    }
    const entry = (recordId: string, op: OutboxEntry['op'], seq: number): OutboxEntry => ({
      tableName: 'accounts',
      recordId,
      op,
      seq,
      opId: `o${seq}`,
      baseRevision: 0,
      deviceId: 'd',
      createdAt: REP_NOW,
      updatedAt: REP_NOW,
      attempts: 0,
      payloadVersion: 1,
    })
    const issues = auditSyncConsistency({
      records,
      outbox: [entry('live', 'delete', 1), entry('gone', 'update', 1)],
      tombstones: [{ tableName: 'accounts', recordId: 'live', deletedAt: REP_NOW, deviceId: 'd', baseRevision: 0, opId: 'x' }],
      settings: undefined,
    })
    expect(issues.map((i) => i.code).sort()).toEqual(
      ['device_missing', 'duplicate_seq', 'outbox_change_for_missing_record', 'outbox_delete_for_live_record', 'tombstone_for_live_record'].sort(),
    )
  })

  it('the dev reset clears sync bookkeeping only; business data untouched', async () => {
    const database = fresh()
    await seedRepresentative(database)
    const before = await dump(database)
    const deviceId = (await database.syncSettings.get('device'))!.deviceId
    expect(await database.syncOutbox.count()).toBeGreaterThan(0)
    await resetSyncMetadata(database)
    expect(await database.syncOutbox.count()).toBe(0)
    expect((await database.syncSettings.get('device'))!.deviceId).toBe(deviceId)
    expect((await readSyncStatus(database)).epoch).toBe(1)
    expect(await dump(database)).toEqual(before)
    await resetSyncMetadata(database, { newDeviceId: true })
    expect((await database.syncSettings.get('device'))!.deviceId).not.toBe(deviceId)
  })
})
