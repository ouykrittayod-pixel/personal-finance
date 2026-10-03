/**
 * Reading a backup file: parse → format → version → records → IDs →
 * relationships → attachment data. Pure (no database access): the database
 * is never touched until the whole file has passed. Nothing is repaired or
 * skipped — the first failing stage rejects the file.
 */
import type { AttachmentBlob } from '@/domain/entities'
import { OVERALL_BUDGET } from '@/domain/budget'
import { DATA_SCHEMA_VERSION } from '@/db/schema'
import { base64ToBytes } from './base64'
import {
  BACKUP_CALENDAR,
  BACKUP_CURRENCY,
  BACKUP_FORMAT,
  BACKUP_TABLES,
  BackupError,
  SUPPORTED_FORMAT_VERSIONS,
  type BackupCounts,
  type BackupData,
  type BackupTable,
} from './format'
import { headerSchema, RECORD_SCHEMAS } from './schemas'

/** A validated backup, ready to replace the database (blobs already decoded). */
export interface PreparedRestore {
  exportedAt: string
  appVersion: string
  schemaVersion: number
  formatVersion: number
  counts: BackupCounts
  /** Total attachment bytes. */
  attachmentBytes: number
  records: Omit<BackupData, 'attachmentBlobs'>
  blobs: AttachmentBlob[]
}

export function readBackup(text: string): PreparedRestore {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    throw new BackupError('invalid_json', [], error)
  }

  if (typeof raw !== 'object' || raw === null || (raw as { format?: unknown }).format !== BACKUP_FORMAT) throw new BackupError('not_backup')
  const version = (raw as { formatVersion?: unknown }).formatVersion
  if (typeof version !== 'number' || !SUPPORTED_FORMAT_VERSIONS.includes(version))
    throw new BackupError('unsupported_version', [`formatVersion ${String(version)}`])

  // Version boundary: format v1 is the only one so far. A v2 parser (with a v1 → v2 upgrade) goes here.
  return readV1(raw)
}

function readV1(raw: unknown): PreparedRestore {
  const header = headerSchema.safeParse(raw)
  if (!header.success)
    throw new BackupError(
      'invalid_data',
      header.error.issues.map((issue) => `header.${issue.path.join('.')}: ${issue.message}`),
    )
  const { schemaVersion, currency, calendar, data } = header.data
  // Older schema versions would need a migration; none exist yet. Newer ones come from a newer app.
  if (schemaVersion !== DATA_SCHEMA_VERSION) throw new BackupError('unsupported_version', [`schemaVersion ${schemaVersion}`])
  if (currency !== BACKUP_CURRENCY || calendar !== BACKUP_CALENDAR) throw new BackupError('invalid_data', [`currency ${currency}`, `calendar ${calendar}`])

  // Records: every collection present, every record exactly the stored shape.
  const issues: string[] = []
  const parsed: Partial<Record<BackupTable, unknown[]>> = {}
  for (const table of BACKUP_TABLES) {
    const rows = data[table]
    if (!Array.isArray(rows)) {
      issues.push(`${table}: missing`)
      continue
    }
    const schema = RECORD_SCHEMAS[table]
    parsed[table] = rows.map((row, index) => {
      const result = schema.safeParse(row)
      if (!result.success) {
        const where = typeof (row as { id?: unknown })?.id === 'string' ? (row as { id: string }).id : `#${index}`
        for (const issue of result.error.issues) issues.push(`${table}[${where}].${issue.path.join('.')}: ${issue.message}`)
      }
      // Store the record exactly as written in the file (validated; strict schemas allow no extra fields).
      return row
    })
  }
  if (issues.length) throw new BackupError('invalid_data', issues)
  const d = parsed as unknown as BackupData

  const counts = Object.fromEntries(BACKUP_TABLES.map((table) => [table, d[table].length])) as BackupCounts
  const declared = (raw as { counts?: Partial<Record<BackupTable, unknown>> }).counts
  if (declared !== undefined) {
    const wrong = BACKUP_TABLES.filter((table) => declared[table] !== counts[table])
    if (wrong.length)
      throw new BackupError(
        'invalid_data',
        wrong.map((table) => `counts.${table}`),
      )
  }

  // IDs unique within each table.
  for (const table of BACKUP_TABLES) {
    const seen = new Set<string>()
    for (const row of d[table]) {
      if (seen.has(row.id)) issues.push(`${table}[${row.id}]`)
      seen.add(row.id)
    }
  }
  if (issues.length) throw new BackupError('duplicate_id', issues)

  // Unique indexes.
  const budgetKeys = new Set<string>()
  for (const budget of d.budgets) {
    const key = `${budget.month}|${budget.categoryId}`
    if (budgetKeys.has(key)) issues.push(`budgets[${budget.id}]: duplicate month+category`)
    budgetKeys.add(key)
  }
  const occurrenceKeys = new Set<string>()
  for (const payment of d.scheduledPayments) {
    const key = `${payment.sourceType}|${payment.sourceId}|${payment.dueDate}`
    if (occurrenceKeys.has(key)) issues.push(`scheduledPayments[${payment.id}]: duplicate source+dueDate`)
    occurrenceKeys.add(key)
  }
  if (issues.length) throw new BackupError('duplicate_id', issues)

  checkReferences(d)

  // Attachments: metadata and binary data match one to one, byte for byte.
  const encoded = new Map(d.attachmentBlobs.map((blob) => [blob.id, blob]))
  const attachmentIds = new Set(d.attachments.map((a) => a.id))
  const blobs: AttachmentBlob[] = []
  let attachmentBytes = 0
  for (const attachment of d.attachments) {
    const entry = encoded.get(attachment.id)
    if (!entry) {
      issues.push(`attachments[${attachment.id}]: blob missing`)
      continue
    }
    const bytes = base64ToBytes(entry.base64)
    if (!bytes || bytes.length !== attachment.sizeBytes) {
      issues.push(`attachmentBlobs[${attachment.id}]: data does not match size`)
      continue
    }
    blobs.push({ id: attachment.id, blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: entry.type }) })
    attachmentBytes += bytes.length
  }
  for (const blob of d.attachmentBlobs) if (!attachmentIds.has(blob.id)) issues.push(`attachmentBlobs[${blob.id}]: no attachment`)
  if (issues.length) throw new BackupError('missing_attachment', issues)

  const { attachmentBlobs: _encoded, ...records } = d
  return {
    exportedAt: header.data.exportedAt,
    appVersion: header.data.appVersion,
    schemaVersion,
    formatVersion: header.data.formatVersion,
    counts,
    attachmentBytes,
    records,
    blobs,
  }
}

