import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FinanceDatabase } from '@/db/dexie'
import {
  createAccountsRepository,
  createBudgetsRepository,
  createDebtsRepository,
  createRecurringObligationsRepository,
  createScheduledPaymentsRepository,
  createTransactionsRepository,
} from '@/db/repositories'
import { DATA_SCHEMA_VERSION } from '@/db/schema'
import { accountBalances, debtSummary, monthTotals } from '@/domain/reporting'
import { getMonthlyAnalytics } from '@/domain/analytics'
import { getMonthlyBudgetSummary } from '@/domain/budget'
import { buildCalendarItems, calendarTotals } from '@/domain/calendar'
import { baht, makeCategory } from '@/test/factories'
import { base64ToBytes, bytesToBase64 } from './base64'
import { backupToBlob, countRecords, createBackup, estimateBackup, replaceDatabase } from './create-backup'
import { exportDataJson, exportTransactionsCsv } from './export-data'
import { BACKUP_FORMAT, BACKUP_FORMAT_VERSION, backupFileName, BackupError, type BackupFile, type BackupErrorKind } from './format'
import { readBackup } from './read-backup'

const TODAY = '2026-09-26'
const NOW = `${TODAY}T07:30:00.000Z`
let counter = 0
const newId = () => `id-${++counter}`
const meta = { now: NOW, today: TODAY, newId }
/** receipt.jpg: JPEG header + every byte value, so any encoding slip shows. */
const RECEIPT = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Array.from({ length: 256 }, (_, i) => i), 0xff, 0xd9])

let database: FinanceDatabase
let name = 0

beforeEach(() => {
  database = new FinanceDatabase(`backup-test-${++name}`)
})
afterEach(async () => {
  database.close()
  await database.delete()
})

/** Accounts, categories, expense (with receipt), income, loan + payment, card purchase + payment, transfer, recurring bill paid, budget. */
async function seed(target: FinanceDatabase = database) {
  const accounts = createAccountsRepository(target)
  const transactions = createTransactionsRepository(target)
  const debts = createDebtsRepository(target)
  const obligations = createRecurringObligationsRepository(target)
  const scheduled = createScheduledPaymentsRepository(target)
  const budgets = createBudgetsRepository(target)
  await accounts.create({ name: 'KBank', kind: 'bank', openingAmountSatang: baht(50_000), openingDate: '2026-08-01' }, { id: 'kbank', now: NOW })
  await accounts.create({ name: 'เงินสด', kind: 'cash', openingAmountSatang: baht(2_000), openingDate: '2026-08-01' }, { id: 'cash', now: NOW })
  await accounts.create({ name: 'บัตร KBank', kind: 'credit_card', openingAmountSatang: baht(0), openingDate: '2026-08-01' }, { id: 'card', now: NOW })
  await target.categories.bulkAdd([
    makeCategory({ id: 'food', name: 'อาหาร' }),
    makeCategory({ id: 'shopping', name: 'ช้อปปิ้ง' }),
    makeCategory({ id: 'internet', name: 'อินเทอร์เน็ต' }),
    makeCategory({ id: 'salary', name: 'เงินเดือน', kind: 'income' }),
  ])
  await debts.create(
    { name: 'สินเชื่อบ้าน', kind: 'mortgage', openingBalanceSatang: baht(1_200_000), openingDate: '2026-08-01', interestMethod: 'unknown' },
    { ...meta, id: 'home' },
  )
  await debts.create(
    { name: 'บัตร KBank', kind: 'credit_card', openingBalanceSatang: baht(0), openingDate: '2026-08-01', interestMethod: 'unknown', linkedAccountId: 'card' },
    { ...meta, id: 'cc' },
  )
  await obligations.create(
    {
      name: 'อินเทอร์เน็ต',
      amountSatang: baht(899),
      categoryId: 'internet',
      defaultAccountId: 'kbank',
      recurrence: { frequency: 'monthly', interval: 1, startDate: '2026-09-01', dayOfMonth: 10 },
    },
    { ...meta, id: 'net' },
  )
  const occurrence = (await scheduled.listForSource('obligation', 'net')).find((p) => p.dueDate === '2026-09-10')!
  await scheduled.markPaid(occurrence.id, { type: 'expense', amountSatang: baht(899), accountId: 'kbank', categoryId: 'internet', date: '2026-09-10' }, [], {
    transactionId: 'net-paid',
    now: NOW,
    newId,
  })
  const tx = (id: string) => ({ id, now: NOW, newId })
  await transactions.create({ type: 'income', amountSatang: baht(27_500), accountId: 'kbank', categoryId: 'salary', date: '2026-09-25' }, [], tx('wage'))
  await transactions.create(
    { type: 'expense', amountSatang: baht(2_500), accountId: 'cash', categoryId: 'food', date: '2026-09-03', description: 'ข้าว, "ร้านป้า"', note: '=SUM(A1)' },
    [{ blob: new Blob([RECEIPT], { type: 'image/jpeg' }), fileName: 'receipt.jpg', mimeType: 'image/jpeg', width: 640, height: 480 }],
    tx('food1'),
  )
  await transactions.create({ type: 'expense', amountSatang: baht(3_550), accountId: 'card', categoryId: 'shopping', date: '2026-09-07' }, [], tx('shop'))
  await transactions.create({ type: 'transfer', amountSatang: baht(5_000), accountId: 'kbank', toAccountId: 'cash', date: '2026-09-05' }, [], tx('move'))
  await transactions.create(
    {
      type: 'debt_payment',
      debtId: 'home',
      amountSatang: baht(7_800),
      allocation: 'split',
      principalSatang: baht(6_000),
      interestSatang: baht(1_800),
      feeSatang: baht(0),
      accountId: 'kbank',
      date: '2026-09-25',
    },
    [],
    tx('loan'),
  )
  await transactions.create({ type: 'debt_payment', debtId: 'cc', amountSatang: baht(3_000), accountId: 'kbank', date: '2026-09-20' }, [], tx('cardpay'))
  await budgets.create({ month: '2026-09', categoryId: 'food', limitSatang: baht(6_000) }, { id: 'b-food', now: NOW })
}

