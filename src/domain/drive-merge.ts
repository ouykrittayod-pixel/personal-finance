/**
 * Merging two copies of the data set — this device's cache and the file in
 * the user's Google Drive — into one. Pure: no I/O, no clock (callers pass `now`).
 *
 * Rules (per record, keyed by table + id):
 * - Present on one side only and not deleted → kept (a copy that missed a
 *   change gets it back on its next sync; nothing is lost by a stale upload).
 * - Present on both → the later version wins (`updatedAt`, or `createdAt` for
 *   records that never change). Equal versions with different content: the
 *   canonical JSON that sorts last wins, so every device picks the same one.
 * - A tombstone (record deleted at `deletedAt`) removes the record unless the
 *   record was changed after the delete (then the record wins and the
 *   tombstone is dropped).
 * - Records that must be unique by meaning, not only by id, are reduced to one:
 *   budgets by month + category; scheduled payments by source + due date
 *   (a settled occurrence beats a pending one). Losers get tombstones.
 *
 * Device clocks decide "later". For one person using a phone and a computer
 * this is enough; a clock that is badly wrong can make an older edit win.
 */
import type { ID, ISODateTime } from './entities'
import { SYNCED_TABLES, type SyncedTable } from './sync'

/** Any stored business record. */
export type SyncRecord = { id: ID; createdAt: ISODateTime; updatedAt?: ISODateTime } & Record<string, unknown>

export interface DriveTombstone {
  tableName: SyncedTable
  recordId: ID
  deletedAt: ISODateTime
}

export interface DriveSnapshot {
  data: Record<SyncedTable, SyncRecord[]>
  tombstones: DriveTombstone[]
}

export const emptySnapshot = (): DriveSnapshot => ({
  data: Object.fromEntries(SYNCED_TABLES.map((table) => [table, []])) as unknown as Record<SyncedTable, SyncRecord[]>,
  tombstones: [],
})

/** JSON with object keys sorted, so equal content always gives equal text. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export const versionOf = (record: SyncRecord): ISODateTime => record.updatedAt ?? record.createdAt

/** The record that wins between two versions of the same record. */
export function newerRecord(a: SyncRecord, b: SyncRecord): SyncRecord {
  const va = versionOf(a)
  const vb = versionOf(b)
  if (va !== vb) return va > vb ? a : b
  return canonicalJson(a) >= canonicalJson(b) ? a : b
}

const key = (table: SyncedTable, id: ID) => `${table}\u0000${id}`
const byId = (a: SyncRecord, b: SyncRecord) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

function laterTimestamp(a: ISODateTime, b: ISODateTime): ISODateTime {
  return a > b ? a : b
}

/** Natural keys that must stay unique (mirrors the unique IndexedDB indexes). */
const NATURAL_KEYS: Partial<Record<SyncedTable, (record: SyncRecord) => string>> = {
  budgets: (r) => `${String(r.month)}|${String(r.categoryId)}`,
  scheduledPayments: (r) => `${String(r.sourceType)}|${String(r.sourceId)}|${String(r.dueDate)}`,
}

/** Which of two records with the same natural key survives. */
function naturalKeyWinner(table: SyncedTable, a: SyncRecord, b: SyncRecord): SyncRecord {
  if (table === 'scheduledPayments') {
    const settled = (r: SyncRecord) => r.status !== 'pending' || r.transactionId !== undefined
    if (settled(a) !== settled(b)) return settled(a) ? a : b
  }
  const winner = newerRecord(a, b)
  if (versionOf(a) === versionOf(b)) return a.id <= b.id ? a : b
  return winner
}

export function mergeSnapshots(local: DriveSnapshot, remote: DriveSnapshot | null, now: ISODateTime): DriveSnapshot {
  if (!remote) remote = emptySnapshot()

  // Tombstones: union, latest delete wins.
  const graves = new Map<string, DriveTombstone>()
  for (const grave of [...remote.tombstones, ...local.tombstones]) {
    const k = key(grave.tableName, grave.recordId)
    const existing = graves.get(k)
    if (!existing || grave.deletedAt > existing.deletedAt) graves.set(k, { tableName: grave.tableName, recordId: grave.recordId, deletedAt: grave.deletedAt })
  }

  const data = {} as Record<SyncedTable, SyncRecord[]>
  for (const table of SYNCED_TABLES) {
    const records = new Map<ID, SyncRecord>()
    for (const record of [...(remote.data[table] ?? []), ...(local.data[table] ?? [])]) {
      const existing = records.get(record.id)
      records.set(record.id, existing ? newerRecord(existing, record) : record)
    }
    // Apply deletes; an edit made after the delete brings the record back.
    for (const [id, record] of records) {
      const grave = graves.get(key(table, id))
      if (!grave) continue
      if (grave.deletedAt >= versionOf(record)) records.delete(id)
      else graves.delete(key(table, id))
    }
    // One record per natural key.
    const naturalKey = NATURAL_KEYS[table]
    if (naturalKey) {
      const winners = new Map<string, SyncRecord>()
      for (const record of records.values()) {
        const k = naturalKey(record)
        const current = winners.get(k)
        winners.set(k, current ? naturalKeyWinner(table, current, record) : record)
      }
      for (const record of [...records.values()]) {
        if (winners.get(naturalKey(record)) === record) continue
        records.delete(record.id)
        graves.set(key(table, record.id), { tableName: table, recordId: record.id, deletedAt: laterTimestamp(now, versionOf(record)) })
      }
    }
    data[table] = [...records.values()].sort(byId)
  }

  const tombstones = [...graves.values()].sort((a, b) => (a.tableName === b.tableName ? (a.recordId < b.recordId ? -1 : 1) : a.tableName < b.tableName ? -1 : 1))
  return { data, tombstones }
}

/** Same records and tombstones (order and key order ignored). */
export function sameSnapshot(a: DriveSnapshot, b: DriveSnapshot): boolean {
  return canonicalJson(normalize(a)) === canonicalJson(normalize(b))
}

function normalize(snapshot: DriveSnapshot): DriveSnapshot {
  const data = {} as Record<SyncedTable, SyncRecord[]>
  for (const table of SYNCED_TABLES) data[table] = [...(snapshot.data[table] ?? [])].sort(byId)
  const tombstones = [...snapshot.tombstones].sort((a, b) => key(a.tableName, a.recordId).localeCompare(key(b.tableName, b.recordId)))
  return { data, tombstones }
}

/** Counts per table, for status messages. */
export function snapshotCounts(snapshot: DriveSnapshot): number {
  return SYNCED_TABLES.reduce((total, table) => total + (snapshot.data[table]?.length ?? 0), 0)
}
