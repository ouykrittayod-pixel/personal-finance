/**
 * IndexedDB schema versions.
 *
 * Rules for changing the schema:
 * 1. NEVER edit a version that has shipped. Append a new entry instead.
 * 2. Each entry lists only tables whose indexes change (Dexie merges the rest);
 *    set a table to `null` to delete it.
 * 3. If existing records must be transformed, add an `upgrade` function.
 * 4. Bump BACKUP_FORMAT_VERSION in features/backup when entity shapes change,
 *    and keep import of older backups working.
 * 5. Bump DATA_SCHEMA_VERSION only when business records change shape. Local
 *    infrastructure tables (sync bookkeeping) change the Dexie version only.
 *
 * Index syntax (Dexie): first key = primary key; `&` unique; `[a+b]` compound;
 * `*` multi-entry. Only indexed fields can be queried with where().
 */
import type { Transaction as DexieTransaction } from 'dexie'
import { upgradeToV2 } from './sync/foundation'

export interface SchemaVersion {
  version: number
  stores: Record<string, string | null>
  upgrade?: (tx: DexieTransaction) => Promise<void> | void
}

export const DB_NAME = 'personal-finance'

export const SCHEMA_VERSIONS: readonly SchemaVersion[] = [
  {
    version: 1,
    stores: {
      accounts: 'id, kind, sortOrder',
      categories: 'id, kind, parentId, sortOrder',
      transactions:
        'id, date, type, accountId, toAccountId, categoryId, debtId, scheduledPaymentId, *tags, [type+date], [accountId+date]',
      recurringObligations: 'id, name',
      scheduledPayments: 'id, &[sourceType+sourceId+dueDate], [sourceType+sourceId], dueDate, status, [status+dueDate], transactionId',
      debts: 'id, kind, status, linkedAccountId',
      budgets: 'id, &[month+categoryId], month',
      attachments: 'id, transactionId, createdAt',
      attachmentBlobs: 'id',
      meta: 'key',
    },
  },
  {
    // Local sync foundation (Phase 18): device-local bookkeeping, never synced or backed up.
    // Occurrence ids become deterministic (see sync/foundation upgradeToV2).
    version: 2,
    stores: {
      syncOutbox: '[tableName+recordId], seq, tableName',
      syncTombstones: '[tableName+recordId], tableName',
      syncState: 'key',
      syncSettings: 'key',
    },
    upgrade: upgradeToV2,
  },
  {
    // Phase 19: this device's passphrase-WRAPPED encryption key (never the plain key). Device-local:
    // never synced, never in backups.
    version: 3,
    stores: { keyring: 'kid' },
  },
]

/** IndexedDB (Dexie) version: local storage layout, including device-only tables. */
export const LATEST_SCHEMA_VERSION = SCHEMA_VERSIONS.at(-1)?.version ?? 0

/**
 * Version of the business data (the records in backups). Stays 1: v2 only
 * added device-local tables and changed occurrence id values, not shapes.
 * Backups carry this number, so backup format v1 is unchanged.
 */
export const DATA_SCHEMA_VERSION = 1