const byId = <T extends { id: string }>(rows: T[]) => [...rows].sort((a, b) => a.id.localeCompare(b.id))
async function snapshot(target: FinanceDatabase = database) {
  return {
    accounts: byId(await target.accounts.toArray()),
    categories: byId(await target.categories.toArray()),
    debts: byId(await target.debts.toArray()),
    recurringObligations: byId(await target.recurringObligations.toArray()),
    scheduledPayments: byId(await target.scheduledPayments.toArray()),
    transactions: byId(await target.transactions.toArray()),
    budgets: byId(await target.budgets.toArray()),
    attachments: byId(await target.attachments.toArray()),
    blobs: await Promise.all(
      byId(await target.attachmentBlobs.toArray()).map(async (row) => ({
        id: row.id,
        type: row.blob.type,
        bytes: [...new Uint8Array(await row.blob.arrayBuffer())],
      })),
    ),
  }
}

/** Everything the app derives from the records — must be identical after a restore. */
function derived(s: Awaited<ReturnType<typeof snapshot>>) {
  const names = { category: () => 'c', account: () => 'a', debt: () => 'd', describe: (tx: { id: string }) => tx.id }
  return {
    balances: [...accountBalances(s.accounts, s.transactions)].sort(),
    dashboard: monthTotals(s.transactions, '2026-09'),
    budget: getMonthlyBudgetSummary(s.budgets, s.transactions, '2026-09'),
    debts: debtSummary(s.debts, s.transactions, s.accounts, TODAY),
    analytics: getMonthlyAnalytics({
      transactions: s.transactions,
      accounts: s.accounts,
      debts: s.debts,
      budgets: s.budgets,
      month: '2026-09',
      previousMonth: '2026-08',
      asOf: TODAY,
      previousAsOf: '2026-08-31',
      sourceOf: (id) => s.scheduledPayments.find((p) => p.id === id)?.sourceId,
    }),
    calendar: buildCalendarItems({ transactions: s.transactions, payments: s.scheduledPayments, obligations: s.recurringObligations, names }, '2026-09', TODAY),
    calendarTotals: calendarTotals(
      { transactions: s.transactions, payments: s.scheduledPayments, obligations: s.recurringObligations },
      { start: '2026-09-01', end: '2026-09-30' },
    ),
  }
}