/** Every reference points at a record in the same backup. */
function checkReferences(d: BackupData) {
  const ids = (rows: readonly { id: string }[]) => new Set(rows.map((row) => row.id))
  const accounts = ids(d.accounts)
  const categories = ids(d.categories)
  const debts = ids(d.debts)
  const obligations = ids(d.recurringObligations)
  const payments = ids(d.scheduledPayments)
  const transactions = ids(d.transactions)
  const issues: string[] = []
  const expect = (present: boolean, where: string) => {
    if (!present) issues.push(where)
  }
  const optional = (value: string | undefined, set: Set<string>, where: string) => expect(value === undefined || set.has(value), where)

  for (const c of d.categories) optional(c.parentId, categories, `categories[${c.id}].parentId`)
  for (const debt of d.debts) optional(debt.linkedAccountId, accounts, `debts[${debt.id}].linkedAccountId`)
  for (const o of d.recurringObligations) {
    optional(o.defaultAccountId, accounts, `recurringObligations[${o.id}].defaultAccountId`)
    optional(o.categoryId, categories, `recurringObligations[${o.id}].categoryId`)
    optional(o.debtId, debts, `recurringObligations[${o.id}].debtId`)
  }
  for (const p of d.scheduledPayments) {
    expect((p.sourceType === 'obligation' ? obligations : debts).has(p.sourceId), `scheduledPayments[${p.id}].sourceId`)
    optional(p.transactionId, transactions, `scheduledPayments[${p.id}].transactionId`)
  }
  for (const tx of d.transactions) {
    expect(accounts.has(tx.accountId), `transactions[${tx.id}].accountId`)
    optional(tx.toAccountId, accounts, `transactions[${tx.id}].toAccountId`)
    optional(tx.categoryId, categories, `transactions[${tx.id}].categoryId`)
    optional(tx.debtId, debts, `transactions[${tx.id}].debtId`)
    optional(tx.scheduledPaymentId, payments, `transactions[${tx.id}].scheduledPaymentId`)
  }
  for (const b of d.budgets) expect(b.categoryId === OVERALL_BUDGET || categories.has(b.categoryId), `budgets[${b.id}].categoryId`)
  for (const a of d.attachments) optional(a.transactionId, transactions, `attachments[${a.id}].transactionId`)
  if (issues.length) throw new BackupError('broken_reference', issues)
}
