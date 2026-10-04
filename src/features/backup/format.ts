/**
 * Backup file format (a portable copy of the local database).
 *
 * {
 *   format: 'personal-finance-backup', formatVersion: 1,
 *   appVersion, schemaVersion, exportedAt, currency: 'THB', calendar: 'gregorian',
 *   counts: { <table>: n },
 *   data: { <table>: [...records exactly as stored], attachmentBlobs: [{ id, type, base64 }] }
 * }
 *
 * - Records are stored as they are in IndexedDB: same IDs, integer satang,
 *   "YYYY-MM-DD" dates and UTC timestamps. Nothing is converted or derived.
 * - Attachment binaries are base64 of the exact bytes; `type` is the Blob's own
 *   MIME type (never re-encoded or converted).
 * - `meta` (last backup time, install time) is device state, not user data:
 *   it is neither backed up nor replaced by a restore.
 *
 * Version boundary: `readBackup` accepts only SUPPORTED_FORMAT_VERSIONS. A future
 * v2 adds a parser (and a v1 → v2 upgrade) there; nothing else changes.
 */
import type { Account, Attachment, Budget, Category, Debt, RecurringObligation, ScheduledPayment, Transaction } from '@/domain/entities'

export const BACKUP_FORMAT = 'personal-finance-backup'
export const BACKUP_FORMAT_VERSION = 1
export const SUPPORTED_FORMAT_VERSIONS: readonly number[] = [1]
export const BACKUP_CURRENCY = 'THB'
export const BACKUP_CALENDAR = 'gregorian'

/** Every user-data table, in restore order (referenced tables first). */
export const BACKUP_TABLES = [
  'accounts',
  'categories',
  'debts',
  'recurringObligations',
  'scheduledPayments',
  'transactions',
  'budgets',
  'attachments',
  'attachmentBlobs',
] as const
export type BackupTable = (typeof BACKUP_TABLES)[number]

/** How an attachment's binary data is written to JSON. */
export interface EncodedBlob {
  id: string
  /** Blob MIME type, preserved as-is. */
  type: string
  base64: string
}

export interface BackupData {
  accounts: Account[]
  categories: Category[]
  debts: Debt[]
  recurringObligations: RecurringObligation[]
  scheduledPayments: ScheduledPayment[]
  transactions: Transaction[]
  budgets: Budget[]
  attachments: Attachment[]
  attachmentBlobs: EncodedBlob[]
}

export type BackupCounts = Record<BackupTable, number>

export interface BackupFile {
  format: typeof BACKUP_FORMAT
  formatVersion: number
  appVersion: string
  schemaVersion: number
  exportedAt: string
  currency: typeof BACKUP_CURRENCY
  calendar: typeof BACKUP_CALENDAR
  counts: BackupCounts
  data: BackupData
}

/** Why a file cannot be restored. Messages shown to the user are keyed by kind; details go to the console only. */
export type BackupErrorKind =
  'invalid_json' | 'not_backup' | 'unsupported_version' | 'invalid_data' | 'duplicate_id' | 'broken_reference' | 'missing_attachment' | 'restore_failed'

export class BackupError extends Error {
  readonly kind: BackupErrorKind
  /** Where the problem is (table / record id / field) — never record contents. */
  readonly details: readonly string[]
  constructor(kind: BackupErrorKind, details: readonly string[] = [], cause?: unknown) {
    super(`${kind}${details.length ? `: ${details.slice(0, 5).join('; ')}` : ''}`, cause === undefined ? undefined : { cause })
    this.name = 'BackupError'
    this.kind = kind
    this.details = details
  }
}

/** personal-finance-backup-2026-09-26.json */
export function backupFileName(today: string): string {
  return `personal-finance-backup-${today}.json`
}
