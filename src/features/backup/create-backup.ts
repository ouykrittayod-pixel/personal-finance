/**
 * Creating a backup and restoring one. Both run entirely in the browser;
 * nothing is sent anywhere.
 */
import type { FinanceDatabase } from '@/db/dexie'
import { toStorageError } from '@/db/errors'
import { LATEST_SCHEMA_VERSION } from '@/db/schema'
import { blobToBase64 } from './base64'
import {
  BACKUP_CALENDAR,
  BACKUP_CURRENCY,
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  BACKUP_TABLES,
  BackupError,
  type BackupCounts,
  type BackupFile,
  type EncodedBlob,
} from './format'
import type { PreparedRestore } from './read-backup'

export const APP_VERSION: string = import.meta.env.VITE_APP_VERSION ?? '0.0.0'

const recordTables = (database: FinanceDatabase) => [
  database.accounts,
  database.categories,
  database.debts,
  database.recurringObligations,
  database.scheduledPayments,
  database.transactions,
  database.budgets,
  database.attachments,
]
const allTables = (database: FinanceDatabase) => [...recordTables(database), database.attachmentBlobs]

/** Record counts per table (no records or blobs loaded). */
export async function countRecords(database: FinanceDatabase): Promise<BackupCounts> {
  const tables = allTables(database)
  const counts = await Promise.all(tables.map((table) => table.count()))
  return Object.fromEntries(tables.map((table, i) => [table.name, counts[i]])) as BackupCounts
}

export interface BackupEstimate {
  counts: BackupCounts
  /** Records excluding attachments. */
  records: number
  attachments: number
  /** Approximate size of the backup file in bytes. */
  bytes: number
}

/** What a backup would contain and roughly how big it is — reads records and attachment sizes, never the blobs. */
export async function estimateBackup(database: FinanceDatabase): Promise<BackupEstimate> {
  const counts = await countRecords(database)
  const rows = await Promise.all(recordTables(database).map((table) => table.toArray()))
  const attachments = rows.at(-1) as { sizeBytes: number }[]
  const recordBytes = rows.reduce((total, list) => total + JSON.stringify(list).length, 0)
  // Base64 is 4 characters per 3 bytes.
  const blobBytes = attachments.reduce((total, a) => total + Math.ceil(a.sizeBytes / 3) * 4 + 80, 0)
  const records = BACKUP_TABLES.filter((table) => table !== 'attachments' && table !== 'attachmentBlobs').reduce((total, table) => total + counts[table], 0)
  return { counts, records, attachments: counts.attachments, bytes: recordBytes + blobBytes + 1_024 }
}

/**
 * A complete backup. Records are read in one read-only transaction (a
 * consistent snapshot); attachments are encoded one at a time afterwards so the
 * page stays responsive.
 */
export async function createBackup(database: FinanceDatabase, exportedAt: string, appVersion: string = APP_VERSION): Promise<BackupFile> {
  const snapshot = await database.transaction('r', allTables(database), async () => ({
    accounts: await database.accounts.toArray(),
    categories: await database.categories.toArray(),
    debts: await database.debts.toArray(),
    recurringObligations: await database.recurringObligations.toArray(),
    scheduledPayments: await database.scheduledPayments.toArray(),
    transactions: await database.transactions.toArray(),
    budgets: await database.budgets.toArray(),
    attachments: await database.attachments.toArray(),
    blobIds: (await database.attachmentBlobs.toCollection().primaryKeys()).map(String),
  }))

  const attachmentBlobs: EncodedBlob[] = []
  for (const blobId of snapshot.blobIds) {
    const row = await database.attachmentBlobs.get(blobId)
    if (!row) throw new BackupError('missing_attachment', [`attachmentBlobs[${blobId}]`])
    attachmentBlobs.push({ id: row.id, type: row.blob.type, base64: await blobToBase64(row.blob) })
  }

  const { blobIds: _ids, ...records } = snapshot
  const data = { ...records, attachmentBlobs }
  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    appVersion,
    schemaVersion: LATEST_SCHEMA_VERSION,
    exportedAt,
    currency: BACKUP_CURRENCY,
    calendar: BACKUP_CALENDAR,
    counts: Object.fromEntries(BACKUP_TABLES.map((table) => [table, data[table].length])) as BackupCounts,
    data,
  }
}

export function backupToBlob(backup: BackupFile): Blob {
  return new Blob([JSON.stringify(backup)], { type: 'application/json' })
}

/**
 * Replace the whole database with a validated backup, atomically: every table
 * is cleared and refilled inside ONE read-write transaction. If anything fails
 * the transaction aborts and IndexedDB rolls back — the current data is kept
 * as it was. Blobs are decoded before the transaction starts (in readBackup),
 * so the transaction only contains database operations.
 */
export async function replaceDatabase(database: FinanceDatabase, restore: Pick<PreparedRestore, 'records' | 'blobs'>): Promise<void> {
  const { records, blobs } = restore
  try {
    await database.transaction('rw', allTables(database), async () => {
      await Promise.all(allTables(database).map((table) => table.clear()))
      await database.accounts.bulkAdd(records.accounts)
      await database.categories.bulkAdd(records.categories)
      await database.debts.bulkAdd(records.debts)
      await database.recurringObligations.bulkAdd(records.recurringObligations)
      await database.scheduledPayments.bulkAdd(records.scheduledPayments)
      await database.transactions.bulkAdd(records.transactions)
      await database.budgets.bulkAdd(records.budgets)
      await database.attachments.bulkAdd(records.attachments)
      await database.attachmentBlobs.bulkAdd(blobs)
    })
  } catch (error) {
    // Rolled back. The cause (e.g. storage full) is kept for the console only.
    throw new BackupError('restore_failed', [], toStorageError(error))
  }
}
