import Dexie, { type EntityTable, type Table } from 'dexie'
import type {
  Account,
  Attachment,
  AttachmentBlob,
  Budget,
  Category,
  Debt,
  MetaEntry,
  RecurringObligation,
  ScheduledPayment,
  Transaction,
} from '@/domain/entities'
import type { OutboxEntry, SyncSettings, SyncState, Tombstone } from '@/domain/sync'
import type { WrappedKey } from '@/lib/crypto/keyring'
import { DB_NAME, SCHEMA_VERSIONS } from './schema'
import { syncTrackingMiddleware } from './sync/tracking'

export class FinanceDatabase extends Dexie {
  declare accounts: EntityTable<Account, 'id'>
  declare categories: EntityTable<Category, 'id'>
  declare transactions: EntityTable<Transaction, 'id'>
  declare recurringObligations: EntityTable<RecurringObligation, 'id'>
  declare scheduledPayments: EntityTable<ScheduledPayment, 'id'>
  declare debts: EntityTable<Debt, 'id'>
  declare budgets: EntityTable<Budget, 'id'>
  declare attachments: EntityTable<Attachment, 'id'>
  declare attachmentBlobs: EntityTable<AttachmentBlob, 'id'>
  declare meta: EntityTable<MetaEntry, 'key'>
  // Device-local sync bookkeeping (Phase 18; no network sync exists).
  declare syncOutbox: Table<OutboxEntry, [string, string]>
  declare syncTombstones: Table<Tombstone, [string, string]>
  declare syncState: EntityTable<SyncState, 'key'>
  declare syncSettings: EntityTable<SyncSettings, 'key'>
  /** Passphrase-wrapped data key (Phase 19). The unwrapped key is never stored. */
  declare keyring: EntityTable<WrappedKey, 'kid'>

  constructor(name: string = DB_NAME) {
    super(name)
    for (const { version, stores, upgrade } of SCHEMA_VERSIONS) {
      const v = this.version(version).stores(stores)
      if (upgrade) v.upgrade(upgrade)
    }
    // Every write to a synced table records its outbox entry in the same transaction.
    this.use(syncTrackingMiddleware())
  }
}

/** The app-wide database instance. Tests create their own via `new FinanceDatabase(name)`. */
export const db = new FinanceDatabase()
