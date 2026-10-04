/**
 * The data file kept in the user's Google Drive (hidden app folder):
 *
 *   { format: "personal-finance-drive", formatVersion: 1, schemaVersion, updatedAt, updatedBy,
 *     data: { accounts: [...], …, attachments: [...] }, tombstones: [{ tableName, recordId, deletedAt }] }
 *
 * Records have exactly the stored shape (same strict schemas as backups), so a
 * damaged or foreign file is rejected before anything touches the device.
 * Attachment files are stored next to it as separate Drive files.
 */
import { z } from 'zod'
import { DATA_SCHEMA_VERSION } from '@/db/schema'
import { emptySnapshot, type DriveSnapshot, type SyncRecord } from '@/domain/drive-merge'
import { SYNCED_TABLES, type SyncedTable } from '@/domain/sync'
import { RECORD_SCHEMAS } from '@/features/backup/schemas'

export const DRIVE_FORMAT = 'personal-finance-drive'
export const DRIVE_FORMAT_VERSION = 1
export const DRIVE_DATA_FILE = 'personal-finance-data.json'
export const attachmentFileName = (attachmentId: string) => `attachment-${attachmentId}`
export const ATTACHMENT_FILE_PREFIX = 'attachment-'

export class RemoteFormatError extends Error {
  readonly reason: 'invalid' | 'newer_app'
  readonly details: string[]
  constructor(reason: 'invalid' | 'newer_app', details: string[] = []) {
    super(`Drive data file rejected (${reason})`)
    this.name = 'RemoteFormatError'
    this.reason = reason
    this.details = details
  }
}

const tombstoneSchema = z.strictObject({
  tableName: z.enum(SYNCED_TABLES),
  recordId: z.string().min(1).max(200),
  deletedAt: z.string().min(1),
})

const headerSchema = z.object({
  format: z.literal(DRIVE_FORMAT),
  formatVersion: z.number().int(),
  schemaVersion: z.number().int().positive(),
  updatedAt: z.string(),
  updatedBy: z.string(),
  data: z.record(z.string(), z.unknown()),
  tombstones: z.array(z.unknown()),
})

export function encodeRemote(snapshot: DriveSnapshot, meta: { now: string; deviceId: string }): string {
  return JSON.stringify({
    format: DRIVE_FORMAT,
    formatVersion: DRIVE_FORMAT_VERSION,
    schemaVersion: DATA_SCHEMA_VERSION,
    updatedAt: meta.now,
    updatedBy: meta.deviceId,
    data: snapshot.data,
    tombstones: snapshot.tombstones,
  })
}

export function decodeRemote(text: string): DriveSnapshot {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new RemoteFormatError('invalid', ['json'])
  }
  const header = headerSchema.safeParse(raw)
  if (!header.success) throw new RemoteFormatError('invalid', header.error.issues.map((i) => `header.${i.path.join('.')}`))
  if (header.data.formatVersion > DRIVE_FORMAT_VERSION || header.data.schemaVersion > DATA_SCHEMA_VERSION) throw new RemoteFormatError('newer_app')

  const snapshot = emptySnapshot()
  const issues: string[] = []
  for (const table of SYNCED_TABLES) {
    const rows = header.data.data[table] ?? []
    if (!Array.isArray(rows)) {
      issues.push(`data.${table}`)
      continue
    }
    const schema = RECORD_SCHEMAS[table as SyncedTable]
    rows.forEach((row, index) => {
      const parsed = schema.safeParse(row)
      if (parsed.success) snapshot.data[table].push(parsed.data as unknown as SyncRecord)
      else issues.push(`data.${table}[${index}]`)
    })
  }
  header.data.tombstones.forEach((row, index) => {
    const parsed = tombstoneSchema.safeParse(row)
    if (parsed.success) snapshot.tombstones.push(parsed.data)
    else issues.push(`tombstones[${index}]`)
  })
  if (issues.length) throw new RemoteFormatError('invalid', issues.slice(0, 20))
  return snapshot
}