async function clearAll(target: FinanceDatabase = database) {
  await Promise.all(target.tables.map((table) => table.clear()))
}

async function backupText(target: FinanceDatabase = database) {
  return JSON.stringify(await createBackup(target, NOW, '0.1.0'))
}

function rejectionOf(text: string): BackupErrorKind | undefined {
  try {
    readBackup(text)
  } catch (error) {
    if (error instanceof BackupError) return error.kind
    throw error
  }
  return undefined
}

/** Take a valid backup, change it, serialise it again. */
async function tampered(change: (backup: BackupFile & { data: Record<string, unknown[]> }) => void) {
  const backup = JSON.parse(await backupText()) as BackupFile & { data: Record<string, unknown[]> }
  change(backup)
  return JSON.stringify(backup)
}

describe('base64', () => {
  it('round-trips every byte value exactly', () => {
    const bytes = new Uint8Array(Array.from({ length: 70_000 }, (_, i) => (i * 7) % 256))
    expect([...base64ToBytes(bytesToBase64(bytes))!]).toEqual([...bytes])
    expect(base64ToBytes('not base64!')).toBeNull()
  })
})

describe('creating a backup', () => {
  beforeEach(() => seed())

  it('metadata: format, versions, currency, calendar, time, counts', async () => {
    const backup = await createBackup(database, NOW, '0.1.0')
    expect(backup).toMatchObject({
      format: BACKUP_FORMAT,
      formatVersion: BACKUP_FORMAT_VERSION,
      appVersion: '0.1.0',
      schemaVersion: DATA_SCHEMA_VERSION,
      exportedAt: NOW,
      currency: 'THB',
      calendar: 'gregorian',
    })
    expect(backup.counts).toEqual({
      accounts: 3,
      categories: 4,
      debts: 2,
      recurringObligations: 1,
      scheduledPayments: await database.scheduledPayments.count(),
      transactions: 7,
      budgets: 1,
      attachments: 1,
      attachmentBlobs: 1,
    })
    expect(backup.counts).toEqual(await countRecords(database))
    expect(Object.keys(backup)).not.toContain('meta')
    expect(backupFileName(TODAY)).toBe('personal-finance-backup-2026-09-26.json')
  })

  it('money stays integer satang and dates stay "YYYY-MM-DD" in the JSON text', async () => {
    const text = await backupText()
    expect(text).toContain('"amountSatang":2750000')
    expect(text).toContain('"date":"2026-09-25"')
    const wage = (JSON.parse(text) as BackupFile).data.transactions.find((tx) => tx.id === 'wage')!
    expect(wage.amountSatang).toBe(2_750_000)
    expect(Number.isInteger(wage.amountSatang)).toBe(true)
  })

  it('attachments: metadata plus base64 of the exact bytes and the blob type', async () => {
    const backup = await createBackup(database, NOW)
    const [attachment] = backup.data.attachments
    expect(attachment).toMatchObject({
      transactionId: 'food1',
      fileName: 'receipt.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: RECEIPT.length,
      width: 640,
      height: 480,
    })
    expect(backup.data.attachmentBlobs).toEqual([{ id: attachment!.id, type: 'image/jpeg', base64: bytesToBase64(RECEIPT) }])
  })

  it('estimate: records, attachment count and a size close to the real file', async () => {
    const estimate = await estimateBackup(database)
    const real = backupToBlob(await createBackup(database, NOW)).size
    expect(estimate.attachments).toBe(1)
    expect(estimate.records).toBe(3 + 4 + 2 + 1 + (await database.scheduledPayments.count()) + 7 + 1)
    expect(Math.abs(estimate.bytes - real) / real).toBeLessThan(0.25)
  })
})

