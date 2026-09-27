import Dexie, { type EntityTable } from 'dexie'
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
import { DB_NAME, SCHEMA_VERSIONS } from './schema'

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

  constructor(name: string = DB_NAME) {
    super(name)
    for (const { version, stores, upgrade } of SCHEMA_VERSIONS) {
      const v = this.version(version).stores(stores)
      if (upgrade) v.upgrade(upgrade)
    }
  }
}

/** The app-wide database instance. Tests create their own via `new FinanceDatabase(name)`. */
export const db = new FinanceDatabase()
