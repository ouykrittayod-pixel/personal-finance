import type { Attachment, ID } from '@/domain/entities'
import type { FinanceDatabase } from '../dexie'

export function createAttachmentsRepository(database: FinanceDatabase) {
  return {
    /** Which of the given transactions have at least one attachment (metadata table only — no blobs loaded). */
    async transactionIdsWithAttachments(transactionIds: readonly ID[]): Promise<Set<ID>> {
      if (transactionIds.length === 0) return new Set()
      const rows = await database.attachments.where('transactionId').anyOf([...transactionIds]).toArray()
      return new Set(rows.flatMap((row) => (row.transactionId ? [row.transactionId] : [])))
    },

    /** Ids of all transactions that have attachments — read from the index only. */
    async allTransactionIdsWithAttachments(): Promise<Set<ID>> {
      const keys = await database.attachments.orderBy('transactionId').uniqueKeys()
      return new Set(keys.map(String))
    },

    /** Attachment metadata of one transaction (no binary data), oldest first. */
    async listForTransaction(transactionId: ID): Promise<Attachment[]> {
      const rows = await database.attachments.where('transactionId').equals(transactionId).toArray()
      return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    },

    /** The binary data of one attachment — loaded only when it is shown. */
    async getBlob(attachmentId: ID): Promise<Blob | undefined> {
      return (await database.attachmentBlobs.get(attachmentId))?.blob
    },
  }
}
