/**
 * Local sync foundation: schema v2 migration, device identity, restore
 * handling and a dev-only reset. Local only — nothing here talks to a network.
 */
import type { Transaction as DexieTransaction } from 'dexie'
import type { ScheduledPayment, Transaction } from '@/domain/entities'
import { planOccurrenceIdMigration } from '@/domain/identity'
import { auditSyncConsistency, type SyncAuditIssue } from '@/domain/sync-audit'
import { initialSyncState, type OutboxEntry, type SyncSettings, type SyncState, type Tombstone } from '@/domain/sync'
import type { FinanceDatabase } from '../dexie'
import { suppressSyncTracking } from './tracking'

const newDevice = (now: string): SyncSettings => ({ key: 'device', deviceId: crypto.randomUUID(), createdAt: now, syncEnabled: false })

/**
 * Records with occurrence ids rewritten to their deterministic form (source +
 * due date) and every transaction's scheduledPaymentId following along. Pure;
 * records already deterministic are returned unchanged. Paid history is kept:
 * status, transactionId and amounts are untouched, only the id changes.
 */
export function withDeterministicOccurrenceIds<T extends { scheduledPayments: readonly ScheduledPayment[]; transactions: readonly Transaction[] }>(
  records: T,
): T & { renamed: number } {
  const renames = planOccurrenceIdMigration(records.scheduledPayments)
  if (renames.size === 0) return { ...records, renamed: 0 }
  return {
    ...records,
    scheduledPayments: records.scheduledPayments.map((p) => (renames.has(p.id) ? { ...p, id: renames.get(p.id)! } : p)),
    transactions: records.transactions.map((tx) =>
      tx.scheduledPaymentId && renames.has(tx.scheduledPaymentId) ? { ...tx, scheduledPaymentId: renames.get(tx.scheduledPaymentId)! } : tx,
    ),
    renamed: renames.size,
  }
}

/**
 * Schema v2 upgrade (runs once, inside IndexedDB's version-change transaction;
 * any error rolls the whole upgrade back and the database stays at v1).
 * 1. Occurrence ids become deterministic; transactions follow. The table is
 *    rewritten in full (the source+dueDate index is unique).
 * 2. The device row (random id, sync off) and the sync state row are created.
 * Not tracked in the outbox: a migration is not a user change.
 */
export async function upgradeToV2(tx: DexieTransaction): Promise<void> {
  const payments = (await tx.table('scheduledPayments').toArray()) as ScheduledPayment[]
  const renames = planOccurrenceIdMigration(payments)
  if (renames.size) {
    // Rewrite the whole table (all rows are in memory): cheaper than per-key deletes, and the unique source+dueDate index never sees two rows at once.
    await tx.table('scheduledPayments').clear()
    await tx.table('scheduledPayments').bulkAdd(payments.map((p) => (renames.has(p.id) ? { ...p, id: renames.get(p.id)! } : p)))
    // Only transactions with a scheduledPaymentId are in that index: one ordered scan, one bulk write.
    const linked = (await tx.table('transactions').orderBy('scheduledPaymentId').toArray()) as Transaction[]
    const moved = linked
      .filter((row) => renames.has(row.scheduledPaymentId!))
      .map((row) => ({ ...row, scheduledPaymentId: renames.get(row.scheduledPaymentId!)! }))
    if (moved.length) await tx.table('transactions').bulkPut(moved)
  }
  const now = new Date().toISOString()
  if (!(await tx.table('syncSettings').get('device'))) await tx.table('syncSettings').add(newDevice(now))
  if (!(await tx.table('syncState').get('state'))) await tx.table('syncState').add(initialSyncState())
}

/** Device and state rows exist (a fresh database gets them here, at startup). */
export async function ensureSyncFoundation(database: FinanceDatabase): Promise<void> {
  await database.transaction('rw', database.syncSettings, database.syncState, async () => {
    if (!(await database.syncSettings.get('device'))) await database.syncSettings.add(newDevice(new Date().toISOString()))
    if (!(await database.syncState.get('state'))) await database.syncState.add(initialSyncState())
  })
}

export interface SyncFoundationStatus {
  deviceId: string | null
  syncEnabled: boolean
  status: SyncState['status']
  epoch: number
  outbox: Record<OutboxEntry['op'], number>
  tombstones: number
}

/** Counts only — no record content. For the dev integrity page. */
export async function readSyncStatus(database: FinanceDatabase): Promise<SyncFoundationStatus> {
  return database.transaction('r', database.syncSettings, database.syncState, database.syncOutbox, database.syncTombstones, async () => {
    const device = await database.syncSettings.get('device')
    const state = (await database.syncState.get('state')) ?? initialSyncState()
    const outbox = { create: 0, update: 0, delete: 0 }
    await database.syncOutbox.each((entry) => {
      outbox[entry.op]++
    })
    return {
      deviceId: device?.deviceId ?? null,
      syncEnabled: device?.syncEnabled ?? false,
      status: state.status,
      epoch: state.epoch,
      outbox,
      tombstones: await database.syncTombstones.count(),
    }
  })
}

/**
 * Sync bookkeeping after the whole data set was replaced (restore): pending
 * changes and tombstones describe data that no longer exists, so they are
 * cleared and the epoch moves on. The device keeps its id. Call inside the
 * restore transaction.
 */
export async function resetAfterReplace(database: FinanceDatabase): Promise<void> {
  const state = (await database.syncState.get('state')) ?? initialSyncState()
  await database.syncOutbox.clear()
  await database.syncTombstones.clear()
  await database.syncState.put({ ...state, epoch: state.epoch + 1, nextOutboxSeq: 1 })
}

/**
 * DEV ONLY: clears outbox, tombstones and sync state, optionally with a new
 * device id. Business data is not touched.
 */
export async function resetSyncMetadata(database: FinanceDatabase, options: { newDeviceId?: boolean } = {}): Promise<void> {
  if (!import.meta.env.DEV && import.meta.env.MODE !== 'test') throw new Error('dev only')
  await database.transaction('rw', [database.syncOutbox, database.syncTombstones, database.syncState, database.syncSettings], async (tx) => {
    suppressSyncTracking(tx.idbtrans)
    const state = (await database.syncState.get('state')) ?? initialSyncState()
    await database.syncOutbox.clear()
    await database.syncTombstones.clear()
    await database.syncState.put({ ...initialSyncState(), epoch: state.epoch + 1 })
    if (options.newDeviceId || !(await database.syncSettings.get('device'))) await database.syncSettings.put(newDevice(new Date().toISOString()))
  })
}

export type { OutboxEntry, SyncSettings, SyncState, Tombstone }

/** Sync bookkeeping checked against the data, in one read-only transaction. */
export async function auditLocalSync(database: FinanceDatabase): Promise<SyncAuditIssue[]> {
  return database.transaction('r', database.tables, async () =>
    auditSyncConsistency({
      records: {
        accounts: await database.accounts.toArray(),
        categories: await database.categories.toArray(),
        transactions: await database.transactions.toArray(),
        recurringObligations: await database.recurringObligations.toArray(),
        scheduledPayments: await database.scheduledPayments.toArray(),
        debts: await database.debts.toArray(),
        budgets: await database.budgets.toArray(),
        attachments: await database.attachments.toArray(),
      },
      outbox: await database.syncOutbox.toArray(),
      tombstones: await database.syncTombstones.toArray(),
      settings: await database.syncSettings.get('device'),
    }),
  )
}