describe('restoring', () => {
  it('round trip: same records, IDs, money, dates, relationships, attachment bytes and every derived figure', async () => {
    await seed()
    const before = await snapshot()
    const text = await backupText()
    await clearAll()
    expect(await database.transactions.count()).toBe(0)

    const prepared = readBackup(text)
    expect(prepared.counts.transactions).toBe(7)
    await replaceDatabase(database, prepared)

    const after = await snapshot()
    expect(after).toEqual(before)
    expect(derived(after)).toEqual(derived(before))
    // Omitted optional fields stay omitted (never stored as undefined/null).
    const wage = after.transactions.find((tx) => tx.id === 'wage')!
    expect(Object.keys(wage)).not.toContain('toAccountId')
    // Spot checks.
    expect(after.transactions.find((tx) => tx.id === 'loan')).toMatchObject({
      debtId: 'home',
      principalSatang: 600_000,
      interestSatang: 180_000,
      date: '2026-09-25',
    })
    expect(after.transactions.find((tx) => tx.id === 'net-paid')?.scheduledPaymentId).toBe(after.scheduledPayments.find((p) => p.status === 'paid')?.id)
    expect(derived(after).dashboard).toMatchObject({ income: baht(27_500), expense: baht(2_500 + 3_550 + 899), debtPayment: baht(10_800) })
  })

  it('receipt.jpg: same file name, MIME type, size, bytes and transaction', async () => {
    await seed()
    const text = await backupText()
    await clearAll()
    await replaceDatabase(database, readBackup(text))
    const [attachment] = await database.attachments.toArray()
    expect(attachment).toMatchObject({ transactionId: 'food1', fileName: 'receipt.jpg', mimeType: 'image/jpeg', sizeBytes: RECEIPT.length })
    const blob = (await database.attachmentBlobs.get(attachment!.id))!.blob
    expect(blob.type).toBe('image/jpeg')
    expect(blob.size).toBe(RECEIPT.length)
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([...RECEIPT])
  })

  it('replaces, never merges: records not in the backup are gone', async () => {
    const other = new FinanceDatabase(`backup-test-b-${name}`)
    try {
      await createAccountsRepository(other).create(
        { name: 'Account B', kind: 'bank', openingAmountSatang: baht(1), openingDate: '2026-09-01' },
        { id: 'b', now: NOW },
      )
      await other.categories.add(makeCategory({ id: 'cat-b', kind: 'income' }))
      await createTransactionsRepository(other).create({ type: 'income', amountSatang: baht(5), accountId: 'b', categoryId: 'cat-b', date: '2026-09-02' }, [], {
        id: 'tx-b',
        now: NOW,
        newId,
      })
      const text = await backupText(other)
      await createAccountsRepository(database).create(
        { name: 'Account A', kind: 'bank', openingAmountSatang: baht(1), openingDate: '2026-09-01' },
        { id: 'a', now: NOW },
      )
      await database.transactions.add({
        id: 'tx-a',
        type: 'adjustment',
        amountSatang: baht(9),
        accountId: 'a',
        date: '2026-09-02',
        createdAt: NOW,
        updatedAt: NOW,
      })

      await replaceDatabase(database, readBackup(text))
      expect((await database.accounts.toArray()).map((a) => a.id)).toEqual(['b'])
      expect((await database.transactions.toArray()).map((tx) => tx.id)).toEqual(['tx-b'])
    } finally {
      other.close()
      await other.delete()
    }
  })

  it('restoring the same backup twice gives the same database — no duplicates', async () => {
    await seed()
    const text = await backupText()
    await replaceDatabase(database, readBackup(text))
    const once = await snapshot()
    await replaceDatabase(database, readBackup(text))
    expect(await snapshot()).toEqual(once)
    expect(await database.transactions.count()).toBe(7)
  })

  it('a failure while writing rolls everything back: the current data is unchanged', async () => {
    await seed()
    const before = await snapshot()
    const prepared = readBackup(await backupText())
    // Force a failure after the tables are cleared (a duplicate key only IndexedDB would catch).
    const broken = { ...prepared, records: { ...prepared.records, transactions: [...prepared.records.transactions, prepared.records.transactions[0]!] } }
    await expect(replaceDatabase(database, broken)).rejects.toMatchObject({ kind: 'restore_failed' })
    expect(await snapshot()).toEqual(before)
  })

  it('does not touch device metadata (last backup time)', async () => {
    await seed()
    await database.meta.put({ key: 'lastBackupAt', value: NOW, updatedAt: NOW })
    await replaceDatabase(database, readBackup(await backupText()))
    expect((await database.meta.get('lastBackupAt'))?.value).toBe(NOW)
  })
})

