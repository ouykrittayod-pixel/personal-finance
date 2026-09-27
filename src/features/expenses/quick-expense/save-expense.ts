import { transactionsRepository } from '@/db/repositories'
import type { ExpenseDraft, TransactionDraft } from '@/domain/transactions'
import type { PendingAttachment } from '@/features/attachments'
import { newId } from '@/lib/ids'

export type SaveIncome = (draft: Omit<TransactionDraft, 'type'>, attachments: PendingAttachment[], transactionId: string) => Promise<void>

/** Income through the same repository path (buildTransaction, one IndexedDB transaction, fixed id). */
export const saveIncome: SaveIncome = async (draft, attachments, transactionId) => {
  await transactionsRepository.create({ ...draft, type: 'income' }, attachments, { id: transactionId, now: new Date().toISOString(), newId })
}

/** A transfer through the same path: money moves between two asset accounts; never income or expense. */
export const saveTransfer: SaveIncome = async (draft, attachments, transactionId) => {
  await transactionsRepository.create({ ...draft, type: 'transfer' }, attachments, { id: transactionId, now: new Date().toISOString(), newId })
}

export type SaveExpense = (draft: ExpenseDraft, attachments: PendingAttachment[], transactionId: string) => Promise<void>

/** Default persistence: repository → domain validation → one IndexedDB transaction. */
export const saveExpense: SaveExpense = async (draft, attachments, transactionId) => {
  await transactionsRepository.createExpense(draft, attachments, { id: transactionId, now: new Date().toISOString(), newId })
}
