import type { BlobInfo, IntegritySnapshot } from '@/domain/integrity'
import type { FinanceDatabase } from './dexie'

/**
 * Everything the integrity audit needs, read in ONE read-only transaction (a
 * consistent snapshot; nothing can be written). Attachment binaries are not
 * read — only each Blob's size and type.
 */
export async function loadIntegritySnapshot(database: FinanceDatabase): Promise<IntegritySnapshot> {
  return database.transaction('r', database.tables, async () => {
    const blobs: BlobInfo[] = []
    await database.attachmentBlobs.each((row) => {
      blobs.push({ id: row.id, size: row.blob?.size ?? -1, type: row.blob?.type ?? '' })
    })
    return {
      accounts: await database.accounts.toArray(),
      categories: await database.categories.toArray(),
      transactions: await database.transactions.toArray(),
      recurringObligations: await database.recurringObligations.toArray(),
      scheduledPayments: await database.scheduledPayments.toArray(),
      debts: await database.debts.toArray(),
      budgets: await database.budgets.toArray(),
      attachments: await database.attachments.toArray(),
      blobs,
      meta: await database.meta.toArray(),
    }
  })
}
