/**
 * Google Drive sync with two simulated devices (fake IndexedDB each) and an
 * in-memory Drive. Synthetic data only.
 */
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { FinanceDatabase } from '@/db/dexie'
import { createRecurringObligationsRepository, createScheduledPaymentsRepository } from '@/db/repositories'
import { accountBalances } from '@/domain/reporting'
import { SYNCED_TABLES } from '@/domain/sync'
import { createFakeDrive, type FakeDrive } from '@/test/fake-drive'
import { baht, makeAccount, makeCategory, makeTx } from '@/test/factories'
import { REP_NOW, REP_TODAY, seedRepresentative } from '@/test/representative'
import { RemoteFormatError } from './remote-format'
import { syncOnce } from './sync-engine'

let n = 0
const opened: FinanceDatabase[] = []
function device() {
  const database = new FinanceDatabase(`drive-${++n}-${crypto.randomUUID()}`)
  opened.push(database)
  return database
}
afterEach(async () => {
  for (const database of opened.splice(0)) {
    database.close()
    await Dexie.delete(database.name)
  }
})

let clock = Date.parse('2026-10-04T00:00:00.000Z')
const now = () => new Date((clock += 1000)).toISOString()
const later = () => new Date((clock += 60_000)).toISOString()

async function business(database: FinanceDatabase) {
  const out: Record<string, unknown[]> = {}
  for (const table of SYNCED_TABLES) out[table] = (await database.table(table).toArray()).sort((a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id))
  return out
}
const sync = (database: FinanceDatabase, drive: FakeDrive, extra: Parameters<typeof syncOnce>[2] = {}) => syncOnce(database, drive.store(), { now, ...extra })

