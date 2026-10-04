/**
 * One sync pass between this device's cache and the user's Google Drive:
 *
 *   read cache → read Drive file → merge → upload if Drive is behind →
 *   write the merge back to the cache → move attachment files both ways.
 *
 * Drive is the shared copy. The cache only exists so the app opens instantly
 * and keeps working offline; changes made offline go up on the next pass.
 *
 * Drive has no compare-and-swap on file content, so an upload first checks
 * that the file is still the version that was merged; if another device got
 * there first, the pass starts again. The merge is a union with tombstones,
 * so even an upload that slips through that check heals on the next pass.
 */
import { applyMergedSnapshot, attachmentsWithoutBlob, readLocalSnapshot } from '@/db/sync/drive-local'
import type { FinanceDatabase } from '@/db/dexie'
import { mergeSnapshots, sameSnapshot, versionOf, type DriveSnapshot } from '@/domain/drive-merge'
import { SYNCED_TABLES } from '@/domain/sync'

export interface RemoteFile {
  snapshot: DriveSnapshot
  version: string
}

/** Storage for the data file and attachment files (Google Drive in the app, in memory in tests). */
export interface RemoteStore {
  /** Version of the data file, or null when there is none yet. Cheap: no content. */
  version(): Promise<string | null>
  read(): Promise<RemoteFile | null>
  /** Upload the data file. `expected` is the version that was merged (null: there was no file). */
  write(snapshot: DriveSnapshot, expected: string | null): Promise<string>
  /** Attachment id → remote file id, for every attachment file stored. */
  listAttachments(): Promise<Map<string, string>>
  uploadAttachment(attachmentId: string, blob: Blob, mimeType: string): Promise<void>
  downloadAttachment(remoteId: string): Promise<Blob>
  deleteAttachment(remoteId: string): Promise<void>
}

/** The remote file changed between read and write. */
export class RemoteConflictError extends Error {
  constructor() {
    super('Drive data file changed during sync')
    this.name = 'RemoteConflictError'
  }
}

export interface SyncOptions {
  now?: () => string
  /** Version this device last synced with; when unchanged and nothing is pending, the pass is skipped. */
  lastVersion?: string | null
  /** After restoring a backup: the cache replaces Drive's data instead of merging with it. */
  replaceRemote?: boolean
  maxAttempts?: number
}

export interface SyncResult {
  version: string | null
  skipped: boolean
  uploaded: boolean
  /** Records changed in the cache because Drive had newer data. */
  downloaded: number
  attachmentsUploaded: number
  attachmentsDownloaded: number
  /** Attachment files that could not be moved this time (retried next pass). */
  attachmentsFailed: number
}

/** The cache becomes the truth: every record is re-stamped, everything else in Drive is deleted. */
export function replacementSnapshot(local: DriveSnapshot, remote: DriveSnapshot | null, now: string): DriveSnapshot {
  const data = {} as DriveSnapshot['data']
  for (const table of SYNCED_TABLES) data[table] = local.data[table].map((record) => (record.updatedAt === undefined ? record : { ...record, updatedAt: now > versionOf(record) ? now : versionOf(record) }))
  const keep = new Set(SYNCED_TABLES.flatMap((table) => data[table].map((record) => `${table}\u0000${record.id}`)))
  const graves = new Map<string, DriveSnapshot['tombstones'][number]>()
  for (const grave of remote?.tombstones ?? []) if (!keep.has(`${grave.tableName}\u0000${grave.recordId}`)) graves.set(`${grave.tableName}\u0000${grave.recordId}`, grave)
  for (const table of SYNCED_TABLES)
    for (const record of remote?.data[table] ?? []) {
      const k = `${table}\u0000${record.id}`
      if (!keep.has(k)) graves.set(k, { tableName: table, recordId: record.id, deletedAt: now > versionOf(record) ? now : versionOf(record) })
    }
  return { data, tombstones: [...graves.values()] }
}

export async function syncOnce(database: FinanceDatabase, store: RemoteStore, options: SyncOptions = {}): Promise<SyncResult> {
  const now = options.now ?? (() => new Date().toISOString())
  const maxAttempts = options.maxAttempts ?? 4

  if (!options.replaceRemote && options.lastVersion) {
    const [local, version] = await Promise.all([readLocalSnapshot(database), store.version()])
    if (local.pending === 0 && version === options.lastVersion && (await attachmentsWithoutBlob(database)).length === 0)
      return { version, skipped: true, uploaded: false, downloaded: 0, attachmentsUploaded: 0, attachmentsDownloaded: 0, attachmentsFailed: 0 }
  }

  for (let attempt = 1; ; attempt++) {
    const local = await readLocalSnapshot(database)
    const remote = await store.read()
    const stamp = now()
    const merged = options.replaceRemote ? replacementSnapshot(local.snapshot, remote?.snapshot ?? null, stamp) : mergeSnapshots(local.snapshot, remote?.snapshot ?? null, stamp)

    let version = remote?.version ?? null
    let uploaded = false
    if (!remote || !sameSnapshot(merged, remote.snapshot)) {
      try {
        version = await store.write(merged, remote?.version ?? null)
        uploaded = true
      } catch (error) {
        if (error instanceof RemoteConflictError && attempt < maxAttempts) continue
        throw error
      }
    }

    const { changed } = await applyMergedSnapshot(database, merged, local.mark, stamp)
    const files = await syncAttachments(database, store, merged)
    return { version, skipped: false, uploaded, downloaded: changed, ...files }
  }
}

/** Upload files Drive lacks, download files this device lacks, delete files of removed attachments. */
async function syncAttachments(database: FinanceDatabase, store: RemoteStore, merged: DriveSnapshot) {
  const result = { attachmentsUploaded: 0, attachmentsDownloaded: 0, attachmentsFailed: 0 }
  const wanted = new Set(merged.data.attachments.map((a) => a.id))
  const remote = await store.listAttachments()
  const localIds = new Set(await database.attachmentBlobs.toCollection().primaryKeys())

  for (const id of localIds) {
    if (!wanted.has(id) || remote.has(id)) continue
    const blob = await database.attachmentBlobs.get(id)
    if (!blob) continue
    try {
      const meta = merged.data.attachments.find((a) => a.id === id)
      await store.uploadAttachment(id, blob.blob, String(meta?.mimeType ?? (blob.blob.type || 'application/octet-stream')))
      result.attachmentsUploaded++
    } catch {
      result.attachmentsFailed++
    }
  }
  for (const [id, remoteId] of remote) {
    if (!wanted.has(id)) {
      await store.deleteAttachment(remoteId).catch(() => undefined)
      continue
    }
    if (localIds.has(id)) continue
    try {
      const blob = await store.downloadAttachment(remoteId)
      await database.attachmentBlobs.put({ id, blob })
      result.attachmentsDownloaded++
    } catch {
      result.attachmentsFailed++
    }
  }
  return result
}
