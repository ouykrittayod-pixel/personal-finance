/**
 * Change tracking for the future sync, as a Dexie DBCore middleware: every
 * write to a synced table — through any repository, any Dexie API — records
 * its outbox entries and tombstones in the SAME IndexedDB transaction as the
 * write. If the write rolls back, so does the tracking; there is no window in
 * which data changed without an outbox entry (or the other way round).
 *
 * Nothing is sent anywhere. Nothing about the record's content is copied:
 * outbox entries hold table name, record id and operation only.
 *
 * Not tracked:
 * - schema upgrades (versionchange transactions) — migrations are not user changes;
 * - transactions passed to suppressSyncTracking (restore replaces the whole data set).
 */
import Dexie, { type DBCore, type DBCoreMutateRequest, type DBCoreMutateResponse, type DBCoreTable, type DBCoreTransaction, type Middleware } from 'dexie'
import {
  collapseOutbox,
  initialSyncState,
  SYNC_TABLES,
  SYNCED_TABLES,
  type OutboxEntry,
  type OutboxOp,
  type SyncedTable,
  type SyncSettings,
  type SyncState,
  type Tombstone,
} from '@/domain/sync'

const synced = new Set<string>(SYNCED_TABLES)
const suppressed = new WeakSet<object>()
/** Tracking inside one transaction runs one write at a time (outbox read-modify-write and seq allocation). */
const queues = new WeakMap<object, Promise<unknown>>()

/** Writes in this transaction are not tracked (restore, dev reset). Pass Dexie's `tx.idbtrans`. */
export function suppressSyncTracking(trans: object) {
  suppressed.add(trans)
}

export interface TrackingOptions {
  now?: () => string
  newId?: () => string
}

type Key = string

/**
 * Dexie keeps "the current transaction" in a zone (PSD) that native `await`
 * does not carry. Middleware below this one (hooks, live-query cache) reads
 * it, so every call downwards runs in the zone captured when the write began.
 */
type Zone = <T>(fn: () => T) => T
const zones = Dexie.Promise as unknown as { PSD: unknown; usePSD: <T>(psd: unknown, fn: () => T) => T }
const captureZone = (): Zone => {
  const psd = zones.PSD
  return (fn) => zones.usePSD(psd, fn)
}

const isUpgrade = (trans: DBCoreTransaction) => (trans as unknown as { mode?: string }).mode === 'versionchange'

