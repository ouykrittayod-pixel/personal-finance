/**
 * Consistency of the local sync bookkeeping with the data (pure). Reports
 * table / id / code only — never record contents.
 */
import type { ID, ScheduledPayment } from './entities'
import { occurrenceId } from './identity'
import { SYNCED_TABLES, type OutboxEntry, type SyncedTable, type SyncSettings, type Tombstone } from './sync'

export interface SyncAuditInput {
  records: Record<SyncedTable, readonly { id: ID }[]>
  outbox: readonly OutboxEntry[]
  tombstones: readonly Tombstone[]
  settings: SyncSettings | undefined
}

export interface SyncAuditIssue {
  table: string
  id: string
  code:
    | 'device_missing'
    | 'device_id_invalid'
    | 'sync_enabled'
    | 'unknown_table'
    | 'tombstone_for_live_record'
    | 'outbox_delete_for_live_record'
    | 'outbox_change_for_missing_record'
    | 'duplicate_seq'
    | 'occurrence_id_not_deterministic'
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function auditSyncConsistency(input: SyncAuditInput): SyncAuditIssue[] {
  const issues: SyncAuditIssue[] = []
  const known = new Set<string>(SYNCED_TABLES)
  const live = new Map<string, Set<ID>>(SYNCED_TABLES.map((table) => [table, new Set(input.records[table].map((r) => r.id))]))

  if (!input.settings) issues.push({ table: 'syncSettings', id: 'device', code: 'device_missing' })
  else {
    if (!UUID.test(input.settings.deviceId)) issues.push({ table: 'syncSettings', id: 'device', code: 'device_id_invalid' })
    if (input.settings.syncEnabled !== false) issues.push({ table: 'syncSettings', id: 'device', code: 'sync_enabled' })
  }

  const seqs = new Set<number>()
  for (const entry of input.outbox) {
    if (!known.has(entry.tableName)) {
      issues.push({ table: entry.tableName, id: entry.recordId, code: 'unknown_table' })
      continue
    }
    const exists = live.get(entry.tableName)!.has(entry.recordId)
    if (entry.op === 'delete' && exists) issues.push({ table: entry.tableName, id: entry.recordId, code: 'outbox_delete_for_live_record' })
    if (entry.op !== 'delete' && !exists) issues.push({ table: entry.tableName, id: entry.recordId, code: 'outbox_change_for_missing_record' })
    if (seqs.has(entry.seq)) issues.push({ table: entry.tableName, id: entry.recordId, code: 'duplicate_seq' })
    seqs.add(entry.seq)
  }
  for (const grave of input.tombstones) {
    if (!known.has(grave.tableName)) issues.push({ table: grave.tableName, id: grave.recordId, code: 'unknown_table' })
    else if (live.get(grave.tableName)!.has(grave.recordId)) issues.push({ table: grave.tableName, id: grave.recordId, code: 'tombstone_for_live_record' })
  }
  for (const p of input.records.scheduledPayments as readonly ScheduledPayment[])
    if (p.id !== occurrenceId(p.sourceType, p.sourceId, p.dueDate))
      issues.push({ table: 'scheduledPayments', id: p.id, code: 'occurrence_id_not_deterministic' })
  return issues
}
