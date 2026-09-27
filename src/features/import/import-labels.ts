import type { DatasetKind, DetectedType, ImportField, RowClassification, RowMessage, RowStatus } from '@/domain/import'
import type { DraftIssue } from '@/domain/transactions'
import { issuesToErrors } from '@/features/transaction-form/errors'
import { importMessages, ti, type ImportMessageKey } from './import-messages'

/** Thai text for a validation message. Rule violations reuse the transaction form's wording. */
export function messageText(message: Pick<RowMessage, 'code'>): string {
  if (message.code.startsWith('rule_')) {
    const errors = issuesToErrors([message.code.slice(5) as DraftIssue])
    const text = Object.values(errors.fields)[0] ?? errors.form
    return `${ti('import.msg.rule')}: ${text ?? message.code.slice(5)}`
  }
  const key = `import.msg.${message.code}`
  return key in importMessages ? ti(key as ImportMessageKey) : message.code
}

export const statusLabel = (status: RowStatus) => ti(`import.status.${status}`)
export const kindLabel = (kind: RowClassification) => ti(`import.kindValue.${kind}`)
export const datasetLabel = (kind: DatasetKind) => ti(`import.kind.${kind}`)
export const typeLabel = (type: DetectedType) => ti(`import.type.${type}`)
export const fieldLabel = (field: ImportField) => ti(`import.field.${field}`)

/** Tone classes shared by status chips (existing design tokens; text + colour, never colour alone). */
export const STATUS_TONE: Record<RowStatus, string> = {
  ready: 'bg-income/10 text-income',
  warning: 'bg-warning/10 text-warning',
  error: 'bg-expense/10 text-expense',
  review: 'bg-info/10 text-info',
  ignored: 'bg-muted text-muted-foreground',
}
export const LEVEL_TONE: Record<RowMessage['level'], string> = {
  error: 'text-expense',
  warning: 'text-warning',
  info: 'text-muted-foreground',
}