export function syncTrackingMiddleware(options: TrackingOptions = {}): Middleware<DBCore> {
  const now = options.now ?? (() => new Date().toISOString())
  const newId = options.newId ?? (() => crypto.randomUUID())

  return {
    stack: 'dbcore',
    name: 'SyncTracking',
    create(down) {
      const outbox = () => down.table('syncOutbox')
      const tombstones = () => down.table('syncTombstones')
      const settings = () => down.table('syncSettings')
      const state = () => down.table('syncState')

      /** Device row and state row, created on first use (a fresh database has none). */
      async function identity(trans: DBCoreTransaction, z: Zone): Promise<{ deviceId: string; state: SyncState }> {
        const [device, current] = await Promise.all([z(() => settings().get({ trans, key: 'device' })), z(() => state().get({ trans, key: 'state' }))])
        let deviceId = (device as SyncSettings | undefined)?.deviceId
        if (!deviceId) {
          deviceId = newId()
          const row: SyncSettings = { key: 'device', deviceId, createdAt: now(), syncEnabled: false }
          await z(() => settings().mutate({ trans, type: 'put', values: [row], keys: ['device'] }))
        }
        return { deviceId, state: (current as SyncState | undefined) ?? initialSyncState() }
      }

      async function track(trans: DBCoreTransaction, tableName: SyncedTable, changes: readonly [Key, OutboxOp][], z: Zone) {
        if (!changes.length) return
        const { deviceId, state: current } = await identity(trans, z)
        const keys = changes.map(([id]) => [tableName, id])
        const existing = (await z(() => outbox().getMany({ trans, keys }))) as (OutboxEntry | undefined)[]
        const at = now()
        let seq = current.nextOutboxSeq
        const pending = new Map<Key, OutboxEntry | null>()
        // Last tombstone decision per record wins ('keep' changes nothing).
        const graves = new Map<Key, Tombstone | null>()
        changes.forEach(([recordId, op], i) => {
          const before = pending.has(recordId) ? (pending.get(recordId) ?? undefined) : existing[i]
          const result = collapseOutbox(before, op, { tableName, recordId, deviceId, now: at, seq: seq++, newOpId: newId })
          pending.set(recordId, result.entry)
          if (result.tombstone === 'write')
            graves.set(recordId, {
              tableName,
              recordId,
              deletedAt: at,
              deviceId,
              baseRevision: result.entry?.baseRevision ?? 0,
              opId: result.entry?.opId ?? newId(),
            })
          if (result.tombstone === 'remove') graves.set(recordId, null)
        })
        const puts = [...pending.values()].filter((e): e is OutboxEntry => e !== null)
        const removes = [...pending].filter(([, e]) => e === null).map(([id]) => [tableName, id])
        const dead = [...graves.values()].filter((g): g is Tombstone => g !== null)
        const revived = [...graves].filter(([, g]) => g === null).map(([id]) => [tableName, id])

        const nextState: SyncState = { ...current, nextOutboxSeq: seq }
        const write = (table: DBCoreTable, req: { type: 'put'; values: readonly unknown[]; keys: unknown[] } | { type: 'delete'; keys: unknown[] }) =>
          writes.push(z(() => table.mutate({ ...req, trans } as DBCoreMutateRequest)))
        const writes: Promise<DBCoreMutateResponse>[] = []
        write(state(), { type: 'put', values: [nextState], keys: ['state'] })
        if (puts.length) write(outbox(), { type: 'put', values: puts, keys: puts.map((e) => [e.tableName, e.recordId]) })
        if (removes.length) write(outbox(), { type: 'delete', keys: removes })
        if (dead.length) write(tombstones(), { type: 'put', values: dead, keys: dead.map((g) => [g.tableName, g.recordId]) })
        if (revived.length) write(tombstones(), { type: 'delete', keys: revived })
        for (const res of await Promise.all(writes)) if (res.numFailures) throw res.failures[0]
      }

      function queued(trans: DBCoreTransaction, work: () => Promise<void>) {
        const run = (queues.get(trans) ?? Promise.resolve()).then(work)
        queues.set(
          trans,
          run.catch(() => undefined),
        )
        return run
      }

      function trackedTable(table: DBCoreTable): DBCoreTable {
        const name = table.name as SyncedTable
        const keyOf = (value: unknown) => table.schema.primaryKey.extractKey!(value) as Key

        async function keysBefore(req: DBCoreMutateRequest, z: Zone): Promise<Key[]> {
          switch (req.type) {
            case 'add':
              return []
            case 'put':
              return (req.keys ?? req.values.map(keyOf)) as Key[]
            case 'delete':
              return req.keys as Key[]
            case 'deleteRange': {
              const res = await z(() => table.query({ trans: req.trans, values: false, query: { index: table.schema.primaryKey, range: req.range } }))
              return res.result as Key[]
            }
          }
        }

        return {
          ...table,
          async mutate(req) {
            if (isUpgrade(req.trans) || suppressed.has(req.trans)) return table.mutate(req)
            const z = captureZone()
            const keys = await keysBefore(req, z)
            const present = keys.length ? await z(() => table.getMany({ trans: req.trans, keys })) : []
            const res = await z(() => table.mutate(req))
            const failed = new Set(Object.keys(res.failures ?? {}).map(Number))
            const changes: [Key, OutboxOp][] = []
            if (req.type === 'add') {
              ;(res.results ?? []).forEach((key, i) => {
                if (!failed.has(i) && key !== undefined) changes.push([key as Key, 'create'])
              })
            } else if (req.type === 'put') {
              keys.forEach((key, i) => {
                if (!failed.has(i)) changes.push([key, present[i] === undefined ? 'create' : 'update'])
              })
            } else {
              keys.forEach((key, i) => {
                if (present[i] !== undefined) changes.push([key, 'delete'])
              })
            }
            await queued(req.trans, () => track(req.trans, name, changes, z))
            return res
          },
        }
      }

      return {
        ...down,
        transaction(stores, mode, options) {
          // A write to a synced table also needs the sync tables in its transaction.
          const widen = mode === 'readwrite' && stores.some((s) => synced.has(s)) && !SYNC_TABLES.every((s) => stores.includes(s))
          return down.transaction(widen ? [...new Set([...stores, ...SYNC_TABLES])] : stores, mode, options)
        },
        table(tableName) {
          const table = down.table(tableName)
          return synced.has(tableName) ? trackedTable(table) : table
        },
      }
    },
  }
}
