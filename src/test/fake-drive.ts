/**
 * Test-only: an in-memory stand-in for the user's Google Drive app folder,
 * with the same contract as the real store (version check before upload).
 * The data file goes through the real encode/decode, so format validation is
 * exercised too.
 */
import type { DriveSnapshot } from '@/domain/drive-merge'
import { decodeRemote, encodeRemote } from '@/features/drive/remote-format'
import { RemoteConflictError, type RemoteStore } from '@/features/drive/sync-engine'

export interface FakeDrive {
  /** A store as one device sees it. */
  store(): RemoteStore
  /** Current file content (decoded), or null. */
  snapshot(): DriveSnapshot | null
  /** Raw text, e.g. to corrupt it in a test. */
  rawText: string | null
  writes: number
  reads: number
  attachmentNames(): string[]
  /** Runs once just before the next upload is accepted (simulate another device or a local edit). */
  beforeNextWrite?: () => Promise<void>
}

export function createFakeDrive(now: () => string = () => new Date().toISOString()): FakeDrive {
  let version = 0
  const files = new Map<string, { attachmentId: string; blob: Blob }>()
  let nextFileId = 1
  const drive: FakeDrive = {
    rawText: null,
    writes: 0,
    reads: 0,
    snapshot: () => (drive.rawText === null ? null : decodeRemote(drive.rawText)),
    attachmentNames: () => [...files.values()].map((f) => f.attachmentId).sort(),
    store: () => ({
      async version() {
        return drive.rawText === null ? null : String(version)
      },
      async read() {
        drive.reads++
        return drive.rawText === null ? null : { snapshot: decodeRemote(drive.rawText), version: String(version) }
      },
      async write(snapshot, expected) {
        const hook = drive.beforeNextWrite
        if (hook) {
          drive.beforeNextWrite = undefined
          await hook()
        }
        const current = drive.rawText === null ? null : String(version)
        if (current !== expected) throw new RemoteConflictError()
        drive.rawText = encodeRemote(snapshot, { now: now(), deviceId: 'test' })
        version++
        drive.writes++
        return String(version)
      },
      async listAttachments() {
        return new Map([...files].map(([fileId, f]) => [f.attachmentId, fileId]))
      },
      async uploadAttachment(attachmentId, blob) {
        files.set(`f${nextFileId++}`, { attachmentId, blob })
      },
      async downloadAttachment(remoteId) {
        const file = files.get(remoteId)
        if (!file) throw new Error('not found')
        return file.blob
      },
      async deleteAttachment(remoteId) {
        files.delete(remoteId)
      },
    }),
  }
  return drive
}