describe('Drive sync: one data set, any device', () => {
  it('first sync uploads everything; a new device downloads the same data, receipts and balances', async () => {
    const drive = createFakeDrive(now)
    const phone = device()
    await seedRepresentative(phone)
    const first = await sync(phone, drive)
    expect(first.uploaded).toBe(true)
    expect(first.attachmentsUploaded).toBe(1)
    expect(await phone.syncOutbox.count()).toBe(0)

    const computer = device()
    const second = await sync(computer, drive)
    expect(second.uploaded).toBe(false)
    expect(second.attachmentsDownloaded).toBe(1)
    expect(await business(computer)).toEqual(await business(phone))
    const [blobPhone] = await phone.attachmentBlobs.toArray()
    const [blobComputer] = await computer.attachmentBlobs.toArray()
    expect(new Uint8Array(await blobComputer!.blob.arrayBuffer())).toEqual(new Uint8Array(await blobPhone!.blob.arrayBuffer()))
    const balances = async (db: FinanceDatabase) => accountBalances(await db.accounts.toArray(), await db.transactions.toArray())
    expect(await balances(computer)).toEqual(await balances(phone))
    // The receiving device recorded nothing as its own change.
    expect(await computer.syncOutbox.count()).toBe(0)
  })

  it('edits and deletes travel both ways', async () => {
    const drive = createFakeDrive(now)
    const a = device()
    const b = device()
    await a.accounts.add(makeAccount({ id: 'cash', name: 'Cash' }))
    await a.transactions.bulkAdd([makeTx({ id: 't1', type: 'income', amountSatang: baht(100), accountId: 'cash' }), makeTx({ id: 't2', type: 'income', amountSatang: baht(5), accountId: 'cash' })])
    await sync(a, drive)
    await sync(b, drive)

    await b.accounts.update('cash', { name: 'Wallet', updatedAt: later() })
    await b.transactions.delete('t2')
    await sync(b, drive)
    await sync(a, drive)
    expect((await a.accounts.get('cash'))!.name).toBe('Wallet')
    expect(await a.transactions.get('t2')).toBeUndefined()
    expect(await business(a)).toEqual(await business(b))
  })

  it('offline changes on both devices are all kept', async () => {
    const drive = createFakeDrive(now)
    const a = device()
    const b = device()
    await a.accounts.add(makeAccount({ id: 'cash' }))
    await sync(a, drive)
    await sync(b, drive)
    await a.transactions.add(makeTx({ id: 'from-phone', type: 'income', amountSatang: baht(1), accountId: 'cash' }))
    await b.transactions.add(makeTx({ id: 'from-computer', type: 'income', amountSatang: baht(2), accountId: 'cash' }))
    await sync(a, drive)
    await sync(b, drive)
    await sync(a, drive)
    expect((await a.transactions.toCollection().primaryKeys()).sort()).toEqual(['from-computer', 'from-phone'])
    expect(await business(a)).toEqual(await business(b))
  })

  it('the same record edited on both devices: the later edit wins everywhere', async () => {
    const drive = createFakeDrive(now)
    const a = device()
    const b = device()
    await a.accounts.add(makeAccount({ id: 'cash', name: 'Cash' }))
    await sync(a, drive)
    await sync(b, drive)
    await a.accounts.update('cash', { name: 'earlier', updatedAt: later() })
    await b.accounts.update('cash', { name: 'later', updatedAt: later() })
    await sync(b, drive)
    await sync(a, drive)
    await sync(b, drive)
    expect((await a.accounts.get('cash'))!.name).toBe('later')
    expect((await b.accounts.get('cash'))!.name).toBe('later')
  })

  it('skips the network when nothing changed on either side', async () => {
    const drive = createFakeDrive(now)
    const a = device()
    await a.accounts.add(makeAccount({ id: 'cash' }))
    const first = await sync(a, drive)
    const reads = drive.reads
    const again = await sync(a, drive, { lastVersion: first.version })
    expect(again.skipped).toBe(true)
    expect(drive.reads).toBe(reads)
    await a.accounts.update('cash', { name: 'x', updatedAt: later() })
    expect((await sync(a, drive, { lastVersion: first.version })).skipped).toBe(false)
  })

  it('another device uploading in between: the pass retries and keeps both changes', async () => {
    const drive = createFakeDrive(now)
    const a = device()
    const b = device()
    await a.accounts.add(makeAccount({ id: 'cash' }))
    await sync(a, drive)
    await sync(b, drive)
    await a.transactions.add(makeTx({ id: 'mine', type: 'income', amountSatang: baht(1), accountId: 'cash' }))
    await b.transactions.add(makeTx({ id: 'theirs', type: 'income', amountSatang: baht(2), accountId: 'cash' }))
    drive.beforeNextWrite = async () => {
      await sync(b, drive)
    }
    await sync(a, drive)
    expect(
      drive
        .snapshot()!
        .data.transactions.map((t) => t.id)
        .sort(),
    ).toEqual(['mine', 'theirs'])
  })

  it('a change made while a sync is running stays and goes up next time', async () => {
    const drive = createFakeDrive(now)
    const a = device()
    await a.accounts.add(makeAccount({ id: 'cash' }))
    drive.beforeNextWrite = async () => {
      await a.transactions.add(makeTx({ id: 'during', type: 'income', amountSatang: baht(1), accountId: 'cash' }))
    }
    await sync(a, drive)
    expect(await a.transactions.get('during')).toBeDefined()
    expect(await a.syncOutbox.get(['transactions', 'during'])).toMatchObject({ op: 'create' })
    await sync(a, drive)
    expect(drive.snapshot()!.data.transactions.map((t) => t.id)).toEqual(['during'])
  })

  it('both devices budget the same month and category: one budget survives, no unique-index error', async () => {
    const drive = createFakeDrive(now)
    const a = device()
    const b = device()
    await a.categories.add(makeCategory({ id: 'food' }))
    await sync(a, drive)
    await sync(b, drive)
    const budget = (id: string, limit: number, at: string) => ({ id, month: '2026-10', categoryId: 'food', limitSatang: baht(limit), createdAt: at, updatedAt: at })
    await a.budgets.add(budget('budget-a', 3000, later()))
    await b.budgets.add(budget('budget-b', 5000, later()))
    await sync(a, drive)
    await sync(b, drive)
    await sync(a, drive)
    expect(await a.budgets.toArray()).toEqual([budget('budget-b', 5000, (await b.budgets.get('budget-b'))!.updatedAt)])
    expect(await business(a)).toEqual(await business(b))
  })

  it('occurrences generated on both devices for the same rule are not duplicated', async () => {
    const drive = createFakeDrive(now)
    const a = device()
    const b = device()
    const meta = { now: REP_NOW, today: REP_TODAY, newId: () => crypto.randomUUID() }
    await a.accounts.add(makeAccount({ id: 'kbank' }))
    await a.categories.add(makeCategory({ id: 'rent' }))
    await createRecurringObligationsRepository(a).create(
      { name: 'Rent', amountSatang: baht(7_800), categoryId: 'rent', defaultAccountId: 'kbank', recurrence: { frequency: 'monthly', interval: 1, startDate: '2026-09-01', dayOfMonth: 6 } },
      { ...meta, id: 'rent-rule' },
    )
    await sync(a, drive)
    await sync(b, drive)
    await createScheduledPaymentsRepository(b).generateMissing('2026-12-20', meta)
    await createScheduledPaymentsRepository(a).generateMissing('2026-12-20', meta)
    await sync(a, drive)
    await sync(b, drive)
    const ids = (db: FinanceDatabase) => db.scheduledPayments.toCollection().primaryKeys()
    expect((await ids(b)).sort()).toEqual((await ids(a)).sort())
    expect(new Set(drive.snapshot()!.data.scheduledPayments.map((p) => p.id)).size).toBe(drive.snapshot()!.data.scheduledPayments.length)
  })

  it('removing an attachment removes its file from Drive and from the other device', async () => {
    const drive = createFakeDrive(now)
    const a = device()
    const b = device()
    await seedRepresentative(a)
    await sync(a, drive)
    await sync(b, drive)
    const [attachment] = await a.attachments.toArray()
    expect(drive.attachmentNames()).toEqual([attachment!.id])
    await a.transaction('rw', a.attachments, a.attachmentBlobs, async () => {
      await a.attachments.delete(attachment!.id)
      await a.attachmentBlobs.delete(attachment!.id)
    })
    await sync(a, drive)
    await sync(b, drive)
    expect(drive.attachmentNames()).toEqual([])
    expect(await b.attachments.count()).toBe(0)
    expect(await b.attachmentBlobs.count()).toBe(0)
  })

  it('after a restore, the restored data replaces Drive and the other devices', async () => {
    const drive = createFakeDrive(now)
    const a = device()
    const b = device()
    await a.accounts.bulkAdd([makeAccount({ id: 'kept', name: 'Kept' }), makeAccount({ id: 'dropped' })])
    await sync(a, drive)
    await sync(b, drive)
    await b.accounts.update('kept', { name: 'edited on B', updatedAt: later() })
    await sync(b, drive)
    // A restores a backup that has only the old "kept" account (simulated: cache replaced without tracking).
    await a.transaction('rw', a.accounts, a.syncOutbox, a.syncTombstones, async () => {
      await a.accounts.clear()
      await a.accounts.add(makeAccount({ id: 'kept', name: 'From backup' }))
      await a.syncOutbox.clear()
      await a.syncTombstones.clear()
    })
    await sync(a, drive, { replaceRemote: true })
    await sync(b, drive)
    expect((await b.accounts.toArray()).map((x) => [x.id, x.name])).toEqual([['kept', 'From backup']])
    expect(await business(a)).toEqual(await business(b))
  })

  it('a damaged Drive file is rejected and the cache is left alone', async () => {
    const drive = createFakeDrive(now)
    const a = device()
    await a.accounts.add(makeAccount({ id: 'cash' }))
    await sync(a, drive)
    drive.rawText = drive.rawText!.replace('"currency":"THB"', '"currency":42')
    const before = await business(a)
    await expect(sync(a, drive)).rejects.toBeInstanceOf(RemoteFormatError)
    expect(await business(a)).toEqual(before)
  })

  it('a file written by a newer app version is refused with its own reason', async () => {
    const drive = createFakeDrive(now)
    const a = device()
    await sync(a, drive)
    drive.rawText = drive.rawText!.replace('"schemaVersion":1', '"schemaVersion":99')
    await expect(sync(a, drive)).rejects.toMatchObject({ reason: 'newer_app' })
  })
})