describe('validation rejects the whole file (and never writes)', () => {
  beforeEach(() => seed())

  it('invalid JSON / not a backup / unsupported format or schema version', async () => {
    expect(rejectionOf('{"format": "personal-finance-backup", ')).toBe('invalid_json')
    expect(rejectionOf('[]')).toBe('not_backup')
    expect(rejectionOf(JSON.stringify({ format: 'something-else', formatVersion: 1 }))).toBe('not_backup')
    expect(
      rejectionOf(
        await tampered((b) => {
          b.formatVersion = 999
        }),
      ),
    ).toBe('unsupported_version')
    expect(
      rejectionOf(
        await tampered((b) => {
          b.schemaVersion = DATA_SCHEMA_VERSION + 1
        }),
      ),
    ).toBe('unsupported_version')
  })

  it('wrong currency or calendar, missing collection, counts that do not match', async () => {
    expect(
      rejectionOf(
        await tampered((b) => {
          ;(b as { currency: string }).currency = 'USD'
        }),
      ),
    ).toBe('invalid_data')
    expect(
      rejectionOf(
        await tampered((b) => {
          ;(b as { calendar: string }).calendar = 'buddhist'
        }),
      ),
    ).toBe('invalid_data')
    expect(
      rejectionOf(
        await tampered((b) => {
          delete (b.data as Partial<Record<string, unknown>>).budgets
        }),
      ),
    ).toBe('invalid_data')
    expect(
      rejectionOf(
        await tampered((b) => {
          b.counts.transactions = 99
        }),
      ),
    ).toBe('invalid_data')
  })

  it.each([
    ['a fraction', 1.5],
    ['a string', '27500'],
    ['null (NaN in JSON)', null],
    ['infinity', 'INF'],
  ])('money that is %s', async (_label, value) => {
    const text = await tampered((b) => {
      ;(b.data.transactions[0] as { amountSatang: unknown }).amountSatang = value
    })
    expect(rejectionOf(value === 'INF' ? text.replace('"amountSatang":"INF"', '"amountSatang":1e400') : text)).toBe('invalid_data')
  })

  it('invalid dates and timestamps, unknown types, unknown fields', async () => {
    expect(
      rejectionOf(
        await tampered((b) => {
          ;(b.data.transactions[0] as { date: string }).date = '2026-02-30'
        }),
      ),
    ).toBe('invalid_data')
    expect(
      rejectionOf(
        await tampered((b) => {
          ;(b.data.transactions[0] as { date: string }).date = '30/09/2026'
        }),
      ),
    ).toBe('invalid_data')
    expect(
      rejectionOf(
        await tampered((b) => {
          ;(b.data.accounts[0] as { createdAt: string }).createdAt = 'yesterday'
        }),
      ),
    ).toBe('invalid_data')
    expect(
      rejectionOf(
        await tampered((b) => {
          ;(b.data.transactions[0] as { type: string }).type = 'gift'
        }),
      ),
    ).toBe('invalid_data')
    expect(
      rejectionOf(
        await tampered((b) => {
          ;(b.data.accounts[0] as { balance?: number }).balance = 1
        }),
      ),
    ).toBe('invalid_data')
  })

  it('duplicate IDs, duplicate budgets and duplicate occurrences', async () => {
    expect(
      rejectionOf(
        await tampered((b) => {
          b.data.transactions.push(b.data.transactions[0]!)
          b.counts.transactions += 1
        }),
      ),
    ).toBe('duplicate_id')
    expect(
      rejectionOf(
        await tampered((b) => {
          b.data.budgets.push({ ...b.data.budgets[0]!, id: 'b-food-2' })
          b.counts.budgets += 1
        }),
      ),
    ).toBe('duplicate_id')
    expect(
      rejectionOf(
        await tampered((b) => {
          b.data.scheduledPayments.push({ ...b.data.scheduledPayments[0]!, id: 'sp-copy' })
          b.counts.scheduledPayments += 1
        }),
      ),
    ).toBe('duplicate_id')
  })

  it.each([
    ['transaction → account', (b: BackupFile) => void (b.data.transactions.find((tx) => tx.id === 'wage')!.accountId = 'nowhere')],
    ['transaction → category', (b: BackupFile) => void (b.data.transactions.find((tx) => tx.id === 'wage')!.categoryId = 'nowhere')],
    ['transaction → debt', (b: BackupFile) => void (b.data.transactions.find((tx) => tx.id === 'loan')!.debtId = 'nowhere')],
    ['transaction → scheduled payment', (b: BackupFile) => void (b.data.transactions.find((tx) => tx.id === 'net-paid')!.scheduledPaymentId = 'nowhere')],
    ['scheduled payment → rule', (b: BackupFile) => void (b.data.scheduledPayments[0]!.sourceId = 'nowhere')],
    ['debt → card account', (b: BackupFile) => void (b.data.debts.find((d) => d.id === 'cc')!.linkedAccountId = 'nowhere')],
    ['budget → category', (b: BackupFile) => void (b.data.budgets[0]!.categoryId = 'nowhere')],
    ['attachment → transaction', (b: BackupFile) => void (b.data.attachments[0]!.transactionId = 'nowhere')],
  ])('broken reference: %s', async (_label, change) => {
    expect(rejectionOf(await tampered(change as never))).toBe('broken_reference')
  })

  it('attachments: missing blob, blob without attachment, bytes that do not match the size', async () => {
    expect(
      rejectionOf(
        await tampered((b) => {
          b.data.attachmentBlobs = []
          b.counts.attachmentBlobs = 0
        }),
      ),
    ).toBe('missing_attachment')
    expect(
      rejectionOf(
        await tampered((b) => {
          b.data.attachmentBlobs.push({ id: 'orphan', type: 'image/png', base64: 'AAAA' })
          b.counts.attachmentBlobs += 1
        }),
      ),
    ).toBe('missing_attachment')
    expect(
      rejectionOf(
        await tampered((b) => {
          ;(b.data.attachmentBlobs[0] as { base64: string }).base64 = 'AAAA'
        }),
      ),
    ).toBe('missing_attachment')
  })

  it('reading a bad file never changes the database', async () => {
    const before = await snapshot()
    expect(rejectionOf('{')).toBe('invalid_json')
    expect(
      rejectionOf(
        await tampered((b) => {
          b.formatVersion = 999
        }),
      ),
    ).toBe('unsupported_version')
    expect(await snapshot()).toEqual(before)
  })
})

