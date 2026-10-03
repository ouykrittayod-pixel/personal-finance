/**
 * Local sync foundation (Phase 18) — types and pure rules only. There is NO
 * network sync: nothing here sends, receives or uploads anything. These
 * records only prepare the local database for a later, opt-in sync.
 *
 * Model:
 * - Every write to a synced table leaves one outbox entry per changed record
 *   (created in the same IndexedDB transaction as the write, db/sync/tracking).
 *   Entries carry no record content: the record is read when it is sent, so
 *   the outbox never holds a second copy of financial data.
 * - Several local changes to one record before it is sent collapse into one
 *   entry (collapseOutbox below).
 * - A deleted record leaves a tombstone so other devices can learn about the
 *   delete later. The user never sees tombstones.
 * - Revisions come from the future server, never from device clocks. Until a
 *   device is linked every base revision is 0 (REVISION_UNSYNCED).
 */
import type { ID, ISODateTime } from './entities'

/** Tables whose records sync (metadata only for attachments; blobs stay on the device). */
export const SYNCED_TABLES = ['accounts', 'categories', 'transactions', 'recurringObligations', 'scheduledPayments', 'debts', 'budgets', 'attachments'] as const
export type SyncedTable = (typeof SYNCED_TABLES)[number]

/** Device-local tables: never synced, never in backups. */
export const LOCAL_ONLY_TABLES = ['attachmentBlobs', 'meta', 'syncOutbox', 'syncTombstones', 'syncState', 'syncSettings', 'keyring'] as const

export const SYNC_TABLES = ['syncOutbox', 'syncTombstones', 'syncState', 'syncSettings'] as const

export const SYNC_PROTOCOL_VERSION = 1
export const OUTBOX_PAYLOAD_VERSION = 1
/** Base revision of a record that has never been confirmed by a server. */
export const REVISION_UNSYNCED = 0

export type OutboxOp = 'create' | 'update' | 'delete'

export interface OutboxEntry {
  tableName: SyncedTable
  recordId: ID
  op: OutboxOp
  /** Idempotency key for the future server: a retried send is applied once. New whenever the entry changes after a send attempt. */
  opId: ID
  /** Local order of the latest change (monotonic per device; not a clock). */
  seq: number
  /** Server revision this change was based on (0 until the device is linked). */
  baseRevision: number
  deviceId: ID
  createdAt: ISODateTime
  updatedAt: ISODateTime
  /** Send attempts so far (always 0 in this phase). */
  attempts: number
  payloadVersion: number
}

export interface Tombstone {
  tableName: SyncedTable
  recordId: ID
  deletedAt: ISODateTime
  deviceId: ID
  baseRevision: number
  opId: ID
}

export interface SyncSettings {
  key: 'device'
  /** Random id (crypto.randomUUID) made once per database; no hardware or browser fingerprint. */
  deviceId: ID
  createdAt: ISODateTime
  /** Sync is off and cannot be turned on in this phase. */
  syncEnabled: false
}

export type SyncStatus = 'disabled'

export interface SyncState {
  key: 'state'
  protocolVersion: number
  linked: false
  cursor: null
  lastSyncAt: null
  status: SyncStatus
  lastError: null
  /** Bumped when the local data set is replaced (restore, dev reset): a later sync must reconcile from scratch. */
  epoch: number
  nextOutboxSeq: number
}

export function initialSyncState(): SyncState {
  return {
    key: 'state',
    protocolVersion: SYNC_PROTOCOL_VERSION,
    linked: false,
    cursor: null,
    lastSyncAt: null,
    status: 'disabled',
    lastError: null,
    epoch: 0,
    nextOutboxSeq: 1,
  }
}

export interface ChangeContext {
  tableName: SyncedTable
  recordId: ID
  deviceId: ID
  now: ISODateTime
  seq: number
  newOpId: () => ID
}

export interface CollapseResult {
  /** The entry to store, or null to remove the record's entry. */
  entry: OutboxEntry | null
  /** What to do with the record's tombstone. */
  tombstone: 'write' | 'remove' | 'keep'
}

const inFlight = (entry: OutboxEntry) => entry.attempts > 0

/**
 * One local change folded into the record's pending outbox entry.
 *
 *   (none)  + create → create        (none)  + update → update     (none) + delete → delete (+ tombstone)
 *   create  + update → create        create  + delete → nothing (never left the device, no tombstone)
 *   update  + update → update        update  + delete → delete (+ tombstone)
 *   delete  + create → update (the record exists again; tombstone removed)
 *
 * An entry that was already sent (attempts > 0) may have reached the server,
 * so it is never dropped: it keeps its op where that is still correct and gets
 * a new opId so the server treats the change as new.
 */
export function collapseOutbox(existing: OutboxEntry | undefined, op: OutboxOp, ctx: ChangeContext): CollapseResult {
  const fresh = (nextOp: OutboxOp, base?: OutboxEntry): OutboxEntry => ({
    tableName: ctx.tableName,
    recordId: ctx.recordId,
    op: nextOp,
    opId: base && !inFlight(base) ? base.opId : ctx.newOpId(),
    seq: ctx.seq,
    baseRevision: base?.baseRevision ?? REVISION_UNSYNCED,
    deviceId: ctx.deviceId,
    createdAt: base?.createdAt ?? ctx.now,
    updatedAt: ctx.now,
    attempts: 0,
    payloadVersion: OUTBOX_PAYLOAD_VERSION,
  })

  if (!existing) return op === 'delete' ? { entry: fresh('delete'), tombstone: 'write' } : { entry: fresh(op), tombstone: op === 'create' ? 'remove' : 'keep' }

  switch (op) {
    case 'create':
      // A pending delete followed by a create: the record exists again.
      if (existing.op === 'delete') return { entry: fresh('update', existing), tombstone: 'remove' }
      return { entry: fresh(existing.op, existing), tombstone: 'remove' }
    case 'update':
      return { entry: fresh(existing.op === 'delete' ? 'update' : existing.op, existing), tombstone: 'keep' }
    case 'delete':
      if (existing.op === 'create' && !inFlight(existing)) return { entry: null, tombstone: 'keep' }
      return { entry: fresh('delete', existing), tombstone: 'write' }
  }
}

/** Outbox entries in send order. */
export const outboxOrder = (entries: readonly OutboxEntry[]) => [...entries].sort((a, b) => a.seq - b.seq)
