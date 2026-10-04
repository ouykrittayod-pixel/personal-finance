/**
 * The device side of Google Drive sync: read this browser's cache as a
 * snapshot, and write a merged snapshot back. The cache is disposable — the
 * data set lives in Drive — so applying replaces whatever differs.
 */
import type { Table } from 'dexie'
import { canonicalJson, type DriveSnapshot, type DriveTombstone, type SyncRecord } from '@/domain/drive-merge'
import { SYNCED_TABLES, type SyncedTable } from '@/domain/sync'
import type { FinanceDatabase } from '../dexie'
import { suppressSyncTracking } from './tracking'

/** Local tombstones older than this are dropped after a successful sync (Drive keeps its own copy). */
export const LOCAL_TOMBSTONE_DAYS = 60

export interface LocalSnapshot {
  snapshot: DriveSnapshot
  /** Highest outbox seq included in this snapshot: changes after it happened during the sync. */
  mark: number
  /** Local changes not yet in Drive. */
  pending: number
}

const syncedTables = (database: FinanceDatabase) => SYNCED_TABLES.map((name) => database.table(name) as Table<SyncRecord, string>)

export async function readLocalSnapshot(database: FinanceDatabase): Promise<LocalSnapshot> {
  return database.transaction('r', [...syncedTables(database), database.syncOutbox, database.syncTombstones], async () => {
    const data = {} as Record<SyncedTable, SyncRecord[]>
    for (const name of SYNCED_TABLES) data[name] = await database.table<SyncRecord, string>(name).toArray()
    const outbox = await database.syncOutbox.toArray()
    const tombstones: DriveTombstone[] = (await database.syncTombstones.toArray()).map((t) => ({ tableName: t.tableName, recordId: t.recordId, deletedAt: t.deletedAt }))
    return { snapshot: { data, tombstones }, mark: outbox.reduce((max, entry) => Math.max(max, entry.seq), 0), pending: outbox.length }
  })
}

export interface ApplyResult {
  /** Records written or removed because Drive had something this device did not. */
  changed: number
}

/**
 * Make the cache equal to `merged`, except records changed on this device
 * while the sync was running (outbox seq > mark): those stay as they are and
 * go up with the next sync. Outbox entries up to `mark` are done. Runs in one
 * transaction and is not itself recorded as a local change.
 */
export async function applyMergedSnapshot(database: FinanceDatabase, merged: DriveSnapshot, mark: number, now: string): Promise<ApplyResult> {
  const tables = syncedTables(database)
  return database.transaction('rw', [...tables, database.syncOutbox, database.syncTombstones], async (tx) => {
    suppressSyncTracking(tx.idbtrans)
    const recent = await database.syncOutbox.where('seq').above(mark).toArray()
    const keep = new Set(recent.map((entry) => `${entry.tableName}\u0000${entry.recordId}`))
    let changed = 0

    for (const name of SYNCED_TABLES) {
      const table = database.table<SyncRecord, string>(name)
      const desired = new Map(merged.data[name].map((record) => [record.id, record]))
      const current = await table.toArray()
      const currentById = new Map(current.map((record) => [record.id, record]))
      const deletes = current.filter((record) => !desired.has(record.id) && !keep.has(`${name}\u0000${record.id}`)).map((record) => record.id)
      const puts = [...desired.values()].filter((record) => {
        if (keep.has(`${name}\u0000${record.id}`)) return false
        const existing = currentById.get(record.id)
        return !existing || canonicalJson(existing) !== canonicalJson(record)
      })
      // Deletes first: a record replacing another with the same natural key must not hit the unique index.
      if (deletes.length) await table.bulkDelete(deletes)
      if (puts.length) await table.bulkPut(puts)
      changed += deletes.length + puts.length
    }

    // Attachment files of removed attachment records are not needed any more.
    const attachmentIds = new Set(merged.data.attachments.map((a) => a.id))
    const orphanBlobs = (await database.attachmentBlobs.toCollection().primaryKeys()).filter((id) => !attachmentIds.has(id) && !keep.has(`attachments\u0000${id}`))
    if (orphanBlobs.length) await database.attachmentBlobs.bulkDelete(orphanBlobs)

    await database.syncOutbox.where('seq').belowOrEqual(mark).delete()
    // This device's own tombstones are kept for a while (they re-assert a delete if another device
    // uploads a stale copy at the same moment); Drive keeps the full set.
    const cutoff = new Date(Date.parse(now) - LOCAL_TOMBSTONE_DAYS * 86_400_000).toISOString()
    await database.syncTombstones.filter((t) => t.deletedAt < cutoff && !keep.has(`${t.tableName}\u0000${t.recordId}`)).delete()
    return { changed }
  })
}

/** Every attachment record that has no file on this device yet. */
export async function attachmentsWithoutBlob(database: FinanceDatabase): Promise<string[]> {
  const [ids, blobIds] = await Promise.all([database.attachments.toCollection().primaryKeys(), database.attachmentBlobs.toCollection().primaryKeys()])
  const present = new Set(blobIds)
  return ids.filter((id) => !present.has(id))
}

/**
 * Empty this device's cache completely (signing out of Drive). Business data,
 * attachment files, sync bookkeeping and device-local settings go; the device
 * id stays. Not recorded as changes (nothing must be "deleted" in Drive).
 */
export async function clearLocalCache(database: FinanceDatabase): Promise<void> {
  const tables = [...syncedTables(database), database.attachmentBlobs, database.syncOutbox, database.syncTombstones, database.meta]
  await database.transaction('rw', tables, async (tx) => {
    suppressSyncTracking(tx.idbtrans)
    for (const table of tables) await table.clear()
  })
}