describe('data exports (read-only)', () => {
  beforeEach(() => seed())

  it('JSON: all financial records, attachment metadata only, not restorable as a backup, database unchanged', async () => {
    const before = await snapshot()
    const text = await (await exportDataJson(database, NOW)).text()
    const data = JSON.parse(text) as Record<string, unknown[]> & { format: string; amountUnit: string }
    expect(data.format).toBe('personal-finance-data-export')
    expect(data.amountUnit).toBe('satang')
    expect(data.transactions).toHaveLength(7)
    expect(data.attachments).toHaveLength(1)
    expect(text).not.toContain(bytesToBase64(RECEIPT))
    expect(Object.keys(data)).not.toContain('attachmentBlobs')
    expect(rejectionOf(text)).toBe('not_backup')
    expect(await snapshot()).toEqual(before)
  })

  it('CSV: BOM, Thai headers, human-readable rows in date order, exact amounts, quoting and formula-safe text', async () => {
    const before = await snapshot()
    const csv = await (await exportTransactionsCsv(database)).text()
    // Blob#text() drops the BOM when decoding; check the raw bytes.
    const bytes = new Uint8Array(await (await exportTransactionsCsv(database)).arrayBuffer())
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    const lines = csv.replace(/^﻿/, '').trimEnd().split('\r\n')
    expect(lines[0]).toBe('วันที่,ประเภท,จำนวนเงิน,หมวดหมู่,บัญชี,รายละเอียด,หมายเหตุ,หนี้,เงินต้น,ดอกเบี้ย,ค่าธรรมเนียม')
    expect(lines).toHaveLength(8)
    expect(lines[1]).toBe(`2026-09-03,รายจ่าย,2500.00,อาหาร,เงินสด,"ข้าว, ""ร้านป้า""",'=SUM(A1),,,,`)
    expect(lines).toContain('2026-09-05,โอนเงิน,5000.00,,KBank → เงินสด,,,,,,')
    expect(lines).toContain('2026-09-25,ชำระหนี้,7800.00,,KBank,,,สินเชื่อบ้าน,6000.00,1800.00,0.00')
    expect(lines.some((line) => line.includes('id-') || line.includes('wage'))).toBe(false)
    expect(await snapshot()).toEqual(before)
  })
})
